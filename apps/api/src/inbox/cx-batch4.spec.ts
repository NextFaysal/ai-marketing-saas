import { createHmac } from "crypto";

process.env.ENCRYPTION_KEY = Buffer.alloc(32, 7).toString("base64");
process.env.DISABLE_SCHEDULER = "true";

import { InboxService } from "./inbox.service";
import { encryptJson } from "../integrations/crypto";
import { DevTemplateProvider } from "../ai/llm/dev.provider";
import { KnowledgeService } from "../knowledge/knowledge.service";
import { MessagingService } from "../messaging/messaging.service";
import { LeadsService, DEFAULT_STAGE_FOLLOWUP_DAYS } from "../crm/leads.service";

function matches(row: any, where: any, tables: any): boolean {
  return Object.entries(where ?? {}).every(([k, v]: [string, any]) => {
    if (v === undefined) return true;
    if (k === "OR") return (v as any[]).some((sub) => matches(row, sub, tables));
    if (k === "conversation") {
      const conv = tables.channelConversation.rows.find((c: any) => c.id === row.conversationId);
      return Boolean(conv) && matches(conv, v, tables);
    }
    if (v !== null && typeof v === "object" && !(v instanceof Date)) {
      if ("not" in v) return row[k] !== v.not;
      if ("in" in v) return v.in.includes(row[k]);
      if ("gt" in v) return row[k] > v.gt;
      if ("gte" in v) return row[k] >= v.gte;
      if ("lt" in v) return row[k] < v.lt;
      if ("lte" in v) return row[k] <= v.lte;
      if ("has" in v) return Array.isArray(row[k]) && row[k].includes(v.has);
      return true;
    }
    return row[k] === v;
  });
}

function makeTable(name: string, tables: any) {
  const rows: any[] = [];
  let seq = 0;
  return {
    rows,
    findFirst: async ({ where }: any = {}) => rows.find((r) => matches(r, where ?? {}, tables)) ?? null,
    findMany: async ({ where, take }: any = {}) => {
      const filtered = rows.filter((r) => matches(r, where ?? {}, tables));
      return take ? filtered.slice(0, take) : filtered;
    },
    findUnique: async ({ where }: any = {}) => rows.find((r) => matches(r, where ?? {}, tables)) ?? null,
    create: async ({ data }: any) => {
      const row = { id: `${name}-${++seq}`, createdAt: new Date(), updatedAt: new Date(), ...data };
      rows.push(row);
      return row;
    },
    update: async ({ where, data }: any) => {
      const row = rows.find((r) => matches(r, where ?? {}, tables));
      if (!row) return null;
      Object.assign(row, data, { updatedAt: new Date() });
      return row;
    },
    delete: async ({ where }: any) => {
      const idx = rows.findIndex((r) => matches(r, where ?? {}, tables));
      return idx >= 0 ? rows.splice(idx, 1)[0] : null;
    },
    deleteMany: async () => ({ count: 0 }),
    count: async ({ where }: any = {}) => rows.filter((r) => matches(r, where ?? {}, tables)).length,
  };
}

