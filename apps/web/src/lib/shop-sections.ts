/**
 * OU8 — shop home section customizer (pure helpers; the shop home
 * page renders EXACTLY what orderedVisibleSections returns).
 *
 * Sections the merchant can hide/reorder: hero, categories,
 * brands, bundles, flash, featured, recently. The product grid
 * ("products") is NOT in this list: it is the shop itself, always
 * rendered, always after the ordered sections. Search lives inside
 * the hero and keeps its own pre-OU8 toggle (showSearch).
 *
 * Visibility input mirrors the StorefrontSetting booleans exactly
 * (showHero/showCategories/showBrands/showBundles/showFlashSale/
 * showFeatured/showRecentlyViewed). sectionOrder is untrusted Json
 * from the DB — unknown keys are dropped, duplicates collapse,
 * missing keys append in canonical order, so ANY stored value
 * still yields every visible section exactly once.
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

export interface ShopSectionVisibility {
  hero: boolean;
  categories: boolean;
  brands: boolean;
  bundles: boolean;
  flash: boolean;
  featured: boolean;
  recently: boolean;
}

/** Map a settings payload (API shape) to section visibility. */
export function sectionVisibilityOf(settings: {
  showHero?: unknown;
  showCategories?: unknown;
  showBrands?: unknown;
  showBundles?: unknown;
  showFlashSale?: unknown;
  showFeatured?: unknown;
  showRecentlyViewed?: unknown;
} | null | undefined): ShopSectionVisibility {
  const s = settings ?? {};
  // Pre-OU8 rows/APIs omit the new flags entirely — absent = ON,
  // matching the DB defaults, so an old payload renders as before.
  const on = (v: unknown) => v !== false;
  return {
    hero: on(s.showHero),
    categories: on(s.showCategories),
    brands: on(s.showBrands),
    bundles: on(s.showBundles),
    flash: on(s.showFlashSale),
    featured: on(s.showFeatured),
    recently: on(s.showRecentlyViewed),
  };
}

/** Normalize an untrusted stored order into a full permutation. */
export function normalizeSectionOrder(raw: unknown): ShopSectionKey[] {
  const out: ShopSectionKey[] = [];
  if (Array.isArray(raw)) {
    for (const v of raw) {
      if ((SHOP_SECTION_KEYS as readonly string[]).includes(v as string) && !out.includes(v as ShopSectionKey)) {
        out.push(v as ShopSectionKey);
      }
    }
  }
  for (const k of SHOP_SECTION_KEYS) if (!out.includes(k)) out.push(k);
  return out;
}

/** THE render list: normalized order, filtered by visibility. */
export function orderedVisibleSections(
  rawOrder: unknown,
  visibility: ShopSectionVisibility,
): ShopSectionKey[] {
  return normalizeSectionOrder(rawOrder).filter((k) => visibility[k]);
}
