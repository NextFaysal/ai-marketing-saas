/**
 * GC — shop theme tokens keyed by settings.themeId.
 * Supports ready-to-use themes for different Bangladeshi & global commerce niches plus token-native v2.
 * "classic" MUST equal the pre-theme classes exactly for backwards compatibility.
 */
import { ordersBn, ordersEn } from "@/lib/i18n/orders";
import { interpolate } from "@/lib/i18n/lookup";

export type ShopThemeId =
  | "classic"
  | "bold"
  | "minimal"
  | "luxury"
  | "organic"
  | "vibrant"
  | "modern"
  | "pastel"
  | "nordic"
  | "midnight"
  | "fashion"
  | "electronics"
  | "grocery"
  | "beauty"
  | "furniture"
  | "books"
  | "kids"
  | "automotive"
  | "sports"
  | "jewelry"
  | "v2"
  | "warm"
  | "ocean";

export interface ShopTheme {
  headerDark: boolean;
  heroClass: string;
  heroTitleClass: string;
  gridClass: string;
  featuredGridClass: string;
  cardClass: string;
  cardImageWrapClass: string;
  pageBgClass?: string;
  nameBn?: string;
  descBn?: string;
  // ED7: optional v2 surfaces (ED8 consumes them).
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
    pageBgClass: "bg-slate-50",
    nameBn: ordersBn.classic,
    descBn: ordersBn.familiarBalancedStandardShopLook,
  },
  bold: {
    headerDark: true,
    heroClass: "rounded-3xl bg-slate-900 p-8 text-center shadow-md border border-slate-900 text-white",
    heroTitleClass: "text-3xl font-black text-white sm:text-5xl",
    gridClass: "grid grid-cols-2 gap-4 md:grid-cols-2 lg:grid-cols-3",
    featuredGridClass: "grid grid-cols-2 gap-4 md:grid-cols-3",
    cardClass: "rounded-xl border-2 border-slate-900/10 shadow-md",
    cardImageWrapClass: "",
    pageBgClass: "bg-slate-100",
    nameBn: ordersBn.bold,
    descBn: ordersBn.bigHeroDarkColorsEye,
  },
  minimal: {
    headerDark: false,
    heroClass: "p-8 text-left",
    heroTitleClass: "text-2xl font-black text-slate-900",
    gridClass: "grid grid-cols-2 gap-6 md:grid-cols-3 lg:grid-cols-4",
    featuredGridClass: "grid grid-cols-2 gap-6 md:grid-cols-4",
    cardClass: "rounded-none border-0 shadow-none",
    cardImageWrapClass: "",
    pageBgClass: "bg-white",
    nameBn: ordersBn.minimal,
    descBn: ordersBn.lightCleanDirectFocusOn,
  },
  luxury: {
    headerDark: true,
    heroClass: "rounded-3xl bg-gradient-to-br from-zinc-900 via-neutral-900 to-black p-10 text-center shadow-xl border border-amber-500/30 text-amber-100",
    heroTitleClass: "text-3xl font-serif font-black tracking-wider text-amber-300 sm:text-5xl",
    gridClass: "grid grid-cols-2 gap-5 md:grid-cols-3 lg:grid-cols-4",
    featuredGridClass: "grid grid-cols-2 gap-5 md:grid-cols-4",
    cardClass: "rounded-2xl border border-amber-500/20 shadow-lg bg-zinc-900 text-zinc-100 hover:border-amber-400/50",
    cardImageWrapClass: "rounded-t-2xl overflow-hidden",
    pageBgClass: "bg-zinc-950 text-zinc-100",
    nameBn: ordersBn.luxury,
    descBn: ordersBn.eliteBlackGoldenVibeJewellery,
  },
  organic: {
    headerDark: false,
    heroClass: "rounded-3xl bg-emerald-900 p-8 text-center shadow-md border border-emerald-800 text-emerald-50",
    heroTitleClass: "text-3xl font-black text-emerald-100 sm:text-4xl",
    gridClass: "grid grid-cols-2 gap-4 md:grid-cols-3 lg:grid-cols-4",
    featuredGridClass: "grid grid-cols-2 gap-4 md:grid-cols-4",
    cardClass: "rounded-3xl border border-emerald-100/90 bg-white shadow-sm hover:border-emerald-300 hover:shadow-md",
    cardImageWrapClass: "rounded-t-3xl overflow-hidden",
    pageBgClass: "bg-[#f7f8f5]",
    nameBn: ordersBn.organic,
    descBn: ordersBn.naturalGreenEarthyTonesOrganic,
  },
  vibrant: {
    headerDark: false,
    heroClass: "rounded-3xl bg-gradient-to-r from-violet-600 via-fuchsia-600 to-pink-500 p-8 text-center shadow-lg text-white",
    heroTitleClass: "text-3xl font-black text-white sm:text-4xl tracking-tight",
    gridClass: "grid grid-cols-2 gap-4 md:grid-cols-3 lg:grid-cols-4",
    featuredGridClass: "grid grid-cols-2 gap-4 md:grid-cols-4",
    cardClass: "rounded-3xl border-2 border-violet-100 bg-white shadow-md hover:shadow-xl hover:border-violet-300",
    cardImageWrapClass: "rounded-t-3xl overflow-hidden",
    pageBgClass: "bg-amber-50/30",
    nameBn: ordersBn.vibrant,
    descBn: ordersBn.aTouchOfBrightColors,
  },
  modern: {
    headerDark: true,
    heroClass: "rounded-3xl bg-gradient-to-b from-indigo-950 via-slate-900 to-slate-950 p-8 text-center shadow-xl border border-indigo-500/30 text-indigo-100",
    heroTitleClass: "text-3xl font-extrabold text-white sm:text-4xl tracking-tight",
    gridClass: "grid grid-cols-2 gap-4 md:grid-cols-3 lg:grid-cols-4",
    featuredGridClass: "grid grid-cols-2 gap-4 md:grid-cols-4",
    cardClass: "rounded-2xl border border-slate-700/60 bg-slate-900 shadow-md text-white hover:border-indigo-500/50",
    cardImageWrapClass: "rounded-t-2xl overflow-hidden",
    pageBgClass: "bg-slate-950 text-slate-100",
    nameBn: ordersBn.modernTech,
    descBn: ordersBn.highTechFinishGadgetsComputers,
  },
  pastel: {
    headerDark: false,
    heroClass: "rounded-3xl bg-gradient-to-r from-rose-100 via-pink-100 to-rose-200 p-8 text-center shadow-sm border border-rose-200/60 text-slate-800",
    heroTitleClass: "text-3xl font-black text-rose-950 sm:text-4xl",
    gridClass: "grid grid-cols-2 gap-4 md:grid-cols-3 lg:grid-cols-4",
    featuredGridClass: "grid grid-cols-2 gap-4 md:grid-cols-4",
    cardClass: "rounded-2xl border border-pink-100 bg-white/95 shadow-sm hover:shadow-md hover:border-pink-300",
    cardImageWrapClass: "rounded-t-2xl overflow-hidden",
    pageBgClass: "bg-rose-50/30",
    nameBn: ordersBn.pastel,
    descBn: ordersBn.softSweetColorsSkincareCosmetics,
  },
  nordic: {
    headerDark: false,
    heroClass: "rounded-2xl bg-[#f0eae1] p-8 text-center border border-[#e4dcce] text-stone-900",
    heroTitleClass: "text-3xl font-bold tracking-tight text-stone-900 sm:text-4xl",
    gridClass: "grid grid-cols-2 gap-5 md:grid-cols-3 lg:grid-cols-4",
    featuredGridClass: "grid grid-cols-2 gap-5 md:grid-cols-4",
    cardClass: "rounded-xl border border-stone-200 bg-white shadow-xs hover:border-stone-400",
    cardImageWrapClass: "rounded-t-xl overflow-hidden",
    pageBgClass: "bg-[#fbf9f5]",
    nameBn: ordersBn.nordic,
    descBn: ordersBn.scandinavianWoodWarmFinishHome,
  },
  midnight: {
    headerDark: true,
    heroClass: "rounded-3xl bg-gradient-to-br from-[#0d1424] to-[#050811] p-8 text-center shadow-2xl border border-cyan-500/30 text-cyan-100",
    heroTitleClass: "text-3xl font-black text-cyan-300 sm:text-5xl tracking-wide",
    gridClass: "grid grid-cols-2 gap-4 md:grid-cols-3 lg:grid-cols-4",
    featuredGridClass: "grid grid-cols-2 gap-4 md:grid-cols-4",
    cardClass: "rounded-2xl border border-slate-800 bg-[#0f172a] shadow-lg text-white hover:border-cyan-400/60",
    cardImageWrapClass: "rounded-t-2xl overflow-hidden",
    pageBgClass: "bg-[#090d16] text-slate-100",
    nameBn: ordersBn.midnight,
    descBn: ordersBn.trueDarkModeNeonAccents,
  },
  fashion: {
    headerDark: false,
    heroClass: "relative overflow-hidden rounded-3xl bg-neutral-900 text-white shadow-2xl",
    heroTitleClass: "text-3xl font-black text-white sm:text-5xl font-serif tracking-tight",
    gridClass: "grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-4",
    featuredGridClass: "grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-4",
    cardClass: "group rounded-2xl bg-white border border-stone-200/80 shadow-xs hover:shadow-xl transition-all duration-300",
    cardImageWrapClass: "aspect-[3/4] overflow-hidden rounded-t-2xl",
    pageBgClass: "bg-[#faf9f6] text-stone-900",
    nameBn: ordersBn.fashionClothing,
    descBn: ordersBn.text1shnio4,
  },
  electronics: {
    headerDark: true,
    heroClass: "relative overflow-hidden rounded-3xl bg-gradient-to-r from-slate-950 via-slate-900 to-indigo-950 text-white shadow-2xl border border-indigo-500/20",
    heroTitleClass: "text-3xl font-black text-white sm:text-5xl tracking-tight",
    gridClass: "grid grid-cols-2 gap-3 sm:gap-4 md:grid-cols-3 lg:grid-cols-4",
    featuredGridClass: "grid grid-cols-2 gap-3 sm:gap-4 md:grid-cols-4",
    cardClass: "group rounded-2xl bg-white border border-slate-200/90 shadow-sm hover:shadow-xl hover:border-indigo-500/50 transition-all duration-300",
    cardImageWrapClass: "aspect-square overflow-hidden rounded-t-2xl bg-slate-50",
    pageBgClass: "bg-[#f4f6f9] text-slate-900",
    nameBn: ordersBn.electronicsGadgets,
    descBn: ordersBn.techSpecsBrandWarrantyEMI,
  },
  grocery: {
    headerDark: false,
    heroClass: "relative overflow-hidden rounded-3xl bg-gradient-to-r from-emerald-800 via-emerald-700 to-teal-800 text-white shadow-xl border border-emerald-600/30",
    heroTitleClass: "text-3xl font-black text-white sm:text-5xl tracking-tight",
    gridClass: "grid grid-cols-2 gap-3 sm:gap-4 md:grid-cols-3 lg:grid-cols-4",
    featuredGridClass: "grid grid-cols-2 gap-3 sm:gap-4 md:grid-cols-4",
    cardClass: "group rounded-2xl bg-white border border-emerald-100/90 shadow-sm hover:shadow-xl hover:border-emerald-500/50 transition-all duration-300",
    cardImageWrapClass: "aspect-square overflow-hidden rounded-t-2xl bg-emerald-50/30",
    pageBgClass: "bg-[#f8faf8] text-slate-900",
    nameBn: ordersBn.groceryOrganicFoods,
    descBn: ordersBn.text1guee61,
  },
  beauty: {
    headerDark: false,
    heroClass: "relative overflow-hidden rounded-3xl bg-gradient-to-r from-rose-950 via-pink-900 to-rose-900 text-white shadow-xl border border-rose-300/30",
    heroTitleClass: "text-3xl font-black text-white sm:text-5xl font-serif tracking-tight",
    gridClass: "grid grid-cols-2 gap-3 sm:gap-4 md:grid-cols-3 lg:grid-cols-4",
    featuredGridClass: "grid grid-cols-2 gap-3 sm:gap-4 md:grid-cols-4",
    cardClass: "group rounded-2xl bg-white border border-rose-100 shadow-sm hover:shadow-xl hover:border-pink-400/50 transition-all duration-300",
    cardImageWrapClass: "aspect-square overflow-hidden rounded-t-2xl bg-pink-50/20",
    pageBgClass: "bg-[#fffafb] text-slate-900",
    nameBn: ordersBn.healthBeautyCosmetics,
    descBn: ordersBn.textuiu3lr,
  },
  furniture: {
    headerDark: true,
    heroClass: "relative overflow-hidden rounded-3xl bg-gradient-to-r from-stone-950 via-amber-950 to-stone-900 text-white shadow-2xl border border-amber-600/30",
    heroTitleClass: "text-3xl font-black text-white sm:text-5xl font-serif tracking-tight",
    gridClass: "grid grid-cols-2 gap-3 sm:gap-5 md:grid-cols-3 lg:grid-cols-4",
    featuredGridClass: "grid grid-cols-2 gap-3 sm:gap-5 md:grid-cols-4",
    cardClass: "group rounded-2xl bg-white border border-stone-200/90 shadow-sm hover:shadow-2xl hover:border-amber-600/50 transition-all duration-300",
    cardImageWrapClass: "aspect-[4/3] overflow-hidden rounded-t-2xl bg-stone-100",
    pageBgClass: "bg-[#fcfbf9] text-stone-900",
    nameBn: ordersBn.homeDecorFurniture,
    descBn: ordersBn.text1rjema,
  },
  books: {
    headerDark: false,
    heroClass: "relative overflow-hidden rounded-3xl bg-gradient-to-r from-amber-950 via-[#3d1810] to-stone-900 text-white shadow-2xl border border-amber-500/20",
    heroTitleClass: "text-3xl font-black text-amber-50 sm:text-5xl font-serif tracking-tight",
    gridClass: "grid grid-cols-2 gap-3 sm:gap-5 md:grid-cols-3 lg:grid-cols-4",
    featuredGridClass: "grid grid-cols-2 gap-3 sm:gap-5 md:grid-cols-4",
    cardClass: "group rounded-2xl bg-white border border-amber-900/10 shadow-sm hover:shadow-xl hover:border-amber-700/40 transition-all duration-300",
    cardImageWrapClass: "aspect-[3/4] overflow-hidden rounded-t-2xl bg-amber-50/20",
    pageBgClass: "bg-[#fdfcf7] text-slate-900",
    nameBn: ordersBn.booksPublicationsStationery,
    descBn: ordersBn.lookInsidePreviewerAuthorPublisher,
  },
  kids: {
    headerDark: false,
    heroClass: "relative overflow-hidden rounded-3xl bg-gradient-to-r from-sky-400 via-teal-400 to-amber-300 text-slate-900 shadow-xl border border-sky-200",
    heroTitleClass: "text-3xl font-black text-slate-950 sm:text-5xl tracking-tight",
    gridClass: "grid grid-cols-2 gap-3 sm:gap-5 md:grid-cols-3 lg:grid-cols-4",
    featuredGridClass: "grid grid-cols-2 gap-3 sm:gap-5 md:grid-cols-4",
    cardClass: "group rounded-3xl bg-white border border-sky-100 shadow-sm hover:shadow-xl hover:border-sky-300 transition-all duration-300",
    cardImageWrapClass: "aspect-square overflow-hidden rounded-t-3xl bg-sky-50/50",
    pageBgClass: "bg-[#f9fcff] text-slate-900",
    nameBn: ordersBn.babyCareToysKidsFashion,
    descBn: ordersBn.ageBasedSizeSelector100,
  },
  automotive: {
    headerDark: true,
    heroClass: "relative overflow-hidden rounded-3xl bg-gradient-to-r from-zinc-950 via-neutral-900 to-red-950 text-white shadow-2xl border border-red-600/30",
    heroTitleClass: "text-3xl font-black text-white sm:text-5xl uppercase tracking-wider font-mono",
    gridClass: "grid grid-cols-2 gap-3 sm:gap-5 md:grid-cols-3 lg:grid-cols-4",
    featuredGridClass: "grid grid-cols-2 gap-3 sm:gap-5 md:grid-cols-4",
    cardClass: "group rounded-2xl bg-white border border-zinc-200 shadow-sm hover:shadow-2xl hover:border-red-500/50 transition-all duration-300",
    cardImageWrapClass: "aspect-square overflow-hidden rounded-t-2xl bg-zinc-100",
    pageBgClass: "bg-[#f5f6f8] text-zinc-900",
    nameBn: ordersBn.automotiveBikesMotorParts,
    descBn: ordersBn.bikeModelFitmentCheckerEngine,
  },
  sports: {
    headerDark: false,
    heroClass: "relative overflow-hidden rounded-3xl bg-gradient-to-r from-sky-950 via-slate-900 to-cyan-900 text-white shadow-2xl border border-sky-500/20",
    heroTitleClass: "text-3xl font-black text-white sm:text-5xl uppercase tracking-tight italic",
    gridClass: "grid grid-cols-2 gap-3 sm:gap-5 md:grid-cols-3 lg:grid-cols-4",
    featuredGridClass: "grid grid-cols-2 gap-3 sm:gap-5 md:grid-cols-4",
    cardClass: "group rounded-2xl bg-white border border-slate-200 shadow-sm hover:shadow-2xl hover:border-sky-500/50 transition-all duration-300",
    cardImageWrapClass: "aspect-square overflow-hidden rounded-t-2xl bg-slate-50",
    pageBgClass: "bg-[#f8fafc] text-slate-900",
    nameBn: ordersBn.sportsFitnessGymEquipment,
    descBn: ordersBn.dumbbellPlateSizeSelectorHome,
  },
  jewelry: {
    headerDark: true,
    heroClass: "relative overflow-hidden rounded-3xl bg-gradient-to-r from-stone-950 via-[#1a1614] to-amber-950 text-white shadow-2xl border border-amber-500/30 font-serif",
    heroTitleClass: "text-3xl font-black text-amber-100 sm:text-5xl font-serif tracking-wide",
    gridClass: "grid grid-cols-2 gap-3 sm:gap-5 md:grid-cols-3 lg:grid-cols-4",
    featuredGridClass: "grid grid-cols-2 gap-3 sm:gap-5 md:grid-cols-4",
    cardClass: "group rounded-2xl bg-white border border-amber-900/15 shadow-sm hover:shadow-2xl hover:border-amber-500/50 transition-all duration-300",
    cardImageWrapClass: "aspect-square overflow-hidden rounded-t-2xl bg-stone-50",
    pageBgClass: "bg-[#faf9f6] text-stone-900",
    nameBn: ordersBn.jewelleryDiamondsLuxuryWatches,
    descBn: ordersBn.textk17nm5,
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
  // OU8: token-native "warm" — soft amber-tinted surfaces, extra
  // rounded corners and a roomier grid rhythm. Authored on the
  // same EB1 variables as v2 (so --brand drives its price colour)
  // with its own literal hero tint.
  warm: {
    headerDark: false,
    heroClass: "rounded-[2rem] bg-amber-50 p-8 text-center shadow-[var(--shadow-card)] border border-amber-200",
    heroTitleClass: "text-3xl font-black text-amber-950 sm:text-4xl",
    gridClass: "grid grid-cols-2 gap-5 md:grid-cols-3 lg:grid-cols-4",
    featuredGridClass: "grid grid-cols-2 gap-5 md:grid-cols-4",
    cardClass: "rounded-[var(--radius-xl)] border border-amber-100 bg-[var(--surface)] shadow-[var(--shadow-card)]",
    cardImageWrapClass: "",
    cardBodyClass: "space-y-1.5 p-4 text-[var(--ink-body)]",
    cardPriceClass: "text-base font-extrabold text-[var(--brand)]",
    sectionTitleClass: "text-xl font-black text-amber-950",
  },
  // OU8: token-native "ocean" — deep-teal dark header + hero,
  // tighter 3-column desktop grid, squared-off cards.
  ocean: {
    headerDark: true,
    heroClass: "rounded-[var(--radius-lg)] bg-cyan-950 p-8 text-center shadow-[var(--shadow-card)] border border-cyan-900 text-white",
    heroTitleClass: "text-3xl font-black text-white sm:text-4xl",
    gridClass: "grid grid-cols-2 gap-4 md:grid-cols-3 lg:grid-cols-3",
    featuredGridClass: "grid grid-cols-2 gap-4 md:grid-cols-3",
    cardClass: "rounded-[var(--radius-lg)] border border-cyan-100 bg-[var(--surface)] shadow-[var(--shadow-card)]",
    cardImageWrapClass: "",
    cardBodyClass: "space-y-1.5 p-4 text-[var(--ink-body)]",
    cardPriceClass: "text-base font-extrabold text-cyan-700",
    sectionTitleClass: "text-xl font-black text-cyan-950",
  },
};

