import { InboxService } from "./inbox.service";

/**
 * Unified Inbox U5 (Milestone 47): pipeline stages advanced by
 * real events, close outcomes feeding analytics, the pipeline
 * board with linked-order value, the Customer Command Profile,
 * and the one-click tracking/refund actions.
 */
const ORG = "org-1";
type Row = Record<string, any>;
function match(row: Row, where: any): boolean {
  return Object.entries(where ?? {}).every(([k, v]) => {
    if (v && typeof v === "object" && !(v instanceof Date)) {
      if ("in" in v) return ((v as any).in as any[]).includes(row[k]);
      if ("not" in v) return row[k] !== (v as any).not;
      if ("gte" in v) return row[k] >= (v as any).gte;
      if ("gt" in v) return row[k] > (v as any).gt;
      return true;
    }
    return row[k] === v;
  });
}
function table(store: Row[]) {
  return {
    findMany: jest.fn(async ({ where, orderBy, take }: any = {}) => {
      let rows = store.filter((r) => match(r, where));
      if (orderBy?.createdAt === "desc") rows = [...rows].sort((a, b) => +new Date(b.createdAt) - +new Date(a.createdAt));
      if (orderBy?.lastMessageAt === "desc") rows = [...rows].sort((a, b) => +new Date(b.lastMessageAt ?? 0) - +new Date(a.lastMessageAt ?? 0));
      return take ? rows.slice(0, take) : rows;
    }),
    findFirst: jest.fn(async ({ where }: any = {}) => store.find((r) => match(r, where)) ?? null),
    findUnique: jest.fn(async ({ where }: any) => store.find((r) => r.id === where.id) ?? null),
    create: jest.fn(async ({ data }: any) => { const row = { id: `row-${store.length + 1}-${Math.random().toString(36).slice(2, 7)}`, createdAt: new Date(), ...data }; store.push(row); return row; }),
    update: jest.fn(async ({ where, data }: any) => {
      const row = store.find((r) => r.id === where.id);
      if (row) { for (const [k, v] of Object.entries(data)) { if (k === "unreadCount" && v && typeof v === "object") row[k] = (row[k] ?? 0) + (v as any).increment; else row[k] = v; } }
      return row;
    }),
    count: jest.fn(async ({ where }: any = {}) => store.filter((r) => match(r, where)).length),
  };
}
function fakeDb() {
  const db: any = {
    conversations: [] as Row[], messages: [] as Row[], orders: [] as Row[], shipments: [] as Row[],
    customers: [] as Row[], leads: [] as Row[], notes: [] as Row[], notifications: [] as Row[],
    memberships: [] as Row[], verifications: [] as Row[], settings: [] as Row[],
  };
  db.channelConversation = table(db.conversations);
  db.channelMessage = table(db.messages);
  db.order = table(db.orders);
  db.courierShipment = table(db.shipments);
  db.customer = table(db.customers);
  db.lead = table(db.leads);
  db.conversationNote = table(db.notes);
  db.agentNotification = table(db.notifications);
  db.membership = table(db.memberships);
  db.paymentVerification = table(db.verifications);
  db.inboxSetting = { findUnique: jest.fn(async () => db.settings[0] ?? null), upsert: jest.fn(async () => ({})) };
  db.integration = table([]);
  return db;
}
const auditStub = () => ({ calls: [] as any[], log: jest.fn(async (e: any) => undefined) });
function service(db: any) {
  return new InboxService(db as any, auditStub() as any, undefined as any, undefined, undefined);
}
function convRow(over: Row = {}): Row {
  return {
    id: "c1", organizationId: ORG, channel: "webchat", externalContactId: "v1",
    contactName: "Rahim", status: "open", pipelineStage: "new", unreadCount: 0,
    tags: [], messages: undefined, createdAt: new Date(), ...over,
  };
}

