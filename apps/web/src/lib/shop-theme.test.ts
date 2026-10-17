import { describe, expect, it } from "vitest";
import {
  SHOP_THEMES,
  THEME_ID_LIST,
  effectiveThemeId,
  isV2Theme,
  previewThemeIdFromHeaders,
  themeIdOf,
  themeOf,
} from "./shop-theme";

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
    // UNION regeneration (2026-10-17): OU8's theme gallery added the
    // "warm" and "ocean" themes on top of main's 21 — the union list
    // is 23 and both additions are real SHOP_THEMES entries.
    expect(THEME_ID_LIST).toHaveLength(23);
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
      "v2",
      "warm",
      "ocean",
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
      pageBgClass: "bg-slate-100",
      nameBn: "বোল্ড",
      descBn: "বড় হিরো, গাঢ় রঙ ও নজরকাড়া অফার",
    });
    expect(SHOP_THEMES.minimal).toEqual({
      headerDark: false,
      heroClass: "p-8 text-left",
      heroTitleClass: "text-2xl font-black text-slate-900",
      gridClass: "grid grid-cols-2 gap-6 md:grid-cols-3 lg:grid-cols-4",
      featuredGridClass: "grid grid-cols-2 gap-6 md:grid-cols-4",
      cardClass: "rounded-none border-0 shadow-none",
      cardImageWrapClass: "",
      pageBgClass: "bg-white",
      nameBn: "মিনিমাল",
      descBn: "হালকা, পরিষ্কার, পণ্যে সরাসরি ফোকাস",
    });
    expect(themeIdOf("classic")).toBe("classic");
    expect(themeIdOf(42)).toBe("classic");
  });

  // ED7: legacy themes omit the new optional v2 fields entirely,
  // so consumers fall back to their current rendering.
  it("legacy themes omit the optional ED7 fields", () => {
    for (const id of ["classic", "bold", "minimal"] as const) {
      expect("cardBodyClass" in SHOP_THEMES[id]).toBe(false);
      expect("cardPriceClass" in SHOP_THEMES[id]).toBe(false);
      expect("sectionTitleClass" in SHOP_THEMES[id]).toBe(false);
    }
  });

  it("pins the v2 theme object (ED7)", () => {
    expect(SHOP_THEMES.v2).toEqual({
      headerDark: false,
      heroClass: "rounded-[var(--radius-xl)] bg-[var(--surface)] p-8 text-center shadow-[var(--shadow-card)] border border-[var(--border-soft)]",
      heroTitleClass: "text-3xl font-black text-[var(--ink-strong)] sm:text-4xl",
      gridClass: "grid grid-cols-2 gap-4 md:grid-cols-3 lg:grid-cols-4",
      featuredGridClass: "grid grid-cols-2 gap-4 md:grid-cols-4",
      cardClass: "rounded-[var(--radius-lg)] border border-[var(--border-soft)] bg-[var(--surface)] shadow-[var(--shadow-card)]",
      cardImageWrapClass: "",
      cardBodyClass: "space-y-1.5 p-4 text-[var(--ink-body)]",
      cardPriceClass: "text-base font-extrabold text-[var(--brand)]",
      sectionTitleClass: "text-xl font-black text-[var(--ink-strong)]",
    });
    expect(themeIdOf("v2")).toBe("v2");
    expect(themeOf("v2")).toBe(SHOP_THEMES.v2);
  });

  it("isV2Theme / effectiveThemeId (ED7)", () => {
    expect(isV2Theme("v2")).toBe(true);
    expect(isV2Theme("classic")).toBe(false);
    expect(isV2Theme(undefined)).toBe(false);
    expect(isV2Theme(42)).toBe(false);
    // Preview wins only when it is a valid theme id.
    expect(effectiveThemeId("classic", "v2")).toBe("v2");
    expect(effectiveThemeId("bold", "v2")).toBe("v2");
    expect(effectiveThemeId("classic", "bold")).toBe("bold");
    expect(effectiveThemeId("v2", null)).toBe("v2");
    expect(effectiveThemeId("bold", undefined)).toBe("bold");
    expect(effectiveThemeId("classic", "nope")).toBe("classic");
    expect(effectiveThemeId("classic", 42)).toBe("classic");
    expect(effectiveThemeId(undefined, null)).toBe("classic");
    expect(effectiveThemeId("nope", "nope")).toBe("classic");
  });

  it("previewThemeIdFromHeaders reads the preview header (ED7)", () => {
    const withPreview = { get: (n: string) => (n === "x-shop-theme-preview" ? "v2" : null) };
    const without = { get: (_n: string) => null };
    expect(previewThemeIdFromHeaders(withPreview)).toBe("v2");
    expect(previewThemeIdFromHeaders(without)).toBe(null);
    // Raw value passes through; validity is effectiveThemeId's job.
    expect(effectiveThemeId("classic", previewThemeIdFromHeaders(withPreview))).toBe("v2");
    expect(effectiveThemeId("bold", previewThemeIdFromHeaders(without))).toBe("bold");
  });
});
