import "reflect-metadata";
import { ForbiddenException } from "@nestjs/common";
import { InboxService } from "./inbox.service";
import { PracticeService } from "./practice.service";
import { PracticeController } from "./practice.controller";
import { MetaMessagingClient } from "./meta-messaging.client";
import { OrdersService } from "../orders/orders.service";
import { CourierService } from "../courier/courier.service";
import { OrderChaseService } from "../orders/order-chase.service";
import { ReviewsService } from "../orders/reviews.service";
import { RolesGuard } from "../common/roles.guard";
import { ROLES_KEY } from "../common/decorators";

/**
 * CX12a — Practice Mode.
 *
 * The core proof: EVERY outbound path a practice conversation /
 * order could touch is blocked or unreachable, with the channel
 * sender faked at the MetaMessagingClient seam — a practice send
 * must be STORED (status "practice") while the sender is NEVER
 * invoked. Fake prisma only; no live DB, no live send anywhere.
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
    if (v === null) return row[k] === null || row[k] === undefined;
    if (v && typeof v === "object" && !(v instanceof Date)) {
      if ("in" in v) return (v.in as any[]).includes(row[k]);
      if ("notIn" in v) return !(v.notIn as any[]).includes(row[k]);
      if ("not" in v) {
        if (v.not === null) return row[k] !== null && row[k] !== undefined;
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
const ORG_B = "org-2";

// ----------------------------------------------------------------
// Inbox harness (CX3-style) for the send guard / order / sweep tests
// ----------------------------------------------------------------
function inboxHarness() {
  const settings: Row[] = [{ id: "s1", organizationId: ORG, autoReplyMode: "auto", confidenceThreshold: 70, perIntent: {}, smartAssign: "off", slaFirstResponseMinutes: 60, perChannelModes: {}, escalationThresholdMinor: null, aiReplyDelaySeconds: 0, aiReplyDelayByChannel: {}, botEnabled: true, botDeliveryChargeMinor: 6000, aiScheduleByChannel: null }];
  const conversations: Row[] = [];
  const messages: Row[] = [];
  const customers: Row[] = [];
  const orders: Row[] = [];
  const stores = {
    settings, conversations, messages, customers, orders,
    products: [
      { id: "p1", organizationId: ORG, name: "কটন শাড়ি", priceMinor: 120000n, currency: "BDT", stockQuantity: 5, status: "ACTIVE", createdAt: new Date("2026-01-01") },
    ] as Row[],
    orderItems: [] as Row[],
    integrations: [] as Row[],
    botSessions: [] as Row[],
  };
  const db = {
    inboxSetting: table(settings),
    channelConversation: table(conversations),
    channelMessage: table(messages),
    messageDraft: table([] as Row[]),
    product: table(stores.products),
    order: table(orders),
    orderItem: table(stores.orderItems),
    businessPolicy: table([] as Row[]),
    businessProfile: table([] as Row[]),
    knowledgeDocument: table([] as Row[]),
    aiUnansweredQuestion: table([] as Row[]),
    aIUsageRecord: table([] as Row[]),
    organization: table([{ id: ORG, name: "টেস্ট শপ", timezone: "Asia/Dhaka", practiceMode: true }] as Row[]),
    membership: table([{ id: "m1", organizationId: ORG, userId: "owner", role: "OWNER" }] as Row[]),
    agentNotification: table([] as Row[]),
    customer: table(customers),
    integration: table(stores.integrations),
    botSession: table(stores.botSessions),
    conversationNote: table([] as Row[]),
  };
  const audit = { calls: [] as any[], log: jest.fn(async (e: any) => { audit.calls.push(e); }) };
  const llm = { getProvider: () => { throw new Error("no provider configured"); } };
  const events = { calls: [] as any[], emit: jest.fn((ev: string, p: any) => { events.calls.push({ ev, p }); }) };
  const inventory = { applyOrderPlaced: jest.fn(async () => undefined), applyOrderRestore: jest.fn(async () => undefined) };
  const service = new InboxService(db as any, audit as any, llm as any, events as any, undefined, undefined, undefined, inventory as any);
  return { service, db, audit, events, inventory, stores };
}

function convRow(over: Row = {}): Row {
  return {
    id: `c-${Math.random().toString(36).slice(2, 8)}`, organizationId: ORG, channel: "whatsapp",
    externalContactId: "8801711111111", contactName: "রহিম", contactPhone: "01711111111",
    status: "open", assignedUserId: null, priority: "normal", sentimentFlag: null,
    autoReplyPaused: false, customerId: null, integrationId: "int-1", isPractice: false,
    unreadCount: 0, createdAt: new Date(), lastMessageAt: new Date(), firstResponseAt: null,
    autoReplyDueAt: null, autoReplyBatchSince: null, ...over,
  };
}

describe("CX12a send guard (deliverText choke point)", () => {
  let waSend: jest.SpyInstance;
  let msSend: jest.SpyInstance;
  beforeEach(() => {
    waSend = jest.spyOn(MetaMessagingClient.prototype, "sendWhatsAppText").mockResolvedValue({ messageId: "wamid.real" } as any);
    msSend = jest.spyOn(MetaMessagingClient.prototype, "sendMessengerText").mockResolvedValue({ messageId: "mid.real" } as any);
  });
  afterEach(() => { jest.restoreAllMocks(); });

  it("sendReply on a practice WhatsApp conversation: stored as practice, sender NEVER invoked, integration NEVER resolved", async () => {
    const { service, stores } = inboxHarness();
    const conv = convRow({ isPractice: true, integrationId: null, externalContactId: "practice-abc" });
    stores.conversations.push(conv);
    (service as any).integrationForConversation = jest.fn(async () => { throw new Error("integration must never resolve for practice"); });

    const sent = await service.sendReply(ORG, "agent-1", conv.id, "হ্যালো, এটি প্র্যাক্টিস উত্তর");
    expect(sent.status).toBe("practice");
    expect(sent.externalId).toMatch(/^practice-/);
    expect(sent.content).toContain("প্র্যাক্টিস উত্তর");
    expect(waSend).not.toHaveBeenCalled();
    expect(msSend).not.toHaveBeenCalled();
    expect((service as any).integrationForConversation).not.toHaveBeenCalled();
  });

  it("sendAutomatedMessage (order bot / autopilot seam) on a practice conversation: stored as practice, sender NEVER invoked", async () => {
    const { service, stores } = inboxHarness();
    const conv = convRow({ isPractice: true, integrationId: null, externalContactId: "practice-abc" });
    stores.conversations.push(conv);
    (service as any).integrationForConversation = jest.fn(async () => { throw new Error("integration must never resolve for practice"); });

    const sent = await service.sendAutomatedMessage(ORG, conv.id, "বটের প্র্যাক্টিস বার্তা", "order_bot");
    expect(sent.status).toBe("practice");
    expect(sent.autoReply).toBe(true);
    expect(waSend).not.toHaveBeenCalled();
    expect((service as any).integrationForConversation).not.toHaveBeenCalled();
  });

  it("autopilot (maybeAutoReply) on a practice conversation: the reply is composed + stored as practice, sender NEVER invoked", async () => {
    const { service, stores } = inboxHarness();
    const conv = convRow({ isPractice: true, integrationId: null, externalContactId: "practice-abc", lastCustomerMessageAt: new Date() });
    stores.conversations.push(conv);
    (service as any).integrationForConversation = jest.fn(async () => { throw new Error("integration must never resolve for practice"); });

    await (service as any).maybeAutoReply(ORG, conv, { intent: "price", confidence: 95, sentiment: null }, "কটন শাড়ি এর দাম কত?");
    const out = stores.messages.filter((m) => m.conversationId === conv.id && m.direction === "out");
    expect(out.length).toBe(1);
    expect(out[0].status).toBe("practice");
    expect(out[0].externalId).toMatch(/^practice-/);
    expect(waSend).not.toHaveBeenCalled();
  });

  it("non-practice WhatsApp conversation is UNAFFECTED: the real sender runs and the row is 'sent' with the platform id", async () => {
    const { service, stores } = inboxHarness();
    const conv = convRow({ isPractice: false });
    stores.conversations.push(conv);
    (service as any).integrationForConversation = jest.fn(async () => ({ id: "int-1", provider: "whatsapp" }));
    (service as any).secretsFor = jest.fn(async () => ({ accessToken: "tok", phoneNumberId: "8801" }));

    const sent = await service.sendReply(ORG, "agent-1", conv.id, "আসল উত্তর");
    expect(waSend).toHaveBeenCalledTimes(1);
    expect(sent.status).toBe("sent");
    expect(sent.externalId).toBe("wamid.real");
  });

  it("non-practice webchat conversation is UNAFFECTED (in-process delivery, status sent)", async () => {
    const { service, stores } = inboxHarness();
    const conv = convRow({ channel: "webchat", isPractice: false, integrationId: null });
    stores.conversations.push(conv);
    const sent = await service.sendReply(ORG, "agent-1", conv.id, "ওয়েবচ্যাট উত্তর");
    expect(sent.status).toBe("sent");
    expect(waSend).not.toHaveBeenCalled();
  });
});

describe("CX12a practice orders (createChatOrder containment)", () => {
  it("practice conversation -> isPractice order, NO customer row, NO stock movement, NO order.created event", async () => {
    const { service, stores, events, inventory } = inboxHarness();
    const conv = convRow({ isPractice: true, channel: "practice", integrationId: null, externalContactId: "practice-abc", customerId: null });
    stores.conversations.push(conv);

    const order = await service.createChatOrder(ORG, "system", conv.id, { items: [{ productId: "p1", quantity: 2 }], shippingMinor: 6000 });
    expect(order.isPractice).toBe(true);
    expect(order.customerId).toBeNull();
    expect(stores.customers.length).toBe(0);
    expect(stores.orderItems.length).toBe(1);
    expect(inventory.applyOrderPlaced).not.toHaveBeenCalled();
    expect(events.calls.filter((c) => c.ev === "order.created").length).toBe(0);
    expect(conv.customerId).toBeNull();
  });

  it("non-practice conversation -> normal order: customer created, stock taken, event fired, isPractice false", async () => {
    const { service, stores, events, inventory } = inboxHarness();
    const conv = convRow({ channel: "webchat", integrationId: null });
    stores.conversations.push(conv);

    const order = await service.createChatOrder(ORG, "agent-1", conv.id, { items: [{ productId: "p1", quantity: 1 }] });
    expect(order.isPractice).toBe(false);
    expect(stores.customers.length).toBe(1);
    expect(inventory.applyOrderPlaced).toHaveBeenCalledTimes(1);
    expect(events.calls.filter((c) => c.ev === "order.created").length).toBe(1);
  });
});

describe("CX12a order list / stats exclusions", () => {
  function ordersHarness() {
    const rows: Row[] = [
      { id: "o1", organizationId: ORG, status: "completed", isCod: true, isPractice: false, totalMinor: 100000n, subtotalMinor: 100000n, shippingMinor: 0n, discountMinor: 0n, taxMinor: 0n, refundedMinor: 0n, placedAt: new Date("2026-10-01"), customer: null, items: [] },
      { id: "o2", organizationId: ORG, status: "pending", isCod: true, isPractice: false, totalMinor: 50000n, subtotalMinor: 50000n, shippingMinor: 0n, discountMinor: 0n, taxMinor: 0n, refundedMinor: 0n, placedAt: new Date("2026-10-02"), customer: null, items: [] },
      { id: "o3", organizationId: ORG, status: "completed", isCod: true, isPractice: true, totalMinor: 999000n, subtotalMinor: 999000n, shippingMinor: 0n, discountMinor: 0n, taxMinor: 0n, refundedMinor: 0n, placedAt: new Date("2026-10-03"), customer: null, items: [] },
    ];
    const orderTable = {
      ...table(rows),
      groupBy: jest.fn(async ({ by, where }: any) => {
        const field = by[0];
        const filtered = rows.filter((r) => match(r, where));
        const groups = new Map<string, Row[]>();
        for (const r of filtered) {
          const key = String(r[field]);
          groups.set(key, [...(groups.get(key) ?? []), r]);
        }
        return [...groups.entries()].map(([key, rs]) => ({
          [field]: field === "isCod" ? key === "true" : key,
          _count: rs.length,
          _sum: { totalMinor: rs.reduce((s, r) => s + BigInt(r.totalMinor ?? 0), 0n) },
        }));
      }),
    };
    const prisma = { order: orderTable };
    const svc = new OrdersService(prisma as any);
    return { svc, rows, orderTable };
  }

  it("list excludes practice orders by default; includePractice surfaces them; the query itself carries isPractice:false", async () => {
    const { svc, orderTable } = ordersHarness();
    const def = await svc.list(ORG, {});
    expect(def.total).toBe(2);
    expect(def.items.map((i: any) => i.id)).not.toContain("o3");
    expect((orderTable.findMany as jest.Mock).mock.calls[0][0].where.isPractice).toBe(false);

    const incl = await svc.list(ORG, { includePractice: true });
    expect(incl.total).toBe(3);
    expect(incl.items.map((i: any) => i.id)).toContain("o3");
  });

  it("stats never count practice orders (totals + delivered revenue)", async () => {
    const { svc } = ordersHarness();
    const stats = await svc.stats(ORG);
    expect(stats.totalOrders).toBe(2);
    expect(stats.deliveredRevenueMinor).toBe("100000");
  });
});

describe("CX12a courier booking refusal", () => {
  function courierHarness() {
    const orders: Row[] = [
      { id: "ord-p", organizationId: ORG, isPractice: true, customerId: null, isCod: true, totalMinor: 100000n, externalNumber: "CHAT-P1", placedAt: new Date(), createdAt: new Date() },
      { id: "ord-r", organizationId: ORG, isPractice: false, customerId: null, isCod: true, totalMinor: 100000n, externalNumber: "1042", placedAt: new Date(), createdAt: new Date() },
    ];
    const shipments: Row[] = [];
    const prisma = {
      order: table(orders),
      courierShipment: table(shipments),
      integration: table([] as Row[]),
      integrationCredential: table([] as Row[]),
    };
    const audit = { log: jest.fn(async () => undefined) };
    const svc = new CourierService(prisma as any, audit as any);
    return { svc, shipments };
  }
  const dto = { orderId: "ord-p", recipientName: "প্র্যাক্টিস", recipientPhone: "01711111111", recipientAddress: "ঢাকা, বাংলাদেশ — প্র্যাক্টিস ঠিকানা" };

  it("practice order -> honest Bengali refusal, no shipment created, no provider reached", async () => {
    const { svc, shipments } = courierHarness();
    await expect(svc.bookShipment(ORG, "owner", dto)).rejects.toThrow(/প্র্যাক্টিস অর্ডার/);
    expect(shipments.length).toBe(0);
  });

  it("non-practice order does NOT hit the practice refusal (it fails later, at the unconnected provider)", async () => {
    const { svc, shipments } = courierHarness();
    await expect(svc.bookShipment(ORG, "owner", { ...dto, orderId: "ord-r" })).rejects.not.toThrow(/প্র্যাক্টিস অর্ডার/);
    expect(shipments.length).toBe(0);
  });
});

describe("CX12a sweep exclusions", () => {
  it("CX3 autoreply sweep: a due practice batch is skipped untouched (never claimed, never fired); a real batch is claimed", async () => {
    const { service, stores } = inboxHarness();
    const past = new Date(Date.now() - 60_000);
    const practice = convRow({ isPractice: true, channel: "practice", integrationId: null, externalContactId: "practice-abc", autoReplyDueAt: past, autoReplyBatchSince: past });
    const real = convRow({ channel: "webchat", integrationId: null, autoReplyDueAt: past, autoReplyBatchSince: past });
    stores.conversations.push(practice, real);
    stores.messages.push({ id: "mb-1", conversationId: real.id, direction: "in", type: "text", content: "কটন শাড়ির দাম কত?", status: "received", autoReply: false, sentByUserId: null, createdAt: new Date(Date.now() - 30_000) });

    const res = await service.runDueAutoReplies(ORG);
    // The practice row was never claimed: its due stamp survives
    // and no outbound row was composed for it.
    expect(practice.autoReplyDueAt).toBe(past);
    expect(stores.messages.filter((m) => m.conversationId === practice.id && m.direction === "out").length).toBe(0);
    // The real row WAS claimed by the sweep (due stamp consumed).
    expect(real.autoReplyDueAt).toBeNull();
    expect(res.fired + res.skipped).toBe(2);
    expect(res.skipped).toBeGreaterThanOrEqual(1);
  });

  it("CX7 chase sweep: a stalled practice bot session is stopped as 'practice' and the sender is never called", async () => {
    const twoHoursAgo = new Date(Date.now() - 2 * 3600_000);
    const sessions: Row[] = [{ id: "bs-1", organizationId: ORG, conversationId: "conv-p", status: "active", state: "ask_phone", data: {}, createdAt: twoHoursAgo, updatedAt: twoHoursAgo }];
    const convs: Row[] = [{ id: "conv-p", organizationId: ORG, isPractice: true, status: "open", autoReplyPaused: false }];
    const chaseRows: Row[] = [];
    const prisma = {
      inboxSetting: table([{ organizationId: ORG, chaseEnabled: true, chaseFirstDelayMinutes: 60, chaseIntervalMinutes: 240, chaseMaxAttempts: 3, chaseQuietHoursRespect: false, chaseQuietStartHour: 22, chaseQuietEndHour: 8 }] as Row[]),
      organization: table([{ id: ORG, timezone: "Asia/Dhaka" }] as Row[]),
      botSession: table(sessions),
      channelConversation: table(convs),
      orderChase: table(chaseRows),
      order: table([] as Row[]),
      channelMessage: table([] as Row[]),
      product: table([] as Row[]),
    };
    const svc = new OrderChaseService(prisma as any);
    const sender = { sendAutomatedMessage: jest.fn(async () => ({})) };
    const res = await svc.runOrderChaseSweep(ORG, sender);
    expect(sender.sendAutomatedMessage).not.toHaveBeenCalled();
    expect(res.sent).toBe(0);
    expect(chaseRows.length).toBe(1);
    expect(chaseRows[0].stoppedReason).toBe("practice");
  });

  it("CX7 chase sweep control: a REAL stalled session IS chased (exclusion is practice-specific)", async () => {
    const twoHoursAgo = new Date(Date.now() - 2 * 3600_000);
    const sessions: Row[] = [{ id: "bs-1", organizationId: ORG, conversationId: "conv-r", status: "active", state: "ask_phone", data: {}, createdAt: twoHoursAgo, updatedAt: twoHoursAgo }];
    const convs: Row[] = [{ id: "conv-r", organizationId: ORG, isPractice: false, status: "open", autoReplyPaused: false }];
    const chaseRows: Row[] = [];
    const prisma = {
      inboxSetting: table([{ organizationId: ORG, chaseEnabled: true, chaseFirstDelayMinutes: 60, chaseIntervalMinutes: 240, chaseMaxAttempts: 3, chaseQuietHoursRespect: false, chaseQuietStartHour: 22, chaseQuietEndHour: 8 }] as Row[]),
      organization: table([{ id: ORG, timezone: "Asia/Dhaka" }] as Row[]),
      botSession: table(sessions),
      channelConversation: table(convs),
      orderChase: table(chaseRows),
      order: table([] as Row[]),
      channelMessage: table([] as Row[]),
      product: table([] as Row[]),
    };
    const svc = new OrderChaseService(prisma as any);
    const sender = { sendAutomatedMessage: jest.fn(async () => ({})) };
    const res = await svc.runOrderChaseSweep(ORG, sender);
    expect(sender.sendAutomatedMessage).toHaveBeenCalledTimes(1);
    expect(res.sent).toBe(1);
  });

  it("CX12b reviews: a delivered PRACTICE order creates no review ask; a real one does", async () => {
    const reviews: Row[] = [];
    const orders: Row[] = [
      { id: "ord-1", organizationId: ORG, customerId: "cus-1", conversationId: "conv-1", isPractice: false, customer: { phone: "01711111111", email: null } },
      { id: "ord-p", organizationId: ORG, customerId: null, conversationId: "conv-p", isPractice: true, customer: null },
    ];
    const prisma = {
      inboxSetting: table([{ organizationId: ORG, reviewRequestEnabled: true, reviewRequestDelayHours: 24 }] as Row[]),
      order: table(orders),
      orderReview: table(reviews),
      customer: table([] as Row[]),
      organization: table([{ id: ORG, name: "শপ" }] as Row[]),
    };
    const svc = new ReviewsService(prisma as any, undefined, undefined, undefined, { log: async () => undefined } as any);
    await svc.noteDelivered(ORG, "ord-p");
    expect(reviews.length).toBe(0);
    await svc.noteDelivered(ORG, "ord-1");
    expect(reviews.length).toBe(1);
    expect(reviews[0].orderId).toBe("ord-1");
  });
});

// ----------------------------------------------------------------
// PracticeService: lifecycle, simulate, cleanup, tenant isolation
// ----------------------------------------------------------------
function practiceHarness() {
  const orgs: Row[] = [
    { id: ORG, name: "শপ A", practiceMode: false },
    { id: ORG_B, name: "শপ B", practiceMode: true },
  ];
  const conversations: Row[] = [];
  const messages: Row[] = [];
  const orders: Row[] = [];
  const db: any = {
    organization: table(orgs),
    channelConversation: table(conversations),
    channelMessage: table(messages),
    messageDraft: table([] as Row[]),
    conversationNote: table([] as Row[]),
    botSession: table([] as Row[]),
    orderChase: table([] as Row[]),
    order: table(orders),
    orderItem: table([] as Row[]),
    orderReview: table([] as Row[]),
  };
  db.$transaction = jest.fn(async (fn: any) => fn(db));
  const audit = { calls: [] as any[], log: jest.fn(async (e: any) => { audit.calls.push(e); }) };
  const ingest = jest.fn(async (..._args: any[]) => undefined);
  const inbox = { ingestChatMessage: ingest };
  const svc = new PracticeService(db as any, audit as any, inbox as any);
  return { svc, db, audit, ingest, orgs, conversations, messages, orders };
}

describe("CX12a PracticeService lifecycle", () => {
  it("toggle flips the flag + audits; state reflects it", async () => {
    const { svc, audit } = practiceHarness();
    const on = await svc.setPracticeMode(ORG, "owner", true);
    expect(on.practiceMode).toBe(true);
    expect(audit.calls.some((c) => c.action === "practice.mode_enabled")).toBe(true);
    const off = await svc.setPracticeMode(ORG, "owner", false);
    expect(off.practiceMode).toBe(false);
  });

  it("practice conversation requires the mode ON and is synthetic (no integration, practice channel + contact)", async () => {
    const { svc } = practiceHarness();
    await expect(svc.createPracticeConversation(ORG, "owner")).rejects.toThrow(/Practice Mode চালু/);
    await svc.setPracticeMode(ORG, "owner", true);
    const conv = await svc.createPracticeConversation(ORG, "owner");
    expect(conv.isPractice).toBe(true);
    expect(conv.channel).toBe("practice");
    expect(conv.integrationId).toBeNull();
    expect(conv.externalContactId).toMatch(/^practice-/);
    expect(conv.contactName).toContain("🧪");
    // Idempotent: a second create returns the same conversation.
    const again = await svc.createPracticeConversation(ORG, "owner");
    expect(again.id).toBe(conv.id);
  });

  it("simulate: refuses real conversations and mode-off; happy path stores the inbound row and runs the SAME ingest dispatch", async () => {
    const { svc, conversations, messages, ingest } = practiceHarness();
    await svc.setPracticeMode(ORG, "owner", true);
    const conv = await svc.createPracticeConversation(ORG, "owner");
    const real = { id: "conv-real", organizationId: ORG, channel: "whatsapp", isPractice: false, status: "open" };
    conversations.push(real);

    await expect(svc.simulateInboundMessage(ORG, "agent", real.id, "হ্যালো")).rejects.toThrow(/প্র্যাক্টিস কথোপকথন নয়/);
    await expect(svc.simulateInboundMessage(ORG, "agent", conv.id, "   ")).rejects.toThrow(/খালি/);

    const out = await svc.simulateInboundMessage(ORG, "agent", conv.id, "কটন শাড়ির দাম কত?");
    expect(ingest).toHaveBeenCalledTimes(1);
    expect(ingest.mock.calls[0][0]).toBe(ORG);
    expect(ingest.mock.calls[0][1]).toBe(conv.id);
    const stored = messages.filter((m) => m.conversationId === conv.id && m.direction === "in");
    expect(stored.length).toBe(1);
    expect(out.messages.length).toBe(1);

    await svc.setPracticeMode(ORG, "owner", false);
    await expect(svc.simulateInboundMessage(ORG, "agent", conv.id, "আবার")).rejects.toThrow(/বন্ধ আছে/);
  });
});

describe("CX12a cleanup", () => {
  it("deletes practice conversations+messages+orders, keeps real rows EXACTLY, turns the flag off, audits — and is idempotent", async () => {
    const { svc, db, audit, conversations, messages, orders } = practiceHarness();
    await svc.setPracticeMode(ORG, "owner", true);
    const conv = await svc.createPracticeConversation(ORG, "owner");
    messages.push(
      { id: "pm-1", conversationId: conv.id, direction: "in", content: "দাম?", status: "received", createdAt: new Date() },
      { id: "pm-2", conversationId: conv.id, direction: "out", content: "১২০০ টাকা", status: "practice", createdAt: new Date() },
    );
    orders.push({ id: "po-1", organizationId: ORG, isPractice: true, status: "pending", createdAt: new Date() });
    (db.orderItem as any).create({ data: { orderId: "po-1", name: "শাড়ি", quantity: 1 } });
    // Real rows of org A + practice rows of org B must survive.
    conversations.push({ id: "conv-real", organizationId: ORG, channel: "whatsapp", isPractice: false, status: "open", createdAt: new Date() });
    messages.push({ id: "rm-1", conversationId: "conv-real", direction: "in", content: "আসল বার্তা", status: "received", createdAt: new Date() });
    orders.push({ id: "ro-1", organizationId: ORG, isPractice: false, status: "completed", createdAt: new Date() });
    conversations.push({ id: "conv-b", organizationId: ORG_B, channel: "practice", isPractice: true, status: "open", createdAt: new Date() });
    orders.push({ id: "po-b", organizationId: ORG_B, isPractice: true, status: "pending", createdAt: new Date() });

    const before = { conversations: conversations.length, orders: orders.length };
    const res = await svc.cleanupPractice(ORG, "owner");
    expect(res).toEqual({ ok: true, conversations: 1, messages: 2, orders: 1, practiceMode: false });

    // Exactly the pre-practice real rows remain for org A; org B untouched.
    expect(conversations.map((c) => c.id).sort()).toEqual(["conv-b", "conv-real"]);
    expect(orders.map((o) => o.id).sort()).toEqual(["po-b", "ro-1"]);
    expect(messages.map((m) => m.id)).toEqual(["rm-1"]);
    expect(conversations.length).toBe(before.conversations - 1);
    expect(orders.length).toBe(before.orders - 1);
    const state = await svc.getState(ORG);
    expect(state.practiceMode).toBe(false);
    expect(state.practiceConversations).toBe(0);
    expect(state.practiceOrders).toBe(0);
    expect(audit.calls.some((c) => c.action === "practice.cleanup" && c.metadata.conversations === 1 && c.metadata.orders === 1)).toBe(true);

    // Idempotent: a second cleanup is a no-op success.
    const again = await svc.cleanupPractice(ORG, "owner");
    expect(again).toEqual({ ok: true, conversations: 0, messages: 0, orders: 0, practiceMode: false });
    expect(conversations.length).toBe(2);
    expect(orders.length).toBe(2);
  });
});

describe("CX12a role gating (RolesGuard pattern)", () => {
  it("toggle + cleanup carry @Roles(OWNER, ADMIN) metadata", () => {
    expect(Reflect.getMetadata(ROLES_KEY, PracticeController.prototype.toggle)).toEqual(["OWNER", "ADMIN"]);
    expect(Reflect.getMetadata(ROLES_KEY, PracticeController.prototype.cleanup)).toEqual(["OWNER", "ADMIN"]);
  });

  it("RolesGuard: SUPPORT_AGENT is 403 on an OWNER/ADMIN endpoint; ADMIN and OWNER pass", () => {
    const reflector = {
      getAllAndOverride: (key: string) => (key === ROLES_KEY ? ["OWNER", "ADMIN"] : undefined),
    };
    const guard = new RolesGuard(reflector as any);
    const ctxFor = (role: string) => ({
      switchToHttp: () => ({ getRequest: () => ({ user: { userId: "u1" }, membership: { role } }) }),
      getHandler: () => PracticeController.prototype.toggle,
      getClass: () => PracticeController,
    });
    expect(() => guard.canActivate(ctxFor("SUPPORT_AGENT") as any)).toThrow(ForbiddenException);
    expect(() => guard.canActivate(ctxFor("VIEWER") as any)).toThrow(ForbiddenException);
    expect(guard.canActivate(ctxFor("ADMIN") as any)).toBe(true);
    expect(guard.canActivate(ctxFor("OWNER") as any)).toBe(true);
  });
});
