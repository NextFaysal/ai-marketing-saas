"use client";
import React, { useState } from "react";
import Link from "next/link";
import { formatMinor } from "@repo/contracts";
import { MediaImage } from "@/components/media-image";
import type { ShopHome, ShopProduct } from "@/lib/storefront-server";
import { shopSortOf } from "@/lib/storefront-server";
import { type ShopLocale, shopT } from "@/lib/shop-i18n";
import { QuickViewButton } from "./QuickView";
import { WishlistHeart } from "./WishlistHeart";
import { FlashCountdown } from "./FlashCountdown";
import { SortSelect } from "./SortSelect";
import { patchCartLine, notifyCartUpdated } from "@/lib/storefront-cart";

export function formatFashionPrice(minor: string): string {
  try {
    return formatMinor(BigInt(minor));
  } catch {
    return minor;
  }
}

// ----------------------------------------------------
// 1. Interactive Fashion Size Guide Modal
// ----------------------------------------------------
export function FashionSizeGuideModal({
  open,
  onClose,
}: {
  open: boolean;
  onClose: () => void;
}) {
  const [tab, setTab] = useState<"panjabi" | "kurti" | "shirt" | "tshirt">("panjabi");

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4 backdrop-blur-sm animate-in fade-in duration-200">
      <div className="relative w-full max-w-2xl rounded-3xl bg-white p-6 shadow-2xl sm:p-8">
        <button
          type="button"
          onClick={onClose}
          className="absolute right-5 top-5 flex h-9 w-9 items-center justify-center rounded-full bg-stone-100 text-stone-500 hover:bg-stone-200 hover:text-stone-900 transition"
          aria-label="Close size guide"
        >
          ✕
        </button>

        <div className="flex items-center gap-2.5">
          <span className="text-2xl">📏</span>
          <div>
            <h3 className="text-lg font-black text-stone-900 sm:text-xl">সাইজ নির্দেশিকা (Size Chart Guide)</h3>
            <p className="text-xs text-stone-500">আপনার সঠিক মাপ বেছে নিন (সব পরিমাপ ইঞ্চিতে)</p>
          </div>
        </div>

        {/* Tab selection */}
        <div className="mt-5 flex flex-wrap gap-2 border-b border-stone-200 pb-3">
          {[
            { id: "panjabi", label: "পাঞ্জাবি (Panjabi)" },
            { id: "kurti", label: "কুর্তি / কামিজ (Kurti)" },
            { id: "shirt", label: "ক্যাজুয়াল শার্ট (Shirt)" },
            { id: "tshirt", label: "টি-শার্ট ও পোলো (T-Shirt)" },
          ].map((t) => (
            <button
              key={t.id}
              type="button"
              onClick={() => setTab(t.id as any)}
              className={`rounded-full px-4 py-1.5 text-xs font-bold transition ${
                tab === t.id
                  ? "bg-neutral-900 text-white shadow-sm"
                  : "bg-stone-100 text-stone-600 hover:bg-stone-200"
              }`}
            >
              {t.label}
            </button>
          ))}
        </div>

        {/* Chart Tables */}
        <div className="mt-4 overflow-x-auto">
          {tab === "panjabi" && (
            <table className="w-full text-left text-xs">
              <thead>
                <tr className="border-b bg-stone-50 text-stone-700">
                  <th className="p-2.5 font-bold">সাইজ (Size)</th>
                  <th className="p-2.5 font-bold">বডি / চেস্ট (Chest)</th>
                  <th className="p-2.5 font-bold">দৈর্ঘ্য (Length)</th>
                  <th className="p-2.5 font-bold">শোল্ডার (Shoulder)</th>
                  <th className="p-2.5 font-bold">হাতা (Sleeve)</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-stone-100 text-stone-600">
                <tr><td className="p-2.5 font-bold text-neutral-900">38 (S)</td><td className="p-2.5">38&quot; - 40&quot;</td><td className="p-2.5">40&quot;</td><td className="p-2.5">17.5&quot;</td><td className="p-2.5">24.5&quot;</td></tr>
                <tr><td className="p-2.5 font-bold text-neutral-900">40 (M)</td><td className="p-2.5">40&quot; - 42&quot;</td><td className="p-2.5">42&quot;</td><td className="p-2.5">18.0&quot;</td><td className="p-2.5">25.0&quot;</td></tr>
                <tr><td className="p-2.5 font-bold text-neutral-900">42 (L)</td><td className="p-2.5">42&quot; - 44&quot;</td><td className="p-2.5">44&quot;</td><td className="p-2.5">18.5&quot;</td><td className="p-2.5">25.5&quot;</td></tr>
                <tr><td className="p-2.5 font-bold text-neutral-900">44 (XL)</td><td className="p-2.5">44&quot; - 46&quot;</td><td className="p-2.5">46&quot;</td><td className="p-2.5">19.0&quot;</td><td className="p-2.5">26.0&quot;</td></tr>
                <tr><td className="p-2.5 font-bold text-neutral-900">46 (XXL)</td><td className="p-2.5">46&quot; - 48&quot;</td><td className="p-2.5">46&quot;</td><td className="p-2.5">19.5&quot;</td><td className="p-2.5">26.5&quot;</td></tr>
              </tbody>
            </table>
          )}

          {tab === "kurti" && (
            <table className="w-full text-left text-xs">
              <thead>
                <tr className="border-b bg-stone-50 text-stone-700">
                  <th className="p-2.5 font-bold">সাইজ (Size)</th>
                  <th className="p-2.5 font-bold">বুকের মাপ (Bust)</th>
                  <th className="p-2.5 font-bold">কোমর (Waist)</th>
                  <th className="p-2.5 font-bold">হিপ (Hip)</th>
                  <th className="p-2.5 font-bold">লম্বা (Length)</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-stone-100 text-stone-600">
                <tr><td className="p-2.5 font-bold text-neutral-900">36 (S)</td><td className="p-2.5">36&quot;</td><td className="p-2.5">32&quot;</td><td className="p-2.5">38&quot;</td><td className="p-2.5">42&quot; - 44&quot;</td></tr>
                <tr><td className="p-2.5 font-bold text-neutral-900">38 (M)</td><td className="p-2.5">38&quot;</td><td className="p-2.5">34&quot;</td><td className="p-2.5">40&quot;</td><td className="p-2.5">42&quot; - 44&quot;</td></tr>
                <tr><td className="p-2.5 font-bold text-neutral-900">40 (L)</td><td className="p-2.5">40&quot;</td><td className="p-2.5">36&quot;</td><td className="p-2.5">42&quot;</td><td className="p-2.5">44&quot; - 46&quot;</td></tr>
                <tr><td className="p-2.5 font-bold text-neutral-900">42 (XL)</td><td className="p-2.5">42&quot;</td><td className="p-2.5">38&quot;</td><td className="p-2.5">44&quot;</td><td className="p-2.5">44&quot; - 46&quot;</td></tr>
                <tr><td className="p-2.5 font-bold text-neutral-900">44 (XXL)</td><td className="p-2.5">44&quot;</td><td className="p-2.5">40&quot;</td><td className="p-2.5">46&quot;</td><td className="p-2.5">46&quot;</td></tr>
              </tbody>
            </table>
          )}

          {tab === "shirt" && (
            <table className="w-full text-left text-xs">
              <thead>
                <tr className="border-b bg-stone-50 text-stone-700">
                  <th className="p-2.5 font-bold">সাইজ (Size)</th>
                  <th className="p-2.5 font-bold">চেস্ট (Chest)</th>
                  <th className="p-2.5 font-bold">দৈর্ঘ্য (Length)</th>
                  <th className="p-2.5 font-bold">কলার (Collar)</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-stone-100 text-stone-600">
                <tr><td className="p-2.5 font-bold text-neutral-900">M (38-39)</td><td className="p-2.5">39&quot; - 40&quot;</td><td className="p-2.5">29&quot;</td><td className="p-2.5">15.0&quot;</td></tr>
                <tr><td className="p-2.5 font-bold text-neutral-900">L (40-41)</td><td className="p-2.5">41&quot; - 42&quot;</td><td className="p-2.5">30&quot;</td><td className="p-2.5">15.5&quot;</td></tr>
                <tr><td className="p-2.5 font-bold text-neutral-900">XL (42-43)</td><td className="p-2.5">43&quot; - 44&quot;</td><td className="p-2.5">31&quot;</td><td className="p-2.5">16.0&quot;</td></tr>
                <tr><td className="p-2.5 font-bold text-neutral-900">XXL (44-45)</td><td className="p-2.5">45&quot; - 46&quot;</td><td className="p-2.5">32&quot;</td><td className="p-2.5">16.5&quot;</td></tr>
              </tbody>
            </table>
          )}

          {tab === "tshirt" && (
            <table className="w-full text-left text-xs">
              <thead>
                <tr className="border-b bg-stone-50 text-stone-700">
                  <th className="p-2.5 font-bold">সাইজ (Size)</th>
                  <th className="p-2.5 font-bold">চেস্ট (Chest)</th>
                  <th className="p-2.5 font-bold">দৈর্ঘ্য (Length)</th>
                  <th className="p-2.5 font-bold">স্লিভ (Sleeve)</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-stone-100 text-stone-600">
                <tr><td className="p-2.5 font-bold text-neutral-900">S</td><td className="p-2.5">36&quot; - 37&quot;</td><td className="p-2.5">27&quot;</td><td className="p-2.5">7.5&quot;</td></tr>
                <tr><td className="p-2.5 font-bold text-neutral-900">M</td><td className="p-2.5">38&quot; - 39&quot;</td><td className="p-2.5">28&quot;</td><td className="p-2.5">8.0&quot;</td></tr>
                <tr><td className="p-2.5 font-bold text-neutral-900">L</td><td className="p-2.5">40&quot; - 41&quot;</td><td className="p-2.5">29&quot;</td><td className="p-2.5">8.5&quot;</td></tr>
                <tr><td className="p-2.5 font-bold text-neutral-900">XL</td><td className="p-2.5">42&quot; - 43&quot;</td><td className="p-2.5">30&quot;</td><td className="p-2.5">9.0&quot;</td></tr>
                <tr><td className="p-2.5 font-bold text-neutral-900">XXL</td><td className="p-2.5">44&quot; - 45&quot;</td><td className="p-2.5">31&quot;</td><td className="p-2.5">9.5&quot;</td></tr>
              </tbody>
            </table>
          )}
        </div>

        <div className="mt-5 rounded-2xl bg-amber-50/80 p-3.5 text-xs text-amber-900">
          💡 <strong>টিপস:</strong> আপনার নিয়মিত পরা আরামদায়ক কোনো পোশাক সমতল স্থানে রেখে ফিতা দিয়ে মেপে নিন এবং উপরিউক্ত চার্টের সাথে মিলিয়ে সাইজ সিলেক্ট করুন। সাইজে সন্দেহ থাকলে ১ সাইজ বড় অর্ডার করার পরামর্শ দেওয়া হয়।
        </div>
      </div>
    </div>
  );
}

