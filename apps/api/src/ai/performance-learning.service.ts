import { Injectable, Logger, Optional } from "@nestjs/common";
import { PrismaService } from "../prisma/prisma.service";
import { LearningService } from "./learning.service";

/**
 * SA-B5 (Smart AI Phase 0, P7): performance learning — the Brain
 * learns what actually WORKED, from the org's own rows:
 * best-sellers, why inbox sales were lost, review patterns,
 * which ad campaigns returned their spend, broadcast delivery,
 * top social posts.
 *
 * Discipline:
 *  - NO LLM anywhere in this service. Every number is a
 *    deterministic aggregate of real rows (Step-0 verified
 *    sources only), labelled with the period it covers. Nothing
 *    is estimated, extrapolated or invented; a source with no
 *    rows contributes an honest empty section.
 *  - INTERNAL class (plan law L3): order counts, revenue and
 *    campaign performance are the owner's business numbers.
 *    Snapshots are served ONLY through OrgBrainService's
 *    internal audience; a customer context never sees them.
 *  - Findings also surface as SUGGESTED LearnedItem facts
 *    (sourceType "performance") for the human review queue —
 *    approving one lands it as an INTERNAL knowledge note, and
 *    LearningService refuses to make a performance fact public
 *    (metrics are never public, D3 + L3).
 *
 * Windows: each run computes the trailing 7-day and 30-day
 * windows, calendar-aligned to UTC days ([start, end)), and
 * upserts on (organizationId, periodStart, periodEnd) — a
 * re-run of the same day corrects the same rows instead of
 * duplicating them. The Brain reads the latest 7-day snapshot.
 *
 * Sources that do NOT exist as data (Step 0, recorded in the
 * acceptance doc): per-broadcast reply attribution (broadcast
 * replies land in the inbox unattributed) and structured
 * order-cancellation reasons (only the raw status exists) —
 * neither is fabricated here; the inbox outcome vocabulary
 * (sale / no_sale_price / no_sale_stock / ...) is the real
 * loss-reason evidence.
 */

export const PERFORMANCE_WINDOWS_DAYS = [7, 30];
const MAX_ORGS_PER_SWEEP = 200;
const DEAD_STATUS = /(cancel|refund|fail)/i;

const bi = (v: any): bigint => {
  try {
    return BigInt(v ?? 0);
  } catch {
    return 0n;
  }
};
const isDeadStatus = (status: any): boolean => DEAD_STATUS.test(String(status ?? ""));
const inWindow = (d: any, start: Date, end: Date): boolean => {
  if (!d) return false;
  const t = d instanceof Date ? d.getTime() : new Date(d).getTime();
  return Number.isFinite(t) && t >= start.getTime() && t < end.getTime();
};
const round2 = (n: number): number => Math.round(n * 100) / 100;

/** Calendar-aligned trailing window: [start, end) in UTC days. */
export function performancePeriod(days: number, now: Date): { start: Date; end: Date } {
  const end = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + 1));
  const start = new Date(end.getTime() - days * 24 * 60 * 60 * 1000);
  return { start, end };
}

export interface PerformanceComputeResult {
  status: "ok" | "skipped";
  reason?: string;
  snapshots: number;
  suggestions: number;
}

@Injectable()
export class PerformanceLearningService {
  private readonly logger = new Logger(PerformanceLearningService.name);
  private learningFallback?: LearningService;

  constructor(
    @Optional() private readonly prisma?: PrismaService,
    @Optional() private readonly learning?: LearningService,
  ) {}

  private db(): any {
    if (!this.prisma) throw new Error("PerformanceLearningService: PrismaService is not available");
    return this.prisma as any;
  }

  private learn(): LearningService {
    return this.learning ?? (this.learningFallback ??= new LearningService(this.prisma as any));
  }

  private async rows<T>(call: () => Promise<T>, fallback: T): Promise<T> {
    try {
      return (await call()) ?? fallback;
    } catch {
      return fallback;
    }
  }

