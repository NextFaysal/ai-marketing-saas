/**
 * GB7 (GC18): merchant tracking-tag validation — pure helpers,
 * no Nest imports, shared by the storefront settings write path
 * (and unit-tested directly).
 *
 * The ids stored on StorefrontSetting are always the MERCHANT's
 * own tracking ids (never platform ids). A null value means
 * "unset" — the shop renders NOTHING for that tag. Shape checks
 * are deliberately strict: a malformed id would silently never
 * fire in the browser, so it is refused at save time with a
 * Bengali message instead.
 */

export const TRACKING_FIELDS = [
  "ga4MeasurementId",
  "gtmContainerId",
  "googleAdsId",
  "googleAdsConversionLabel",
  "searchConsoleVerification",
  "metaPixelId",
  "tikTokPixelId",
  "clarityId",
] as const;

export type TrackingField = (typeof TRACKING_FIELDS)[number];

export type TrackingValidation =
  | { ok: true; value: string | null }
  | { ok: false; message: string };

const RULES: Record<
  TrackingField,
  { pattern: RegExp; message: string; allowMultiple?: boolean }
> = {
  ga4MeasurementId: {
    pattern: /^G-[A-Z0-9]{6,}$/i,
    message: "GA4 Measurement ID-এর ফরম্যাট ঠিক নয় (G- দিয়ে শুরু হতে হবে)",
    allowMultiple: true,
  },
  gtmContainerId: {
    pattern: /^GTM-[A-Z0-9]{6,}$/i,
    message: "GTM Container ID-এর ফরম্যাট ঠিক নয় (GTM- দিয়ে শুরু হতে হবে)",
    allowMultiple: true,
  },
  googleAdsId: {
    pattern: /^AW-\d{6,}$/,
    message: "Google Ads ID-এর ফরম্যাট ঠিক নয় (AW- দিয়ে শুরু হতে হবে)",
  },
  googleAdsConversionLabel: {
    pattern: /^[A-Za-z0-9_-]{6,64}$/,
    message: "Google Ads Conversion Label-এর ফরম্যাট ঠিক নয়",
  },
  searchConsoleVerification: {
    pattern: /^[A-Za-z0-9_-]{20,128}$/,
    message: "Search Console verification টোকেনের ফরম্যাট ঠিক নয়",
  },
  metaPixelId: {
    pattern: /^\d{9,20}$/,
    message: "Facebook Pixel ID-এর ফরম্যাট ঠিক নয় (৯–২০ ডিজিট হতে হবে)",
    allowMultiple: true,
  },
  tikTokPixelId: {
    pattern: /^[A-Za-z0-9_-]{9,32}$/,
    message: "TikTok Pixel ID সঠিক ফরম্যাটে হতে হবে (যেমন: CXXXXXXXXX)",
    allowMultiple: true,
  },
  clarityId: {
    pattern: /^[A-Za-z0-9]{6,16}$/,
    message: "Microsoft Clarity Project ID সঠিক ফরম্যাটে হতে হবে (যেমন: abcdefgh12)",
    allowMultiple: true,
  },
};

/**
 * Normalize + shape-check one tracking value.
 * null / undefined / empty-after-trim ⇒ { ok: true, value: null }
 * (clearing the field).
 * Supports comma-separated / multiple IDs for fields marked with allowMultiple.
 */
export function validateTrackingValue(
  field: TrackingField,
  raw: string | null | undefined,
): TrackingValidation {
  if (raw === null || raw === undefined) return { ok: true, value: null };
  const value = String(raw).trim();
  if (value === "") return { ok: true, value: null };
  const rule = RULES[field];
  if (!rule) return { ok: true, value };

  if (rule.allowMultiple) {
    const tokens = value
      .split(/[\s,]+/)
      .map((t) => t.trim())
      .filter(Boolean);
    if (tokens.length === 0) return { ok: true, value: null };
    for (const token of tokens) {
      if (!rule.pattern.test(token)) {
        return { ok: false, message: rule.message };
      }
    }
    return { ok: true, value: tokens.join(", ") };
  }

  if (!rule.pattern.test(value)) return { ok: false, message: rule.message };
  return { ok: true, value };
}
