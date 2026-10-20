import { Injectable } from "@nestjs/common";
import { PrismaService } from "../prisma/prisma.service";
import { computeAdKpis, chooseCostForDate, contributionProfit } from "./metrics";
import { badRequest } from "../i18n/api-exception";

export const REVENUE_EXCLUDED_STATUSES = ["cancelled", "refunded", "failed"];

export function parseRange(fromStr?: string, toStr?: string): { from: Date; toExclusive: Date; days: number } {
  const today = new Date();
  const to = toStr ? new Date(`${toStr}T00:00:00.000Z`) : new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate()));
  const from = fromStr ? new Date(`${fromStr}T00:00:00.000Z`) : new Date(to.getTime() - 29 * 86400000);
  if (Number.isNaN(from.getTime()) || Number.isNaN(to.getTime())) throw badRequest("analytics.invalidFromToDateExpectedYyyy");
  if (from > to) throw badRequest("analytics.fromMustBeBeforeTo");
  const toExclusive = new Date(to.getTime() + 86400000);
  const days = Math.round((toExclusive.getTime() - from.getTime()) / 86400000);
  if (days > 366) throw badRequest("analytics.rangeTooLargeMax366Days");
  return { from, toExclusive, days };
}

function dayKey(d: Date): string { return d.toISOString().slice(0, 10); }
function moneyStr(v: bigint | number): string { return BigInt(v).toString(); }

