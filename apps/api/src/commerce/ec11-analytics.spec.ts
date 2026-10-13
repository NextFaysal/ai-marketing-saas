import { BadRequestException } from "@nestjs/common";
import { CommerceAnalyticsService, OPEN_ORDER_STATUSES } from "./commerce-analytics.service";

// Fixed clock: 2026-10-13T10:00Z = 16:00 Dhaka.
// Dhaka today window = [2026-10-12T18:00Z, 2026-10-13T18:00Z).
const NOW = new Date("2026-10-13T10:00:00.000Z");

function matches(row: any, where: any): boolean {
  if (!where) return true;
  return Object.entries(where).every(([k, v]) => {
    if (v === undefined) return true;
    if (v !== null && typeof v === "object" && !(v instanceof Date) && !Array.isArray(v)) {
      if ("in" in (v as any)) return (v as any).in.includes(row[k]);
      return true;
    }
    return row[k] === v;
  });
}

function makeTable() {
  const rows: any[] = [];
  return {
    rows,
    findFirst: async ({ where }: any) => rows.find((r) => matches(r, where)) ?? null,
    findMany: async ({ where, skip, take }: any = {}) => {
      let out = rows.filter((r) => matches(r, where ?? {}));
      if (typeof skip === "number") out = out.slice(skip);
      if (typeof take === "number") out = out.slice(0, take);
      return out;
    },
    count: async ({ where }: any = {}) => rows.filter((r) => matches(r, where ?? {})).length,
  };
}

function fakePrisma() {
  return {
    store: makeTable(),
    order: makeTable(),
    product: makeTable(),
    productCost: makeTable(),
    storeListing: makeTable(),
    syncOutbox: makeTable(),
    syncConflict: makeTable(),
  } as any;
}

function order(overrides: Record<string, any> = {}): any {
  return {
    id: `o-${Math.random().toString(36).slice(2, 8)}`,
    organizationId: "org-1",
    storeId: "s1",
    status: "completed",
    totalMinor: 0n,
    refundedMinor: 0n,
    currency: "BDT",
    placedAt: new Date("2026-10-10T05:00:00.000Z"),
    createdAt: new Date("2026-10-10T05:00:00.000Z"),
    items: [],
    ...overrides,
  };
}

function analyticsFixture(withCostForB = false) {
  const prisma = fakePrisma();
  prisma.store.rows.push(
    { id: "s1", organizationId: "org-1", name: "Woo Shop", platform: "WOOCOMMERCE", currency: "BDT" },
    { id: "s2", organizationId: "org-1", name: "Shopify Shop", platform: "SHOPIFY", currency: "BDT" },
    { id: "s3", organizationId: "org-1", name: "Empty Shop", platform: "WOOCOMMERCE", currency: "BDT" },
  );
  prisma.productCost.rows.push({
    id: "c1", productId: "pA", costMinor: 400n, effectiveFrom: new Date("2026-01-01T00:00:00.000Z"),
  });
  if (withCostForB) {
    prisma.productCost.rows.push({
      id: "c2", productId: "pB", costMinor: 100n, effectiveFrom: new Date("2026-01-01T00:00:00.000Z"),
    });
  }
  prisma.order.rows.push(
    order({
      id: "o1", storeId: "s1", status: "completed", totalMinor: 10000n, refundedMinor: 1000n,
      items: [{ productId: "pA", name: "A", quantity: 2, totalMinor: 10000n }],
    }),
    order({
      id: "o2", storeId: "s1", status: "completed", totalMinor: 5000n, refundedMinor: 0n,
      items: [{ productId: "pA", name: "A", quantity: 1, totalMinor: 5000n }],
    }),
    // Cancelled: counts in ordersCount + total refunds, never in revenue.
    order({
      id: "o3", storeId: "s1", status: "cancelled", totalMinor: 9999n, refundedMinor: 500n,
      items: [{ productId: "pA", name: "A", quantity: 1, totalMinor: 9999n }],
    }),
    // Native order whose product has no cost row (unless withCostForB).
    order({
      id: "o4", storeId: null, status: "completed", totalMinor: 3000n, refundedMinor: 0n,
      items: [{ productId: "pB", name: "B", quantity: 1, totalMinor: 3000n }],
    }),
    // s2 order with unknown COGS.
    order({
      id: "o5", storeId: "s2", status: "completed", totalMinor: 2000n, refundedMinor: 0n,
      items: [{ productId: "pB", name: "B", quantity: 1, totalMinor: 2000n }],
    }),
    // Out of the 30-day window — must be invisible everywhere.
    order({
      id: "o6", storeId: "s1", status: "completed", totalMinor: 77777n, refundedMinor: 0n,
      placedAt: new Date("2026-08-01T05:00:00.000Z"), createdAt: new Date("2026-08-01T05:00:00.000Z"),
      items: [{ productId: "pA", name: "A", quantity: 9, totalMinor: 77777n }],
    }),
  );
  return prisma;
}

