import { Injectable, Logger, Optional } from "@nestjs/common";
import { PrismaService } from "../prisma/prisma.service";
import { LearningService } from "./learning.service";
import { performancePeriod } from "./performance-learning.service";
import { detectReplyLanguage } from "../inbox/in7-ai";

/**
 * SA-B16 (Smart AI Phase 3, A3): Creative Intelligence —
 * deterministic pattern mining over the org's OWN ad creatives.
 * It answers "কোন creative/angle জিতছে" from linked evidence,
 * never from taste: every reported pattern is a pooled-CTR
 * aggregate over real creatives whose sample cleared named
 * floors, stated WITH its numbers.
 *
 * The honest grain (Step 0, verified in this tree):
 *  - Ad-level DailyAdMetric rows exist ONLY from the Meta
 *    insights sync (normalizeMetaAdInsight, level "ad").
 *    Google/TikTok syncs write campaign-level rows only, so
 *    no creative grain exists for those platforms here.
 *  - Creative TEXT lives only on hub-built CampaignAd rows
 *    (primaryText / headline / description; textOptions index 0
 *    always mirrors those columns, so the columns ARE the live
 *    copy — unpublished variants carry no metrics and are not
 *    evidence). The join is CampaignAd.externalAdId =
 *    DailyAdMetric.adExternalId, org-scoped through the plan.
 *  - Synced Meta ads with no hub CampaignAd have metrics but
 *    no local creative text — excluded, counted in
 *    `adsWithoutLocalText`, never silently dropped.
 *  - Image/video CONTENT is not analysed: CreativeAsset rows
 *    are media files with no text and no vision pipeline
 *    exists on this line. NOT BUILT, not faked.
 *  - SocialPost captions are NOT mined here: their insights
 *    are engagement-shaped platform Json, not impressions/
 *    clicks — pooling them with ad CTR would be a dishonest
 *    aggregate. Recorded as a separate possible surface.
 *
 * Discipline:
 *  - NO LLM anywhere in the analysis. Features are text-derived
 *    by named lexicons + script ratios (detectReplyLanguage is
 *    the platform's one language detector — reused, not forked).
 *  - A creative is evidence only at >= CREATIVE_MIN_IMPRESSIONS
 *    impressions in the window; a pattern is reported only with
 *    >= CREATIVE_PATTERN_MIN_CREATIVES qualifying creatives AND
 *    |lift| >= CREATIVE_PATTERN_MIN_LIFT_PERCENT vs the org's
 *    pooled baseline CTR. Below that: silence over noise.
 *  - Findings land as SUGGESTED LearnedItems (sourceType
 *    "creative"); approval forces INTERNAL exactly like
 *    "ads"/"performance" (creative performance is the owner's
 *    business data, plan law L3).
 *  - Exemplars are READ-THROUGH: the top creative texts are
 *    read from their source CampaignAd rows at request time —
 *    no parallel copy is stored to go stale (Phase 5's content
 *    generator consumes them via getReport()).
 */

/** Trailing window for creative evidence (days). */
export const CREATIVE_WINDOW_DAYS = 30;

/** A creative below this many window impressions is anecdote,
 * not evidence — it enters neither the baseline nor any group. */
export const CREATIVE_MIN_IMPRESSIONS = 1_000;

/** A pattern needs at least this many qualifying creatives. */
export const CREATIVE_PATTERN_MIN_CREATIVES = 3;

/** ... and its pooled CTR must beat (or trail) the org's pooled
 * baseline CTR by at least this percent to be reported. */
export const CREATIVE_PATTERN_MIN_LIFT_PERCENT = 20;

/** Exemplars returned by the read API. */
export const CREATIVE_EXEMPLAR_LIMIT = 5;

/** Primary-text length bands (characters). */
export const CREATIVE_TEXT_LENGTH_BANDS = { shortMax: 80, mediumMax: 200 } as const;
/** Headline length bands (characters). */
export const CREATIVE_HEADLINE_LENGTH_BANDS = { shortMax: 30, mediumMax: 60 } as const;

