import { BadRequestException, Injectable, Optional } from "@nestjs/common";
import { PrismaService } from "../prisma/prisma.service";
import { REVENUE_EXCLUDED_STATUSES } from "../analytics/analytics.service";
import { chooseCostForDate } from "../analytics/metrics";
import { dhakaDayStartUtc } from "../crm/lead-followups";
import { computeStockDiverged, pendingOutboxKeys } from "./stock-divergence";
import { AbandonedCheckoutsService } from "./abandoned-checkouts.service";

/**
 * EC11 — per-store commerce analytics (read-only).
 *
 * Definitions are REUSED, never reinvented:
 *  - Revenue orders exclude REVENUE_EXCLUDED_STATUSES
 *    (cancelled / refunded / failed), exactly like AnalyticsService.
 *  - COGS per order item = chooseCostForDate(ProductCost rows,
 *    effective order date); an order's COGS is "fully known" only
 *    when it has at least one item and EVERY item resolves to a
 *    cost (mirrors AnalyticsService.computeRange).
 *  - Windows are Dhaka days (dhakaDayStartUtc), orders matched by
 *    effective date (placedAt ?? createdAt) — mirroring
 *    ProductsService.salesReport.
 *  - Profit is reported ONLY at 100% COGS coverage; otherwise it
 *    is null — an incomplete profit number is never dressed up as
 *    a real one.
 *
 * All money leaves as decimal strings (BigInt-safe). This service
 * performs NO writes.
 */

/**
 * Orders still awaiting fulfillment. completed / cancelled /
 * refunded / failed / returned are NOT unfulfilled — the order is
 * either done, dead, or came back.
 */
export const OPEN_ORDER_STATUSES = ["pending", "processing", "on-hold"];

const DAY_MS = 86400000;
const NATIVE_STORE_NAME = "Native / সরাসরি অর্ডার (কোনো স্টোর নয়)";
const NATIVE_SHORT_NAME = "Native / সরাসরি";

function parseDays(daysInput: unknown, def: number): number {
  const days =
    daysInput === undefined || daysInput === null || daysInput === "" ? def : Number(daysInput);
  if (!Number.isInteger(days) || days < 1 || days > 365) {
    throw new BadRequestException("days must be an integer between 1 and 365");
  }
  return days;
}

function parseLimit(limitInput: unknown, def: number, max: number): number {
  const limit =
    limitInput === undefined || limitInput === null || limitInput === "" ? def : Number(limitInput);
  if (!Number.isInteger(limit) || limit < 1 || limit > max) {
    throw new BadRequestException(`limit must be an integer between 1 and ${max}`);
  }
  return limit;
}

function effectiveDate(order: any): Date {
  return new Date(order.placedAt ?? order.createdAt);
}

function money(v: bigint): string {
  return v.toString();
}

@Injectable()
export class CommerceAnalyticsService {
  constructor(
    private readonly prisma: PrismaService,
    @Optional() private readonly abandoned?: AbandonedCheckoutsService,
  ) {}

  // ---------- shared loads (findMany only: fake-friendly) ----------

  private async loadStores(orgId: string): Promise<any[]> {
    return (
      (await (this.prisma as any).store.findMany({ where: { organizationId: orgId } })) ?? []
    );
  }

  private async loadOrders(orgId: string, withItems: boolean): Promise<any[]> {
    return (
      (await (this.prisma as any).order.findMany({
        where: { organizationId: orgId },
        ...(withItems ? { include: { items: true } } : {}),
        take: 20000,
      })) ?? []
    );
  }

  private async loadProducts(orgId: string): Promise<any[]> {
    return (
      (await (this.prisma as any).product.findMany({
        where: { organizationId: orgId },
        take: 5000,
      })) ?? []
    );
  }

  private async loadListings(orgId: string): Promise<any[]> {
    const table = (this.prisma as any).storeListing;
    if (!table?.findMany) return [];
    return (await table.findMany({ where: { organizationId: orgId }, take: 5000 })) ?? [];
  }

