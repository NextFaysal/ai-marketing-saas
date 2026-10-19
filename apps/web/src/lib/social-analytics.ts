/**
 * SU Batch 4 (SU7/SU8) — pure helpers for Social Analytics v2 on
 * the Social Posts page: the engagement timeseries chart, the
 * content-type comparison, per-account comparison and follower
 * growth, plus the monthly-report month helpers.
 *
 * The numbers come straight from the API, which aggregates ONLY
 * the posts whose platform insights actually arrived. A content
 * type with no insight data carries engagementTotal /
 * engagementAvg = null (never an invented 0) and the UI renders
 * "—" for it. Follower growth is computed only from real daily
 * snapshots — fewer than two snapshots means no growth figure at
 * all, never an estimate.
 *
 * Kept pure (no React, no fetch) so the behaviour is unit-testable
 * without a component harness — same pattern as
 * social-post-insights / social-composer.
 */
import { intlLocaleOf, normalizeUiLocale, type UiLocale } from "@repo/contracts";
import { socialBn, socialEn } from "./i18n/social";


// ---------------------------------------------------------------------------
// API contract types (GET /organizations/:orgId/social/insights/*)
// ---------------------------------------------------------------------------

export interface MetricTotal {
  total: number;
  posts: number;
}

export interface SocialTimeseriesDay {
  day: string; // "YYYY-MM-DD"
  metrics: Record<string, MetricTotal>;
  engagement: MetricTotal;
}

export interface SocialTimeseries {
  days: number;
  timeZone: string;
  series: SocialTimeseriesDay[];
}

export type SocialContentType = "text" | "photo" | "carousel" | "video";

export interface SocialContentTypeRow {
  type: SocialContentType | string;
  posts: number;
  withInsights: number;
  engagementTotal: number | null;
  engagementAvg: number | null;
}

export interface SocialContentTypes {
  types: SocialContentTypeRow[];
}

export interface SocialAccountInsightRow {
  accountId: string;
  platform: string;
  name: string;
  postsWithInsights: number;
  totals: Record<string, MetricTotal>;
  engagement: MetricTotal;
}

export interface SocialAccountsInsights {
  accounts: SocialAccountInsightRow[];
}

export interface FollowerSnapshot {
  day: string; // "YYYY-MM-DD"
  followers: number;
}

export interface SocialFollowerAccount {
  accountId: string;
  platform: string;
  name: string;
  snapshots: FollowerSnapshot[];
}

export interface SocialFollowers {
  accounts: SocialFollowerAccount[];
}

// ---------------------------------------------------------------------------
// Number / date formatting (existing bn-BD locale style)
// ---------------------------------------------------------------------------

/** Bengali digits for an integer-ish value, e.g. 30 → "৩০". */
export function bnDigits(value: number | string): string {
  return String(value).replace(/\d/g, (d) => "০১২৩৪৫৬৭৮৯"[Number(d)]);
}

/** Locale number formatting (bn-BD style by default), e.g. 1234 → "১,২৩৪". */
export function formatBnNumber(value: number, maximumFractionDigits = 0, locale: UiLocale = "bn"): string {
  return new Intl.NumberFormat(intlLocaleOf(normalizeUiLocale(locale)), { maximumFractionDigits }).format(value);
}

const MONTH_NAMES_BN = [
  socialBn.zzSocAnMonth01, socialBn.zzSocAnMonth02, socialBn.zzSocAnMonth03, socialBn.zzSocAnMonth04,
  socialBn.zzSocAnMonth05, socialBn.zzSocAnMonth06, socialBn.zzSocAnMonth07, socialBn.zzSocAnMonth08,
  socialBn.zzSocAnMonth09, socialBn.zzSocAnMonth10, socialBn.zzSocAnMonth11, socialBn.zzSocAnMonth12,
] as const;

function parseDay(day: string): { y: number; m: number; d: number } | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(day ?? "");
  if (!match) return null;
  const y = Number(match[1]);
  const m = Number(match[2]);
  const d = Number(match[3]);
  if (m < 1 || m > 12 || d < 1 || d > 31) return null;
  return { y, m, d };
}

