import React from "react";

/**
 * ED5 (EB2) streaming shell for the products page: header, filter
 * bar and product-row skeletons (thumb + lines). Skeleton-only.
 */
export default function ProductsLoading() {
  return (
    <div className="space-y-5" aria-label="লোড হচ্ছে">
      <span className="sr-only">লোড হচ্ছে…</span>
      <div className="flex items-center justify-between gap-3">
        <div className="skeleton h-8 w-44" />
        <div className="skeleton h-10 w-36" />
      </div>
      <div className="skeleton h-11 w-full" />
      <div className="space-y-2">
        {Array.from({ length: 8 }).map((_, i) => (
          <div key={i} className="flex items-center gap-3">
            <div className="skeleton h-12 w-12 shrink-0" />
            <div className="skeleton h-12 flex-1" />
          </div>
        ))}
      </div>
    </div>
  );
}
