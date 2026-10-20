import { Injectable, Logger, Optional } from "@nestjs/common";
import { formatMinor } from "@repo/contracts";
import { PrismaService } from "../prisma/prisma.service";
import { LearningService } from "./learning.service";
import { performancePeriod } from "./performance-learning.service";
import { extractGuardNumbers } from "../inbox/business-brain";
import { buildLlmProvider } from "./llm/llm.factory";
import type { LlmProvider } from "./llm/llm.types";
import { resolveOrgLlmConfig } from "./llm/org-llm-config";
import { effectiveLlmConfig } from "../common/platform-config";
import { aiPauseReason, killSwitches } from "../common/platform-settings";
import { EventsService } from "../common/events.service";
import { resolveOwnerLanguageForOrg } from "./owner-language";

/**
 * SA-B14 (Smart AI Phase 3, A1): Ads Report Intelligence — the
 * deterministic ads digest. It answers the report's "কেন"
 * (why) from the org's OWN DailyAdMetric rows: period-over-
 * period totals, platform split, top/bottom campaigns by ROAS,
 * budget pacing against the org's own BusinessProfile budget,
 * and anomaly flags with named thresholds.
 *
 * Discipline:
 *  - NO LLM in the digest. Every number is a deterministic
 *    aggregate of campaign-level DailyAdMetric rows, using the
 *    EXACT row rule SA-B5's PerformanceLearningService uses
 *    (campaignExternalId != "" AND adSetExternalId == "" AND
 *    adExternalId == "" — ad/ad-set rows roll up into campaign
 *    rows; summing all levels would double-count) and the SAME
 *    calendar-aligned UTC windows (performancePeriod), so the
 *    digest's trailing-7-day totals can never disagree with
 *    the performance snapshot's ads totals for the same window
 *    (spec cross-checks the two on identical fixtures).
 *  - INTERNAL class (plan law L3): spend, ROAS and campaign
 *    performance are the owner's business numbers. The digest
 *    is served only through the internal Brain audience and
 *    member-gated tenant APIs — never a customer context.
 *  - Missing data says so (law L2): no budget on the profile
 *    means pacing is reported as NOT computed — no target is
 *    invented; a period with no rows is hasData=false, not a
 *    page of zeros dressed as insight. The month-end
 *    projection is an ESTIMATE and is labelled আনুমানিক
 *    wherever it is uttered (plan A1: estimate হলে labelled).
 *  - The only LLM surface is narrate() (Item 2): it may only
 *    restate the computed fact lines, and the shared number
 *    guard (extractGuardNumbers, the SA-B3 discipline) drops
 *    the whole narration if it utters even one number the
 *    facts do not contain — a narration is never "fixed up".
 *
 * What already existed and is NOT rebuilt here (Step 0):
 * AdsService (accounts/sync/spend-watchdog/creative
 * leaderboard/pacing endpoint — its pacing takes a caller-
 * supplied budget and a looser row filter, so this service
 * does not reuse it), ai/anomaly.ts day-series detection
 * (orders+spend, AI-chat tools only), GrowthCopilotService
 * opportunity scan (actions ride M47 — SA-B15's seam).
 */

export const ADS_DIGEST_WINDOWS_DAYS = [7, 30] as const;

/** Top/bottom ROAS ranking floor (minor units = ৳500): a
 * campaign that spent less than this in the window cannot top
 * or bottom the ROAS list on the strength of one cheap sale.
 * Campaigns below the floor are counted, not hidden. */
export const ADS_CAMPAIGN_RANK_MIN_SPEND_MINOR = 50_000;

/** Anomaly thresholds — every flag names the numbers that
 * tripped it, and none fires on thin data (the minima are
 * part of the threshold, recorded in the acceptance doc). */
export const ADS_ANOMALY_THRESHOLDS = {
  /** spend_spike: current spend >= prior x (1 + 50%) ... */
  spendSpikePercent: 50,
  /** ... and current spend at least ৳1,000 (absolute floor). */
  spendSpikeMinCurrentSpendMinor: 100_000,
  /** roas_collapse: ROAS falls by >= 40% from a prior ROAS of
   * at least 1.0, with both periods spending >= ৳1,000. */
  roasCollapseDropPercent: 40,
  roasCollapseMinPriorRoas: 1,
  roasCollapseMinSpendMinor: 100_000,
  /** zero_conversion_spend: >= ৳1,000 spent, 0 conversions. */
  zeroConversionMinSpendMinor: 100_000,
  /** ctr_drop: CTR falls >= 30% with >= 1,000 impressions in
   * BOTH periods (the fatigue-shaped signal; the platform's
   * per-ad fatigue definition stays in creative-fatigue.ts). */
  ctrDropPercent: 30,
  ctrDropMinImpressions: 1_000,
} as const;

