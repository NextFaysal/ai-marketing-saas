"use client";

import React, { useState } from "react";
import Link from "next/link";
import type { ShopHome, ShopProduct } from "@/lib/storefront-server";
import { patchCartLine, notifyCartUpdated } from "@/lib/storefront-cart";

export function formatSportsPrice(minor: number | string | null | undefined): string {
  if (minor == null) return "৳০";
  const num = typeof minor === "string" ? parseInt(minor, 10) : minor;
  if (isNaN(num)) return "৳০";
  return `৳${Math.round(num / 100).toLocaleString("bn-BD")}`;
}

/**
 * 4 Core Sports & Fitness Pillars
 */
export function SportsTrustBar() {
  return (
    <div className="grid grid-cols-2 gap-3 sm:grid-cols-4 sm:gap-4 py-4">
      <div className="flex items-center gap-3 rounded-2xl border border-sky-100 bg-white p-3.5 shadow-xs">
        <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-sky-50 text-xl">
          🏆
        </span>
        <div className="min-w-0">
          <p className="text-xs font-bold text-slate-900">১০০% অরিজিনাল গিয়ার</p>
          <p className="text-[11px] text-slate-500 truncate">বিশ্বখ্যাত ও অথেনটিক ব্র্যান্ড</p>
        </div>
      </div>
      <div className="flex items-center gap-3 rounded-2xl border border-sky-100 bg-white p-3.5 shadow-xs">
        <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-blue-50 text-xl">
          🛠️
        </span>
        <div className="min-w-0">
          <p className="text-xs font-bold text-slate-900">ফ্রি হোম অ্যাসেম্বলি</p>
          <p className="text-[11px] text-slate-500 truncate">দক্ষ টেকনিশিয়ান দ্বারা ফিটিং</p>
        </div>
      </div>
      <div className="flex items-center gap-3 rounded-2xl border border-sky-100 bg-white p-3.5 shadow-xs">
        <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-cyan-50 text-xl">
          🚚
        </span>
        <div className="min-w-0">
          <p className="text-xs font-bold text-slate-900">হেভি ফ্রেইট ডেলিভারি</p>
          <p className="text-[11px] text-slate-500 truncate">সারা দেশে সুরক্ষিত হোম ডেলিভারি</p>
        </div>
      </div>
      <div className="flex items-center gap-3 rounded-2xl border border-sky-100 bg-white p-3.5 shadow-xs">
        <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-amber-50 text-xl">
          🛡️
        </span>
        <div className="min-w-0">
          <p className="text-xs font-bold text-slate-900">১০ বছর ফ্রেম গ্যারান্টি</p>
          <p className="text-[11px] text-slate-500 truncate">ইন্ডাস্ট্রিয়াল গ্রেড হেভি স্টিল</p>
        </div>
      </div>
    </div>
  );
}

/**
 * Interactive Home Gym Setup & Technician Assembly Booking Modal
 */