const MAX_ORGS_PER_SWEEP = 200;

const round2 = (n: number): number => Math.round(n * 100) / 100;
const dayLabel = (d: Date): string => d.toISOString().slice(0, 10);

/** Urgency lexicon (bn + en) — named, reviewable, deterministic. */
export const CREATIVE_URGENCY_LEXICON = [
  "আজই", "এখনই", "সীমিত", "স্টক শেষ", "শেষ সুযোগ", "দেরি না", "অফার শেষ", "শীঘ্রই",
  "today only", "limited", "hurry", "last chance", "ends soon", "don't miss", "dont miss", "while stocks last",
] as const;

/** Discount markers: ছাড়/অফার words or an explicit % figure. */
export const CREATIVE_DISCOUNT_MARKERS = ["ছাড়", "ডিসকাউন্ট", "অফার", "discount", "sale", "% off", "percent off"] as const;

/** Price markers: the taka sign or the word টাকা / taka. */
export const CREATIVE_PRICE_MARKERS = ["৳", "টাকা", "taka", "bdt"] as const;

/** CTA phrases in the copy itself (the CampaignAd.callToAction
 * column defaults to SHOP_NOW for every ad, so the field alone
 * carries no signal — the text is what a customer reads). */
export const CREATIVE_CTA_LEXICON = [
  "অর্ডার করুন", "অর্ডার করো", "কিনুন", "কেনাকাটা", "মেসেজ করুন", "ইনবক্স", "কল করুন",
  "order now", "shop now", "buy now", "message us", "inbox us", "call now", "order করুন",
] as const;

const EMOJI_RE = /[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}\u{2B00}-\u{2BFF}]/u;

const containsAny = (lowerText: string, lexicon: readonly string[]): boolean =>
  lexicon.some((w) => lowerText.includes(w.toLowerCase()));

function lengthBand(len: number, bands: { shortMax: number; mediumMax: number }): string {
  if (len === 0) return "empty";
  if (len <= bands.shortMax) return "short";
  if (len <= bands.mediumMax) return "medium";
  return "long";
}

/** Feature values for ONE creative on ONE surface. Boolean
 * features yield "yes" (the "no" group is the complement — the
 * aggregator reports the presence effect, never both sides of
 * the same coin). Multi-value features yield their value. */
export function creativeFeatures(surface: "text" | "headline", raw: string): Record<string, string> {
  const text = String(raw ?? "").trim();
  const lower = text.toLowerCase();
  const out: Record<string, string> = {};
  const lang = detectReplyLanguage(text);
  if (lang) out.language = lang;
  out.length = lengthBand(text.length, surface === "headline" ? CREATIVE_HEADLINE_LENGTH_BANDS : CREATIVE_TEXT_LENGTH_BANDS);
  if (text.includes("?") || text.includes("？")) out.question = "yes";
  if (EMOJI_RE.test(text)) out.emoji = "yes";
  if (surface === "text") {
    if (containsAny(lower, CREATIVE_PRICE_MARKERS) || /[0-9০-৯]+\s*(টাকা|taka)/i.test(text)) out.price = "yes";
    if (containsAny(lower, CREATIVE_DISCOUNT_MARKERS) || /[0-9০-৯]+\s*%/.test(text)) out.discount = "yes";
    if (containsAny(lower, CREATIVE_URGENCY_LEXICON)) out.urgency = "yes";
    if (containsAny(lower, CREATIVE_CTA_LEXICON)) out.cta = "yes";
  }
  return out;
}

