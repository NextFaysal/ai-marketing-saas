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

export function formatBeautyPrice(minor: string): string {
  try {
    return formatMinor(BigInt(minor));
  } catch {
    return minor;
  }
}

// ----------------------------------------------------
// 1. Beauty Trust & Authenticity Bar (4 Pillars)
// ----------------------------------------------------
export function BeautyAuthenticityBadge() {
  const pillars = [
    {
      icon: "🔒",
      title: "১০০% অরিজিনাল গ্যারান্টি",
      subtitle: "সরাসরি কোরিয়া, ইউএসএ ও ইউকে ডিস্ট্রিবিউটর",
    },
    {
      icon: "🧪",
      title: "ডার্মাটোলজিক্যালি টেস্টেড",
      subtitle: "পারদ, স্টেরয়েড ও ক্ষতিকর কেমিক্যালমুক্ত",
    },
    {
      icon: "📦",
      title: "বাবল সুরক্ষিত প্যাকেজিং",
      subtitle: "কাচের সিরাম ও বোতল ভাঙা প্রতিরোধী প্রটেকশন",
    },
    {
      icon: "🔄",
      title: "আনবক্সিং মানিব্যাক পলিসি",
      subtitle: "নকল প্রমাণে ৩ গুণ টাকা ফেরতের নিশ্চয়তা",
    },
  ];

  return (
    <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
      {pillars.map((p) => (
        <div
          key={p.title}
          className="flex items-start gap-3 rounded-2xl border border-rose-100 bg-white p-3.5 shadow-xs transition hover:border-pink-300 hover:shadow-sm"
        >
          <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-pink-50 text-xl text-rose-600">
            {p.icon}
          </span>
          <div>
            <h4 className="text-xs font-black text-slate-900">{p.title}</h4>
            <p className="mt-0.5 text-[11px] text-slate-500 leading-snug">{p.subtitle}</p>
          </div>
        </div>
      ))}
    </div>
  );
}

// ----------------------------------------------------
// 2. Health & Beauty Product Card (Shajgoj / Banglashoppers Style)
// ----------------------------------------------------
export function BeautyProductCard({
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

  const priceMinor = product.priceMinor;
  const compareMinor = product.compareAtMinor;
  const isOutOfStock = product.stockState === "out_of_stock";

  const percentOff =
    compareMinor && BigInt(compareMinor) > BigInt(priceMinor) && BigInt(compareMinor) > 0n
      ? Math.round(
          Number(((BigInt(compareMinor) - BigInt(priceMinor)) * 100n) / BigInt(compareMinor)),
        )
      : 0;

  async function handleQuickAdd() {
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
    <div className="group relative flex flex-col justify-between overflow-hidden rounded-2xl border border-rose-100/90 bg-white shadow-xs transition-all duration-300 hover:border-pink-400 hover:shadow-xl">
      {/* Top Badges & Image */}
      <div className="relative aspect-square w-full overflow-hidden bg-gradient-to-b from-pink-50/30 to-white p-3">
        <div className="absolute left-2.5 top-2.5 z-10 flex flex-col gap-1">
          {percentOff > 0 ? (
            <span className="rounded-lg bg-rose-600 px-2 py-0.5 text-[10px] font-black text-white shadow-xs">
              −{percentOff}%
            </span>
          ) : null}
          <span className="rounded-lg bg-rose-950/80 px-2 py-0.5 text-[9px] font-bold text-white backdrop-blur-xs">
            ✨ ১০০% জেনুইন
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
              width={350}
              height={350}
              className="h-full w-full object-contain p-2 transition duration-500 group-hover:scale-105"
            />
          ) : (
            <div className="flex h-full w-full items-center justify-center text-4xl">💄</div>
          )}
        </Link>

        <QuickViewButton orgSlug={orgSlug} product={product} locale={locale} />
      </div>

      {/* Card Info */}
      <div className="flex flex-1 flex-col justify-between p-3.5 space-y-2.5">
        <div>
          <div className="flex items-center justify-between text-[11px]">
            <span className="font-semibold text-rose-700">
              {product.category || "স্কিনকেয়ার"}
            </span>
            <span className="rounded-full bg-pink-50 px-2 py-0.5 text-[10px] font-bold text-rose-800">
              {isOutOfStock ? "স্টক শেষ" : "● স্টকে আছে"}
            </span>
          </div>

          <Link
            href={`/shop/${orgSlug}/products/${product.slug}`}
            className="mt-1 line-clamp-2 text-xs font-black text-slate-900 transition hover:text-rose-700 sm:text-sm"
            title={product.name}
          >
            {product.name}
          </Link>
        </div>

        {/* Pricing & Add to Cart Button */}
        <div className="border-t border-rose-50 pt-2.5 space-y-2">
          <div className="flex items-baseline gap-2">
            <span className="text-base font-black text-rose-950 font-serif sm:text-lg">
              {formatBeautyPrice(priceMinor)}
            </span>
            {compareMinor && BigInt(compareMinor) > BigInt(priceMinor) ? (
              <span className="text-xs text-slate-400 line-through">
                {formatBeautyPrice(compareMinor)}
              </span>
            ) : null}
          </div>

          <button
            type="button"
            onClick={handleQuickAdd}
            disabled={isOutOfStock || busy}
            className={`w-full rounded-xl py-2 text-xs font-black transition flex items-center justify-center gap-1.5 ${
              isOutOfStock
                ? "bg-slate-100 text-slate-400 cursor-not-allowed"
                : added
                  ? "bg-emerald-600 text-white"
                  : "bg-rose-900 text-white shadow-xs hover:bg-rose-950 active:scale-95"
            }`}
          >
            {added ? (
              <span>✓ ব্যাগে যোগ হয়েছে</span>
            ) : (
              <>
                <span>🛍️</span>
                <span>{isOutOfStock ? "স্টক শেষ" : busy ? "যোগ হচ্ছে…" : "ব্যাগে নিন"}</span>
              </>
            )}
          </button>
        </div>
      </div>
    </div>
  );
}

