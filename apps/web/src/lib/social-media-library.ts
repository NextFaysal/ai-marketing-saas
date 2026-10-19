/**
 * SU3 — pure helpers for the Social Posts Media Library v2:
 * aspect options for the image editor, tag parsing/formatting,
 * media-list query building and bulk-result summaries.
 *
 * Kept pure (no React, no fetch) so the behaviour is unit-testable
 * without a component harness — same pattern as
 * social-composer / social-post-filters.
 */
import { fmtNumber, type UiLocale } from "@repo/contracts";
import { tr } from "./i18n/lookup";
import { socialBn, socialEn } from "./i18n/social";

const SOCIAL_DICTS = { bn: socialBn, en: socialEn };
const L = (locale: UiLocale, key: string, params?: Record<string, string | number>) =>
  tr(SOCIAL_DICTS, locale, key, params) ?? key;


/** Bengali digits for a non-negative integer, e.g. 3 → "৩". */
function bnNum(n: number): string {
  return String(n).replace(/\d/g, (d) => "০১২৩৪৫৬৭৮৯"[Number(d)]);
}

export type MediaAspect = "1:1" | "4:5" | "9:16" | "16:9";

export const ASPECT_OPTIONS: { value: MediaAspect; label: string; labelEn: string }[] = [
  { value: "1:1", label: "1:1 (বর্গাকার)", labelEn: "1:1 (square)" },
  { value: "4:5", label: "4:5 (পোর্ট্রেট)", labelEn: "4:5 (portrait)" },
  { value: "9:16", label: "9:16 (উল্লম্ব / Reel)", labelEn: "9:16 (vertical / Reel)" },
  { value: "16:9", label: "16:9 (ওয়াইড)", labelEn: "16:9 (wide)" },
];

export function aspectLabel(value: MediaAspect, locale: UiLocale = "bn"): string {
  const found = ASPECT_OPTIONS.find((o) => o.value === value);
  if (!found) return value;
  return locale === "en" ? found.labelEn : found.label;
}

export const MAX_MEDIA_TAGS = 20;

/**
 * Parse a free-form tag input: split on commas and any whitespace,
 * trim each piece, drop empties, dedupe case-insensitively (the
 * first occurrence's spelling wins) and cap at MAX_MEDIA_TAGS.
 */
export function parseMediaTagsInput(input: string): string[] {
  const seen = new Set<string>();
  const tags: string[] = [];
  for (const piece of (input ?? "").split(/[,\s]+/)) {
    const tag = piece.trim();
    if (!tag) continue;
    const key = tag.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    tags.push(tag);
    if (tags.length >= MAX_MEDIA_TAGS) break;
  }
  return tags;
}

/** Tags back into an editable comma-separated string. */
export function formatMediaTags(tags: string[] | null | undefined): string {
  return (tags ?? []).join(", ");
}

export interface MediaQueryFilters {
  folderId?: string | null;
  tag?: string | null;
  q?: string | null;
}

/**
 * Build the GET media query string (no leading "?") from the
 * active filters — empty/blank values are omitted entirely, so
 * "no filters" returns "".
 */
export function buildMediaQuery(filters: MediaQueryFilters): string {
  const params = new URLSearchParams();
  const folderId = (filters.folderId ?? "").trim();
  if (folderId) params.set("folderId", folderId);
  const tag = (filters.tag ?? "").trim();
  if (tag) params.set("tag", tag);
  const q = (filters.q ?? "").trim();
  if (q) params.set("q", q);
  return params.toString();
}

export interface MediaBulkResult {
  id: string;
  ok: boolean;
  error?: string;
}

/**
 * Bengali summary of a POST media/bulk response, e.g.
 * "৩টি সফল, ১টি ব্যর্থ". A zero side is omitted; an empty
 * result list is stated honestly.
 */
export function summarizeBulkResults(results: MediaBulkResult[] | null | undefined, locale: UiLocale = "bn"): string {
  const list = results ?? [];
  if (list.length === 0) return L(locale, "noResults");
  const ok = list.filter((r) => r.ok).length;
  const failed = list.length - ok;
  const parts: string[] = [];
  if (ok > 0) parts.push(L(locale, "bulkOkPart", { count: fmtNumber(locale, ok) }));
  if (failed > 0) parts.push(L(locale, "bulkFailedPart", { count: fmtNumber(locale, failed) }));
  return parts.join(", ");
}
