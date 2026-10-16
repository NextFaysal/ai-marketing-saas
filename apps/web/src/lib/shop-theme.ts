/**
 * GC — shop theme tokens keyed by settings.themeId.
 * "classic" MUST equal the pre-theme classes exactly.
 *
 * ED1 (Design Tokens v3) note: these three themes' outputs are
 * literal Tailwind class strings — a compatibility contract, pinned
 * byte-for-byte by lib/shop-theme.test.ts. They deliberately do NOT
 * route through the CSS-variable token layer: their strings contain
 * no variable seam, and re-expressing them would change the class
 * output every existing shop renders with. The token layer reaches
 * the shop through the surfaces that DO have a seam — the per-org
 * --brand variable set by the shop layout, which drives .btn-brand
 * (the primary CTAs) and the v2 tokens (--surface/--ink-*) — while
 * theme layout strings stay verbatim. EB3's Shop v2 theme ("v2",
 * added in ED7) IS the first theme authored natively on tokens:
 * its class strings are built on the EB1 CSS variables
 * (--surface / --border-soft / --shadow-card / --radius-* / ink
 * tokens) via Tailwind arbitrary values. The three legacy themes
 * (classic / bold / minimal) remain literal pinned strings.
 */
export type ShopThemeId = "classic" | "bold" | "minimal" | "v2";

export interface ShopTheme {
  headerDark: boolean;
  heroClass: string;
  heroTitleClass: string;
  gridClass: string;
  featuredGridClass: string;
  cardClass: string;
  cardImageWrapClass: string;
  // ED7: optional v2 surfaces (ED8 consumes them). The legacy
  // themes OMIT these keys entirely — consumers must fall back to
  // their current rendering when a field is undefined.
  cardBodyClass?: string;
  cardPriceClass?: string;
  sectionTitleClass?: string;
}

export const SHOP_THEMES: Record<ShopThemeId, ShopTheme> = {
  classic: {
    headerDark: false,
    heroClass: "rounded-3xl bg-white p-8 text-center shadow-sm border border-slate-200",
    heroTitleClass: "text-3xl font-black text-slate-900 sm:text-4xl",
    gridClass: "grid grid-cols-2 gap-4 md:grid-cols-3 lg:grid-cols-4",
    featuredGridClass: "grid grid-cols-2 gap-4 md:grid-cols-4",
    cardClass: "rounded-2xl border border-slate-200 shadow-sm",
    cardImageWrapClass: "",
  },
  bold: {
    headerDark: true,
    heroClass: "rounded-3xl bg-slate-900 p-8 text-center shadow-md border border-slate-900 text-white",
    heroTitleClass: "text-3xl font-black text-white sm:text-5xl",
    gridClass: "grid grid-cols-2 gap-4 md:grid-cols-2 lg:grid-cols-3",
    featuredGridClass: "grid grid-cols-2 gap-4 md:grid-cols-3",
    cardClass: "rounded-xl border-2 border-slate-900/10 shadow-md",
    cardImageWrapClass: "",
  },
  minimal: {
    headerDark: false,
    heroClass: "p-8 text-left",
    heroTitleClass: "text-2xl font-black text-slate-900",
    gridClass: "grid grid-cols-2 gap-6 md:grid-cols-3 lg:grid-cols-4",
    featuredGridClass: "grid grid-cols-2 gap-6 md:grid-cols-4",
    cardClass: "rounded-none border-0 shadow-none",
    cardImageWrapClass: "",
  },
  // ED7: token-native v2 — every colour / radius / shadow below
  // resolves through the EB1 CSS variables, so the shop follows
  // the token layer (and a future dark palette) instead of literal
  // slate/indigo values. Grid rhythm matches classic (2 → 3 → 4).
  v2: {
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
  },
};

export function themeOf(id: unknown): ShopTheme {
  if (id === "bold" || id === "minimal" || id === "classic" || id === "v2") return SHOP_THEMES[id];
  return SHOP_THEMES.classic;
}

export function themeIdOf(id: unknown): ShopThemeId {
  if (id === "bold" || id === "minimal" || id === "classic" || id === "v2") return id;
  return "classic";
}

/** ED7: true only for the token-native v2 theme. */
export function isV2Theme(id: unknown): boolean {
  return id === "v2";
}

/**
 * ED7: the theme a request actually renders with. A preview id
 * wins ONLY when it is itself a valid theme id; anything else
 * (missing, unknown, non-string) falls back to the stored id's
 * own resolution (which itself falls back to classic).
 */
export function effectiveThemeId(storedId: unknown, previewId: unknown): ShopThemeId {
  if (previewId === "bold" || previewId === "minimal" || previewId === "classic" || previewId === "v2") {
    return previewId;
  }
  return themeIdOf(storedId);
}