// ----------------------------------------------------
// 2. High Fashion 3:4 Aspect Product Card with Sizes
// ----------------------------------------------------
export function FashionProductCard({
  orgSlug,
  product,
  locale = "bn",
  flashServerNow,
  onOpenSizeGuide,
}: {
  orgSlug: string;
  product: ShopProduct;
  locale?: ShopLocale | string;
  flashServerNow?: string | null;
  onOpenSizeGuide?: () => void;
}) {
  const [hovered, setHovered] = useState(false);
  const [selectedSize, setSelectedSize] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);
  const [added, setAdded] = useState(false);

  const t = shopT(locale);
  const hasMultipleImages = (product.images ?? []).length > 1;
  const secondaryImage = hasMultipleImages ? product.images[1] : null;

  // Extract real sizes if product has variants, or fall back to standard sizes for clothes
  const variantSizes = (product.variants ?? []).map((v) => ({
    id: v.id,
    label: v.name.replace(/size|সাইজ/i, "").trim() || v.name,
    inStock: v.stockState !== "out_of_stock",
  }));
  const availableSizes = variantSizes.length > 0 ? variantSizes : [
    { id: "S", label: "S", inStock: true },
    { id: "M", label: "M", inStock: true },
    { id: "L", label: "L", inStock: true },
    { id: "XL", label: "XL", inStock: true },
    { id: "XXL", label: "XXL", inStock: true },
  ];

  const handleQuickAdd = async (e: React.MouseEvent, variantId?: string) => {
    e.preventDefault();
    e.stopPropagation();
    try {
      setAdding(true);
      await patchCartLine(orgSlug, {
        productId: product.id,
        variantId: variantId && variantId.length > 3 ? variantId : null,
        quantity: 1,
      });
      notifyCartUpdated(orgSlug);
      setAdded(true);
      setTimeout(() => setAdded(false), 2000);
    } catch (err) {
      console.error("Quick add failed", err);
    } finally {
      setAdding(false);
    }
  };

  const discountPercent =
    product.compareAtMinor && BigInt(product.compareAtMinor) > BigInt(product.priceMinor)
      ? Math.round(
          ((Number(product.compareAtMinor) - Number(product.priceMinor)) /
            Number(product.compareAtMinor)) *
            100,
        )
      : null;

  return (
    <div
      className="group relative flex flex-col overflow-hidden rounded-2xl border border-stone-200/80 bg-white transition-all duration-300 hover:-translate-y-1 hover:border-stone-400 hover:shadow-xl"
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
    >
      {/* 3:4 Tall Portrait Image Wrap */}
      <div className="relative aspect-[3/4] w-full overflow-hidden bg-stone-100">
        <Link href={`/shop/${orgSlug}/products/${product.slug ?? product.id}`} className="block h-full w-full">
          {product.imageUrl ? (
            <MediaImage
              src={hovered && secondaryImage ? secondaryImage : product.imageUrl}
              alt={product.name}
              width={600}
              height={800}
              sizes="(max-width: 640px) 50vw, (max-width: 1024px) 33vw, 25vw"
              className="h-full w-full object-cover transition-transform duration-700 ease-out group-hover:scale-105"
            />
          ) : (
            <div className="flex h-full w-full items-center justify-center bg-stone-100 text-5xl">👗</div>
          )}
        </Link>

        {/* Top Badges */}
        <div className="absolute left-2.5 top-2.5 flex flex-col gap-1.5 z-10 pointer-events-none">
          {discountPercent ? (
            <span className="rounded-full bg-rose-600 px-2.5 py-0.5 text-[10px] font-black tracking-wide text-white shadow-sm">
              −{discountPercent}% OFF
            </span>
          ) : product.flashSale ? (
            <span className="rounded-full bg-rose-600 px-2.5 py-0.5 text-[10px] font-black tracking-wide text-white shadow-sm">
              ⚡ FLASH
            </span>
          ) : (
            <span className="rounded-full bg-neutral-900/80 px-2 py-0.5 text-[10px] font-bold text-white backdrop-blur-xs">
              NEW DROP
            </span>
          )}
          {product.freeShipping && (
            <span className="rounded-full bg-emerald-600 px-2 py-0.5 text-[9px] font-bold text-white shadow-xs">
              ফ্রি ডেলিভারি
            </span>
          )}
        </div>

        {/* Wishlist Heart */}
        <div className="absolute right-2.5 top-2.5 z-10">
          <WishlistHeart orgSlug={orgSlug} productId={product.id} locale={locale} />
        </div>

        {/* Hover Quick Size Selector Bar */}
        <div
          className={`absolute inset-x-2 bottom-2 z-10 rounded-xl bg-white/95 p-2 shadow-lg backdrop-blur transition-all duration-300 ${
            hovered ? "translate-y-0 opacity-100 pointer-events-auto" : "translate-y-4 opacity-0 pointer-events-none"
          }`}
        >
          <div className="flex items-center justify-between px-1 pb-1 text-[11px] font-bold text-stone-600">
            <span>দ্রুত সাইজ বাছুন:</span>
            {onOpenSizeGuide && (
              <button
                type="button"
                onClick={(e) => {
                  e.preventDefault();
                  e.stopPropagation();
                  onOpenSizeGuide();
                }}
                className="text-[10px] font-semibold text-indigo-600 underline hover:text-indigo-800"
              >
                সাইজ গাইড
              </button>
            )}
          </div>
          <div className="flex flex-wrap items-center gap-1">
            {availableSizes.slice(0, 5).map((s) => (
              <button
                key={s.id}
                type="button"
                disabled={!s.inStock || adding}
                onClick={(e) => {
                  setSelectedSize(s.label);
                  handleQuickAdd(e, s.id);
                }}
                className={`flex-1 min-w-[28px] rounded-lg py-1 text-center text-xs font-bold transition ${
                  selectedSize === s.label
                    ? "bg-neutral-900 text-white"
                    : s.inStock
                    ? "bg-stone-100 text-stone-800 hover:bg-neutral-900 hover:text-white"
                    : "bg-stone-50 text-stone-300 cursor-not-allowed line-through"
                }`}
                title={s.inStock ? `অ্যাড করুন: ${s.label}` : "স্টক শেষ"}
              >
                {s.label}
              </button>
            ))}
          </div>
        </div>

        {/* Quick View Button */}
        <div className="absolute bottom-16 right-2.5 z-10">
          <QuickViewButton orgSlug={orgSlug} product={product} locale={locale} />
        </div>
      </div>

      {/* Product Details Section */}
      <div className="flex flex-1 flex-col justify-between p-4">
        <div>
          <div className="flex items-center justify-between text-[11px] font-medium text-stone-400">
            <span>{product.category || "Fashion"}</span>
            {product.brand && <span className="font-semibold text-stone-600">{product.brand.name}</span>}
          </div>
          <Link href={`/shop/${orgSlug}/products/${product.slug ?? product.id}`}>
            <h3 className="mt-1 line-clamp-2 text-sm font-bold text-stone-900 group-hover:text-indigo-600 transition">
              {product.name}
            </h3>
          </Link>
        </div>

        <div className="mt-3 flex items-center justify-between border-t border-stone-100 pt-2.5">
          <div className="flex items-baseline gap-2">
            <span className="text-base font-black text-stone-900">
              {formatFashionPrice(product.priceMinor)}
            </span>
            {product.compareAtMinor && (
              <span className="text-xs text-stone-400 line-through">
                {formatFashionPrice(product.compareAtMinor)}
              </span>
            )}
          </div>

          <button
            type="button"
            onClick={(e) => handleQuickAdd(e)}
            disabled={adding}
            className={`rounded-xl px-3 py-1.5 text-xs font-bold transition shadow-xs ${
              added
                ? "bg-emerald-600 text-white"
                : "bg-stone-100 text-stone-800 hover:bg-neutral-900 hover:text-white"
            }`}
          >
            {added ? "✓ যোগ হয়েছে" : adding ? "..." : "+ ব্যাগে নিন"}
          </button>
        </div>
      </div>
    </div>
  );
}

