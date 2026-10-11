import { BadRequestException, Injectable, Logger, NotFoundException, OnModuleInit, Optional } from "@nestjs/common";
import { leaderClaim } from "../common/leader-claim";
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
import { InboxService } from "../inbox/inbox.service";
import { EmailChannelService } from "../inbox/channels/email.service";
import { ProactiveService } from "../ai/proactive.service";
import { LeadsService } from "../crm/leads.service";
import { PaymentsService } from "../payments/payments.service";
import { refreshPlatformConfig } from "../common/platform-config";
import { orgFlagEnabled } from "../common/feature-flags";
import { platformSetting, effectiveLimits } from "../common/platform-settings";

export const JOB_TYPES = [
  "woo_products", "woo_orders", "shopify_products", "shopify_orders",
  "meta_insights", "google_insights", "tiktok_insights",
  "daily_report", "daily_briefing", "competitor_ads", "competitor_scan", "competitor_multi_sync", "weekly_ads_report", "meta_status_sync", "audience_refresh", "dayparting",
  "subscription_sweep", "dunning_reminders", "billing_reminders", "audit_retention",
  "inbox_assignment_sweep", "email_sync", "inbox_retention",
  "lead_followup_sweep", "auto_renew",
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
    @Optional() private readonly inbox?: InboxService,
    @Optional() private readonly emailChannel?: EmailChannelService,
    @Optional() private readonly proactive?: ProactiveService,
    @Optional() private readonly leads?: LeadsService,
    @Optional() private readonly payments?: PaymentsService,
  ) {}

  // ---------- Milestone 57: BullMQ dispatch mode ----------
  // When REDIS_URL is set, due jobs are ENQUEUED to the
  // "scheduled-jobs" queue and executed by the dedicated worker
  // (which calls back into POST /internal/jobs/execute). The
  // BullMQ jobId is deterministic per scheduled run, so multiple
  // API replicas enqueueing the same run collapse into one job.
  // Without REDIS_URL, execution stays inline exactly as before.
  private _queue: any = null;
  private _queueFailed = false;
  queueEnabled(): boolean {
    return Boolean(process.env.REDIS_URL) && !this._queueFailed;
  }
  private async getQueue(): Promise<any> {
    if (this._queue) return this._queue;
    const { Queue } = await import("bullmq");
    const { default: Redis } = await import("ioredis");
    const connection = new Redis(process.env.REDIS_URL as string, { maxRetriesPerRequest: null });
    this._queue = new Queue("scheduled-jobs", { connection });
    return this._queue;
  }
  private async enqueueScheduled(job: any, runKey: string): Promise<string> {
    const queue = await this.getQueue();
    const backoffMs = Number(process.env.JOB_BACKOFF_MS ?? 30000);
    const bull = await queue.add("execute", { scheduledJobId: job.id }, {
      jobId: `sched-${job.id}-${runKey}`,
      attempts: 3,
      backoff: { type: "exponential", delay: backoffMs },
      removeOnComplete: 200,
      removeOnFail: false,
    });
    return String(bull.id);
  }

  /** Worker callback path: execute + record, but RE-THROW on
   * failure so BullMQ's retry/DLQ semantics see the failure. */
  async executeScheduledJobById(jobId: string) {
    const job = await (this.prisma as any).scheduledJob.findFirst({ where: { id: jobId } });
    if (!job) throw new NotFoundException("Scheduled job not found (deleted?)");
    const startedAt = new Date();
    try {
      const result = await this.executeJob(job);
      const summary = summarizeResult(result);
      await (this.prisma as any).automationRun.create({
        data: { organizationId: job.organizationId, kind: "schedule", refId: job.id, status: "success", detail: summary },
      }).catch(() => undefined);
      await (this.prisma as any).scheduledJob.update({
        where: { id: job.id },
        data: { lastRunAt: startedAt, lastStatus: "success", lastError: null },
      });
      return { ok: true, summary };
    } catch (e) {
      const message = e instanceof Error ? e.message : "Job failed";
      await (this.prisma as any).automationRun.create({
        data: { organizationId: job.organizationId, kind: "schedule", refId: job.id, status: "error", detail: message },
      }).catch(() => undefined);
      await (this.prisma as any).scheduledJob.update({
        where: { id: job.id },
        data: { lastRunAt: startedAt, lastStatus: "error", lastError: message },
      }).catch(() => undefined);
      throw e;
    }
  }

  /** Worker reports an exhausted job: park it in the DLQ table.
   * Milestone 63: webhook jobs carry a label instead of a
   * ScheduledJob id (`webhook:<source>:<integrationId>`) and
   * pass their own jobType. */
  async recordDlq(input: { scheduledJobId: string; error: string; attempts: number; jobType?: string }) {
    const job = input.scheduledJobId.startsWith("webhook:")
      ? null
      : await (this.prisma as any).scheduledJob.findFirst({ where: { id: input.scheduledJobId } }).catch(() => null);
    const row = await (this.prisma as any).deadLetterJob.create({
      data: {
        organizationId: job?.organizationId ?? null,
        scheduledJobId: input.scheduledJobId,
        jobType: input.jobType ?? job?.type ?? null,
        error: String(input.error ?? "unknown error").slice(0, 2000),
        attempts: input.attempts ?? 0,
      },
    });
    await this.audit.log({
      organizationId: job?.organizationId ?? null, userId: "system", action: "automation.job_dead_lettered",
      entityType: "ScheduledJob", entityId: input.scheduledJobId,
      metadata: { error: row.error, attempts: row.attempts },
    }).catch(() => undefined);
    return row;
  }

  async listDlq(take = 50) {
    const rows = await (this.prisma as any).deadLetterJob.findMany({ orderBy: { createdAt: "desc" }, take }).catch(() => []);
    return rows;
  }

  async replayDlq(dlqId: string, actorId: string) {
    const row = await (this.prisma as any).deadLetterJob.findFirst({ where: { id: dlqId } });
    if (!row) throw new NotFoundException("Dead-letter entry not found");
    if (row.replayedAt) throw new BadRequestException("This entry was already replayed");
    if (!row.scheduledJobId) throw new BadRequestException("Entry has no scheduled job to replay");
    const job = await (this.prisma as any).scheduledJob.findFirst({ where: { id: row.scheduledJobId } });
    if (!job) throw new BadRequestException("The scheduled job no longer exists");
    await (this.prisma as any).deadLetterJob.update({ where: { id: dlqId }, data: { replayedAt: new Date() } });
    await this.audit.log({
      organizationId: row.organizationId, userId: actorId, action: "automation.dlq_replayed",
      entityType: "DeadLetterJob", entityId: dlqId, metadata: { scheduledJobId: job.id },
    }).catch(() => undefined);
    if (this.queueEnabled()) {
      const bullId = await this.enqueueScheduled(job, `replay-${Date.now()}`);
      return { replayed: true, mode: "queued", bullJobId: bullId };
    }
    void this.executeScheduledJobById(job.id).catch(() => undefined);
    return { replayed: true, mode: "inline" };
  }

  onModuleInit() {
    if (process.env.DISABLE_SCHEDULER === "true") {
      this.logger.log("Scheduler disabled via DISABLE_SCHEDULER");
      return;
    }
    // In-process scheduler. Multi-replica safe when REDIS_URL is
    // set: job dispatch dedupes via BullMQ job ids (M57) and the
    // hourly rule evaluation is leader-claimed (M62).
    this.timer = setInterval(() => { void this.tick(); }, 60_000);
    this.timer.unref?.();
    this.logger.log("Scheduler started (60s tick)");
  }

  private async tick() {
    try {
      // Keep the dynamic platform config snapshot fresh (Milestone 33).
      await refreshPlatformConfig(this.prisma as any).catch(() => undefined);
      await this.runDueJobs();
      const evalIntervalMs = Number(process.env.RULE_EVAL_INTERVAL_MS ?? 60 * 60 * 1000);
      if (Date.now() - this.lastRuleEvaluation > evalIntervalMs) {
        this.lastRuleEvaluation = Date.now();
        // Milestone 62: with multiple API replicas every tick
        // would evaluate the same rules — exactly one instance
        // claims each round (Redis test-and-set; single-instance
        // deployments always claim locally).
        const claimed = await leaderClaim.tryClaim("rule-evaluation", Math.max(60, Math.floor(evalIntervalMs / 1000)));
        if (!claimed) {
          this.logger.log("Rule evaluation skipped: another instance holds the leader claim");
        } else {
          const orgs = await (this.prisma as any).organization.findMany({ select: { id: true }, take: 100 });
          for (const org of orgs) await this.evaluateRules(org.id, null).catch((e) => this.logger.warn(`Rule evaluation failed for ${org.id}: ${e instanceof Error ? e.message : e}`));
        }
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
      case "daily_briefing": return this.proactive ? this.proactive.runDailyBriefing(orgId, actor) : { skipped: "proactive service unavailable" };
      case "competitor_ads": return this.competitors.syncAds(orgId, actor, job.targetId, {});
      case "competitor_scan": return this.competitors.scanWebsite(orgId, actor, job.targetId);
      case "competitor_multi_sync": return this.competitors.syncMultiPlatform(orgId, actor, job.targetId);
      case "weekly_ads_report": return this.sendWeeklyAdsReport(orgId);

      case "dunning_reminders": return this.sendDunningReminder(orgId);
      case "billing_reminders": return this.sendBillingReminders(orgId);
      case "inbox_assignment_sweep": {
        if (!this.inbox) throw new BadRequestException("Inbox service is not available in this deployment");
        return this.inbox.sweepAssignments(orgId);
      }
      case "email_sync": {
        if (!this.emailChannel) throw new BadRequestException("Email channel is not available in this deployment");
        return this.emailChannel.syncOrganization(orgId);
      }
      case "inbox_retention": {
        if (!this.inbox) throw new BadRequestException("Inbox service is not available in this deployment");
        return this.inbox.applyRetention(orgId);
      }
      case "lead_followup_sweep": {
        if (!this.leads) throw new BadRequestException("Leads service is not available in this deployment");
        return this.leads.sweepFollowUpReminders(orgId);
      }
      case "auto_renew": {
        if (!this.payments) throw new BadRequestException("Payments service is not available in this deployment");
        return this.payments.chargeAutoRenew(orgId);
      }
      case "subscription_sweep": {
        const { sweepSubscription } = await import("../common/platform-settings");
        const result = await sweepSubscription(this.prisma as any, orgId);
        if (result.changed) {
          await this.audit.log({ organizationId: orgId, action: result.status === "FREE" ? "subscription.plan_change_applied" : "subscription.past_due", entityType: "Subscription", entityId: orgId, metadata: { via: "subscription_sweep", status: result.status } });
        }
        return result;
      }
      case "meta_status_sync": return this.campaigns.syncAllPublishedStatuses(orgId, actor);
      case "dayparting": {
        // Milestone 40: platform feature flag (dayparting).
        if (!(await orgFlagEnabled(this.prisma as any, orgId, "dayparting"))) {
          return { skipped: true, reason: "dayparting is disabled for this organization by the platform team" };
        }
        return this.campaigns.applyDayparting(orgId, actor);
      }
      case "audit_retention": return this.runAuditRetention();
      case "audience_refresh": {
        if (!this.audiences) throw new BadRequestException("Audience service is not available in this deployment");
        return this.audiences.refreshAllMemberships(orgId, actor);
      }
      default: throw new BadRequestException(`Unknown job type: ${job.type}`);
    }
  }

  async runJobNow(organizationId: string, actorId: string, jobId: string) {
    const job = await this.getJobOrThrow(organizationId, jobId);
    if (this.queueEnabled()) {
      try {
        const bullJobId = await this.enqueueScheduled(job, `manual-${Date.now()}`);
        return { queued: true, bullJobId, jobId: job.id };
      } catch (e) {
        this.logger.warn(`Enqueue failed, running inline instead: ${e instanceof Error ? e.message : e}`);
      }
    }
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
    if (this.queueEnabled() && due.length) {
      let dispatched = 0;
      for (const job of due) {
        try {
          await this.enqueueScheduled(job, String(new Date(job.nextRunAt).getTime()));
          // Advance the schedule at dispatch time; the outcome is
          // recorded by the worker callback (lastStatus/lastRunAt).
          await (this.prisma as any).scheduledJob.update({
            where: { id: job.id },
            data: { nextRunAt: new Date(Date.now() + job.intervalMinutes * 60000) },
          });
          dispatched++;
        } catch (e) {
          this.logger.warn(`Dispatch failed for job ${job.id}, running inline: ${e instanceof Error ? e.message : e}`);
          await this.runJob(job);
        }
      }
      return dispatched;
    }
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

  /** Milestone 39 dunning: staged PAST_DUE reminders (stage 1 on
   * the first run, then day 3 and day 7+). Each stage is sent
   * ONCE per past-due episode — the audit log is the record, so
   * re-runs are no-ops. Without a configured email provider the
   * job fails honestly instead of pretending to remind anyone. */
  /**
   * Milestone 40 (Phase A4): audit-log retention. Deletes audit
   * rows older than the configured retention (platform setting
   * auditRetentionDays, default 365, min 30) EXCEPT admin.*
   * actions, which are kept indefinitely for operator
   * accountability. Platform-wide — the job's org is ignored.
   */
  async runAuditRetention() {
    const raw = await platformSetting(this.prisma as any, "auditRetentionDays").catch(() => null);
    const days = Math.min(3650, Math.max(30, Number(raw ?? 365) || 365));
    const cutoff = new Date(Date.now() - days * 86400000);
    const old = await (this.prisma as any).auditLog?.findMany({
      where: { createdAt: { lt: cutoff } }, take: 100000,
    }).catch(() => []) ?? [];
    const deletable = (old as any[]).filter((r) => !String(r.action ?? "").startsWith("admin."));
    let deleted = 0;
    for (const r of deletable) {
      const res = await (this.prisma as any).auditLog.delete({ where: { id: r.id } }).catch(() => null);
      if (res) deleted++;
    }
    return { retentionDays: days, cutoff: cutoff.toISOString(), candidates: (old as any[]).length, deleted, preservedAdminActions: (old as any[]).length - deletable.length };
  }

  /**
   * Billing Package B1: pre-expiry + abandoned-checkout
   * reminders. In-app notifications are the reliable channel;
   * email is attempted when a provider exists and its outcome
   * is reported honestly (sent count / skipped / error) —
   * never claimed sent when it was not. Audit rows are the
   * dedupe record, exactly like dunning: each expiry stage
   * fires once per period, each checkout is reminded once.
   */
  async sendBillingReminders(organizationId: string) {
    const p = this.prisma as any;
    const now = new Date();
    const out: any = { expiry: null, checkoutReminders: 0, notifications: 0, emailsSent: 0, emailStatus: this.email ? "attempted" : "no_provider" };
    const memberships = (await p.membership.findMany({
      where: { organizationId, role: { in: ["OWNER", "ADMIN"] }, status: "ACTIVE" }, include: { user: true },
    }).catch(() => [])) as any[];
    const profile = (await p.businessProfile?.findUnique?.({ where: { organizationId } })?.catch?.(() => null)) ?? null;
    const extraEmails: string[] = Array.isArray(profile?.billingEmails) ? profile.billingEmails : [];
    const recipients = [...new Set([...memberships.map((m) => m.user?.email).filter(Boolean), ...extraEmails])] as string[];
    const org = await p.organization.findUnique({ where: { id: organizationId } }).catch(() => null);
    const notifyAdmins = async (title: string, body: string) => {
      for (const m of memberships) {
        const made = await p.agentNotification?.create?.({ data: { organizationId, userId: m.userId, type: "billing", title, body } })?.catch?.(() => null);
        if (made) out.notifications++;
      }
    };
    const mailAll = async (subject: string, text: string) => {
      if (!this.email) return;
      for (const to of recipients) {
        try { await this.email.send({ to, subject, text }); out.emailsSent++; }
        catch { out.emailStatus = "provider_error"; }
      }
    };
    const metaOf = (a: any) => { try { return typeof a.metadata === "string" ? JSON.parse(a.metadata) : a.metadata ?? {}; } catch { return {}; } };

    // --- subscription expiring soon (stages 7 / 3 / 1 days) ---
    const sub = await p.subscription.findFirst({ where: { organizationId }, orderBy: { createdAt: "desc" } }).catch(() => null);
    if (sub && ["ACTIVE", "TRIALING"].includes(sub.status) && sub.currentPeriodEnd) {
      const daysLeft = Math.ceil((new Date(sub.currentPeriodEnd).getTime() - now.getTime()) / 86400000);
      const stage = daysLeft <= 0 ? null : daysLeft <= 1 ? 1 : daysLeft <= 3 ? 3 : daysLeft <= 7 ? 7 : null;
      if (stage) {
        const prior = (await p.auditLog.findMany({ where: { organizationId, action: "billing.expiry_reminder_sent" }, take: 50 }).catch(() => [])) as any[];
        const already = prior.some((a) => metaOf(a)?.stage === stage && metaOf(a)?.periodEnd === new Date(sub.currentPeriodEnd).toISOString());
        if (!already) {
          const title = `⏳ সাবস্ক্রিপশনের মেয়াদ ${daysLeft} দিন বাকি`;
          const body = `${org?.name ?? "আপনার"} ওয়ার্কস্পেসের ${sub.plan} প্ল্যানের মেয়াদ ${daysLeft} দিন পর শেষ হবে। সেবা নির্বিঘ্নে চালু রাখতে Billing পেজ থেকে নবায়ন করুন।`;
          await notifyAdmins(title, body);
          await mailAll(`সাবস্ক্রিপশন নবায়ন — ${daysLeft} দিন বাকি (${sub.plan})`, `${title}\n\n${body}\n\n— Qosprey AI Marketing টিম`);
          await this.audit.log({
            organizationId, action: "billing.expiry_reminder_sent", entityType: "Subscription", entityId: sub.id,
            metadata: { stage, daysLeft, periodEnd: new Date(sub.currentPeriodEnd).toISOString(), notified: memberships.length, emailsSent: out.emailsSent, emailStatus: out.emailStatus },
          });
          out.expiry = { stage, daysLeft, sent: true };
        } else out.expiry = { stage, daysLeft, sent: false, reason: "stage already sent" };
      }
    }

    // --- abandoned checkouts (initiated 1h–3d ago), once each ---
    const stale = (await p.planCheckout.findMany({
      where: { organizationId, status: "initiated", createdAt: { lt: new Date(now.getTime() - 3600_000), gt: new Date(now.getTime() - 3 * 86400000) } },
      take: 20,
    }).catch(() => [])) as any[];
    if (stale.length) {
      const prior = (await p.auditLog.findMany({ where: { organizationId, action: "billing.checkout_reminder_sent" }, take: 100 }).catch(() => [])) as any[];
      const reminded = new Set(prior.map((a) => metaOf(a)?.checkoutId).filter(Boolean));
      for (const co of stale) {
        if (reminded.has(co.id)) continue;
        const made = await p.agentNotification?.create?.({
          data: { organizationId, userId: co.createdById, type: "billing", title: "💳 অসম্পূর্ণ পেমেন্ট", body: `${co.plan} প্ল্যানের পেমেন্টটি অসম্পূর্ণ আছে (${co.tranId}) — Billing পেজ থেকে আবার চেষ্টা করে প্ল্যানটি চালু করুন।` },
        })?.catch?.(() => null);
        if (made) out.notifications++;
        const creator = await p.user.findUnique({ where: { id: co.createdById } }).catch(() => null);
        if (this.email && creator?.email) {
          try { await this.email.send({ to: creator.email, subject: `অসম্পূর্ণ পেমেন্ট — ${co.plan} প্ল্যান`, text: `আপনার ${co.plan} প্ল্যানের পেমেন্টটি সম্পূর্ণ হয়নি। Billing পেজ থেকে আবার চেষ্টা করুন — মেয়াদ শেষ হওয়ার আগেই নবায়ন করলে সেবা বন্ধ হবে না।\n\n— Qosprey AI Marketing টিম` }); out.emailsSent++; }
          catch { out.emailStatus = "provider_error"; }
        }
        await this.audit.log({
          organizationId, action: "billing.checkout_reminder_sent", entityType: "PlanCheckout", entityId: co.id,
          metadata: { checkoutId: co.id, plan: co.plan, tranId: co.tranId },
        });
        out.checkoutReminders++;
      }
    }

    // --- Billing Package B6: usage alerts at 80% / 100% of
    // the plan limits (seats + daily AI), once per metric +
    // threshold per Asia/Dhaka day, audit-deduped. ---
    out.usageAlerts = [];
    try {
      const limits = await effectiveLimits(p, organizationId, {
        aiDaily: Number(process.env.AI_DAILY_MESSAGE_LIMIT ?? 200),
        broadcastCap: Number(process.env.BROADCAST_MAX_RECIPIENTS ?? 1000),
      });
      const dayStart = new Date(new Date().toISOString().slice(0, 10) + "T00:00:00.000Z");
      const seatsUsed = await p.membership.count({ where: { organizationId, status: "ACTIVE" } }).catch(() => 0);
      const aiUsed = (await p.aIUsageRecord?.count?.({ where: { organizationId, createdAt: { gte: dayStart } } })?.catch?.(() => 0)) ?? 0;
      const dhakaDay = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Dhaka" }).format(now);
      const checks = [
        { metric: "seats", label: "টিম সিট", used: Number(seatsUsed ?? 0), limit: limits.seats },
        { metric: "aiDaily", label: "দৈনিক AI ব্যবহার", used: Number(aiUsed ?? 0), limit: limits.aiDaily },
      ];
      for (const c of checks) {
        if (!c.limit || c.limit <= 0) continue;
        const ratio = c.used / c.limit;
        const threshold = ratio >= 1 ? 100 : ratio >= 0.8 ? 80 : null;
        if (!threshold) continue;
        const prior = (await p.auditLog.findMany({ where: { organizationId, action: "billing.usage_alert_sent" }, take: 100 }).catch(() => [])) as any[];
        const already = prior.some((a) => { const m = metaOf(a); return m?.metric === c.metric && m?.threshold === threshold && m?.day === dhakaDay; });
        if (already) continue;
        const title = threshold === 100 ? `🚫 ${c.label} এর সীমা শেষ (${c.used}/${c.limit})` : `⚠️ ${c.label} সীমার ${threshold}% ব্যবহৃত (${c.used}/${c.limit})`;
        const body = `${org?.name ?? "আপনার"} ওয়ার্কস্পেসে ${c.label}: ${c.used}/${c.limit} ব্যবহৃত হয়েছে। ${threshold === 100 ? "সীমা বাড়াতে বড় প্ল্যান নিন — Billing পেজ দেখুন।" : "সীমা শেষ হওয়ার আগেই বড় প্ল্যান নেওয়ার কথা ভাবুন।"}`;
        await notifyAdmins(title, body);
        await mailAll(title, `${title}\n\n${body}\n\n— Qosprey AI Marketing টিম`);
        await this.audit.log({
          organizationId, action: "billing.usage_alert_sent", entityType: "Organization", entityId: organizationId,
          metadata: { metric: c.metric, threshold, used: c.used, limit: c.limit, day: dhakaDay },
        });
        out.usageAlerts.push({ metric: c.metric, threshold });
      }
    } catch (e) {
      out.usageAlertsError = e instanceof Error ? e.message : "usage check failed";
    }

    // --- Referral Advanced R2: expire granted credit whose
    // date has passed, FIFO over the credit ledger. ---
    out.creditExpiredMinor = "0";
    try {
      const entries = (await p.creditLedger?.findMany?.({ where: { organizationId }, orderBy: { createdAt: "asc" }, take: 1000 })?.catch?.(() => [])) ?? [];
      const due = computeExpiredUnspent(entries as any[], now);
      if (due > 0n) {
        const orgRow = await p.organization.findUnique({ where: { id: organizationId } }).catch(() => null);
        const balance = BigInt(orgRow?.creditMinor ?? 0);
        const debit = due > balance ? balance : due;
        if (debit > 0n) {
          await p.organization.update({ where: { id: organizationId }, data: { creditMinor: balance - debit } });
          await p.creditLedger.create({ data: { organizationId, deltaMinor: -debit, reason: "credit_expired" } });
          await this.audit.log({
            organizationId, action: "billing.credit_expired", entityType: "Organization", entityId: organizationId,
            metadata: { expiredMinor: debit.toString() },
          });
          await notifyAdmins("⏰ কিছু বিলিং ক্রেডিটের মেয়াদ শেষ", `রেফারেল ক্রেডিটের মেয়াদ পেরিয়ে যাওয়ায় ৳${(Number(debit) / 100).toFixed(2)} বাদ গেছে। বিস্তারিত Billing পেজের ক্রেডিট ইতিহাসে দেখুন।`);
          out.creditExpiredMinor = debit.toString();
        }
      }
    } catch (e) {
      out.creditExpiryError = e instanceof Error ? e.message : "credit expiry check failed";
    }
    return out;
  }

  async sendDunningReminder(organizationId: string) {
    if (!this.email) throw new BadRequestException("Email provider is not available in this deployment");
    const sub = await (this.prisma as any).subscription.findFirst({
      where: { organizationId }, orderBy: { createdAt: "desc" },
    }).catch(() => null);
    if (!sub || sub.status !== "PAST_DUE") return { skipped: "subscription is not past due" };
    const end = sub.currentPeriodEnd ? new Date(sub.currentPeriodEnd) : new Date();
    const daysOverdue = Math.max(0, Math.floor((Date.now() - end.getTime()) / 86400000));
    const stage = daysOverdue >= 7 ? 7 : daysOverdue >= 3 ? 3 : 1;
    const prior = await (this.prisma as any).auditLog.findMany({
      where: { organizationId, action: "billing.dunning_sent" }, take: 50,
    }).catch(() => []);
    const already = (prior as any[]).some((a) => {
      const meta = typeof a.metadata === "string" ? JSON.parse(a.metadata) : a.metadata;
      return meta?.stage === stage && meta?.periodEnd === (sub.currentPeriodEnd ? new Date(sub.currentPeriodEnd).toISOString() : null);
    });
    if (already) return { skipped: "stage already sent", stage, daysOverdue };
    const org = await (this.prisma as any).organization.findUnique({ where: { id: organizationId } }).catch(() => null);
    const memberships = await (this.prisma as any).membership.findMany({
      where: { organizationId, role: { in: ["OWNER", "ADMIN"] } }, include: { user: true },
    });
    const recipients = memberships.map((m: any) => m.user?.email).filter(Boolean) as string[];
    if (recipients.length === 0) throw new BadRequestException("No OWNER/ADMIN email recipients found");
    const text = [
      `আসসালামু আলাইকুম,`,
      ``,
      `${org?.name ?? "আপনার"} ওয়ার্কস্পেসের ${sub.plan} সাবস্ক্রিপশনের মেয়াদ ${daysOverdue} দিন আগে শেষ হয়েছে (PAST_DUE)।`,
      `মেয়াদ পেরিয়ে যাওয়ায় ওয়ার্কস্পেসটি এখন Read-only — নতুন ডেটা যোগ করা যাচ্ছে না, তবে সব ডেটা নিরাপদে আছে।`,
      `পেমেন্ট সম্পন্ন হলেই সাবস্ক্রিপশন আবার সক্রিয় হবে। Billing পেজ থেকে অনলাইনে পেমেন্ট করতে পারবেন, অথবা প্ল্যাটফর্ম টিমের সাথে যোগাযোগ করুন।`,
      ``,
      `— Qosprey AI Marketing টিম`,
    ].join("\n");
    let sent = 0;
    for (const to of recipients) {
      await this.email.send({ to, subject: `সাবস্ক্রিপশন মেয়াদ শেষ — ${sub.plan} (দিন ${daysOverdue})`, text });
      sent++;
    }
    await this.audit.log({
      organizationId, action: "billing.dunning_sent", entityType: "Subscription", entityId: sub.id,
      metadata: { stage, daysOverdue, recipients: sent, periodEnd: sub.currentPeriodEnd ? new Date(sub.currentPeriodEnd).toISOString() : null },
    });
    return { sent, stage, daysOverdue };
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

/**
 * Referral Advanced R2: how much granted credit has expired
 * UNSPENT, FIFO over the ledger — spends and earlier expiry
 * debits consume the oldest grants first. Only ledger-tracked
 * credit can expire; pre-ledger balances are untracked by
 * design (documented in the R2 acceptance).
 */
export function computeExpiredUnspent(
  entries: { deltaMinor: bigint | number; reason: string; expiresAt?: Date | string | null; createdAt: Date | string }[],
  now: Date,
): bigint {
  const sorted = [...entries].sort((a, b) => +new Date(a.createdAt) - +new Date(b.createdAt));
  let spent = 0n;
  let expiredAlready = 0n;
  const grants: { amount: bigint; expiresAt: Date | null }[] = [];
  for (const e of sorted) {
    const d = BigInt(e.deltaMinor as any);
    if (d > 0n) grants.push({ amount: d, expiresAt: e.expiresAt ? new Date(e.expiresAt) : null });
    else if (e.reason === "credit_expired") expiredAlready += -d;
    else spent += -d;
  }
  let consumed = spent + expiredAlready;
  let due = 0n;
  for (const g of grants) {
    const usedHere = consumed > g.amount ? g.amount : consumed;
    consumed -= usedHere;
    const unspent = g.amount - usedHere;
    if (unspent > 0n && g.expiresAt && g.expiresAt < now) due += unspent;
  }
  return due;
}
