import "reflect-metadata";
import { OrderInsightsService } from "./order-insights.service";

/** ON2 — timeline merge, Customer 360 math, comments CRUD. */

const T = (d: number) => new Date(`2026-10-${String(d).padStart(2, "0")}T10:00:00Z`);

function matchWhere(row: any, where: any): boolean {
  for (const [key, cond] of Object.entries(where ?? {})) {
    const val = (row as any)[key];
    if (cond !== null && typeof cond === "object" && !(cond instanceof Date)) {
      const c: any = cond;
      if ("in" in c && !c.in.map(String).includes(String(val))) return false;
      if ("notIn" in c && c.notIn.map(String).includes(String(val))) return false;
      continue;
    }
    if (String(val) !== String(cond)) return false;
  }
  return true;
}
const table = (rows: any[]) => ({
  findMany: jest.fn(async ({ where }: any = {}) => rows.filter((r) => matchWhere(r, where))),
  findFirst: jest.fn(async ({ where }: any = {}) => rows.find((r) => matchWhere(r, where)) ?? null),
});

function setup() {
  const orders: any[] = [
    { id: "o1", organizationId: "org-1", customerId: "cust1", status: "delivered", source: "manual", totalMinor: 1000n, placedAt: T(1), createdAt: T(1) },
    { id: "o2", organizationId: "org-1", customerId: "cust1", status: "cancelled", source: "woocommerce", totalMinor: 500n, placedAt: T(2), createdAt: T(2) },
    { id: "o3", organizationId: "org-1", customerId: "cust1", status: "completed", source: "woocommerce", totalMinor: 2000n, placedAt: T(3), createdAt: T(3) },
    { id: "o4", organizationId: "org-1", customerId: "cust1", status: "processing", source: "woocommerce", totalMinor: 3000n, placedAt: T(4), createdAt: T(4) },
    { id: "o5", organizationId: "org-1", customerId: "cust2", status: "processing", source: "woocommerce", totalMinor: 700n, placedAt: T(5), createdAt: T(5) },
    { id: "o-nocust", organizationId: "org-1", customerId: null, status: "pending", source: "manual", totalMinor: 100n, placedAt: T(1), createdAt: T(1) },
  ];
  const customers: any[] = [
    { id: "cust1", organizationId: "org-1", firstName: "Rahim", lastName: "Uddin", phone: "01711000001", email: "rahim@example.com" },
    { id: "cust2", organizationId: "org-1", firstName: "New", lastName: "Buyer", phone: "01711000099", email: null },
  ];
  const audits: any[] = [
    { id: "a1", organizationId: "org-1", entityType: "Order", entityId: "o1", action: "orders.status_changed", userId: "u1", metadata: { from: "processing", to: "delivered" }, createdAt: T(6) },
    { id: "a2", organizationId: "org-1", entityType: "Order", entityId: "o1", action: "orders.internal_note_updated", userId: "u1", metadata: { cleared: false }, createdAt: T(7) },
    { id: "a3", organizationId: "org-1", entityType: "Order", entityId: "o1", action: "orders.manual_created", userId: "u1", metadata: {}, createdAt: T(1) },
    { id: "a4", organizationId: "org-1", entityType: "Order", entityId: "o1", action: "orders.refund_recorded", userId: "u1", metadata: { amountMinor: "200" }, createdAt: T(8) },
    { id: "a5", organizationId: "org-1", entityType: "PaymentVerification", entityId: "pv1", action: "orders.advance_verification_recorded", userId: "u1", metadata: { orderId: "o1" }, createdAt: T(9) },
  ];
  const verifications: any[] = [
    { id: "pv1", organizationId: "org-1", orderId: "o1", status: "approved", amountMinor: 300n, source: "manual_advance", createdAt: T(9) },
    { id: "pv2", organizationId: "org-1", orderId: "o1", status: "pending", amountMinor: 100n, source: "bkash", createdAt: T(10) },
    { id: "pv3", organizationId: "org-1", orderId: "o3", status: "approved", amountMinor: 2000n, source: "manual_advance", createdAt: T(9) },
    { id: "pv4", organizationId: "org-1", orderId: "o4", status: "approved", amountMinor: 1000n, source: "manual_advance", createdAt: T(9) },
  ];
  const comments: any[] = [];
  const prisma: any = {
    order: table(orders),
    customer: table(customers),
    auditLog: table(audits),
    paymentVerification: {
      ...table(verifications),
      groupBy: jest.fn(async ({ where }: any) => {
        const sums = new Map<string, bigint>();
        for (const v of verifications.filter((r) => r.organizationId === where.organizationId && r.status === where.status && (where.orderId?.in ?? []).map(String).includes(String(r.orderId)))) {
          sums.set(String(v.orderId), (sums.get(String(v.orderId)) ?? 0n) + BigInt(v.amountMinor ?? 0));
        }
        return [...sums.entries()].map(([orderId, s]) => ({ orderId, _sum: { amountMinor: s } }));
      }),
    },
    fulfillment: table([
      { id: "f1", organizationId: "org-1", orderId: "o1", status: "packed", createdAt: T(11), updatedAt: T(12) },
    ]),
    courierShipment: table([
      { id: "s1", organizationId: "org-1", orderId: "o1", provider: "steadfast", trackingCode: "TRK1", status: "delivered", codCollectedMinor: 1000n, codCollectedAt: T(14), createdAt: T(13), updatedAt: T(14) },
    ]),
    returnRequest: table([
      { id: "r1", organizationId: "org-1", orderId: "o1", customerId: "cust1", status: "approved", source: "staff", createdAt: T(15), updatedAt: T(16), restockAppliedAt: null },
    ]),
    orderReview: table([
      { id: "rv1", organizationId: "org-1", orderId: "o1", requestedAt: T(17), receivedAt: T(18), rating: 5 },
    ]),
    installmentPlan: table([
      { id: "ip1", organizationId: "org-1", orderId: "o1", createdAt: T(19) },
    ]),
    installmentItem: table([
      { id: "ii1", planId: "ip1", seq: 1, amountMinor: 500n, paidAt: T(20) },
      { id: "ii2", planId: "ip1", seq: 2, amountMinor: 500n, paidAt: null },
    ]),
    deliveryAssignment: table([
      { id: "da1", organizationId: "org-1", orderId: "o1", assignedAt: T(21), pickedUpAt: null, deliveredAt: T(22), returnedAt: null },
    ]),
    user: table([{ id: "u1", name: "Rahim Staff", email: "staff@example.com" }]),
    membership: table([
      { userId: "u-admin", organizationId: "org-1", role: "ADMIN", status: "ACTIVE" },
      { userId: "u-other", organizationId: "org-1", role: "SUPPORT_AGENT", status: "ACTIVE" },
    ]),
    orderComment: {
      findMany: jest.fn(async ({ where }: any = {}) => comments.filter((r) => matchWhere(r, where))),
      findFirst: jest.fn(async ({ where }: any = {}) => comments.find((r) => matchWhere(r, where)) ?? null),
      create: jest.fn(async ({ data }: any) => {
        const row = { id: `c${comments.length + 1}`, createdAt: new Date(Date.now() + comments.length * 1000), updatedAt: null, ...data };
        comments.push(row); return row;
      }),
      delete: jest.fn(async ({ where }: any) => {
        const i = comments.findIndex((r) => r.id === where.id); comments.splice(i, 1); return {};
      }),
    },
  };
  const audit = { log: jest.fn(async () => undefined) };
  const svc = new OrderInsightsService(prisma, audit as any);
  return { svc, prisma, audit, comments };
}

