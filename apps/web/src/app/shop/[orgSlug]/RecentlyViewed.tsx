"use client";
import React, { useEffect, useState } from "react";
import { readRecentlyViewed, recordRecentlyViewed, type RecentlyViewedCard } from "@/lib/recently-viewed";
import type { ShopProduct } from "@/lib/storefront-server";
import { shopT, type ShopLocale } from "@/lib/shop-i18n";
import { ProductCard } from "./ProductCard";

/**
 * EC27 — recently viewed (web-only, localStorage per org slug).
 * Recording happens on the product page; the strip renders the
 * stored minimal cards (prices captured at view time may be
 * stale — clicking goes to the live product page). No server
 * state, no tracking.
 */
export function RecordRecentlyViewed({ orgSlug, product }: { orgSlug: string; product: ShopProduct }) {
  useEffect(() => {
    recordRecentlyViewed(orgSlug, {
      id: product.id,
      slug: product.slug,
      name: product.name,
      imageUrl: product.imageUrl,
      priceMinor: product.priceMinor,
    });
  }, [orgSlug, product]);
  return null;
}

function toCardProduct(card: RecentlyViewedCard): ShopProduct {
  return {
    id: card.id,
    name: card.name,
    slug: card.slug,
    description: null,
    category: null,
    categoryId: null,
    sku: null,
    priceMinor: card.priceMinor,
    compareAtMinor: null,
    currency: "BDT",
    imageUrl: card.imageUrl,
    images: card.imageUrl ? [card.imageUrl] : [],
    stockQuantity: null,
    stockState: "untracked", // no stock claim from a stored card
    bump: null,
    variants: [],
  };
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
  const [cards, setCards] = useState<RecentlyViewedCard[]>([]);
  useEffect(() => {
    setCards(readRecentlyViewed(orgSlug).filter((c) => c.id !== excludeId));
  }, [orgSlug, excludeId]);
  if (cards.length === 0) return null;
  return (
    <section className="space-y-4">
      <h2 className="text-xl font-black text-slate-900">{t.home.recentlyViewed}</h2>
      <div className="grid grid-cols-2 gap-4 md:grid-cols-4">
        {cards.map((c) => (
          <ProductCard key={c.id} orgSlug={orgSlug} product={toCardProduct(c)} locale={locale} />
        ))}
      </div>
    </section>
  );
}
