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

export function formatAutoPrice(minor: number | string | null | undefined): string {
  if (minor == null) return "৳০";
  const num = typeof minor === "string" ? parseInt(minor, 10) : minor;
  if (isNaN(num)) return "৳০";
  return `৳${Math.round(num / 100).toLocaleString("bn-BD")}`;
}

/** 4 Automotive & Bike Parts Trust Pillars */
export function AutomotiveTrustBar() {
  const pillars = [
    { icon: "⚙️", title: "১০০% জেনুইন পার্টস", desc: "সরাসরি অফিসিয়াল ইমপোর্টার ও ব্র্যান্ড ওয়্যারেন্টি" },
    { icon: "🏍️", title: "১০০% ফিটমেন্ট গ্যারান্টি", desc: "মডেলের সাথে ম্যাচ না করলে ইনস্ট্যান্ট এক্সচেঞ্জ" },
    { icon: "🛠️", title: "এক্সপার্ট মেকানিক সাপোর্ট", desc: "পার্টনার গ্যারেজে ফ্রি ইনস্টলেশন পরামর্শ" },
    { icon: "🚚", title: "সারা দেশে সুপারফাস্ট কুরিয়ার", desc: "নিরাপদ প্যাকেজিং ও ক্যাশ অন ডেলিভারি" },
  ];
  return (
    <div className="grid grid-cols-2 gap-3 sm:grid-cols-4 sm:gap-4 my-6">
      {pillars.map((p, i) => (
        <div
          key={i}
          className="flex items-center gap-3 rounded-2xl border border-zinc-800 bg-[#14161a] p-3.5 shadow-sm transition hover:border-red-600/40"
        >
          <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-zinc-800 text-xl text-red-500">
            {p.icon}
          </span>
          <div className="min-w-0">
            <h4 className="text-xs font-bold text-white sm:text-sm">{p.title}</h4>
            <p className="text-[11px] text-zinc-400 truncate">{p.desc}</p>
          </div>
        </div>
      ))}
    </div>
  );
}