/** Short label for a "YYYY-MM-DD" day, e.g. "১৩ অক্টোবর" / "13 October". Falls back to the raw day. */
export function dayLabelBn(day: string, locale: UiLocale = "bn"): string {
  const parsed = parseDay(day);
  if (!parsed) return day;
  if (locale === "en") {
    return new Intl.DateTimeFormat("en-IN", { day: "numeric", month: "long" }).format(new Date(parsed.y, parsed.m - 1, parsed.d));
  }
  return `${bnDigits(parsed.d)} ${MONTH_NAMES_BN[parsed.m - 1]}`;
}

// ---------------------------------------------------------------------------
// Timeseries bars
// ---------------------------------------------------------------------------

export interface TimeseriesBar {
  day: string;
  engagementTotal: number;
  /** কয়টা post-এর engagement data এই দিনে এসেছে (basis). */
  posts: number;
  /** সর্বোচ্চ দিনের তুলনায় 0–100; সব দিনে engagement 0 হলে 0. */
  heightPct: number;
  label: string;
}

export function timeseriesBars(series: SocialTimeseriesDay[] | null | undefined, locale: UiLocale = "bn"): TimeseriesBar[] {
  if (!Array.isArray(series)) return [];
  const totals = series.map((entry) => {
    const total = entry?.engagement?.total;
    return typeof total === "number" && Number.isFinite(total) ? total : 0;
  });
  const max = totals.length > 0 ? Math.max(...totals) : 0;
  return series.map((entry, i) => {
    const engagementTotal = totals[i] ?? 0;
    const postsRaw = entry?.engagement?.posts;
    return {
      day: entry.day,
      engagementTotal,
      posts: typeof postsRaw === "number" && Number.isFinite(postsRaw) ? postsRaw : 0,
      heightPct: max > 0 ? (engagementTotal / max) * 100 : 0,
      label: dayLabelBn(entry.day, locale),
    };
  });
}

// ---------------------------------------------------------------------------
// Content types
// ---------------------------------------------------------------------------

const CONTENT_TYPE_LABELS: Record<string, string> = {
  text: socialBn.zzSocAnTypeText,
  photo: socialBn.zzSocAnTypePhoto,
  carousel: socialBn.zzSocAnTypeCarousel,
  video: socialBn.zzSocAnTypeVideo,
};

const CONTENT_TYPE_LABELS_EN: Record<string, string> = {
  text: socialEn.zzSocAnTypeText,
  photo: socialEn.zzSocAnTypePhoto,
  carousel: socialEn.zzSocAnTypeCarousel,
  video: socialEn.zzSocAnTypeVideo,
};

/** Label for a content type; an unknown type falls back to its raw value. */
export function contentTypeLabel(type: string, locale: UiLocale = "bn"): string {
  return (locale === "en" ? CONTENT_TYPE_LABELS_EN[type] : CONTENT_TYPE_LABELS[type]) ?? type;
}

// ---------------------------------------------------------------------------
// Follower growth
// ---------------------------------------------------------------------------

export interface FollowerGrowth {
  first: number;
  last: number;
  delta: number;
  /** প্রথম ও সর্বশেষ snapshot-এর মধ্যে দিনের ব্যবধান. */
  days: number;
}

/**
 * Growth between the first and last snapshot (chronological by
 * day). Fewer than two usable snapshots → null: with one snapshot
 * there is no "growth" to report, and inventing one would be a lie.
 */
export function followerGrowth(snapshots: FollowerSnapshot[] | null | undefined): FollowerGrowth | null {
  if (!Array.isArray(snapshots)) return null;
  const usable = snapshots
    .filter((s) => s && typeof s.followers === "number" && Number.isFinite(s.followers))
    .slice()
    .sort((a, b) => String(a.day).localeCompare(String(b.day)));
  if (usable.length < 2) return null;
  const firstSnap = usable[0];
  const lastSnap = usable[usable.length - 1];
  const firstParsed = parseDay(firstSnap.day);
  const lastParsed = parseDay(lastSnap.day);
  let days = usable.length - 1;
  if (firstParsed && lastParsed) {
    const ms = Date.UTC(lastParsed.y, lastParsed.m - 1, lastParsed.d) - Date.UTC(firstParsed.y, firstParsed.m - 1, firstParsed.d);
    days = Math.max(0, Math.round(ms / 86_400_000));
  }
  return {
    first: firstSnap.followers,
    last: lastSnap.followers,
    delta: lastSnap.followers - firstSnap.followers,
    days,
  };
}

