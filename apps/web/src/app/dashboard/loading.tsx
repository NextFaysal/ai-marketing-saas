import React from "react";
import { getDict } from "@/lib/i18n/dict";

// Server component (streaming shell): no LocaleProvider hook is
// available here, so the aria text uses the platform-default (bn)
// dictionary directly — the same default the provider starts from.
const dict = getDict("bn");

/**
 * ED5 (EB2) streaming shell for the dashboard root. Skeleton-only
 * (EB1 .skeleton globals); approximates header + KPI row + panel.
 */
export default function DashboardLoading() {
  return (
    <div className="space-y-6" aria-label={dict.common.loading}>
      <span className="sr-only">{dict.common.loading}</span>
      <div className="flex items-center justify-between gap-3">
        <div className="skeleton h-8 w-56" />
        <div className="skeleton h-10 w-32" />
      </div>
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        {Array.from({ length: 4 }).map((_, i) => (
          <div key={i} className="skeleton h-28 w-full" />
        ))}
      </div>
      <div className="skeleton h-64 w-full" />
    </div>
  );
}
