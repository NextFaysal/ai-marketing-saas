"use client";
import React, { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import type { ShopProduct } from "@/lib/storefront-server";
import { fetchCart, patchCartLine } from "@/lib/storefront-cart";
import { shopT, type ShopLocale } from "@/lib/shop-i18n";
import { priceText, stockBadge } from "./ProductCard";

export function QuickViewButton({
  orgSlug,
  product,
  locale = "bn",
}: {
  orgSlug: string;
  product: ShopProduct;
  locale?: ShopLocale | string;
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
        className="absolute bottom-2.5 right-2.5 z-10 flex items-center gap-1 rounded-full bg-white/95 px-2.5 py-1.5 text-[11px] font-bold text-slate-800 shadow-md transition hover:bg-white"
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
                // eslint-disable-next-line @next/next/no-img-element
                <img src={image} alt={product.name} className="aspect-square w-full object-cover" />
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
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img src={src} alt="" className="h-full w-full object-cover" />
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
              <div>
                <label className="mb-1.5 block text-xs font-bold text-slate-700">{t.product.variantLabel}</label>
                <select
                  value={variantId}
                  onChange={(e) => setVariantId(e.target.value)}
                  className="w-full rounded-xl border border-slate-300 p-2.5 text-sm focus:border-indigo-600 focus:outline-none"
                >
                  <option value="">{t.product.defaultVariant}</option>
                  {product.variants.map((v) => (
                    <option key={v.id} value={v.id} disabled={v.stockState === "out_of_stock"}>
                      {v.name}
                      {v.priceMinor ? ` — ${priceText(v.priceMinor)}` : ""}
                      {v.stockState === "out_of_stock" ? ` (${t.product.outOfStock})` : ""}
                    </option>
                  ))}
                </select>
              </div>
            ) : null}
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
                  <Link href={`/shop/${orgSlug}/checkout`} className="rounded-lg bg-indigo-600 px-4 py-2 text-xs font-bold text-white">{t.product.checkoutNow}</Link>
                </div>
              </div>
            ) : (
              <button
                type="button"
                onClick={addToCart}
                disabled={busy || outOfStock}
                className="w-full rounded-xl bg-indigo-600 py-3 text-sm font-extrabold text-white disabled:opacity-50"
              >
                {outOfStock ? t.product.outOfStockOrder : busy ? t.product.adding : t.product.addToCart}
              </button>
            )}
            {product.slug ? (
              <Link href={`/shop/${orgSlug}/products/${product.slug}`} className="block text-center text-xs font-bold text-indigo-700 hover:underline">
                {t.product.fullDetails} →
              </Link>
            ) : null}
          </div>
        </div>
      </div>
    </div>
  );
}
