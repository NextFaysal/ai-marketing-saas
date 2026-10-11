import { createHmac } from "crypto";

process.env.ENCRYPTION_KEY = Buffer.alloc(32, 7).toString("base64");

import { InboxService } from "./inbox.service";
import { encryptJson } from "../integrations/crypto";
import { DevTemplateProvider } from "../ai/llm/dev.provider";

function matches(row: any, where: any, tables: any): boolean {
  return Object.entries(where).every(([k, v]: [string, any]) => {
    if (v === undefined) return true;
    if (k === "conversation") {
      const conv = tables.channelConversation.rows.find((c: any) => c.id === row.conversationId);
      return conv && matches(conv, v, tables);
    }
    if (v !== null && typeof v === "object" && !(v instanceof Date)) {
      if ("not" in v) return row[k] !== v.not;
      if ("in" in v) return v.in.includes(row[k]);
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
    findFirst: async ({ where }: any) => rows.find((r) => matches(r, where ?? {}, tables)) ?? null,
    findMany: async ({ where, take }: any = {}) => { const f = rows.filter((r) => matches(r, where ?? {}, tables)); return take ? f.slice(0, take) : f; },
    findUnique: async ({ where }: any) => rows.find((r) => r.id === where.id) ?? null,
    // Inbox Next-Gen P3: checkAiAllowed counts today's usage per
    // feature — the fake honours the same where the service sends.
    count: async ({ where }: any = {}) => rows.filter((r) => matches(r, where ?? {}, tables)).length,
    create: async ({ data }: any) => { const row = { id: `${name}-${++seq}`, createdAt: new Date(), updatedAt: new Date(), ...data }; rows.push(row); return row; },
    update: async ({ where, data }: any) => {
      const row = rows.find((r) => r.id === where.id);
      for (const [k, v] of Object.entries(data)) {
        if (v !== null && typeof v === "object" && "increment" in (v as any)) (row as any)[k] = ((row as any)[k] ?? 0) + (v as any).increment;
        else (row as any)[k] = v;
      }
      return row;
    },
  };
}
function fakePrisma() {
  const tables: Record<string, any> = {};
  for (const name of ["integration", "channelConversation", "channelMessage", "lead", "leadActivity", "customer", "membership", "businessPolicy", "product", "messageDraft", "aIUsageRecord"]) {
    tables[name] = makeTable(name, tables);
  }
  tables.businessProfile = { findUnique: async () => ({ industry: "fashion", description: "Clothing store", brandVoice: "friendly" }) };
  const secrets = encryptJson({ accessToken: "tok", appSecret: "appsecret", verifyToken: "vtok", phoneNumberId: "999" });
  tables.integration.rows.push({ id: "int-1", organizationId: "org-1", provider: "whatsapp", status: "CONNECTED", credential: { encryptedData: secrets } });
  tables.product.rows.push({ id: "p1", organizationId: "org-1", status: "ACTIVE", name: "Cotton Panjabi", priceMinor: 150000n, currency: "BDT", stockQuantity: 12 });
  return tables;
}

const waBody = (extra: any = {}) => JSON.stringify({
  object: "whatsapp_business_account",
  entry: [{ changes: [{ value: {
    contacts: [{ profile: { name: "Karim" }, wa_id: "8801711111111" }],
    messages: [{ from: "8801711111111", id: "wamid.in1", timestamp: "1728000000", type: "text", text: { body: "Cotton Panjabi এর দাম কত?" } }],
    ...extra,
  } }] }],
});
const sign = (body: string) => "sha256=" + createHmac("sha256", "appsecret").update(body, "utf8").digest("hex");

const llmStub = { getProvider: () => new DevTemplateProvider() } as any;
const auditStub = { log: async () => undefined } as any;

describe("InboxService webhooks", () => {
  it("verifies the subscription challenge against the stored verify token", async () => {
    const svc = new InboxService(fakePrisma() as any, auditStub, llmStub);
    await expect(svc.verifySubscription("int-1", "subscribe", "vtok", "CH-42")).resolves.toBe("CH-42");
    await expect(svc.verifySubscription("int-1", "subscribe", "WRONG", "CH-42")).resolves.toBeNull();
  });

  it("rejects bad signatures", async () => {
    const svc = new InboxService(fakePrisma() as any, auditStub, llmStub);
    await expect(svc.handleWebhook("int-1", waBody(), "sha256=deadbeef")).rejects.toThrow("signature");
  });

  it("stores inbound messages once (idempotent), opens a conversation and auto-creates a lead", async () => {
    const prisma = fakePrisma();
    const svc = new InboxService(prisma as any, auditStub, llmStub);
    const first = await svc.handleWebhook("int-1", waBody(), sign(waBody()));
    expect(first).toMatchObject({ received: 1, duplicates: 0 });
    const retry = await svc.handleWebhook("int-1", waBody(), sign(waBody()));
    expect(retry).toMatchObject({ received: 0, duplicates: 1 });
    expect(prisma.channelMessage.rows).toHaveLength(1);
    expect(prisma.channelConversation.rows[0]).toMatchObject({ unreadCount: 1, contactName: "Karim" });
    expect(prisma.lead.rows).toHaveLength(1);
    expect(prisma.lead.rows[0]).toMatchObject({ source: "whatsapp", phone: "8801711111111" });
  });
});

describe("InboxService sending + drafts", () => {
  async function setup() {
    const prisma = fakePrisma();
    const svc = new InboxService(prisma as any, auditStub, llmStub);
    await svc.handleWebhook("int-1", waBody(), sign(waBody()));
    const conv = prisma.channelConversation.rows[0];
    return { prisma, svc, conv };
  }

  it("marks a reply sent ONLY with an API message id; failures stay failed and throw", async () => {
    const { prisma, svc, conv } = await setup();
    (global as any).fetch = async () => ({ ok: true, status: 200, json: async () => ({ messages: [{ id: "wamid.out1" }] }) });
    const sent = await svc.sendReply("org-1", "user-1", conv.id, "ধন্যবাদ!");
    expect(sent).toMatchObject({ status: "sent", externalId: "wamid.out1" });

    (global as any).fetch = async () => ({ ok: false, status: 400, json: async () => ({ error: { message: "outside 24h window" } }) });
    await expect(svc.sendReply("org-1", "user-1", conv.id, "আবার চেষ্টা")).rejects.toThrow("NOT sent");
    const failed = prisma.channelMessage.rows.find((m: any) => m.status === "failed");
    expect(failed.error).toContain("24h window");
  });

  it("AI draft is grounded in the real product price and is never sent by itself", async () => {
    const { prisma, svc, conv } = await setup();
    const draft = await svc.suggestDraft("org-1", "user-1", conv.id);
    expect(draft.status).toBe("suggested");
    expect(draft.content).toContain("1500.00");
    expect(draft.provider).toBe("dev-template");
    // No outbound message exists yet - the AI only suggested.
    expect(prisma.channelMessage.rows.filter((m: any) => m.direction === "out")).toHaveLength(0);

    (global as any).fetch = async () => ({ ok: true, status: 200, json: async () => ({ messages: [{ id: "wamid.out9" }] }) });
    const sent = await svc.sendDraft("org-1", "user-1", conv.id, draft.id);
    expect(sent.status).toBe("sent");
    expect(prisma.messageDraft.rows[0].status).toBe("sent");
    expect(prisma.channelMessage.rows.find((m: any) => m.direction === "out").sentByAiDraft).toBe(true);
  });
});
