import { Injectable, Optional } from "@nestjs/common";
import { PrismaService } from "../prisma/prisma.service";
import { AnalyticsService, parseRange, REVENUE_EXCLUDED_STATUSES } from "../analytics/analytics.service";
import { chooseCostForDate } from "../analytics/metrics";
import { AttributionService } from "../attribution/attribution.service";
import { computeRfm, RFM_SEGMENTS } from "../messaging/rfm";
import { PlannedToolCall } from "./planner";
import { contactFactLines, deliveryFactLines, hoursFactLines, matchKnowledge, paymentFactLines } from "../inbox/business-brain";
import { detectAnomalies, DailyPoint } from "./anomaly";
import { formatMinor } from "@repo/contracts";
import { CompetitorsService } from "../competitors/competitors.service";
import { forecastRevenue, type DailyRevenuePoint } from "./forecast";

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
    @Optional() private readonly competitors?: CompetitorsService,
  ) {}


  async execute(organizationId: string, call: PlannedToolCall): Promise<unknown> {
    switch (call.tool) {
      case "get_analytics_overview": return this.overview(organizationId, call.args);
      case "get_campaign_performance": return this.campaigns(organizationId, call.args);
      case "get_attribution_report": return this.attributionReport(organizationId, call.args);
      case "list_products": return this.products(organizationId, call.args);
      case "get_orders_attention": return this.ordersAttention(organizationId);
      case "get_anomalies": return this.getAnomalies(organizationId, Number(call.args.days ?? 14));
      case "get_business_knowledge": return this.knowledge(organizationId, typeof call.args.query === "string" ? call.args.query : undefined);
      case "get_customer_segments": return this.customerSegments(organizationId);
      case "get_inventory_health": return this.inventoryHealth(organizationId);
      case "get_courier_performance": return this.courierPerformance(organizationId);
      case "get_product_profit": return this.productProfit(organizationId, call.args);
      case "compare_periods": return this.comparePeriods(organizationId, call.args);
      case "get_competitor_intelligence": return this.competitorIntelligence(organizationId, call.args);
      case "get_order_detail": return this.orderDetail(organizationId, call.args);
      case "get_customer_360": return this.customer360(organizationId, call.args);
      case "get_crm_pipeline": return this.crmPipeline(organizationId);
      case "get_inbox_performance": return this.inboxPerformance(organizationId);
      case "get_social_performance": return this.socialPerformance(organizationId);
      case "get_ad_account_health": return this.adAccountHealth(organizationId);
      case "get_usage_summary": return this.usageSummary(organizationId);
      case "get_team_performance": return this.teamPerformance(organizationId);
      case "get_automation_health": return this.automationHealth(organizationId);
      case "get_courier_rollup": return this.courierRollup(organizationId);
      case "get_sales_forecast": return this.salesForecast(organizationId, call.args);
      default: throw new Error(`Unknown tool: ${call.tool}`);

    }
  }


  // ----- AP3 tool universe (all read-only, org-scoped) -----

  private async orderDetail(organizationId: string, args: Record<string, unknown>) {
    const q = String(args.query ?? "").trim();
    if (!q) return { found: false, reason: "কোনো অর্ডার নম্বর দেওয়া হয়নি" };
    const p: any = this.prisma as any;
    const o = await p.order.findFirst({
      where: { organizationId, OR: [{ externalNumber: q }, { externalId: q }, { id: q }, { externalNumber: { contains: q } }] },
      orderBy: { createdAt: "desc" },
    });
    if (!o) return { found: false, reason: `“${q}” দিয়ে কোনো অর্ডার পাওয়া যায়নি` };
    const [items, shipments] = await Promise.all([
      p.orderItem.findMany({ where: { orderId: o.id }, take: 20 }),
      p.courierShipment.findMany({ where: { organizationId, orderId: o.id }, orderBy: { createdAt: "desc" }, take: 3 }),
    ]);
    return {
      found: true,
      orderNumber: o.externalNumber ?? o.externalId,
      status: o.status,
      source: o.source,
      payment: o.paymentMethod ?? null,
      isCod: Boolean(o.isCod),
      placedAt: new Date(o.createdAt).toISOString().slice(0, 10),
      subtotal: formatMinor(o.subtotalMinor ?? 0n, o.currency),
      shipping: formatMinor(o.shippingMinor ?? 0n, o.currency),
      discount: formatMinor(o.discountMinor ?? 0n, o.currency),
      total: formatMinor(o.totalMinor ?? 0n, o.currency),
      items: items.map((i: any) => ({ name: i.name, sku: i.sku ?? null, qty: i.quantity, total: formatMinor(i.totalMinor ?? 0n, o.currency) })),
      shipments: shipments.map((s: any) => ({ provider: s.provider, status: s.status, trackingCode: s.trackingCode ?? null })),
    };
  }

  private async customer360(organizationId: string, args: Record<string, unknown>) {
    const q = String(args.query ?? "").trim();
    if (!q) return { found: false, reason: "কোনো ফোন/নাম/ইমেইল দেওয়া হয়নি" };
    const p: any = this.prisma as any;
    const contains = { contains: q, mode: "insensitive" as const };
    const c = await p.customer.findFirst({
      where: { organizationId, mergedIntoId: null, OR: [{ phone: contains }, { email: contains }, { firstName: contains }, { lastName: contains }] },
      orderBy: { createdAt: "desc" },
    });
    if (!c) return { found: false, reason: `“${q}” দিয়ে কোনো কাস্টমার পাওয়া যায়নি` };
    const orders = await p.order.findMany({ where: { organizationId, customerId: c.id, isPractice: false }, orderBy: { createdAt: "desc" }, take: 50 });
    const lifetime = orders.filter((o: any) => !REVENUE_EXCLUDED_STATUSES.includes(o.status)).reduce((s: number, o: any) => s + Number(o.totalMinor ?? 0), 0);
    const lead = await p.lead.findFirst({ where: { organizationId, customerId: c.id }, orderBy: { createdAt: "desc" } }).catch(() => null);
    return {
      found: true,
      name: [c.firstName, c.lastName].filter(Boolean).join(" ") || "(নাম নেই)",
      phone: c.phone ?? null,
      email: c.email ?? null,
      orders: orders.length,
      lifetimeValue: formatMinor(BigInt(Math.round(lifetime)), orders[0]?.currency ?? "BDT"),
      lastOrder: orders[0] ? { number: orders[0].externalNumber ?? orders[0].externalId, status: orders[0].status, at: new Date(orders[0].createdAt).toISOString().slice(0, 10) } : null,
      leadStage: lead?.stage ?? null,
      customerSince: new Date(c.createdAt).toISOString().slice(0, 10),
    };
  }

  private async crmPipeline(organizationId: string) {
    const p: any = this.prisma as any;
    const leads = await p.lead.findMany({ where: { organizationId, mergedIntoId: null }, take: 2000 });
    const stages: Record<string, { count: number; valueMinor: number }> = {};
    let overdue = 0;
    const now = Date.now();
    for (const l of leads) {
      const s = (stages[l.stage] ??= { count: 0, valueMinor: 0 });
      s.count += 1;
      s.valueMinor += Number(l.valueMinor ?? 0);
      if (l.nextFollowUpAt && new Date(l.nextFollowUpAt).getTime() < now && !["won", "lost"].includes(l.stage)) overdue += 1;
    }
    return {
      totalLeads: leads.length,
      overdueFollowUps: overdue,
      stages: Object.entries(stages).map(([stage, v]) => ({ stage, leads: v.count, value: formatMinor(BigInt(Math.round(v.valueMinor)), "BDT") })),
    };
  }

  private async inboxPerformance(organizationId: string) {
    const p: any = this.prisma as any;
    const since = new Date(Date.now() - 30 * 86_400_000);
    const convs = await p.channelConversation.findMany({ where: { organizationId, createdAt: { gte: since } }, take: 5000 });
    const byStatus: Record<string, number> = {};
    const byChannel: Record<string, number> = {};
    let unassigned = 0;
    for (const c of convs) {
      byStatus[c.status] = (byStatus[c.status] ?? 0) + 1;
      byChannel[c.channel] = (byChannel[c.channel] ?? 0) + 1;
      if (c.status === "open" && !c.assignedUserId) unassigned += 1;
    }
    const themes = await p.aiUnansweredQuestion.findMany({ where: { organizationId, status: "open" }, orderBy: { count: "desc" }, take: 5 });
    return {
      windowDays: 30,
      conversations: convs.length,
      byStatus,
      byChannel,
      unassignedOpen: unassigned,
      topUnansweredThemes: themes.map((t2: any) => ({ question: t2.normalizedQuestion, askedTimes: t2.count, channel: t2.channel })),
    };
  }

  private async socialPerformance(organizationId: string) {
    const p: any = this.prisma as any;
    const since = new Date(Date.now() - 30 * 86_400_000);
    const posts = await p.socialPost.findMany({ where: { organizationId, createdAt: { gte: since } }, orderBy: { createdAt: "desc" }, take: 2000 });
    const byStatus: Record<string, number> = {};
    for (const post of posts) byStatus[post.status] = (byStatus[post.status] ?? 0) + 1;
    const failed = posts.find((x: any) => x.status === "failed");
    return {
      windowDays: 30,
      posts: posts.length,
      byStatus,
      latestFailure: failed ? { at: new Date(failed.createdAt).toISOString().slice(0, 10), error: failed.error ?? "কারণ রেকর্ড নেই" } : null,
    };
  }

  private async adAccountHealth(organizationId: string) {
    const p: any = this.prisma as any;
    const accounts = await p.adAccount.findMany({ where: { organizationId }, take: 100 });
    const byBucket: Record<string, number> = {};
    for (const a of accounts) byBucket[a.platformStatusBucket ?? "unknown"] = (byBucket[a.platformStatusBucket ?? "unknown"] ?? 0) + 1;
    return {
      accounts: accounts.length,
      byPlatformStatus: byBucket,
      notActive: accounts
        .filter((a: any) => a.status !== "ACTIVE" || (a.platformStatusBucket && a.platformStatusBucket !== "active"))
        .map((a: any) => ({ name: a.name, platform: a.platform, status: a.status, platformStatus: a.platformStatusBucket ?? null })),
    };
  }

  private async usageSummary(organizationId: string) {
    const p: any = this.prisma as any;
    const since = new Date(Date.now() - 30 * 86_400_000);
    const rows = await p.aIUsageRecord.findMany({ where: { organizationId, createdAt: { gte: since } }, take: 10000 });
    const byFeature: Record<string, { calls: number; inputTokens: number; outputTokens: number }> = {};
    const byProvider: Record<string, number> = {};
    const todayKey = new Date().toISOString().slice(0, 10);
    let today = 0;
    for (const r of rows) {
      const f = (byFeature[r.feature] ??= { calls: 0, inputTokens: 0, outputTokens: 0 });
      f.calls += 1;
      f.inputTokens += r.inputTokens ?? 0;
      f.outputTokens += r.outputTokens ?? 0;
      byProvider[r.provider] = (byProvider[r.provider] ?? 0) + 1;
      if (new Date(r.createdAt).toISOString().slice(0, 10) === todayKey) today += 1;
    }
    return { windowDays: 30, totalCalls: rows.length, callsToday: today, byFeature, byProvider };
  }

  private async teamPerformance(organizationId: string) {
    const p: any = this.prisma as any;
    const states = await p.agentState.findMany({ where: { organizationId }, take: 500 });
    const presence: Record<string, number> = {};
    for (const s of states) presence[s.status] = (presence[s.status] ?? 0) + 1;
    const open = await p.channelConversation.findMany({ where: { organizationId, status: "open" }, take: 5000 });
    const load: Record<string, number> = {};
    for (const c of open) if (c.assignedUserId) load[c.assignedUserId] = (load[c.assignedUserId] ?? 0) + 1;
    const since = new Date(Date.now() - 30 * 86_400_000);
    const closed = await p.channelConversation.count({ where: { organizationId, status: "closed", updatedAt: { gte: since } } }).catch(() => 0);
    return {
      agents: states.length,
      presence,
      openConversations: open.length,
      topLoad: Object.entries(load).sort((a, b) => b[1] - a[1]).slice(0, 5).map(([userId, count]) => ({ userId, openAssigned: count })),
      closedLast30Days: closed,
    };
  }

  private async automationHealth(organizationId: string) {
    const p: any = this.prisma as any;
    const since = new Date(Date.now() - 7 * 86_400_000);
    const runs = await p.automationRun.findMany({ where: { organizationId, createdAt: { gte: since } }, orderBy: { createdAt: "desc" }, take: 2000 });
    const byStatus: Record<string, number> = {};
    const byKind: Record<string, number> = {};
    for (const r of runs) {
      byStatus[r.status] = (byStatus[r.status] ?? 0) + 1;
      byKind[r.kind] = (byKind[r.kind] ?? 0) + 1;
    }
    return {
      windowDays: 7,
      runs: runs.length,
      byStatus,
      byKind,
      latestErrors: runs.filter((r: any) => r.status === "error").slice(0, 3).map((r: any) => ({ at: new Date(r.createdAt).toISOString(), kind: r.kind, detail: r.detail ?? null })),
    };
  }

  private async courierRollup(organizationId: string) {
    const p: any = this.prisma as any;
    const since = new Date(Date.now() - 30 * 86_400_000);
    const rows = await p.courierShipment.findMany({ where: { organizationId, createdAt: { gte: since } }, take: 5000 });
    const TERMINAL = ["delivered", "partial_delivered", "cancelled", "returned"];
    const byProvider: Record<string, { total: number; delivered: number; returned: number; codCollectedMinor: number; stuck: number }> = {};
    for (const s of rows) {
      const v = (byProvider[s.provider] ??= { total: 0, delivered: 0, returned: 0, codCollectedMinor: 0, stuck: 0 });
      v.total += 1;
      if (s.status === "delivered" || s.status === "partial_delivered") {
        v.delivered += 1;
        v.codCollectedMinor += Number(s.codAmountMinor ?? 0);
      }
      if (s.status === "returned") v.returned += 1;
      if (!TERMINAL.includes(s.status) && Date.now() - new Date(s.createdAt).getTime() > 72 * 3600_000) v.stuck += 1;
    }
    return {
      windowDays: 30,
      providers: Object.entries(byProvider).map(([provider, v]) => ({
        provider,
        shipments: v.total,
        delivered: v.delivered,
        returned: v.returned,
        deliveryRatePct: v.total ? Math.round((v.delivered / v.total) * 1000) / 10 : 0,
        codCollected: formatMinor(BigInt(Math.round(v.codCollectedMinor)), "BDT"),
        stuckOver72h: v.stuck,
      })),
    };
  }

  // ----- AP4: deterministic forecasting over real daily revenue -----

  private async salesForecast(organizationId: string, args: Record<string, unknown>) {
    const p: any = this.prisma as any;
    const days = Math.min(30, Math.max(7, Number(args.days ?? 14) || 14));
    const since = new Date(Date.now() - 30 * 86_400_000);
    const orders = await p.order.findMany({ where: { organizationId, isPractice: false, createdAt: { gte: since } }, take: 10000 });
    const byDay = new Map<string, number>();
    for (const o of orders) {
      if (REVENUE_EXCLUDED_STATUSES.includes(o.status)) continue;
      const key = new Date(o.createdAt).toISOString().slice(0, 10);
      byDay.set(key, (byDay.get(key) ?? 0) + Number(o.totalMinor ?? 0));
    }
    const series: DailyRevenuePoint[] = [];
    for (let i = 29; i >= 0; i--) {
      const key = new Date(Date.now() - i * 86_400_000).toISOString().slice(0, 10);
      series.push({ date: key, revenueMinor: byDay.get(key) ?? 0 });
    }
    const result = forecastRevenue(series, days, typeof args.scenarioGrowthPct === "number" ? args.scenarioGrowthPct : undefined);
    if (!result.available) return result;
    return {
      ...result,
      dailyBaseline: formatMinor(BigInt(result.dailyBaselineMinor), "BDT"),
      totalProjected: formatMinor(BigInt(result.totalProjectedMinor), "BDT"),
      totalRange: `${formatMinor(BigInt(result.totalLowMinor), "BDT")} – ${formatMinor(BigInt(result.totalHighMinor), "BDT")}`,
      days: result.days.map((d) => ({ date: d.date, projected: formatMinor(BigInt(d.projectedMinor), "BDT") })),
    };
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

  private async knowledge(organizationId: string, query?: string) {
    const [profile, policies, docs, allDocs] = await Promise.all([
      (this.prisma as any).businessProfile.findUnique({ where: { organizationId } }),
      (this.prisma as any).businessPolicy.findMany({ where: { organizationId }, take: 20 }),
      (this.prisma as any).knowledgeDocument.findMany({ where: { organizationId }, take: 20, orderBy: { createdAt: "desc" } }),
      // Milestone 77: a wider pool exists only for ranking.
      query ? (this.prisma as any).knowledgeDocument.findMany({ where: { organizationId }, take: 100 }) : Promise.resolve([]),
    ]);
    const cap = (s: string | null | undefined) => (s ? s.slice(0, 500) : null);
    // Milestone 77 (Business Brain): the Command Center facts
    // ride along — delivery/payment/contact/hours the owner
    // set in Settings, in the same verified lines the inbox
    // autopilot quotes.
    const facts = profile ? [
      ...deliveryFactLines(profile), ...paymentFactLines(profile),
      ...contactFactLines(profile), ...hoursFactLines(profile),
    ] : [];
    const matchedDocuments = query
      ? matchKnowledge(query, allDocs as any[], 5).map((m) => ({ kind: m.doc.kind, title: m.doc.title, content: cap(m.doc.content), matchScore: m.score }))
      : [];
    return {
      profile: profile ? {
        industry: profile.industry, description: cap(profile.description), goals: cap(profile.goals),
        brandVoice: cap(profile.brandVoice), websiteUrl: profile.websiteUrl,
        // Milestone 77: owner-set AI behaviour, visible to the model.
        aiInstructions: cap(profile.aiInstructions), aiReplyLanguage: profile.aiReplyLanguage ?? null,
      } : null,
      facts,
      policies: policies.map((p: any) => ({ type: p.type, title: p.title, content: cap(p.content) })),
      documents: docs.map((d: any) => ({ kind: d.kind, title: d.title, content: cap(d.content) })),
      matchedDocuments,
    };
  }

  private async competitorIntelligence(organizationId: string, args: Record<string, unknown>) {
    if (this.competitors) {
      const dossier = await this.competitors.exportDossier(organizationId, args.competitorId as string | undefined);
      return {
        summary: dossier.summary,
        trackedCompetitors: dossier.competitors.map((c) => ({
          name: c.competitor.name,
          activeAdsCount: c.activeAds,
          winningAdsCount: c.winningAdsCount,
          winningAdsSample: c.winningAds.slice(0, 3).map((a: any) => ({
            daysRunning: a.daysRunning,
            platforms: a.platforms,
            snippet: a.creativeText?.slice(0, 200),
          })),
        })),
        liveOpportunityAlerts: dossier.liveOpportunityAlerts.slice(0, 5).map((alt: any) => ({
          title: alt.title,
          detail: alt.detail,
        })),
        priceDifferences: dossier.priceComparisonMatrix
          .filter((p) => p.competitorPrices.length > 0)
          .slice(0, 5)
          .map((p) => ({
            product: p.productName,
            ourPrice: formatMinor(BigInt(p.ownPriceMinor), p.currency),
            competitorPrice: `${p.competitorPrices[0].competitorName} at ${formatMinor(BigInt(p.competitorPrices[0].priceMinor), p.competitorPrices[0].currency)}`,
            diffPercent: p.competitorPrices[0].diffPercent,
          })),
      };
    }

    // Direct fallback from prisma
    const [comps, alerts] = await Promise.all([
      (this.prisma as any).competitor.findMany({ where: { organizationId }, take: 10 }),
      (this.prisma as any).competitorInsight.findMany({
        where: { organizationId, provider: "alert-engine" },
        take: 5,
        orderBy: { createdAt: "desc" },
      }),
    ]);
    return {
      trackedCompetitors: comps.map((c: any) => ({ name: c.name, website: c.websiteUrl })),
      liveOpportunityAlerts: alerts.map((a: any) => ({ title: a.title, detail: a.detail })),
    };
  }
}