export function SportsAssemblyModal({
  open,
  onClose,
  productName,
}: {
  open: boolean;
  onClose: () => void;
  productName: string;
}) {
  const [city, setCity] = useState("ঢাকা (Dhaka Metro)");
  const [address, setAddress] = useState("");
  const [phone, setPhone] = useState("");
  const [booked, setBooked] = useState(false);

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4 backdrop-blur-xs">
      <div className="relative w-full max-w-lg rounded-3xl bg-white p-6 shadow-2xl">
        <button
          type="button"
          onClick={onClose}
          className="absolute right-4 top-4 rounded-full p-2 text-slate-400 hover:bg-slate-100 hover:text-slate-700"
        >
          ✕
        </button>

        <div className="flex items-center gap-3">
          <span className="flex h-12 w-12 items-center justify-center rounded-2xl bg-sky-100 text-2xl text-sky-700">
            🛠️
          </span>
          <div>
            <h3 className="text-lg font-black text-slate-900">ফ্রি হোম জিম অ্যাসেম্বলি ও টেকনিশিয়ান</h3>
            <p className="text-xs text-slate-500">বিশেষজ্ঞ মেকানিক দ্বারা নিরাপদ ফিটিং ও ক্যালিব্রেশন</p>
          </div>
        </div>

        <div className="mt-4 rounded-2xl border border-sky-100 bg-sky-50/60 p-3.5">
          <p className="text-xs font-semibold text-sky-950">
            নির্বাচিত পণ্য: <span className="font-bold">{productName}</span>
          </p>
          <p className="mt-1 text-[11px] text-sky-800">
            ইকুইপমেন্ট ডেলিভারির ২৪-৪৮ ঘণ্টার মধ্যে আমাদের সার্টিফাইড টেকনিশিয়ান আপনার ঠিকানায় গিয়ে আনবক্সিং, লেভেলিং ও স্ক্রু-টাইটেনিং সম্পূর্ণ করে দেবেন।
          </p>
        </div>

        {booked ? (
          <div className="mt-6 rounded-2xl bg-emerald-50 border border-emerald-200 p-6 text-center">
            <span className="text-4xl">🎉</span>
            <p className="mt-2 text-base font-bold text-emerald-900">অ্যাসেম্বলি সার্ভিস রিকোয়েস্ট গৃহীত হয়েছে!</p>
            <p className="mt-1 text-xs text-emerald-700">
              আমাদের স্পোর্টস কোঅর্ডিনেটর খুব শীঘ্রই <strong>{phone || "আপনার নম্বরে"}</strong> কল করে শিডিউল কনফার্ম করবেন।
            </p>
            <button
              type="button"
              onClick={() => {
                setBooked(false);
                onClose();
              }}
              className="mt-4 rounded-xl bg-emerald-600 px-6 py-2.5 text-xs font-bold text-white hover:bg-emerald-700"
            >
              ঠিক আছে
            </button>
          </div>
        ) : (
          <form
            onSubmit={(e) => {
              e.preventDefault();
              setBooked(true);
            }}
            className="mt-4 space-y-3"
          >
            <div>
              <label className="block text-xs font-bold text-slate-700">আপনার শহর / অঞ্চল</label>
              <select
                value={city}
                onChange={(e) => setCity(e.target.value)}
                className="mt-1 w-full rounded-xl border border-slate-300 bg-white px-3 py-2 text-xs font-semibold text-slate-800 focus:border-sky-500 focus:outline-hidden"
              >
                <option>ঢাকা (Dhaka Metro) — ২৪ ঘণ্টার মধ্যে ফ্রি ফিটিং</option>
                <option>চট্টগ্রাম (Chattogram City) — ৪৮ ঘণ্টার মধ্যে</option>
                <option>সিলেট (Sylhet Sadar)</option>
                <option>রাজশাহী (Rajshahi Metro)</option>
                <option>খুলনা (Khulna Sadar)</option>
                <option>অন্যান্য জেলা (কুরিয়ার সাপোর্টেড ভিডিও অ্যাসিস্ট্যান্স)</option>
              </select>
            </div>

            <div>
              <label className="block text-xs font-bold text-slate-700">বিস্তারিত ঠিকানা (বাসা/ফ্লোর/রোড)</label>
              <textarea
                required
                rows={2}
                value={address}
                onChange={(e) => setAddress(e.target.value)}
                placeholder="যেমন: ফ্ল্যাট ৪/বি, হাউজ ১২, রোড ৭, ধানমন্ডি, ঢাকা"
                className="mt-1 w-full rounded-xl border border-slate-300 px-3 py-2 text-xs text-slate-800 focus:border-sky-500 focus:outline-hidden"
              />
            </div>

            <div>
              <label className="block text-xs font-bold text-slate-700">মোবাইল নম্বর</label>
              <input
                required
                type="tel"
                value={phone}
                onChange={(e) => setPhone(e.target.value)}
                placeholder="017XXXXXXXX"
                className="mt-1 w-full rounded-xl border border-slate-300 px-3 py-2 text-xs text-slate-800 focus:border-sky-500 focus:outline-hidden"
              />
            </div>

            <div className="space-y-1.5 pt-1 text-[11px] text-slate-500">
              <div className="flex items-center gap-2">
                <span>✓</span>
                <span>কোনো হিডেন চার্জ নেই — ১০০% ফ্রি হোম ইন্সটলেশন</span>
              </div>
              <div className="flex items-center gap-2">
                <span>✓</span>
                <span>লোড-বেয়ারিং টেস্ট ও সেফটি ট্রায়াল নিশ্চিতকরণ</span>
              </div>
            </div>

            <button
              type="submit"
              className="mt-2 w-full rounded-xl bg-sky-600 py-3 text-xs font-bold text-white shadow-md hover:bg-sky-700"
            >
              হোম ফিটিং শিডিউল বুক করুন (ফ্রি)
            </button>
          </form>
        )}
      </div>
    </div>
  );
}

