import { FulfillmentService } from "./fulfillment.service";
import { ReturnsService } from "./returns.service";

function matchWhere(row: any, where: any): boolean {
  for (const [k, v] of Object.entries(where ?? {})) {
    if (v === undefined) continue;
    if (v && typeof v === "object" && !(v instanceof Date)) {
      if (!matchWhere(row, v)) return false;
    } else if (row[k] !== v) return false;
  }
  return true;
}
function makeTable() {
  const rows: any[] = [];
  let seq = 0;
  return {
    rows,
    findFirst: async ({ where }: any) => rows.find((r) => matchWhere(r, where)) ?? null,
    findMany: async ({ where }: any = {}) => rows.filter((r) => matchWhere(r, where)),
    create: async ({ data }: any) => { const row = { id: data.id ?? `row-${++seq}`, createdAt: new Date(), ...data }; rows.push(row); return row; },
    update: async ({ where, data }: any) => {
      const row = rows.find((r) => matchWhere(r, where));
      if (!row) throw new Error("record not found");
      Object.assign(row, data);
      return row;
    },
  };
}

function setup(opts: { withConversation?: boolean; withEmail?: boolean } = {}) {
  const prisma: any = {
    order: makeTable(), orderItem: makeTable(), customer: makeTable(),
    fulfillment: makeTable(), returnRequest: makeTable(), courierShipment: makeTable(),
    businessProfile: makeTable(), organization: makeTable(),
  };
  const customer: any = {
    id: "c1", organizationId: "org-1", firstName: "Rahim", lastName: "Uddin",
    phone: "01700000000", email: opts.withEmail === false ? null : "rahim@example.com",
  };
  prisma.customer.rows.push(customer);
  const items = [
    { id: "oi1", orderId: "o1", productId: "p1", name: "Shirt", sku: "SH-1", quantity: 5, priceMinor: 10000n, totalMinor: 50000n },
    { id: "oi2", orderId: "o1", productId: "p2", name: "Cap", sku: "CP-1", quantity: 2, priceMinor: 5000n, totalMinor: 10000n },
  ];
  prisma.orderItem.rows.push(...items);
  prisma.order.rows.push({
    id: "o1", organizationId: "org-1", customerId: "c1", externalId: "77", externalNumber: "1001",
    source: "woocommerce", storeId: "st1", status: "completed", isCod: true, isPractice: false,
    conversationId: opts.withConversation === false ? null : "conv-1",
    address: "House 1, Dhaka", totalMinor: 60000n, refundedMinor: 0n,
    items, customer,
  });
  const audit: any = { log: async () => undefined };
  const pushCalls: any[] = [];
  const orderPush: any = { enqueueFulfillment: async (...a: any[]) => { pushCalls.push(a); return { enqueued: 1 }; } };
  const fulfillments = new FulfillmentService(prisma, audit, orderPush);
  const invCalls: any[] = [];
  const inventory: any = { adjust: async (...a: any[]) => { invCalls.push(a); return { stockQuantity: 10 }; } };
  const orderCalls: any = { refunds: [] as any[], manuals: [] as any[] };
  const orders: any = {
    updateOrder: async (_org: string, _u: string, _id: string, dto: any) => { orderCalls.refunds.push(dto); return {}; },
    createManual: async (_org: string, _u: string, dto: any) => { orderCalls.manuals.push(dto); return { id: "o-exchange" }; },
  };
  const inboxCalls: any[] = [];
  const inbox: any = { sendAutomatedMessage: async (...a: any[]) => { inboxCalls.push(a); } };
  const emailCalls: any[] = [];
  const email: any = { send: async (m: any) => { emailCalls.push(m); return { providerMessageId: "e1" }; } };
  const courierCalls: any[] = [];
  const courier: any = {
    bookShipment: async (org: string, u: string, dto: any) => {
      courierCalls.push(dto);
      const row = { id: "sh-ret", organizationId: org, orderId: dto.orderId, provider: dto.provider ?? "steadfast", trackingCode: "RET123", status: "in_review" };
      prisma.courierShipment.rows.push(row);
      return row;
    },
  };
  const returns = new ReturnsService(prisma, audit, courier, inventory, orders, inbox, email);
  return { prisma, fulfillments, returns, pushCalls, invCalls, orderCalls, inboxCalls, emailCalls, courierCalls };
}

