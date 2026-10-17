"use client";
import React, { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import type { ShopProduct } from "@/lib/storefront-server";
import { fetchCart, patchCartLine } from "@/lib/storefront-cart";
import { shopT, type ShopLocale } from "@/lib/shop-i18n";
import { priceText, stockBadge } from "./ProductCard";
import { FashionSizeGuideModal, FashionFitAssistantModal } from "./FashionTheme";
import { MediaImage } from "@/components/MediaImage";

export function QuickViewButton({
  orgSlug,
  product,
  locale = "bn",
  large = false,
}: {
  orgSlug: string;
  product: ShopProduct;
  locale?: ShopLocale | string;
  /** ED8: v2 cards only — enlarges the hit area to ≥44px tall.
   * Default false renders exactly as before. */
  large?: boolean;
}) {
  const t = shopT(locale);
  const [open, setOpen] = useState(false);
  return (
    <>
      <button
        type="button"
        aria-label={t.product.quickView}
        title={t.product.quickView}
        onClick={(e) => {
          e.preventDefault();
          e.stopPropagation();
          setOpen(true);
        }}
        className={`absolute bottom-2.5 right-2.5 z-10 flex items-center gap-1 rounded-full bg-white/95 text-[11px] font-bold text-slate-800 shadow-md transition hover:bg-white ${large ? "min-h-11 px-3.5 py-3" : "px-2.5 py-1.5"}`}
      >
        <span aria-hidden="true">👁️</span>
        <span className="hidden sm:inline">{t.product.quickView}</span>
      </button>
      {open ? <QuickView orgSlug={orgSlug} product={product} locale={locale} onClose={() => setOpen(false)} /> : null}
    </>
  );
}

export function QuickView({
  orgSlug,
  product,
  locale = "bn",
  onClose,
}: {
  orgSlug: string;
  product: ShopProduct;
  locale?: ShopLocale | string;
  onClose: () => void;
}) {
  const t = shopT(locale);
  const [sizeGuideOpen, setSizeGuideOpen] = useState(false);
  const [fitModalOpen, setFitModalOpen] = useState(false);
  const images = useMemo(() => {
    const list: string[] = [];
    for (const src of product.images ?? []) if (src && !list.includes(src)) list.push(src);
    if (product.imageUrl && !list.includes(product.imageUrl)) list.unshift(product.imageUrl);
    return list;
  }, [product]);

  const [image, setImage] = useState(images[0] ?? "");
  const [variantId, setVariantId] = useState<string>("");
  const [quantity, setQuantity] = useState(1);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [added, setAdded] = useState(false);

  const variant = product.variants.find((v) => v.id === variantId) ?? null;
  const unitMinor = variant?.priceMinor ?? product.priceMinor;
  const stockState = variant ? variant.stockState : product.stockState;
  const outOfStock = stockState === "out_of_stock" && !product.preorder;
  const badge = stockBadge(stockState, locale);

  useEffect(() => {
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => {
      document.body.style.overflow = prev;
      window.removeEventListener("keydown", onKey);
    };
  }, [onClose]);

  async function addToCart() {
    setBusy(true);
    setError("");
    setAdded(false);
    try {
      const cart = await fetchCart(orgSlug);
      const existing = cart?.items.find(
        (i) => i.productId === product.id && (i.variantId ?? null) === (variantId || null),
      );
      const nextQty = Math.min(99, (existing?.quantity ?? 0) + quantity);
      await patchCartLine(orgSlug, {
        productId: product.id,
        variantId: variantId || null,
        quantity: nextQty,
        includeBump: false,
      });
      setAdded(true);
    } catch (e) {
      setError(e instanceof Error ? e.message : t.product.addToCartError);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4" onClick={onClose}>
      <div
        role="dialog"
        aria-modal="true"
        aria-label={product.name}
        className="relative max-h-[90vh] w-full max-w-3xl overflow-y-auto rounded-2xl bg-white shadow-xl"
        onClick={(e) => e.stopPropagation()}
      >
        <button
          type="button"
          onClick={onClose}
          aria-label={t.popup.close}
          className="absolute right-3 top-3 z-10 flex h-8 w-8 items-center justify-center rounded-full bg-white/90 text-lg font-bold text-slate-700 shadow"
        >
          ×
        </button>
        <div className="grid gap-5 p-5 sm:grid-cols-2">
          <div className="space-y-3">
            <div className="overflow-hidden rounded-2xl border border-slate-200">
              {image ? (
                <MediaImage src={image} alt={product.name} width={640} height={640} sizes="(max-width: 640px) 90vw, 400px" className="aspect-square w-full object-cover" />
              ) : (
                <div className="flex aspect-square w-full items-center justify-center bg-indigo-50 text-6xl">📦</div>
              )}
            </div>
            {images.length > 1 ? (
              <div className="flex flex-wrap gap-2">
                {images.map((src) => (
                  <button
                    key={src}
                    type="button"
                    onClick={() => setImage(src)}
                    className={`h-14 w-14 overflow-hidden rounded-lg border-2 ${src === image ? "border-indigo-600" : "border-slate-200"}`}
                  >
                    <MediaImage src={src} alt="" width={160} height={160} className="h-full w-full object-cover" />
                  </button>
                ))}
              </div>
            ) : null}
          </div>
          <div className="space-y-4">
            <div>
              <h3 className="text-xl font-black text-slate-900">{product.name}</h3>
              <div className="mt-2 flex flex-wrap items-center gap-2">
                <span className="text-xl font-extrabold text-indigo-700">{priceText(unitMinor)}</span>
                {product.compareAtMinor && !variant ? (
                  <span className="text-sm text-slate-400 line-through">{priceText(product.compareAtMinor)}</span>
                ) : null}
                {badge ? <span className={`rounded-full px-2 py-0.5 text-[11px] font-bold ${badge.cls}`}>{badge.label}</span> : null}
              </div>
            </div>
            {product.description ? <p className="line-clamp-4 whitespace-pre-line text-sm text-slate-600">{product.description}</p> : null}
            {product.variants.length > 0 ? (
              <div className="space-y-2">
                <div className="flex flex-wrap items-center justify-between gap-1">
                  <label className="text-xs font-bold text-slate-700">{t.product.variantLabel}</label>
                  <div className="flex items-center gap-2">
                    <button
                      type="button"
                      onClick={() => setFitModalOpen(true)}
                      className="text-[11px] font-bold text-amber-800 bg-amber-50 px-2 py-0.5 rounded-full border border-amber-200 hover:bg-amber-100"
                    >
                      ✨ সাইজ ফাইন্ডার
                    </button>
                    <button
                      type="button"
                      onClick={() => setSizeGuideOpen(true)}
                      className="flex items-center gap-1 text-[11px] font-bold text-indigo-600 hover:text-indigo-800 underline"
                    >
                      📏 সাইজ গাইড
                    </button>
                  </div>
                </div>
                <div className="flex flex-wrap gap-2">
                  {product.variants.map((v) => {
                    const isSelected = variantId === v.id;
                    const isOut = v.stockState === "out_of_stock";
                    return (
                      <button
                        key={v.id}
                        type="button"
                        disabled={isOut}
                        onClick={() => setVariantId(isSelected ? "" : v.id)}
                        className={`rounded-xl border px-3 py-1.5 text-xs font-bold transition ${
                          isSelected
                            ? "border-neutral-900 bg-neutral-900 text-white shadow-sm"
                            : isOut
                            ? "border-slate-200 bg-slate-50 text-slate-300 line-through cursor-not-allowed"
                            : "border-slate-200 bg-white text-slate-800 hover:border-neutral-900"
                        }`}
                      >
                        {v.name}
                        {v.priceMinor && v.priceMinor !== product.priceMinor ? ` (${priceText(v.priceMinor)})` : ""}
                      </button>
                    );
                  })}
                </div>
              </div>
            ) : (
              <div className="flex items-center justify-between rounded-xl bg-stone-50 px-3 py-2 text-xs">
                <span className="text-stone-600">সাইজ নির্ধারণে সহায়তা প্রয়োজন?</span>
                <button
                  type="button"
                  onClick={() => setSizeGuideOpen(true)}
                  className="font-bold text-indigo-600 hover:text-indigo-800 underline"
                >
                  📏 সাইজ চার্ট দেখুন
                </button>
              </div>
            )}
            <div className="flex items-center justify-between border-y py-3">
              <span className="text-xs font-bold text-slate-700">{t.product.quantity}</span>
              <div className="flex items-center overflow-hidden rounded-lg border">
                <button type="button" onClick={() => setQuantity(Math.max(1, quantity - 1))} className="bg-slate-50 px-3 py-1 font-bold text-slate-600">−</button>
                <span className="px-4 py-1 text-sm font-bold text-slate-900">{quantity}</span>
                <button type="button" onClick={() => setQuantity(Math.min(99, quantity + 1))} className="bg-slate-50 px-3 py-1 font-bold text-slate-600">+</button>
              </div>
            </div>
            {error ? <p className="rounded-lg bg-rose-50 px-3 py-2 text-xs font-medium text-rose-700">{error}</p> : null}
            {added ? (
              <div className="space-y-2 rounded-xl bg-emerald-50 p-3 text-center">
                <p className="text-sm font-bold text-emerald-800">{t.product.added}</p>
                <div className="flex justify-center gap-2">
                  <Link href={`/shop/${orgSlug}/cart`} className="rounded-lg border bg-white px-4 py-2 text-xs font-bold text-slate-700">{t.product.viewCart}</Link>
                  <Link href={`/shop/${orgSlug}/checkout`} className="btn-brand rounded-lg px-4 py-2 text-xs font-bold">{t.product.checkoutNow}</Link>
                </div>
              </div>
            ) : (
              <button
                type="button"
                onClick={addToCart}
                disabled={busy || outOfStock}
                className="btn-brand w-full rounded-xl py-3 text-sm font-extrabold disabled:opacity-50"
              >
                {outOfStock ? t.product.outOfStockOrder : busy ? t.product.adding : t.product.addToCart}
              </button>
            )}
            {product.slug ? (
              <Link href={`/shop/${orgSlug}/products/${product.slug}`} className="block text-center text-xs font-bold text-indigo-700 hover:underline">
                {t.product.fullDetails} →
              </Link>
            ) : null}

            <div className="flex flex-wrap items-center justify-center gap-2 pt-2 text-[11px] font-medium text-stone-500">
              <span>🚚 দ্রুততম ডেলিভারি</span>
              <span>·</span>
              <span>🛡️ অফিশিয়াল গ্যারান্টি</span>
              <span>·</span>
              <span>🔄 ৭ দিনের সহজ পরিবর্তন</span>
            </div>
          </div>
        </div>
      </div>
      <FashionSizeGuideModal open={sizeGuideOpen} onClose={() => setSizeGuideOpen(false)} />
      <FashionFitAssistantModal
        open={fitModalOpen}
        onClose={() => setFitModalOpen(false)}
        availableSizes={product.variants.map((v) => v.name)}
        onApplySize={(recSize) => {
          const matched = product.variants.find((v) => {
            const vName = v.name.toUpperCase();
            const rName = recSize.toUpperCase();
            return vName.includes(rName) || rName.includes(vName);
          });
          if (matched) setVariantId(matched.id);
        }}
      />
    </div>
  );
}
