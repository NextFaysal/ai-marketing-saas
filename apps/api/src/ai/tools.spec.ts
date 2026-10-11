import { ToolsService } from "./tools.service";
import { templateAnswer } from "./chat.service";

function matches(row: any, where: any): boolean {
  return Object.entries(where ?? {}).every(([k, v]) => {
    if (v === undefined) return true;
    if (v !== null && typeof v === "object" && !(v instanceof Date)) {
      if ("in" in (v as any)) return (v as any).in.includes(row[k]);
      if ("not" in (v as any)) return row[k] !== (v as any).not;
    }
    return row[k] === v;
  });
}
function table(rows: any[] = []) {
  return {
    rows,
    findMany: async ({ where }: any = {}) => rows.filter((r) => matches(r, where)),
    findFirst: async ({ where }: any) => rows.find((r) => matches(r, where)) ?? null,
    count: async ({ where }: any = {}) => rows.filter((r) => matches(r, where ?? {})).length,
  };
}
function fakePrisma(tables: Record<string, any[]>) {
  const out: any = {};
  for (const [name, rows] of Object.entries(tables)) out[name] = table(rows);
  return out;
}
/** Analytics stub keyed by the range start date, shaped like computeRange.
 *  Minor-unit fields are strings / BigInt, exactly as the real
 *  AnalyticsService returns them (regression lock for the live-found
 *  Infinity%/NaN% delta bug, M46). */
function analyticsStub(byFrom: Record<string, any>) {
  return {
    computeRange: async (_org: string, from: Date) => {
      const key = from.toISOString().slice(0, 10);
      const t = byFrom[key] ?? { orders: 0, revenueMinor: "0", adSpendMinor: "0", profitMinor: 0n };
      return {
        range: { from: key, to: key },
        totals: { orders: t.orders, revenueMinor: t.revenueMinor, adSpendMinor: t.adSpendMinor, averageOrderValueMinor: 0, platformConversions: 0 },
        kpis: { mer: null, platformRoas: null, cpaMinor: null },
        profit: { contributionProfitMinor: t.profitMinor, contributionMarginPercent: null, cogsCoverage: { percent: 100 } },
        platforms: [], mixedCurrencies: false,
      };
    },
  } as any;
}
const noAnalytics = analyticsStub({});
const tools = (prisma: any, analytics: any = noAnalytics) => new ToolsService(prisma, analytics, {} as any);

describe("get_customer_segments (M46)", () => {
  it("aggregates RFM segments with counts and revenue shares summing to ~100%", async () => {
    const prisma = fakePrisma({
      customer: [
        { id: "c1", organizationId: "org-1", firstName: "Asha", lastName: null, email: null, phone: null, mergedIntoId: null },
        { id: "c2", organizationId: "org-1", firstName: "Babul", lastName: null, email: null, phone: null, mergedIntoId: null },
        { id: "c3", organizationId: "org-1", firstName: "NoOrders", lastName: null, email: null, phone: null, mergedIntoId: null },
      ],
      order: [
        { organizationId: "org-1", customerId: "c1", status: "completed", totalMinor: 300000n, placedAt: new Date() },
        { organizationId: "org-1", customerId: "c1", status: "completed", totalMinor: 100000n, placedAt: new Date() },
        { organizationId: "org-1", customerId: "c2", status: "completed", totalMinor: 100000n, placedAt: new Date() },
        { organizationId: "org-1", customerId: "c2", status: "cancelled", totalMinor: 999999n, placedAt: new Date() },
      ],
    });
    const r: any = await tools(prisma).execute("org-1", { tool: "get_customer_segments", args: {} });
    expect(r.totalCustomers).toBe(2); // c3 has no orders; cancelled order excluded
    const share = r.segments.reduce((s: number, x: any) => s + x.revenueSharePercent, 0);
    expect(share).toBeGreaterThan(99.9); expect(share).toBeLessThanOrEqual(100.1);
    expect(r.segments.reduce((s: number, x: any) => s + x.customers, 0)).toBe(2);
  });
  it("says plainly when there are no customers with orders", async () => {
    const r: any = await tools(fakePrisma({ customer: [], order: [] })).execute("org-1", { tool: "get_customer_segments", args: {} });
    expect(r.totalCustomers).toBe(0);
    expect(r.note).toContain("No customers with orders");
  });
});

