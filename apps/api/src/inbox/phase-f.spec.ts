process.env.ENCRYPTION_KEY = Buffer.alloc(32, 7).toString("base64");
process.env.DISABLE_SCHEDULER = "true";

import { InboxService } from "./inbox.service";
import { WebchatService } from "./webchat.service";
import { parseMetaWebhook } from "./webhook.parser";
import { CustomersService } from "../customers/customers.service";
import { MessagingService } from "../messaging/messaging.service";
import { computeRfm, segmentFor } from "../messaging/rfm";
import { DevTemplateProvider } from "../ai/llm/dev.provider";

function matches(row: any, where: any): boolean {
  return Object.entries(where ?? {}).every(([k, v]: [string, any]) => {
    if (v === undefined) return true;
    if (k === "OR") return (v as any[]).some((sub) => matches(row, sub));
    if (v !== null && typeof v === "object" && !(v instanceof Date)) {
      if ("not" in v) return row[k] !== v.not;
      if ("in" in v) return v.in.includes(row[k]);
      if ("gt" in v) return row[k] > v.gt;
      if ("contains" in v) return String(row[k] ?? "").toLowerCase().includes(String(v.contains).toLowerCase());
      return true;
    }
    return row[k] === v;
  });
}
function makeTable(name: string) {
  const rows: any[] = [];
  let seq = 0;
  return {
    rows,
    findFirst: async ({ where }: any = {}) => rows.find((r) => matches(r, where ?? {})) ?? null,
    findMany: async ({ where, take }: any = {}) => {
      const f = rows.filter((r) => matches(r, where ?? {}));
      return take ? f.slice(0, take) : f;
    },
    findUnique: async ({ where }: any) => rows.find((r) => matches(r, where ?? {})) ?? null,
    create: async ({ data }: any) => { const row = { id: `${name}-${++seq}`, createdAt: new Date(), updatedAt: new Date(), ...data }; rows.push(row); return row; },
    update: async ({ where, data }: any) => {
      const row = rows.find((r) => matches(r, where ?? {}));
      if (!row) return null;
      for (const [k, v] of Object.entries(data)) {
        if (v !== null && typeof v === "object" && "increment" in (v as any)) (row as any)[k] = ((row as any)[k] ?? 0) + (v as any).increment;
        else (row as any)[k] = v;
      }
      return row;
    },
    updateMany: async ({ where, data }: any) => {
      let count = 0;
      for (const row of rows) if (matches(row, where ?? {})) { Object.assign(row, data); count++; }
      return { count };
    },
  };
}
const NAMES = ["integration", "integrationCredential", "channelConversation", "channelMessage", "conversationNote", "lead", "leadActivity", "customer", "order", "membership", "user", "messageDraft", "inboxSetting", "businessPolicy", "product", "widgetSite", "liveChatSession", "agentPresence", "agentNotification", "broadcast", "messageDelivery", "whatsAppTemplate", "courierShipment"];
function fakePrisma() {
  const tables: Record<string, any> = {};
  for (const n of NAMES) tables[n] = makeTable(n);
  tables.businessProfile = { findUnique: async () => ({ industry: "fashion", description: "x", brandVoice: "friendly" }) };
  // membership findMany with include user: rows carry a joined user object
  const origMembers = tables.membership.findMany;
  tables.membership.findMany = async (args: any) => {
    const rows = await origMembers(args);
    return rows.map((r: any) => ({ ...r, user: tables.user.rows.find((u: any) => u.id === r.userId) ?? null }));
  };
  const origMemberFirst = tables.membership.findFirst;
  tables.membership.findFirst = async (args: any) => {
    const row = await origMemberFirst(args);
    return row ? { ...row, user: tables.user.rows.find((u: any) => u.id === row.userId) ?? null } : null;
  };
  return tables;
}
const auditStub = { log: async () => undefined } as any;
const llmStub = { getProvider: () => new DevTemplateProvider() } as any;

describe("M17 Instagram parser", () => {
  it("parses Instagram DM webhooks into the instagram channel", () => {
    const parsed = parseMetaWebhook({
      object: "instagram",
      entry: [{ messaging: [{ sender: { id: "igsid-1" }, timestamp: 1728000000000, message: { mid: "ig-m1", text: "দাম কত?" } }] }],
    });
    expect(parsed.messages).toHaveLength(1);
    expect(parsed.messages[0].channel).toBe("instagram");
    expect(parsed.messages[0].externalContactId).toBe("igsid-1");
    const fb = parseMetaWebhook({ object: "page", entry: [{ messaging: [{ sender: { id: "p1" }, timestamp: 1728000000000, message: { mid: "m1", text: "hi" } }] }] });
    expect(fb.messages[0].channel).toBe("messenger");
  });
});

