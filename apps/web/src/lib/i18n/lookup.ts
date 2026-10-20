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

/**
 * Parameterised lookup (MB2 STEP-0) — the interpolation helper the
 * dashboard conversion depends on (~1,087 interpolated template
 * literals in the MB2 inventory).
 *
 * Dictionary values carry named placeholders: "{count}টি অর্ডার"
 * (bn) / "{count} orders" (en). `tr` resolves the string through
 * the exact same ML-L2/L6 path as `lookup` FIRST (whole-string bn
 * fallback + missing-key log), and only then substitutes params —
 * so a missing en key falls back as a complete Bengali sentence
 * with the params filled in, never as a half-mixed string.
 *
 * A param that is not supplied is left visible as "{name}" in the
 * output (an honest, greppable gap — never silently blanked).
 */
export type TrParams = Record<string, string | number | bigint>;

const PLACEHOLDER = /\{([A-Za-z0-9_]+)\}/g;

export function interpolate(template: string, params?: TrParams): string {
  if (!params) return template;
  return template.replace(PLACEHOLDER, (whole, key: string) =>
    Object.prototype.hasOwnProperty.call(params, key) ? String(params[key]) : whole,
  );
}

export function tr(
  source: DictsLike | Record<UiLocale, Dict>,
  locale: unknown,
  path: string,
  params?: TrParams,
): string | undefined {
  const resolved = lookup(source, locale, path);
  return resolved === undefined ? undefined : interpolate(resolved, params);
}

/** Sorted placeholder names of a dictionary value — the parity
 * test pins bn/en placeholder sets equal for every key. */
export function placeholdersOf(value: string): string[] {
  const names = new Set<string>();
  for (const m of value.matchAll(PLACEHOLDER)) names.add(m[1]);
  return [...names].sort();
}

/**
 * Bengali count-classifier pattern (MB2 STEP-0) — the ~764 code
 * sites shaped like `${n}টি` / `${n}জন` in the bn source.
 *
 * In Bengali the classifier suffix attaches to the number itself
 * ("৩টি", "৫জন") and the noun does not change; in English there
 * is no suffix and the NOUN carries the plural ("3 orders",
 * "1 order"). This helper owns that divergence for the sites
 * where the count phrase is assembled in code rather than inside
 * a dictionary template:
 *
 *   countWithClassifier(locale, 3, { bnSuffix: "টি", enOne: "order", enOther: "orders" })
 *     bn → "৩টি" is NOT produced here — digit localisation is the
 *     caller's job via @repo/contracts fmtNumber; pass the
 *     already-formatted count as `formattedCount`.
 *     en → "3 orders" (formattedCount + space + plural noun)
 *
 * Prefer dictionary templates with {count} placeholders (via tr)
 * wherever the whole phrase is copy; use this helper only for
 * genuinely code-assembled count phrases.
 */
export interface CountClassifierForms {
  /** Bengali classifier suffix: টি / টা / জন / গুলো … (default "টি"). */
  bnSuffix?: string;
  /** English singular noun ("order"). */
  enOne: string;
  /** English plural noun ("orders"). */
  enOther: string;
  /** Count already localised by the caller (fmtNumber). Defaults to String(count). */
  formattedCount?: string;
}

export function countWithClassifier(
  locale: unknown,
  count: number,
  forms: CountClassifierForms,
): string {
  const display = forms.formattedCount ?? String(count);
  if (localeOf(locale) === "bn") return `${display}${forms.bnSuffix ?? "টি"}`;
  return `${display} ${count === 1 ? forms.enOne : forms.enOther}`;
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
