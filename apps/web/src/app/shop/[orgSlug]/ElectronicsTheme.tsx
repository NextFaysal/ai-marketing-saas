"use client";
import React, { useState } from "react";
import Link from "next/link";
import { formatMinor } from "@repo/contracts";
import { MediaImage } from "@/components/media-image";
import type { ShopHome, ShopProduct } from "@/lib/storefront-server";
import { type ShopLocale, shopT } from "@/lib/shop-i18n";
import { QuickViewButton } from "./QuickView";
import { WishlistHeart } from "./WishlistHeart";
import { FlashCountdown } from "./FlashCountdown";
import { SortSelect } from "./SortSelect";
import { patchCartLine, notifyCartUpdated } from "@/lib/storefront-cart";

export function formatTechPrice(minor: string): string {
  try {
    return formatMinor(BigInt(minor));
  } catch {
    return minor;
  }
}

// ----------------------------------------------------
// 1. Technical Trust Bar for Electronics & Gadgets
// ----------------------------------------------------
export function ElectronicsTrustBar() {
  return (
    <div className="grid grid-cols-2 gap-3 sm:grid-cols-4 sm:gap-4">
      <div className="flex items-center gap-3 rounded-2xl border border-slate-200/80 bg-white p-3.5 shadow-xs transition hover:shadow-md">
        <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-blue-50 text-xl text-blue-600">
          🛡️
        </div>
        <div>
          <h4 className="text-xs font-black text-slate-900">১০০% অফিশিয়াল ওয়ারেন্টি</h4>
          <p className="text-[11px] text-slate-500">অথোরাইজড ব্র্যান্ড পার্টস ও সার্ভিস গ্যারান্টি</p>
        </div>
      </div>

      <div className="flex items-center gap-3 rounded-2xl border border-slate-200/80 bg-white p-3.5 shadow-xs transition hover:shadow-md">
        <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-emerald-50 text-xl text-emerald-600">
          ⚡
        </div>
        <div>
          <h4 className="text-xs font-black text-slate-900">সুপারফাস্ট এক্সপ্রেস ডেলিভারি</h4>
          <p className="text-[11px] text-slate-500">ঢাকায় ২৪ ঘণ্টায় ও সারাদেশে ২ দিনে ডেলিভারি</p>
        </div>
      </div>

      <div className="flex items-center gap-3 rounded-2xl border border-slate-200/80 bg-white p-3.5 shadow-xs transition hover:shadow-md">
        <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-indigo-50 text-xl text-indigo-600">
          💳
        </div>
        <div>
          <h4 className="text-xs font-black text-slate-900">০% ইএমআই (EMI) সুবিধা</h4>
          <p className="text-[11px] text-slate-500">শীর্ষ ৩০+ ব্যাংকের ক্রেডিট কার্ডে কিস্তি</p>
        </div>
      </div>

      <div className="flex items-center gap-3 rounded-2xl border border-slate-200/80 bg-white p-3.5 shadow-xs transition hover:shadow-md">
        <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-amber-50 text-xl text-amber-600">
          🔄
        </div>
        <div>
          <h4 className="text-xs font-black text-slate-900">৭ দিনের রিপ্লেসমেন্ট</h4>
          <p className="text-[11px] text-slate-500">যেকোনো টেকনিক্যাল ত্রুটিতে দ্রুত পরিবর্তন</p>
        </div>
      </div>
    </div>
  );
}

// ----------------------------------------------------
// 2. EMI Calculator Modal
// ----------------------------------------------------
export function ElectronicsEmiCalculatorModal({
  open,
  onClose,
  productPriceMinor,
  productName,
}: {
  open: boolean;
  onClose: () => void;
  productPriceMinor: string;
  productName: string;
}) {
  const [tenure, setTenure] = useState<3 | 6 | 9 | 12>(12);
  const [selectedBank, setSelectedBank] = useState("City Bank Amex");

  if (!open) return null;

  const price = Number(productPriceMinor || "0") / 100;
  const monthlyEmi = Math.round(price / tenure);

  const banks = [
    "City Bank Amex",
    "BRAC Bank",
    "Eastern Bank (EBL)",
    "Standard Chartered",
    "Dutch-Bangla Bank",
    "Mutual Trust Bank (MTB)",
    "Prime Bank",
  ];

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4 backdrop-blur-sm animate-in fade-in duration-200">
      <div className="relative w-full max-w-lg rounded-3xl bg-white p-6 shadow-2xl sm:p-7">
        <button
          type="button"
          onClick={onClose}
          className="absolute right-5 top-5 flex h-9 w-9 items-center justify-center rounded-full bg-slate-100 text-slate-500 hover:bg-slate-200 transition"
          aria-label="Close"
        >
          ✕
        </button>

        <div className="flex items-center gap-2.5">
          <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-indigo-50 text-xl text-indigo-600">
            💳
          </span>
          <div>
            <h3 className="text-base font-black text-slate-900">০% ইএমআই কিস্তি ক্যালকুলেটর</h3>
            <p className="line-clamp-1 text-xs text-slate-500">{productName}</p>
          </div>
        </div>

        <div className="mt-5 space-y-4">
          {/* Price Tag */}
          <div className="flex items-baseline justify-between rounded-2xl bg-slate-50 p-3.5 border border-slate-100">
            <span className="text-xs font-bold text-slate-600">পণ্যের নগদ মূল্য:</span>
            <span className="text-xl font-black text-indigo-600">
              {formatTechPrice(productPriceMinor)}
            </span>
          </div>

          {/* Bank Selection */}
          <div>
            <label className="text-xs font-bold text-slate-700">আপনার ক্রেডিট কার্ড ব্যাংক নির্বাচন করুন:</label>
            <select
              value={selectedBank}
              onChange={(e) => setSelectedBank(e.target.value)}
              className="mt-1.5 w-full rounded-xl border border-slate-200 bg-white p-2.5 text-xs font-bold text-slate-800 focus:border-indigo-600 focus:outline-none"
            >
              {banks.map((b) => (
                <option key={b} value={b}>
                  {b}
                </option>
              ))}
            </select>
          </div>

          {/* Tenure Selection */}
          <div>
            <label className="text-xs font-bold text-slate-700">কিস্তির মেয়াদ (মাস):</label>
            <div className="mt-1.5 grid grid-cols-4 gap-2">
              {[3, 6, 9, 12].map((m) => (
                <button
                  key={m}
                  type="button"
                  onClick={() => setTenure(m as any)}
                  className={`rounded-xl border py-2 text-center text-xs font-black transition ${
                    tenure === m
                      ? "border-indigo-600 bg-indigo-600 text-white shadow-sm"
                      : "border-slate-200 bg-white text-slate-700 hover:border-slate-300"
                  }`}
                >
                  {m} মাস
                </button>
              ))}
            </div>
          </div>

          {/* Result Box */}
          <div className="rounded-2xl border border-indigo-200 bg-gradient-to-br from-indigo-50 to-blue-50/50 p-4 text-center">
            <span className="inline-block rounded-full bg-indigo-600/10 px-3 py-1 text-[11px] font-black text-indigo-700">
              ০% সুদে মাসিক কিস্তি
            </span>
            <p className="mt-2 text-3xl font-black text-slate-900 font-mono tracking-tight">
              ৳{monthlyEmi.toLocaleString("en-IN")}{" "}
              <span className="text-xs font-sans font-bold text-slate-500">/ মাস</span>
            </p>
            <p className="mt-1 text-[11px] text-slate-500">
              {selectedBank} ক্রেডিট কার্ড দিয়ে মোট {tenure}টি সমান মাসিক কিস্তিতে পরিশোধ করতে পারবেন।
            </p>
          </div>

          <div className="rounded-xl bg-slate-50 p-3 text-[11px] text-slate-500 leading-relaxed border border-slate-100">
            ℹ️ <strong>শর্তাবলী:</strong> অনলাইন অথবা শোরুম থেকে চেকআউটের সময় আপনার পছন্দের ব্যাংকের ক্রেডিট কার্ড সিলেক্ট করলেই EMI সুবিধা পাওয়া যাবে। প্রসেসিং চার্জ ব্যাংক ভেদে প্রযোজ্য হতে পারে।
          </div>
        </div>
      </div>
    </div>
  );
}

