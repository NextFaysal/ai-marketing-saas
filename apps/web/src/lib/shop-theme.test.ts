import { describe, expect, it } from "vitest";
import { SHOP_THEMES, themeOf } from "./shop-theme";

describe("shop theme", () => {
  it("classic equals the pre-theme classes exactly", () => {
    expect(SHOP_THEMES.classic.heroClass).toBe("rounded-3xl bg-white p-8 text-center shadow-sm border border-slate-200");
    expect(SHOP_THEMES.classic.heroTitleClass).toBe("text-3xl font-black text-slate-900 sm:text-4xl");
    expect(SHOP_THEMES.classic.gridClass).toBe("grid grid-cols-2 gap-4 md:grid-cols-3 lg:grid-cols-4");
    expect(SHOP_THEMES.classic.featuredGridClass).toBe("grid grid-cols-2 gap-4 md:grid-cols-4");
    expect(SHOP_THEMES.classic.cardClass).toBe("rounded-2xl border border-slate-200 shadow-sm");
    expect(SHOP_THEMES.classic.headerDark).toBe(false);
  });
  it("falls back to classic for unknown ids", () => {
    expect(themeOf(undefined)).toBe(SHOP_THEMES.classic);
    expect(themeOf("nope")).toBe(SHOP_THEMES.classic);
    expect(themeOf("bold").headerDark).toBe(true);
    expect(themeOf("minimal")).toBe(SHOP_THEMES.minimal);
  });
});
