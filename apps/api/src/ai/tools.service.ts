import { Injectable } from "@nestjs/common";
import { PrismaService } from "../prisma/prisma.service";
import { AnalyticsService, parseRange, REVENUE_EXCLUDED_STATUSES } from "../analytics/analytics.service";
import { chooseCostForDate } from "../analytics/metrics";
import { AttributionService } from "../attribution/attribution.service";
import { computeRfm, RFM_SEGMENTS } from "../messaging/rfm";
import { PlannedToolCall } from "./planner";
import { detectAnomalies, DailyPoint } from "./anomaly";
import { formatMinor } from "@repo/contracts";

/**
 * Read-only AI tools. Every tool is organization-scoped by construction
 * (the org id comes from the authenticated request, never from the model),
 * returns a compact JSON summary, and is executed through this single
 * choke point so ChatService can log each call to AIAction.
 * There are deliberately NO write tools (Milestones 6/45/46 are all
 * read-only; write actions arrive in M47 behind explicit approval).
 */
@Injectable()
export class ToolsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly analytics: AnalyticsService,
    private readonly attribution: AttributionService,
  ) {}

  async execute(organizationId: string, call: PlannedToolCall): Promise<unknown> {
    switch (call.tool) {
      case "get_analytics_overview": return this.overview(organizationId, call.args);
      case "get_campaign_performance": return this.campaigns(organizationId, call.args);
      case "get_attribution_report": return this.attributionReport(organizationId, call.args);
      case "list_products": return this.products(organizationId, call.args);
      case "get_orders_attention": return this.ordersAttention(organizationId);
      case "get_anomalies": return this.getAnomalies(organizationId, Number(call.args.days ?? 14));
      case "get_business_knowledge": return this.knowledge(organizationId);
      case "get_customer_segments": return this.customerSegments(organizationId);
      case "get_inventory_health": return this.inventoryHealth(organizationId);
      case "get_courier_performance": return this.courierPerformance(organizationId);
      case "get_product_profit": return this.productProfit(organizationId, call.args);
      case "compare_periods": return this.comparePeriods(organizationId, call.args);
      default: throw new Error(`Unknown tool: ${call.tool}`);
    }
  }

  private async overview(organizationId: string, args: Record<string, unknown>) {
    const { from, toExclusive } = parseRange(args.from as string | undefined, args.to as string | undefined);
    const r: any = await this.analytics.computeRange(organizationId, from, toExclusive);
    return {
      range: r.range,
      orders: r.totals.orders,
      revenue: formatMinor(BigInt(r.totals.revenueMinor)),
      revenueMinor: r.totals.revenueMinor,
      adSpend: formatMinor(BigInt(r.totals.adSpendMinor)),
      adSpendMinor: r.totals.adSpendMinor,
      averageOrderValue: formatMinor(BigInt(r.totals.averageOrderValueMinor)),
      mer: r.kpis.mer, platformRoas: r.kpis.platformRoas, cpaMinor: r.kpis.cpaMinor,
      platformConversions: r.totals.platformConversions,
      contributionProfit: formatMinor(BigInt(r.profit.contributionProfitMinor)),
      contributionProfitMinor: r.profit.contributionProfitMinor,
      contributionMarginPercent: r.profit.contributionMarginPercent,
      cogsCoveragePercent: r.profit.cogsCoverage.percent,
      platforms: r.platforms,
      mixedCurrencies: r.mixedCurrencies,
    };
  }

  private async campaigns(organizationId: string, args: Record<string, unknown>) {
    const { from, toExclusive } = parseRange(args.from as string | undefined, args.to as string | undefined);
    const r: any = await this.analytics.computeRange(organizationId, from, toExclusive);
    const limit = Number(args.limit ?? 10);
    return {
      range: r.range,
      campaigns: r.campaigns.slice(0, limit).map((c: any) => ({
        name: c.campaignName ?? c.campaignExternalId ?? "(account level)",
        platform: c.platform, source: c.source,
        spend: formatMinor(BigInt(c.spendMinor)), clicks: c.clicks,
        ctrPercent: c.ctrPercent, platformConversions: c.platformConversions,
        cpa: c.cpaMinor === null ? null : formatMinor(BigInt(Math.round(c.cpaMinor))),
        platformRoas: c.platformRoas,
      })),
    };
  }

  private async attributionReport(organizationId: string, args: Record<string, unknown>) {
    const model = (args.model as any) ?? "LAST_TOUCH";
    const r = await this.attribution.report(organizationId, model);
    return {
      model: r.model, windowDays: r.windowDays,
      ordersRevenue: formatMinor(BigInt(r.totals.ordersRevenueMinor)),
      attributedRevenue: formatMinor(BigInt(r.totals.attributedRevenueMinor)),
      unattributedRevenue: formatMinor(BigInt(r.totals.unattributedRevenueMinor)),
      byChannel: r.byChannel.map((c) => ({ ...c, revenue: formatMinor(BigInt(c.revenueMinor)) })),
    };
  }

  private async products(organizationId: string, args: Record<string, unknown>) {
    const limit = Number(args.limit ?? 10);
    const items = await (this.prisma as any).product.findMany({
      where: { organizationId, status: "ACTIVE", ...(args.search ? { name: { contains: String(args.search), mode: "insensitive" } } : {}) },
      include: { costs: { orderBy: { effectiveFrom: "desc" }, take: 1 } },
      orderBy: { createdAt: "desc" }, take: limit,
    });
    return {
      products: items.map((p: any) => {
        const cost = p.costs?.[0]?.costMinor;
        const marginPercent = cost != null && BigInt(p.priceMinor) > 0n
          ? Number(((BigInt(p.priceMinor) - BigInt(cost)) * 10000n) / BigInt(p.priceMinor)) / 100 : null;
        return {
          name: p.name, sku: p.sku, category: p.category,
          price: formatMinor(BigInt(p.priceMinor), p.currency),
          cost: cost != null ? formatMinor(BigInt(cost), p.currency) : null,
          marginPercent, stock: p.stockQuantity,
        };
      }),
    };
  }

  private async ordersAttention(organizationId: string) {
    const cutoff = new Date(Date.now() - 24 * 3600 * 1000);
    const [stale, failed] = await Promise.all([
      (this.prisma as any).order.findMany({
        where: { organizationId, status: { in: ["pending", "on-hold"] }, placedAt: { lt: cutoff } },
        orderBy: { placedAt: "asc" }, take: 10,
        select: { id: true, externalNumber: true, status: true, totalMinor: true, placedAt: true, isCod: true },
      }),
      (this.prisma as any).order.count({ where: { organizationId, status: "failed" } }),
    ]);
    return {
      stalePendingOrOnHoldOver24h: stale.length,
      failedOrders: failed,
      examples: stale.map((o: any) => ({
        order: o.externalNumber ?? o.id, status: o.status, isCod: o.isCod,
        total: formatMinor(BigInt(o.totalMinor)), placedAt: o.placedAt,
      })),
    };
  }

  async getAnomalies(organizationId: string, days = 14) {
    const to = new Date();
    const from = new Date(Date.now() - (days - 1) * 86400000);
    const r: any = await this.analytics.computeRange(organizationId, new Date(Date.UTC(from.getUTCFullYear(), from.getUTCMonth(), from.getUTCDate())), new Date(Date.UTC(to.getUTCFullYear(), to.getUTCMonth(), to.getUTCDate()) + 86400000));
    const raw: Map<string, any> = r._dailyRaw;
    const points: DailyPoint[] = [];
    for (let i = 0; i < days; i++) {
      const d = new Date(Date.UTC(from.getUTCFullYear(), from.getUTCMonth(), from.getUTCDate()) + i * 86400000);
      const key = d.toISOString().slice(0, 10);
      const day = raw.get(key);
      points.push({ date: key, orders: day?.orders ?? 0, revenueMinor: day?.revenueMinor ?? 0n, spendMinor: day?.spendMinor ?? 0n });
    }
    const { anomalies, sufficientData } = detectAnomalies(points);
    return {
      anomalies, sufficientData,
      note: sufficientData ? undefined : "Baseline order volume is too low for reliable anomaly detection; rate anomalies were skipped rather than guessed.",
    };
  }

  // ----- Milestone 46: deep analysis tools (read-only) -----

  /** RFM segments with counts and revenue share, reusing the messaging
   *  module's RFM computation (quintiles relative to this business's own
   *  customers; customers without orders are excluded by that code). */
  private async customerSegments(organizationId: string) {
    const rows = await computeRfm(this.prisma as any, organizationId);
    const totalRevenue = rows.reduce((s, r) => s + BigInt(r.monetaryMinor), 0n);
    const segments = RFM_SEGMENTS.map((name) => {
      const inSeg = rows.filter((r) => r.segment === name);
      const rev = inSeg.reduce((s, r) => s + BigInt(r.monetaryMinor), 0n);
      return {
        segment: name, customers: inSeg.length,
        revenue: formatMinor(rev),
        revenueSharePercent: totalRevenue > 0n ? Number((rev * 1000n) / totalRevenue) / 10 : 0,
      };
    }).filter((s) => s.customers > 0);
    return {
      totalCustomers: rows.length,
      totalRevenue: formatMinor(totalRevenue),
      segments,
      note: rows.length
        ? "RFM scores are quintiles relative to this business's own customer base; customers without orders are excluded."
        : "No customers with orders yet, so no segments can be computed.",
    };
  }

  /** Stock health from real stockQuantity fields. Thresholds are stated
   *  in the result; "high stock" is a raw count above the threshold, NOT
   *  a sales-velocity judgement. Untracked products are counted plainly. */
  private async inventoryHealth(organizationId: string) {
    const LOW = 5, HIGH = 100;
    const items = await (this.prisma as any).product.findMany({
      where: { organizationId, status: "ACTIVE" }, take: 5000,
      select: { name: true, sku: true, stockQuantity: true },
    });
    const tracked = items.filter((p: any) => p.stockQuantity !== null && p.stockQuantity !== undefined);
    const brief = (p: any) => ({ name: p.name, sku: p.sku, stock: p.stockQuantity });
    return {
      totalProducts: items.length,
      trackedProducts: tracked.length,
      untrackedProducts: items.length - tracked.length,
      stockDataAbsent: tracked.length === 0,
      thresholds: { lowStockAtOrBelow: LOW, highStockAtOrAbove: HIGH },
      outOfStock: tracked.filter((p: any) => p.stockQuantity === 0).map(brief),
      lowStock: tracked.filter((p: any) => p.stockQuantity > 0 && p.stockQuantity <= LOW).map(brief),
      highStock: tracked.filter((p: any) => p.stockQuantity >= HIGH).map(brief),
      note: tracked.length === 0
        ? "No product has a stock quantity recorded, so stock health cannot be assessed. Add stock quantities to products first."
        : "High stock is a raw unit count above the stated threshold, not a sales-velocity judgement.",
    };
  }

  /** Per-provider delivery/return rates from real CourierShipment rows.
   *  Rates are computed over TERMINAL shipments only (delivered,
   *  partial_delivered, returned, cancelled); when a provider has no
   *  terminal shipment its rates are null, never guessed. */
  private async courierPerformance(organizationId: string) {
    const rows = await (this.prisma as any).courierShipment.findMany({ where: { organizationId }, take: 5000 });
    const byProvider = new Map<string, any>();
    for (const s of rows) {
      const p = byProvider.get(s.provider) ?? {
        provider: s.provider, total: 0, delivered: 0, partialDelivered: 0, returned: 0, cancelled: 0, inTransit: 0,
      };
      p.total++;
      if (s.status === "delivered") p.delivered++;
      else if (s.status === "partial_delivered") p.partialDelivered++;
      else if (s.status === "returned") p.returned++;
      else if (s.status === "cancelled") p.cancelled++;
      else p.inTransit++;
      byProvider.set(s.provider, p);
    }
    const providers = [...byProvider.values()].map((p) => {
      const terminal = p.delivered + p.partialDelivered + p.returned + p.cancelled;
      const pct = (n: number) => (terminal > 0 ? Math.round((n / terminal) * 1000) / 10 : null);
      return {
        ...p, terminal,
        deliveryRatePercent: pct(p.delivered + p.partialDelivered),
        returnRatePercent: pct(p.returned),
      };
    }).sort((a, b) => b.total - a.total);
    return {
      totalShipments: rows.length,
      providers,
      note: rows.length
        ? "Rates are computed over terminal shipments only (delivered, partial, returned, cancelled); in-transit parcels are excluded from the rates."
        : "No courier shipments booked yet, so courier performance cannot be assessed.",
    };
  }

  /** Per-product profit: revenue from real order items, COGS from the
   *  product cost in effect on each order's date, and the period's total
   *  ad spend allocated PRO-RATA BY REVENUE SHARE — an allocation, which
   *  the result labels as such (it is not per-product tracked spend).
   *  Products with any item lacking a cost get cogsKnown=false and null
   *  profit figures rather than a guessed number. */
  private async productProfit(organizationId: string, args: Record<string, unknown>) {
    const { from, toExclusive } = parseRange(args.from as string | undefined, args.to as string | undefined);
    const limit = Number(args.limit ?? 10);
    const orders = await (this.prisma as any).order.findMany({
      where: { organizationId }, include: { items: true }, take: 20000,
    });
    const inRange = orders.filter((o: any) => {
      const d = new Date(o.placedAt ?? o.createdAt);
      return d.getTime() >= from.getTime() && d.getTime() < toExclusive.getTime() && !REVENUE_EXCLUDED_STATUSES.includes(o.status);
    });
    const productIds = [...new Set(inRange.flatMap((o: any) => (o.items ?? []).map((i: any) => i.productId).filter(Boolean)))];
    const costRows = productIds.length
      ? await (this.prisma as any).productCost.findMany({ where: { productId: { in: productIds } } })
      : [];
    const costsByProduct = new Map<string, { costMinor: bigint; effectiveFrom: Date }[]>();
    for (const c of costRows) {
      const list = costsByProduct.get(c.productId) ?? [];
      list.push({ costMinor: BigInt(c.costMinor), effectiveFrom: new Date(c.effectiveFrom) });
      costsByProduct.set(c.productId, list);
    }
    const metrics = await (this.prisma as any).dailyAdMetric.findMany({ where: { organizationId }, take: 20000 });
    const adSpend = metrics
      .filter((m: any) => (m.adExternalId ?? "") === "" && new Date(m.date).getTime() >= from.getTime() && new Date(m.date).getTime() < toExclusive.getTime())
      .reduce((s: bigint, m: any) => s + BigInt(m.spendMinor), 0n);

    const perProduct = new Map<string, any>();
    let unlinkedRevenue = 0n;
    for (const o of inRange) {
      const orderDate = new Date(o.placedAt ?? o.createdAt);
      for (const item of o.items ?? []) {
        if (!item.productId) { unlinkedRevenue += BigInt(item.totalMinor); continue; }
        const p = perProduct.get(item.productId) ?? {
          productId: item.productId, name: item.name, units: 0, revenueMinor: 0n, cogsMinor: 0n, cogsKnown: true,
        };
        p.units += item.quantity;
        p.revenueMinor += BigInt(item.totalMinor);
        const cost = chooseCostForDate(costsByProduct.get(item.productId) ?? [], orderDate);
        if (cost === null) p.cogsKnown = false;
        else p.cogsMinor += cost * BigInt(item.quantity);
        perProduct.set(item.productId, p);
      }
    }
    const linkedRevenue = [...perProduct.values()].reduce((s, p) => s + p.revenueMinor, 0n);
    const products = [...perProduct.values()]
      .sort((a, b) => (b.revenueMinor > a.revenueMinor ? 1 : -1))
      .slice(0, limit)
      .map((p) => {
        const allocated: bigint = linkedRevenue > 0n ? (adSpend * BigInt(p.revenueMinor)) / linkedRevenue : 0n;
        const gross: bigint | null = p.cogsKnown ? BigInt(p.revenueMinor) - BigInt(p.cogsMinor) : null;
        return {
          name: p.name, units: p.units,
          revenue: formatMinor(p.revenueMinor),
          cogs: p.cogsKnown ? formatMinor(p.cogsMinor) : null,
          cogsKnown: p.cogsKnown,
          grossProfit: gross !== null ? formatMinor(gross) : null,
          allocatedAdSpend: formatMinor(allocated),
          contributionAfterAds: gross !== null ? formatMinor(gross - allocated) : null,
        };
      });
    return {
      range: { from: from.toISOString().slice(0, 10), to: new Date(toExclusive.getTime() - 86400000).toISOString().slice(0, 10) },
      totalAdSpend: formatMinor(adSpend),
      allocationMethod: "Total ad spend for the period allocated pro-rata by each product's revenue share. This is an allocation, not per-product tracked spend.",
      unlinkedItemsRevenue: formatMinor(unlinkedRevenue),
      products,
      note: products.length ? undefined : "No revenue orders with product items in this period.",
    };
  }

  /** Two periods side by side: the requested range vs the immediately
   *  preceding range of the same length. Deltas are null when the
   *  previous period's value is 0 — a percentage would be invented. */
  private async comparePeriods(organizationId: string, args: Record<string, unknown>) {
    const { from, toExclusive, days } = parseRange(args.from as string | undefined, args.to as string | undefined);
    const iso = (d: Date) => d.toISOString().slice(0, 10);
    const prevFrom = new Date(from.getTime() - days * 86400000);
    const [cur, prev]: any[] = await Promise.all([
      this.overview(organizationId, { from: iso(from), to: iso(new Date(toExclusive.getTime() - 86400000)) }),
      this.overview(organizationId, { from: iso(prevFrom), to: iso(new Date(from.getTime() - 86400000)) }),
    ]);
    // Minor-unit fields arrive as strings/BigInt from AnalyticsService,
    // so coerce first: a raw "0" string or 0n must still mean "no data".
    const pct = (c: unknown, p: unknown) => {
      const cn = Number(c as any), pn = Number(p as any);
      if (!Number.isFinite(cn) || !Number.isFinite(pn) || pn === 0) return null;
      return Math.round(((cn - pn) / Math.abs(pn)) * 1000) / 10;
    };
    const slim = (o: any) => ({
      range: o.range, orders: o.orders, revenue: o.revenue, revenueMinor: o.revenueMinor,
      adSpend: o.adSpend, adSpendMinor: o.adSpendMinor, contributionProfit: o.contributionProfit,
    });
    return {
      current: slim(cur),
      previous: slim(prev),
      deltasPercent: {
        orders: pct(cur.orders, prev.orders),
        revenue: pct(cur.revenueMinor, prev.revenueMinor),
        adSpend: pct(cur.adSpendMinor, prev.adSpendMinor),
        contributionProfit: pct(cur.contributionProfitMinor, prev.contributionProfitMinor),
      },
      note: prev.orders === 0 && Number(prev.revenueMinor) === 0
        ? "The previous period had no orders or revenue, so percentage deltas are null rather than invented."
        : undefined,
    };
  }

  private async knowledge(organizationId: string) {
    const [profile, policies, docs] = await Promise.all([
      (this.prisma as any).businessProfile.findUnique({ where: { organizationId } }),
      (this.prisma as any).businessPolicy.findMany({ where: { organizationId }, take: 20 }),
      (this.prisma as any).knowledgeDocument.findMany({ where: { organizationId }, take: 20, orderBy: { createdAt: "desc" } }),
    ]);
    const cap = (s: string | null | undefined) => (s ? s.slice(0, 500) : null);
    return {
      profile: profile ? {
        industry: profile.industry, description: cap(profile.description), goals: cap(profile.goals),
        brandVoice: cap(profile.brandVoice), websiteUrl: profile.websiteUrl,
      } : null,
      policies: policies.map((p: any) => ({ type: p.type, title: p.title, content: cap(p.content) })),
      documents: docs.map((d: any) => ({ kind: d.kind, title: d.title, content: cap(d.content) })),
    };
  }
}
