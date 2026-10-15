"use client";
import React from "react";
import { extractedSummary, type LabelScanResultView, type LabelMatchView } from "@/lib/cx8";

interface LabelScannerModalProps {
  isOpen: boolean;
  onClose: () => void;
  labelQuery: string;
  onLabelQueryChange: (q: string) => void;
  labelScan: LabelScanResultView | null;
  labelBusy: string;
  labelError: string;
  onRunLabelScan: (file: File) => void;
  onRunLabelLookup: () => void;
  onOpenScannedOrder: (match: LabelMatchView) => void;
}

export function LabelScannerModal({
  isOpen,
  onClose,
  labelQuery,
  onLabelQueryChange,
  labelScan,
  labelBusy,
  labelError,
  onRunLabelScan,
  onRunLabelLookup,
  onOpenScannedOrder,
}: LabelScannerModalProps) {
  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/40 p-4 backdrop-blur-xs animate-fade">
      <div className="w-full max-w-xl rounded-3xl bg-white p-6 shadow-2xl animate-rise space-y-4">
        {/* Header */}
        <div className="flex items-center justify-between border-b border-slate-100 pb-3">
          <div>
            <h3 className="text-base font-bold text-slate-900">📷 AI প্যাকিং — লেবেল স্ক্যানার</h3>
            <p className="text-xs text-slate-500">
              পার্সেলের লেবেলের ছবি দিলে AI ট্র্যাকিং কোড বা অর্ডার নম্বর শনাক্ত করে খুঁজে দেয়।
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="rounded-xl border border-slate-200 p-2 text-slate-400 hover:bg-slate-100 hover:text-slate-700"
          >
            ✕
          </button>
        </div>

        {/* Upload & Search Box */}
        <div className="space-y-3">
          <div className="flex flex-wrap items-center gap-2">
            <label
              className={`inline-flex items-center gap-1.5 rounded-xl bg-indigo-600 px-4 py-2 text-xs font-semibold text-white shadow-sm hover:bg-indigo-700 active:scale-95 ${
                labelBusy ? "pointer-events-none opacity-50" : "cursor-pointer"
              }`}
            >
              <span>{labelBusy === "scan" ? "ছবি পড়া হচ্ছে..." : "📷 ছবির ফাইল বা ক্যামেরা"}</span>
              <input
                type="file"
                accept="image/jpeg,image/png,image/webp"
                className="hidden"
                disabled={labelBusy !== ""}
                onChange={(e) => {
                  const f = e.target.files?.[0];
                  e.target.value = "";
                  if (f) void onRunLabelScan(f);
                }}
              />
            </label>

            <span className="text-xs text-slate-400">অথবা নম্বর লিখুন:</span>
          </div>

          <div className="flex items-center gap-2">
            <input
              type="text"
              className="flex-1 rounded-xl border border-slate-200 px-3 py-2 text-xs focus:outline-none focus:ring-2 focus:ring-indigo-500"
              placeholder="ট্র্যাকিং কোড, অর্ডার # বা ফোনের শেষ ৪ ডিজিট..."
              value={labelQuery}
              onChange={(e) => onLabelQueryChange(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  e.preventDefault();
                  onRunLabelLookup();
                }
              }}
            />
            <button
              type="button"
              disabled={labelBusy !== "" || !labelQuery.trim()}
              onClick={onRunLabelLookup}
              className="rounded-xl bg-slate-900 px-4 py-2 text-xs font-semibold text-white shadow-sm hover:bg-slate-800 disabled:opacity-50"
            >
              {labelBusy === "lookup" ? "খোঁজা হচ্ছে..." : "খুঁজুন"}
            </button>
          </div>
        </div>

        {/* Error Notice */}
        {labelError && (
          <div className="rounded-xl bg-red-50 p-3 text-xs text-red-600 font-medium">
            {labelError}
          </div>
        )}

        {/* Results Display */}
        {labelScan && !labelScan.available && (
          <div className="rounded-xl bg-amber-50 p-3 text-xs text-amber-800">
            AI ছবি পড়া এখন সেটআপ করা নেই — উপরের বক্সে সরাসরি নম্বর লিখে খুঁজুন।
          </div>
        )}

        {labelScan && labelScan.matched && (
          <div className="rounded-2xl border border-emerald-200 bg-emerald-50/70 p-4 space-y-2">
            <div className="flex items-center justify-between">
              <span className="font-bold text-emerald-800 text-xs">✓ অর্ডার শনাক্ত হয়েছে!</span>
              <button
                type="button"
                onClick={() => {
                  onOpenScannedOrder(labelScan.matched!);
                  onClose();
                }}
                className="rounded-xl bg-emerald-700 px-3 py-1.5 text-xs font-bold text-white shadow-sm hover:bg-emerald-800"
              >
                ড্রয়ারে খুলুন →
              </button>
            </div>
            <div className="text-xs text-emerald-900">
              অর্ডার #{labelScan.matched.orderNumber ?? labelScan.matched.orderId.slice(0, 8)}
              {labelScan.matched.trackingCode && ` · Tracking: ${labelScan.matched.trackingCode}`}
              {labelScan.matched.provider && ` · ${labelScan.matched.provider}`}
              {labelScan.matched.shipmentStatus && ` · শিপমেন্ট: ${labelScan.matched.shipmentStatus}`}
            </div>
          </div>
        )}

        {labelScan && !labelScan.matched && labelScan.candidates.length > 0 && (
          <div className="space-y-2">
            <p className="text-xs font-semibold text-slate-700">
              ফোনের শেষ ৪ ডিজিট মিলিয়ে সম্ভাব্য পার্সেল ({labelScan.candidates.length}টি):
            </p>
            <div className="max-h-48 space-y-1.5 overflow-y-auto">
              {labelScan.candidates.map((c) => (
                <div
                  key={c.shipmentId ?? c.orderId}
                  className="flex items-center justify-between rounded-xl border border-slate-200 bg-slate-50 p-2.5 text-xs"
                >
                  <div>
                    <span className="font-bold text-slate-900">
                      #{c.orderNumber ?? c.orderId.slice(0, 8)}
                    </span>
                    {c.trackingCode && <span className="ml-2 text-slate-500">{c.trackingCode}</span>}
                    {c.provider && <span className="ml-1 text-slate-500">({c.provider})</span>}
                  </div>
                  <button
                    type="button"
                    onClick={() => {
                      onOpenScannedOrder(c);
                      onClose();
                    }}
                    className="font-bold text-indigo-600 hover:underline"
                  >
                    খুলুন
                  </button>
                </div>
              ))}
            </div>
          </div>
        )}

        {labelScan && labelScan.available && !labelScan.matched && labelScan.candidates.length === 0 && (
          <div className="rounded-xl bg-slate-50 p-3 text-xs text-slate-600">
            কোনো মিল পাওয়া যায়নি।
            {extractedSummary(labelScan)
              ? ` ছবি/খোঁজ থেকে পড়া মান: ${extractedSummary(labelScan)}`
              : " ছবি থেকে কোনো নম্বর পরিষ্কার পড়া যায়নি।"}
          </div>
        )}
      </div>
    </div>
  );
}