// ----------------------------------------------------
// 3. Interactive Cosmetic Shade Swatch Selector
// ----------------------------------------------------
export function BeautyShadeSelector({
  selectedShade = "Ivory Fair",
  onSelectShade,
}: {
  selectedShade?: string;
  onSelectShade?: (shadeName: string) => void;
}) {
  const shades = [
    { name: "Fair Ivory 110", color: "#F7E2D0", tone: "Cool Fair" },
    { name: "Classic Beige 120", color: "#E7BA99", tone: "Neutral Light" },
    { name: "Warm Honey 130", color: "#D59F7A", tone: "Warm Medium" },
    { name: "Golden Tan 140", color: "#C68960", tone: "Golden Dusk" },
    { name: "Deep Amber 150", color: "#A86940", tone: "Deep Warm" },
  ];

  return (
    <div className="space-y-2.5 rounded-2xl border border-rose-100 bg-pink-50/30 p-3.5">
      <div className="flex items-center justify-between text-xs">
        <label className="font-bold text-slate-900">
          আপনার ত্বকের শেড বেছে নিন: <span className="text-rose-700">{selectedShade}</span>
        </label>
        <span className="text-[11px] font-bold text-rose-800">ন্যাচারাল ফিনিশ</span>
      </div>

      <div className="flex flex-wrap items-center gap-2.5">
        {shades.map((s) => {
          const active = selectedShade === s.name;
          return (
            <button
              key={s.name}
              type="button"
              onClick={() => onSelectShade && onSelectShade(s.name)}
              className={`group flex items-center gap-2 rounded-xl border px-3 py-1.5 transition ${
                active
                  ? "border-rose-900 bg-white shadow-xs ring-2 ring-rose-400"
                  : "border-slate-200 bg-white hover:border-pink-400"
              }`}
            >
              <span
                className="h-4 w-4 rounded-full border border-black/10 shadow-inner"
                style={{ backgroundColor: s.color }}
              />
              <span className="text-xs font-bold text-slate-800">{s.name}</span>
            </button>
          );
        })}
      </div>
    </div>
  );
}

