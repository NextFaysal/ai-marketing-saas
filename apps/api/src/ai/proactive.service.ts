import { Injectable, Optional } from "@nestjs/common";
import { PrismaService } from "../prisma/prisma.service";
import { AuditService } from "../audit/audit.service";
import { ToolsService } from "./tools.service";

export interface ProactiveSettings { briefingEnabled: boolean; anomalyAlertsEnabled: boolean }
const DEFAULT_SETTINGS: ProactiveSettings = { briefingEnabled: true, anomalyAlertsEnabled: true };

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
  ) {}

  private p(): any { return this.prisma as any; }

  async getSettings(orgId: string): Promise<ProactiveSettings> {
    const row = await this.p().aIProactiveSetting.findUnique({ where: { organizationId: orgId } }).catch(() => null);
    if (!row) return { ...DEFAULT_SETTINGS };
    return { briefingEnabled: row.briefingEnabled !== false, anomalyAlertsEnabled: row.anomalyAlertsEnabled !== false };
  }

  async updateSettings(orgId: string, userId: string, dto: Partial<ProactiveSettings>) {
    const current = await this.getSettings(orgId);
    const next: ProactiveSettings = {
      briefingEnabled: dto.briefingEnabled ?? current.briefingEnabled,
      anomalyAlertsEnabled: dto.anomalyAlertsEnabled ?? current.anomalyAlertsEnabled,
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
    let briefings = 0;
    let anomalyAlerts = 0;

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
      const title = `দৈনিক ব্রিফিং — ${yesterday}`;
      const body = lines.join("\n");
      for (const userId of userIds) {
        if (await this.alreadySent(orgId, userId, "ai_briefing")) continue;
        await this.notify(orgId, userId, "ai_briefing", title, body);
        briefings++;
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
      metadata: { briefings, anomalyAlerts, anomalies: anomalies.length, orders: Number(overview?.orders ?? 0) },
    });
    return { briefings, anomalyAlerts, anomalies: anomalies.length, recipients: userIds.length };
  }
}
