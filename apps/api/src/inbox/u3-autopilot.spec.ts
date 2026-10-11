import { InboxService } from "./inbox.service";

/**
 * Unified Inbox U3 (Milestone 45): per-channel autopilot modes,
 * the escalation gate + pause, the LLM tier with its number
 * guard, and bot v2 (multi-product cart + Order.address).
 */
type Row = Record<string, any>;
function match(row: Row, where: any = {}): boolean {
  return Object.entries(where).every(([k, raw]) => {
    const v = raw as any;
    if (v && typeof v === "object" && !(v instanceof Date)) {
      if ("in" in v) return (v.in as any[]).includes(row[k]);
      if ("not" in v) return row[k] !== v.not;
      if ("gte" in v) return new Date(row[k]).getTime() >= new Date(v.gte).getTime();
      if ("lt" in v) return new Date(row[k]).getTime() < new Date(v.lt).getTime();
      return true;
    }
    return row[k] === v;
  });
}
function table(store: Row[]) {
  return {
    findMany: jest.fn(async ({ where, take, orderBy }: any = {}) => {
      let rows = store.filter((r) => match(r, where));
      if (orderBy?.createdAt === "desc") rows = [...rows].sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
      if (orderBy?.createdAt === "asc") rows = [...rows].sort((a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime());
      return take ? rows.slice(0, take) : rows;
    }),
    findFirst: jest.fn(async ({ where, orderBy }: any = {}) => {
      let rows = store.filter((r) => match(r, where));
      if (orderBy?.createdAt === "desc") rows = [...rows].sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
      return rows[0] ?? null;
    }),
    findUnique: jest.fn(async ({ where }: any = {}) => store.find((r) => Object.entries(where).every(([k, v]) => r[k] === v)) ?? null),
    create: jest.fn(async ({ data }: any) => { const row = { id: `row-${store.length + 1}-${Math.random().toString(36).slice(2, 7)}`, createdAt: new Date(), updatedAt: new Date(), ...data }; store.push(row); return row; }),
    update: jest.fn(async ({ where, data }: any) => { const row = store.find((r) => r.id === where.id || match(r, where)); if (!row) throw new Error("nf"); Object.assign(row, data); return row; }),
    updateMany: jest.fn(async ({ where, data }: any) => { let n = 0; for (const r of store) if (match(r, where)) { Object.assign(r, data); n++; } return { count: n }; }),
    count: jest.fn(async ({ where }: any = {}) => store.filter((r) => match(r, where)).length),
  };
}

const ORG = "org-1";
function setup(llmProvider?: any) {
  const settings: Row[] = [{ id: "s1", organizationId: ORG, autoReplyMode: "off", confidenceThreshold: 70, perIntent: {}, smartAssign: "off", slaFirstResponseMinutes: 60, perChannelModes: {}, escalationThresholdMinor: null }];
  const conversations: Row[] = [];
  const messages: Row[] = [];
  const drafts: Row[] = [];
  const products: Row[] = [
    { id: "p1", organizationId: ORG, name: "কটন শাড়ি", priceMinor: 120000n, currency: "BDT", stockQuantity: 5, status: "ACTIVE", createdAt: new Date("2026-01-01") },
    { id: "p2", organizationId: ORG, name: "লেদার ব্যাগ", priceMinor: 250000n, currency: "BDT", stockQuantity: 2, status: "ACTIVE", createdAt: new Date("2026-01-02") },
  ];
  const orders: Row[] = [];
  const db = {
    inboxSetting: table(settings),
    channelConversation: table(conversations),
    channelMessage: table(messages),
    messageDraft: table(drafts),
    product: table(products),
    order: table(orders),
    orderItem: table([] as Row[]),
    customer: table([] as Row[]),
    businessPolicy: table([] as Row[]),
    businessProfile: table([] as Row[]),
    botSession: table([] as Row[]),
    conversationNote: table([] as Row[]),
    integration: table([] as Row[]),
    agentNotification: table([] as Row[]),
    aIUsageRecord: table([] as Row[]),
    membership: table([{ id: "m1", organizationId: ORG, userId: "owner", role: "OWNER", user: { id: "owner", name: "Owner", email: "o@x" } }]),
  };
  const audit = { calls: [] as any[], log: jest.fn(async (e: any) => { audit.calls.push(e); }) };
  const llm = { getProvider: () => { if (!llmProvider) throw new Error("no provider configured"); return llmProvider; } };
  const service = new InboxService(db as any, audit as any, llm as any);
  return { service, db, audit, conversations, messages, drafts, orders, settings };
}
function conv(over: Row = {}): Row {
  return { id: `c-${Math.random().toString(36).slice(2, 8)}`, organizationId: ORG, channel: "webchat", status: "open", assignedUserId: null, priority: "normal", sentimentFlag: null, autoReplyPaused: false, customerId: null, contactName: "রহিম", createdAt: new Date(), lastMessageAt: new Date(), firstResponseAt: null, ...over };
}
const CLS = (intent: string, confidence = 95, sentiment: string | null = null) => ({ intent, confidence, sentiment } as any);

describe("U3 modes + escalation gate", () => {
  it("per-channel mode overrides the global off; draft mode files a draft", async () => {
    const { service, conversations, drafts } = setup();
    await service.updateSettings(ORG, "owner", { perChannelModes: { webchat: "draft" } });
    const c = conv(); conversations.push(c);
    await (service as any).maybeAutoReply(ORG, c, CLS("price"), "কটন শাড়ি এর দাম কত?");
    expect(drafts).toHaveLength(1);
    expect(drafts[0].content).toContain("কটন শাড়ি");
  });

  it("global off + no channel override: silence", async () => {
    const { service, conversations, drafts, messages } = setup();
    const c = conv(); conversations.push(c);
    await (service as any).maybeAutoReply(ORG, c, CLS("price"), "কটন শাড়ি এর দাম কত?");
    expect(drafts).toHaveLength(0);
    expect(messages.filter((m) => m.autoReply)).toHaveLength(0);
  });

  it("complaint escalates: paused + priority high + audit, and stays silent afterwards", async () => {
    const { service, conversations, audit, messages } = setup();
    await service.updateSettings(ORG, "owner", { autoReplyMode: "auto" });
    const c = conv(); conversations.push(c);
    await (service as any).maybeAutoReply(ORG, c, CLS("complaint", 90, "negative"), "খুবই বাজে সার্ভিস, রিফান্ড চাই");
    expect(c.autoReplyPaused).toBe(true);
    expect(c.priority).toBe("high");
    expect(audit.calls.some((a) => a.action === "inbox.autopilot.escalated")).toBe(true);
    // paused: even a clean price question gets no autopilot now
    await (service as any).maybeAutoReply(ORG, c, CLS("price"), "কটন শাড়ি এর দাম কত?");
    expect(messages.filter((m) => m.autoReply)).toHaveLength(0);
  });

  it("human request words escalate", async () => {
    const { service, conversations } = setup();
    await service.updateSettings(ORG, "owner", { autoReplyMode: "auto" });
    const c = conv(); conversations.push(c);
    await (service as any).maybeAutoReply(ORG, c, CLS("other", 80), "আমি একজন এজেন্ট এর সাথে কথা বলতে চাই");
    expect(c.autoReplyPaused).toBe(true);
  });

  it("high-value open order escalates", async () => {
    const { service, conversations, orders, db } = setup();
    await service.updateSettings(ORG, "owner", { autoReplyMode: "auto", escalationThresholdMinor: 100000 });
    (db.customer as any); // keep
    orders.push({ id: "o1", organizationId: ORG, customerId: "cust-1", status: "processing", totalMinor: 500000n, currency: "BDT", createdAt: new Date(), externalNumber: "1001" });
    const c = conv({ customerId: "cust-1" }); conversations.push(c);
    await (service as any).maybeAutoReply(ORG, c, CLS("price"), "কটন শাড়ি এর দাম কত?");
    expect(c.autoReplyPaused).toBe(true);
  });
});

describe("U3 LLM tier + number guard", () => {
  const realProvider = (text: string) => ({ name: "fake-llm", isRealLlm: true, complete: jest.fn(async () => ({ text, inputTokens: 10, outputTokens: 5, tokensEstimated: false })) });

  it("composes from the fact pack when rules have no answer", async () => {
    const { service, conversations, messages } = setup(realProvider("এই কটন শাড়িটির দাম ৳1,200 এবং স্টকে 5টি আছে।"));
    await service.updateSettings(ORG, "owner", { autoReplyMode: "auto" });
    (service as any).composeGroundedReply = async () => null; // force the LLM tier
    const c = conv(); conversations.push(c);
    await (service as any).maybeAutoReply(ORG, c, CLS("price"), "কটন শাড়ি টা কেমন হবে?");
    const sent = messages.filter((m) => m.autoReply && m.status === "sent");
    expect(sent).toHaveLength(1);
    expect(JSON.parse(sent[0].autoReplyEvidence).tier).toBe("llm");
  });

  it("guard rejects invented numbers; NO_ANSWER stays silent; dev provider never autopilots", async () => {
    const invented = setup(realProvider("অফার চলছে! মাত্র ৫০ টাকায় পাবেন!"));
    await invented.service.updateSettings(ORG, "owner", { autoReplyMode: "auto" });
    (invented.service as any).composeGroundedReply = async () => null;
    const c1 = conv(); invented.conversations.push(c1);
    await (invented.service as any).maybeAutoReply(ORG, c1, CLS("price"), "কটন শাড়ি এর দাম কত?");
    expect(invented.messages.filter((m) => m.autoReply)).toHaveLength(0);
    expect(invented.audit.calls.some((a) => a.action === "inbox.autopilot.guard_rejected")).toBe(true);

    const dev = setup({ name: "dev-template", isRealLlm: false, complete: jest.fn(async () => ({ text: "x", inputTokens: 0, outputTokens: 0, tokensEstimated: true })) });
    await dev.service.updateSettings(ORG, "owner", { autoReplyMode: "auto" });
    (dev.service as any).composeGroundedReply = async () => null;
    const c2 = conv(); dev.conversations.push(c2);
    await (dev.service as any).maybeAutoReply(ORG, c2, CLS("price"), "কটন শাড়ি এর দাম কত?");
    expect(dev.messages.filter((m) => m.autoReply)).toHaveLength(0);
  });

  it("extractNumbers normalizes Bengali digits and separators", () => {
    expect((InboxService as any).extractNumbers("দাম ১,২০০ টাকা, স্টক ৫টি")).toEqual(["1200", "5"]);
  });
});

describe("U3 bot v2: multi-product cart + address on the order", () => {
  it("walks the full cart flow into a two-item order with an address", async () => {
    const { service, db, conversations, orders } = setup();
    await service.updateSettings(ORG, "owner", { botEnabled: true, botDeliveryChargeMinor: 6000 });
    const sent: string[] = [];
    (service as any).botSend = jest.fn(async (_o: string, _c: any, _s: any, text: string) => { sent.push(text); return true; });
    const c = conv(); conversations.push(c);
    const session: Row = { id: "bs1", organizationId: ORG, conversationId: c.id, state: "ask_product", data: {}, status: "active", updatedAt: new Date() };
    (db.botSession as any).findFirst = jest.fn(async () => session);
    (db.botSession as any).update = jest.fn(async ({ data }: any) => { Object.assign(session, data); return session; });
    const settings = await service.getSettings(ORG);
    const step = (text: string) => (service as any).botStep(ORG, c, session, text, settings);

    await step("1");            // কটন শাড়ি
    expect(session.state).toBe("ask_quantity");
    await step("2");            // x2 -> ask_more
    expect(session.state).toBe("ask_more");
    expect(session.data.items).toHaveLength(1);
    await step("2");            // লেদার ব্যাগ
    expect(session.state).toBe("ask_quantity");
    await step("1");            // x1 -> ask_more with 2 items
    expect(session.data.items).toHaveLength(2);
    await step("শেষ");
    expect(session.state).toBe("ask_name");
    await step("রহিম উদ্দিন");
    await step("01712345678");
    expect(session.state).toBe("ask_address");
    await step("বাসা ১২, রোড ৩, মিরপুর, ঢাকা");
    expect(session.state).toBe("confirm");
    expect(sent[sent.length - 1]).toContain("কটন শাড়ি");
    expect(sent[sent.length - 1]).toContain("লেদার ব্যাগ");
    await step("হ্যাঁ");
    expect(session.status).toBe("completed");
    expect(orders).toHaveLength(1);
    expect(orders[0].address).toContain("মিরপুর");
    const items = (db.orderItem as any); void items;
    const orderItems = await (service as any).prisma.orderItem.findMany({ where: { orderId: orders[0].id } });
    expect(orderItems).toHaveLength(2);
    // subtotal = 2*120000 + 1*250000 = 490000; + delivery 6000
    expect(String(orders[0].totalMinor)).toBe("496000");
  });
});
