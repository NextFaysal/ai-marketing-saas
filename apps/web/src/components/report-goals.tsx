"use client";
import React, { useCallback, useEffect, useState } from "react";
import { apiFetch } from "@/lib/api";
import { getOrganizationId } from "@/lib/org";
import { formatMinor } from "@repo/contracts";

/** Reports Advanced RP5 — monthly goals card. Money
 *  targets are entered in major units (৳) and stored
 *  as minor; orders are a plain count. Progress is
 *  shown next to the month's elapsed pace. */
interface GoalRow { metric: string; goalId: string | null; target: string | null; actual: string; progressPct: number | null }
interface GoalsData { month: string; pacePct: number; elapsedDays: number; daysInMonth: number; goals: GoalRow[] }
const LABELS: Record<string, string> = { revenue: "Revenue লক্ষ্য", orders: "Orders লক্ষ্য", spend: "Ad Spend লক্ষ্য" };

export function ReportGoals() {
  const now = new Date();
  const [month, setMonth] = useState(`${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`);
  const [data, setData] = useState<GoalsData | null>(null);
  const [draft, setDraft] = useState<Record<string, string>>({});
  const [error, setError] = useState("");

  const load = useCallback(async () => {
    const orgId = getOrganizationId(); if (!orgId) return;
    try { setData(await apiFetch<GoalsData>(`/organizations/${orgId}/reports/goals?month=${month}`)); }
    catch (e) { setError(e instanceof Error ? e.message : "Failed"); }
  }, [month]);
  useEffect(() => { load(); }, [load]);

  async function save(metric: string) {
    const orgId = getOrganizationId(); if (!orgId) return;
    const raw = (draft[metric] ?? "").trim();
    if (!raw) return;
    const target = metric === "orders" ? String(Math.round(Number(raw))) : String(Math.round(Number(raw) * 100));
    try {
      await apiFetch(`/organizations/${orgId}/reports/goals`, { method: "POST", body: JSON.stringify({ month, metric, target }) });
      setDraft((d) => ({ ...d, [metric]: "" }));
      await load();
    } catch (e) { setError(e instanceof Error ? e.message : "Save failed"); }
  }
  const show = (metric: string, v: string) => (metric === "orders" ? Number(v).toLocaleString() : formatMinor(BigInt(v)));

  if (!data) return null;
  return (
    <div className="card p-5">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="font-semibold">মাসিক লক্ষ্য (Goals)</div>
        <label className="text-sm text-slate-500">মাস
          <input type="month" className="input ml-2" value={month} onChange={(e) => setMonth(e.target.value)} />
        </label>
      </div>
      <p className="mt-1 text-xs text-slate-500">মাসের {data.elapsedDays}/{data.daysInMonth} দিন গেছে — অর্থাৎ সময় অনুযায়ী Pace {data.pacePct}%। Progress Pace-এর বেশি হলে এগিয়ে আছেন।</p>
      {error ? <p className="mt-2 rounded-lg bg-red-50 p-2 text-sm text-red-700">{error}</p> : null}
      <div className="mt-3 space-y-4">
        {data.goals.map((g) => (
          <div key={g.metric}>
            <div className="flex flex-wrap items-center justify-between gap-2 text-sm">
              <span className="font-medium">{LABELS[g.metric]}</span>
              {g.target !== null ? (
                <span className="text-slate-500">অর্জন {show(g.metric, g.actual)} / লক্ষ্য {show(g.metric, g.target)} — <strong className="text-slate-700">{g.progressPct ?? 0}%</strong></span>
              ) : <span className="text-slate-400">লক্ষ্য বসানো হয়নি (অর্জন {show(g.metric, g.actual)})</span>}
            </div>
            {g.target !== null ? (
              <div className="relative mt-1 h-2.5 overflow-hidden rounded bg-slate-100">
                <div className="h-full bg-blue-500" style={{ width: `${Math.min(100, g.progressPct ?? 0)}%` }} />
                <div className="absolute top-0 h-full w-0.5 bg-slate-700" style={{ left: `${Math.min(100, data.pacePct)}%` }} title={`Pace ${data.pacePct}%`} />
              </div>
            ) : null}
            <div className="mt-1.5 flex items-center gap-2">
              <input className="input" style={{ maxWidth: 200 }} placeholder={g.metric === "orders" ? "লক্ষ্য (সংখ্যা)" : "লক্ষ্য (৳)"} inputMode="numeric"
                value={draft[g.metric] ?? ""} onChange={(e) => setDraft((d) => ({ ...d, [g.metric]: e.target.value }))} />
              <button className="btn-primary btn-sm" onClick={() => save(g.metric)}>{g.target !== null ? "বদলান" : "বসান"}</button>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
