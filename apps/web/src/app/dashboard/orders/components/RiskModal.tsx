"use client";
import React from "react";
import { useLocale } from "@/lib/i18n/provider";
import type { RiskDetail } from "./types";
import { RISK_LABEL } from "./types";

interface RiskModalProps {
  riskDetail: (RiskDetail & { orderLabel: string }) | null;
  onClose: () => void;
}

export function RiskModal({ riskDetail, onClose }: RiskModalProps) {
  const { dict, t, locale } = useLocale();
  if (!riskDetail) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/40 p-4 backdrop-blur-xs animate-fade">
      <div className="w-full max-w-lg rounded-3xl bg-white p-6 shadow-2xl animate-rise space-y-4">
        {/* Header */}
        <div className="flex items-center justify-between border-b border-slate-100 pb-3">
          <div className="flex items-center gap-2">
            <h3 className="text-base font-bold text-slate-900">
              {dict.orders.returnRiskOrder}{riskDetail.orderLabel}
            </h3>
            <span
              className={`rounded-full px-2 py-0.5 text-xs font-bold ${
                RISK_LABEL[riskDetail.band as keyof typeof RISK_LABEL]?.cls ?? ""
              }`}
            >
              {RISK_LABEL[riskDetail.band as keyof typeof RISK_LABEL] ? dict.orders[RISK_LABEL[riskDetail.band as keyof typeof RISK_LABEL]!.textKey] : riskDetail.band}
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
          <span className="font-bold text-slate-700">{dict.orders.identifiedReasons}</span>
          <ul className="list-disc space-y-1.5 pl-5 text-slate-600">
            {riskDetail.reasons.map((r, i) => (
              <li key={i}>{r}</li>
            ))}
          </ul>

          {riskDetail.suggestion && (
            <div className="rounded-xl border border-amber-200 bg-amber-50/70 p-3 text-xs font-semibold text-amber-900">
              {dict.orders.suggestion2}{riskDetail.suggestion}
            </div>
          )}

          <p className="text-[11px] text-slate-400 pt-2 border-t border-slate-100">
            {dict.orders.thisScoreIsMadeBy}</p>
        </div>
      </div>
    </div>
  );
}
