"use client";
import React, { useEffect, useState } from "react";
import { API_URL } from "@/lib/api";
import { readRecentlyViewedIds, recordRecentlyViewed } from "@/lib/recently-viewed";
import type { ShopProduct } from "@/lib/storefront-server";
import { shopT, type ShopLocale } from "@/lib/shop-i18n";
import { ProductCard } from "./ProductCard";

/**
 * AB6 (AX14) — recently viewed v2 (web-only, localStorage per
 * org slug). Storage holds product IDs ONLY; the strip
 * resolves them LIVE via the shop API (?ids=), so prices and
 * stock are never stale, unresolvable/inactive products are
 * dropped, and a fetch failure renders nothing. No server
 * tracking of views.
 */
export function RecordRecentlyViewed({ orgSlug, productId }: { orgSlug: string; productId: string }) {
  useEffect(() => {
    recordRecentlyViewed(orgSlug, productId);
  }, [orgSlug, productId]);
  return null;
}

export function RecentlyViewedStrip({
  orgSlug,
  locale = "bn",
  excludeId,
}: {
  orgSlug: string;
  locale?: ShopLocale | string;
  excludeId?: string;
}) {
  const t = shopT(locale);
  const [products, setProducts] = useState<ShopProduct[]>([]);
  useEffect(() => {
    let alive = true;
    const ids = readRecentlyViewedIds(orgSlug).filter((id) => id !== excludeId);
    if (ids.length === 0) { setProducts([]); return; }
    (async () => {
      try {
        const res = await fetch(
          `${API_URL}/public/shop/${encodeURIComponent(orgSlug)}?ids=${encodeURIComponent(ids.join(","))}`,
        );
        if (!res.ok) throw new Error("failed");
        const json = (await res.json()) as { products?: ShopProduct[] };
        const live = Array.isArray(json.products) ? json.products : [];
        // Render in stored-id order; ids the API did not
        // resolve (inactive/deleted) are dropped.
        const byId = new Map(live.map((p) => [p.id, p]));
        if (alive) setProducts(ids.map((id) => byId.get(id)).filter((p): p is ShopProduct => !!p));
      } catch {
        if (alive) setProducts([]);
      }
    })();
    return () => { alive = false; };
  }, [orgSlug, excludeId]);
  if (products.length === 0) return null;
  return (
    <section className="space-y-4">
      <h2 className="text-xl font-black text-slate-900">{t.home.recentlyViewed}</h2>
      <div className="grid grid-cols-2 gap-4 md:grid-cols-4">
        {products.map((p) => (
          <ProductCard key={p.id} orgSlug={orgSlug} product={p} locale={locale} />
        ))}
      </div>
    </section>
  );
}
