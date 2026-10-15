"use client";
import React, { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { API_URL, apiFetch, getToken } from "@/lib/api";
import { getOrganizationId } from "@/lib/org";

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
  if (v === null || v === 0) return <span className="text-xs text-slate-400">আগের মতোই</span>;
  const good = invert ? v < 0 : v > 0;
  return (
    <span className={`text-xs font-medium ${good ? "text-emerald-600" : "text-red-500"}`}>
      {v > 0 ? "▲" : "▼"} {Math.abs(v)}{suffix} আগের সময়ের চেয়ে
    </span>
  );
}

function mins(v: number | null): string {
  return v === null ? "—" : `${v} মিনিট`;
}
function pts(v: number | null): string {
  return v === null ? "তথ্য নেই" : `${v}`;
}

export default function TeamPerformancePage() {
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
      setError(err?.message || "সেলস স্কোরবোর্ড লোড ব্যর্থ।");
    } finally {
      setSalesLoading(false);
    }
  }, []);

  const loadSupportCard = useCallback(async (d: number, tid: string) => {
    const orgId = getOrganizationId();
    if (!orgId) {
      setError("কোনো Organization নির্বাচিত নেই।");
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
      setError(e instanceof Error ? e.message : "লোড করা যায়নি");
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
              ← টিম সেটিংস
            </Link>
            <span className="text-slate-300">/</span>
            <span className="text-xs font-semibold text-slate-500">পারফরম্যান্স ও অ্যাট্রিবিউশন</span>
          </div>
          <h1 className="text-2xl font-bold tracking-tight text-slate-900 mt-1">
            টিম পারফরম্যান্স ও সেলস অ্যাট্রিবিউশন স্কোরবোর্ড
          </h1>
          <p className="text-xs text-slate-500">
            কল সেন্টার ও ইনবক্স এজেন্টদের কনফার্ম করা অর্ডার, ডেলিভারি সাকসেস রেট এবং কমিশন হিসাব।
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          {[7, 14, 30, 90].map((d) => (
            <button
              key={d}
              onClick={() => setDays(d)}
              className={d === days ? "btn-primary btn-sm text-xs font-bold" : "btn-secondary btn-sm text-xs"}
            >
              শেষ {d} দিন
            </button>
          ))}
          {activeTab === "support" && (
            <button className="btn-secondary btn-sm text-xs" onClick={downloadSupportCsv}>
              CSV ডাউনলোড
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
            <span>🛍️ সেলস ও ডেলিভারি অ্যাট্রিবিউশন</span>
            <span className="rounded-full bg-emerald-100 text-emerald-800 px-2 py-0.5 text-[10px] font-bold">
              সক্রিয়
            </span>
          </button>

          <button
            onClick={() => setActiveTab("support")}
            className={`pb-3 font-semibold transition-colors border-b-2 ${
              activeTab === "support"
                ? "border-brand-600 text-brand-700"
                : "border-transparent text-slate-500 hover:text-slate-700"
            }`}
          >
            💬 ইনবক্স সাপোর্ট ও রেসপন্স স্কোরকার্ড
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
              <p className="text-xs font-medium text-slate-500">ডেলিভার্ড সেলস রেভিনিউ</p>
              <p className="mt-1 text-2xl font-bold text-slate-900">
                ৳{totalDeliveredRevenue.toLocaleString("bn-BD")}
              </p>
              <p className="text-[11px] text-emerald-600 font-semibold">{totalDeliveredCount}টি অর্ডার সফল ডেলিভারি</p>
            </div>

            <div className="card p-4">
              <p className="text-xs font-medium text-slate-500">সামগ্রিক ডেলিভারি হার</p>
              <p className="mt-1 text-2xl font-bold text-indigo-700">
                {overallDeliveryRate}%
              </p>
              <p className="text-[11px] text-slate-400">রিটার্ন হয়েছে {totalReturnedCount}টি অর্ডার</p>
            </div>

            <div className="card p-4 border-emerald-100 bg-emerald-50/20">
              <p className="text-xs font-medium text-emerald-800">মোট এজেন্ট কমিশন তহবিল</p>
              <p className="mt-1 text-2xl font-bold text-emerald-900">
                ৳{totalCommissionPool.toLocaleString("bn-BD")}
              </p>
              <p className="text-[11px] text-emerald-700">প্রতি সফল ডেলিভারিতে ৳{commissionRate}</p>
            </div>

            <div className="card p-4">
              <label className="block text-xs font-medium text-slate-500">কমিশন রেট পরিবর্তন করুন</label>
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
                  আপডেট
                </button>
              </div>
              <p className="text-[11px] text-slate-400 mt-1">প্রতি ডেলিভার্ড পার্সেলের ইনসেনটিভ</p>
            </div>
          </div>

          {/* Leaderboard Table */}
          {salesLoading ? (
            <div className="card p-12 text-center text-xs text-slate-400">স্কোরবোর্ড লোড হচ্ছে...</div>
          ) : !salesData || salesData.leaderboard.length === 0 ? (
            <div className="card p-12 text-center">
              <span className="text-4xl">👥</span>
              <p className="mt-2 text-sm font-semibold text-slate-700">কোনো সেলস রেকর্ড পাওয়া যায়নি</p>
              <p className="text-xs text-slate-400">এই সময়সীমায় কোনো অর্ডারে সেলস এজেন্ট ট্যাগ করা হয়নি।</p>
            </div>
          ) : (
            <div className="overflow-hidden card">
              <div className="border-b bg-slate-50 px-5 py-3 font-semibold text-xs text-slate-700 flex items-center justify-between">
                <span>স্টাফ সেলস লিডারবোর্ড (সর্বোচ্চ রেভিনিউ ক্রমানুসারে)</span>
                <span className="text-slate-400 font-normal">শেষ {days} দিনের ডেলিভারি পারফরম্যান্স</span>
              </div>
              <div className="overflow-x-auto">
                <table className="w-full text-left text-xs min-w-[780px]">
                  <thead className="bg-slate-50 border-b border-slate-200 text-slate-500 font-semibold">
                    <tr>
                      <th className="py-3 px-4">র‍্যাংক</th>
                      <th className="py-3 px-4">এজেন্ট / স্টাফ</th>
                      <th className="py-3 px-4 text-center">মোট হ্যান্ডেল</th>
                      <th className="py-3 px-4 text-center">ডেলিভার্ড</th>
                      <th className="py-3 px-4 text-center">রিটার্ন</th>
                      <th className="py-3 px-4">ডেলিভারি সাকসেস হার</th>
                      <th className="py-3 px-4 text-right">অর্জিত রেভিনিউ</th>
                      <th className="py-3 px-4 text-right">অর্জিত কমিশন</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {salesData.leaderboard.map((agent, index) => {
                      const isUnassigned = agent.agentId === "unassigned";
                      let rankBadge = `${index + 1}`;
                      if (index === 0 && !isUnassigned) rankBadge = "🥇 1";
                      else if (index === 1 && !isUnassigned) rankBadge = "🥈 2";
                      else if (index === 2 && !isUnassigned) rankBadge = "🥉 3";

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
                            {agent.totalOrders}টি
                          </td>
                          <td className="py-3 px-4 text-center font-bold text-emerald-700">
                            {agent.deliveredOrders}টি
                          </td>
                          <td className="py-3 px-4 text-center font-bold text-rose-600">
                            {agent.returnedOrders}টি
                          </td>
                          <td className="py-3 px-4">
                            <div className="flex items-center gap-2">
                              <span className="font-bold text-xs text-slate-700 w-12">
                                {agent.deliveryRatePercent}%
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
                            ৳{agent.deliveredRevenueBdt.toLocaleString("bn-BD")}
                          </td>
                          <td className="py-3 px-4 text-right font-bold text-emerald-700">
                            ৳{agent.totalCommissionBdt.toLocaleString("bn-BD")}
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
              <option value="">সব টিম</option>
              {teams.map((t) => (
                <option key={t.id} value={t.id}>
                  {t.name} টিম
                </option>
              ))}
            </select>
          </div>

          {card ? (
            <div className="card p-4 text-xs text-slate-600 leading-relaxed">
              <strong>হিসাব যেভাবে হয়:</strong> {card.formula} প্রতিটা Flag এর পাশে তার প্রমাণ দেওয়া আছে। আগের সমান দৈর্ঘ্যের সময়ের সাথে তুলনা দেখানো হয়েছে।
              {card.scopedTeamName ? (
                <div className="mt-1 font-medium text-indigo-700">
                  এখন শুধু "{card.scopedTeamName}" টিমের হিসাব দেখানো হচ্ছে।
                </div>
              ) : null}
            </div>
          ) : null}

          {card?.fairness && card.fairness.totalAssigned > 0 ? (
            <div className="card p-4">
              <div className="mb-2 text-xs font-semibold">
                ⚖️ কাজের ভাগ — ন্যায্যতা{" "}
                <span className="ml-1 font-normal text-slate-400">
                  সমান ভাগ হতো {card.fairness.equalSharePercent}% করে · সর্বোচ্চ–সর্বনিম্ন ব্যবধান {card.fairness.spreadPercent}%
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
                      {agent?.name ?? f.userId}: ভাগ {f.sharePercent}% ({f.deviationPercent > 0 ? "+" : ""}
                      {f.deviationPercent}%)
                    </span>
                  );
                })}
              </div>
            </div>
          ) : null}

          {!card && !error ? <p className="text-sm text-slate-400">লোড হচ্ছে…</p> : null}

          {card ? (
            <div className="card overflow-x-auto p-5">
              <table className="w-full min-w-[880px] text-xs">
                <thead>
                  <tr className="text-left text-slate-500 font-semibold border-b">
                    <th className="py-2">র‍্যাংক</th>
                    <th>সদস্য</th>
                    <th>সূচক (১০০)</th>
                    <th>বন্ধ</th>
                    <th>Reply</th>
                    <th>প্রথম জবাব</th>
                    <th>সমাধান</th>
                    <th>CSAT</th>
                    <th>পর্যবেক্ষণ</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {card.agents.map((a) => (
                    <tr key={a.userId} className="hover:bg-slate-50 align-top">
                      <td className="py-3 font-bold">{a.rank ?? "—"}</td>
                      <td className="py-3">
                        <span className="font-semibold text-slate-900">{a.name}</span>
                        <span className="text-[10px] text-slate-400 ml-1">({a.role})</span>
                        {a.activityState === "idle" ? (
                          <span className="ml-1 rounded bg-amber-100 px-1 text-[10px] text-amber-700">এখন নিষ্ক্রিয়</span>
                        ) : null}
                      </td>
                      <td className="py-3">
                        <span className="text-base font-bold text-slate-900">{a.indicator}</span>
                        <div className="text-[10px] text-slate-400">
                          বন্ধ {pts(a.components.volume)}/৩০ · গতি {pts(a.components.speed)}/২৫ · সমাধান {pts(a.components.resolution)}/২০ · CSAT {pts(a.components.csat)}/২৫
                        </div>
                      </td>
                      <td className="py-3">{a.current.closed}টি<div><Delta v={a.deltas.closed} /></div></td>
                      <td className="py-3">{a.current.replies}টি<div><Delta v={a.deltas.replies} /></div></td>
                      <td className="py-3">{mins(a.current.avgFirstResponseMinutes)}<div><Delta v={a.deltas.avgFirstResponseMinutes} invert suffix=" মিনিট" /></div></td>
                      <td className="py-3">{mins(a.current.avgResolutionMinutes)}<div><Delta v={a.deltas.avgResolutionMinutes} invert suffix=" মিনিট" /></div></td>
                      <td className="py-3">{a.current.csatAvg === null ? "—" : `${a.current.csatAvg}/৫`}</td>
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
                          <span className="text-[10px] text-slate-400">কিছু নেই</span>
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
