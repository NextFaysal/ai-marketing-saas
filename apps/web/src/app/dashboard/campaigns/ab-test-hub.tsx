"use client";
import React, { useEffect, useState } from "react";
import Link from "next/link";
import { apiFetch } from "@/lib/api";
import { getOrganizationId } from "@/lib/org";
import { fmtMoneyMinor, fmtNumber } from "@repo/contracts";
import { getVerdictLabel } from "@/lib/ab-test-winner";
import { useLocale } from "@/lib/i18n/provider";

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
  const { t, locale } = useLocale();
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
      setError(e instanceof Error ? e.message : t("ads.abLoadError"));
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
      setNotice(t("ads.abPromoted", { name: res?.name || planId }));
      await loadAbTests();
      if (onRefreshPlans) onRefreshPlans();
    } catch (e) {
      setError(e instanceof Error ? e.message : t("ads.abPromoteError"));
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
      setNotice(t("ads.abVariantCreated", { label: variantLabel }));
      setShowCreateModal(false);
      await loadAbTests();
      if (onRefreshPlans) onRefreshPlans();
    } catch (e) {
      setError(e instanceof Error ? e.message : t("ads.abVariantError"));
    } finally {
      setBusy(null);
    }
  };

  const formatMoney = (minor: string | null | undefined) => {
    if (!minor || minor === "0") return fmtMoneyMinor(locale, 0n);
    try {
      return fmtMoneyMinor(locale, BigInt(minor));
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
                {t("ads.abTitle")}
              </h2>
            </div>
            <p className="text-xs text-slate-600">
              {t("ads.abIntro")}
            </p>
          </div>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => setShowCreateModal(true)}
              className="flex items-center gap-2 rounded-lg bg-indigo-600 px-4 py-2.5 text-xs font-semibold text-white shadow hover:bg-indigo-700 transition"
            >
              <span>➕</span>
              <span>{t("ads.abCreateNew")}</span>
            </button>
            <button
              type="button"
              onClick={loadAbTests}
              className="rounded-lg border border-slate-300 bg-white px-3 py-2.5 text-xs font-medium text-slate-700 hover:bg-slate-50 transition"
              title={t("ads.abRefresh")}
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
              <h3 className="font-bold text-slate-900">{t("ads.abModalTitle")}</h3>
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
                  {t("ads.abSourceLabel")}
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
                  {t("ads.abSourceHint")}
                </p>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block font-semibold text-slate-700 mb-1">
                    {t("ads.abVariantLabel")}
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
                    {t("ads.abMetricLabel")}
                  </label>
                  <select
                    value={metricChoice}
                    onChange={(e) => setMetricChoice(e.target.value as any)}
                    className="w-full rounded-lg border border-slate-300 p-2 text-xs focus:border-indigo-500 focus:outline-none"
                  >
                    <option value="first_party_cpa">{t("ads.abMetricFirstParty")}</option>
                    <option value="platform_cpa">{t("ads.abMetricPlatform")}</option>
                  </select>
                </div>
              </div>

              <div className="rounded-lg bg-amber-50 p-3 text-[11px] text-amber-800">
                💡 <strong>{t("ads.abTipsLabel")}</strong> {t("ads.abTip")}
              </div>

              <div className="flex items-center justify-end gap-2 pt-2 border-t border-slate-100">
                <button
                  type="button"
                  onClick={() => setShowCreateModal(false)}
                  className="rounded-lg border border-slate-300 px-4 py-2 text-xs text-slate-700 hover:bg-slate-50"
                >
                  {t("ads.abCancel")}
                </button>
                <button
                  type="submit"
                  disabled={busy === "create-variant"}
                  className="rounded-lg bg-indigo-600 px-4 py-2 text-xs font-semibold text-white hover:bg-indigo-700 disabled:opacity-50"
                >
                  {busy === "create-variant" ? t("ads.abCreating") : t("ads.abCreateVariant")}
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
          <p>{t("ads.abAnalyzing")}</p>
        </div>
      ) : groups.length === 0 ? (
        <div className="card p-10 text-center space-y-3">
          <div className="text-4xl">⚖️</div>
          <h3 className="font-bold text-slate-800">{t("ads.abEmptyTitle")}</h3>
          <p className="max-w-md mx-auto text-xs text-slate-500">
            {t("ads.abEmptyDesc")}
          </p>
          <button
            type="button"
            onClick={() => setShowCreateModal(true)}
            className="rounded-lg bg-indigo-600 px-4 py-2 text-xs font-semibold text-white shadow hover:bg-indigo-700 transition"
          >
            {t("ads.abStartFirst")}
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
                        {t("ads.abGroup", { id: grp.groupId.slice(0, 16) })}
                      </h4>
                      <p className="text-[11px] text-slate-500">
                        {t("ads.abEvalMetric")}{" "}
                        <span className="font-semibold text-slate-700">
                          {grp.metric === "first_party_cpa"
                            ? t("ads.abMetricFirstPartyLong")
                            : t("ads.abMetricPlatformLong")}
                        </span>
                      </p>
                    </div>
                  </div>

                  <div className="flex items-center gap-2">
                    {(() => {
                      const vInfo = getVerdictLabel(grp.verdict, locale);
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
                            <span>{t("ads.abWinner")}</span>
                          </div>
                        )}

                        <div className="space-y-1">
                          <div className="flex items-center gap-2">
                            <span className="rounded bg-indigo-600 px-2 py-0.5 text-xs font-bold text-white">
                              Variant {v.variant}
                            </span>
                            <span className="text-xs text-slate-400 capitalize">
                              {t("ads.abStatus", { status: v.status })}
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
                              {t("ads.abSpend")}
                            </div>
                            <div className="text-sm font-bold text-slate-800">
                              {formatMoney(v.spendMinor)}
                            </div>
                          </div>

                          <div className="rounded-lg bg-slate-50 p-2.5 border border-slate-100">
                            <div className="text-[10px] text-slate-400 uppercase font-semibold">
                              {t("ads.abFirstPartyOrders")}
                            </div>
                            <div className="text-sm font-bold text-emerald-600">
                              {t("ads.abCountSuffix", { count: fmtNumber(locale, v.firstPartyOrders) })}
                            </div>
                            <div className="text-[10px] text-slate-500">
                              {t("ads.abRevenue", { amount: formatMoney(v.firstPartyRevenueMinor) })}
                            </div>
                          </div>

                          <div className="rounded-lg bg-slate-50 p-2.5 border border-slate-100">
                            <div className="text-[10px] text-slate-400 uppercase font-semibold">
                              {t("ads.abFirstPartyCpa")}
                            </div>
                            <div className="text-sm font-bold text-indigo-600">
                              {formatMoney(v.firstPartyCpaMinor)}
                            </div>
                          </div>

                          <div className="rounded-lg bg-slate-50 p-2.5 border border-slate-100">
                            <div className="text-[10px] text-slate-400 uppercase font-semibold">
                              {t("ads.abMetaConversions")}
                            </div>
                            <div className="text-sm font-bold text-slate-700">
                              {t("ads.abCountSuffix", { count: fmtNumber(locale, v.platformConversions) })}
                            </div>
                            <div className="text-[10px] text-slate-500">
                              {t("ads.abPlatformCpa", { amount: formatMoney(v.platformCpaMinor) })}
                            </div>
                          </div>
                        </div>

                        {/* Actions */}
                        <div className="pt-2 flex items-center justify-between">
                          <Link
                            href={`/dashboard/campaign-builder?id=${v.planId}`}
                            className="text-xs font-medium text-indigo-600 hover:underline"
                          >
                            {t("ads.abViewInBuilder")}
                          </Link>

                          {isWinner && (
                            <button
                              type="button"
                              onClick={() => handlePromoteWinner(v.planId)}
                              disabled={busy === `promote-${v.planId}`}
                              className="rounded-lg bg-emerald-600 px-3 py-1.5 text-xs font-semibold text-white shadow-sm hover:bg-emerald-700 disabled:opacity-50"
                            >
                              {busy === `promote-${v.planId}` ? t("ads.abPromoting") : t("ads.abPromote")}
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
          <span>{t("ads.abGuideTitle")}</span>
        </h4>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div className="rounded-lg bg-slate-50 p-3 border border-slate-200/60 space-y-1">
            <div className="font-semibold text-slate-800">{t("ads.abGuide1Title")}</div>
            <p>
              {t("ads.abGuide1Body")}
            </p>
          </div>
          <div className="rounded-lg bg-slate-50 p-3 border border-slate-200/60 space-y-1">
            <div className="font-semibold text-slate-800">{t("ads.abGuide2Title")}</div>
            <p>
              {t("ads.abGuide2Body")}
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}
