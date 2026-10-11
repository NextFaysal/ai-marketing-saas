import { Injectable } from "@nestjs/common";
import { LlmFactory } from "../ai/llm/llm.factory";

/**
 * Review miner — INPUT-DRIVEN, or nothing (HF4, replaces the inventing
 * miner removed in the Honesty Fix package).
 *
 * The old miner had no review source at all: it asked an LLM to invent
 * "typical" complaints and quotes, and without an LLM returned a
 * hardcoded 460-feedback / 3.8-rating report with fabricated customer
 * quotes. This version analyzes ONLY the text the owner pastes in from
 * the competitor's real page/comments:
 * - counts are counted by code from the pasted items,
 * - quotes are verbatim excerpts of the input (code drops any quote
 *   that is not found in the input — see verifyQuotes),
 * - a rating is reported only when the pasted text itself carries
 *   parseable ratings ("4/5", "2 stars", ★★★),
 * - complaint categories/sentiment are deterministic keyword
 *   classifications OF THE INPUT (a heuristic, labeled as such),
 * - counter angles may be drafted by a real LLM from the computed
 *   categories only; otherwise a labeled template draft is used.
 *
 * No input -> { available: false } and no report is created.
 */

export interface CustomerComplaintTheme {
  category: "Shipping & Delivery" | "Product Quality & Fabric" | "Sizing & Fit" | "Customer Service & Return" | "Pricing & Hidden Cost";
  /** Share of the pasted items counted in this category, by code. */
  frequencyPercent: number;
  itemCount: number;
  complaintSummary: string;
  sampleCustomerQuotes: string[];
  severity: "High" | "Medium" | "Critical";
}

export interface ReviewCounterAngle {
  hookHeadline: string;
  trustMechanism: string;
  guaranteeOffer: string;
  whyBuyersSwitch: string;
}

export type CompetitorReviewMineReport =
  | { available: false; competitorName: string; reason: string }
  | {
      available: true;
      competitorName: string;
      /** Exactly the number of pasted review items that were analyzed. */
      totalAnalyzedFeedback: number;
      /** Average of ratings parsed from the pasted text, or null when
       *  the input carries no parseable rating. Never invented. */
      overallRatingScore: number | null;
      sentimentDistribution: { satisfied: number; neutral: number; dissatisfied: number };
      topComplaints: CustomerComplaintTheme[];
      biggestVulnerability: string;
      recommendedCounterAngles: ReviewCounterAngle[];
    };

/** Split pasted text into individual review items: blank-line separated
 *  blocks when present, otherwise one review per line. */
export function splitReviewItems(text: string): string[] {
  const byBlankLine = text.split(/\n\s*\n/).map((s) => s.trim()).filter(Boolean);
  if (byBlankLine.length > 1) return byBlankLine.slice(0, 200);
  return text.split(/\n+/).map((s) => s.trim()).filter(Boolean).slice(0, 200);
}

