"use client";
import React from "react";
import { useLocale } from "@/lib/i18n/provider";
import { STATUSES, type Stats } from "./types";

interface OrdersFilterBarProps {
  status: string;
  onStatusChange: (status: string) => void;
  codOnly: boolean;
  onCodOnlyChange: (cod: boolean) => void;
  searchQuery: string;
  onSearchQueryChange: (q: string) => void;
  stats: Stats | null;
}

// ML5 i18n: values are dict.orders keys, resolved at render.
const STATUS_LABELS = {
  "": "allOrders",
  pending: "pending2",
  processing: "processing2",
  "on-hold": "onHold",
  completed: "complete",
  cancelled: "cancel",
  refunded: "refund",
  failed: "failed",
} as const satisfies Record<string, string>;

export function OrdersFilterBar({
  status,
  onStatusChange,
  codOnly,
  onCodOnlyChange,
  searchQuery,
  onSearchQueryChange,
  stats,
}: OrdersFilterBarProps) {
  const { dict, t, locale } = useLocale();
  // Find count for each status from stats
  const getCount = (s: string) => {
    if (!stats) return null;
    if (s === "") return stats.totalOrders;
    const found = stats.byStatus.find((item) => item.status === s);
    return found ? found.count : 0;
  };

  return (
    <div className="space-y-3 rounded-2xl border border-slate-200/80 bg-white p-3 shadow-sm">
      {/* Top row: Search input + COD toggle */}
      <div className="flex flex-col gap-2.5 sm:flex-row sm:items-center sm:justify-between">
        <div className="relative flex-1">
          <span className="pointer-events-none absolute inset-y-0 left-0 flex items-center pl-3 text-slate-400">
            🔍
          </span>
          <input
            type="text"
            aria-label={dict.orders.searchOrdersByOrderNumber}
            className="w-full rounded-xl border border-slate-200 bg-slate-50/60 py-2 pl-9 pr-9 text-xs text-slate-900 placeholder:text-slate-400 transition hover:bg-white focus:border-indigo-500 focus:bg-white focus:outline-none focus:ring-4 focus:ring-indigo-500/10"
            placeholder={dict.orders.searchInRealTimeBy}
            value={searchQuery}
            onChange={(e) => onSearchQueryChange(e.target.value)}
          />
          {searchQuery && (
            <button
              type="button"
              onClick={() => onSearchQueryChange("")}
              className="absolute inset-y-0 right-0 flex min-w-[44px] items-center justify-center pr-3 text-xs text-slate-500 hover:text-slate-600"
              aria-label={dict.orders.clearSearch}
            >
              ✕
            </button>
          )}
        </div>

        <div className="flex items-center gap-3">
          <label className="inline-flex cursor-pointer select-none items-center gap-2 rounded-xl border border-slate-200 bg-slate-50/50 px-3 py-1.5 text-xs font-semibold text-slate-700 transition hover:bg-slate-100">
            <input
              type="checkbox"
              className="h-3.5 w-3.5 rounded border-slate-300 text-indigo-600 focus:ring-indigo-500"
              checked={codOnly}
              onChange={(e) => onCodOnlyChange(e.target.checked)}
            />
            <span>{dict.orders.cODOrdersOnly}</span>
          </label>
        </div>
      </div>

      {/* Status Segmented Tabs */}
      <div className="flex items-center gap-1.5 overflow-x-auto pb-1 text-xs scrollbar-none">
        {STATUSES.map((s) => {
          const isActive = status === s;
          const count = getCount(s);
          return (
            <button
              key={s}
              type="button"
              onClick={() => onStatusChange(s)}
              className={`inline-flex min-h-[44px] shrink-0 items-center gap-1.5 rounded-xl px-3 py-1.5 text-xs font-semibold transition ${
                isActive
                  ? "bg-indigo-600 text-white shadow-sm"
                  : "bg-slate-100/70 text-slate-600 hover:bg-slate-200/80 hover:text-slate-900"
              }`}
            >
              <span>{STATUS_LABELS[s as keyof typeof STATUS_LABELS] ? dict.orders[STATUS_LABELS[s as keyof typeof STATUS_LABELS]] : s}</span>
              {count !== null && (
                <span
                  className={`rounded-full px-1.5 py-0.2 text-[10px] font-bold ${
                    isActive ? "bg-white/20 text-white" : "bg-white text-slate-700 shadow-2xs"
                  }`}
                >
                  {count}
                </span>
              )}
            </button>
          );
        })}
      </div>
    </div>
  );
}
