// ML1 — UI locale core (Multi-Language program, MB1).
//
// The platform has exactly TWO UI locales for now: Bangla (bn) and
// English (en). Bangla is the platform default (Bangladesh-first
// product): a user with no stored preference, in an org with no
// stored default, sees Bangla. Content translations (NF5) and shop
// i18n (EC19) are separate concerns — this module is ONLY about the
// interface language of the staff/admin/storefront chrome.
//
// Values arriving from the DB, localStorage, headers or query params
// are untrusted: only the exact strings "bn" and "en" are locales.
// Anything else ("bn-BD", "EN", "fr", null, 42 …) is NOT a locale and
// is skipped / replaced by the fallback — never treated as final.

/** Every UI locale the platform ships, in preference-display order. */
export const UI_LOCALES = ["bn", "en"] as const;

export type UiLocale = (typeof UI_LOCALES)[number];

/** Platform-wide default when neither the user nor the org chose one. */
export const PLATFORM_DEFAULT_LOCALE: UiLocale = "bn";

/** Exact-match guard: only "bn" / "en" pass. No case-folding, no
 * BCP-47 prefixes — callers that hold "bn-BD" must map it themselves. */
export function isUiLocale(value: unknown): value is UiLocale {
  return value === "bn" || value === "en";
}

/** Coerce an unknown value to a UiLocale, else the fallback
 * (platform default unless the caller supplies one). */
export function normalizeUiLocale(
  value: unknown,
  fallback: UiLocale = PLATFORM_DEFAULT_LOCALE,
): UiLocale {
  return isUiLocale(value) ? value : fallback;
}

/**
 * Resolution order for "which UI language does this person see":
 *   1. the user's own stored preference (staff pref)
 *   2. the organization's default locale
 *   3. the platform default (bn)
 * An invalid value at any level is SKIPPED, not treated as final —
 * a corrupt user pref must not mask a valid org default.
 */
export function resolveUiLocale(input: {
  userPref?: unknown;
  orgDefault?: unknown;
}): UiLocale {
  if (isUiLocale(input?.userPref)) return input.userPref;
  if (isUiLocale(input?.orgDefault)) return input.orgDefault;
  return PLATFORM_DEFAULT_LOCALE;
}

/**
 * The Intl (BCP-47) locale behind a UiLocale:
 *   bn → "bn-BD"  (Bengali digits ০-৯, lakh grouping ১,০০,০০০)
 *   en → "en-IN"  (Latin digits, Indian grouping 1,00,000 — the
 *                  grouping Bangladeshi users expect in English too,
 *                  and verified to render dates day-first long:
 *                  "19 October 2026")
 */
export function intlLocaleOf(locale: UiLocale): "bn-BD" | "en-IN" {
  return normalizeUiLocale(locale) === "bn" ? "bn-BD" : "en-IN";
}