const MAX_ORGS_PER_SWEEP = 200;
const DAY_MS = 24 * 60 * 60 * 1000;

const bi = (v: any): bigint => {
  try {
    return BigInt(v ?? 0);
  } catch {
    return 0n;
  }
};
const round2 = (n: number): number => Math.round(n * 100) / 100;
const pctChange = (current: number, prior: number): number | null =>
  prior === 0 ? null : Math.round(((current - prior) / prior) * 10000) / 100;
const moneyText = (minor: bigint | string | number, currency: string | null): string => {
  try {
    return formatMinor(BigInt(minor ?? 0), currency ?? "BDT");
  } catch {
    return String(minor ?? 0);
  }
};
const dayLabel = (d: Date): string => d.toISOString().slice(0, 10);

/** The SA-B5 campaign-level row rule — the one honest level:
 * ad-set and ad rows roll up into these; summing every level
 * would double-count. Kept identical to
 * PerformanceLearningService.adsMetrics on purpose. */
export const isCampaignLevelRow = (r: any): boolean =>
  String(r?.campaignExternalId ?? "") !== "" &&
  String(r?.adExternalId ?? "") === "" &&
  String(r?.adSetExternalId ?? "") === "";

interface Agg {
  spend: bigint;
  impressions: number;
  clicks: number;
  conversions: number;
  value: bigint;
}
const emptyAgg = (): Agg => ({ spend: 0n, impressions: 0, clicks: 0, conversions: 0, value: 0n });
function addRow(a: Agg, r: any): void {
  a.spend += bi(r.spendMinor);
  a.impressions += Number(r.impressions ?? 0);
  a.clicks += Number(r.clicks ?? 0);
  a.conversions += Number(r.platformConversions ?? 0);
  a.value += bi(r.platformConversionValueMinor);
}

export interface AdsTotals {
  spendMinor: string;
  impressions: number;
  clicks: number;
  ctrPercent: number | null;
  conversions: number;
  conversionValueMinor: string;
  roas: number | null;
  cpaMinor: string | null;
}
function totalsOf(a: Agg): AdsTotals {
  return {
    spendMinor: a.spend.toString(),
    impressions: a.impressions,
    clicks: a.clicks,
    ctrPercent: a.impressions > 0 ? round2((a.clicks / a.impressions) * 100) : null,
    conversions: a.conversions,
    conversionValueMinor: a.value.toString(),
    roas: a.spend > 0n ? round2(Number(a.value) / Number(a.spend)) : null,
    cpaMinor: a.conversions > 0 ? (a.spend / BigInt(a.conversions)).toString() : null,
  };
}

export interface AdsCampaignDigest extends AdsTotals {
  campaignExternalId: string;
  platform: string;
  name: string;
}

export interface AdsAnomaly {
  type: "spend_spike" | "roas_collapse" | "zero_conversion_spend" | "ctr_drop";
  severity: "warning" | "critical";
  /** Owner-facing (Bengali) statement of the flag. */
  message: string;
  /** The exact numbers that tripped the threshold. */
  evidence: Record<string, string | number | null>;
}

export interface AdsPacing {
  budgetSet: boolean;
  monthlyBudgetMinor: string | null;
  budgetCurrency: string | null;
  monthToDateSpendMinor: string;
  dayOfMonth: number;
  daysInMonth: number;
  expectedSpendByNowMinor: string | null;
  pacePercent: number | null;
  /** An ESTIMATE (daily-average projection) — labelled
   * আনুমানিক in every rendered line that utters it. */
  projectedMonthSpendMinor: string | null;
  projectedIsEstimate: true;
}

export interface AdsDigest {
  organizationId: string;
  generatedAt: string;
  windowDays: number;
  period: { start: string; end: string };
  priorPeriod: { start: string; end: string };
  priorDataAvailable: boolean;
  hasData: boolean;
  currency: string | null;
  totals: AdsTotals;
  priorTotals: AdsTotals | null;
  deltas: { spendPercent: number | null; roasPercent: number | null; ctrPercent: number | null; conversionsPercent: number | null } | null;
  platforms: Array<{ platform: string } & AdsTotals>;
  topCampaigns: AdsCampaignDigest[];
  bottomCampaigns: AdsCampaignDigest[];
  /** Campaigns with spend in the window that the ROAS
   * ranking floor excluded (counted, never silently dropped). */
  campaignsBelowFloor: number;
  pacing: AdsPacing;
  anomalies: AdsAnomaly[];
  /** Bengali, period-labelled, guard-ready fact lines — the
   * ONLY text a narration may restate. */
  factLines: string[];
  /** Top findings (English, the LearnedItem review-queue
   * convention SA-B5 set) — at most 3, anomalies first. */
  findings: string[];
}

