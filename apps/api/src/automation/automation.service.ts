import { BadRequestException, Injectable, Logger, NotFoundException, OnModuleInit, Optional } from "@nestjs/common";
import { PrismaService } from "../prisma/prisma.service";
import { AuditService } from "../audit/audit.service";
import { IntegrationsService } from "../integrations/integrations.service";
import { ShopifyService } from "../integrations/shopify/shopify.service";
import { AdsService } from "../ads/ads.service";
import { ReportsService } from "../ai/reports.service";
import { CompetitorsService } from "../competitors/competitors.service";
import { CampaignsService } from "../campaigns/campaigns.service";
import { EmailProvider } from "../messaging/email.provider";
import { AudiencesService } from "../audiences/audiences.service";
import { refreshPlatformConfig } from "../common/platform-config";

export const JOB_TYPES = [
  "woo_products", "woo_orders", "shopify_products", "shopify_orders",
  "meta_insights", "google_insights", "tiktok_insights",
  "daily_report", "competitor_ads", "competitor_scan", "weekly_ads_report", "meta_status_sync", "audience_refresh", "dayparting",
  "subscription_sweep",
] as const;

export const RULE_METRICS = [
  "platform_cpa", "platform_roas", "spend_no_conversions",
  "frequency", "ctr_percent", "cpm", "first_party_roas", "first_party_cpa",
, "ad_frequency", "ad_ctr_percent", "month_spend"] as const;
export const RULE_ACTIONS = ["pause_campaign", "alert", "activate_campaign", "scale_budget", "pause_ad"] as const;

/** Pure threshold check, unit-tested. value/threshold in the same unit. */
export function evaluateThreshold(value: number, comparator: "gt" | "lt", threshold: number): boolean {
  return comparator === "gt" ? value > threshold : value < threshold;
}

