"use client";
import React, { useState } from "react";
import Link from "next/link";
import { fmtMoneyMinor, fmtNumber, formatMinor } from "@repo/contracts";
import { MediaImage } from "@/components/media-image";
import type { ShopHome, ShopProduct } from "@/lib/storefront-server";
import { type ShopLocale, shopT } from "@/lib/shop-i18n";
import { QuickViewButton } from "./QuickView";
import { WishlistHeart } from "./WishlistHeart";
import { FlashCountdown } from "./FlashCountdown";
import { SortSelect } from "./SortSelect";
import { patchCartLine, notifyCartUpdated } from "@/lib/storefront-cart";

export function formatGroceryPrice(minor: string): string {
  try {
    return formatMinor(BigInt(minor));
  } catch {
    return minor;
  }
}

// ----------------------------------------------------
// 1. Organic & Grocery Trust Bar
// ----------------------------------------------------
export function GroceryTrustBar({ locale = "bn" }: { locale?: ShopLocale | string } = {}) {
  const t = shopT(locale);
  return (
    <div className="grid grid-cols-2 gap-3 sm:grid-cols-4 sm:gap-4">
      <div className="flex items-center gap-3 rounded-2xl border border-emerald-100 bg-white p-3.5 shadow-xs transition hover:shadow-md">
        <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-emerald-50 text-xl text-emerald-600">
          ⚡
        </div>
        <div>
          <h4 className="text-xs font-black text-slate-900">{t.themeGrocery.trust1Title}</h4>
          <p className="text-[11px] text-slate-500">{t.themeGrocery.trust1Desc}</p>
        </div>
      </div>

      <div className="flex items-center gap-3 rounded-2xl border border-emerald-100 bg-white p-3.5 shadow-xs transition hover:shadow-md">
        <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-lime-50 text-xl text-lime-600">
          🌿
        </div>
        <div>
          <h4 className="text-xs font-black text-slate-900">{t.themeGrocery.trust2Title}</h4>
          <p className="text-[11px] text-slate-500">{t.themeGrocery.trust2Desc}</p>
        </div>
      </div>

      <div className="flex items-center gap-3 rounded-2xl border border-emerald-100 bg-white p-3.5 shadow-xs transition hover:shadow-md">
        <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-teal-50 text-xl text-teal-600">
          ❄️
        </div>
        <div>
          <h4 className="text-xs font-black text-slate-900">{t.themeGrocery.trust3Title}</h4>
          <p className="text-[11px] text-slate-500">{t.themeGrocery.trust3Desc}</p>
        </div>
      </div>

      <div className="flex items-center gap-3 rounded-2xl border border-emerald-100 bg-white p-3.5 shadow-xs transition hover:shadow-md">
        <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-amber-50 text-xl text-amber-600">
          🔄
        </div>
        <div>
          <h4 className="text-xs font-black text-slate-900">{t.themeGrocery.trust4Title}</h4>
          <p className="text-[11px] text-slate-500">{t.themeGrocery.trust4Desc}</p>
        </div>
      </div>
    </div>
  );
}

