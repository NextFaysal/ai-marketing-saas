import { Injectable, Logger, OnModuleInit, Optional } from "@nestjs/common";
import { formatMinor } from "@repo/contracts";
import { PrismaService } from "../prisma/prisma.service";
import { EventsService } from "../common/events.service";
import { LearningService } from "./learning.service";
import {
  CompetitorIntelligenceService,
  COMPETITOR_FINDINGS_LIMIT,
  COMPETITOR_LAUNCH_BURST_MIN_NEW_ADS,
  COMPETITOR_PRICE_DROP_MIN_PERCENT,
  COMPETITOR_SILENCE_MIN_DAYS,
  COMPETITOR_WINDOW_SHORT_DAYS,
  type CompetitorDigest,
} from "./competitor-intelligence.service";

/**
 * SA-B18 (Smart AI Phase 4, C2): Competitor → Action
 * proposals, review-queue half. C1 (SA-B17) files WHAT the
 * rivals did (findings); this service files what the org
 * might DO about it — as SUGGESTED LearnedItems in the same
 * review queue (kind "fact", sourceType "competitor", so
 * approval forces INTERNAL, law L3, exactly like the
 * findings themselves).
 *
 * Step-0 mapping analysis (SA-B18 — the full table lives in
 * docs/smart-ai-b18-acceptance.md):
 *  - price_drop → a talking point: the finding's real
 *    numbers + the org's OWN live price when — and only
 *    when — the scanner's product name EXACTLY matches an
 *    own ACTIVE product's name (see the linkage rule below).
 *    No engine bridge: no catalog action answers a rival's
 *    price (setting the org's own prices is deliberately
 *    absent from the catalog — a human/staff decision, L5).
 *  - launch_burst → a counter-content IDEA (evidence: the
 *    burst + honestly-labelled all-competitor theme counts;
 *    the actual draft is Phase-5 G1 work, not this batch)
 *    in the queue, PLUS the batch's one engine bridge
 *    (CompetitorActionProposerService: resume_campaign).
 *  - silence → an opportunity note in the queue. No engine
 *    bridge: nothing happened, so there is no observed rival
 *    act to answer, and a budget proposal would need an
 *    invented amount.
 *  - A separate LearnedItem kind "response" was REJECTED:
 *    LearningService.approve() throws on kinds outside
 *    faq_pair/fact/product_note, and the queue + Brain
 *    rendering key on those three. A response is a fact with
 *    a structured `response` block in its content — the
 *    union absorbs it as-is, with zero new surface.
 *
 * Own-product linkage rule (price_drop only): the scanner's
 * productName links to an own product iff, after
 * normalisation (trim, whitespace collapse, case-fold), it
 * EQUALS the product's `name` or `nameEn`, the product is
 * ACTIVE and belongs to the same org. Earliest createdAt
 * wins a tie; the productId is recorded in the suggestion so
 * a human can audit the pairing. Substring/fuzzy
 * near-matches NEVER link — a wrong pairing would put a
 * fabricated comparison in front of the team. A comparative
 * claim ("their new price is below yours") is made ONLY
 * when the two currencies match; otherwise both prices are
 * stated with their currencies and no comparison is claimed.
 *
 * Findings derivation: the structured findings below are
 * read off the C1 digest's OWN structured fields
 * (priceMovements, competitors) using C1's exported
 * threshold constants, with C1's own sort + cap — the
 * digest is computed ONCE by CompetitorIntelligenceService
 * and never recomputed from raw rows here. The response for
 * the i-th derived finding carries the digest's i-th
 * finding statement as its evidence text.
 *
 * Where it runs: CompetitorIntelligenceService announces
 * every computed digest on the findings path
 * ("competitor.findings_filed" — the competitor_intelligence
 * sweep and the on-demand suggest endpoint both land in
 * suggestFindings), and this service subscribes — the
 * SA-B15 bus discipline, so the module direction stays
 * acyclic and a response failure can never break the
 * findings path. NO LLM anywhere: every number below comes
 * from the digest or the org's live product row.
 */

export type CompetitorFindingRule = "price_drop" | "launch_burst" | "silence";

export interface CompetitorStructuredFinding {
  rule: CompetitorFindingRule;
  competitorId: string;
  competitorName: string;
  /** The C1 finding statement at the same position in the
   * digest's findings list — evidence, carried verbatim. */
  findingText: string | null;
  // price_drop
  productName?: string;
  currency?: string;
  priorPriceMinor?: string | null;
  latestPriceMinor?: string;
  deltaPercent?: number | null;
  latestObservedAt?: string;
  // launch_burst
  newAds7d?: number;
  activeAds?: number;
  // silence
  daysSinceLastNewAd?: number | null;
  lastNewAdAt?: string | null;
}