const FEATURE_LABELS_BN: Record<string, string> = {
  language: "ভাষা",
  length: "দৈর্ঘ্য",
  question: "প্রশ্ন-আকারের",
  emoji: "ইমোজি-সহ",
  price: "দাম উল্লেখ করা",
  discount: "ছাড় উল্লেখ করা",
  urgency: "জরুরি-ভাবের শব্দ",
  cta: "কল-টু-অ্যাকশন",
};
const VALUE_LABELS_BN: Record<string, string> = {
  bn: "বাংলা", en: "ইংরেজি", mixed: "বাংলা-ইংরেজি মিশ্র",
  short: "ছোট", medium: "মাঝারি", long: "বড়", empty: "খালি", yes: "",
};
const SURFACE_LABELS_BN: Record<string, string> = { text: "মূল লেখা (primary text)", headline: "headline" };

export interface CreativeUnit {
  adId: string;
  externalAdId: string;
  adName: string;
  campaignName: string | null;
  primaryText: string;
  headline: string | null;
  description: string | null;
  impressions: number;
  clicks: number;
  spendMinor: string;
  conversions: number;
  conversionValueMinor: string;
  ctrPercent: number | null;
  roas: number | null;
}

export interface CreativePattern {
  /** e.g. "headline:question=yes" — stable per surface/feature/value. */
  key: string;
  surface: "text" | "headline";
  feature: string;
  value: string;
  direction: "winning" | "losing";
  creatives: number;
  impressions: number;
  clicks: number;
  ctrPercent: number;
  baselineCtrPercent: number;
  liftPercent: number;
  /** Pooled ROAS of the group (value/spend) when spend > 0. */
  roas: number | null;
  baselineRoas: number | null;
  /** The owner-facing statement, WITH its numbers (Bengali,
   * the LearnedItem fact text when suggested). */
  statement: string;
}

export interface CreativeReport {
  organizationId: string;
  generatedAt: string;
  windowDays: number;
  period: { start: string; end: string };
  /** Creatives with local text AND ad-level metrics in window. */
  creativesWithText: number;
  /** Of those, the ones clearing the impressions floor. */
  creativesQualifying: number;
  /** Below-floor creatives (counted, never hidden). */
  creativesBelowFloor: number;
  /** Metric'd ads with NO local CampaignAd text (excluded). */
  adsWithoutLocalText: number;
  baseline: { impressions: number; clicks: number; ctrPercent: number | null; roas: number | null };
  patterns: CreativePattern[];
  exemplars: CreativeUnit[];
}

interface Agg {
  creatives: number;
  impressions: number;
  clicks: number;
  spend: bigint;
  convValue: bigint;
}
const emptyAgg = (): Agg => ({ creatives: 0, impressions: 0, clicks: 0, spend: 0n, convValue: 0n });
const ctrOf = (a: Agg): number | null => (a.impressions > 0 ? round2((a.clicks / a.impressions) * 100) : null);
const roasOf = (a: Agg): number | null => (a.spend > 0n ? round2(Number(a.convValue) / Number(a.spend)) : null);

@Injectable()
export class CreativeLearningService {
  private readonly logger = new Logger(CreativeLearningService.name);
  private learningFallback?: LearningService;

  constructor(
    @Optional() private readonly prisma?: PrismaService,
    @Optional() private readonly learning?: LearningService,
  ) {}

  private db(): any {
    if (!this.prisma) throw new Error("CreativeLearningService: PrismaService is not available");
    return this.prisma as any;
  }

  private learn(): LearningService {
    return this.learning ?? (this.learningFallback ??= new LearningService(this.prisma as any));
  }

  private async rows<T>(call: (() => unknown) | undefined, fallback: T): Promise<T> {
    try {
      const v = await (call ? call() : undefined);
      return (v ?? fallback) as T;
    } catch {
      return fallback;
    }
  }