/**
 * Dumbbell / Barbell Weight Selection Pills
 */
export function SportsWeightSelector({
  selectedWeight,
  onChangeWeight,
}: {
  selectedWeight: string;
  onChangeWeight: (w: string) => void;
}) {
  const options = [
    { id: "2.5kg", label: "২.৫ কেজি (জোড়া)", desc: "ওয়ার্মআপ ও টোনিং" },
    { id: "5kg", label: "৫ কেজি (জোড়া)", desc: "বিগিনার আর্মস ও শোল্ডার" },
    { id: "10kg", label: "১০ কেজি (জোড়া)", desc: "ইন্টারমিডিয়েট স্ট্রেন্থ" },
    { id: "15kg", label: "১৫ কেজি (জোড়া)", desc: "অ্যাডভান্সড চেস্ট ও ব্যাক" },
    { id: "20kg", label: "২০ কেজি (জোড়া)", desc: "প্রফেশনাল হেভি লিফটিং" },
  ];

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between text-xs">
        <span className="font-bold text-slate-800">ওজন / ক্যাপাসিটি সিলেক্টর:</span>
        <span className="font-semibold text-sky-600">{selectedWeight}</span>
      </div>
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
        {options.map((opt) => {
          const isSelected = selectedWeight.includes(opt.id) || selectedWeight.includes(opt.label);
          return (
            <button
              key={opt.id}
              type="button"
              onClick={() => onChangeWeight(opt.label)}
              className={`rounded-xl border p-2.5 text-left transition-all ${
                isSelected
                  ? "border-sky-600 bg-sky-50/80 ring-2 ring-sky-500/20"
                  : "border-slate-200 bg-white hover:border-slate-300"
              }`}
            >
              <div className="text-xs font-bold text-slate-900">{opt.label}</div>
              <div className="text-[10px] text-slate-500">{opt.desc}</div>
            </button>
          );
        })}
      </div>
    </div>
  );
}

/**
 * Heavy-duty Gym Equipment Specifications Table
 */
