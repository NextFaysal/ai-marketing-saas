import { convertedDisplayAmount, displayPriceLabel, parseRatePerUnit } from "./translations";

/**
 * NF5 (FB3) — the PUBLIC read side of translations + display
 * currencies. Deliberately a set of functions over a prisma-like
 * handle (the buildCheckoutTrust pattern) so StorefrontService
 * can call them with its own prisma — no new DI edge, no module
 * cycle, and the SAME code the specs exercise is the code the
 * public shop runs.
 *
 * HARD RULES enforced here (spec-pinned in translations.spec.ts):
 * - Only status = "approved" translations are ever read for a
 *   public surface. Drafts do not exist as far as this file is
 *   concerned: the query filters on approved, never post-filters.
 * - A missing translation leaves the base-language original text
 *   untouched (the caller passes serialized products whose name /
 *   description already carry the AB6 base rule).
 * - Every query is org-scoped: another org's translations can
 *   never be served for this org's shop.
 * - Converted prices are DISPLAY strings with the honest
 *   approximate label; base price fields are never modified, and
 *   nothing here is read by checkout / orders / payments.
 */

export interface DisplayPrice {
  currency: string;
  amount: string;
  label: string;
  /** Where the human-entered rate came from (their own note). */
  sourceNote: string;
  rateUpdatedAt: string | null;
}

/** Approved product name/description overlays for one locale. */
export async function approvedProductTexts(
  db: any,
  organizationId: string,
  productIds: string[],
  locale: string,
): Promise<Map<string, { name?: string; description?: string }>> {
  const out = new Map<string, { name?: string; description?: string }>();
  if (!db?.contentTranslation || !organizationId || !locale || productIds.length === 0) return out;
  const rows = await db.contentTranslation.findMany({
    where: {
      organizationId,
      entityType: "product",
      entityId: { in: productIds },
      locale,
      status: "approved",
      field: { in: ["name", "description"] },
    },
  }).catch(() => []);
  for (const row of rows ?? []) {
    if (typeof row?.text !== "string" || !row.text.trim()) continue;
    const cur = out.get(String(row.entityId)) ?? {};
    if (row.field === "name") cur.name = row.text;
    if (row.field === "description") cur.description = row.text;
    out.set(String(row.entityId), cur);
  }
  return out;
}

/**
 * MB5 (ML15): approved category name/description overlays for
 * one locale — approvedProductTexts' exact rules (approved-only
 * IN the query, org-scoped, missing row = base text untouched).
 */
export async function approvedCategoryTexts(
  db: any,
  organizationId: string,
  categoryIds: string[],
  locale: string,
): Promise<Map<string, { name?: string; description?: string }>> {
  const out = new Map<string, { name?: string; description?: string }>();
  if (!db?.contentTranslation || !organizationId || !locale || categoryIds.length === 0) return out;
  const rows = await db.contentTranslation.findMany({
    where: {
      organizationId,
      entityType: "category",
      entityId: { in: categoryIds },
      locale,
      status: "approved",
      field: { in: ["name", "description"] },
    },
  }).catch(() => []);
  for (const row of rows ?? []) {
    if (typeof row?.text !== "string" || !row.text.trim()) continue;
    const cur = out.get(String(row.entityId)) ?? {};
    if (row.field === "name") cur.name = row.text;
    if (row.field === "description") cur.description = row.text;
    out.set(String(row.entityId), cur);
  }
  return out;
}

/**
 * MB5 (ML15): approved blog-post TITLE overlays for one locale
 * (title only — CD-5; content is never overlaid). Same
 * approved-only/org-scoped rules as the product/category reads.
 */