  private async loadOutbox(orgId: string): Promise<any[]> {
    const table = (this.prisma as any).syncOutbox;
    if (!table?.findMany) return [];
    return (await table.findMany({ where: { organizationId: orgId }, take: 20000 })) ?? [];
  }

  private async loadConflicts(orgId: string): Promise<any[]> {
    const table = (this.prisma as any).syncConflict;
    if (!table?.findMany) return [];
    return (await table.findMany({ where: { organizationId: orgId }, take: 5000 })) ?? [];
  }

  /** COGS per order (AnalyticsService.computeRange pattern). */
  private async cogsByOrder(
    revenueOrders: any[],
  ): Promise<Map<string, { cogs: bigint; fullyKnown: boolean }>> {
    const productIds = [
      ...new Set(
        revenueOrders.flatMap((o: any) =>
          (o.items ?? []).map((i: any) => i.productId).filter(Boolean),
        ),
      ),
    ];
    const costTable = (this.prisma as any).productCost;
    const costRows =
      productIds.length && costTable?.findMany
        ? ((await costTable.findMany({ where: { productId: { in: productIds } } })) ?? [])
        : [];
    const costsByProduct = new Map<string, { costMinor: bigint; effectiveFrom: Date }[]>();
    for (const c of costRows) {
      const list = costsByProduct.get(c.productId) ?? [];
      list.push({ costMinor: BigInt(c.costMinor), effectiveFrom: new Date(c.effectiveFrom) });
      costsByProduct.set(c.productId, list);
    }
    const out = new Map<string, { cogs: bigint; fullyKnown: boolean }>();
    for (const o of revenueOrders) {
      const orderDate = effectiveDate(o);
      let cogs = 0n;
      let fullyKnown = (o.items ?? []).length > 0;
      for (const item of o.items ?? []) {
        const cost = item.productId
          ? chooseCostForDate(costsByProduct.get(item.productId) ?? [], orderDate)
          : null;
        if (cost === null) {
          fullyKnown = false;
          continue;
        }
        cogs += cost * BigInt(item.quantity);
      }
      out.set(o.id, { cogs, fullyKnown });
    }
    return out;
  }

  private async countStockDiverged(
    orgId: string,
    listings: any[],
    products: any[],
  ): Promise<number> {
    if (!listings.length) return 0;
    const stockByProduct = new Map<string, number | null>(
      products.map((p: any) => [p.id, p.stockQuantity ?? null]),
    );
    const pairs = listings.map((l: any) => ({ storeId: l.storeId, productId: l.productId }));
    const pending = await pendingOutboxKeys(this.prisma, orgId, pairs);
    let count = 0;
    for (const l of listings) {
      const hasPending = pending.has(`${l.storeId}:${l.productId}`);
      if (computeStockDiverged(l, stockByProduct.get(l.productId) ?? null, hasPending)) count++;
    }
    return count;
  }

  // ---------- EC11: per-store revenue / COGS / profit ----------

