"use client";
import React, { useMemo, useState } from "react";
import Link from "next/link";
import { formatMinor } from "@repo/contracts";
import type { ShopProduct } from "@/lib/storefront-server";
import { fetchCart, patchCartLine } from "@/lib/storefront-cart";
import { shopT, type ShopLocale } from "@/lib/shop-i18n";
import { priceText, stockBadge } from "../../ProductCard";
import { WishlistHeart } from "../../WishlistHeart";
import { MediaImage } from "@/components/media-image";
import { StockAlertForm } from "../../StockAlertForm";

export function ProductDetailClient({ orgSlug, product, locale = "bn" }: { orgSlug: string; product: ShopProduct; locale?: ShopLocale | string }) {
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
  const [includeBump, setIncludeBump] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [added, setAdded] = useState(false);

  const variant = product.variants.find((v) => v.id === variantId) ?? null;
  const unitMinor = variant?.priceMinor ?? product.priceMinor;
  const stockState = variant ? variant.stockState : product.stockState;
  // EC24a: preorder products are orderable at zero stock.
  const outOfStock = stockState === "out_of_stock" && !product.preorder;
  const badge = stockBadge(stockState, locale);

  async function addToCart() {
    setBusy(true);
    setError("");
    setAdded(false);
    try {
      // PATCH sets the line's absolute quantity — merge with any
      // existing line for the same product/variant first.
      const cart = await fetchCart(orgSlug);
      const existing = cart?.items.find(
        (i) => i.productId === product.id && (i.variantId ?? null) === (variantId || null),
      );
      const nextQty = Math.min(99, (existing?.quantity ?? 0) + quantity);
      await patchCartLine(orgSlug, {
        productId: product.id,
        variantId: variantId || null,
        quantity: nextQty,
        includeBump,
      });
      setAdded(true);
    } catch (e) {
      setError(e instanceof Error ? e.message : t.product.addToCartError);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="grid gap-6 md:grid-cols-2">
      {/* Gallery */}
      <div className="space-y-3">
        <div className="overflow-hidden rounded-3xl border border-slate-200 bg-white">
          {image ? (
            <MediaImage src={image} alt={product.name} width={1200} height={1200} priority sizes="(max-width: 768px) 100vw, 600px" className="aspect-square w-full object-cover" />
          ) : (
            <div className="flex aspect-square w-full items-center justify-center bg-indigo-50 text-7xl">📦</div>
          )}
        </div>
        {images.length > 1 ? (
          <div className="flex flex-wrap gap-2">
            {images.map((src) => (
              <button
                key={src}
                type="button"
                onClick={() => setImage(src)}
                className={`h-16 w-16 overflow-hidden rounded-xl border-2 ${src === image ? "border-indigo-600" : "border-slate-200"}`}
              >
                <MediaImage src={src} alt="" width={160} height={160} className="h-full w-full object-cover" />
              </button>
            ))}
          </div>
        ) : null}
      </div>

      {/* Buy panel */}
      <div className="space-y-4 rounded-3xl border border-slate-200 bg-white p-6 shadow-sm">
        <div>
          <h1 className="text-2xl font-black text-slate-900">{product.name}</h1>
          <div className="mt-2 flex flex-wrap items-center gap-2">
            <span className="text-2xl font-extrabold text-indigo-700">{priceText(unitMinor)}</span>
            {product.compareAtMinor && !variant ? (
              <span className="text-sm text-slate-400 line-through">{priceText(product.compareAtMinor)}</span>
            ) : null}
            {badge ? <span className={`rounded-full px-2 py-0.5 text-[11px] font-bold ${badge.cls}`}>{badge.label}</span> : null}
            {product.preorder ? (
              <span className="rounded-full bg-violet-100 px-2 py-0.5 text-[11px] font-bold text-violet-700">
                প্রি-অর্ডার{product.preorder.releaseDate ? ` · ${new Date(product.preorder.releaseDate).toLocaleDateString("bn-BD")}` : ""}
              </span>
            ) : null}
            {product.digital ? (
              <span className="rounded-full bg-sky-100 px-2 py-0.5 text-[11px] font-bold text-sky-700">ডিজিটাল পণ্য</span>
            ) : null}
          </div>
          {product.sku ? <p className="mt-1 text-[11px] text-slate-400">SKU: {product.sku}</p> : null}
        </div>

        {product.description ? <p className="whitespace-pre-line text-sm leading-relaxed text-slate-600">{product.description}</p> : null}

        {product.variants.length > 0 ? (
          <div>
            <label className="mb-1.5 block text-xs font-bold text-slate-700" htmlFor="variant">{t.product.variantLabel}</label>
            <select
              id="variant"
              value={variantId}
              onChange={(e) => setVariantId(e.target.value)}
              className="w-full rounded-xl border border-slate-300 p-2.5 text-sm focus:border-indigo-600 focus:outline-none"
            >
              <option value="">{t.product.defaultVariant}</option>
              {product.variants.map((v) => (
                <option key={v.id} value={v.id} disabled={v.stockState === "out_of_stock"}>
                  {v.name}
                  {v.priceMinor ? ` — ${priceText(v.priceMinor)}` : ""}
                  {v.stockState === "out_of_stock" ? ` (${t.product.outOfStock})` : v.stockState === "low" ? ` (${t.product.lowStock})` : ""}
                </option>
              ))}
            </select>
            {variant ? (
              <p className="mt-1 text-[11px] text-slate-500">
                {t.product.selected} <b>{variant.name}</b> — {priceText(variant.priceMinor ?? product.priceMinor)}
              </p>
            ) : null}
          </div>
        ) : null}

        <div className="flex items-center justify-between border-y py-3">
          <span className="text-xs font-bold text-slate-700">{t.product.quantity}</span>
          <div className="flex items-center overflow-hidden rounded-lg border">
            <button type="button" onClick={() => setQuantity(Math.max(1, quantity - 1))} className="bg-slate-50 px-3 py-1 font-bold text-slate-600 hover:bg-slate-100">−</button>
            <span className="px-4 py-1 text-sm font-bold text-slate-900">{quantity}</span>
            <button type="button" onClick={() => setQuantity(Math.min(99, quantity + 1))} className="bg-slate-50 px-3 py-1 font-bold text-slate-600 hover:bg-slate-100">+</button>
          </div>
        </div>

        {product.bump ? (
          <label
            className={`flex cursor-pointer items-start gap-2.5 rounded-xl border p-3.5 transition ${includeBump ? "border-amber-500 bg-amber-50/70 ring-2 ring-amber-400" : "border-dashed border-amber-300 bg-amber-50/20"}`}
          >
            <input type="checkbox" checked={includeBump} onChange={(e) => setIncludeBump(e.target.checked)} className="mt-0.5" />
            <span className="space-y-1">
              <span className="flex flex-wrap items-center gap-1.5">
                <span className="rounded bg-amber-500 px-1.5 py-0.5 text-[10px] font-bold text-white">{t.product.bumpBadge}</span>
                <span className="text-xs font-bold text-slate-900">{product.bump.title}</span>
              </span>
              <span className="block text-[11px] font-bold text-amber-900">
                {t.product.bumpExtraPrefix}{formatMinor(BigInt(product.bump.priceMinor))}{t.product.bumpExtraSuffix}
              </span>
            </span>
          </label>
        ) : null}

        <div className="flex items-center gap-2">
          <span className="text-xs font-bold text-slate-700">{t.common.wishlist}:</span>
          <WishlistHeart orgSlug={orgSlug} productId={product.id} locale={locale} />
        </div>

        {error ? <p className="rounded-lg bg-rose-50 px-3 py-2 text-xs font-medium text-rose-700">{error}</p> : null}

        {added ? (
          <div className="space-y-2 rounded-xl bg-emerald-50 p-3 text-center">
            <p className="text-sm font-bold text-emerald-800">{t.product.added}</p>
            <div className="flex justify-center gap-2">
              <Link href={`/shop/${orgSlug}/cart`} className="rounded-lg bg-white px-4 py-2 text-xs font-bold text-slate-700 border">{t.product.viewCart}</Link>
              <Link href={`/shop/${orgSlug}/checkout`} className="rounded-lg bg-indigo-600 px-4 py-2 text-xs font-bold text-white">{t.product.checkoutNow}</Link>
            </div>
          </div>
        ) : (
          <button
            type="button"
            onClick={addToCart}
            disabled={busy || outOfStock}
            className="w-full rounded-2xl bg-indigo-600 py-3.5 text-sm font-extrabold text-white shadow-lg shadow-indigo-600/30 transition hover:bg-indigo-700 disabled:opacity-50"
          >
            {outOfStock ? t.product.outOfStockOrder : busy ? t.product.adding : t.product.addToCart}
          </button>
        )}
        <p className="text-center text-[11px] text-slate-400">{t.product.priceNote}</p>

        {/* EC28: back-in-stock alert — only while actually out of stock. */}
        {outOfStock ? (
          <StockAlertForm
            orgSlug={orgSlug}
            productId={product.id}
            variantSku={variant?.sku ?? null}
            locale={locale}
          />
        ) : null}
      </div>
    </div>
  );
}