// ---------------------------------------------------------------------------
// Monthly report helpers
// ---------------------------------------------------------------------------

/** "YYYY-MM" for a Date (local calendar month — matches the page's existing plan-month code). */
export function currentMonthValue(date: Date): string {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}`;
}

/** "YYYY-MM" → month name + year, e.g. "2026-10" → "অক্টোবর ২০২৬" / "October 2026". Invalid input is returned as-is. */
export function monthLabelBn(month: string, locale: UiLocale = "bn"): string {
  const match = /^(\d{4})-(\d{2})$/.exec(month ?? "");
  if (!match) return month;
  const m = Number(match[2]);
  if (m < 1 || m > 12) return month;
  if (locale === "en") {
    return new Intl.DateTimeFormat("en-IN", { month: "long", year: "numeric" }).format(new Date(Number(match[1]), m - 1, 1));
  }
  return `${MONTH_NAMES_BN[m - 1]} ${bnDigits(match[1])}`;
}

// ---------------------------------------------------------------------------
// YouTube / Story platform fields (SU8)
// ---------------------------------------------------------------------------

/** Comma-separated tags input → a clean tag list (trimmed, leading "#" dropped, deduped). */
export function parseYoutubeTagsInput(input: string): string[] {
  const seen = new Set<string>();
  const tags: string[] = [];
  for (const raw of (input ?? "").split(",")) {
    const tag = raw.trim().replace(/^#+/, "").trim();
    if (!tag || seen.has(tag)) continue;
    seen.add(tag);
    tags.push(tag);
  }
  return tags;
}

/** Tag list → the comma-separated input value. */
export function youtubeTagsToInput(tags: string[] | null | undefined): string {
  return Array.isArray(tags) ? tags.join(", ") : "";
}

export interface PlatformFieldsForm {
  youtubeTitle: string;
  youtubeTags: string[];
  youtubeCategoryId: string;
  youtubeIsShort: boolean;
  /** SN1: chosen YouTube playlist id ("" = none). */
  youtubePlaylistId?: string;
  coverAssetId: string;
  isStory: boolean;
  /** Story শুধু meta_page-এর জন্য প্রযোজ্য — অন্য platform-এ isStory পাঠানো হয় না. */
  isStoryApplicable: boolean;
}

export interface PlatformFieldsPayload {
  youtubeTitle?: string | null;
  youtubeTags?: string[] | null;
  youtubeCategoryId?: string | null;
  youtubeIsShort?: boolean;
  youtubePlaylistId?: string | null;
  coverAssetId?: string | null;
  isStory?: boolean;
}

/**
 * Build the create/update body fragment for the optional platform
 * fields. Create: empty fields are omitted entirely. Update: empty
 * fields are sent as null / [] / false so an edit can actually
 * clear a previously saved value (the same null-clearing pattern
 * the composer already uses for firstCommentText).
 */
export function platformFieldsForSave(form: PlatformFieldsForm, mode: "create" | "update"): PlatformFieldsPayload {
  const title = (form.youtubeTitle ?? "").trim();
  const categoryId = (form.youtubeCategoryId ?? "").trim();
  const coverAssetId = (form.coverAssetId ?? "").trim();
  const playlistId = (form.youtubePlaylistId ?? "").trim();
  const tags = Array.isArray(form.youtubeTags) ? form.youtubeTags : [];
  if (mode === "create") {
    const payload: PlatformFieldsPayload = {};
    if (title) payload.youtubeTitle = title;
    if (tags.length > 0) payload.youtubeTags = tags;
    if (categoryId) payload.youtubeCategoryId = categoryId;
    if (form.youtubeIsShort) payload.youtubeIsShort = true;
    if (playlistId) payload.youtubePlaylistId = playlistId;
    if (coverAssetId) payload.coverAssetId = coverAssetId;
    if (form.isStoryApplicable && form.isStory) payload.isStory = true;
    return payload;
  }
  const payload: PlatformFieldsPayload = {
    youtubeTitle: title || null,
    youtubeTags: tags,
    youtubeCategoryId: categoryId || null,
    youtubeIsShort: !!form.youtubeIsShort,
    youtubePlaylistId: playlistId || null,
    coverAssetId: coverAssetId || null,
  };
  if (form.isStoryApplicable) payload.isStory = !!form.isStory;
  return payload;
}