describe("ON2 timeline", () => {
  it("merges real records desc, with the pinned titles, and no payment double-count", async () => {
    const { svc } = setup();
    const { entries, truncated } = await svc.timeline("org-1", "o1");
    expect(truncated).toBe(false);
    const titles = entries.map((e: any) => e.title);
    expect(titles).toContain("অর্ডার তৈরি হয়েছে");
    expect(titles).toContain("অবস্থা পরিবর্তন: processing → delivered");
    expect(titles).toContain("রিফান্ড রেকর্ড হয়েছে");
    expect(titles).toContain("পেমেন্ট যাচাই হয়েছে");
    expect(titles).toContain("পেমেন্ট যাচাই অপেক্ষমাণ");
    expect(titles).toContain("ফুলফিলমেন্ট তৈরি হয়েছে");
    expect(titles).toContain("প্যাক করা হয়েছে");
    expect(titles).toContain("কুরিয়ার বুক করা হয়েছে");
    expect(titles).toContain("COD টাকা সংগ্রহ (মিলকরণ)");
    expect(titles).toContain("রিটার্ন অনুরোধ তৈরি হয়েছে");
    expect(titles).toContain("রিটার্ন অনুমোদিত হয়েছে");
    expect(titles).toContain("রিভিউ অনুরোধ পাঠানো হয়েছে");
    expect(titles).toContain("গ্রাহক রিভিউ দিয়েছেন");
    expect(titles).toContain("কিস্তি পরিকল্পনা তৈরি হয়েছে");
    expect(titles).toContain("কিস্তি #1 পরিশোধ হয়েছে");
    expect(titles).toContain("রাইডারকে দেওয়া হয়েছে");
    expect(titles).toContain("রাইডার ডেলিভারি করেছেন");
    // Excluded audits never appear; the PaymentVerification-entity
    // audit must not duplicate the payment row entry.
    expect(titles).not.toContain("orders.internal_note_updated");
    expect(titles).not.toContain("orders.manual_created");
    expect(titles).not.toContain("orders.advance_verification_recorded");
    expect(entries.filter((e: any) => e.kind === "payment")).toHaveLength(2);
    // Desc order: newest (rider delivered, T22) first.
    expect(entries[0].title).toBe("রাইডার ডেলিভারি করেছেন");
    const times = entries.map((e: any) => new Date(e.at).getTime());
    expect([...times].sort((a, b) => b - a)).toEqual(times);
    // Actor names batch-resolved for audit entries.
    const status = entries.find((e: any) => e.kind === "status");
    expect(status!.actor).toBe("Rahim Staff");
    // Shipment detail carries provider + tracking.
    const ship = entries.find((e: any) => e.title === "কুরিয়ার বুক করা হয়েছে");
    expect(ship!.detail).toContain("steadfast");
    expect(ship!.detail).toContain("TRK1");
  });

  it("foreign / missing order is a 404", async () => {
    const { svc } = setup();
    await expect(svc.timeline("org-2", "o1")).rejects.toThrow("Order not found in this organization");
    await expect(svc.timeline("org-1", "missing")).rejects.toThrow("Order not found in this organization");
  });

  it("caps at 200 entries with the truncated flag", async () => {
    const { svc, prisma } = setup();
    const many = Array.from({ length: 250 }, (_, i) => ({
      id: `ax${i}`, organizationId: "org-1", entityType: "Order", entityId: "o1",
      action: "orders.tags_updated", userId: "u1", metadata: {}, createdAt: new Date(Date.UTC(2026, 9, 1) + i * 60000),
    }));
    (prisma.auditLog.findMany as jest.Mock).mockImplementation(async () => many);
    const out = await svc.timeline("org-1", "o1");
    expect(out.entries).toHaveLength(200);
    expect(out.truncated).toBe(true);
  });
});

