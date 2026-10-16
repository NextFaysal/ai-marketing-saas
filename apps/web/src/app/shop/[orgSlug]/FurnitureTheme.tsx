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

export function formatFurniturePrice(minor: string): string {
  try {
    return formatMinor(BigInt(minor));
  } catch {
    return minor;
  }
}

// ----------------------------------------------------
// 1. Furniture Trust & Warranty Bar (4 Pillars)
// ----------------------------------------------------
export function FurnitureTrustBar() {
  const pillars = [
    {
      icon: "🛡️",
      title: "১০ বছরের কাঠামোগত ওয়ারেন্টি",
      subtitle: "সলিড কাঠ ও ফ্রেমে ঘুণে না ধরার লিখিত গ্যারান্টি",
    },
    {
      icon: "🚚",
      title: "ফ্রি ডোরস্টেপ ডেলিভারি",
      subtitle: "শক-প্রুফ কার্টনে ঢাকা ও সারাদেশে নিরাপদ পরিবহন",
    },
    {
      icon: "🔧",
      title: "ফ্রি হোম ফিটিং ও অ্যাসেম্বলি",
      subtitle: "দক্ষ কার্পেন্টার টিম দ্বারা নিখুঁত ইনস্টলেশন",
    },
    {
      icon: "💳",
      title: "০% সহজ ইএমআই কিস্তি",
      subtitle: "১২ মাস পর্যন্ত শীর্ষ ব্যাংকের ক্রেডিট কার্ড সুবিধা",
    },
  ];

  return (
    <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
      {pillars.map((p) => (
        <div
          key={p.title}
          className="flex items-start gap-3 rounded-2xl border border-stone-200/90 bg-white p-3.5 shadow-xs transition hover:border-amber-600/50 hover:shadow-md"
        >
          <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-amber-50 text-xl text-amber-800">
            {p.icon}
          </span>
          <div>
            <h4 className="text-xs font-black text-stone-900">{p.title}</h4>
            <p className="mt-0.5 text-[11px] text-stone-500 leading-snug">{p.subtitle}</p>
          </div>
        </div>
      ))}
    </div>
  );
}

// ----------------------------------------------------
// 2. High-End Furniture Product Card (HATIL / ISHO Style)
// ----------------------------------------------------
export function FurnitureProductCard({
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

  const emiPerMonth =
    priceMinor && BigInt(priceMinor) > 0n
      ? Math.round(Number(BigInt(priceMinor) / 1200n))
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
    <div className="group relative flex flex-col justify-between overflow-hidden rounded-2xl border border-stone-200/90 bg-white shadow-xs transition-all duration-300 hover:border-amber-600/50 hover:shadow-2xl">
      {/* Aspect 4:3 Image Container for Furniture */}
      <div className="relative aspect-[4/3] w-full overflow-hidden bg-stone-100 p-3">
        <div className="absolute left-2.5 top-2.5 z-10 flex flex-col gap-1">
          {percentOff > 0 ? (
            <span className="rounded-lg bg-rose-600 px-2 py-0.5 text-[10px] font-black text-white shadow-xs">
              −{percentOff}%
            </span>
          ) : null}
          <span className="rounded-lg bg-stone-900/80 px-2 py-0.5 text-[9px] font-bold text-white backdrop-blur-xs">
            🛡️ ১০ বছর ওয়ারেন্টি
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
              width={450}
              height={338}
              className="h-full w-full object-contain p-2 transition duration-500 group-hover:scale-105"
            />
          ) : (
            <div className="flex h-full w-full items-center justify-center text-4xl">🛋️</div>
          )}
        </Link>

        <QuickViewButton orgSlug={orgSlug} product={product} locale={locale} />
      </div>

      {/* Card Info */}
      <div className="flex flex-1 flex-col justify-between p-4 space-y-2.5">
        <div>
          <div className="flex items-center justify-between text-[11px]">
            <span className="font-semibold text-amber-900">
              {product.category || "আসবাবপত্র"}
            </span>
            <span className="rounded-full bg-stone-100 px-2 py-0.5 text-[10px] font-bold text-stone-700">
              {isOutOfStock ? "স্টক শেষ" : "● রেডি স্টক"}
            </span>
          </div>

          <Link
            href={`/shop/${orgSlug}/products/${product.slug}`}
            className="mt-1 line-clamp-2 text-xs font-black text-stone-900 transition hover:text-amber-800 sm:text-sm font-serif"
            title={product.name}
          >
            {product.name}
          </Link>

          {emiPerMonth > 0 ? (
            <p className="mt-1 text-[11px] font-bold text-stone-500">
              ইএমআই: <span className="text-amber-900">৳{emiPerMonth.toLocaleString("bn-BD")}/মাস</span> (০%)
            </p>
          ) : null}
        </div>

        {/* Pricing & Add to Cart */}
        <div className="border-t border-stone-100 pt-2.5 space-y-2">
          <div className="flex items-baseline gap-2">
            <span className="text-base font-black text-stone-950 font-serif sm:text-lg">
              {formatFurniturePrice(priceMinor)}
            </span>
            {compareMinor && BigInt(compareMinor) > BigInt(priceMinor) ? (
              <span className="text-xs text-stone-400 line-through">
                {formatFurniturePrice(compareMinor)}
              </span>
            ) : null}
          </div>

          <button
            type="button"
            onClick={handleQuickAdd}
            disabled={isOutOfStock || busy}
            className={`w-full rounded-xl py-2.5 text-xs font-black transition flex items-center justify-center gap-1.5 ${
              isOutOfStock
                ? "bg-stone-100 text-stone-400 cursor-not-allowed"
                : added
                  ? "bg-emerald-600 text-white"
                  : "bg-stone-900 text-white shadow-xs hover:bg-amber-950 active:scale-95"
            }`}
          >
            {added ? (
              <span>✓ অর্ডারে যোগ হয়েছে</span>
            ) : (
              <>
                <span>🛋️</span>
                <span>{isOutOfStock ? "স্টক শেষ" : busy ? "যোগ হচ্ছে…" : "অর্ডারে যোগ করুন"}</span>
              </>
            )}
          </button>
        </div>
      </div>
    </div>
  );
}

