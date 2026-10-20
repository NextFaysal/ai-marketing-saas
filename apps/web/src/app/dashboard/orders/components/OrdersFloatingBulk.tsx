"use client";
import React from "react";
import { useLocale } from "@/lib/i18n/provider";
import type { Order } from "./types";

interface OrdersFloatingBulkProps {
  selected: string[];
  items: Order[];
  bulkProvider: string;
  onBulkProviderChange: (p: string) => void;
  conns: { provider: string; connected: boolean }[];
  courierConnected: boolean;
  rAreas: any[];
  rAreaId: string;
  onRAreaChange: (areaId: string, areaName: string) => void;
  bulkBusy: boolean;
  bulkResults: {
    requested: number;
    booked: number;
    skipped: number;
    failed: number;
    results: { orderId: string; ok: boolean; skipped?: boolean; trackingCode?: string; error?: string }[];
  } | null;
  onBulkBook: () => void;
  onBulkLabels: () => void;
  onClearSelection: () => void;
}

export function OrdersFloatingBulk({
  selected,
  items,
  bulkProvider,
  onBulkProviderChange,
  conns,
  courierConnected,
  rAreas,
  rAreaId,
  onRAreaChange,
  bulkBusy,
  bulkResults,
  onBulkBook,
  onBulkLabels,
  onClearSelection,
}: OrdersFloatingBulkProps) {
  const { dict, t, locale } = useLocale();
  if (selected.length === 0) return null;

  return (
    <div className="fixed bottom-6 left-1/2 z-40 w-11/12 max-w-4xl -translate-x-1/2 rounded-2xl border border-indigo-200/80 bg-white/95 p-3.5 shadow-2xl backdrop-blur-md transition-all animate-rise">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <span className="flex h-7 w-7 items-center justify-center rounded-xl bg-indigo-600 text-xs font-bold text-white shadow-sm">
            {selected.length}
          </span>
          <span className="text-xs font-bold text-slate-800">
            {dict.orders.ordersSelectedMax50}</span>
        </div>

        {/* Controls */}
        <div className="flex flex-wrap items-center gap-2">
          <select
            className="rounded-xl border border-slate-200 bg-white px-2.5 py-1.5 text-xs font-semibold text-slate-700 shadow-sm focus:border-indigo-500 focus:outline-none"
            value={bulkProvider}
            onChange={(e) => onBulkProviderChange(e.target.value)}
          >
            {(["steadfast", "pathao", "redx"] as const).map((p) => {
              const c = conns.find((x) => x.provider === p);
              const connected = c ? c.connected : p === "steadfast" ? courierConnected : false;
              return (
                <option key={p} value={p} disabled={!connected}>
                  {p === "steadfast" ? "Steadfast" : p === "pathao" ? "Pathao" : "RedX"}
                  {connected ? "" : dict.orders.notLinked2}
                </option>
              );
            })}
          </select>

          {bulkProvider === "redx" && (
            <select
              className="max-w-xs rounded-xl border border-slate-200 bg-white px-2.5 py-1.5 text-xs text-slate-700 shadow-sm focus:border-indigo-500 focus:outline-none"
              value={rAreaId}
              onChange={(e) => {
                const area = rAreas.find((a: any) => String(a.id) === e.target.value);
                onRAreaChange(e.target.value, area?.name ?? "");
              }}
            >
              <option value="">{dict.orders.selectARedXDeliveryArea}</option>
              {rAreas.map((a: any) => (
                <option key={a.id} value={a.id}>
                  {a.name}
                </option>
              ))}
            </select>
          )}

          <button
            type="button"
            disabled={bulkBusy}
            onClick={onBulkBook}
            className="inline-flex items-center gap-1.5 rounded-xl bg-indigo-600 px-3 py-1.5 text-xs font-semibold text-white shadow-sm transition hover:bg-indigo-700 active:scale-95 disabled:opacity-50"
          >
            <span>🚚</span>
            {bulkBusy ? dict.orders.booking2 : dict.orders.bookTogether}
          </button>

          <button
            type="button"
            onClick={onBulkLabels}
            className="inline-flex items-center gap-1.5 rounded-xl border border-slate-200 bg-white px-3 py-1.5 text-xs font-semibold text-slate-700 shadow-sm transition hover:bg-slate-50 active:scale-95"
          >
            <span>🏷️</span> {dict.orders.labelPDF}</button>

          <button
            type="button"
            onClick={onClearSelection}
            className="inline-flex items-center rounded-xl px-2.5 py-1.5 text-xs font-semibold text-slate-500 hover:text-slate-800"
          >
            {dict.orders.cancel3}</button>
        </div>
      </div>

      {bulkResults && (
        <div className="mt-3 border-t border-slate-100 pt-2 text-xs">
          <div className="flex items-center gap-2 font-semibold text-slate-800">
            <span>{dict.orders.result}</span>
            <span className="text-emerald-700">{bulkResults.booked}{dict.orders.booked}</span> ·
            <span className="text-amber-700">{bulkResults.skipped}{dict.orders.previouslyBooked}</span> ·
            <span className="text-red-600">{bulkResults.failed}{dict.orders.failed2}</span>
          </div>
          <ul className="mt-1.5 max-h-24 space-y-0.5 overflow-y-auto text-[11px]">
            {bulkResults.results.map((r) => {
              const o = items.find((x) => x.id === r.orderId);
              return (
                <li
                  key={r.orderId}
                  className={`flex items-center gap-1.5 ${
                    r.ok ? "text-emerald-700" : r.skipped ? "text-amber-700" : "text-red-600"
                  }`}
                >
                  <span>{r.ok ? "✓" : r.skipped ? "⏭" : "✗"}</span>
                  <span className="font-medium">#{o?.externalNumber ?? r.orderId.slice(0, 8)}</span>
                  <span>— {r.ok ? `Tracking: ${r.trackingCode}` : r.error}</span>
                </li>
              );
            })}
          </ul>
        </div>
      )}
    </div>
  );
}
