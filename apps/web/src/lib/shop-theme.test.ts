import { describe, expect, it } from "vitest";
import { SHOP_THEMES, THEME_ID_LIST, themeIdOf, themeOf } from "./shop-theme";

describe("shop theme", () => {
  it("classic equals the pre-theme classes exactly", () => {
    expect(SHOP_THEMES.classic.heroClass).toBe("rounded-3xl bg-white p-8 text-center shadow-sm border border-slate-200");
    expect(SHOP_THEMES.classic.heroTitleClass).toBe("text-3xl font-black text-slate-900 sm:text-4xl");
    expect(SHOP_THEMES.classic.gridClass).toBe("grid grid-cols-2 gap-4 md:grid-cols-3 lg:grid-cols-4");
    expect(SHOP_THEMES.classic.featuredGridClass).toBe("grid grid-cols-2 gap-4 md:grid-cols-4");
    expect(SHOP_THEMES.classic.cardClass).toBe("rounded-2xl border border-slate-200 shadow-sm");
    expect(SHOP_THEMES.classic.headerDark).toBe(false);
  });

  it("supports all prebuilt themes including fashion, electronics, grocery, beauty, furniture, books, kids, automotive, sports, and jewelry", () => {
    expect(THEME_ID_LIST).toHaveLength(20);
    const expected = [
      "classic",
      "bold",
      "minimal",
      "luxury",
      "organic",
      "vibrant",
      "modern",
      "pastel",
      "nordic",
      "midnight",
      "fashion",
      "electronics",
      "grocery",
      "beauty",
      "furniture",
      "books",
      "kids",
      "automotive",
      "sports",
      "jewelry",
    ];
    expect(THEME_ID_LIST).toEqual(expected);

    for (const id of THEME_ID_LIST) {
      const theme = SHOP_THEMES[id];
      expect(theme).toBeDefined();
      expect(typeof theme.headerDark).toBe("boolean");
      expect(theme.heroClass).toBeTruthy();
      expect(theme.heroTitleClass).toBeTruthy();
      expect(theme.gridClass).toBeTruthy();
      expect(theme.cardClass).toBeDefined();
      expect(themeIdOf(id)).toBe(id);
      expect(themeOf(id)).toBe(theme);
    }
  });

  it("falls back to classic for unknown ids", () => {
    expect(themeOf(undefined)).toBe(SHOP_THEMES.classic);
    expect(themeOf("nope")).toBe(SHOP_THEMES.classic);
    expect(themeOf("bold").headerDark).toBe(true);
    expect(themeOf("luxury").headerDark).toBe(true);
    expect(themeOf("modern").headerDark).toBe(true);
    expect(themeOf("midnight").headerDark).toBe(true);
    expect(themeOf("organic").headerDark).toBe(false);
    expect(themeOf("minimal")).toBe(SHOP_THEMES.minimal);
  });
});
