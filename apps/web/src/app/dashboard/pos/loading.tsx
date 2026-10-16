import React from "react";

/**
 * ED5 (EB2) streaming shell for POS: header/search bar, a grid of
 * product tiles and the cart panel. Skeleton-only, no page logic.
 */
export default function PosLoading() {
  return (
    <div className="space-y-5" aria-label="লোড হচ্ছে">
      <span className="sr-only">লোড হচ্ছে…</span>
      <div className="skeleton h-11 w-full" />
      <div className="grid gap-5 lg:grid-cols-[1fr_320px]">
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
          {Array.from({ length: 9 }).map((_, i) => (
            <div key={i} className="skeleton h-28 w-full" />
          ))}
        </div>
        <div className="space-y-3">
          <div className="skeleton h-10 w-full" />
          {Array.from({ length: 4 }).map((_, i) => (
            <div key={i} className="skeleton h-12 w-full" />
          ))}
          <div className="skeleton h-12 w-full rounded-xl" />
        </div>
      </div>
    </div>
  );
}