/** Structured findings from the digest's own fields, in the
 * digest's own priority order (drops by delta asc, bursts
 * by count desc, silences by days desc), capped exactly as
 * C1 caps digest.findings. Pure — no reads, no writes. */
export function deriveCompetitorFindings(digest: CompetitorDigest): CompetitorStructuredFinding[] {
  const drops: CompetitorStructuredFinding[] = (digest.priceMovements ?? [])
    .filter((pt) => pt.deltaPercent !== null && pt.deltaPercent <= -COMPETITOR_PRICE_DROP_MIN_PERCENT)
    .sort((a, b) => (a.deltaPercent as number) - (b.deltaPercent as number))
    .map((pt) => ({
      rule: "price_drop" as const,
      competitorId: pt.competitorId,
      competitorName: pt.competitorName,
      findingText: null,
      productName: pt.productName,
      currency: pt.currency,
      priorPriceMinor: pt.priorPriceMinor,
      latestPriceMinor: pt.latestPriceMinor,
      deltaPercent: pt.deltaPercent,
      latestObservedAt: pt.latestObservedAt,
    }));
  const bursts: CompetitorStructuredFinding[] = (digest.competitors ?? [])
    .filter((c) => c.newAds7d >= COMPETITOR_LAUNCH_BURST_MIN_NEW_ADS)
    .sort((a, b) => b.newAds7d - a.newAds7d)
    .map((c) => ({
      rule: "launch_burst" as const,
      competitorId: c.competitorId,
      competitorName: c.name,
      findingText: null,
      newAds7d: c.newAds7d,
      activeAds: c.activeAds,
    }));
  const silences: CompetitorStructuredFinding[] = (digest.competitors ?? [])
    .filter(
      (c) =>
        c.totalAds > 0 &&
        c.daysSinceLastNewAd !== null &&
        (c.daysSinceLastNewAd as number) >= COMPETITOR_SILENCE_MIN_DAYS,
    )
    .sort((a, b) => (b.daysSinceLastNewAd as number) - (a.daysSinceLastNewAd as number))
    .map((c) => ({
      rule: "silence" as const,
      competitorId: c.competitorId,
      competitorName: c.name,
      findingText: null,
      daysSinceLastNewAd: c.daysSinceLastNewAd,
      lastNewAdAt: c.lastNewAdAt,
    }));
  return [...drops, ...bursts, ...silences]
    .slice(0, COMPETITOR_FINDINGS_LIMIT)
    .map((f, i) => ({ ...f, findingText: digest.findings?.[i] ?? null }));
}

/** Name normalisation for the linkage rule: trim, collapse
 * internal whitespace, case-fold. Nothing fuzzier — ever. */
export function normalizeProductName(s: unknown): string {
  return String(s ?? "")
    .trim()
    .replace(/\s+/g, " ")
    .toLowerCase();
}

const MAX_OWN_PRODUCTS_READ = 1000;
const dayLabel = (d: Date): string => d.toISOString().slice(0, 10);

export interface FiledCompetitorResponse {
  rule: CompetitorFindingRule;
  competitorId: string;
  created: boolean;
}

@Injectable()
export class CompetitorResponseService implements OnModuleInit {
  private readonly logger = new Logger(CompetitorResponseService.name);
  private learningFallback?: LearningService;
  private intelligenceFallback?: CompetitorIntelligenceService;

  constructor(
    @Optional() private readonly prisma?: PrismaService,
    @Optional() private readonly intelligence?: CompetitorIntelligenceService,
    @Optional() private readonly learning?: LearningService,
    @Optional() private readonly events?: EventsService,
  ) {}

  onModuleInit() {
    this.events?.on("competitor.findings_filed", (payload) => this.onFindingsFiled(payload));
  }

  private db(): any {
    if (!this.prisma) throw new Error("CompetitorResponseService: PrismaService is not available");
    return this.prisma as any;
  }

  private learn(): LearningService {
    return this.learning ?? (this.learningFallback ??= new LearningService(this.prisma as any));
  }

  private intel(): CompetitorIntelligenceService {
    return (
      this.intelligence ??
      (this.intelligenceFallback ??= new CompetitorIntelligenceService(this.prisma as any, this.learn()))
    );
  }

