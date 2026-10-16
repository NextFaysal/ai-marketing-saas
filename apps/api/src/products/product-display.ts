/**
 * AB6 (AX13) — shared shopper-facing product text display rule.
 *
 * Pure helpers (no service / prisma dependency) so every public
 * surface — storefront, single-product checkout, landings —
 * resolves a product's display name/description identically:
 * the English alternate ONLY when the shop locale is "en" and
 * a non-empty alternate exists; the primary text otherwise.
 */
export function displayProductName(product: any, locale?: string | null): string {
  if (locale === "en" && typeof product?.nameEn === "string" && product.nameEn.trim()) {
    return product.nameEn;
  }
  return product?.name ?? "";
}

export function displayProductDescription(product: any, locale?: string | null): string | null {
  if (locale === "en" && typeof product?.descriptionEn === "string" && product.descriptionEn.trim()) {
    return product.descriptionEn;
  }
  return product?.description ?? null;
}
