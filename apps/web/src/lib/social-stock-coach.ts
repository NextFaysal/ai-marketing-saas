/**
 * SN5 + SN9 (Social Posts Next, Batch N3) — web-side types +
 * pure helpers for stock media (Pexels, the org's own key),
 * brand overlay, and the weekly performance coach. Fetching
 * stays in page.tsx; this module only shapes data so it can be
 * unit-tested.
 */
import { fmtNumber, type UiLocale } from "@repo/contracts";
import { tr } from "./i18n/lookup";
import { socialBn, socialEn } from "./i18n/social";

const SOCIAL_DICTS = { bn: socialBn, en: socialEn };
const L = (locale: UiLocale, key: string, params?: Record<string, string | number>) =>
  tr(SOCIAL_DICTS, locale, key, params) ?? key;


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

/** Video duration as m:ss (locale digits), or null. */
export function formatStockDuration(seconds: number | null | undefined, locale: UiLocale = "bn"): string | null {
  if (seconds === null || seconds === undefined || !Number.isFinite(seconds) || seconds < 0) return null;
  const total = Math.round(seconds);
  const text = `${Math.floor(total / 60)}:${String(total % 60).padStart(2, "0")}`;
  return text.replace(/\d/g, (d) => (locale === "en" ? d : "০১২৩৪৫৬৭৮৯"[Number(d)]));
}

// ---------------------------------------------------------------------------
// SN5 — brand overlay positions (POST media/:id/brand-overlay).
// ---------------------------------------------------------------------------

export const OVERLAY_POSITIONS: { value: "bottom" | "top" | "corner"; label: string; labelEn: string }[] = [
  { value: "bottom", label: "নিচে brand bar", labelEn: "Brand bar at bottom" },
  { value: "top", label: "উপরে brand bar", labelEn: "Brand bar at top" },
  { value: "corner", label: "কোণায় শুধু logo", labelEn: "Logo only in corner" },
];

export function overlayPositionLabel(value: string, locale: UiLocale = "bn"): string {
  const found = OVERLAY_POSITIONS.find((o) => o.value === value);
  if (!found) return value;
  return locale === "en" ? found.labelEn : found.label;
}

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
export function coachSourceLabel(source: string | null | undefined, locale: UiLocale = "bn"): string {
  return source === "llm" ? L(locale, "coachLlm") : L(locale, "coachAuto");
}
