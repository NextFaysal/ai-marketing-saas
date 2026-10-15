import { InventoryIntelligenceService } from "./inventory-intelligence.service";
import { PurchasingService } from "./purchasing.service";
import { PurchasingController } from "./purchasing.controller";
import { InventoryService } from "../inventory/inventory.service";

/**
 * EC33 — Inventory Intelligence specs.
 *
 * In-memory fake Prisma in the same makeTable style as the EC20
 * purchasing specs. Time is PINNED for the velocity / dead-stock
 * suites via the services' nowOverride parameter, so window
 * boundaries are exact to the millisecond.
 */
function matches(row: any, where: any): boolean {
  return Object.entries(where ?? {}).every(([k, v]: [string, any]) => {
    if (v === undefined) return true;
    if (v !== null && typeof v === "object" && !(v instanceof Date)) {
      if ("in" in v && !v.in.includes(row[k])) return false;
      if ("notIn" in v && v.notIn.includes(row[k])) return false;
      if ("gte" in v && !(row[k] != null && new Date(row[k]).getTime() >= new Date(v.gte).getTime())) return false;
      if ("lt" in v && !(row[k] != null && new Date(row[k]).getTime() < new Date(v.lt).getTime())) return false;
      return true;
    }
    if (v === null) return row[k] === null || row[k] === undefined;
    return row[k] === v;
  });
}

