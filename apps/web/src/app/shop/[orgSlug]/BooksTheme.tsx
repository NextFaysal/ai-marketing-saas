"use client";
import React, { useState } from "react";
import Link from "next/link";
import { fmtMoneyMinor, fmtNumber } from "@repo/contracts";
import { MediaImage } from "@/components/media-image";
import type { ShopHome, ShopProduct } from "@/lib/storefront-server";
import { patchCartLine, notifyCartUpdated } from "@/lib/storefront-cart";
import { shopT, type ShopLocale } from "@/lib/shop-i18n";
import { SortSelect } from "./SortSelect";
import { FlashCountdown } from "./FlashCountdown";
import { RecentlyViewedStrip } from "./RecentlyViewed";

export function formatBooksPrice(minor: number | string | null | undefined, locale: string = "bn"): string {
  const loc: "bn" | "en" = locale === "en" ? "en" : "bn";
  if (minor == null) return fmtMoneyMinor(loc, 0);
  const num = typeof minor === "string" ? parseInt(minor, 10) : minor;
  if (isNaN(num)) return fmtMoneyMinor(loc, 0);
  return fmtMoneyMinor(loc, Math.round(num / 100) * 100);
}

/** 4 Books Trust Pillars */
export function BooksTrustBar({ locale = "bn" }: { locale?: ShopLocale | string } = {}) {
  const t = shopT(locale);
  const pillars = [
    { icon: "📖", title: t.themeBooks.trust1Title, desc: t.themeBooks.trust1Desc },
    { icon: "🚚", title: t.themeBooks.trust2Title, desc: t.themeBooks.trust2Desc },
    { icon: "🔖", title: t.themeBooks.trust3Title, desc: t.themeBooks.trust3Desc },
    { icon: "🔄", title: t.themeBooks.trust4Title, desc: t.themeBooks.trust4Desc },
  ];
  return (
    <div className="grid grid-cols-2 gap-3 sm:grid-cols-4 sm:gap-4 my-6">
      {pillars.map((p, i) => (
        <div
          key={i}
          className="flex items-center gap-3 rounded-2xl border border-amber-900/10 bg-[#fbf9f4] p-3.5 shadow-xs transition hover:border-amber-700/30"
        >
          <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-amber-100 text-xl">
            {p.icon}
          </span>
          <div className="min-w-0">
            <h4 className="text-xs font-bold text-amber-950 sm:text-sm">{p.title}</h4>
            <p className="text-[11px] text-amber-900/70 truncate">{p.desc}</p>
          </div>
        </div>
      ))}
    </div>
  );
}

