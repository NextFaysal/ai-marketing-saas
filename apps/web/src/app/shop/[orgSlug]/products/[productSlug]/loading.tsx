import React from "react";
import { shopT } from "@/lib/shop-i18n";
const t = shopT("bn");

/**
 * ED5 (EB2) streaming shell for the product detail route.
 * Route-specific (not just the shop-level shell) because the PDP has
 * a distinct gallery + buy-panel layout: showing the generic card
 * grid here would shift layout when the real PDP arrives. Skeleton-
 * only, no page logic, no data.
 */
export default function ProductDetailLoading() {
  return (
    <div className="mx-auto max-w-6xl space-y-8 px-4 py-8 sm:px-6" aria-label={t.shopWidgets.loading}>
      <span className="sr-only">{t.shopWidgets.loadingEllipsis}</span>
      <div className="skeleton h-3 w-56" />
      <div className="grid gap-8 lg:grid-cols-2">
        <div className="space-y-3">
          <div className="skeleton aspect-square w-full rounded-3xl" />
          <div className="grid grid-cols-4 gap-3">
            {Array.from({ length: 4 }).map((_, i) => (
              <div key={i} className="skeleton aspect-square w-full" />
            ))}
          </div>
        </div>
        <div className="space-y-4">
          <div className="skeleton h-7 w-3/4" />
          <div className="skeleton h-4 w-1/3" />
          <div className="skeleton h-8 w-40" />
          <div className="skeleton h-4 w-full" />
          <div className="skeleton h-4 w-5/6" />
          <div className="skeleton h-12 w-full rounded-xl" />
          <div className="skeleton h-12 w-full rounded-xl" />
        </div>
      </div>
    </div>
  );
}