@Injectable()
export class AutomationService implements OnModuleInit {
  private readonly logger = new Logger(AutomationService.name);
  private timer: NodeJS.Timeout | null = null;
  private lastRuleEvaluation = 0;

  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly integrations: IntegrationsService,
    private readonly shopify: ShopifyService,
    private readonly ads: AdsService,
    private readonly reports: ReportsService,
    private readonly competitors: CompetitorsService,
    private readonly campaigns: CampaignsService,
    @Optional() private readonly email?: EmailProvider,
    @Optional() private readonly audiences?: AudiencesService,
  ) {}

  onModuleInit() {
    if (process.env.DISABLE_SCHEDULER === "true") {
      this.logger.log("Scheduler disabled via DISABLE_SCHEDULER");
      return;
    }
    // Single-instance in-process scheduler (monolith MVP). For multiple
    // API instances, run exactly one with the scheduler enabled.
    this.timer = setInterval(() => { void this.tick(); }, 60_000);
    this.timer.unref?.();
    this.logger.log("Scheduler started (60s tick)");
  }

  private async tick() {
    try {
      // Keep the dynamic platform config snapshot fresh (Milestone 33).
      await refreshPlatformConfig(this.prisma as any).catch(() => undefined);
      await this.runDueJobs();
      if (Date.now() - this.lastRuleEvaluation > 60 * 60 * 1000) {
        this.lastRuleEvaluation = Date.now();
        const orgs = await (this.prisma as any).organization.findMany({ select: { id: true }, take: 100 });
        for (const org of orgs) await this.evaluateRules(org.id, null).catch((e) => this.logger.warn(`Rule evaluation failed for ${org.id}: ${e instanceof Error ? e.message : e}`));
      }
    } catch (e) {
      this.logger.warn(`Scheduler tick failed: ${e instanceof Error ? e.message : e}`);
    }
  }

  // ---------- Scheduled jobs ----------
  async createJob(organizationId: string, actorId: string, dto: { name: string; type: string; targetId: string; intervalMinutes: number }) {
    if (!(JOB_TYPES as readonly string[]).includes(dto.type)) throw new BadRequestException("Invalid job type");
    if (!Number.isFinite(dto.intervalMinutes) || dto.intervalMinutes < 5) throw new BadRequestException("intervalMinutes must be at least 5");
    const job = await (this.prisma as any).scheduledJob.create({
      data: {
        organizationId, name: dto.name, type: dto.type, targetId: dto.targetId,
        intervalMinutes: Math.floor(dto.intervalMinutes), enabled: true,
        nextRunAt: new Date(Date.now() + dto.intervalMinutes * 60000), createdById: actorId,
      },
    });
    return job;
  }

  async listJobs(organizationId: string) {
    return (this.prisma as any).scheduledJob.findMany({ where: { organizationId }, orderBy: { createdAt: "desc" } });
  }

  private async getJobOrThrow(organizationId: string, jobId: string) {
    const job = await (this.prisma as any).scheduledJob.findFirst({ where: { id: jobId, organizationId } });
    if (!job) throw new NotFoundException("Scheduled job not found");
    return job;
  }

  async updateJob(organizationId: string, jobId: string, dto: { enabled?: boolean; intervalMinutes?: number; name?: string }) {
    await this.getJobOrThrow(organizationId, jobId);
    const data: Record<string, unknown> = {};
    if (dto.enabled !== undefined) data.enabled = dto.enabled;
    if (dto.name !== undefined) data.name = dto.name;
    if (dto.intervalMinutes !== undefined) {
      if (dto.intervalMinutes < 5) throw new BadRequestException("intervalMinutes must be at least 5");
      data.intervalMinutes = Math.floor(dto.intervalMinutes);
    }
    return (this.prisma as any).scheduledJob.update({ where: { id: jobId }, data });
  }

  async deleteJob(organizationId: string, jobId: string) {
    await this.getJobOrThrow(organizationId, jobId);
    await (this.prisma as any).scheduledJob.delete({ where: { id: jobId } });
    return { deleted: true };
  }

  async executeJob(job: any): Promise<unknown> {
    const orgId: string = job.organizationId;
    const actor: string = job.createdById;
    switch (job.type) {
      case "woo_products": return this.integrations.syncProducts(orgId, actor, job.targetId);
      case "woo_orders": return this.integrations.syncOrders(orgId, actor, job.targetId);
      case "shopify_products": return this.shopify.syncProducts(orgId, actor, job.targetId);
      case "shopify_orders": return this.shopify.syncOrders(orgId, actor, job.targetId);
      case "meta_insights": return this.ads.syncMetaInsights(orgId, actor, job.targetId, {});
      case "google_insights": return this.ads.syncGoogleInsights(orgId, actor, job.targetId, {});
      case "tiktok_insights": return this.ads.syncTikTokInsights(orgId, actor, job.targetId, {});
      case "daily_report": return this.reports.generate(orgId, actor, { type: "daily" });
      case "competitor_ads": return this.competitors.syncAds(orgId, actor, job.targetId, {});
      case "competitor_scan": return this.competitors.scanWebsite(orgId, actor, job.targetId);
      case "weekly_ads_report": return this.sendWeeklyAdsReport(orgId);
      case "subscription_sweep": {
        const { sweepSubscription } = await import("../common/platform-settings");
        const result = await sweepSubscription(this.prisma as any, orgId);
        if (result.changed) {
          await this.audit.log({ organizationId: orgId, action: "subscription.past_due", entityType: "Subscription", entityId: orgId, metadata: { via: "subscription_sweep" } });
        }
        return result;
      }
      case "meta_status_sync": return this.campaigns.syncAllPublishedStatuses(orgId, actor);
      case "dayparting": return this.campaigns.applyDayparting(orgId, actor);
      case "audience_refresh": {
        if (!this.audiences) throw new BadRequestException("Audience service is not available in this deployment");
        return this.audiences.refreshAllMemberships(orgId, actor);
      }
      default: throw new BadRequestException(`Unknown job type: ${job.type}`);
    }
  }

  async runJobNow(organizationId: string, actorId: string, jobId: string) {
    const job = await this.getJobOrThrow(organizationId, jobId);
    return this.runJob(job);
  }

  private async runJob(job: any) {
    const startedAt = new Date();
    try {
      const result = await this.executeJob(job);
      const summary = summarizeResult(result);
      await (this.prisma as any).automationRun.create({
        data: { organizationId: job.organizationId, kind: "schedule", refId: job.id, status: "success", detail: summary },
      });
      return (this.prisma as any).scheduledJob.update({
        where: { id: job.id },
        data: { lastRunAt: startedAt, lastStatus: "success", lastError: null, nextRunAt: new Date(Date.now() + job.intervalMinutes * 60000) },
      });
    } catch (e) {
      const message = e instanceof Error ? e.message : "Job failed";
      await (this.prisma as any).automationRun.create({
        data: { organizationId: job.organizationId, kind: "schedule", refId: job.id, status: "error", detail: message },
      });
      return (this.prisma as any).scheduledJob.update({
        where: { id: job.id },
        data: { lastRunAt: startedAt, lastStatus: "error", lastError: message, nextRunAt: new Date(Date.now() + job.intervalMinutes * 60000) },
      });
    }
  }

  async runDueJobs(): Promise<number> {
    const due = await (this.prisma as any).scheduledJob.findMany({
      where: { enabled: true, nextRunAt: { lte: new Date() } },
      orderBy: { nextRunAt: "asc" }, take: 10,
    });
    for (const job of due) await this.runJob(job);
    return due.length;
  }

  /** Weekly ads summary emailed to the org's OWNER/ADMIN members.
   * Numbers come from campaign-level DailyAdMetric rows and real
   * orders of the last 7 days. If SMTP is not configured the job
   * fails honestly (EmailProvider throws) and the run is marked
   * error by the scheduler wrapper. */
  async sendWeeklyAdsReport(organizationId: string) {
    if (!this.email) throw new BadRequestException("Email provider is not available in this deployment");
    const from = new Date(Date.now() - 6 * 86400000);
    from.setUTCHours(0, 0, 0, 0);
    const metrics = await (this.prisma as any).dailyAdMetric.findMany({
      where: { organizationId, date: { gte: from } }, take: 20000,
    });
    const campaignRows = metrics.filter((m: any) => (m.adExternalId ?? "") === "");
    let spend = 0n, impressions = 0, clicks = 0, conversions = 0;
    for (const m of campaignRows) {
      spend += BigInt(m.spendMinor); impressions += m.impressions ?? 0; clicks += m.clicks ?? 0; conversions += m.platformConversions ?? 0;
    }
    const orders = await (this.prisma as any).order.findMany({
      where: { organizationId, placedAt: { gte: from } }, take: 20000,
    }).catch(() => []);
    const revenueOrders = orders.filter((o: any) => !["cancelled", "refunded"].includes(o.status));
    const revenue = revenueOrders.reduce((s: bigint, o: any) => s + BigInt(o.totalMinor), 0n);
    const memberships = await (this.prisma as any).membership.findMany({
      where: { organizationId, role: { in: ["OWNER", "ADMIN"] } }, include: { user: true },
    });
    const recipients = memberships.map((m: any) => m.user?.email).filter(Boolean) as string[];
    if (recipients.length === 0) throw new BadRequestException("No OWNER/ADMIN email recipients found");
    const fmt = (minor: bigint) => (Number(minor) / 100).toLocaleString("en-US", { minimumFractionDigits: 2 });
    const text = [
      "Weekly Ads Summary (last 7 days)", "",
      `Ad spend: ${fmt(spend)}`,
      `Impressions: ${impressions.toLocaleString()}  Clicks: ${clicks.toLocaleString()}`,
      `Platform conversions: ${conversions}`,
      `Store orders: ${revenueOrders.length}  Revenue: ${fmt(revenue)}`,
      "",
      "Platform-reported conversions come from the ad platforms and can differ from tracked store orders.",
    ].join("\n");
    let sent = 0;
    for (const to of recipients) {
      await this.email.send({ to, subject: "Weekly Ads Summary — গত ৭ দিনের বিজ্ঞাপন সারসংক্ষেপ", text });
      sent++;
    }
    return { sent, recipients: recipients.length, spendMinor: spend.toString(), orders: revenueOrders.length };
  }

  // ---------- Automation rules ----------
  async createRule(organizationId: string, actorId: string, dto: {
    name: string; metric: string; comparator: string; threshold: string; windowDays?: number; action: string; campaignPlanId?: string;
    actionConfig?: { percent?: number; minDailyMinor?: number; maxDailyMinor?: number; cooldownHours?: number };
  }) {
    if (!(RULE_METRICS as readonly string[]).includes(dto.metric)) throw new BadRequestException("Invalid metric");
    if (!["gt", "lt"].includes(dto.comparator)) throw new BadRequestException("Invalid comparator");
    if (!(RULE_ACTIONS as readonly string[]).includes(dto.action)) throw new BadRequestException("Invalid action");
    if (Number.isNaN(Number(dto.threshold))) throw new BadRequestException("threshold must be numeric");
    if (dto.action === "scale_budget") {
      const percent = Number(dto.actionConfig?.percent ?? 0);
      if (!percent || percent < -90 || percent > 200) throw new BadRequestException("scale_budget needs actionConfig.percent between -90 and 200");
    }
    const rule = await (this.prisma as any).automationRule.create({
      data: {
        organizationId, name: dto.name, metric: dto.metric, comparator: dto.comparator,
        threshold: dto.threshold, windowDays: dto.windowDays ?? 3, action: dto.action,
        campaignPlanId: dto.campaignPlanId ?? null, enabled: true, createdById: actorId,
        actionConfig: dto.actionConfig ?? undefined,
      },
    });
    return rule;
  }

  /** First-party metrics for a plan from our OWN attribution credits.
   * Credits link to a campaign by name (UTM campaign) or by external id
   * when the touchpoint carried one; revenue/orders are the credited
   * amounts under the org's current attribution model credits. Spend is
   * the same platform spend used by platform metrics, so the two
   * families stay comparable but are never mixed. */
  /** Per-ad aggregates for a plan's Meta campaign (rules v3). */
  async adMetricsForPlan(organizationId: string, campaignExternalId: string, windowDays: number) {
    const since = new Date(Date.now() - windowDays * 86400000);
    const rows = await (this.prisma as any).dailyAdMetric.findMany({
      where: { organizationId, campaignExternalId, date: { gte: since } }, take: 10000,
    });
    const map = new Map<string, { adExternalId: string; spend: bigint; impressions: bigint; clicks: bigint; reach: bigint }>();
    for (const r of rows as any[]) {
      if (!r.adExternalId) continue;
      const a = map.get(r.adExternalId) ?? { adExternalId: r.adExternalId, spend: 0n, impressions: 0n, clicks: 0n, reach: 0n };
      a.spend += BigInt(r.spendMinor ?? 0); a.impressions += BigInt(r.impressions ?? 0);
      a.clicks += BigInt(r.clicks ?? 0); a.reach += BigInt(r.reach ?? 0);
      map.set(r.adExternalId, a);
    }
    return [...map.values()].map((a) => ({
      ...a,
      frequency: a.reach > 0n ? Number(a.impressions) / Number(a.reach) : null,
      ctrPercent: a.impressions > 0n ? Number(a.clicks) / Number(a.impressions) * 100 : null,
    }));
  }

  async firstPartyMetrics(organizationId: string, plan: any, windowDays: number, spendMinor: bigint) {
    const from = new Date(Date.now() - (windowDays - 1) * 86400000);
    from.setUTCHours(0, 0, 0, 0);
    const credits = await (this.prisma as any).attributionCredit.findMany({
      where: { organizationId, createdAt: { gte: from } }, take: 20000,
    }).catch(() => []);
    const touchIds = [...new Set(credits.map((c: any) => c.touchpointId).filter(Boolean))];
    const touches = touchIds.length
      ? await (this.prisma as any).touchpoint.findMany({ where: { id: { in: touchIds } } }).catch(() => [])
      : [];
    const campaignByTouch = new Map(touches.map((t: any) => [t.id, t.campaign as string | null]));
    let revenue = 0n;
    const orders = new Set<string>();
    for (const c of credits) {
      const campaignKey = c.touchpointId ? campaignByTouch.get(c.touchpointId) : null;
      if (!campaignKey) continue;
      if (campaignKey !== plan.name && campaignKey !== plan.externalCampaignId) continue;
      revenue += BigInt(c.revenueMinor ?? 0);
      if (c.orderId) orders.add(c.orderId);
    }
    return {
      revenueMinor: revenue, orders: orders.size,
      roas: spendMinor > 0n ? Number((revenue * 100n) / spendMinor) / 100 : null,
      cpaMajor: orders.size > 0 ? Number(spendMinor) / 100 / orders.size : null,
    };
  }

  async listRules(organizationId: string) {
    return (this.prisma as any).automationRule.findMany({ where: { organizationId }, orderBy: { createdAt: "desc" } });
  }

  async updateRule(organizationId: string, ruleId: string, dto: { enabled?: boolean }) {
    const rule = await (this.prisma as any).automationRule.findFirst({ where: { id: ruleId, organizationId } });
    if (!rule) throw new NotFoundException("Rule not found");
    return (this.prisma as any).automationRule.update({ where: { id: ruleId }, data: { ...(dto.enabled !== undefined ? { enabled: dto.enabled } : {}) } });
  }

  async deleteRule(organizationId: string, ruleId: string) {
    const rule = await (this.prisma as any).automationRule.findFirst({ where: { id: ruleId, organizationId } });
    if (!rule) throw new NotFoundException("Rule not found");
    await (this.prisma as any).automationRule.delete({ where: { id: ruleId } });
    return { deleted: true };
  }

  /** Campaign metrics over a window, from DailyAdMetric rows of the plan's
   *  Meta campaign. Platform-reported figures, labeled as such. */
  async campaignMetrics(organizationId: string, externalCampaignId: string, windowDays: number) {
    const from = new Date(Date.now() - (windowDays - 1) * 86400000);
    from.setUTCHours(0, 0, 0, 0);
    const rows = await (this.prisma as any).dailyAdMetric.findMany({
      where: { organizationId, campaignExternalId: externalCampaignId, date: { gte: from } },
    });
    // Campaign-level rows only — ad-level rows describe the same spend.
    const campaignRows = rows.filter((r: any) => (r.adExternalId ?? "") === "");
    let spend = 0n, conversions = 0, conversionValue = 0n, impressions = 0, clicks = 0, reach = 0;
    for (const r of campaignRows) {
      spend += BigInt(r.spendMinor);
      conversions += Number(r.platformConversions ?? 0);
      conversionValue += BigInt(r.platformConversionValueMinor ?? 0);
      impressions += Number(r.impressions ?? 0);
      clicks += Number(r.clicks ?? 0);
      reach += Number(r.reach ?? 0);
    }
    return {
      spendMinor: spend, conversions, conversionValueMinor: conversionValue,
      impressions, clicks, reach,
      cpaMajor: conversions > 0 ? Number(spend) / 100 / conversions : null,
      roas: spend > 0n ? Number((conversionValue * 100n) / spend) / 100 : null,
      ctrPercent: impressions > 0 ? Math.round((clicks / impressions) * 10000) / 100 : null,
      cpmMinor: impressions > 0 ? Math.round((Number(spend) / impressions) * 1000) : null,
      frequency: reach > 0 ? Math.round((impressions / reach) * 100) / 100 : null,
    };
  }

  async evaluateRules(organizationId: string, actorId: string | null) {
    const rules = await (this.prisma as any).automationRule.findMany({ where: { organizationId, enabled: true } });
    const results: { ruleId: string; planId: string; triggered: boolean; detail: string }[] = [];
    for (const rule of rules) {
      await (this.prisma as any).automationRule.update({ where: { id: rule.id }, data: { lastEvaluatedAt: new Date() } });
      const plans = await (this.prisma as any).campaignPlan.findMany({
        where: { organizationId, status: "published", ...(rule.campaignPlanId ? { id: rule.campaignPlanId } : {}) },
      });
      for (const plan of plans) {
        if (!plan.externalCampaignId) continue;
        const metrics = await this.campaignMetrics(organizationId, plan.externalCampaignId, rule.windowDays);
        let value: number | null = null;
        let detail = "";
        if (rule.metric === "platform_cpa") { value = metrics.cpaMajor; detail = `Platform CPA ${value === null ? "n/a (no conversions)" : value.toFixed(2)} over ${rule.windowDays}d, spend ${metrics.spendMinor} minor, conversions ${metrics.conversions}`; }
        if (rule.metric === "platform_roas") { value = metrics.roas; detail = `Platform ROAS ${value === null ? "n/a" : value} over ${rule.windowDays}d`; }
        if (rule.metric === "spend_no_conversions") {
          value = metrics.conversions === 0 ? Number(metrics.spendMinor) / 100 : 0;
          detail = `Spend ${value.toFixed(2)} with ${metrics.conversions} platform conversions over ${rule.windowDays}d`;
        }
        if (rule.metric === "frequency") { value = metrics.frequency; detail = `Frequency ${value === null ? "n/a (no reach data — run a campaign sync)" : value} over ${rule.windowDays}d`; }
        if (rule.metric === "ctr_percent") { value = metrics.ctrPercent; detail = `CTR ${value === null ? "n/a" : value + "%"} over ${rule.windowDays}d`; }
        if (rule.metric === "cpm") { value = metrics.cpmMinor === null ? null : metrics.cpmMinor / 100; detail = `CPM ${value === null ? "n/a" : value.toFixed(2)} over ${rule.windowDays}d`; }
        if (rule.metric === "first_party_roas" || rule.metric === "first_party_cpa") {
          const fp = await this.firstPartyMetrics(organizationId, plan, rule.windowDays, metrics.spendMinor);
          value = rule.metric === "first_party_roas" ? fp.roas : fp.cpaMajor;
          detail = `First-party ${rule.metric === "first_party_roas" ? "ROAS" : "CPA"} ${value === null ? "n/a" : value} over ${rule.windowDays}d (credited revenue ${fp.revenueMinor} minor, ${fp.orders} orders, matched by campaign name/id)`;
        }
        let breachingAds: { adExternalId: string }[] = [];
        if (rule.metric === "month_spend") {
          const monthStart = new Date(Date.UTC(new Date().getUTCFullYear(), new Date().getUTCMonth(), 1));
          const mrows = await (this.prisma as any).dailyAdMetric.findMany({
            where: { organizationId, campaignExternalId: plan.externalCampaignId, date: { gte: monthStart } }, take: 10000,
          });
          let ms = 0n;
          for (const r of mrows as any[]) if ((r.adExternalId ?? "") === "") ms += BigInt(r.spendMinor ?? 0);
          value = Number(ms) / 100;
          detail = `Month-to-date spend ${value.toFixed(2)} (campaign-level rows)`;
        }
        if (rule.metric === "ad_frequency" || rule.metric === "ad_ctr_percent") {
          const ads = await this.adMetricsForPlan(organizationId, plan.externalCampaignId, rule.windowDays);
          const field = rule.metric === "ad_frequency" ? "frequency" : "ctrPercent";
          const withData = ads.filter((x) => x[field] !== null);
          breachingAds = withData.filter((x) => evaluateThreshold(x[field]!, rule.comparator, Number(rule.threshold)));
          if (withData.length === 0) { value = null; detail = `No ad-level ${field} data (run an ad-level sync)`; }
          else if (rule.comparator === "lt") value = Math.min(...withData.map((x) => x[field]!));
          else value = Math.max(...withData.map((x) => x[field]!));
          detail = `${breachingAds.length} ad(s) breach ${rule.metric} ${rule.comparator} ${rule.threshold} over ${rule.windowDays}d`;
        }
        if (value === null) { results.push({ ruleId: rule.id, planId: plan.id, triggered: false, detail: `${detail} - not evaluated (no data)` }); continue; }
        const triggered = evaluateThreshold(value, rule.comparator, Number(rule.threshold));
        if (!triggered) { results.push({ ruleId: rule.id, planId: plan.id, triggered: false, detail }); continue; }

        // Triggered. Pause only makes sense for ACTIVE campaigns; alerts
        // are rate-limited to one per rule+plan per 24 hours.
        if (rule.action === "activate_campaign") {
          if (plan.metaStatus !== "PAUSED") {
            results.push({ ruleId: rule.id, planId: plan.id, triggered: false, detail: `${detail} - condition met but campaign is not PAUSED` });
            continue;
          }
          try {
            await this.campaigns.setMetaStatus(organizationId, actorId ?? rule.createdById, plan.id, "ACTIVE");
            await (this.prisma as any).automationRun.create({
              data: { organizationId, kind: "rule", refId: rule.id, status: "triggered", detail: `Activated plan ${plan.id}: ${detail}`, evidence: { planId: plan.id, action: "activate_campaign", metric: rule.metric, value, threshold: rule.threshold } as any },
            });
            await (this.prisma as any).automationRule.update({ where: { id: rule.id }, data: { lastTriggeredAt: new Date() } });
            results.push({ ruleId: rule.id, planId: plan.id, triggered: true, detail: `Activated: ${detail}` });
          } catch (e) {
            await (this.prisma as any).automationRun.create({
              data: { organizationId, kind: "rule", refId: rule.id, status: "error", detail: `Activate failed for plan ${plan.id}: ${e instanceof Error ? e.message : e}`, evidence: { planId: plan.id } as any },
            });
            results.push({ ruleId: rule.id, planId: plan.id, triggered: false, detail: "Activate attempt failed, see runs" });
          }
          continue;
        }
        if (rule.action === "scale_budget") {
          const cfg: any = rule.actionConfig ?? {};
          const cooldownMs = Math.max(1, Number(cfg.cooldownHours ?? 24)) * 3600 * 1000;
          if (rule.lastTriggeredAt && Date.now() - new Date(rule.lastTriggeredAt).getTime() < cooldownMs) {
            results.push({ ruleId: rule.id, planId: plan.id, triggered: false, detail: `${detail} - scale cooldown active` });
            continue;
          }
          try {
            const changes = await this.campaigns.scalePlanBudgets(organizationId, actorId ?? rule.createdById, plan.id, Number(cfg.percent ?? 0), {
              minDailyMinor: cfg.minDailyMinor !== undefined ? Number(cfg.minDailyMinor) : undefined,
              maxDailyMinor: cfg.maxDailyMinor !== undefined ? Number(cfg.maxDailyMinor) : undefined,
            });
            await (this.prisma as any).automationRun.create({
              data: { organizationId, kind: "rule", refId: rule.id, status: "triggered", detail: `Scaled budgets of plan ${plan.id} by ${cfg.percent}%: ${detail}`, evidence: { planId: plan.id, action: "scale_budget", metric: rule.metric, value, threshold: rule.threshold, changes } as any },
            });
            await (this.prisma as any).automationRule.update({ where: { id: rule.id }, data: { lastTriggeredAt: new Date() } });
            results.push({ ruleId: rule.id, planId: plan.id, triggered: true, detail: `Scaled ${changes.length} ad set(s): ${detail}` });
          } catch (e) {
            await (this.prisma as any).automationRun.create({
              data: { organizationId, kind: "rule", refId: rule.id, status: "error", detail: `Scale failed for plan ${plan.id}: ${e instanceof Error ? e.message : e}`, evidence: { planId: plan.id } as any },
            });
            results.push({ ruleId: rule.id, planId: plan.id, triggered: false, detail: "Scale attempt failed, see runs" });
          }
          continue;
        }
        if (rule.action === "pause_ad") {
          if (breachingAds.length === 0) {
            results.push({ ruleId: rule.id, planId: plan.id, triggered: false, detail: `${detail} - pause_ad needs an ad-level metric breach` });
            continue;
          }
          try {
            const adSets = await (this.prisma as any).campaignAdSet.findMany({ where: { planId: plan.id } });
            const setIds = adSets.map((s: any) => s.id);
            const localAds = await (this.prisma as any).campaignAd.findMany({ where: { adSetId: { in: setIds } } });
            const paused: string[] = [];
            for (const b of breachingAds) {
              const local = localAds.find((x: any) => x.externalAdId === b.adExternalId);
              if (!local) continue;
              await this.campaigns.setAdStatus(organizationId, actorId ?? rule.createdById, plan.id, local.id, "PAUSED");
              paused.push(b.adExternalId);
            }
            await (this.prisma as any).automationRun.create({
              data: { organizationId, kind: "rule", refId: rule.id, status: "triggered", detail: `Paused ${paused.length} ad(s) on plan ${plan.id}: ${detail}`, evidence: { planId: plan.id, metric: rule.metric, value, threshold: rule.threshold, pausedAds: paused } as any },
            });
            await (this.prisma as any).automationRule.update({ where: { id: rule.id }, data: { lastTriggeredAt: new Date() } });
            results.push({ ruleId: rule.id, planId: plan.id, triggered: true, detail: `Paused ads: ${detail}` });
          } catch (e) {
            await (this.prisma as any).automationRun.create({
              data: { organizationId, kind: "rule", refId: rule.id, status: "error", detail: `pause_ad failed for plan ${plan.id}: ${e instanceof Error ? e.message : e}`, evidence: { planId: plan.id } as any },
            });
            results.push({ ruleId: rule.id, planId: plan.id, triggered: false, detail: "pause_ad attempt failed, see runs" });
          }
          continue;
        }
        if (rule.action === "pause_campaign") {
          if (plan.metaStatus !== "ACTIVE") {
            results.push({ ruleId: rule.id, planId: plan.id, triggered: false, detail: `${detail} - condition met but campaign is not ACTIVE` });
            continue;
          }
          try {
            await this.campaigns.setMetaStatus(organizationId, actorId ?? rule.createdById, plan.id, "PAUSED");
            await (this.prisma as any).automationRun.create({
              data: { organizationId, kind: "rule", refId: rule.id, status: "triggered", detail: `Paused plan ${plan.id}: ${detail}`, evidence: { planId: plan.id, metric: rule.metric, value, threshold: rule.threshold } as any },
            });
            await (this.prisma as any).automationRule.update({ where: { id: rule.id }, data: { lastTriggeredAt: new Date() } });
            results.push({ ruleId: rule.id, planId: plan.id, triggered: true, detail: `Paused: ${detail}` });
          } catch (e) {
            await (this.prisma as any).automationRun.create({
              data: { organizationId, kind: "rule", refId: rule.id, status: "error", detail: `Pause failed for plan ${plan.id}: ${e instanceof Error ? e.message : e}`, evidence: { planId: plan.id } as any },
            });
            results.push({ ruleId: rule.id, planId: plan.id, triggered: false, detail: "Pause attempt failed, see runs" });
          }
        } else {
          const recent = await (this.prisma as any).automationRun.findMany({
            where: { organizationId, kind: "rule", refId: rule.id, status: "triggered", createdAt: { gte: new Date(Date.now() - 24 * 3600 * 1000) } },
          });
          const alreadyAlerted = recent.some((r: any) => (r.evidence as any)?.planId === plan.id && (r.evidence as any)?.action === "alert");
          if (alreadyAlerted) { results.push({ ruleId: rule.id, planId: plan.id, triggered: false, detail: "Alert already sent within 24h" }); continue; }
          await (this.prisma as any).automationRun.create({
            data: { organizationId, kind: "rule", refId: rule.id, status: "triggered", detail: `Alert for plan ${plan.id}: ${detail}`, evidence: { planId: plan.id, action: "alert", metric: rule.metric, value, threshold: rule.threshold } as any },
          });
          await (this.prisma as any).automationRule.update({ where: { id: rule.id }, data: { lastTriggeredAt: new Date() } });
          results.push({ ruleId: rule.id, planId: plan.id, triggered: true, detail: `Alert: ${detail}` });
        }
      }
    }
    return { evaluatedRules: rules.length, results };
  }

  async listRuns(organizationId: string, limit = 50) {
    return (this.prisma as any).automationRun.findMany({
      where: { organizationId }, orderBy: { createdAt: "desc" }, take: Math.min(100, limit),
    });
  }
}

function summarizeResult(result: unknown): string {
  try {
    const text = JSON.stringify(result, (_k, v) => (typeof v === "bigint" ? v.toString() : v));
    return text.length > 500 ? text.slice(0, 500) + "..." : text;
  } catch {
    return "completed";
  }
}
