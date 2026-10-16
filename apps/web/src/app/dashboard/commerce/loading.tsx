import React from "react";

/**
 * ED5 (EB2) streaming shell for the commerce hub: header, stat-card
 * grid and a store/table block. Skeleton-only, no page logic.
 */
export default function CommerceLoading() {
  return (
    <div className="space-y-6" aria-label="লোড হচ্ছে">
      <span className="sr-only">লোড হচ্ছে…</span>
      <div className="flex items-center justify-between gap-3">
        <div className="skeleton h-8 w-48" />
        <div className="skeleton h-10 w-28" />
      </div>
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
        {Array.from({ length: 6 }).map((_, i) => (
          <div key={i} className="skeleton h-32 w-full" />
        ))}
      </div>
      <div className="space-y-3">
        {Array.from({ length: 4 }).map((_, i) => (
          <div key={i} className="skeleton h-12 w-full" />
        ))}
      </div>
    </div>
  );
}
