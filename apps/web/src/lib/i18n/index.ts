/**
 * ML3 (Multi-Language MB1) — unified dashboard i18n entry point.
 *
 * - `./dict`   — typed bn/en dictionary (bn is the shape source
 *   of truth) + getDict/localeOf. Pure, no contracts import.
 * - `./lookup` — dotted-key lookup with whole-string bn fallback
 *   + once-per-key missing-key warning (ML-L2/L6). Pure.
 * - `./shop`   — the EC19 shop-surface dictionary, now the
 *   `shop` namespace of this unified module.
 * - `./provider` — LocaleProvider / useLocale / LanguageSwitcher
 *   (client component; the only part that imports
 *   @repo/contracts at runtime, for resolveUiLocale).
 */
export * from "./dict";
export * from "./lookup";
// export * from "./shop"; // ML3 commit re-enables
export * from "./provider";
