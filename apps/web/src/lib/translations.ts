// NF5 (FB3) — storefront translations + display currencies.
// Pure logic (locale list, labels, grouping, payload builders)
// + thin API wrappers — same split as lib/booking.ts: the panel
// component owns fetching/state, everything testable lives here.
//
// Honesty rules mirrored from the API: a translation is public
// ONLY when status is "approved" (drafts — including every AI
// generation — never reach the shop), and a converted price is
// a display-only, human-rated, approximate figure; checkout is
// always charged in the shop's base currency.

import { apiFetch } from "./api";

export const TRANSLATION_LOCALES = [
  { code: "bn", label: "বাংলা" },
  { code: "en", label: "English" },
  { code: "hi", label: "हिन्दी (Hindi)" },
] as const;

export type TranslationLocaleCode = (typeof TRANSLATION_LOCALES)[number]["code"];

export interface TranslationView {
  id: string;
  entityType: string; // product | category | blog_post | storefront_string
  entityId: string;
  field: string; // name | description | title (blog_post) | announcementText | returnPolicyText | deliveryPromiseText
  locale: string;
  text: string;
  status: string; // draft | approved
  source: string; // ai | human
  updatedAt: string | null;
}

export interface CurrencyRateView {
  currency: string;
  ratePerUnit: string;
  sourceNote: string;
  baseCurrency: string;
  updatedAt: string | null;
}

export const PRODUCT_TRANSLATION_FIELDS = [
  { field: "name", label: "পণ্যের নাম" },
  { field: "description", label: "পণ্যের বিবরণ" },
] as const;

/** MB5 (ML15): category fields — the product pair (name, description). */
export const CATEGORY_TRANSLATION_FIELDS = [
  { field: "name", label: "ক্যাটাগরির নাম" },
  { field: "description", label: "ক্যাটাগরির বিবরণ" },
] as const;

/** MB5 (ML15): blog post — title ONLY (content is not translated). */
export const BLOG_POST_TRANSLATION_FIELDS = [
  { field: "title", label: "ব্লগ পোস্টের শিরোনাম" },
] as const;

export const STOREFRONT_STRING_FIELDS = [
  { field: "announcementText", label: "ঘোষণা (announcement)" },
  { field: "returnPolicyText", label: "রিটার্ন নীতি" },
  { field: "deliveryPromiseText", label: "ডেলিভারি প্রতিশ্রুতি" },
] as const;

export function statusLabel(status: string): string {
  return status === "approved" ? "✅ অনুমোদিত — দোকানে দেখাচ্ছে" : "📝 খসড়া — দোকানে দেখাবে না";
}

export function sourceLabel(source: string): string {
  return source === "ai" ? "AI খসড়া" : "নিজে লেখা";
}

/** Find one translation in a list by field + locale. */
export function findTranslation(
  items: TranslationView[], field: string, locale: string,
): TranslationView | null {
  return items.find((t) => t.field === field && t.locale === locale) ?? null;
}

/** True when approving would change anything (draft → approved). */
export function canApprove(t: TranslationView | null): boolean {
  return !!t && t.status !== "approved";
}

/**
 * The converted-price caption for a shop product card, built
 * ONLY from the API's displayPrices (never computed client-side
 * from a rate — the server owns the conversion + label so the
 * honest wording can never drift). Returns null when the API
 * sent no display price (no rate configured → nothing shown).
 */
export function displayPriceCaption(product: {
  displayPrices?: { currency: string; amount: string; label: string }[] | null;
}): string | null {
  const first = product.displayPrices?.[0];
  if (!first) return null;
  return `${first.currency} ${first.amount} — ${first.label}`;
}

// ---------- API wrappers ----------

const base = (orgId: string) => `/organizations/${orgId}`;

export function fetchProductTranslations(orgId: string, productId: string) {
  return apiFetch<{ items: TranslationView[] }>(`${base(orgId)}/products/${productId}/translations`);
}

export function fetchStorefrontStringTranslations(orgId: string) {
  return apiFetch<{ items: TranslationView[] }>(`${base(orgId)}/storefront-string-translations`);
}

/** MB5 (ML15): category translations — the product wrappers' mirror. */
export function fetchCategoryTranslations(orgId: string, categoryId: string) {
  return apiFetch<{ items: TranslationView[] }>(`${base(orgId)}/categories/${categoryId}/translations`);
}

export function generateCategoryAiDraft(orgId: string, categoryId: string, locale: string) {
  return apiFetch<{ mode: string; note: string; items: TranslationView[] }>(
    `${base(orgId)}/categories/${categoryId}/translations/ai-draft`,
    { method: "POST", body: JSON.stringify({ locale }) },
  );
}

/** MB5 (ML15): blog-post title translations — the product wrappers' mirror. */
export function fetchBlogPostTranslations(orgId: string, blogPostId: string) {
  return apiFetch<{ items: TranslationView[] }>(`${base(orgId)}/blog-posts/${blogPostId}/translations`);
}

export function generateBlogPostAiDraft(orgId: string, blogPostId: string, locale: string) {
  return apiFetch<{ mode: string; note: string; items: TranslationView[] }>(
    `${base(orgId)}/blog-posts/${blogPostId}/translations/ai-draft`,
    { method: "POST", body: JSON.stringify({ locale }) },
  );
}

export function upsertTranslation(orgId: string, body: {
  entityType: string; entityId: string; field: string; locale: string; text: string; status?: string;
}) {
  return apiFetch<TranslationView>(`${base(orgId)}/translations`, {
    method: "POST",
    body: JSON.stringify(body),
  });
}

export function updateTranslation(orgId: string, id: string, body: { text?: string; status?: string }) {
  return apiFetch<TranslationView>(`${base(orgId)}/translations/${id}`, {
    method: "PATCH",
    body: JSON.stringify(body),
  });
}

export function generateProductAiDraft(orgId: string, productId: string, locale: string) {
  return apiFetch<{ mode: string; note: string; items: TranslationView[] }>(
    `${base(orgId)}/products/${productId}/translations/ai-draft`,
    { method: "POST", body: JSON.stringify({ locale }) },
  );
}

export function generateStringsAiDraft(orgId: string, locale: string) {
  return apiFetch<{ mode: string; note: string; items: TranslationView[] }>(
    `${base(orgId)}/storefront-string-translations/ai-draft`,
    { method: "POST", body: JSON.stringify({ locale }) },
  );
}

export function fetchCurrencyRates(orgId: string) {
  return apiFetch<{ baseCurrency: string; items: CurrencyRateView[] }>(`${base(orgId)}/display-currency-rates`);
}

export function upsertCurrencyRate(orgId: string, body: { currency: string; ratePerUnit: string; sourceNote: string }) {
  return apiFetch<CurrencyRateView>(`${base(orgId)}/display-currency-rates`, {
    method: "POST",
    body: JSON.stringify(body),
  });
}

export function deleteCurrencyRate(orgId: string, currency: string) {
  return apiFetch<{ deleted: boolean; currency: string }>(`${base(orgId)}/display-currency-rates/${currency}`, {
    method: "DELETE",
  });
}