describe("CX Batch 4 (CX7 Chase, CX12c Voice Order, CX9 Knowledge Ingestion, CX10 Broadcast Polish)", () => {
  const auditStub = { log: jest.fn(async () => undefined) } as any;
  const llmStub = { getProvider: () => new DevTemplateProvider() } as any;

  describe("CX7: To Chase (Incomplete Chat Order Chase)", () => {
    it("skips chasing when chase is disabled or not due yet", async () => {
      const tables: Record<string, any> = {};
      for (const t of ["inboxSetting", "botSession", "channelConversation", "channelMessage", "conversationNote", "integration", "product"]) {
        tables[t] = makeTable(t, tables);
      }
      tables.inboxSetting.rows.push({
        id: "s1", organizationId: "org-1", botEnabled: true, chaseEnabled: false, chaseIntervalMinutes: 30, maxChaseAttempts: 2,
      });
      tables.botSession.rows.push({
        id: "bot-1", organizationId: "org-1", conversationId: "conv-1", state: "ask_quantity", status: "active", chaseCount: 0,
        createdAt: new Date(Date.now() - 40 * 60000), updatedAt: new Date(Date.now() - 40 * 60000),
      });

      const svc = new InboxService(tables as any, auditStub, llmStub);
      const res = await svc.runChaseSweep("org-1");
      expect(res.chased).toBe(0);
      expect(res.reason).toBe("chase_disabled");
    });

    it("sends a polite reminder when bot session is stuck past interval and increments chaseCount", async () => {
      const tables: Record<string, any> = {};
      for (const t of ["inboxSetting", "botSession", "channelConversation", "channelMessage", "conversationNote", "integration", "product"]) {
        tables[t] = makeTable(t, tables);
      }
      tables.inboxSetting.rows.push({
        id: "s1", organizationId: "org-1", botEnabled: true, chaseEnabled: true, chaseIntervalMinutes: 30, maxChaseAttempts: 2,
        chaseMessage: "ভাইয়া, আপনার অর্ডারটি কি নিশ্চিত করব?",
      });
      const secrets = encryptJson({ accessToken: "tok", appSecret: "appsecret", verifyToken: "vtok", phoneNumberId: "999" });
      tables.integration.rows.push({ id: "int-1", organizationId: "org-1", provider: "whatsapp", status: "CONNECTED", credential: { encryptedData: secrets } });

      tables.channelConversation.rows.push({
        id: "conv-1", organizationId: "org-1", channel: "webchat", status: "open", assignedUserId: null,
      });
      tables.botSession.rows.push({
        id: "bot-1", organizationId: "org-1", conversationId: "conv-1", state: "ask_quantity", status: "active", chaseCount: 0,
        createdAt: new Date(Date.now() - 35 * 60000), updatedAt: new Date(Date.now() - 35 * 60000),
      });

      const svc = new InboxService(tables as any, auditStub, llmStub);
      const res = await svc.runChaseSweep("org-1");
      expect(res.chased).toBe(1);

      const session = tables.botSession.rows[0];
      expect(session.chaseCount).toBe(1);
      expect(session.lastChasedAt).toBeDefined();

      const outMsgs = tables.channelMessage.rows.filter((m: any) => m.direction === "out");
      expect(outMsgs.length).toBeGreaterThan(0);
      expect(outMsgs[0].content).toContain("ভাইয়া, আপনার অর্ডারটি কি নিশ্চিত করব?");
    });

    it("marks session expired when maxChaseAttempts is reached", async () => {
      const tables: Record<string, any> = {};
      for (const t of ["inboxSetting", "botSession", "channelConversation", "channelMessage", "conversationNote", "integration", "product"]) {
        tables[t] = makeTable(t, tables);
      }
      tables.inboxSetting.rows.push({
        id: "s1", organizationId: "org-1", botEnabled: true, chaseEnabled: true, chaseIntervalMinutes: 30, maxChaseAttempts: 2,
      });
      tables.channelConversation.rows.push({
        id: "conv-1", organizationId: "org-1", channel: "webchat", status: "open", assignedUserId: null,
      });
      tables.botSession.rows.push({
        id: "bot-1", organizationId: "org-1", conversationId: "conv-1", state: "ask_quantity", status: "active", chaseCount: 2,
        createdAt: new Date(Date.now() - 40 * 60000), updatedAt: new Date(Date.now() - 40 * 60000),
      });

      const svc = new InboxService(tables as any, auditStub, llmStub);
      const res = await svc.runChaseSweep("org-1");
      expect(res.chased).toBe(0);
      expect(res.expired).toBe(1);
      expect(tables.botSession.rows[0].status).toBe("expired");
    });

    it("cancels cleanly when customer sends cancel words", async () => {
      const tables: Record<string, any> = {};
      for (const t of ["inboxSetting", "botSession", "channelConversation", "channelMessage", "conversationNote", "integration", "product"]) {
        tables[t] = makeTable(t, tables);
      }
      tables.inboxSetting.rows.push({ id: "s1", organizationId: "org-1", botEnabled: true });
      const conv = { id: "conv-1", organizationId: "org-1", channel: "webchat", status: "open" };
      tables.channelConversation.rows.push(conv);
      tables.botSession.rows.push({
        id: "bot-1", organizationId: "org-1", conversationId: "conv-1", state: "ask_quantity", status: "active",
      });

      const svc = new InboxService(tables as any, auditStub, llmStub);
      const consumed = await (svc as any).handleOrderBot("org-1", conv, "অর্ডার বাতিল করতে চাই", { intent: "other" });
      expect(consumed).toBe(true);
      expect(tables.botSession.rows[0].status).toBe("expired");
      const outMsgs = tables.channelMessage.rows.filter((m: any) => m.direction === "out");
      expect(outMsgs[0].content).toContain("অর্ডারটি বাতিল করা হয়েছে");
    });
  });

  describe("CX12c: Voice Note Order & Auto-Transcription", () => {
    it("auto-transcribes inbound audio and forwards transcript into intelligence pipeline", async () => {
      const tables: Record<string, any> = {};
      for (const t of ["inboxSetting", "botSession", "channelConversation", "channelMessage", "conversationNote", "integration", "product"]) {
        tables[t] = makeTable(t, tables);
      }
      tables.inboxSetting.rows.push({ id: "s1", organizationId: "org-1", botEnabled: true });
      const conv = { id: "conv-1", organizationId: "org-1", channel: "webchat", status: "open" };
      tables.channelConversation.rows.push(conv);
      const msg = {
        id: "msg-audio-1", conversationId: "conv-1", direction: "in", type: "audio", mediaContentType: "audio/ogg",
      };
      tables.channelMessage.rows.push(msg);

      const svc = new InboxService(tables as any, auditStub, llmStub);
      jest.spyOn(svc, "transcribeMessage").mockResolvedValueOnce({
        transcription: "শাড়িটির দাম কত?", provider: "openai/whisper-1", intent: "price",
      });

      await (svc as any).processInboundIntelligence("org-1", conv, msg, { type: "audio" });
      expect(svc.transcribeMessage).toHaveBeenCalledWith("org-1", "conv-1", "msg-audio-1");
    });
  });

  describe("CX9: Knowledge Base File Ingestion", () => {
    it("extracts text from plain text or markdown and creates KnowledgeDocument with chunk metadata", async () => {
      const tables: Record<string, any> = {};
      tables.businessPolicy = makeTable("businessPolicy", tables);
      tables.knowledgeDocument = makeTable("knowledgeDocument", tables);

      const svc = new KnowledgeService(tables as any, auditStub);

      const content = "আমাদের রিটার্ন পলিসি: পণ্য গ্রহণের ৭ দিনের মধ্যে যোগাযোগ করুন।\n\nডেলিভারি চার্জ: ঢাকার ভেতর ৬০ টাকা, ঢাকার বাইরে ১২০ টাকা।";
      const base64 = Buffer.from(content, "utf-8").toString("base64");

      const result = await svc.ingestFile("org-1", "user-1", {
        filename: "policy.txt",
        dataBase64: base64,
        kind: "file_doc",
      });

      expect(result.success).toBe(true);
      expect(result.totalChunks).toBe(1);
      expect(result.documents[0].sourceFile).toBe("policy.txt");
      expect(result.documents[0].chunkIndex).toBe(0);
      expect(result.documents[0].content).toContain("রিটার্ন পলিসি");
    });

    it("splits long files into ordered chunks", async () => {
      const tables: Record<string, any> = {};
      tables.businessPolicy = makeTable("businessPolicy", tables);
      tables.knowledgeDocument = makeTable("knowledgeDocument", tables);

      const svc = new KnowledgeService(tables as any, auditStub);

      const paragraph = "আমাদের প্রতিষ্ঠানে গ্রাহকের সন্তুষ্টিই প্রথম অগ্রাধিকার। প্রতিটি পণ্যের গুণগত মান আমরা যাচাই করে থাকি। ".repeat(10);
      const longText = `${paragraph}\n\n${paragraph}\n\n${paragraph}\n\n${paragraph}`;
      const base64 = Buffer.from(longText, "utf-8").toString("base64");

      const result = await svc.ingestFile("org-1", "user-1", {
        filename: "faq_manual.md",
        dataBase64: base64,
      });

      expect(result.totalChunks).toBeGreaterThan(1);
      expect(result.documents.length).toBe(result.totalChunks);
      expect(result.documents[0].title).toContain("(অংশ 1/");
      expect(result.documents[1].title).toContain("(অংশ 2/");
    });

    it("rejects empty files with descriptive error", async () => {
      const tables: Record<string, any> = {};
      tables.businessPolicy = makeTable("businessPolicy", tables);
      tables.knowledgeDocument = makeTable("knowledgeDocument", tables);

      const svc = new KnowledgeService(tables as any, auditStub);

      await expect(
        svc.ingestFile("org-1", "user-1", {
          filename: "empty.txt",
          dataBase64: Buffer.from("   ", "utf-8").toString("base64"),
        })
      ).rejects.toThrow("পাঠযোগ্য তথ্য পাওয়া যায়নি");
    });
  });

  describe("CX10: Follow-up Timing Settings + Broadcast Polish", () => {
    it("automatically computes nextFollowUpAt when lead created with stage", async () => {
      const tables: Record<string, any> = {};
      tables.lead = makeTable("lead", tables);
      tables.leadActivity = makeTable("leadActivity", tables);
      tables.crmSetting = makeTable("crmSetting", tables);

      const svc = new LeadsService(tables as any, undefined, auditStub, null as any);
      // Integration: stamping is settings-driven (CX10) — the org
      // configures the same intervals the owner's static map held
      // (new = 1 day, proposal = 5 days, expressed in hours).
      await svc.updateFollowUpSetting("org-1", { new: 24, proposal: 120 });

      const before = Date.now();
      const lead = await svc.create("org-1", "user-1", {
        name: "Rahim",
        phone: "01711223344",
        stage: "new",
      });

      expect(lead.nextFollowUpAt).toBeDefined();
      const dueTime = new Date(lead.nextFollowUpAt).getTime();
      const expectedDays = DEFAULT_STAGE_FOLLOWUP_DAYS.new;
      expect(dueTime).toBeGreaterThanOrEqual(before + (expectedDays * 86400000) - 5000);
    });

    it("updates nextFollowUpAt when lead stage changes without explicit follow-up date", async () => {
      const tables: Record<string, any> = {};
      tables.lead = makeTable("lead", tables);
      tables.leadActivity = makeTable("leadActivity", tables);
      tables.crmSetting = makeTable("crmSetting", tables);

      const svc = new LeadsService(tables as any, undefined, auditStub, null as any);
      await svc.updateFollowUpSetting("org-1", { new: 24, proposal: 120 });

      const lead = await svc.create("org-1", "user-1", {
        name: "Karim",
        stage: "new",
        nextFollowUpAt: new Date(Date.now() + 10000).toISOString(),
      });

      const beforeUpdate = Date.now();
      const updated = await svc.update("org-1", "user-1", lead.id, {
        stage: "proposal",
      });

      expect(updated.stage).toBe("proposal");
      const dueTime = new Date(updated.nextFollowUpAt).getTime();
      const expectedDays = DEFAULT_STAGE_FOLLOWUP_DAYS.proposal;
      expect(dueTime).toBeGreaterThanOrEqual(beforeUpdate + (expectedDays * 86400000) - 5000);
    });

    it("previews audience with accurate count, opt-out filtering, and masked samples", async () => {
      const tables: Record<string, any> = {};
      tables.customer = makeTable("customer", tables);
      tables.lead = makeTable("lead", tables);
      tables.messageDelivery = makeTable("messageDelivery", tables);
      tables.broadcast = makeTable("broadcast", tables);
      tables.template = makeTable("template", tables);

      tables.customer.rows.push(
        { id: "c1", organizationId: "org-1", firstName: "Alice", email: "alice@example.com", phone: "01711111111", unsubscribed: false },
        { id: "c2", organizationId: "org-1", firstName: "Bob", email: "bob@example.com", phone: "01722222222", unsubscribed: false },
        { id: "c3", organizationId: "org-1", firstName: "Charlie", email: "charlie@example.com", phone: "01733333333", unsubscribed: true },
      );

      const svc = new MessagingService(tables as any, auditStub, {} as any, {} as any);
      const preview = await svc.previewAudience("org-1", {
        channel: "email",
        audienceType: "customers",
        excludeOptOut: true,
      });

      expect(preview.totalRaw).toBe(3);
      expect(preview.totalEligible).toBe(2);
      expect(preview.excludedCount).toBe(1);
      expect(preview.sample).toHaveLength(2);
      expect(preview.sample[0].maskedContact).toContain("***@example.com");
    });

    it("excludes recent broadcast recipients when excludePastDays is set", async () => {
      const tables: Record<string, any> = {};
      tables.customer = makeTable("customer", tables);
      tables.lead = makeTable("lead", tables);
      tables.messageDelivery = makeTable("messageDelivery", tables);
      tables.broadcast = makeTable("broadcast", tables);
      tables.template = makeTable("template", tables);

      tables.customer.rows.push(
        { id: "c1", organizationId: "org-1", firstName: "Alice", email: "alice@example.com", phone: "01711111111", unsubscribed: false },
        { id: "c2", organizationId: "org-1", firstName: "Bob", email: "bob@example.com", phone: "01722222222", unsubscribed: false },
      );

      tables.messageDelivery.rows.push({
        id: "d1", organizationId: "org-1", address: "alice@example.com", recipientId: "c1",
        createdAt: new Date(Date.now() - 2 * 24 * 3600 * 1000),
      });

      const svc = new MessagingService(tables as any, auditStub, {} as any, {} as any);
      const preview = await svc.previewAudience("org-1", {
        channel: "email",
        audienceType: "customers",
        excludePastDays: 7,
      });

      expect(preview.totalEligible).toBe(1);
      expect(preview.sample[0].id).toBe("c2");
      expect(preview.excludedCount).toBe(1);
    });
  });
});