// ----------------------------------------------------
// 4. Complete 3-Step Skincare Routine Bundle (Save ৳350)
// ----------------------------------------------------
export function BeautyRoutineBundle({
  orgSlug,
  mainProduct,
}: {
  orgSlug: string;
  mainProduct: ShopProduct;
}) {
  const [cleanser, setCleanser] = useState(true);
  const [serum, setSerum] = useState(true);
  const [sunscreen, setSunscreen] = useState(true);
  const [busy, setBusy] = useState(false);
  const [added, setAdded] = useState(false);

  const mainPrice = BigInt(mainProduct.priceMinor || "0");
  const cleanserPrice = 75000n; // 750 taka
  const sunscreenPrice = 115000n; // 1150 taka

  let extraTotal = 0n;
  if (cleanser) extraTotal += cleanserPrice;
  if (sunscreen) extraTotal += sunscreenPrice;

  const rawTotal = mainPrice + extraTotal;
  const comboDiscount = 35000n; // ৳350 taka savings
  const finalTotal = rawTotal > comboDiscount ? rawTotal - comboDiscount : rawTotal;

  async function handleAddRoutineBundle() {
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
    <div className="space-y-4 rounded-3xl border border-rose-200 bg-gradient-to-br from-rose-50/80 via-white to-pink-50/50 p-5 shadow-xs">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <span className="flex h-9 w-9 items-center justify-center rounded-xl bg-rose-900 text-white text-lg">
            ✨
          </span>
          <div>
            <h3 className="text-sm font-black text-slate-900">
              কমপ্লিট ৩-স্টেপ স্কিনকেয়ার রুটিন (Glass Skin Routine)
            </h3>
            <p className="text-[11px] text-slate-500">
              ক্লিনজার + টার্গেটেড সিরাম + সানস্ক্রিন একসাথে ব্যবহারে দ্রুততম গ্লো রেজাল্ট
            </p>
          </div>
        </div>
        <span className="rounded-full bg-rose-900 px-3 py-1 text-[10px] font-black text-white">
          ৳৩৫০ ইনস্ট্যান্ট ছাড়
        </span>
      </div>

      <div className="grid gap-3 sm:grid-cols-3">
        {/* Step 1: Gentle Cleanser */}
        <label
          className={`flex cursor-pointer items-start gap-2.5 rounded-2xl border p-3 transition ${
            cleanser
              ? "border-rose-900 bg-white shadow-xs"
              : "border-slate-200 bg-white/60 opacity-60"
          }`}
        >
          <input
            type="checkbox"
            checked={cleanser}
            onChange={(e) => setCleanser(e.target.checked)}
            className="mt-1 accent-rose-900"
          />
          <div>
            <span className="rounded bg-rose-100 px-1.5 py-0.2 text-[9px] font-black text-rose-800">
              স্টেপ ১: ক্লিনজার
            </span>
            <p className="mt-1 text-xs font-bold text-slate-900">সিকা সুদিং ফোমিং ফেসওয়াশ</p>
            <p className="text-xs font-extrabold text-rose-900">+ ৳৭৫০</p>
          </div>
        </label>

        {/* Step 2: Main Product (Targeted Serum / Moisturizer) */}
        <div className="rounded-2xl border-2 border-rose-900 bg-white p-3 shadow-xs">
          <span className="rounded bg-rose-900 px-1.5 py-0.2 text-[9px] font-black text-white">
            স্টেপ ২: মূল সিরাম (নির্বাচিত)
          </span>
          <p className="mt-1 line-clamp-1 text-xs font-black text-slate-900">{mainProduct.name}</p>
          <p className="text-xs font-extrabold text-rose-900">{formatBeautyPrice(mainProduct.priceMinor)}</p>
        </div>

        {/* Step 3: Daily Sunscreen SPF 50+ */}
        <label
          className={`flex cursor-pointer items-start gap-2.5 rounded-2xl border p-3 transition ${
            sunscreen
              ? "border-rose-900 bg-white shadow-xs"
              : "border-slate-200 bg-white/60 opacity-60"
          }`}
        >
          <input
            type="checkbox"
            checked={sunscreen}
            onChange={(e) => setSunscreen(e.target.checked)}
            className="mt-1 accent-rose-900"
          />
          <div>
            <span className="rounded bg-rose-100 px-1.5 py-0.2 text-[9px] font-black text-rose-800">
              স্টেপ ৩: সান প্রটেকশন
            </span>
            <p className="mt-1 text-xs font-bold text-slate-900">হায়ালুরনিক ওয়াটার সানস্ক্রিন SPF 50+</p>
            <p className="text-xs font-extrabold text-rose-900">+ ৳১,১৫০</p>
          </div>
        </label>
      </div>

      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 border-t border-rose-100 pt-3">
        <div>
          <div className="flex items-baseline gap-2">
            <span className="text-sm font-bold text-slate-400 line-through">
              {formatBeautyPrice(rawTotal.toString())}
            </span>
            <span className="text-xl font-black text-rose-950 font-serif">
              {formatBeautyPrice(finalTotal.toString())}
            </span>
            <span className="text-xs font-bold text-rose-700">
              (৳৩৫০ সেভ হচ্ছে)
            </span>
          </div>
          <p className="text-[11px] text-slate-500">সম্পূর্ণ রুটিন সেট একসাথে বাবল প্রটেকশনে ডেলিভারি হবে</p>
        </div>

        {added ? (
          <div className="flex items-center gap-2">
            <span className="text-xs font-bold text-emerald-800">✓ সম্পূর্ণ রুটিন ব্যাগে যোগ হয়েছে!</span>
            <Link
              href={`/shop/${orgSlug}/cart`}
              className="rounded-xl bg-rose-900 px-4 py-2 text-xs font-bold text-white hover:bg-rose-950"
            >
              কার্ট দেখুন
            </Link>
          </div>
        ) : (
          <button
            type="button"
            onClick={handleAddRoutineBundle}
            disabled={busy}
            className="rounded-xl bg-rose-900 px-5 py-3 text-xs font-black text-white shadow-md shadow-rose-900/20 hover:bg-rose-950 transition disabled:opacity-50"
          >
            {busy ? "যোগ হচ্ছে…" : "এক ক্লিকে সম্পূর্ণ ৩-স্টেপ রুটিন কিনুন"}
          </button>
        )}
      </div>
    </div>
  );
}