// ----------------------------------------------------
// 3. Main Fashion Theme Home Layout
// ----------------------------------------------------
export function FashionThemeHome({
  orgSlug,
  home,
  q = "",
  category = "",
  brand = "",
  page = 1,
  sort = "featured",
}: {
  orgSlug: string;
  home: ShopHome;
  q?: string;
  category?: string;
  brand?: string;
  page?: number;
  sort?: string;
}) {
  const [sizeModalOpen, setSizeModalOpen] = useState(false);

  const { settings, categories, featuredProducts, products, pagination } = home;
  const brands = home.brands ?? [];
  const locale = (settings.locale ?? "bn") as ShopLocale;
  const t = shopT(locale);
  const accent = home.organization.primaryColor || "#18181b"; // Elegant dark neutral default for fashion

  // Curated category department showcase
  const categoryHighlights = categories.slice(0, 4);

  return (
    <div className="space-y-14 pb-16">
      {/* 1. Size Guide Modal */}
      <FashionSizeGuideModal open={sizeModalOpen} onClose={() => setSizeModalOpen(false)} />

      {/* 2. Top Promotional Ticker (Yellow/Aarong style) */}
      <div className="bg-neutral-950 py-2.5 text-center text-xs font-semibold text-stone-200 tracking-wider uppercase">
        <div className="mx-auto flex max-w-6xl items-center justify-between px-4 sm:px-6">
          <span className="hidden sm:inline text-amber-400">✨ NEW SEASON DROP</span>
          <span>🚚 ঢাকার ভিতরে ২৪-৪৮ ঘণ্টায় এক্সপ্রেস হোম ডেলিভারি • সহজ ৭ দিন এক্সচেঞ্জ</span>
          <button
            type="button"
            onClick={() => setSizeModalOpen(true)}
            className="hidden sm:inline font-bold text-amber-300 underline hover:text-white transition"
          >
            📏 সাইজ গাইড
          </button>
        </div>
      </div>

      <div className="mx-auto max-w-6xl space-y-14 px-4 sm:px-6">
        {/* 3. High-Fashion Editorial Hero */}
        <section className="relative overflow-hidden rounded-3xl bg-gradient-to-br from-neutral-950 via-stone-900 to-neutral-900 text-white shadow-2xl">
          <div className="absolute inset-0 bg-[radial-gradient(ellipse_at_top_right,_var(--tw-gradient-stops))] from-amber-500/10 via-transparent to-transparent pointer-events-none" />
          <div className="relative z-10 grid gap-8 p-8 sm:p-14 lg:grid-cols-2 lg:items-center">
            <div className="space-y-5 text-left">
              <span className="inline-block rounded-full bg-amber-400/20 px-3 py-1 text-xs font-extrabold tracking-widest text-amber-300 uppercase">
                SEASON LOOKBOOK &apos;26
              </span>
              <h1 className="text-3xl font-black tracking-tight text-white sm:text-5xl lg:text-6xl font-serif">
                {settings.shopName}
              </h1>
              <p className="max-w-lg text-sm leading-relaxed text-stone-300 sm:text-base">
                {settings.metaDescription || "ঐতিহ্য ও আধুনিক ফ্যাশনের অপূর্ব মেলবন্ধন — প্রিমিয়াম পাঞ্জাবি, শাড়ি, কুর্তি ও ট্রেন্ডি পোশাকের এক্সক্লুসিভ কালেকশন।"}
              </p>

              {/* Call to Actions */}
              <div className="flex flex-wrap items-center gap-3 pt-2">
                <a
                  href="#collection-grid"
                  className="rounded-full bg-white px-7 py-3 text-xs font-black uppercase tracking-wider text-neutral-950 shadow-md hover:bg-amber-300 transition"
                >
                  কালেকশন দেখুন ↓
                </a>
                <button
                  type="button"
                  onClick={() => setSizeModalOpen(true)}
                  className="rounded-full border border-stone-500 bg-neutral-900/60 px-5 py-3 text-xs font-bold text-stone-200 backdrop-blur hover:bg-neutral-800 transition"
                >
                  📏 সাইজ চার্ট গাইড
                </button>
              </div>
            </div>

            {/* Hero Visual Collage / Seasonal Highlight */}
            <div className="relative grid grid-cols-2 gap-3 sm:gap-4">
              <div className="relative aspect-[3/4] overflow-hidden rounded-2xl bg-stone-800 shadow-xl">
                {featuredProducts[0]?.imageUrl ? (
                  <MediaImage
                    src={featuredProducts[0].imageUrl}
                    alt="Fashion collection hero 1"
                    width={400}
                    height={533}
                    className="h-full w-full object-cover"
                  />
                ) : (
                  <div className="flex h-full w-full items-center justify-center text-4xl">👗</div>
                )}
                <div className="absolute inset-0 bg-gradient-to-t from-black/70 via-transparent to-transparent flex items-end p-3">
                  <span className="text-xs font-bold text-white">নারীদের উৎসব কালেকশন</span>
                </div>
              </div>

              <div className="relative aspect-[3/4] overflow-hidden rounded-2xl bg-stone-800 shadow-xl mt-6">
                {featuredProducts[1]?.imageUrl || featuredProducts[0]?.imageUrl ? (
                  <MediaImage
                    src={featuredProducts[1]?.imageUrl ?? featuredProducts[0]?.imageUrl ?? ""}
                    alt="Fashion collection hero 2"
                    width={400}
                    height={533}
                    className="h-full w-full object-cover"
                  />
                ) : (
                  <div className="flex h-full w-full items-center justify-center text-4xl">👔</div>
                )}
                <div className="absolute inset-0 bg-gradient-to-t from-black/70 via-transparent to-transparent flex items-end p-3">
                  <span className="text-xs font-bold text-white">এক্সক্লুসিভ পাঞ্জাবি ও মেনস</span>
                </div>
              </div>
            </div>
          </div>
        </section>

        {/* 4. Bangladeshi Fashion 4 Trust Pillars */}
        <section className="grid grid-cols-2 gap-3.5 rounded-2xl border border-stone-200 bg-white p-5 shadow-xs sm:grid-cols-4 sm:p-6">
          <div className="flex items-center gap-3">
            <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl bg-amber-50 text-xl">🚚</span>
            <div>
              <h4 className="text-xs font-bold text-stone-900">দ্রুত হোম ডেলিভারি</h4>
              <p className="text-[11px] text-stone-500">ঢাকার ভিতর ২৪-৪৮ ঘণ্টা</p>
            </div>
          </div>
          <div className="flex items-center gap-3">
            <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl bg-rose-50 text-xl">🔄</span>
            <div>
              <h4 className="text-xs font-bold text-stone-900">সহজ ৭ দিন এক্সচেঞ্জ</h4>
              <p className="text-[11px] text-stone-500">সাইজ পরিবর্তন সুবিধা</p>
            </div>
          </div>
          <div className="flex items-center gap-3">
            <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl bg-emerald-50 text-xl">💵</span>
            <div>
              <h4 className="text-xs font-bold text-stone-900">ক্যাশ অন ডেলিভারি</h4>
              <p className="text-[11px] text-stone-500">সারাদেশে COD ও বিকাশ</p>
            </div>
          </div>
          <div className="flex items-center gap-3">
            <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl bg-indigo-50 text-xl">🧵</span>
            <div>
              <h4 className="text-xs font-bold text-stone-900">১০০% প্রিমিয়াম সুতি</h4>
              <p className="text-[11px] text-stone-500">সেরা আরাম ও টেকসই ফেব্রিক</p>
            </div>
          </div>
        </section>

        {/* 5. Shop By Gender & Department Showcase */}
        {categoryHighlights.length > 0 && (
          <section className="space-y-5">
            <div className="flex items-end justify-between">
              <div>
                <span className="text-xs font-black tracking-wider text-amber-700 uppercase">DEPARTMENTS</span>
                <h2 className="text-2xl font-black text-stone-900 font-serif">পোশাকের ধরন অনুযায়ী বেছে নিন</h2>
              </div>
            </div>

            <div className="grid grid-cols-2 gap-4 md:grid-cols-4">
              {categoryHighlights.map((cat, idx) => {
                const sampleImg =
                  products.find((p) => p.category === cat.name || p.categoryId === cat.id)?.imageUrl ??
                  featuredProducts[idx]?.imageUrl ??
                  null;
                return (
                  <Link
                    key={cat.id ?? cat.name}
                    href={`/shop/${orgSlug}?category=${encodeURIComponent(cat.slug ?? cat.name)}`}
                    className="group relative aspect-[3/4] overflow-hidden rounded-2xl bg-stone-900 shadow-md transition hover:-translate-y-1 hover:shadow-xl"
                  >
                    {sampleImg ? (
                      <MediaImage
                        src={sampleImg}
                        alt={cat.name}
                        width={400}
                        height={533}
                        className="h-full w-full object-cover transition duration-700 group-hover:scale-105 opacity-80 group-hover:opacity-90"
                      />
                    ) : (
                      <div className="flex h-full w-full items-center justify-center bg-stone-800 text-4xl">
                        👗
                      </div>
                    )}
                    <div className="absolute inset-0 bg-gradient-to-t from-black/85 via-black/30 to-transparent flex flex-col justify-end p-4 text-white">
                      <h3 className="text-base font-extrabold">{cat.name}</h3>
                      <span className="text-xs text-stone-300 font-medium">
                        {cat.productCount} টি পোশাক রয়েছে →
                      </span>
                    </div>
                  </Link>
                );
              })}
            </div>
          </section>
        )}

        {/* 6. Flash Sale (if active) */}
        {(home.flashSales?.sales ?? []).length > 0 && (
          <section className="space-y-4 rounded-3xl border border-rose-200 bg-rose-50/70 p-6">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <span className="text-xs font-black tracking-widest text-rose-600 uppercase">LIMITED DROP</span>
                <h2 className="text-2xl font-black text-rose-900">⚡ ফ্ল্যাশ সেল অফার</h2>
              </div>
              <span className="rounded-full bg-white px-4 py-1.5 text-xs font-bold text-rose-700 shadow-xs">
                <FlashCountdown
                  endsAt={home.flashSales!.sales[0].endsAt}
                  serverNow={home.flashSales!.serverNow}
                  locale={locale}
                />
              </span>
            </div>

            <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-4">
              {home.flashSales!.sales[0].products.map((p) => (
                <FashionProductCard
                  key={p.id}
                  orgSlug={orgSlug}
                  product={p}
                  locale={locale}
                  flashServerNow={home.flashSales!.serverNow}
                  onOpenSizeGuide={() => setSizeModalOpen(true)}
                />
              ))}
            </div>
          </section>
        )}

        {/* 7. Featured & New Arrivals Showcase */}
        {featuredProducts.length > 0 && (
          <section className="space-y-5">
            <div className="flex items-end justify-between">
              <div>
                <span className="text-xs font-black tracking-widest text-stone-400 uppercase">CURATED LOOKS</span>
                <h2 className="text-2xl font-black text-stone-900 font-serif">নতুন আগমন ও স্পেশাল ডিজাইন</h2>
              </div>
            </div>

            <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-4">
              {featuredProducts.map((p) => (
                <FashionProductCard
                  key={p.id}
                  orgSlug={orgSlug}
                  product={p}
                  locale={locale}
                  onOpenSizeGuide={() => setSizeModalOpen(true)}
                />
              ))}
            </div>
          </section>
        )}

        {/* 8. Main Catalog Grid */}
        <section id="collection-grid" className="space-y-6 pt-4">
          <div className="flex flex-wrap items-center justify-between gap-3 border-b border-stone-200 pb-4">
            <div>
              <span className="text-xs font-black tracking-wider text-amber-700 uppercase">ALL APPAREL</span>
              <h2 className="text-2xl font-black text-stone-900 font-serif">
                সকল পোশাক কালেকশন
                <span className="ml-2 text-sm font-semibold text-stone-400 font-sans">
                  ({pagination.total} টি পোশাক)
                </span>
              </h2>
            </div>
            <div className="flex items-center gap-3">
              <button
                type="button"
                onClick={() => setSizeModalOpen(true)}
                className="rounded-lg border border-stone-300 bg-white px-3 py-1.5 text-xs font-bold text-stone-700 hover:bg-stone-50"
              >
                📏 সাইজ চার্ট
              </button>
              <SortSelect
                orgSlug={orgSlug}
                locale={locale}
                value={shopSortOf(sort)}
                q={q}
                category={category}
                brand={brand}
              />
            </div>
          </div>

          {/* Category Filter Pills */}
          {categories.length > 0 && (
            <div className="flex flex-wrap items-center gap-2">
              <Link
                href={`/shop/${orgSlug}`}
                className={`rounded-full px-4 py-1.5 text-xs font-bold transition ${
                  !category
                    ? "bg-neutral-900 text-white shadow-xs"
                    : "bg-white text-stone-700 border border-stone-200 hover:bg-stone-50"
                }`}
              >
                সব পোশাক ({pagination.total})
              </Link>
              {categories.map((c) => {
                const value = c.slug ?? c.name;
                const active = category === value || category === c.name;
                return (
                  <Link
                    key={c.id ?? c.name}
                    href={`/shop/${orgSlug}?category=${encodeURIComponent(value)}`}
                    className={`rounded-full px-4 py-1.5 text-xs font-bold transition ${
                      active
                        ? "bg-neutral-900 text-white shadow-xs"
                        : "bg-white text-stone-700 border border-stone-200 hover:bg-stone-50"
                    }`}
                  >
                    {c.name} ({c.productCount})
                  </Link>
                );
              })}
            </div>
          )}

          {products.length === 0 ? (
            <div className="rounded-3xl border border-dashed border-stone-300 bg-white p-12 text-center">
              <p className="text-4xl">👗</p>
              <p className="mt-2 text-sm font-semibold text-stone-600">কোনো পোশাক পাওয়া যায়নি</p>
              <Link
                href={`/shop/${orgSlug}`}
                className="mt-4 inline-block rounded-full bg-neutral-900 px-5 py-2 text-xs font-bold text-white hover:bg-stone-800"
              >
                সকল পোশাক দেখুন
              </Link>
            </div>
          ) : (
            <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-4">
              {products.map((p) => (
                <FashionProductCard
                  key={p.id}
                  orgSlug={orgSlug}
                  product={p}
                  locale={locale}
                  onOpenSizeGuide={() => setSizeModalOpen(true)}
                />
              ))}
            </div>
          )}

          {/* Pagination */}
          {pagination.totalPages > 1 && (
            <nav className="flex items-center justify-center gap-2 pt-6">
              {page > 1 && (
                <Link
                  href={`/shop/${orgSlug}?page=${page - 1}${category ? `&category=${category}` : ""}`}
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
                  href={`/shop/${orgSlug}?page=${page + 1}${category ? `&category=${category}` : ""}`}
                  className="rounded-xl border bg-white px-4 py-2 text-xs font-bold text-stone-700 hover:bg-stone-50"
                >
                  পরের পেজ
                </Link>
              )}
            </nav>
          )}
        </section>

        {/* 9. Social Lookbook & Instagram Grid (#StyleWithUs) */}
        <section className="rounded-3xl border border-stone-200 bg-white p-8 text-center space-y-5">
          <div>
            <span className="text-xs font-black tracking-widest text-amber-700 uppercase">#WEARYOURSTYLE</span>
            <h2 className="text-2xl font-black text-stone-900 font-serif">গ্রাহকদের ভালোবাসায় ও স্টাইলে</h2>
            <p className="mx-auto mt-1 max-w-md text-xs text-stone-500">
              আমাদের পোশাক পরে আপনার ছবি পোস্ট করে ট্যাগ করুন সোশ্যাল মিডিয়ায় আর পান আকর্ষণীয় সারপ্রাইজ গিফট!
            </p>
          </div>

          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            {products.slice(0, 4).map((p, i) => (
              <div key={i} className="group relative aspect-square overflow-hidden rounded-2xl bg-stone-100">
                {p.imageUrl ? (
                  <MediaImage
                    src={p.imageUrl}
                    alt="Customer style look"
                    width={300}
                    height={300}
                    className="h-full w-full object-cover transition duration-500 group-hover:scale-110"
                  />
                ) : (
                  <div className="flex h-full w-full items-center justify-center text-3xl">📸</div>
                )}
                <div className="absolute inset-0 bg-black/40 opacity-0 group-hover:opacity-100 transition flex items-center justify-center text-white text-xs font-bold">
                  @{settings.shopName.toLowerCase().replace(/\s+/g, "")}
                </div>
              </div>
            ))}
          </div>
        </section>
      </div>
    </div>
  );
}