  /** Compute + store both window snapshots for one org, then
   * derive the review-queue findings from the 7-day window.
   * Never throws. */
  async computeOrg(organizationId: string, now: Date = new Date()): Promise<PerformanceComputeResult> {
    const out: PerformanceComputeResult = { status: "ok", snapshots: 0, suggestions: 0 };
    try {
      const widest = performancePeriod(Math.max(...PERFORMANCE_WINDOWS_DAYS), now);
      const hasData = await this.orgHasAnyData(organizationId, widest);
      if (!hasData) {
        await this.learn()
          .saveState(organizationId, "performance", { lastStatus: "skipped", lastDetail: { reason: "no_source_data" } })
          .catch(() => undefined);
        return { ...out, status: "skipped", reason: "no_source_data" };
      }
      let weekMetrics: any = null;
      let weekSnapshotId: string | null = null;
      for (const days of PERFORMANCE_WINDOWS_DAYS) {
        const { start, end } = performancePeriod(days, now);
        const metrics = await this.computeWindow(organizationId, days, start, end);
        const row = await this.db().performanceSnapshot.upsert({
          where: { organizationId_periodStart_periodEnd: { organizationId, periodStart: start, periodEnd: end } },
          create: { organizationId, periodStart: start, periodEnd: end, metrics, computedAt: now },
          update: { metrics, computedAt: now },
        });
        out.snapshots++;
        if (days === 7) {
          weekMetrics = metrics;
          weekSnapshotId = row?.id ?? null;
        }
      }
      if (weekMetrics) {
        out.suggestions = await this.createInsightSuggestions(organizationId, weekMetrics, weekSnapshotId);
      }
      await this.learn()
        .saveState(organizationId, "performance", {
          lastStatus: "ok",
          lastDetail: { snapshots: out.snapshots, suggestions: out.suggestions },
        })
        .catch(() => undefined);
      return out;
    } catch (e) {
      this.logger.error(`performance compute failed for org ${organizationId}: ${e instanceof Error ? e.message : String(e)}`);
      return { ...out, status: "skipped", reason: "compute_failed" };
    }
  }

  /** Any source row at all inside the widest window — an org
   * with genuinely nothing to learn from gets no empty
   * snapshots (silence over noise). */
  private async orgHasAnyData(organizationId: string, w: { start: Date; end: Date }): Promise<boolean> {
    const checks: Array<Promise<number>> = [
      this.rows(() => this.db().channelConversation.count({ where: { organizationId, lastMessageAt: { gte: w.start, lt: w.end } } }), 0),
      this.rows(() => this.db().order.count({ where: { organizationId, createdAt: { gte: w.start, lt: w.end } } }), 0),
      this.rows(() => this.db().dailyAdMetric.count({ where: { organizationId, date: { gte: w.start, lt: w.end } } }), 0),
      this.rows(() => this.db().broadcast.count({ where: { organizationId, sentAt: { gte: w.start, lt: w.end } } }), 0),
      this.rows(() => this.db().socialPost.count({ where: { organizationId, publishedAt: { gte: w.start, lt: w.end } } }), 0),
    ];
    const counts = await Promise.all(checks);
    return counts.some((c) => (c ?? 0) > 0);
  }

  private async computeWindow(organizationId: string, days: number, start: Date, end: Date): Promise<any> {
    const range = { gte: start, lt: end };
    const metrics: any = {
      windowDays: days,
      periodStart: start.toISOString(),
      periodEnd: end.toISOString(),
      inbox: await this.inboxMetrics(organizationId, range),
      sales: await this.salesMetrics(organizationId, range),
      ads: await this.adsMetrics(organizationId, range),
      broadcasts: await this.broadcastMetrics(organizationId, range),
      social: await this.socialMetrics(organizationId, range),
    };
    return metrics;
  }

