"use client";
import React, { useEffect, useState } from "react";
import { fmtNumber } from "@repo/contracts";
import { pubLocaleOf, pubT } from "@/lib/i18n/public";

interface UrgencyStockBarProps {
  stockCount?: number | null;
  locale?: string;
}

export function UrgencyStockBar({ stockCount = 6, locale }: UrgencyStockBarProps) {
  const loc = pubLocaleOf(locale);
  const t = pubT(loc);
  const [secondsLeft, setSecondsLeft] = useState(885); // ~14m 45s

  useEffect(() => {
    const timer = setInterval(() => {
      setSecondsLeft((prev) => (prev > 1 ? prev - 1 : 890));
    }, 1000);
    return () => clearInterval(timer);
  }, []);

  const minutes = Math.floor(secondsLeft / 60);
  const seconds = secondsLeft % 60;
  const displayTime = `${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`;

  const remaining = typeof stockCount === "number" && stockCount > 0 ? Math.min(stockCount, 9) : 4;

  return (
    <div className="rounded-2xl border border-amber-300 bg-gradient-to-r from-amber-500/10 via-orange-500/10 to-amber-500/10 p-3.5 shadow-sm">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <span className="flex h-7 w-7 items-center justify-center rounded-full bg-amber-500 text-white text-xs animate-pulse">
            🔥
          </span>
          <div>
            <p className="text-xs font-black text-amber-950">
              {t.boosters.offerTitle}
            </p>
            <p className="text-[11px] font-semibold text-amber-800">
              {t.boosters.stockPrefix}<span className="font-bold underline text-rose-600">{fmtNumber(loc, remaining)}{t.boosters.stockMid}</span>{t.boosters.stockSuffix}
            </p>
          </div>
        </div>
        <div className="flex items-center gap-1.5 rounded-xl bg-white px-3 py-1.5 border border-amber-200 shadow-xs">
          <span className="text-[11px] font-semibold text-slate-500">{t.boosters.offerEndsLabel}</span>
          <span className="font-mono text-sm font-black text-rose-600 tracking-wider">
            {displayTime}
          </span>
        </div>
      </div>
      <div className="mt-2.5 h-1.5 w-full overflow-hidden rounded-full bg-amber-200/60">
        <div
          className="h-full rounded-full bg-gradient-to-r from-amber-500 to-rose-500 transition-all duration-500"
          style={{ width: `${Math.max(15, (remaining / 10) * 100)}%` }}
        />
      </div>
    </div>
  );
}

interface BundleSelectorProps {
  unitMinor: string | number;
  quantity: number;
  onSelectQuantity: (q: number) => void;
  takaFn: (minor?: string | number | null) => string;
  locale?: string;
}

export function BundleSelector({
  unitMinor,
  quantity,
  onSelectQuantity,
  takaFn,
  locale,
}: BundleSelectorProps) {
  const t = pubT(locale);
  const baseNum = Number(unitMinor) || 0;

  const tiers = [
    {
      qty: 1,
      title: t.boosters.tier1Title,
      subtitle: t.boosters.tier1Subtitle,
      priceMinor: baseNum,
      badge: null,
      savings: null,
    },
    {
      qty: 2,
      title: t.boosters.tier2Title,
      subtitle: `${t.boosters.tier2SubtitlePrefix}${takaFn(20000)}${t.boosters.tier2SubtitleSuffix}`,
      priceMinor: Math.max(0, baseNum * 2 - 20000),
      badge: t.boosters.tier2Badge,
      savings: t.boosters.tier2Savings.replace("{amount}", takaFn(20000)),
    },
    {
      qty: 3,
      title: t.boosters.tier3Title,
      subtitle: `${t.boosters.tier3SubtitlePrefix}${takaFn(40000)}${t.boosters.tier3SubtitleSuffix}`,
      priceMinor: Math.max(0, baseNum * 3 - 40000),
      badge: t.boosters.tier3Badge,
      savings: t.boosters.tier3Savings.replace("{amount}", takaFn(40000)),
    },
  ];

  return (
    <div className="space-y-2">
      <label className="block text-xs font-bold text-slate-800">
        {t.boosters.bundleLabel}
      </label>
      <div className="grid gap-2.5 sm:grid-cols-3">
        {tiers.map((t) => {
          const isSelected = quantity === t.qty;
          return (
            <button
              key={t.qty}
              type="button"
              onClick={() => onSelectQuantity(t.qty)}
              className={`relative flex flex-col justify-between rounded-2xl border p-3.5 text-left transition ${
                isSelected
                  ? "border-indigo-600 bg-indigo-50/60 ring-2 ring-indigo-500 shadow-sm"
                  : "border-slate-200 bg-white hover:border-slate-300 hover:bg-slate-50/50"
              }`}
            >
              {t.badge && (
                <span className="absolute -top-2.5 right-3 rounded-full bg-gradient-to-r from-amber-500 to-rose-500 px-2 py-0.5 text-[10px] font-extrabold text-white shadow-xs">
                  {t.badge}
                </span>
              )}
              <div className="space-y-1">
                <div className="flex items-center justify-between">
                  <span className="text-xs font-black text-slate-900">{t.title}</span>
                  <span
                    className={`flex h-4 w-4 items-center justify-center rounded-full border text-[10px] ${
                      isSelected
                        ? "border-indigo-600 bg-indigo-600 text-white font-bold"
                        : "border-slate-300 bg-white"
                    }`}
                  >
                    {isSelected ? "✓" : ""}
                  </span>
                </div>
                <p className="text-[11px] font-semibold text-slate-500">{t.subtitle}</p>
              </div>
              <div className="mt-3 border-t border-slate-100 pt-2 flex items-baseline justify-between">
                <span className="text-sm font-black text-indigo-700">
                  {takaFn(t.priceMinor)}
                </span>
                {t.savings && (
                  <span className="rounded bg-emerald-100 px-1.5 py-0.5 text-[10px] font-bold text-emerald-800">
                    {t.savings}
                  </span>
                )}
              </div>
            </button>
          );
        })}
      </div>
    </div>
  );
}