describe("EC11 storesAnalytics", () => {
  it("groups revenue/COGS per store, excludes cancelled from revenue, keeps total refunds separate", async () => {
    const svc = new CommerceAnalyticsService(analyticsFixture());
    const out: any = await svc.storesAnalytics("org-1", 30, NOW);
    expect(out.days).toBe(30);
    expect(out.definitions.revenueExcludedStatuses).toEqual(["cancelled", "refunded", "failed"]);

    const s1 = out.stores.find((r: any) => r.storeId === "s1");
    expect(s1.ordersCount).toBe(3); // o1, o2, cancelled o3 (o6 out of window)
    expect(s1.revenueOrders).toBe(2);
    expect(s1.revenueMinor).toBe("15000");
    expect(s1.totalRefundedMinor).toBe("1500"); // 1000 revenue-order + 500 cancelled
    expect(s1.revenueRefundedMinor).toBe("1000");
    expect(s1.cogsMinor).toBe("1200"); // 2*400 + 1*400
    expect(s1.cogsKnownOrders).toBe(2);
    expect(s1.cogsCoveragePercent).toBe(100);
    expect(s1.profitMinor).toBe("12800"); // 15000 - 1000 - 1200

    const native = out.stores.find((r: any) => r.storeId === null);
    expect(native.platform).toBe("NATIVE");
    expect(native.revenueMinor).toBe("3000");
    expect(native.cogsCoveragePercent).toBe(0);
    expect(native.profitMinor).toBeNull(); // incomplete COGS — never a fake profit
  });

  it("incomplete COGS in any revenue bucket makes totals profit null, with the right coverage", async () => {
    const svc = new CommerceAnalyticsService(analyticsFixture());
    const out: any = await svc.storesAnalytics("org-1", 30, NOW);
    const s2 = out.stores.find((r: any) => r.storeId === "s2");
    expect(s2.cogsCoveragePercent).toBe(0);
    expect(s2.profitMinor).toBeNull();
    expect(out.totals.revenueOrders).toBe(4);
    expect(out.totals.cogsKnownOrders).toBe(2);
    expect(out.totals.cogsCoveragePercent).toBe(50);
    expect(out.totals.profitMinor).toBeNull();
    expect(out.totals.revenueMinor).toBe("20000");
  });

  it("complete COGS everywhere yields totals profit = revenue - revenue refunds - COGS", async () => {
    const svc = new CommerceAnalyticsService(analyticsFixture(true));
    const out: any = await svc.storesAnalytics("org-1", 30, NOW);
    const native = out.stores.find((r: any) => r.storeId === null);
    expect(native.cogsCoveragePercent).toBe(100);
    expect(native.profitMinor).toBe("2900"); // 3000 - 0 - 100
    const s2 = out.stores.find((r: any) => r.storeId === "s2");
    expect(s2.profitMinor).toBe("1900"); // 2000 - 0 - 100
    expect(out.totals.cogsCoveragePercent).toBe(100);
    expect(out.totals.profitMinor).toBe("17600"); // 20000 - 1000 - 1400
  });

  it("a store with zero orders still gets a row; the native bucket is always present", async () => {
    const svc = new CommerceAnalyticsService(analyticsFixture());
    const out: any = await svc.storesAnalytics("org-1", 30, NOW);
    const s3 = out.stores.find((r: any) => r.storeId === "s3");
    expect(s3).toBeDefined();
    expect(s3.ordersCount).toBe(0);
    expect(s3.revenueMinor).toBe("0");
    expect(s3.cogsCoveragePercent).toBeNull();
    expect(s3.profitMinor).toBeNull();
    expect(out.stores.some((r: any) => r.storeId === null)).toBe(true);
  });

  it("rejects an out-of-range days value", async () => {
    const svc = new CommerceAnalyticsService(analyticsFixture());
    await expect(svc.storesAnalytics("org-1", 0, NOW)).rejects.toBeInstanceOf(BadRequestException);
    await expect(svc.storesAnalytics("org-1", 366, NOW)).rejects.toBeInstanceOf(BadRequestException);
  });
});