  // ---------- inbox outcomes ----------
  private async inboxMetrics(organizationId: string, range: { gte: Date; lt: Date }) {
    const handled = await this.rows(
      () => this.db().channelConversation.count({ where: { organizationId, isPractice: false, lastMessageAt: range } }),
      0,
    );
    const closedRows = await this.rows<any[]>(
      () =>
        this.db().channelConversation.findMany({
          where: { organizationId, isPractice: false, status: "closed" },
        }),
      [],
    );
    const closed = (closedRows ?? []).filter((c: any) => inWindow(c.resolvedAt ?? c.updatedAt, range.gte, range.lt));
    const outcomes: Record<string, number> = {};
    for (const c of closed) {
      const key = c.outcome ? String(c.outcome) : "unclassified";
      outcomes[key] = (outcomes[key] ?? 0) + 1;
    }
    // AI-resolved = closed with at least one autopilot reply and
    // NO staff-sent message: the conversation the AI handled end
    // to end. Deterministic from ChannelMessage authorship.
    let aiResolved = 0;
    if (closed.length) {
      const ids = closed.map((c: any) => c.id);
      const msgs = await this.rows<any[]>(
        () => this.db().channelMessage.findMany({ where: { conversationId: { in: ids }, direction: "out" } }),
        [],
      );
      const aiSeen = new Set<string>();
      const staffSeen = new Set<string>();
      for (const m of msgs ?? []) {
        if (m.autoReply) aiSeen.add(m.conversationId);
        if (m.sentByUserId) staffSeen.add(m.conversationId);
      }
      aiResolved = ids.filter((id: string) => aiSeen.has(id) && !staffSeen.has(id)).length;
    }
    const rated = closed.filter((c: any) => c.csatRating != null);
    const csatAvg = rated.length
      ? round2(rated.reduce((s: number, c: any) => s + Number(c.csatRating), 0) / rated.length)
      : null;
    const chatOrders = await this.rows<any[]>(
      () =>
        this.db().order.findMany({
          where: { organizationId, isPractice: false, conversationId: { not: null }, createdAt: range },
        }),
      [],
    );
    let chatValue = 0n;
    for (const o of chatOrders ?? []) if (!isDeadStatus(o.status)) chatValue += bi(o.totalMinor);
    return {
      conversationsHandled: handled,
      closed: closed.length,
      aiResolved,
      aiResolvedShare: closed.length ? round2(aiResolved / closed.length) : null,
      outcomes,
      ordersFromInbox: (chatOrders ?? []).length,
      ordersFromInboxValueMinor: chatValue.toString(),
      csatAvg,
      csatCount: rated.length,
    };
  }

  // ---------- sales: orders, best-sellers, returns, reviews ----------
  private async salesMetrics(organizationId: string, range: { gte: Date; lt: Date }) {
    const orders = await this.rows<any[]>(
      () => this.db().order.findMany({ where: { organizationId, isPractice: false, createdAt: range } }),
      [],
    );
    const live = (orders ?? []).filter((o: any) => !isDeadStatus(o.status));
    let revenue = 0n;
    for (const o of live) revenue += bi(o.totalMinor);
    const cancelled = (orders ?? []).filter((o: any) => /cancel/i.test(String(o.status ?? ""))).length;
    const refunded = (orders ?? []).filter((o: any) => /refund/i.test(String(o.status ?? ""))).length;

    let topProducts: any[] = [];
    if (live.length) {
      const liveIds = new Set(live.map((o: any) => o.id));
      const items = await this.rows<any[]>(
        () => this.db().orderItem.findMany({ where: { orderId: { in: [...liveIds] } } }),
        [],
      );
      const byProduct = new Map<string, { productId: string | null; name: string; qty: number; revenue: bigint }>();
      for (const it of items ?? []) {
        const key = it.productId ? `p:${it.productId}` : `n:${String(it.name ?? "")}`;
        const cur = byProduct.get(key) ?? { productId: it.productId ?? null, name: String(it.name ?? ""), qty: 0, revenue: 0n };
        cur.qty += Number(it.quantity ?? 0);
        cur.revenue += bi(it.totalMinor);
        byProduct.set(key, cur);
      }
      topProducts = [...byProduct.values()]
        .sort((a, b) => b.qty - a.qty || (b.revenue > a.revenue ? 1 : -1))
        .slice(0, 5)
        .map((p) => ({ productId: p.productId, name: p.name, qty: p.qty, revenueMinor: p.revenue.toString() }));
    }

    const returns = await this.rows<any[]>(
      () => this.db().returnRequest.findMany({ where: { organizationId, createdAt: range } }),
      [],
    );
    const reasonCounts = new Map<string, number>();
    for (const r of returns ?? []) {
      const reason = String(r.reason ?? "").trim();
      if (!reason) continue;
      reasonCounts.set(reason, (reasonCounts.get(reason) ?? 0) + 1);
    }
    const topReasons = [...reasonCounts.entries()]
      .sort((a, b) => b[1] - a[1])
      .slice(0, 5)
      .map(([reason, count]) => ({ reason, count }));

    const reviewRows = await this.rows<any[]>(
      () => this.db().orderReview.findMany({ where: { organizationId, rating: { not: null } } }),
      [],
    );
    const reviews = (reviewRows ?? []).filter((r: any) => inWindow(r.receivedAt ?? r.createdAt, range.gte, range.lt));
    const distribution: Record<string, number> = {};
    let ratingSum = 0;
    for (const r of reviews) {
      const k = String(r.rating);
      distribution[k] = (distribution[k] ?? 0) + 1;
      ratingSum += Number(r.rating);
    }

    return {
      orders: (orders ?? []).length,
      revenueMinor: revenue.toString(),
      cancelled,
      refunded,
      topProducts,
      returns: { total: (returns ?? []).length, topReasons },
      reviews: {
        count: reviews.length,
        avgRating: reviews.length ? round2(ratingSum / reviews.length) : null,
        distribution,
      },
    };
  }

