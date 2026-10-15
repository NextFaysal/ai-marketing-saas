import "reflect-metadata";
import { OrderProfitService } from "./order-profit.service";

/**
 * ON7 — OrderProfitService specs: ProductCost as-of rule,
 * delivery-actual coverage, the sold-bucket predicate, and the
 * profit report (totals, per-product margin sort, cap flag).
 * Fake-Prisma in the neighbouring makeTable style.
 */
function matches(row: any, where: any): boolean {
  return Object.entries(where ?? {}).every(([k, v]: [string, any]) => {
    if (v === undefined) return true;
    if (v !== null && typeof v === "object" && !(v instanceof Date) && !Array.isArray(v)) {
      if ("in" in v && !v.in.map(String).includes(String(row[k]))) return false;
      if ("notIn" in v && v.notIn.map(String).includes(String(row[k]))) return false;
      if ("not" in v && row[k] === v.not) return false;
      return true;
    }
    if (v === null) return row[k] === null || row[k] === undefined;
    return String(row[k]) === String(v);
  });
}

function makeTable(name: string) {
  const rows: any[] = [];
  let seq = 0;
  return {
    rows,
    findFirst: async ({ where }: any = {}) => rows.find((r) => matches(r, where)) ?? null,
    findMany: async ({ where, take }: any = {}) => {
      let f = rows.filter((r) => matches(r, where ?? {}));
      if (take !== undefined) f = f.slice(0, take);
      return f;
    },
    create: async ({ data }: any) => {
      const row = { id: data.id ?? `${name}-${++seq}`, createdAt: new Date(), ...data };
      rows.push(row);
      return row;
    },
    update: async ({ where, data }: any) => {
      const row = rows.find((r) => r.id === where.id);
      if (!row) throw new Error("not found");
      Object.assign(row, data);
      return row;
    },
  };
}

function setup() {
  const prisma: any = {
    order: makeTable("order"),
    orderItem: makeTable("item"),
    productCost: makeTable("cost"),
    productVariant: makeTable("variant"),
    courierShipment: makeTable("shipment"),
    reconciliationLine: makeTable("recon"),
    paymentVerification: makeTable("pv"),
  };
  const svc = new OrderProfitService(prisma);
  return { prisma, svc };
}

const PLACED = new Date("2026-09-15T10:00:00Z");

function seedOrder(prisma: any, over: any = {}) {
  const row = {
    id: "ord-1", organizationId: "org-1", externalId: "ext-1", externalNumber: "1001",
    status: "completed", isPractice: false, totalMinor: 100000n, discountMinor: 0n,
    shippingMinor: 6000n, placedAt: PLACED, createdAt: PLACED, ...over,
  };
  prisma.order.rows.push(row);
  return row;
}

function seedItem(prisma: any, over: any = {}) {
  const row = {
    id: `it-${prisma.orderItem.rows.length + 1}`, orderId: "ord-1", productId: "p-1",
    sku: null, name: "Panjabi", quantity: 1, priceMinor: 100000n, totalMinor: 100000n,
    isGift: false, ...over,
  };
  prisma.orderItem.rows.push(row);
  return row;
}

function seedCost(prisma: any, over: any = {}) {
  const row = {
    id: `c-${prisma.productCost.rows.length + 1}`, organizationId: "org-1",
    productId: "p-1", variantId: null, costMinor: 40000n,
    effectiveFrom: new Date("2026-09-01T00:00:00Z"), ...over,
  };
  prisma.productCost.rows.push(row);
  return row;
}

// ------------------------------------------------------------------

