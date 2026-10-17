import { Injectable, Logger, Optional } from "@nestjs/common";
import { formatMinor } from "@repo/contracts";
import { PrismaService } from "../prisma/prisma.service";
import { EventsService } from "../common/events.service";
import { LearningService } from "./learning.service";
import { performancePeriod } from "./performance-learning.service";
import { creativeFeatures } from "./creative-learning.service";

/**
 * SA-B17 (Smart AI Phase 4, C1): Competitor Brain — the
 * deterministic digest that structures the competitor data
 * the org ALREADY collects into Brain knowledge. It answers
 * "প্রতিদ্বন্দ্বীরা কী করছে" from real rows only: who launched
 * new ads, whose prices moved, what themes their copy uses.
 *
 * Step 0 inventory (verified in this tree, SA-B17) — what C1
 * builds on, all of it pre-existing collection:
 *  - `Competitor` — org-scoped profile rows (name,
 *    facebookPageId/Url, websiteUrl, notes).
 *  - `CompetitorAd` — Meta Ad Library sync rows (official
 *    API via CompetitorsService.syncAds / syncMultiPlatform):
 *    externalAdId, startedAt/stoppedAt, isActive, platforms,
 *    creativeText, snapshotUrl, and a REAL firstSeenAt /
 *    lastSeenAt pair, so "new ad" honestly means "first seen
 *    by our sync in the window" — never backdated.
 *  - `CompetitorPriceObservation` — scanner/manual price
 *    points (productName, priceMinor, currency, sourceUrl,
 *    sourceType website_scan|manual|ad_library, observedAt),
 *    written by the robots-respecting WebsiteScanner
 *    (CompetitorsService.scanWebsite) and manual entry.
 *  - Collection cadence: per-competitor ScheduledJobs
 *    (competitor_ads / competitor_scan / competitor_multi_sync,
 *    daily) executed by AutomationService. There is no single
 *    org-level "sync finished" hook, so C1's findings cadence
 *    is the learning-sweep family pattern (B14/B16): on-demand
 *    endpoint + `competitor_intelligence_sweep`. Recorded
 *    choice — C1 adds NO new collection, scrapers or external
 *    calls; it only reads what the syncs already stored.
 *  - The dossier surface (`CompetitorsService.exportDossier`)
 *    and the evidence-bound `CompetitorInsight` rows are the
 *    tenant's existing read surfaces; C1 does not replace
 *    them — it feeds the Brain + the LearnedItem review queue.
 *
 * Honesty boundaries (plan Phase-4 entry notes):
 *  - CompetitorAd carries NO performance data (no
 *    impressions/clicks/spend) — creative themes here are
 *    deterministic COUNTS over creativeText (language,
 *    price/discount mention, urgency, question form), never
 *    CTR/ROAS claims. The lexicons + the language detector
 *    are SA-B16's, reused, not forked.
 *  - Price movement needs >= 2 observations of the same
 *    (competitor, productName) series. A single observation
 *    states the latest price only — "no movement data",
 *    never a fabricated 0% delta. Product names are the
 *    scanner's own strings: an exact-name series is the
 *    honest grain (a renamed listing starts a new series).
 *  - Competitor data is INTERNAL class (law L3) and strictly
 *    per-org (law L1): digests are computed from the org's
 *    own competitor rows only, and findings land as
 *    SUGGESTED LearnedItems (sourceType "competitor") whose
 *    approval forces INTERNAL, like "ads"/"performance"/
 *    "creative".
 *  - NO LLM anywhere in the analysis.
 */

/** Activity windows carried by every digest (days). The
 * findings rules read the 7-day figures; themes and prices
 * read the trailing 30 days. */
export const COMPETITOR_WINDOW_SHORT_DAYS = 7;
export const COMPETITOR_WINDOW_LONG_DAYS = 30;

/** A competitor launching at least this many NEW ads in the
 * short window is a launch burst worth a finding. */
export const COMPETITOR_LAUNCH_BURST_MIN_NEW_ADS = 5;

