import { Injectable } from "@nestjs/common";
import { PrismaService } from "../prisma/prisma.service";
import { AuditService } from "../audit/audit.service";
import { AnalyticsService } from "../analytics/analytics.service";
import { badRequest, notFound } from "../i18n/api-exception";

/**
 * Reports Advanced RP5 — monthly goals. Actuals come
 * from the same computeRange as the analytics
 * overview. Pace is the share of the month that has
 * elapsed (for the current month), 100 for past
 * months, 0 for future months — a plain arithmetic
 * fact, shown next to the progress so the reader
 * judges "ahead/behind" themselves.
 */
export const GOAL_METRICS = ["revenue", "orders", "spend"] as const;
const MONTH_RE = /^\d{4}-(0[1-9]|1[0-2])$/;

export function monthWindow(month: string, now = new Date()): { from: string; to: string; daysInMonth: number; elapsedDays: number } {
  if (!MONTH_RE.test(month)) throw badRequest("reports.monthMustBeYyyyMm");
  const [y, m] = month.split("-").map(Number);
  const daysInMonth = new Date(Date.UTC(y, m, 0)).getUTCDate();
  const first = new Date(Date.UTC(y, m - 1, 1));
  const today = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
  const elapsed = today < first ? 0 : today.getTime() >= first.getTime() + daysInMonth * 86400000 ? daysInMonth : Math.floor((today.getTime() - first.getTime()) / 86400000) + 1;
  const last = new Date(first.getTime() + (daysInMonth - 1) * 86400000);
  const effectiveLast = today < last ? today : last;
  return {
    from: first.toISOString().slice(0, 10),
    to: (today < first ? first : effectiveLast).toISOString().slice(0, 10),
    daysInMonth, elapsedDays: elapsed,
  };
}

@Injectable()
export class ReportGoalsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly analytics: AnalyticsService,
  ) {}

  async list(organizationId: string, month: string) {
    const w = monthWindow(month);
    const goals = await (this.prisma as any).reportGoal.findMany({ where: { organizationId, month } });
    const byMetric = new Map<string, any>((goals ?? []).map((g: any) => [g.metric, g]));
    // Actuals only make sense once the month has started.
    let totals: any = null;
    if (w.elapsedDays > 0) {
      const r = await this.analytics.computeRange(organizationId, new Date(`${w.from}T00:00:00.000Z`), new Date(new Date(`${w.to}T00:00:00.000Z`).getTime() + 86400000));
      totals = r.totals;
    }
    const actualOf = (metric: string): bigint => {
      if (!totals) return 0n;
      if (metric === "revenue") return BigInt(totals.revenueMinor ?? 0);
      if (metric === "spend") return BigInt(totals.adSpendMinor ?? 0);
      return BigInt(totals.orders ?? 0);
    };
    const pacePct = Math.round((w.elapsedDays / w.daysInMonth) * 10000) / 100;
    return {
      month, pacePct, elapsedDays: w.elapsedDays, daysInMonth: w.daysInMonth,
      goals: GOAL_METRICS.map((metric) => {
        const g = byMetric.get(metric);
        const actual = actualOf(metric);
        const target = g ? BigInt(g.target) : null;
        return {
          metric,
          goalId: g?.id ?? null,
          target: target !== null ? target.toString() : null,
          actual: actual.toString(),
          progressPct: target !== null && target > 0n ? Math.round(Number((actual * 10000n) / target)) / 100 : null,
        };
      }),
    };
  }

  async set(organizationId: string, actorId: string, dto: { month: string; metric: string; target: string }) {
    monthWindow(dto.month);
    if (!(GOAL_METRICS as readonly string[]).includes(dto.metric)) throw badRequest("reports.metricMustBeOneOf", { p1: GOAL_METRICS.join(", ") });
    let target: bigint;
    try { target = BigInt(dto.target); } catch { throw badRequest("reports.targetMustBeAnIntegerMinor"); }
    if (target < 0n) throw badRequest("reports.targetCannotBeNegative");
    const row = await (this.prisma as any).reportGoal.upsert({
      where: { organizationId_month_metric: { organizationId, month: dto.month, metric: dto.metric } },
      create: { organizationId, month: dto.month, metric: dto.metric, target, createdById: actorId },
      update: { target },
    });
    await this.audit.log({ organizationId, userId: actorId, action: "report_goal_set", entityType: "report_goal", entityId: row.id, metadata: { month: dto.month, metric: dto.metric, target: target.toString() } }).catch(() => undefined);
    return { ...row, target: row.target.toString() };
  }

  async remove(organizationId: string, actorId: string, id: string) {
    const row = await (this.prisma as any).reportGoal.findFirst({ where: { id, organizationId } });
    if (!row) throw notFound("reports.goalNotFound");
    await (this.prisma as any).reportGoal.delete({ where: { id } });
    await this.audit.log({ organizationId, userId: actorId, action: "report_goal_deleted", entityType: "report_goal", entityId: id, metadata: {} }).catch(() => undefined);
    return { deleted: true };
  }
}
