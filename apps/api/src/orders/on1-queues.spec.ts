import "reflect-metadata";
import { OrdersService } from "./orders.service";
import { STUCK_DAYS, TRANSIT_STATUSES, dhakaTodayString } from "./order-queues";

/**
 * ON1 — smart queues. One shared fixture set; for EVERY queue the
 * count endpoint and the queue-filtered list must agree, because
 * both go through resolveQueueOrderIds.
 */

function matchWhere(row: any, where: any): boolean {
  for (const [key, cond] of Object.entries(where ?? {})) {
    const val = row[key];
    if (cond !== null && typeof cond === "object" && !(cond instanceof Date)) {
      const c: any = cond;
      if ("in" in c && !c.in.map(String).includes(String(val))) return false;
      if ("notIn" in c && c.notIn.map(String).includes(String(val))) return false;
      if ("not" in c && String(val) === String(c.not)) return false;
      continue;
    }
    if (String(val) !== String(cond)) return false;
  }
  return true;
}

function setup() {
  const today = dhakaTodayString();
  const now = Date.now();
  const orders: any[] = [
    { id: "o-need", status: "pending", isCod: true, codConfirmationStatus: "awaiting", isPractice: false, placedAt: new Date("2026-10-10T10:00:00Z"), totalMinor: 1000n, items: [] },
    { id: "o-need2", status: "on-hold", isCod: true, codConfirmationStatus: "awaiting", isPractice: false, placedAt: new Date("2026-10-09T10:00:00Z"), totalMinor: 1000n, items: [] },
    { id: "o-confirmed", status: "processing", isCod: true, codConfirmationStatus: "confirmed", isPractice: false, placedAt: new Date("2026-10-08T10:00:00Z"), totalMinor: 1000n, items: [{ id: "oi-c", quantity: 1 }] },
    { id: "o-ready", status: "processing", isCod: false, codConfirmationStatus: null, isPractice: false, placedAt: new Date("2026-10-07T10:00:00Z"), totalMinor: 1000n, items: [{ id: "oi-r", quantity: 2 }] },
    { id: "o-covered", status: "processing", isCod: false, codConfirmationStatus: null, isPractice: false, placedAt: new Date("2026-10-06T10:00:00Z"), totalMinor: 1000n, items: [{ id: "oi-v", quantity: 1 }] },
    { id: "o-active-ship", status: "processing", isCod: false, codConfirmationStatus: null, isPractice: false, placedAt: new Date("2026-10-05T10:00:00Z"), totalMinor: 1000n, items: [{ id: "oi-a", quantity: 1 }] },
    { id: "o-stuck", status: "processing", isCod: false, codConfirmationStatus: null, isPractice: false, placedAt: new Date("2026-10-04T10:00:00Z"), totalMinor: 1000n, items: [{ id: "oi-s", quantity: 1 }] },
    { id: "o-today", status: "processing", isCod: false, codConfirmationStatus: null, isPractice: false, deliveryDate: today, placedAt: new Date("2026-10-03T10:00:00Z"), totalMinor: 1000n, items: [] },
    { id: "o-today-cancelled", status: "cancelled", isCod: false, codConfirmationStatus: null, isPractice: false, deliveryDate: today, placedAt: new Date("2026-10-03T10:00:00Z"), totalMinor: 1000n, items: [] },
    { id: "o-due", status: "completed", isCod: false, codConfirmationStatus: null, isPractice: false, placedAt: new Date("2026-10-02T10:00:00Z"), totalMinor: 1000n, items: [] },
    { id: "o-paid", status: "delivered", isCod: false, codConfirmationStatus: null, isPractice: false, placedAt: new Date("2026-10-02T09:00:00Z"), totalMinor: 500n, items: [] },
    { id: "o-return", status: "delivered", isCod: false, codConfirmationStatus: null, isPractice: false, placedAt: new Date("2026-10-01T10:00:00Z"), totalMinor: 1000n, items: [] },
    { id: "o-practice", status: "pending", isCod: true, codConfirmationStatus: "awaiting", isPractice: true, placedAt: new Date("2026-10-10T10:00:00Z"), totalMinor: 1000n, items: [] },
  ].map((o) => ({ organizationId: "org-1", createdAt: o.placedAt, customer: null, subtotalMinor: 0n, shippingMinor: 0n, discountMinor: 0n, taxMinor: 0n, refundedMinor: 0n, ...o }));
  const shipments: any[] = [
    { id: "s-active", organizationId: "org-1", orderId: "o-active-ship", provider: "steadfast", status: "in_transit", updatedAt: new Date(now - 3600_000) },
    { id: "s-stuck", organizationId: "org-1", orderId: "o-stuck", provider: "steadfast", status: "in_transit", updatedAt: new Date(now - (STUCK_DAYS + 6) * 86400_000) },
    { id: "s-delivered", organizationId: "org-1", orderId: "o-return", provider: "steadfast", status: "delivered", updatedAt: new Date(now - 86400_000) },
  ];
  const fulfillments: any[] = [
    { id: "f-covered", organizationId: "org-1", orderId: "o-covered", status: "packed", items: [{ orderItemId: "oi-v", quantity: 1 }] },
  ];
  const returns: any[] = [
    { id: "r1", organizationId: "org-1", orderId: "o-return", status: "requested" },
    { id: "r2", organizationId: "org-1", orderId: "o-ready", status: "completed" },
  ];
  const verifications: any[] = [
    { organizationId: "org-1", orderId: "o-due", status: "approved", amountMinor: 400n },
    { organizationId: "org-1", orderId: "o-due", status: "pending", amountMinor: 999n },
    { organizationId: "org-1", orderId: "o-paid", status: "approved", amountMinor: 500n },
    { organizationId: "org-1", orderId: "o-return", status: "approved", amountMinor: 1000n },
  ];
  const table = (rows: any[]) => ({
    findMany: jest.fn(async ({ where }: any = {}) => rows.filter((r) => matchWhere(r, where))),
    findFirst: jest.fn(async ({ where }: any = {}) => rows.find((r) => matchWhere(r, where)) ?? null),
    count: jest.fn(async ({ where }: any = {}) => rows.filter((r) => matchWhere(r, where)).length),
  });
  const prisma: any = {
    order: {
      ...table(orders),
      findMany: jest.fn(async (args: any = {}) => {
        let rows = orders.filter((r) => matchWhere(r, args.where));
        if (args.orderBy?.placedAt === "desc") rows = [...rows].sort((a, b) => new Date(b.placedAt ?? 0).getTime() - new Date(a.placedAt ?? 0).getTime());
        if (args.skip) rows = rows.slice(args.skip);
        if (args.take) rows = rows.slice(0, args.take);
        return rows;
      }),
    },
    courierShipment: table(shipments),
    fulfillment: table(fulfillments),
    returnRequest: table(returns),
    paymentVerification: {
      groupBy: jest.fn(async ({ where }: any) => {
        const sums = new Map<string, bigint>();
        for (const v of verifications.filter((r) => matchWhere(r, { organizationId: where.organizationId, status: where.status }) && (where.orderId?.in ?? []).map(String).includes(String(r.orderId)))) {
          sums.set(String(v.orderId), (sums.get(String(v.orderId)) ?? 0n) + BigInt(v.amountMinor ?? 0));
        }
        return [...sums.entries()].map(([orderId, s]) => ({ orderId, _sum: { amountMinor: s } }));
      }),
      findMany: jest.fn(async () => []),
    },
    // due_collection: the fake $queryRaw computes the same grouped
    // predicate the real SQL encodes, from the same fixtures.
    $queryRaw: jest.fn(async () => orders
      .filter((o) => o.organizationId === "org-1" && !o.isPractice && ["completed", "delivered"].includes(o.status))
      .filter((o) => {
        const paid = verifications.filter((v) => v.orderId === o.id && v.status === "approved").reduce((s, v) => s + BigInt(v.amountMinor ?? 0), 0n);
        return BigInt(o.totalMinor) > paid;
      })
      .map((o) => ({ id: o.id, placedAt: o.placedAt, createdAt: o.createdAt }))),
  };
  const audit = { log: jest.fn(async () => undefined) };
  const svc = new OrdersService(prisma, undefined, undefined, audit as any);
  return { svc, prisma };
}