describe("ON2 customer-360", () => {
  it("computes counts, sold-only LTV, reliability and open due", async () => {
    const { svc } = setup();
    const out = await svc.customer360("org-1", "o1");
    expect(out.customer).toEqual({ id: "cust1", name: "Rahim Uddin", phone: "01711000001", email: "rahim@example.com" });
    expect(out.orderCount).toBe(4);
    expect(out.cancelledCount).toBe(1);
    expect(out.returnedCount).toBe(0);
    expect(out.deliveredCount).toBe(2); // o1 delivered + o3 completed (sold); o4 not sold, o2 dead
    expect(out.lifetimeValueMinor).toBe("3000");
    expect(out.reliabilityPercent).toBe(66.7); // 2 / (2 + 1 + 0)
    // Open due over o1 (1000-300) + o3 (2000-2000) + o4 (3000-1000); o2 excluded (cancelled)
    expect(out.openDueMinor).toBe("2700");
    expect(out.openReturns).toBe(1);
    expect(out.lastOrders).toHaveLength(4);
    expect(out.lastOrders[0].id).toBe("o4");
    expect(out.lastOrders[0].totalMinor).toBe("3000");
  });

  it("no-customer order returns the zero shape; a fresh customer has null reliability", async () => {
    const { svc } = setup();
    const zero = await svc.customer360("org-1", "o-nocust");
    expect(zero).toEqual({
      customer: null, orderCount: 0, deliveredCount: 0, cancelledCount: 0, returnedCount: 0,
      lifetimeValueMinor: "0", reliabilityPercent: null, openDueMinor: "0", openReturns: 0, lastOrders: [],
    });
    const fresh = await svc.customer360("org-1", "o5");
    expect(fresh.orderCount).toBe(1);
    expect(fresh.reliabilityPercent).toBeNull();
    expect(fresh.openDueMinor).toBe("700");
  });

  it("missing order is a 404", async () => {
    const { svc } = setup();
    await expect(svc.customer360("org-1", "missing")).rejects.toThrow("Order not found in this organization");
  });
});

