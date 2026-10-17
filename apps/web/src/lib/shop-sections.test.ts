import { describe, expect, it } from "vitest";
import {
  SHOP_SECTION_KEYS,
  normalizeSectionOrder,
  orderedVisibleSections,
  sectionVisibilityOf,
} from "./shop-sections";
import { SHOP_THEMES, themeIdOf, themeOf, effectiveThemeId } from "./shop-theme";

describe("OU8 shop sections", () => {
  it("defaults: absent flags are ON; null order is canonical", () => {
    expect(sectionVisibilityOf(null)).toEqual({
      hero: true, categories: true, brands: true, bundles: true,
      flash: true, featured: true, recently: true,
    });
    expect(normalizeSectionOrder(null)).toEqual([...SHOP_SECTION_KEYS]);
    expect(orderedVisibleSections(null, sectionVisibilityOf({}))).toEqual([...SHOP_SECTION_KEYS]);
  });

  it("a hidden section disappears from the render list (toggle does something)", () => {
    const vis = sectionVisibilityOf({ showFeatured: false, showHero: false });
    const out = orderedVisibleSections(null, vis);
    expect(out).not.toContain("featured");
    expect(out).not.toContain("hero");
    expect(out).toContain("categories");
  });

  it("reorder is honoured; unknown/duplicate keys collapse; missing keys append canonically", () => {
    expect(normalizeSectionOrder(["featured", "hero", "featured", "nope", 42])).toEqual([
      "featured", "hero", "categories", "brands", "bundles", "flash", "recently",
    ]);
    const vis = sectionVisibilityOf({});
    expect(orderedVisibleSections(["featured", "hero"], vis)[0]).toBe("featured");
    expect(orderedVisibleSections(["featured", "hero"], vis)[1]).toBe("hero");
  });
});

describe("OU8 new preset themes", () => {
  it("warm and ocean resolve end-to-end and differ from every prior preset", () => {
    expect(themeIdOf("warm")).toBe("warm");
    expect(themeIdOf("ocean")).toBe("ocean");
    expect(themeOf("warm")).toBe(SHOP_THEMES.warm);
    expect(themeOf("ocean")).toBe(SHOP_THEMES.ocean);
    expect(effectiveThemeId("classic", "warm")).toBe("warm");
    expect(effectiveThemeId("ocean", null)).toBe("ocean");
    expect(effectiveThemeId("classic", "nope")).toBe("classic");
    const all = Object.values(SHOP_THEMES);
    expect(new Set(all.map((t) => t.heroClass)).size).toBe(all.length);
    expect(new Set(all.map((t) => t.gridClass)).size).toBeGreaterThanOrEqual(4);
    // Token-native like v2: card body/price/section classes exist.
    for (const id of ["warm", "ocean"] as const) {
      expect(SHOP_THEMES[id].cardBodyClass).toBeTruthy();
      expect(SHOP_THEMES[id].cardPriceClass).toBeTruthy();
      expect(SHOP_THEMES[id].sectionTitleClass).toBeTruthy();
    }
    expect(SHOP_THEMES.ocean.headerDark).toBe(true);
    expect(SHOP_THEMES.warm.headerDark).toBe(false);
  });
});
