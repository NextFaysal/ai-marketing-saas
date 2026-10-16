import "reflect-metadata";
import { OrdersService } from "./orders.service";
import { OrderProfitService } from "./order-profit.service";

/**
 * GB5 (GC14) — the rto_attention queue + the ON7 booking-charge
 * fallback. Same fake-table discipline as on1-queues/on7-profit.
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

describe("GB5 rto_attention queue", () => {
  function setup() {
    const orders: any[] = [
      { id: "o-rto", status: "processing", isPractice: false },
      { id: "o-rto-open-rr", status: "processing", isPractice: false },
      { id: "o-rto-resolved", status: "processing", isPractice: false },
      { id: "o-rto-restocked", status: "processing", isPractice: false },
      { id: "o-order-returned", status: "returned", isPractice: false },
      { id: "o-order-refunded", status: "refunded", isPractice: false },
      { id: "o-delivered", status: "delivered", isPractice: false },
      { id: "o-practice-rto", status: "processing", isPractice: true },
    ].map((o) => ({ organizationId: "org-1", ...o }));
    const shipments: any[] = [
      { id: "s1", organizationId: "org-1", orderId: "o-rto", provider: "pathao", status: "returned" },
      { id: "s2", organizationId: "org-1", orderId: "o-rto-open-rr", provider: "pathao", status: "returned" },
      { id: "s3", organizationId: "org-1", orderId: "o-rto-resolved", provider: "redx", status: "return" }, // classifier alias
      { id: "s4", organizationId: "org-1", orderId: "o-rto-restocked", provider: "redx", status: "returned" },
      { id: "s5", organizationId: "org-1", orderId: "o-order-returned", provider: "pathao", status: "returned" },
      { id: "s6", organizationId: "org-1", orderId: "o-order-refunded", provider: "pathao", status: "returned" },
      { id: "s7", organizationId: "org-1", orderId: "o-delivered", provider: "pathao", status: "delivered" },
      { id: "s8", organizationId: "org-1", orderId: "o-practice-rto", provider: "pathao", status: "returned" },
    ];
    const returns: any[] = [
      { id: "r1", organizationId: "org-1", orderId: "o-rto-open-rr", status: "requested", restockAppliedAt: null },
      { id: "r2", organizationId: "org-1", orderId: "o-rto-resolved", status: "received", restockAppliedAt: null },
      { id: "r3", organizationId: "org-1", orderId: "o-rto-restocked", status: "return_shipped", restockAppliedAt: new Date() },
    ];
    const table = (rows: any[]) => ({
      findMany: jest.fn(async ({ where }: any = {}) => rows.filter((r) => matchWhere(r, where))),
      findFirst: jest.fn(async ({ where }: any = {}) => rows.find((r) => matchWhere(r, where)) ?? null),
      count: jest.fn(async ({ where }: any = {}) => rows.filter((r) => matchWhere(r, where)).length),
    });
    const prisma: any = {
      order: table(orders), courierShipment: table(shipments), returnRequest: table(returns),
      fulfillment: table([]), paymentVerification: { groupBy: jest.fn(async () => []), findMany: jest.fn(async () => []) },
      $queryRaw: jest.fn(async () => []),
    };
    const audit = { log: jest.fn(async () => undefined) };
    const svc = new OrdersService(prisma, undefined, undefined, audit as any);
    return { svc };
  }

  it("includes returned-shipment orders without a completed resolution — and only those", async () => {
    const { svc } = setup();
    const ids = await svc.resolveQueueOrderIds("org-1", "rto_attention");
    expect(ids).toContain("o-rto"); // no return request at all
    expect(ids).toContain("o-rto-open-rr"); // open request does NOT clear it
    expect(ids).not.toContain("o-rto-resolved"); // ReturnRequest received -> resolved
    expect(ids).not.toContain("o-rto-restocked"); // restock applied -> resolved
    expect(ids).not.toContain("o-order-returned"); // order already terminal
    expect(ids).not.toContain("o-order-refunded");
    expect(ids).not.toContain("o-delivered"); // shipment not returned
    expect(ids).not.toContain("o-practice-rto"); // practice excluded
    expect(ids).toHaveLength(2);
  });

  it("count == list through the shared resolver", async () => {
    const { svc } = setup();
    const counts = await svc.queueCounts("org-1");
    const rto = counts.find((c) => c.key === "rto_attention");
    expect(rto?.label).toBe("RTO — ফেরত পার্সেল দেখা বাকি");
    expect(rto?.count).toBe(2);
  });
});

describe("GB5 ON7 — booking-charge fallback with source labels", () => {
  function makeTable(name: string, rows: any[] = []) {
    let seq = 0;
    const matches = (row: any, where: any): boolean => Object.entries(where ?? {}).every(([k, v]) => {
      if (v && typeof v === "object" && !(v instanceof Date)) {
        const c: any = v;
        if ("in" in c) return c.in.map(String).includes(String(row[k]));
        return true;
      }
      return String(row[k]) === String(v);
    });
    return {
      rows,
      findMany: async ({ where, take }: any = {}) => {
        let f = rows.filter((r) => matches(r, where ?? {}));
        if (take !== undefined) f = f.slice(0, take);
        return f;
      },
      findFirst: async ({ where }: any = {}) => rows.find((r) => matches(r, where ?? {})) ?? null,
      create: async ({ data }: any) => { const row = { id: data.id ?? `${name}-${++seq}`, createdAt: new Date(), ...data }; rows.push(row); return row; },
    };
  }

  function setup() {
    const prisma: any = {
      order: makeTable("order"), orderItem: makeTable("item"), productCost: makeTable("cost"),
      productVariant: makeTable("variant"), courierShipment: makeTable("shipment"),
      reconciliationLine: makeTable("recon"), paymentVerification: makeTable("pv"),
    };
    prisma.order.rows.push({
      id: "ord-1", organizationId: "org-1", externalId: "ext-1", externalNumber: "1001",
      status: "completed", isPractice: false, totalMinor: 100000n, discountMinor: 0n,
      shippingMinor: 6000n, placedAt: new Date("2026-09-15T10:00:00Z"), createdAt: new Date("2026-09-15T10:00:00Z"),
    });
    prisma.orderItem.rows.push({
      id: "it-1", orderId: "ord-1", productId: "p-1", sku: null, name: "Panjabi",
      quantity: 1, priceMinor: 100000n, totalMinor: 100000n, isGift: false,
    });
    prisma.productCost.rows.push({
      id: "c-1", organizationId: "org-1", productId: "p-1", variantId: null,
      costMinor: 40000n, effectiveFrom: new Date("2026-09-01T00:00:00Z"),
    });
    return { prisma, svc: new OrderProfitService(prisma) };
  }

  it("booking charge alone -> delivery actual from booking, labelled", async () => {
    const { prisma, svc } = setup();
    prisma.courierShipment.rows.push({ id: "sh-1", organizationId: "org-1", orderId: "ord-1", provider: "pathao", status: "delivered", chargeMinor: 6000n });
    const out: any = await svc.getOrderProfit("org-1", "ord-1");
    expect(out.deliveryActualMinor).toBe("6000");
    expect(out.deliveryActualSource).toBe("booking");
    expect(out.deliveryActualCoverage).toEqual({ shipments: 1, withCharge: 1 });
    expect(out.netMarginMinor).toBe("54000"); // 100000 − 40000 − 6000
  });

  it("the settlement sheet still wins over the booking charge", async () => {
    const { prisma, svc } = setup();
    prisma.courierShipment.rows.push({ id: "sh-1", organizationId: "org-1", orderId: "ord-1", provider: "pathao", status: "delivered", chargeMinor: 6000n });
    prisma.reconciliationLine.rows.push({
      id: "rl-1", organizationId: "org-1", matchedShipmentId: "sh-1", outcome: "matched",
      sheetChargeMinor: 5500n, createdAt: new Date("2026-09-20T00:00:00Z"),
    });
    const out: any = await svc.getOrderProfit("org-1", "ord-1");
    expect(out.deliveryActualMinor).toBe("5500");
    expect(out.deliveryActualSource).toBe("reconciliation_sheet");
  });

  it("mixed sources across shipments are labelled mixed; a chargeless shipment keeps actual null", async () => {
    const { prisma, svc } = setup();
    prisma.courierShipment.rows.push(
      { id: "sh-1", organizationId: "org-1", orderId: "ord-1", provider: "pathao", status: "delivered", chargeMinor: 6000n },
      { id: "sh-2", organizationId: "org-1", orderId: "ord-1", provider: "redx", status: "delivered", chargeMinor: null },
    );
    prisma.reconciliationLine.rows.push({
      id: "rl-1", organizationId: "org-1", matchedShipmentId: "sh-2", outcome: "matched",
      sheetChargeMinor: 7000n, createdAt: new Date("2026-09-20T00:00:00Z"),
    });
    const mixed: any = await svc.getOrderProfit("org-1", "ord-1");
    expect(mixed.deliveryActualMinor).toBe("13000");
    expect(mixed.deliveryActualSource).toBe("mixed");

    const { prisma: p2, svc: s2 } = setup();
    p2.courierShipment.rows.push({ id: "sh-9", organizationId: "org-1", orderId: "ord-1", provider: "steadfast", status: "delivered", chargeMinor: null });
    const none: any = await s2.getOrderProfit("org-1", "ord-1");
    expect(none.deliveryActualMinor).toBeNull();
    expect(none.deliveryActualSource).toBeNull();
    expect(none.deliveryActualCoverage).toEqual({ shipments: 1, withCharge: 0 });
  });
});