describe("get_inventory_health (M46)", () => {
  it("buckets tracked stock and counts untracked products", async () => {
    const prisma = fakePrisma({
      product: [
        { organizationId: "org-1", status: "ACTIVE", name: "Gone", sku: "G1", stockQuantity: 0 },
        { organizationId: "org-1", status: "ACTIVE", name: "Low", sku: "L1", stockQuantity: 3 },
        { organizationId: "org-1", status: "ACTIVE", name: "Bulk", sku: "B1", stockQuantity: 150 },
        { organizationId: "org-1", status: "ACTIVE", name: "Untracked", sku: "U1", stockQuantity: null },
      ],
    });
    const r: any = await tools(prisma).execute("org-1", { tool: "get_inventory_health", args: {} });
    expect(r.trackedProducts).toBe(3); expect(r.untrackedProducts).toBe(1);
    expect(r.outOfStock.map((p: any) => p.name)).toEqual(["Gone"]);
    expect(r.lowStock.map((p: any) => p.name)).toEqual(["Low"]);
    expect(r.highStock.map((p: any) => p.name)).toEqual(["Bulk"]);
    expect(r.stockDataAbsent).toBe(false);
  });
  it("reports absent stock data instead of inventing health", async () => {
    const prisma = fakePrisma({ product: [{ organizationId: "org-1", status: "ACTIVE", name: "X", sku: null, stockQuantity: null }] });
    const r: any = await tools(prisma).execute("org-1", { tool: "get_inventory_health", args: {} });
    expect(r.stockDataAbsent).toBe(true);
    expect(r.note).toContain("cannot be assessed");
  });
});

describe("get_courier_performance (M46)", () => {
  it("computes rates over terminal shipments only, per provider", async () => {
    const mk = (provider: string, status: string) => ({ organizationId: "org-1", provider, status });
    const prisma = fakePrisma({
      courierShipment: [
        mk("steadfast", "delivered"), mk("steadfast", "delivered"), mk("steadfast", "returned"),
        mk("steadfast", "in_transit"), mk("pathao", "delivered"), mk("pathao", "pending"),
      ],
    });
    const r: any = await tools(prisma).execute("org-1", { tool: "get_courier_performance", args: {} });
    const sf = r.providers.find((p: any) => p.provider === "steadfast");
    expect(sf.total).toBe(4); expect(sf.terminal).toBe(3);
    expect(sf.deliveryRatePercent).toBe(66.7); expect(sf.returnRatePercent).toBe(33.3);
    const ph = r.providers.find((p: any) => p.provider === "pathao");
    expect(ph.deliveryRatePercent).toBe(100);
  });
  it("no shipments -> honest note", async () => {
    const r: any = await tools(fakePrisma({ courierShipment: [] })).execute("org-1", { tool: "get_courier_performance", args: {} });
    expect(r.totalShipments).toBe(0);
    expect(r.note).toContain("No courier shipments");
  });
});

