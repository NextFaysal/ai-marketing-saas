"use client";
import React, { useEffect, useState } from "react";
import { useLocale } from "@/lib/i18n/provider";
import { apiFetch } from "@/lib/api";
import { getOrganizationId } from "@/lib/org";

export interface CourierScorecard {
  provider: "steadfast" | "pathao" | "redx" | string;
  courierAccountId: string | null;
  overallScore: number;
  deliveryRate: number | null;
  returnRate: number | null;
  sampleSize: number;
  speedRating: "fast" | "standard" | "moderate";
  estimatedTurnaround: string;
  recommendationReason: string;
  isWinner: boolean;
}

export interface SmartRoutingData {
  orderId: string;
  district: string;
  isInsideDhaka: boolean;
  recommendedProvider: string;
  recommendedCourierAccountId: string | null;
  confidence: "high" | "medium" | "benchmark";
  summaryReason: string;
  scorecards: CourierScorecard[];
}

export function SmartRoutingCard({
  orderId,
  currentProvider,
  onSelectProvider,
}: {
  orderId: string;
  currentProvider: string;
  onSelectProvider: (provider: string) => Promise<void>;
}) {
  const { dict, t, locale } = useLocale();
  const [data, setData] = useState<SmartRoutingData | null>(null);
  const [loading, setLoading] = useState(false);
  const [showDetails, setShowDetails] = useState(false);
  const [applying, setApplying] = useState(false);

  useEffect(() => {
    const orgId = getOrganizationId();
    if (!orgId || !orderId) return;

    let mounted = true;
    setLoading(true);

    apiFetch<SmartRoutingData>(`/organizations/${orgId}/courier/smart-routing/${orderId}`)
      .then((res) => {
        if (mounted) setData(res);
      })
      .catch(() => {
        // Non-blocking fallback
      })
      .finally(() => {
        if (mounted) setLoading(false);
      });

    return () => {
      mounted = false;
    };
  }, [orderId]);

  if (loading) {
    return (
      <div className="rounded-xl border border-blue-100 bg-blue-50/40 p-3 text-xs text-blue-800 flex items-center gap-2">
        <span className="h-3.5 w-3.5 animate-spin rounded-full border-2 border-blue-600 border-t-transparent" />
        <span>{dict.orders.smartAICourierRoutingIs}</span>
      </div>
    );
  }

  if (!data) return null;

  const winner = data.scorecards.find((s) => s.isWinner) || data.scorecards[0];
  const isSelected = currentProvider === data.recommendedProvider;

  return (
    <div className="rounded-2xl border border-sky-200/80 bg-gradient-to-br from-sky-50/50 via-white to-blue-50/30 p-3.5 shadow-sm space-y-2.5">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <span className="flex h-6 w-6 items-center justify-center rounded-lg bg-sky-600 text-white text-xs font-bold shadow-sm">
            AI
          </span>
          <div>
            <div className="flex items-center gap-1.5">
              <span className="text-xs font-bold text-slate-800">
                {dict.orders.smartCourierRouting}{data.district}
              </span>
              <span className="rounded bg-sky-100 px-1.5 py-0.2 text-[10px] font-bold text-sky-800">
                {data.isInsideDhaka ? dict.orders.dhakaMetro : dict.orders.outsideDhaka}
              </span>
            </div>
            <p className="text-[11px] text-slate-500">
              {dict.orders.optimizedBasedOnHistoricalDelivery}</p>
          </div>
        </div>

        {!isSelected && (
          <button
            type="button"
            disabled={applying}
            onClick={async () => {
              setApplying(true);
              try {
                await onSelectProvider(data.recommendedProvider);
              } finally {
                setApplying(false);
              }
            }}
            className="rounded-xl bg-sky-600 px-3 py-1.5 text-xs font-bold text-white shadow-sm hover:bg-sky-700 disabled:opacity-50 transition flex items-center gap-1.5"
          >
            {applying ? (
              <span>{dict.orders.selecting}</span>
            ) : (
              <>
                <span>⚡</span>
                <span>{dict.orders.selectBestCourier}</span>
              </>
            )}
          </button>
        )}
      </div>

      {/* Recommendation Banner */}
      <div className="rounded-xl border border-sky-100 bg-white p-2.5 text-xs">
        <div className="flex items-center justify-between">
          <span className="font-semibold text-slate-700">
            {winner?.provider === "steadfast"
              ? "Steadfast Courier"
              : winner?.provider === "pathao"
              ? "Pathao Courier"
              : "RedX Logistics"}
          </span>
          <span className="rounded-lg bg-emerald-50 px-2 py-0.5 text-[11px] font-bold text-emerald-700 border border-emerald-200">
            {dict.orders.score}{winner?.overallScore}{dict.orders.text2byoo}</span>
        </div>
        <p className="mt-1 text-[11px] text-slate-600 leading-relaxed">
          {data.summaryReason}
        </p>
      </div>

      {/* Details accordion */}
      <div>
        <button
          type="button"
          onClick={() => setShowDetails(!showDetails)}
          className="text-[11px] font-medium text-sky-700 hover:underline"
        >
          {showDetails ? dict.orders.hideDetailedScorecard : dict.orders.viewAllCouriersComparativeScorecard}
        </button>

        {showDetails && (
          <div className="mt-2 grid grid-cols-1 sm:grid-cols-3 gap-2 pt-1">
            {data.scorecards.map((s) => (
              <div
                key={s.provider}
                className={`rounded-xl border p-2.5 text-[11px] ${
                  s.isWinner
                    ? "border-sky-300 bg-sky-50/50 shadow-sm"
                    : "border-slate-100 bg-slate-50/60"
                }`}
              >
                <div className="flex items-center justify-between font-bold text-slate-800">
                  <span className="capitalize">{s.provider}</span>
                  <span>{s.overallScore} pt</span>
                </div>
                <div className="mt-1 space-y-0.5 text-slate-500 text-[10px]">
                  <div>{dict.orders.estimatedTime}<span className="font-semibold text-slate-700">{s.estimatedTurnaround}</span></div>
                  {s.deliveryRate !== null && (
                    <div>{dict.orders.deliverySuccess}<span className="font-bold text-emerald-700">{Math.round(s.deliveryRate * 100)}%</span></div>
                  )}
                  {s.returnRate !== null && (
                    <div>{dict.orders.returnRate2}<span className="font-bold text-red-600">{Math.round(s.returnRate * 100)}%</span></div>
                  )}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
