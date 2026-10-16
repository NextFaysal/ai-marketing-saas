"use client";
import React, { useState } from "react";
import Link from "next/link";
import { formatMinor } from "@repo/contracts";
import { MediaImage } from "@/components/media-image";
import type { ShopHome, ShopProduct } from "@/lib/storefront-server";
import { patchCartLine, notifyCartUpdated } from "@/lib/storefront-cart";
import { shopT, type ShopLocale } from "@/lib/shop-i18n";
import { SortSelect } from "./SortSelect";
import { FlashCountdown } from "./FlashCountdown";
import { RecentlyViewedStrip } from "./RecentlyViewed";

export function formatKidsPrice(minor: number | string | null | undefined): string {
  if (minor == null) return "৳০";
  const num = typeof minor === "string" ? parseInt(minor, 10) : minor;
  if (isNaN(num)) return "৳০";
  return `৳${Math.round(num / 100).toLocaleString("bn-BD")}`;
}

/** 4 Kids & Baby Trust Pillars */
export function KidsTrustBar() {
  const pillars = [
    { icon: "🍼", title: "১০০% নন-টক্সিক ও BPA-Free", desc: "শিশুর মুখের জন্য নিরাপদ ফুড-গ্রেড উপাদান" },
    { icon: "🧵", title: "নরম কম্বড অর্গানিক কটন", desc: "কোমল ত্বকের জন্য র‍্যাশ-ফ্রি হাইপোঅ্যালার্জেনিক" },
    { icon: "🧸", title: "চোকিং-হ্যাজার্ড টেস্টেড", desc: "আন্তর্জাতিক সেফটি স্ট্যান্ডার্ড অনুযায়ী পরীক্ষিত" },
    { icon: "🚚", title: "সারা দেশে এক্সপ্রেস হোম ডেলিভারি", desc: "ক্যাশ অন ডেলিভারি ও দ্রুত পার্সেল সুবিধা" },
  ];
  return (
    <div className="grid grid-cols-2 gap-3 sm:grid-cols-4 sm:gap-4 my-6">
      {pillars.map((p, i) => (
        <div
          key={i}
          className="flex items-center gap-3 rounded-3xl border border-sky-100 bg-[#f4f9ff] p-3.5 shadow-xs transition hover:border-sky-300"
        >
          <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl bg-sky-200 text-xl">
            {p.icon}
          </span>
          <div className="min-w-0">
            <h4 className="text-xs font-bold text-slate-900 sm:text-sm">{p.title}</h4>
            <p className="text-[11px] text-slate-500 truncate">{p.desc}</p>
          </div>
        </div>
      ))}
    </div>
  );
}

/** Age Group Selector for Kids Apparel & Toys */
export function KidsAgeSelector({
  selectedAge,
  onSelectAge,
}: {
  selectedAge: string;
  onSelectAge: (age: string) => void;
}) {
  const ages = [
    { id: "0-6m", label: "০ – ৬ মাস", desc: "নবজাতক নিউবর্ন" },
    { id: "6-12m", label: "৬ – ১২ মাস", desc: "ইনফ্যান্ট ও হামাগুড়ি" },
    { id: "1-2y", label: "১ – ২ বছর", desc: "টডলার ও প্রথম হাঁটা" },
    { id: "3-5y", label: "৩ – ৫ বছর", desc: "প্রিস্কুল ও প্লে-টাইম" },
    { id: "6-8y", label: "৬ – ৮ বছর", desc: "স্কুল কিডস" },
    { id: "9-12y", label: "৯ – ১২ বছর", desc: "প্রাক-কৈশোর" },
  ];

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between">
        <label className="text-xs font-bold text-slate-800">
          শিশুর বয়স অনুযায়ী সাইজ: <span className="text-sky-600 font-extrabold">{selectedAge}</span>
        </label>
      </div>
      <div className="grid grid-cols-3 sm:grid-cols-6 gap-2">
        {ages.map((a) => {
          const active = selectedAge.includes(a.label);
          return (
            <button
              key={a.id}
              type="button"
              onClick={() => onSelectAge(a.label)}
              className={`flex flex-col items-center justify-center rounded-2xl p-2.5 text-center transition border ${
                active
                  ? "border-sky-500 bg-sky-50 shadow-xs ring-2 ring-sky-400"
                  : "border-slate-200 bg-white hover:border-sky-300"
              }`}
            >
              <span className="text-xs font-black text-slate-900">{a.label}</span>
              <span className="mt-0.5 text-[9px] text-slate-500">{a.desc}</span>
            </button>
          );
        })}
      </div>
    </div>
  );
}