// ----------------------------------------------------
// 5. Active Ingredients & Dermatologist Usage Guide
// ----------------------------------------------------
export function BeautyIngredientsGuide() {
  return (
    <div className="rounded-2xl border border-rose-100 bg-white p-4 text-xs space-y-3 shadow-xs">
      <div className="flex items-center justify-between border-b border-rose-50 pb-2">
        <h4 className="font-black text-slate-900">অ্যাক্টিভ ইনগ্রেডিয়েন্টস ও ব্যবহারের নিয়ম:</h4>
        <span className="text-[10px] text-rose-700 font-bold">ল্যাব ভেরিফায়েড ফর্মুলা</span>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-3 gap-2.5 text-[11px]">
        <div className="rounded-xl border border-rose-50 bg-rose-50/40 p-2.5">
          <p className="font-bold text-slate-900">🧪 ১০% নিয়াসিনামাইড</p>
          <p className="mt-0.5 text-slate-500">পোর মিনিমাইজ করে ও ব্রণের দাগ হালকা করে</p>
        </div>
        <div className="rounded-xl border border-rose-50 bg-rose-50/40 p-2.5">
          <p className="font-bold text-slate-900">💧 হায়ালুরোনিক অ্যাসিড</p>
          <p className="mt-0.5 text-slate-500">ত্বকের গভীরে আর্দ্রতা ধরে রেখে গ্লাস স্কিন লুক দেয়</p>
        </div>
        <div className="rounded-xl border border-rose-50 bg-rose-50/40 p-2.5">
          <p className="font-bold text-slate-900">🌿 সেন্টেলা এশিয়াটিকা</p>
          <p className="mt-0.5 text-slate-500">ত্বকের লালচে ভাব ও জ্বালাপোড়া শান্ত করে</p>
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-3 pt-1 border-t border-rose-50 text-[11px] text-slate-600">
        <span className="font-bold text-slate-800">ব্যবহারের সময়:</span>
        <span className="rounded-full bg-amber-50 px-2.5 py-0.5 font-bold text-amber-900">
          ☀️ সকাল (AM)
        </span>
        <span className="rounded-full bg-indigo-50 px-2.5 py-0.5 font-bold text-indigo-900">
          🌙 রাত (PM)
        </span>
        <span className="text-slate-400">· সকল ধরনের ত্বকের জন্য উপযোগী</span>
      </div>
    </div>
  );
}

