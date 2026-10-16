"use client";
import React, { useEffect, useState } from "react";
import Link from "next/link";
import { apiFetch } from "@/lib/api";
import { getOrganizationId } from "@/lib/org";

export interface GrowthOpportunity {
  id: string;
  category:
    | "scale_winner"
    | "pause_bleeder"
    | "creative_fatigue"
    | "retargeting"
    | "inventory_guard";
  priority: "critical" | "high" | "medium";
  title: string;
  summary: string;
  metrics: {
    spendBdt?: string;
    revenueBdt?: string;
    roas?: number | null;
    purchases?: number;
    frequency?: number | null;
    ctrPercent?: number | null;
    ctrDropPercent?: number | null;
    stockRemaining?: number;
  };
  projectedImpactBn: string;
  actionType:
    | "pause_campaign"
    | "scale_budget"
    | "rotate_creative"
    | "reorder_stock"
    | "create_broadcast";
  actionPayload: Record<string, any>;
}

export interface GrowthCopilotSummary {
  overallHealthScore: number;
  scannedCampaignCount: number;
  totalSpend7DaysBdt: string;
  totalRevenue7DaysBdt: string;
  blendedRoas: number | null;
  opportunities: GrowthOpportunity[];
}

export interface GrowthCopilotHubProps {
  onActionApplied?: () => void | Promise<void>;
}

