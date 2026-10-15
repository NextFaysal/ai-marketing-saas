"use client";
import React from "react";
import { formatMinor } from "@repo/contracts";
import type { Stats } from "./types";

interface OrdersKpiBarProps {
  stats: Stats | null;
}

export function OrdersKpiBar({ stats }: OrdersKpiBarProps) {
  if (!stats) return null;

  return (
    <div className="grid grid-cols-2 gap-3.5 sm:grid-cols-2 lg:grid-cols-4">
      {/* 1. Total Orders */}
      <div className="group relative overflow-hidden rounded-2xl border border-slate-200/80 bg-white p-4 shadow-sm transition hover:shadow-md">
        <div className="flex items-center justify-between">
          <span className="text-xs font-semibold text-slate-500">মোট অর্ডার</span>
          <span className="flex h-7 w-7 items-center justify-center rounded-lg bg-indigo-50 text-indigo-600 text-sm">
            📦
          </span>
        </div>
        <div className="mt-2 text-2xl font-bold tracking-tight text-slate-900">
          {stats.totalOrders}
        </div>
        <div className="mt-1 text-[11px] text-slate-400">ফিল্টার অনুযায়ী মোট হিসাব</div>
      </div>

      {/* 2. COD Orders */}
      <div className="group relative overflow-hidden rounded-2xl border border-slate-200/80 bg-white p-4 shadow-sm transition hover:shadow-md">
        <div className="flex items-center justify-between">
          <span className="text-xs font-semibold text-slate-500">COD অর্ডার</span>
          <span className="flex h-7 w-7 items-center justify-center rounded-lg bg-amber-50 text-amber-600 text-sm">
            💵
          </span>
        </div>
        <div className="mt-2 text-2xl font-bold tracking-tight text-slate-900">
          {stats.codOrders}
        </div>
        <div className="mt-1 flex items-center gap-1.5 text-[11px] text-amber-600 font-medium">
          <span>মোটের {stats.codSharePercent}%</span>
          <span className="text-slate-400">· ক্যাশ অন ডেলিভারি</span>
        </div>
      </div>

      {/* 3. Delivered Revenue */}
      <div className="group relative overflow-hidden rounded-2xl border border-slate-200/80 bg-white p-4 shadow-sm transition hover:shadow-md">
        <div className="flex items-center justify-between">
          <span className="text-xs font-semibold text-slate-500">ডেলিভার্ড রেভিনিউ</span>
          <span className="flex h-7 w-7 items-center justify-center rounded-lg bg-emerald-50 text-emerald-600 text-sm">
            💰
          </span>
        </div>
        <div className="mt-2 text-2xl font-bold tracking-tight text-emerald-600">
          {formatMinor(BigInt(stats.deliveredRevenueMinor))}
        </div>
        <div className="mt-1 text-[11px] text-slate-400">শুধুমাত্র Completed অর্ডার থেকে</div>
      </div>

      {/* 4. Status Breakdown */}
      <div className="group relative overflow-hidden rounded-2xl border border-slate-200/80 bg-white p-4 shadow-sm transition hover:shadow-md">
        <div className="flex items-center justify-between">
          <span className="text-xs font-semibold text-slate-500">স্ট্যাটাস অনুপাত</span>
          <span className="flex h-7 w-7 items-center justify-center rounded-lg bg-blue-50 text-blue-600 text-sm">
            📊
          </span>
        </div>
        <div className="mt-2 flex flex-wrap gap-1.5 overflow-hidden max-h-12">
          {stats.byStatus.map((s) => (
            <span
              key={s.status}
              className="inline-flex items-center gap-1 rounded-md bg-slate-100 px-1.5 py-0.5 text-[11px] font-medium text-slate-700"
            >
              <span>{s.status}:</span>
              <strong className="text-slate-900">{s.count}</strong>
            </span>
          ))}
          {stats.byStatus.length === 0 && <span className="text-xs text-slate-400">—</span>}
        </div>
      </div>
    </div>
  );
}