/** A tracked price drop of at least this percent is a
 * finding. Mirrors the website scanner's own >= 5% price-drop
 * alert threshold (CompetitorsService.scanWebsite), so the
 * Brain and the live alerts agree on what "a drop" means. */
export const COMPETITOR_PRICE_DROP_MIN_PERCENT = 5;

/** A competitor that HAS run ads before but has launched no
 * new ad for at least this many days is reported silent —
 * the statement says "no NEW ad", never "inactive" (their
 * older ads may still be running). */
export const COMPETITOR_SILENCE_MIN_DAYS = 14;

/** Findings filed per digest — the strongest signals only. */
export const COMPETITOR_FINDINGS_LIMIT = 3;

const MAX_ORGS_PER_SWEEP = 200;
/** Generous read caps: a digest must not silently truncate
 * a normal org's data, but a pathological row count cannot
 * hang a context build either. Truncation, if it ever bit,
 * would show up as wrong counts — so the caps are far above
 * the dossier's own 100-per-competitor working set. */
const MAX_ADS_PER_ORG = 5000;
const MAX_OBSERVATIONS_PER_ORG = 5000;

const round2 = (n: number): number => Math.round(n * 100) / 100;
const dayLabel = (d: Date): string => d.toISOString().slice(0, 10);
const DAY_MS = 24 * 60 * 60 * 1000;

export interface CompetitorPricePoint {
  productName: string;
  currency: string;
  /** Latest observed price (minor units, string — BigInt-safe). */
  latestPriceMinor: string;
  latestObservedAt: string;
  /** The immediately prior observation, when one exists. */
  priorPriceMinor: string | null;
  priorObservedAt: string | null;
  /** (latest - prior) / prior * 100 — null unless >= 2
   * observations in the SAME currency exist. Null NEVER
   * means 0: it means "no movement data". */
  deltaPercent: number | null;
  observations: number;
}

export interface CompetitorDigestEntry {
  competitorId: string;
  name: string;
  facebookPageId: string | null;
  websiteUrl: string | null;
  totalAds: number;
  activeAds: number;
  endedAds: number;
  newAds7d: number;
  newAds30d: number;
  /** New ads per week, from the 7-day count (the count IS
   * the weekly rate) and the 30-day count rescaled. */
  adsPerWeek7d: number;
  adsPerWeek30d: number;
  /** When the newest ad (by firstSeenAt) was first seen. */
  lastNewAdAt: string | null;
  /** Whole days since that first-seen; null when the
   * competitor has never had an ad collected. */
  daysSinceLastNewAd: number | null;
  prices: CompetitorPricePoint[];
}

export interface CompetitorThemes {
  /** Ads first seen in the long window that carry copy. */
  adsWithText: number;
  byLanguage: { bn: number; en: number; mixed: number };
  priceMention: number;
  discountMention: number;
  urgency: number;
  questionForm: number;
  emoji: number;
  cta: number;
}

export interface CompetitorDigest {
  organizationId: string;
  generatedAt: string;
  /** False only when the org tracks no competitors at all —
   * an honest empty digest, never an error. */
  hasData: boolean;
  period: { start: string; end: string };
  tracked: number;
  totals: {
    adsSeen: number;
    activeAds: number;
    endedAds: number;
    newAds7d: number;
    newAds30d: number;
    priceSeries: number;
    priceMovements: number;
  };
  competitors: CompetitorDigestEntry[];
  themes: CompetitorThemes;
  /** Org-level view of every price series with >= 2 points
   * (the per-competitor entries carry all series). */
  priceMovements: Array<CompetitorPricePoint & { competitorId: string; competitorName: string }>;
  /** <= COMPETITOR_FINDINGS_LIMIT deterministic finding
   * statements (price drops, then launch bursts, then
   * silences — strongest first within each rule). */
  findings: string[];
  /** Rendered Bengali fact lines for the Brain + API. */
  factLines: string[];
}