describe("EC11 deadStock", () => {
  function fixture() {
    const prisma = fakePrisma();
    prisma.product.rows.push(
      { id: "p-never", organizationId: "org-1", name: "Never Sold", sku: "NV-1", status: "ACTIVE", stockQuantity: 10, priceMinor: 1000n, currency: "BDT" },
      { id: "p-old", organizationId: "org-1", name: "Old Seller", sku: "OLD-1", status: "ACTIVE", stockQuantity: 5, priceMinor: 2000n, currency: "BDT" },
      { id: "p-recent", organizationId: "org-1", name: "Recent Seller", sku: "RC-1", status: "ACTIVE", stockQuantity: 7, priceMinor: 500n, currency: "BDT" },
      { id: "p-untracked", organizationId: "org-1", name: "Untracked", sku: "UN-1", status: "ACTIVE", stockQuantity: null, priceMinor: 500n, currency: "BDT" },
      { id: "p-zero", organizationId: "org-1", name: "Zero Stock", sku: "ZR-1", status: "ACTIVE", stockQuantity: 0, priceMinor: 500n, currency: "BDT" },
      { id: "p-archived", organizationId: "org-1", name: "Archived", sku: "AR-1", status: "ARCHIVED", stockQuantity: 9, priceMinor: 500n, currency: "BDT" },
    );
    prisma.order.rows.push(
      // Sold long before the 90-day window.
      order({
        id: "d1", status: "completed",
        placedAt: new Date("2026-06-01T05:00:00.000Z"), createdAt: new Date("2026-06-01T05:00:00.000Z"),
        items: [{ productId: "p-old", name: "Old Seller", quantity: 3, totalMinor: 6000n }],
      }),
      // Sold inside the window — NOT dead.
      order({
        id: "d2", status: "completed",
        items: [{ productId: "p-recent", name: "Recent Seller", quantity: 2, totalMinor: 1000n }],
      }),
      // A cancelled order is not a sale — p-never stays never-sold.
      order({
        id: "d3", status: "cancelled",
        items: [{ productId: "p-never", name: "Never Sold", quantity: 1, totalMinor: 1000n }],
      }),
    );
    return prisma;
  }

  it("flags never-sold first, then longest-unsold; excludes in-window sellers, untracked, zero and archived", async () => {
    const svc = new CommerceAnalyticsService(fixture());
    const out: any = await svc.deadStock("org-1", 90, 50, NOW);
    expect(out.items.map((i: any) => i.productId)).toEqual(["p-never", "p-old"]);

    const never = out.items[0];
    expect(never.lastSaleAt).toBeNull();
    expect(never.daysSinceLastSale).toBeNull();
    expect(never.stockQuantity).toBe(10);
    expect(never.stockValueMinor).toBe("10000");
    expect(never.soldUnitsInWindow).toBe(0);

    const old = out.items[1];
    expect(old.lastSaleAt).toBe("2026-06-01T05:00:00.000Z");
    expect(old.daysSinceLastSale).toBe(
      Math.floor((NOW.getTime() - new Date("2026-06-01T05:00:00.000Z").getTime()) / 86400000),
    );
    expect(old.stockValueMinor).toBe("10000"); // 2000 * 5
  });

  it("respects the limit", async () => {
    const svc = new CommerceAnalyticsService(fixture());
    const out: any = await svc.deadStock("org-1", 90, 1, NOW);
    expect(out.items).toHaveLength(1);
    expect(out.totalDead).toBe(2);
  });
});