  private async onFindingsFiled(payload: any): Promise<void> {
    const organizationId = payload?.organizationId;
    if (typeof organizationId !== "string" || !organizationId) return;
    // Fire-and-forget safe: the bus isolates handler
    // failures; this catch is the second wall (the B11/B15
    // discipline) so filing responses can never surface
    // into the findings path.
    await this.suggestResponses(organizationId).catch(() => undefined);
  }

  /** The linkage rule, exposed for specs: the org's own
   * ACTIVE product whose name/nameEn exactly matches the
   * scanner's product name after normalisation — or null.
   * Org-scoped by construction (one org's catalogue is never
   * read for another org's response). */
  async findOwnProductLink(
    organizationId: string,
    scannerProductName: string,
  ): Promise<{ productId: string; name: string; priceMinor: string; currency: string } | null> {
    const target = normalizeProductName(scannerProductName);
    if (!target) return null;
    const rows = await this.db()
      .product?.findMany?.({
        where: { organizationId, status: "ACTIVE" },
        orderBy: { createdAt: "asc" },
        take: MAX_OWN_PRODUCTS_READ,
      })
      .catch(() => []);
    for (const p of rows ?? []) {
      if (normalizeProductName(p.name) === target || (p.nameEn && normalizeProductName(p.nameEn) === target)) {
        return {
          productId: String(p.id),
          name: String(p.name),
          priceMinor: String(p.priceMinor ?? "0"),
          currency: String(p.currency ?? "BDT"),
        };
      }
    }
    return null;
  }

  private async buildResponse(
    organizationId: string,
    digest: CompetitorDigest,
    f: CompetitorStructuredFinding,
  ): Promise<{ text: string; content: Record<string, unknown> }> {
    if (f.rule === "price_drop") {
      const own = await this.findOwnProductLink(organizationId, String(f.productName ?? ""));
      const prior = formatMinor(BigInt(f.priorPriceMinor ?? "0"), String(f.currency ?? "BDT"));
      const latest = formatMinor(BigInt(f.latestPriceMinor ?? "0"), String(f.currency ?? "BDT"));
      let text =
        `প্রতিদ্বন্দ্বী “${f.competitorName}” “${f.productName}”-এর দাম কমিয়েছে: ${prior} থেকে ${latest} (${f.deltaPercent}%)। `;
      if (own) {
        const ownPrice = formatMinor(BigInt(own.priceMinor), own.currency);
        text += `হুবহু একই নামের আপনার পণ্য “${own.name}”-এর বর্তমান দাম ${ownPrice}`;
        if (own.currency === f.currency) {
          const ownMinor = BigInt(own.priceMinor);
          const compMinor = BigInt(f.latestPriceMinor ?? "0");
          if (ownMinor > compMinor) text += ` — অর্থাৎ প্রতিদ্বন্দ্বীর নতুন দাম এখন আপনার দামের চেয়ে কম। `;
          else if (ownMinor < compMinor) text += ` — আপনার দাম এখনও প্রতিদ্বন্দ্বীর নতুন দামের চেয়ে কম। `;
          else text += ` — দুই দাম এখন সমান। `;
        } else {
          text += ` (মুদ্রা আলাদা — প্রতিদ্বন্দ্বীর ${f.currency}, আপনার ${own.currency} — তাই সরাসরি তুলনা করা হয়নি)। `;
        }
      } else {
        text += `আপনার catalog-এ হুবহু একই নামের কোনো পণ্য পাওয়া যায়নি, তাই নিজের দামের সঙ্গে তুলনা করা হয়নি। `;
      }
      text +=
        `পরামর্শ (টিমের জন্য প্রস্তাব): তাড়াহুড়ো করে দাম না কমিয়ে, customer-এর উত্তরে পণ্যের মান, ` +
        `ওয়ারেন্টি/সার্ভিস আর ডেলিভারির দিকগুলো তুলে ধরুন। দাম বদলানোর সিদ্ধান্ত শুধু টিমের — এখানে কোনো দাম বদলানো হয়নি।`;
      return {
        text,
        content: {
          text,
          findingText: f.findingText,
          response: {
            rule: f.rule,
            kind: "talking_point",
            competitorId: f.competitorId,
            competitorName: f.competitorName,
            productName: f.productName,
            currency: f.currency,
            priorPriceMinor: f.priorPriceMinor ?? null,
            latestPriceMinor: f.latestPriceMinor,
            deltaPercent: f.deltaPercent,
            latestObservedAt: f.latestObservedAt,
            linkage: own ? "exact_name" : null,
            ownProduct: own,
          },
        },
      };
    }

    if (f.rule === "launch_burst") {
      let text =
        `প্রতিদ্বন্দ্বী “${f.competitorName}” গত ${COMPETITOR_WINDOW_SHORT_DAYS} দিনে ${f.newAds7d}টি নতুন ad চালু করেছে ` +
        `(বর্তমানে সক্রিয় ad ${f.activeAds}টি)। পাল্টা content-এর ধারণা (টিমের জন্য প্রস্তাব — এটি কোনো খসড়া নয়): ` +
        `নিজের সবচেয়ে শক্তিশালী পণ্য/অফার নিয়ে একটি পাল্টা পোস্ট বা campaign-এর পরিকল্পনা করুন`;
      const t = digest.themes;
      if (t && t.adsWithText > 0) {
        text +=
          ` — প্রসঙ্গত, সব প্রতিদ্বন্দ্বী মিলিয়ে সাম্প্রতিক ad-এর লেখায় দামের উল্লেখ ${t.priceMention}টিতে, ` +
          `ছাড়ের উল্লেখ ${t.discountMention}টিতে, জরুরি-ভাবের শব্দ ${t.urgency}টিতে দেখা গেছে (সামগ্রিক হিসাব, শুধু এই প্রতিদ্বন্দ্বীর নয়)`;
      }
      text += `। আসল খসড়া content তৈরির ধাপে (Phase 5) হবে; এখানে কোনো পোস্ট বা campaign তৈরি করা হয়নি।`;
      return {
        text,
        content: {
          text,
          findingText: f.findingText,
          response: {
            rule: f.rule,
            kind: "counter_content_idea",
            competitorId: f.competitorId,
            competitorName: f.competitorName,
            newAds7d: f.newAds7d,
            activeAds: f.activeAds,
          },
        },
      };
    }

    // silence
    const lastSeen = f.lastNewAdAt ? dayLabel(new Date(f.lastNewAdAt)) : null;
    const text =
      `প্রতিদ্বন্দ্বী “${f.competitorName}” গত ${f.daysSinceLastNewAd} দিনে কোনো নতুন ad দেয়নি` +
      (lastSeen ? ` (সর্বশেষ নতুন ad ${lastSeen})` : ``) +
      ` — পুরনো ad এখনো চলতে পারে, তারা নিষ্ক্রিয় এমন দাবি করা হচ্ছে না। ` +
      `পরামর্শ (টিমের জন্য প্রস্তাব): এই সময়টা নিজের উপস্থিতি বাড়ানোর সুযোগ হিসেবে দেখুন। ` +
      `budget বা campaign বদলানোর যেকোনো সিদ্ধান্ত টিমের — এখানে কোনো পরিবর্তন করা হয়নি।`;
    return {
      text,
      content: {
        text,
        findingText: f.findingText,
        response: {
          rule: f.rule,
          kind: "opportunity_note",
          competitorId: f.competitorId,
          competitorName: f.competitorName,
          daysSinceLastNewAd: f.daysSinceLastNewAd,
          lastNewAdAt: f.lastNewAdAt ?? null,
        },
      },
    };
  }

