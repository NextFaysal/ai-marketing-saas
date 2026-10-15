"use client";
import React from "react";
import type { RiskDetail } from "./types";
import { RISK_LABEL } from "./types";

interface RiskModalProps {
  riskDetail: (RiskDetail & { orderLabel: string }) | null;
  onClose: () => void;
}

export function RiskModal({ riskDetail, onClose }: RiskModalProps) {
  if (!riskDetail) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/40 p-4 backdrop-blur-xs animate-fade">
      <div className="w-full max-w-lg rounded-3xl bg-white p-6 shadow-2xl animate-rise space-y-4">
        {/* Header */}
        <div className="flex items-center justify-between border-b border-slate-100 pb-3">
          <div className="flex items-center gap-2">
            <h3 className="text-base font-bold text-slate-900">
              ↩️ রিটার্ন ঝুঁকি — অর্ডার {riskDetail.orderLabel}
            </h3>
            <span
              className={`rounded-full px-2 py-0.5 text-xs font-bold ${
                RISK_LABEL[riskDetail.band]?.cls ?? ""
              }`}
            >
              {RISK_LABEL[riskDetail.band]?.text ?? riskDetail.band}
              {riskDetail.score !== null && ` (${riskDetail.score}%)`}
            </span>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="rounded-xl border border-slate-200 p-2 text-slate-400 hover:bg-slate-100 hover:text-slate-700"
          >
            ✕
          </button>
        </div>

        {/* Reasons */}
        <div className="space-y-3 text-xs">
          <span className="font-bold text-slate-700">শনাক্তকৃত কারণসমূহ:</span>
          <ul className="list-disc space-y-1.5 pl-5 text-slate-600">
            {riskDetail.reasons.map((r, i) => (
              <li key={i}>{r}</li>
            ))}
          </ul>

          {riskDetail.suggestion && (
            <div className="rounded-xl border border-amber-200 bg-amber-50/70 p-3 text-xs font-semibold text-amber-900">
              💡 পরামর্শ: {riskDetail.suggestion}
            </div>
          )}

          <p className="text-[11px] text-slate-400 pt-2 border-t border-slate-100">
            * এই স্কোরটি গ্রাহকের পূর্বের ডেলিভারি ইতিহাস পর্যালোচনা করে তৈরি। সিদ্ধান্ত নেওয়ার সম্পূর্ণ ক্ষমতা আপনার।
          </p>
        </div>
      </div>
    </div>
  );
}