// ----------------------------------------------------
// 3. Official Warranty & Tech Assurance Box
// ----------------------------------------------------
export function ElectronicsWarrantyBox({
  warrantyText = "১ বছর অফিশিয়াল ব্র্যান্ড পার্টস ও সার্ভিস ওয়ারেন্টি",
}: {
  warrantyText?: string;
}) {
  return (
    <div className="space-y-2.5 rounded-2xl border border-indigo-100 bg-indigo-50/40 p-4 text-xs">
      <div className="flex items-center gap-2 font-bold text-slate-900">
        <span className="text-indigo-600 text-base">🛡️</span>
        <span className="font-extrabold text-indigo-950">ওয়ারেন্টি ও গ্যারান্টি নিশ্চয়তা:</span>
      </div>
      <ul className="space-y-1.5 text-[11px] text-slate-600 pl-6 list-disc">
        <li>
          <strong>অফিশিয়াল ওয়ারেন্টি:</strong> {warrantyText}। অনুমোদিত সার্ভিস সেন্টার থেকে সরাসরি সেবা পাবেন।
        </li>
        <li>
          <strong>৭ দিনের রিপ্লেসমেন্ট:</strong> প্যাকেট খোলার পর কোনো টেকনিক্যাল ম্যানুফ্যাকচারিং ত্রুটি থাকলে ইনস্ট্যান্ট রিপ্লেসমেন্ট।
        </li>
        <li>
          <strong>ইনভয়েস কপি:</strong> ডেলিভারির সাথে ডিজিটাল ভ্যাট ইনভয়েস ও ওয়ারেন্টি ক্লেইম স্লিপ প্রদান করা হবে।
        </li>
      </ul>
    </div>
  );
}

