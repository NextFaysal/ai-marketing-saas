import { Injectable } from "@nestjs/common";
import { AuditService } from "../audit/audit.service";
import { EmailProvider } from "../messaging/email.provider";
import { OrderProfitService } from "../orders/order-profit.service";
import { PrismaService } from "../prisma/prisma.service";
import { FinanceReportsService, REPORT_LABELS_BN } from "./finance-reports.service";
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

export const SCHEDULED_REPORT_TYPES = ["discounts", "refunds", "payment_sales", "category_sales", "shipping_cost", "profit"] as const;
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
    if (!Array.isArray(raw)) throw new Error("প্রাপকের ইমেইল তালিকা দিন");
    const cleaned = [...new Set(raw.map((r) => String(r ?? "").trim().toLowerCase()).filter(Boolean))];
    if (!cleaned.length) throw new Error("অন্তত একজন প্রাপকের ইমেইল দিন");
    if (cleaned.length > 10) throw new Error("সর্বোচ্চ ১০ জন প্রাপক যোগ করা যাবে");
    for (const e of cleaned) if (!EMAIL_RE.test(e)) throw new Error(`ইমেইল ঠিকানাটি সঠিক নয়: ${e}`);
    return cleaned;
  }

  private validateConfigBody(body: any, partial: boolean): Record<string, unknown> {
    const out: Record<string, unknown> = {};
    if (!partial || body.reportType !== undefined) {
      if (!SCHEDULED_REPORT_TYPES.includes(body.reportType)) throw new Error("রিপোর্টের ধরনটি তালিকা থেকে বেছে নিন");
      out.reportType = body.reportType;
    }
    if (!partial || body.cadence !== undefined) {
      if (!CADENCES.includes(body.cadence)) throw new Error("পাঠানোর ব্যবধান daily বা weekly হতে হবে");
      out.cadence = body.cadence;
    }
    if (body.format !== undefined) {
      if (!FORMATS.includes(body.format)) throw new Error("ফরম্যাট csv বা xlsx হতে হবে");
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
    if (!row) throw new Error("নির্ধারিত রিপোর্টটি পাওয়া যায়নি");
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

  private async buildProfitFile(organizationId: string, from: string, to: string, format: "csv" | "xlsx"): Promise<BuiltFile> {
    const report = await this.profit.getProfitReport(organizationId, { from, to });
    const totals = report.totals ?? {};
    const fin = report.finance;
    const sections: ReportSection[] = [
      { title: "সারসংক্ষেপ", headers: ["বিবরণ", "পরিমাণ"], rows: [
        ["মোট অর্ডার", totals.orders ?? 0],
        ["মোট বিক্রি (টাকা)", takaCell(toBig(totals.revenueMinor ?? 0))],
        ["পণ্যের খরচ (টাকা)", takaCell(toBig(totals.productCostMinor ?? 0))],
        ["খরচ-কভারেজ (%)", totals.costCoveragePercent ?? ""],
        ["মোট মার্জিন (টাকা)", totals.grossMarginMinor == null ? "" : takaCell(toBig(totals.grossMarginMinor))],
        ...(fin ? [
          ["সময়সীমার খরচ (টাকা)", takaCell(toBig(fin.periodExpensesMinor ?? 0))],
          ["গেটওয়ে ফি (টাকা)", fin.gatewayFeesMinor == null ? "" : takaCell(toBig(fin.gatewayFeesMinor))],
          ["আনুমানিক নিট লাভ (টাকা)", fin.estimatedNetMinor == null ? "" : takaCell(toBig(fin.estimatedNetMinor))],
        ] : []),
      ] },
      { title: "পণ্য অনুযায়ী", headers: ["পণ্য", "বিক্রীত পরিমাণ", "আয় (টাকা)", "খরচ (টাকা)", "মার্জিন (টাকা)"], rows: (report.perProduct ?? []).map((p: any) => [
        String(p.name ?? p.productId ?? "—"), Number(p.quantity ?? 0),
        takaCell(toBig(p.revenueMinor ?? 0)),
        p.costMinor == null ? "" : takaCell(toBig(p.costMinor)),
        p.marginMinor == null ? "" : takaCell(toBig(p.marginMinor)),
      ]) },
    ];
    const summary = [
      `লাভের রিপোর্ট · ${from} — ${to}`,
      `অর্ডার: ${totals.orders ?? 0}টি · বিক্রি: ${takaText(toBig(totals.revenueMinor ?? 0))} · মোট মার্জিন: ${totals.grossMarginMinor == null ? "হিসাব হয়নি (খরচ অজানা)" : takaText(toBig(totals.grossMarginMinor))} (কভারেজ ${totals.costCoveragePercent ?? "—"}%)`,
      ...(fin?.estimatedNetMinor != null ? [`আনুমানিক নিট লাভ: ${takaText(toBig(fin.estimatedNetMinor))}`] : []),
    ].join("\n");
    return buildFileFromSections(`profit-${from}-to-${to}`, sections, format, summary, [`লাভের রিপোর্ট · সময়সীমা: ${from} থেকে ${to} (ঢাকা) · ভিত্তি: পণ্যের লাইন-মোট (ছাড়ের আগে)`]);
  }

  private async buildFile(organizationId: string, config: any, now: Date): Promise<{ file: BuiltFile; periodLabel: string }> {
    const range = String(config.cadence) === "weekly"
      ? FinanceReportsService.lastWeekRange(now)
      : FinanceReportsService.yesterdayRange(now);
    const periodLabel = String(config.cadence) === "weekly" ? `${range.from}..${range.to}` : range.from;
    const format = (String(config.format ?? "csv") === "xlsx" ? "xlsx" : "csv") as "csv" | "xlsx";
    const type = String(config.reportType);
    const file = type === "profit"
      ? await this.buildProfitFile(organizationId, range.from, range.to, format)
      : await this.reports.buildReportFile(organizationId, type, range.from, range.to, format);
    return { file, periodLabel };
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
    try {
      ({ file, periodLabel } = await this.buildFile(organizationId, config, now));
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
    const label = REPORT_LABELS_BN[String(config.reportType)] ?? String(config.reportType);
    const results: Array<{ email: string; ok: boolean; messageId?: string; error?: string }> = [];
    for (const to of recipients) {
      try {
        const sent = await this.email.send({
          to,
          subject: `রিপোর্ট: ${label} (${periodLabel})`,
          text: `${file.summary}\n\nসম্পূর্ণ রিপোর্টটি এই ইমেইলে সংযুক্ত (attachment) করা হয়েছে: ${file.filename}`,
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
