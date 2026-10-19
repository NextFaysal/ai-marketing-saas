"use client";
import React, { useState } from "react";
import {
  calculateDrawerReconciliation,
  buildZReportText,
} from "@/lib/pos-closing";

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

export function openZReportPrint(slipText: string, paperWidth: "80mm" | "58mm" = "80mm") {
  const w = window.open("", "_blank");
  if (!w) return;
  const html = `<!DOCTYPE html>
<html>
<head>
<meta charset="utf-8">
<title>Z-Report শিফট রিপোর্ট</title>
<style>
  @page { size: ${paperWidth} auto; margin: 4mm; }
  body { font-family: monospace, monospace; font-size: 11px; width: ${
    paperWidth === "58mm" ? "48mm" : "72mm"
  }; margin: 0 auto; padding: 4px; line-height: 1.35; color: #000; }
  pre { white-space: pre-wrap; font-family: inherit; font-size: 11px; margin: 0; }
</style>
</head>
<body>
  <pre>${slipText}</pre>
  <script>
    window.onload = function() { window.print(); };
  </script>
</body>
</html>`;
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
  const [openingFloat, setOpeningFloat] = useState("2000");
  const [cashierName, setCashierName] = useState("কাউন্টার ১");
  const [shiftName, setShiftName] = useState("সকালের শিফট");
  const [cashPayouts, setCashPayouts] = useState("0");
  const [actualCashCounted, setActualCashCounted] = useState("");
  const [shiftStartTime] = useState(() =>
    new Date().toLocaleTimeString("bn-BD", { hour: "2-digit", minute: "2-digit" })
  );

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
    shopName: storeName || "আমাদের শপ",
    cashierName,
    shiftStartTime,
    shiftEndTime: new Date().toLocaleTimeString("bn-BD", { hour: "2-digit", minute: "2-digit" }),
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
            <h2 className="text-base font-bold text-slate-800">💰 ক্যাশ ড্রয়ার রিকনসিলিয়েশন ও শিফট ক্লোজ (Z-Report)</h2>
            <p className="text-xs text-slate-500">কাউন্টারের প্রারম্ভিক ক্যাশ, বিক্রি, খরচ এবং হাতে থাকা নগদ মিলিয়ে চূড়ান্ত হিসাব মিলান</p>
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
                <label className="block text-xs font-semibold text-slate-700">ক্যাশিয়ারের নাম</label>
                <input
                  type="text"
                  value={cashierName}
                  onChange={(e) => setCashierName(e.target.value)}
                  className="mt-1 w-full rounded-lg border border-slate-200 px-3 py-2 text-sm"
                />
              </div>
              <div>
                <label className="block text-xs font-semibold text-slate-700">শিফটের নাম</label>
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
                <label className="block text-xs font-semibold text-slate-700">প্রারম্ভিক ক্যাশ ফ্লোট (৳)</label>
                <input
                  type="number"
                  min="0"
                  value={openingFloat}
                  onChange={(e) => setOpeningFloat(e.target.value)}
                  className="mt-1 w-full rounded-lg border border-slate-200 px-3 py-2 text-sm font-semibold"
                  placeholder="2000"
                />
                <span className="text-[10px] text-slate-400">শিফটের শুরুতে ড্রয়ারে থাকা ভাংতি টাকা</span>
              </div>
              <div>
                <label className="block text-xs font-semibold text-slate-700">নগদ খরচ / ভাউচার (৳)</label>
                <input
                  type="number"
                  min="0"
                  value={cashPayouts}
                  onChange={(e) => setCashPayouts(e.target.value)}
                  className="mt-1 w-full rounded-lg border border-slate-200 px-3 py-2 text-sm font-semibold"
                  placeholder="0"
                />
                <span className="text-[10px] text-slate-400">ড্রয়ার থেকে প্রদানকৃত খরচ (যদি থাকে)</span>
              </div>
            </div>

            <div>
              <label className="block text-xs font-semibold text-slate-700">
                হাতে গোনা নগদ ক্যাশ (Actual Cash Counted) (৳) <span className="text-red-500">*</span>
              </label>
              <input
                type="number"
                min="0"
                value={actualCashCounted}
                onChange={(e) => setActualCashCounted(e.target.value)}
                className="mt-1 w-full rounded-lg border-2 border-indigo-500 px-3 py-2.5 text-base font-bold text-indigo-900 focus:outline-none focus:ring-2 focus:ring-indigo-500"
                placeholder="কাউন্ট করে মোট কত টাকা পেয়েছেন লিখুন..."
                autoFocus
              />
              <span className="text-[10px] text-slate-500">ড্রয়ার খুলে ফিজিক্যাল ক্যাশ গুণে মোট পরিমাণ লিখুন</span>
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
                <span>হিসাবের ফলাফল:</span>
                <span className="font-mono text-base">{reconciliation.discrepancyFormatted}</span>
              </div>
              <p className="mt-1 text-xs font-medium">{reconciliation.summaryBangla}</p>
              <div className="mt-2 grid grid-cols-2 gap-2 border-t border-slate-200/60 pt-2 text-xs">
                <div>
                  প্রত্যাশিত ক্যাশ: <strong>৳{(Number(reconciliation.expectedCashInDrawerMinor) / 100).toFixed(2)}</strong>
                </div>
                <div>
                  হাতে গোনা ক্যাশ: <strong>৳{(Number(reconciliation.actualCashCountedMinor) / 100).toFixed(2)}</strong>
                </div>
              </div>
            </div>
          </div>

          {/* Thermal Z-Report Slip Preview */}
          <div className="flex flex-col items-center justify-start rounded-xl border border-dashed border-slate-300 bg-slate-50 p-4">
            <span className="mb-2 text-[11px] font-bold uppercase tracking-wider text-slate-400">
              ৮০মিমি থার্মাল Z-Report স্লিপ প্রিভিউ
            </span>
            <div className="w-full max-w-[280px] rounded bg-white p-3 font-mono text-[11px] text-slate-800 shadow-md">
              <pre className="whitespace-pre-wrap font-mono leading-tight">{zReportText}</pre>
            </div>
          </div>
        </div>

        <div className="flex items-center justify-between border-t bg-slate-50 px-6 py-3.5">
          <span className="text-xs text-slate-500">
            শিফট শেষে স্লিপ প্রিন্ট করে ক্যাশ ড্রয়ারে ও ম্যানেজারের ফাইলে রাখুন
          </span>
          <div className="flex gap-2">
            <button
              type="button"
              className="rounded-lg border border-slate-200 px-4 py-2 text-xs font-semibold text-slate-600 hover:bg-slate-100"
              onClick={onClose}
            >
              বন্ধ করুন
            </button>
            <button
              type="button"
              className="btn-primary flex items-center gap-1.5 px-5 py-2 text-xs font-semibold"
              onClick={() => openZReportPrint(zReportText, paperWidth)}
            >
              🖨️ থার্মাল Z-Report স্লিপ প্রিন্ট করুন
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
