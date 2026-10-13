import { Injectable, Optional } from "@nestjs/common";
import { PrismaService } from "../prisma/prisma.service";
import { AuditService } from "../audit/audit.service";
import { ToolsService } from "./tools.service";
import { EmailProvider } from "../messaging/email.provider";
import { CommerceAnalyticsService } from "../commerce/commerce-analytics.service";
import { TelegramClient } from "../inbox/channels/telegram.service";
import { decryptJson } from "../integrations/crypto";
import { REVENUE_EXCLUDED_STATUSES } from "../analytics/analytics.service";

export interface ProactiveSettings {
  briefingEnabled: boolean;
  anomalyAlertsEnabled: boolean;
  dailyReportEmailEnabled: boolean;
  // AP6: Telegram copy of the briefing (opt-in + chat id required).
  telegramBriefEnabled: boolean;
  telegramBriefChatId: string | null;
  // AP7: autonomy (0 default | 2 auto internal-only) + identity.
  autonomyLevel: number;
  assistantName: string | null;
}
const DEFAULT_SETTINGS: ProactiveSettings = { briefingEnabled: true, anomalyAlertsEnabled: true, dailyReportEmailEnabled: false, telegramBriefEnabled: false, telegramBriefChatId: null, autonomyLevel: 0, assistantName: null };

/**
 * Milestone 48 — Proactive Assistant.
 *
 * A scheduled `daily_briefing` automation job (or the manual run-now
 * endpoint) composes yesterday's briefing from REAL tool output —
 * the same get_analytics_overview and get_anomalies the chat uses —
 * and delivers it as in-app notifications (AgentNotification, the
 * existing notification system) to the org's OWNER/ADMIN members.
 *
 * Honesty rules:
 * - A day with no orders still gets a briefing that SAYS there was no
 *   data; nothing is invented and the briefing is never silently
 *   skipped for emptiness.
 * - Anomaly alerts fire only for the detector's highest severity
 *   ("critical" — the detector emits warning|critical; there is no
 *   "high" tier in it). Warning-tier anomalies are summarised inside
 *   the briefing instead.
 * - Dedupe: per user + type + day for briefings, and per user + day +
 *   anomaly type for alerts (the type is stored as a body marker).
 */