describe("EC9 Fulfillment", () => {
  it("partial fulfilment math: remaining shrinks and over-fulfilling is refused", async () => {
    const { fulfillments } = setup();
    await fulfillments.create("org-1", "u1", "o1", { items: [{ orderItemId: "oi1", quantity: 2 }] });
    const view = await fulfillments.listForOrder("org-1", "o1");
    expect(view.items.find((i: any) => i.id === "oi1").remaining).toBe(3);
    expect(view.items.find((i: any) => i.id === "oi2").remaining).toBe(2);
    await expect(fulfillments.create("org-1", "u1", "o1", { items: [{ orderItemId: "oi1", quantity: 4 }] }))
      .rejects.toThrow("বেশি হতে পারবে না");
  });

  it("default fulfilment takes ALL remaining items", async () => {
    const { fulfillments } = setup();
    const f = await fulfillments.create("org-1", "u1", "o1", {});
    expect(f.items).toEqual([
      { orderItemId: "oi1", quantity: 5, packed: false },
      { orderItemId: "oi2", quantity: 2, packed: false },
    ]);
  });

  it("a fulfilment with a courier tracking code enqueues the store push exactly once", async () => {
    const { prisma, fulfillments, pushCalls } = setup();
    prisma.courierShipment.rows.push({ id: "sh1", organizationId: "org-1", orderId: "o1", provider: "steadfast", trackingCode: "SF1", status: "in_review" });
    const f = await fulfillments.create("org-1", "u1", "o1", { courierShipmentId: "sh1" });
    expect(pushCalls.length).toBe(1);
    expect(pushCalls[0][2]).toMatchObject({ trackingCode: "SF1" });
    // A later tracking edit must not re-push (marker is set).
    await fulfillments.update("org-1", "u1", f.id, { trackingCode: "SF2" });
    expect(pushCalls.length).toBe(1);
  });

  it("packing all items flips the fulfilment to packed", async () => {
    const { fulfillments } = setup();
    const f = await fulfillments.create("org-1", "u1", "o1", { items: [{ orderItemId: "oi2", quantity: 1 }] });
    const updated = await fulfillments.update("org-1", "u1", f.id, { packed: [{ orderItemId: "oi2", packed: true }] });
    expect(updated.status).toBe("packed");
    expect(updated.items[0].packed).toBe(true);
  });

  it("manifest is built from real fulfilment rows for the courier + day", async () => {
    const { prisma, fulfillments } = setup();
    prisma.courierShipment.rows.push({ id: "sh1", organizationId: "org-1", orderId: "o1", provider: "steadfast", trackingCode: "SF1", status: "in_review" });
    const f = await fulfillments.create("org-1", "u1", "o1", { courierShipmentId: "sh1", items: [{ orderItemId: "oi1", quantity: 2 }] });
    await fulfillments.update("org-1", "u1", f.id, { status: "handed_over" });
    const m = await fulfillments.manifest("org-1", "steadfast");
    expect(m.totalParcels).toBe(1);
    expect(m.totalItems).toBe(2);
    expect(m.rows[0]).toMatchObject({ trackingCode: "SF1", orderNumber: "1001" });
    const empty = await fulfillments.manifest("org-1", "pathao");
    expect(empty.totalParcels).toBe(0);
  });
});