@Injectable()
export class CompetitorIntelligenceService {
  private readonly logger = new Logger(CompetitorIntelligenceService.name);
  private learningFallback?: LearningService;

  constructor(
    @Optional() private readonly prisma?: PrismaService,
    @Optional() private readonly learning?: LearningService,
    @Optional() private readonly events?: EventsService,
  ) {}

  private db(): any {
    if (!this.prisma) throw new Error("CompetitorIntelligenceService: PrismaService is not available");
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

  /** Group one competitor's price observations into
   * per-product series and reduce each to its latest point
   * (+ prior + delta when honestly computable). */
  private priceSeries(observations: any[]): CompetitorPricePoint[] {
    const byProduct = new Map<string, any[]>();
    for (const o of observations) {
      const key = String(o.productName ?? "");
      if (!key) continue;
      const list = byProduct.get(key) ?? [];
      list.push(o);
      byProduct.set(key, list);
    }
    const out: CompetitorPricePoint[] = [];
    for (const [productName, list] of byProduct) {
      const sorted = [...list].sort((a, b) => new Date(b.observedAt).getTime() - new Date(a.observedAt).getTime());
      const latest = sorted[0];
      const prior = sorted.length >= 2 ? sorted[1] : null;
      let deltaPercent: number | null = null;
      if (prior && String(prior.currency ?? "BDT") === String(latest.currency ?? "BDT")) {
        const priorMinor = BigInt(prior.priceMinor ?? 0);
        const latestMinor = BigInt(latest.priceMinor ?? 0);
        if (priorMinor > 0n) {
          deltaPercent = round2((Number(latestMinor - priorMinor) / Number(priorMinor)) * 100);
        }
      }
      out.push({
        productName,
        currency: String(latest.currency ?? "BDT"),
        latestPriceMinor: String(latest.priceMinor ?? "0"),
        latestObservedAt: new Date(latest.observedAt).toISOString(),
        priorPriceMinor: prior ? String(prior.priceMinor ?? "0") : null,
        priorObservedAt: prior ? new Date(prior.observedAt).toISOString() : null,
        deltaPercent,
        observations: sorted.length,
      });
    }
    // Most recently observed first — a stable, readable order.
    out.sort((a, b) => (a.latestObservedAt < b.latestObservedAt ? 1 : -1));
    return out;
  }

  /** The full deterministic digest: activity (7d + 30d),
   * creative themes (30d, counts only), price series and the
   * threshold findings. Pure over stored rows — no writes,
   * no external calls, no LLM. */
  async computeDigest(
    organizationId: string,
    opts: { now?: Date } = {},
  ): Promise<CompetitorDigest> {
    const now = opts.now ?? new Date();
    const { start: start30, end } = performancePeriod(COMPETITOR_WINDOW_LONG_DAYS, now);
    const { start: start7 } = performancePeriod(COMPETITOR_WINDOW_SHORT_DAYS, now);
    const p = this.db();

    const competitors = await this.rows<any[]>(
      () => p.competitor?.findMany?.({ where: { organizationId }, orderBy: { createdAt: "asc" } }),
      [],
    );
    const base: CompetitorDigest = {
      organizationId,
      generatedAt: now.toISOString(),
      hasData: (competitors ?? []).length > 0,
      period: { start: start30.toISOString(), end: end.toISOString() },
      tracked: (competitors ?? []).length,
      totals: { adsSeen: 0, activeAds: 0, endedAds: 0, newAds7d: 0, newAds30d: 0, priceSeries: 0, priceMovements: 0 },
      competitors: [],
      themes: {
        adsWithText: 0,
        byLanguage: { bn: 0, en: 0, mixed: 0 },
        priceMention: 0, discountMention: 0, urgency: 0, questionForm: 0, emoji: 0, cta: 0,
      },
      priceMovements: [],
      findings: [],
      factLines: [],
    };
    if (!base.hasData) return base;

    const ids = (competitors ?? []).map((c: any) => String(c.id));
    const [ads, observations] = await Promise.all([
      this.rows<any[]>(() => p.competitorAd?.findMany?.({ where: { competitorId: { in: ids } }, take: MAX_ADS_PER_ORG }), []),
      this.rows<any[]>(
        () => p.competitorPriceObservation?.findMany?.({ where: { competitorId: { in: ids } }, orderBy: { observedAt: "desc" }, take: MAX_OBSERVATIONS_PER_ORG }),
        [],
      ),
    ]);
    const adsByCompetitor = new Map<string, any[]>();
    for (const ad of ads ?? []) {
      const key = String(ad.competitorId);
      const list = adsByCompetitor.get(key) ?? [];
      list.push(ad);
      adsByCompetitor.set(key, list);
    }
    const obsByCompetitor = new Map<string, any[]>();
    for (const o of observations ?? []) {
      const key = String(o.competitorId);
      const list = obsByCompetitor.get(key) ?? [];
      list.push(o);
      obsByCompetitor.set(key, list);
    }

    const themes = base.themes;
    const priceMovements: CompetitorDigest["priceMovements"] = [];
    const drops: Array<{ delta: number; text: string }> = [];
    const bursts: Array<{ count: number; text: string }> = [];
    const silences: Array<{ days: number; text: string }> = [];

    for (const c of competitors ?? []) {
      const cAds = adsByCompetitor.get(String(c.id)) ?? [];
      const active = cAds.filter((a: any) => a.isActive).length;
      const inWindow = (a: any, from: Date) => {
        const t = new Date(a.firstSeenAt ?? a.createdAt ?? 0).getTime();
        return t >= from.getTime() && t < end.getTime();
      };
      const new7 = cAds.filter((a: any) => inWindow(a, start7));
      const new30 = cAds.filter((a: any) => inWindow(a, start30));
      let lastNewAdAt: Date | null = null;
      for (const a of cAds) {
        const t = new Date(a.firstSeenAt ?? a.createdAt ?? 0);
        if (!Number.isNaN(t.getTime()) && (!lastNewAdAt || t > lastNewAdAt)) lastNewAdAt = t;
      }
      const daysSince = lastNewAdAt ? Math.floor((now.getTime() - lastNewAdAt.getTime()) / DAY_MS) : null;

      // Creative themes: counts over copy first seen in the
      // long window (SA-B16 features/lexicons, reused).
      for (const a of new30) {
        const text = String(a.creativeText ?? "").trim();
        if (!text) continue;
        themes.adsWithText++;
        const f = creativeFeatures("text", text);
        if (f.language === "bn") themes.byLanguage.bn++;
        else if (f.language === "en") themes.byLanguage.en++;
        else if (f.language === "mixed") themes.byLanguage.mixed++;
        if (f.price) themes.priceMention++;
        if (f.discount) themes.discountMention++;
        if (f.urgency) themes.urgency++;
        if (f.question) themes.questionForm++;
        if (f.emoji) themes.emoji++;
        if (f.cta) themes.cta++;
      }

      const prices = this.priceSeries(obsByCompetitor.get(String(c.id)) ?? []);
      for (const pt of prices) {
        if (pt.deltaPercent !== null) {
          priceMovements.push({ ...pt, competitorId: String(c.id), competitorName: String(c.name) });
          if (pt.deltaPercent <= -COMPETITOR_PRICE_DROP_MIN_PERCENT) {
            drops.push({
              delta: pt.deltaPercent,
              text:
                `প্রতিদ্বন্দ্বী “${c.name}” “${pt.productName}”-এর দাম কমিয়েছে: ` +
                `${formatMinor(BigInt(pt.priorPriceMinor ?? "0"), pt.currency)} থেকে ${formatMinor(BigInt(pt.latestPriceMinor), pt.currency)} ` +
                `(${pt.deltaPercent}%), সর্বশেষ দেখা গেছে ${dayLabel(new Date(pt.latestObservedAt))}।`,
            });
          }
        }
      }

      if (new7.length >= COMPETITOR_LAUNCH_BURST_MIN_NEW_ADS) {
        bursts.push({
          count: new7.length,
          text: `প্রতিদ্বন্দ্বী “${c.name}” গত ${COMPETITOR_WINDOW_SHORT_DAYS} দিনে ${new7.length}টি নতুন ad চালু করেছে (বর্তমানে সক্রিয় ad ${active}টি)।`,
        });
      }
      if (cAds.length > 0 && daysSince !== null && daysSince >= COMPETITOR_SILENCE_MIN_DAYS) {
        silences.push({
          days: daysSince,
          text: `প্রতিদ্বন্দ্বী “${c.name}” গত ${daysSince} দিনে কোনো নতুন ad দেয়নি (সর্বশেষ নতুন ad ${dayLabel(lastNewAdAt as Date)}); পুরনো ad এখনো চলতে পারে।`,
        });
      }

      base.totals.adsSeen += cAds.length;
      base.totals.activeAds += active;
      base.totals.endedAds += cAds.length - active;
      base.totals.newAds7d += new7.length;
      base.totals.newAds30d += new30.length;
      base.totals.priceSeries += prices.length;

      base.competitors.push({
        competitorId: String(c.id),
        name: String(c.name),
        facebookPageId: c.facebookPageId ?? null,
        websiteUrl: c.websiteUrl ?? null,
        totalAds: cAds.length,
        activeAds: active,
        endedAds: cAds.length - active,
        newAds7d: new7.length,
        newAds30d: new30.length,
        adsPerWeek7d: new7.length,
        adsPerWeek30d: round2((new30.length * 7) / COMPETITOR_WINDOW_LONG_DAYS),
        lastNewAdAt: lastNewAdAt ? lastNewAdAt.toISOString() : null,
        daysSinceLastNewAd: daysSince,
        prices,
      });
    }
    base.totals.priceMovements = priceMovements.length;
    base.priceMovements = priceMovements;

    drops.sort((a, b) => a.delta - b.delta);
    bursts.sort((a, b) => b.count - a.count);
    silences.sort((a, b) => b.days - a.days);
    base.findings = [...drops, ...bursts, ...silences]
      .slice(0, COMPETITOR_FINDINGS_LIMIT)
      .map((f) => f.text);

    base.factLines = this.factLines(base);
    return base;
  }

  private factLines(d: CompetitorDigest): string[] {
    const lines: string[] = [];
    const range = `${dayLabel(new Date(d.period.start))} – ${dayLabel(new Date(d.period.end))}`;
    lines.push(
      `প্রতিদ্বন্দ্বী চিত্র (${range}): ${d.tracked}টি প্রতিদ্বন্দ্বী track করা হচ্ছে; মোট ${d.totals.adsSeen}টি ad দেখা গেছে (${d.totals.activeAds}টি সক্রিয়), ` +
        `গত ${COMPETITOR_WINDOW_SHORT_DAYS} দিনে ${d.totals.newAds7d}টি ও গত ${COMPETITOR_WINDOW_LONG_DAYS} দিনে ${d.totals.newAds30d}টি নতুন ad।`,
    );
    for (const c of d.competitors) {
      lines.push(
        `“${c.name}”: মোট ${c.totalAds}টি ad (${c.activeAds}টি সক্রিয়, ${c.endedAds}টি শেষ), গত ${COMPETITOR_WINDOW_SHORT_DAYS} দিনে ${c.newAds7d}টি নতুন (সপ্তাহে ${c.adsPerWeek30d}টি গড়ে গত ${COMPETITOR_WINDOW_LONG_DAYS} দিনে)।`,
      );
      for (const pt of c.prices) {
        lines.push(
          `“${c.name}”-এর “${pt.productName}”: সর্বশেষ দাম ${formatMinor(BigInt(pt.latestPriceMinor), pt.currency)} (${dayLabel(new Date(pt.latestObservedAt))})` +
            (pt.deltaPercent !== null && pt.priorPriceMinor !== null
              ? `; আগের ${formatMinor(BigInt(pt.priorPriceMinor), pt.currency)} থেকে ${pt.deltaPercent > 0 ? "+" : ""}${pt.deltaPercent}%।`
              : `; আগের দামের সঙ্গে তুলনার মতো পর্যাপ্ত পর্যবেক্ষণ নেই।`),
        );
      }
    }
    const t = d.themes;
    if (t.adsWithText > 0) {
      lines.push(
        `প্রতিদ্বন্দ্বীদের creative theme (গত ${COMPETITOR_WINDOW_LONG_DAYS} দিনের নতুন ad-এর লেখা, ${t.adsWithText}টি): ` +
          `বাংলা ${t.byLanguage.bn}টি, ইংরেজি ${t.byLanguage.en}টি, মিশ্র ${t.byLanguage.mixed}টি; ` +
          `দামের উল্লেখ ${t.priceMention}টিতে, ছাড়ের উল্লেখ ${t.discountMention}টিতে, জরুরি-ভাবের শব্দ ${t.urgency}টিতে, প্রশ্ন-আকার ${t.questionForm}টিতে, CTA ${t.cta}টিতে, ইমোজি ${t.emoji}টিতে।`,
      );
    }
    for (const f of d.findings) lines.push(`উল্লেখযোগ্য: ${f}`);
    return lines;
  }

  /** File the digest's findings as SUGGESTED LearnedItem
   * facts (sourceType "competitor" — approval forces
   * INTERNAL, law L3). The dedupe wall (hash of the
   * statement, which carries its numbers) makes a re-run
   * over unchanged data a no-op. */
  async suggestFindings(
    organizationId: string,
    opts: { now?: Date } = {},
  ): Promise<{ created: number; digest: CompetitorDigest; reason?: string }> {
    const digest = await this.computeDigest(organizationId, opts);
    if (!digest.hasData) return { created: 0, digest, reason: "no_competitors_tracked" };
    // SA-B18 (C2): announce every computed digest on the
    // findings path so the response proposers (review-queue
    // responses + the one engine bridge) can react — the
    // SA-B15 bus discipline, so the findings path never
    // depends on the bus and a consumer failure can never
    // surface here.
    try {
      this.events?.emit("competitor.findings_filed", {
        organizationId,
        periodStart: digest.period.start,
        periodEnd: digest.period.end,
        findings: digest.findings.length,
      });
    } catch {
      /* the findings path never depends on the bus */
    }
    if (!digest.findings.length) return { created: 0, digest, reason: "no_findings" };
    let created = 0;
    for (const text of digest.findings) {
      const r = await this.learn()
        .createSuggestion(organizationId, {
          kind: "fact",
          title: `Competitor finding: ${text.slice(0, 80)}`,
          content: { text },
          sourceType: "competitor",
          sourceRef: { periodStart: digest.period.start, periodEnd: digest.period.end },
        })
        .catch(() => ({ created: false }));
      if ((r as any)?.created) created++;
    }
    return { created, digest };
  }

  /** The competitor_intelligence_sweep job body: orgs that
   * track competitors get their findings queued; orgs with
   * none are skipped honestly; one org's failure never stops
   * the sweep (the SA-B5/B14/B16 sweep discipline). */
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
              .saveState(String(org.id), "competitor_intelligence", {
                lastStatus: "ok",
                lastDetail: { suggestions: r.created, findings: r.digest.findings.length, tracked: r.digest.tracked },
              })
              .catch(() => undefined);
          } else {
            skipped++;
          }
        } catch (e) {
          skipped++;
          this.logger.warn(`competitor intelligence failed for org ${org.id}: ${e instanceof Error ? e.message : String(e)}`);
        }
      }
      return { orgs: (orgs ?? []).length, digested, skipped, suggestions };
    } catch (e) {
      this.logger.error(`competitor intelligence sweep failed: ${e instanceof Error ? e.message : String(e)}`);
      return { orgs: 0, digested, skipped, suggestions };
    }
  }
}
