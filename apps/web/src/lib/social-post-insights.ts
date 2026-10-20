/**
 * SP7 — pure helpers for Post Insights + the Approval Flow on the
 * Social Posts page.
 *
 * The insight numbers come straight from the platform (Meta Page /
 * Instagram). A metric key is ABSENT when the platform did not
 * return it — it is never 0-filled, and the UI must show "এখনো data
 * আসেনি" instead of invented zeros. A key that IS present with the
 * value 0 is real data and is shown as 0.
 *
 * Kept pure (no React, no fetch) so the behaviour is unit-testable
 * without a component harness — same pattern as social-post-filters.
 */
import type { UiLocale } from "@repo/contracts";


import type { SocialPost } from "./social-post-filters";
import type { AutoDraftKind } from "./social-posts-su5";

export interface SocialPostInsights {
  platform: "meta_page" | "instagram" | "threads";
  reactions?: number;
  comments?: number;
  shares?: number;
  likeCount?: number;
  commentsCount?: number;
  impressions?: number;
  reach?: number;
  saved?: number;
  plays?: number;
  // SN7: Threads-native metrics (absent when Threads omits them).
  views?: number;
  likes?: number;
  replies?: number;
  reposts?: number;
  quotes?: number;
}

export type SocialApprovalStatus = "pending" | "approved" | "rejected" | "manager_approved";

/** SocialPost extended with the SP7 fields every post response now carries. */
export interface Sp7SocialPost extends SocialPost {
  insights: SocialPostInsights | null;
  insightsFetchedAt: string | null;
  approvalStatus: SocialApprovalStatus | null;
  submittedById: string | null;
  reviewedById: string | null;
  reviewNote: string | null;
  /** SP8/SP9: honest platform-state note recorded with a
   * successful hand-off (TikTok inbox mode / YouTube private
   * lock). Null for plain Meta publishes. */
  publishNote: string | null;
  /** SU1: post-group id when this post was saved as one variant of
   * a multi-account group; null for a standalone post. */
  postGroupId: string | null;
  /** SU1: first comment to post right after a successful publish
   * (Meta Page / Instagram only). */
  firstCommentText: string | null;
  firstCommentStatus: "pending" | "posted" | "failed" | null;
  firstCommentError: string | null;
  /** SU2: recurring-series id + cadence, and the evergreen flags. */
  seriesId: string | null;
  recurrenceFrequency: "daily" | "weekly" | "monthly" | null;
  recurrenceInterval: number | null;
  isEvergreen: boolean;
  evergreenMinGapDays: number | null;
  evergreenMaxCycles: number | null;
  evergreenCyclesUsed: number;
  /** SU5: which commerce event created this draft, or null for a
   * human-written post. */
  autoDraftKind: AutoDraftKind | null;
  /** SU6: whether a tracked short-link token exists (minted at
   * schedule/publish time). The token itself is never serialized
   * by the API — the UI only needs this boolean. */
  hasTrackedLink: boolean;
  /** SU8 (Batch 4): optional platform-publishing fields — YouTube
   * title/tags/category/Shorts, a cover image asset, and the
   * Facebook Story flag. All optional/null when never set. */
  youtubeTitle?: string | null;
  youtubeTags?: string[] | null;
  youtubeCategoryId?: string | null;
  youtubeIsShort?: boolean;
  /** SN1: chosen YouTube playlist id (null = no playlist). */
  youtubePlaylistId?: string | null;
  coverAssetId?: string | null;
  isStory?: boolean;
  /** SU9: the team member this post is assigned to (null =
   * unassigned); members are picked from GET /organizations/:id/members. */
  assignedUserId?: string | null;
  /** SN10: caption-test pair id — two drafts sharing one id are
   * a caption test pair; null/absent = not in a test. */
  captionTestId?: string | null;
}

/** SN10 — one post inside a caption-test pair, as GET
 * insights/caption-tests returns it. engagement is null when the
 * platform returned no engagement fields; metricsPresent lists
 * ONLY the metric keys actually present (never invented). */