describe("U5 pipeline + outcomes", () => {
  it("updateConversation validates stage and outcome, and stores them", async () => {
    const db = fakeDb(); db.conversations.push(convRow());
    const svc = service(db);
    await expect(svc.updateConversation(ORG, "agent", "c1", { pipelineStage: "bogus" })).rejects.toThrow(/Invalid pipeline stage/);
    await expect(svc.updateConversation(ORG, "agent", "c1", { outcome: "bogus" })).rejects.toThrow(/Invalid conversation outcome/);
    const updated = await svc.updateConversation(ORG, "agent", "c1", { status: "closed", outcome: "sale", outcomeReason: "COD confirmed" });
    expect(updated.pipelineStage).toBe("new");
    expect(db.conversations[0].outcome).toBe("sale");
    expect(db.conversations[0].outcomeReason).toBe("COD confirmed");
    expect(db.conversations[0].resolvedAt).toBeTruthy();
  });

  it("a human reply advances a new thread to talking (forward-only)", async () => {
    const db = fakeDb(); db.conversations.push(convRow());
    const svc = service(db);
    await svc.sendReply(ORG, "agent", "c1", "হ্যালো, কীভাবে সাহায্য করতে পারি?");
    expect(db.conversations[0].pipelineStage).toBe("talking");
    // Reopening/moving back never happens automatically.
    db.conversations[0].pipelineStage = "ordered";
    await svc.sendReply(ORG, "agent", "c1", "আরেকটি বার্তা");
    expect(db.conversations[0].pipelineStage).toBe("ordered");
  });

  it("board groups by stage, derives delivered, and sums linked order value", async () => {
    const db = fakeDb();
    db.conversations.push(
      convRow({ id: "c1", pipelineStage: "new" }),
      convRow({ id: "c2", pipelineStage: "ordered", contactName: "Karim" }),
      convRow({ id: "c3", pipelineStage: "talking" }),
      convRow({ id: "c4", pipelineStage: "new", status: "closed" }), // closed threads leave the board
    );
    db.orders.push(
      { id: "o1", organizationId: ORG, conversationId: "c2", totalMinor: 150000n, status: "completed", createdAt: new Date() },
      { id: "o2", organizationId: ORG, conversationId: "c3", totalMinor: 50000n, status: "processing", createdAt: new Date() },
    );
    const board = await service(db).getPipelineBoard(ORG);
    expect(board.totalActive).toBe(3);
    expect(board.stages.new.count).toBe(1);
    expect(board.stages.talking.count).toBe(1);
    expect(board.stages.ordered.count).toBe(0);
    expect(board.stages.delivered.count).toBe(1); // derived from the completed order
    expect(board.stages.delivered.valueMinor).toBe("150000");
    expect(board.stages.delivered.cards[0].storedStage).toBe("ordered");
  });
});

describe("U5 command profile + one-click actions", () => {
  function seedCustomer(db: any) {
    db.customers.push({ id: "cust1", organizationId: ORG, name: "Rahim Uddin", phone: "01700000000", email: null, createdAt: new Date() });
    db.conversations.push(
      convRow({ id: "c1", customerId: "cust1", pipelineStage: "ordered" }),
      convRow({ id: "c9", customerId: "cust1", channel: "whatsapp", externalContactId: "8801700000000", status: "closed", pipelineStage: "delivered" }),
    );
    const now = new Date();
    for (let i = 0; i < 3; i++) {
      db.orders.push({
        id: `o${i}`, organizationId: ORG, customerId: "cust1", conversationId: i === 0 ? "c1" : "c9",
        externalNumber: `W-${i}`, status: "completed", source: "chat", isCod: true, currency: "BDT",
        totalMinor: 100000n, createdAt: now,
      });
    }
    db.shipments.push({ id: "s1", organizationId: ORG, orderId: "o0", provider: "steadfast", trackingCode: "SF-123", status: "delivered", createdAt: now });
    db.verifications.push({ id: "v1", organizationId: ORG, conversationId: "c1", provider: "bkash", verdict: "matched", trxId: "TX1", amountMinor: 100000n, createdAt: now });
  }

  it("assembles the full profile: history, lifetime, RFM, payments, shipments", async () => {
    const db = fakeDb(); seedCustomer(db);
    const profile = await service(db).getCommandProfile(ORG, "c1");
    expect(profile.customer?.name).toBe("Rahim Uddin");
    expect(profile.conversations.map((c: any) => c.channel).sort()).toEqual(["webchat", "whatsapp"]);
    expect(profile.lifetime.orderCount).toBe(3);
    expect(profile.lifetime.totalSpentMinor).toBe("300000");
    expect(profile.rfm.segment).toBe("champion");
    expect(profile.orders[0].shipment?.trackingCode).toBe("SF-123");
    expect(profile.payments.verifications[0].verdict).toBe("matched");
  });

  it("shareTracking sends the real tracking through the confirmed path", async () => {
    const db = fakeDb(); seedCustomer(db);
    const out = await service(db).shareTracking(ORG, "agent", "c1");
    expect(out).toMatchObject({ sent: true, trackingCode: "SF-123" });
    const sent = db.messages.filter((m: Row) => m.status === "sent");
    expect(sent).toHaveLength(1);
    expect(sent[0].content).toContain("SF-123");
  });

  it("shareTracking refuses honestly when no booking exists", async () => {
    const db = fakeDb(); db.conversations.push(convRow());
    await expect(service(db).shareTracking(ORG, "agent", "c1")).rejects.toThrow(/অর্ডার পাওয়া যায়নি/);
  });

  it("requestRefund files a note, notifies owners, and moves no money", async () => {
    const db = fakeDb(); db.conversations.push(convRow());
    db.memberships.push(
      { id: "m1", organizationId: ORG, userId: "owner-1", role: "OWNER" },
      { id: "m2", organizationId: ORG, userId: "agent", role: "SUPPORT_AGENT" },
    );
    const out = await service(db).requestRefund(ORG, "agent", "c1", { reason: "ভুল পণ্য গেছে" });
    expect(out).toEqual({ requested: true, notified: 1 });
    expect(db.notes).toHaveLength(1);
    expect(db.notes[0].content).toContain("রিফান্ড অনুরোধ");
    expect(db.notifications).toHaveLength(1);
    expect(db.notifications[0].userId).toBe("owner-1");
  });
});