  /** Assemble the org's creative units for the trailing
   * window: hub CampaignAd text joined to ad-level metric
   * rows. Flat org-scoped queries only (plan -> ad sets ->
   * ads -> metrics), so no row from another org can enter. */
  private async collectUnits(
    organizationId: string,
    now: Date,
  ): Promise<{ units: CreativeUnit[]; adsWithoutLocalText: number }> {
    const { start, end } = performancePeriod(CREATIVE_WINDOW_DAYS, now);
    const p = this.db();

    const plans = await this.rows<any[]>(
      () => p.campaignPlan?.findMany?.({ where: { organizationId }, select: { id: true, name: true } }),
      [],
    );
    const planName = new Map((plans ?? []).map((pl: any) => [String(pl.id), pl.name ?? null]));
    const planIds = [...planName.keys()];
    if (!planIds.length) return { units: [], adsWithoutLocalText: 0 };

    const adSets = await this.rows<any[]>(
      () => p.campaignAdSet?.findMany?.({ where: { planId: { in: planIds } }, select: { id: true, planId: true } }),
      [],
    );
    const setPlan = new Map((adSets ?? []).map((s: any) => [String(s.id), String(s.planId)]));
    const setIds = [...setPlan.keys()];
    if (!setIds.length) return { units: [], adsWithoutLocalText: 0 };

    const ads = await this.rows<any[]>(
      () =>
        p.campaignAd?.findMany?.({
          where: { adSetId: { in: setIds }, externalAdId: { not: null } },
          orderBy: { createdAt: "asc" },
        }),
      [],
    );
    // One creative text per platform ad id (earliest hub ad
    // wins — duplicates would double-count the same metrics).
    const adByExternal = new Map<string, any>();
    for (const ad of ads ?? []) {
      const ext = String(ad.externalAdId ?? "");
      if (ext && !adByExternal.has(ext)) adByExternal.set(ext, ad);
    }

    const metricRows = await this.rows<any[]>(
      () =>
        p.dailyAdMetric?.findMany?.({
          where: { organizationId, adExternalId: { not: "" }, date: { gte: start, lt: end } },
        }),
      [],
    );
    const metricByAd = new Map<string, Agg & { conversions: number; campaignName: string | null }>();
    for (const r of metricRows ?? []) {
      const ext = String(r.adExternalId ?? "");
      if (!ext) continue;
      const a = metricByAd.get(ext) ?? { ...emptyAgg(), conversions: 0, campaignName: null };
      a.impressions += Number(r.impressions ?? 0);
      a.clicks += Number(r.clicks ?? 0);
      a.spend += BigInt(r.spendMinor ?? 0);
      a.convValue += BigInt(r.platformConversionValueMinor ?? 0);
      a.conversions += Number(r.platformConversions ?? 0);
      if (!a.campaignName && r.campaignName) a.campaignName = String(r.campaignName);
      metricByAd.set(ext, a);
    }

    let adsWithoutLocalText = 0;
    const units: CreativeUnit[] = [];
    for (const [ext, a] of metricByAd) {
      const ad = adByExternal.get(ext);
      if (!ad) {
        adsWithoutLocalText++;
        continue;
      }
      const planId = setPlan.get(String(ad.adSetId));
      units.push({
        adId: String(ad.id),
        externalAdId: ext,
        adName: String(ad.name ?? ext),
        campaignName: (planId ? planName.get(planId) : null) ?? a.campaignName,
        primaryText: String(ad.primaryText ?? ""),
        headline: ad.headline ?? null,
        description: ad.description ?? null,
        impressions: a.impressions,
        clicks: a.clicks,
        spendMinor: a.spend.toString(),
        conversions: a.conversions,
        conversionValueMinor: a.convValue.toString(),
        ctrPercent: a.impressions > 0 ? round2((a.clicks / a.impressions) * 100) : null,
        roas: a.spend > 0n ? round2(Number(a.convValue) / Number(a.spend)) : null,
      });
    }
    return { units, adsWithoutLocalText };
  }