export interface CaptionTestPost {
  id: string;
  caption: string;
  status: string;
  scheduledAt: string | null;
  publishedAt: string | null;
  platformUrl: string | null;
  platform: string | null;
  accountName: string | null;
  engagement: number | null;
  metricsPresent: string[];
  insightsFetchedAt: string | null;
  linkClicks: number;
}

/** SN10 — one caption test (a pair of posts). There is NO winner
 * field by design; closeCall is null when it cannot be decided
 * yet (not both published, or a post has no engagement score). */
export interface CaptionTestGroup {
  captionTestId: string;
  posts: CaptionTestPost[];
  bothPublished: boolean;
  closeCall: boolean | null;
}

export interface CaptionTestsResponse {
  tests: CaptionTestGroup[];
}

export interface SocialInsightsSummary {
  postsWithInsights: number;
  totals: Record<string, { total: number; posts: number }>;
  bestTime: { weekday: number; hour: number; score: number; postsConsidered: number } | null;
}

export interface InsightChip {
  key: string;
  label: string;
  value: number;
}

export interface SummaryMetricRow {
  key: string;
  label: string;
  total: number;
  posts: number;
}

/** Display order + Bengali labels for every known insight metric. */
const METRIC_DEFS: { key: string; chipLabel: string; totalLabel: string; chipLabelEn: string; totalLabelEn: string }[] = [
  { key: "reactions", chipLabel: "👍 রিঅ্যাকশন", totalLabel: "মোট রিঅ্যাকশন", chipLabelEn: "👍 Reactions", totalLabelEn: "Total reactions" },
  { key: "likeCount", chipLabel: "👍 পছন্দ", totalLabel: "মোট পছন্দ", chipLabelEn: "👍 Likes", totalLabelEn: "Total likes" },
  { key: "comments", chipLabel: "💬 মন্তব্য", totalLabel: "মোট মন্তব্য", chipLabelEn: "💬 Comments", totalLabelEn: "Total comments" },
  { key: "commentsCount", chipLabel: "💬 মন্তব্য", totalLabel: "মোট মন্তব্য", chipLabelEn: "💬 Comments", totalLabelEn: "Total comments" },
  { key: "shares", chipLabel: "↗️ শেয়ার", totalLabel: "মোট শেয়ার", chipLabelEn: "↗️ Shares", totalLabelEn: "Total shares" },
  { key: "impressions", chipLabel: "👁️ মোট দেখা", totalLabel: "মোট দেখা", chipLabelEn: "👁️ Total views", totalLabelEn: "Total views" },
  { key: "reach", chipLabel: "পৌঁছেছে", totalLabel: "মোট পৌঁছেছে", chipLabelEn: "Reached", totalLabelEn: "Total reached" },
  { key: "saved", chipLabel: "সেভ", totalLabel: "মোট সেভ", chipLabelEn: "Saved", totalLabelEn: "Total saved" },
  { key: "plays", chipLabel: "প্লে", totalLabel: "মোট প্লে", chipLabelEn: "Plays", totalLabelEn: "Total plays" },
  // SN7: Threads-native metrics (shares above is shared).
  { key: "views", chipLabel: "👁️ ভিউ", totalLabel: "মোট ভিউ", chipLabelEn: "👁️ Views", totalLabelEn: "Total views" },
  { key: "likes", chipLabel: "❤️ লাইক", totalLabel: "মোট লাইক", chipLabelEn: "❤️ Likes", totalLabelEn: "Total likes" },
  { key: "replies", chipLabel: "💬 রিপ্লাই", totalLabel: "মোট রিপ্লাই", chipLabelEn: "💬 Replies", totalLabelEn: "Total replies" },
  { key: "reposts", chipLabel: "🔁 রিপোস্ট", totalLabel: "মোট রিপোস্ট", chipLabelEn: "🔁 Reposts", totalLabelEn: "Total reposts" },
  { key: "quotes", chipLabel: "❝ কোট", totalLabel: "মোট কোট", chipLabelEn: "❝ Quotes", totalLabelEn: "Total quotes" },
];

/**
 * Chips for ONE post's insights: only the metrics that are actually
 * present (a real number, including a real 0), in display order.
 * Absent keys are skipped — never rendered as 0.
 */
