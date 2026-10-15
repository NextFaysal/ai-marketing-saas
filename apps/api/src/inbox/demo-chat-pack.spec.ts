import "reflect-metadata";
import { InboxService } from "./inbox.service";
import { PracticeService } from "./practice.service";
import { PracticeController } from "./practice.controller";
import { MetaMessagingClient } from "./meta-messaging.client";
import { DEMO_PACK_SCENARIOS } from "./demo-pack";
import { ROLES_KEY } from "../common/decorators";

/**
 * Demo Chat Pack — extends CX12a Practice Mode with 12 labelled
 * demo scenarios. Fake prisma only; the proofs that matter:
 *  (ক) mode OFF refuses, nothing is created;
 *  (খ) a load creates exactly 12 practice conversations on real
 *      channel names — yet NO Customer row and the integration
 *      table is never even queried;
 *  (গ) the REAL deliverText guard still refuses to hand a demo
 *      conversation to any channel sender;
 *  (ঘ) a second load is a no-op (idempotent);
 *  (ঙ) folder counts / unreadTotal ignore the demo rows;
 *  (চ) practice cleanup wipes the whole pack;
 *  (ছ) the demo-pack route carries the expected @Roles metadata.
 */
type Row = Record<string, any>;

function eqVal(a: any, b: any): boolean {
  if (a instanceof Date && b instanceof Date) return a.getTime() === b.getTime();
  if (a instanceof Date || b instanceof Date) return new Date(a).getTime() === new Date(b).getTime();
  return a === b;
}
function match(row: Row, where: any = {}): boolean {
  return Object.entries(where ?? {}).every(([k, raw]) => {
    const v = raw as any;
    if (v === undefined) return true;
    if (k === "AND") return (v as any[]).every((w) => match(row, w));
    if (k === "OR") return (v as any[]).some((w) => match(row, w));
    if (v === null) return row[k] === null || row[k] === undefined;
    if (v && typeof v === "object" && !(v instanceof Date)) {
      if ("in" in v) return (v.in as any[]).includes(row[k]);
      if ("notIn" in v) return !(v.notIn as any[]).includes(row[k]);
      if ("startsWith" in v) return typeof row[k] === "string" && row[k].startsWith(v.startsWith);
      if ("contains" in v) {
        if (typeof row[k] !== "string") return false;
        return v.mode === "insensitive" ? row[k].toLowerCase().includes(String(v.contains).toLowerCase()) : row[k].includes(v.contains);
      }
      if ("not" in v) {
        if (v.not === null) return row[k] !== null && row[k] !== undefined;
        if (typeof v.not === "object") return !match(row, { [k]: v.not });
        return !eqVal(row[k], v.not);
      }
      if ("gte" in v && !(new Date(row[k]).getTime() >= new Date(v.gte).getTime())) return false;
      if ("gt" in v && !(new Date(row[k]).getTime() > new Date(v.gt).getTime())) return false;
      if ("lte" in v && !(new Date(row[k]).getTime() <= new Date(v.lte).getTime())) return false;
      if ("lt" in v && !(new Date(row[k]).getTime() < new Date(v.lt).getTime())) return false;
      if ("equals" in v) return eqVal(row[k], v.equals);
      return true;
    }
    return eqVal(row[k], v);
  });
}
function sortRows(rows: Row[], orderBy: any): Row[] {
  if (!orderBy) return rows;
  const entries = Array.isArray(orderBy) ? orderBy : [orderBy];
  let out = [...rows];
  for (const e of [...entries].reverse()) {
    const [key, dir] = Object.entries(e)[0] as [string, string];
    out = out.sort((a, b) => {
      const av = a[key] instanceof Date ? new Date(a[key]).getTime() : a[key];
      const bv = b[key] instanceof Date ? new Date(b[key]).getTime() : b[key];
      const cmp = (av ?? 0) < (bv ?? 0) ? -1 : (av ?? 0) > (bv ?? 0) ? 1 : 0;
      return dir === "desc" ? -cmp : cmp;
    });
  }
  return out;
}
function table(store: Row[]) {
  return {
    findMany: jest.fn(async ({ where, take, orderBy, skip }: any = {}) => {
      let rows = sortRows(store.filter((r) => match(r, where)), orderBy);
      if (skip) rows = rows.slice(skip);
      return take ? rows.slice(0, take) : rows;
    }),
    findFirst: jest.fn(async ({ where, orderBy }: any = {}) => {
      const rows = sortRows(store.filter((r) => match(r, where)), orderBy);
      return rows[0] ?? null;
    }),
    findUnique: jest.fn(async ({ where }: any = {}) => store.find((r) => match(r, where)) ?? null),
    create: jest.fn(async ({ data }: any) => { const row = { id: `row-${Math.random().toString(36).slice(2, 9)}`, createdAt: new Date(), updatedAt: new Date(), ...data }; store.push(row); return row; }),
    update: jest.fn(async ({ where, data }: any) => { const row = store.find((r) => r.id === where.id || match(r, where)); if (!row) throw new Error("nf"); Object.assign(row, data); return row; }),
    updateMany: jest.fn(async ({ where, data }: any) => { let n = 0; for (const r of store) if (match(r, where)) { Object.assign(r, data); n++; } return { count: n }; }),
    deleteMany: jest.fn(async ({ where }: any = {}) => { let n = 0; for (let i = store.length - 1; i >= 0; i--) if (match(store[i], where)) { store.splice(i, 1); n++; } return { count: n }; }),
    delete: jest.fn(async ({ where }: any = {}) => { const i = store.findIndex((r) => r.id === where.id || match(r, where)); if (i >= 0) store.splice(i, 1); return {}; }),
    count: jest.fn(async ({ where }: any = {}) => store.filter((r) => match(r, where)).length),
    aggregate: jest.fn(async ({ where }: any = {}) => ({ _sum: { unreadCount: store.filter((r) => match(r, where)).reduce((s, r) => s + (r.unreadCount ?? 0), 0) } })),
  };
}