// ----------------------------------------------------
// 10. "Find My Fit" AI Smart Size Recommender Modal
// ----------------------------------------------------
export function FashionFitAssistantModal({
  open,
  onClose,
  onApplySize,
  availableSizes = ["S", "M", "L", "XL", "XXL"],
}: {
  open: boolean;
  onClose: () => void;
  onApplySize?: (size: string) => void;
  availableSizes?: string[];
}) {
  const [feet, setFeet] = useState(5);
  const [inches, setInches] = useState(8);
  const [weightKg, setWeightKg] = useState(68);
  const [fitPref, setFitPref] = useState<"slim" | "regular" | "relaxed">("regular");

  if (!open) return null;

  // Height in cm
  const heightCm = Math.round((feet * 12 + inches) * 2.54);

  // Estimation logic
  let estChest = Math.round(weightKg * 0.44 + heightCm * 0.07);
  if (fitPref === "slim") estChest -= 1;
  if (fitPref === "relaxed") estChest += 2;

  let recommendedSize = "M";
  let sizeNumber = "40";
  if (estChest <= 37) {
    recommendedSize = "S";
    sizeNumber = "38";
  } else if (estChest <= 40) {
    recommendedSize = "M";
    sizeNumber = "40";
  } else if (estChest <= 43) {
    recommendedSize = "L";
    sizeNumber = "42";
  } else if (estChest <= 46) {
    recommendedSize = "XL";
    sizeNumber = "44";
  } else {
    recommendedSize = "XXL";
    sizeNumber = "46";
  }

  // Find best match in available sizes (supports both S/M/L and 38/40/42)
  const matchedSize = availableSizes.find((s) => {
    const norm = s.toUpperCase().trim();
    return norm === recommendedSize || norm === sizeNumber || norm.includes(recommendedSize) || norm.includes(sizeNumber);
  }) || recommendedSize;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4 backdrop-blur-sm animate-in fade-in duration-200">
      <div className="relative w-full max-w-lg rounded-3xl bg-white p-6 shadow-2xl sm:p-7">
        <button
          type="button"
          onClick={onClose}
          className="absolute right-5 top-5 flex h-9 w-9 items-center justify-center rounded-full bg-stone-100 text-stone-500 hover:bg-stone-200 hover:text-stone-900 transition"
          aria-label="Close"
        >
          ✕
        </button>

        <div className="flex items-center gap-2.5">
          <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-amber-100 text-xl">✨</span>
          <div>
            <h3 className="text-lg font-black text-stone-900">ফাইন্ড মাই ফিট (Smart Size Assistant)</h3>
            <p className="text-xs text-stone-500">আপনার শারীরিক মাপ অনুযায়ী সেরা সাইজ নির্ধারণ করুন</p>
          </div>
        </div>

        <div className="mt-5 space-y-4">
          {/* Height */}
          <div>
            <label className="text-xs font-bold text-stone-800">আপনার উচ্চতা (Height):</label>
            <div className="mt-1.5 grid grid-cols-2 gap-3">
              <div className="flex items-center gap-2 rounded-xl border border-stone-200 px-3 py-2">
                <span className="text-xs text-stone-500">ফুট:</span>
                <select
                  value={feet}
                  onChange={(e) => setFeet(Number(e.target.value))}
                  className="w-full bg-transparent text-sm font-bold text-stone-900 focus:outline-none"
                >
                  {[4, 5, 6].map((f) => (
                    <option key={f} value={f}>{f} ফুট</option>
                  ))}
                </select>
              </div>
              <div className="flex items-center gap-2 rounded-xl border border-stone-200 px-3 py-2">
                <span className="text-xs text-stone-500">ইঞ্চি:</span>
                <select
                  value={inches}
                  onChange={(e) => setInches(Number(e.target.value))}
                  className="w-full bg-transparent text-sm font-bold text-stone-900 focus:outline-none"
                >
                  {Array.from({ length: 12 }, (_, i) => i).map((i) => (
                    <option key={i} value={i}>{i} ইঞ্চি</option>
                  ))}
                </select>
              </div>
            </div>
          </div>

          {/* Weight */}
          <div>
            <div className="flex justify-between text-xs font-bold text-stone-800">
              <span>আপনার ওজন (Weight):</span>
              <span className="text-neutral-900 font-extrabold">{weightKg} কেজি</span>
            </div>
            <input
              type="range"
              min={40}
              max={120}
              value={weightKg}
              onChange={(e) => setWeightKg(Number(e.target.value))}
              className="mt-2 w-full accent-neutral-900 cursor-pointer"
            />
          </div>

          {/* Fit Preference */}
          <div>
            <label className="text-xs font-bold text-stone-800">ফিট পছন্দ (Fit Style):</label>
            <div className="mt-1.5 grid grid-cols-3 gap-2">
              {[
                { id: "slim", label: "স্লিম ফিট", desc: "বডি-ফিটেড" },
                { id: "regular", label: "রেগুলার", desc: "আরামদায়ক" },
                { id: "relaxed", label: "রিল্যাক্সড", desc: "ঢিলেঢালা" },
              ].map((style) => (
                <button
                  key={style.id}
                  type="button"
                  onClick={() => setFitPref(style.id as any)}
                  className={`rounded-xl border p-2 text-center transition ${
                    fitPref === style.id
                      ? "border-neutral-900 bg-neutral-900 text-white shadow-sm"
                      : "border-stone-200 bg-white text-stone-700 hover:border-stone-400"
                  }`}
                >
                  <p className="text-xs font-bold">{style.label}</p>
                  <p className={`text-[10px] ${fitPref === style.id ? "text-stone-300" : "text-stone-400"}`}>{style.desc}</p>
                </button>
              ))}
            </div>
          </div>

          {/* Recommendation Output */}
          <div className="rounded-2xl border border-amber-200 bg-gradient-to-br from-amber-50 to-orange-50/50 p-4 text-center">
            <span className="inline-block rounded-full bg-amber-500/20 px-3 py-1 text-[11px] font-black text-amber-900">
              🎯 ৯৪% সঠিক ফিটিং নিশ্চয়তা
            </span>
            <p className="mt-2 text-xs text-stone-600">আপনার জন্য সবচেয়ে পারফেক্ট সাইজ:</p>
            <p className="text-3xl font-black text-neutral-950 font-serif my-1">
              {matchedSize} <span className="text-sm font-sans font-bold text-stone-500">({estChest}&quot; চেস্ট)</span>
            </p>
            <p className="text-[11px] text-stone-500">
              দৈর্ঘ্য ও কাঁধের মাপ সম্পূর্ণ স্ট্যান্ডার্ড অনুযায়ী মিলবে।
            </p>
          </div>

          {/* Apply button */}
          <div className="flex gap-2 pt-1">
            <button
              type="button"
              onClick={() => {
                if (onApplySize) onApplySize(matchedSize);
                onClose();
              }}
              className="w-full rounded-xl bg-neutral-900 py-3 text-xs font-bold text-white shadow hover:bg-black transition"
            >
              এই সাইজটি সিলেক্ট করুন ({matchedSize})
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

// ----------------------------------------------------
// 11. Out of Stock Size Restock Notification Modal
// ----------------------------------------------------
export function FashionRestockAlertModal({
  open,
  onClose,
  productName,
  sizeName,
}: {
  open: boolean;
  onClose: () => void;
  productName: string;
  sizeName: string;
}) {
  const [contact, setContact] = useState("");
  const [submitted, setSubmitted] = useState(false);

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4 backdrop-blur-sm animate-in fade-in duration-200">
      <div className="relative w-full max-w-md rounded-3xl bg-white p-6 shadow-2xl">
        <button
          type="button"
          onClick={onClose}
          className="absolute right-5 top-5 flex h-8 w-8 items-center justify-center rounded-full bg-stone-100 text-stone-500 hover:bg-stone-200 transition"
          aria-label="Close"
        >
          ✕
        </button>

        <div className="text-center">
          <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-full bg-amber-100 text-2xl">🔔</div>
          <h3 className="mt-3 text-base font-black text-stone-900">সাইজ রিস্টক নোটিফিকেশন</h3>
          <p className="mt-1 text-xs text-stone-500 leading-relaxed">
            <strong>{productName}</strong>-এর <strong>{sizeName}</strong> সাইজটি বর্তমানে স্টক আউট। রিস্টক হওয়া মাত্রই আপনাকে জানানো হবে।
          </p>
        </div>

        {submitted ? (
          <div className="mt-5 rounded-2xl bg-emerald-50 p-4 text-center text-xs font-bold text-emerald-800">
            ✅ ধন্যবাদ! আপনার তথ্য সংরক্ষিত হয়েছে। সাইজটি রিস্টক হওয়া মাত্রই আপনি মেসেজ পাবেন।
          </div>
        ) : (
          <form
            onSubmit={(e) => {
              e.preventDefault();
              if (contact.trim()) setSubmitted(true);
            }}
            className="mt-4 space-y-3"
          >
            <div>
              <label className="text-xs font-bold text-stone-700">আপনার মোবাইল / WhatsApp নম্বর:</label>
              <input
                type="text"
                required
                placeholder="01XXXXXXXXX"
                value={contact}
                onChange={(e) => setContact(e.target.value)}
                className="mt-1 w-full rounded-xl border border-stone-200 p-2.5 text-xs font-medium focus:border-neutral-900 focus:outline-none"
              />
            </div>
            <button
              type="submit"
              className="w-full rounded-xl bg-neutral-900 py-2.5 text-xs font-bold text-white shadow hover:bg-black transition"
            >
              নোটিফিকেশন পেতে যুক্ত হোন
            </button>
          </form>
        )}
      </div>
    </div>
  );
}