export const THEME_ID_LIST: ShopThemeId[] = [
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

export function themeOf(id: unknown): ShopTheme {
  if (typeof id === "string" && id in SHOP_THEMES) {
    return SHOP_THEMES[id as ShopThemeId];
  }
  return SHOP_THEMES.classic;
}

export function themeIdOf(id: unknown): ShopThemeId {
  if (typeof id === "string" && id in SHOP_THEMES) {
    return id as ShopThemeId;
  }
  return "classic";
}

/** ED7: true only for the token-native v2 theme. */
export function isV2Theme(id: unknown): boolean {
  return id === "v2";
}

/**
 * ED8: v2 detection from a RESOLVED tokens object. ShopTheme
 * carries no id, so consumers that receive tokens (ProductCard)
 * detect v2 by the presence of the v2-only optional fields ED7
 * added — the legacy themes omit them entirely (pinned by
 * shop-theme.test.ts). This is THE chosen detection approach for
 * token consumers; do not invent id-string checks there.
 */
export function isV2Tokens(theme: ShopTheme): boolean {
  return theme.cardPriceClass !== undefined;
}

/**
 * ED7: the theme a request actually renders with. A preview id
 * wins ONLY when it is itself a valid theme id; anything else
 * (missing, unknown, non-string) falls back to the stored id's
 * own resolution (which itself falls back to classic).
 */
export function effectiveThemeId(storedId: unknown, previewId: unknown): ShopThemeId {
  if (typeof previewId === "string" && previewId in SHOP_THEMES) {
    return previewId as ShopThemeId;
  }
  return themeIdOf(storedId);
}

/** Request header the middleware sets for a ?themePreview=v2 view. */
export const SHOP_THEME_PREVIEW_HEADER = "x-shop-theme-preview";

/**
 * ED7: read the theme-preview id from a Headers-like object (any
 * { get(name) } — so this stays unit-testable without next/headers).
 * Returns the raw header value, or null when absent; validity is
 * effectiveThemeId's job, not this reader's.
 */
export function previewThemeIdFromHeaders(h: { get(name: string): string | null }): string | null {
  return h.get(SHOP_THEME_PREVIEW_HEADER);
}

/** ML5 i18n: dict keys for each theme's name/description so the
 * dashboard theme picker can render them in the active locale
 * (the ShopTheme nameBn/descBn fields stay the bn defaults). */
export const THEME_TEXT_KEYS: Record<string, { name: string; desc: string }> = {
  classic: { name: "classic", desc: "familiarBalancedStandardShopLook" },
  bold: { name: "bold", desc: "bigHeroDarkColorsEye" },
  minimal: { name: "minimal", desc: "lightCleanDirectFocusOn" },
  luxury: { name: "luxury", desc: "eliteBlackGoldenVibeJewellery" },
  organic: { name: "organic", desc: "naturalGreenEarthyTonesOrganic" },
  vibrant: { name: "vibrant", desc: "aTouchOfBrightColors" },
  modern: { name: "modernTech", desc: "highTechFinishGadgetsComputers" },
  pastel: { name: "pastel", desc: "softSweetColorsSkincareCosmetics" },
  nordic: { name: "nordic", desc: "scandinavianWoodWarmFinishHome" },
  midnight: { name: "midnight", desc: "trueDarkModeNeonAccents" },
  fashion: { name: "fashionClothing", desc: "text1shnio4" },
  electronics: { name: "electronicsGadgets", desc: "techSpecsBrandWarrantyEMI" },
  grocery: { name: "groceryOrganicFoods", desc: "text1guee61" },
  beauty: { name: "healthBeautyCosmetics", desc: "textuiu3lr" },
  furniture: { name: "homeDecorFurniture", desc: "text1rjema" },
  books: { name: "booksPublicationsStationery", desc: "lookInsidePreviewerAuthorPublisher" },
  kids: { name: "babyCareToysKidsFashion", desc: "ageBasedSizeSelector100" },
  automotive: { name: "automotiveBikesMotorParts", desc: "bikeModelFitmentCheckerEngine" },
  sports: { name: "sportsFitnessGymEquipment", desc: "dumbbellPlateSizeSelectorHome" },
  jewelry: { name: "jewelleryDiamondsLuxuryWatches", desc: "textk17nm5" }
};
export function shopThemeText(
  id: string,
  locale: "bn" | "en" = "bn",
): { name: string; desc: string } | null {
  const keys = THEME_TEXT_KEYS[id];
  const theme = SHOP_THEMES[id as ShopThemeId];
  if (!theme) return null;
  if (!keys || locale === "bn") return { name: theme.nameBn ?? id, desc: theme.descBn ?? "" };
  const en = ordersEn as unknown as Record<string, string>;
  return { name: en[keys.name] ?? theme.nameBn ?? id, desc: en[keys.desc] ?? theme.descBn ?? "" };
}