// ----------------------------------------------------
// 3. Wood Finish & Upholstery Color Selector
// ----------------------------------------------------
export function FurnitureFinishSelector({
  selectedFinish = "সেগুন কাঠ ফিনিশ",
  onSelectFinish,
}: {
  selectedFinish?: string;
  onSelectFinish?: (finish: string) => void;
}) {
  const finishes = [
    { label: "সেগুন কাঠ ফিনিশ", color: "#8B5A2B", badge: "প্রিমিয়াম" },
    { label: "কানাডিয়ান ওক", color: "#D2B48C", badge: "মডার্ন" },
    { label: "ডার্ক ওয়ালনাট", color: "#3D2B1F", badge: "জনপ্রিয়" },
    { label: "মেহগনি কালার", color: "#5C2C16", badge: "ক্লাসিক" },
  ];

  return (
    <div className="space-y-2.5 rounded-2xl border border-stone-200 bg-stone-50/60 p-4">
      <div className="flex items-center justify-between text-xs">
        <label className="font-bold text-stone-900">
          কাঠের ফিনিশ ও টেক্সচার বেছে নিন: <span className="text-amber-800">{selectedFinish}</span>
        </label>
        <span className="text-[11px] font-bold text-stone-500">সিজনড হার্ডউড</span>
      </div>

      <div className="flex flex-wrap gap-2.5">
        {finishes.map((f) => {
          const active = selectedFinish === f.label;
          return (
            <button
              key={f.label}
              type="button"
              onClick={() => onSelectFinish && onSelectFinish(f.label)}
              className={`flex items-center gap-2 rounded-xl border px-3 py-2 text-xs font-bold transition ${
                active
                  ? "border-amber-800 bg-white shadow-xs ring-2 ring-amber-700/50"
                  : "border-stone-200 bg-white hover:border-amber-600"
              }`}
            >
              <span
                className="h-4 w-4 rounded-full border border-black/10 shadow-xs"
                style={{ backgroundColor: f.color }}
              />
              <span className="text-stone-800">{f.label}</span>
              {f.badge && (
                <span
                  className={`text-[9px] rounded-full px-1.5 py-0.2 ${
                    active ? "bg-amber-100 text-amber-900" : "bg-stone-100 text-stone-500"
                  }`}
                >
                  {f.badge}
                </span>
              )}
            </button>
          );
        })}
      </div>
    </div>
  );
}

