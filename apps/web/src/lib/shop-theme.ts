/**
 * GC — shop theme tokens keyed by settings.themeId.
 * Supports ready-to-use themes for different Bangladeshi & global commerce niches plus token-native v2.
 * "classic" MUST equal the pre-theme classes exactly for backwards compatibility.
 */
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
    nameBn: "ক্লাসিক",
    descBn: "চেনা, ভারসাম্যপূর্ণ ও স্ট্যান্ডার্ড শপ লুক",
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
    nameBn: "বোল্ড",
    descBn: "বড় হিরো, গাঢ় রঙ ও নজরকাড়া অফার",
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
    nameBn: "মিনিমাল",
    descBn: "হালকা, পরিষ্কার, পণ্যে সরাসরি ফোকাস",
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
    nameBn: "লাক্সারি",
    descBn: "অভিজাত ব্ল্যাক ও গোল্ডেন ভাইব — গয়না, ঘড়ি ও প্রিমিয়াম ব্র্যান্ড",
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
    nameBn: "অর্গানিক",
    descBn: "প্রাকৃতিক সবুজ ও মাটির টান — অর্গানিক ফুড ও ভেষজ পণ্য",
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
    nameBn: "ভাইব্রেন্ট",
    descBn: "উজ্জ্বল রঙের ছোঁয়া — ফ্যাশন, গিফট ও ট্রেন্ডি আইটেম",
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
    nameBn: "মডার্ন টেক",
    descBn: "হাই-টেক ফিনিশ — গ্যাজেট, কম্পিউটার ও স্মার্ট অ্যাকসেসরিজ",
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
    nameBn: "প্যাস্টেল",
    descBn: "নরম মিষ্টি রং — স্কিনকেয়ার, কসমেটিকস ও ওমেন্স কালেকশন",
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
    nameBn: "নর্ডিক",
    descBn: "স্ক্যান্ডিনেভিয়ান কাঠ ও ওয়ার্ম ফিনিশ — হোম ডেকর ও লাইফস্টাইল",
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
    nameBn: "মিডনাইট",
    descBn: "ট্রু ডার্ক মোড ও নিয়ন অ্যাকসেন্ট — স্ট্রিটওয়্যার, ফ্যাশন ও ইউথ ব্র্যান্ড",
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
    nameBn: "ফ্যাশন ও ক্লদিং",
    descBn: "৩:৪ পোর্ট্রেট কার্ড, সাইজ সিলেক্টর, জেন্ডার ডিপার্টমেন্ট ও সাইজ গাইড (আড়ং / ইয়েলো স্টাইল)",
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
    nameBn: "ইলেকট্রনিক্স ও গ্যাজেটস",
    descBn: "টেক স্পেকস, ব্র্যান্ড ওয়ারেন্টি, EMI ক্যালকুলেটর ও গ্যাজেট কম্পেয়ার (স্টার টেক / রায়ান্স স্টাইল)",
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
    nameBn: "গ্রোসারি ও অর্গানিক ফুডস",
    descBn: "১ ঘণ্টার এক্সপ্রেস ডেলিভারি, ওজন/কেজি সিলেক্টর, ইনস্ট্যান্ট কোয়ান্টিটি স্টেপার ও অর্গানিক ল্যাব সার্টিফিকেট (চালডাল / খাস ফুড স্টাইল)",
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
    nameBn: "হেলথ, বিউটি ও কসমেটিক্স",
    descBn: "১০০% অরিজিনাল অথেন্টিসিটি সনদ, স্কিন টাইপ ম্যাচিং, রুটিন কম্বো ও শেড পিকার (সাজগোজ / বাংলাশপার্স স্টাইল)",
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
    nameBn: "হোম ডেকর ও ফার্নিচার",
    descBn: "১০ বছরের স্ট্রাকচারাল ওয়ারেন্টি, সেগুন/ওক কাঠ ও ফিনিশ সিলেক্টর, রুম সেট বান্ডেল ও ফিটিং সার্ভিস (হাতিল / অটবি / ইশো স্টাইল)",
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
    nameBn: "বই, প্রকাশনী ও স্টেশনারি",
    descBn: "একটু পড়ে দেখুন (Look Inside) প্রিভিউয়ার, লেখক ও প্রকাশনী ফিল্টার, বাইন্ডিং সিলেক্টর ও বইমেলা কালেকশন (রকমারি / বাতিঘর স্টাইল)",
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
    nameBn: "বেবি কেয়ার, টয়স ও কিডস ফ্যাশন",
    descBn: "বয়স ভিত্তিক সাইজ সিলেক্টর, ১০০% নন-টক্সিক ও BPA-Free গ্যারান্টি, নিউবর্ন গিফট হ্যাম্পার ও লার্নিং স্কিল ট্যাগ (হপসকচ / বেবি শপ বিডি স্টাইল)",
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
    nameBn: "অটোমোটিভ, বাইক ও মোটর পার্টস",
    descBn: "বাইক মডেল ফিটমেন্ট চেকার, ইঞ্জিন অয়েল ভিসকোসিটি সিলেক্টর, ১০০% জেনুইন পার্টস সনদ ও পিরিওডিক সার্ভিসিং কম্বো (বাইকবিডি / মোটরপার্টস বিডি স্টাইল)",
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
    nameBn: "স্পোর্টস, ফিটনেস ও জিম ইকুইপমেন্ট",
    descBn: "ডাম্বেল ও প্লেট সাইজ সিলেক্টর, হোম জিম অ্যাসেম্বলি ও টেকনিশিয়ান রিকোয়েস্ট, ১০০% অরিজিনাল অ্যাথলেটিক গিয়ার ও ওয়ার্কআউট কম্বো (ডেক্যাথলন / স্পোর্টস ওয়ার্ল্ড স্টাইল)",
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
    nameBn: "জুয়েলারি, ডায়মন্ড ও লাক্সারি ওয়াচেস",
    descBn: "২২ ক্যারেট হলমার্ক গোল্ড সনদ, ডায়মন্ড ৪সি সার্টিফিকেট, রিং সাইজ গাইড ও ব্রাইডাল জুয়েলারি সেট (আপন জুয়েলার্স / ডায়মন্ড ওয়ার্ল্ড / টাইম জোন বিডি স্টাইল)",
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