export function insightChips(insights: SocialPostInsights | null | undefined, locale: UiLocale = "bn"): InsightChip[] {
  if (!insights) return [];
  const record = insights as unknown as Record<string, unknown>;
  const chips: InsightChip[] = [];
  for (const def of METRIC_DEFS) {
    const value = record[def.key];
    if (typeof value === "number" && Number.isFinite(value)) {
      chips.push({ key: def.key, label: locale === "en" ? def.chipLabelEn : def.chipLabel, value });
    }
  }
  return chips;
}

export function hasInsights(insights: SocialPostInsights | null | undefined): boolean {
  return insightChips(insights).length > 0;
}

/** SN10: the display label for one metric key (the chip label the
 * rest of the page uses); unknown keys show as their raw key. */
export function insightMetricLabel(key: string, locale: UiLocale = "bn"): string {
  const def = METRIC_DEFS.find((d) => d.key === key);
  if (!def) return key;
  return locale === "en" ? def.chipLabelEn : def.chipLabel;
}

/**
 * Rows for the performance strip: known metrics in display order,
 * then any unknown keys the API sent (labelled by their raw key so
 * nothing is silently dropped).
 */
export function summaryMetricRows(totals: Record<string, { total: number; posts: number }> | null | undefined, locale: UiLocale = "bn"): SummaryMetricRow[] {
  if (!totals) return [];
  const rows: SummaryMetricRow[] = [];
  const seen = new Set<string>();
  for (const def of METRIC_DEFS) {
    const entry = totals[def.key];
    if (entry && typeof entry.total === "number") {
      rows.push({ key: def.key, label: locale === "en" ? def.totalLabelEn : def.totalLabel, total: entry.total, posts: entry.posts });
      seen.add(def.key);
    }
  }
  for (const [key, entry] of Object.entries(totals)) {
    if (!seen.has(key) && entry && typeof entry.total === "number") {
      rows.push({ key, label: key, total: entry.total, posts: entry.posts });
    }
  }
  return rows;
}

/** Bengali weekday names, index 0 = Sunday … 6 = Saturday (matches the API's bestTime.weekday). */
export const WEEKDAY_NAMES_BN = ["রবিবার", "সোমবার", "মঙ্গলবার", "বুধবার", "বৃহস্পতিবার", "শুক্রবার", "শনিবার"] as const;

export function weekdayNameBn(weekday: number, locale: UiLocale = "bn"): string {
  if (locale === "en") {
    if (weekday < 0 || weekday > 6) return "";
    // 2024-01-07 was a Sunday.
    return new Intl.DateTimeFormat("en-IN", { weekday: "long" }).format(new Date(2024, 0, 7 + weekday));
  }
  return WEEKDAY_NAMES_BN[weekday] ?? "";
}

/** 0–23 hour → Bengali day-part + 12-hour label, e.g. 20 → "রাত ৮টা", 0 → "রাত ১২টা". */
export function formatHourBn(hour: number, locale: UiLocale = "bn"): string {
  const h = ((hour % 24) + 24) % 24;
  if (locale === "en") {
    return new Intl.DateTimeFormat("en-IN", { hour: "numeric", hour12: true }).format(new Date(2024, 0, 1, h));
  }
  const period = h < 4 ? "রাত" : h < 6 ? "ভোর" : h < 12 ? "সকাল" : h < 15 ? "দুপুর" : h < 18 ? "বিকেল" : h < 20 ? "সন্ধ্যা" : "রাত";
  const h12 = h % 12 === 0 ? 12 : h % 12;
  return `${period} ${h12.toLocaleString("bn-BD")}টা`;
}

/**
 * The "অনুমোদনের জন্য পাঠান" button shows only for draft posts while
 * the approval setting is ON and the post is not already approved /
 * waiting (a rejected post may be submitted again).
 */
export function canSubmitForApproval(
  post: { status: string; approvalStatus?: SocialApprovalStatus | null },
  requireApproval: boolean,
): boolean {
  if (!requireApproval) return false;
  if (post.status !== "draft") return false;
  return post.approvalStatus == null || post.approvalStatus === "rejected";
}