describe("EC11 topProducts", () => {
  function fixture() {
    const prisma = fakePrisma();
    prisma.product.rows.push(
      { id: "p1", organizationId: "org-1", name: "Product One", sku: "P-1", status: "ACTIVE", stockQuantity: 4, priceMinor: 1000n, currency: "BDT" },
      // p2 intentionally has NO product row — name falls back to the item name.
    );
    prisma.order.rows.push(
      order({
        id: "t1", storeId: "s1", status: "completed",
        items: [
          { productId: "p1", name: "Product One", quantity: 2, totalMinor: 2000n },
          { productId: "p2", name: "Ghost Item", quantity: 1, totalMinor: 500n },
          { productId: null, name: "Loose", quantity: 3, totalMinor: 900n },
        ],
      }),
      order({
        id: "t2", storeId: null, status: "completed",
        items: [
          { productId: "p1", name: "Product One", quantity: 5, totalMinor: 5000n },
          { productId: null, name: "Loose Native", quantity: 1, totalMinor: 300n },
        ],
      }),
      // Cancelled — never aggregated.
      order({
        id: "t3", storeId: "s1", status: "cancelled",
        items: [{ productId: "p1", name: "Product One", quantity: 99, totalMinor: 99000n }],
      }),
    );
    return prisma;
  }

  it("aggregates all stores by default, sorted by revenue, with unlinked items summarized", async () => {
    const svc = new CommerceAnalyticsService(fixture());
    const out: any = await svc.topProducts("org-1", { days: 30 }, NOW);
    expect(out.storeId).toBeNull();
    expect(out.items[0].productId).toBe("p1");
    expect(out.items[0].units).toBe(7);
    expect(out.items[0].revenueMinor).toBe("7000");
    expect(out.items[0].orderCount).toBe(2);
    expect(out.items[0].name).toBe("Product One");
    const ghost = out.items.find((i: any) => i.productId === "p2");
    expect(ghost.name).toBe("Ghost Item"); // item-name fallback
    expect(out.unlinked).toEqual({ units: 4, revenueMinor: "1200" });
  });

  it("storeId filter keeps only that store's orders", async () => {
    const svc = new CommerceAnalyticsService(fixture());
    const out: any = await svc.topProducts("org-1", { storeId: "s1", days: 30 }, NOW);
    const p1 = out.items.find((i: any) => i.productId === "p1");
    expect(p1.units).toBe(2);
    expect(p1.revenueMinor).toBe("2000");
    expect(out.unlinked).toEqual({ units: 3, revenueMinor: "900" });
  });

  it('"native" filter keeps only store-less orders', async () => {
    const svc = new CommerceAnalyticsService(fixture());
    const out: any = await svc.topProducts("org-1", { storeId: "native", days: 30 }, NOW);
    expect(out.storeId).toBe("native");
    expect(out.items).toHaveLength(1);
    expect(out.items[0].units).toBe(5);
    expect(out.unlinked).toEqual({ units: 1, revenueMinor: "300" });
  });
});