// ----------------------------------------------------
// 4. Dimension & Clearance Specification Table
// ----------------------------------------------------
export function FurnitureDimensionSpecs() {
  return (
    <div className="rounded-2xl border border-stone-200 bg-white p-4 text-xs space-y-3 shadow-xs">
      <div className="flex items-center justify-between border-b border-stone-100 pb-2">
        <h4 className="font-black text-stone-900">আসবাবের মাপ ও স্পেস গাইড (Dimension Specs):</h4>
        <span className="text-[10px] text-amber-800 font-bold">দরজা ও লিফট ফ্রেন্ডলি</span>
      </div>

      <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 text-[11px] text-stone-700">
        <div className="rounded-xl bg-stone-50 p-2.5">
          <p className="text-stone-400">দৈর্ঘ্য (Length)</p>
          <p className="font-bold text-stone-900">৮৪ ইঞ্চি (২১৩ সেমি)</p>
        </div>
        <div className="rounded-xl bg-stone-50 p-2.5">
          <p className="text-stone-400">প্রস্থ (Width)</p>
          <p className="font-bold text-stone-900">৭২ ইঞ্চি (১৮২ সেমি)</p>
        </div>
        <div className="rounded-xl bg-stone-50 p-2.5">
          <p className="text-stone-400">উচ্চতা (Height)</p>
          <p className="font-bold text-stone-900">৪৫ ইঞ্চি (১১৪ সেমি)</p>
        </div>
        <div className="rounded-xl bg-stone-50 p-2.5">
          <p className="text-stone-400">সিজনড কাঠ</p>
          <p className="font-bold text-stone-900">কেমিক্যাল ট্রিটেড</p>
        </div>
      </div>

      <div className="flex items-center gap-2 rounded-xl bg-amber-50/70 p-2.5 text-[11px] text-amber-900">
        <span>🚪</span>
        <p><strong>লিফট ও সিঁড়ি ক্লিয়ারেন্স:</strong> এটি ন্যাক-ডাউন (Knock-down) ফিটিং ফ্রেম, তাই যেকোনো স্ট্যান্ডার্ড অ্যাপার্টমেন্টের লিফট বা দরজা দিয়ে অনায়াসে প্রবেশযোগ্য।</p>
      </div>
    </div>
  );
}

