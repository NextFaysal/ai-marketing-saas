import { Injectable } from "@nestjs/common";
import { PrismaService } from "../prisma/prisma.service";
import { AnalyticsService, parseRange } from "../analytics/analytics.service";
import { AttributionService } from "../attribution/attribution.service";
import { PlannedToolCall } from "./planner";
import { detectAnomalies, DailyPoint } from "./anomaly";
import { formatMinor } from "@repo/contracts";

/**
 * Read-only AI tools. Every tool is organization-scoped by construction
 * (the org id comes from the authenticated request, never from the model),
 * returns a compact JSON summary, and is executed through this single
 * choke point so ChatService can log each call to AIAction.
 * There are deliberately NO write tools in Milestone 6.
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