  /** The full deterministic report: pooled baseline, pattern
   * aggregates over qualifying creatives, and the exemplar
   * ranking. Pure over the collected units — no writes. */
  async computeReport(organizationId: string, opts: { now?: Date } = {}): Promise<CreativeReport> {
    const now = opts.now ?? new Date();
    const { start, end } = performancePeriod(CREATIVE_WINDOW_DAYS, now);
    const { units, adsWithoutLocalText } = await this.collectUnits(organizationId, now);

    const qualifying = units.filter((u) => u.impressions >= CREATIVE_MIN_IMPRESSIONS);
    const baselineAgg = emptyAgg();
    for (const u of qualifying) {
      baselineAgg.creatives++;
      baselineAgg.impressions += u.impressions;
      baselineAgg.clicks += u.clicks;
      baselineAgg.spend += BigInt(u.spendMinor);
      baselineAgg.convValue += BigInt(u.conversionValueMinor);
    }
    const baselineCtr = ctrOf(baselineAgg);
    const baselineRoas = roasOf(baselineAgg);

    const patterns: CreativePattern[] = [];
    if (baselineCtr !== null && baselineCtr > 0 && qualifying.length >= CREATIVE_PATTERN_MIN_CREATIVES) {
      // group key -> aggregate, per surface
      const groups = new Map<string, Agg & { surface: "text" | "headline"; feature: string; value: string }>();
      for (const u of qualifying) {
        const surfaces: Array<["text" | "headline", string]> = [["text", u.primaryText]];
        if (u.headline && String(u.headline).trim()) surfaces.push(["headline", String(u.headline)]);
        for (const [surface, text] of surfaces) {
          const feats = creativeFeatures(surface, text);
          for (const [feature, value] of Object.entries(feats)) {
            const key = `${surface}:${feature}=${value}`;
            const g = groups.get(key) ?? { ...emptyAgg(), surface, feature, value };
            g.creatives++;
            g.impressions += u.impressions;
            g.clicks += u.clicks;
            g.spend += BigInt(u.spendMinor);
            g.convValue += BigInt(u.conversionValueMinor);
            groups.set(key, g);
          }
        }
      }
      const range = `${dayLabel(start)} – ${dayLabel(end)}`;
      for (const [key, g] of groups) {
        if (g.creatives < CREATIVE_PATTERN_MIN_CREATIVES) continue;
        // Boolean features only ever emit their "yes" group
        // (creativeFeatures omits absent features), so every
        // group here is a presence group or a categorical value.
        const ctr = ctrOf(g);
        if (ctr === null) continue;
        const lift = Math.round(((ctr - baselineCtr) / baselineCtr) * 10000) / 100;
        if (Math.abs(lift) < CREATIVE_PATTERN_MIN_LIFT_PERCENT) continue;
        const direction = lift > 0 ? "winning" : "losing";
        const featureLabel = FEATURE_LABELS_BN[g.feature] ?? g.feature;
        const valueLabel = VALUE_LABELS_BN[g.value] ?? g.value;
        const name = `${SURFACE_LABELS_BN[g.surface]}${valueLabel ? ` (${valueLabel})` : ""} ${featureLabel}`.trim();
        const roas = roasOf(g);
        const statement =
          `Creative pattern (${range}, গত ${CREATIVE_WINDOW_DAYS} দিন): ${name} — CTR ${ctr}% বনাম org-এর গড় ${baselineCtr}% ` +
          `(${lift > 0 ? "+" : ""}${lift}%), ${g.creatives}টি creative, ${g.impressions} impressions থেকে` +
          (roas !== null ? `; এই group-এর ROAS ${roas}${baselineRoas !== null ? ` (গড় ${baselineRoas})` : ""}` : "") +
          `।`;
        patterns.push({
          key, surface: g.surface, feature: g.feature, value: g.value, direction,
          creatives: g.creatives, impressions: g.impressions, clicks: g.clicks,
          ctrPercent: ctr, baselineCtrPercent: baselineCtr, liftPercent: lift,
          roas, baselineRoas, statement,
        });
      }
      // Strongest signal first.
      patterns.sort((a, b) => Math.abs(b.liftPercent) - Math.abs(a.liftPercent));
    }

    const exemplars = [...qualifying]
      .sort((a, b) => (b.ctrPercent ?? -1) - (a.ctrPercent ?? -1) || b.impressions - a.impressions)
      .slice(0, CREATIVE_EXEMPLAR_LIMIT);

    return {
      organizationId,
      generatedAt: now.toISOString(),
      windowDays: CREATIVE_WINDOW_DAYS,
      period: { start: start.toISOString(), end: end.toISOString() },
      creativesWithText: units.length,
      creativesQualifying: qualifying.length,
      creativesBelowFloor: units.length - qualifying.length,
      adsWithoutLocalText,
      baseline: { impressions: baselineAgg.impressions, clicks: baselineAgg.clicks, ctrPercent: baselineCtr, roas: baselineRoas },
      patterns,
      exemplars,
    };
  }