describe("EC9 Returns — full cycle", () => {
  async function submittedReturn(s: ReturnType<typeof setup>) {
    const link = await s.returns.createLink("org-1", "u1", "o1");
    expect(link.token).toBeTruthy();
    const view = await s.returns.publicView(link.token);
    expect(view.order.items.length).toBe(2);
    await expect(s.returns.publicSubmit(link.token, { items: [{ orderItemId: "oi1", quantity: 99 }] }))
      .rejects.toThrow("বেশি হতে পারবে না");
    await s.returns.publicSubmit(link.token, { reason: "সাইজ মিলছে না", items: [{ orderItemId: "oi1", quantity: 2 }] });
    await expect(s.returns.publicSubmit(link.token, { items: [{ orderItemId: "oi1", quantity: 1 }] }))
      .rejects.toThrow("আগেই জমা");
    return link;
  }

  it("refund resolution: approve -> received (restock) -> complete restocks exactly once + records refund + notifies via inbox", async () => {
    const s = setup();
    const link = await submittedReturn(s);
    const approved = await s.returns.decide("org-1", "u1", link.id, { decision: "approve", resolution: "refund" });
    expect(approved.status).toBe("approved");
    const received = await s.returns.markReceived("org-1", "u1", link.id, { items: [{ orderItemId: "oi1", condition: "ভালো", restock: true }] });
    expect(received.restockDecision).toBe("restock");
    const done = await s.returns.complete("org-1", "u1", link.id);
    expect(done.status).toBe("completed");
    expect(s.invCalls.length).toBe(1);
    expect(s.invCalls[0][2]).toBe("p1");
    expect(s.invCalls[0][3]).toMatchObject({ delta: 2, reason: "return_restock" });
    expect(s.orderCalls.refunds.length).toBe(1);
    expect(s.orderCalls.refunds[0].refund.amountMinor).toBe("60000");
    expect(done.notificationStatus ?? s.prisma.returnRequest.rows[0].notificationStatus).toBe("sent_inbox");
    // A second completion is impossible — the status gate refuses.
    await expect(s.returns.complete("org-1", "u1", link.id)).rejects.toThrow("received");
    expect(s.invCalls.length).toBe(1);
  });

  it("return courier booking reuses the courier path with the merchant as recipient", async () => {
    const s = setup();
    s.prisma.businessProfile.rows.push({ organizationId: "org-1", address: "Road 5, Dhanmondi", city: "Dhaka", contactPhone: "01800000000" });
    s.prisma.organization.rows.push({ id: "org-1", name: "Test Shop" });
    const link = await submittedReturn(s);
    await s.returns.decide("org-1", "u1", link.id, { decision: "approve", resolution: "refund" });
    const booked = await s.returns.bookReturnCourier("org-1", "u1", link.id, {});
    expect(booked.status).toBe("return_shipped");
    expect(booked.returnShipmentId).toBe("sh-ret");
    expect(s.courierCalls[0].recipientAddress).toContain("Dhanmondi");
    expect(s.courierCalls[0].note).toContain("RETURN");
  });

  it("exchange resolution creates a linked manual order on completion", async () => {
    const s = setup();
    const link = await submittedReturn(s);
    await s.returns.decide("org-1", "u1", link.id, { decision: "approve", resolution: "exchange" });
    await s.returns.markReceived("org-1", "u1", link.id, { items: [{ orderItemId: "oi1", condition: "ভালো", restock: false }] });
    const done = await s.returns.complete("org-1", "u1", link.id);
    expect(done.exchangeOrderId).toBe("o-exchange");
    expect(s.orderCalls.manuals.length).toBe(1);
    expect(s.orderCalls.manuals[0].items[0]).toMatchObject({ name: "Shirt", quantity: 2, unitPriceMinor: 10000 });
    expect(s.invCalls.length).toBe(0); // restock was false
  });

  it("no channel (no conversation, no email) is recorded honestly as not_sent_no_channel", async () => {
    const s = setup({ withConversation: false, withEmail: false });
    const link = await s.returns.createLink("org-1", "u1", "o1");
    await s.returns.publicSubmit(link.token, { reason: "x", items: [{ orderItemId: "oi2", quantity: 1 }] });
    const row = s.prisma.returnRequest.rows[0];
    expect(row.notificationStatus).toBe("not_sent_no_channel");
    expect(s.inboxCalls.length).toBe(0);
    expect(s.emailCalls.length).toBe(0);
  });

  it("email fallback fires when there is no conversation", async () => {
    const s = setup({ withConversation: false, withEmail: true });
    const link = await s.returns.createLink("org-1", "u1", "o1");
    await s.returns.publicSubmit(link.token, { reason: "x", items: [{ orderItemId: "oi2", quantity: 1 }] });
    expect(s.prisma.returnRequest.rows[0].notificationStatus).toBe("sent_email");
    expect(s.emailCalls[0].to).toBe("rahim@example.com");
  });

  it("a bad token is a 404, and staff actions on foreign orgs are 404", async () => {
    const s = setup();
    await expect(s.returns.publicView("nope")).rejects.toThrow("not found");
    const link = await s.returns.createLink("org-1", "u1", "o1");
    await expect(s.returns.decide("org-2", "u1", link.id, { decision: "approve" })).rejects.toThrow("not found");
  });
});
