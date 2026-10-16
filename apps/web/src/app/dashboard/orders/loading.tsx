import React from "react";

/**
 * ED5 (EB2) streaming shell for the orders page: header, filter bar
 * and table-row skeletons. Skeleton-only, no page logic.
 */
export default function OrdersLoading() {
  return (
    <div className="space-y-5" aria-label="লোড হচ্ছে">
      <span className="sr-only">লোড হচ্ছে…</span>
      <div className="flex items-center justify-between gap-3">
        <div className="skeleton h-8 w-44" />
        <div className="skeleton h-10 w-32" />
      </div>
      <div className="skeleton h-11 w-full" />
      <div className="space-y-2">
        {Array.from({ length: 8 }).map((_, i) => (
          <div key={i} className="skeleton h-14 w-full" />
        ))}
      </div>
    </div>
  );
}
