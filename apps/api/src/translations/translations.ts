/**
 * NF5 (FB3) — multi-language storefront: shared constants and
 * pure helpers (no service / prisma dependency).
 *
 * LOCALE CHOICE (recorded per the FB3 brief): the codebase's
 * existing i18n machinery is strictly bn | en — StorefrontSetting
 * .locale is @IsIn(["bn","en"]), Product carries nameEn /
 * descriptionEn alternates (AB6), and the web shop dictionary
 * (apps/web/src/lib/shop-i18n.ts) is typed ShopLocale = "bn"|"en"
 * with a bn fallback for anything unknown. NF5 therefore keeps
 * bn + en as the base pair and adds **hi (Hindi)** as the third
 * locale, carried end-to-end by THIS translation layer: the
 * ContentTranslation.locale column is a free string (the
 * mechanism is locale-agnostic), every configured LLM provider
 * behind LlmFactory (OpenAI / Anthropic / Gemini) generates
 * Hindi, and the web shop renders product name/description from
 * the payload generically — so approved Hindi product content
 * displays with zero dictionary changes (shop chrome honestly
 * falls back to the bn dictionary, shop-i18n's own rule for an
 * unknown locale). Extending further is data, not code: add the
 * locale here and translate.
 */

export const TRANSLATION_LOCALES = ["bn", "en", "hi"] as const;
export type TranslationLocale = (typeof TRANSLATION_LOCALES)[number];

export const LOCALE_NAMES: Record<string, string> = {
  bn: "বাংলা",
  en: "English",
  hi: "हिन्दी (Hindi)",
};

/** Language name used inside the LLM prompt (English instruction). */
export const LOCALE_PROMPT_NAMES: Record<string, string> = {
  bn: "Bengali (Bangla script)",
  en: "English",
  hi: "Hindi (Devanagari script)",
};

export function isTranslationLocale(v: unknown): v is TranslationLocale {
  return typeof v === "string" && (TRANSLATION_LOCALES as readonly string[]).includes(v);
}

/**
 * Resolve the locale a public shop read should serve: an explicit
 * shopper choice (the `?locale=` query on the existing
 * public/shop/:orgSlug routes — same slug routing as always, no
 * second router) wins when it is a supported translation locale;
 * otherwise the org's StorefrontSetting.locale (the existing
 * EC19 pattern). Anything unknown resolves to the setting, and
 * the setting itself defaults to "bn" upstream.
 */
export function resolveShopLocale(requested: unknown, settingLocale?: string | null): string {
  if (isTranslationLocale(requested)) return requested;
  return settingLocale ?? "bn";
}

/**
 * The honest converted-price label, in the customer's language:
 * the converted figure is approximate and checkout is charged in
 * the shop's base currency. Locales outside bn/en/hi fall back to
 * English (the label must never be silently dropped).
 */
export function displayPriceLabel(locale: string | null | undefined, baseCurrency: string): string {
  const base = (baseCurrency || "BDT").toUpperCase();
  switch (locale) {
    case "bn":
      return `আনুমানিক মূল্য — চেকআউটে দোকানের মূল মুদ্রায় (${base}) চার্জ করা হবে`;
    case "hi":
      return `अनुमानित मूल्य — चेकआउट पर दुकान की मूल मुद्रा (${base}) में शुल्क लिया जाएगा`;
    default:
      return `Approximate price — checkout is charged in the shop's base currency (${base})`;
  }
}

/**
 * Parse a human-entered ratePerUnit ("how many base-currency
 * units one display-currency unit costs", e.g. "119.50").
 * Returns null for anything that is not a plain positive decimal
 * — an unparseable rate is NEVER guessed at.
 */
export function parseRatePerUnit(raw: unknown): number | null {
  if (typeof raw !== "string" && typeof raw !== "number") return null;
  const s = String(raw).trim();
  if (!/^\d+(\.\d+)?$/.test(s)) return null;
  const n = Number(s);
  return Number.isFinite(n) && n > 0 ? n : null;
}

/**
 * Convert a base-currency minor-unit price into a DISPLAY amount
 * in `currency`, using ONLY the human-entered rate. Display math
 * only: the result is a formatted string for shoppers, labelled
 * approximate by displayPriceLabel wherever it is shown; it is
 * never written to an order, a cart total, or a payment.
 * Assumes the conventional 100 minor units per major unit on
 * both sides (true for BDT / USD / INR / EUR shop currencies).
 */
export function convertedDisplayAmount(priceMinor: bigint | number | string, ratePerUnit: number): string | null {
  if (!Number.isFinite(ratePerUnit) || ratePerUnit <= 0) return null;
  let minor: bigint;
  try {
    minor = typeof priceMinor === "bigint" ? priceMinor : BigInt(String(priceMinor));
  } catch {
    return null;
  }
  const displayMajor = Number(minor) / 100 / ratePerUnit;
  if (!Number.isFinite(displayMajor)) return null;
  return displayMajor.toFixed(2);
}