describe("ON2 comments", () => {
  it("create trims + audits without the body; list is ASC with author names", async () => {
    const { svc, audit } = setup();
    const c1 = await svc.createComment("org-1", "u1", "o1", "  প্রথম মন্তব্য  ");
    expect(c1.body).toBe("প্রথম মন্তব্য");
    expect(c1.authorName).toBe("Rahim Staff");
    await svc.createComment("org-1", "u1", "o1", "দ্বিতীয় মন্তব্য");
    const list = await svc.listComments("org-1", "o1");
    expect(list.map((c: any) => c.body)).toEqual(["প্রথম মন্তব্য", "দ্বিতীয় মন্তব্য"]);
    const call = (audit.log as jest.Mock).mock.calls.find((c: any[]) => c[0].action === "orders.comment_created");
    expect(call[0].metadata).toEqual({ orderId: "o1" });
    expect(JSON.stringify(call[0])).not.toContain("প্রথম মন্তব্য");
  });

  it("empty / oversized bodies are a 400; comments on a missing order are a 404", async () => {
    const { svc } = setup();
    await expect(svc.createComment("org-1", "u1", "o1", "   ")).rejects.toThrow(/মন্তব্য/);
    await expect(svc.createComment("org-1", "u1", "o1", "x".repeat(2001))).rejects.toThrow(/মন্তব্য/);
    await expect(svc.createComment("org-1", "u1", "missing", "hello")).rejects.toThrow("Order not found in this organization");
    await expect(svc.listComments("org-1", "missing")).rejects.toThrow("Order not found in this organization");
  });

  it("delete: author ok, other staff 403 Bengali, ADMIN member ok, missing comment 404", async () => {
    const { svc } = setup();
    const mine = await svc.createComment("org-1", "u1", "o1", "আমার মন্তব্য");
    const theirs = await svc.createComment("org-1", "u-author2", "o1", "অন্যের মন্তব্য");
    await expect(svc.deleteComment("org-1", "u-other", "o1", theirs.id)).rejects.toThrow(/শুধু মন্তব্যের লেখক অথবা অ্যাডমিন/);
    expect((await svc.deleteComment("org-1", "u-admin", "o1", theirs.id)).deleted).toBe(true);
    expect((await svc.deleteComment("org-1", "u1", "o1", mine.id)).deleted).toBe(true);
    await expect(svc.deleteComment("org-1", "u1", "o1", "missing-comment")).rejects.toThrow("Comment not found");
    await expect(svc.deleteComment("org-1", "u1", "missing-order", mine.id)).rejects.toThrow("Order not found in this organization");
    // A comment on ANOTHER order is scoped out -> 404.
    const onO2 = await svc.createComment("org-1", "u1", "o2", "অন্য অর্ডারের মন্তব্য");
    await expect(svc.deleteComment("org-1", "u1", "o1", onO2.id)).rejects.toThrow("Comment not found");
  });
});