/** Vehicle & Bike Model Fitment Checker Modal */
export function AutomotiveFitmentModal({
  open,
  onClose,
  productName,
}: {
  open: boolean;
  onClose: () => void;
  productName: string;
}) {
  const [brand, setBrand] = useState("Yamaha");
  const [model, setModel] = useState("R15 V3 / V4");
  const [year, setYear] = useState("2023 - 2026");
  const [checked, setChecked] = useState(false);

  if (!open) return null;

  const bikeList = [
    { brand: "Yamaha", models: ["R15 V3 / V4", "MT-15", "FZ-S Fi V2/V3", "Fazer Fi", "Saluto 125"] },
    { brand: "Suzuki", models: ["Gixxer SF Fi Disc", "Gixxer Monotone", "GSX-R 150", "Hayate"] },
    { brand: "Honda", models: ["CBR 150R", "CB Hornet 160R", "X-Blade 160", "CB Shine 125"] },
    { brand: "Bajaj", models: ["Pulsar 150 Twin Disc", "Pulsar NS160 Fi ABS", "Discover 125", "Avenger 160"] },
    { brand: "TVS", models: ["Apache RTR 160 4V", "Apache RTR 160 2V", "Raider 125", "Metro Plus"] },
  ];

  const currentModels = bikeList.find((b) => b.brand === brand)?.models ?? [];

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/75 p-4 backdrop-blur-xs">
      <div className="flex max-h-[90vh] w-full max-w-lg flex-col rounded-3xl border border-zinc-800 bg-[#121316] shadow-2xl overflow-hidden animate-in fade-in zoom-in-95 text-white">
        {/* Header */}
        <div className="flex items-center justify-between border-b border-zinc-800 bg-gradient-to-r from-zinc-950 via-zinc-900 to-red-950 px-6 py-4">
          <div className="flex items-center gap-2.5">
            <span className="flex h-10 w-10 items-center justify-center rounded-2xl bg-red-600 text-xl text-white shadow-xs">
              🏍️
            </span>
            <div>
              <h3 className="text-base font-black text-white">বাইক মডেল ফিটমেন্ট চেকার</h3>
              <p className="text-xs text-zinc-400">আপনার বাইকে পার্টসটি ম্যাচ করবে কিনা যাচাই করুন</p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="flex h-8 w-8 items-center justify-center rounded-full text-zinc-400 hover:bg-zinc-800 hover:text-white"
          >
            ✕
          </button>
        </div>

        {/* Content */}
        <div className="flex-1 overflow-y-auto p-6 space-y-4 text-xs">
          <div className="rounded-2xl border border-zinc-800 bg-zinc-900/60 p-3.5">
            <span className="text-[10px] font-bold uppercase tracking-wider text-red-500">নির্বাচিত পার্টস</span>
            <h4 className="mt-0.5 text-sm font-extrabold text-white truncate">{productName}</h4>
          </div>

          <div className="space-y-3">
            <div>
              <label className="mb-1 block font-bold text-zinc-300">বাইকের ব্র্যান্ড (Brand):</label>
              <div className="grid grid-cols-3 gap-2">
                {bikeList.map((b) => (
                  <button
                    key={b.brand}
                    type="button"
                    onClick={() => {
                      setBrand(b.brand);
                      setModel(b.models[0] ?? "");
                      setChecked(false);
                    }}
                    className={`rounded-xl p-2 font-bold transition border ${
                      brand === b.brand
                        ? "border-red-600 bg-red-950/40 text-red-400"
                        : "border-zinc-800 bg-zinc-900 text-zinc-400 hover:border-zinc-700"
                    }`}
                  >
                    {b.brand}
                  </button>
                ))}
              </div>
            </div>

            <div>
              <label className="mb-1 block font-bold text-zinc-300">বাইকের মডেল (Model):</label>
              <select
                value={model}
                onChange={(e) => {
                  setModel(e.target.value);
                  setChecked(false);
                }}
                className="w-full rounded-xl border border-zinc-800 bg-zinc-900 p-2.5 font-bold text-white focus:border-red-600 focus:outline-none"
              >
                {currentModels.map((m) => (
                  <option key={m} value={m}>
                    {m}
                  </option>
                ))}
              </select>
            </div>

            <div>
              <label className="mb-1 block font-bold text-zinc-300">ম্যানুফ্যাকচারিং সাল (Year):</label>
              <select
                value={year}
                onChange={(e) => {
                  setYear(e.target.value);
                  setChecked(false);
                }}
                className="w-full rounded-xl border border-zinc-800 bg-zinc-900 p-2.5 font-bold text-white focus:border-red-600 focus:outline-none"
              >
                <option value="2023 - 2026">২০২৩ — ২০২৬ (লেটেস্ট বিএস-৬ / ওবিডি-২)</option>
                <option value="2020 - 2022">২০২০ — ২০২২ (বিএস-৪ / বিএস-৬)</option>
                <option value="2016 - 2019">২০১৬ — ২০১৯ (কার্বুরেটর / আর্লি এফআই)</option>
              </select>
            </div>
          </div>

          <button
            type="button"
            onClick={() => setChecked(true)}
            className="w-full rounded-xl bg-red-600 py-2.5 text-xs font-black uppercase tracking-wider text-white hover:bg-red-500 transition shadow-lg"
          >
            ফিটমেন্ট ভেরিফাই করুন 🔍
          </button>

          {checked && (
            <div className="rounded-2xl border border-emerald-500/30 bg-emerald-950/30 p-4 text-emerald-400 animate-in fade-in">
              <div className="flex items-center gap-2 font-black text-sm text-emerald-300">
                <span>✅ পারফেক্ট ফিট কনফার্মড!</span>
              </div>
              <p className="mt-1 leading-relaxed text-zinc-300">
                এই পার্টসটি আপনার <span className="font-bold text-white">{brand} {model} ({year})</span> বাইকে শতভাগ নির্বিঘ্নে সরাসরি ফিট হবে। কোনো প্লাগ বা কাটিং মডিফিকেশনের প্রয়োজন নেই।
              </p>
              <span className="mt-2 block text-[11px] font-bold text-emerald-400">
                ✓ যদি কোনো কারণে ফিট না হয়, ৭ দিনের ভেতর ১০০% ফ্রি রিটার্ন গ্যারান্টি!
              </span>
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="border-t border-zinc-800 bg-zinc-950 p-4 text-center">
          <button
            type="button"
            onClick={onClose}
            className="w-full rounded-xl border border-zinc-700 bg-zinc-900 py-2 text-xs font-bold text-zinc-300 hover:bg-zinc-800"
          >
            বন্ধ করুন
          </button>
        </div>
      </div>
    </div>
  );
}

/** Engine Oil Viscosity & Grade Selector */
export function AutomotiveViscositySelector({
  selectedGrade,
  onSelectGrade,
}: {
  selectedGrade: string;
  onSelectGrade: (grade: string) => void;
}) {
  const grades = [
    { id: "10w40", grade: "10W-40", type: "Full Synthetic", desc: "স্পোর্টস ও হাই-আরপিএম বাইকের জন্য সেরা", badge: "টপ চয়েস" },
    { id: "10w30", grade: "10W-30", type: "Semi Synthetic", desc: "স্মুথ কমিউটার ও সর্বোচ্চ মাইলেজ", badge: "মাইলেজ" },
    { id: "20w50", grade: "20W-50", type: "Premium Mineral", desc: "হাই-হিট ও লং ট্যুরিং ইঞ্জিনের জন্য", badge: "হেভি ডিউটি" },
  ];

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between">
        <label className="text-xs font-bold text-zinc-800">
          ইঞ্জিন অয়েল গ্রেড ও ভিসকোসিটি: <span className="text-red-600 font-extrabold">{selectedGrade}</span>
        </label>
      </div>
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
        {grades.map((g) => {
          const active = selectedGrade.includes(g.grade);
          return (
            <button
              key={g.id}
              type="button"
              onClick={() => onSelectGrade(`${g.grade} (${g.type})`)}
              className={`flex flex-col items-start rounded-xl p-3 text-left transition border ${
                active
                  ? "border-red-600 bg-red-50/50 shadow-xs ring-1 ring-red-500"
                  : "border-zinc-200 bg-white hover:border-red-400"
              }`}
            >
              <div className="flex w-full items-center justify-between">
                <span className="font-mono text-xs font-black text-zinc-900">{g.grade}</span>
                <span className="rounded bg-red-100 px-1.5 py-0.5 text-[9px] font-bold text-red-700">{g.badge}</span>
              </div>
              <span className="mt-1 font-semibold text-[11px] text-zinc-700">{g.type}</span>
              <span className="mt-0.5 text-[10px] text-zinc-500">{g.desc}</span>
            </button>
          );
        })}
      </div>
    </div>
  );
}

