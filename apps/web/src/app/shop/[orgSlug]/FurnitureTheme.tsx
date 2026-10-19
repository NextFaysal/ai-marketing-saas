"use client";
import React, { useState } from "react";
import Link from "next/link";
import { fmtMoney, fmtNumber, formatMinor } from "@repo/contracts";
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
export function FurnitureTrustBar({ locale = "bn" }: { locale?: ShopLocale | string } = {}) {
  const t = shopT(locale);
  const pillars = [
    {
      icon: "🛡️",
      title: t.themeFurniture.trust1Title,
      subtitle: t.themeFurniture.trust1Sub,
    },
    {
      icon: "🚚",
      title: t.themeFurniture.trust2Title,
      subtitle: t.themeFurniture.trust2Sub,
    },
    {
      icon: "🔧",
      title: t.themeFurniture.trust3Title,
      subtitle: t.themeFurniture.trust3Sub,
    },
    {
      icon: "💳",
      title: t.themeFurniture.trust4Title,
      subtitle: t.themeFurniture.trust4Sub,
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
  const t = shopT(locale);
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
            {t.themeFurniture.warrantyBadge}
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
              {product.category || t.themeFurniture.furnitureFallback}
            </span>
            <span className="rounded-full bg-stone-100 px-2 py-0.5 text-[10px] font-bold text-stone-700">
              {isOutOfStock ? t.themeFurniture.outOfStock : t.themeFurniture.readyStock}
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
              {t.themeFurniture.emiPrefix}<span className="text-amber-900">{fmtMoney(locale === "en" ? "en" : "bn", emiPerMonth)}{t.themeFurniture.emiPerMonthSuffix}</span> ({fmtNumber(locale === "en" ? "en" : "bn", 0)}%)
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
              <span>{t.themeFurniture.addedToOrder}</span>
            ) : (
              <>
                <span>🛋️</span>
                <span>{isOutOfStock ? t.themeFurniture.outOfStock : busy ? t.themeFurniture.adding : t.themeFurniture.addToOrder}</span>
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
  locale = "bn",
}: {
  selectedFinish?: string;
  onSelectFinish?: (finish: string) => void;
  locale?: ShopLocale | string;
}) {
  const t = shopT(locale);
  const finishes = [
    { label: "সেগুন কাঠ ফিনিশ", color: "#8B5A2B", badge: t.themeFurniture.badgePremium },
    { label: "কানাডিয়ান ওক", color: "#D2B48C", badge: t.themeFurniture.badgeModern },
    { label: "ডার্ক ওয়ালনাট", color: "#3D2B1F", badge: t.themeFurniture.badgePopular },
    { label: "মেহগনি কালার", color: "#5C2C16", badge: t.themeFurniture.badgeClassic },
  ];

  return (
    <div className="space-y-2.5 rounded-2xl border border-stone-200 bg-stone-50/60 p-4">
      <div className="flex items-center justify-between text-xs">
        <label className="font-bold text-stone-900">
          {t.themeFurniture.finishLabel}<span className="text-amber-800">{selectedFinish}</span>
        </label>
        <span className="text-[11px] font-bold text-stone-500">{t.themeFurniture.seasonedHardwood}</span>
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
export function FurnitureDimensionSpecs({ locale = "bn" }: { locale?: ShopLocale | string } = {}) {
  const t = shopT(locale);
  return (
    <div className="rounded-2xl border border-stone-200 bg-white p-4 text-xs space-y-3 shadow-xs">
      <div className="flex items-center justify-between border-b border-stone-100 pb-2">
        <h4 className="font-black text-stone-900">{t.themeFurniture.dimsHeading}</h4>
        <span className="text-[10px] text-amber-800 font-bold">{t.themeFurniture.dimsFriendly}</span>
      </div>

      <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 text-[11px] text-stone-700">
        <div className="rounded-xl bg-stone-50 p-2.5">
          <p className="text-stone-400">{t.themeFurniture.dimLength}</p>
          <p className="font-bold text-stone-900">৮৪ ইঞ্চি (২১৩ সেমি)</p>
        </div>
        <div className="rounded-xl bg-stone-50 p-2.5">
          <p className="text-stone-400">{t.themeFurniture.dimWidth}</p>
          <p className="font-bold text-stone-900">৭২ ইঞ্চি (১৮২ সেমি)</p>
        </div>
        <div className="rounded-xl bg-stone-50 p-2.5">
          <p className="text-stone-400">{t.themeFurniture.dimHeight}</p>
          <p className="font-bold text-stone-900">৪৫ ইঞ্চি (১১৪ সেমি)</p>
        </div>
        <div className="rounded-xl bg-stone-50 p-2.5">
          <p className="text-stone-400">{t.themeFurniture.dimWood}</p>
          <p className="font-bold text-stone-900">{t.themeFurniture.dimTreated}</p>
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
  locale = "bn",
}: {
  orgSlug: string;
  mainProduct: ShopProduct;
  locale?: ShopLocale | string;
}) {
  const t = shopT(locale);
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
              {t.themeFurniture.comboTitle}
            </h3>
            <p className="text-[11px] text-stone-500">
              {t.themeFurniture.comboSub}
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
            {t.themeFurniture.comboMain}
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
          <p className="text-[11px] text-stone-500">{t.themeFurniture.comboNote}</p>
        </div>

        {added ? (
          <div className="flex items-center gap-2">
            <span className="text-xs font-bold text-emerald-800">{t.themeFurniture.comboAdded}</span>
            <Link
              href={`/shop/${orgSlug}/cart`}
              className="rounded-xl bg-amber-900 px-4 py-2 text-xs font-bold text-white hover:bg-stone-900"
            >
              {t.themeFurniture.viewCart}
            </Link>
          </div>
        ) : (
          <button
            type="button"
            onClick={handleAddSetBundle}
            disabled={busy}
            className="rounded-xl bg-amber-900 px-5 py-3 text-xs font-black text-white shadow-md shadow-amber-900/20 hover:bg-stone-900 transition disabled:opacity-50"
          >
            {busy ? t.themeFurniture.comboBusy : t.themeFurniture.comboBuy}
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
  locale = "bn",
}: {
  open: boolean;
  onClose: () => void;
  productName: string;
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
            <h3 className="text-base font-black text-stone-900 font-serif">{t.themeFurniture.warrantyTitle}</h3>
            <p className="line-clamp-1 text-xs text-stone-500">{productName}</p>
          </div>
        </div>

        <div className="mt-5 space-y-3 text-xs text-stone-700">
          <div className="rounded-2xl border border-amber-200 bg-amber-50/60 p-4 space-y-2">
            <div className="flex items-center justify-between border-b border-amber-200/60 pb-2">
              <span className="font-bold text-stone-900">{t.themeFurniture.warrantyTypeLabel}</span>
              <span className="font-black text-amber-900">{t.themeFurniture.warrantyTypeValue}</span>
            </div>
            <p><strong>{t.themeFurniture.warrantyWoodPrefix}</strong> সিজনড সলিড কাঠ ও হাই-ডেনসিটি বোর্ড — কোনো অবস্থাতেই ঘুণ ধরবে না (Termite-free guarantee)।</p>
            <p><strong>{t.themeFurniture.warrantyFittingPrefix}</strong> স্ক্রু, কবজা ও মেকানিজমে ১ বছরের ফ্রি রিপ্লেসমেন্ট এবং লাইফটাইম সার্ভিস সাপোর্ট।</p>
            <p><strong>{t.themeFurniture.warrantyServicePrefix}</strong> যেকোনো সমস্যায় আমাদের টেকনিক্যাল টিম সরাসরি আপনার বাসায় গিয়ে ইন্সপেকশন ও রিপেয়ার সম্পন্ন করবে।</p>
          </div>

          <div className="grid grid-cols-3 gap-2 text-center text-[11px]">
            <div className="rounded-xl border border-stone-100 bg-stone-50 p-2.5">
              <p className="font-bold text-stone-900">{t.themeFurniture.feat1Title}</p>
              <p className="text-stone-400 text-[10px]">{t.themeFurniture.feat1Sub}</p>
            </div>
            <div className="rounded-xl border border-stone-100 bg-stone-50 p-2.5">
              <p className="font-bold text-stone-900">{t.themeFurniture.feat2Title}</p>
              <p className="text-stone-400 text-[10px]">{t.themeFurniture.feat2Sub}</p>
            </div>
            <div className="rounded-xl border border-stone-100 bg-stone-50 p-2.5">
              <p className="font-bold text-stone-900">{t.themeFurniture.feat3Title}</p>
              <p className="text-stone-400 text-[10px]">{t.themeFurniture.feat3Sub}</p>
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
  locale = "bn",
}: {
  open: boolean;
  onClose: () => void;
  productName: string;
  locale?: ShopLocale | string;
}) {
  const t = shopT(locale);
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
            <h3 className="text-base font-black text-stone-900 font-serif">{t.themeFurniture.vizTitle}</h3>
            <p className="line-clamp-1 text-xs text-stone-500">{productName}</p>
          </div>
        </div>

        {/* Room Visualizer Preview Box */}
        <div
          className="relative h-48 w-full rounded-2xl border border-stone-200 p-4 flex flex-col justify-between transition-colors duration-300"
          style={{ backgroundColor: wallColor }}
        >
          <div className="flex items-center justify-between text-xs font-bold text-stone-700 bg-white/80 backdrop-blur-xs px-3 py-1 rounded-full shadow-xs">
            <span>{t.themeFurniture.vizPreviewPrefix}{roomType === "bedroom" ? t.themeFurniture.vizBedroom : roomType === "living" ? t.themeFurniture.vizLiving : t.themeFurniture.vizDining}</span>
            <span className="text-amber-800">{t.themeFurniture.vizPerfectFit}</span>
          </div>

          <div className="text-center space-y-1">
            <span className="text-5xl">🛋️</span>
            <p className="text-xs font-black text-stone-900 bg-white/80 px-2.5 py-0.5 rounded-full inline-block">
              {productName}
            </p>
          </div>

          <p className="text-[11px] text-stone-500 text-center bg-white/60 rounded px-2 py-0.5">
            {t.themeFurniture.vizCoverage}
          </p>
        </div>

        {/* Wall Color & Room Selector */}
        <div className="space-y-3 text-xs">
          <div>
            <label className="font-bold text-stone-800 block mb-1">{t.themeFurniture.vizRoomLabel}</label>
            <div className="grid grid-cols-3 gap-2">
              {[
                { id: "bedroom", label: t.themeFurniture.roomBedroom },
                { id: "living", label: t.themeFurniture.roomLiving },
                { id: "dining", label: t.themeFurniture.roomDining },
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
            <label className="font-bold text-stone-800 block mb-1">{t.themeFurniture.vizWallLabel}</label>
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
  const t = shopT(locale);
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
            <span>{t.themeFurniture.topPremium}</span>
            <span className="hidden sm:inline">·</span>
            <span className="text-amber-400">{t.themeFurniture.topWarranty}</span>
          </div>
          <div className="flex items-center gap-2 font-semibold text-[11px]">
            <span>{t.themeFurniture.topHotline}01XXXXXXXXX</span>
            <span>·</span>
            <span className="bg-amber-900 px-2.5 py-0.5 rounded-full">{t.themeFurniture.topEmi}</span>
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
                {settings.shopName || t.themeFurniture.heroTaglineFallback}
              </h1>
              <p className="max-w-xl text-xs sm:text-sm text-stone-300 leading-relaxed">
                {settings.metaDescription ||
                  t.themeFurniture.heroDescFallback}
              </p>
              <div className="flex flex-wrap items-center gap-3 pt-2">
                <a
                  href="#furniture-featured"
                  className="rounded-xl bg-amber-700 px-6 py-3 text-xs font-black text-white shadow-lg shadow-amber-900/40 transition hover:bg-amber-600"
                >
                  {t.themeFurniture.heroCta}
                </a>
                <a
                  href="#room-categories"
                  className="rounded-xl border border-stone-700 bg-stone-900/60 px-5 py-3 text-xs font-bold text-stone-200 backdrop-blur-sm hover:bg-stone-800"
                >
                  {t.themeFurniture.heroCategories}
                </a>
              </div>
            </div>

            {/* Hero Right Visual */}
            <div className="flex items-center justify-center">
              <div className="rounded-3xl border border-amber-500/20 bg-stone-900/80 p-6 backdrop-blur-md shadow-2xl text-center space-y-3">
                <span className="text-5xl">🛋️</span>
                <h3 className="text-lg font-black text-white font-serif">Living & Bedroom Suites</h3>
                <p className="text-xs text-amber-200/80 max-w-xs">
                  {t.themeFurniture.heroQuality}
                </p>
                <div className="flex justify-center gap-2 text-[10px] font-bold text-amber-100">
                  <span className="rounded-full bg-white/10 px-2.5 py-1">{t.themeFurniture.chipWarranty}</span>
                  <span className="rounded-full bg-white/10 px-2.5 py-1">{t.themeFurniture.chipDelivery}</span>
                </div>
              </div>
            </div>
          </div>
        </section>

        {/* 3. 4 Pillars Trust Bar */}
        <FurnitureTrustBar locale={locale} />

        {/* 4. Room Categories */}
        <section id="room-categories" className="space-y-4">
          <div className="flex items-center justify-between">
            <h3 className="text-base font-black text-stone-900 font-serif">
              {t.themeFurniture.roomsHeading}
            </h3>
            <span className="text-xs font-bold text-amber-800">{t.themeFurniture.roomsSub}</span>
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
                    {flashSales.sales[0].name || t.themeFurniture.flashFallback}
                  </h3>
                  <p className="text-xs text-amber-300">{t.themeFurniture.flashSub}</p>
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
                {t.themeFurniture.collectionHeading}
              </h2>
              <p className="text-xs text-stone-500">
                {t.themeFurniture.collectionSub}
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
                  {t.themeFurniture.prevPage}
                </Link>
              )}
              <span className="text-xs font-semibold text-stone-500">
                {t.themeFurniture.pagePrefix}{fmtNumber(locale === "en" ? "en" : "bn", pagination.page)} / {fmtNumber(locale === "en" ? "en" : "bn", pagination.totalPages)}
              </span>
              {page < pagination.totalPages && (
                <Link
                  href={`/shop/${orgSlug}?page=${page + 1}`}
                  className="rounded-xl border bg-white px-4 py-2 text-xs font-bold text-stone-700 hover:bg-stone-50"
                >
                  {t.themeFurniture.nextPage}
                </Link>
              )}
            </nav>
          )}
        </section>
      </div>
    </div>
  );
}