const ORG = "org-1";
const ACTOR = "owner-1";

function harness() {
  const stores = {
    organizations: [{ id: ORG, name: "টেস্ট শপ", timezone: "Asia/Dhaka", practiceMode: false }] as Row[],
    conversations: [] as Row[],
    messages: [] as Row[],
    notes: [] as Row[],
    botSessions: [] as Row[],
    orders: [] as Row[],
    orderItems: [] as Row[],
    customers: [] as Row[],
    integrations: [] as Row[],
    products: [
      { id: "p1", organizationId: ORG, name: "কটন শাড়ি", priceMinor: 120000n, currency: "BDT", status: "ACTIVE", createdAt: new Date("2026-01-01") },
    ] as Row[],
  };
  const db: any = {
    organization: table(stores.organizations),
    channelConversation: table(stores.conversations),
    channelMessage: table(stores.messages),
    conversationNote: table(stores.notes),
    botSession: table(stores.botSessions),
    order: table(stores.orders),
    orderItem: table(stores.orderItems),
    customer: table(stores.customers),
    integration: table(stores.integrations),
    product: table(stores.products),
    messageDraft: table([] as Row[]),
    orderChase: table([] as Row[]),
    orderReview: table([] as Row[]),
    inboxSetting: table([{ id: "s1", organizationId: ORG, slaFirstResponseMinutes: 60, escalationThresholdMinor: null }] as Row[]),
  };
  db.$transaction = jest.fn(async (fn: any) => fn(db));
  const audit = { calls: [] as any[], log: jest.fn(async (e: any) => { audit.calls.push(e); }) };
  const llm = { getProvider: () => { throw new Error("no provider configured"); } };
  const practice = new PracticeService(db as any, audit as any, { ingestChatMessage: jest.fn(async () => undefined) } as any);
  const inbox = new InboxService(db as any, audit as any, llm as any, { emit: jest.fn() } as any);
  return { stores, db, audit, practice, inbox };
}

