/**
 * NF5 (FB3) — Translations DTOs (plain interfaces, the booking.dto
 * pattern): every merchant-readable validation lives in
 * TranslationsService so failures are Bengali 400s, not bare
 * validation lists.
 */

export interface UpsertTranslationDto {
  entityType?: string; // product | storefront_string
  entityId?: string; // product id, or "shop" for storefront strings
  field?: string; // name | description | announcementText | returnPolicyText | deliveryPromiseText
  locale?: string; // bn | en | hi
  text?: string;
  /** Explicit staff choice only — never defaults to approved. */
  status?: string; // draft | approved
}

export interface UpdateTranslationDto {
  text?: string;
  status?: string; // draft | approved
}

export interface AiProductDraftDto {
  locale?: string; // bn | en | hi
}

export interface AiStringsDraftDto {
  locale?: string; // bn | en | hi
  /** Subset of the supported storefront-string keys; default = all with base text. */
  fields?: string[];
}

export interface UpsertCurrencyRateDto {
  currency?: string; // ISO code, e.g. USD
  /** Human-entered: base-currency units per 1 unit of `currency`. */
  ratePerUnit?: string | number;
  /** Required: where the human got this rate. */
  sourceNote?: string;
}
