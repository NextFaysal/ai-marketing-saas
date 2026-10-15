/**
 * SN5 + SN9 (Social Posts Next, Batch N3) — web-side types +
 * pure helpers for stock media (Pexels, the org's own key),
 * brand overlay, and the weekly performance coach. Fetching
 * stays in page.tsx; this module only shapes data so it can be
 * unit-tested.
 */

// ---------------------------------------------------------------------------
// SN5 — stock config + search (GET/PUT/DELETE media/stock/*).
// ---------------------------------------------------------------------------

/** Key status — the API never returns the key itself, only
 * configured + the last 4 characters. */
export interface StockConfigStatus {
  configured: boolean;
  provider: string;
  status: string | null;
  lastVerifiedAt: string | null;
  keyLast4: string | null;
}

export interface StockSearchItem {
  stockId: string;
  kind: "photo" | "video";
  thumbUrl: string | null;
  width: number | null;
  height: number | null;
  duration: number | null;
  photographer: string;
  pageUrl: string;
  alt: string;
}

export interface StockSearchResult {
  kind: "photo" | "video";
  page: number;
  totalResults: number;
  items: StockSearchItem[];
}

/** Video duration as m:ss (Bengali digits), or null. */
export function formatStockDuration(seconds: number | null | undefined): string | null {
  if (seconds === null || seconds === undefined || !Number.isFinite(seconds) || seconds < 0) return null;
  const total = Math.round(seconds);
  const text = `${Math.floor(total / 60)}:${String(total % 60).padStart(2, "0")}`;
  return text.replace(/\d/g, (d) => "০১২৩৪৫৬৭৮৯"[Number(d)]);
}

// ---------------------------------------------------------------------------
// SN5 — brand overlay positions (POST media/:id/brand-overlay).
// ---------------------------------------------------------------------------

export const OVERLAY_POSITIONS: { value: "bottom" | "top" | "corner"; label: string }[] = [
  { value: "bottom", label: "নিচে brand bar" },
  { value: "top", label: "উপরে brand bar" },
  { value: "corner", label: "কোণায় শুধু logo" },
];

// ---------------------------------------------------------------------------
// SN9 — performance coach (GET insights/coach).
// ---------------------------------------------------------------------------

export interface CoachWindowStat {
  posts: number;
  scoredPosts: number;
  engagement: number;
}

export interface CoachData {
  current: CoachWindowStat;
  previous: CoachWindowStat;
  engagementDeltaPct: number | null;
  topPosts: { id: string; captionExcerpt: string; engagement: number; publishedAt: string; socialAccountId: string }[];
  hashtagMovers: { tag: string; currentAvg: number; previousAvg: number | null; posts: number }[];
  bestContentType: { kind: string; avgEngagement: number; posts: number } | null;
  bestTime: { dayOfWeek: number; hour: number; avgEngagement: number; posts: number } | null;
  dataSufficient: boolean;
}

export interface CoachDigest {
  id: string;
  weekStart: string;
  narrationSource: "llm" | "deterministic" | string;
  summary: string;
  data: CoachData | null;
  createdAt: string | null;
}

export interface CoachResponse {
  latest: CoachDigest | null;
  preview: { data: CoachData; summary: string };
}

/**
 * Honest source label for a coach summary: an LLM narration is
 * named as such; the deterministic text is a summary built from
 * the numbers — never dressed up as AI.
 */
export function coachSourceLabel(source: string | null | undefined): string {
  return source === "llm" ? "AI সারসংক্ষেপ (org-এর নিজের LLM দিয়ে)" : "স্বয়ংক্রিয় সারসংক্ষেপ (শুধু সংখ্যা থেকে তৈরি)";
}
