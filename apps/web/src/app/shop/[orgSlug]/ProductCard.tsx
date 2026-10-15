import React from "react";
import Link from "next/link";
import { formatMinor } from "@repo/contracts";
import type { ShopProduct } from "@/lib/storefront-server";
import { shopT, type ShopLocale } from "@/lib/shop-i18n";
import { WishlistHeart } from "./WishlistHeart";

export function priceText(minor: string): string {
  try {
    return formatMinor(BigInt(minor));
  } catch {
    return minor;
  }
}

export function stockBadge(state: string, locale: ShopLocale | string = "bn"): { label: string; cls: string } | null {
  const t = shopT(locale);
  switch (state) {
    case "out_of_stock":
      return { label: t.product.outOfStock, cls: "bg-rose-100 text-rose-700" };
    case "low":
      return { label: t.product.lowStock, cls: "bg-amber-100 text-amber-800" };
    case "in_stock":
      return { label: t.product.inStock, cls: "bg-emerald-100 text-emerald-700" };
    default:
      return null; // untracked — no stock claim
  }
}

export function ProductCard({ orgSlug, product, locale = "bn" }: { orgSlug: string; product: ShopProduct; locale?: ShopLocale | string }) {
  const badge = stockBadge(product.stockState, locale);
  const inner = (
    <>
      {product.imageUrl ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={product.imageUrl} alt={product.name} className="aspect-square w-full object-cover" />
      ) : (
        <div className="flex aspect-square w-full items-center justify-center bg-indigo-50 text-5xl">📦</div>
      )}
      <div className="space-y-1.5 p-4">
        <h3 className="line-clamp-2 text-sm font-bold text-slate-900">{product.name}</h3>
        {product.category ? <p className="text-[11px] text-slate-400">{product.category}</p> : null}
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-base font-extrabold text-indigo-700">{priceText(product.priceMinor)}</span>
          {product.compareAtMinor ? (
            <span className="text-xs text-slate-400 line-through">{priceText(product.compareAtMinor)}</span>
          ) : null}
          {badge ? <span className={`rounded-full px-2 py-0.5 text-[10px] font-bold ${badge.cls}`}>{badge.label}</span> : null}
        </div>
      </div>
    </>
  );
  const cls = "block overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm transition hover:shadow-md";
  // EC25: heart overlays the card; WishlistHeart stops propagation
  // so tapping it never navigates the card Link.
  const heart = (
    <div className="absolute right-2.5 top-2.5 z-10">
      <WishlistHeart orgSlug={orgSlug} productId={product.id} locale={locale} />
    </div>
  );
  if (!product.slug) return <div className={`relative ${cls}`}>{heart}{inner}</div>;
  return (
    <div className="relative">
      {heart}
      <Link href={`/shop/${orgSlug}/products/${product.slug}`} className={cls}>
        {inner}
      </Link>
    </div>
  );
}
