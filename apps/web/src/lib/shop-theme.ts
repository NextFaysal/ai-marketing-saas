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
 * theme layout strings stay verbatim. EB3's Shop v2 theme will be
 * the first theme authored natively on tokens.
 */
export type ShopThemeId = "classic" | "bold" | "minimal";

export interface ShopTheme {
  headerDark: boolean;
  heroClass: string;
  heroTitleClass: string;
  gridClass: string;
  featuredGridClass: string;
  cardClass: string;
  cardImageWrapClass: string;
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
};

export function themeOf(id: unknown): ShopTheme {
  if (id === "bold" || id === "minimal" || id === "classic") return SHOP_THEMES[id];
  return SHOP_THEMES.classic;
}

export function themeIdOf(id: unknown): ShopThemeId {
  if (id === "bold" || id === "minimal" || id === "classic") return id;
  return "classic";
}