describe("M17 website live chat", () => {
  it("runs visitor -> inbox -> agent reply end to end on our own channel", async () => {
    const tables = fakePrisma();
    const inbox = new InboxService(tables as any, auditStub, llmStub);
    const webchat = new WebchatService(tables as any, auditStub, inbox);
    const site = await webchat.createSite("org-1", "owner", { name: "Main Store", greeting: "স্বাগতম!" });
    expect(site.widgetKey).toMatch(/^wc_/);
    const start = await webchat.startSession(site.widgetKey, { visitorId: "v-1", name: "Nabil" });
    expect(start.greeting).toBe("স্বাগতম!");
    await webchat.postMessage(site.widgetKey, { token: start.token, text: "আপনাদের ডেলিভারি চার্জ কত?" });
    const conv = tables.channelConversation.rows[0];
    expect(conv.channel).toBe("webchat");
    expect(tables.lead.rows).toHaveLength(1);
    // agent replies from the inbox - no external platform involved
    const sent = await inbox.sendReply("org-1", "agent-1", conv.id, "ঢাকায় ৬০ টাকা, বাইরে ১২০ টাকা।");
    expect(sent.status).toBe("sent");
    const visible = await webchat.listMessages(site.widgetKey, start.token);
    expect(visible.map((m: any) => m.direction)).toEqual(["in", "out"]);
    // a forged token is refused
    await expect(webchat.listMessages(site.widgetKey, "f".repeat(64))).rejects.toThrow("Invalid chat session token");
    // session row never stores the raw token
    expect(JSON.stringify(tables.liveChatSession.rows)).not.toContain(start.token);
  });
});

describe("M17 customer merge", () => {
  it("moves orders + conversations, fills gaps, hides the source", async () => {
    const tables = fakePrisma();
    tables.customer.rows.push(
      { id: "c-source", organizationId: "org-1", firstName: "Rahim", phone: "01711111111", email: null, source: "chat", mergedIntoId: null, createdAt: new Date(1) },
      { id: "c-target", organizationId: "org-1", firstName: "Rahim Uddin", phone: null, email: "r@example.com", source: "woocommerce", mergedIntoId: null, createdAt: new Date(2) },
    );
    tables.order.rows.push({ id: "o1", organizationId: "org-1", customerId: "c-source", totalMinor: 50000n, status: "completed", currency: "BDT", createdAt: new Date() });
    tables.channelConversation.rows.push({ id: "cv1", organizationId: "org-1", customerId: "c-source", channel: "whatsapp", status: "open", createdAt: new Date() });
    const svc = new CustomersService(tables as any, auditStub);
    const detail = await svc.merge("org-1", "admin", { sourceId: "c-source", targetId: "c-target" });
    expect(detail.lifetime.totalSpentMinor).toBe("50000");
    expect(detail.customer.phone).toBe("01711111111"); // gap filled from source
    expect(tables.order.rows[0].customerId).toBe("c-target");
    expect(tables.channelConversation.rows[0].customerId).toBe("c-target");
    const list = await svc.list("org-1");
    expect(list.map((c: any) => c.id)).toEqual(["c-target"]); // source hidden
    await expect(svc.merge("org-1", "admin", { sourceId: "c-source", targetId: "c-target" })).rejects.toThrow("already merged");
  });
});

