/**
 * SU11 — pure helpers for the Social Posts tabbed workspace:
 * cursor-pagination query/merge, bulk-action summaries, CSV
 * import result formatting, and SU10 account-health labels.
 *
 * Kept pure (no React, no fetch) so the behaviour is
 * unit-testable without a component harness — same pattern as
 * social-post-filters / social-media-library.
 */

import { fmtNumber, type UiLocale } from "@repo/contracts";
import { tr } from "./i18n/lookup";
import { socialBn, socialEn } from "./i18n/social";

const SOCIAL_DICTS = { bn: socialBn, en: socialEn };
const L = (locale: UiLocale, key: string, params?: Record<string, string | number>) =>
  tr(SOCIAL_DICTS, locale, key, params) ?? key;


/** One page of the cursor-paginated post list (SU11 API). */
export interface SocialPostPage<T> {
  items: T[];
  nextCursor: string | null;
}

/** Build the GET posts query string for cursor mode. Empty
 * filters are omitted entirely (the API treats an absent filter
 * as "no filter"); the cursor is omitted on the first page. */
export function buildPostsPageQuery(input: {
  cursor?: string | null;
  limit?: number;
  status?: string;
  accountId?: string;
}): string {
  const params = new URLSearchParams();
  params.set("limit", String(input.limit ?? 50));
  if (input.cursor) params.set("cursor", input.cursor);
  if (input.status) params.set("status", input.status);
  if (input.accountId) params.set("accountId", input.accountId);
  return params.toString();
}

/** Append a freshly loaded page to the loaded posts, dropping
 * any id that is already present (a post edited between pages
 * must never render twice). Order is preserved: existing rows
 * first, then the page's new rows in page order. */
export function mergePostPage<T extends { id: string }>(existing: T[], pageItems: T[]): T[] {
  const seen = new Set(existing.map((p) => p.id));
  return [...existing, ...pageItems.filter((p) => !seen.has(p.id))];
}

export interface BulkPostResult {
  id: string;
  ok: boolean;
  error?: string;
}

export interface BulkPostsResponse {
  results: BulkPostResult[];
  succeeded: number;
  failed: number;
}

/** The notice line for a bulk run: counts first (Bengali digits),
 * then up to two verbatim per-item errors so the user sees WHY
 * the failures failed without opening anything else. */
export function summarizeBulkPostResults(res: BulkPostsResponse, actionLabel: string, locale: UiLocale = "bn"): string {
  let text = L(locale, "bulkResult", { action: actionLabel, ok: fmtNumber(locale, res.succeeded), failed: fmtNumber(locale, res.failed) });
  const errors = res.results.filter((r) => !r.ok && r.error).slice(0, 2);
  if (errors.length > 0) {
    text += L(locale, "bulkFailReasons", { errors: errors.map((r) => r.error).join(" · ") });
    if (res.failed > errors.length) text += L(locale, "bulkMore");
  }
  return text;
}

export interface CsvImportRowResult {
  row: number;
  ok: boolean;
  id?: string;
  error?: string;
}

export interface CsvImportResponse {
  results: CsvImportRowResult[];
  created: number;
  failed: number;
}

/** The notice line for a CSV import run (counts, Bengali digits). */
export function summarizeCsvImport(res: CsvImportResponse, locale: UiLocale = "bn"): string {
  return L(locale, "csvImportResult", { created: fmtNumber(locale, res.created), failed: fmtNumber(locale, res.failed) });
}

/** SU10 account-health label pill (GET accounts/health values). */
export function healthPill(health: string | null | undefined, locale: UiLocale = "bn"): { label: string; cls: string } {
  switch (health) {
    case "ok":
      return { label: L(locale, "healthOk"), cls: "bg-green-100 text-green-700" };
    case "error":
      return { label: L(locale, "healthProblem"), cls: "bg-red-100 text-red-700" };
    case "never_checked":
      return { label: L(locale, "healthNever"), cls: "bg-slate-200 text-slate-600" };
    default:
      return { label: L(locale, "healthUnknown"), cls: "bg-slate-100 text-slate-500" };
  }
}

/** SU9: the approval badge label for the two-step intermediate
 * state. The other states keep their SP7 labels in shared.tsx;
 * this helper exists so the wording is unit-pinned. */
export function managerApprovedLabel(locale: UiLocale = "bn"): string {
  return L(locale, "apprManagerApproved");
}