describe("EC11 hubSummary + commerceSignals", () => {
  function fixture() {
    const prisma = fakePrisma();
    prisma.store.rows.push({
      id: "s1", organizationId: "org-1", name: "Woo Shop", platform: "WOOCOMMERCE", currency: "BDT",
    });
    prisma.product.rows.push(
      { id: "p-low", organizationId: "org-1", name: "Low", sku: "L-1", status: "ACTIVE", stockQuantity: 3, lowStockThreshold: null, priceMinor: 100n, currency: "BDT" },
      { id: "p-ok", organizationId: "org-1", name: "Fine", sku: "F-1", status: "ACTIVE", stockQuantity: 40, lowStockThreshold: null, priceMinor: 100n, currency: "BDT" },
      { id: "p-untracked", organizationId: "org-1", name: "Untracked", sku: "U-1", status: "ACTIVE", stockQuantity: null, lowStockThreshold: null, priceMinor: 100n, currency: "BDT" },
    );
    // Listing channel stock (7) != product stock (3), no pending product push → diverged.
    prisma.storeListing.rows.push({
      id: "l1", organizationId: "org-1", storeId: "s1", productId: "p-low", channelStock: 7, syncStatus: "synced",
    });
    prisma.order.rows.push(
      // Today (Dhaka), store order.
      order({
        id: "h1", storeId: "s1", status: "completed", totalMinor: 5000n,
        placedAt: new Date("2026-10-13T05:00:00.000Z"), createdAt: new Date("2026-10-13T05:00:00.000Z"),
      }),
      // Today (Dhaka), native + unfulfilled.
      order({
        id: "h2", storeId: null, status: "pending", totalMinor: 2000n,
        placedAt: new Date("2026-10-13T06:00:00.000Z"), createdAt: new Date("2026-10-13T06:00:00.000Z"),
      }),
      // Old unfulfilled order (> 48h).
      order({
        id: "h3", storeId: "s1", status: "processing", totalMinor: 1000n,
        placedAt: new Date("2026-10-08T05:00:00.000Z"), createdAt: new Date("2026-10-08T05:00:00.000Z"),
      }),
    );
    prisma.syncOutbox.rows.push(
      { id: "ob1", organizationId: "org-1", storeId: "s1", entityType: "order", entityId: "h1", status: "pending", updatedAt: new Date(NOW.getTime() - 3600000) },
      { id: "ob2", organizationId: "org-1", storeId: "s1", entityType: "order", entityId: "h1", status: "processing", updatedAt: new Date(NOW.getTime() - 3600000) },
      { id: "ob3", organizationId: "org-1", storeId: "s1", entityType: "order", entityId: "h1", status: "failed", updatedAt: new Date(NOW.getTime() - 3600000) },
      { id: "ob4", organizationId: "org-1", storeId: "s1", entityType: "order", entityId: "h1", status: "dead", updatedAt: new Date(NOW.getTime() - 30 * 3600000) },
      { id: "ob5", organizationId: "org-1", storeId: "s1", entityType: "order", entityId: "h1", status: "done", updatedAt: new Date(NOW.getTime() - 3600000) },
    );
    prisma.syncConflict.rows.push(
      { id: "cf1", organizationId: "org-1", storeId: "s1", listingId: "l1", status: "open" },
      { id: "cf2", organizationId: "org-1", storeId: "s1", listingId: "l1", status: "resolved" },
    );
    const abandoned = {
      listUnified: async () => ({
        generatedAt: NOW.toISOString(),
        items: [
          { source: "tracker", totalMinor: "1500", recovered: false },
          { source: "shopify", totalMinor: null, recovered: false },
          { source: "native", totalMinor: "500", recovered: true },
        ],
      }),
    };
    return { prisma, abandoned };
  }

  it("computes today's sales per store, sync counts, stock and fulfillment signals", async () => {
    const { prisma, abandoned } = fixture();
    const svc = new CommerceAnalyticsService(prisma, abandoned as any);
    const out: any = await svc.hubSummary("org-1", NOW);

    expect(out.today.orders).toBe(2);
    expect(out.today.revenueMinor).toBe("7000");
    const s1 = out.today.byStore.find((g: any) => g.storeId === "s1");
    expect(s1).toMatchObject({ storeName: "Woo Shop", orders: 1, revenueMinor: "5000" });
    const native = out.today.byStore.find((g: any) => g.storeId === null);
    expect(native.orders).toBe(1);
    expect(native.revenueMinor).toBe("2000");

    expect(out.sync).toMatchObject({ pending: 1, processing: 1, failed: 1, dead: 1, openConflicts: 1, failedSyncs24h: 1 });
    expect(out.unfulfilledOrders).toBe(2);
    expect(out.unfulfilledOlderThan48h).toBe(1);
    expect(out.lowStockCount).toBe(1);
    expect(out.stockDivergedCount).toBe(1);
    expect(out.hasCommerceData).toBe(true);
  });

  it("sums open abandoned value, counting null-value carts as unknown (recovered excluded)", async () => {
    const { prisma, abandoned } = fixture();
    const svc = new CommerceAnalyticsService(prisma, abandoned as any);
    const out: any = await svc.hubSummary("org-1", NOW);
    expect(out.abandoned.openCount).toBe(2);
    expect(out.abandoned.totalValueMinor).toBe("1500");
    expect(out.abandoned.unknownValueCount).toBe(1);
    expect(out.abandoned.bySource).toEqual({ tracker: 1, shopify: 1 });
  });

  it("commerceSignals: failedSyncs24h only counts the last 24h; empty org has no commerce data", async () => {
    const { prisma, abandoned } = fixture();
    const svc = new CommerceAnalyticsService(prisma, abandoned as any);
    const signals = await svc.commerceSignals("org-1", NOW);
    expect(signals).toMatchObject({
      hasCommerceData: true,
      failedSyncs24h: 1, // ob3 (1h ago); ob4 is dead but 30h old
      openConflicts: 1,
      stockDivergedCount: 1,
      unfulfilledOlderThan48h: 1,
    });
    expect(OPEN_ORDER_STATUSES).toEqual(["pending", "processing", "on-hold"]);

    const empty = new CommerceAnalyticsService(fakePrisma());
    const emptySignals = await empty.commerceSignals("org-1", NOW);
    expect(emptySignals.hasCommerceData).toBe(false);
    expect(emptySignals.failedSyncs24h).toBe(0);
    const emptyHub = await empty.hubSummary("org-1", NOW);
    expect(emptyHub.abandoned).toMatchObject({ openCount: 0, totalValueMinor: "0", unknownValueCount: 0 });
    expect(emptyHub.today.orders).toBe(0);
  });
});