function makeTable(name: string) {
  const rows: any[] = [];
  let seq = 0;
  return {
    rows,
    findFirst: async ({ where }: any) => rows.find((r) => matches(r, where)) ?? null,
    findUnique: async ({ where }: any) => rows.find((r) => r.id === where.id) ?? null,
    findMany: async ({ where, take, skip, orderBy }: any = {}) => {
      let f = rows.filter((r) => matches(r, where ?? {}));
      if (orderBy?.createdAt === "desc") f = [...f].sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
      if (orderBy?.createdAt === "asc") f = [...f].sort((a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime());
      if (skip) f = f.slice(skip);
      if (take) f = f.slice(0, take);
      return f;
    },
    count: async ({ where }: any = {}) => rows.filter((r) => matches(r, where ?? {})).length,
    create: async ({ data }: any) => {
      const row = { id: `${name}-${++seq}`, createdAt: new Date(Date.now() + seq * 10), ...data };
      rows.push(row);
      return row;
    },
    update: async ({ where, data }: any) => {
      const row = rows.find((r) => r.id === where.id);
      if (!row) throw new Error(`row not found in ${name}: ${where.id}`);
      Object.assign(row, data);
      return row;
    },
    deleteMany: async ({ where }: any) => {
      for (let i = rows.length - 1; i >= 0; i--) if (matches(rows[i], where)) rows.splice(i, 1);
      return { count: 0 };
    },
  };
}

function fakePrisma() {
  return {
    product: makeTable("product"), productVariant: makeTable("variant"), productCost: makeTable("cost"),
    order: makeTable("order"), orderItem: makeTable("item"), courierShipment: makeTable("shipment"),
    inventorySetting: makeTable("invsetting"),
    supplier: makeTable("supplier"), purchaseOrder: makeTable("po"), purchaseOrderItem: makeTable("poi"),
    stockMovement: makeTable("movement"), membership: makeTable("membership"),
    agentNotification: makeTable("notif"), auditLog: makeTable("audit"),
  };
}

function fakeAudit(prisma: any) {
  return {
    log: jest.fn(async (input: any) => {
      await prisma.auditLog.create({
        data: {
          organizationId: input.organizationId ?? null,
          userId: input.userId ?? null,
          action: input.action, entityType: input.entityType,
          entityId: input.entityId ?? null, metadata: input.metadata ?? null,
        },
      });
    }),
  } as any;
}

function setup() {
  const prisma: any = fakePrisma();
  const audit = fakeAudit(prisma);
  const inventory = new InventoryService(prisma as any, audit);
  const intelligence = new InventoryIntelligenceService(prisma as any, audit, inventory);
  const purchasing = new PurchasingService(prisma as any, audit, inventory);
  return { prisma, audit, inventory, intelligence, purchasing };
}

const NOW = new Date("2026-10-13T12:00:00.000Z");
const DAY = 86400000;
const daysBefore = (base: Date, n: number, extraMs = 0) => new Date(base.getTime() - n * DAY + extraMs);

async function seedProduct(prisma: any, over: Record<string, unknown> = {}) {
  return prisma.product.create({
    data: {
      organizationId: "org-1", name: "Product", sku: null, status: "ACTIVE",
      priceMinor: 100000n, stockQuantity: 0, lowStockThreshold: null, ...over,
    },
  });
}

let orderSeq = 0;
async function seedSale(
  prisma: any,
  opts: {
    productId: string; qty: number; date: Date;
    sku?: string | null; status?: string; shipmentStatus?: string;
  },
) {
  const id = `order-${++orderSeq}`;
  const order = await prisma.order.create({
    data: {
      id, organizationId: "org-1", externalId: id,
      status: opts.status ?? "completed",
      placedAt: opts.date, createdAt: opts.date,
    },
  });
  await prisma.orderItem.create({
    data: {
      orderId: order.id, productId: opts.productId, name: "line",
      sku: opts.sku ?? null, quantity: opts.qty,
      priceMinor: 1000n, totalMinor: 1000n,
    },
  });
  if (opts.shipmentStatus) {
    await prisma.courierShipment.create({
      data: {
        organizationId: "org-1", orderId: order.id, provider: "steadfast",
        invoice: id, status: opts.shipmentStatus,
        recipientName: "Buyer", recipientPhone: "01700000000", recipientAddress: "Dhaka",
      },
    });
  }
  return order;
}

describe("EC33 settings", () => {
  it("defaults to leadTimeDays 14 when no row exists", async () => {
    const { intelligence } = setup();
    const out = await intelligence.getSettings("org-1");
    expect(out.leadTimeDays).toBe(14);
    expect(out.organizationId).toBe("org-1");
  });

  it("update upserts (one row), audits inventory_settings.updated", async () => {
    const { prisma, intelligence } = setup();
    const first = await intelligence.updateSettings("org-1", "owner-1", { leadTimeDays: 21 });
    expect(first.leadTimeDays).toBe(21);
    const second = await intelligence.updateSettings("org-1", "owner-1", { leadTimeDays: 7 });
    expect(second.leadTimeDays).toBe(7);
    expect(prisma.inventorySetting.rows).toHaveLength(1);
    expect((await intelligence.getSettings("org-1")).leadTimeDays).toBe(7);
    const audits = prisma.auditLog.rows.filter((a: any) => a.action === "inventory_settings.updated");
    expect(audits).toHaveLength(2);
    expect(audits[0].metadata).toEqual({ leadTimeDays: 21 });
    expect(audits[0].entityType).toBe("InventorySetting");
  });

  it("rejects 0, 181, fractional and non-integer lead times with a Bengali 400 and writes nothing", async () => {
    const { prisma, intelligence } = setup();
    for (const bad of [0, 181, 2.5, "14", null, undefined]) {
      await expect(intelligence.updateSettings("org-1", "owner-1", { leadTimeDays: bad } as any))
        .rejects.toThrow(/লিড টাইম \(leadTimeDays\)/);
    }
    expect(prisma.inventorySetting.rows).toHaveLength(0);
  });
});

describe("EC33 velocity", () => {
  async function velocityFixture() {
    const ctx = setup();
    const { prisma } = ctx;
    // A: 60 units 5d ago + 30 units 45d ago (both completed).
    const a = await seedProduct(prisma, { name: "A", sku: "A-1", stockQuantity: 90 });
    await seedSale(prisma, { productId: a.id, sku: "A-1", qty: 60, date: daysBefore(NOW, 5) });
    await seedSale(prisma, { productId: a.id, sku: "A-1", qty: 30, date: daysBefore(NOW, 45) });
    // Noise that must NOT count: cancelled, and processing w/o delivery.
    await seedSale(prisma, { productId: a.id, sku: "A-1", qty: 100, status: "cancelled", date: daysBefore(NOW, 5) });
    await seedSale(prisma, { productId: a.id, sku: "A-1", qty: 50, status: "processing", date: daysBefore(NOW, 5) });
    // S: sold only via delivered / partial_delivered shipments.
    const s = await seedProduct(prisma, { name: "S", sku: "S-1", stockQuantity: 20 });
    await seedSale(prisma, { productId: s.id, sku: "S-1", qty: 10, status: "processing", shipmentStatus: "delivered", date: daysBefore(NOW, 10) });
    await seedSale(prisma, { productId: s.id, sku: "S-1", qty: 10, status: "processing", shipmentStatus: "partial_delivered", date: daysBefore(NOW, 10) });
    // Refunded is dead even with a delivered shipment.
    await seedSale(prisma, { productId: s.id, sku: "S-1", qty: 99, status: "refunded", shipmentStatus: "delivered", date: daysBefore(NOW, 10) });
    // B: variant-tracked. X sells via its sku; an unknown-sku line is
    // product-level and belongs to NEITHER variant row.
    const b = await seedProduct(prisma, { name: "B", sku: "B-1", stockQuantity: 999 });
    const vx = await prisma.productVariant.create({ data: { productId: b.id, name: "X", sku: "B-X", stockQuantity: 20 } });
    const vy = await prisma.productVariant.create({ data: { productId: b.id, name: "Y", sku: "B-Y", stockQuantity: 10 } });
    await seedSale(prisma, { productId: b.id, sku: "B-X", qty: 30, date: daysBefore(NOW, 5) });
    await seedSale(prisma, { productId: b.id, sku: "B-UNKNOWN", qty: 7, date: daysBefore(NOW, 5) });
    // Z: zero stock but selling.
    const z = await seedProduct(prisma, { name: "Z", sku: "Z-1", stockQuantity: 0 });
    await seedSale(prisma, { productId: z.id, sku: "Z-1", qty: 30, date: daysBefore(NOW, 5) });
    // C: no sales at all.
    const c = await seedProduct(prisma, { name: "C", sku: "C-1", stockQuantity: 12 });
    return { ...ctx, a, s, b, vx, vy, z, c };
  }

  it("computes exact units/day across two windows from the same fixtures", async () => {
    const { intelligence, a } = await velocityFixture();
    const w30 = await intelligence.velocity("org-1", 30, NOW);
    expect(w30.windowDays).toBe(30);
    expect(w30.generatedAt).toBe(NOW.toISOString());
    const rowA30 = w30.items.find((i: any) => i.productId === a.id)!;
    expect(rowA30).toMatchObject({ unitsSold: 60, dailyVelocity: 2, currentStock: 90, daysOfStockLeft: 45 });
    expect(rowA30.projectedStockoutDate).toBe(new Date(NOW.getTime() + 45 * DAY).toISOString());

    const w60 = await intelligence.velocity("org-1", 60, NOW);
    const rowA60 = w60.items.find((i: any) => i.productId === a.id)!;
    expect(rowA60).toMatchObject({ unitsSold: 90, dailyVelocity: 1.5, daysOfStockLeft: 60 });
    expect(rowA60.projectedStockoutDate).toBe(new Date(NOW.getTime() + 60 * DAY).toISOString());
  });

  it("counts shipment-proven sales, never dead or undelivered orders", async () => {
    const { intelligence, s } = await velocityFixture();
    const w30 = await intelligence.velocity("org-1", 30, NOW);
    const rowS = w30.items.find((i: any) => i.productId === s.id)!;
    expect(rowS.unitsSold).toBe(20); // 10 delivered + 10 partial; refunded 99 excluded
  });

  it("maps variant sales by sku within the product; product-level lines hit no variant", async () => {
    const { intelligence, b, vx, vy } = await velocityFixture();
    const w30 = await intelligence.velocity("org-1", 30, NOW);
    const rowsB = w30.items.filter((i: any) => i.productId === b.id);
    expect(rowsB).toHaveLength(2); // variants only — no product row
    const rowX = rowsB.find((i: any) => i.variantId === vx.id)!;
    expect(rowX).toMatchObject({ unitsSold: 30, dailyVelocity: 1, daysOfStockLeft: 20, sku: "B-X" });
    const rowY = rowsB.find((i: any) => i.variantId === vy.id)!;
    expect(rowY.unitsSold).toBe(0);
  });

  it("zero velocity => daysOfStockLeft and projectedStockoutDate are null", async () => {
    const { intelligence, c } = await velocityFixture();
    const w30 = await intelligence.velocity("org-1", 30, NOW);
    const rowC = w30.items.find((i: any) => i.productId === c.id)!;
    expect(rowC).toMatchObject({ unitsSold: 0, dailyVelocity: 0, daysOfStockLeft: null, projectedStockoutDate: null });
  });

  it("stock 0 with velocity > 0 => already stocked out (0 days, stockout = now)", async () => {
    const { intelligence, z } = await velocityFixture();
    const w30 = await intelligence.velocity("org-1", 30, NOW);
    const rowZ = w30.items.find((i: any) => i.productId === z.id)!;
    expect(rowZ).toMatchObject({ unitsSold: 30, dailyVelocity: 1, currentStock: 0, daysOfStockLeft: 0 });
    expect(rowZ.projectedStockoutDate).toBe(NOW.toISOString());
  });

  it("rejects a window outside {30, 60, 90}", async () => {
    const { intelligence } = setup();
    await expect(intelligence.velocity("org-1", 45, NOW)).rejects.toThrow(/৩০, ৬০ বা ৯০/);
    await expect(intelligence.velocity("org-1", 7, NOW)).rejects.toThrow(/৩০, ৬০ বা ৯০/);
  });
});

describe("EC33 velocity reorder suggestions", () => {
  it("applies ceil(dailyVelocity × leadTimeDays) − stock, honours settings, excludes zero-velocity with a count", async () => {
    const { prisma, intelligence } = setup();
    const realNow = new Date();
    // P1: 10 units in 30d => daily 1/3; default lead 14 => ceil(4.66) = 5; stock 1 => 4.
    const p1 = await seedProduct(prisma, { name: "P1", sku: "P1", stockQuantity: 1 });
    await seedSale(prisma, { productId: p1.id, sku: "P1", qty: 10, date: daysBefore(realNow, 5) });
    // P2: daily 1, stock 100 — already covers the lead time: excluded, NOT counted.
    const p2 = await seedProduct(prisma, { name: "P2", sku: "P2", stockQuantity: 100 });
    await seedSale(prisma, { productId: p2.id, sku: "P2", qty: 30, date: daysBefore(realNow, 5) });
    // P3: no sales at all — excluded and counted.
    await seedProduct(prisma, { name: "P3", sku: "P3", stockQuantity: 5 });

    const out = await intelligence.reorderSuggestionsV2("org-1", "velocity");
    expect(out.mode).toBe("velocity");
    expect(out.noRecentSalesCount).toBe(1);
    expect(out.items).toHaveLength(1);
    expect(out.items[0]).toMatchObject({
      productId: p1.id, productName: "P1", variantId: null, sku: "P1",
      currentStock: 1, suggestedQty: 4, basis: "velocity",
      unitsSold: 10, windowDays: 30, leadTimeDays: 14,
      lastSupplier: null, lastUnitCostMinor: null,
    });
    expect(out.items[0].dailyVelocity).toBeCloseTo(10 / 30, 10);

    // Lead time from settings drives the formula: ceil(10/30 × 10) = 4; 4 − 1 = 3.
    await intelligence.updateSettings("org-1", "owner-1", { leadTimeDays: 10 });
    const out2 = await intelligence.reorderSuggestionsV2("org-1", "velocity");
    expect(out2.items[0]).toMatchObject({ suggestedQty: 3, leadTimeDays: 10 });
  });
});

describe("EC33 dead stock", () => {
  async function deadFixture() {
    const ctx = setup();
    const { prisma } = ctx;
    const d1 = await seedProduct(prisma, { name: "Old", sku: "D1", stockQuantity: 10 });
    await prisma.productCost.create({ data: { productId: d1.id, variantId: null, costMinor: 200n, effectiveFrom: daysBefore(NOW, 200) } });
    await seedSale(prisma, { productId: d1.id, sku: "D1", qty: 3, date: daysBefore(NOW, 100) });

    const d2 = await seedProduct(prisma, { name: "Boundary", sku: "D2", stockQuantity: 5 });
    await seedSale(prisma, { productId: d2.id, sku: "D2", qty: 1, date: daysBefore(NOW, 90) }); // exactly at the boundary

    const d3 = await seedProduct(prisma, { name: "JustOutside", sku: "D3", stockQuantity: 5 });
    await prisma.productCost.create({ data: { productId: d3.id, variantId: null, costMinor: 100n, effectiveFrom: daysBefore(NOW, 200) } });
    await seedSale(prisma, { productId: d3.id, sku: "D3", qty: 1, date: daysBefore(NOW, 90, -1) }); // 1ms outside

    const d4 = await seedProduct(prisma, { name: "Never", sku: "D4", stockQuantity: 8 }); // never sold, no cost

    const d5 = await seedProduct(prisma, { name: "Recent", sku: "D5", stockQuantity: 5 });
    await seedSale(prisma, { productId: d5.id, sku: "D5", qty: 1, date: daysBefore(NOW, 10) });

    await seedProduct(prisma, { name: "ZeroStock", sku: "D6", stockQuantity: 0 }); // no stock held — not dead stock

    // Variant product: a recent PRODUCT-level sale rescues neither variant row.
    const dv = await seedProduct(prisma, { name: "DV", sku: "DV", stockQuantity: 999 });
    const va = await prisma.productVariant.create({ data: { productId: dv.id, name: "A", sku: "DV-A", stockQuantity: 6 } });
    const vb = await prisma.productVariant.create({ data: { productId: dv.id, name: "B", sku: "DV-B", stockQuantity: 6 } });
    await prisma.productCost.create({ data: { productId: dv.id, variantId: vb.id, costMinor: 50n, effectiveFrom: daysBefore(NOW, 200) } });
    await seedSale(prisma, { productId: dv.id, sku: "DV-A", qty: 2, date: daysBefore(NOW, 100) });
    await seedSale(prisma, { productId: dv.id, sku: "DV-OTHER", qty: 1, date: daysBefore(NOW, 10) });
    return { ...ctx, d1, d2, d3, d4, d5, dv, va, vb };
  }

  it("boundary: a sale exactly at now − days is INSIDE the window (not dead); 1ms older is dead", async () => {
    const { intelligence, d2, d3 } = await deadFixture();
    const out = await intelligence.deadStock("org-1", 90, NOW);
    const ids = out.items.map((i: any) => i.productId);
    expect(ids).not.toContain(d2.id);
    expect(ids).toContain(d3.id);
    const rowD3 = out.items.find((i: any) => i.productId === d3.id)!;
    expect(rowD3.lastSaleAt).toBe(daysBefore(NOW, 90, -1).toISOString());
  });

  it("collects old / never-sold rows with honest lastSaleAt, stuck values, sorting and unvalued count", async () => {
    const { intelligence, d1, d4, dv, va, vb } = await deadFixture();
    const out = await intelligence.deadStock("org-1", 90, NOW);
    expect(out.days).toBe(90);
    // Dead: D1 (2000), D3 (500), DV-B (300), DV-A (null), D4 (null).
    expect(out.items).toHaveLength(5);
    expect(out.items[0]).toMatchObject({ productId: d1.id, currentStock: 10, unitCostMinor: "200", stuckValueMinor: "2000" });
    expect(out.items[0].lastSaleAt).toBe(daysBefore(NOW, 100).toISOString());
    expect(out.items[1].stuckValueMinor).toBe("500");
    const rowB = out.items.find((i: any) => i.variantId === vb.id)!;
    expect(rowB).toMatchObject({ productId: dv.id, unitCostMinor: "50", stuckValueMinor: "300", lastSaleAt: null });
    const rowA = out.items.find((i: any) => i.variantId === va.id)!;
    expect(rowA.stuckValueMinor).toBeNull(); // its old sale does not invent a cost
    expect(rowA.lastSaleAt).toBe(daysBefore(NOW, 100).toISOString());
    const rowNever = out.items.find((i: any) => i.productId === d4.id)!;
    expect(rowNever).toMatchObject({ lastSaleAt: null, unitCostMinor: null, stuckValueMinor: null });
    // Nulls sort last.
    expect(out.items[out.items.length - 1].stuckValueMinor).toBeNull();
    expect(out.items[out.items.length - 2].stuckValueMinor).toBeNull();
    expect(out.unvaluedCount).toBe(2); // DV-A + Never
  });

  it("validates days in 1..365", async () => {
    const { intelligence } = setup();
    await expect(intelligence.deadStock("org-1", 0, NOW)).rejects.toThrow(/১ থেকে ৩৬৫/);
    await expect(intelligence.deadStock("org-1", 366, NOW)).rejects.toThrow(/১ থেকে ৩৬৫/);
    await expect(intelligence.deadStock("org-1", 1.5, NOW)).rejects.toThrow(/১ থেকে ৩৬৫/);
  });

  it("renders the same rows as CSV with proper escaping", async () => {
    const { prisma, intelligence } = setup();
    const p = await seedProduct(prisma, { name: "Shirt, Red", sku: "CSV-1", stockQuantity: 2 });
    await prisma.productCost.create({ data: { productId: p.id, variantId: null, costMinor: 300n, effectiveFrom: daysBefore(NOW, 10) } });
    const csv = await intelligence.deadStockCsv("org-1", 90);
    const lines = csv.split("\n");
    expect(lines[0]).toBe("product_id,product_name,variant_id,variant_name,sku,current_stock,last_sale_at,unit_cost_minor,stuck_value_minor");
    expect(csv).toContain('"Shirt, Red"');
    expect(csv).toContain("CSV-1,2,,300,600");
  });
});

describe("EC33 valuation", () => {
  it("sums latest costs, prefers variant cost over product cost, counts unvalued honestly", async () => {
    const { prisma, intelligence } = setup();
    // V1: two product-level costs — the LATEST (150) wins over 100.
    const v1 = await seedProduct(prisma, { name: "V1", sku: "V1", stockQuantity: 10 });
    await prisma.productCost.create({ data: { productId: v1.id, variantId: null, costMinor: 100n, effectiveFrom: new Date("2026-01-01T00:00:00Z"), createdAt: new Date("2026-01-01T00:00:00Z") } });
    await prisma.productCost.create({ data: { productId: v1.id, variantId: null, costMinor: 150n, effectiveFrom: new Date("2026-06-01T00:00:00Z"), createdAt: new Date("2026-06-01T00:00:00Z") } });
    // V2: variant-tracked. VV has its own cost 300 (preferred over the
    // product-level 100); VW has none and falls back to product-level.
    const v2 = await seedProduct(prisma, { name: "V2", sku: "V2", stockQuantity: 999 });
    await prisma.productCost.create({ data: { productId: v2.id, variantId: null, costMinor: 100n, effectiveFrom: new Date("2026-01-01T00:00:00Z"), createdAt: new Date("2026-01-01T00:00:00Z") } });
    const vv = await prisma.productVariant.create({ data: { productId: v2.id, name: "VV", sku: "V2-V", stockQuantity: 4 } });
    await prisma.productCost.create({ data: { productId: v2.id, variantId: vv.id, costMinor: 300n, effectiveFrom: new Date("2026-01-01T00:00:00Z"), createdAt: new Date("2026-01-01T00:00:00Z") } });
    const vw = await prisma.productVariant.create({ data: { productId: v2.id, name: "VW", sku: "V2-W", stockQuantity: 2 } });
    // V3: stocked but never costed — unvalued, contributes nothing.
    await seedProduct(prisma, { name: "V3", sku: "V3", stockQuantity: 7 });
    // V4: costed but zero stock — excluded from value AND coverage.
    const v4 = await seedProduct(prisma, { name: "V4", sku: "V4", stockQuantity: 0 });
    await prisma.productCost.create({ data: { productId: v4.id, variantId: null, costMinor: 500n, effectiveFrom: new Date("2026-01-01T00:00:00Z") } });

    const out = await intelligence.valuation("org-1");
    expect(out.currency).toBe("BDT");
    expect(out.totalValueMinor).toBe("2900"); // 10×150 + 4×300 + 2×100
    expect(out.valuedProducts).toBe(3);
    expect(out.unvaluedProducts).toBe(1);
    expect(out.items).toHaveLength(3);
    expect(out.items[0]).toMatchObject({ productId: v1.id, unitCostMinor: "150", valueMinor: "1500" });
    expect(out.items[1]).toMatchObject({ productId: v2.id, variantId: vv.id, unitCostMinor: "300", valueMinor: "1200" });
    expect(out.items[2]).toMatchObject({ productId: v2.id, variantId: vw.id, unitCostMinor: "100", valueMinor: "200" });
  });
});

describe("EC33 simple mode stays untouched", () => {
  it("PurchasingService.reorderSuggestions keeps its original shape (no mode field)", async () => {
    const { prisma, purchasing } = setup();
    await seedProduct(prisma, { name: "Low", sku: "LOW-1", stockQuantity: 3 });
    const out = await purchasing.reorderSuggestions("org-1");
    expect(Object.keys(out)).toEqual(["items"]);
    expect(out.items).toHaveLength(1);
    expect(out.items[0]).toMatchObject({ currentStock: 3, threshold: 5, suggestedQty: 7, variantId: null });
  });

  it("controller routes absent/simple to PurchasingService, velocity to intelligence, others 400", async () => {
    const purchasingStub: any = { reorderSuggestions: jest.fn(async () => ({ items: ["simple"] })) };
    const intelligenceStub: any = { reorderSuggestionsV2: jest.fn(async () => ({ mode: "velocity", items: [], noRecentSalesCount: 0 })) };
    const controller = new PurchasingController(purchasingStub, intelligenceStub);
    await expect(controller.reorderSuggestions("org-1")).resolves.toEqual({ items: ["simple"] });
    await expect(controller.reorderSuggestions("org-1", "simple")).resolves.toEqual({ items: ["simple"] });
    await expect(controller.reorderSuggestions("org-1", "velocity")).resolves.toEqual({ mode: "velocity", items: [], noRecentSalesCount: 0 });
    expect(purchasingStub.reorderSuggestions).toHaveBeenCalledTimes(2);
    expect(intelligenceStub.reorderSuggestionsV2).toHaveBeenCalledTimes(1);
    expect(() => controller.reorderSuggestions("org-1", "bogus")).toThrow(/simple বা velocity/);
  });
});
