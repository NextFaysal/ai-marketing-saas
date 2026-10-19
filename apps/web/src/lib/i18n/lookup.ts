/**
 * ML-L2 / ML-L6 (Multi-Language MB1) — dotted-key lookup with
 * whole-string bn fallback and a missing-key log.
 *
 * Pure and dependency-free (like ./dict) so it can be unit
 * tested without a built @repo/contracts dist or React.
 *
 * `lookup(dicts, locale, "common.save")` resolves the path in
 * the active locale's dictionary. When the resolved value is
 * missing or empty AND the (normalized) locale is not bn, it
 * logs `[i18n] missing key: <path> (<locale>)` ONCE per
 * key+locale (module-level Set) and returns the bn value —
 * a whole string falls back, never half a sentence (ML-L2),
 * and the gap is never silently hidden (ML-L6).
 */

import type { Dict, UiLocale } from "./dict";
import { localeOf } from "./dict";

export type DictsLike = Record<string, unknown>;

const warned = new Set<string>();

function resolvePath(root: unknown, path: string): unknown {
  let cur: unknown = root;
  for (const part of path.split(".")) {
    if (!cur || typeof cur !== "object") return undefined;
    cur = (cur as Record<string, unknown>)[part];
  }
  return cur;
}

function asNonEmptyString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() !== "" ? value : undefined;
}

export function lookup(
  source: DictsLike | Record<UiLocale, Dict>,
  locale: unknown,
  path: string,
): string | undefined {
  const active = localeOf(locale);
  const record = source as DictsLike;
  const hit = asNonEmptyString(resolvePath(record[active], path));
  if (hit !== undefined) return hit;
  if (active === "bn") return undefined;
  const warnKey = `${path} (${active})`;
  if (!warned.has(warnKey)) {
    warned.add(warnKey);
    console.warn(`[i18n] missing key: ${path} (${active})`);
  }
  return asNonEmptyString(resolvePath(record.bn, path));
}