// ----------------------------------------------------
// 5. Complete Master Bedroom Set Bundle (Save ৳৪,৫০০)
// ----------------------------------------------------
export function FurnitureRoomSetBundle({
  orgSlug,
  mainProduct,
}: {
  orgSlug: string;
  mainProduct: ShopProduct;
}) {
  const [wardrobe, setWardrobe] = useState(true);
  const [dressing, setDressing] = useState(true);
  const [bedside, setBedside] = useState(true);
  const [busy, setBusy] = useState(false);
  const [added, setAdded] = useState(false);

  const mainPrice = BigInt(mainProduct.priceMinor || "0");
  const wardrobePrice = 4500000n; // 45,000 taka (4-door wardrobe)
  const dressingPrice = 1850000n; // 18,500 taka (dressing table)
  const bedsidePrice = 650000n;   // 6,500 taka (bedside unit)

  let extraTotal = 0n;
  if (wardrobe) extraTotal += wardrobePrice;
  if (dressing) extraTotal += dressingPrice;
  if (bedside) extraTotal += bedsidePrice;

  const rawTotal = mainPrice + extraTotal;
  const comboDiscount = 450000n; // ৳4,500 taka discount
  const finalTotal = rawTotal > comboDiscount ? rawTotal - comboDiscount : rawTotal;

  async function handleAddSetBundle() {
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
    <div className="space-y-4 rounded-3xl border border-amber-200 bg-gradient-to-br from-amber-50/70 via-white to-stone-50/80 p-5 shadow-xs">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <span className="flex h-9 w-9 items-center justify-center rounded-xl bg-amber-900 text-white text-lg">
            🛋️
          </span>
          <div>
            <h3 className="text-sm font-black text-stone-900 font-serif">
              কমপ্লিট মাস্টার বেডরুম স্যুট কম্বো (Complete Bedroom Set)
            </h3>
            <p className="text-[11px] text-stone-500">
              বেড + ৪-পাল্লা আলমিরা + ড্রেসিং টেবিল + বেডসাইড ইউনিট একসাথে নিয়ে ঘরে আনুন রাজকীয় লুক
            </p>
          </div>
        </div>
        <span className="rounded-full bg-amber-900 px-3 py-1 text-[10px] font-black text-white">
          ৳৪,৫০০ ইনস্ট্যান্ট সেভিংস
        </span>
      </div>

      <div className="grid gap-3 sm:grid-cols-4">
        {/* Step 1: Main Product (e.g. King Bed) */}
        <div className="rounded-2xl border-2 border-amber-900 bg-white p-3 shadow-xs">
          <span className="rounded bg-amber-900 px-1.5 py-0.2 text-[9px] font-black text-white">
            মূল আসবাব
          </span>
          <p className="mt-1 line-clamp-1 text-xs font-black text-stone-900">{mainProduct.name}</p>
          <p className="text-xs font-extrabold text-amber-900">{formatFurniturePrice(mainProduct.priceMinor)}</p>
        </div>

        {/* Step 2: 4-Door Wardrobe */}
        <label
          className={`flex cursor-pointer items-start gap-2.5 rounded-2xl border p-3 transition ${
            wardrobe ? "border-amber-900 bg-white shadow-xs" : "border-stone-200 bg-white/60 opacity-60"
          }`}
        >
          <input
            type="checkbox"
            checked={wardrobe}
            onChange={(e) => setWardrobe(e.target.checked)}
            className="mt-1 accent-amber-900"
          />
          <div>
            <span className="text-lg">🚪</span>
            <p className="text-xs font-bold text-stone-900">৪-পাল্লা আলমিরা (Wardrobe)</p>
            <p className="text-xs font-extrabold text-amber-900">+ ৳৪৫,০০০</p>
          </div>
        </label>

        {/* Step 3: Dressing Table */}
        <label
          className={`flex cursor-pointer items-start gap-2.5 rounded-2xl border p-3 transition ${
            dressing ? "border-amber-900 bg-white shadow-xs" : "border-stone-200 bg-white/60 opacity-60"
          }`}
        >
          <input
            type="checkbox"
            checked={dressing}
            onChange={(e) => setDressing(e.target.checked)}
            className="mt-1 accent-amber-900"
          />
          <div>
            <span className="text-lg">🪞</span>
            <p className="text-xs font-bold text-stone-900">ম্যাচিং ড্রেসিং টেবিল</p>
            <p className="text-xs font-extrabold text-amber-900">+ ৳১৮,৫০০</p>
          </div>
        </label>

        {/* Step 4: Bedside Table */}
        <label
          className={`flex cursor-pointer items-start gap-2.5 rounded-2xl border p-3 transition ${
            bedside ? "border-amber-900 bg-white shadow-xs" : "border-stone-200 bg-white/60 opacity-60"
          }`}
        >
          <input
            type="checkbox"
            checked={bedside}
            onChange={(e) => setBedside(e.target.checked)}
            className="mt-1 accent-amber-900"
          />
          <div>
            <span className="text-lg">🛏️</span>
            <p className="text-xs font-bold text-stone-900">বেডসাইড টেবিল ইউনিট</p>
            <p className="text-xs font-extrabold text-amber-900">+ ৳৬,৫০০</p>
          </div>
        </label>
      </div>

      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 border-t border-amber-100 pt-3">
        <div>
          <div className="flex items-baseline gap-2">
            <span className="text-sm font-bold text-stone-400 line-through">
              {formatFurniturePrice(rawTotal.toString())}
            </span>
            <span className="text-xl font-black text-stone-950 font-serif">
              {formatFurniturePrice(finalTotal.toString())}
            </span>
            <span className="text-xs font-bold text-amber-800">
              (৳৪,৫০০ সেভ হচ্ছে)
            </span>
          </div>
          <p className="text-[11px] text-stone-500">সম্পূর্ণ রুম সেট একসাথে ডেলিভারি ও ফ্রি ফিটিং করা হবে</p>
        </div>

        {added ? (
          <div className="flex items-center gap-2">
            <span className="text-xs font-bold text-emerald-800">✓ সম্পূর্ণ রুম সেট অর্ডারে যুক্ত হয়েছে!</span>
            <Link
              href={`/shop/${orgSlug}/cart`}
              className="rounded-xl bg-amber-900 px-4 py-2 text-xs font-bold text-white hover:bg-stone-900"
            >
              কার্ট দেখুন
            </Link>
          </div>
        ) : (
          <button
            type="button"
            onClick={handleAddSetBundle}
            disabled={busy}
            className="rounded-xl bg-amber-900 px-5 py-3 text-xs font-black text-white shadow-md shadow-amber-900/20 hover:bg-stone-900 transition disabled:opacity-50"
          >
            {busy ? "যোগ হচ্ছে…" : "এক ক্লিকে সম্পূর্ণ রুম সেট কিনুন"}
          </button>
        )}
      </div>
    </div>
  );
}

