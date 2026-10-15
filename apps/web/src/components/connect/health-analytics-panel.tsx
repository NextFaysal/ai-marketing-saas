"use client";
import React, { useCallback, useEffect, useState } from "react";
import { apiFetch } from "@/lib/api";
import { getOrganizationId } from "@/lib/org";
import { formatWhen } from "@/lib/connections";

/**
 * CC22 — connection health analytics panel.
 *
 * Fed ONLY by GET connections/health-analytics, which computes
 * everything from the recorded Connection Doctor runs. An
 * account with no recorded checks shows "তথ্য নেই" — never a
 * fabricated 0% or 100%. The endpoint is OWNER/ADMIN; for
 * other roles the panel quietly stays hidden (the fetch fails
 * and nothing renders) rather than showing invented numbers.
 */

interface AccountStats {
  targetType: string;
  targetId: string;
  provider: string | null;
  displayName: string | null;
  checks: number;
  passed: number;
  failed: number;
  degraded: number;
  uptimePct: number | null;
  lastFailureAt: string | null;
  lastFailureKind: string | null;
  daily: { date: string; total: number; passRatePct: number | null }[];
}

interface AnalyticsView {
  generatedAt: string;
  windowDays: number;
  accounts: AccountStats[];
  worst: AccountStats[];
}

function uptimeCls(pct: number | null): string {
  if (pct === null) return "bg-slate-100 text-slate-500";
  if (pct >= 95) return "bg-green-100 text-green-700";
  if (pct >= 80) return "bg-amber-100 text-amber-700";
  return "bg-red-100 text-red-700";
}

function Sparkline({ daily }: { daily: AccountStats["daily"] }) {
  // 14 daily buckets as small bars; a day with no checks is an
  // outline (no data), never a 0-height "failure" bar.
  return (
    <span className="inline-flex items-end gap-[2px]" title={daily.map((d) => `${d.date}: ${d.total === 0 ? "কোনো পরীক্ষা হয়নি" : `পাসের হার ${d.passRatePct}%`}`).join("\n")}>
      {daily.map((d) => (
        <span
          key={d.date}
          className={`inline-block w-[5px] rounded-sm ${d.total === 0 ? "border border-slate-300 bg-transparent" : d.passRatePct !== null && d.passRatePct >= 95 ? "bg-green-400" : d.passRatePct !== null && d.passRatePct >= 50 ? "bg-amber-400" : "bg-red-400"}`}
          style={{ height: `${d.total === 0 ? 4 : 4 + Math.round(((d.passRatePct ?? 0) / 100) * 10)}px` }}
        />
      ))}
    </span>
  );
}

export function HealthAnalyticsPanel() {
  const [data, setData] = useState<AnalyticsView | null>(null);
  const [loaded, setLoaded] = useState(false);

  const load = useCallback(async () => {
    const orgId = getOrganizationId();
    if (!orgId) return;
    try {
      const res = await apiFetch<AnalyticsView>(`organizations/${orgId}/connections/health-analytics`);
      setData(res);
    } catch { /* OWNER/ADMIN-only surface — stays hidden otherwise */ }
    setLoaded(true);
  }, []);

  useEffect(() => { void load(); }, [load]);

  if (!loaded || !data) return null;
  const withChecks = data.accounts.filter((a) => a.checks > 0);

  return (
    <div className="card space-y-3 p-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="font-semibold text-slate-800">📈 কানেকশন Health বিশ্লেষণ <span className="text-xs font-normal text-slate-400">(শেষ {data.windowDays} দিনের আসল Doctor পরীক্ষা থেকে)</span></div>
        <button type="button" onClick={() => void load()} className="rounded-lg bg-slate-100 px-2.5 py-1 text-xs font-semibold text-slate-600 hover:bg-slate-200">রিফ্রেশ</button>
      </div>
      {data.worst.length ? (
        <div className="rounded-xl bg-red-50 px-3 py-2 text-xs text-red-700">
          <span className="font-semibold">সবচেয়ে কম নির্ভরযোগ্য:</span>{" "}
          {data.worst.map((w) => `${w.displayName ?? w.targetId} (${w.uptimePct}%)`).join(" · ")}
        </div>
      ) : null}
      {withChecks.length === 0 ? (
        <p className="text-xs leading-relaxed text-slate-500">
          এখনো কোনো Connection Doctor পরীক্ষার রেকর্ড নেই — তাই কোনো uptime সংখ্যা দেখানো হচ্ছে না।
          উপরে কোনো অ্যাকাউন্টে Doctor চালালে বা স্বয়ংক্রিয় sweep চালু থাকলে এখানে আসল হিসাব জমবে।
        </p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full min-w-[560px] text-left text-xs">
            <thead>
              <tr className="text-slate-400">
                <th className="py-1 pr-2 font-semibold">অ্যাকাউন্ট</th>
                <th className="py-1 pr-2 font-semibold">Uptime (৩০ দিন)</th>
                <th className="py-1 pr-2 font-semibold">পরীক্ষা · পাস · ব্যর্থ · আংশিক</th>
                <th className="py-1 pr-2 font-semibold">শেষ ১৪ দিন</th>
                <th className="py-1 font-semibold">সর্বশেষ ব্যর্থতা</th>
              </tr>
            </thead>
            <tbody>
              {data.accounts.map((a) => (
                <tr key={`${a.targetType}:${a.targetId}`} className="border-t border-slate-100 align-top">
                  <td className="py-1.5 pr-2 font-medium text-slate-700">{a.displayName ?? a.targetId}<span className="block text-[11px] font-normal text-slate-400">{a.provider ?? ""}</span></td>
                  <td className="py-1.5 pr-2">
                    {a.uptimePct === null
                      ? <span className="rounded-full bg-slate-100 px-2 py-0.5 font-semibold text-slate-500">তথ্য নেই</span>
                      : <span className={`rounded-full px-2 py-0.5 font-semibold ${uptimeCls(a.uptimePct)}`}>{a.uptimePct}%</span>}
                  </td>
                  <td className="py-1.5 pr-2 text-slate-600">{a.checks} · {a.passed} · {a.failed} · {a.degraded}</td>
                  <td className="py-1.5 pr-2"><Sparkline daily={a.daily} /></td>
                  <td className="py-1.5 text-slate-600">
                    {a.lastFailureAt ? <>{formatWhen(a.lastFailureAt)}{a.lastFailureKind ? <span className="block text-[11px] text-slate-400">ধাপ: {a.lastFailureKind}</span> : null}</> : <span className="text-slate-400">—</span>}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <p className="text-[11px] leading-relaxed text-slate-400">
        Uptime = পাস ÷ মোট পরীক্ষা; "আংশিক" (partial) পরীক্ষা uptime-এ সফল ধরা হয় না, আলাদা কলামে দেখানো হয়।
        কোনো পরীক্ষা না থাকলে সংখ্যার বদলে "তথ্য নেই" দেখায় — অনুমান করা হয় না।
      </p>
    </div>
  );
}