  async storesAnalytics(orgId: string, daysInput?: number | string | null, now = new Date()) {
    const days = parseDays(daysInput, 30);
    const end = new Date(dhakaDayStartUtc(now).getTime() + DAY_MS);
    const start = new Date(end.getTime() - days * DAY_MS);

    const [stores, allOrders] = await Promise.all([this.loadStores(orgId), this.loadOrders(orgId, true)]);
    const inWindow = allOrders.filter((o: any) => {
      const t = effectiveDate(o).getTime();
      return t >= start.getTime() && t < end.getTime();
    });
    const revenueOrders = inWindow.filter(
      (o: any) => !REVENUE_EXCLUDED_STATUSES.includes(o.status),
    );
    const cogsMap = await this.cogsByOrder(revenueOrders);

    interface Bucket {
      storeId: string | null;
      storeName: string;
      platform: string;
      currency: string | null;
      orders: any[];
      revenueOrders: any[];
    }
    const buckets = new Map<string, Bucket>();
    for (const s of stores) {
      buckets.set(s.id, {
        storeId: s.id,
        storeName: s.name,
        platform: s.platform,
        currency: s.currency ?? null,
        orders: [],
        revenueOrders: [],
      });
    }
    buckets.set("__native__", {
      storeId: null,
      storeName: NATIVE_STORE_NAME,
      platform: "NATIVE",
      currency: null,
      orders: [],
      revenueOrders: [],
    });
    const bucketFor = (o: any): Bucket => {
      const key = o.storeId ?? "__native__";
      let b = buckets.get(key);
      if (!b) {
        // Order referencing a store row we could not load — keep
        // the numbers instead of dropping the order silently.
        b = {
          storeId: o.storeId,
          storeName: o.storeId,
          platform: "UNKNOWN",
          currency: null,
          orders: [],
          revenueOrders: [],
        };
        buckets.set(key, b);
      }
      return b;
    };
    for (const o of inWindow) bucketFor(o).orders.push(o);
    for (const o of revenueOrders) bucketFor(o).revenueOrders.push(o);

    const rows = [...buckets.values()].map((b) => {
      const revenueMinor = b.revenueOrders.reduce((s: bigint, o: any) => s + BigInt(o.totalMinor ?? 0), 0n);
      // Refunds on ALL in-window orders (a cancelled order can
      // still have been refunded) vs refunds on revenue orders
      // only — profit math uses the revenue-orders figure so a
      // refund attached to an excluded order never distorts it.
      const totalRefundedMinor = b.orders.reduce((s: bigint, o: any) => s + BigInt(o.refundedMinor ?? 0), 0n);
      const revenueRefundedMinor = b.revenueOrders.reduce((s: bigint, o: any) => s + BigInt(o.refundedMinor ?? 0), 0n);
      let cogsMinor = 0n;
      let cogsKnownOrders = 0;
      for (const o of b.revenueOrders) {
        const entry = cogsMap.get(o.id);
        if (!entry) continue;
        cogsMinor += entry.cogs;
        if (entry.fullyKnown) cogsKnownOrders++;
      }
      const revenueCount = b.revenueOrders.length;
      const cogsCoveragePercent =
        revenueCount > 0 ? Math.round((cogsKnownOrders / revenueCount) * 100) : null;
      const profitMinor =
        revenueCount > 0 && cogsCoveragePercent === 100
          ? revenueMinor - revenueRefundedMinor - cogsMinor
          : null;
      return {
        storeId: b.storeId,
        storeName: b.storeName,
        platform: b.platform,
        currency: b.currency,
        ordersCount: b.orders.length,
        revenueOrders: revenueCount,
        revenueMinor: money(revenueMinor),
        refundedMinor: money(totalRefundedMinor),
        totalRefundedMinor: money(totalRefundedMinor),
        revenueRefundedMinor: money(revenueRefundedMinor),
        cogsMinor: money(cogsMinor),
        cogsKnownOrders,
        cogsCoveragePercent,
        profitMinor: profitMinor === null ? null : money(profitMinor),
      };
    });

    const totalRevenueOrders = rows.reduce((s, r) => s + r.revenueOrders, 0);
    const totalKnown = rows.reduce((s, r) => s + r.cogsKnownOrders, 0);
    const totalsCoverage =
      totalRevenueOrders > 0 ? Math.round((totalKnown / totalRevenueOrders) * 100) : null;
    const everyRevenueBucketComplete = rows
      .filter((r) => r.revenueOrders > 0)
      .every((r) => r.cogsCoveragePercent === 100);
    const totalsProfit =
      totalRevenueOrders > 0 && everyRevenueBucketComplete
        ? rows.reduce((s: bigint, r) => s + BigInt(r.revenueMinor), 0n) -
          rows.reduce((s: bigint, r) => s + BigInt(r.revenueRefundedMinor), 0n) -
          rows.reduce((s: bigint, r) => s + BigInt(r.cogsMinor), 0n)
        : null;
    const totals = {
      storeId: null as string | null,
      storeName: "সব স্টোর + Native",
      ordersCount: rows.reduce((s, r) => s + r.ordersCount, 0),
      revenueOrders: totalRevenueOrders,
      revenueMinor: money(rows.reduce((s: bigint, r) => s + BigInt(r.revenueMinor), 0n)),
      refundedMinor: money(rows.reduce((s: bigint, r) => s + BigInt(r.totalRefundedMinor), 0n)),
      totalRefundedMinor: money(rows.reduce((s: bigint, r) => s + BigInt(r.totalRefundedMinor), 0n)),
      revenueRefundedMinor: money(
        rows.reduce((s: bigint, r) => s + BigInt(r.revenueRefundedMinor), 0n),
      ),
      cogsMinor: money(rows.reduce((s: bigint, r) => s + BigInt(r.cogsMinor), 0n)),
      cogsKnownOrders: totalKnown,
      cogsCoveragePercent: totalsCoverage,
      profitMinor: totalsProfit === null ? null : money(totalsProfit),
    };

    return {
      days,
      window: { from: start.toISOString(), to: end.toISOString() },
      stores: rows,
      totals,
      definitions: {
        revenue:
          "Orders by effective date (placedAt ?? createdAt) in the Dhaka-day window, excluding cancelled/refunded/failed.",
        profit: "revenue - refunds - COGS, only at 100% COGS coverage",
        revenueExcludedStatuses: REVENUE_EXCLUDED_STATUSES,
      },
    };
  }

