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

import type { SocialPost } from "./social-post-filters";

export interface SocialPostInsights {
  platform: "meta_page" | "instagram";
  reactions?: number;
  comments?: number;
  shares?: number;
  likeCount?: number;
  commentsCount?: number;
  impressions?: number;
  reach?: number;
  saved?: number;
  plays?: number;
}

export type SocialApprovalStatus = "pending" | "approved" | "rejected";

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
const METRIC_DEFS: { key: string; chipLabel: string; totalLabel: string }[] = [
  { key: "reactions", chipLabel: "👍 রিঅ্যাকশন", totalLabel: "মোট রিঅ্যাকশন" },
  { key: "likeCount", chipLabel: "👍 পছন্দ", totalLabel: "মোট পছন্দ" },
  { key: "comments", chipLabel: "💬 মন্তব্য", totalLabel: "মোট মন্তব্য" },
  { key: "commentsCount", chipLabel: "💬 মন্তব্য", totalLabel: "মোট মন্তব্য" },
  { key: "shares", chipLabel: "↗️ শেয়ার", totalLabel: "মোট শেয়ার" },
  { key: "impressions", chipLabel: "👁️ মোট দেখা", totalLabel: "মোট দেখা" },
  { key: "reach", chipLabel: "পৌঁছেছে", totalLabel: "মোট পৌঁছেছে" },
  { key: "saved", chipLabel: "সেভ", totalLabel: "মোট সেভ" },
  { key: "plays", chipLabel: "প্লে", totalLabel: "মোট প্লে" },
];

/**
 * Chips for ONE post's insights: only the metrics that are actually
 * present (a real number, including a real 0), in display order.
 * Absent keys are skipped — never rendered as 0.
 */
export function insightChips(insights: SocialPostInsights | null | undefined): InsightChip[] {
  if (!insights) return [];
  const record = insights as unknown as Record<string, unknown>;
  const chips: InsightChip[] = [];
  for (const def of METRIC_DEFS) {
    const value = record[def.key];
    if (typeof value === "number" && Number.isFinite(value)) {
      chips.push({ key: def.key, label: def.chipLabel, value });
    }
  }
  return chips;
}

export function hasInsights(insights: SocialPostInsights | null | undefined): boolean {
  return insightChips(insights).length > 0;
}

/**
 * Rows for the performance strip: known metrics in display order,
 * then any unknown keys the API sent (labelled by their raw key so
 * nothing is silently dropped).
 */
export function summaryMetricRows(totals: Record<string, { total: number; posts: number }> | null | undefined): SummaryMetricRow[] {
  if (!totals) return [];
  const rows: SummaryMetricRow[] = [];
  const seen = new Set<string>();
  for (const def of METRIC_DEFS) {
    const entry = totals[def.key];
    if (entry && typeof entry.total === "number") {
      rows.push({ key: def.key, label: def.totalLabel, total: entry.total, posts: entry.posts });
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

export function weekdayNameBn(weekday: number): string {
  return WEEKDAY_NAMES_BN[weekday] ?? "";
}

/** 0–23 hour → Bengali day-part + 12-hour label, e.g. 20 → "রাত ৮টা", 0 → "রাত ১২টা". */
export function formatHourBn(hour: number): string {
  const h = ((hour % 24) + 24) % 24;
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