@Injectable()
export class AnalyticsService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * Core range computation shared by the overview endpoint and the daily
   * aggregate recompute. Revenue = orders by effective date
   * (placedAt, fallback createdAt) excluding cancelled/refunded/failed.
   * Platform-reported conversions are reported separately from orders;
   * the two are never merged into one "conversions" number.
   */
  async computeRange(organizationId: string, from: Date, toExclusive: Date) {
    const [orders, metrics] = await Promise.all([
      (this.prisma as any).order.findMany({ where: { organizationId }, include: { items: true }, take: 20000 }),
      (this.prisma as any).dailyAdMetric.findMany({ where: { organizationId }, take: 20000 }),
    ]);
    const inRange = (d: Date) => d.getTime() >= from.getTime() && d.getTime() < toExclusive.getTime();
    const rangeOrders = orders.filter((o: any) => inRange(new Date(o.placedAt ?? o.createdAt)));
    const revenueOrders = rangeOrders.filter((o: any) => !REVENUE_EXCLUDED_STATUSES.includes(o.status));
    // Campaign totals come from campaign-level rows ONLY: ad-level rows
    // (Phase G sync) describe the same spend per ad and would double it.
    const rangeMetrics = metrics.filter((m: any) => inRange(new Date(m.date)) && (m.adExternalId ?? "") === "");

    // COGS: per order item, the product cost in effect on the order date.
    const productIds = [...new Set(revenueOrders.flatMap((o: any) => (o.items ?? []).map((i: any) => i.productId).filter(Boolean)))];
    const costRows = productIds.length
      ? await (this.prisma as any).productCost.findMany({ where: { productId: { in: productIds } } })
      : [];
    const costsByProduct = new Map<string, { costMinor: bigint; effectiveFrom: Date }[]>();
    for (const c of costRows) {
      const list = costsByProduct.get(c.productId) ?? [];
      list.push({ costMinor: BigInt(c.costMinor), effectiveFrom: new Date(c.effectiveFrom) });
      costsByProduct.set(c.productId, list);
    }
    const cogsByOrder = new Map<string, { cogs: bigint; fullyKnown: boolean }>();
    for (const o of revenueOrders) {
      const orderDate = new Date(o.placedAt ?? o.createdAt);
      let cogs = 0n, fullyKnown = (o.items ?? []).length > 0;
      for (const item of o.items ?? []) {
        const cost = item.productId ? chooseCostForDate(costsByProduct.get(item.productId) ?? [], orderDate) : null;
        if (cost === null) { fullyKnown = false; continue; }
        cogs += cost * BigInt(item.quantity);
      }
      cogsByOrder.set(o.id, { cogs, fullyKnown });
    }

    const revenue = revenueOrders.reduce((s: bigint, o: any) => s + BigInt(o.totalMinor), 0n);
    const refunded = rangeOrders.reduce((s: bigint, o: any) => s + BigInt(o.refundedMinor ?? 0), 0n);
    const cogs = [...cogsByOrder.values()].reduce((s, v) => s + v.cogs, 0n);
    const cogsKnownOrders = [...cogsByOrder.values()].filter((v) => v.fullyKnown).length;

    const spend = rangeMetrics.reduce((s: bigint, m: any) => s + BigInt(m.spendMinor), 0n);
    const impressions = rangeMetrics.reduce((s: number, m: any) => s + m.impressions, 0);
    const clicks = rangeMetrics.reduce((s: number, m: any) => s + m.clicks, 0);
    const platformConversions = rangeMetrics.reduce((s: number, m: any) => s + m.platformConversions, 0);
    const platformConversionValue = rangeMetrics.reduce((s: bigint, m: any) => s + BigInt(m.platformConversionValueMinor), 0n);

    const kpis = computeAdKpis({ spendMinor: spend, impressions, clicks, platformConversions, platformConversionValueMinor: platformConversionValue, revenueMinor: revenue });
    const contribution = contributionProfit({ revenueMinor: revenue, refundedMinor: refunded, cogsMinor: cogs, adSpendMinor: spend });

    // Daily series
    const daily = new Map<string, { date: string; orders: number; revenueMinor: bigint; spendMinor: bigint; cogsMinor: bigint; refundedMinor: bigint; cogsKnownOrders: number }>();
    const ensureDay = (key: string) => daily.get(key) ?? { date: key, orders: 0, revenueMinor: 0n, spendMinor: 0n, cogsMinor: 0n, refundedMinor: 0n, cogsKnownOrders: 0 };
    for (const o of revenueOrders) {
      const key = dayKey(new Date(o.placedAt ?? o.createdAt));
      const d = ensureDay(key); daily.set(key, d);
      d.orders++; d.revenueMinor += BigInt(o.totalMinor);
      d.cogsMinor += cogsByOrder.get(o.id)?.cogs ?? 0n;
      if (cogsByOrder.get(o.id)?.fullyKnown) d.cogsKnownOrders++;
      d.refundedMinor += BigInt(o.refundedMinor ?? 0);
    }
    for (const m of rangeMetrics) {
      const key = dayKey(new Date(m.date));
      const d = ensureDay(key); daily.set(key, d);
      d.spendMinor += BigInt(m.spendMinor);
    }

    // Campaigns
    const campaignMap = new Map<string, any>();
    for (const m of rangeMetrics) {
      const key = `${m.platform}::${m.adAccountId}::${m.campaignExternalId}::${m.source}`;
      const e = campaignMap.get(key) ?? {
        platform: m.platform, source: m.source, campaignExternalId: m.campaignExternalId,
        campaignName: m.campaignName ?? null, spendMinor: 0n, impressions: 0, clicks: 0,
        platformConversions: 0, platformConversionValueMinor: 0n,
      };
      e.spendMinor += BigInt(m.spendMinor); e.impressions += m.impressions; e.clicks += m.clicks;
      e.platformConversions += m.platformConversions; e.platformConversionValueMinor += BigInt(m.platformConversionValueMinor);
      if (m.campaignName) e.campaignName = m.campaignName;
      campaignMap.set(key, e);
    }
    const campaigns = [...campaignMap.values()].map((e) => {
      const k = computeAdKpis({ spendMinor: e.spendMinor, impressions: e.impressions, clicks: e.clicks, platformConversions: e.platformConversions, platformConversionValueMinor: e.platformConversionValueMinor, revenueMinor: 0n });
      return {
        ...e, spendMinor: moneyStr(e.spendMinor), platformConversionValueMinor: moneyStr(e.platformConversionValueMinor),
        ctrPercent: k.ctrPercent, cpcMinor: k.cpcMinor, cpaMinor: k.cpaMinor, platformRoas: k.platformRoas,
      };
    }).sort((a, b) => Number(BigInt(b.spendMinor) - BigInt(a.spendMinor)));

    // Platforms
    const platformMap = new Map<string, any>();
    for (const m of rangeMetrics) {
      const e = platformMap.get(m.platform) ?? { platform: m.platform, spendMinor: 0n, impressions: 0, clicks: 0, platformConversions: 0, platformConversionValueMinor: 0n };
      e.spendMinor += BigInt(m.spendMinor); e.impressions += m.impressions; e.clicks += m.clicks;
      e.platformConversions += m.platformConversions; e.platformConversionValueMinor += BigInt(m.platformConversionValueMinor);
      platformMap.set(m.platform, e);
    }
    const platforms = [...platformMap.values()].map((e) => ({
      ...e, spendMinor: moneyStr(e.spendMinor), platformConversionValueMinor: moneyStr(e.platformConversionValueMinor),
      platformRoas: computeAdKpis({ spendMinor: e.spendMinor, impressions: e.impressions, clicks: e.clicks, platformConversions: e.platformConversions, platformConversionValueMinor: e.platformConversionValueMinor, revenueMinor: 0n }).platformRoas,
    }));

    const currencies = new Set<string>([
      ...rangeOrders.map((o: any) => o.currency), ...rangeMetrics.map((m: any) => m.currency),
    ]);

    return {
      range: { from: dayKey(from), to: dayKey(new Date(toExclusive.getTime() - 86400000)) },
      totals: {
        orders: revenueOrders.length,
        revenueMinor: moneyStr(revenue),
        refundedMinor: moneyStr(refunded),
        averageOrderValueMinor: revenueOrders.length ? moneyStr(revenue / BigInt(revenueOrders.length)) : "0",
        adSpendMinor: moneyStr(spend),
        impressions, clicks, platformConversions,
        platformConversionValueMinor: moneyStr(platformConversionValue),
      },
      kpis: {
        ctrPercent: kpis.ctrPercent, cpcMinor: kpis.cpcMinor, cpmMinor: kpis.cpmMinor,
        cpaMinor: kpis.cpaMinor, // spend / platform-reported conversions
        platformRoas: kpis.platformRoas, // platform value / spend
        mer: kpis.mer, // total revenue / total spend
        costPerOrderMinor: revenueOrders.length ? Math.round((Number(spend) / revenueOrders.length) * 100) / 100 : null,
      },
      profit: {
        revenueMinor: moneyStr(revenue), refundedMinor: moneyStr(refunded),
        cogsMinor: moneyStr(cogs), adSpendMinor: moneyStr(spend),
        contributionProfitMinor: moneyStr(contribution.profitMinor),
        contributionMarginPercent: contribution.marginPercent,
        cogsCoverage: {
          ordersWithFullCost: cogsKnownOrders, ordersTotal: revenueOrders.length,
          percent: revenueOrders.length ? Math.round((cogsKnownOrders / revenueOrders.length) * 10000) / 100 : 0,
        },
        note: "Courier/delivery cost and payment fees are not in the system yet, so contribution profit excludes them. COGS uses the product cost in effect on the order date; orders without full cost data lower the coverage percentage instead of being guessed.",
      },
      platforms,
      campaigns,
      dailySeries: [...daily.values()].sort((a, b) => a.date.localeCompare(b.date)).map((d) => ({
        date: d.date, orders: d.orders, revenueMinor: moneyStr(d.revenueMinor),
        spendMinor: moneyStr(d.spendMinor), cogsMinor: moneyStr(d.cogsMinor), refundedMinor: moneyStr(d.refundedMinor),
      })),
      currencies: [...currencies],
      mixedCurrencies: currencies.size > 1,
      _dailyRaw: daily, _orders: revenueOrders,
    };
  }

  async overview(organizationId: string, fromStr?: string, toStr?: string) {
    const { from, toExclusive, days } = parseRange(fromStr, toStr);
    const result = await this.computeRange(organizationId, from, toExclusive);
    const { _dailyRaw, _orders, ...pub } = result as any;
    // Reports Advanced RP5: previous-period comparison —
    // the same computation over the immediately preceding
    // equal-length window. A delta is null when the
    // previous value is 0 and the current is not (a
    // percentage would be fabricated); 0 when both are 0.
    const prevTo = from;
    const prevFrom = new Date(from.getTime() - days * 86400000);
    const prev = await this.computeRange(organizationId, prevFrom, prevTo).catch(() => null);
    const delta = (cur: number, old: number): number | null => {
      if (old === 0) return cur === 0 ? 0 : null;
      return Math.round(((cur - old) / old) * 10000) / 100;
    };
    const cur = {
      orders: Number(result.totals.orders ?? 0),
      revenueMinor: BigInt(result.totals.revenueMinor ?? 0),
      adSpendMinor: BigInt(result.totals.adSpendMinor ?? 0),
      profitMinor: BigInt(result.profit.contributionProfitMinor ?? 0),
    };
    const old = prev ? {
      orders: Number(prev.totals.orders ?? 0),
      revenueMinor: BigInt(prev.totals.revenueMinor ?? 0),
      adSpendMinor: BigInt(prev.totals.adSpendMinor ?? 0),
      profitMinor: BigInt(prev.profit.contributionProfitMinor ?? 0),
    } : null;
    (pub as any).comparison = old ? {
      previousRange: { from: dayKey(prevFrom), to: dayKey(new Date(prevTo.getTime() - 86400000)) },
      previous: {
        orders: old.orders, revenueMinor: old.revenueMinor.toString(),
        adSpendMinor: old.adSpendMinor.toString(), profitMinor: old.profitMinor.toString(),
      },
      deltas: {
        orders: delta(cur.orders, old.orders),
        revenue: delta(Number(cur.revenueMinor), Number(old.revenueMinor)),
        adSpend: delta(Number(cur.adSpendMinor), Number(old.adSpendMinor)),
        profit: delta(Number(cur.profitMinor), Number(old.profitMinor)),
      },
    } : null;
    return pub;
  }

  /** Persist DailyMetricAggregate rows for the range (used by reports in Milestone 6). */
  async recomputeAggregates(organizationId: string, fromStr?: string, toStr?: string) {
    const { from, toExclusive, days } = parseRange(fromStr, toStr);
    const result = await this.computeRange(organizationId, from, toExclusive);
    const spendByDay = new Map<string, bigint>();
    const metrics = await (this.prisma as any).dailyAdMetric.findMany({ where: { organizationId }, take: 20000 });
    for (const m of metrics) {
      const t = new Date(m.date).getTime();
      if ((m.adExternalId ?? "") === "" && t >= from.getTime() && t < toExclusive.getTime()) {
        const key = dayKey(new Date(m.date));
        spendByDay.set(key, (spendByDay.get(key) ?? 0n) + BigInt(m.spendMinor));
      }
    }
    let written = 0;
    for (let i = 0; i < days; i++) {
      const date = new Date(from.getTime() + i * 86400000);
      const key = dayKey(date);
      const day = (result as any)._dailyRaw.get(key);
      const data = {
        orders: day?.orders ?? 0, revenueMinor: day?.revenueMinor ?? 0n,
        refundedMinor: day?.refundedMinor ?? 0n, cogsMinor: day?.cogsMinor ?? 0n,
        cogsKnownOrders: day?.cogsKnownOrders ?? 0, adSpendMinor: spendByDay.get(key) ?? 0n,
      };
      const existing = await (this.prisma as any).dailyMetricAggregate.findFirst({ where: { organizationId, date } });
      if (existing) await (this.prisma as any).dailyMetricAggregate.update({ where: { id: existing.id }, data });
      else await (this.prisma as any).dailyMetricAggregate.create({ data: { organizationId, date, ...data } });
      written++;
    }
    return { daysWritten: written };
  }
}