/** Baby Safety & Material Specification Table */
export function KidsSafetySpecs() {
  const specs = [
    { label: "ম্যাটেরিয়াল গ্রেড", value: "১০০% প্রিমিয়াম কম্বড অর্গানিক কটন / ফুড-গ্রেড সিলিকন" },
    { label: "সেফটি সার্টিফিকেট", value: "EN71 & ASTM F963 আন্তর্জাতিক ল্যাব টেস্ট সার্টিফাইড" },
    { label: "কেমিক্যাল প্রোটেকশন", value: "১০০% BPA-Free, Lead-Free & Phthalate-Free" },
    { label: "ত্বকের সহনশীলতা", value: "ডার্মাটোলজিক্যালি পরীক্ষিত হাইপোঅ্যালার্জেনিক (র‍্যাশ-মুক্ত)" },
    { label: "ওয়াশ ও ড্রাই কেয়ার", value: "নরম হ্যান্ড/মেশিন ওয়াশ উপযোগী, নন-ফেডিং ইকো ডাই" },
    { label: "চোকিং রিস্ক প্রোটেকশন", value: "কোনো সূঁচালো কোণা বা আলগা ছোট পার্টস নেই (Zero Choking Hazard)" },
  ];

  return (
    <div className="rounded-3xl border border-sky-100 bg-[#f7fbff] p-4 text-xs">
      <h4 className="font-bold text-slate-900 text-sm mb-3 flex items-center gap-1.5">
        <span>🛡️</span> শিশুর স্বাস্থ্য ও সুরক্ষা স্পেসিফিকেশন
      </h4>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
        {specs.map((s, idx) => (
          <div key={idx} className="rounded-2xl border border-sky-100/80 bg-white p-3">
            <span className="block text-[10px] font-semibold text-slate-400">{s.label}</span>
            <span className="mt-0.5 block font-bold text-slate-800">{s.value}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

/** Official Baby Safety & Purity Guarantee Modal */
export function KidsSafetyModal({
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
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4 backdrop-blur-xs">
      <div className="flex max-h-[90vh] w-full max-w-lg flex-col rounded-3xl border border-sky-200 bg-white shadow-2xl overflow-hidden animate-in fade-in zoom-in-95">
        {/* Header */}
        <div className="flex items-center justify-between border-b border-sky-100 bg-gradient-to-r from-sky-50 via-teal-50 to-pink-50 px-6 py-4">
          <div className="flex items-center gap-2.5">
            <span className="flex h-10 w-10 items-center justify-center rounded-2xl bg-sky-500 text-xl text-white shadow-xs">
              🛡️
            </span>
            <div>
              <h3 className="text-base font-black text-slate-900">শিশুর শতভাগ সুরক্ষা গ্যারান্টি</h3>
              <p className="text-xs text-slate-500">আন্তর্জাতিক পেডিয়াট্রিক ও ল্যাব স্ট্যান্ডার্ড সনদ</p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="flex h-8 w-8 items-center justify-center rounded-full text-slate-400 hover:bg-slate-100 hover:text-slate-700"
          >
            ✕
          </button>
        </div>

        {/* Content */}
        <div className="flex-1 overflow-y-auto p-6 space-y-4 text-xs leading-relaxed text-slate-600">
          <div className="rounded-2xl border border-sky-100 bg-sky-50/60 p-4">
            <span className="text-[10px] font-bold uppercase tracking-wider text-sky-800">সার্টিফাইড প্রোডাক্ট</span>
            <h4 className="mt-0.5 text-sm font-extrabold text-slate-900">{productName}</h4>
          </div>

          <div className="space-y-3">
            <div className="flex items-start gap-3 rounded-2xl border border-slate-100 p-3">
              <span className="text-xl">🧪</span>
              <div>
                <h5 className="font-bold text-slate-900">১০০% BPA-Free ও নন-টক্সিক ফুড গ্রেড</h5>
                <p className="mt-0.5 text-slate-500">
                  শিশুর মুখে যাওয়ার ঝুঁকিপূর্ণ কোনো বিষাক্ত প্লাস্টিকাইজার, বিসফেনল কিংবা ভারী ধাতু (Lead/Mercury) নেই।
                </p>
              </div>
            </div>

            <div className="flex items-start gap-3 rounded-2xl border border-slate-100 p-3">
              <span className="text-xl">🌿</span>
              <div>
                <h5 className="font-bold text-slate-900">হাইপোঅ্যালার্জেনিক ও র‍্যাশ-ফ্রি প্রটেকশন</h5>
                <p className="mt-0.5 text-slate-500">
                  শিশুর নরম ও সংবেদনশীল ত্বকে ঘামাচি, লালচে দাগ বা অ্যালার্জির ঝুঁকি রোধে সম্পূর্ণ প্রাকৃতিক অরগানিক ফিনিশ।
                </p>
              </div>
            </div>

            <div className="flex items-start gap-3 rounded-2xl border border-slate-100 p-3">
              <span className="text-xl">🔍</span>
              <div>
                <h5 className="font-bold text-slate-900">শার্প-এজ ও ড্রপ-টেস্ট সুরক্ষা</h5>
                <p className="mt-0.5 text-slate-500">
                  প্রতিটি খেলনা ও আনুষঙ্গিক ড্রপ টেস্ট ও স্মুথ এজিং প্রক্রিয়ার মাধ্যমে তৈরি যাতে শিশুর আঘাত পাওয়ার ভয় না থাকে।
                </p>
              </div>
            </div>
          </div>

          <div className="rounded-2xl border border-emerald-200 bg-emerald-50/70 p-3 text-emerald-900">
            <p className="font-bold">✓ কোয়ালিটি ড্যামেজ রিপ্লেসমেন্ট প্রতিশ্রুতি</p>
            <p className="mt-0.5 text-[11px] text-emerald-800">
              ডেলিভারির সময় কোনো ভাঙা বা ডিফেক্টিভ পার্টস থাকলে আমরা ২৪ ঘণ্টার ভেতর সম্পূর্ণ বিনামূল্যে নতুন পণ্য রিপ্লেস করে থাকি।
            </p>
          </div>
        </div>

        {/* Footer */}
        <div className="border-t border-slate-100 bg-slate-50 p-4 text-center">
          <button
            type="button"
            onClick={onClose}
            className="w-full rounded-2xl bg-sky-600 py-2.5 text-xs font-bold text-white shadow-md hover:bg-sky-500 transition"
          >
            ঠিক আছে, বুঝতে পেরেছি
          </button>
        </div>
      </div>
    </div>
  );
}

/** Complete Newborn / Toddler Gift Hamper Bundle */
export function KidsGiftHamperBundle({
  orgSlug,
  mainProduct,
}: {
  orgSlug: string;
  mainProduct: ShopProduct;
}) {
  const [busy, setBusy] = useState(false);
  const [added, setAdded] = useState(false);

  const mainPrice = Number(mainProduct.priceMinor);
  const companion1Price = 45000; // ৳৪৫০ বেবি ওয়্যার
  const companion2Price = 38000; // ৳৩৮০ খেলনা / টিথার
  const subtotal = mainPrice + companion1Price + companion2Price;
  const discountMinor = 45000; // ৳৪৫০ ইনস্ট্যান্ট সাশ্রয়
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
    <div className="rounded-3xl border border-sky-200 bg-gradient-to-br from-[#f8fcff] via-sky-50/40 to-[#fff8fa] p-5 sm:p-6 shadow-sm">
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-sky-100 pb-4">
        <div>
          <span className="rounded-full bg-sky-500 px-3 py-0.5 text-[11px] font-black text-white">
            🎁 স্পেশাল বেবি গিফট বক্স হ্যাম্পার
          </span>
          <h3 className="mt-1 text-base sm:text-lg font-black text-slate-900">
            ফুল কেয়ার গিফট সেট অর্ডারে ইনস্ট্যান্ট ৳৪৫০ সাশ্রয় + ফ্রি প্রিমিয়াম গিফট বক্স ও কার্ড!
          </h3>
        </div>
        <div className="text-right">
          <span className="text-xs text-slate-400 line-through">{formatKidsPrice(subtotal)}</span>
          <p className="text-xl font-black text-sky-600">{formatKidsPrice(comboPrice)}</p>
        </div>
      </div>

      <div className="my-4 grid grid-cols-1 sm:grid-cols-3 gap-3">
        <div className="flex items-center gap-3 rounded-2xl border border-sky-100 bg-white p-3">
          <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl bg-sky-100 text-2xl">
            🧸
          </div>
          <div className="min-w-0">
            <span className="text-[10px] font-bold text-sky-600">মূল আইটেম</span>
            <h5 className="truncate text-xs font-bold text-slate-900">{mainProduct.name}</h5>
            <span className="text-xs font-extrabold text-slate-900">{formatKidsPrice(mainPrice)}</span>
          </div>
        </div>

        <div className="flex items-center gap-3 rounded-2xl border border-sky-100 bg-white p-3">
          <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl bg-amber-100 text-2xl">
            👶
          </div>
          <div className="min-w-0">
            <span className="text-[10px] font-bold text-amber-600">১০০% সুতি রম্পার সুট</span>
            <h5 className="truncate text-xs font-bold text-slate-900">সফট অর্গানিক বেবি রম্পার</h5>
            <span className="text-xs font-extrabold text-slate-900">৳৪৫০</span>
          </div>
        </div>

        <div className="flex items-center gap-3 rounded-2xl border border-sky-100 bg-white p-3">
          <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl bg-teal-100 text-2xl">
            🔔
          </div>
          <div className="min-w-0">
            <span className="text-[10px] font-bold text-teal-600">ফুড গ্রেড টিথার খেলনা</span>
            <h5 className="truncate text-xs font-bold text-slate-900">সিলিকন সেন্সরি র‍্যাটল টিথার</h5>
            <span className="text-xs font-extrabold text-slate-900">৳৩৮০</span>
          </div>
        </div>
      </div>

      <div className="flex flex-wrap items-center justify-between gap-3 pt-2">
        <span className="text-xs text-slate-600 font-medium">
          🎀 যেকোনো আত্মীয় বা নতুন অভিভাবককে উপহার দেওয়ার জন্য সম্পূর্ণ রেডি টু গিফট প্যাকেজিং!
        </span>
        <button
          type="button"
          onClick={handleAddCombo}
          disabled={busy}
          className="rounded-2xl bg-sky-500 px-5 py-2.5 text-xs font-extrabold text-white shadow-md hover:bg-sky-600 transition disabled:opacity-50"
        >
          {added ? "✓ গিফট কম্বো কার্টে যোগ হয়েছে!" : "এক ক্লিকে ফুল গিফট সেট কিনুন (৳৪৫০ ছাড়)"}
        </button>
      </div>
    </div>
  );
}

/** Playful Kids & Baby Product Card */
export function KidsProductCard({
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

  return (
    <div className="group relative flex flex-col overflow-hidden rounded-3xl border border-sky-100 bg-white shadow-xs transition-all duration-300 hover:-translate-y-1 hover:border-sky-300 hover:shadow-xl">
      {/* Product Image */}
      <Link href={`/shop/${orgSlug}/products/${product.slug}`} className="relative block aspect-square overflow-hidden bg-sky-50/40">
        {product.imageUrl ? (
          <MediaImage
            src={product.imageUrl}
            alt={product.name}
            className="h-full w-full object-cover transition-transform duration-500 group-hover:scale-105"
          />
        ) : (
          <div className="flex h-full w-full flex-col items-center justify-center p-4 text-center text-sky-400">
            <span className="text-4xl">🧸</span>
            <span className="mt-2 text-xs font-bold text-slate-500 line-clamp-2">{product.name}</span>
          </div>
        )}

        {/* Badges */}
        <div className="absolute left-3 top-3 flex flex-col gap-1">
          {discountPct ? (
            <span className="rounded-xl bg-rose-500 px-2.5 py-0.5 text-[10px] font-black text-white shadow-xs">
              {discountPct}% ছাড়
            </span>
          ) : null}
          <span className="rounded-xl bg-sky-500 px-2 py-0.5 text-[9px] font-extrabold text-white shadow-xs">
            ০-১২ মাস
          </span>
        </div>

        <div className="absolute right-3 top-3">
          <span className="rounded-xl bg-teal-500/90 px-2 py-0.5 text-[9px] font-bold text-white shadow-xs backdrop-blur-xs">
            ✓ BPA Free
          </span>
        </div>
      </Link>

      {/* Product Details */}
      <div className="flex flex-1 flex-col justify-between p-4">
        <div>
          <div className="mb-1 flex items-center justify-between text-[11px] text-slate-400">
            <span>{product.brand?.name ?? "Babyshop BD"}</span>
            <span className="flex items-center text-amber-500 font-bold">
              ★ ৪.৯
            </span>
          </div>

          <Link href={`/shop/${orgSlug}/products/${product.slug}`} className="group-hover:text-sky-600 transition">
            <h4 className="text-sm font-bold text-slate-900 line-clamp-2 leading-snug">
              {product.name}
            </h4>
          </Link>
        </div>

        <div className="mt-3">
          <div className="flex items-baseline gap-2">
            <span className="text-base font-black text-slate-900">
              {formatKidsPrice(priceMinor)}
            </span>
            {compareMinor && compareMinor > priceMinor ? (
              <span className="text-xs text-slate-400 line-through">
                {formatKidsPrice(compareMinor)}
              </span>
            ) : null}
          </div>

          <div className="mt-3 pt-2.5 border-t border-slate-100">
            <button
              type="button"
              onClick={handleQuickAdd}
              disabled={busy}
              className={`w-full rounded-2xl py-2 text-xs font-bold transition flex items-center justify-center gap-1.5 ${
                added
                  ? "bg-emerald-600 text-white"
                  : "bg-sky-50 text-sky-700 hover:bg-sky-500 hover:text-white"
              }`}
            >
              <span>{added ? "✓ কার্টে যোগ হয়েছে!" : "🛒 কার্টে যোগ করুন"}</span>
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

/** Complete Kids & Baby Theme Homepage */
export function KidsThemeHome({
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

  const ageStages = [
    { title: "নবজাতক", age: "০ – ৬ মাস", icon: "🍼", desc: "ফিডার, র‍্যাপার ও ডায়াপার" },
    { title: "ইনফ্যান্ট", age: "৬ – ১২ মাস", icon: "👶", desc: "বেবি ফুড, টিথার ও হামাগুড়ি" },
    { title: "টডলার", age: "১ – ৩ বছর", icon: "🧸", desc: "লার্নিং টয় ও ওয়াকার" },
    { title: "প্রিস্কুলার", age: "৩ – ৫ বছর", icon: "🎨", desc: "ড্রয়িং, পাজল ও রাইড-অন" },
    { title: "কিডস ফ্যাশন", age: "৫ – ১০ বছর", icon: "👗", desc: "স্টাইলিশ পোশাক ও জুতো" },
  ];

  const toySkills = [
    { name: "STEM ও ব্রেন ডেভেলপমেন্ট", icon: "🧩", count: "১২০+ আইটেম" },
    { name: "মিউজিক্যাল ও সেন্সরি খেলনা", icon: "🎵", count: "৮৫+ আইটেম" },
    { name: "আর্ট, ড্রয়িং ও ক্রাফট", icon: "🎨", count: "৯০+ আইটেম" },
    { name: "আউটডোর ও রাইড-অন কার", icon: "🚗", count: "৪৫+ আইটেম" },
  ];

  return (
    <div className="mx-auto max-w-6xl space-y-10 px-4 py-8 sm:px-6">
      {/* Cheerful Playful Hero Banner */}
      <section className="relative overflow-hidden rounded-3xl bg-gradient-to-r from-sky-400 via-teal-300 to-amber-200 p-8 sm:p-12 text-slate-900 shadow-xl border border-sky-200">
        <div className="relative z-10 max-w-2xl space-y-4">
          <div className="inline-flex items-center gap-2 rounded-full border border-white/60 bg-white/70 px-4 py-1 text-xs font-black text-sky-800 backdrop-blur-xs">
            <span>🎈 বেবি ফেস্টিভ্যাল ২০২৬ — সব বেবি কেয়ার ও খেলনায় ৩৫% পর্যন্ত ছাড়</span>
          </div>
          <h1 className="text-3xl font-black sm:text-5xl tracking-tight leading-tight text-slate-950">
            শিশুর হাসিমুখ আর সুরক্ষায় কোনো আপস নয়
          </h1>
          <p className="text-sm sm:text-base text-slate-800 font-medium leading-relaxed">
            ১০০% নন-টক্সিক ও ফুড গ্রেড উপাদান দিয়ে তৈরি বেবি কেয়ার, অর্গানিক সুতি জামাকাপড় ও ব্রেন ডেভেলপমেন্ট খেলনার এক বিশ্বস্ত ঠিকানা।
          </p>
          <div className="flex flex-wrap items-center gap-3 pt-2">
            <a
              href="#all-kids"
              className="rounded-2xl bg-slate-950 px-6 py-3 text-xs font-black text-white shadow-lg hover:bg-slate-800 transition"
            >
              কালেকশন দেখুন 🛒
            </a>
            <span className="text-xs font-bold text-slate-900">
              ✓ ফ্রি গিফট র‍্যাপিং ও ক্যাশ অন ডেলিভারি
            </span>
          </div>
        </div>

        {/* Decorative background emoji */}
        <div className="absolute -right-6 -bottom-8 select-none text-[150px] opacity-25">
          🧸
        </div>
      </section>

      {/* 4 Trust Pillars */}
      <KidsTrustBar />

      {/* Age Stage Categories */}
      <section className="space-y-4">
        <div className="flex items-center justify-between">
          <div>
            <span className="text-xs font-bold text-sky-600 uppercase tracking-wider">বয়স ভিত্তিক ব্রাউজ</span>
            <h2 className="text-xl sm:text-2xl font-black text-slate-900">শিশুর সঠিক বয়সের পণ্য বেছে নিন</h2>
          </div>
          <span className="text-xs font-bold text-sky-600">সব বয়স →</span>
        </div>
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-5">
          {ageStages.map((st, idx) => (
            <div
              key={idx}
              className="group flex flex-col items-center rounded-3xl border border-sky-100 bg-white p-4 text-center shadow-xs transition hover:-translate-y-1 hover:border-sky-300 hover:shadow-md cursor-pointer"
            >
              <div className="flex h-14 w-14 items-center justify-center rounded-2xl bg-sky-100 text-3xl group-hover:scale-110 transition duration-300">
                {st.icon}
              </div>
              <h4 className="mt-3 text-sm font-extrabold text-slate-900 group-hover:text-sky-600">
                {st.title}
              </h4>
              <span className="mt-0.5 rounded-full bg-sky-50 px-2 py-0.5 text-[10px] font-bold text-sky-700">
                {st.age}
              </span>
              <p className="mt-1.5 text-[11px] text-slate-400 line-clamp-1">{st.desc}</p>
            </div>
          ))}
        </div>
      </section>

      {/* Toy Skill Development Categories */}
      <section className="space-y-4">
        <h2 className="text-xl sm:text-2xl font-black text-slate-900">
          মেধা ও মানসিক বিকাশ সহায়ক খেলনা
        </h2>
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          {toySkills.map((sk, idx) => (
            <div
              key={idx}
              className="flex items-center gap-3 rounded-3xl border border-sky-100 bg-[#f7fbff] p-4 shadow-xs transition hover:bg-sky-50 cursor-pointer"
            >
              <span className="text-3xl">{sk.icon}</span>
              <div className="min-w-0">
                <h4 className="text-xs font-bold text-slate-900 truncate">{sk.name}</h4>
                <p className="text-[10px] text-slate-500">{sk.count}</p>
              </div>
            </div>
          ))}
        </div>
      </section>

      {/* Flash Sale / Mega Deals */}
      {home.flashSales && home.flashSales.sales && home.flashSales.sales.length > 0 ? (
        <section className="rounded-3xl border border-sky-200 bg-gradient-to-r from-sky-500 via-teal-400 to-sky-600 p-6 text-white shadow-xl">
          <div className="flex flex-wrap items-center justify-between gap-3 border-b border-white/20 pb-4">
            <div>
              <span className="rounded-full bg-amber-400 px-3 py-0.5 text-xs font-black uppercase text-slate-950">
                ⚡ লিমিটেড বেবি ফ্ল্যাশ ডিল
              </span>
              <h2 className="mt-1 text-xl sm:text-2xl font-black text-white">
                আজকের সুপার কিডস অফার
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
              <KidsProductCard key={p.id} orgSlug={orgSlug} product={p} locale={locale} />
            ))}
          </div>
        </section>
      ) : null}

      {/* Main Kids Catalog */}
      <section id="all-kids" className="space-y-6">
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-200 pb-4">
          <div>
            <h2 className="text-2xl font-black text-slate-900">
              সকল বেবি ও কিডস আইটেম
            </h2>
            <p className="text-xs text-slate-500">
              মোট {home.pagination?.total ?? products.length} টি পণ্য পাওয়া যাচ্ছে
            </p>
          </div>
          <SortSelect orgSlug={orgSlug} locale={locale} value="featured" />
        </div>

        {products.length === 0 ? (
          <div className="rounded-3xl border border-dashed border-sky-200 bg-white p-12 text-center">
            <span className="text-4xl">🧸</span>
            <p className="mt-3 text-sm font-bold text-slate-700">বর্তমানে কোনো পণ্য পাওয়া যায়নি</p>
          </div>
        ) : (
          <div className="grid grid-cols-2 gap-3 sm:gap-5 md:grid-cols-3 lg:grid-cols-4">
            {products.map((p) => (
              <KidsProductCard key={p.id} orgSlug={orgSlug} product={p} locale={locale} />
            ))}
          </div>
        )}
      </section>

      <RecentlyViewedStrip orgSlug={orgSlug} locale={locale} />
    </div>
  );
}
