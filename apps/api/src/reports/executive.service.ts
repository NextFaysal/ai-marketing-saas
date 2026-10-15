import { Injectable } from "@nestjs/common";
import { PrismaService } from "../prisma/prisma.service";
import { AnalyticsService, parseRange } from "../analytics/analytics.service";
import { CustomReportsService } from "./custom-reports.service";
import { computeRfm } from "../messaging/rfm";

/**
 * Reports Advanced RP6 — the Executive Summary: one
 * payload across sales, ads, customers and operations,
 * every number from the same services the product
 * itself uses (computeRange, the RP2 ads grouping,
 * computeRfm, real order/shipment rows). The INTERNAL
 * payload includes contribution profit; the public
 * share rendering strips it (report-shares.service).
 */
@Injectable()
export class ExecutiveService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly analytics: AnalyticsService,
    private readonly custom: CustomReportsService,
  ) {}

  async executive(organizationId: string, fromStr?: string, toStr?: string) {
    const { from, toExclusive } = parseRange(fromStr, toStr);
    const p = this.prisma as any;
    const range = await this.analytics.computeRange(organizationId, from, toExclusive);
    const [newCustomers, rfm, statusGroups, campaignsRun, topItems] = await Promise.all([
      p.customer.count({ where: { organizationId, createdAt: { gte: from, lt: toExclusive } } }).catch(() => 0),
      computeRfm(this.prisma, organizationId).catch(() => []),
      // CX12a: executive analytics never count practice orders.
      p.order.groupBy({ by: ["status"], where: { organizationId, isPractice: false, createdAt: { gte: from, lt: toExclusive } }, _count: { _all: true } }).catch(() => []),
      this.custom.run(organizationId, { dimension: "campaign", metrics: ["spend", "conversions", "cpa"], from: fromStr, to: toStr, rangePreset: fromStr && toStr ? undefined : "last_30d" }).catch(() => null),
      p.orderItem.groupBy({
        by: ["name"],
        where: { order: { organizationId, isPractice: false, status: { notIn: ["cancelled", "refunded", "failed"] }, OR: [{ placedAt: { gte: from, lt: toExclusive } }, { placedAt: null, createdAt: { gte: from, lt: toExclusive } }] } },
        _sum: { quantity: true, totalMinor: true }, orderBy: { _sum: { totalMinor: "desc" } }, take: 5,
      }).catch(() => []),
    ]);
    const segments: Record<string, number> = {};
    for (const r of rfm ?? []) segments[r.segment] = (segments[r.segment] ?? 0) + 1;
    const ordersByStatus: Record<string, number> = {};
    for (const g of statusGroups ?? []) ordersByStatus[String(g.status)] = Number(g._count?._all ?? 0);
    return {
      range: { from: from.toISOString().slice(0, 10), to: new Date(toExclusive.getTime() - 86400000).toISOString().slice(0, 10) },
      sales: {
        orders: range.totals.orders,
        revenueMinor: String(range.totals.revenueMinor),
        refundedMinor: String(range.totals.refundedMinor),
        averageOrderValueMinor: String(range.totals.averageOrderValueMinor),
        profit: {
          contributionProfitMinor: String(range.profit.contributionProfitMinor),
          contributionMarginPercent: range.profit.contributionMarginPercent,
        },
      },
      ads: {
        spendMinor: String(range.totals.adSpendMinor),
        impressions: range.totals.impressions,
        clicks: range.totals.clicks,
        platformConversions: range.totals.platformConversions,
        mer: range.kpis.mer, platformRoas: range.kpis.platformRoas,
        topCampaigns: (campaignsRun?.rows ?? []).slice(0, 5).map((r: any) => ({
          name: r.label, spendMinor: r.values.spend, conversions: r.values.conversions, cpaMinor: r.values.cpa,
        })),
      },
      customers: {
        newInRange: Number(newCustomers ?? 0),
        withOrders: (rfm ?? []).length,
        segments,
      },
      operations: {
        ordersByStatus,
        topProducts: (topItems ?? []).map((g: any) => ({
          name: String(g.name), quantity: Number(g._sum?.quantity ?? 0), totalMinor: String(g._sum?.totalMinor ?? 0n),
        })),
      },
    };
  }
}
