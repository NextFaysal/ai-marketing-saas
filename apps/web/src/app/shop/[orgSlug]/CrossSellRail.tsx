"use client";
import React, { useEffect, useState } from "react";
import { API_URL } from "@/lib/api";
import type { ShopProduct } from "@/lib/storefront-server";
import { shopT, type ShopLocale } from "@/lib/shop-i18n";
import { ProductCard } from "./ProductCard";

/**
 * AB6 (AX14): cart/checkout cross-sell rail — recommendations
 * for the products currently in the cart, from the public
 * recommendations endpoint. Renders nothing when there are no
 * cart products, no recommendations, or the fetch fails.
 * ProductCard carries the normal QuickView add-to-cart path.
 */
export function CrossSellRail({
  orgSlug,
  productIds,
  locale = "bn",
}: {
  orgSlug: string;
  productIds: string[];
  locale?: ShopLocale | string;
}) {
  const t = shopT(locale);
  const [products, setProducts] = useState<ShopProduct[]>([]);
  const idsKey = [...new Set(productIds.filter(Boolean))].join(",");

  useEffect(() => {
    if (!idsKey) { setProducts([]); return; }
    let alive = true;
    (async () => {
      try {
        const res = await fetch(
          `${API_URL}/public/shop/${encodeURIComponent(orgSlug)}/recommendations?context=cart&productIds=${encodeURIComponent(idsKey)}`,
        );
        if (!res.ok) throw new Error("failed");
        const json = (await res.json()) as { products?: ShopProduct[] };
        if (alive) setProducts(Array.isArray(json.products) ? json.products : []);
      } catch {
        if (alive) setProducts([]);
      }
    })();
    return () => { alive = false; };
  }, [orgSlug, idsKey]);

  if (!idsKey || products.length === 0) return null;
  return (
    <section className="space-y-4">
      <h2 className="text-xl font-black text-slate-900">{t.product.crossSell}</h2>
      <div className="grid grid-cols-2 gap-4 md:grid-cols-4">
        {products.map((p) => (
          <ProductCard key={p.id} orgSlug={orgSlug} product={p} locale={locale} />
        ))}
      </div>
    </section>
  );
}