  // ---------- AB7 (AX19): order attribution source breakdown ----------

  /**
   * Orders grouped by their AX19 utmSource stamp over the
   * window. Range + "sold" conventions are THIS service's:
   * Dhaka-day window on the effective date (placedAt ??
   * createdAt), sold = status NOT in REVENUE_EXCLUDED_STATUSES
   * (cancelled / refunded / failed) — the same revenue-order
   * definition storesAnalytics uses.
   *
   * The stamps read here are the ORDER-LEVEL record written at
   * placement by the native checkouts. This is NOT the
   * attribution engine (src/attribution/): the engine computes
   * visitor-journey attribution and is untouched by AX19, and
   * nothing here feeds it.
   *
   * Orders without a stamp (POS / manual / external sync —
   * never stamped) group under "সরাসরি/অজানা".
   */
  async sourceBreakdown(orgId: string, daysInput?: number | string | null, now = new Date()) {
    const days = parseDays(daysInput, 30);
    const end = new Date(dhakaDayStartUtc(now).getTime() + DAY_MS);
    const start = new Date(end.getTime() - days * DAY_MS);

    const allOrders = await this.loadOrders(orgId, false);
    const sold = allOrders.filter((o: any) => {
      if (REVENUE_EXCLUDED_STATUSES.includes(o.status)) return false;
      const t = effectiveDate(o).getTime();
      return t >= start.getTime() && t < end.getTime();
    });

    const UNKNOWN_SOURCE = "সরাসরি/অজানা";
    const bySource = new Map<string, { source: string; orders: number; revenueMinor: bigint }>();
    let withClickId = 0;
    let stampedOrders = 0;
    let totalRevenue = 0n;
    for (const o of sold) {
      const raw = typeof o.utmSource === "string" ? o.utmSource.trim() : "";
      const source = raw === "" ? UNKNOWN_SOURCE : raw;
      if (raw !== "") stampedOrders++;
      if (o.clickId !== null && o.clickId !== undefined && o.clickId !== "") withClickId++;
      const revenue = BigInt(o.totalMinor ?? 0);
      totalRevenue += revenue;
      let bucket = bySource.get(source);
      if (!bucket) {
        bucket = { source, orders: 0, revenueMinor: 0n };
        bySource.set(source, bucket);
      }
      bucket.orders++;
      bucket.revenueMinor += revenue;
    }

    const sources = [...bySource.values()]
      .sort((a, b) => {
        if (a.revenueMinor !== b.revenueMinor) return a.revenueMinor > b.revenueMinor ? -1 : 1;
        return a.source < b.source ? -1 : a.source > b.source ? 1 : 0;
      })
      .map((b) => ({ source: b.source, orders: b.orders, revenueMinor: money(b.revenueMinor) }));

    return {
      days,
      window: { from: start.toISOString(), to: end.toISOString() },
      sources,
      totals: {
        orders: sold.length,
        revenueMinor: money(totalRevenue),
        withClickId,
        stampedOrders,
      },
      definitions: {
        sold:
          "Orders by effective date (placedAt ?? createdAt) in the Dhaka-day window, excluding cancelled/refunded/failed (REVENUE_EXCLUDED_STATUSES).",
        unknownSource: `${UNKNOWN_SOURCE} = orders with no utmSource stamp (untracked: POS / manual / external sync, or a native checkout that presented none).`,
      },
    };
  }