  // ---------- ads: campaign performance ----------
  private async adsMetrics(organizationId: string, range: { gte: Date; lt: Date }) {
    const rows = await this.rows<any[]>(
      () => this.db().dailyAdMetric.findMany({ where: { organizationId, date: range } }),
      [],
    );
    // Campaign-level rows only: ad-set and ad rows roll up into
    // them, so summing everything would double count.
    const campaignRows = (rows ?? []).filter(
      (r: any) => String(r.campaignExternalId ?? "") !== "" && String(r.adExternalId ?? "") === "" && String(r.adSetExternalId ?? "") === "",
    );
    let spend = 0n;
    let value = 0n;
    let conversions = 0;
    let currency: string | null = null;
    const byCampaign = new Map<string, { name: string; spend: bigint; value: bigint; conversions: number }>();
    const campaignIds = new Set<string>();
    for (const r of campaignRows) {
      spend += bi(r.spendMinor);
      value += bi(r.platformConversionValueMinor);
      conversions += Number(r.platformConversions ?? 0);
      if (!currency && r.currency) currency = String(r.currency);
      const key = String(r.campaignExternalId);
      const cur = byCampaign.get(key) ?? { name: String(r.campaignName ?? key), spend: 0n, value: 0n, conversions: 0 };
      cur.spend += bi(r.spendMinor);
      cur.value += bi(r.platformConversionValueMinor);
      cur.conversions += Number(r.platformConversions ?? 0);
      if (r.campaignName) cur.name = String(r.campaignName);
      byCampaign.set(key, cur);
      if (r.adCampaignId) campaignIds.add(String(r.adCampaignId));
    }
    if (campaignIds.size) {
      const campaigns = await this.rows<any[]>(
        () => this.db().adCampaign.findMany({ where: { organizationId, id: { in: [...campaignIds] } } }),
        [],
      );
      const extById = new Map((campaignRows ?? []).filter((r: any) => r.adCampaignId).map((r: any) => [String(r.adCampaignId), String(r.campaignExternalId)]));
      for (const c of campaigns ?? []) {
        const ext = extById.get(String(c.id));
        const entry = ext ? byCampaign.get(ext) : undefined;
        if (entry && c.name) entry.name = String(c.name);
      }
    }
    const topCampaigns = [...byCampaign.values()]
      .sort((a, b) => (b.value > a.value ? 1 : b.value < a.value ? -1 : b.spend > a.spend ? 1 : -1))
      .slice(0, 5)
      .map((c) => ({
        name: c.name,
        spendMinor: c.spend.toString(),
        conversions: c.conversions,
        conversionValueMinor: c.value.toString(),
        roas: c.spend > 0n ? round2(Number(c.value) / Number(c.spend)) : null,
      }));
    return {
      spendMinor: spend.toString(),
      conversions,
      conversionValueMinor: value.toString(),
      currency,
      roas: spend > 0n ? round2(Number(value) / Number(spend)) : null,
      topCampaigns,
    };
  }

  // ---------- broadcasts: delivery truth (no reply attribution exists) ----------
  private async broadcastMetrics(organizationId: string, range: { gte: Date; lt: Date }) {
    const rows = await this.rows<any[]>(
      () =>
        this.db().broadcast.findMany({
          where: { organizationId, sentAt: range, status: { in: ["sent", "partial"] } },
          orderBy: { sentAt: "desc" },
        }),
      [],
    );
    const list: any[] = [];
    let sentTotal = 0;
    let failedTotal = 0;
    let deliveredTotal = 0;
    let readTotal = 0;
    for (const b of (rows ?? []).slice(0, 10)) {
      const deliveries = await this.rows<any[]>(
        () => this.db().messageDelivery.findMany({ where: { organizationId, broadcastId: b.id } }),
        [],
      );
      let delivered = 0;
      let read = 0;
      for (const d of deliveries ?? []) {
        if (d.deliveryStatus === "delivered" || d.deliveryStatus === "read") delivered++;
        if (d.deliveryStatus === "read") read++;
      }
      sentTotal += Number(b.sentCount ?? 0);
      failedTotal += Number(b.failedCount ?? 0);
      deliveredTotal += delivered;
      readTotal += read;
      list.push({
        id: b.id,
        name: String(b.name ?? ""),
        channel: String(b.channel ?? ""),
        totalRecipients: Number(b.totalRecipients ?? 0),
        sentCount: Number(b.sentCount ?? 0),
        failedCount: Number(b.failedCount ?? 0),
        delivered,
        read,
      });
    }
    return { count: (rows ?? []).length, sentTotal, failedTotal, deliveredTotal, readTotal, items: list };
  }

