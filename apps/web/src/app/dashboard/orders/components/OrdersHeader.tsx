"use client";
import React from "react";
import { useLocale } from "@/lib/i18n/provider";

interface OrdersHeaderProps {
  total: number;
  duplicateCount?: number;
  exportBusy: boolean;
  onOpenDuplicates: () => void;
  onOpenLabelScanner: () => void;
  onOpenCourierHub: () => void;
  onDownloadExport: () => void;
  onOpenAutomation?: () => void;
  onOpenAnalytics?: () => void;
  onOpenPrint?: () => void;
  onOpenTeam?: () => void;
  onOpenFraud?: () => void;
  onOpenNotif?: () => void;
}

export function OrdersHeader({
  total,
  duplicateCount = 0,
  exportBusy,
  onOpenDuplicates,
  onOpenLabelScanner,
  onOpenCourierHub,
  onDownloadExport,
  onOpenAutomation,
  onOpenAnalytics,
  onOpenPrint,
  onOpenTeam,
  onOpenFraud,
  onOpenNotif,
}: OrdersHeaderProps) {
  const { dict, t, locale } = useLocale();
  return (
    <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
      <div>
        <div className="flex items-center gap-3">
          <h1 className="text-2xl font-bold tracking-tight text-slate-900">{dict.orders.orderManagement}</h1>
          <span className="inline-flex items-center rounded-full bg-indigo-50 px-2.5 py-0.5 text-xs font-semibold text-indigo-700 ring-1 ring-inset ring-indigo-200">
            {total} {dict.orders.orders}</span>
        </div>
        <p className="mt-1 text-xs text-slate-500">
          {dict.orders.realTimeOrderTrackingCourier}</p>

        {/* Quick Link Pills */}
        <div className="mt-3 flex flex-wrap items-center gap-2">
          <a
            href="/dashboard/orders/manual"
            className="inline-flex items-center gap-1 rounded-lg border border-slate-200 bg-white px-2.5 py-1 text-xs font-medium text-slate-700 shadow-sm transition hover:bg-slate-50 hover:border-slate-300"
          >
            <span>+</span> {dict.orders.manualOrderCSV}</a>
          <a
            href="/dashboard/orders/ndr"
            className="inline-flex items-center gap-1.5 rounded-lg border border-rose-200 bg-rose-50/70 px-2.5 py-1 text-xs font-semibold text-rose-700 transition hover:bg-rose-100"
          >
            <span>🚨</span> {dict.orders.nDRRecovery}</a>
          <a
            href="/dashboard/orders/reconciliation"
            className="inline-flex items-center gap-1.5 rounded-lg border border-emerald-200 bg-emerald-50/70 px-2.5 py-1 text-xs font-semibold text-emerald-800 transition hover:bg-emerald-100"
          >
            <span>💰</span> {dict.orders.cashReconciliation}</a>
          <a
            href="/dashboard/team/performance"
            className="inline-flex items-center gap-1.5 rounded-lg border border-indigo-200 bg-indigo-50/70 px-2.5 py-1 text-xs font-semibold text-indigo-800 transition hover:bg-indigo-100"
          >
            <span>🏆</span> {dict.orders.teamScoreboard}</a>
          {duplicateCount > 0 && (
            <button
              type="button"
              onClick={onOpenDuplicates}
              className="inline-flex items-center gap-1.5 rounded-lg border border-amber-300 bg-amber-50 px-2.5 py-1 text-xs font-bold text-amber-800 transition hover:bg-amber-100 animate-pulse"
            >
              <span>⚠️</span> {dict.orders.duplicateOrders}{duplicateCount})
            </button>
          )}
        </div>
      </div>

      {/* Main Top Action Buttons */}
      <div className="flex flex-wrap items-center gap-2">
        {onOpenAutomation && (
          <button
            type="button"
            onClick={onOpenAutomation}
            className="inline-flex items-center gap-1.5 rounded-xl border border-slate-200 bg-white px-3 py-2 text-xs font-semibold text-slate-700 shadow-sm transition hover:bg-slate-50 hover:border-slate-300 active:scale-95"
          >
            <span>🤖</span> {dict.orders.automation}</button>
        )}
        {onOpenAnalytics && (
          <button
            type="button"
            onClick={onOpenAnalytics}
            className="inline-flex items-center gap-1.5 rounded-xl border border-slate-200 bg-white px-3 py-2 text-xs font-semibold text-slate-700 shadow-sm transition hover:bg-slate-50 hover:border-slate-300 active:scale-95"
          >
            <span>📊</span> {dict.orders.analytics}</button>
        )}
        {onOpenPrint && (
          <button
            type="button"
            onClick={onOpenPrint}
            className="inline-flex items-center gap-1.5 rounded-xl border border-slate-200 bg-white px-3 py-2 text-xs font-semibold text-slate-700 shadow-sm transition hover:bg-slate-50 hover:border-slate-300 active:scale-95"
          >
            <span>🖨️</span> {dict.orders.printCenter2}</button>
        )}
        {onOpenTeam && (
          <button
            type="button"
            onClick={onOpenTeam}
            className="inline-flex items-center gap-1.5 rounded-xl border border-slate-200 bg-white px-3 py-2 text-xs font-semibold text-slate-700 shadow-sm transition hover:bg-slate-50 hover:border-slate-300 active:scale-95"
          >
            <span>👥</span> {dict.orders.team}</button>
        )}
        {onOpenFraud && (
          <button
            type="button"
            onClick={onOpenFraud}
            className="inline-flex items-center gap-1.5 rounded-xl border border-slate-200 bg-white px-3 py-2 text-xs font-semibold text-slate-700 shadow-sm transition hover:bg-slate-50 hover:border-slate-300 active:scale-95"
          >
            <span>🛡️</span> {dict.orders.fraudShield2}</button>
        )}
        {onOpenNotif && (
          <button
            type="button"
            onClick={onOpenNotif}
            className="inline-flex items-center gap-1.5 rounded-xl border border-slate-200 bg-white px-3 py-2 text-xs font-semibold text-slate-700 shadow-sm transition hover:bg-slate-50 hover:border-slate-300 active:scale-95"
          >
            <span>🔔</span> {dict.orders.notification}</button>
        )}
        <button
          type="button"
          onClick={onOpenLabelScanner}
          className="inline-flex items-center gap-1.5 rounded-xl border border-slate-200 bg-white px-3 py-2 text-xs font-semibold text-slate-700 shadow-sm transition hover:bg-slate-50 hover:border-slate-300 active:scale-95"
        >
          <span>📷</span> {dict.orders.labelScanner}</button>
        <button
          type="button"
          onClick={onOpenCourierHub}
          className="inline-flex items-center gap-1.5 rounded-xl border border-slate-200 bg-white px-3 py-2 text-xs font-semibold text-slate-700 shadow-sm transition hover:bg-slate-50 hover:border-slate-300 active:scale-95"
        >
          <span>🚚</span> {dict.orders.courierHubSettings}</button>
        <button
          type="button"
          disabled={exportBusy}
          onClick={onDownloadExport}
          className="inline-flex items-center gap-1.5 rounded-xl bg-slate-900 px-3.5 py-2 text-xs font-semibold text-white shadow-sm transition hover:bg-slate-800 active:scale-95 disabled:opacity-50"
        >
          <span>📥</span> {exportBusy ? dict.orders.downloading : dict.orders.exportCSV}
        </button>
      </div>
    </div>
  );
}