// ----------------------------------------------------
// 2. Chaldal-Style Product Card with Quantity Stepper
// ----------------------------------------------------
export function GroceryProductCard({
  orgSlug,
  product,
  locale = "bn",
}: {
  orgSlug: string;
  product: ShopProduct;
  locale?: ShopLocale | string;
}) {
  const t = shopT(locale);
  const [qty, setQty] = useState(0);
  const [busy, setBusy] = useState(false);

  const priceMinor = product.priceMinor || "0";
  const compareMinor = product.compareAtMinor;
  const isOutOfStock = product.stockState === "out_of_stock";

  async function updateQuantity(nextQty: number) {
    if (busy || isOutOfStock) return;
    setBusy(true);
    try {
      await patchCartLine(orgSlug, {
        productId: product.id,
        variantId: null,
        quantity: nextQty,
        includeBump: false,
      });
      setQty(nextQty);
      notifyCartUpdated(orgSlug);
    } catch {
      /* ignore */
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="group relative flex flex-col justify-between overflow-hidden rounded-2xl border border-emerald-100 bg-white shadow-xs transition-all duration-300 hover:border-emerald-500 hover:shadow-xl">
      {/* Top Badges & Image */}
      <div className="relative aspect-square w-full overflow-hidden bg-emerald-50/20 p-3">
        <div className="absolute left-2.5 top-2.5 z-10 flex flex-col gap-1">
          <span className="rounded-lg bg-emerald-600 px-2 py-0.5 text-[9px] font-black text-white shadow-xs">
            {t.themeGrocery.freshBadge}
          </span>
          {compareMinor && BigInt(compareMinor) > BigInt(priceMinor) && (
            <span className="rounded-lg bg-rose-600 px-2 py-0.5 text-[9px] font-black text-white shadow-xs">
              ছাড়
            </span>
          )}
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
            <div className="flex h-full w-full items-center justify-center text-4xl">🥬</div>
          )}
        </Link>

        <QuickViewButton orgSlug={orgSlug} product={product} locale={locale} />
      </div>

      {/* Card Info & Stepper */}
      <div className="flex flex-1 flex-col justify-between p-3.5 space-y-2.5">
        <div>
          <div className="flex items-center justify-between text-[11px]">
            <span className="font-semibold text-emerald-800">
              {product.category || t.themeGrocery.groceryFallback}
            </span>
            <span className="rounded bg-emerald-50 px-1.5 py-0.5 text-[10px] font-bold text-emerald-700">
              {t.themeGrocery.pack1kg}
            </span>
          </div>

          <Link
            href={`/shop/${orgSlug}/products/${product.slug}`}
            className="mt-1 line-clamp-2 text-xs font-black text-slate-900 transition hover:text-emerald-700 sm:text-sm"
            title={product.name}
          >
            {product.name}
          </Link>
        </div>

        {/* Pricing & Chaldal Quantity Stepper */}
        <div className="border-t border-emerald-50 pt-2.5 space-y-2">
          <div className="flex items-baseline gap-2">
            <span className="text-base font-black text-emerald-950 font-serif sm:text-lg">
              {formatGroceryPrice(priceMinor)}
            </span>
            {compareMinor ? (
              <span className="text-xs text-slate-400 line-through">
                {formatGroceryPrice(compareMinor)}
              </span>
            ) : null}
          </div>

          {/* Quantity Stepper (Chaldal Style) */}
          {qty > 0 ? (
            <div className="flex items-center justify-between rounded-xl border border-emerald-600 bg-emerald-50 px-2 py-1">
              <button
                type="button"
                onClick={() => updateQuantity(qty - 1)}
                disabled={busy}
                className="flex h-7 w-7 items-center justify-center rounded-lg bg-white font-black text-emerald-800 shadow-xs hover:bg-emerald-100 disabled:opacity-50"
              >
                −
              </button>
              <span className="text-xs font-black text-emerald-950">{fmtNumber(locale === "en" ? "en" : "bn", qty)}{t.themeGrocery.inBagSuffix}</span>
              <button
                type="button"
                onClick={() => updateQuantity(qty + 1)}
                disabled={busy}
                className="flex h-7 w-7 items-center justify-center rounded-lg bg-emerald-600 font-black text-white shadow-xs hover:bg-emerald-700 disabled:opacity-50"
              >
                +
              </button>
            </div>
          ) : (
            <button
              type="button"
              onClick={() => updateQuantity(1)}
              disabled={isOutOfStock || busy}
              className={`w-full rounded-xl py-2 text-xs font-black transition flex items-center justify-center gap-1.5 ${
                isOutOfStock
                  ? "bg-slate-100 text-slate-400 cursor-not-allowed"
                  : "bg-emerald-600 text-white shadow-xs hover:bg-emerald-700"
              }`}
            >
              <span>+</span>
              <span>{isOutOfStock ? t.themeGrocery.outOfStock : busy ? t.themeGrocery.adding : t.themeGrocery.addToBag}</span>
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

// ----------------------------------------------------
// 3. Weight / Pack Size Selector Pills
// ----------------------------------------------------
export function GroceryWeightSelector({
  selectedWeight = "১ কেজি",
  onSelectWeight,
  locale = "bn",
}: {
  selectedWeight?: string;
  onSelectWeight?: (w: string) => void;
  locale?: ShopLocale | string;
}) {
  const t = shopT(locale);
  const packs = [
    { label: "২৫০ গ্রাম", discount: null },
    { label: "৫০০ গ্রাম", discount: null },
    { label: "১ কেজি", discount: t.themeGrocery.badgePopular },
    { label: "২ কেজি", discount: "৳২০ ছাড়" },
    { label: "৫ কেজি", discount: "৳৬০ ছাড়" },
  ];

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between">
        <label className="text-xs font-bold text-slate-800">{t.themeGrocery.weightLabel}</label>
        <span className="text-[11px] text-emerald-700 font-bold">{t.themeGrocery.weightNote}</span>
      </div>

      <div className="flex flex-wrap gap-2">
        {packs.map((p) => {
          const active = selectedWeight === p.label;
          return (
            <button
              key={p.label}
              type="button"
              onClick={() => onSelectWeight && onSelectWeight(p.label)}
              className={`relative rounded-xl border px-3.5 py-2 text-xs font-bold transition ${
                active
                  ? "border-emerald-600 bg-emerald-600 text-white shadow-sm"
                  : "border-slate-200 bg-white text-slate-800 hover:border-emerald-600"
              }`}
            >
              <span>{p.label}</span>
              {p.discount && (
                <span
                  className={`ml-1 text-[9px] rounded-full px-1.5 py-0.2 ${
                    active ? "bg-white/20 text-white" : "bg-emerald-100 text-emerald-800"
                  }`}
                >
                  {p.discount}
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
// 4. Monthly Family Bazar Bundle (Save ৳250)
// ----------------------------------------------------
export function GroceryMonthlyBazarBundle({
  orgSlug,
  mainProduct,
  locale = "bn",
}: {
  orgSlug: string;
  mainProduct: ShopProduct;
  locale?: ShopLocale | string;
}) {
  const t = shopT(locale);
  const [rice, setRice] = useState(true);
  const [oil, setOil] = useState(true);
  const [dal, setDal] = useState(true);
  const [salt, setSalt] = useState(true);
  const [busy, setBusy] = useState(false);
  const [added, setAdded] = useState(false);

  const mainPrice = BigInt(mainProduct.priceMinor || "0");
  const oilPrice = 89000n;   // 890 taka (5L Oil)
  const dalPrice = 28000n;   // 280 taka (2kg Dal)
  const saltPrice = 4500n;   // 45 taka (1kg Salt)

  let extraTotal = 0n;
  if (oil) extraTotal += oilPrice;
  if (dal) extraTotal += dalPrice;
  if (salt) extraTotal += saltPrice;

  const rawTotal = mainPrice + extraTotal;
  const comboDiscount = 25000n; // ৳250 taka discount
  const finalTotal = rawTotal > comboDiscount ? rawTotal - comboDiscount : rawTotal;

  async function handleAddBazarBundle() {
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
    <div className="space-y-4 rounded-3xl border border-emerald-200 bg-gradient-to-br from-emerald-50/70 via-white to-lime-50/40 p-5 shadow-xs">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <span className="flex h-9 w-9 items-center justify-center rounded-xl bg-emerald-600 text-white text-lg">
            🧺
          </span>
          <div>
            <h3 className="text-sm font-black text-slate-900">{t.themeGrocery.comboTitle}</h3>
            <p className="text-[11px] text-slate-500">{t.themeGrocery.comboSub.replace("{price}", fmtMoneyMinor(locale === "en" ? "en" : "bn", 25000))}</p>
          </div>
        </div>
        <span className="rounded-full bg-emerald-600 px-3 py-1 text-[10px] font-black text-white">
          ৳২৫০ ইনস্ট্যান্ট ছাড়
        </span>
      </div>

      <div className="grid gap-3 sm:grid-cols-4">
        {/* Main Product (e.g. 5kg Rice) */}
        <div className="rounded-2xl border border-emerald-600 bg-white p-3 shadow-xs">
          <span className="rounded bg-emerald-600 px-1.5 py-0.5 text-[9px] font-bold text-white">
            {t.themeGrocery.comboMain}
          </span>
          <p className="mt-2 line-clamp-1 text-xs font-black text-slate-900">{mainProduct.name}</p>
          <p className="text-xs font-extrabold text-emerald-700">{formatGroceryPrice(mainProduct.priceMinor)}</p>
        </div>

        {/* 5L Oil */}
        <label
          className={`flex cursor-pointer items-start gap-2.5 rounded-2xl border p-3 transition ${
            oil ? "border-emerald-600 bg-white shadow-xs" : "border-slate-200 bg-white/60 opacity-60"
          }`}
        >
          <input type="checkbox" checked={oil} onChange={(e) => setOil(e.target.checked)} className="mt-1 accent-emerald-600" />
          <div>
            <span className="text-lg">🫒</span>
            <p className="text-xs font-bold text-slate-900">খাঁটি তেল (৫ লিটার)</p>
            <p className="text-xs font-extrabold text-emerald-700">+ ৳৮৯০</p>
          </div>
        </label>

        {/* 2kg Dal */}
        <label
          className={`flex cursor-pointer items-start gap-2.5 rounded-2xl border p-3 transition ${
            dal ? "border-emerald-600 bg-white shadow-xs" : "border-slate-200 bg-white/60 opacity-60"
          }`}
        >
          <input type="checkbox" checked={dal} onChange={(e) => setDal(e.target.checked)} className="mt-1 accent-emerald-600" />
          <div>
            <span className="text-lg">🌾</span>
            <p className="text-xs font-bold text-slate-900">দেশি মসুর ডাল (২ কেজি)</p>
            <p className="text-xs font-extrabold text-emerald-700">+ ৳২৮০</p>
          </div>
        </label>

        {/* 1kg Salt */}
        <label
          className={`flex cursor-pointer items-start gap-2.5 rounded-2xl border p-3 transition ${
            salt ? "border-emerald-600 bg-white shadow-xs" : "border-slate-200 bg-white/60 opacity-60"
          }`}
        >
          <input type="checkbox" checked={salt} onChange={(e) => setSalt(e.target.checked)} className="mt-1 accent-emerald-600" />
          <div>
            <span className="text-lg">🧂</span>
            <p className="text-xs font-bold text-slate-900">ভ্যাকুয়াম লবণ (১ কেজি)</p>
            <p className="text-xs font-extrabold text-emerald-700">+ ৳৪৫</p>
          </div>
        </label>
      </div>

      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 border-t border-emerald-100 pt-3">
        <div>
          <div className="flex items-baseline gap-2">
            <span className="text-sm font-bold text-slate-400 line-through">
              {formatGroceryPrice(rawTotal.toString())}
            </span>
            <span className="text-xl font-black text-emerald-950 font-serif">
              {formatGroceryPrice(finalTotal.toString())}
            </span>
            <span className="text-xs font-bold text-emerald-700">
              (৳২৫০ সেভ হচ্ছে)
            </span>
          </div>
          <p className="text-[11px] text-slate-500">{t.themeGrocery.comboNote}</p>
        </div>

        {added ? (
          <div className="flex items-center gap-2">
            <span className="text-xs font-bold text-emerald-800">{t.themeGrocery.comboAdded}</span>
            <Link
              href={`/shop/${orgSlug}/cart`}
              className="rounded-xl bg-emerald-600 px-4 py-2 text-xs font-bold text-white hover:bg-emerald-700"
            >
              {t.themeGrocery.viewCart}
            </Link>
          </div>
        ) : (
          <button
            type="button"
            onClick={handleAddBazarBundle}
            disabled={busy}
            className="rounded-xl bg-emerald-600 px-5 py-3 text-xs font-black text-white shadow-md shadow-emerald-600/20 hover:bg-emerald-700 transition disabled:opacity-50"
          >
            {busy ? t.themeGrocery.comboBusy : t.themeGrocery.comboBuy}
          </button>
        )}
      </div>
    </div>
  );
}

// ----------------------------------------------------
// 5. Organic Purity Lab Test Certificate Modal
// ----------------------------------------------------
export function GroceryPurityCertModal({
  open,
  onClose,
  productName,
  source = "সুন্দরবনের প্রাকৃতিক চাক ও নাটোরের ঘানি",
  locale = "bn",
}: {
  open: boolean;
  onClose: () => void;
  productName: string;
  source?: string;
  locale?: ShopLocale | string;
}) {
  const t = shopT(locale);
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
          <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-emerald-100 text-xl text-emerald-700">
            🌿
          </span>
          <div>
            <h3 className="text-base font-black text-slate-900">{t.themeGrocery.purityTitle}</h3>
            <p className="line-clamp-1 text-xs text-slate-500">{productName}</p>
          </div>
        </div>

        <div className="mt-5 space-y-3.5 text-xs text-slate-700">
          <div className="rounded-2xl border border-emerald-200 bg-emerald-50/70 p-4 space-y-2">
            <div className="flex items-center justify-between border-b border-emerald-200/60 pb-2">
              <span className="font-bold text-emerald-950">{t.themeGrocery.purityScoreLabel}</span>
              <span className="font-black text-emerald-700 text-sm">{t.themeGrocery.purityScoreValue}</span>
            </div>
            <p><strong>{t.themeGrocery.sourcePrefix}</strong> {source}</p>
            <p><strong>{t.themeGrocery.labPrefix}</strong> ০% ইউরিয়া, ০% প্যারাফিন, ০% প্রিজারভেটিভ বা ক্ষতিকর রঙ।</p>
            <p><strong>{t.themeGrocery.bstiPrefix}</strong> BSTI & বাংলাদেশ ফুড সেফটি স্ট্যান্ডার্ড কমপ্লায়েন্ট।</p>
          </div>

          <div className="grid grid-cols-3 gap-2 text-center text-[11px]">
            <div className="rounded-xl border border-slate-100 bg-slate-50 p-2.5">
              <p className="font-bold text-slate-900">{t.themeGrocery.feat1Title}</p>
              <p className="text-slate-400 text-[10px]">{t.themeGrocery.feat1Sub}</p>
            </div>
            <div className="rounded-xl border border-slate-100 bg-slate-50 p-2.5">
              <p className="font-bold text-slate-900">{t.themeGrocery.feat2Title}</p>
              <p className="text-slate-400 text-[10px]">{t.themeGrocery.feat2Sub}</p>
            </div>
            <div className="rounded-xl border border-slate-100 bg-slate-50 p-2.5">
              <p className="font-bold text-slate-900">{t.themeGrocery.feat3Title}</p>
              <p className="text-slate-400 text-[10px]">{t.themeGrocery.feat3Sub}</p>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

// ----------------------------------------------------
// 6. Nutrition Facts Table
// ----------------------------------------------------
export function GroceryNutritionFacts({ locale = "bn" }: { locale?: ShopLocale | string } = {}) {
  const t = shopT(locale);
  return (
    <div className="rounded-2xl border border-slate-200 bg-white p-4 text-xs space-y-2.5 shadow-xs">
      <div className="flex items-center justify-between border-b border-slate-100 pb-2">
        <h4 className="font-black text-slate-900">{t.themeGrocery.nutritionHeading}</h4>
        <span className="text-[10px] text-emerald-700 font-bold">{t.themeGrocery.labVerified}</span>
      </div>
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 text-[11px] text-slate-700">
        <div className="rounded-lg bg-slate-50 p-2">
          <p className="text-slate-400">শক্তি (Energy)</p>
          <p className="font-bold text-slate-900">৩২০ ক্যালোরি</p>
        </div>
        <div className="rounded-lg bg-slate-50 p-2">
          <p className="text-slate-400">প্রোটিন (Protein)</p>
          <p className="font-bold text-slate-900">৮.৫ গ্রাম</p>
        </div>
        <div className="rounded-lg bg-slate-50 p-2">
          <p className="text-slate-400">ফাইবার (Fiber)</p>
          <p className="font-bold text-slate-900">৩.২ গ্রাম</p>
        </div>
        <div className="rounded-lg bg-slate-50 p-2">
          <p className="text-slate-400">খনিজ ও আয়রন</p>
          <p className="font-bold text-slate-900">ন্যাচারাল জিঙ্ক ও আয়রন</p>
        </div>
      </div>
    </div>
  );
}

// ----------------------------------------------------
// 7. Express Delivery Slot Picker
// ----------------------------------------------------
export function GroceryDeliverySlotPicker({ locale = "bn" }: { locale?: ShopLocale | string } = {}) {
  const t = shopT(locale);
  const [slot, setSlot] = useState("slot1");
  const slots = [
    { id: "slot1", label: "আজ সকাল ১০:০০ - ১২:০০ (১ ঘণ্টায় এক্সপ্রেস)", fast: true },
    { id: "slot2", label: "আজ দুপুর ২:০০ - ৪:০০", fast: false },
    { id: "slot3", label: "আজ সন্ধ্যা ৬:০০ - ৮:০০", fast: false },
    { id: "slot4", label: "আগামীকাল সকাল ৮:০০ - ১০:০০", fast: false },
  ];

  return (
    <div className="space-y-2 rounded-2xl border border-emerald-100 bg-emerald-50/40 p-3.5 text-xs">
      <div className="flex items-center gap-1.5 font-bold text-slate-900">
        <span>⏰</span>
        <span>{t.themeGrocery.slotLabel}</span>
      </div>
      <div className="grid gap-2 sm:grid-cols-2">
        {slots.map((s) => (
          <label
            key={s.id}
            className={`flex cursor-pointer items-center justify-between rounded-xl border p-2.5 transition ${
              slot === s.id ? "border-emerald-600 bg-white font-bold text-emerald-950 shadow-xs" : "border-slate-200 bg-white/70 text-slate-700"
            }`}
          >
            <div className="flex items-center gap-2">
              <input
                type="radio"
                name="delivery-slot"
                checked={slot === s.id}
                onChange={() => setSlot(s.id)}
                className="accent-emerald-600"
              />
              <span className="text-[11px]">{s.label}</span>
            </div>
            {s.fast && <span className="rounded bg-emerald-600 px-1.5 py-0.5 text-[9px] text-white">{t.themeGrocery.freshTag}</span>}
          </label>
        ))}
      </div>
    </div>
  );
}

// ----------------------------------------------------
// 8. Grocery & Organic Foods Dedicated Homepage Layout
// ----------------------------------------------------
export function GroceryThemeHome({
  home,
  orgSlug,
  locale = "bn",
}: {
  home: ShopHome;
  orgSlug: string;
  locale?: ShopLocale | string;
}) {
  const t = shopT(locale);
  const { settings, products, flashSales, categories, brands, pagination } = home;
  const page = pagination.page;

  const groceryDepartments = [
    { label: "তাজা শাকসবজি", icon: "🥬", slug: "vegetables" },
    { label: "চাল, ডাল ও তেল", icon: "🍚", slug: "staples" },
    { label: "খাঁটি মধু ও ঘি", icon: "🍯", slug: "organic-pure" },
    { label: "দেশি মাছ ও মাংস", icon: "🐟", slug: "meat-fish" },
    { label: "দুধ ও তাজা ডিম", icon: "🥛", slug: "dairy-eggs" },
    { label: "খাঁটি গুঁড়া মসলা", icon: "🌶️", slug: "spices" },
    { label: "চা, বিস্কুট ও স্ন্যাক্স", icon: "🍪", slug: "snacks" },
    { label: "ফ্রুটস ও খেজুর", icon: "🍎", slug: "fruits" },
  ];

  return (
    <div className="min-h-screen bg-[#f8faf8] text-slate-900 pb-16">
      {/* 1. Top Express Delivery Ribbon (Chaldal Style) */}
      <div className="bg-emerald-900 text-white text-xs py-2 px-4">
        <div className="mx-auto max-w-7xl flex flex-wrap items-center justify-between gap-2">
          <div className="flex items-center gap-2 font-bold">
            <span>{t.themeGrocery.topExpress}</span>
            <span className="hidden sm:inline">·</span>
            <span className="text-emerald-300">{t.themeGrocery.topPromise}</span>
          </div>
          <div className="flex items-center gap-2 font-semibold text-[11px]">
            <span>{t.themeGrocery.topOrder}01XXXXXXXXX</span>
            <span>·</span>
            <span className="bg-emerald-800 px-2 py-0.5 rounded-full">{t.themeGrocery.topCod}</span>
          </div>
        </div>
      </div>

      <div className="mx-auto max-w-7xl px-4 sm:px-6 space-y-10 pt-6">
        {/* 2. Hero Banner */}
        <section className="relative overflow-hidden rounded-3xl bg-gradient-to-r from-emerald-800 via-emerald-700 to-teal-800 text-white shadow-xl border border-emerald-600/30">
          <div className="relative z-10 grid gap-8 p-8 md:grid-cols-2 md:p-12 items-center">
            <div className="space-y-4">
              <div className="inline-flex items-center gap-2 rounded-full border border-emerald-400/30 bg-emerald-500/20 px-3 py-1 text-xs font-black text-emerald-200">
                <span>🌿</span>
                <span>100% ORGANIC & FRESH FARM PRODUCE</span>
              </div>
              <h1 className="text-3xl font-black tracking-tight text-white sm:text-5xl font-serif">
                {settings.shopName || t.themeGrocery.heroTaglineFallback}
              </h1>
              <p className="max-w-xl text-xs sm:text-sm text-emerald-100 leading-relaxed">
                {settings.metaDescription ||
                  t.themeGrocery.heroDescFallback}
              </p>
              <div className="flex flex-wrap items-center gap-3 pt-2">
                <a
                  href="#grocery-featured"
                  className="rounded-xl bg-white px-6 py-3 text-xs font-black text-emerald-900 shadow-md transition hover:bg-emerald-50"
                >
                  {t.themeGrocery.heroCta}
                </a>
                <a
                  href="#grocery-departments"
                  className="rounded-xl border border-emerald-400/40 bg-emerald-900/40 px-5 py-3 text-xs font-bold text-white backdrop-blur-sm hover:bg-emerald-900/60"
                >
                  {t.themeGrocery.browseCategories}
                </a>
              </div>
            </div>

            {/* Hero Right Visual */}
            <div className="flex items-center justify-center">
              <div className="relative aspect-square w-full max-w-md overflow-hidden rounded-3xl bg-white/10 p-6 border border-emerald-400/20 backdrop-blur-md shadow-2xl flex items-center justify-center">
                {products[0]?.imageUrl ? (
                  <MediaImage
                    src={products[0].imageUrl}
                    alt={products[0].name}
                    width={450}
                    height={450}
                    className="max-h-full max-w-full object-contain drop-shadow-2xl"
                  />
                ) : (
                  <div className="text-8xl">🍯</div>
                )}
                <div className="absolute bottom-4 left-4 right-4 rounded-2xl bg-white/95 p-3.5 backdrop-blur-md text-slate-900 shadow-lg text-left">
                  <span className="text-[10px] font-bold text-emerald-700">{t.themeGrocery.organicSpecial}</span>
                  <p className="line-clamp-1 text-xs font-black">{products[0]?.name || t.themeGrocery.heroProductFallback}</p>
                  <p className="text-xs font-extrabold text-emerald-800">
                    {products[0]?.priceMinor ? formatGroceryPrice(products[0].priceMinor) : ""}
                  </p>
                </div>
              </div>
            </div>
          </div>
        </section>

        {/* 3. Organic Trust Bar */}
        <GroceryTrustBar locale={locale} />

        {/* 4. Department Hub */}
        <section id="grocery-departments" className="space-y-4">
          <div>
            <h2 className="text-xl font-black text-slate-900 sm:text-2xl font-serif">{t.themeGrocery.categoriesHeading}</h2>
            <p className="text-xs text-slate-500">{t.themeGrocery.categoriesSub}</p>
          </div>

          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4 md:grid-cols-8">
            {groceryDepartments.map((dept) => (
              <Link
                key={dept.slug}
                href={`/shop/${orgSlug}?category=${dept.slug}`}
                className="group flex flex-col items-center justify-center rounded-2xl border border-emerald-100 bg-white p-3.5 text-center shadow-xs transition hover:border-emerald-600 hover:shadow-md"
              >
                <span className="flex h-12 w-12 items-center justify-center rounded-2xl bg-emerald-50 text-2xl transition group-hover:scale-110">
                  {dept.icon}
                </span>
                <span className="mt-2 text-xs font-bold text-slate-800 group-hover:text-emerald-700">
                  {dept.label}
                </span>
              </Link>
            ))}
          </div>
        </section>

        {/* 5. Flash Daily Deals */}
        {flashSales?.sales && flashSales.sales.length > 0 && flashSales.sales[0]?.products?.length ? (
          <section className="rounded-3xl border border-rose-200 bg-rose-50/70 p-6 space-y-4">
            <div className="flex flex-wrap items-center justify-between gap-3 border-b border-rose-200 pb-3">
              <div className="flex items-center gap-2">
                <span className="text-2xl">🔥</span>
                <div>
                  <h3 className="text-lg font-black text-rose-950 font-serif">{flashSales.sales[0].name || t.themeGrocery.flashFallback}</h3>
                  <p className="text-xs text-rose-700">{t.themeGrocery.flashSub}</p>
                </div>
              </div>
              <FlashCountdown endsAt={flashSales.sales[0].endsAt} serverNow={flashSales.serverNow} locale={locale} />
            </div>

            <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
              {flashSales.sales[0].products.slice(0, 4).map((p) => (
                <GroceryProductCard
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
        <section id="grocery-featured" className="space-y-5">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <h2 className="text-xl font-black text-slate-900 sm:text-2xl font-serif">
                {t.themeGrocery.collectionHeading}
              </h2>
              <p className="text-xs text-slate-500">
                {t.themeGrocery.collectionSub}
              </p>
            </div>
            <SortSelect orgSlug={orgSlug} locale={locale} value="featured" />
          </div>

          <div className="grid grid-cols-2 gap-3 sm:gap-4 md:grid-cols-3 lg:grid-cols-4">
            {products.map((p) => (
              <GroceryProductCard
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
                  {t.themeGrocery.prevPage}
                </Link>
              )}
              <span className="text-xs font-semibold text-slate-500">
                {t.themeGrocery.pagePrefix}{fmtNumber(locale === "en" ? "en" : "bn", pagination.page)} / {fmtNumber(locale === "en" ? "en" : "bn", pagination.totalPages)}
              </span>
              {page < pagination.totalPages && (
                <Link
                  href={`/shop/${orgSlug}?page=${page + 1}`}
                  className="rounded-xl border bg-white px-4 py-2 text-xs font-bold text-slate-700 hover:bg-slate-50"
                >
                  {t.themeGrocery.nextPage}
                </Link>
              )}
            </nav>
          )}
        </section>
      </div>
    </div>
  );
}