describe("M17 RFM + segment audience + A/B split", () => {
  function seed(tables: any) {
    const day = 86400000;
    const mk = (id: string, daysAgo: number, count: number, totalEach: number) => {
      tables.customer.rows.push({ id, organizationId: "org-1", firstName: id, phone: `0170000000${id.slice(-1)}`, email: `${id}@x.com`, mergedIntoId: null, createdAt: new Date() });
      for (let i = 0; i < count; i++) {
        tables.order.rows.push({
          id: `${id}-o${i}`, organizationId: "org-1", customerId: id, status: "completed",
          totalMinor: BigInt(totalEach), placedAt: new Date(Date.now() - daysAgo * day - i * day), createdAt: new Date(),
        });
      }
    };
    mk("champ", 1, 6, 90000);
    mk("lost1", 200, 1, 10000);
    mk("reg01", 40, 2, 30000);
    mk("reg02", 60, 2, 25000);
    mk("reg03", 30, 3, 20000);
  }
  it("scores quintiles and labels segments from real orders", async () => {
    const tables = fakePrisma(); seed(tables);
    const rows = await computeRfm(tables as any, "org-1");
    const champ = rows.find((r) => r.customerId === "champ")!;
    expect(champ.r).toBe(5); expect(champ.f).toBe(5); expect(champ.m).toBe(5);
    expect(champ.segment).toBe("champions");
    const lost = rows.find((r) => r.customerId === "lost1")!;
    expect(lost.segment).toBe("lost");
    expect(segmentFor(5, 5, 5)).toBe("champions");
    expect(segmentFor(1, 1, 1)).toBe("lost");
  });
  it("segment audiences and A/B sends partition the audience exactly once", async () => {
    const tables = fakePrisma(); seed(tables);
    const emailStub = { isConfigured: () => true, send: async () => ({ providerMessageId: "smtp-1" }) } as any;
    const smsStub = { isConfigured: () => true, send: async () => ({ providerMessageId: "sms-1" }) } as any;
    const svc = new MessagingService(tables as any, auditStub, emailStub, smsStub);
    const segAudience = await svc.resolveAudience("org-1", "email", "segment", undefined, "champions");
    expect(segAudience.map((r) => r.id)).toEqual(["champ"]);
    const created: any = await svc.createBroadcast("org-1", "admin", {
      name: "Promo", channel: "email", subject: "A subject", body: "Body A", audienceType: "customers",
      abTest: true, abBody: "Body B",
    });
    expect(created.variants).toHaveLength(2);
    const [a, b] = created.variants;
    await svc.sendBroadcast("org-1", "admin", a.id);
    await svc.sendBroadcast("org-1", "admin", b.id);
    const deliveries = tables.messageDelivery.rows;
    expect(deliveries.length).toBe(5); // every customer exactly once
    expect(new Set(deliveries.map((d: any) => d.recipientId)).size).toBe(5);
    const aIds = new Set(deliveries.filter((d: any) => d.broadcastId === a.id).map((d: any) => d.recipientId));
    const bIds = new Set(deliveries.filter((d: any) => d.broadcastId === b.id).map((d: any) => d.recipientId));
    expect([...aIds].filter((x) => bIds.has(x))).toHaveLength(0);
  });
});

describe("M17 presence + notifications", () => {
  function seedTeam(tables: any) {
    tables.user.rows.push(
      { id: "u-rahim", name: "Rahim Uddin", email: "rahim@x.com" },
      { id: "u-karim", name: "Karim Islam", email: "karim@x.com" },
    );
    tables.membership.rows.push(
      { id: "m1", organizationId: "org-1", userId: "u-rahim", role: "SUPPORT_AGENT" },
      { id: "m2", organizationId: "org-1", userId: "u-karim", role: "SUPPORT_AGENT" },
    );
    tables.channelConversation.rows.push({
      id: "conv-1", organizationId: "org-1", channel: "whatsapp", externalContactId: "8801",
      contactName: "Customer", status: "open", unreadCount: 0, tags: [], assignedUserId: null, createdAt: new Date(),
    });
  }
  it("shows other active agents (collision detection) and ignores stale presence", async () => {
    const tables = fakePrisma(); seedTeam(tables);
    const svc = new InboxService(tables as any, auditStub, llmStub);
    const mine = await svc.heartbeatPresence("org-1", "u-rahim", "conv-1", true);
    expect(mine.others).toHaveLength(0);
    const theirs = await svc.heartbeatPresence("org-1", "u-karim", "conv-1", false);
    expect(theirs.others).toHaveLength(1);
    expect(theirs.others[0].name).toBe("Rahim Uddin");
    expect(theirs.others[0].typing).toBe(true);
    // age rahim's heartbeat beyond the 45s window
    tables.agentPresence.rows.find((r: any) => r.userId === "u-rahim").lastSeenAt = new Date(Date.now() - 120000);
    const after = await svc.heartbeatPresence("org-1", "u-karim", "conv-1", false);
    expect(after.others).toHaveLength(0);
  });
  it("notifies on assignment (not self-assignment) and on @mentions in notes", async () => {
    const tables = fakePrisma(); seedTeam(tables);
    const svc = new InboxService(tables as any, auditStub, llmStub);
    await svc.updateConversation("org-1", "u-rahim", "conv-1", { assignedUserId: "u-rahim" }); // self: no notify
    expect(tables.agentNotification.rows).toHaveLength(0);
    await svc.updateConversation("org-1", "u-rahim", "conv-1", { assignedUserId: "u-karim" });
    expect(tables.agentNotification.rows).toHaveLength(1);
    expect(tables.agentNotification.rows[0].type).toBe("assigned");
    expect(tables.agentNotification.rows[0].userId).toBe("u-karim");
    await svc.addNote("org-1", "u-karim", "conv-1", "@rahim এই অর্ডারটা একটু দেখবেন?");
    const mention = tables.agentNotification.rows.find((n: any) => n.type === "mention");
    expect(mention?.userId).toBe("u-rahim");
    const unread = await svc.unreadNotificationCount("org-1", "u-rahim");
    expect(unread.count).toBe(1);
  });
});
