"use client";

import React, { useState } from "react";
import Link from "next/link";
import type { ShopHome, ShopProduct } from "@/lib/storefront-server";
import { patchCartLine, notifyCartUpdated } from "@/lib/storefront-cart";
import { fmtMoneyMinor } from "@repo/contracts";
import { shopT, type ShopLocale } from "@/lib/shop-i18n";

export function formatSportsPrice(minor: number | string | null | undefined, locale: string = "bn"): string {
  if (minor == null) return fmtMoneyMinor(locale, 0);
  const num = typeof minor === "string" ? parseInt(minor, 10) : minor;
  if (isNaN(num)) return fmtMoneyMinor(locale, 0);
  return fmtMoneyMinor(locale, Math.round(num / 100) * 100);
}

/**
 * 4 Core Sports & Fitness Pillars
 */
export function SportsTrustBar({ locale = "bn" }: { locale?: ShopLocale | string } = {}) {
  const t = shopT(locale);
  return (
    <div className="grid grid-cols-2 gap-3 sm:grid-cols-4 sm:gap-4 py-4">
      <div className="flex items-center gap-3 rounded-2xl border border-sky-100 bg-white p-3.5 shadow-xs">
        <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-sky-50 text-xl">
          🏆
        </span>
        <div className="min-w-0">
          <p className="text-xs font-bold text-slate-900">{t.themeSports.trust1Title}</p>
          <p className="text-[11px] text-slate-500 truncate">{t.themeSports.trust1Desc}</p>
        </div>
      </div>
      <div className="flex items-center gap-3 rounded-2xl border border-sky-100 bg-white p-3.5 shadow-xs">
        <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-blue-50 text-xl">
          🛠️
        </span>
        <div className="min-w-0">
          <p className="text-xs font-bold text-slate-900">{t.themeSports.trust2Title}</p>
          <p className="text-[11px] text-slate-500 truncate">{t.themeSports.trust2Desc}</p>
        </div>
      </div>
      <div className="flex items-center gap-3 rounded-2xl border border-sky-100 bg-white p-3.5 shadow-xs">
        <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-cyan-50 text-xl">
          🚚
        </span>
        <div className="min-w-0">
          <p className="text-xs font-bold text-slate-900">{t.themeSports.trust3Title}</p>
          <p className="text-[11px] text-slate-500 truncate">{t.themeSports.trust3Desc}</p>
        </div>
      </div>
      <div className="flex items-center gap-3 rounded-2xl border border-sky-100 bg-white p-3.5 shadow-xs">
        <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-amber-50 text-xl">
          🛡️
        </span>
        <div className="min-w-0">
          <p className="text-xs font-bold text-slate-900">{t.themeSports.trust4Title}</p>
          <p className="text-[11px] text-slate-500 truncate">{t.themeSports.trust4Desc}</p>
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
  locale = "bn",
}: {
  open: boolean;
  onClose: () => void;
  productName: string;
  locale?: ShopLocale | string;
}) {
  const t = shopT(locale);
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
            <h3 className="text-lg font-black text-slate-900">{t.themeSports.assemblyTitle}</h3>
            <p className="text-xs text-slate-500">{t.themeSports.assemblySub}</p>
          </div>
        </div>

        <div className="mt-4 rounded-2xl border border-sky-100 bg-sky-50/60 p-3.5">
          <p className="text-xs font-semibold text-sky-950">
            {t.themeSports.selectedProduct}<span className="font-bold">{productName}</span>
          </p>
          <p className="mt-1 text-[11px] text-sky-800">
            {t.themeSports.assemblyBody}
          </p>
        </div>

        {booked ? (
          <div className="mt-6 rounded-2xl bg-emerald-50 border border-emerald-200 p-6 text-center">
            <span className="text-4xl">🎉</span>
            <p className="mt-2 text-base font-bold text-emerald-900">{t.themeSports.assemblyDoneTitle}</p>
            <p className="mt-1 text-xs text-emerald-700">
              {t.themeSports.assemblyDonePrefix}<strong>{phone || t.themeSports.yourNumber}</strong>{t.themeSports.assemblyDoneMid}
            </p>
            <button
              type="button"
              onClick={() => {
                setBooked(false);
                onClose();
              }}
              className="mt-4 rounded-xl bg-emerald-600 px-6 py-2.5 text-xs font-bold text-white hover:bg-emerald-700"
            >
              {t.themeSports.okButton}
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
              <label className="block text-xs font-bold text-slate-700">{t.themeSports.cityLabel}</label>
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
              <label className="block text-xs font-bold text-slate-700">{t.themeSports.addressLabel}</label>
              <textarea
                required
                rows={2}
                value={address}
                onChange={(e) => setAddress(e.target.value)}
                placeholder={t.themeSports.addressPlaceholder}
                className="mt-1 w-full rounded-xl border border-slate-300 px-3 py-2 text-xs text-slate-800 focus:border-sky-500 focus:outline-hidden"
              />
            </div>

            <div>
              <label className="block text-xs font-bold text-slate-700">{t.themeSports.phoneLabel}</label>
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
                <span>{t.themeSports.noHiddenCharge}</span>
              </div>
              <div className="flex items-center gap-2">
                <span>✓</span>
                <span>{t.themeSports.loadTest}</span>
              </div>
            </div>

            <button
              type="submit"
              className="mt-2 w-full rounded-xl bg-sky-600 py-3 text-xs font-bold text-white shadow-md hover:bg-sky-700"
            >
              {t.themeSports.bookFitting}
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
  locale = "bn",
}: {
  selectedWeight: string;
  onChangeWeight: (w: string) => void;
  locale?: ShopLocale | string;
}) {
  const t = shopT(locale);
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
        <span className="font-bold text-slate-800">{t.themeSports.weightLabel}</span>
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
export function SportsEquipmentSpecs({ locale = "bn" }: { locale?: ShopLocale | string } = {}) {
  const t = shopT(locale);
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
        <span>{t.themeSports.specsHeading}</span>
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
  locale = "bn",
}: {
  orgSlug: string;
  mainProduct: { id: string; name: string; priceMinor: string };
  locale?: ShopLocale | string;
}) {
  const t = shopT(locale);
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
            <h3 className="text-sm font-black text-slate-900">{t.themeSports.comboTitle}</h3>
            <p className="text-[11px] text-slate-500">{t.themeSports.comboSubPrefix}{formatSportsPrice(50000, locale)}{t.themeSports.comboSubSuffix}</p>
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
          <p className="text-[11px] text-slate-400">{t.themeSports.comboPriceLabel}</p>
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
          {loading ? t.themeSports.adding : added ? t.themeSports.comboAdded : t.themeSports.comboAdd}
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
  const t = shopT(locale);
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
              {t.themeSports.originalBadge}
            </span>
            {hasDiscount ? (
              <span className="rounded-lg bg-sky-600 px-2 py-0.5 text-[10px] font-black text-white">
                {t.themeSports.offerOff}
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
            <span>{t.themeSports.frameGuarantee}</span>
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
          {loading ? t.themeSports.adding : added ? t.themeSports.addedToCart : t.themeSports.addToCart}
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
  const t = shopT(locale);
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
            <span>{t.themeSports.heroBadge}</span>
          </div>
          <h1 className="text-3xl font-black italic tracking-tight text-white sm:text-5xl lg:text-6xl">
            BUILD YOUR <span className="text-sky-400 underline decoration-sky-500/50">DREAM BODY</span> AT HOME
          </h1>
          <p className="text-sm font-medium text-slate-300 sm:text-base max-w-xl">
            {t.themeSports.heroDesc}
          </p>
          <div className="flex flex-wrap items-center gap-3 pt-3">
            <a
              href="#products-section"
              className="rounded-xl bg-sky-500 px-6 py-3 text-xs font-black uppercase tracking-wider text-white shadow-lg hover:bg-sky-400 transition-transform active:scale-95"
            >
              {t.themeSports.heroCta}
            </a>
            <button
              type="button"
              onClick={() => setAssemblyOpen(true)}
              className="rounded-xl border border-sky-400/40 bg-white/10 px-6 py-3 text-xs font-bold text-white backdrop-blur-xs hover:bg-white/20"
            >
              {t.themeSports.heroAssembly}
            </button>
          </div>
        </div>
      </div>

      {/* Trust Pillars */}
      <SportsTrustBar locale={locale} />

      {/* Sports Categories Matrix */}
      <div className="space-y-4">
        <div className="flex items-center justify-between">
          <div>
            <h2 className="text-lg font-black text-slate-900">{t.themeSports.categoriesHeading}</h2>
            <p className="text-xs text-slate-500">{t.themeSports.categoriesSub}</p>
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
            <span>{t.themeSports.techBanner}</span>
          </div>
          <h3 className="text-xl sm:text-2xl font-black">
            {t.themeSports.techTitle}
          </h3>
          <p className="text-xs sm:text-sm text-sky-100">
            {t.themeSports.techBody}
          </p>
        </div>
        <button
          type="button"
          onClick={() => setAssemblyOpen(true)}
          className="rounded-2xl bg-white px-6 py-3.5 text-xs font-black uppercase tracking-wider text-sky-900 shadow-xl hover:bg-sky-50 transition-transform active:scale-95"
        >
          {t.themeSports.techCta}
        </button>
      </div>

      {/* Products Grid */}
      <div id="products-section" className="space-y-4">
        <div className="flex items-center justify-between">
          <div>
            <h2 className="text-xl font-black text-slate-900">{t.themeSports.collectionHeading}</h2>
            <p className="text-xs text-slate-500">{t.themeSports.collectionSub}</p>
          </div>
        </div>

        {products.length === 0 ? (
          <div className="rounded-3xl border border-dashed border-slate-300 bg-white p-12 text-center">
            <p className="text-4xl">🏋️</p>
            <p className="mt-2 text-sm font-semibold text-slate-600">{t.themeSports.noProducts}</p>
          </div>
        ) : (
          <div className="grid grid-cols-2 gap-3 sm:gap-5 md:grid-cols-3 lg:grid-cols-4">
            {products.map((p: ShopProduct) => (
              <SportsProductCard key={p.id} orgSlug={orgSlug} product={p} locale={locale} />
            ))}
          </div>
        )}
      </div>

      <SportsAssemblyModal locale={locale}
        open={assemblyOpen}
        onClose={() => setAssemblyOpen(false)}
        productName={t.themeSports.assemblyProductName}
      />
    </div>
  );
}