describe("ON1 queues", () => {
  it("exports the pinned constants", () => {
    expect(STUCK_DAYS).toBe(4);
    expect(TRANSIT_STATUSES).toContain("in_transit");
    expect(TRANSIT_STATUSES).not.toContain("delivered");
  });

  it("unknown queue key is a Bengali 400", async () => {
    const { svc } = setup();
    await expect(svc.resolveQueueOrderIds("org-1", "bogus")).rejects.toThrow(/অজানা কিউ/);
  });

  const expected: Record<string, string[]> = {
    needs_confirmation: ["o-need", "o-need2"],
    ready_to_pack: ["o-confirmed", "o-ready", "o-today"],
    in_transit_stuck: ["o-stuck"],
    deliveries_today: ["o-today"],
    due_collection: ["o-due"],
    returns_open: ["o-return"],
  };
  for (const [key, ids] of Object.entries(expected)) {
    it(`${key} resolves exactly its orders (practice excluded)`, async () => {
      const { svc } = setup();
      const got = await svc.resolveQueueOrderIds("org-1", key);
      expect([...got].sort()).toEqual([...ids].sort());
      expect(got).not.toContain("o-practice");
    });
  }

  it("all_open excludes terminal-ish statuses; all includes every non-practice order", async () => {
    const { svc } = setup();
    const open = await svc.resolveQueueOrderIds("org-1", "all_open");
    expect(open).toContain("o-need");
    expect(open).not.toContain("o-due"); // completed
    expect(open).not.toContain("o-today-cancelled");
    const all = await svc.resolveQueueOrderIds("org-1", "all");
    expect(all).toHaveLength(12);
    expect(all).not.toContain("o-practice");
  });

  it("count == list length for every queue (single code path)", async () => {
    const { svc } = setup();
    const counts = await svc.queueCounts("org-1");
    expect(counts.map((c) => c.key)).toEqual([
      "needs_confirmation", "ready_to_pack", "in_transit_stuck", "deliveries_today",
      "due_collection", "returns_open", "review_hold", "incomplete_intake", "sla_breach", "all_open", "all",
    ]);
    expect(counts.find((c) => c.key === "needs_confirmation")?.label).toBe("নিশ্চিত করা বাকি");
    for (const c of counts) {
      const list = await svc.list("org-1", { queue: c.key, pageSize: 100 });
      expect(list.total).toBe(c.count);
      expect(list.items).toHaveLength(c.count);
    }
  });

  it("ready_to_pack: a partially packed order stays, a fully covered one leaves", async () => {
    const { svc, prisma } = setup();
    // o-ready needs 2 of oi-r; pack only 1 -> still ready.
    (prisma.fulfillment.findMany as jest.Mock).mockImplementation(async () => [
      { id: "f-part", organizationId: "org-1", orderId: "o-ready", status: "pending", items: [{ orderItemId: "oi-r", quantity: 1 }] },
    ]);
    let ids = await svc.resolveQueueOrderIds("org-1", "ready_to_pack");
    expect(ids).toContain("o-ready");
    // Pack the second unit too -> covered -> leaves the queue.
    (prisma.fulfillment.findMany as jest.Mock).mockImplementation(async () => [
      { id: "f-part", organizationId: "org-1", orderId: "o-ready", status: "packed", items: [{ orderItemId: "oi-r", quantity: 2 }] },
      { id: "f-covered", organizationId: "org-1", orderId: "o-covered", status: "packed", items: [{ orderItemId: "oi-v", quantity: 1 }] },
    ]);
    ids = await svc.resolveQueueOrderIds("org-1", "ready_to_pack");
    expect(ids).not.toContain("o-ready");
  });
});