describe("ON7 ProductCost as-of rule", () => {
  it("latest cost at-or-before placedAt wins over older and newer rows", async () => {
    const { prisma, svc } = setup();
    seedOrder(prisma);
    seedItem(prisma);
    seedCost(prisma, { costMinor: 30000n, effectiveFrom: new Date("2026-08-01T00:00:00Z") });
    seedCost(prisma, { costMinor: 45000n, effectiveFrom: new Date("2026-09-10T00:00:00Z") }); // latest ≤ placedAt
    seedCost(prisma, { costMinor: 99000n, effectiveFrom: new Date("2026-10-01T00:00:00Z") }); // after — must NOT win
    const out: any = await svc.getOrderProfit("org-1", "ord-1");
    expect(out.productCostMinor).toBe("45000");
    expect(out.grossMarginMinor).toBe("55000"); // 100000 − 45000
  });

  it("no row at-or-before placedAt → the EARLIEST cost after placedAt is used", async () => {
    const { prisma, svc } = setup();
    seedOrder(prisma);
    seedItem(prisma);
    seedCost(prisma, { costMinor: 52000n, effectiveFrom: new Date("2026-10-05T00:00:00Z") });
    seedCost(prisma, { costMinor: 48000n, effectiveFrom: new Date("2026-09-20T00:00:00Z") }); // earliest after
    const out: any = await svc.getOrderProfit("org-1", "ord-1");
    expect(out.productCostMinor).toBe("48000");
  });

  it("variant-specific rows beat product-level rows (variant resolved by SKU)", async () => {
    const { prisma, svc } = setup();
    seedOrder(prisma);
    prisma.productVariant.rows.push({ id: "v-1", productId: "p-1", sku: "PN-XL", name: "XL" });
    seedItem(prisma, { sku: "PN-XL" });
    seedCost(prisma, { costMinor: 40000n, variantId: null }); // product-level
    seedCost(prisma, { costMinor: 61000n, variantId: "v-1" }); // variant-specific wins
    const out: any = await svc.getOrderProfit("org-1", "ord-1");
    expect(out.productCostMinor).toBe("61000");
  });

  it("no cost rows at all → line uncosted and productCostMinor is null when nothing is costed", async () => {
    const { prisma, svc } = setup();
    seedOrder(prisma);
    seedItem(prisma);
    const out: any = await svc.getOrderProfit("org-1", "ord-1");
    expect(out.productCostMinor).toBeNull();
    expect(out.grossMarginMinor).toBeNull();
    expect(out.costedLines).toBe(0);
    expect(out.uncostedLines).toHaveLength(1);
    expect(out.uncostedRevenueMinor).toBe("100000");
  });

  it("gift line cost IS counted (free gift, real cost)", async () => {
    const { prisma, svc } = setup();
    seedOrder(prisma, { totalMinor: 100000n });
    seedItem(prisma);
    seedItem(prisma, { productId: "p-gift", name: "Free Mug", priceMinor: 0n, totalMinor: 0n, isGift: true });
    seedCost(prisma, { costMinor: 40000n }); // p-1
    seedCost(prisma, { productId: "p-gift", costMinor: 7000n }); // the gift's own cost
    const out: any = await svc.getOrderProfit("org-1", "ord-1");
    expect(out.productCostMinor).toBe("47000"); // 40000 + 7000 gift cost
    expect(out.costedLines).toBe(2);
  });
});

// ------------------------------------------------------------------

describe("ON7 delivery actual", () => {
  function seedShipment(prisma: any, id: string) {
    prisma.courierShipment.rows.push({
      id, organizationId: "org-1", orderId: "ord-1", provider: "steadfast", status: "delivered",
    });
  }
  function seedRecon(prisma: any, shipmentId: string, charge: bigint, over: any = {}) {
    prisma.reconciliationLine.rows.push({
      id: `r-${prisma.reconciliationLine.rows.length + 1}`, organizationId: "org-1",
      matchedShipmentId: shipmentId, sheetChargeMinor: charge, outcome: "matched",
      createdAt: new Date("2026-09-20T00:00:00Z"), ...over,
    });
  }

  it("every shipment covered → deliveryActual is the sum and netMargin is present", async () => {
    const { prisma, svc } = setup();
    seedOrder(prisma);
    seedItem(prisma);
    seedCost(prisma, { costMinor: 40000n });
    seedShipment(prisma, "s-1");
    seedShipment(prisma, "s-2");
    seedRecon(prisma, "s-1", 5500n);
    seedRecon(prisma, "s-2", 6500n);
    const out: any = await svc.getOrderProfit("org-1", "ord-1");
    expect(out.deliveryActualMinor).toBe("12000");
    expect(out.deliveryActualCoverage).toEqual({ shipments: 2, withCharge: 2 });
    expect(out.netMarginMinor).toBe("48000"); // (100000 − 40000) − 12000
  });

  it("partial coverage → deliveryActual null, netMargin null, coverage counts shown", async () => {
    const { prisma, svc } = setup();
    seedOrder(prisma);
    seedItem(prisma);
    seedCost(prisma, { costMinor: 40000n });
    seedShipment(prisma, "s-1");
    seedShipment(prisma, "s-2");
    seedRecon(prisma, "s-1", 5500n); // s-2 has NO sheet line
    const out: any = await svc.getOrderProfit("org-1", "ord-1");
    expect(out.deliveryActualMinor).toBeNull();
    expect(out.netMarginMinor).toBeNull();
    expect(out.deliveryActualCoverage).toEqual({ shipments: 2, withCharge: 1 });
    expect(out.grossMarginMinor).toBe("60000"); // gross still known
  });

  it("zero shipments → deliveryActual null with 0/0 coverage", async () => {
    const { prisma, svc } = setup();
    seedOrder(prisma);
    seedItem(prisma);
    seedCost(prisma, { costMinor: 40000n });
    const out: any = await svc.getOrderProfit("org-1", "ord-1");
    expect(out.deliveryActualMinor).toBeNull();
    expect(out.deliveryActualCoverage).toEqual({ shipments: 0, withCharge: 0 });
    expect(out.netMarginMinor).toBeNull();
  });
});

// ------------------------------------------------------------------

