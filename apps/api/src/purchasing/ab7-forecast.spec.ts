import { InventoryIntelligenceService } from "./inventory-intelligence.service";
import { InventoryService } from "../inventory/inventory.service";

/**
 * AB7 (AX20) — Forecasting v2 specs.
 *
 * Same in-memory fake-Prisma style as the EC33 inventory
 * intelligence specs; time is PINNED via nowOverride so the
 * 30/60/90-day windows and weekday buckets are exact.
 */
function matches(row: any, where: any): boolean {
  return Object.entries(where ?? {}).every(([k, v]: [string, any]) => {
    if (v === undefined) return true;
    if (v !== null && typeof v === "object" && !(v instanceof Date)) {
      if ("in" in v && !v.in.includes(row[k])) return false;
      if ("gte" in v && !(row[k] != null && new Date(row[k]).getTime() >= new Date(v.gte).getTime())) return false;
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
    findMany: async ({ where, take, orderBy }: any = {}) => {
      let f = rows.filter((r) => matches(r, where ?? {}));
      if (orderBy?.createdAt === "asc") f = [...f].sort((a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime());
      if (take) f = f.slice(0, take);
      return f;
    },
    create: async ({ data }: any) => {
      const row = { id: `${name}-${++seq}`, createdAt: new Date(Date.now() + seq * 10), ...data };
      rows.push(row);
      return row;
    },
    update: async ({ where, data }: any) => {
      const row = rows.find((r) => r.id === where.id);
      if (!row) throw new Error(`row not found in ${name}`);
      Object.assign(row, data);
      return row;
    },
  };
}

function setup() {
  const prisma: any = {
    product: makeTable("product"), productVariant: makeTable("variant"), productCost: makeTable("cost"),
    order: makeTable("order"), orderItem: makeTable("item"), courierShipment: makeTable("shipment"),
    inventorySetting: makeTable("invsetting"), stockMovement: makeTable("movement"),
    membership: makeTable("membership"), agentNotification: makeTable("notif"), auditLog: makeTable("audit"),
  };
  const audit: any = { log: jest.fn(async () => undefined) };
  const inventory = new InventoryService(prisma as any, audit);
  const intelligence = new InventoryIntelligenceService(prisma as any, audit, inventory);
  return { prisma, intelligence };
}

const NOW = new Date("2026-10-13T12:00:00.000Z"); // a Tuesday (UTC)
const DAY = 86400000;
const daysBefore = (n: number) => new Date(NOW.getTime() - n * DAY);

let orderSeq = 0;
async function seedSale(prisma: any, productId: string, qty: number, date: Date, sku?: string | null) {
  const id = `order-${++orderSeq}`;
  await prisma.order.create({
    data: { id, organizationId: "org-1", externalId: id, status: "completed", placedAt: date, createdAt: date },
  });
  await prisma.orderItem.create({
    data: { orderId: id, productId, name: "line", sku: sku ?? null, quantity: qty, priceMinor: 1000n, totalMinor: 1000n },
  });
}

async function seedProduct(prisma: any, over: Record<string, unknown> = {}) {
  return prisma.product.create({
    data: { organizationId: "org-1", name: "P", sku: null, status: "ACTIVE", priceMinor: 100000n, stockQuantity: 100, lowStockThreshold: null, ...over },
  });
}

describe("AB7 forecasting v2 — trend", () => {
  it("trendGrowthPct: last-30 vs prior-30, rounded to 1 decimal; v1 fields unchanged", async () => {
    const { prisma, intelligence } = setup();
    const p = await seedProduct(prisma, { name: "Trend", sku: "T-1", stockQuantity: 90 });
    await seedSale(prisma, p.id, 60, daysBefore(5), "T-1"); // last 30
    await seedSale(prisma, p.id, 30, daysBefore(45), "T-1"); // prior 30
    const out = await intelligence.velocity("org-1", 30, NOW);
    const row = out.items.find((i: any) => i.productId === p.id)!;
    // v1 untouched: 60 sold in 30d => velocity 2, 90/2 = 45 days.
    expect(row).toMatchObject({ unitsSold: 60, dailyVelocity: 2, daysOfStockLeft: 45 });
    // (2 − 1) / 1 × 100 = 100.0
    expect(row.trendGrowthPct).toBe(100);
    // Sparse history (2 distinct days) => no seasonal claim.
    expect(row.weekdayFactors).toEqual([1, 1, 1, 1, 1, 1, 1]);
    expect(row.demandBasis).toBe("velocity");
    // trendFactor clamps vel30/velPrior = 2 => projected = 2 × 2 × 1 = 4
    expect(row.projectedDailyDemand).toBe(4);
  });

  it("trendGrowthPct is NULL when prior window is zero — even when last-30 sold, and when both are zero", async () => {
    const { prisma, intelligence } = setup();
    const recent = await seedProduct(prisma, { name: "RecentOnly", sku: "R-1" });
    await seedSale(prisma, recent.id, 30, daysBefore(5), "R-1");
    const never = await seedProduct(prisma, { name: "Never", sku: "N-1" });
    const out = await intelligence.velocity("org-1", 30, NOW);
    const r = out.items.find((i: any) => i.productId === recent.id)!;
    expect(r.trendGrowthPct).toBeNull();
    // trendFactor falls back to 1 => projected = vel30 (1) × 1 × 1
    expect(r.projectedDailyDemand).toBe(1);
    const n = out.items.find((i: any) => i.productId === never.id)!;
    expect(n.trendGrowthPct).toBeNull();
  });

  it("declining trend: growth is negative and stockout v2 nulls when vel30 = 0 despite prior sales", async () => {
    const { prisma, intelligence } = setup();
    const p = await seedProduct(prisma, { name: "Fading", sku: "F-1" });
    await seedSale(prisma, p.id, 30, daysBefore(45), "F-1"); // prior only
    const out = await intelligence.velocity("org-1", 30, NOW);
    const row = out.items.find((i: any) => i.productId === p.id)!;
    expect(row.trendGrowthPct).toBe(-100);
    expect(row.projectedDailyDemand).toBe(0);
    expect(row.daysOfStockLeftV2).toBeNull();
    expect(row.projectedStockoutDateV2).toBeNull();
  });
});

describe("AB7 forecasting v2 — weekday factors + seasonal stockout", () => {
  async function weekdayFixture(stock: number) {
    const ctx = setup();
    const { prisma } = ctx;
    const p = await seedProduct(prisma, { name: "Weekly", sku: "W-1", stockQuantity: stock });
    // 42 consecutive days ending yesterday: Mondays sell 10,
    // every other weekday sells 1. 42 distinct sales days.
    for (let d = 1; d <= 42; d++) {
      const date = daysBefore(d);
      await seedSale(prisma, p.id, date.getDay() === 1 ? 10 : 1, date, "W-1");
    }
    return { ...ctx, p };
  }

  it("weekdayFactors are normalized (mean ≈ 1) with Monday dominant, basis trend_seasonal", async () => {
    const { intelligence, p } = await weekdayFixture(30);
    const out = await intelligence.velocity("org-1", 90, NOW);
    const row = out.items.find((i: any) => i.productId === p.id)!;
    expect(row.demandBasis).toBe("trend_seasonal");
    expect(row.weekdayFactors).toHaveLength(7);
    const mean = row.weekdayFactors.reduce((s: number, x: number) => s + x, 0) / 7;
    expect(mean).toBeCloseTo(1, 2);
    // Monday (index 1) carries 10× the daily volume of other days.
    expect(row.weekdayFactors[1]).toBeGreaterThan(4);
    for (let w = 0; w < 7; w++) {
      if (w !== 1) expect(row.weekdayFactors[w]).toBeLessThan(0.6);
    }
    // vel30 = 75/30 = 2.5, prior = 21/30 = 0.7 => growth 257.1,
    // trendFactor clamps 3.57… to 2; any 7 consecutive days
    // average the normalized factors to ~1 => projected ≈ 5.
    expect(row.trendGrowthPct).toBe(257.1);
    expect(row.projectedDailyDemand).toBe(5);
  });

  it("stockout v2 lands on the Monday spike — far earlier than the flat v1 projection", async () => {
    const { intelligence, p } = await weekdayFixture(30);
    const out = await intelligence.velocity("org-1", 90, NOW);
    const row = out.items.find((i: any) => i.productId === p.id)!;
    // v1 (90d flat): 96 units / 90d => stock 30 lasts 28.125 days.
    expect(row.daysOfStockLeft).toBeCloseTo(28.125, 6);
    // v2: ~2.2/day Wed–Sun, then Monday's ~21.8 unit day crosses
    // 30 cumulative on day 6 (Monday 2026-10-19).
    expect(row.daysOfStockLeftV2).toBe(6);
    expect(row.projectedStockoutDateV2).toBe("2026-10-19T12:00:00.000Z");
    expect(row.daysOfStockLeftV2).toBeLessThan(row.daysOfStockLeft ?? Infinity);
  });

  it("under 21 distinct sales days => all factors 1.0 and basis velocity, however concentrated", async () => {
    const { prisma, intelligence } = setup();
    const p = await seedProduct(prisma, { name: "Sparse", sku: "S-1" });
    // 10 Mondays only — a strong pattern on far too little history.
    for (let d = 1; d <= 70; d++) {
      const date = daysBefore(d);
      if (date.getDay() === 1) await seedSale(prisma, p.id, 10, date, "S-1");
    }
    const out = await intelligence.velocity("org-1", 90, NOW);
    const row = out.items.find((i: any) => i.productId === p.id)!;
    expect(row.weekdayFactors).toEqual([1, 1, 1, 1, 1, 1, 1]);
    expect(row.demandBasis).toBe("velocity");
  });
});

describe("AB7 forecasting v2 — zero / stocked-out / cap rules", () => {
  it("zero-velocity rows keep every projection null and demand 0", async () => {
    const { prisma, intelligence } = setup();
    const p = await seedProduct(prisma, { name: "Idle", sku: "I-1", stockQuantity: 12 });
    const out = await intelligence.velocity("org-1", 30, NOW);
    const row = out.items.find((i: any) => i.productId === p.id)!;
    expect(row).toMatchObject({
      dailyVelocity: 0, daysOfStockLeft: null, projectedStockoutDate: null,
      projectedDailyDemand: 0, daysOfStockLeftV2: null, projectedStockoutDateV2: null,
      demandBasis: "velocity",
    });
    expect(row.weekdayFactors).toEqual([1, 1, 1, 1, 1, 1, 1]);
  });

  it("stock <= 0 with vel30 > 0 => v2 mirrors v1's stocked-out rule (0 days, date = now)", async () => {
    const { prisma, intelligence } = setup();
    const p = await seedProduct(prisma, { name: "Out", sku: "O-1", stockQuantity: 0 });
    await seedSale(prisma, p.id, 30, daysBefore(5), "O-1");
    const out = await intelligence.velocity("org-1", 30, NOW);
    const row = out.items.find((i: any) => i.productId === p.id)!;
    expect(row.daysOfStockLeftV2).toBe(0);
    expect(row.projectedStockoutDateV2).toBe(NOW.toISOString());
  });

  it("stockout beyond the 365-day simulation cap => both v2 fields null", async () => {
    const { prisma, intelligence } = setup();
    const p = await seedProduct(prisma, { name: "Deep", sku: "D-1", stockQuantity: 100000 });
    await seedSale(prisma, p.id, 30, daysBefore(5), "D-1"); // vel30 = 1/day
    const out = await intelligence.velocity("org-1", 30, NOW);
    const row = out.items.find((i: any) => i.productId === p.id)!;
    expect(row.daysOfStockLeft).toBe(100000); // v1 still projects flat
    expect(row.daysOfStockLeftV2).toBeNull();
    expect(row.projectedStockoutDateV2).toBeNull();
  });
});