function normalizeForMatch(s: string): string {
  return s.toLowerCase().replace(/["“”'‘’]/g, "").replace(/\s+/g, " ").trim();
}

/** Keep only quotes that actually appear in the input text. Any quote
 *  that cannot be found verbatim (after whitespace/quote-mark
 *  normalization) is dropped — an invented quote can never survive. */
export function verifyQuotes(quotes: string[], inputText: string): string[] {
  const haystack = normalizeForMatch(inputText);
  return quotes.filter((q) => {
    const needle = normalizeForMatch(q.replace(/^"+|"+$/g, ""));
    return needle.length > 0 && haystack.includes(needle);
  });
}

/** Parse a rating out of a single pasted item, if the item carries one. */
export function parseRating(item: string): number | null {
  const fraction = item.match(/(\d(?:\.\d)?)\s*\/\s*5/);
  if (fraction) {
    const v = parseFloat(fraction[1]);
    if (v > 0 && v <= 5) return v;
  }
  const stars = item.match(/(\d(?:\.\d)?)\s*(?:stars?|স্টার)/i);
  if (stars) {
    const v = parseFloat(stars[1]);
    if (v > 0 && v <= 5) return v;
  }
  const starGlyphs = item.match(/★+/);
  if (starGlyphs) {
    const v = starGlyphs[0].length;
    if (v >= 1 && v <= 5) return v;
  }
  return null;
}

const CATEGORIES: { category: CustomerComplaintTheme["category"]; re: RegExp }[] = [
  { category: "Shipping & Delivery", re: /deliver|shipping|courier|shipment|দেরি|ডেলিভারি|late delivery/i },
  { category: "Product Quality & Fabric", re: /quality|fabric|colou?r|material|damag|broken|ছবি|রঙ|নষ্ট|ফ্যাব্রিক/i },
  { category: "Sizing & Fit", re: /\bsize\b|sizing|\bfit\b|measurement|সাইজ/i },
  { category: "Customer Service & Return", re: /return|exchange|refund|customer service|support|রিটার্ন|এক্সচেঞ্জ|ফেরত|রেসপন্স/i },
  { category: "Pricing & Hidden Cost", re: /price|pricing|charge|cost|expensive|overpriced|দাম|চার্জ|hidden/i },
];

const NEGATIVE_RE = /খারাপ|বাজে|হতাশ|অভিযোগ|প্রতারণা|নকল|ভুল|দেরি|late|slow|bad|worst|poor|damag|wrong|fake|disappoint|complain|fraud|waste|terrible|awful/i;
const POSITIVE_RE = /ভালো|সন্তুষ্ট|ধন্যবাদ|good|great|excellent|happy|best|perfect|love|satisfied|amazing|awesome/i;

type Sentiment = "satisfied" | "neutral" | "dissatisfied";

function classifySentiment(item: string, rating: number | null): Sentiment {
  if (rating !== null) {
    if (rating <= 2) return "dissatisfied";
    if (rating >= 4) return "satisfied";
    return "neutral";
  }
  if (NEGATIVE_RE.test(item)) return "dissatisfied";
  if (POSITIVE_RE.test(item)) return "satisfied";
  return "neutral";
}

function categoryOf(item: string): CustomerComplaintTheme["category"] | null {
  for (const c of CATEGORIES) {
    if (c.re.test(item)) return c.category;
  }
  return null;
}

@Injectable()
export class ReviewMiner {
  constructor(private readonly llm: LlmFactory) {}

  async mine(competitorName: string, reviewsText?: string): Promise<CompetitorReviewMineReport> {
    const cleanName = competitorName.trim();
    const items = reviewsText ? splitReviewItems(reviewsText) : [];
    if (items.length === 0) {
      return {
        available: false,
        competitorName: cleanName,
        reason: "আসল রিভিউ পেস্ট করুন — ডেটা ছাড়া রিপোর্ট তৈরি হয় না",
      };
    }

    const total = items.length;
    const ratings: number[] = [];
    const sentimentCounts: Record<Sentiment, number> = { satisfied: 0, neutral: 0, dissatisfied: 0 };
    const byCategory = new Map<CustomerComplaintTheme["category"], string[]>();

    for (const item of items) {
      const rating = parseRating(item);
      if (rating !== null) ratings.push(rating);
      const sentiment = classifySentiment(item, rating);
      sentimentCounts[sentiment]++;
      if (sentiment === "dissatisfied") {
        const category = categoryOf(item);
        if (category) {
          const list = byCategory.get(category) ?? [];
          list.push(item);
          byCategory.set(category, list);
        }
      }
    }

    const pct = (n: number) => Math.round((n / total) * 100);
    const sentimentDistribution = {
      satisfied: pct(sentimentCounts.satisfied),
      neutral: pct(sentimentCounts.neutral),
      dissatisfied: pct(sentimentCounts.dissatisfied),
    };
    // Rounding drift goes to the largest bucket so the shares total 100.
    const drift = 100 - (sentimentDistribution.satisfied + sentimentDistribution.neutral + sentimentDistribution.dissatisfied);
    if (drift !== 0) {
      const largest = (Object.keys(sentimentDistribution) as Sentiment[]).reduce((a, b) =>
        sentimentDistribution[a] >= sentimentDistribution[b] ? a : b,
      );
      sentimentDistribution[largest] += drift;
    }

    const topComplaints: CustomerComplaintTheme[] = [...byCategory.entries()]
      .map(([category, catItems]) => {
        const frequencyPercent = pct(catItems.length);
        // Quotes are the pasted items themselves — then re-verified
        // against the raw input so nothing unverifiable can slip in.
        const quotes = verifyQuotes(
          catItems.slice(0, 2).map((t) => t.slice(0, 240)),
          reviewsText!,
        );
        return {
          category,
          frequencyPercent,
          itemCount: catItems.length,
          complaintSummary: `পেস্ট করা ${total}টি রিভিউর মধ্যে ${catItems.length}টিতে এই বিষয়ে অসন্তোষ পাওয়া গেছে (কীওয়ার্ড-ভিত্তিক শ্রেণিবিভাগ)।`,
          sampleCustomerQuotes: quotes,
          severity: (frequencyPercent >= 30 ? "Critical" : frequencyPercent >= 15 ? "High" : "Medium") as CustomerComplaintTheme["severity"],
        };
      })
      .sort((a, b) => b.itemCount - a.itemCount)
      .slice(0, 4);

    const overallRatingScore = ratings.length
      ? Math.round((ratings.reduce((a, b) => a + b, 0) / ratings.length) * 10) / 10
      : null;

    const biggestVulnerability = topComplaints.length
      ? `${cleanName}-এর পেস্ট করা ${total}টি রিভিউর মধ্যে সবচেয়ে বেশি অসন্তোষ: ${topComplaints[0].category} (${topComplaints[0].itemCount}টি, ${topComplaints[0].frequencyPercent}%)`
      : `পেস্ট করা ${total}টি রিভিউতে স্পষ্ট নেতিবাচক প্যাটার্ন পাওয়া যায়নি`;

    const recommendedCounterAngles = await this.counterAngles(cleanName, topComplaints);

    return {
      available: true,
      competitorName: cleanName,
      totalAnalyzedFeedback: total,
      overallRatingScore,
      sentimentDistribution,
      topComplaints,
      biggestVulnerability,
      recommendedCounterAngles,
    };
  }

  /** Draft counter-positioning angles grounded ONLY in the computed
   *  complaint categories (real LLM when configured, else a clearly
   *  generic template draft). No statistics are ever invented here —
   *  the counts quoted come from the code-side classification above. */
  private async counterAngles(
    competitorName: string,
    topComplaints: CustomerComplaintTheme[],
  ): Promise<ReviewCounterAngle[]> {
    if (topComplaints.length === 0) return [];
    const top = topComplaints[0];

    const template: ReviewCounterAngle[] = [
      {
        hookHeadline: `${top.category} নিয়ে আর ভোগান্তি নয় — অর্ডারের আগে সব শর্ত পরিষ্কার`,
        trustMechanism: `পেস্ট করা রিভিউগুলোতে ${top.category} নিয়ে সবচেয়ে বেশি অসন্তোষ (${top.itemCount}টি) — এই নির্দিষ্ট জায়গায় যাচাইযোগ্য প্রতিশ্রুতি (যেমন অর্ডারের পর লাইভ আপডেট ও শর্ত আগেই ঘোষণা) দিয়ে আস্থা তৈরি করুন। এটি একটি খসড়া পরামর্শ, প্রতিযোগী সম্পর্কে দাবি নয়।`,
        guaranteeOffer: `শর্ত পূরণ না হলে স্পষ্ট, আগে থেকে ঘোষিত সমাধান (রিপ্লেসমেন্ট/রিফান্ড নীতি পেজে প্রকাশিত)`,
        whyBuyersSwitch: `ক্রেতারা ${top.category} নিয়ে হতাশ হলে ঝুঁকি-কমানো প্রতিশ্রুতি দেওয়া ব্র্যান্ডের দিকে যায় — খসড়াটি সেই হতাশার জায়গাতেই কথা বলে।`,
      },
    ];

    try {
      const provider = this.llm.getProvider();
      if (!provider.isRealLlm) return template;
      const prompt = `You are a conversion copywriter. A store owner pasted REAL customer reviews of competitor "${competitorName}" and our code counted these complaint categories (do not invent any other facts, numbers, or quotes):
${topComplaints.map((t) => `- ${t.category}: ${t.itemCount} of the pasted reviews (${t.frequencyPercent}%)`).join("\n")}

Draft 2 counter-positioning ad angles (in Bengali) that address ONLY these counted categories. Return JSON: {"angles":[{"hookHeadline":"...","trustMechanism":"...","guaranteeOffer":"...","whyBuyersSwitch":"..."}]}`;
      const res = await provider.complete(
        [{ role: "system", content: "You are a customer feedback and competitive sentiment analyst. Output JSON only." }, { role: "user", content: prompt }],
        { jsonMode: true },
      );
      const parsed = JSON.parse(res.text.match(/\{[\s\S]*\}/)?.[0] || "{}");
      const angles = Array.isArray(parsed.angles)
        ? parsed.angles.filter(
            (a: any) => a && typeof a.hookHeadline === "string" && typeof a.trustMechanism === "string",
          )
        : [];
      if (angles.length) {
        return angles.slice(0, 2).map((a: any) => ({
          hookHeadline: String(a.hookHeadline),
          trustMechanism: String(a.trustMechanism),
          guaranteeOffer: String(a.guaranteeOffer ?? ""),
          whyBuyersSwitch: String(a.whyBuyersSwitch ?? ""),
        }));
      }
    } catch {
      // fall through to the template draft
    }
    return template;
  }
}
