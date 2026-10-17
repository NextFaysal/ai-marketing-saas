"use client";
import React from "react";

/**
 * ED10 (EB4) — the shop offline page's retry button. Split out
 * as a tiny client island so the offline page itself stays a
 * static server component: retry simply reloads, letting the
 * (now hopefully restored) network answer the navigation.
 */
export function ShopOfflineRetry({ label }: { label: string }) {
  return (
    <button
      type="button"
      onClick={() => window.location.reload()}
      className="btn-brand mt-6 rounded-xl px-5 py-2.5 text-sm font-bold"
    >
      {label}
    </button>
  );
}
