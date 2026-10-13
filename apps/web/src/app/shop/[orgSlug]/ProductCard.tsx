import React from "react";
import Link from "next/link";
import { formatMinor } from "@repo/contracts";
import type { ShopProduct } from "@/lib/storefront-server";

export function priceText(minor: string): string {
  try {
    return formatMinor(BigInt(minor));
  } catch {
    return minor;
  }
}

export function stockBadge(state: string): { label: string; cls: string } | null {
  switch (state) {
    case "out_of_stock":
      return { label: "স্টক শেষ", cls: "bg-rose-100 text-rose-700" };
    case "low":
      return { label: "স্টক কম আছে", cls: "bg-amber-100 text-amber-800" };
    case "in_stock":
      return { label: "স্টকে আছে", cls: "bg-emerald-100 text-emerald-700" };
    default:
      return null; // untracked — no stock claim
  }
}

export function ProductCard({ orgSlug, product }: { orgSlug: string; product: ShopProduct }) {
  const badge = stockBadge(product.stockState);
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
  if (!product.slug) return <div className={cls}>{inner}</div>;
  return (
    <Link href={`/shop/${orgSlug}/products/${product.slug}`} className={cls}>
      {inner}
    </Link>
  );
}