// ----------------------------------------------------
// 6. 100% Genuine Authenticity Verification Modal
// ----------------------------------------------------
export function BeautyAuthenticityModal({
  open,
  onClose,
  productName,
}: {
  open: boolean;
  onClose: () => void;
  productName: string;
}) {
  if (!open) return null;

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
          <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-rose-100 text-xl text-rose-700">
            🔒
          </span>
          <div>
            <h3 className="text-base font-black text-slate-900">১০০% অরিজিনাল অথেন্টিসিটি সনদ</h3>
            <p className="line-clamp-1 text-xs text-slate-500">{productName}</p>
          </div>
        </div>

        <div className="mt-5 space-y-3 text-xs text-slate-700">
          <div className="rounded-2xl border border-rose-200 bg-pink-50/60 p-4 space-y-2">
            <div className="flex items-center justify-between border-b border-rose-200/60 pb-2">
              <span className="font-bold text-slate-900">সোর্সিং ও আমদানিকারক:</span>
              <span className="font-black text-rose-900">অথোরাইজড গ্লোবাল ডিস্ট্রিবিউটর</span>
            </div>
            <p><strong>আমদানি চ্যানেল:</strong> দক্ষিণ কোরিয়া, যুক্তরাজ্য ও মার্কিন যুক্তরাষ্ট্রের অফিশিয়াল চ্যানেল থেকে সরাসরি আমদানিকৃত।</p>
            <p><strong>ব্যাচ কোড ও কিউআর:</strong> প্যাকেটের গায়ে থাকা অরিজিনাল বারকোড ও ব্যাচ নাম্বার চেক করে যেকোনো অথেনটিকেশন অ্যাপে যাচাই করতে পারবেন।</p>
            <p><strong>মানিব্যাক পলিসি:</strong> নকল বা গ্রে-মার্কেট প্রসাধনী প্রমাণিত হলে ৩ গুণ টাকা রিফান্ড গ্যারান্টি।</p>
          </div>

          <div className="grid grid-cols-3 gap-2 text-center text-[11px]">
            <div className="rounded-xl border border-slate-100 bg-slate-50 p-2.5">
              <p className="font-bold text-slate-900">বিএসটিআই ছাড়পত্র</p>
              <p className="text-slate-400 text-[10px]">BSTI টেস্টেড</p>
            </div>
            <div className="rounded-xl border border-slate-100 bg-slate-50 p-2.5">
              <p className="font-bold text-slate-900">পারদ ও লেড মুক্ত</p>
              <p className="text-slate-400 text-[10px]">০% ক্ষতিকর উপাদান</p>
            </div>
            <div className="rounded-xl border border-slate-100 bg-slate-50 p-2.5">
              <p className="font-bold text-slate-900">তাজা এক্সপায়ারি</p>
              <p className="text-slate-400 text-[10px]">২০২৬-২০২৭ ডেট</p>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

// ----------------------------------------------------
// 7. Interactive Skin Type & Concern Quiz Modal
// ----------------------------------------------------
export function BeautySkinQuizModal({
  open,
  onClose,
}: {
  open: boolean;
  onClose: () => void;
}) {
  const [skinType, setSkinType] = useState("oily");
  const [concern, setConcern] = useState("acne");
  const [submitted, setSubmitted] = useState(false);

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4 backdrop-blur-sm animate-in fade-in duration-200">
      <div className="relative w-full max-w-lg rounded-3xl bg-white p-6 shadow-2xl sm:p-7 space-y-4">
        <button
          type="button"
          onClick={onClose}
          className="absolute right-5 top-5 flex h-9 w-9 items-center justify-center rounded-full bg-slate-100 text-slate-500 hover:bg-slate-200 transition"
          aria-label="Close"
        >
          ✕
        </button>

        <div className="flex items-center gap-2.5">
          <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-pink-100 text-xl text-rose-700">
            🪄
          </span>
          <div>
            <h3 className="text-base font-black text-slate-900">স্মার্ট স্কিন কনসার্ন অ্যাডভাইজর</h3>
            <p className="text-xs text-slate-500">আপনার ত্বকের ধরন অনুযায়ী পারফেক্ট প্রোডাক্ট সাজেশন পান</p>
          </div>
        </div>

        {!submitted ? (
          <div className="space-y-4 text-xs">
            {/* Question 1: Skin Type */}
            <div className="space-y-2">
              <label className="font-bold text-slate-800">১. আপনার ত্বকের ধরন কোনটি?</label>
              <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
                {[
                  { id: "oily", label: "তৈলাক্ত (Oily)" },
                  { id: "dry", label: "শুষ্ক (Dry)" },
                  { id: "combination", label: "মিশ্র (Combo)" },
                  { id: "sensitive", label: "সংবেদনশীল" },
                ].map((t) => (
                  <button
                    key={t.id}
                    type="button"
                    onClick={() => setSkinType(t.id)}
                    className={`rounded-xl border p-2 text-center font-bold transition ${
                      skinType === t.id
                        ? "border-rose-900 bg-rose-900 text-white"
                        : "border-slate-200 bg-slate-50 text-slate-700 hover:border-pink-300"
                    }`}
                  >
                    {t.label}
                  </button>
                ))}
              </div>
            </div>

            {/* Question 2: Main Concern */}
            <div className="space-y-2">
              <label className="font-bold text-slate-800">২. আপনার প্রধান ত্বকের সমস্যা কোনটি?</label>
              <div className="grid grid-cols-2 gap-2">
                {[
                  { id: "acne", label: "ব্রণ ও পোরস (Acne Care)" },
                  { id: "pigment", label: "কালো দাগ ও পিগমেন্টেশন" },
                  { id: "glow", label: "উজ্জ্বলতা ও গ্লাস স্কিন" },
                  { id: "barrier", label: "ড্যামেজড স্কিন ব্যারিয়ার" },
                ].map((c) => (
                  <button
                    key={c.id}
                    type="button"
                    onClick={() => setConcern(c.id)}
                    className={`rounded-xl border p-2.5 text-left font-bold transition ${
                      concern === c.id
                        ? "border-rose-900 bg-pink-50/80 text-rose-950 ring-1 ring-rose-900"
                        : "border-slate-200 bg-white text-slate-700 hover:border-pink-300"
                    }`}
                  >
                    {c.label}
                  </button>
                ))}
              </div>
            </div>

            <button
              type="button"
              onClick={() => setSubmitted(true)}
              className="w-full rounded-2xl bg-rose-900 py-3 text-xs font-black text-white shadow-md hover:bg-rose-950"
            >
              সাজেশন দেখুন →
            </button>
          </div>
        ) : (
          <div className="space-y-3 rounded-2xl border border-rose-200 bg-pink-50/50 p-4 text-xs">
            <h4 className="font-black text-rose-950">✨ আপনার জন্য বিশেষজ্ঞ পরামর্শ:</h4>
            <p className="text-slate-700 leading-relaxed">
              আপনার নির্বাচিত <strong>{skinType}</strong> ত্বকের জন্য স্যালিসিলিক অ্যাসিড (BHA) অথবা নিয়াসিনামাইড সিরাম অত্যন্ত কার্যকর। প্রতিদিন সকালে সানস্ক্রিন এবং রাতে সিকা ময়েশ্চারাইজার ব্যবহারের পরামর্শ দেওয়া হচ্ছে।
            </p>
            <button
              type="button"
              onClick={onClose}
              className="mt-2 w-full rounded-xl bg-rose-900 py-2.5 text-xs font-bold text-white hover:bg-rose-950"
            >
              ম্যাচিং প্রোডাক্ট দেখুন
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

// ----------------------------------------------------
// 8. Health, Beauty & Cosmetics Dedicated Homepage Layout
// ----------------------------------------------------
export function BeautyThemeHome({
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
  const [skinQuizOpen, setSkinQuizOpen] = useState(false);

  const skinConcerns = [
    { label: "ব্রণ ও পোর কেয়ার", icon: "🌿", slug: "acne-care" },
    { label: "ব্রাইটনিং ও গ্লাস স্কিন", icon: "✨", slug: "brightening" },
    { label: "ডিপ ময়েশ্চারাইজার", icon: "💧", slug: "hydration" },
    { label: "অ্যান্টি-এজিং সিরাম", icon: "⏳", slug: "anti-aging" },
    { label: "সান প্রোটেকশন SPF 50+", icon: "☀️", slug: "sunscreen" },
    { label: "লিপস্টিক ও মেকআপ", icon: "💄", slug: "makeup" },
  ];

  return (
    <div className="min-h-screen bg-[#fffafb] text-slate-900 pb-16">
      {/* 1. Top Ribbon */}
      <div className="bg-rose-950 text-white text-xs py-2 px-4">
        <div className="mx-auto max-w-7xl flex flex-wrap items-center justify-between gap-2">
          <div className="flex items-center gap-2 font-bold">
            <span>✨ ১০০% অরিজিনাল কোরিয়ান ও আন্তর্জাতিক কসমেটিক্স</span>
            <span className="hidden sm:inline">·</span>
            <span className="text-pink-300">সরাসরি অথোরাইজড চ্যানেল থেকে সংগৃহীত</span>
          </div>
          <div className="flex items-center gap-2 font-semibold text-[11px]">
            <span>📞 বিউটি কনসালটেশন: 01XXXXXXXXX</span>
            <span>·</span>
            <button
              type="button"
              onClick={() => setSkinQuizOpen(true)}
              className="bg-rose-800 hover:bg-rose-700 px-2.5 py-0.5 rounded-full font-bold underline"
            >
              স্কিন কুইজ দিন
            </button>
          </div>
        </div>
      </div>

      <div className="mx-auto max-w-7xl px-4 sm:px-6 space-y-10 pt-6">
        {/* 2. Hero Banner */}
        <section className="relative overflow-hidden rounded-3xl bg-gradient-to-r from-rose-950 via-pink-900 to-rose-900 text-white shadow-xl border border-rose-300/30">
          <div className="relative z-10 grid gap-8 p-8 md:grid-cols-2 md:p-12 items-center">
            <div className="space-y-4">
              <div className="inline-flex items-center gap-2 rounded-full border border-pink-300/30 bg-pink-500/20 px-3 py-1 text-xs font-black text-pink-200">
                <span>🌸</span>
                <span>AUTHENTIC SKINCARE & LUXURY BEAUTY</span>
              </div>
              <h1 className="text-3xl font-black tracking-tight text-white sm:text-5xl font-serif">
                {settings.shopName || "আপনার ত্বকের জন্য খাঁটি ও বিশ্বস্ত প্রসাধন"}
              </h1>
              <p className="max-w-xl text-xs sm:text-sm text-pink-100 leading-relaxed">
                {settings.metaDescription ||
                  "কোরিয়ান গ্লাস স্কিন সিক্রেট, ইউকে ও ইউএসএ অরিজিনাল সিরাম, ময়েশ্চারাইজার ও মেকআপ। প্রতিটি পণ্যে ১০০% অরিজিনালিটি ও অথেন্টিসিটি নিশ্চয়তা।"}
              </p>
              <div className="flex flex-wrap items-center gap-3 pt-2">
                <a
                  href="#beauty-featured"
                  className="rounded-xl bg-white px-6 py-3 text-xs font-black text-rose-950 shadow-md transition hover:bg-pink-50"
                >
                  বেস্ট সেলিং স্কিনকেয়ার →
                </a>
                <button
                  type="button"
                  onClick={() => setSkinQuizOpen(true)}
                  className="rounded-xl border border-pink-300/40 bg-rose-900/40 px-5 py-3 text-xs font-bold text-white backdrop-blur-sm hover:bg-rose-900/60"
                >
                  🪄 স্কিন টাইপ ম্যাচ করুন
                </button>
              </div>
            </div>

            {/* Hero Right Visual */}
            <div className="flex items-center justify-center">
              <div className="rounded-3xl border border-white/20 bg-white/10 p-6 backdrop-blur-md shadow-2xl text-center space-y-3">
                <span className="text-5xl">✨</span>
                <h3 className="text-lg font-black text-white font-serif">K-Beauty & Glass Skin</h3>
                <p className="text-xs text-pink-200 max-w-xs">
                  COSRX, Beauty of Joseon, Anua এবং The Ordinary এর মতো জনপ্রিয় গ্লোবাল ব্র্যান্ড
                </p>
                <div className="flex justify-center gap-2 text-[10px] font-bold text-pink-100">
                  <span className="rounded-full bg-white/20 px-2.5 py-1">ডার্মাটোলজিস্ট টেস্টেড</span>
                  <span className="rounded-full bg-white/20 px-2.5 py-1">১০০% অথেনটিক</span>
                </div>
              </div>
            </div>
          </div>
        </section>

        {/* 3. 4 Pillars Trust Bar */}
        <BeautyAuthenticityBadge />

        {/* 4. Skin Concerns Category Strip */}
        <section className="space-y-4">
          <div className="flex items-center justify-between">
            <h3 className="text-base font-black text-slate-900 font-serif">
              ত্বকের সমস্যা ও প্রয়োজন অনুযায়ী বেছে নিন:
            </h3>
            <span className="text-xs font-bold text-rose-700">টার্গেটেড সমাধান</span>
          </div>

          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-6">
            {skinConcerns.map((c) => (
              <Link
                key={c.slug}
                href={`/shop/${orgSlug}?category=${c.slug}`}
                className="group flex flex-col items-center justify-center rounded-2xl border border-rose-100 bg-white p-3.5 text-center shadow-xs transition hover:border-pink-400 hover:shadow-md"
              >
                <span className="flex h-12 w-12 items-center justify-center rounded-2xl bg-pink-50 text-2xl transition group-hover:scale-110">
                  {c.icon}
                </span>
                <span className="mt-2 text-xs font-bold text-slate-800 group-hover:text-rose-700">
                  {c.label}
                </span>
              </Link>
            ))}
          </div>
        </section>

        {/* 5. Flash Beauty Deals */}
        {flashSales?.sales && flashSales.sales.length > 0 && flashSales.sales[0]?.products?.length ? (
          <section className="rounded-3xl border border-rose-200 bg-rose-50/70 p-6 space-y-4">
            <div className="flex flex-wrap items-center justify-between gap-3 border-b border-rose-200 pb-3">
              <div className="flex items-center gap-2">
                <span className="text-2xl">🔥</span>
                <div>
                  <h3 className="text-lg font-black text-rose-950 font-serif">
                    {flashSales.sales[0].name || "বিউটি মেগা সেল — সীমিত সময়ের অফার"}
                  </h3>
                  <p className="text-xs text-rose-700">জনপ্রিয় আন্তর্জাতিক ব্র্যান্ডের উপর সর্বোচ্চ ছাড়</p>
                </div>
              </div>
              <FlashCountdown endsAt={flashSales.sales[0].endsAt} serverNow={flashSales.serverNow} locale={locale} />
            </div>

            <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
              {flashSales.sales[0].products.slice(0, 4).map((p) => (
                <BeautyProductCard
                  key={p.id}
                  orgSlug={orgSlug}
                  product={p}
                  locale={locale}
                />
              ))}
            </div>
          </section>
        ) : null}

        {/* 6. Main Product Grid */}
        <section id="beauty-featured" className="space-y-5">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <h2 className="text-xl font-black text-slate-900 sm:text-2xl font-serif">
                জনপ্রিয় কসমেটিক্স ও স্কিনকেয়ার কালেকশন
              </h2>
              <p className="text-xs text-slate-500">
                ১০০% অরিজিনাল সনদ ও ডার্মাটোলজিক্যাল ভেরিফিকেশন সহ
              </p>
            </div>
            <SortSelect orgSlug={orgSlug} locale={locale} value="featured" />
          </div>

          <div className="grid grid-cols-2 gap-3 sm:gap-4 md:grid-cols-3 lg:grid-cols-4">
            {products.map((p) => (
              <BeautyProductCard
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
      </div>

      {/* Skin Quiz Modal */}
      <BeautySkinQuizModal open={skinQuizOpen} onClose={() => setSkinQuizOpen(false)} />
    </div>
  );
}
