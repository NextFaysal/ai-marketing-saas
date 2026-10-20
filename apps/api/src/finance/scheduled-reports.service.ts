import { Injectable } from "@nestjs/common";
import { AuditService } from "../audit/audit.service";
import { EmailProvider } from "../messaging/email.provider";
import { OrderProfitService } from "../orders/order-profit.service";
import { PrismaService } from "../prisma/prisma.service";
import { FinanceReportsService, reportLabelFor } from "./finance-reports.service";
import { badRequest, notFound } from "../i18n";
import {
  catalogList,
  catalogText,
  resolveDocumentLocale,
  type ApiLocale,
} from "../i18n/catalog/send-locale";
import { aggregateFunnels, type BroadcastFunnelShape } from "../messaging/analytics";
import {
  buildFileFromSections,
  dhakaDateKey,
  takaCell,
  takaText,
  toBig,
  type BuiltFile,
  type ReportSection,
} from "./finance-common";

/**
 * GB8 (GC19.3) — scheduled report delivery by email.
 *
 * Attachments: EmailProvider.send historically exposed no
 * attachment parameter; GB8 extended it with an OPTIONAL
 * pass-through to the underlying nodemailer transport (which
 * always supported attachments). So scheduled reports ARE
 * delivered as real email attachments — and a run is recorded
 * "sent" ONLY when at least one recipient's send returned a
 * message id (the platform-wide sent rule). When the platform
 * email service is not configured the run records
 * failed_no_provider and nothing claims delivery.
 *
 * Exactly-once stance: for a scheduled (non-test) run the
 * config's lastRunAt is stamped BEFORE the file is generated and
 * sent. A crash mid-run therefore LOSES that period's send
 * rather than duplicating it; the loss is visible because no run
 * row exists for the period. Test sends ("এখনই পাঠান") never
 * stamp lastRunAt.
 *
 * Periods: daily = yesterday (Dhaka); weekly = the 7 Dhaka days
 * ending yesterday. Due: daily — lastRunAt's Dhaka date is before
 * today (or never ran); weekly — lastRunAt is ≥ 7 days ago (or
 * never ran).
 */

export const SCHEDULED_REPORT_TYPES = ["discounts", "refunds", "payment_sales", "category_sales", "shipping_cost", "profit", "messaging_summary"] as const;
const CADENCES = ["daily", "weekly"] as const;
const FORMATS = ["csv", "xlsx"] as const;
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