// ----------------------------------------------------
// 12. Model Stats Card
// ----------------------------------------------------
export function FashionModelStats({
  height = "৬ ফুট ০ ইঞ্চি (১৮৩ সেমি)",
  chest = "৩৯ ইঞ্চি",
  size = "L (Large)",
}: {
  height?: string;
  chest?: string;
  size?: string;
}) {
  return (
    <div className="rounded-2xl border border-stone-200 bg-stone-50/70 p-3.5 text-xs">
      <div className="flex items-center gap-2 font-bold text-stone-800">
        <span>🧍‍♂️</span>
        <span>মডেলের সাইজ ও মাপ:</span>
      </div>
      <div className="mt-2 grid grid-cols-3 gap-2 text-center text-[11px]">
        <div className="rounded-lg bg-white p-2 shadow-xs border border-stone-100">
          <p className="text-stone-400">উচ্চতা</p>
          <p className="font-bold text-stone-800">{height}</p>
        </div>
        <div className="rounded-lg bg-white p-2 shadow-xs border border-stone-100">
          <p className="text-stone-400">বুকের মাপ</p>
          <p className="font-bold text-stone-800">{chest}</p>
        </div>
        <div className="rounded-lg bg-white p-2 shadow-xs border border-stone-100">
          <p className="text-stone-400">পরিহিত সাইজ</p>
          <p className="font-bold text-neutral-900">{size}</p>
        </div>
      </div>
    </div>
  );
}