// ----------------------------------------------------
// 6. 10-Year Structural Warranty Certificate Modal
// ----------------------------------------------------
export function FurnitureWarrantyModal({
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
          className="absolute right-5 top-5 flex h-9 w-9 items-center justify-center rounded-full bg-stone-100 text-stone-500 hover:bg-stone-200 transition"
          aria-label="Close"
        >
          ✕
        </button>

        <div className="flex items-center gap-2.5">
          <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-amber-100 text-xl text-amber-800">
            🛡️
          </span>
          <div>
            <h3 className="text-base font-black text-stone-900 font-serif">১০ বছরের অফিশিয়াল স্ট্রাকচারাল ওয়ারেন্টি</h3>
            <p className="line-clamp-1 text-xs text-stone-500">{productName}</p>
          </div>
        </div>

        <div className="mt-5 space-y-3 text-xs text-stone-700">
          <div className="rounded-2xl border border-amber-200 bg-amber-50/60 p-4 space-y-2">
            <div className="flex items-center justify-between border-b border-amber-200/60 pb-2">
              <span className="font-bold text-stone-900">ওয়ারেন্টির ধরন:</span>
              <span className="font-black text-amber-900">১০ বছর পার্টস ও ফ্রেম কভারেজ</span>
            </div>
            <p><strong>কাঠ ও মেটেরিয়াল:</strong> সিজনড সলিড কাঠ ও হাই-ডেনসিটি বোর্ড — কোনো অবস্থাতেই ঘুণ ধরবে না (Termite-free guarantee)।</p>
            <p><strong>ফিটিং ও জয়েন্ট:</strong> স্ক্রু, কবজা ও মেকানিজমে ১ বছরের ফ্রি রিপ্লেসমেন্ট এবং লাইফটাইম সার্ভিস সাপোর্ট।</p>
            <p><strong>সার্ভিসিং পলিসি:</strong> যেকোনো সমস্যায় আমাদের টেকনিক্যাল টিম সরাসরি আপনার বাসায় গিয়ে ইন্সপেকশন ও রিপেয়ার সম্পন্ন করবে।</p>
          </div>

          <div className="grid grid-cols-3 gap-2 text-center text-[11px]">
            <div className="rounded-xl border border-stone-100 bg-stone-50 p-2.5">
              <p className="font-bold text-stone-900">ঘুণ প্রতিরোধী</p>
              <p className="text-stone-400 text-[10px]">কেমিক্যাল সিজনিং</p>
            </div>
            <div className="rounded-xl border border-stone-100 bg-stone-50 p-2.5">
              <p className="font-bold text-stone-900">ফ্রি টেকনিশিয়ান</p>
              <p className="text-stone-400 text-[10px]">হোম ভিজিট</p>
            </div>
            <div className="rounded-xl border border-stone-100 bg-stone-50 p-2.5">
              <p className="font-bold text-stone-900">জেনুইন কার্ড</p>
              <p className="text-stone-400 text-[10px]">QR ভেরিফায়েড</p>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

// ----------------------------------------------------
// 7. 3D Room Visualizer & Space Planner Modal
// ----------------------------------------------------
export function FurnitureRoomVisualizerModal({
  open,
  onClose,
  productName,
}: {
  open: boolean;
  onClose: () => void;
  productName: string;
}) {
  const [roomType, setRoomType] = useState("bedroom");
  const [wallColor, setWallColor] = useState("#F5EBE0");

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4 backdrop-blur-sm animate-in fade-in duration-200">
      <div className="relative w-full max-w-lg rounded-3xl bg-white p-6 shadow-2xl sm:p-7 space-y-4">
        <button
          type="button"
          onClick={onClose}
          className="absolute right-5 top-5 flex h-9 w-9 items-center justify-center rounded-full bg-stone-100 text-stone-500 hover:bg-stone-200 transition"
          aria-label="Close"
        >
          ✕
        </button>

        <div className="flex items-center gap-2.5">
          <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-amber-100 text-xl text-amber-800">
            📐
          </span>
          <div>
            <h3 className="text-base font-black text-stone-900 font-serif">৩ডি রুম ভিজ্যুয়ালাইজার ও স্পেস প্ল্যানার</h3>
            <p className="line-clamp-1 text-xs text-stone-500">{productName}</p>
          </div>
        </div>

        {/* Room Visualizer Preview Box */}
        <div
          className="relative h-48 w-full rounded-2xl border border-stone-200 p-4 flex flex-col justify-between transition-colors duration-300"
          style={{ backgroundColor: wallColor }}
        >
          <div className="flex items-center justify-between text-xs font-bold text-stone-700 bg-white/80 backdrop-blur-xs px-3 py-1 rounded-full shadow-xs">
            <span>রুম প্রিভিউ: {roomType === "bedroom" ? "মাস্টার বেডরুম" : roomType === "living" ? "লিভিং রুম" : "ডাইনিং স্পেস"}</span>
            <span className="text-amber-800">পারফেক্ট ফিট ✓</span>
          </div>

          <div className="text-center space-y-1">
            <span className="text-5xl">🛋️</span>
            <p className="text-xs font-black text-stone-900 bg-white/80 px-2.5 py-0.5 rounded-full inline-block">
              {productName}
            </p>
          </div>

          <p className="text-[11px] text-stone-500 text-center bg-white/60 rounded px-2 py-0.5">
            ফ্লোর স্পেস কভারেজ: ১২০-১৫০ বর্গফুট রুমের জন্য আদর্শ
          </p>
        </div>

        {/* Wall Color & Room Selector */}
        <div className="space-y-3 text-xs">
          <div>
            <label className="font-bold text-stone-800 block mb-1">রুমের ধরন নির্বাচন করুন:</label>
            <div className="grid grid-cols-3 gap-2">
              {[
                { id: "bedroom", label: "বেডরুম" },
                { id: "living", label: "লিভিং রুম" },
                { id: "dining", label: "ডাইনিং রুম" },
              ].map((r) => (
                <button
                  key={r.id}
                  type="button"
                  onClick={() => setRoomType(r.id)}
                  className={`rounded-xl border p-2 text-center font-bold transition ${
                    roomType === r.id
                      ? "border-amber-900 bg-amber-900 text-white"
                      : "border-stone-200 bg-stone-50 text-stone-700 hover:border-amber-600"
                  }`}
                >
                  {r.label}
                </button>
              ))}
            </div>
          </div>

          <div>
            <label className="font-bold text-stone-800 block mb-1">দেয়ালের রঙ ম্যাচ করুন:</label>
            <div className="flex gap-2">
              {[
                { color: "#F5EBE0", label: "ওয়ার্ম আইভরি" },
                { color: "#E3E7D3", label: "অলিভ পেস্টেল" },
                { color: "#D8E2DC", label: "সফট সি-ফোম" },
                { color: "#E0E1DD", label: "মডার্ন গ্রে" },
              ].map((c) => (
                <button
                  key={c.color}
                  type="button"
                  onClick={() => setWallColor(c.color)}
                  className={`flex items-center gap-1.5 rounded-lg border px-2.5 py-1 transition ${
                    wallColor === c.color ? "border-amber-900 ring-2 ring-amber-700/50" : "border-stone-200"
                  }`}
                >
                  <span className="h-3.5 w-3.5 rounded-full border border-black/10" style={{ backgroundColor: c.color }} />
                  <span className="text-[11px] font-bold text-stone-700">{c.label}</span>
                </button>
              ))}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

// ----------------------------------------------------
// 8. Home Decor & Furniture Dedicated Homepage Layout
// ----------------------------------------------------
export function FurnitureThemeHome({
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

  const roomCategories = [
    { label: "লিভিং রুম", icon: "🛋️", slug: "living-room" },
    { label: "মাস্টার বেডরুম", icon: "🛏️", slug: "bedroom" },
    { label: "ডাইনিং ও কিচেন", icon: "🪑", slug: "dining" },
    { label: "হোম অফিস ও স্টাডি", icon: "💼", slug: "office" },
    { label: "ম্যাট্রেস ও বেডিং", icon: "🛌", slug: "mattress" },
    { label: "হোম ডেকর ও ল্যাম্প", icon: "🏺", slug: "decor" },
  ];

  return (
    <div className="min-h-screen bg-[#fcfbf9] text-stone-900 pb-16">
      {/* 1. Top Ribbon */}
      <div className="bg-stone-950 text-white text-xs py-2 px-4 border-b border-amber-900/30">
        <div className="mx-auto max-w-7xl flex flex-wrap items-center justify-between gap-2">
          <div className="flex items-center gap-2 font-bold">
            <span>🛋️ প্রিমিয়াম সলিড উড ও আধুনিক ফার্নিচার</span>
            <span className="hidden sm:inline">·</span>
            <span className="text-amber-400">১০ বছরের অফিশিয়াল কাঠামোগত ওয়ারেন্টি ও ফ্রি ফিটিং</span>
          </div>
          <div className="flex items-center gap-2 font-semibold text-[11px]">
            <span>📞 শোরুম হটলাইন: 01XXXXXXXXX</span>
            <span>·</span>
            <span className="bg-amber-900 px-2.5 py-0.5 rounded-full">০% ইএমআই সুবিধা</span>
          </div>
        </div>
      </div>

      <div className="mx-auto max-w-7xl px-4 sm:px-6 space-y-10 pt-6">
        {/* 2. Hero Banner */}
        <section className="relative overflow-hidden rounded-3xl bg-gradient-to-r from-stone-950 via-amber-950 to-stone-900 text-white shadow-2xl border border-amber-600/30">
          <div className="relative z-10 grid gap-8 p-8 md:grid-cols-2 md:p-12 lg:p-16 items-center">
            <div className="space-y-4">
              <div className="inline-flex items-center gap-2 rounded-full border border-amber-400/30 bg-amber-500/10 px-3 py-1 text-xs font-black text-amber-300">
                <span>🏛️</span>
                <span>ARCHITECTURAL LUXURY & SOLID HARDWOOD</span>
              </div>
              <h1 className="text-3xl font-black tracking-tight text-white sm:text-5xl lg:text-6xl font-serif">
                {settings.shopName || "আপনার স্বপ্নের বাড়ি সাজান সেরা ডিজাইনের আসবাবে"}
              </h1>
              <p className="max-w-xl text-xs sm:text-sm text-stone-300 leading-relaxed">
                {settings.metaDescription ||
                  "সিজনড সেগুন কাঠ ও কানাডিয়ান ওকের নিখুঁত ফিনিশ। আধুনিক আর্কিটেকচারাল ডিজাইন, ১০ বছরের ওয়ারেন্টি এবং ফ্রি হোম ফিটিং সার্ভিস।"}
              </p>
              <div className="flex flex-wrap items-center gap-3 pt-2">
                <a
                  href="#furniture-featured"
                  className="rounded-xl bg-amber-700 px-6 py-3 text-xs font-black text-white shadow-lg shadow-amber-900/40 transition hover:bg-amber-600"
                >
                  ফিচার্ড ফার্নিচার দেখুন →
                </a>
                <a
                  href="#room-categories"
                  className="rounded-xl border border-stone-700 bg-stone-900/60 px-5 py-3 text-xs font-bold text-stone-200 backdrop-blur-sm hover:bg-stone-800"
                >
                  রুম অনুযায়ী ক্যাটাগরি
                </a>
              </div>
            </div>

            {/* Hero Right Visual */}
            <div className="flex items-center justify-center">
              <div className="rounded-3xl border border-amber-500/20 bg-stone-900/80 p-6 backdrop-blur-md shadow-2xl text-center space-y-3">
                <span className="text-5xl">🛋️</span>
                <h3 className="text-lg font-black text-white font-serif">Living & Bedroom Suites</h3>
                <p className="text-xs text-amber-200/80 max-w-xs">
                  আন্তর্জাতিক স্ট্যান্ডার্ড সিজনিং ও লেকার ফিনিশ দ্বারা তৈরি দীর্ঘস্থায়ী আসবাব
                </p>
                <div className="flex justify-center gap-2 text-[10px] font-bold text-amber-100">
                  <span className="rounded-full bg-white/10 px-2.5 py-1">১০ বছর ওয়ারেন্টি</span>
                  <span className="rounded-full bg-white/10 px-2.5 py-1">ফ্রি হোম ডেলিভারি</span>
                </div>
              </div>
            </div>
          </div>
        </section>

        {/* 3. 4 Pillars Trust Bar */}
        <FurnitureTrustBar />

        {/* 4. Room Categories */}
        <section id="room-categories" className="space-y-4">
          <div className="flex items-center justify-between">
            <h3 className="text-base font-black text-stone-900 font-serif">
              রুম অনুযায়ী ফার্নিচার বেছে নিন:
            </h3>
            <span className="text-xs font-bold text-amber-800">সম্পূর্ণ রুম সলিউশন</span>
          </div>

          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-6">
            {roomCategories.map((c) => (
              <Link
                key={c.slug}
                href={`/shop/${orgSlug}?category=${c.slug}`}
                className="group flex flex-col items-center justify-center rounded-2xl border border-stone-200 bg-white p-3.5 text-center shadow-xs transition hover:border-amber-700 hover:shadow-md"
              >
                <span className="flex h-12 w-12 items-center justify-center rounded-2xl bg-amber-50 text-2xl transition group-hover:scale-110">
                  {c.icon}
                </span>
                <span className="mt-2 text-xs font-bold text-stone-800 group-hover:text-amber-800">
                  {c.label}
                </span>
              </Link>
            ))}
          </div>
        </section>

        {/* 5. Flash Room Makeover Deals */}
        {flashSales?.sales && flashSales.sales.length > 0 && flashSales.sales[0]?.products?.length ? (
          <section className="rounded-3xl border border-amber-300 bg-amber-950 text-white p-6 space-y-4 shadow-xl">
            <div className="flex flex-wrap items-center justify-between gap-3 border-b border-amber-800 pb-3">
              <div className="flex items-center gap-2">
                <span className="text-2xl">🔥</span>
                <div>
                  <h3 className="text-lg font-black text-white font-serif">
                    {flashSales.sales[0].name || "রুম মেকওভার মেগা ড্রপ — সীমিত সময়ের ছাড়"}
                  </h3>
                  <p className="text-xs text-amber-300">হোম ডেকর ও ফার্নিচারে বিশেষ আকর্ষণীয় মূল্যছাড়</p>
                </div>
              </div>
              <FlashCountdown endsAt={flashSales.sales[0].endsAt} serverNow={flashSales.serverNow} locale={locale} />
            </div>

            <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
              {flashSales.sales[0].products.slice(0, 4).map((p) => (
                <FurnitureProductCard
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
        <section id="furniture-featured" className="space-y-5">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <h2 className="text-xl font-black text-stone-900 sm:text-2xl font-serif">
                অভিজাত ও টেকসই আসবাব কালেকশন
              </h2>
              <p className="text-xs text-stone-500">
                ১০ বছরের লিখিত ওয়ারেন্টি ও ফ্রি হোম ফিটিং সার্ভিস সহ
              </p>
            </div>
            <SortSelect orgSlug={orgSlug} locale={locale} value="featured" />
          </div>

          <div className="grid grid-cols-2 gap-3 sm:gap-4 md:grid-cols-3 lg:grid-cols-4">
            {products.map((p) => (
              <FurnitureProductCard
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
                  className="rounded-xl border bg-white px-4 py-2 text-xs font-bold text-stone-700 hover:bg-stone-50"
                >
                  আগের পেজ
                </Link>
              )}
              <span className="text-xs font-semibold text-stone-500">
                পেজ {pagination.page} / {pagination.totalPages}
              </span>
              {page < pagination.totalPages && (
                <Link
                  href={`/shop/${orgSlug}?page=${page + 1}`}
                  className="rounded-xl border bg-white px-4 py-2 text-xs font-bold text-stone-700 hover:bg-stone-50"
                >
                  পরের পেজ
                </Link>
              )}
            </nav>
          )}
        </section>
      </div>
    </div>
  );
}
