import { BadRequestException, Injectable, NotFoundException } from "@nestjs/common";
import { PrismaService } from "../prisma/prisma.service";
import { AuditService } from "../audit/audit.service";
import { AnalyticsService, parseRange } from "../analytics/analytics.service";

/**
 * Reports Advanced RP2 — the custom report engine.
 * Runs from the SAME sources as the product's own
 * numbers: day = DailyMetricAggregate (coverage is
 * ensured via the existing recompute path first);
 * platform/campaign = campaign-level DailyAdMetric
 * rows (adExternalId "" and adSetExternalId "").
 * The metric matrix is HONEST: order-side metrics do
 * not exist per platform/campaign and ad metrics do
 * not exist per day in the aggregate — unsupported
 * combinations are refused with the allowed list,
 * never silently zero-filled. Derived metrics
 * (profit, AOV, CTR, CPM, CPA) return null when
 * their denominator is zero.
 */
export const DAY_METRICS = ["orders", "revenue", "refunds", "cogs", "adSpend", "profit", "aov"] as const;
export const ADS_METRICS = ["spend", "impressions", "clicks", "conversions", "conversionValue", "ctr", "cpm", "cpa"] as const;
export const DIMENSIONS = ["day", "platform", "campaign"] as const;
export const RANGE_PRESETS = ["last_7d", "last_30d", "this_month", "last_month"] as const;

export function metricsFor(dimension: string): readonly string[] {
  return dimension === "day" ? DAY_METRICS : ADS_METRICS;
}
export function validateDefinition(dimension: string, metrics: string[]) {
  if (!(DIMENSIONS as readonly string[]).includes(dimension)) throw new BadRequestException(`dimension must be one of ${DIMENSIONS.join(", ")}`);
  if (!Array.isArray(metrics) || !metrics.length) throw new BadRequestException("অন্তত একটি metric বেছে নিন");
  const allowed = metricsFor(dimension);
  const bad = metrics.filter((m) => !allowed.includes(m));
  if (bad.length) throw new BadRequestException(`এই dimension-এ এই metric পাওয়া যায় না: ${bad.join(", ")}। পাওয়া যায়: ${allowed.join(", ")}`);
}
export function presetRange(preset: string): { from: string; to: string } {
  const now = new Date();
  const iso = (d: Date) => d.toISOString().slice(0, 10);
  const today = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
  switch (preset) {
    case "last_7d": return { from: iso(new Date(today.getTime() - 6 * 86400000)), to: iso(today) };
    case "last_30d": return { from: iso(new Date(today.getTime() - 29 * 86400000)), to: iso(today) };
    case "this_month": return { from: iso(new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), 1))), to: iso(today) };
    case "last_month": {
      const firstThis = new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), 1));
      const firstLast = new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth() - 1, 1));
      return { from: iso(firstLast), to: iso(new Date(firstThis.getTime() - 86400000)) };
    }
    default: throw new BadRequestException(`rangePreset must be one of ${RANGE_PRESETS.join(", ")}`);
  }
}

type Values = Record<string, string | number | null>;
const money = (v: bigint | number) => BigInt(v).toString();
const ratio2 = (num: number, den: number) => (den > 0 ? Math.round((num / den) * 100) / 100 : null);

