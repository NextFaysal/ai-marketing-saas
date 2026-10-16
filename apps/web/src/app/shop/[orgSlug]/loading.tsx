import React from "react";

/**
 * ED5 (EB2) streaming shell for shop routes under /shop/[orgSlug].
 * Server component, skeleton-only (EB1 .skeleton globals) — no page
 * logic, no data. Approximates the shop home: a strip under the
 * (layout-rendered) header plus a grid of product-card skeletons.
 */
export default function ShopLoading() {
  return (
    <div className="mx-auto max-w-6xl space-y-6 px-4 py-8 sm:px-6" aria-label="লোড হচ্ছে">
      <span className="sr-only">লোড হচ্ছে…</span>
      <div className="skeleton h-10 w-full rounded-full" />
      <div className="skeleton h-44 w-full rounded-3xl sm:h-56" />
      <div className="grid grid-cols-2 gap-4 md:grid-cols-4">
        {Array.from({ length: 8 }).map((_, i) => (
          <div key={i} className="space-y-2">
            <div className="skeleton aspect-square w-full" />
            <div className="skeleton h-3 w-3/4" />
            <div className="skeleton h-3 w-1/2" />
          </div>
        ))}
      </div>
    </div>
  );
}
