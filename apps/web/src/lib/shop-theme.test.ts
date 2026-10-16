import { describe, expect, it } from "vitest";
import { SHOP_THEMES, themeIdOf, themeOf } from "./shop-theme";

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

  // ED1 (Tokens v3): the full theme objects are pinned verbatim —
  // the ED1 token layer deliberately does NOT re-express these
  // strings, and any future change must land as a spec change too.
  it("pins every theme object byte-for-byte (ED1)", () => {
    expect(SHOP_THEMES.classic.cardImageWrapClass).toBe("");
    expect(SHOP_THEMES.bold).toEqual({
      headerDark: true,
      heroClass: "rounded-3xl bg-slate-900 p-8 text-center shadow-md border border-slate-900 text-white",
      heroTitleClass: "text-3xl font-black text-white sm:text-5xl",
      gridClass: "grid grid-cols-2 gap-4 md:grid-cols-2 lg:grid-cols-3",
      featuredGridClass: "grid grid-cols-2 gap-4 md:grid-cols-3",
      cardClass: "rounded-xl border-2 border-slate-900/10 shadow-md",
      cardImageWrapClass: "",
    });
    expect(SHOP_THEMES.minimal).toEqual({
      headerDark: false,
      heroClass: "p-8 text-left",
      heroTitleClass: "text-2xl font-black text-slate-900",
      gridClass: "grid grid-cols-2 gap-6 md:grid-cols-3 lg:grid-cols-4",
      featuredGridClass: "grid grid-cols-2 gap-6 md:grid-cols-4",
      cardClass: "rounded-none border-0 shadow-none",
      cardImageWrapClass: "",
    });
    expect(themeIdOf("classic")).toBe("classic");
    expect(themeIdOf(42)).toBe("classic");
  });
});