  /** File response suggestions for one org's current digest.
   *  Mirrors the digest's filed findings 1:1 (same findings,
   *  same order, same cap). The LearnedItem dedupe wall
   *  (hash of kind+content — the content carries the
   *  finding's numbers and the response) makes a re-run over
   *  unchanged data a no-op. */
  async suggestResponses(
    organizationId: string,
    opts: { now?: Date } = {},
  ): Promise<{ created: number; digest: CompetitorDigest; responses: FiledCompetitorResponse[]; reason?: string }> {
    const digest = await this.intel().computeDigest(organizationId, opts);
    if (!digest.hasData) return { created: 0, digest, responses: [], reason: "no_competitors_tracked" };
    const findings = deriveCompetitorFindings(digest);
    if (!findings.length) return { created: 0, digest, responses: [], reason: "no_findings" };
    let created = 0;
    const responses: FiledCompetitorResponse[] = [];
    for (const f of findings) {
      const built = await this.buildResponse(organizationId, digest, f);
      const r = await this.learn()
        .createSuggestion(organizationId, {
          kind: "fact",
          title: `Competitor response: ${built.text.slice(0, 80)}`,
          content: built.content,
          sourceType: "competitor",
          sourceRef: {
            periodStart: digest.period.start,
            periodEnd: digest.period.end,
            rule: f.rule,
            competitorId: f.competitorId,
          },
        })
        .catch(() => ({ created: false }));
      const wasCreated = !!(r as any)?.created;
      if (wasCreated) created++;
      responses.push({ rule: f.rule, competitorId: f.competitorId, created: wasCreated });
    }
    return { created, digest, responses };
  }
}