  // ---------- EC11: dead stock ----------

  async deadStock(
    orgId: string,
    daysInput?: number | string | null,
    limitInput?: number | string | null,
    now = new Date(),
  ) {
    const days = parseDays(daysInput, 90);
    const limit = parseLimit(limitInput, 50, 200);
    const end = new Date(dhakaDayStartUtc(now).getTime() + DAY_MS);
    const start = new Date(end.getTime() - days * DAY_MS);

    const [products, orders] = await Promise.all([
      this.loadProducts(orgId),
      this.loadOrders(orgId, true),
    ]);
    const tracked = products.filter(
      (p: any) => p.stockQuantity != null && p.stockQuantity > 0 && p.status !== "ARCHIVED",
    );

    const windowUnits = new Map<string, number>();
    const lastSaleAt = new Map<string, number>();
    for (const o of orders) {
      if (REVENUE_EXCLUDED_STATUSES.includes(o.status)) continue;
      const t = effectiveDate(o).getTime();
      const inWin = t >= start.getTime() && t < end.getTime();
      for (const item of o.items ?? []) {
        if (!item.productId) continue;
        if (inWin) windowUnits.set(item.productId, (windowUnits.get(item.productId) ?? 0) + Number(item.quantity ?? 0));
        const prev = lastSaleAt.get(item.productId);
        if (prev === undefined || t > prev) lastSaleAt.set(item.productId, t);
      }
    }

    const dead = tracked
      .filter((p: any) => (windowUnits.get(p.id) ?? 0) === 0)
      .map((p: any) => {
        const last = lastSaleAt.get(p.id) ?? null;
        return {
          productId: p.id,
          name: p.name,
          sku: p.sku ?? null,
          stockQuantity: p.stockQuantity,
          stockValueMinor: money(BigInt(p.priceMinor ?? 0) * BigInt(p.stockQuantity)),
          currency: p.currency ?? null,
          lastSaleAt: last === null ? null : new Date(last).toISOString(),
          daysSinceLastSale:
            last === null ? null : Math.floor((now.getTime() - last) / DAY_MS),
          soldUnitsInWindow: 0,
          _last: last,
        };
      })
      .sort((a: any, b: any) => {
        // Never-sold first, then longest-unsold first.
        if (a._last === null && b._last !== null) return -1;
        if (a._last !== null && b._last === null) return 1;
        if (a._last === null && b._last === null) return 0;
        return a._last - b._last;
      });

    const items = dead.slice(0, limit).map(({ _last, ...row }: any) => row);
    return {
      days,
      limit,
      window: { from: start.toISOString(), to: end.toISOString() },
      totalDead: dead.length,
      items,
    };
  }

  // ---------- EC11: top products (per-store) ----------