/** "একটু পড়ে দেখুন" (Look Inside / First Few Pages Reader Modal) */
export function BooksLookInsideModal({
  open,
  onClose,
  productName,
  locale = "bn",
}: {
  open: boolean;
  onClose: () => void;
  productName: string;
  locale?: ShopLocale | string;
}) {
  const t = shopT(locale);
  const [currentPage, setCurrentPage] = useState(1);
  const [readerTheme, setReaderTheme] = useState<"sepia" | "light" | "dark">("sepia");
  const [fontSize, setFontSize] = useState<"sm" | "base" | "lg">("base");

  if (!open) return null;

  const samplePages = [
    {
      page: 1,
      title: "সূচিপত্র ও মুখবন্ধ",
      text: `সূচিপত্র:\n\n১. প্রথম অধ্যায় — কুয়াশাঢাকা ভোর (পৃষ্ঠা ৭)\n২. দ্বিতীয় অধ্যায় — রহস্যের সূত্রপাত (পৃষ্ঠা ২১)\n৩. তৃতীয় অধ্যায় — মধ্যরাতের বার্তা (পৃষ্ঠা ৪২)\n৪. চতুর্থ অধ্যায় — অন্ধকার নদীর তীরে (পৃষ্ঠা ৬৭)\n৫. পঞ্চম অধ্যায় — শেষ প্রহর (পৃষ্ঠা ৯৫)\n\nলেখকের কথা:\n"জীবন ও সাহিত্যের মাঝে যে অদৃশ্য সেতুবন্ধন থাকে, এই বইটি তারই এক আন্তরিক বহিঃপ্রকাশ। পাঠকদের ভালো লাগলেই আমার শ্রম সার্থক হবে।"\n— লেখক`,
    },
    {
      page: 2,
      title: "প্রথম পরিচ্ছেদ: কুয়াশাঢাকা ভোর",
      text: `ভোরের ঘন কুয়াশায় চারপাশ কেমন যেন থমথমে হয়ে আছে। জানালার কাঁচ বেয়ে শিশিরবিন্দু গড়িয়ে পড়ছে। দূর থেকে ভেসে আসছে একটা অচেনা পাখির ডাক।\n\nটেবিলের ওপর রাখা আধখাওয়া চায়ের কাপটা ততক্ষণে পুরোপুরি ঠান্ডা হয়ে গেছে। রাতভর নির্ঘুম কেটেছে শফিক সাহেবের। হাতে ধরা পুরানো খামটার ভেতরে থাকা চিঠিটা অন্তত বিশবার পড়া হয়ে গেছে। প্রতিটি শব্দের ভেতর লুকিয়ে আছে এক অমীমাংসিত সত্য।\n\nতিনি চশমাটা খুলে টেবিলের ওপর রাখলেন। বাইরে তখন ধীরে ধীরে ভোরের আলো ফুটতে শুরু করেছে...`,
    },
    {
      page: 3,
      title: "প্রথম পরিচ্ছেদ (চলমান)",
      text: `হঠাৎ দরজায় করাঘাত। মৃদু কিন্তু নিশ্চিত।\n\nএই অসময়ে কে আসতে পারে? শফিক সাহেব সাবধানে উঠে দাঁড়ালেন। কাঠের মেঝেতে তাঁর পা ফেলার শব্দ যেন অস্বাভাবিক ভারী শোনাল। তিনি দরজার কাছে এসে নিচু গলায় জিজ্ঞেস করলেন, "কে?"\n\nওপাশ থেকে কোনো কণ্ঠস্বর এলো না। শুধু একটা কাগজের টুকরো দরজার নিচ দিয়ে ঘরের ভেতর পিছলে ঢুকল। চিঠির গায়ে লাল কালিতে লেখা একটিমাত্র সংকেত...`,
    },
  ];

  const pageData = samplePages[currentPage - 1] ?? samplePages[0];

  const themeClasses = {
    sepia: "bg-[#fbf0d9] text-[#433422]",
    light: "bg-white text-slate-800",
    dark: "bg-stone-900 text-stone-200",
  };

  const fontClasses = {
    sm: "text-xs sm:text-sm leading-relaxed",
    base: "text-sm sm:text-base leading-relaxed sm:leading-loose",
    lg: "text-base sm:text-lg leading-loose",
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4 backdrop-blur-xs">
      <div className="flex max-h-[90vh] w-full max-w-2xl flex-col rounded-3xl border border-amber-900/20 bg-white shadow-2xl overflow-hidden animate-in fade-in zoom-in-95">
        {/* Header with reader controls */}
        <div className="flex flex-wrap items-center justify-between gap-2 border-b border-amber-900/10 bg-[#f7f4ec] px-5 py-3">
          <div className="min-w-0">
            <span className="text-[11px] font-bold uppercase tracking-wider text-amber-800">{t.themeBooks.previewLabel}</span>
            <h3 className="truncate font-serif text-base font-bold text-amber-950">{productName}</h3>
          </div>
          <div className="flex items-center gap-2">
            {/* Color mode switcher */}
            <div className="flex items-center rounded-lg border border-amber-900/10 bg-white p-0.5">
              <button
                type="button"
                onClick={() => setReaderTheme("sepia")}
                className={`rounded px-2 py-1 text-xs font-bold ${readerTheme === "sepia" ? "bg-amber-200 text-amber-900" : "text-slate-600"}`}
                title={t.themeBooks.sepiaTitle}
              >
                {t.themeBooks.sepia}
              </button>
              <button
                type="button"
                onClick={() => setReaderTheme("light")}
                className={`rounded px-2 py-1 text-xs font-bold ${readerTheme === "light" ? "bg-slate-200 text-slate-900" : "text-slate-600"}`}
                title={t.themeBooks.lightTitle}
              >
                {t.themeBooks.day}
              </button>
              <button
                type="button"
                onClick={() => setReaderTheme("dark")}
                className={`rounded px-2 py-1 text-xs font-bold ${readerTheme === "dark" ? "bg-stone-800 text-stone-100" : "text-slate-600"}`}
                title={t.themeBooks.darkTitle}
              >
                {t.themeBooks.night}
              </button>
            </div>
            {/* Font size toggle */}
            <div className="flex items-center rounded-lg border border-amber-900/10 bg-white p-0.5">
              <button
                type="button"
                onClick={() => setFontSize("sm")}
                className={`px-1.5 py-0.5 text-xs font-bold ${fontSize === "sm" ? "bg-amber-100 text-amber-900 rounded" : "text-slate-500"}`}
              >
                A-
              </button>
              <button
                type="button"
                onClick={() => setFontSize("base")}
                className={`px-1.5 py-0.5 text-xs font-bold ${fontSize === "base" ? "bg-amber-100 text-amber-900 rounded" : "text-slate-500"}`}
              >
                A
              </button>
              <button
                type="button"
                onClick={() => setFontSize("lg")}
                className={`px-1.5 py-0.5 text-xs font-bold ${fontSize === "lg" ? "bg-amber-100 text-amber-900 rounded" : "text-slate-500"}`}
              >
                A+
              </button>
            </div>
            <button
              type="button"
              onClick={onClose}
              className="flex h-8 w-8 items-center justify-center rounded-full text-slate-400 hover:bg-amber-200/50 hover:text-slate-700"
            >
              ✕
            </button>
          </div>
        </div>

        {/* Book Reader Page View */}
        <div className={`flex-1 overflow-y-auto p-6 sm:p-10 font-serif transition-colors ${themeClasses[readerTheme]}`}>
          <div className="mx-auto max-w-xl">
            <h4 className="mb-4 text-center font-bold text-lg border-b border-current/20 pb-2">
              {pageData.title}
            </h4>
            <div className={`whitespace-pre-line text-justify ${fontClasses[fontSize]}`}>
              {pageData.text}
            </div>
            <div className="mt-8 pt-4 border-t border-current/20 text-center text-xs opacity-75">
              {t.themeBooks.pageSamplePrefix}{fmtNumber(locale === "en" ? "en" : "bn", currentPage)}{t.themeBooks.pageSampleSuffix}
            </div>
          </div>
        </div>

        {/* Footer Navigation */}
        <div className="flex items-center justify-between border-t border-amber-900/10 bg-[#f7f4ec] px-5 py-3">
          <button
            type="button"
            disabled={currentPage <= 1}
            onClick={() => setCurrentPage((p) => Math.max(1, p - 1))}
            className="rounded-xl border border-amber-900/20 bg-white px-3 py-1.5 text-xs font-bold text-amber-950 disabled:opacity-40 hover:bg-amber-50"
          >
            {t.themeBooks.prevPage}
          </button>
          <span className="text-xs font-bold text-amber-900">
            {t.themeBooks.pageOfPrefix}{fmtNumber(locale === "en" ? "en" : "bn", currentPage)}{t.themeBooks.pageOfMid}{fmtNumber(locale === "en" ? "en" : "bn", samplePages.length)}
          </span>
          <button
            type="button"
            disabled={currentPage >= samplePages.length}
            onClick={() => setCurrentPage((p) => Math.min(samplePages.length, p + 1))}
            className="rounded-xl border border-amber-900/20 bg-white px-3 py-1.5 text-xs font-bold text-amber-950 disabled:opacity-40 hover:bg-amber-50"
          >
            {t.themeBooks.nextPage}
          </button>
        </div>
      </div>
    </div>
  );
}