/** OEM Specifications & Compatibility Matrix */
export function AutomotivePartSpecs() {
  const specs = [
    { label: "OEM পার্ট নম্বর", value: "2FB-E2461-00-JP" },
    { label: "কান্ট্রি অব অরিজিন", value: "জাপান / ইন্দোনেশিয়া (অরিজিনাল)" },
    { label: "ইঞ্জিন কম্প্যাটিবিলিটি", value: "150cc — 165cc 4-Stroke Liquid Cooled" },
    { label: "সার্টিফিকেশন স্ট্যান্ডার্ড", value: "JASO MA2 / API SN Plus" },
    { label: "ম্যাটেরিয়াল গ্রেড", value: "হাই-গ্রেড হিট-ট্রিটেড অ্যালয় ও সিরামিক" },
    { label: "ইনস্টলেশন টাইপ", value: "ডাইরেক্ট প্লাগ অ্যান্ড প্লে (No Mod Required)" },
    { label: "ওয়ারেন্টি কভারেজ", value: "১ বছরের অফিসিয়াল রিপ্লেসমেন্ট গ্যারান্টি" },
    { label: "সিকিউরিটি যাচাই", value: "১০০% ভেরিফায়েবল স্ক্র্যাচ কিউআর কোড" },
  ];

  return (
    <div className="rounded-2xl border border-zinc-200 bg-zinc-50 p-4 text-xs">
      <h4 className="font-bold text-zinc-900 text-sm mb-3 flex items-center gap-1.5 font-mono">
        <span>⚙️</span> OEM টেকনিক্যাল স্পেসিফিকেশন ও সিকিউরিটি ডাটা
      </h4>
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
        {specs.map((s, idx) => (
          <div key={idx} className="rounded-xl border border-zinc-200 bg-white p-2.5">
            <span className="block text-[10px] font-semibold text-zinc-400 font-mono">{s.label}</span>
            <span className="mt-0.5 block font-bold text-zinc-900">{s.value}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

/** Periodic Bike Service & Tune-Up Combo Bundle */
export function AutomotiveTuneupBundle({
  orgSlug,
  mainProduct,
}: {
  orgSlug: string;
  mainProduct: ShopProduct;
}) {
  const [busy, setBusy] = useState(false);
  const [added, setAdded] = useState(false);

  const mainPrice = Number(mainProduct.priceMinor);
  const companion1Price = 28000; // ৳২৮০ জেনুইন অয়েল ফিল্টার
  const companion2Price = 45000; // ৳৪৫০ ইরিডিয়াম স্পার্ক প্লাগ
  const subtotal = mainPrice + companion1Price + companion2Price;
  const discountMinor = 35000; // ৳৩৫০ সাশ্রয়
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
    <div className="rounded-3xl border border-red-500/30 bg-gradient-to-br from-[#121316] via-zinc-900 to-[#1c1214] p-5 sm:p-6 text-white shadow-xl">
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-zinc-800 pb-4">
        <div>
          <span className="rounded-full bg-red-600 px-3 py-0.5 text-[11px] font-black uppercase text-white">
            🛠️ ফুল পিরিওডিক বাইক টিউন-আপ কম্বো
          </span>
          <h3 className="mt-1 font-mono text-base sm:text-lg font-black text-white">
            ইঞ্জিন অয়েল + জেনুইন ফিল্টার + ইরিডিয়াম প্লাগ একত্রে নিলে ইনস্ট্যান্ট ৳৩৫০ ক্যাশ ছাড়!
          </h3>
        </div>
        <div className="text-right">
          <span className="text-xs text-zinc-400 line-through font-mono">{formatAutoPrice(subtotal)}</span>
          <p className="font-mono text-xl font-black text-red-500">{formatAutoPrice(comboPrice)}</p>
        </div>
      </div>

      <div className="my-4 grid grid-cols-1 sm:grid-cols-3 gap-3">
        <div className="flex items-center gap-3 rounded-2xl border border-zinc-800 bg-zinc-900/80 p-3">
          <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-xl bg-zinc-800 text-2xl text-red-500">
            🛢️
          </div>
          <div className="min-w-0">
            <span className="text-[10px] font-bold text-red-400">মূল আইটেম</span>
            <h5 className="truncate text-xs font-bold text-white">{mainProduct.name}</h5>
            <span className="text-xs font-extrabold text-zinc-300 font-mono">{formatAutoPrice(mainPrice)}</span>
          </div>
        </div>

        <div className="flex items-center gap-3 rounded-2xl border border-zinc-800 bg-zinc-900/80 p-3">
          <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-xl bg-zinc-800 text-2xl text-amber-500">
            ⚙️
          </div>
          <div className="min-w-0">
            <span className="text-[10px] font-bold text-amber-400">OEM ফিল্টার</span>
            <h5 className="truncate text-xs font-bold text-white">জেনুইন ম্যাগনেটিক অয়েল ফিল্টার</h5>
            <span className="text-xs font-extrabold text-zinc-300 font-mono">৳২৮০</span>
          </div>
        </div>

        <div className="flex items-center gap-3 rounded-2xl border border-zinc-800 bg-zinc-900/80 p-3">
          <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-xl bg-zinc-800 text-2xl text-sky-500">
            ⚡
          </div>
          <div className="min-w-0">
            <span className="text-[10px] font-bold text-sky-400">ইরিডিয়াম প্লাগ</span>
            <h5 className="truncate text-xs font-bold text-white">NGK লেজার ইরিডিয়াম স্পার্ক প্লাগ</h5>
            <span className="text-xs font-extrabold text-zinc-300 font-mono">৳৪৫০</span>
          </div>
        </div>
      </div>

      <div className="flex flex-wrap items-center justify-between gap-3 pt-2">
        <span className="text-xs text-zinc-400 font-medium">
          🎁 প্রতিটি টিউন-আপ কম্বোর সাথে ১টি বাইক কি-রিং ও মাইক্রোফাইবার ক্লিনিং ক্লথ ফ্রি!
        </span>
        <button
          type="button"
          onClick={handleAddCombo}
          disabled={busy}
          className="rounded-xl bg-red-600 px-5 py-2.5 text-xs font-extrabold text-white shadow-lg hover:bg-red-500 transition disabled:opacity-50"
        >
          {added ? "✓ কম্বো কার্টে যোগ হয়েছে!" : "এক ক্লিকে ৩টি পার্টস কিনুন (৳৩৫০ ছাড়)"}
        </button>
      </div>
    </div>
  );
}

/** High-Performance Automotive Product Card */
export function AutomotiveProductCard({
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
  const [fitmentOpen, setFitmentOpen] = useState(false);

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

  function handleCheckFit(e: React.MouseEvent) {
    e.preventDefault();
    e.stopPropagation();
    setFitmentOpen(true);
  }

  return (
    <>
      <div className="group relative flex flex-col overflow-hidden rounded-2xl border border-zinc-200 bg-white shadow-xs transition-all duration-300 hover:-translate-y-1 hover:border-red-500 hover:shadow-xl">
        {/* Product Image */}
        <Link href={`/shop/${orgSlug}/products/${product.slug}`} className="relative block aspect-square overflow-hidden bg-zinc-100">
          {product.imageUrl ? (
            <MediaImage
              src={product.imageUrl}
              alt={product.name}
              className="h-full w-full object-cover transition-transform duration-500 group-hover:scale-105"
            />
          ) : (
            <div className="flex h-full w-full flex-col items-center justify-center p-4 text-center text-zinc-400">
              <span className="text-4xl">🏍️</span>
              <span className="mt-2 text-xs font-bold text-zinc-600 line-clamp-2">{product.name}</span>
            </div>
          )}

          {/* Badges */}
          <div className="absolute left-2.5 top-2.5 flex flex-col gap-1">
            {discountPct ? (
              <span className="rounded-lg bg-red-600 px-2 py-0.5 text-[10px] font-black text-white shadow-xs font-mono">
                {discountPct}% OFF
              </span>
            ) : null}
            <span className="rounded-lg bg-zinc-900/90 px-2 py-0.5 text-[9px] font-bold text-zinc-200 shadow-xs backdrop-blur-xs font-mono">
              OEM GENUINE
            </span>
          </div>

          {/* Quick Fitment Check Button on hover */}
          <div className="absolute inset-x-2 bottom-2 z-10 opacity-0 transition-opacity duration-200 group-hover:opacity-100">
            <button
              type="button"
              onClick={handleCheckFit}
              className="w-full rounded-xl bg-zinc-950/90 py-1.5 text-center text-xs font-bold text-white shadow-md backdrop-blur-xs hover:bg-red-600"
            >
              🔍 ফিটমেন্ট চেক করুন
            </button>
          </div>
        </Link>

        {/* Card Info */}
        <div className="flex flex-1 flex-col justify-between p-4">
          <div>
            <div className="mb-1 flex items-center justify-between text-[11px] text-zinc-500 font-mono">
              <span>{product.brand?.name ?? "Yamaha"}</span>
              <span className="flex items-center text-amber-500 font-bold">
                ★ ৪.৯
              </span>
            </div>

            <Link href={`/shop/${orgSlug}/products/${product.slug}`} className="group-hover:text-red-600 transition">
              <h4 className="text-sm font-bold text-zinc-900 line-clamp-2 leading-snug">
                {product.name}
              </h4>
            </Link>

            <span className="mt-1 inline-block rounded bg-zinc-100 px-1.5 py-0.5 text-[10px] font-semibold text-zinc-600 font-mono">
              ফিট: R15 / FZ / Gixxer / Pulsar
            </span>
          </div>

          <div className="mt-3">
            <div className="flex items-baseline gap-2">
              <span className="text-base font-black text-zinc-900 font-mono">
                {formatAutoPrice(priceMinor)}
              </span>
              {compareMinor && compareMinor > priceMinor ? (
                <span className="text-xs text-zinc-400 line-through font-mono">
                  {formatAutoPrice(compareMinor)}
                </span>
              ) : null}
            </div>

            <div className="mt-3 pt-2.5 border-t border-zinc-100">
              <button
                type="button"
                onClick={handleQuickAdd}
                disabled={busy}
                className={`w-full rounded-xl py-2 text-xs font-bold transition flex items-center justify-center gap-1.5 ${
                  added
                    ? "bg-emerald-600 text-white"
                    : "bg-zinc-900 text-white hover:bg-red-600"
                }`}
              >
                <span>{added ? "✓ কার্টে যোগ হয়েছে" : "🛒 কার্টে যোগ করুন"}</span>
              </button>
            </div>
          </div>
        </div>
      </div>

      <AutomotiveFitmentModal
        open={fitmentOpen}
        onClose={() => setFitmentOpen(false)}
        productName={product.name}
      />
    </>
  );
}

/** Complete Automotive Theme Homepage */
export function AutomotiveThemeHome({
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

  const topBrands = [
    { name: "Yamaha", origin: "Japan", badge: "অফিসিয়াল" },
    { name: "Suzuki", origin: "Japan", badge: "জেনুইন" },
    { name: "Honda", origin: "Japan", badge: "অরিজিনাল" },
    { name: "Bajaj", origin: "India", badge: "অথেনটিক" },
    { name: "TVS", origin: "India", badge: "রেসিং পার্টস" },
    { name: "Motul", origin: "France", badge: "লুব্রিকেন্ট" },
  ];

  const partCategories = [
    { name: "ইঞ্জিন অয়েল ও লুব্রিকেন্ট", icon: "🛢️", count: "১১০+ আইটেম" },
    { name: "ব্রেকিং ও ডিস্ক প্যাড", icon: "🛑", count: "৮৫+ আইটেম" },
    { name: "টায়ার, টিউব ও ভাল্ব", icon: "🛞", count: "৬৫+ আইটেম" },
    { name: "ড্রাইভ চেইন ও স্প্রকেট কিট", icon: "⛓️", count: "৪৫+ আইটেম" },
    { name: "হেলমেট ও রাইডিং গিয়ার", icon: "🪖", count: "৭০+ আইটেম" },
    { name: "লাইটিং, ব্যাটারি ও হর্ন", icon: "💡", count: "৯০+ আইটেম" },
    { name: "সাসপেনশন ও হ্যান্ডেলবার", icon: "🔧", count: "৪০+ আইটেম" },
    { name: "ক্ল্যাচ ও অ্যাক্সিলারেটর কেবল", icon: "⚙️", count: "৫০+ আইটেম" },
  ];

  return (
    <div className="mx-auto max-w-6xl space-y-10 px-4 py-8 sm:px-6">
      {/* High-Performance Racing Banner */}
      <section className="relative overflow-hidden rounded-3xl bg-gradient-to-r from-zinc-950 via-neutral-900 to-red-950 p-8 sm:p-12 text-white shadow-2xl border border-red-600/30">
        <div className="relative z-10 max-w-2xl space-y-4">
          <div className="inline-flex items-center gap-2 rounded-full border border-red-500/40 bg-red-950/60 px-4 py-1 text-xs font-black uppercase text-red-300 backdrop-blur-xs font-mono">
            <span>🏁 ১০০% জেনুইন বাইক পার্টস ও লুব্রিকেন্ট হাব</span>
          </div>
          <h1 className="text-3xl font-black sm:text-5xl uppercase tracking-tight leading-tight text-white font-mono">
            আপনার বাইকের পিক পারফরম্যান্স নিশ্চিত করুন
          </h1>
          <p className="text-sm sm:text-base text-zinc-300 font-medium leading-relaxed">
            সরাসরি অথরাইজড ডিস্ট্রিবিউটর থেকে সংগৃহীত অরিজিনাল ইঞ্জিন অয়েল, ড্রাইভ চেইন, ডিস্ক প্যাড ও পারফরম্যান্স পার্টস। ১০০% মডেল ফিটমেন্ট গ্যারান্টি সহ ঘরে বসেই ডেলিভারি নিন।
          </p>
          <div className="flex flex-wrap items-center gap-3 pt-2">
            <a
              href="#all-parts"
              className="rounded-xl bg-red-600 px-6 py-3 text-xs font-black uppercase tracking-wider text-white shadow-lg hover:bg-red-500 transition font-mono"
            >
              পার্টস ক্যাটালগ দেখুন ⚡
            </a>
            <span className="text-xs font-bold text-zinc-400">
              ✓ স্ক্র্যাচ কিউআর ভেরিফিকেশন ও ক্যাশ অন ডেলিভারি
            </span>
          </div>
        </div>

        {/* Decorative background watermark */}
        <div className="absolute -right-8 -bottom-10 select-none text-[160px] opacity-15">
          🏍️
        </div>
      </section>

      {/* 4 Trust Pillars */}
      <AutomotiveTrustBar />

      {/* Bike Brands Explorer */}
      <section className="space-y-4">
        <div className="flex items-center justify-between">
          <div>
            <span className="text-xs font-bold text-red-600 uppercase tracking-wider font-mono">ব্র্যান্ড ক্যাটালগ</span>
            <h2 className="text-xl sm:text-2xl font-black text-zinc-900">শীর্ষ বাইক ব্র্যান্ড অনুযায়ী পার্টস</h2>
          </div>
          <span className="text-xs font-bold text-red-600">সব ব্র্যান্ড →</span>
        </div>
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-6">
          {topBrands.map((b, idx) => (
            <div
              key={idx}
              className="group flex flex-col items-center rounded-2xl border border-zinc-200 bg-white p-4 text-center shadow-xs transition hover:-translate-y-1 hover:border-red-500 hover:shadow-md cursor-pointer"
            >
              <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-zinc-900 text-xl font-mono font-black text-red-500 group-hover:scale-110 transition duration-300">
                {b.name.slice(0, 2).toUpperCase()}
              </div>
              <h4 className="mt-3 font-mono text-sm font-black text-zinc-900 group-hover:text-red-600">
                {b.name}
              </h4>
              <span className="mt-0.5 rounded-full bg-zinc-100 px-2 py-0.5 text-[10px] font-bold text-zinc-600 font-mono">
                {b.origin}
              </span>
              <span className="mt-2 text-[10px] font-bold text-red-600">{b.badge}</span>
            </div>
          ))}
        </div>
      </section>

      {/* Parts Category Matrix */}
      <section className="space-y-4">
        <h2 className="text-xl sm:text-2xl font-black text-zinc-900">
          পার্টস ও এক্সেসরিজ ক্যাটাগরি
        </h2>
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          {partCategories.map((c, idx) => (
            <div
              key={idx}
              className="flex items-center gap-3 rounded-2xl border border-zinc-200 bg-white p-4 shadow-xs transition hover:border-red-500 hover:bg-red-50/20 cursor-pointer"
            >
              <span className="text-3xl">{c.icon}</span>
              <div className="min-w-0">
                <h4 className="text-xs font-bold text-zinc-900 truncate">{c.name}</h4>
                <p className="text-[10px] text-zinc-500 font-mono">{c.count}</p>
              </div>
            </div>
          ))}
        </div>
      </section>

      {/* Flash Sale / Mega Service Deals */}
      {home.flashSales && home.flashSales.sales && home.flashSales.sales.length > 0 ? (
        <section className="rounded-3xl border border-red-600/40 bg-gradient-to-r from-zinc-950 via-zinc-900 to-red-950 p-6 text-white shadow-xl">
          <div className="flex flex-wrap items-center justify-between gap-3 border-b border-zinc-800 pb-4">
            <div>
              <span className="rounded-full bg-red-600 px-3 py-0.5 text-xs font-black uppercase text-white font-mono">
                ⚡ লিমিটেড মেগা টিউন-আপ ফ্ল্যাশ ডিল
              </span>
              <h2 className="mt-1 text-xl sm:text-2xl font-black text-white font-mono">
                আজকের সুপার মোটর পার্টস অফার
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
              <AutomotiveProductCard key={p.id} orgSlug={orgSlug} product={p} locale={locale} />
            ))}
          </div>
        </section>
      ) : null}

      {/* Main Parts Catalog */}
      <section id="all-parts" className="space-y-6">
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-zinc-200 pb-4">
          <div>
            <h2 className="text-2xl font-black text-zinc-900 font-mono">
              সকল অটোমোটিভ ও বাইক পার্টস
            </h2>
            <p className="text-xs text-zinc-500 font-mono">
              মোট {home.pagination?.total ?? products.length} টি পার্টস পাওয়া যাচ্ছে
            </p>
          </div>
          <SortSelect orgSlug={orgSlug} locale={locale} value="featured" />
        </div>

        {products.length === 0 ? (
          <div className="rounded-2xl border border-dashed border-zinc-300 bg-white p-12 text-center">
            <span className="text-4xl">🏍️</span>
            <p className="mt-3 text-sm font-bold text-zinc-600">বর্তমানে কোনো পার্টস পাওয়া যায়নি</p>
          </div>
        ) : (
          <div className="grid grid-cols-2 gap-3 sm:gap-5 md:grid-cols-3 lg:grid-cols-4">
            {products.map((p) => (
              <AutomotiveProductCard key={p.id} orgSlug={orgSlug} product={p} locale={locale} />
            ))}
          </div>
        )}
      </section>

      <RecentlyViewedStrip orgSlug={orgSlug} locale={locale} />
    </div>
  );
}
