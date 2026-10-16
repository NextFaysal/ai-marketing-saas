"use client";
import React, { useEffect, useState } from "react";
import Link from "next/link";
import { apiFetch } from "@/lib/api";
import { getOrganizationId } from "@/lib/org";
import {
  generateMediaBuyerRecommendations,
  MediaBuyerRecommendation,
  PlanMetricInput,
} from "@/lib/media-buyer-advisor";

interface MediaBuyerAdvisorProps {
  onProposalCreated?: () => void;
}

export function MediaBuyerAdvisor({ onProposalCreated }: MediaBuyerAdvisorProps) {
  const [loading, setLoading] = useState(true);
  const [plans, setPlans] = useState<PlanMetricInput[]>([]);
  const [recommendations, setRecommendations] = useState<MediaBuyerRecommendation[]>([]);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [notice, setNotice] = useState("");
  const [error, setError] = useState("");

  const scanCampaigns = async () => {
    const orgId = getOrganizationId();
    if (!orgId) return;
    setLoading(true);
    setError("");
    try {
      const data = await apiFetch<{ items: PlanMetricInput[] }>(
        `/organizations/${orgId}/campaign-plans?pageSize=50`
      );
      const items = Array.isArray(data?.items) ? data.items : [];
      setPlans(items);
      const recs = generateMediaBuyerRecommendations(items);
      setRecommendations(recs);
    } catch (e) {
      setError(e instanceof Error ? e.message : "ক্যাম্পেইন ডেটা স্ক্যান করা যায়নি");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    scanCampaigns();
  }, []);

  const handleApplyProposal = async (rec: MediaBuyerRecommendation) => {
    if (!rec.proposalType) return;
    const orgId = getOrganizationId();
    if (!orgId) return;
    setBusyId(rec.id);
    setError("");
    setNotice("");
    try {
      await apiFetch(`/organizations/${orgId}/ai/proposals`, {
        method: "POST",
        body: JSON.stringify({
          type: rec.proposalType,
          planId: rec.planId,
        }),
      });
      setNotice(
        `✅ "${rec.campaignName}"-এর জন্য এআই অ্যাকশন প্রস্তাব তৈরি হয়েছে! নিচে Proposals তালিকায় গিয়ে Approve করলেই এটি কার্যকর হবে।`
      );
      if (onProposalCreated) onProposalCreated();
    } catch (e) {
      setError(e instanceof Error ? e.message : "প্রস্তাব তৈরি ব্যর্থ হয়েছে");
    } finally {
      setBusyId(null);
    }
  };

  const highAlerts = recommendations.filter((r) => r.severity === "high").length;
  const opportunities = recommendations.filter((r) => r.severity === "opportunity").length;

  return (
    <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm space-y-5">
      {/* Header */}
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between border-b border-slate-100 pb-4">
        <div className="flex items-center gap-3">
          <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-gradient-to-tr from-purple-600 to-indigo-600 text-xl text-white shadow-sm">
            🧠
          </div>
          <div>
            <div className="flex items-center gap-2">
              <h3 className="font-bold text-slate-900 text-base">
                প্রেডিক্টিভ এআই মিডিয়া বায়ার (Daily Advisor)
              </h3>
              <span className="rounded-full bg-indigo-100 px-2.5 py-0.5 text-[10px] font-bold text-indigo-700">
                স্বয়ংক্রিয় বিশ্লেষণ
              </span>
            </div>
            <p className="text-xs text-slate-500">
              লাইভ বিজ্ঞাপনের পারফরম্যান্স ও আরওএএস বিশ্লেষণ করে বাজেট বৃদ্ধি বা অপচয় রোধের পরামর্শ।
            </p>
          </div>
        </div>

        <button
          type="button"
          onClick={scanCampaigns}
          disabled={loading}
          className="flex items-center gap-1.5 self-start rounded-lg border border-slate-200 bg-slate-50 px-3 py-1.5 text-xs font-semibold text-slate-700 hover:bg-slate-100 transition disabled:opacity-50"
        >
          <span>🔄</span>
          <span>{loading ? "স্ক্যান হচ্ছে..." : "রিয়েল-টাইম স্ক্যান চালান"}</span>
        </button>
      </div>

      {/* Metrics Bar */}
      <div className="grid grid-cols-3 gap-3 text-center text-xs">
        <div className="rounded-xl bg-slate-50 p-2.5 border border-slate-100">
          <div className="text-[10px] text-slate-400 uppercase font-semibold">মনিটরকৃত ক্যাম্পেইন</div>
          <div className="text-base font-bold text-slate-800">{plans.length} টি</div>
        </div>
        <div className="rounded-xl bg-emerald-50 p-2.5 border border-emerald-100">
          <div className="text-[10px] text-emerald-600 uppercase font-semibold">স্কেলিংয়ের সুযোগ</div>
          <div className="text-base font-bold text-emerald-700">{opportunities} টি</div>
        </div>
        <div className="rounded-xl bg-rose-50 p-2.5 border border-rose-100">
          <div className="text-[10px] text-rose-600 uppercase font-semibold">জরুরি অ্যাকশন অ্যালার্ট</div>
          <div className="text-base font-bold text-rose-700">{highAlerts} টি</div>
        </div>
      </div>

      {/* Alerts */}
      {error && (
        <div className="rounded-xl border border-red-200 bg-red-50 p-3 text-xs text-red-700 flex items-center justify-between">
          <span>⚠️ {error}</span>
          <button type="button" onClick={() => setError("")} className="font-bold text-red-500">✕</button>
        </div>
      )}

      {notice && (
        <div className="rounded-xl border border-emerald-200 bg-emerald-50 p-3 text-xs text-emerald-800 flex items-center justify-between">
          <span>{notice}</span>
          <button type="button" onClick={() => setNotice("")} className="font-bold text-emerald-600">✕</button>
        </div>
      )}

      {/* Recommendations Cards */}
      {loading ? (
        <div className="p-8 text-center text-xs text-slate-400">
          <div className="inline-block h-5 w-5 animate-spin rounded-full border-2 border-indigo-600 border-t-transparent mb-2" />
          <p>আপনার বিজ্ঞাপনের মেট্রিকস বিশ্লেষণ করা হচ্ছে...</p>
        </div>
      ) : recommendations.length === 0 ? (
        <div className="rounded-xl border border-dashed border-slate-200 p-6 text-center text-xs text-slate-500">
          <span className="text-2xl mb-1 block">✨</span>
          <p className="font-semibold text-slate-700">সব ক্যাম্পেইন স্বাভাবিক অবস্থায় চলছে</p>
          <p className="text-[11px] text-slate-400 mt-1">
            কোনো ক্রিয়েটিভ ক্লান্তি বা অস্বাভাবিক বাজেট অপচয় পাওয়া যায়নি।
          </p>
        </div>
      ) : (
        <div className="space-y-3">
          {recommendations.map((rec) => {
            const isHigh = rec.severity === "high";
            const isOpp = rec.severity === "opportunity";
            return (
              <div
                key={rec.id}
                className={`rounded-xl border p-4 transition ${
                  isHigh
                    ? "border-rose-200 bg-rose-50/40"
                    : isOpp
                    ? "border-emerald-200 bg-emerald-50/40"
                    : "border-indigo-100 bg-indigo-50/30"
                }`}
              >
                <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-3">
                  <div className="space-y-1.5">
                    <div className="flex flex-wrap items-center gap-2">
                      <span
                        className={`rounded-full px-2.5 py-0.5 text-[11px] font-bold ${
                          isHigh
                            ? "bg-rose-100 text-rose-800"
                            : isOpp
                            ? "bg-emerald-100 text-emerald-800"
                            : "bg-indigo-100 text-indigo-800"
                        }`}
                      >
                        {rec.badgeLabel}
                      </span>
                      <span className="text-[11px] font-medium text-slate-500 bg-white px-2 py-0.5 rounded border border-slate-200">
                        {rec.metricBadge}
                      </span>
                    </div>

                    <h4 className="font-bold text-slate-900 text-sm">
                      {rec.title}: <span className="font-medium text-slate-700">{rec.campaignName}</span>
                    </h4>

                    <p className="text-xs text-slate-600 leading-relaxed max-w-2xl">
                      {rec.reason}
                    </p>
                  </div>

                  {/* Action button */}
                  <div className="shrink-0 self-end sm:self-center">
                    {rec.proposalType ? (
                      <button
                        type="button"
                        onClick={() => handleApplyProposal(rec)}
                        disabled={busyId === rec.id}
                        className="rounded-lg bg-rose-600 px-3.5 py-2 text-xs font-semibold text-white shadow-sm hover:bg-rose-700 transition disabled:opacity-50"
                      >
                        {busyId === rec.id ? "প্রস্তাব তৈরি হচ্ছে..." : rec.suggestedActionLabel}
                      </button>
                    ) : rec.actionUrl ? (
                      <Link
                        href={rec.actionUrl}
                        className={`inline-block rounded-lg px-3.5 py-2 text-xs font-semibold shadow-sm transition ${
                          isOpp
                            ? "bg-emerald-600 text-white hover:bg-emerald-700"
                            : "bg-indigo-600 text-white hover:bg-indigo-700"
                        }`}
                      >
                        {rec.suggestedActionLabel} →
                      </Link>
                    ) : null}
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