/** Books Binding Format Selector (Hardcover, Paperback, Board Book) */
export function BooksBindingSelector({
  selectedBinding,
  onSelectBinding,
  locale = "bn",
}: {
  selectedBinding: string;
  onSelectBinding: (binding: string) => void;
  locale?: ShopLocale | string;
}) {
  const t = shopT(locale);
  const bindings = [
    { id: "hardcover", label: t.themeBooks.bindingHardcover, desc: t.themeBooks.bindingHardcoverDesc, badge: t.themeBooks.badgeBestseller },
    { id: "paperback", label: t.themeBooks.bindingPaperback, desc: t.themeBooks.bindingPaperbackDesc, badge: t.themeBooks.badgeValue },
    { id: "ebook", label: t.themeBooks.bindingEbook, desc: t.themeBooks.bindingEbookDesc, badge: t.themeBooks.badgeDigital },
  ];

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between">
        <label className="text-xs font-bold text-amber-950">
          {t.themeBooks.bindingLabel}<span className="text-amber-800 font-extrabold">{selectedBinding}</span>
        </label>
      </div>
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
        {bindings.map((b) => {
          const active = selectedBinding.includes(b.label);
          return (
            <button
              key={b.id}
              type="button"
              onClick={() => onSelectBinding(b.label)}
              className={`flex flex-col items-start rounded-xl p-2.5 text-left transition border ${
                active
                  ? "border-amber-700 bg-amber-50/70 shadow-xs ring-1 ring-amber-700"
                  : "border-amber-900/10 bg-white hover:border-amber-700/40"
              }`}
            >
              <div className="flex w-full items-center justify-between">
                <span className="font-serif text-xs font-extrabold text-amber-950">{b.label}</span>
                <span className="rounded bg-amber-200/60 px-1.5 py-0.2 text-[9px] font-bold text-amber-900">{b.badge}</span>
              </div>
              <span className="mt-1 text-[10px] text-amber-900/70">{b.desc}</span>
            </button>
          );
        })}
      </div>
    </div>
  );
}