@Injectable()
export class CustomReportsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly analytics: AnalyticsService,
  ) {}

  async run(organizationId: string, def: { dimension: string; metrics: string[]; rangePreset?: string; from?: string; to?: string }) {
    validateDefinition(def.dimension, def.metrics);
    const preset = def.from && def.to ? null : (def.rangePreset ?? "last_30d");
    const range = preset ? presetRange(preset) : { from: def.from!, to: def.to! };
    const { from, toExclusive, days } = parseRange(range.from, range.to);
    const rows = def.dimension === "day"
      ? await this.runDay(organizationId, range, days)
      : await this.runAds(organizationId, def.dimension, from, toExclusive);
    const picked: { key: string; label: string; values: Values }[] = rows.map((r: any) => ({
      key: r.key, label: r.label,
      values: Object.fromEntries(def.metrics.map((m) => [m, r.values[m] ?? null])),
    }));
    return {
      dimension: def.dimension, metrics: def.metrics,
      range: { from: range.from, to: range.to },
      rows: picked,
      totals: this.totals(def.dimension, def.metrics, rows),
    };
  }

  private async runDay(organizationId: string, range: { from: string; to: string }, days: number) {
    const p = this.prisma as any;
    const { from, toExclusive } = parseRange(range.from, range.to);
    let aggs = await p.dailyMetricAggregate.findMany({ where: { organizationId, date: { gte: from, lt: toExclusive } }, orderBy: { date: "asc" } });
    if ((aggs ?? []).length < days) {
      await this.analytics.recomputeAggregates(organizationId, range.from, range.to);
      aggs = await p.dailyMetricAggregate.findMany({ where: { organizationId, date: { gte: from, lt: toExclusive } }, orderBy: { date: "asc" } });
    }
    return (aggs ?? []).map((a: any) => {
      const revenue = BigInt(a.revenueMinor ?? 0), refunds = BigInt(a.refundedMinor ?? 0), cogs = BigInt(a.cogsMinor ?? 0), spend = BigInt(a.adSpendMinor ?? 0);
      const orders = Number(a.orders ?? 0);
      const values: Values = {
        orders, revenue: money(revenue), refunds: money(refunds), cogs: money(cogs), adSpend: money(spend),
        profit: money(revenue - refunds - cogs - spend),
        aov: orders > 0 ? money(revenue / BigInt(orders)) : null,
      };
      const day = new Date(a.date).toISOString().slice(0, 10);
      return { key: day, label: day, values };
    });
  }

  private async runAds(organizationId: string, dimension: string, from: Date, toExclusive: Date) {
    const p = this.prisma as any;
    const raw = await p.dailyAdMetric.findMany({
      where: { organizationId, date: { gte: from, lt: toExclusive }, adExternalId: "", adSetExternalId: "" }, take: 20000,
    });
    interface G { spend: bigint; impressions: number; clicks: number; conversions: number; convValue: bigint; label: string }
    const groups = new Map<string, G>();
    for (const r of raw ?? []) {
      const key = dimension === "platform" ? String(r.platform) : String(r.campaignExternalId || "(unknown)");
      const g = groups.get(key) ?? { spend: 0n, impressions: 0, clicks: 0, conversions: 0, convValue: 0n, label: dimension === "platform" ? key : (r.campaignName ?? key) };
      g.spend += BigInt(r.spendMinor ?? 0);
      g.impressions += Number(r.impressions ?? 0);
      g.clicks += Number(r.clicks ?? 0);
      g.conversions += Number(r.platformConversions ?? 0);
      g.convValue += BigInt(r.platformConversionValueMinor ?? 0);
      groups.set(key, g);
    }
    return [...groups.entries()].map(([key, g]) => ({
      key, label: g.label,
      values: {
        spend: money(g.spend), impressions: g.impressions, clicks: g.clicks, conversions: g.conversions,
        conversionValue: money(g.convValue),
        ctr: ratio2(g.clicks * 100, g.impressions),
        cpm: g.impressions > 0 ? money((g.spend * 1000n) / BigInt(g.impressions)) : null,
        cpa: g.conversions > 0 ? money(g.spend / BigInt(g.conversions)) : null,
      } as Values,
    })).sort((a, b) => Number(BigInt((b.values.spend as string) ?? "0") - BigInt((a.values.spend as string) ?? "0")));
  }

  private totals(dimension: string, metrics: string[], rows: { values: Values }[]): Values {
    const sum = (m: string) => rows.reduce((s, r) => s + BigInt((r.values[m] as string) ?? "0"), 0n);
    const sumN = (m: string) => rows.reduce((s, r) => s + Number(r.values[m] ?? 0), 0);
    const out: Values = {};
    for (const m of metrics) {
      if (dimension === "day") {
        if (m === "orders") out[m] = sumN("orders");
        else if (m === "aov") { const o = sumN("orders"); out[m] = o > 0 ? money(sum("revenue") / BigInt(o)) : null; }
        else if (m === "profit") out[m] = money(sum("revenue") - sum("refunds") - sum("cogs") - sum("adSpend"));
        else out[m] = money(sum(m));
      } else {
        if (m === "impressions" || m === "clicks" || m === "conversions") out[m] = sumN(m);
        else if (m === "ctr") out[m] = ratio2(sumN("clicks") * 100, sumN("impressions"));
        else if (m === "cpm") { const i = sumN("impressions"); out[m] = i > 0 ? money((sum("spend") * 1000n) / BigInt(i)) : null; }
        else if (m === "cpa") { const c = sumN("conversions"); out[m] = c > 0 ? money(sum("spend") / BigInt(c)) : null; }
        else out[m] = money(sum(m));
      }
    }
    return out;
  }

  // ---- Saved definitions (CRUD) ----
  private json(row: any) {
    return row ? { ...row, createdAt: row.createdAt?.toISOString?.() ?? row.createdAt, updatedAt: row.updatedAt?.toISOString?.() ?? row.updatedAt } : row;
  }
  async create(organizationId: string, actorId: string, dto: { name: string; metrics: string[]; dimension: string; rangePreset?: string; recipients?: string[] }) {
    validateDefinition(dto.dimension, dto.metrics);
    const preset = dto.rangePreset ?? "last_30d";
    if (!(RANGE_PRESETS as readonly string[]).includes(preset)) throw new BadRequestException(`rangePreset must be one of ${RANGE_PRESETS.join(", ")}`);
    const row = await (this.prisma as any).savedReport.create({ data: {
      organizationId, name: String(dto.name ?? "").slice(0, 120) || "Untitled report",
      metrics: dto.metrics, dimension: dto.dimension, rangePreset: preset,
      recipients: (dto.recipients ?? []).map((r) => String(r).trim()).filter((r) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(r)),
      createdById: actorId,
    } });
    await this.audit.log({ organizationId, userId: actorId, action: "saved_report_created", entityType: "saved_report", entityId: row.id, metadata: { dimension: dto.dimension, metrics: dto.metrics } }).catch(() => undefined);
    return this.json(row);
  }
  async list(organizationId: string) {
    const rows = await (this.prisma as any).savedReport.findMany({ where: { organizationId }, orderBy: { createdAt: "desc" } });
    return (rows ?? []).map((r: any) => this.json(r));
  }
  async get(organizationId: string, id: string) {
    const row = await (this.prisma as any).savedReport.findFirst({ where: { id, organizationId } });
    if (!row) throw new NotFoundException("Saved report not found");
    return row;
  }
  async update(organizationId: string, actorId: string, id: string, dto: { name?: string; metrics?: string[]; dimension?: string; rangePreset?: string; recipients?: string[] }) {
    const existing = await this.get(organizationId, id);
    const dimension = dto.dimension ?? existing.dimension;
    const metrics = dto.metrics ?? existing.metrics;
    validateDefinition(dimension, metrics);
    const row = await (this.prisma as any).savedReport.update({ where: { id }, data: {
      ...(dto.name !== undefined ? { name: String(dto.name).slice(0, 120) } : {}),
      ...(dto.metrics !== undefined ? { metrics } : {}),
      ...(dto.dimension !== undefined ? { dimension } : {}),
      ...(dto.rangePreset !== undefined ? { rangePreset: dto.rangePreset } : {}),
      ...(dto.recipients !== undefined ? { recipients: dto.recipients.map((r) => String(r).trim()).filter((r) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(r)) } : {}),
    } });
    await this.audit.log({ organizationId, userId: actorId, action: "saved_report_updated", entityType: "saved_report", entityId: id, metadata: {} }).catch(() => undefined);
    return this.json(row);
  }
  async remove(organizationId: string, actorId: string, id: string) {
    await this.get(organizationId, id);
    await (this.prisma as any).savedReport.delete({ where: { id } });
    await this.audit.log({ organizationId, userId: actorId, action: "saved_report_deleted", entityType: "saved_report", entityId: id, metadata: {} }).catch(() => undefined);
    return { deleted: true };
  }
  async runSaved(organizationId: string, id: string) {
    const def = await this.get(organizationId, id);
    return this.run(organizationId, { dimension: def.dimension, metrics: def.metrics, rangePreset: def.rangePreset });
  }
}