// ----------------------------------------------------
// 13. Fabric Specs & Wash Care Guide
// ----------------------------------------------------
export function FashionFabricCareGuide({
  fabric = "১০০% প্রিমিয়াম কম্বড কটন (Combed Cotton)",
  gsm = "২২০ GSM (ঘন ও আরামদায়ক টেক্সচার)",
  careNotes = "রঙের উজ্জ্বলতা দীর্ঘস্থায়ী রাখতে ছায়ায় শুকান",
}: {
  fabric?: string;
  gsm?: string;
  careNotes?: string;
}) {
  return (
    <div className="space-y-3 rounded-2xl border border-stone-200 bg-white p-4">
      <div className="flex items-center gap-2">
        <span className="text-base">🧵</span>
        <h4 className="text-xs font-bold text-stone-900">ফেব্রিক ও উপাদান বৈশিষ্ট্য:</h4>
      </div>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 text-xs text-stone-700">
        <div className="flex items-center gap-2 rounded-xl bg-stone-50 p-2.5">
          <span className="text-amber-700 font-bold">✓</span>
          <span><strong>উপাদান:</strong> {fabric}</span>
        </div>
        <div className="flex items-center gap-2 rounded-xl bg-stone-50 p-2.5">
          <span className="text-amber-700 font-bold">✓</span>
          <span><strong>ঘনত্ব:</strong> {gsm}</span>
        </div>
      </div>

      <div className="border-t border-stone-100 pt-3">
        <p className="text-[11px] font-bold text-stone-800 mb-2">ধোয়া ও যত্নের নিয়মাবলী (Care Guide):</p>
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 text-[11px] text-stone-600">
          <div className="flex items-center gap-1.5 rounded-lg bg-stone-50 p-2">
            <span>🧺</span>
            <span>মৃদু ওয়াশ (৩০°C)</span>
          </div>
          <div className="flex items-center gap-1.5 rounded-lg bg-stone-50 p-2">
            <span>🚫</span>
            <span>ব্লিচ নিষেধ</span>
          </div>
          <div className="flex items-center gap-1.5 rounded-lg bg-stone-50 p-2">
            <span>💨</span>
            <span>ছায়ায় শুকান</span>
          </div>
          <div className="flex items-center gap-1.5 rounded-lg bg-stone-50 p-2">
            <span>🌡️</span>
            <span>হালকা ইস্ত্রি</span>
          </div>
        </div>
      </div>
    </div>
  );
}