@Injectable()
export class AdsIntelligenceService {
  private readonly logger = new Logger(AdsIntelligenceService.name);
  private learningFallback?: LearningService;

  constructor(
    @Optional() private readonly prisma?: PrismaService,
    @Optional() private readonly learning?: LearningService,
    @Optional() private readonly deps?: { providerResolver?: (organizationId: string) => Promise<LlmProvider | null> },
    // SA-B15 (A2): the global event bus — suggestFindings
    // announces each computed digest so the ads action proposer
    // can evaluate campaign-grain pause signals. Optional: the
    // digest path never depends on the bus being present.
    @Optional() private readonly events?: EventsService,
  ) {}

  private db(): any {
    if (!this.prisma) throw new Error("AdsIntelligenceService: PrismaService is not available");
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

  /** The deterministic digest for one org. Never throws into
   * a Brain/API caller: a broken read degrades to hasData
   * false rather than an exception dressed as insight. */
  async computeDigest(
    organizationId: string,
    opts: { days?: number; now?: Date } = {},
  ): Promise<AdsDigest> {
    const days = opts.days === 30 ? 30 : 7;
    const now = opts.now ?? new Date();
    const cur = performancePeriod(days, now);
    const prior = { start: new Date(cur.start.getTime() - days * DAY_MS), end: cur.start };

    const allRows = await this.rows<any[]>(
      () =>
        this.db().dailyAdMetric.findMany({
          where: { organizationId, date: { gte: prior.start, lt: cur.end } },
        }),
      [],
    );
    const campaignRows = (allRows ?? []).filter(isCampaignLevelRow);
    const curRows = campaignRows.filter((r: any) => new Date(r.date).getTime() >= cur.start.getTime());
    const priorRows = campaignRows.filter((r: any) => new Date(r.date).getTime() < cur.start.getTime());
    const priorDataAvailable = priorRows.length > 0;
    const hasData = curRows.length > 0;
    const currency =
      (curRows.find((r: any) => r.currency)?.currency as string) ??
      (priorRows.find((r: any) => r.currency)?.currency as string) ??
      null;

    const curAgg = emptyAgg();
    for (const r of curRows) addRow(curAgg, r);
    const priorAgg = emptyAgg();
    for (const r of priorRows) addRow(priorAgg, r);
    const totals = totalsOf(curAgg);
    const priorTotals = priorDataAvailable ? totalsOf(priorAgg) : null;
    const deltas = priorTotals
      ? {
          spendPercent: pctChange(Number(curAgg.spend), Number(priorAgg.spend)),
          roasPercent:
            totals.roas !== null && priorTotals.roas !== null && priorTotals.roas !== 0
              ? pctChange(totals.roas, priorTotals.roas)
              : null,
          ctrPercent:
            totals.ctrPercent !== null && priorTotals.ctrPercent !== null && priorTotals.ctrPercent !== 0
              ? pctChange(totals.ctrPercent, priorTotals.ctrPercent)
              : null,
          conversionsPercent: pctChange(curAgg.conversions, priorAgg.conversions),
        }
      : null;

    // ---- per-platform split (current window) ----
    const byPlatform = new Map<string, Agg>();
    for (const r of curRows) {
      const key = String(r.platform ?? "unknown");
      const a = byPlatform.get(key) ?? emptyAgg();
      addRow(a, r);
      byPlatform.set(key, a);
    }
    const platforms = [...byPlatform.entries()]
      .map(([platform, a]) => ({ platform, ...totalsOf(a) }))
      .sort((x, y) => Number(BigInt(y.spendMinor) - BigInt(x.spendMinor)));

    // ---- per-campaign ranking by ROAS (floored) ----
    const byCampaign = new Map<string, { campaignExternalId: string; platform: string; name: string; adCampaignId: string | null; agg: Agg }>();
    for (const r of curRows) {
      const key = `${String(r.platform ?? "unknown")}::${String(r.campaignExternalId)}`;
      const c =
        byCampaign.get(key) ??
        {
          campaignExternalId: String(r.campaignExternalId),
          platform: String(r.platform ?? "unknown"),
          name: String(r.campaignName ?? r.campaignExternalId),
          adCampaignId: r.adCampaignId ? String(r.adCampaignId) : null,
          agg: emptyAgg(),
        };
      addRow(c.agg, r);
      if (r.campaignName) c.name = String(r.campaignName);
      if (r.adCampaignId) c.adCampaignId = String(r.adCampaignId);
      byCampaign.set(key, c);
    }
    // Campaign names: the AdCampaign row is the freshest name
    // (the SA-B5 rule — a renamed campaign shows its new name).
    const campaignIds = [...byCampaign.values()].map((c) => c.adCampaignId).filter(Boolean) as string[];
    if (campaignIds.length) {
      const campaignRowsDb = await this.rows<any[]>(
        () => this.db().adCampaign.findMany({ where: { organizationId, id: { in: campaignIds } } }),
        [],
      );
      const nameById = new Map((campaignRowsDb ?? []).map((c: any) => [String(c.id), c.name ? String(c.name) : null]));
      for (const c of byCampaign.values()) {
        const fresh = c.adCampaignId ? nameById.get(c.adCampaignId) : null;
        if (fresh) c.name = fresh;
      }
    }
    const floor = BigInt(ADS_CAMPAIGN_RANK_MIN_SPEND_MINOR);
    const allCampaigns: AdsCampaignDigest[] = [...byCampaign.values()].map((c) => ({
      campaignExternalId: c.campaignExternalId,
      platform: c.platform,
      name: c.name,
      ...totalsOf(c.agg),
    }));
    const qualifying = allCampaigns
      .filter((c) => BigInt(c.spendMinor) >= floor && c.roas !== null)
      .sort((a, b) => (b.roas ?? 0) - (a.roas ?? 0) || Number(BigInt(b.spendMinor) - BigInt(a.spendMinor)));
    const campaignsBelowFloor = allCampaigns.filter((c) => BigInt(c.spendMinor) > 0n && BigInt(c.spendMinor) < floor).length;
    const topCampaigns = qualifying.slice(0, 3);
    // With <= 3 qualifying campaigns the top list already shows
    // all of them — a "bottom" list would just repeat it.
    const bottomCampaigns = qualifying.length > 3 ? qualifying.slice(-3).reverse() : [];

    const pacing = await this.computePacing(organizationId, now, cur.end);
    const anomalies = hasData ? this.detectAnomalies(totals, priorTotals, priorDataAvailable, currency, days) : [];

    const digest: AdsDigest = {
      organizationId,
      generatedAt: now.toISOString(),
      windowDays: days,
      period: { start: cur.start.toISOString(), end: cur.end.toISOString() },
      priorPeriod: { start: prior.start.toISOString(), end: prior.end.toISOString() },
      priorDataAvailable,
      hasData,
      currency,
      totals,
      priorTotals,
      deltas,
      platforms,
      topCampaigns,
      bottomCampaigns,
      campaignsBelowFloor,
      pacing,
      anomalies,
      factLines: [],
      findings: [],
    };
    digest.factLines = this.factLines(digest);
    digest.findings = this.findingTexts(digest);
    return digest;
  }

  /** Budget pacing: month-to-date campaign spend vs the org's
   * OWN BusinessProfile monthly budget. No budget row/value =
   * pacing not computed (budgetSet false) — never an invented
   * target (law L2). */
  private async computePacing(organizationId: string, now: Date, tomorrow: Date): Promise<AdsPacing> {
    const monthStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
    const daysInMonth = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 0)).getUTCDate();
    const dayOfMonth = now.getUTCDate();
    const mtdRows = await this.rows<any[]>(
      () => this.db().dailyAdMetric.findMany({ where: { organizationId, date: { gte: monthStart, lt: tomorrow } } }),
      [],
    );
    let mtd = 0n;
    for (const r of (mtdRows ?? []).filter(isCampaignLevelRow)) mtd += bi(r.spendMinor);
    const profile = await this.rows<any>(
      () =>
        this.db().businessProfile.findUnique({
          where: { organizationId },
          select: { monthlyBudgetMinor: true, budgetCurrency: true },
        }),
      null,
    );
    const budget = profile?.monthlyBudgetMinor != null ? bi(profile.monthlyBudgetMinor) : null;
    const expectedByNow = budget !== null ? (budget * BigInt(dayOfMonth)) / BigInt(daysInMonth) : null;
    const pacePercent =
      expectedByNow !== null && expectedByNow > 0n ? Math.round((Number(mtd) / Number(expectedByNow)) * 100) : null;
    const projected = dayOfMonth > 0 ? BigInt(Math.round((Number(mtd) / dayOfMonth) * daysInMonth)) : null;
    return {
      budgetSet: budget !== null,
      monthlyBudgetMinor: budget !== null ? budget.toString() : null,
      budgetCurrency: profile?.budgetCurrency ?? null,
      monthToDateSpendMinor: mtd.toString(),
      dayOfMonth,
      daysInMonth,
      expectedSpendByNowMinor: expectedByNow !== null ? expectedByNow.toString() : null,
      pacePercent,
      projectedMonthSpendMinor: budget !== null && projected !== null ? projected.toString() : null,
      projectedIsEstimate: true,
    };
  }

  /** Period-over-period anomaly flags over the campaign data.
   * Distinct from ai/anomaly.ts (last-day vs baseline over a
   * combined orders+spend series, AI-chat only): these compare
   * the digest's two equal windows and every threshold's
   * minimum-data floor is part of the rule. */
  private detectAnomalies(
    totals: AdsTotals,
    priorTotals: AdsTotals | null,
    priorDataAvailable: boolean,
    currency: string | null,
    days: number,
  ): AdsAnomaly[] {
    const T = ADS_ANOMALY_THRESHOLDS;
    const out: AdsAnomaly[] = [];
    const curSpend = BigInt(totals.spendMinor);

    if (priorDataAvailable && priorTotals) {
      const priorSpend = BigInt(priorTotals.spendMinor);
      const spendChange = pctChange(Number(curSpend), Number(priorSpend));
      if (
        priorSpend > 0n &&
        curSpend >= BigInt(T.spendSpikeMinCurrentSpendMinor) &&
        spendChange !== null &&
        spendChange >= T.spendSpikePercent
      ) {
        out.push({
          type: "spend_spike",
          severity: spendChange >= 100 ? "critical" : "warning",
          message: `বিজ্ঞাপন ব্যয় হঠাৎ বেড়েছে: আগের ${days} দিনের ${moneyText(priorSpend, currency)} থেকে এই ${days} দিনে ${moneyText(curSpend, currency)} (+${spendChange}%)।`,
          evidence: { currentSpendMinor: totals.spendMinor, priorSpendMinor: priorTotals.spendMinor, changePercent: spendChange },
        });
      }
      if (
        totals.roas !== null &&
        priorTotals.roas !== null &&
        priorTotals.roas >= T.roasCollapseMinPriorRoas &&
        curSpend >= BigInt(T.roasCollapseMinSpendMinor) &&
        priorSpend >= BigInt(T.roasCollapseMinSpendMinor)
      ) {
        const drop = pctChange(totals.roas, priorTotals.roas);
        if (drop !== null && drop <= -T.roasCollapseDropPercent) {
          out.push({
            type: "roas_collapse",
            severity: "critical",
            message: `ROAS ভেঙে পড়েছে: আগের ${days} দিনে ${priorTotals.roas} থেকে এই ${days} দিনে ${totals.roas} (${drop}%)।`,
            evidence: { currentRoas: totals.roas, priorRoas: priorTotals.roas, changePercent: drop },
          });
        }
      }
      if (
        totals.ctrPercent !== null &&
        priorTotals.ctrPercent !== null &&
        priorTotals.ctrPercent > 0 &&
        totals.impressions >= T.ctrDropMinImpressions &&
        priorTotals.impressions >= T.ctrDropMinImpressions
      ) {
        const drop = pctChange(totals.ctrPercent, priorTotals.ctrPercent);
        if (drop !== null && drop <= -T.ctrDropPercent) {
          out.push({
            type: "ctr_drop",
            severity: "warning",
            message: `CTR কমেছে: আগের ${days} দিনে ${priorTotals.ctrPercent}% থেকে এই ${days} দিনে ${totals.ctrPercent}% (${drop}%) — creative ক্লান্তির (fatigue) সম্ভাব্য লক্ষণ।`,
            evidence: { currentCtrPercent: totals.ctrPercent, priorCtrPercent: priorTotals.ctrPercent, changePercent: drop, currentImpressions: totals.impressions, priorImpressions: priorTotals.impressions },
          });
        }
      }
    }

    if (totals.conversions === 0 && curSpend >= BigInt(T.zeroConversionMinSpendMinor)) {
      out.push({
        type: "zero_conversion_spend",
        severity: curSpend >= BigInt(T.zeroConversionMinSpendMinor) * 5n ? "critical" : "warning",
        message: `এই ${days} দিনে ${moneyText(curSpend, currency)} ব্যয় হয়েছে কিন্তু platform-reported conversion ০টি।`,
        evidence: { currentSpendMinor: totals.spendMinor, conversions: 0 },
      });
    }
    return out;
  }

  /** Bengali fact lines — period always named, every number
   * from the digest itself. These lines are the guard set for
   * narration: a narration may restate ONLY numbers appearing
   * here. */
  private factLines(d: AdsDigest): string[] {
    const cur = d.currency;
    if (!d.hasData) {
      return [
        `বিজ্ঞাপন বিশ্লেষণ (${dayLabel(new Date(d.period.start))} – ${dayLabel(new Date(d.period.end))}, গত ${d.windowDays} দিন): এই সময়ে কোনো campaign-স্তরের বিজ্ঞাপন ডেটা পাওয়া যায়নি।`,
      ];
    }
    const lines: string[] = [];
    lines.push(
      `বিজ্ঞাপন বিশ্লেষণ (${dayLabel(new Date(d.period.start))} – ${dayLabel(new Date(d.period.end))}, গত ${d.windowDays} দিন):`,
    );
    const t = d.totals;
    lines.push(
      `মোট ব্যয় ${moneyText(t.spendMinor, cur)}; impression ${t.impressions}, click ${t.clicks} (CTR ${t.ctrPercent ?? "—"}%); platform conversion ${t.conversions}টি, conversion মূল্য ${moneyText(t.conversionValueMinor, cur)}; ROAS ${t.roas ?? "—"}।`,
    );
    if (d.deltas && d.priorTotals) {
      const parts: string[] = [];
      if (d.deltas.spendPercent !== null) parts.push(`ব্যয় ${d.deltas.spendPercent >= 0 ? "+" : ""}${d.deltas.spendPercent}%`);
      if (d.deltas.roasPercent !== null) parts.push(`ROAS ${d.deltas.roasPercent >= 0 ? "+" : ""}${d.deltas.roasPercent}%`);
      if (d.deltas.conversionsPercent !== null) parts.push(`conversion ${d.deltas.conversionsPercent >= 0 ? "+" : ""}${d.deltas.conversionsPercent}%`);
      if (parts.length) lines.push(`আগের ${d.windowDays} দিনের তুলনায়: ${parts.join(", ")}।`);
    }
    for (const p of d.platforms) {
      if (BigInt(p.spendMinor) <= 0n && p.impressions === 0) continue;
      lines.push(`${p.platform}: ব্যয় ${moneyText(p.spendMinor, cur)}, ROAS ${p.roas ?? "—"}, conversion ${p.conversions}টি।`);
    }
    const top = d.topCampaigns[0];
    if (top) lines.push(`সেরা campaign (ROAS অনুযায়ী): "${top.name}" — ROAS ${top.roas}, ব্যয় ${moneyText(top.spendMinor, cur)}, conversion ${top.conversions}টি।`);
    const bottom = d.bottomCampaigns[0];
    if (bottom) lines.push(`সবচেয়ে দুর্বল campaign (ROAS অনুযায়ী): "${bottom.name}" — ROAS ${bottom.roas}, ব্যয় ${moneyText(bottom.spendMinor, cur)}, conversion ${bottom.conversions}টি।`);
    if (d.campaignsBelowFloor > 0) {
      lines.push(`আরও ${d.campaignsBelowFloor}টি campaign-এ ব্যয় হয়েছে, তবে ROAS ranking-এর ন্যূনতম ব্যয়ের (${moneyText(ADS_CAMPAIGN_RANK_MIN_SPEND_MINOR, cur)}) নিচে থাকায় সেগুলো সেরা/দুর্বল তালিকায় আসেনি।`);
    }
    const p = d.pacing;
    if (p.budgetSet) {
      lines.push(
        `বাজেট গতি: মাসিক বাজেট ${moneyText(p.monthlyBudgetMinor!, p.budgetCurrency ?? cur)}; এ মাসে ${p.dayOfMonth} দিনে ব্যয় ${moneyText(p.monthToDateSpendMinor, cur)} (এই সময়ে প্রত্যাশিত ${moneyText(p.expectedSpendByNowMinor!, cur)}-এর ${p.pacePercent ?? "—"}%); এই গতিতে মাস শেষে আনুমানিক ব্যয় ${moneyText(p.projectedMonthSpendMinor!, cur)} (আনুমানিক)।`,
      );
    } else {
      lines.push(
        `বাজেট গতি: মাসিক বিজ্ঞাপন বাজেট সেট করা নেই — তাই pacing হিসাব করা হয়নি। এ মাসে এখন পর্যন্ত ব্যয় ${moneyText(p.monthToDateSpendMinor, cur)}।`,
      );
    }
    for (const a of d.anomalies) lines.push(`সতর্কতা (${a.type}): ${a.message}`);
    return lines;
  }

  /** Top findings for the human review queue (LearnedItem
   * facts, sourceType "ads"). English, the SA-B5 convention;
   * anomalies first, then the ROAS winner, then over-pacing.
   * At most 3 — the queue shows signal, not the whole digest. */
  private findingTexts(d: AdsDigest): string[] {
    if (!d.hasData) return [];
    const range = `${dayLabel(new Date(d.period.start))} to ${dayLabel(new Date(d.period.end))}`;
    const out: string[] = [];
    for (const a of d.anomalies.slice(0, 2)) {
      out.push(`Ad anomaly (${a.type}) in the last ${d.windowDays} days (${range}): ${this.anomalyEvidenceText(a, d)}`);
    }
    const top = d.topCampaigns[0];
    if (top && out.length < 3) {
      out.push(
        `Top ad campaign by ROAS in the last ${d.windowDays} days (${range}): "${top.name}" (${top.platform}) — ROAS ${top.roas} on ${moneyText(top.spendMinor, d.currency)} spend, ${top.conversions} conversions.`,
      );
    }
    const p = d.pacing;
    if (p.budgetSet && p.pacePercent !== null && p.pacePercent >= 110 && out.length < 3) {
      out.push(
        `Ad spend is pacing at ${p.pacePercent}% of the expected month-to-date level (budget ${moneyText(p.monthlyBudgetMinor!, p.budgetCurrency ?? d.currency)}, spent ${moneyText(p.monthToDateSpendMinor, d.currency)} by day ${p.dayOfMonth}); projected month-end spend ${moneyText(p.projectedMonthSpendMinor!, d.currency)} (estimate).`,
      );
    }
    return out.slice(0, 3);
  }

  private anomalyEvidenceText(a: AdsAnomaly, d: AdsDigest): string {
    const e = a.evidence;
    switch (a.type) {
      case "spend_spike":
        return `spend rose ${e.changePercent}% vs the prior period (${moneyText(String(e.priorSpendMinor), d.currency)} -> ${moneyText(String(e.currentSpendMinor), d.currency)}).`;
      case "roas_collapse":
        return `ROAS fell ${e.changePercent}% vs the prior period (${e.priorRoas} -> ${e.currentRoas}).`;
      case "ctr_drop":
        return `CTR fell ${e.changePercent}% vs the prior period (${e.priorCtrPercent}% -> ${e.currentCtrPercent}%).`;
      case "zero_conversion_spend":
        return `${moneyText(String(e.currentSpendMinor), d.currency)} spent with 0 platform-reported conversions.`;
      default:
        return a.type;
    }
  }

  /** File the digest's top findings as SUGGESTED LearnedItem
   * facts (sourceType "ads" — approval forces INTERNAL, law
   * L3, exactly like "performance"). The dedupe wall makes a
   * re-run inside the same period a no-op. */
  async suggestFindings(
    organizationId: string,
    opts: { days?: number; now?: Date } = {},
  ): Promise<{ created: number; digest: AdsDigest; reason?: string }> {
    const digest = await this.computeDigest(organizationId, opts);
    if (!digest.hasData) return { created: 0, digest, reason: "no_ads_data" };
    let created = 0;
    for (const text of digest.findings) {
      const r = await this.learn()
        .createSuggestion(organizationId, {
          kind: "fact",
          title: `Ads finding (${digest.windowDays}d): ${text.slice(0, 80)}`,
          content: { text },
          sourceType: "ads",
          sourceRef: { periodStart: digest.period.start, periodEnd: digest.period.end, windowDays: digest.windowDays },
        })
        .catch(() => ({ created: false }));
      if ((r as any)?.created) created++;
    }
    // SA-B15 (A2): announce the computed digest (ids + period
    // only — the bus discipline) on the findings path, which is
    // exactly where the sweep and the on-demand suggest endpoint
    // both land. AdsActionProposerService turns campaign-grain
    // anomaly signals into pause_campaign proposals from this.
    // Fire-and-forget: the bus isolates listener failures, and
    // a missing bus simply means no announcement.
    try {
      this.events?.emit("ads.digest_computed", {
        organizationId,
        windowDays: digest.windowDays,
        periodStart: digest.period.start,
        periodEnd: digest.period.end,
      });
    } catch {
      /* the digest path never depends on the bus */
    }
    return { created, digest };
  }

  /** The ads_intelligence_sweep job body: every org with ad
   * data gets its findings queued; one org's failure never
   * stops the sweep (the SA-B5 sweep discipline). */
  async runSweep(now: Date = new Date()): Promise<{ orgs: number; digested: number; skipped: number; suggestions: number }> {
    let digested = 0;
    let skipped = 0;
    let suggestions = 0;
    try {
      const orgs = await this.rows<any[]>(() => this.db().organization.findMany({ take: MAX_ORGS_PER_SWEEP }), []);
      for (const org of orgs ?? []) {
        try {
          const r = await this.suggestFindings(String(org.id), { now });
          if (r.digest.hasData) {
            digested++;
            suggestions += r.created;
            await this.learn()
              .saveState(String(org.id), "ads_intelligence", {
                lastStatus: "ok",
                lastDetail: { suggestions: r.created, windowDays: r.digest.windowDays },
              })
              .catch(() => undefined);
          } else {
            skipped++;
          }
        } catch (e) {
          skipped++;
          this.logger.warn(`ads intelligence failed for org ${org.id}: ${e instanceof Error ? e.message : String(e)}`);
        }
      }
      return { orgs: (orgs ?? []).length, digested, skipped, suggestions };
    } catch (e) {
      this.logger.error(`ads intelligence sweep failed: ${e instanceof Error ? e.message : String(e)}`);
      return { orgs: 0, digested, skipped, suggestions };
    }
  }

  // ------------------------------------------------------------------
  // Item 2 — guarded narration (the ONLY LLM surface)
  // ------------------------------------------------------------------

  /** Resolve the org's chat provider exactly as the chat layer
   * does (org config -> platform config). Null when the
   * effective provider is not a real LLM. */
  private async resolveProvider(organizationId: string): Promise<LlmProvider | null> {
    if (this.deps?.providerResolver) return this.deps.providerResolver(organizationId);
    const creds = await resolveOrgLlmConfig(this.prisma as any, organizationId).catch(() => null);
    const provider = creds
      ? buildLlmProvider(creds.provider, creds.apiKey, creds.model)
      : (() => {
          const cfg = effectiveLlmConfig();
          return buildLlmProvider(cfg.provider, cfg.apiKey, cfg.model);
        })();
    return provider.isRealLlm ? provider : null;
  }

  /** A short owner-facing summary of the COMPUTED digest. The
   * model may only restate the fact lines; the shared number
   * guard then compares every number it uttered against the
   * fact set — one unsupported number and the WHOLE narration
   * is dropped (never edited into compliance). The digest is
   * complete without a narration: every failure mode returns
   * narration null with an honest machine-readable note. */
  async narrate(
    organizationId: string,
    actorId: string,
    opts: { days?: number; now?: Date } = {},
  ): Promise<{ digest: AdsDigest; narration: string | null; narrationNote: string | null; droppedNumbers?: string[] }> {
    const digest = await this.computeDigest(organizationId, opts);
    if (!digest.hasData) return { digest, narration: null, narrationNote: "no_ads_data" };

    const ks = await killSwitches(this.prisma as any).catch(() => ({ aiDisabledOrgIds: [] as string[] }));
    const pauseReason = aiPauseReason(ks, organizationId);
    if (pauseReason) {
      return { digest, narration: null, narrationNote: pauseReason };
    }
    const provider = await this.resolveProvider(organizationId);
    if (!provider) return { digest, narration: null, narrationNote: "no_real_llm_provider" };

    // MB5 (ML13, CD-8 #7): narration language is the shared
    // OWNER chain (aiReplyLanguage → dashboardLocale → acting
    // user's preferredLocale → bn) instead of the old binary
    // `aiReplyLanguage === "en"` check. No dto on this path.
    const { language } = await resolveOwnerLanguageForOrg(this.prisma as any, {
      organizationId,
      userId: actorId,
    });
    const english = language === "en";
    const system = english
      ? "You are an ads analyst. Using ONLY the verified facts below, write a short summary for the shop owner in English (at most 4 sentences). Use only numbers that appear in the facts — never add a new number, percentage or estimate, and never mention anything the facts do not contain."
      : "আপনি একজন বিজ্ঞাপন বিশ্লেষক। নিচের যাচাইকৃত তথ্যের ভিত্তিতে দোকান মালিকের জন্য বাংলায় একটি সংক্ষিপ্ত সারসংক্ষেপ লিখুন (সর্বোচ্চ ৪ বাক্য)। শুধুমাত্র তথ্যে থাকা সংখ্যা ব্যবহার করুন — নতুন কোনো সংখ্যা, শতাংশ বা অনুমান যোগ করবেন না, আর তথ্যে নেই এমন কিছু বলবেন না।";

    let result;
    try {
      result = await provider.complete(
        [
          { role: "system", content: system },
          { role: "user", content: digest.factLines.join("\n") },
        ],
        { maxTokens: 400 },
      );
    } catch (e) {
      this.logger.warn(`ads narration call failed for org ${organizationId}: ${e instanceof Error ? e.message : String(e)}`);
      return { digest, narration: null, narrationNote: "llm_call_failed" };
    }
    await this.db()
      .aIUsageRecord.create({
        data: {
          organizationId,
          userId: actorId,
          feature: "ads_intelligence",
          provider: provider.name,
          model: result.model,
          inputTokens: result.inputTokens,
          outputTokens: result.outputTokens,
          estimated: result.tokensEstimated,
        },
      })
      .catch(() => undefined);

    const text = String(result.text ?? "").trim();
    if (!text) return { digest, narration: null, narrationNote: "llm_call_failed" };
    const allowed = new Set(extractGuardNumbers(digest.factLines.join("\n")));
    const invented = [...new Set(extractGuardNumbers(text).filter((n) => !allowed.has(n)))];
    if (invented.length) {
      // The guard's verdict is final: the narration is dropped
      // whole, with the offending numbers named in the record —
      // the facts stay exactly as computed (law L2).
      return { digest, narration: null, narrationNote: "dropped_unsupported_numbers", droppedNumbers: invented };
    }
    return { digest, narration: text, narrationNote: null };
  }
}