async function loadedHarness() {
  const h = harness();
  await h.practice.setPracticeMode(ORG, ACTOR, true);
  const res = await h.practice.loadDemoPack(ORG, ACTOR);
  return { ...h, res };
}

describe("Demo Chat Pack — load", () => {
  it("(ক) practiceMode OFF: honest Bengali refusal, nothing created", async () => {
    const h = harness();
    await expect(h.practice.loadDemoPack(ORG, ACTOR)).rejects.toThrow(/আগে Practice Mode চালু করুন — তারপর Demo Chat লোড হবে/);
    expect(h.stores.conversations.length).toBe(0);
    expect(h.stores.messages.length).toBe(0);
    expect(h.stores.orders.length).toBe(0);
  });

  it("(খ) load creates exactly 12 practice conversations with messages, practice orders, note and bot session — no Customer row, integration table never queried", async () => {
    const { stores, db, audit, practice, res } = await loadedHarness();
    expect(res.created).toBe(true);
    expect(res.count).toBe(12);
    expect(res.scenarios.length).toBe(12);
    expect(res.scenarios.map((s: any) => s.slug)).toEqual(DEMO_PACK_SCENARIOS.map((s) => s.slug));
    for (const s of res.scenarios) {
      expect(typeof s.conversationId).toBe("string");
      expect(s.title).toBeTruthy();
      expect(s.feature).toBeTruthy();
    }

    expect(stores.conversations.length).toBe(12);
    for (const c of stores.conversations) {
      expect(c.organizationId).toBe(ORG);
      expect(c.isPractice).toBe(true);
      expect(c.integrationId).toBeNull();
      expect(c.externalContactId).toMatch(/^practice-demo-/);
      expect(c.contactName).toMatch(/^🎬 Demo: /);
      expect(c.customerId).toBeNull();
      const msgs = stores.messages.filter((m) => m.conversationId === c.id);
      expect(msgs.length).toBeGreaterThanOrEqual(2);
      for (const m of msgs) {
        if (m.direction === "out") expect(m.status).toBe("practice");
      }
    }
    const byChannel = stores.conversations.reduce((acc: any, c) => ({ ...acc, [c.channel]: (acc[c.channel] ?? 0) + 1 }), {});
    expect(byChannel).toEqual({ whatsapp: 5, messenger: 3, instagram: 1, webchat: 1, telegram: 1, email: 1 });

    // Orders: 4 practice orders (1 + 2 VIP + 1 delivered), all
    // conversation-linked, customer-less, totals consistent.
    expect(stores.orders.length).toBe(4);
    expect(stores.orderItems.length).toBe(4);
    const convIds = new Set(stores.conversations.map((c) => c.id));
    expect(stores.orders.map((o) => o.externalNumber).sort()).toEqual(["DEMO-1001", "DEMO-1002", "DEMO-1003", "DEMO-1004"]);
    for (const o of stores.orders) {
      expect(o.isPractice).toBe(true);
      expect(convIds.has(o.conversationId)).toBe(true);
      expect(o.customerId).toBeNull();
      expect(o.source).toBe("chat");
      expect(o.isCod).toBe(true);
      expect(o.paymentMethod).toBe("cod");
      expect(o.storeSyncStatus).toBe("local_only");
      expect(o.externalId).toMatch(/^demo-order-/);
      expect(o.totalMinor).toBe(o.subtotalMinor + o.shippingMinor);
      expect(o.shippingMinor).toBe(6000n);
    }
    const delivered = stores.orders.find((o) => o.externalId.startsWith("demo-order-wa-delivered-review"))!;
    expect(delivered.status).toBe("delivered");
    // Items grounded in the org's real ACTIVE product.
    for (const item of stores.orderItems) {
      expect(item.productId).toBe("p1");
      expect(item.name).toBe("কটন শাড়ি");
      expect(item.priceMinor).toBe(120000n);
    }

    // The containment proofs: no Customer row was ever created and
    // the integration table was never even READ.
    expect(stores.customers.length).toBe(0);
    expect((db.customer.create as jest.Mock).mock.calls.length).toBe(0);
    expect((db.integration.findMany as jest.Mock).mock.calls.length).toBe(0);
    expect((db.integration.findFirst as jest.Mock).mock.calls.length).toBe(0);
    expect((db.integration.findUnique as jest.Mock).mock.calls.length).toBe(0);

    // Scenario spot-checks.
    const complaint = stores.conversations.find((c) => c.externalContactId === "practice-demo-msgr-complaint-handover")!;
    expect(complaint.handoverReason).toBe("complaint");
    expect(complaint.sentimentFlag).toBe("negative");
    expect(complaint.priority).toBe("high");
    expect(complaint.autoReplyPaused).toBe(true);
    expect(complaint.firstResponseAt).toBeNull();
    const note = stores.notes.find((n) => n.conversationId === complaint.id)!;
    expect(note).toBeTruthy();
    expect(note.content).toContain("@owner");
    expect(note.authorUserId).toBe(ACTOR);

    const chase = stores.conversations.find((c) => c.externalContactId === "practice-demo-msgr-to-chase")!;
    expect(stores.botSessions.length).toBe(1);
    expect(stores.botSessions[0].conversationId).toBe(chase.id);
    expect(stores.botSessions[0].state).toBe("ask_address");
    expect(stores.botSessions[0].status).toBe("active");
    expect(stores.botSessions[0].data.phone).toBe("01933333333");

    const fullOrder = stores.conversations.find((c) => c.externalContactId === "practice-demo-wa-full-order")!;
    const foMsgs = stores.messages.filter((m) => m.conversationId === fullOrder.id);
    const pinned = foMsgs.find((m) => m.pinnedAt)!;
    expect(pinned).toBeTruthy();
    expect(pinned.pinnedBy).toBe(ACTOR);
    expect(pinned.content).toContain("ঠিকানা");
    const aiReply = foMsgs.find((m) => m.autoReply)!;
    expect(aiReply.deliveryStatus).toBe("read");
    expect(aiReply.readAt).toBeTruthy();

    // Quote resolution: the agent reply in the product-card thread
    // points at the FIRST inbound message's real id.
    const card = stores.conversations.find((c) => c.externalContactId === "practice-demo-msgr-product-card")!;
    const cardMsgs = stores.messages.filter((m) => m.conversationId === card.id)
      .sort((a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime());
    expect(cardMsgs[1].content).toContain("🛍️");
    expect(cardMsgs[1].reactions?.[0]?.emoji).toBe("❤️");
    expect(cardMsgs[2].replyToMessageId).toBe(cardMsgs[0].id);

    const deliveredConv = stores.conversations.find((c) => c.externalContactId === "practice-demo-wa-delivered-review")!;
    expect(deliveredConv.status).toBe("closed");
    expect(deliveredConv.csatRating).toBe(5);
    expect(deliveredConv.outcome).toBe("sale");

    const snoozed = stores.conversations.find((c) => c.externalContactId === "practice-demo-tg-snoozed")!;
    expect(new Date(snoozed.snoozedUntil).getTime()).toBeGreaterThan(Date.now());

    const voice = stores.messages.find((m) => m.type === "audio")!;
    expect(voice.transcription).toContain("কটন শাড়ি");
    expect(voice.transcriptionStatus).toBe("done");

    // Audit + state surface.
    const auditRow = audit.calls.find((c) => c.action === "practice.demo_pack_loaded");
    expect(auditRow).toBeTruthy();
    expect(auditRow.metadata).toEqual({ conversations: 12, orders: 4 });
    const state = await practice.getState(ORG);
    expect(state.demoConversations).toBe(12);
    expect(state.demoPackLoaded).toBe(true);
  });

  it("(ঘ) second load is idempotent: created:false, same ids, no new rows", async () => {
    const { stores, practice, res } = await loadedHarness();
    const again = await practice.loadDemoPack(ORG, ACTOR);
    expect(again.created).toBe(false);
    expect(again.count).toBe(12);
    expect(again.scenarios.map((s: any) => s.conversationId).sort())
      .toEqual(res.scenarios.map((s: any) => s.conversationId).sort());
    expect(stores.conversations.length).toBe(12);
    expect(stores.orders.length).toBe(4);
  });
});

describe("Demo Chat Pack — send guard on real channel names", () => {
  let waSend: jest.SpyInstance;
  let msSend: jest.SpyInstance;
  beforeEach(() => {
    waSend = jest.spyOn(MetaMessagingClient.prototype, "sendWhatsAppText").mockResolvedValue({ messageId: "wamid.real" } as any);
    msSend = jest.spyOn(MetaMessagingClient.prototype, "sendMessengerText").mockResolvedValue({ messageId: "mid.real" } as any);
  });
  afterEach(() => { jest.restoreAllMocks(); });

  it("(গ) deliverText on a loaded whatsapp demo conversation returns a practice-* id and no sender is ever invoked", async () => {
    const { stores, inbox } = await loadedHarness();
    const conv = stores.conversations.find((c) => c.externalContactId === "practice-demo-wa-full-order")!;
    expect(conv.channel).toBe("whatsapp");
    expect(conv.isPractice).toBe(true);
    const id = await (inbox as any).deliverText(conv, "ডেমো কথোপকথনে পরীক্ষামূলক উত্তর");
    expect(id).toMatch(/^practice-/);
    expect(waSend).not.toHaveBeenCalled();
    expect(msSend).not.toHaveBeenCalled();
  });
});

describe("Demo Chat Pack — folder counts exclusion", () => {
  it("(ঙ) demo rows (incl. unread + handover) do not inflate all / unreadTotal / handover; the one real conversation counts exactly", async () => {
    const { stores, inbox } = await loadedHarness();
    stores.conversations.push({
      id: "conv-real", organizationId: ORG, channel: "whatsapp", externalContactId: "8801799999999",
      contactName: "আসল কাস্টমার", status: "open", isPractice: false, integrationId: "int-1",
      assignedUserId: null, autoReplyPaused: true, priority: "high", unreadCount: 3,
      snoozedUntil: null, firstResponseAt: new Date(), createdAt: new Date(), lastMessageAt: new Date(),
    });
    const counts = await inbox.conversationFolderCounts(ORG, ACTOR);
    expect(counts.all).toBe(1);
    expect(counts.unreadTotal).toBe(3);
    expect(counts.handover).toBe(1);
    expect(counts.mine).toBe(0);
    expect(counts.snoozed).toBe(0);
  });
});

describe("Demo Chat Pack — cleanup", () => {
  it("(চ) cleanupPractice wipes demo conversations/messages/orders/bot sessions/notes and the counts come back to zero", async () => {
    const { stores, practice, inbox } = await loadedHarness();
    const res = await practice.cleanupPractice(ORG, ACTOR);
    expect(res.conversations).toBe(12);
    expect(res.orders).toBe(4);
    expect(stores.conversations.length).toBe(0);
    expect(stores.messages.length).toBe(0);
    expect(stores.orders.length).toBe(0);
    expect(stores.orderItems.length).toBe(0);
    expect(stores.botSessions.length).toBe(0);
    expect(stores.notes.length).toBe(0);
    const state = await practice.getState(ORG);
    expect(state.demoConversations).toBe(0);
    expect(state.demoPackLoaded).toBe(false);
    const counts = await inbox.conversationFolderCounts(ORG, ACTOR);
    expect(counts.all).toBe(0);
    expect(counts.unreadTotal).toBe(0);
  });
});

describe("Demo Chat Pack — controller roles", () => {
  it("(ছ) demo-pack route carries @Roles(OWNER, ADMIN, MARKETING_MANAGER, SUPPORT_AGENT)", () => {
    expect(Reflect.getMetadata(ROLES_KEY, PracticeController.prototype.demoPack))
      .toEqual(["OWNER", "ADMIN", "MARKETING_MANAGER", "SUPPORT_AGENT"]);
  });
});