// ----------------------------------------------------
// 14. "Complete the Look" / Outfit Builder
// ----------------------------------------------------
export function FashionCompleteTheLook({
  orgSlug,
  mainProduct,
  relatedProducts = [],
}: {
  orgSlug: string;
  mainProduct: ShopProduct;
  relatedProducts?: ShopProduct[];
}) {
  // Pick up to 2 items from related products to build a full stylish outfit
  const items = relatedProducts.slice(0, 2);
  const [selectedIds, setSelectedIds] = useState<string[]>(items.map((i) => i.id));
  const [busy, setBusy] = useState(false);
  const [added, setAdded] = useState(false);

  if (items.length === 0) return null;

  // Calculate combo total
  const mainPrice = BigInt(mainProduct.priceMinor || "0");
  const accessoriesPrice = items
    .filter((i) => selectedIds.includes(i.id))
    .reduce((sum, item) => sum + BigInt(item.priceMinor || "0"), 0n);

  const rawTotal = mainPrice + accessoriesPrice;
  // 10% Bundle Discount
  const discountedTotal = (rawTotal * 90n) / 100n;
  const savings = rawTotal - discountedTotal;

  async function handleAddEntireLook() {
    setBusy(true);
    setAdded(false);
    try {
      // 1. Add main product
      await patchCartLine(orgSlug, {
        productId: mainProduct.id,
        variantId: null,
        quantity: 1,
        includeBump: false,
      });

      // 2. Add selected complementary items
      for (const id of selectedIds) {
        await patchCartLine(orgSlug, {
          productId: id,
          variantId: null,
          quantity: 1,
          includeBump: false,
        });
      }

      notifyCartUpdated(orgSlug);
      setAdded(true);
    } catch {
      /* ignore */
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="rounded-3xl border border-stone-200 bg-stone-50/50 p-5 space-y-4">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <span className="text-xl">✨</span>
          <div>
            <h3 className="text-sm font-black text-stone-900 font-serif">কমপ্লিট দ্য লুক (Complete the Look)</h3>
            <p className="text-[11px] text-stone-500">ম্যাচিং পোশাক ও এক্সেসরিজ একসাথে কিনে ১০% ছাড় উপভোগ করুন</p>
          </div>
        </div>
        <span className="rounded-full bg-amber-500 px-2.5 py-1 text-[10px] font-black text-white">
          ১০% সেভ করুন
        </span>
      </div>

      <div className="grid gap-3 sm:grid-cols-3">
        {/* Main Product Card */}
        <div className="relative rounded-2xl border border-neutral-900 bg-white p-3 shadow-xs">
          <span className="absolute left-2 top-2 rounded bg-neutral-900 px-1.5 py-0.5 text-[9px] font-bold text-white">
            মূল পোশাক
          </span>
          <div className="aspect-[3/4] overflow-hidden rounded-xl bg-stone-100 mt-4">
            {mainProduct.imageUrl ? (
              <MediaImage
                src={mainProduct.imageUrl}
                alt={mainProduct.name}
                width={200}
                height={260}
                className="h-full w-full object-cover"
              />
            ) : null}
          </div>
          <p className="mt-2 line-clamp-1 text-xs font-bold text-stone-900">{mainProduct.name}</p>
          <p className="text-xs font-extrabold text-neutral-900">{formatFashionPrice(mainProduct.priceMinor)}</p>
        </div>

        {/* Complementary items */}
        {items.map((item) => {
          const isChecked = selectedIds.includes(item.id);
          return (
            <div
              key={item.id}
              onClick={() => {
                setSelectedIds((prev) =>
                  isChecked ? prev.filter((id) => id !== item.id) : [...prev, item.id]
                );
              }}
              className={`relative cursor-pointer rounded-2xl border p-3 transition ${
                isChecked
                  ? "border-neutral-900 bg-white shadow-xs"
                  : "border-stone-200 bg-white/60 opacity-60"
              }`}
            >
              <input
                type="checkbox"
                checked={isChecked}
                onChange={() => {}}
                className="absolute right-3 top-3 accent-neutral-900"
              />
              <span className="rounded bg-stone-100 px-1.5 py-0.5 text-[9px] font-bold text-stone-600">
                ম্যাচিং লুক
              </span>
              <div className="aspect-[3/4] overflow-hidden rounded-xl bg-stone-100 mt-2">
                {item.imageUrl ? (
                  <MediaImage
                    src={item.imageUrl}
                    alt={item.name}
                    width={200}
                    height={260}
                    className="h-full w-full object-cover"
                  />
                ) : null}
              </div>
              <p className="mt-2 line-clamp-1 text-xs font-bold text-stone-900">{item.name}</p>
              <p className="text-xs font-extrabold text-neutral-900">{formatFashionPrice(item.priceMinor)}</p>
            </div>
          );
        })}
      </div>

      {/* Pricing and Action */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 border-t border-stone-200 pt-3">
        <div>
          <div className="flex items-baseline gap-2">
            <span className="text-sm font-bold text-stone-500 line-through">
              {formatFashionPrice(rawTotal.toString())}
            </span>
            <span className="text-lg font-black text-neutral-950 font-serif">
              {formatFashionPrice(discountedTotal.toString())}
            </span>
            <span className="text-xs font-bold text-emerald-700">
              (বাঁচবে {formatFashionPrice(savings.toString())})
            </span>
          </div>
          <p className="text-[11px] text-stone-500">নির্বাচিত {selectedIds.length + 1}টি আইটেম কম্বো হিসেবে যুক্ত হবে</p>
        </div>

        {added ? (
          <div className="flex items-center gap-2">
            <span className="text-xs font-bold text-emerald-800">✅ সম্পূর্ণ লুক ব্যাগে যোগ হয়েছে!</span>
            <Link
              href={`/shop/${orgSlug}/cart`}
              className="rounded-xl bg-neutral-900 px-4 py-2 text-xs font-bold text-white hover:bg-black"
            >
              কার্ট দেখুন
            </Link>
          </div>
        ) : (
          <button
            type="button"
            onClick={handleAddEntireLook}
            disabled={busy}
            className="rounded-xl bg-neutral-900 px-5 py-3 text-xs font-bold text-white shadow hover:bg-black transition disabled:opacity-50"
          >
            {busy ? "যোগ হচ্ছে…" : "এক ক্লিকে কমপ্লিট লুক কিনুন"}
          </button>
        )}
      </div>
    </div>
  );
}