  // ---------- social: top posts by real platform-returned engagement ----------
  private async socialMetrics(organizationId: string, range: { gte: Date; lt: Date }) {
    const rows = await this.rows<any[]>(
      () => this.db().socialPost.findMany({ where: { organizationId, status: "published", publishedAt: range } }),
      [],
    );
    const scored: any[] = [];
    for (const post of rows ?? []) {
      const ins = post.insights && typeof post.insights === "object" ? post.insights : null;
      if (!ins) continue;
      const reactions = Number(ins.reactions ?? ins.likeCount ?? 0) || 0;
      const comments = Number(ins.comments ?? ins.commentsCount ?? 0) || 0;
      const shares = Number(ins.shares ?? 0) || 0;
      scored.push({
        id: post.id,
        caption: String(post.caption ?? "").slice(0, 120),
        engagement: reactions + comments + shares,
        impressions: ins.impressions != null ? Number(ins.impressions) : null,
        reach: ins.reach != null ? Number(ins.reach) : null,
      });
    }
    scored.sort((a, b) => b.engagement - a.engagement);
    return {
      published: (rows ?? []).length,
      withInsights: scored.length,
      topPosts: scored.slice(0, 5),
    };
  }

  // ---------- findings -> the human review queue ----------
  private async createInsightSuggestions(organizationId: string, metrics: any, snapshotId: string | null): Promise<number> {
    const rangeLabel = `${String(metrics.periodStart).slice(0, 10)} to ${String(metrics.periodEnd).slice(0, 10)}`;
    const findings: string[] = [];
    const topProduct = metrics?.sales?.topProducts?.[0];
    if (topProduct) {
      findings.push(
        `Best-selling product in the last 7 days (${rangeLabel}): "${topProduct.name}" — ${topProduct.qty} units sold.`,
      );
    }
    const outcomes = metrics?.inbox?.outcomes ?? {};
    const lossKeys = ["no_sale_price", "no_sale_stock", "no_sale_undecided"] as const;
    const topLoss = lossKeys
      .map((k) => ({ k, n: Number(outcomes[k] ?? 0) }))
      .sort((a, b) => b.n - a.n)[0];
    if (topLoss && topLoss.n > 0 && Number(metrics?.inbox?.closed ?? 0) > 0) {
      findings.push(
        `Most lost inbox sales in the last 7 days (${rangeLabel}) closed as "${topLoss.k}" — ${topLoss.n} of ${metrics.inbox.closed} closed conversations.`,
      );
    }
    const topCampaign = metrics?.ads?.topCampaigns?.[0];
    if (topCampaign && topCampaign.roas != null && bi(topCampaign.spendMinor) > 0n) {
      findings.push(
        `Best ad return in the last 7 days (${rangeLabel}): campaign "${topCampaign.name}" returned ${topCampaign.roas}x its spend (platform-reported conversions).`,
      );
    }
    let created = 0;
    for (const text of findings.slice(0, 3)) {
      const r = await this.learn()
        .createSuggestion(organizationId, {
          kind: "fact",
          title: text.slice(0, 120),
          content: { text, periodStart: metrics.periodStart, periodEnd: metrics.periodEnd },
          sourceType: "performance",
          sourceRef: snapshotId ? [snapshotId] : [],
        })
        .catch(() => ({ created: false }));
      if ((r as any)?.created) created++;
    }
    return created;
  }

  /** The performance_learning_sweep job body: every org with
   * data gets fresh snapshots; one org's failure never stops
   * the sweep. */
  async runSweep(now: Date = new Date()): Promise<{ orgs: number; computed: number; skipped: number }> {
    let computed = 0;
    let skipped = 0;
    try {
      const orgs = await this.rows<any[]>(() => this.db().organization.findMany({ take: MAX_ORGS_PER_SWEEP }), []);
      for (const org of orgs ?? []) {
        const r = await this.computeOrg(String(org.id), now);
        if (r.status === "ok") computed++;
        else skipped++;
      }
      return { orgs: (orgs ?? []).length, computed, skipped };
    } catch (e) {
      this.logger.error(`performance learning sweep failed: ${e instanceof Error ? e.message : String(e)}`);
      return { orgs: 0, computed, skipped };
    }
  }
}
