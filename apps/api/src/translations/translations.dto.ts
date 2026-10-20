/**
 * NF5 (FB3) — Translations DTOs (plain interfaces, the booking.dto
 * pattern): every merchant-readable validation lives in
 * TranslationsService so failures are Bengali 400s, not bare
 * validation lists.
 */

export interface UpsertTranslationDto {
  entityType?: string; // product | category | blog_post | storefront_string (MB5/ML15 added category + blog_post)
  entityId?: string; // product/category/blog-post id, or "shop" for storefront strings
  field?: string; // name | description | title (blog_post only) | announcementText | returnPolicyText | deliveryPromiseText
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