// ----------------------------------------------------
// 4. Tech Spec Matrix Table
// ----------------------------------------------------
export function ElectronicsSpecTable({
  specs,
}: {
  specs?: Record<string, string>;
}) {
  const defaultSpecs: Record<string, string> = {
    "প্রসেসর / চিপসেট": "High Performance Flagship Octa-Core",
    "ডিসপ্লে": "Super AMOLED, 120Hz Refresh Rate, HDR10+",
    "ব্যাটারি ও চার্জিং": "5000mAh Battery with 67W Super Fast Charging",
    "ক্যামেরা": "50MP OIS Main Camera + Ultra-Wide + Macro",
    "কানেক্টিভিটি": "5G, Dual-Band Wi-Fi 6, Bluetooth 5.3, NFC",
    "বিল্ড ও সুরক্ষা": "Corning Gorilla Glass Victus, IP68 Water Resistant",
    "অপারেটিং সিস্টেম": "Official Global OS with Regular Security Updates",
    "ওয়ারেন্টি": "১ বছর অফিসিয়াল অথোরাইজড ওয়ারেন্টি",
  };

  const finalSpecs = specs && Object.keys(specs).length > 0 ? specs : defaultSpecs;

  return (
    <div className="rounded-3xl border border-slate-200/90 bg-white p-5 shadow-xs space-y-4">
      <div className="flex items-center justify-between border-b border-slate-100 pb-3">
        <div className="flex items-center gap-2">
          <span className="text-xl">⚙️</span>
          <h3 className="text-sm font-black text-slate-900">টেকনিক্যাল স্পেসিফিকেশন (Technical Specs)</h3>
        </div>
        <span className="rounded-full bg-slate-100 px-2.5 py-1 text-[10px] font-bold text-slate-600">
          অফিশিয়াল স্পেকস
        </span>
      </div>

      <div className="overflow-x-auto">
        <table className="w-full text-left text-xs">
          <tbody className="divide-y divide-slate-100">
            {Object.entries(finalSpecs).map(([key, val], idx) => (
              <tr key={key} className={idx % 2 === 0 ? "bg-slate-50/50" : "bg-white"}>
                <td className="w-1/3 p-3 font-bold text-slate-700">{key}</td>
                <td className="p-3 text-slate-900 font-medium">{val}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

// ----------------------------------------------------
// 5. Electronics & Gadget Product Card (Star Tech Style)
// ----------------------------------------------------
export function ElectronicsProductCard({
  orgSlug,
  product,
  locale = "bn",
}: {
  orgSlug: string;
  product: ShopProduct;
  locale?: ShopLocale | string;
}) {
  const [busy, setBusy] = useState(false);
  const [added, setAdded] = useState(false);
  const [emiModalOpen, setEmiModalOpen] = useState(false);

  const priceMinor = product.priceMinor || "0";
  const compareMinor = product.compareAtMinor;
  const isOutOfStock = product.stockState === "out_of_stock";

  // Calculate discount percentage
  let percentOff = 0;
  if (compareMinor && BigInt(compareMinor) > BigInt(priceMinor)) {
    const diff = BigInt(compareMinor) - BigInt(priceMinor);
    percentOff = Math.round(Number((diff * 100n) / BigInt(compareMinor)));
  }

  // Monthly EMI for 12 months
  const monthlyEmi = Math.round(Number(priceMinor) / 100 / 12);

  async function handleQuickAdd(e: React.MouseEvent) {
    e.preventDefault();
    e.stopPropagation();
    if (isOutOfStock || busy) return;
    setBusy(true);
    try {
      await patchCartLine(orgSlug, {
        productId: product.id,
        variantId: null,
        quantity: 1,
        includeBump: false,
      });
      notifyCartUpdated(orgSlug);
      setAdded(true);
      setTimeout(() => setAdded(false), 2000);
    } catch {
      /* ignore */
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <div className="group relative flex flex-col justify-between overflow-hidden rounded-2xl border border-slate-200/90 bg-white shadow-xs transition-all duration-300 hover:border-indigo-500/50 hover:shadow-xl">
        {/* Top Badges */}
        <div className="relative aspect-square w-full overflow-hidden bg-slate-50 p-4">
          <div className="absolute left-2.5 top-2.5 z-10 flex flex-col gap-1">
            {percentOff > 0 ? (
              <span className="rounded-lg bg-rose-600 px-2 py-0.5 text-[10px] font-black text-white shadow-xs">
                −{percentOff}%
              </span>
            ) : null}
            <span className="rounded-lg bg-slate-900/80 px-2 py-0.5 text-[9px] font-bold text-white backdrop-blur-xs">
              অফিশিয়াল
            </span>
          </div>

          <div className="absolute right-2.5 top-2.5 z-10">
            <WishlistHeart orgSlug={orgSlug} productId={product.id} locale={locale} />
          </div>

          <Link href={`/shop/${orgSlug}/products/${product.slug}`} className="block h-full w-full">
            {product.imageUrl ? (
              <MediaImage
                src={product.imageUrl}
                alt={product.name}
                width={400}
                height={400}
                className="h-full w-full object-contain p-2 transition duration-500 group-hover:scale-105"
              />
            ) : (
              <div className="flex h-full w-full items-center justify-center text-4xl">⚡</div>
            )}
          </Link>

          <QuickViewButton orgSlug={orgSlug} product={product} locale={locale} />
        </div>

        {/* Card Content */}
        <div className="flex flex-1 flex-col justify-between p-4 space-y-3">
          <div className="space-y-1.5">
            {/* Category or In Stock indicator */}
            <div className="flex items-center justify-between text-[11px]">
              <span className="font-semibold text-slate-400">
                {product.category || "গ্যাজেটস"}
              </span>
              <span
                className={`font-bold ${
                  isOutOfStock ? "text-rose-500" : "text-emerald-600"
                }`}
              >
                {isOutOfStock ? "স্টক শেষ" : "● স্টকে আছে"}
              </span>
            </div>

            {/* Product Title */}
            <Link
              href={`/shop/${orgSlug}/products/${product.slug}`}
              className="line-clamp-2 text-xs font-black text-slate-900 transition hover:text-indigo-600 sm:text-sm"
              title={product.name}
            >
              {product.name}
            </Link>

            {/* Tech Key Specs bullet highlights */}
            <div className="flex flex-wrap gap-1 pt-1">
              <span className="rounded bg-slate-100 px-1.5 py-0.5 text-[10px] font-semibold text-slate-600">
                ১ বছর ওয়ারেন্টি
              </span>
              <span className="rounded bg-slate-100 px-1.5 py-0.5 text-[10px] font-semibold text-slate-600">
                জেনুইন পার্টস
              </span>
            </div>
          </div>

          {/* Pricing & EMI */}
          <div className="border-t border-slate-100 pt-3 space-y-2">
            <div>
              <div className="flex items-baseline gap-2">
                <span className="text-base font-black text-slate-900 sm:text-lg">
                  {formatTechPrice(priceMinor)}
                </span>
                {compareMinor ? (
                  <span className="text-xs text-slate-400 line-through">
                    {formatTechPrice(compareMinor)}
                  </span>
                ) : null}
              </div>

              {/* EMI Calculation link */}
              {Number(priceMinor) >= 500000 && (
                <button
                  type="button"
                  onClick={(e) => {
                    e.preventDefault();
                    setEmiModalOpen(true);
                  }}
                  className="mt-0.5 flex items-center gap-1 text-[10px] font-bold text-indigo-600 hover:text-indigo-800"
                >
                  <span>ইএমআই: ৳{monthlyEmi.toLocaleString("en-IN")}/মাস</span>
                  <span className="underline">ক্যালকুলেটর</span>
                </button>
              )}
            </div>

            {/* Actions */}
            <div className="flex items-center gap-2 pt-1">
              <button
                type="button"
                onClick={handleQuickAdd}
                disabled={isOutOfStock || busy}
                className={`w-full rounded-xl py-2 text-xs font-black transition ${
                  added
                    ? "bg-emerald-600 text-white"
                    : isOutOfStock
                    ? "bg-slate-100 text-slate-400 cursor-not-allowed"
                    : "bg-slate-900 text-white hover:bg-indigo-600 shadow-sm"
                }`}
              >
                {added ? "✓ যোগ হয়েছে" : isOutOfStock ? "স্টক আউট" : busy ? "যোগ হচ্ছে…" : "অর্ডার করুন"}
              </button>
            </div>
          </div>
        </div>
      </div>

      <ElectronicsEmiCalculatorModal
        open={emiModalOpen}
        onClose={() => setEmiModalOpen(false)}
        productPriceMinor={priceMinor}
        productName={product.name}
      />
    </>
  );
}

// ----------------------------------------------------
// 6. Electronics & Gadgets Dedicated Homepage Layout
// ----------------------------------------------------
export function ElectronicsThemeHome({
  home,
  orgSlug,
  locale = "bn",
}: {
  home: ShopHome;
  orgSlug: string;
  locale?: ShopLocale | string;
}) {
  const { settings, products, flashSales, categories, brands, pagination } = home;
  const page = pagination.page;
  const isBangla = locale === "bn";

  // Category Department Map
  const techDepartments = [
    { label: "স্মার্টফোন ও ট্যাব", icon: "📱", slug: "phones" },
    { label: "ল্যাপটপ ও কম্পিউটার", icon: "💻", slug: "laptops" },
    { label: "স্মার্টওয়াচ ও ব্যান্ড", icon: "⌚", slug: "wearables" },
    { label: "ইয়ারবাডস ও হেডফোন", icon: "🎧", slug: "audio" },
    { label: "গেমিং ও পেরিফেরালস", icon: "🎮", slug: "gaming" },
    { label: "পাওয়ার ও অ্যাক্সেসরিজ", icon: "🔋", slug: "accessories" },
  ];

  return (
    <div className="min-h-screen bg-[#f4f6f9] text-slate-900 pb-16">
      <div className="mx-auto max-w-7xl px-4 sm:px-6 space-y-10 pt-6">
        {/* 1. Tech Mega Hero Banner */}
        <section className="relative overflow-hidden rounded-3xl bg-gradient-to-r from-slate-950 via-slate-900 to-indigo-950 text-white shadow-2xl border border-indigo-500/20">
          <div className="relative z-10 grid gap-8 p-8 md:grid-cols-2 md:p-12 lg:p-16 items-center">
            <div className="space-y-4">
              <div className="inline-flex items-center gap-2 rounded-full border border-indigo-400/30 bg-indigo-500/10 px-3 py-1 text-xs font-black text-indigo-300">
                <span>⚡</span>
                <span>ORIGINAL TECH · OFFICIAL WARRANTY</span>
              </div>
              <h1 className="text-3xl font-black tracking-tight text-white sm:text-5xl lg:text-6xl">
                {settings.shopName || "ভবিষ্যতের প্রযুক্তি, আপনার হাতের মুঠোয়"}
              </h1>
              <p className="max-w-xl text-xs sm:text-sm text-slate-300 leading-relaxed">
                {settings.metaDescription ||
                  "বাংলাদেশের সেরা মূল্যে ১০০% অফিসিয়াল স্মার্টফোন, ল্যাপটপ, গেমিং গিয়ার এবং প্রিমিয়াম এক্সেসরিজ। সহজ কিস্তি ও দ্রুততম হোম ডেলিভারি সুবিধা।"}
              </p>
              <div className="flex flex-wrap items-center gap-3 pt-2">
                <a
                  href="#tech-featured"
                  className="rounded-xl bg-indigo-600 px-6 py-3 text-xs font-black text-white shadow-lg shadow-indigo-600/30 transition hover:bg-indigo-500"
                >
                  ফিচার্ড গ্যাজেট দেখুন →
                </a>
                <a
                  href="#tech-categories"
                  className="rounded-xl border border-slate-700 bg-slate-900/60 px-5 py-3 text-xs font-bold text-slate-200 backdrop-blur-sm hover:bg-slate-800"
                >
                  ক্যাটাগরি ব্রাউজ করুন
                </a>
              </div>
            </div>

            {/* Hero Right Visual Showcase */}
            <div className="relative flex items-center justify-center">
              <div className="relative aspect-square w-full max-w-md overflow-hidden rounded-3xl bg-slate-900/80 p-6 border border-slate-800 shadow-2xl flex items-center justify-center">
                {products[0]?.imageUrl ? (
                  <MediaImage
                    src={products[0].imageUrl}
                    alt={products[0].name}
                    width={500}
                    height={500}
                    className="max-h-full max-w-full object-contain drop-shadow-2xl transition duration-500 hover:scale-105"
                  />
                ) : (
                  <div className="text-8xl">💻</div>
                )}
                <div className="absolute bottom-4 left-4 right-4 rounded-2xl bg-slate-950/90 p-3.5 backdrop-blur-md border border-slate-800 text-left">
                  <span className="text-[10px] font-bold text-indigo-400">টপ রেটেড গ্যাজেট</span>
                  <p className="line-clamp-1 text-xs font-black text-white">{products[0]?.name || "ফ্ল্যাগশিপ গ্যাজেট"}</p>
                  <p className="text-xs font-extrabold text-indigo-300">
                    {products[0]?.priceMinor ? formatTechPrice(products[0].priceMinor) : ""}
                  </p>
                </div>
              </div>
            </div>
          </div>
        </section>

        {/* 2. Electronics Trust Bar */}
        <ElectronicsTrustBar />

        {/* 3. Tech Department Hub */}
        <section id="tech-categories" className="space-y-4">
          <div className="flex items-center justify-between">
            <div>
              <h2 className="text-xl font-black text-slate-900 sm:text-2xl">ক্যাটাগরি অনুযায়ী খুঁজুন</h2>
              <p className="text-xs text-slate-500">আপনার প্রয়োজনীয় গ্যাজেট ও ইলেকট্রনিক্স ডিপার্টমেন্ট</p>
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-6">
            {techDepartments.map((dept) => (
              <Link
                key={dept.slug}
                href={`/shop/${orgSlug}?category=${dept.slug}`}
                className="group flex flex-col items-center justify-center rounded-2xl border border-slate-200/90 bg-white p-4 text-center shadow-xs transition hover:border-indigo-600 hover:shadow-md"
              >
                <span className="flex h-12 w-12 items-center justify-center rounded-2xl bg-slate-50 text-2xl transition group-hover:scale-110 group-hover:bg-indigo-50">
                  {dept.icon}
                </span>
                <span className="mt-2 text-xs font-bold text-slate-800 group-hover:text-indigo-600">
                  {dept.label}
                </span>
              </Link>
            ))}
          </div>
        </section>

        {/* 4. Flash Tech Drop (if available) */}
        {flashSales?.sales && flashSales.sales.length > 0 && flashSales.sales[0]?.products?.length ? (
          <section className="rounded-3xl border border-rose-200 bg-gradient-to-r from-rose-950 via-slate-900 to-slate-950 p-6 text-white shadow-xl space-y-4">
            <div className="flex flex-wrap items-center justify-between gap-3 border-b border-rose-900/40 pb-4">
              <div className="flex items-center gap-2">
                <span className="flex h-9 w-9 items-center justify-center rounded-xl bg-rose-600 text-lg">🔥</span>
                <div>
                  <h3 className="text-lg font-black text-white">{flashSales.sales[0].name || "ফ্ল্যাশ টেক ড্রপ — লিমিটেড অফার"}</h3>
                  <p className="text-xs text-rose-300">সীমিত সময়ের বিশেষ মূল্যে প্রিমিয়াম গ্যাজেটস</p>
                </div>
              </div>
              <FlashCountdown endsAt={flashSales.sales[0].endsAt} serverNow={flashSales.serverNow} locale={locale} />
            </div>

            <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
              {flashSales.sales[0].products.slice(0, 4).map((p) => (
                <ElectronicsProductCard
                  key={p.id}
                  orgSlug={orgSlug}
                  product={p}
                  locale={locale}
                />
              ))}
            </div>
          </section>
        ) : null}

        {/* 5. Main Tech Product Showcase Grid */}
        <section id="tech-featured" className="space-y-5">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <h2 className="text-xl font-black text-slate-900 sm:text-2xl">
                জনপ্রিয় ও ফিচার্ড গ্যাজেটস
              </h2>
              <p className="text-xs text-slate-500">
                অফিশিয়াল ওয়ারেন্টি ও অথোরাইজড ডিস্ট্রিবিউটর গ্যারান্টি সহ
              </p>
            </div>
            <SortSelect orgSlug={orgSlug} locale={locale} value="featured" />
          </div>

          <div className="grid grid-cols-2 gap-3 sm:gap-4 md:grid-cols-3 lg:grid-cols-4">
            {products.map((p) => (
              <ElectronicsProductCard
                key={p.id}
                orgSlug={orgSlug}
                product={p}
                locale={locale}
              />
            ))}
          </div>

          {/* Pagination */}
          {pagination.totalPages > 1 && (
            <nav className="flex items-center justify-center gap-2 pt-6">
              {page > 1 && (
                <Link
                  href={`/shop/${orgSlug}?page=${page - 1}`}
                  className="rounded-xl border bg-white px-4 py-2 text-xs font-bold text-slate-700 hover:bg-slate-50"
                >
                  আগের পেজ
                </Link>
              )}
              <span className="text-xs font-semibold text-slate-500">
                পেজ {pagination.page} / {pagination.totalPages}
              </span>
              {page < pagination.totalPages && (
                <Link
                  href={`/shop/${orgSlug}?page=${page + 1}`}
                  className="rounded-xl border bg-white px-4 py-2 text-xs font-bold text-slate-700 hover:bg-slate-50"
                >
                  পরের পেজ
                </Link>
              )}
            </nav>
          )}
        </section>

        {/* 6. Popular Electronics Brands Bar */}
        <section className="rounded-3xl border border-slate-200/90 bg-white p-6 shadow-xs space-y-4">
          <div className="text-center">
            <h3 className="text-sm font-black text-slate-900 uppercase tracking-widest text-slate-500">
              শীর্ষ অফিসিয়াল গ্যাজেট ব্র্যান্ডস
            </h3>
            <p className="text-xs text-slate-400">সরাসরি অনুমোদিত ব্র্যান্ড ডিস্ট্রিবিউটর থেকে সংগৃহীত</p>
          </div>
          <div className="flex flex-wrap items-center justify-center gap-6 sm:gap-10 pt-2 text-slate-600 font-black text-sm">
            {["APPLE", "SAMSUNG", "XIAOMI", "ANKER", "SONY", "ASUS", "ONEPLUS", "LENOVO"].map(
              (brand) => (
                <span
                  key={brand}
                  className="tracking-wider text-slate-400 hover:text-slate-900 transition cursor-default"
                >
                  {brand}
                </span>
              ),
            )}
          </div>
        </section>
      </div>
    </div>
  );
}

// ----------------------------------------------------
// 7. Branch / Showroom Stock Availability (Star Tech Style)
// ----------------------------------------------------
export function ElectronicsBranchStock({
  productName,
}: {
  productName?: string;
}) {
  const branches = [
    { name: "আইডিবি ভবন শাখা (IDB Bhaban, Agargaon)", status: "in_stock", label: "স্টকে আছে" },
    { name: "মাল্টিপ্ল্যান সেন্টার (Multiplan, Elephant Rd)", status: "in_stock", label: "স্টকে আছে" },
    { name: "উত্তরা শাখা (Uttara Sector 3, Dhaka)", status: "limited", label: "সীমিত স্টক" },
    { name: "যমুনা ফিউচার পার্ক (Level 4, JFP)", status: "in_stock", label: "স্টকে আছে" },
    { name: "চট্টগ্রাম জিইসি শোরুম (GEC Circle, Ctg)", status: "in_stock", label: "স্টকে আছে" },
    { name: "রাজশাহী ও সিলেট ব্রাঞ্চ (Rajshahi / Sylhet)", status: "out_of_stock", label: "স্টক শেষ" },
  ];

  return (
    <div className="space-y-3 rounded-2xl border border-slate-200/90 bg-white p-4 text-xs shadow-xs">
      <div className="flex items-center justify-between border-b border-slate-100 pb-2">
        <div className="flex items-center gap-2 font-bold text-slate-900">
          <span className="text-base text-indigo-600">🏬</span>
          <span>শোরুম ও ব্রাঞ্চ স্টক প্রাপ্যতা (Showroom Stock)</span>
        </div>
        <span className="text-[10px] text-slate-400 font-medium">লাইভ আপডেট</span>
      </div>

      <div className="grid gap-2 sm:grid-cols-2">
        {branches.map((b) => (
          <div
            key={b.name}
            className="flex items-center justify-between rounded-xl bg-slate-50 p-2.5 border border-slate-100"
          >
            <span className="text-[11px] font-bold text-slate-700">{b.name}</span>
            <span
              className={`text-[10px] font-extrabold px-2 py-0.5 rounded-full ${
                b.status === "in_stock"
                  ? "bg-emerald-100 text-emerald-800"
                  : b.status === "limited"
                  ? "bg-amber-100 text-amber-800"
                  : "bg-slate-200 text-slate-500"
              }`}
            >
              {b.status === "in_stock" ? "● " : b.status === "limited" ? "⚠️ " : "○ "}
              {b.label}
            </span>
          </div>
        ))}
      </div>

      <p className="text-[10px] text-slate-400">
        💡 আপনি সরাসরি শোরুমে এসে দেখে কিনতে পারেন অথবা হোম ডেলিভারির জন্য অনলাইনে অর্ডার করতে পারেন।
      </p>
    </div>
  );
}

// ----------------------------------------------------
// 8. Essentials Charger & Protection Combo Pack
// ----------------------------------------------------
export function ElectronicsAccessoriesCombo({
  orgSlug,
  mainProduct,
}: {
  orgSlug: string;
  mainProduct: ShopProduct;
}) {
  const [chargerChecked, setChargerChecked] = useState(true);
  const [glassChecked, setGlassChecked] = useState(true);
  const [caseChecked, setCaseChecked] = useState(false);
  const [busy, setBusy] = useState(false);
  const [added, setAdded] = useState(false);

  const chargerPrice = 125000n; // 1250 taka in minor
  const glassPrice = 35000n;    // 350 taka in minor
  const casePrice = 45000n;     // 450 taka in minor

  const mainPrice = BigInt(mainProduct.priceMinor || "0");
  let accessoriesTotal = 0n;
  let itemsCount = 1;
  if (chargerChecked) { accessoriesTotal += chargerPrice; itemsCount++; }
  if (glassChecked) { accessoriesTotal += glassPrice; itemsCount++; }
  if (caseChecked) { accessoriesTotal += casePrice; itemsCount++; }

  const rawTotal = mainPrice + accessoriesTotal;
  // ৳500 flat combo savings if at least 2 accessories are picked
  const savings = itemsCount >= 3 ? 50000n : 20000n;
  const comboTotal = rawTotal > savings ? rawTotal - savings : rawTotal;

  async function handleAddCombo() {
    setBusy(true);
    setAdded(false);
    try {
      await patchCartLine(orgSlug, {
        productId: mainProduct.id,
        variantId: null,
        quantity: 1,
        includeBump: false,
      });
      notifyCartUpdated(orgSlug);
      setAdded(true);
    } catch {
      /* ignore */
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-4 rounded-3xl border border-indigo-200 bg-gradient-to-br from-indigo-50/60 via-white to-blue-50/40 p-5 shadow-xs">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <span className="flex h-8 w-8 items-center justify-center rounded-xl bg-indigo-600 text-white text-sm">⚡</span>
          <div>
            <h3 className="text-sm font-black text-slate-900">অপরিহার্য চার্জার ও প্রোটেকশন কম্বো (Essentials Combo)</h3>
            <p className="text-[11px] text-slate-500">বক্সে চার্জার নেই? এক ক্লিকে অরিজিনাল এক্সেসরিজ যুক্ত করে ৳৫০০ সেভ করুন</p>
          </div>
        </div>
        <span className="rounded-full bg-indigo-600 px-3 py-1 text-[10px] font-black text-white">
          স্পেশাল কম্বো অফার
        </span>
      </div>

      <div className="grid gap-3 sm:grid-cols-3">
        {/* Charger */}
        <label
          className={`flex cursor-pointer items-start gap-3 rounded-2xl border p-3 transition ${
            chargerChecked ? "border-indigo-600 bg-white shadow-xs" : "border-slate-200 bg-white/60 opacity-60"
          }`}
        >
          <input
            type="checkbox"
            checked={chargerChecked}
            onChange={(e) => setChargerChecked(e.target.checked)}
            className="mt-1 accent-indigo-600"
          />
          <div>
            <span className="text-xl">🔌</span>
            <p className="mt-1 text-xs font-black text-slate-900">67W GaN ফাস্ট চার্জার</p>
            <p className="text-[10px] text-slate-500">আল্ট্রা ফাস্ট চার্জিং ও সেফটি চিপ</p>
            <p className="mt-1 text-xs font-extrabold text-indigo-600">+ ৳১,২৫০</p>
          </div>
        </label>

        {/* 9H Tempered Glass */}
        <label
          className={`flex cursor-pointer items-start gap-3 rounded-2xl border p-3 transition ${
            glassChecked ? "border-indigo-600 bg-white shadow-xs" : "border-slate-200 bg-white/60 opacity-60"
          }`}
        >
          <input
            type="checkbox"
            checked={glassChecked}
            onChange={(e) => setGlassChecked(e.target.checked)}
            className="mt-1 accent-indigo-600"
          />
          <div>
            <span className="text-xl">📱</span>
            <p className="mt-1 text-xs font-black text-slate-900">9H প্রিমিয়াম গ্লাস প্রোটেক্টর</p>
            <p className="text-[10px] text-slate-500">এজ-টু-এজ ক্র্যাক রেজিস্ট্যান্ট</p>
            <p className="mt-1 text-xs font-extrabold text-indigo-600">+ ৳৩৫০</p>
          </div>
        </label>

        {/* Armor Case */}
        <label
          className={`flex cursor-pointer items-start gap-3 rounded-2xl border p-3 transition ${
            caseChecked ? "border-indigo-600 bg-white shadow-xs" : "border-slate-200 bg-white/60 opacity-60"
          }`}
        >
          <input
            type="checkbox"
            checked={caseChecked}
            onChange={(e) => setCaseChecked(e.target.checked)}
            className="mt-1 accent-indigo-600"
          />
          <div>
            <span className="text-xl">🛡️</span>
            <p className="mt-1 text-xs font-black text-slate-900">শকপ্রুফ এয়ার-কুশন কেস</p>
            <p className="text-[10px] text-slate-500">ড্রপ প্রটেকশন ও গ্রিপ ফিনিশ</p>
            <p className="mt-1 text-xs font-extrabold text-indigo-600">+ ৳৪৫০</p>
          </div>
        </label>
      </div>

      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 border-t border-indigo-100 pt-3">
        <div>
          <div className="flex items-baseline gap-2">
            <span className="text-sm font-bold text-slate-400 line-through">
              {formatTechPrice(rawTotal.toString())}
            </span>
            <span className="text-xl font-black text-slate-900 font-mono">
              {formatTechPrice(comboTotal.toString())}
            </span>
            <span className="text-xs font-bold text-emerald-700">
              (বাঁচবে {formatTechPrice(savings.toString())})
            </span>
          </div>
          <p className="text-[11px] text-slate-500">মূল ডিভাইসের সাথে {itemsCount - 1}টি প্রটেকশন এক্সেসরিজ যুক্ত হবে</p>
        </div>

        {added ? (
          <div className="flex items-center gap-2">
            <span className="text-xs font-bold text-emerald-800">✅ কম্বো ব্যাগে যোগ হয়েছে!</span>
            <Link
              href={`/shop/${orgSlug}/cart`}
              className="rounded-xl bg-indigo-600 px-4 py-2 text-xs font-bold text-white hover:bg-indigo-700"
            >
              কার্ট দেখুন
            </Link>
          </div>
        ) : (
          <button
            type="button"
            onClick={handleAddCombo}
            disabled={busy}
            className="rounded-xl bg-indigo-600 px-5 py-3 text-xs font-black text-white shadow-md shadow-indigo-600/20 hover:bg-indigo-700 transition disabled:opacity-50"
          >
            {busy ? "যোগ হচ্ছে…" : "এক ক্লিকে কম্বো যোগ করুন"}
          </button>
        )}
      </div>
    </div>
  );
}

// ----------------------------------------------------
// 9. Side-by-Side Gadget Compare Modal
// ----------------------------------------------------
export function ElectronicsCompareModal({
  open,
  onClose,
  productA,
  productB,
  orgSlug,
}: {
  open: boolean;
  onClose: () => void;
  productA: ShopProduct;
  productB?: ShopProduct | null;
  orgSlug: string;
}) {
  if (!open) return null;

  const sampleB: ShopProduct = productB || {
    ...productA,
    id: "sample-compare-b",
    name: "ফ্ল্যাগশিপ প্রো অ্যাডভান্সড ভ্যারিয়েন্ট",
    priceMinor: String(Number(productA.priceMinor || "0") + 800000),
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4 backdrop-blur-sm animate-in fade-in duration-200">
      <div className="relative w-full max-w-3xl rounded-3xl bg-white p-6 shadow-2xl sm:p-7 max-h-[90vh] overflow-y-auto">
        <button
          type="button"
          onClick={onClose}
          className="absolute right-5 top-5 flex h-9 w-9 items-center justify-center rounded-full bg-slate-100 text-slate-500 hover:bg-slate-200 transition"
          aria-label="Close"
        >
          ✕
        </button>

        <div className="flex items-center gap-2.5">
          <span className="text-2xl">⚖️</span>
          <div>
            <h3 className="text-base font-black text-slate-900">গ্যাজেট তুলনা (Side-by-Side Tech Comparison)</h3>
            <p className="text-xs text-slate-500">দুটি ডিভাইসের স্পেসিফিকেশন ও মূল্য সরাসরি তুলনা করুন</p>
          </div>
        </div>

        <div className="mt-5 overflow-x-auto">
          <table className="w-full text-left text-xs">
            <thead>
              <tr className="border-b border-slate-200">
                <th className="p-3 w-1/3 text-slate-500 font-bold">বৈশিষ্ট্য</th>
                <th className="p-3 w-1/3 font-black text-slate-900">
                  <p className="line-clamp-2">{productA.name}</p>
                  <p className="mt-1 text-base font-black text-indigo-600 font-mono">
                    {formatTechPrice(productA.priceMinor)}
                  </p>
                </th>
                <th className="p-3 w-1/3 font-black text-slate-900">
                  <p className="line-clamp-2">{sampleB.name}</p>
                  <p className="mt-1 text-base font-black text-indigo-600 font-mono">
                    {formatTechPrice(sampleB.priceMinor)}
                  </p>
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 text-slate-700">
              <tr>
                <td className="p-3 font-bold text-slate-500">প্রসেসর / চিপসেট</td>
                <td className="p-3 font-semibold">Flagship Octa-Core 4nm</td>
                <td className="p-3 font-semibold">Flagship Pro 3nm Max</td>
              </tr>
              <tr>
                <td className="p-3 font-bold text-slate-500">ডিসপ্লে টেকনোলজি</td>
                <td className="p-3 font-semibold">6.7&quot; Super AMOLED, 120Hz</td>
                <td className="p-3 font-semibold">6.8&quot; Dynamic LTPO AMOLED, 1-120Hz</td>
              </tr>
              <tr>
                <td className="p-3 font-bold text-slate-500">ক্যামেরা সেটআপ</td>
                <td className="p-3 font-semibold">50MP Main OIS + 12MP Ultra-Wide</td>
                <td className="p-3 font-semibold">200MP Main + Periscope 5X Zoom</td>
              </tr>
              <tr>
                <td className="p-3 font-bold text-slate-500">ব্যাটারি ও ফাস্ট চার্জিং</td>
                <td className="p-3 font-semibold">5000mAh · 67W ফাস্ট চার্জ</td>
                <td className="p-3 font-semibold">5400mAh · 100W সুপারভুক চার্জ</td>
              </tr>
              <tr>
                <td className="p-3 font-bold text-slate-500">অফিশিয়াল ওয়ারেন্টি</td>
                <td className="p-3 font-semibold text-emerald-700">১ বছর পার্টস ও সার্ভিস</td>
                <td className="p-3 font-semibold text-emerald-700">১ বছর পার্টস ও সার্ভিস</td>
              </tr>
              <tr>
                <td className="p-3 font-bold text-slate-500">রেটিং ও রিভিউ</td>
                <td className="p-3 font-semibold">★ ৪.৮ / ৫.০ (১২৪ রিভিউ)</td>
                <td className="p-3 font-semibold">★ ৪.৯ / ৫.০ (১৮০ রিভিউ)</td>
              </tr>
            </tbody>
          </table>
        </div>

        <div className="mt-5 flex justify-end gap-3 border-t border-slate-100 pt-3">
          <button
            type="button"
            onClick={onClose}
            className="rounded-xl border border-slate-200 px-5 py-2.5 text-xs font-bold text-slate-700 hover:bg-slate-50"
          >
            বন্ধ করুন
          </button>
        </div>
      </div>
    </div>
  );
}

// ----------------------------------------------------
// 10. Online IMEI & Warranty Verification Modal
// ----------------------------------------------------
export function ElectronicsWarrantyLookupModal({
  open,
  onClose,
}: {
  open: boolean;
  onClose: () => void;
}) {
  const [query, setQuery] = useState("");
  const [result, setResult] = useState<any>(null);

  if (!open) return null;

  function handleCheck(e: React.FormEvent) {
    e.preventDefault();
    if (!query.trim()) return;
    setResult({
      deviceName: "Samsung Galaxy Flagship 5G / Apple Official",
      serialNo: query.toUpperCase(),
      purchaseDate: "15 January 2026",
      warrantyDaysLeft: 274,
      status: "সক্রিয় (Active Warranty)",
      authorizedCenter: "অফিসিয়াল অথোরাইজড সার্ভিস সেন্টার, ধানমন্ডি ও উত্তরা ব্রাঞ্চ",
    });
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4 backdrop-blur-sm animate-in fade-in duration-200">
      <div className="relative w-full max-w-md rounded-3xl bg-white p-6 shadow-2xl sm:p-7">
        <button
          type="button"
          onClick={onClose}
          className="absolute right-5 top-5 flex h-9 w-9 items-center justify-center rounded-full bg-slate-100 text-slate-500 hover:bg-slate-200 transition"
          aria-label="Close"
        >
          ✕
        </button>

        <div className="text-center">
          <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-full bg-indigo-50 text-2xl text-indigo-600">
            🛡️
          </div>
          <h3 className="mt-3 text-base font-black text-slate-900">অনলাইন ওয়ারেন্টি যাচাই পোর্টাল</h3>
          <p className="mt-1 text-xs text-slate-500">
            আপনার ডিভাইসের সিরিয়াল নম্বর, IMEI অথবা ইনভয়েস নম্বর দিয়ে ওয়ারেন্টির মেয়াদ চেক করুন।
          </p>
        </div>

        <form onSubmit={handleCheck} className="mt-4 space-y-3">
          <input
            type="text"
            required
            placeholder="IMEI / সিরিয়াল নম্বর লিখুন (যেমন: 8642910...)"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            className="w-full rounded-xl border border-slate-200 p-2.5 text-xs font-mono uppercase focus:border-indigo-600 focus:outline-none"
          />
          <button
            type="submit"
            className="w-full rounded-xl bg-slate-900 py-2.5 text-xs font-black text-white shadow hover:bg-indigo-600 transition"
          >
            ওয়ারেন্টি স্ট্যাটাস চেক করুন
          </button>
        </form>

        {result && (
          <div className="mt-4 space-y-2 rounded-2xl border border-emerald-200 bg-emerald-50/70 p-4 text-xs">
            <div className="flex items-center justify-between border-b border-emerald-200/60 pb-2">
              <span className="font-bold text-emerald-950">ডিভাইস স্ট্যাটাস:</span>
              <span className="font-black text-emerald-700">✅ {result.status}</span>
            </div>
            <p className="text-slate-700"><strong>মডেল:</strong> {result.deviceName}</p>
            <p className="text-slate-700 font-mono"><strong>সিরিয়াল:</strong> {result.serialNo}</p>
            <p className="text-slate-700"><strong>ক্রয়ের তারিখ:</strong> {result.purchaseDate}</p>
            <p className="text-emerald-900 font-bold"><strong>অবশিষ্ট মেয়াদ:</strong> {result.warrantyDaysLeft} দিন</p>
            <p className="text-[11px] text-slate-500 pt-1"><strong>সার্ভিস সেন্টার:</strong> {result.authorizedCenter}</p>
          </div>
        )}
      </div>
    </div>
  );
}

// ----------------------------------------------------
// 11. Device Compatibility Checker
// ----------------------------------------------------
export function ElectronicsCompatibilityChecker() {
  const [device, setDevice] = useState("iphone15");

  return (
    <div className="space-y-2.5 rounded-2xl border border-slate-200/90 bg-slate-50/80 p-4 text-xs">
      <div className="flex items-center gap-2 font-bold text-slate-900">
        <span className="text-base text-indigo-600">🔌</span>
        <span>ডিভাইস কম্প্যাটিবিলিটি চেকার (Device Compatibility):</span>
      </div>

      <div className="flex items-center gap-2">
        <select
          value={device}
          onChange={(e) => setDevice(e.target.value)}
          className="w-full rounded-xl border border-slate-200 bg-white p-2 text-xs font-bold text-slate-800 focus:border-indigo-600 focus:outline-none"
        >
          <option value="iphone15">Apple iPhone 15 / 15 Pro / 16 (Type-C)</option>
          <option value="samsung">Samsung Galaxy S23 / S24 / Ultra</option>
          <option value="xiaomi">Xiaomi / Redmi / POCO Flagships</option>
          <option value="macbook">Apple MacBook Air / Pro (M1/M2/M3)</option>
          <option value="windows">Windows Type-C Laptops (Dell, Asus, HP)</option>
        </select>
      </div>

      <div className="flex items-center gap-2 rounded-xl bg-emerald-50 p-2.5 text-[11px] font-bold text-emerald-800 border border-emerald-100">
        <span>✅</span>
        <span>১০০% ফুল কম্প্যাটিবল — ফাস্ট চার্জিং, হিটিং প্রটেকশন ও হাই-স্পিড ডেটা ট্রান্সফার নিশ্চিত।</span>
      </div>
    </div>
  );
}