describe("ON7 sold-bucket predicate (via the profit report)", () => {
  const RANGE = { from: "2026-09-01", to: "2026-09-30" };
  function reportSetup() {
    const ctx = setup();
    seedCost(ctx.prisma, { costMinor: 40000n });
    return ctx;
  }
  function addOrder(ctx: any, id: string, status: string, shipmentStatus?: string) {
    ctx.prisma.order.rows.push({
      id, organizationId: "org-1", externalId: id, externalNumber: id, status,
      isPractice: false, totalMinor: 100000n, discountMinor: 0n, shippingMinor: 0n,
      placedAt: PLACED, createdAt: PLACED,
    });
    ctx.prisma.orderItem.rows.push({
      id: `it-${id}`, orderId: id, productId: "p-1", sku: null, name: "Panjabi",
      quantity: 1, priceMinor: 100000n, totalMinor: 100000n, isGift: false,
    });
    if (shipmentStatus) {
      ctx.prisma.courierShipment.rows.push({
        id: `s-${id}`, organizationId: "org-1", orderId: id, provider: "steadfast", status: shipmentStatus,
      });
    }
  }

  it("processing alone is NOT sold; completed IS sold", async () => {
    const ctx = reportSetup();
    addOrder(ctx, "o-proc", "processing");
    addOrder(ctx, "o-comp", "completed");
    const report: any = await ctx.svc.getProfitReport("org-1", RANGE);
    expect(report.totals.orders).toBe(1);
    expect(report.totals.revenueMinor).toBe("100000");
  });

  it("processing + delivered shipment IS sold", async () => {
    const ctx = reportSetup();
    addOrder(ctx, "o-proc", "processing", "delivered");
    const report: any = await ctx.svc.getProfitReport("org-1", RANGE);
    expect(report.totals.orders).toBe(1);
  });

  it("cancelled + delivered shipment is NOT sold (dead status wins)", async () => {
    const ctx = reportSetup();
    addOrder(ctx, "o-cx", "cancelled", "delivered");
    const report: any = await ctx.svc.getProfitReport("org-1", RANGE);
    expect(report.totals.orders).toBe(0);
    expect(report.totals.revenueMinor).toBe("0");
  });
});

// ------------------------------------------------------------------

describe("ON7 profit report", () => {
  const RANGE = { from: "2026-09-01", to: "2026-09-30" };
  function soldOrder(ctx: any, id: string, productId: string, name: string, total: bigint) {
    ctx.prisma.order.rows.push({
      id, organizationId: "org-1", externalId: id, externalNumber: id, status: "completed",
      isPractice: false, totalMinor: total, discountMinor: 0n, shippingMinor: 0n,
      placedAt: PLACED, createdAt: PLACED,
    });
    ctx.prisma.orderItem.rows.push({
      id: `it-${id}`, orderId: id, productId, sku: null, name,
      quantity: 1, priceMinor: total, totalMinor: total, isGift: false,
    });
  }

  it("totals + per-product margins sorted ascending with null margins LAST", async () => {
    const ctx = setup();
    // p-low: margin 10000; p-high: margin 80000; p-none: NO cost rows → null margin.
    seedCost(ctx.prisma, { productId: "p-low", costMinor: 90000n });
    seedCost(ctx.prisma, { productId: "p-high", costMinor: 20000n });
    soldOrder(ctx, "o-1", "p-high", "High", 100000n);
    soldOrder(ctx, "o-2", "p-low", "Low", 100000n);
    soldOrder(ctx, "o-3", "p-none", "NoCost", 50000n);
    const report: any = await ctx.svc.getProfitReport("org-1", RANGE);
    expect(report.totals.orders).toBe(3);
    expect(report.totals.revenueMinor).toBe("250000");
    expect(report.totals.productCostMinor).toBe("110000"); // 90000 + 20000
    expect(report.totals.uncostedOrders).toBe(1);
    // Gross margin basis: costed orders' revenue (200000) − product cost (110000).
    expect(report.totals.grossMarginMinor).toBe("90000");
    expect(report.perProduct.map((p: any) => p.name)).toEqual(["Low", "High", "NoCost"]);
    expect(report.perProduct[0].marginMinor).toBe("10000");
    expect(report.perProduct[1].marginMinor).toBe("80000");
    expect(report.perProduct[2].marginMinor).toBeNull();
    expect(report.perProduct[2].costMinor).toBeNull();
    expect(report.truncated).toBe(false);
  });

  it("per-product list is capped at 100 with the truncated flag set", async () => {
    const ctx = setup();
    for (let i = 0; i < 105; i++) {
      soldOrder(ctx, `o-${i}`, `p-${i}`, `Prod ${i}`, 1000n);
    }
    const report: any = await ctx.svc.getProfitReport("org-1", RANGE);
    expect(report.totals.orders).toBe(105);
    expect(report.perProduct).toHaveLength(100);
    expect(report.truncated).toBe(true);
    expect(report.perProductTruncated).toBe(true);
  });
});