export function GrowthCopilotHub(props: GrowthCopilotHubProps) {
  const [data, setData] = useState<GrowthCopilotSummary | null>(null);
  const [loading, setLoading] = useState(false);
  const [activeCategory, setActiveCategory] = useState<string>("all");
  const [actionBusyId, setActionBusyId] = useState<string | null>(null);
  const [actionNotice, setActionNotice] = useState<string>("");
  const [actionError, setActionError] = useState<string>("");

  const loadAudit = async () => {
    const orgId = getOrganizationId();
    if (!orgId) return;
    try {
      setLoading(true);
      const res = await apiFetch<GrowthCopilotSummary>(
        `/organizations/${orgId}/ai/growth-copilot`,
      );
      setData(res);
    } catch {
      // Non-blocking
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadAudit();
  }, []);

  const handleApplyAction = async (opp: GrowthOpportunity) => {
    const orgId = getOrganizationId();
    if (!orgId) return;

    setActionBusyId(opp.id);
    setActionNotice("");
    setActionError("");

    try {
      const res = await apiFetch<any>(
        `/organizations/${orgId}/ai/growth-copilot/apply-action`,
        {
          method: "POST",
          body: JSON.stringify({
            opportunityId: opp.id,
            actionType: opp.actionType,
            payload: opp.actionPayload,
          }),
        },
      );
      setActionNotice(res.message || "অ্যাকশনটি সফলভাবে কার্যকর হয়েছে!");
      await loadAudit();
      await props.onActionApplied?.();
    } catch (e) {
      setActionError(e instanceof Error ? e.message : "অ্যাকশন সম্পন্ন করা যায়নি");
    } finally {
      setActionBusyId(null);
    }
  };

  if (loading && !data) {
    return (
      <div className="rounded-2xl border border-indigo-100 bg-indigo-50/30 p-6 flex items-center justify-center gap-2 text-xs text-indigo-700">
        <span className="h-4 w-4 animate-spin rounded-full border-2 border-indigo-600 border-t-transparent" />
        <span>এআই গ্রোথ কোপাইলট লাইভ বিজ্ঞাপন ও পারফরম্যান্স স্ক্যান করছে...</span>
      </div>
    );
  }

  if (!data || data.opportunities.length === 0) {
    return null;
  }

  const filteredOpps =
    activeCategory === "all"
      ? data.opportunities
      : data.opportunities.filter((o) => o.category === activeCategory);

  const getPriorityBadge = (p: string) => {
    if (p === "critical")
      return (
        <span className="rounded-md bg-red-100 px-2 py-0.5 text-[10px] font-bold text-red-800 border border-red-200">
          🚨 জরুরি অ্যালার্ট
        </span>
      );
    if (p === "high")
      return (
        <span className="rounded-md bg-amber-100 px-2 py-0.5 text-[10px] font-bold text-amber-800 border border-amber-200">
          ⚡ গুরুত্বপূর্ণ সুযোগ
        </span>
      );
    return (
      <span className="rounded-md bg-blue-100 px-2 py-0.5 text-[10px] font-bold text-blue-800 border border-blue-200">
        💡 পরামর্শ
      </span>
    );
  };

  return (
    <div className="rounded-2xl border border-indigo-200/80 bg-gradient-to-br from-indigo-50/60 via-white to-purple-50/40 p-5 shadow-sm space-y-4">
      {/* Top Header & Health Gauge */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 border-b border-indigo-100 pb-4">
        <div className="flex items-center gap-3">
          <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-gradient-to-tr from-indigo-600 to-violet-600 text-white text-lg shadow">
            🤖
          </span>
          <div>
            <div className="flex items-center gap-2">
              <h3 className="font-bold text-slate-900 text-base">
                AI Growth Copilot & Ad Optimizer
              </h3>
              <span className="rounded-full bg-indigo-600 px-2 py-0.5 text-[10px] font-extrabold text-white">
                LIVE
              </span>
            </div>
            <p className="text-xs text-slate-500 mt-0.5">
              অটোমেটেড বিজ্ঞাপন অডিট: লস কমানো, উইনিং ক্যাম্পেইন স্কেলিং ও ক্রিয়েটিভ অপটিমাইজেশন
            </p>
          </div>
        </div>

        {/* Health Score & 7-day stats */}
        <div className="flex items-center gap-4">
          <div className="text-right">
            <span className="text-[10px] uppercase font-bold text-slate-400 block">বিজ্ঞাপন স্বাস্থ্য স্কোর</span>
            <div className="flex items-baseline justify-end gap-1">
              <span
                className={`text-2xl font-black ${
                  data.overallHealthScore >= 80
                    ? "text-emerald-600"
                    : data.overallHealthScore >= 60
                    ? "text-amber-600"
                    : "text-red-600"
                }`}
              >
                {data.overallHealthScore}
              </span>
              <span className="text-xs font-semibold text-slate-400">/১০০</span>
            </div>
          </div>

          <div className="hidden sm:block h-8 w-px bg-slate-200" />

          <div className="hidden sm:block text-right">
            <span className="text-[10px] uppercase font-bold text-slate-400 block">গত ৭ দিনের ROAS</span>
            <span className="text-base font-bold text-slate-800">
              {data.blendedRoas ? `${data.blendedRoas}x` : "—"}
            </span>
          </div>
        </div>
      </div>

      {actionNotice && (
        <div className="rounded-xl bg-emerald-50 p-3 text-xs text-emerald-800 border border-emerald-200 font-medium">
          {actionNotice}
        </div>
      )}

      {actionError && (
        <div className="rounded-xl bg-red-50 p-3 text-xs text-red-800 border border-red-200 font-medium">
          {actionError}
        </div>
      )}

      {/* Category Pills */}
      <div className="flex flex-wrap items-center gap-1.5 text-xs font-semibold">
        <button
          type="button"
          onClick={() => setActiveCategory("all")}
          className={`rounded-lg px-2.5 py-1 transition ${
            activeCategory === "all"
              ? "bg-indigo-600 text-white shadow-sm"
              : "bg-white text-slate-600 border border-slate-200 hover:bg-slate-50"
          }`}
        >
          সব সুযোগ ({data.opportunities.length})
        </button>
        <button
          type="button"
          onClick={() => setActiveCategory("pause_bleeder")}
          className={`rounded-lg px-2.5 py-1 transition ${
            activeCategory === "pause_bleeder"
              ? "bg-red-600 text-white shadow-sm"
              : "bg-white text-slate-600 border border-slate-200 hover:bg-slate-50"
          }`}
        >
          🛑 ক্ষতি রোধ
        </button>
        <button
          type="button"
          onClick={() => setActiveCategory("scale_winner")}
          className={`rounded-lg px-2.5 py-1 transition ${
            activeCategory === "scale_winner"
              ? "bg-emerald-600 text-white shadow-sm"
              : "bg-white text-slate-600 border border-slate-200 hover:bg-slate-50"
          }`}
        >
          🚀 উইনার স্কেল
        </button>
        <button
          type="button"
          onClick={() => setActiveCategory("creative_fatigue")}
          className={`rounded-lg px-2.5 py-1 transition ${
            activeCategory === "creative_fatigue"
              ? "bg-purple-600 text-white shadow-sm"
              : "bg-white text-slate-600 border border-slate-200 hover:bg-slate-50"
          }`}
        >
          ⚡ ক্রিয়েটিভ রিফ্রেশ
        </button>
        <button
          type="button"
          onClick={() => setActiveCategory("retargeting")}
          className={`rounded-lg px-2.5 py-1 transition ${
            activeCategory === "retargeting"
              ? "bg-blue-600 text-white shadow-sm"
              : "bg-white text-slate-600 border border-slate-200 hover:bg-slate-50"
          }`}
        >
          🛒 কার্ট রিকভারি
        </button>
      </div>

      {/* Opportunity Cards List */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-3 pt-1">
        {filteredOpps.map((opp) => (
          <div
            key={opp.id}
            className="rounded-xl border border-slate-200/90 bg-white p-4 shadow-sm hover:border-indigo-300 transition flex flex-col justify-between space-y-3"
          >
            <div className="space-y-1.5">
              <div className="flex items-center justify-between gap-2">
                {getPriorityBadge(opp.priority)}
                <span className="text-[11px] font-bold text-indigo-700 bg-indigo-50 px-2 py-0.5 rounded border border-indigo-100">
                  {opp.projectedImpactBn}
                </span>
              </div>
              <h4 className="text-sm font-bold text-slate-900 leading-snug">
                {opp.title}
              </h4>
              <p className="text-xs text-slate-600 leading-relaxed">
                {opp.summary}
              </p>
            </div>

            {/* Metrics Tag & Action Button */}
            <div className="flex flex-wrap items-center justify-between gap-2 border-t border-slate-100 pt-2.5">
              <div className="flex items-center gap-2 text-[11px] text-slate-500 font-medium">
                {opp.metrics.spendBdt && (
                  <span>খরচ: <b className="text-slate-800">৳{opp.metrics.spendBdt}</b></span>
                )}
                {opp.metrics.purchases !== undefined && (
                  <span>অর্ডার: <b className="text-slate-800">{opp.metrics.purchases}টি</b></span>
                )}
                {opp.metrics.ctrPercent !== undefined && opp.metrics.ctrPercent !== null && (
                  <span>CTR: <b className="text-slate-800">{opp.metrics.ctrPercent}%</b></span>
                )}
              </div>

              <div>
                {opp.actionType === "rotate_creative" ? (
                  <Link
                    href="/dashboard/creative-studio"
                    className="inline-flex items-center gap-1 rounded-lg bg-purple-50 border border-purple-200 px-3 py-1.5 text-xs font-bold text-purple-700 hover:bg-purple-100 transition"
                  >
                    🎨 ক্রিয়েটিভ স্টুডিও
                  </Link>
                ) : (
                  <button
                    type="button"
                    disabled={actionBusyId === opp.id}
                    onClick={() => handleApplyAction(opp)}
                    className={`inline-flex items-center gap-1 rounded-lg px-3 py-1.5 text-xs font-bold text-white shadow-sm transition disabled:opacity-50 ${
                      opp.actionType === "pause_campaign"
                        ? "bg-red-600 hover:bg-red-700"
                        : opp.actionType === "scale_budget"
                        ? "bg-emerald-600 hover:bg-emerald-700"
                        : "bg-indigo-600 hover:bg-indigo-700"
                    }`}
                  >
                    {actionBusyId === opp.id ? (
                      <span className="inline-block h-3 w-3 animate-spin rounded-full border-2 border-white border-t-transparent" />
                    ) : opp.actionType === "pause_campaign" ? (
                      "🛑 ক্যাম্পেইন পজ করুন"
                    ) : opp.actionType === "scale_budget" ? (
                      "📈 বাজেট ২০% বাড়ান"
                    ) : opp.actionType === "create_broadcast" ? (
                      "💬 কার্ট রিকভারি ড্রাফট"
                    ) : (
                      "অ্যাকশন নিন"
                    )}
                  </button>
                )}
              </div>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
