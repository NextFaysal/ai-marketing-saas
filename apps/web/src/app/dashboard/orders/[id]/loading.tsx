import React from "react";
import { Skeleton } from "@repo/ui";

/**
 * ED12 (EB5) streaming shell for the order-detail route: back link,
 * breadcrumb and header-card skeletons, mirroring
 * orders/loading.tsx. Skeleton-only, no page logic.
 */
export default function OrderDetailLoading() {
  return (
    <div className="space-y-5" aria-label="লোড হচ্ছে">
      <span className="sr-only">লোড হচ্ছে…</span>
      <div className="space-y-2">
        <Skeleton className="h-5 w-32" />
        <Skeleton className="h-4 w-56" />
      </div>
      <Skeleton className="h-24 w-full" />
      <Skeleton className="h-40 w-full" />
      <Skeleton className="h-40 w-full" />
    </div>
  );
}