describe("get_product_profit (M46)", () => {
  it("computes COGS from dated costs, nulls unknown-cost profit, and labels the ad allocation", async () => {
    const placed = new Date("2026-10-05T10:00:00Z");
    const prisma = fakePrisma({
      order: [
        { organizationId: "org-1", status: "completed", placedAt: placed, items: [
          { productId: "pA", name: "Alpha", quantity: 2, totalMinor: 100000n },
          { productId: "pB", name: "Beta", quantity: 1, totalMinor: 50000n },
        ] },
        { organizationId: "org-1", status: "cancelled", placedAt: placed, items: [
          { productId: "pA", name: "Alpha", quantity: 9, totalMinor: 999999n },
        ] },
      ],
      productCost: [{ productId: "pA", costMinor: 30000n, effectiveFrom: new Date("2026-01-01") }],
      dailyAdMetric: [{ organizationId: "org-1", date: new Date("2026-10-05"), spendMinor: 15000n, adExternalId: "" }],
    });
    const r: any = await tools(prisma).execute("org-1", { tool: "get_product_profit", args: { from: "2026-10-01", to: "2026-10-31" } });
    const a = r.products.find((p: any) => p.name === "Alpha");
    const b = r.products.find((p: any) => p.name === "Beta");
    // Alpha: revenue 100000 minor, COGS 2 x 30000 = 60000, gross 40000 minor = BDT 400.00;
    // ad share 2/3 of 15000 = 10000 -> contribution 30000 minor = BDT 300.00
    expect(a.units).toBe(2);
    expect(a.grossProfit).toBe("BDT 400.00");
    expect(a.contributionAfterAds).toBe("BDT 300.00");
    // Beta has no cost row: profit must be null, never guessed
    expect(b.cogsKnown).toBe(false);
    expect(b.grossProfit).toBeNull(); expect(b.contributionAfterAds).toBeNull();
    expect(r.allocationMethod).toContain("pro-rata");
    expect(r.allocationMethod).toContain("not per-product tracked spend");
  });
});

describe("compare_periods (M46)", () => {
  it("returns side-by-side periods with honest deltas", async () => {
    const analytics = analyticsStub({
      "2026-10-01": { orders: 50, revenueMinor: "200000", adSpendMinor: "20000", profitMinor: 80000n },
      "2026-09-01": { orders: 40, revenueMinor: "100000", adSpendMinor: "20000", profitMinor: 40000n },
    });
    const r: any = await tools(fakePrisma({}), analytics).execute("org-1", { tool: "compare_periods", args: { from: "2026-10-01", to: "2026-10-30" } });
    expect(r.current.orders).toBe(50); expect(r.previous.orders).toBe(40);
    expect(r.deltasPercent.orders).toBe(25);
    expect(r.deltasPercent.revenue).toBe(100);
    expect(r.deltasPercent.adSpend).toBe(0);
    expect(r.deltasPercent.contributionProfit).toBe(100);
  });
  it("previous period empty -> deltas null, not invented", async () => {
    const analytics = analyticsStub({ "2026-10-01": { orders: 5, revenueMinor: "5000", adSpendMinor: "0", profitMinor: 1000n } });
    const r: any = await tools(fakePrisma({}), analytics).execute("org-1", { tool: "compare_periods", args: { from: "2026-10-01", to: "2026-10-30" } });
    expect(r.deltasPercent.revenue).toBeNull();
    expect(r.note).toContain("null rather than invented");
  });
});

describe("dev-template rendering for the M46 tools", () => {
  it("renders inventory health in Bengali from the tool result only", () => {
    const out = templateAnswer("bn", "স্টক কেমন?", [{ tool: "get_inventory_health", status: "success", result: {
      trackedProducts: 2, untrackedProducts: 0, stockDataAbsent: false, thresholds: { lowStockAtOrBelow: 5, highStockAtOrAbove: 100 },
      outOfStock: [{ name: "Gone", stock: 0 }], lowStock: [], highStock: [],
    } }]);
    expect(out).toContain("স্টকের অবস্থা");
    expect(out).toContain("Gone");
  });
  it("renders courier performance numbers verbatim", () => {
    const out = templateAnswer("en", "courier?", [{ tool: "get_courier_performance", status: "success", result: {
      totalShipments: 4, providers: [{ provider: "steadfast", total: 4, delivered: 2, returned: 1, cancelled: 0, inTransit: 1, deliveryRatePercent: 66.7, returnRatePercent: 33.3 }],
    } }]);
    expect(out).toContain("steadfast");
    expect(out).toContain("66.7%");
  });
});