  async topProducts(
    orgId: string,
    opts: { storeId?: string | null; days?: number | string | null; limit?: number | string | null } = {},
    now = new Date(),
  ) {
    const days = parseDays(opts.days, 30);
    const limit = parseLimit(opts.limit, 20, 100);
    const end = new Date(dhakaDayStartUtc(now).getTime() + DAY_MS);
    const start = new Date(end.getTime() - days * DAY_MS);

    const [products, orders] = await Promise.all([
      this.loadProducts(orgId),
      this.loadOrders(orgId, true),
    ]);
    const productById = new Map<string, any>(products.map((p: any) => [p.id, p]));

    const matchesStore = (o: any): boolean => {
      if (opts.storeId === undefined || opts.storeId === null || opts.storeId === "") return true;
      if (opts.storeId === "native") return o.storeId == null;
      return o.storeId === opts.storeId;
    };

    const byProduct = new Map<
      string,
      { productId: string; units: number; revenueMinor: bigint; orderIds: Set<string>; firstItemName: string }
    >();
    let unlinkedUnits = 0;
    let unlinkedRevenue = 0n;
    for (const o of orders) {
      if (REVENUE_EXCLUDED_STATUSES.includes(o.status)) continue;
      if (!matchesStore(o)) continue;
      const t = effectiveDate(o).getTime();
      if (t < start.getTime() || t >= end.getTime()) continue;
      for (const item of o.items ?? []) {
        if (!item.productId) {
          unlinkedUnits += Number(item.quantity ?? 0);
          unlinkedRevenue += BigInt(item.totalMinor ?? 0);
          continue;
        }
        let entry = byProduct.get(item.productId);
        if (!entry) {
          entry = {
            productId: item.productId,
            units: 0,
            revenueMinor: 0n,
            orderIds: new Set<string>(),
            firstItemName: item.name,
          };
          byProduct.set(item.productId, entry);
        }
        entry.units += Number(item.quantity ?? 0);
        entry.revenueMinor += BigInt(item.totalMinor ?? 0);
        entry.orderIds.add(o.id);
      }
    }

    const items = [...byProduct.values()]
      .map((e) => {
        const product = productById.get(e.productId);
        return {
          productId: e.productId,
          name: product?.name ?? e.firstItemName,
          sku: product?.sku ?? null,
          units: e.units,
          revenueMinor: money(e.revenueMinor),
          orderCount: e.orderIds.size,
          _revenue: e.revenueMinor,
        };
      })
      .sort((a, b) => {
        if (a._revenue !== b._revenue) return a._revenue > b._revenue ? -1 : 1;
        return b.units - a.units;
      })
      .slice(0, limit)
      .map(({ _revenue, ...row }: any) => row);

    return {
      days,
      storeId: opts.storeId ?? null,
      items,
      unlinked: { units: unlinkedUnits, revenueMinor: money(unlinkedRevenue) },
      definitions:
        "Per-store extension of the S6 sales-report definitions: revenue orders exclude cancelled/refunded/failed, effective date is placedAt ?? createdAt in a Dhaka-day window; items without a linked productId are counted only in `unlinked`.",
    };
  }

  // ---------- EC11: hub summary + briefing signals ----------

  async commerceSignals(orgId: string, now = new Date()) {
    const [stores, listings, outbox, conflicts, orders] = await Promise.all([
      this.loadStores(orgId),
      this.loadListings(orgId),
      this.loadOutbox(orgId),
      this.loadConflicts(orgId),
      this.loadOrders(orgId, false),
    ]);
    const products = listings.length ? await this.loadProducts(orgId) : [];
    const cutoff24h = now.getTime() - DAY_MS;
    const cutoff48h = now.getTime() - 2 * DAY_MS;
    return {
      hasCommerceData: stores.length > 0 || listings.length > 0,
      failedSyncs24h: outbox.filter(
        (r: any) =>
          (r.status === "failed" || r.status === "dead") &&
          r.updatedAt != null &&
          new Date(r.updatedAt).getTime() >= cutoff24h,
      ).length,
      openConflicts: conflicts.filter((c: any) => c.status === "open").length,
      stockDivergedCount: await this.countStockDiverged(orgId, listings, products),
      unfulfilledOlderThan48h: orders.filter(
        (o: any) =>
          OPEN_ORDER_STATUSES.includes(o.status) && effectiveDate(o).getTime() < cutoff48h,
      ).length,
    };
  }

