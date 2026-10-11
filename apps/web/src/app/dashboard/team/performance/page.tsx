"use client";
import React, { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { API_URL, apiFetch, getToken } from "@/lib/api";
import { getOrganizationId } from "@/lib/org";

// Milestone 70 (Team W2): performance scorecard page. Every
// number comes from the API's scorecard payload — the formula
// is printed on the page and each indicator shows its four
// components, so nothing is a black box.
interface AgentRow {
  userId: string; name: string; role: string; rank: number | null; indicator: number;
  components: { volume: number; speed: number | null; resolution: number | null; csat: number | null };
  missingComponents: string[]; insufficientData: boolean; activityState: string | null;
  current: { assigned: number; closed: number; replies: number; avgFirstResponseMinutes: number | null; avgResolutionMinutes: number | null; csatAvg: number | null; csatResponses: number };
  previous: { assigned: number; closed: number; replies: number };
  deltas: { assigned: number; closed: number; replies: number; avgFirstResponseMinutes: number | null; avgResolutionMinutes: number | null; csatAvg: number | null };
  flags: { code: string; label: string; detail: string }[];
}
interface Scorecard { days: number; formula: string; agents: AgentRow[] }

function Delta({ v, invert = false, suffix = "" }: { v: number | null; invert?: boolean; suffix?: string }) {
  if (v === null || v === 0) return <span className="text-xs text-slate-400">আগের মতোই</span>;
  const good = invert ? v < 0 : v > 0;
  return (
    <span className={`text-xs font-medium ${good ? "text-emerald-600" : "text-red-500"}`}>
      {v > 0 ? "▲" : "▼"} {Math.abs(v)}{suffix} আগের সময়ের চেয়ে
    </span>
  );
}
function mins(v: number | null): string { return v === null ? "—" : `${v} মিনিট`; }
function pts(v: number | null): string { return v === null ? "তথ্য নেই" : `${v}`; }

interface ScorecardX extends Scorecard {
  scopedTeamId?: string | null; scopedTeamName?: string | null;
  // Milestone 74: assignment fairness vs the equal share.
  fairness?: { totalAssigned: number; equalSharePercent: number; spreadPercent: number; perAgent: { userId: string; assigned: number; sharePercent: number; deviationPercent: number }[] };
}

export default function TeamPerformancePage() {
  const [days, setDays] = useState(7);
  const [card, setCard] = useState<ScorecardX | null>(null);
  const [error, setError] = useState("");
  // Milestone 71: optional team slice (lead/manager enforced server-side).
  const [teams, setTeams] = useState<{ id: string; name: string }[]>([]);
  const [teamId, setTeamId] = useState("");

  const load = useCallback(async (d: number, tid: string) => {
    const orgId = getOrganizationId();
    if (!orgId) { setError("কোনো Organization নির্বাচিত নেই।"); return; }
    try {
      setCard(await apiFetch<ScorecardX>(`/organizations/${orgId}/inbox/team-scorecard?days=${d}${tid ? `&teamId=${tid}` : ""}`));
      setError("");
    } catch (e) { setError(e instanceof Error ? e.message : "লোড করা যায়নি"); }
  }, []);
  useEffect(() => { load(days, teamId); }, [load, days, teamId]);
  useEffect(() => {
    const orgId = getOrganizationId(); if (!orgId) return;
    apiFetch<{ id: string; name: string }[]>(`/organizations/${orgId}/inbox/teams`).then(setTeams).catch(() => undefined);
  }, []);

  async function downloadCsv() {
    const orgId = getOrganizationId(); if (!orgId) return;
    const res = await fetch(`${API_URL}/organizations/${orgId}/inbox/team-scorecard.csv?days=${days}${teamId ? `&teamId=${teamId}` : ""}`, {
      headers: { Authorization: `Bearer ${getToken() ?? ""}` },
    });
    if (!res.ok) return;
    const blob = await res.blob();
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = `team-scorecard-${days}d.csv`;
    a.click();
    URL.revokeObjectURL(a.href);
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-3">
        <h1 className="page-title">পারফরম্যান্স স্কোরকার্ড</h1>
        <Link href="/dashboard/team" className="btn-secondary">← টিম সেটিংস</Link>
        <div className="ml-auto flex flex-wrap items-center gap-1">
          <select className="input w-48" value={teamId} onChange={(e) => setTeamId(e.target.value)}>
            <option value="">সব টিম</option>
            {teams.map((t) => <option key={t.id} value={t.id}>{t.name} টিম</option>)}
          </select>
          {[7, 14, 30].map((d) => (
            <button key={d} onClick={() => setDays(d)} className={d === days ? "btn-primary btn-sm" : "btn-secondary btn-sm"}>শেষ {d} দিন</button>
          ))}
          <button className="btn-secondary btn-sm" onClick={downloadCsv}>CSV ডাউনলোড</button>
        </div>
      </div>
      {error ? <div className="rounded-lg bg-red-50 p-3 text-sm text-red-700">{error}</div> : null}
      {card ? (
        <div className="card p-4 text-sm text-slate-600">
          <strong>হিসাব যেভাবে হয়:</strong> {card.formula} প্রতিটা Flag এর পাশে তার প্রমাণ দেওয়া আছে। আগের সমান দৈর্ঘ্যের সময়ের সাথে তুলনা দেখানো হয়েছে — উন্নতি না অবনতি, নিজেই দেখা যাবে।
          {card.scopedTeamName ? <div className="mt-1 font-medium text-indigo-700">এখন শুধু "{card.scopedTeamName}" টিমের হিসাব দেখানো হচ্ছে — মধ্যম মান ও Ranking এই টিমের ভেতরেই।</div> : null}
        </div>
      ) : null}

      {card?.fairness && card.fairness.totalAssigned > 0 ? (
        <div className="card p-4">
          <div className="mb-2 text-sm font-semibold">⚖️ কাজের ভাগ — ন্যায্যতা <span className="ml-1 font-normal text-slate-400">সমান ভাগ হতো {card.fairness.equalSharePercent}% করে · সর্বোচ্চ–সর্বনিম্ন ব্যবধান {card.fairness.spreadPercent}%</span></div>
          <div className="flex flex-wrap gap-1.5">
            {card.fairness.perAgent.map((f) => {
              const agent = card.agents.find((a) => a.userId === f.userId);
              const heavy = f.deviationPercent > 10; const light = f.deviationPercent < -10;
              return (
                <span key={f.userId} className={`rounded px-2 py-1 text-xs ${heavy ? "bg-red-100 text-red-700" : light ? "bg-sky-100 text-sky-700" : "bg-slate-100 text-slate-600"}`}>
                  {agent?.name ?? f.userId}: ভাগ {f.sharePercent}% ({f.deviationPercent > 0 ? "+" : ""}{f.deviationPercent}%)
                </span>
              );
            })}
          </div>
          <p className="mt-2 text-xs text-slate-400">কারো ভাগ সমান ভাগের চেয়ে অনেক বেশি মানে কাজের চাপ তার দিকেই ঝুঁকেছে — Team পেজ থেকে "কাজের ভারসাম্য করুন" দিয়ে খোলা কথোপকথন সরানো যায়।</p>
        </div>
      ) : null}
      {!card && !error ? <p className="text-sm text-slate-400">লোড হচ্ছে…</p> : null}
      {card ? (
        <div className="card overflow-x-auto p-5">
          <table className="w-full min-w-[880px] text-sm">
            <thead><tr className="text-left text-slate-500">
              <th className="py-2">র‍্যাংক</th><th>সদস্য</th><th>সূচক (১০০)</th><th>বন্ধ</th><th>Reply</th><th>প্রথম জবাব</th><th>সমাধান</th><th>CSAT</th><th>পর্যবেক্ষণ</th>
            </tr></thead>
            <tbody>
              {card.agents.map((a) => (
                <tr key={a.userId} className="border-t align-top">
                  <td className="py-2 font-bold">{a.rank ?? "—"}</td>
                  <td>
                    {a.name} <span className="text-xs text-slate-400">({a.role})</span>
                    {a.activityState === "idle" ? <span className="ml-1 rounded bg-amber-100 px-1 text-xs text-amber-700">এখন নিষ্ক্রিয়</span> : null}
                    {a.insufficientData ? <div className="text-xs text-slate-400">এই সময়ে পর্যাপ্ত তথ্য নেই — নতুন সদস্য হতে পারে</div> : null}
                  </td>
                  <td>
                    <span className="text-lg font-bold">{a.indicator}</span>
                    <div className="text-xs text-slate-400">বন্ধ {pts(a.components.volume)}/৩০ · গতি {pts(a.components.speed)}/২৫ · সমাধান {pts(a.components.resolution)}/২০ · CSAT {pts(a.components.csat)}/২৫</div>
                  </td>
                  <td>{a.current.closed}টি<div><Delta v={a.deltas.closed} /></div></td>
                  <td>{a.current.replies}টি<div><Delta v={a.deltas.replies} /></div></td>
                  <td>{mins(a.current.avgFirstResponseMinutes)}<div><Delta v={a.deltas.avgFirstResponseMinutes} invert suffix=" মিনিট" /></div></td>
                  <td>{mins(a.current.avgResolutionMinutes)}<div><Delta v={a.deltas.avgResolutionMinutes} invert suffix=" মিনিট" /></div></td>
                  <td>{a.current.csatAvg === null ? "—" : `${a.current.csatAvg}/৫`}<div className="text-xs text-slate-400">{a.current.csatResponses}টি রেটিং</div></td>
                  <td>
                    {a.flags.length ? a.flags.map((f) => (
                      <div key={f.code} className="mb-1">
                        <span className={`rounded px-1.5 py-0.5 text-xs ${f.code === "customers_happy" ? "bg-emerald-100 text-emerald-700" : "bg-amber-100 text-amber-700"}`}>{f.label}</span>
                        <div className="text-xs text-slate-400">{f.detail}</div>
                      </div>
                    )) : <span className="text-xs text-slate-400">কিছু নেই</span>}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : null}
    </div>
  );
}
