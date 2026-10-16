"use client";
import React, { useEffect, useState } from "react";
import Link from "next/link";
import { apiFetch } from "@/lib/api";
import { getOrganizationId } from "@/lib/org";
import { formatMinor } from "@repo/contracts";
import { getVerdictLabel } from "@/lib/ab-test-winner";

export interface AbVariant {
  planId: string;
  name: string;
  variant: string;
  status: string;
  spendMinor: string;
  platformConversions: number;
  platformCpaMinor: string | null;
  firstPartyOrders: number;
  firstPartyRevenueMinor: string;
  firstPartyCpaMinor: string | null;
}

export interface AbTestGroup {
  groupId: string;
  metric: string;
  variants: AbVariant[];
  winnerPlanId: string | null;
  verdict: string;
}

interface AbTestHubProps {
  plans: { id: string; name: string; status: string }[];
  onRefreshPlans?: () => void;
}

export function AbTestHub({ plans, onRefreshPlans }: AbTestHubProps) {
  const [loading, setLoading] = useState(true);
  const [groups, setGroups] = useState<AbTestGroup[]>([]);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [busy, setBusy] = useState<string | null>(null);

  // New variant modal/form state
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [sourcePlanId, setSourcePlanId] = useState(plans[0]?.id ?? "");
  const [variantLabel, setVariantLabel] = useState("B");
  const [metricChoice, setMetricChoice] = useState<"first_party_cpa" | "platform_cpa">("first_party_cpa");

  const loadAbTests = async () => {
    const orgId = getOrganizationId();
    if (!orgId) return;
    setLoading(true);
    setError("");
    try {
      const data = await apiFetch<AbTestGroup[]>(`/organizations/${orgId}/campaigns/ab-tests/list`);
      setGroups(Array.isArray(data) ? data : []);
    } catch (e) {
      setError(e instanceof Error ? e.message : "A/B টেস্ট তালিকা লোড করা যায়নি");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadAbTests();
  }, []);

  const handlePromoteWinner = async (planId: string) => {
    const orgId = getOrganizationId();
    if (!orgId) return;
    setBusy(`promote-${planId}`);
    setError("");
    setNotice("");
    try {
      const res = await apiFetch<any>(`/organizations/${orgId}/campaigns/${planId}/promote-winner`, {
        method: "POST",
      });
      setNotice(`✅ বিজয়ী সংস্করণ সফলভাবে প্রমোট করা হয়েছে! নতুন ড্রাফট: "${res?.name || planId}"`);
      await loadAbTests();
      if (onRefreshPlans) onRefreshPlans();
    } catch (e) {
      setError(e instanceof Error ? e.message : "উইনার প্রমোট করা যায়নি");
    } finally {
      setBusy(null);
    }
  };

  const handleCreateVariant = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!sourcePlanId) return;
    const orgId = getOrganizationId();
    if (!orgId) return;
    setBusy("create-variant");
    setError("");
    setNotice("");
    try {
      await apiFetch(`/organizations/${orgId}/campaigns/${sourcePlanId}/ab-variant`, {
        method: "POST",
        body: JSON.stringify({
          variant: variantLabel,
          metric: metricChoice,
        }),
      });
      setNotice(`✅ সফলভাবে নতুন A/B ভ্যারিয়েন্ট (${variantLabel}) তৈরি করা হয়েছে!`);
      setShowCreateModal(false);
      await loadAbTests();
      if (onRefreshPlans) onRefreshPlans();
    } catch (e) {
      setError(e instanceof Error ? e.message : "ভ্যারিয়েন্ট তৈরি ব্যর্থ হয়েছে");
    } finally {
      setBusy(null);
    }
  };

  const formatMoney = (minor: string | null | undefined) => {
    if (!minor || minor === "0") return "৳০";
    try {
      return formatMinor(BigInt(minor), "BDT");
    } catch {
      return `${minor} BDT`;
    }
  };

  return (
    <div className="space-y-6">
      {/* Top Banner & Header */}
      <div className="rounded-xl border border-indigo-200 bg-gradient-to-r from-indigo-50 via-sky-50 to-purple-50 p-5 shadow-sm">
        <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
          <div className="space-y-1">
            <div className="flex items-center gap-2">
              <span className="flex h-9 w-9 items-center justify-center rounded-lg bg-indigo-600 text-lg text-white shadow-sm">
                ⚖️
              </span>
              <h2 className="text-lg font-bold text-slate-900">
                অটো A/B টেস্টিং ও উইনার ডিটেক্টর (A/B Test Hub)
              </h2>
            </div>
            <p className="text-xs text-slate-600">
              ভিন্ন ভিন্ন ক্রিয়েটিভ বা অ্যাড সেটের মধ্যে তুলনামূলক পারফরম্যান্স পরীক্ষা করুন। সর্বনিম্ন খরচে সর্বোচ্চ সেলস আনা উইনার অ্যাডকে স্বয়ংক্রিয়ভাবে শনাক্ত ও স্কেল করুন।
            </p>
          </div>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => setShowCreateModal(true)}
              className="flex items-center gap-2 rounded-lg bg-indigo-600 px-4 py-2.5 text-xs font-semibold text-white shadow hover:bg-indigo-700 transition"
            >
              <span>➕</span>
              <span>নতুন A/B টেস্ট তৈরি করুন</span>
            </button>
            <button
              type="button"
              onClick={loadAbTests}
              className="rounded-lg border border-slate-300 bg-white px-3 py-2.5 text-xs font-medium text-slate-700 hover:bg-slate-50 transition"
              title="রিফ্রেশ করুন"
            >
              🔄
            </button>
          </div>
        </div>
      </div>

      {/* Alerts */}
      {error && (
        <div className="flex items-center justify-between rounded-xl border border-red-200 bg-red-50 p-4 text-xs text-red-700">
          <div className="flex items-center gap-2">
            <span>⚠️</span>
            <span>{error}</span>
          </div>
          <button type="button" onClick={() => setError("")} className="font-semibold text-red-500 hover:text-red-700">
            ✕
          </button>
        </div>
      )}

      {notice && (
        <div className="flex items-center justify-between rounded-xl border border-emerald-200 bg-emerald-50 p-4 text-xs text-emerald-800">
          <div className="flex items-center gap-2">
            <span>✓</span>
            <span>{notice}</span>
          </div>
          <button type="button" onClick={() => setNotice("")} className="font-semibold text-emerald-600 hover:text-emerald-800">
            ✕
          </button>
        </div>
      )}

      {/* Create Modal */}
      {showCreateModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4 backdrop-blur-sm">
          <div className="w-full max-w-md rounded-2xl bg-white p-6 shadow-2xl space-y-4">
            <div className="flex items-center justify-between pb-2 border-b border-slate-100">
              <h3 className="font-bold text-slate-900">নতুন A/B টেস্ট ভ্যারিয়েন্ট তৈরি</h3>
              <button
                type="button"
                onClick={() => setShowCreateModal(false)}
                className="text-slate-400 hover:text-slate-600"
              >
                ✕
              </button>
            </div>

            <form onSubmit={handleCreateVariant} className="space-y-4 text-xs">
              <div>
                <label className="block font-semibold text-slate-700 mb-1">
                  মূল ক্যাম্পেইন নির্বাচন করুন (Variant A):
                </label>
                <select
                  value={sourcePlanId}
                  onChange={(e) => setSourcePlanId(e.target.value)}
                  className="w-full rounded-lg border border-slate-300 p-2.5 text-xs focus:border-indigo-500 focus:outline-none"
                  required
                >
                  {plans.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.name} ({p.status})
                    </option>
                  ))}
                </select>
                <p className="mt-1 text-[11px] text-slate-500">
                  নির্বাচিত ক্যাম্পেইনটি থেকে হুবহু আরেকটি সংস্করণ (ভ্যারিয়েন্ট B) তৈরি হবে।
                </p>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block font-semibold text-slate-700 mb-1">
                    ভ্যারিয়েন্ট লেবেল:
                  </label>
                  <input
                    type="text"
                    value={variantLabel}
                    onChange={(e) => setVariantLabel(e.target.value)}
                    placeholder="B"
                    className="w-full rounded-lg border border-slate-300 p-2 text-xs focus:border-indigo-500 focus:outline-none uppercase"
                    maxLength={5}
                    required
                  />
                </div>
                <div>
                  <label className="block font-semibold text-slate-700 mb-1">
                    উইনার নির্ধারণের মেট্রিক:
                  </label>
                  <select
                    value={metricChoice}
                    onChange={(e) => setMetricChoice(e.target.value as any)}
                    className="w-full rounded-lg border border-slate-300 p-2 text-xs focus:border-indigo-500 focus:outline-none"
                  >
                    <option value="first_party_cpa">আসল অর্ডার CPA (সেরা)</option>
                    <option value="platform_cpa">মেটা প্ল্যাটফর্ম CPA</option>
                  </select>
                </div>
              </div>

              <div className="rounded-lg bg-amber-50 p-3 text-[11px] text-amber-800">
                💡 <strong>টিপস:</strong> ভ্যারিয়েন্ট B তৈরি হলে Campaign Builder-এ গিয়ে আপনি ভিন্ন কোনো ছবি বা অফার হেডলাইন দিয়ে টেস্ট করতে পারেন।
              </div>

              <div className="flex items-center justify-end gap-2 pt-2 border-t border-slate-100">
                <button
                  type="button"
                  onClick={() => setShowCreateModal(false)}
                  className="rounded-lg border border-slate-300 px-4 py-2 text-xs text-slate-700 hover:bg-slate-50"
                >
                  বাতিল
                </button>
                <button
                  type="submit"
                  disabled={busy === "create-variant"}
                  className="rounded-lg bg-indigo-600 px-4 py-2 text-xs font-semibold text-white hover:bg-indigo-700 disabled:opacity-50"
                >
                  {busy === "create-variant" ? "তৈরি হচ্ছে..." : "ভ্যারিয়েন্ট তৈরি করুন"}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Main Groups List */}
      {loading ? (
        <div className="card p-12 text-center text-sm text-slate-500">
          <div className="inline-block h-6 w-6 animate-spin rounded-full border-2 border-indigo-600 border-t-transparent mb-2" />
          <p>A/B টেস্টের পারফরম্যান্স বিশ্লেষণ করা হচ্ছে...</p>
        </div>
      ) : groups.length === 0 ? (
        <div className="card p-10 text-center space-y-3">
          <div className="text-4xl">⚖️</div>
          <h3 className="font-bold text-slate-800">কোনো সক্রিয় A/B টেস্ট নেই</h3>
          <p className="max-w-md mx-auto text-xs text-slate-500">
            বিজ্ঞাপনের কার্যকারিতা যাচাই করতে আপনার যেকোনো ক্যাম্পেইনকে একটি A/B টেস্টে রূপান্তর করুন। দুটি ভিন্ন ব্যানার বা টেক্সটের পারফরম্যান্স অটোমেটিক ট্র্যাক হবে।
          </p>
          <button
            type="button"
            onClick={() => setShowCreateModal(true)}
            className="rounded-lg bg-indigo-600 px-4 py-2 text-xs font-semibold text-white shadow hover:bg-indigo-700 transition"
          >
            প্রথম A/B টেস্ট শুরু করুন
          </button>
        </div>
      ) : (
        <div className="space-y-6">
          {groups.map((grp) => {
            const hasWinner = Boolean(grp.winnerPlanId);
            return (
              <div
                key={grp.groupId}
                className="card overflow-hidden border border-slate-200 shadow-sm transition hover:shadow-md"
              >
                {/* Group Header */}
                <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-100 bg-slate-50/80 px-5 py-3">
                  <div className="flex items-center gap-2.5">
                    <span className="flex h-7 w-7 items-center justify-center rounded-md bg-indigo-100 text-xs font-bold text-indigo-700">
                      AB
                    </span>
                    <div>
                      <h4 className="text-sm font-bold text-slate-800">
                        গ্রুপ: {grp.groupId.slice(0, 16)}...
                      </h4>
                      <p className="text-[11px] text-slate-500">
                        মূল্যায়ন মেট্রিক:{" "}
                        <span className="font-semibold text-slate-700">
                          {grp.metric === "first_party_cpa"
                            ? "ফার্স্ট-পার্টি অর্ডার CPA (আসল সেলস)"
                            : "মেটা প্ল্যাটফর্ম CPA"}
                        </span>
                      </p>
                    </div>
                  </div>

                  <div className="flex items-center gap-2">
                    {(() => {
                      const vInfo = getVerdictLabel(grp.verdict);
                      return (
                        <span className={`flex items-center gap-1 rounded-full px-3 py-1 text-xs font-bold ${vInfo.badgeCls}`}>
                          {hasWinner ? "🏆 " : "⏳ "}
                          {vInfo.label}
                        </span>
                      );
                    })()}
                  </div>
                </div>

                {/* Variants Side-by-Side Comparison */}
                <div className="grid grid-cols-1 divide-y md:grid-cols-2 md:divide-x md:divide-y-0">
                  {grp.variants.map((v) => {
                    const isWinner = v.planId === grp.winnerPlanId;
                    return (
                      <div
                        key={v.planId}
                        className={`relative p-5 space-y-4 ${
                          isWinner ? "bg-amber-50/30 ring-1 ring-amber-300 ring-inset" : "bg-white"
                        }`}
                      >
                        {/* Winner Ribbon */}
                        {isWinner && (
                          <div className="absolute top-3 right-3 flex items-center gap-1 rounded-full bg-amber-500 px-2.5 py-0.5 text-[11px] font-bold text-white shadow-sm">
                            <span>🏆</span>
                            <span>উইনার (বিজয়ী)</span>
                          </div>
                        )}

                        <div className="space-y-1">
                          <div className="flex items-center gap-2">
                            <span className="rounded bg-indigo-600 px-2 py-0.5 text-xs font-bold text-white">
                              Variant {v.variant}
                            </span>
                            <span className="text-xs text-slate-400 capitalize">
                              স্ট্যাটাস: {v.status}
                            </span>
                          </div>
                          <h5 className="font-semibold text-slate-900 text-sm">
                            <Link
                              href={`/dashboard/campaign-builder?id=${v.planId}`}
                              className="hover:text-indigo-600 hover:underline"
                            >
                              {v.name}
                            </Link>
                          </h5>
                        </div>

                        {/* Metrics Grid */}
                        <div className="grid grid-cols-2 gap-2 text-xs">
                          <div className="rounded-lg bg-slate-50 p-2.5 border border-slate-100">
                            <div className="text-[10px] text-slate-400 uppercase font-semibold">
                              মোট বিজ্ঞাপন খরচ
                            </div>
                            <div className="text-sm font-bold text-slate-800">
                              {formatMoney(v.spendMinor)}
                            </div>
                          </div>

                          <div className="rounded-lg bg-slate-50 p-2.5 border border-slate-100">
                            <div className="text-[10px] text-slate-400 uppercase font-semibold">
                              আসল অর্ডার (First-party)
                            </div>
                            <div className="text-sm font-bold text-emerald-600">
                              {v.firstPartyOrders} টি
                            </div>
                            <div className="text-[10px] text-slate-500">
                              রেভিনিউ: {formatMoney(v.firstPartyRevenueMinor)}
                            </div>
                          </div>

                          <div className="rounded-lg bg-slate-50 p-2.5 border border-slate-100">
                            <div className="text-[10px] text-slate-400 uppercase font-semibold">
                              ফার্স্ট-পার্টি CPA (প্রতি অর্ডারে খরচ)
                            </div>
                            <div className="text-sm font-bold text-indigo-600">
                              {formatMoney(v.firstPartyCpaMinor)}
                            </div>
                          </div>

                          <div className="rounded-lg bg-slate-50 p-2.5 border border-slate-100">
                            <div className="text-[10px] text-slate-400 uppercase font-semibold">
                              মেটা কনভার্সন
                            </div>
                            <div className="text-sm font-bold text-slate-700">
                              {v.platformConversions} টি
                            </div>
                            <div className="text-[10px] text-slate-500">
                              প্ল্যাটফর্ম CPA: {formatMoney(v.platformCpaMinor)}
                            </div>
                          </div>
                        </div>

                        {/* Actions */}
                        <div className="pt-2 flex items-center justify-between">
                          <Link
                            href={`/dashboard/campaign-builder?id=${v.planId}`}
                            className="text-xs font-medium text-indigo-600 hover:underline"
                          >
                            Campaign Builder-এ দেখুন →
                          </Link>

                          {isWinner && (
                            <button
                              type="button"
                              onClick={() => handlePromoteWinner(v.planId)}
                              disabled={busy === `promote-${v.planId}`}
                              className="rounded-lg bg-emerald-600 px-3 py-1.5 text-xs font-semibold text-white shadow-sm hover:bg-emerald-700 disabled:opacity-50"
                            >
                              {busy === `promote-${v.planId}` ? "প্রমোট হচ্ছে..." : "🚀 উইনার হিসেবে প্রমোট করুন"}
                            </button>
                          )}
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* Educational Fatigue & Optimization Guide */}
      <div className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm text-xs text-slate-600 space-y-3">
        <h4 className="font-semibold text-slate-800 text-sm flex items-center gap-2">
          <span>🧠</span>
          <span>মার্কেটারদের জন্য ক্রিয়েটিভ ফ্যাটিগ ও অপটিমাইজেশন নিয়মাবলী:</span>
        </h4>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div className="rounded-lg bg-slate-50 p-3 border border-slate-200/60 space-y-1">
            <div className="font-semibold text-slate-800">১. ক্রিয়েটিভ ফ্যাটিগ (দর্শক ক্লান্তি) নিয়ম:</div>
            <p>
              যখন বিজ্ঞাপনের ফ্রিকোয়েন্সি (Frequency) ≥ ৩.৫ ছাড়িয়ে যায় এবং CTR পূর্বের তুলনায় ৩০%+ ড্রপ করে, তখন বুঝতে হবে একই দর্শক বিজ্ঞাপনটি বারবার দেখে ক্লান্ত।
            </p>
          </div>
          <div className="rounded-lg bg-slate-50 p-3 border border-slate-200/60 space-y-1">
            <div className="font-semibold text-slate-800">২. উইনার প্রমোট করলে কী হয়?</div>
            <p>
              "উইনার প্রমোট" বাটনে ক্লিক করলে সিস্টেম স্বয়ংক্রিয়ভাবে বিজয়ী ভ্যারিয়েন্টটির একটি পরিচ্ছন্ন প্রোডাকশন ক্যাম্পেইন তৈরি করে, যা আপনি সহজেই স্কেল করতে পারেন।
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}