interface StickyBuyBarProps {
  productName: string;
  imageUrl?: string | null;
  unitMinor: string | number;
  quantity: number;
  onScrollToOrder: () => void;
  visible: boolean;
  takaFn: (minor?: string | number | null) => string;
  locale?: string;
}

export function StickyBuyBar({
  productName,
  imageUrl,
  unitMinor,
  quantity,
  onScrollToOrder,
  visible,
  takaFn,
  locale,
}: StickyBuyBarProps) {
  const loc = pubLocaleOf(locale);
  const t = pubT(loc);
  if (!visible) return null;

  const totalApprox = Number(unitMinor) * quantity;

  return (
    <div className="fixed inset-x-0 bottom-0 z-40 border-t border-slate-200 bg-white/95 px-4 py-3 backdrop-blur shadow-2xl transition-all duration-300">
      <div className="mx-auto flex max-w-3xl items-center justify-between gap-3">
        <div className="flex items-center gap-3 min-w-0 flex-1">
          {imageUrl ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={imageUrl}
              alt=""
              className="h-11 w-11 shrink-0 rounded-xl border border-slate-200 object-cover"
            />
          ) : (
            <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-indigo-50 text-lg">
              📦
            </div>
          )}
          <div className="min-w-0">
            <p className="truncate text-xs font-bold text-slate-800">{productName}</p>
            <div className="flex items-baseline gap-2">
              <span className="text-base font-black text-indigo-700">
                {takaFn(totalApprox)}
              </span>
              {quantity > 1 && (
                <span className="text-[11px] font-semibold text-slate-500">
                  {t.boosters.qtyLabel.replace("{count}", fmtNumber(loc, quantity))}
                </span>
              )}
            </div>
          </div>
        </div>

        <button
          type="button"
          onClick={onScrollToOrder}
          className="shrink-0 rounded-2xl bg-gradient-to-r from-indigo-600 to-indigo-700 px-6 py-3 text-xs sm:text-sm font-black text-white shadow-lg shadow-indigo-600/30 transition hover:from-indigo-700 hover:to-indigo-800 active:scale-95"
        >
          {t.boosters.orderCodButton}
        </button>
      </div>
    </div>
  );
}

export function RecentBuyersToast({ locale }: { locale?: string } = {}) {
  const t = pubT(locale);
  const [current, setCurrent] = useState<{ name: string; location: string; timeAgo: string } | null>(null);

  const notifications = [
    { name: "আরিফুল ইসলাম", location: "মিরপুর, ঢাকা", timeAgo: "২ মিনিট আগে" },
    { name: "তানিয়া আক্তার", location: "ধানমন্ডি, ঢাকা", timeAgo: "৫ মিনিট আগে" },
    { name: "মেহেদী হাসান", location: "জিইসি, চট্টগ্রাম", timeAgo: "৭ মিনিট আগে" },
    { name: "ফাতেমা বেগম", location: "সিলেট সদর", timeAgo: "১০ মিনিট আগে" },
    { name: "শাকিল আহমেদ", location: "রাজশাহী", timeAgo: "৩ মিনিট আগে" },
    { name: "রাশেদুল করিম", location: "উত্তরা, ঢাকা", timeAgo: "১২ মিনিট আগে" },
  ];

  useEffect(() => {
    let index = 0;
    const interval = setInterval(() => {
      setCurrent(notifications[index % notifications.length]);
      index++;

      // auto dismiss after 5s
      const timeout = setTimeout(() => {
        setCurrent(null);
      }, 5000);

      return () => clearTimeout(timeout);
    }, 18000);

    return () => clearInterval(interval);
  }, []);

  if (!current) return null;

  return (
    <div className="fixed bottom-20 left-4 z-40 max-w-xs animate-bounce-in rounded-2xl border border-slate-200 bg-white/95 p-3 shadow-xl backdrop-blur">
      <div className="flex items-center gap-2.5">
        <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-emerald-100 text-emerald-700 font-bold text-xs">
          ✓
        </div>
        <div className="min-w-0">
          <p className="truncate text-xs font-bold text-slate-800">
            {current.name} ({current.location})
          </p>
          <p className="text-[10px] text-slate-500">
            {current.timeAgo}{t.boosters.orderedSuffix}
          </p>

        </div>
      </div>
    </div>
  );
}