  /** File every reported pattern as a SUGGESTED LearnedItem
   * fact (sourceType "creative" — approval forces INTERNAL,
   * law L3). The dedupe wall (hash of the statement, which
   * carries its window + numbers) makes a same-window re-run
   * a no-op; a new window's numbers file fresh suggestions. */
  async suggestPatterns(
    organizationId: string,
    opts: { now?: Date } = {},
  ): Promise<{ created: number; report: CreativeReport; reason?: string }> {
    const report = await this.computeReport(organizationId, opts);
    if (!report.patterns.length) {
      return { created: 0, report, reason: report.creativesQualifying ? "no_pattern_cleared_thresholds" : "no_qualifying_creatives" };
    }
    let created = 0;
    for (const pat of report.patterns) {
      const r = await this.learn()
        .createSuggestion(organizationId, {
          kind: "fact",
          title: `Creative pattern (${report.windowDays}d): ${pat.key}`,
          content: { text: pat.statement },
          sourceType: "creative",
          sourceRef: {
            periodStart: report.period.start,
            periodEnd: report.period.end,
            windowDays: report.windowDays,
            patternKey: pat.key,
            creatives: pat.creatives,
            impressions: pat.impressions,
          },
        })
        .catch(() => ({ created: false }));
      if ((r as any)?.created) created++;
    }
    return { created, report };
  }

  /** The creative_learning_sweep job body: every org gets its
   * patterns queued; orgs without qualifying creatives are
   * skipped honestly; one org's failure never stops the sweep
   * (the SA-B5/B14 sweep discipline). */
  async runSweep(now: Date = new Date()): Promise<{ orgs: number; mined: number; skipped: number; suggestions: number }> {
    let mined = 0;
    let skipped = 0;
    let suggestions = 0;
    try {
      const orgs = await this.rows<any[]>(() => this.db().organization.findMany({ take: MAX_ORGS_PER_SWEEP }), []);
      for (const org of orgs ?? []) {
        try {
          const r = await this.suggestPatterns(String(org.id), { now });
          if (r.report.creativesQualifying > 0) {
            mined++;
            suggestions += r.created;
            await this.learn()
              .saveState(String(org.id), "creative_learning", {
                lastStatus: "ok",
                lastDetail: { suggestions: r.created, patterns: r.report.patterns.length, qualifying: r.report.creativesQualifying },
              })
              .catch(() => undefined);
          } else {
            skipped++;
          }
        } catch (e) {
          skipped++;
          this.logger.warn(`creative learning failed for org ${org.id}: ${e instanceof Error ? e.message : String(e)}`);
        }
      }
      return { orgs: (orgs ?? []).length, mined, skipped, suggestions };
    } catch (e) {
      this.logger.error(`creative learning sweep failed: ${e instanceof Error ? e.message : String(e)}`);
      return { orgs: 0, mined, skipped, suggestions };
    }
  }
}
