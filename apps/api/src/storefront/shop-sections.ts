/**
 * OU8 — server-side shop section vocabulary + order normalization.
 * Mirrors apps/web/src/lib/shop-sections.ts (the render-side pure
 * helpers): the API validates/stores only these keys, the web
 * normalizes again on read, so a hand-edited DB value can never
 * inject an unknown section into the shop.
 */
export const SHOP_SECTION_KEYS = [
  "hero",
  "categories",
  "brands",
  "bundles",
  "flash",
  "featured",
  "recently",
] as const;

export type ShopSectionKey = (typeof SHOP_SECTION_KEYS)[number];

/** Filter an incoming order to known keys, deduped, order kept.
 * Missing keys are NOT appended here — storage keeps the merchant's
 * partial order and readers complete it canonically. */
export function sanitizeSectionOrder(raw: unknown): ShopSectionKey[] {
  if (!Array.isArray(raw)) return [];
  const out: ShopSectionKey[] = [];
  for (const v of raw) {
    if ((SHOP_SECTION_KEYS as readonly string[]).includes(v as string) && !out.includes(v as ShopSectionKey)) {
      out.push(v as ShopSectionKey);
    }
  }
  return out;
}

export function isValidSectionOrder(raw: unknown): boolean {
  if (!Array.isArray(raw)) return false;
  return raw.every((v) => typeof v === "string" && (SHOP_SECTION_KEYS as readonly string[]).includes(v));
}
