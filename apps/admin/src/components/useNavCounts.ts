"use client";
// ADX3: shared loader for GET /admin/nav-counts. One fetch per page
// load, shared by the sidebar badges and the Attention Bell via a
// tiny module-level cache + listener set. A failed fetch leaves the
// value null FOREVER for that page load — null means "unknown", and
// every consumer renders nothing for unknown counts (honesty rule,
// docs/admin-ux-architecture.md §4). It is never retried into a
// fabricated 0.
import React from "react";
import { apiFetch } from "@/lib/api";
import type { NavCounts } from "./nav";

let cache: NavCounts | null = null;
let started = false;
const listeners = new Set<(c: NavCounts | null) => void>();

function emit() { for (const l of listeners) l(cache); }

export function useNavCounts(): NavCounts | null {
  const [counts, setCounts] = React.useState<NavCounts | null>(cache);
  React.useEffect(() => {
    listeners.add(setCounts);
    if (!started) {
      started = true;
      apiFetch<NavCounts>("/admin/nav-counts")
        .then((v) => { cache = v && typeof v === "object" ? v : null; emit(); })
        .catch(() => { cache = null; emit(); });
    } else {
      setCounts(cache);
    }
    return () => { listeners.delete(setCounts); };
  }, []);
  return counts;
}

/** Fields actually present in a nav-counts payload (numbers only). */
export function presentCounts(counts: NavCounts | null): [keyof NavCounts, number][] {
  if (!counts) return [];
  const out: [keyof NavCounts, number][] = [];
  for (const k of ["pendingPayouts", "openTickets", "failedJobs24h", "activeAlerts", "overdueSubscriptions"] as const) {
    const v = counts[k];
    if (typeof v === "number") out.push([k, v]);
  }
  return out;
}