export async function approvedBlogPostTexts(
  db: any,
  organizationId: string,
  postIds: string[],
  locale: string,
): Promise<Map<string, { title?: string }>> {
  const out = new Map<string, { title?: string }>();
  if (!db?.contentTranslation || !organizationId || !locale || postIds.length === 0) return out;
  const rows = await db.contentTranslation.findMany({
    where: {
      organizationId,
      entityType: "blog_post",
      entityId: { in: postIds },
      locale,
      status: "approved",
      field: "title",
    },
  }).catch(() => []);
  for (const row of rows ?? []) {
    if (typeof row?.text !== "string" || !row.text.trim()) continue;
    out.set(String(row.entityId), { title: row.text });
  }
  return out;
}

/** Approved storefront_string translations for one locale. */
export async function approvedStorefrontStrings(
  db: any,
  organizationId: string,
  locale: string,
): Promise<Map<string, string>> {
  const out = new Map<string, string>();
  if (!db?.contentTranslation || !organizationId || !locale) return out;
  const rows = await db.contentTranslation.findMany({
    where: { organizationId, entityType: "storefront_string", locale, status: "approved" },
  }).catch(() => []);
  for (const row of rows ?? []) {
    if (typeof row?.text === "string" && row.text.trim()) out.set(String(row.field), row.text);
  }
  return out;
}

/**
 * Overlay approved translations onto SERIALIZED public products
 * (the serializeProduct output shape: { id, name, description,
 * ... }). Mutates and returns the list for call-site brevity.
 * Products without an approved row keep their base text exactly.
 */
export async function overlayProductTranslations<T extends { id: string; name: string; description: string | null }>(
  db: any,
  organizationId: string,
  products: T[],
  locale: string,
): Promise<T[]> {
  if (!products.length) return products;
  const texts = await approvedProductTexts(db, organizationId, products.map((p) => String(p.id)), locale);
  if (texts.size === 0) return products;
  for (const p of products) {
    const t = texts.get(String(p.id));
    if (!t) continue;
    if (t.name) p.name = t.name;
    if (t.description) p.description = t.description;
  }
  return products;
}

/** The org's human-entered display-currency rates (valid rows only). */
export async function displayCurrencyRates(db: any, organizationId: string): Promise<any[]> {
  if (!db?.displayCurrencyRate || !organizationId) return [];
  const rows = await db.displayCurrencyRate.findMany({
    where: { organizationId },
    orderBy: { currency: "asc" },
  }).catch(() => []);
  return (rows ?? []).filter((r: any) => parseRatePerUnit(r?.ratePerUnit) !== null);
}

/**
 * DISPLAY-ONLY converted prices for one base price. Empty when no
 * rate is configured (no converted price is shown at all then),
 * when the rate is unparseable, or when the "rate" is for the
 * base currency itself.
 */
export function displayPricesFor(
  priceMinor: bigint | number | string,
  baseCurrency: string,
  rates: any[],
  locale: string,
): DisplayPrice[] {
  const base = (baseCurrency || "BDT").toUpperCase();
  const out: DisplayPrice[] = [];
  for (const r of rates ?? []) {
    const currency = String(r?.currency ?? "").toUpperCase();
    if (!currency || currency === base) continue;
    const rate = parseRatePerUnit(r?.ratePerUnit);
    if (rate === null) continue;
    const amount = convertedDisplayAmount(priceMinor, rate);
    if (amount === null) continue;
    out.push({
      currency,
      amount,
      label: displayPriceLabel(locale, base),
      sourceNote: String(r?.sourceNote ?? ""),
      rateUpdatedAt: r?.updatedAt ? new Date(r.updatedAt).toISOString() : null,
    });
  }
  return out;
}

/** Attach displayPrices to serialized public products in place. */
export function attachDisplayPrices<T extends { priceMinor: string; currency?: string | null }>(
  products: T[],
  rates: any[],
  locale: string,
): (T & { displayPrices: DisplayPrice[] })[] {
  return products.map((p) => ({
    ...p,
    displayPrices: displayPricesFor(p.priceMinor, p.currency ?? "BDT", rates, locale),
  }));
}