@Injectable()
export class ScheduledReportsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly email: EmailProvider,
    private readonly reports: FinanceReportsService,
    private readonly profit: OrderProfitService,
  ) {}

  private t(name: string): any {
    return (this.prisma as any)[name];
  }

  // ---------------- CRUD ----------------

  private serializeConfig(c: any) {
    return {
      id: String(c.id),
      reportType: String(c.reportType),
      cadence: String(c.cadence),
      format: String(c.format ?? "csv"),
      recipients: Array.isArray(c.recipients) ? c.recipients.map(String) : [],
      enabled: Boolean(c.enabled),
      lastRunAt: c.lastRunAt ? new Date(c.lastRunAt).toISOString() : null,
      createdAt: c.createdAt ? new Date(c.createdAt).toISOString() : null,
    };
  }

  private serializeRun(r: any) {
    return {
      id: String(r.id),
      scheduledReportId: String(r.scheduledReportId),
      periodLabel: String(r.periodLabel),
      status: String(r.status),
      testRun: Boolean(r.testRun),
      detail: r.detail ?? null,
      createdAt: r.createdAt ? new Date(r.createdAt).toISOString() : null,
    };
  }

  private validateRecipients(raw: unknown): string[] {
    if (!Array.isArray(raw)) throw badRequest("finance.scheduled.recipientsListRequired");
    const cleaned = [...new Set(raw.map((r) => String(r ?? "").trim().toLowerCase()).filter(Boolean))];
    if (!cleaned.length) throw badRequest("finance.scheduled.atLeastOneRecipient");
    if (cleaned.length > 10) throw badRequest("finance.scheduled.maxRecipients");
    for (const e of cleaned) if (!EMAIL_RE.test(e)) throw badRequest("finance.scheduled.emailInvalid", { email: e });
    return cleaned;
  }

  private validateConfigBody(body: any, partial: boolean): Record<string, unknown> {
    const out: Record<string, unknown> = {};
    if (!partial || body.reportType !== undefined) {
      if (!SCHEDULED_REPORT_TYPES.includes(body.reportType)) throw badRequest("finance.scheduled.reportTypeFromList");
      out.reportType = body.reportType;
    }
    if (!partial || body.cadence !== undefined) {
      if (!CADENCES.includes(body.cadence)) throw badRequest("finance.scheduled.cadenceInvalid");
      out.cadence = body.cadence;
    }
    if (body.format !== undefined) {
      if (!FORMATS.includes(body.format)) throw badRequest("finance.scheduled.formatInvalid");
      out.format = body.format;
    }
    if (!partial || body.recipients !== undefined) out.recipients = this.validateRecipients(body.recipients);
    if (body.enabled !== undefined) out.enabled = Boolean(body.enabled);
    return out;
  }

  async listConfigs(organizationId: string) {
    const rows = await this.t("scheduledReport").findMany({ where: { organizationId }, orderBy: { createdAt: "desc" }, take: 100 });
    return { items: rows.map((c: any) => this.serializeConfig(c)) };
  }

  private async findConfig(organizationId: string, id: string) {
    const row = await this.t("scheduledReport").findFirst({ where: { id, organizationId } });
    if (!row) throw notFound("finance.scheduled.notFound");
    return row;
  }

  async createConfig(organizationId: string, actorId: string | undefined, body: any) {
    const data = this.validateConfigBody(body ?? {}, false);
    const row = await this.t("scheduledReport").create({
      data: { organizationId, createdById: actorId ?? null, format: "csv", enabled: true, ...data },
    });
    await this.audit.log({ organizationId, userId: actorId, action: "finance.scheduled_report_created", entityType: "ScheduledReport", entityId: String(row.id), metadata: { reportType: row.reportType, cadence: row.cadence } }).catch(() => undefined);
    return this.serializeConfig(row);
  }

  async updateConfig(organizationId: string, actorId: string | undefined, id: string, body: any) {
    await this.findConfig(organizationId, id);
    const data = this.validateConfigBody(body ?? {}, true);
    const row = await this.t("scheduledReport").update({ where: { id }, data });
    await this.audit.log({ organizationId, userId: actorId, action: "finance.scheduled_report_updated", entityType: "ScheduledReport", entityId: id, metadata: { fields: Object.keys(data) } }).catch(() => undefined);
    return this.serializeConfig(row);
  }

  async deleteConfig(organizationId: string, actorId: string | undefined, id: string) {
    await this.findConfig(organizationId, id);
    await this.t("scheduledReport").delete({ where: { id } });
    await this.audit.log({ organizationId, userId: actorId, action: "finance.scheduled_report_deleted", entityType: "ScheduledReport", entityId: id }).catch(() => undefined);
    return { ok: true };
  }

  async listRuns(organizationId: string, id: string) {
    await this.findConfig(organizationId, id);
    const rows = await this.t("scheduledReportRun").findMany({
      where: { organizationId, scheduledReportId: id },
      orderBy: { createdAt: "desc" },
      take: 50,
    });
    return { items: rows.map((r: any) => this.serializeRun(r)) };
  }

  // ---------------- generation ----------------

  private async buildProfitFile(organizationId: string, from: string, to: string, format: "csv" | "xlsx", locale: ApiLocale = "bn"): Promise<BuiltFile> {
    const T = (key: string, params?: Record<string, unknown>) => catalogText(key, locale, params);
    const H = (key: string) => catalogList(key, locale);
    const report = await this.profit.getProfitReport(organizationId, { from, to });
    const totals = report.totals ?? {};
    const fin = report.finance;
    const sections: ReportSection[] = [
      { title: T("finance.section.summary"), headers: H("finance.headers.descriptionAmount"), rows: [
        [T("finance.profit.totalOrders"), totals.orders ?? 0],
        [T("finance.profit.totalSales"), takaCell(toBig(totals.revenueMinor ?? 0))],
        [T("finance.profit.productCost"), takaCell(toBig(totals.productCostMinor ?? 0))],
        [T("finance.profit.costCoverage"), totals.costCoveragePercent ?? ""],
        [T("finance.profit.grossMargin"), totals.grossMarginMinor == null ? "" : takaCell(toBig(totals.grossMarginMinor))],
        ...(fin ? [
          [T("finance.profit.periodExpenses"), takaCell(toBig(fin.periodExpensesMinor ?? 0))],
          [T("finance.profit.gatewayFees"), fin.gatewayFeesMinor == null ? "" : takaCell(toBig(fin.gatewayFeesMinor))],
          [T("finance.profit.estimatedNet"), fin.estimatedNetMinor == null ? "" : takaCell(toBig(fin.estimatedNetMinor))],
        ] : []),
      ] },
      { title: T("finance.section.byProduct"), headers: H("finance.headers.productProfit"), rows: (report.perProduct ?? []).map((p: any) => [
        String(p.name ?? p.productId ?? "—"), Number(p.quantity ?? 0),
        takaCell(toBig(p.revenueMinor ?? 0)),
        p.costMinor == null ? "" : takaCell(toBig(p.costMinor)),
        p.marginMinor == null ? "" : takaCell(toBig(p.marginMinor)),
      ]) },
    ];
    const summary = [
      T("finance.summary.profitHead", { from, to }),
      T("finance.summary.profitLine", { orders: totals.orders ?? 0, revenue: takaText(toBig(totals.revenueMinor ?? 0)), margin: totals.grossMarginMinor == null ? T("finance.notCalculatedCostUnknown") : takaText(toBig(totals.grossMarginMinor)), coverage: totals.costCoveragePercent ?? "—" }),
      ...(fin?.estimatedNetMinor != null ? [T("finance.summary.profitNetLine", { net: takaText(toBig(fin.estimatedNetMinor)) })] : []),
    ].join("\n");
    return buildFileFromSections(`profit-${from}-to-${to}`, sections, format, summary, [T("finance.profitFileNote", { from, to })]);
  }

  /**
   * MX16 — the scheduled MESSAGING summary, plugged into this
   * existing system as a new reportType (the integration point
   * the MB6 Step-0 audit named — no second scheduler was
   * built). Figures come from the messaging records themselves
   * (Broadcast / MessageDelivery / MessageLinkClick rows of
   * the period, judged by sentAt), with the same funnel
   * capability rule as the broadcast report: a stage a channel
   * cannot report stays EMPTY (null), never 0. Orders are the
   * labelled ASSOCIATION figure (recipient customers'
   * non-cancelled, non-practice orders in the 7 days after
   * each broadcast was sent) — there is no honest
   * AttributionCredit join for messaging, so no attribution
   * figure appears anywhere in this file.
   */
  private async buildMessagingFile(organizationId: string, from: string, to: string, format: "csv" | "xlsx", locale: ApiLocale = "bn"): Promise<BuiltFile> {
    const T = (key: string, params?: Record<string, unknown>) => catalogText(key, locale, params);
    const H = (key: string) => catalogList(key, locale);
    const fromDate = new Date(`${from}T00:00:00+06:00`);
    const toDate = new Date(`${to}T23:59:59.999+06:00`);
    const allBroadcasts: any[] = await this.t("broadcast").findMany({
      where: { organizationId }, orderBy: { createdAt: "desc" }, take: 500,
    }).catch(() => []);
    const broadcasts = (allBroadcasts ?? []).filter((b: any) => {
      if (!b.sentAt) return false;
      const t = new Date(b.sentAt).getTime();
      return t >= fromDate.getTime() && t <= toDate.getTime();
    });
    const rows: {
      broadcast: any; funnel: BroadcastFunnelShape; assocOrders: number; assocTotal: bigint;
    }[] = [];
    for (const b of broadcasts) {
      const deliveries: any[] = await this.t("messageDelivery").findMany({
        where: { organizationId, broadcastId: b.id }, take: 20000,
      }).catch(() => []);
      let sent = 0, failed = 0, skipped = 0;
      const deliveredKeys = new Set<string>();
      const readKeys = new Set<string>();
      const openedKeys = new Set<string>();
      for (const d of deliveries ?? []) {
        if (d.status === "sent") sent++;
        else if (d.status === "failed") failed++;
        else if (d.status === "skipped") skipped++;
        if (d.status !== "sent") continue;
        const key = d.recipientId ? `${d.recipientType}:${d.recipientId}` : `${d.recipientType}:${d.address}`;
        if (d.deliveryStatus === "delivered" || d.deliveryStatus === "read" || d.deliveredAt) deliveredKeys.add(key);
        if (d.deliveryStatus === "read" || d.readAt) readKeys.add(key);
        if (d.openedAt) openedKeys.add(key);
      }
      const clicks: any[] = await this.t("messageLinkClick").findMany({
        where: { organizationId, broadcastId: b.id }, take: 20000,
      }).catch(() => []);
      const channel = String(b.channel);
      const funnel: BroadcastFunnelShape = {
        audience: sent + failed + skipped,
        sent, failed, skipped,
        delivered: channel === "whatsapp" || channel === "onsite" ? deliveredKeys.size : null,
        read: channel === "whatsapp" || channel === "onsite" ? readKeys.size : null,
        opened: channel === "email" && b.htmlBody ? openedKeys.size : null,
        clickedRecipients: ["whatsapp", "push", "telegram", "onsite"].includes(channel) ? null : new Set((clicks ?? []).map((c: any) => c.recipientKey)).size,
        totalClicks: ["whatsapp", "push", "telegram", "onsite"].includes(channel) ? null : (clicks ?? []).length,
      };
      // Association: recipient customers (snapshot entries or
      // BroadcastRecipient rows) → their orders in the 7 days
      // after this broadcast was sent.
      const customerIds = new Set<string>();
      const snapshot: any[] = Array.isArray(b.recipientSnapshot) ? b.recipientSnapshot : [];
      for (const e of snapshot) if (e?.type === "customer" && e?.id) customerIds.add(String(e.id));
      if (!snapshot.length) {
        const recips: any[] = await this.t("broadcastRecipient").findMany({
          where: { broadcastId: b.id, recipientType: "customer" }, take: 20000,
        }).catch(() => []);
        for (const r of recips ?? []) if (r.recipientId) customerIds.add(String(r.recipientId));
      }
      const start = new Date(b.sentAt);
      const end = new Date(start.getTime() + 7 * 24 * 3600 * 1000);
      let assocOrders = 0;
      let assocTotal = BigInt(0);
      const ids = [...customerIds];
      for (let s = 0; s < ids.length; s += 500) {
        const orders: any[] = await this.t("order").findMany({
          where: {
            organizationId, customerId: { in: ids.slice(s, s + 500) },
            createdAt: { gte: start, lt: end }, status: { not: "cancelled" }, isPractice: false,
          },
          select: { totalMinor: true },
        }).catch(() => []);
        for (const o of orders ?? []) {
          assocOrders++;
          try { assocTotal += BigInt(o.totalMinor ?? 0); } catch { /* malformed stored figure contributes nothing */ }
        }
      }
      rows.push({ broadcast: b, funnel, assocOrders, assocTotal });
    }
    const channels = aggregateFunnels(rows.map((r) => ({ channel: String(r.broadcast.channel), funnel: r.funnel })));
    const totSent = rows.reduce((s, r) => s + r.funnel.sent, 0);
    const totFailed = rows.reduce((s, r) => s + r.funnel.failed, 0);
    const totSkipped = rows.reduce((s, r) => s + r.funnel.skipped, 0);
    const totAssocOrders = rows.reduce((s, r) => s + r.assocOrders, 0);
    const totAssocTotal = rows.reduce((s, r) => s + r.assocTotal, BigInt(0));
    const cell = (v: number | null) => (v === null ? "" : v);
    const sections: ReportSection[] = [
      { title: T("finance.section.summary"), headers: H("finance.headers.descriptionAmount"), rows: [
        [T("finance.messaging.broadcastsSentInPeriod"), rows.length],
        [T("finance.messaging.totalSent"), totSent],
        [T("finance.messaging.totalFailed"), totFailed],
        [T("finance.messaging.totalSkipped"), totSkipped],
        [T("finance.messaging.associatedOrders"), totAssocOrders],
        [T("finance.messaging.associatedOrderTotal"), takaCell(totAssocTotal)],
      ] },
      { title: T("finance.section.funnelByChannel"), headers: H("finance.headers.funnelByChannel"), rows: channels.map((c) => [
        c.channel, c.broadcasts, c.sent, c.failed, c.skipped,
        cell(c.delivered), cell(c.read), cell(c.opened), cell(c.clickedRecipients), cell(c.totalClicks),
      ]) },
      { title: T("finance.section.byBroadcast"), headers: H("finance.headers.byBroadcast"), rows: rows.map((r) => [
        String(r.broadcast.name ?? ""), String(r.broadcast.channel), String(r.broadcast.status),
        r.funnel.sent, r.funnel.failed, r.funnel.skipped,
        cell(r.funnel.delivered), cell(r.funnel.read), cell(r.funnel.opened), cell(r.funnel.clickedRecipients),
        r.assocOrders, takaCell(r.assocTotal),
      ]) },
    ];
    const summary = [
      T("finance.summary.messagingHead", { from, to }),
      T("finance.summary.messagingLine", { broadcasts: rows.length, sent: totSent, failed: totFailed, skipped: totSkipped }),
      T("finance.summary.messagingAssocLine", { orders: totAssocOrders, total: takaText(totAssocTotal) }),
    ].join("\n");
    return buildFileFromSections(`messaging_summary-${from}-to-${to}`, sections, format, summary, [
      T("finance.messagingFileNote", { from, to }),
      T("finance.associationNote", { label: T("finance.associationLabel") }),
      T("finance.messagingNullStageNote"),
    ]);
  }

  private async buildFile(organizationId: string, config: any, now: Date): Promise<{ file: BuiltFile; periodLabel: string; locale: ApiLocale }> {
    const range = String(config.cadence) === "weekly"
      ? FinanceReportsService.lastWeekRange(now)
      : FinanceReportsService.yesterdayRange(now);
    const periodLabel = String(config.cadence) === "weekly" ? `${range.from}..${range.to}` : range.from;
    const format = (String(config.format ?? "csv") === "xlsx" ? "xlsx" : "csv") as "csv" | "xlsx";
    const type = String(config.reportType);
    // ML12: scheduled documents render in the org document locale.
    const locale = await resolveDocumentLocale(this.prisma as any, organizationId);
    const file = type === "profit"
      ? await this.buildProfitFile(organizationId, range.from, range.to, format, locale)
      : type === "messaging_summary"
        ? await this.buildMessagingFile(organizationId, range.from, range.to, format, locale)
        : await this.reports.buildReportFile(organizationId, type, range.from, range.to, format, locale);
    return { file, periodLabel, locale };
  }

  // ---------------- running ----------------

  /** One delivery attempt. `test` runs never stamp lastRunAt. */
  async runOne(organizationId: string, config: any, opts: { test: boolean; now?: Date }) {
    const now = opts.now ?? new Date();
    const recipients: string[] = Array.isArray(config.recipients) ? config.recipients.map(String) : [];
    if (!opts.test) {
      // Stamp FIRST (the exactly-once stance documented above).
      await this.t("scheduledReport").update({ where: { id: String(config.id) }, data: { lastRunAt: now } }).catch(() => undefined);
    }
    let file: BuiltFile;
    let periodLabel: string;
    let locale: ApiLocale = "bn";
    try {
      ({ file, periodLabel, locale } = await this.buildFile(organizationId, config, now));
    } catch (e: any) {
      const range = String(config.cadence) === "weekly" ? FinanceReportsService.lastWeekRange(now) : FinanceReportsService.yesterdayRange(now);
      const run = await this.t("scheduledReportRun").create({
        data: {
          scheduledReportId: String(config.id), organizationId,
          periodLabel: String(config.cadence) === "weekly" ? `${range.from}..${range.to}` : range.from,
          status: "failed_error", testRun: opts.test,
          detail: { error: String(e?.message ?? e), recipients: [] },
        },
      });
      return this.serializeRun(run);
    }
    const createRun = async (status: string, detail: Record<string, unknown>) => {
      const run = await this.t("scheduledReportRun").create({
        data: { scheduledReportId: String(config.id), organizationId, periodLabel, status, testRun: opts.test, detail },
      });
      return this.serializeRun(run);
    };
    if (!this.email.isConfigured()) {
      return createRun("failed_no_provider", { reason: "email_not_configured", attachment: file.filename, recipients: recipients.map((email) => ({ email, ok: false, error: "email_not_configured" })) });
    }
    const label = reportLabelFor(String(config.reportType), locale);
    const results: Array<{ email: string; ok: boolean; messageId?: string; error?: string }> = [];
    for (const to of recipients) {
      try {
        const sent = await this.email.send({
          to,
          subject: catalogText("finance.scheduled.emailSubject", locale, { label, period: periodLabel }),
          text: catalogText("finance.scheduled.emailBody", locale, { summary: file.summary, filename: file.filename }),
          attachments: [{ filename: file.filename, content: file.body, contentType: file.contentType }],
        });
        results.push({ email: to, ok: true, messageId: sent.providerMessageId });
      } catch (e: any) {
        results.push({ email: to, ok: false, error: String(e?.message ?? e) });
      }
    }
    const anyOk = results.some((r) => r.ok);
    return createRun(anyOk ? "sent" : "failed_error", { attachment: file.filename, recipients: results });
  }

  /** "এখনই পাঠান" — a test send of the current elapsed period. */
  async sendNow(organizationId: string, id: string) {
    const config = await this.findConfig(organizationId, id);
    return this.runOne(organizationId, config, { test: true });
  }

  /** Due rule (see the class doc). Exported for spec pinning. */
  static isDue(config: { cadence: string; lastRunAt?: Date | string | null }, now: Date): boolean {
    if (!config.lastRunAt) return true;
    const last = new Date(config.lastRunAt);
    if (String(config.cadence) === "weekly") return now.getTime() - last.getTime() >= 7 * 86400_000;
    return dhakaDateKey(last) < dhakaDateKey(now);
  }

  /** The scheduled_report_sweep job body (per-org enablement). */
  async runSweep(organizationId: string) {
    const now = new Date();
    const configs = await this.t("scheduledReport").findMany({ where: { organizationId, enabled: true }, take: 100 });
    let ran = 0, sent = 0, failed = 0;
    for (const config of configs) {
      if (!ScheduledReportsService.isDue(config, now)) continue;
      const run = await this.runOne(organizationId, config, { test: false, now });
      ran += 1;
      if (run.status === "sent") sent += 1; else failed += 1;
    }
    return { checked: configs.length, ran, sent, failed };
  }
}
