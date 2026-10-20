"use client";
import React, { useState } from "react";
import {
  calculateDrawerReconciliation,
  buildZReportText,
} from "@/lib/pos-closing";
import { useLocale } from "@/lib/i18n/provider";
import { dicts } from "@/lib/i18n/dict";
import { tr, type TrParams } from "@/lib/i18n/lookup";
import { fmtTime, type UiLocale } from "@repo/contracts";

export interface PosZReportModalProps {
  open: boolean;
  onClose: () => void;
  today: {
    orders: Array<{ totalMinor: string; dueMinor: string }>;
    totalSalesMinor: string;
    orderCount: number;
  } | null;
  storeName?: string | null;
  paperWidth?: "80mm" | "58mm";
}

export function openZReportPrint(slipText: string, paperWidth: "80mm" | "58mm" = "80mm", locale: UiLocale = "bn") {
  const tt = (path: string, params?: TrParams) => tr(dicts, locale, path, params) ?? path;
  const w = window.open("", "_blank");
  if (!w) return;
  const html = tt("pos.dOCTYPEHtmlHtmlHeadMeta2", { paperWidth: paperWidth, receiptSettings: paperWidth === "58mm" ? "48mm" : "72mm", slipText: slipText });
  w.document.open();
  w.document.write(html);
  w.document.close();
}

