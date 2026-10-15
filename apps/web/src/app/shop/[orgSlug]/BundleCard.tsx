"use client";
import React, { useState } from "react";
import type { ShopBundle } from "@/lib/storefront-server";
import { fetchCart, patchBundleLine } from "@/lib/storefront-cart";
import { shopT, type ShopLocale } from "@/lib/shop-i18n";
import { priceText } from "./ProductCard";

/**
 * EC29 — bundle card for the shop home strip. One click adds ONE
 * bundle unit (the cart page adjusts quantity afterwards). Prices
 * are the server's bundle payload values — nothing is computed
 * client-side except the savings badge visibility.
 */
export function BundleCard({
  orgSlug,
  bundle,
  locale = "bn",
}: {
  orgSlug: string;
  bundle: ShopBundle;
  locale?: ShopLocale | string;
}) {
  const t = shopT(locale);
  const [busy, setBusy] = useState(false);
  const [added, setAdded] = useState(false);
  const [error, setError] = useState("");

  const savings = (() => {
    if (!bundle.savingsMinor) return null;
    try {
      return BigInt(bundle.savingsMinor) > 0n ? bundle.savingsMinor : null;
    } catch {
      return null;
    }
  })();

  async function add() {
    setBusy(true);
    setError("");
    setAdded(false);
    try {
      // POST cart/bundle sets the line's quantity — read the
      // current cart first so repeated clicks add up, mirroring
      // the product detail page's merge behaviour.
      const cart = await fetchCart(orgSlug);
      const existing = (cart?.bundleItems ?? []).find((i) => i.bundleId === bundle.id);
      await patchBundleLine(orgSlug, { bundleId: bundle.id, quantity: Math.min(99, (existing?.quantity ?? 0) + 1) });
      setAdded(true);
    } catch (e) {
      setError(e instanceof Error ? e.message : t.product.addToCartError);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex flex-col overflow-hidden rounded-2xl border border-amber-200 bg-white shadow-sm">
      <div className="relative">
        {bundle.imageUrl ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={bundle.imageUrl} alt={bundle.name} className="aspect-[4/3] w-full object-cover" />
        ) : (
          <div className="flex aspect-[4/3] w-full items-center justify-center bg-amber-50 text-5xl">🎁</div>
        )}
        {savings ? (
          <span className="absolute left-3 top-3 rounded-full bg-rose-600 px-2.5 py-1 text-[11px] font-bold text-white">
            {t.home.bundleSavingsPrefix} {priceText(savings)}
          </span>
        ) : null}
      </div>
      <div className="flex flex-1 flex-col space-y-2 p-4">
        <h3 className="text-sm font-bold text-slate-900">{bundle.name}</h3>
        {bundle.description ? <p className="line-clamp-2 text-xs text-slate-500">{bundle.description}</p> : null}
        <details className="text-xs text-slate-600">
          <summary className="cursor-pointer font-semibold text-slate-700">{t.home.bundleContents}</summary>
          <ul className="mt-1.5 list-disc space-y-0.5 pl-4">
            {bundle.components.map((c) => (
              <li key={`${c.productId}-${c.variantSku ?? ""}`}>
                {c.name}{c.variantSku ? ` (${c.variantSku})` : ""} × {c.qty}
              </li>
            ))}
          </ul>
        </details>
        <div className="mt-auto space-y-2 pt-1">
          <div className="flex flex-wrap items-baseline gap-2">
            <span className="text-lg font-extrabold text-indigo-700">{priceText(bundle.bundlePriceMinor)}</span>
            <span className="text-xs text-slate-400">
              {t.home.bundleRegularLabel} <span className="line-through">{priceText(bundle.regularTotalMinor)}</span>
            </span>
          </div>
          {error ? <p className="rounded-lg bg-rose-50 px-2 py-1 text-[11px] font-medium text-rose-700">{error}</p> : null}
          <button
            type="button"
            onClick={add}
            disabled={busy}
            className="w-full rounded-xl bg-amber-500 py-2.5 text-sm font-extrabold text-white shadow hover:bg-amber-600 disabled:opacity-50"
          >
            {busy ? t.home.bundleAdding : added ? t.home.bundleAdded : t.home.bundleAddToCart}
          </button>
        </div>
      </div>
    </div>
  );
}