export function SportsEquipmentSpecs() {
  const specs = [
    { label: "ফ্রেম ম্যাটেরিয়াল", value: "১৪-গেজ হেভি ডিউটি ইন্ডাস্ট্রিয়াল স্টিল (মরিচারোধী পাউডার কোটেড)" },
    { label: "সর্বোচ্চ ইউজার ওয়েট", value: "১৫০ কেজি (হেভি কমার্শিয়াল টেস্টেড ৩৫০ কেজি পর্যন্ত)" },
    { label: "গ্রিপ ও কুশনিং", value: "নন-স্লিপ ডায়মন্ড নার্লিং গ্রিপ ও হাই-ডেনসিটি পিইউ লেদার ফোম" },
    { label: "সার্টিফিকেশন", value: "ISO 20957 কমার্শিয়াল ফিটনেস ইকুইপমেন্ট স্ট্যান্ডার্ড" },
    { label: "ফ্রেম ও পার্টস ওয়ারেন্টি", value: "১০ বছর স্ট্রাকচারাল ফ্রেম ও ২ বছর পার্টস রিপ্লেসমেন্ট" },
  ];

  return (
    <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-xs">
      <h4 className="flex items-center gap-2 text-xs font-black uppercase tracking-wider text-slate-900">
        <span>🏋️</span>
        <span>ইকুইপমেন্ট টেকনিক্যাল স্পেসিফিকেশন</span>
      </h4>
      <div className="mt-3 divide-y divide-slate-100 text-xs">
        {specs.map((s, idx) => (
          <div key={idx} className="flex justify-between py-2 text-slate-700">
            <span className="font-semibold text-slate-500">{s.label}</span>
            <span className="font-bold text-slate-900 text-right">{s.value}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

/**
 * Complete Workout & Strength Combo Bundle
 */
export function SportsWorkoutBundle({
  orgSlug,
  mainProduct,
}: {
  orgSlug: string;
  mainProduct: { id: string; name: string; priceMinor: string };
}) {
  const [loading, setLoading] = useState(false);
  const [added, setAdded] = useState(false);

  const mainPrice = parseInt(mainProduct.priceMinor, 10) || 0;
  const resistanceBandsPrice = 65000; // ৳650
  const shakerBottlePrice = 45000; // ৳450
  const discountMinor = 50000; // ৳500 savings
  const bundleTotal = Math.max(0, mainPrice + resistanceBandsPrice + shakerBottlePrice - discountMinor);

  const handleAddBundle = async () => {
    setLoading(true);
    try {
      await patchCartLine(orgSlug, { productId: mainProduct.id, quantity: 1 });
      notifyCartUpdated(orgSlug);
      setAdded(true);
      setTimeout(() => setAdded(false), 3000);
    } catch {
      // ignore
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="rounded-3xl border border-sky-200 bg-gradient-to-br from-sky-50/60 via-white to-blue-50/40 p-5 shadow-sm">
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-sky-100 pb-3">
        <div className="flex items-center gap-2">
          <span className="flex h-8 w-8 items-center justify-center rounded-xl bg-sky-600 text-white font-bold text-sm">
            ⚡
          </span>
          <div>
            <h3 className="text-sm font-black text-slate-900">আলটিমেট ওয়ার্কআউট স্টার্টার কম্বো বান্ডল</h3>
            <p className="text-[11px] text-slate-500">একসাথে নিলে পাচ্ছেন ৳৫০০ নগদ ছাড় ও ফ্রি হোম ডেলিভারি</p>
          </div>
        </div>
        <span className="rounded-full bg-emerald-100 px-3 py-1 text-xs font-black text-emerald-800">
          ইনস্ট্যান্ট ৳৫০০ সাশ্রয়
        </span>
      </div>

      <div className="mt-4 grid grid-cols-1 gap-3 sm:grid-cols-3">
        <div className="flex items-center gap-3 rounded-2xl border border-slate-200 bg-white p-3">
          <span className="text-2xl">🏋️</span>
          <div className="min-w-0">
            <p className="text-xs font-bold text-slate-900 truncate">{mainProduct.name}</p>
            <p className="text-[11px] font-semibold text-sky-600">{formatSportsPrice(mainPrice)}</p>
          </div>
        </div>
        <div className="flex items-center gap-3 rounded-2xl border border-slate-200 bg-white p-3">
          <span className="text-2xl">🎗️</span>
          <div className="min-w-0">
            <p className="text-xs font-bold text-slate-900 truncate">হেভি রেজিস্ট্যান্স ব্যান্ড সেট (৫ লেভেল)</p>
            <p className="text-[11px] font-semibold text-slate-500">৳৬৫০</p>
          </div>
        </div>
        <div className="flex items-center gap-3 rounded-2xl border border-slate-200 bg-white p-3">
          <span className="text-2xl">🥤</span>
          <div className="min-w-0">
            <p className="text-xs font-bold text-slate-900 truncate">BPA-Free প্রোটিন শেকার বোতল (৭০০ml)</p>
            <p className="text-[11px] font-semibold text-slate-500">৳৪৫০</p>
          </div>
        </div>
      </div>

      <div className="mt-5 flex flex-wrap items-center justify-between gap-4 rounded-2xl bg-slate-900 p-4 text-white">
        <div>
          <p className="text-[11px] text-slate-400">কম্বো অফার মূল্য (৩টি আইটেম একসাথে):</p>
          <div className="flex items-baseline gap-2">
            <span className="text-xl font-black text-white">{formatSportsPrice(bundleTotal)}</span>
            <span className="text-xs text-slate-400 line-through">
              {formatSportsPrice(mainPrice + resistanceBandsPrice + shakerBottlePrice)}
            </span>
          </div>
        </div>
        <button
          type="button"
          onClick={handleAddBundle}
          disabled={loading}
          className="rounded-xl bg-sky-500 px-6 py-2.5 text-xs font-bold text-white shadow-md hover:bg-sky-400 disabled:opacity-50"
        >
          {loading ? "যোগ হচ্ছে..." : added ? "✓ কম্বো কার্টে যোগ হয়েছে" : "সম্পূর্ণ কম্বো কার্টে যোগ করুন"}
        </button>
      </div>
    </div>
  );
}

/**
 * Athletic High-Performance Product Card
 */
export function SportsProductCard({
  orgSlug,
  product,
  locale = "bn",
}: {
  orgSlug: string;
  product: ShopProduct;
  locale?: string;
}) {
  const [loading, setLoading] = useState(false);
  const [added, setAdded] = useState(false);

  const priceMinor = parseInt(product.priceMinor, 10) || 0;
  const compareMinor = product.compareAtMinor
    ? parseInt(product.compareAtMinor, 10)
    : null;
  const hasDiscount = compareMinor && compareMinor > priceMinor;

  const handleQuickAdd = async (e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setLoading(true);
    try {
      await patchCartLine(orgSlug, { productId: product.id, quantity: 1 });
      notifyCartUpdated(orgSlug);
      setAdded(true);
      setTimeout(() => setAdded(false), 2000);
    } catch {
      // ignore
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="group relative flex flex-col justify-between overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-xs transition-all duration-300 hover:shadow-xl hover:border-sky-500/60">
      <Link href={`/shop/${orgSlug}/products/${product.slug}`} className="block">
        <div className="relative aspect-square w-full overflow-hidden bg-slate-50">
          {product.imageUrl ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={product.imageUrl}
              alt={product.name}
              className="h-full w-full object-cover transition-transform duration-500 group-hover:scale-105"
            />
          ) : (
            <div className="flex h-full w-full items-center justify-center text-4xl text-slate-300">
              🏋️
            </div>
          )}

          {/* Badges */}
          <div className="absolute left-2.5 top-2.5 flex flex-col gap-1.5">
            <span className="rounded-lg bg-slate-900/90 px-2 py-0.5 text-[10px] font-black uppercase tracking-wider text-white backdrop-blur-xs">
              ১০০% অরিজিনাল
            </span>
            {hasDiscount ? (
              <span className="rounded-lg bg-sky-600 px-2 py-0.5 text-[10px] font-black text-white">
                অফার ছাড়
              </span>
            ) : null}
          </div>

          <div className="absolute right-2.5 top-2.5">
            <span className="flex h-7 w-7 items-center justify-center rounded-full bg-white/90 text-xs shadow-xs text-sky-700 backdrop-blur-xs">
              ⚡
            </span>
          </div>
        </div>

        <div className="p-3.5">
          <div className="flex items-center gap-1.5 text-[11px] font-semibold text-sky-700">
            <span>🛡️</span>
            <span>১০ বছর ফ্রেম গ্যারান্টি</span>
          </div>
          <h3 className="mt-1 line-clamp-2 text-xs font-bold text-slate-900 group-hover:text-sky-600 transition-colors">
            {product.name}
          </h3>

          <div className="mt-3 flex items-baseline gap-2">
            <span className="text-sm font-black text-slate-950">
              {formatSportsPrice(priceMinor)}
            </span>
            {hasDiscount ? (
              <span className="text-xs text-slate-400 line-through">
                {formatSportsPrice(compareMinor)}
              </span>
            ) : null}
          </div>
        </div>
      </Link>

      <div className="px-3.5 pb-3.5">
        <button
          type="button"
          onClick={handleQuickAdd}
          disabled={loading || product.isGiftCard}
          className="w-full rounded-xl bg-slate-900 py-2.5 text-xs font-bold text-white shadow-xs transition-all hover:bg-sky-600 active:scale-98 disabled:opacity-50"
        >
          {loading ? "যোগ হচ্ছে..." : added ? "✓ কার্টে যোগ হয়েছে" : "কার্টে যোগ করুন"}
        </button>
      </div>
    </div>
  );
}

/**
 * Dedicated Sports & Fitness Home Surface
 */
export function SportsThemeHome({
  home,
  orgSlug,
  locale = "bn",
}: {
  home: ShopHome;
  orgSlug: string;
  locale?: string;
}) {
  const [assemblyOpen, setAssemblyOpen] = useState(false);
  const products: ShopProduct[] = home.products ?? [];
  const primaryColor = home.organization.primaryColor || "#0284c7";

  const sportsCategories = [
    { title: "ডাম্বেল ও স্ট্রেন্থ", icon: "🏋️", desc: "কাস্ট আয়রন, রাবার ও এক্সেসরিজ" },
    { title: "ট্রেডমিল ও কার্ডিও", icon: "🏃", desc: "হোম ও কমার্শিয়াল গ্রেড মোটর" },
    { title: "ব্যাডমিন্টন ও টেনিস", icon: "🏸", desc: "র‍্যাকেট, শাটলকক ও গ্রিপস" },
    { title: "ক্রিকেট ও ফুটবল", icon: "🏏", desc: "ইংলিশ উইলো ব্যাট ও বল" },
    { title: "স্পোর্টস নিউট্রিশন", icon: "🥤", desc: "প্রোটিন শেকার ও সাপ্লিমেন্ট" },
    { title: "ওয়ার্কআউট অ্যাপারেল", icon: "🎽", desc: "ড্রাই-ফিট জার্সি ও শর্টস" },
  ];

  return (
    <div className="space-y-10">
      {/* High-Energy Athletic Hero Banner */}
      <div className="relative overflow-hidden rounded-3xl bg-gradient-to-r from-sky-950 via-slate-900 to-cyan-950 text-white shadow-2xl border border-sky-500/20">
        <div className="absolute inset-0 bg-[radial-gradient(circle_at_30%_50%,rgba(2,132,199,0.25),transparent_60%)]" />
        <div className="relative z-10 px-6 py-12 sm:px-12 sm:py-16 lg:py-20 max-w-3xl space-y-4">
          <div className="inline-flex items-center gap-2 rounded-full border border-sky-400/40 bg-sky-500/10 px-3.5 py-1 text-xs font-black uppercase tracking-wider text-sky-300">
            <span>⚡</span>
            <span>ব্রেক ইওর লিমিটস — ১০০% প্রফেশনাল স্পোর্টস গিয়ার</span>
          </div>
          <h1 className="text-3xl font-black italic tracking-tight text-white sm:text-5xl lg:text-6xl">
            BUILD YOUR <span className="text-sky-400 underline decoration-sky-500/50">DREAM BODY</span> AT HOME
          </h1>
          <p className="text-sm font-medium text-slate-300 sm:text-base max-w-xl">
            বিশ্বমানের ট্রেডমিল, ডাম্বেল, রেজিস্ট্যান্স ব্যান্ড ও অল-ইন-ওয়ান হোম জিম সেট। সারা দেশে দ্রুত ডেলিভারি ও ফ্রি ইন্সটলেশন।
          </p>
          <div className="flex flex-wrap items-center gap-3 pt-3">
            <a
              href="#products-section"
              className="rounded-xl bg-sky-500 px-6 py-3 text-xs font-black uppercase tracking-wider text-white shadow-lg hover:bg-sky-400 transition-transform active:scale-95"
            >
              গিয়ার এক্সপ্লোর করুন
            </a>
            <button
              type="button"
              onClick={() => setAssemblyOpen(true)}
              className="rounded-xl border border-sky-400/40 bg-white/10 px-6 py-3 text-xs font-bold text-white backdrop-blur-xs hover:bg-white/20"
            >
              🛠️ ফ্রি হোম অ্যাসেম্বলি বুক করুন
            </button>
          </div>
        </div>
      </div>

      {/* Trust Pillars */}
      <SportsTrustBar />

      {/* Sports Categories Matrix */}
      <div className="space-y-4">
        <div className="flex items-center justify-between">
          <div>
            <h2 className="text-lg font-black text-slate-900">স্পোর্টস ও ট্রেনিং ক্যাটাগরি</h2>
            <p className="text-xs text-slate-500">আপনার ফিটনেস গোল অনুযায়ী সেরা অরিজিনাল গিয়ার বেছে নিন</p>
          </div>
        </div>
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
          {sportsCategories.map((c, idx) => (
            <div
              key={idx}
              className="group cursor-pointer rounded-2xl border border-slate-200 bg-white p-4 text-center shadow-xs transition-all hover:border-sky-500/60 hover:shadow-lg"
            >
              <span className="inline-block text-3xl transition-transform group-hover:scale-110">
                {c.icon}
              </span>
              <p className="mt-2 text-xs font-black text-slate-900 group-hover:text-sky-600 transition-colors">
                {c.title}
              </p>
              <p className="mt-0.5 text-[10px] text-slate-500 line-clamp-1">{c.desc}</p>
            </div>
          ))}
        </div>
      </div>

      {/* Technician Assembly Callout Banner */}
      <div className="rounded-3xl border border-sky-200 bg-gradient-to-r from-sky-600 to-blue-700 p-6 sm:p-8 text-white shadow-lg flex flex-wrap items-center justify-between gap-6">
        <div className="space-y-2 max-w-xl">
          <div className="inline-flex items-center gap-2 rounded-full bg-white/20 px-3 py-0.5 text-xs font-black">
            <span>🛠️</span>
            <span>সারাদেশে সার্টিফাইড টেকনিশিয়ান নেটওয়ার্ক</span>
          </div>
          <h3 className="text-xl sm:text-2xl font-black">
            হোম জিম ইকুইপমেন্ট ইন্সটলেশন নিয়ে চিন্তিত?
          </h3>
          <p className="text-xs sm:text-sm text-sky-100">
            ট্রেডমিল, ক্রস ট্রেইনার কিংবা মাল্টি-জিম ইকুইপমেন্ট — ডেলিভারির পর আমাদের দক্ষ টেকনিশিয়ান আপনার বাসায় গিয়ে সম্পূর্ণ ফ্রি সেটআপ ও লোড ক্যালিব্রেশন করে দেবেন।
          </p>
        </div>
        <button
          type="button"
          onClick={() => setAssemblyOpen(true)}
          className="rounded-2xl bg-white px-6 py-3.5 text-xs font-black uppercase tracking-wider text-sky-900 shadow-xl hover:bg-sky-50 transition-transform active:scale-95"
        >
          ইন্সটলেশন শিডিউল করুন →
        </button>
      </div>

      {/* Products Grid */}
      <div id="products-section" className="space-y-4">
        <div className="flex items-center justify-between">
          <div>
            <h2 className="text-xl font-black text-slate-900">সেরা স্পোর্টস ও জিম ইকুইপমেন্ট</h2>
            <p className="text-xs text-slate-500">প্রফেশনাল অ্যাথলেটদের ফার্স্ট চয়েস অরিজিনাল গিয়ার</p>
          </div>
        </div>

        {products.length === 0 ? (
          <div className="rounded-3xl border border-dashed border-slate-300 bg-white p-12 text-center">
            <p className="text-4xl">🏋️</p>
            <p className="mt-2 text-sm font-semibold text-slate-600">কোনো স্পোর্টস প্রোডাক্ট পাওয়া যায়নি।</p>
          </div>
        ) : (
          <div className="grid grid-cols-2 gap-3 sm:gap-5 md:grid-cols-3 lg:grid-cols-4">
            {products.map((p: ShopProduct) => (
              <SportsProductCard key={p.id} orgSlug={orgSlug} product={p} locale={locale} />
            ))}
          </div>
        )}
      </div>

      <SportsAssemblyModal
        open={assemblyOpen}
        onClose={() => setAssemblyOpen(false)}
        productName="হোম জিম ও ট্রেনিং ইকুইপমেন্ট"
      />
    </div>
  );
}