@Injectable()
export class ProactiveService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    @Optional() private readonly tools?: ToolsService,
    // CX12b (12e): optional email copy of the daily briefing.
    // AiModule already imports MessagingModule — no new wiring.
    @Optional() private readonly email?: EmailProvider,
    // EC11: optional commerce signals for the daily briefing.
    // AiModule imports CommerceModule for it; absent = briefing
    // behaves exactly as before.
    @Optional() private readonly commerceAnalytics?: CommerceAnalyticsService,
  ) {}

  private p(): any { return this.prisma as any; }

  async getSettings(orgId: string): Promise<ProactiveSettings> {
    const row = await this.p().aIProactiveSetting.findUnique({ where: { organizationId: orgId } }).catch(() => null);
    if (!row) return { ...DEFAULT_SETTINGS };
    return {
      briefingEnabled: row.briefingEnabled !== false,
      anomalyAlertsEnabled: row.anomalyAlertsEnabled !== false,
      dailyReportEmailEnabled: row.dailyReportEmailEnabled === true,
      telegramBriefEnabled: row.telegramBriefEnabled === true,
      telegramBriefChatId: row.telegramBriefChatId ?? null,
      autonomyLevel: Number(row.autonomyLevel ?? 0),
      assistantName: row.assistantName ?? null,
    };
  }

  async updateSettings(orgId: string, userId: string, dto: Partial<ProactiveSettings>) {
    const current = await this.getSettings(orgId);
    const next: ProactiveSettings = {
      briefingEnabled: dto.briefingEnabled ?? current.briefingEnabled,
      anomalyAlertsEnabled: dto.anomalyAlertsEnabled ?? current.anomalyAlertsEnabled,
      dailyReportEmailEnabled: dto.dailyReportEmailEnabled ?? current.dailyReportEmailEnabled,
      telegramBriefEnabled: dto.telegramBriefEnabled ?? current.telegramBriefEnabled,
      telegramBriefChatId: dto.telegramBriefChatId !== undefined ? (dto.telegramBriefChatId?.trim() || null) : current.telegramBriefChatId,
      autonomyLevel: dto.autonomyLevel !== undefined ? Math.min(2, Math.max(0, Math.floor(dto.autonomyLevel))) : current.autonomyLevel,
      assistantName: dto.assistantName !== undefined ? (dto.assistantName?.trim().slice(0, 60) || null) : current.assistantName,
    };
    await this.p().aIProactiveSetting.upsert({
      where: { organizationId: orgId },
      create: { organizationId: orgId, ...next },
      update: { ...next },
    });
    await this.audit.log({ organizationId: orgId, userId, action: "ai.proactive_settings_updated", entityType: "AIProactiveSetting", entityId: orgId, metadata: { ...next } });
    return next;
  }

  private async recipients(orgId: string): Promise<string[]> {
    const members = await this.p().membership.findMany({
      where: { organizationId: orgId, status: "ACTIVE", role: { in: ["OWNER", "ADMIN"] } },
    }).catch(() => []);
    return [...new Set((members as any[]).map((m) => m.userId as string))];
  }

  private startOfToday(): Date { const d = new Date(); d.setUTCHours(0, 0, 0, 0); return d; }

  private async alreadySent(orgId: string, userId: string, type: string, marker?: string): Promise<boolean> {
    const rows = await this.p().agentNotification.findMany({
      where: { organizationId: orgId, userId, type, createdAt: { gte: this.startOfToday() } },
    }).catch(() => []);
    if (!marker) return (rows as any[]).length > 0;
    return (rows as any[]).some((r) => String(r.body ?? "").startsWith(marker));
  }

  private async notify(orgId: string, userId: string, type: string, title: string, body: string) {
    await this.p().agentNotification.create({
      data: { organizationId: orgId, userId, type, title, body: body.slice(0, 1800), conversationId: null },
    });
  }

  /**
   * AP6 opportunity radar — deterministic lines from REAL signals
   * only: (1) low-stock products that are actually selling,
   * (2) a courier whose delivery rate fell ≥10 points week over
   * week, (3) an open unanswered-question backlog of 5+. No signal
   * → no line; nothing is padded or invented.
   */
  async computeOpportunityRadar(orgId: string): Promise<string[]> {
    const p = this.p();
    const lines: string[] = [];
    const day = 86_400_000;
    const now = Date.now();

    // (1) low stock + selling
    const products = await p.product.findMany({ where: { organizationId: orgId, status: "ACTIVE" }, take: 500 }).catch(() => []);
    const low = (products as any[]).filter((x) => x.stockQuantity !== null && x.stockQuantity !== undefined && x.stockQuantity <= (x.lowStockThreshold ?? 5));
    if (low.length) {
      const orders = await p.order.findMany({ where: { organizationId: orgId, isPractice: false, createdAt: { gte: new Date(now - 14 * day) } }, take: 5000 }).catch(() => []);
      const okOrders = (orders as any[]).filter((o) => !REVENUE_EXCLUDED_STATUSES.includes(o.status));
      const items = okOrders.length
        ? await p.orderItem.findMany({ where: { orderId: { in: okOrders.map((o: any) => o.id) } }, take: 10000 }).catch(() => [])
        : [];
      const sold = new Map<string, number>();
      for (const i of items as any[]) if (i.productId) sold.set(i.productId, (sold.get(i.productId) ?? 0) + (i.quantity ?? 0));
      for (const prod of low) {
        const qty = sold.get(prod.id) ?? 0;
        if (qty > 0) lines.push(`“${prod.name}” স্টক মাত্র ${prod.stockQuantity}টি, অথচ গত ১৪ দিনে ${qty}টি বিক্রি হয়েছে — রিস্টকের কথা ভাবুন।`);
        if (lines.length >= 3) break;
      }
    }

    // (2) courier deterioration (delivery rate, 7d vs prior 7d)
    const ships = await p.courierShipment.findMany({ where: { organizationId: orgId, createdAt: { gte: new Date(now - 14 * day) } }, take: 10000 }).catch(() => []);
    const rate = (rows: any[]) => {
      const done = rows.filter((s) => ["delivered", "partial_delivered", "cancelled", "returned"].includes(s.status));
      if (done.length < 5) return null;
      return (done.filter((s) => s.status === "delivered" || s.status === "partial_delivered").length / done.length) * 100;
    };
    const providers = [...new Set((ships as any[]).map((s) => s.provider as string))];
    for (const provider of providers) {
      const rows = (ships as any[]).filter((s) => s.provider === provider);
      const recent = rate(rows.filter((s) => new Date(s.createdAt).getTime() >= now - 7 * day));
      const prior = rate(rows.filter((s) => new Date(s.createdAt).getTime() < now - 7 * day));
      if (recent !== null && prior !== null && prior - recent >= 10) {
        lines.push(`${provider} কুরিয়ারের ডেলিভারি রেট কমেছে: আগের সপ্তাহে ${prior.toFixed(0)}% → এই সপ্তাহে ${recent.toFixed(0)}%।`);
      }
    }

    // (3) unanswered backlog
    const openQ = await p.aiUnansweredQuestion.findMany({ where: { organizationId: orgId, status: "open" }, orderBy: { count: "desc" }, take: 1 }).catch(() => []);
    const openCount = await p.aiUnansweredQuestion.count({ where: { organizationId: orgId, status: "open" } }).catch(() => 0);
    if (openCount >= 5 && openQ[0]) {
      lines.push(`ইনবক্সে ${openCount}টি প্রশ্নের উত্তর এখনো বাকি — সবচেয়ে বেশি আসা প্রশ্ন: “${openQ[0].normalizedQuestion}” (${openQ[0].count}বার)।`);
    }
    return lines.slice(0, 5);
  }

  /** Month-to-date revenue vs the previous month's same span. */
  private async monthPacingLine(orgId: string): Promise<string | null> {
    const p = this.p();
    const now = new Date();
    const startThis = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
    const startPrev = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - 1, 1));
    const elapsedMs = now.getTime() - startThis.getTime();
    const sum = async (from: Date, to: Date) => {
      const rows = await p.order.findMany({ where: { organizationId: orgId, isPractice: false, createdAt: { gte: from, lt: to } }, take: 10000 }).catch(() => []);
      return (rows as any[]).filter((o) => !REVENUE_EXCLUDED_STATUSES.includes(o.status)).reduce((s, o) => s + Number(o.totalMinor ?? 0), 0);
    };
    const [cur, prev] = await Promise.all([sum(startThis, now), sum(startPrev, new Date(startPrev.getTime() + elapsedMs))]);
    if (cur <= 0 || prev <= 0) return null;
    const delta = Math.round(((cur - prev) / prev) * 100);
    return `মাসের গতি: এই মাসে এখন পর্যন্ত আয় আগের মাসের একই সময়ের তুলনায় ${delta >= 0 ? "+" : ""}${delta}% (${delta >= 0 ? "এগিয়ে" : "পিছিয়ে"})।`;
  }

  /**
   * EC11: one commerce line for the daily briefing, from real
   * CommerceAnalyticsService signals only. Null when the service is
   * absent, the org has no commerce data, or every signal is zero
   * (a zero-everything line is noise, not a briefing).
   */
  async commerceBriefingLine(orgId: string, now = new Date()): Promise<string | null> {
    if (!this.commerceAnalytics) return null;
    const signals: any = await this.commerceAnalytics.commerceSignals(orgId, now);
    if (!signals?.hasCommerceData) return null;
    const total = Number(signals.failedSyncs24h ?? 0) + Number(signals.openConflicts ?? 0) + Number(signals.stockDivergedCount ?? 0) + Number(signals.unfulfilledOlderThan48h ?? 0);
    if (total === 0) return null;
    return `কমার্স অবস্থা: গত ২৪ ঘণ্টায় ব্যর্থ সিঙ্ক ${signals.failedSyncs24h}টি, খোলা কনফ্লিক্ট ${signals.openConflicts}টি, স্টক-বিচ্যুত লিস্টিং ${signals.stockDivergedCount}টি, ৪৮ ঘণ্টার বেশি পুরনো অপূর্ণ অর্ডার ${signals.unfulfilledOlderThan48h}টি। বিস্তারিত: Commerce Hub / Sync Center।`;
  }

  /** Send via the org's CONNECTED telegram integration bot. Returns
   *  false when no usable integration exists (honest skip). */
  private async sendTelegramBrief(orgId: string, chatId: string, text: string): Promise<boolean> {
    const integration = await this.p().integration.findFirst({
      where: { organizationId: orgId, provider: "telegram", status: "CONNECTED" },
      include: { credential: true },
    }).catch(() => null);
    const stored = (integration as any)?.credential?.encryptedData;
    if (!stored) return false;
    const creds = decryptJson<{ botToken?: string }>(stored);
    if (!creds?.botToken) return false;
    await new TelegramClient(String(creds.botToken)).sendMessage(chatId, text.slice(0, 3900));
    return true;
  }

  /** AP6 Assistant Task Inbox — one aggregate for the AI surfaces. */
  async taskInbox(orgId: string) {
    const p = this.p();
    const [pendingProposals, unansweredOpen, radar, briefingRows] = await Promise.all([
      p.aIActionProposal.count({ where: { organizationId: orgId, status: "proposed" } }).catch(() => 0),
      p.aiUnansweredQuestion.count({ where: { organizationId: orgId, status: "open" } }).catch(() => 0),
      this.computeOpportunityRadar(orgId).catch(() => [] as string[]),
      p.agentNotification.findMany({ where: { organizationId: orgId, type: "ai_briefing", createdAt: { gte: this.startOfToday() } }, take: 1 }).catch(() => []),
    ]);
    return {
      pendingProposals,
      unansweredOpen,
      radar,
      briefingToday: (briefingRows as any[]).length > 0,
    };
  }

  /** Run one daily cycle for an org. Safe to call repeatedly (dedupe). */
  async runDailyBriefing(orgId: string, actorId: string) {
    const settings = await this.getSettings(orgId);
    if (!settings.briefingEnabled && !settings.anomalyAlertsEnabled) {
      return { skipped: "proactive_disabled", briefings: 0, anomalyAlerts: 0 };
    }
    if (!this.tools) return { skipped: "tools_unavailable", briefings: 0, anomalyAlerts: 0 };
    const yesterday = new Date(Date.now() - 86400000).toISOString().slice(0, 10);
    const overview: any = await this.tools.execute(orgId, { tool: "get_analytics_overview", args: { from: yesterday, to: yesterday } });
    const anomalyResult: any = await this.tools.getAnomalies(orgId, 14);
    const anomalies: any[] = anomalyResult?.anomalies ?? [];
    const userIds = await this.recipients(orgId);
    let telegramSent = 0;
    let telegramSkipped: string | null = null;
    let briefings = 0;
    let anomalyAlerts = 0;
    let emailsSent = 0;

    if (settings.briefingEnabled) {
      const lines: string[] = [];
      if (Number(overview?.orders ?? 0) > 0) {
        lines.push(`গতকালের সারসংক্ষেপ (${yesterday}): অর্ডার ${overview.orders}টি, Revenue ${overview.revenue}, Ad Spend ${overview.adSpend}, Contribution Profit ${overview.contributionProfit} (Margin ${overview.contributionMarginPercent ?? "—"}%)।`);
      } else {
        lines.push(`গতকাল (${yesterday}) কোনো অর্ডার রেকর্ড হয়নি। এটি একটি সৎ “তথ্য নেই” ব্রিফিং — কোনো সংখ্যা বানানো হয়নি। অর্ডার/সিঙ্ক ঠিকমতো হচ্ছে কিনা দেখে নিন।`);
      }
      if (anomalies.length) {
        lines.push(`অস্বাভাবিকতা ধরা পড়েছে ${anomalies.length}টি: ${anomalies.slice(0, 3).map((a) => a.message).join(" ")}`);
      }
      if (overview?.cogsCoveragePercent !== undefined && Number(overview.cogsCoveragePercent) < 100) {
        lines.push(`দ্রষ্টব্য: COGS coverage ${overview.cogsCoveragePercent}% — কিছু পণ্যের কস্ট বাকি, তাই লাভের হিসাব আংশিক।`);
      }
      // AP6: opportunity radar + month pacing — deterministic,
      // real-signal lines only; empty when there is no signal.
      const radar = await this.computeOpportunityRadar(orgId).catch(() => [] as string[]);
      if (radar.length) lines.push(`সুযোগ ও ঝুঁকি:\n${radar.map((r) => `• ${r}`).join("\n")}`);
      const pacing = await this.monthPacingLine(orgId).catch(() => null);
      if (pacing) lines.push(pacing);
      const commerceLine = await this.commerceBriefingLine(orgId).catch(() => null);
      if (commerceLine) lines.push(commerceLine);
      const title = `দৈনিক ব্রিফিং — ${yesterday}`;
      const body = lines.join("\n");
      for (const userId of userIds) {
        if (await this.alreadySent(orgId, userId, "ai_briefing")) continue;
        await this.notify(orgId, userId, "ai_briefing", title, body);
        briefings++;
      }
      // CX12b (12e completion): optional EMAIL COPY of the same
      // briefing to the same OWNER/ADMIN recipients. The in-app
      // notification above remains the primary path — the copy is
      // sent only when the org opted in AND SMTP is configured AND
      // this run really created in-app briefings (so the per-day
      // dedupe governs the copy too). A recipient with no email is
      // skipped; a rejected send is counted as not sent.
      if (settings.dailyReportEmailEnabled && briefings > 0 && this.email?.isConfigured()) {
        const users = await this.p().user.findMany({ where: { id: { in: userIds } }, select: { id: true, email: true } }).catch(() => []);
        for (const u of users as any[]) {
          if (!u.email) continue;
          try {
            await this.email!.send({ to: u.email, subject: title, text: body });
            emailsSent++;
          } catch { /* a rejected copy is simply not sent */ }
        }
      }

      // AP6: optional TELEGRAM copy of the same briefing — only when
      // the org opted in, set a chat id, has a CONNECTED telegram
      // integration with a bot token, and this run really created
      // in-app briefings (the per-day dedupe governs the copy too).
      // A failed send is reported in the result, never faked.
      if (settings.telegramBriefEnabled) {
        if (briefings === 0) telegramSkipped = "no_new_briefing";
        else if (!settings.telegramBriefChatId) telegramSkipped = "no_chat_id";
        else {
          try {
            const sent = await this.sendTelegramBrief(orgId, settings.telegramBriefChatId, `${title}\n\n${body}`);
            telegramSent = sent ? 1 : 0;
            if (!sent) telegramSkipped = "no_telegram_integration";
          } catch (e) {
            telegramSkipped = e instanceof Error ? e.message : "telegram_send_failed";
          }
        }
      }
    }


    if (settings.anomalyAlertsEnabled) {
      const critical = anomalies.filter((a) => a.severity === "critical");
      for (const a of critical) {
        const marker = `[${a.type}]`;
        const title = `Anomaly Alert — ${a.type}`;
        const body = `${marker} ${a.message}`;
        for (const userId of userIds) {
          if (await this.alreadySent(orgId, userId, "ai_anomaly", marker)) continue;
          await this.notify(orgId, userId, "ai_anomaly", title, body);
          anomalyAlerts++;
        }
      }
    }

    await this.audit.log({
      organizationId: orgId, userId: actorId, action: "ai.daily_briefing", entityType: "Organization", entityId: orgId,
      metadata: { briefings, anomalyAlerts, anomalies: anomalies.length, orders: Number(overview?.orders ?? 0), emailsSent },
    });
    return { briefings, anomalyAlerts, anomalies: anomalies.length, recipients: userIds.length, emailsSent, telegramSent, telegramSkipped };
  }
}
