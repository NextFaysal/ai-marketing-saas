"use client";
import React, { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { API_URL, apiFetch, getToken } from "@/lib/api";
import { getOrganizationId } from "@/lib/org";
import { useLocale } from "@/lib/i18n/provider";
import type { UiLocale } from "@/lib/i18n/dict";
import { fmtMoney, fmtNumber } from "@repo/contracts";
import type { teamBn } from "@/lib/i18n/team";

// Feature 5: Staff Sales Attribution Row
interface StaffSalesRow {
  agentId: string;
  name: string;
  email: string;
  role: string;
  totalOrders: number;
  confirmedOrders: number;
  deliveredOrders: number;
  returnedOrders: number;
  inFlightOrders: number;
  deliveredRevenueMinor: string;
  deliveredRevenueBdt: number;
  deliveryRatePercent: number;
  returnRatePercent: number;
  totalCommissionMinor: string;
  totalCommissionBdt: number;
}

interface StaffScoreboardData {
  totalAgents: number;
  defaultCommissionPerDeliveryBdt: number;
  leaderboard: StaffSalesRow[];
}

// Milestone 70 (Team W2): Support Scorecard
interface AgentRow {
  userId: string;
  name: string;
  role: string;
  rank: number | null;
  indicator: number;
  components: { volume: number; speed: number | null; resolution: number | null; csat: number | null };
  missingComponents: string[];
  insufficientData: boolean;
  activityState: string | null;
  current: {
    assigned: number;
    closed: number;
    replies: number;
    avgFirstResponseMinutes: number | null;
    avgResolutionMinutes: number | null;
    csatAvg: number | null;
    csatResponses: number;
  };
  previous: { assigned: number; closed: number; replies: number };
  deltas: {
    assigned: number;
    closed: number;
    replies: number;
    avgFirstResponseMinutes: number | null;
    avgResolutionMinutes: number | null;
    csatAvg: number | null;
  };
  flags: { code: string; label: string; detail: string }[];
}

interface Scorecard {
  days: number;
  formula: string;
  agents: AgentRow[];
  scopedTeamId?: string | null;
  scopedTeamName?: string | null;
  fairness?: {
    totalAssigned: number;
    equalSharePercent: number;
    spreadPercent: number;
    perAgent: { userId: string; assigned: number; sharePercent: number; deviationPercent: number }[];
  };
}

function Delta({ v, invert = false, suffix = "" }: { v: number | null; invert?: boolean; suffix?: string }) {
  const { dict, t, locale } = useLocale();
  const D = dict.team;
  if (v === null || v === 0) return <span className="text-xs text-slate-400">{D.pfDeltaSame}</span>;
  const good = invert ? v < 0 : v > 0;
  return (
    <span className={`text-xs font-medium ${good ? "text-emerald-600" : "text-red-500"}`}>
      {t("team.pfDeltaVs", { arrow: v > 0 ? "▲" : "▼", value: fmtNumber(locale, Math.abs(v)), suffix })}
    </span>
  );
}

type TeamDict = typeof teamBn;
function mins(v: number | null, locale: UiLocale, D: TeamDict, tr: (path: string, params?: Record<string, string | number>) => string): string {
  return v === null ? "—" : tr("team.pfMins", { v: fmtNumber(locale, v) });
}
function pts(v: number | null, locale: UiLocale, D: TeamDict): string {
  return v === null ? D.pfNoInfo : fmtNumber(locale, v);
}

export default function TeamPerformancePage() {
  const { dict, t, locale } = useLocale();
  const D = dict.team;
  const [activeTab, setActiveTab] = useState<"sales" | "support">("sales");
  const [days, setDays] = useState(30);
  const [commissionRate, setCommissionRate] = useState(50);

  // Sales Scoreboard state
  const [salesData, setSalesData] = useState<StaffScoreboardData | null>(null);
  const [salesLoading, setSalesLoading] = useState(true);

  // Support Scorecard state
  const [card, setCard] = useState<Scorecard | null>(null);
  const [teams, setTeams] = useState<{ id: string; name: string }[]>([]);
  const [teamId, setTeamId] = useState("");
  const [error, setError] = useState("");

  const loadSalesScoreboard = useCallback(async (d: number, comm: number) => {
    const orgId = getOrganizationId();
    if (!orgId) return;
    setSalesLoading(true);
    try {
      const fromDate = new Date();
      fromDate.setDate(fromDate.getDate() - d);
      const res = await apiFetch<StaffScoreboardData>(
        `/organizations/${orgId}/orders/scoreboard?from=${fromDate.toISOString()}&commission=${comm}`
      );
      setSalesData(res);
      setError("");
    } catch (err: any) {
      setError(err?.message || D.pfSalesLoadFailed);
    } finally {
      setSalesLoading(false);
    }
  }, []);

  const loadSupportCard = useCallback(async (d: number, tid: string) => {
    const orgId = getOrganizationId();
    if (!orgId) {
      setError(D.tmNoOrg);
      return;
    }
    try {
      setCard(
        await apiFetch<Scorecard>(
          `/organizations/${orgId}/inbox/team-scorecard?days=${d}${tid ? `&teamId=${tid}` : ""}`
        )
      );
      setError("");
    } catch (e: any) {
      setError(e instanceof Error ? e.message : D.tmLoadFailed);
    }
  }, []);

  useEffect(() => {
    if (activeTab === "sales") {
      void loadSalesScoreboard(days, commissionRate);
    } else {
      void loadSupportCard(days, teamId);
    }
  }, [activeTab, days, teamId, commissionRate, loadSalesScoreboard, loadSupportCard]);

  useEffect(() => {
    const orgId = getOrganizationId();
    if (!orgId) return;
    apiFetch<{ id: string; name: string }[]>(`/organizations/${orgId}/inbox/teams`)
      .then(setTeams)
      .catch(() => undefined);
  }, []);

  async function downloadSupportCsv() {
    const orgId = getOrganizationId();
    if (!orgId) return;
    const res = await fetch(
      `${API_URL}/organizations/${orgId}/inbox/team-scorecard.csv?days=${days}${teamId ? `&teamId=${teamId}` : ""}`,
      {
        headers: { Authorization: `Bearer ${getToken() ?? ""}` },
      }
    );
    if (!res.ok) return;
    const blob = await res.blob();
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = `team-scorecard-${days}d.csv`;
    a.click();
    URL.revokeObjectURL(a.href);
  }

  // Sales totals
  const totalDeliveredRevenue =
    salesData?.leaderboard.reduce((sum, s) => sum + s.deliveredRevenueBdt, 0) || 0;
  const totalDeliveredCount =
    salesData?.leaderboard.reduce((sum, s) => sum + s.deliveredOrders, 0) || 0;
  const totalReturnedCount =
    salesData?.leaderboard.reduce((sum, s) => sum + s.returnedOrders, 0) || 0;
  const totalCommissionPool =
    salesData?.leaderboard.reduce((sum, s) => sum + s.totalCommissionBdt, 0) || 0;
  const finishedOrders = totalDeliveredCount + totalReturnedCount;
  const overallDeliveryRate =
    finishedOrders > 0 ? ((totalDeliveredCount / finishedOrders) * 100).toFixed(1) : "0.0";

  return (
    <div className="space-y-6">
      {/* Page Header */}
      <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <div className="flex items-center gap-2">
            <Link href="/dashboard/team" className="text-xs text-brand-600 hover:underline">
              {D.pfBackToTeam}
            </Link>
            <span className="text-slate-300">/</span>
            <span className="text-xs font-semibold text-slate-500">{D.pfCrumb}</span>
          </div>
          <h1 className="text-2xl font-bold tracking-tight text-slate-900 mt-1">{D.pfTitle}</h1>
          <p className="text-xs text-slate-500">{D.pfSubtitle}</p>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          {[7, 14, 30, 90].map((d) => (
            <button
              key={d}
              onClick={() => setDays(d)}
              className={d === days ? "btn-primary btn-sm text-xs font-bold" : "btn-secondary btn-sm text-xs"}
            >
              {t("team.pfLastDays", { days: fmtNumber(locale, d) })}
            </button>
          ))}
          {activeTab === "support" && (
            <button className="btn-secondary btn-sm text-xs" onClick={downloadSupportCsv}>
              {D.pfCsvDownload}
            </button>
          )}
        </div>
      </div>

      {error ? <div className="rounded-xl bg-red-50 p-4 text-xs text-red-700 border border-red-200">{error}</div> : null}

      {/* Tabs */}
      <div className="border-b border-slate-200">
        <nav className="flex space-x-6 text-sm">
          <button
            onClick={() => setActiveTab("sales")}
            className={`pb-3 font-semibold transition-colors border-b-2 flex items-center gap-2 ${
              activeTab === "sales"
                ? "border-brand-600 text-brand-700"
                : "border-transparent text-slate-500 hover:text-slate-700"
            }`}
          >
            <span>{D.pfTabSales}</span>
            <span className="rounded-full bg-emerald-100 text-emerald-800 px-2 py-0.5 text-[10px] font-bold">{D.pfActiveChip}</span>
          </button>

          <button
            onClick={() => setActiveTab("support")}
            className={`pb-3 font-semibold transition-colors border-b-2 ${
              activeTab === "support"
                ? "border-brand-600 text-brand-700"
                : "border-transparent text-slate-500 hover:text-slate-700"
            }`}
          >
            {D.pfTabSupport}
          </button>
        </nav>
      </div>

      {/* ============================================================== */}
      {/* TAB 1: SALES & DELIVERY ATTRIBUTION SCOREBOARD                  */}
      {/* ============================================================== */}
      {activeTab === "sales" && (
        <div className="space-y-6">
          {/* KPI Summary Cards */}
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            <div className="card p-4">
              <p className="text-xs font-medium text-slate-500">{D.pfKpiRevenue}</p>
              <p className="mt-1 text-2xl font-bold text-slate-900">
                {fmtMoney(locale, totalDeliveredRevenue)}
              </p>
              <p className="text-[11px] text-emerald-600 font-semibold">{t("team.pfOrdersDelivered", { count: fmtNumber(locale, totalDeliveredCount) })}</p>
            </div>

            <div className="card p-4">
              <p className="text-xs font-medium text-slate-500">{D.pfKpiDeliveryRate}</p>
              <p className="mt-1 text-2xl font-bold text-indigo-700">
                {fmtNumber(locale, Number(overallDeliveryRate), { minimumFractionDigits: 1, maximumFractionDigits: 1 })}%
              </p>
              <p className="text-[11px] text-slate-400">{t("team.pfKpiReturned", { count: fmtNumber(locale, totalReturnedCount) })}</p>
            </div>

            <div className="card p-4 border-emerald-100 bg-emerald-50/20">
              <p className="text-xs font-medium text-emerald-800">{D.pfKpiCommissionPool}</p>
              <p className="mt-1 text-2xl font-bold text-emerald-900">
                {fmtMoney(locale, totalCommissionPool)}
              </p>
              <p className="text-[11px] text-emerald-700">{t("team.pfKpiPerDelivery", { amount: fmtMoney(locale, commissionRate) })}</p>
            </div>

            <div className="card p-4">
              <label className="block text-xs font-medium text-slate-500">{D.pfCommissionLabel}</label>
              <div className="mt-1 flex items-center gap-1.5">
                <span className="text-sm font-bold text-slate-700">৳</span>
                <input
                  type="number"
                  min="0"
                  max="1000"
                  className="input !py-1 text-xs w-24 font-bold"
                  value={commissionRate}
                  onChange={(e) => setCommissionRate(Number(e.target.value) || 0)}
                />
                <button
                  onClick={() => void loadSalesScoreboard(days, commissionRate)}
                  className="btn-primary btn-sm text-xs font-semibold !py-1"
                >
                  {D.pfUpdateBtn}
                </button>
              </div>
              <p className="text-[11px] text-slate-400 mt-1">{D.pfCommissionNote}</p>
            </div>
          </div>

          {/* Leaderboard Table */}
          {salesLoading ? (
            <div className="card p-12 text-center text-xs text-slate-400">{D.pfBoardLoading}</div>
          ) : !salesData || salesData.leaderboard.length === 0 ? (
            <div className="card p-12 text-center">
              <span className="text-4xl">👥</span>
              <p className="mt-2 text-sm font-semibold text-slate-700">{D.pfNoSalesTitle}</p>
              <p className="text-xs text-slate-400">{D.pfNoSalesDesc}</p>
            </div>
          ) : (
            <div className="overflow-hidden card">
              <div className="border-b bg-slate-50 px-5 py-3 font-semibold text-xs text-slate-700 flex items-center justify-between">
                <span>{D.pfLeaderboardTitle}</span>
                <span className="text-slate-400 font-normal">{t("team.pfLeaderboardSub", { days: fmtNumber(locale, days) })}</span>
              </div>
              <div className="overflow-x-auto">
                <table className="w-full text-left text-xs min-w-[780px]">
                  <thead className="bg-slate-50 border-b border-slate-200 text-slate-500 font-semibold">
                    <tr>
                      <th className="py-3 px-4">{D.pfColRank}</th>
                      <th className="py-3 px-4">{D.pfColAgent}</th>
                      <th className="py-3 px-4 text-center">{D.pfColHandled}</th>
                      <th className="py-3 px-4 text-center">{D.pfColDelivered}</th>
                      <th className="py-3 px-4 text-center">{D.pfColReturn}</th>
                      <th className="py-3 px-4">{D.pfColSuccessRate}</th>
                      <th className="py-3 px-4 text-right">{D.pfColRevenue}</th>
                      <th className="py-3 px-4 text-right">{D.pfColCommission}</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {salesData.leaderboard.map((agent, index) => {
                      const isUnassigned = agent.agentId === "unassigned";
                      let rankBadge = fmtNumber(locale, index + 1);
                      if (index === 0 && !isUnassigned) rankBadge = `🥇 ${fmtNumber(locale, 1)}`;
                      else if (index === 1 && !isUnassigned) rankBadge = `🥈 ${fmtNumber(locale, 2)}`;
                      else if (index === 2 && !isUnassigned) rankBadge = `🥉 ${fmtNumber(locale, 3)}`;

                      return (
                        <tr
                          key={agent.agentId}
                          className={`hover:bg-slate-50 transition-colors ${
                            isUnassigned ? "bg-amber-50/30" : ""
                          }`}
                        >
                          <td className="py-3 px-4 font-bold text-slate-800">
                            {isUnassigned ? "—" : rankBadge}
                          </td>
                          <td className="py-3 px-4">
                            <span className={`font-bold ${isUnassigned ? "text-amber-800" : "text-slate-900"}`}>
                              {agent.name}
                            </span>
                            <div className="text-[10px] text-slate-400 font-mono">
                              {agent.email} · {agent.role}
                            </div>
                          </td>
                          <td className="py-3 px-4 text-center font-medium">
                            {t("team.tmCountSuffix", { count: fmtNumber(locale, agent.totalOrders) })}
                          </td>
                          <td className="py-3 px-4 text-center font-bold text-emerald-700">
                            {t("team.tmCountSuffix", { count: fmtNumber(locale, agent.deliveredOrders) })}
                          </td>
                          <td className="py-3 px-4 text-center font-bold text-rose-600">
                            {t("team.tmCountSuffix", { count: fmtNumber(locale, agent.returnedOrders) })}
                          </td>
                          <td className="py-3 px-4">
                            <div className="flex items-center gap-2">
                              <span className="font-bold text-xs text-slate-700 w-12">
                                {fmtNumber(locale, agent.deliveryRatePercent)}%
                              </span>
                              <div className="w-24 bg-slate-200 rounded-full h-2 overflow-hidden">
                                <div
                                  className={`h-full rounded-full ${
                                    agent.deliveryRatePercent >= 75
                                      ? "bg-emerald-500"
                                      : agent.deliveryRatePercent >= 50
                                      ? "bg-amber-500"
                                      : "bg-rose-500"
                                  }`}
                                  style={{ width: `${Math.min(agent.deliveryRatePercent, 100)}%` }}
                                />
                              </div>
                            </div>
                          </td>
                          <td className="py-3 px-4 text-right font-bold text-slate-900">
                            {fmtMoney(locale, agent.deliveredRevenueBdt)}
                          </td>
                          <td className="py-3 px-4 text-right font-bold text-emerald-700">
                            {fmtMoney(locale, agent.totalCommissionBdt)}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </div>
      )}

      {/* ============================================================== */}
      {/* TAB 2: SUPPORT & INBOX RESPONSE SCORECARD                       */}
      {/* ============================================================== */}
      {activeTab === "support" && (
        <div className="space-y-4">
          <div className="flex flex-wrap items-center gap-2">
            <select
              className="input w-48 text-xs"
              value={teamId}
              onChange={(e) => setTeamId(e.target.value)}
            >
              <option value="">{D.pfAllTeams}</option>
              {teams.map((tm) => (
                <option key={tm.id} value={tm.id}>
                  {t("team.pfTeamSuffix", { name: tm.name })}
                </option>
              ))}
            </select>
          </div>

          {card ? (
            <div className="card p-4 text-xs text-slate-600 leading-relaxed">
              <strong>{D.pfFormulaLead}</strong> {card.formula}{D.pfFormulaTrail}
              {card.scopedTeamName ? (
                <div className="mt-1 font-medium text-indigo-700">{t("team.pfScopedTeam", { name: card.scopedTeamName })}</div>
              ) : null}
            </div>
          ) : null}

          {card?.fairness && card.fairness.totalAssigned > 0 ? (
            <div className="card p-4">
              <div className="mb-2 text-xs font-semibold">
                {D.pfFairnessTitle}{" "}
                <span className="ml-1 font-normal text-slate-400">
                  {t("team.pfFairnessNote", { equal: fmtNumber(locale, card.fairness.equalSharePercent), spread: fmtNumber(locale, card.fairness.spreadPercent) })}
                </span>
              </div>
              <div className="flex flex-wrap gap-1.5">
                {card.fairness.perAgent.map((f) => {
                  const agent = card.agents.find((a) => a.userId === f.userId);
                  const heavy = f.deviationPercent > 10;
                  const light = f.deviationPercent < -10;
                  return (
                    <span
                      key={f.userId}
                      className={`rounded px-2 py-1 text-xs ${
                        heavy ? "bg-red-100 text-red-700" : light ? "bg-sky-100 text-sky-700" : "bg-slate-100 text-slate-600"
                      }`}
                    >
                      {t("team.pfShareText", { name: agent?.name ?? f.userId, share: fmtNumber(locale, f.sharePercent), dev: `${f.deviationPercent > 0 ? "+" : ""}${fmtNumber(locale, f.deviationPercent)}` })}
                    </span>
                  );
                })}
              </div>
            </div>
          ) : null}

          {!card && !error ? <p className="text-sm text-slate-400">{dict.common.loading}</p> : null}

          {card ? (
            <div className="card overflow-x-auto p-5">
              <table className="w-full min-w-[880px] text-xs">
                <thead>
                  <tr className="text-left text-slate-500 font-semibold border-b">
                    <th className="py-2">{D.pfColRank}</th>
                    <th>{dict.common.member}</th>
                    <th>{t("team.pfColIndicator", { max: fmtNumber(locale, 100) })}</th>
                    <th>{D.pfColClosed}</th>
                    <th>{D.pfColReply}</th>
                    <th>{D.pfColFirstResponse}</th>
                    <th>{D.pfColResolution}</th>
                    <th>{D.pfColCsat}</th>
                    <th>{D.pfColFlags}</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {card.agents.map((a) => (
                    <tr key={a.userId} className="hover:bg-slate-50 align-top">
                      <td className="py-3 font-bold">{a.rank === null || a.rank === undefined ? "—" : fmtNumber(locale, a.rank)}</td>
                      <td className="py-3">
                        <span className="font-semibold text-slate-900">{a.name}</span>
                        <span className="text-[10px] text-slate-400 ml-1">({a.role})</span>
                        {a.activityState === "idle" ? (
                          <span className="ml-1 rounded bg-amber-100 px-1 text-[10px] text-amber-700">{D.pfIdleNow}</span>
                        ) : null}
                      </td>
                      <td className="py-3">
                        <span className="text-base font-bold text-slate-900">{fmtNumber(locale, a.indicator)}</span>
                        <div className="text-[10px] text-slate-400">
                          {t("team.pfComponents", { volume: pts(a.components.volume, locale, D), vmax: fmtNumber(locale, 30), speed: pts(a.components.speed, locale, D), smax: fmtNumber(locale, 25), resolution: pts(a.components.resolution, locale, D), rmax: fmtNumber(locale, 20), csat: pts(a.components.csat, locale, D), cmax: fmtNumber(locale, 25) })}
                        </div>
                      </td>
                      <td className="py-3">{t("team.tmCountSuffix", { count: fmtNumber(locale, a.current.closed) })}<div><Delta v={a.deltas.closed} /></div></td>
                      <td className="py-3">{t("team.tmCountSuffix", { count: fmtNumber(locale, a.current.replies) })}<div><Delta v={a.deltas.replies} /></div></td>
                      <td className="py-3">{mins(a.current.avgFirstResponseMinutes, locale, D, t)}<div><Delta v={a.deltas.avgFirstResponseMinutes} invert suffix={D.pfMinuteSuffix} /></div></td>
                      <td className="py-3">{mins(a.current.avgResolutionMinutes, locale, D, t)}<div><Delta v={a.deltas.avgResolutionMinutes} invert suffix={D.pfMinuteSuffix} /></div></td>
                      <td className="py-3">{a.current.csatAvg === null ? "—" : t("team.pfCsatCell", { avg: fmtNumber(locale, a.current.csatAvg), max: fmtNumber(locale, 5) })}</td>
                      <td className="py-3">
                        {a.flags.length ? (
                          a.flags.map((f) => (
                            <div key={f.code} className="mb-1">
                              <span
                                className={`rounded px-1.5 py-0.5 text-[10px] font-bold ${
                                  f.code === "customers_happy" ? "bg-emerald-100 text-emerald-700" : "bg-amber-100 text-amber-700"
                                }`}
                              >
                                {f.label}
                              </span>
                              <div className="text-[10px] text-slate-400">{f.detail}</div>
                            </div>
                          ))
                        ) : (
                          <span className="text-[10px] text-slate-400">{D.pfNothing}</span>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : null}
        </div>
      )}
    </div>
  );
}