export function PosZReportModal({
  open,
  onClose,
  today,
  storeName,
  paperWidth = "80mm",
}: PosZReportModalProps) {
  const { dict, locale } = useLocale();
  const [openingFloat, setOpeningFloat] = useState("2000");
  const [cashierName, setCashierName] = useState(dict.pos.counter1);
  const [shiftName, setShiftName] = useState(dict.pos.morningShift);
  const [cashPayouts, setCashPayouts] = useState("0");
  const [actualCashCounted, setActualCashCounted] = useState("");
  const [shiftStartTime] = useState(() => fmtTime(locale, new Date()));

  if (!open) return null;

  const todayTotalSalesMinor = today?.totalSalesMinor ? BigInt(today.totalSalesMinor) : 0n;
  const openingFloatMinor = BigInt(Math.round((Number(openingFloat) || 0) * 100));
  const cashPayoutsMinor = BigInt(Math.round((Number(cashPayouts) || 0) * 100));
  const actualCashMinor = BigInt(Math.round((Number(actualCashCounted) || 0) * 100));

  const cashSalesFromOrders = (today?.orders ?? []).reduce((acc, o) => {
    return acc + BigInt(Number(o.totalMinor) - Number(o.dueMinor));
  }, 0n);

  const cashSalesMinor = cashSalesFromOrders > 0n ? cashSalesFromOrders : todayTotalSalesMinor;
  const digitalSalesMinor = todayTotalSalesMinor > cashSalesMinor ? todayTotalSalesMinor - cashSalesMinor : 0n;

  const reconciliation = calculateDrawerReconciliation({
    openingFloatMinor,
    cashSalesMinor,
    digitalSalesMinor,
    cashPayoutsMinor,
    actualCashCountedMinor: actualCashMinor,
  });

  const shiftSlipData = {
    shopName: storeName || dict.pos.ourShop,
    cashierName,
    shiftStartTime,
    shiftEndTime: fmtTime(locale, new Date()),
    orderCount: today?.orderCount ?? 0,
    totalSalesMinor: todayTotalSalesMinor,
    reconciliation,
  };

  const zReportText = buildZReportText(shiftSlipData);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4">
      <div className="flex max-h-[90vh] w-full max-w-3xl flex-col rounded-2xl bg-white shadow-2xl">
        <div className="flex items-center justify-between border-b px-6 py-4">
          <div>
            <h2 className="text-base font-bold text-slate-800">{dict.pos.cashDrawerReconciliationShiftClose}</h2>
            <p className="text-xs text-slate-500">{dict.pos.reconcileTheCounterSOpening}</p>
          </div>
          <button
            type="button"
            className="rounded-lg p-1.5 text-slate-400 hover:bg-slate-100 hover:text-slate-600"
            onClick={onClose}
          >
            ✕
          </button>
        </div>

        <div className="grid flex-1 gap-6 overflow-y-auto p-6 md:grid-cols-2">
          <div className="space-y-3.5">
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block text-xs font-semibold text-slate-700">{dict.pos.cashierName}</label>
                <input
                  type="text"
                  value={cashierName}
                  onChange={(e) => setCashierName(e.target.value)}
                  className="mt-1 w-full rounded-lg border border-slate-200 px-3 py-2 text-sm"
                />
              </div>
              <div>
                <label className="block text-xs font-semibold text-slate-700">{dict.pos.shiftName}</label>
                <input
                  type="text"
                  value={shiftName}
                  onChange={(e) => setShiftName(e.target.value)}
                  className="mt-1 w-full rounded-lg border border-slate-200 px-3 py-2 text-sm"
                />
              </div>
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block text-xs font-semibold text-slate-700">{dict.pos.openingCashFloat}</label>
                <input
                  type="number"
                  min="0"
                  value={openingFloat}
                  onChange={(e) => setOpeningFloat(e.target.value)}
                  className="mt-1 w-full rounded-lg border border-slate-200 px-3 py-2 text-sm font-semibold"
                  placeholder="2000"
                />
                <span className="text-[10px] text-slate-400">{dict.pos.theChangeMoneyKeptIn}</span>
              </div>
              <div>
                <label className="block text-xs font-semibold text-slate-700">{dict.pos.cashExpensesVouchers}</label>
                <input
                  type="number"
                  min="0"
                  value={cashPayouts}
                  onChange={(e) => setCashPayouts(e.target.value)}
                  className="mt-1 w-full rounded-lg border border-slate-200 px-3 py-2 text-sm font-semibold"
                  placeholder="0"
                />
                <span className="text-[10px] text-slate-400">{dict.pos.expensesPaidFromTheDrawer}</span>
              </div>
            </div>

            <div>
              <label className="block text-xs font-semibold text-slate-700">
                {dict.pos.actualCashCountedInHand} <span className="text-red-500">*</span>
              </label>
              <input
                type="number"
                min="0"
                value={actualCashCounted}
                onChange={(e) => setActualCashCounted(e.target.value)}
                className="mt-1 w-full rounded-lg border-2 border-indigo-500 px-3 py-2.5 text-base font-bold text-indigo-900 focus:outline-none focus:ring-2 focus:ring-indigo-500"
                placeholder={dict.pos.countAndEnterTheTotal}
                autoFocus
              />
              <span className="text-[10px] text-slate-500">{dict.pos.openTheDrawerPhysicallyCount}</span>
            </div>

            {/* Discrepancy Alert */}
            <div
              className={`rounded-xl border p-3.5 ${
                reconciliation.status === "balanced"
                  ? "border-emerald-200 bg-emerald-50 text-emerald-800"
                  : reconciliation.status === "over"
                  ? "border-blue-200 bg-blue-50 text-blue-800"
                  : "border-red-200 bg-red-50 text-red-800"
              }`}
            >
              <div className="flex items-center justify-between font-bold text-sm">
                <span>{dict.pos.calculationResult}</span>
                <span className="font-mono text-base">{reconciliation.discrepancyFormatted}</span>
              </div>
              <p className="mt-1 text-xs font-medium">{reconciliation.summaryBangla}</p>
              <div className="mt-2 grid grid-cols-2 gap-2 border-t border-slate-200/60 pt-2 text-xs">
                <div>
                  {dict.pos.expectedCash} <strong>{dict.pos.text1yr}{(Number(reconciliation.expectedCashInDrawerMinor) / 100).toFixed(2)}</strong>
                </div>
                <div>
                  {dict.pos.cashCountedInHand} <strong>{dict.pos.text1yr}{(Number(reconciliation.actualCashCountedMinor) / 100).toFixed(2)}</strong>
                </div>
              </div>
            </div>
          </div>

          {/* Thermal Z-Report Slip Preview */}
          <div className="flex flex-col items-center justify-start rounded-xl border border-dashed border-slate-300 bg-slate-50 p-4">
            <span className="mb-2 text-[11px] font-bold uppercase tracking-wider text-slate-400">
              {dict.pos.textuakx2m}
            </span>
            <div className="w-full max-w-[280px] rounded bg-white p-3 font-mono text-[11px] text-slate-800 shadow-md">
              <pre className="whitespace-pre-wrap font-mono leading-tight">{zReportText}</pre>
            </div>
          </div>
        </div>

        <div className="flex items-center justify-between border-t bg-slate-50 px-6 py-3.5">
          <span className="text-xs text-slate-500">
            {dict.pos.atTheEndOfThe}
          </span>
          <div className="flex gap-2">
            <button
              type="button"
              className="rounded-lg border border-slate-200 px-4 py-2 text-xs font-semibold text-slate-600 hover:bg-slate-100"
              onClick={onClose}
            >
              {dict.pos.close}
            </button>
            <button
              type="button"
              className="btn-primary flex items-center gap-1.5 px-5 py-2 text-xs font-semibold"
              onClick={() => openZReportPrint(zReportText, paperWidth, locale)}
            >
              {dict.pos.printThermalZReportSlip}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