  async hubSummary(orgId: string, now = new Date()) {
    const start = dhakaDayStartUtc(now);
    const end = new Date(start.getTime() + DAY_MS);

    const [stores, orders, outbox, products, listings, signals] = await Promise.all([
      this.loadStores(orgId),
      this.loadOrders(orgId, false),
      this.loadOutbox(orgId),
      this.loadProducts(orgId),
      this.loadListings(orgId),
      this.commerceSignals(orgId, now),
    ]);
    const storeNameById = new Map<string, string>(stores.map((s: any) => [s.id, s.name]));

    // Today (Dhaka) sales, grouped per store.
    const byStoreMap = new Map<
      string,
      { storeId: string | null; storeName: string; orders: number; revenueMinor: bigint }
    >();
    let todayOrders = 0;
    let todayRevenue = 0n;
    for (const o of orders) {
      const t = effectiveDate(o).getTime();
      if (t < start.getTime() || t >= end.getTime()) continue;
      todayOrders++;
      const key = o.storeId ?? "__native__";
      let group = byStoreMap.get(key);
      if (!group) {
        group = {
          storeId: o.storeId ?? null,
          storeName: o.storeId ? (storeNameById.get(o.storeId) ?? o.storeId) : NATIVE_SHORT_NAME,
          orders: 0,
          revenueMinor: 0n,
        };
        byStoreMap.set(key, group);
      }
      group.orders++;
      if (!REVENUE_EXCLUDED_STATUSES.includes(o.status)) {
        const rev = BigInt(o.totalMinor ?? 0);
        group.revenueMinor += rev;
        todayRevenue += rev;
      }
    }
    const byStore = [...byStoreMap.values()].map((g) => ({
      storeId: g.storeId,
      storeName: g.storeName,
      orders: g.orders,
      revenueMinor: money(g.revenueMinor),
    }));

    const syncCounts = { pending: 0, processing: 0, failed: 0, dead: 0 } as Record<string, number>;
    for (const r of outbox) if (r.status in syncCounts) syncCounts[r.status]++;

    const unfulfilledOrders = orders.filter((o: any) =>
      OPEN_ORDER_STATUSES.includes(o.status),
    ).length;

    const lowStockCount = products.filter(
      (p: any) =>
        p.stockQuantity != null && p.stockQuantity <= (p.lowStockThreshold ?? 5),
    ).length;

    // Abandoned (unified): injected service when available; an
    // absent service reports an honest empty set, never invented
    // carts.
    let abandonedItems: any[] = [];
    if (this.abandoned?.listUnified) {
      const unified = await this.abandoned.listUnified(orgId).catch(() => ({ items: [] }));
      abandonedItems = (unified as any)?.items ?? [];
    }
    const openItems = abandonedItems.filter((i: any) => !i.recovered);
    let abandonedValue = 0n;
    let unknownValueCount = 0;
    const bySource: Record<string, number> = {};
    for (const i of openItems) {
      if (i.totalMinor == null) unknownValueCount++;
      else abandonedValue += BigInt(i.totalMinor);
      const src = String(i.source ?? "unknown");
      bySource[src] = (bySource[src] ?? 0) + 1;
    }

    return {
      generatedAt: now.toISOString(),
      today: {
        window: { from: start.toISOString(), to: end.toISOString() },
        orders: todayOrders,
        revenueMinor: money(todayRevenue),
        byStore,
      },
      sync: {
        pending: syncCounts.pending,
        processing: syncCounts.processing,
        failed: syncCounts.failed,
        dead: syncCounts.dead,
        openConflicts: signals.openConflicts,
        failedSyncs24h: signals.failedSyncs24h,
      },
      unfulfilledOrders,
      unfulfilledOlderThan48h: signals.unfulfilledOlderThan48h,
      lowStockCount,
      stockDivergedCount: signals.stockDivergedCount,
      listingsCount: listings.length,
      hasCommerceData: signals.hasCommerceData,
      abandoned: {
        openCount: openItems.length,
        totalValueMinor: money(abandonedValue),
        unknownValueCount,
        bySource,
      },
      signals,
    };
  }
}