/** Book Technical Specifications Table */
export function BooksDetailSpecs({ locale = "bn" }: { locale?: ShopLocale | string } = {}) {
  const t = shopT(locale);
  const specs = [
    { label: "আইএসবিএন (ISBN)", value: "978-984-502-841-3" },
    { label: "পৃষ্ঠা সংখ্যা", value: "২৮৮ পৃষ্ঠা (অফসেট পেপার)" },
    { label: "প্রকাশনী", value: "অন্যপ্রকাশ / প্রথমা প্রকাশন" },
    { label: "ভাষা ও লিপি", value: "বাংলা (ইউনিকোড প্রমিত)" },
    { label: "প্রথম প্রকাশ", value: "অমর একুশে বইমেলা ২০২৬" },
    { label: "সংস্করণ", value: "১ম সংস্করণ (পরিমার্জিত)" },
    { label: "ওজন", value: "৩৫০ গ্রাম (বুক প্যাকিং)" },
    { label: "দেশ", value: "বাংলাদেশ" },
  ];

  return (
    <div className="rounded-2xl border border-amber-900/10 bg-[#fbf9f4] p-4 text-xs">
      <h4 className="font-serif font-bold text-amber-950 text-sm mb-3 flex items-center gap-1.5">
        <span>📑</span> {t.themeBooks.specsHeading}
      </h4>
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
        {specs.map((s, idx) => (
          <div key={idx} className="rounded-xl border border-amber-900/5 bg-white p-2.5">
            <span className="block text-[10px] font-semibold text-amber-900/60">{s.label}</span>
            <span className="mt-0.5 block font-bold text-amber-950">{s.value}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

/** Author Profile Box */
export function BooksAuthorBox({
  authorName = "হুমায়ূন আহমেদ",
  locale = "bn",
}: {
  authorName?: string;
  locale?: ShopLocale | string;
}) {
  const t = shopT(locale);
  return (
    <div className="rounded-2xl border border-amber-900/15 bg-gradient-to-r from-amber-50 to-stone-50 p-4">
      <div className="flex items-start gap-3">
        <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-full bg-amber-800 text-xl font-bold text-white shadow-xs">
          ✍️
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center justify-between gap-1">
            <h4 className="font-serif text-sm font-extrabold text-amber-950">{authorName}</h4>
            <span className="rounded-full bg-amber-100 px-2 py-0.5 text-[10px] font-bold text-amber-900">
              {t.themeBooks.authorProfile}
            </span>
          </div>
          <p className="mt-1 text-xs leading-relaxed text-amber-900/80">
            বাংলা সাহিত্যের অন্যতম প্রধান কথাশিল্পী, ঔপন্যাসিক ও নাট্যকার। তাঁর রচিত চরিত্র হিমু, মিসির আলি ও শুভ্র বাংলা সাহিত্যে কালজয়ী স্থান করে নিয়েছে।
          </p>
          <div className="mt-2.5 flex items-center gap-2">
            <span className="text-[11px] font-bold text-amber-800">
              📚 এই লেখকের আরও ৪২টি বই আমাদের স্টোরে পাওয়া যাচ্ছে
            </span>
          </div>
        </div>
      </div>
    </div>
  );
}

/** 3-Book Reader Set Bundle with Discount */
export function BooksReadingBundle({
  orgSlug,
  mainProduct,
  locale = "bn",
}: {
  orgSlug: string;
  mainProduct: ShopProduct;
  locale?: ShopLocale | string;
}) {
  const t = shopT(locale);
  const [busy, setBusy] = useState(false);
  const [added, setAdded] = useState(false);

  const mainPrice = Number(mainProduct.priceMinor);
  const companion1Price = 38000; // ৳৩৮০
  const companion2Price = 45000; // ৳৪৫০
  const subtotal = mainPrice + companion1Price + companion2Price;
  const discountMinor = 25000; // ৳২৫০ ইনস্ট্যান্ট সেভিংস
  const comboPrice = subtotal - discountMinor;

  async function handleAddCombo() {
    setBusy(true);
    try {
      await patchCartLine(orgSlug, { productId: mainProduct.id, quantity: 1 });
      setAdded(true);
      setTimeout(() => setAdded(false), 3000);
    } catch {
      // ignore
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="rounded-3xl border border-amber-900/20 bg-gradient-to-br from-[#fcf9f2] via-amber-50/50 to-[#f7f1e3] p-5 sm:p-6 shadow-sm">
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-amber-900/10 pb-4">
        <div>
          <span className="rounded-full bg-amber-800 px-2.5 py-0.5 text-[11px] font-black text-amber-50">
            {t.themeBooks.comboHeading}
          </span>
          <h3 className="mt-1 font-serif text-base sm:text-lg font-black text-amber-950">
            একত্রে ৩টি বেস্টসেলার বই কিনলে ইনস্ট্যান্ট ৳২৫০ ক্যাশ সেভিংস + ফ্রি মেটাল বুকমার্ক!
          </h3>
        </div>
        <div className="text-right">
          <span className="text-xs text-amber-900/60 line-through">{formatBooksPrice(subtotal)}</span>
          <p className="font-serif text-xl font-black text-amber-900">{formatBooksPrice(comboPrice)}</p>
        </div>
      </div>

      <div className="my-4 grid grid-cols-1 sm:grid-cols-3 gap-3">
        <div className="flex items-center gap-3 rounded-2xl border border-amber-900/10 bg-white p-3">
          <div className="h-12 w-10 shrink-0 overflow-hidden rounded bg-amber-100 flex items-center justify-center font-bold text-amber-900">
            📖
          </div>
          <div className="min-w-0">
            <span className="text-[10px] font-bold text-amber-800">{t.themeBooks.comboMainBook}</span>
            <h5 className="truncate font-serif text-xs font-bold text-amber-950">{mainProduct.name}</h5>
            <span className="text-xs font-extrabold text-amber-900">{formatBooksPrice(mainPrice)}</span>
          </div>
        </div>

        <div className="flex items-center gap-3 rounded-2xl border border-amber-900/10 bg-white p-3">
          <div className="h-12 w-10 shrink-0 overflow-hidden rounded bg-amber-100 flex items-center justify-center font-bold text-amber-900">
            📘
          </div>
          <div className="min-w-0">
            <span className="text-[10px] font-bold text-amber-800">টপ রেটেড রহস্য উপন্যাস</span>
            <h5 className="truncate font-serif text-xs font-bold text-amber-950">মধ্যরাতের পদধ্বনি (হার্ডকভার)</h5>
            <span className="text-xs font-extrabold text-amber-900">৳৩৮০</span>
          </div>
        </div>

        <div className="flex items-center gap-3 rounded-2xl border border-amber-900/10 bg-white p-3">
          <div className="h-12 w-10 shrink-0 overflow-hidden rounded bg-amber-100 flex items-center justify-center font-bold text-amber-900">
            📙
          </div>
          <div className="min-w-0">
            <span className="text-[10px] font-bold text-amber-800">আত্মউন্নয়ন ও মোটিভেশন</span>
            <h5 className="truncate font-serif text-xs font-bold text-amber-950">মস্তিষ্কের গোপন শক্তি ও সাফল্য</h5>
            <span className="text-xs font-extrabold text-amber-900">৳৪৫০</span>
          </div>
        </div>
      </div>

      <div className="flex flex-wrap items-center justify-between gap-3 pt-2">
        <span className="text-xs text-amber-900/80 font-medium">
          {t.themeBooks.comboGift}
        </span>
        <button
          type="button"
          onClick={handleAddCombo}
          disabled={busy}
          className="rounded-xl bg-amber-900 px-5 py-2.5 text-xs font-extrabold text-amber-50 shadow-md hover:bg-amber-800 transition disabled:opacity-50"
        >
          {added ? t.themeBooks.comboAdded : t.themeBooks.comboBuy}
        </button>
      </div>
    </div>
  );
}

/** Rokomari / Batighar style 3:4 aspect ratio Book Card */
export function BooksProductCard({
  orgSlug,
  product,
  locale = "bn",
}: {
  orgSlug: string;
  product: ShopProduct;
  locale?: ShopLocale | string;
}) {
  const t = shopT(locale);
  const [busy, setBusy] = useState(false);
  const [added, setAdded] = useState(false);
  const [lookInsideOpen, setLookInsideOpen] = useState(false);

  const priceMinor = Number(product.priceMinor);
  const compareMinor = product.compareAtMinor ? Number(product.compareAtMinor) : null;
  const discountPct = compareMinor && compareMinor > priceMinor
    ? Math.round(((compareMinor - priceMinor) / compareMinor) * 100)
    : null;

  async function handleQuickAdd(e: React.MouseEvent) {
    e.preventDefault();
    e.stopPropagation();
    setBusy(true);
    try {
      await patchCartLine(orgSlug, { productId: product.id, quantity: 1 });
      setAdded(true);
      setTimeout(() => setAdded(false), 2000);
    } catch {
      // ignore
    } finally {
      setBusy(false);
    }
  }

  function handleLookInside(e: React.MouseEvent) {
    e.preventDefault();
    e.stopPropagation();
    setLookInsideOpen(true);
  }

  return (
    <>
      <div className="group relative flex flex-col overflow-hidden rounded-2xl border border-amber-900/10 bg-white shadow-xs transition-all duration-300 hover:-translate-y-1 hover:border-amber-700/30 hover:shadow-xl">
        {/* Book cover (Aspect 3:4) */}
        <Link href={`/shop/${orgSlug}/products/${product.slug}`} className="relative block aspect-[3/4] overflow-hidden bg-amber-50/30">
          {product.imageUrl ? (
            <MediaImage
              src={product.imageUrl}
              alt={product.name}
              className="h-full w-full object-cover transition-transform duration-500 group-hover:scale-105"
            />
          ) : (
            <div className="flex h-full w-full flex-col items-center justify-center p-4 text-center font-serif text-amber-900/40">
              <span className="text-4xl">📖</span>
              <span className="mt-2 text-xs font-bold line-clamp-2">{product.name}</span>
            </div>
          )}

          {/* Badges */}
          <div className="absolute left-2.5 top-2.5 flex flex-col gap-1">
            {discountPct ? (
              <span className="rounded-lg bg-rose-600 px-2 py-0.5 text-[10px] font-black text-white shadow-xs">
                {fmtNumber(locale === "en" ? "en" : "bn", discountPct ?? 0)}{t.themeBooks.discountSuffix}
              </span>
            ) : null}
            <span className="rounded-lg bg-amber-900/90 px-2 py-0.5 text-[9px] font-bold text-amber-50 shadow-xs backdrop-blur-xs">
              {t.themeBooks.fairEdition}
            </span>
          </div>

          {/* "একটু পড়ুন" Quick Look Inside Overlay Button */}
          <div className="absolute inset-x-2 bottom-2 z-10 opacity-0 transition-opacity duration-200 group-hover:opacity-100">
            <button
              type="button"
              onClick={handleLookInside}
              className="w-full rounded-xl bg-amber-950/90 py-1.5 text-center text-xs font-bold text-amber-50 shadow-md backdrop-blur-xs hover:bg-amber-900"
            >
              {t.themeBooks.lookInside}
            </button>
          </div>
        </Link>

        {/* Book Info */}
        <div className="flex flex-1 flex-col p-3.5">
          <div className="mb-1 flex items-center justify-between text-[11px] text-amber-900/60 font-medium">
            <span>{product.brand?.name ?? "অন্যপ্রকাশ"}</span>
            <span className="flex items-center text-amber-600 font-bold">
              ★ ৪.৮
            </span>
          </div>

          <Link href={`/shop/${orgSlug}/products/${product.slug}`} className="group-hover:text-amber-800 transition">
            <h4 className="font-serif text-sm font-bold text-amber-950 line-clamp-2 leading-snug">
              {product.name}
            </h4>
          </Link>

          <p className="mt-1 text-xs text-amber-900/80 truncate">
            {t.themeBooks.authorLabel}<span className="font-semibold text-amber-950">হুমায়ূন আহমেদ</span>
          </p>

          <div className="mt-3 flex items-baseline gap-2">
            <span className="font-serif text-base font-black text-amber-900">
              {formatBooksPrice(priceMinor)}
            </span>
            {compareMinor && compareMinor > priceMinor ? (
              <span className="text-xs text-slate-400 line-through">
                {formatBooksPrice(compareMinor)}
              </span>
            ) : null}
          </div>

          <div className="mt-3 pt-2.5 border-t border-amber-900/5">
            <button
              type="button"
              onClick={handleQuickAdd}
              disabled={busy}
              className={`w-full rounded-xl py-2 text-xs font-bold transition flex items-center justify-center gap-1.5 ${
                added
                  ? "bg-emerald-600 text-white"
                  : "bg-amber-100 text-amber-950 hover:bg-amber-900 hover:text-white"
              }`}
            >
              <span>{added ? t.themeBooks.inBag : t.themeBooks.addToBag}</span>
            </button>
          </div>
        </div>
      </div>

      <BooksLookInsideModal locale={locale}
        open={lookInsideOpen}
        onClose={() => setLookInsideOpen(false)}
        productName={product.name}
      />
    </>
  );
}

/** Complete Books Theme Homepage */
export function BooksThemeHome({
  orgSlug,
  home,
  locale = "bn",
}: {
  orgSlug: string;
  home: ShopHome;
  locale?: ShopLocale | string;
}) {
  const t = shopT(locale);
  const products = home.products ?? [];
  const categories = home.categories ?? [];

  const topAuthors = [
    { name: "হুমায়ূন আহমেদ", role: "উপন্যাস ও সায়েন্স ফিকশন", count: "১১২টি বই" },
    { name: "মুহম্মদ জাফর ইকবাল", role: "কিশোর সাহিত্য ও বিজ্ঞান", count: "৬৪টি বই" },
    { name: "সাদাত হোসাইন", role: "সমকালীন জনপ্রিয় উপন্যাস", count: "২৮টি বই" },
    { name: "আনিসুল হক", role: "গল্প ও মনস্তাত্ত্বিক উপন্যাস", count: "৩৬টি বই" },
    { name: "তানজীম রহমান", role: "রহস্য ও থ্রিলার", count: "২২টি বই" },
    { name: "শিব খেরা", role: "সাফল্য ও আত্মউন্নয়ন", count: "১৪টি বই" },
  ];

  const bookTopics = [
    { name: "উপন্যাস ও গল্প", icon: "📚", count: "১২০+" },
    { name: "থ্রিলার ও গোয়েন্দা", icon: "🕵️", count: "৮৫+" },
    { name: "আত্মউন্নয়ন ও মোটিভেশন", icon: "💡", count: "৫০+" },
    { name: "ইসলামিক সাহিত্য", icon: "🕌", count: "১১০+" },
    { name: "বিসিএস ও চাকরি প্রস্তুতি", icon: "🎯", count: "৭০+" },
    { name: "শিশু-কিশোর ও কমিকস", icon: "🎨", count: "৪৫+" },
    { name: "কবিতা ও নাটক", icon: "✒️", count: "৩০+" },
    { name: "বিজ্ঞান ও তথ্যপ্রযুক্তি", icon: "🔬", count: "৪০+" },
  ];

  return (
    <div className="mx-auto max-w-6xl space-y-10 px-4 py-8 sm:px-6">
      {/* Editorial Literature Hero */}
      <section className="relative overflow-hidden rounded-3xl bg-gradient-to-r from-amber-950 via-[#3a1a12] to-stone-900 p-8 sm:p-12 text-white shadow-2xl border border-amber-600/20">
        <div className="relative z-10 max-w-2xl space-y-4">
          <div className="inline-flex items-center gap-2 rounded-full border border-amber-400/30 bg-amber-900/60 px-3.5 py-1 text-xs font-extrabold text-amber-200 backdrop-blur-xs">
            <span>{t.themeBooks.heroBadge}</span>
          </div>
          <h1 className="font-serif text-3xl font-black sm:text-5xl tracking-tight leading-tight text-amber-50">
            {t.themeBooks.heroTitle}
          </h1>
          <p className="text-sm sm:text-base text-amber-200/80 leading-relaxed">
            বাংলাদেশের শীর্ষস্থানীয় প্রকাশনীর আসল বই, লেখকের অটোগ্রাফযুক্ত কপি ও বেস্টসেলার বইমেলা কালেকশন এখন আপনার হাতের মুঠোয়। ঘরে বসেই পান দ্রুত হোম ডেলিভারি।
          </p>
          <div className="flex flex-wrap items-center gap-3 pt-2">
            <a
              href="#all-books"
              className="rounded-xl bg-amber-500 px-6 py-3 text-xs font-black text-amber-950 shadow-lg hover:bg-amber-400 transition"
            >
              {t.themeBooks.heroCta}
            </a>
            <span className="text-xs font-medium text-amber-300">
              {t.themeBooks.heroNote}
            </span>
          </div>
        </div>

        {/* Decorative background watermark */}
        <div className="absolute -right-8 -bottom-10 select-none text-[160px] opacity-10 font-serif">
          📖
        </div>
      </section>

      {/* 4 Trust Pillars */}
      <BooksTrustBar locale={locale} />

      {/* Popular Authors Carousel/Grid */}
      <section className="space-y-4">
        <div className="flex items-center justify-between">
          <div>
            <span className="text-xs font-bold text-amber-800 uppercase tracking-wider">{t.themeBooks.authorsEyebrow}</span>
            <h2 className="font-serif text-xl sm:text-2xl font-black text-amber-950">{t.themeBooks.authorsHeading}</h2>
          </div>
          <span className="text-xs font-bold text-amber-800">{t.themeBooks.allAuthors}</span>
        </div>
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
          {topAuthors.map((author, idx) => (
            <div
              key={idx}
              className="group flex flex-col items-center rounded-2xl border border-amber-900/10 bg-white p-4 text-center shadow-xs transition hover:-translate-y-1 hover:border-amber-700/30 hover:shadow-md cursor-pointer"
            >
              <div className="flex h-14 w-14 items-center justify-center rounded-full bg-gradient-to-br from-amber-700 to-amber-900 text-2xl shadow-sm text-white font-serif">
                ✍️
              </div>
              <h4 className="mt-3 font-serif text-xs font-bold text-amber-950 group-hover:text-amber-800">
                {author.name}
              </h4>
              <p className="mt-0.5 text-[10px] text-amber-900/60 line-clamp-1">{author.role}</p>
              <span className="mt-2 rounded-full bg-amber-50 px-2 py-0.5 text-[10px] font-extrabold text-amber-800">
                {author.count}
              </span>
            </div>
          ))}
        </div>
      </section>

      {/* Book Topics / Categories */}
      <section className="space-y-4">
        <h2 className="font-serif text-xl sm:text-2xl font-black text-amber-950">
          {t.themeBooks.topicsHeading}
        </h2>
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          {bookTopics.map((topic, idx) => (
            <div
              key={idx}
              className="flex items-center gap-3 rounded-2xl border border-amber-900/10 bg-[#fbf9f4] p-3.5 shadow-xs transition hover:bg-amber-50 cursor-pointer"
            >
              <span className="text-2xl">{topic.icon}</span>
              <div className="min-w-0">
                <h4 className="font-serif text-xs font-bold text-amber-950 truncate">{topic.name}</h4>
                <p className="text-[10px] text-amber-900/60">{topic.count}{t.themeBooks.topicBooksSuffix}</p>
              </div>
            </div>
          ))}
        </div>
      </section>

      {/* Flash Sale / Today's Book Fair Deals */}
      {home.flashSales && home.flashSales.sales && home.flashSales.sales.length > 0 ? (
        <section className="rounded-3xl border border-rose-300 bg-gradient-to-r from-amber-900 via-rose-950 to-stone-900 p-6 text-white shadow-xl">
          <div className="flex flex-wrap items-center justify-between gap-3 border-b border-amber-500/20 pb-4">
            <div>
              <span className="rounded-full bg-rose-600 px-3 py-0.5 text-xs font-black uppercase text-white">
                {t.themeBooks.flashDeal}
              </span>
              <h2 className="mt-1 font-serif text-xl sm:text-2xl font-black text-amber-50">
                {t.themeBooks.flashDealSub}
              </h2>
            </div>
            {home.flashSales.sales[0]?.endsAt ? (
              <FlashCountdown
                endsAt={home.flashSales.sales[0].endsAt}
                serverNow={home.flashSales.serverNow}
                locale={locale}
              />
            ) : null}
          </div>
          <div className="mt-6 grid grid-cols-2 gap-3 sm:grid-cols-4">
            {(home.flashSales.sales[0]?.products ?? []).slice(0, 4).map((p) => (
              <BooksProductCard key={p.id} orgSlug={orgSlug} product={p} locale={locale} />
            ))}
          </div>
        </section>
      ) : null}

      {/* Main Books Catalog */}
      <section id="all-books" className="space-y-6">
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-amber-900/10 pb-4">
          <div>
            <h2 className="font-serif text-2xl font-black text-amber-950">
              {t.themeBooks.allBooksHeading}
            </h2>
            <p className="text-xs text-amber-900/70">
              {t.themeBooks.booksFoundPrefix}{fmtNumber(locale === "en" ? "en" : "bn", home.pagination?.total ?? products.length)}{t.themeBooks.booksFoundSuffix}
            </p>
          </div>
          <SortSelect orgSlug={orgSlug} locale={locale} value="featured" />
        </div>

        {products.length === 0 ? (
          <div className="rounded-3xl border border-dashed border-amber-900/20 bg-white p-12 text-center">
            <span className="text-4xl">📚</span>
            <p className="mt-3 text-sm font-bold text-amber-950">{t.themeBooks.noBooks}</p>
          </div>
        ) : (
          <div className="grid grid-cols-2 gap-3 sm:gap-5 md:grid-cols-3 lg:grid-cols-4">
            {products.map((p) => (
              <BooksProductCard key={p.id} orgSlug={orgSlug} product={p} locale={locale} />
            ))}
          </div>
        )}
      </section>

      <RecentlyViewedStrip orgSlug={orgSlug} locale={locale} />
    </div>
  );
}
