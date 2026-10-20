"use client";
import React, { useCallback, useEffect, useState } from "react";
import { apiFetch } from "@/lib/api";
import { getOrganizationId } from "@/lib/org";
import { fmtMoneyMinor, fmtNumber } from "@repo/contracts";
import { useLocale } from "@/lib/i18n/provider";

/** Reports Advanced RP5 — monthly goals card. Money
 *  targets are entered in major units (৳) and stored
 *  as minor; orders are a plain count. Progress is
 *  shown next to the month's elapsed pace. */
interface GoalRow { metric: string; goalId: string | null; target: string | null; actual: string; progressPct: number | null }
interface GoalsData { month: string; pacePct: number; elapsedDays: number; daysInMonth: number; goals: GoalRow[] }

export function ReportGoals() {
  const { dict, t, locale } = useLocale();
  const S = dict.shared;
  const LABELS: Record<string, string> = { revenue: S.zzRglLabelRevenue, orders: S.zzRglLabelOrders, spend: S.zzRglLabelSpend };
  const now = new Date();
  const [month, setMonth] = useState(`${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`);
  const [data, setData] = useState<GoalsData | null>(null);
  const [draft, setDraft] = useState<Record<string, string>>({});
  const [error, setError] = useState("");

  const load = useCallback(async () => {
    const orgId = getOrganizationId(); if (!orgId) return;
    try { setData(await apiFetch<GoalsData>(`/organizations/${orgId}/reports/goals?month=${month}`)); }
    catch (e) { setError(e instanceof Error ? e.message : S.zzRglFailed); }
  }, [month, S]);
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
    } catch (e) { setError(e instanceof Error ? e.message : S.zzRglSaveFailed); }
  }
  const show = (metric: string, v: string) => (metric === "orders" ? fmtNumber(locale, Number(v)) : fmtMoneyMinor(locale, BigInt(v)));

  if (!data) return null;
  return (
    <div className="card p-5">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="font-semibold">{S.zzRglTitle}</div>
        <label className="text-sm text-slate-500">{S.zzRglMonth}
          <input type="month" className="input ml-2" value={month} onChange={(e) => setMonth(e.target.value)} />
        </label>
      </div>
      <p className="mt-1 text-xs text-slate-500">{t("shared.zzRglPaceIntro", { elapsed: fmtNumber(locale, data.elapsedDays), total: fmtNumber(locale, data.daysInMonth), pace: fmtNumber(locale, data.pacePct) })}</p>
      {error ? <p className="mt-2 rounded-lg bg-red-50 p-2 text-sm text-red-700">{error}</p> : null}
      <div className="mt-3 space-y-4">
        {data.goals.map((g) => (
          <div key={g.metric}>
            <div className="flex flex-wrap items-center justify-between gap-2 text-sm">
              <span className="font-medium">{LABELS[g.metric]}</span>
              {g.target !== null ? (
                <span className="text-slate-500">{t("shared.zzRglAchievedPrefix", { actual: show(g.metric, g.actual), target: show(g.metric, g.target) })}<strong className="text-slate-700">{fmtNumber(locale, g.progressPct ?? 0)}%</strong></span>
              ) : <span className="text-slate-400">{t("shared.zzRglNoTarget", { actual: show(g.metric, g.actual) })}</span>}
            </div>
            {g.target !== null ? (
              <div className="relative mt-1 h-2.5 overflow-hidden rounded bg-slate-100">
                <div className="h-full bg-blue-500" style={{ width: `${Math.min(100, g.progressPct ?? 0)}%` }} />
                <div className="absolute top-0 h-full w-0.5 bg-slate-700" style={{ left: `${Math.min(100, data.pacePct)}%` }} title={t("shared.zzRglPaceTitle", { pace: fmtNumber(locale, data.pacePct) })} />
              </div>
            ) : null}
            <div className="mt-1.5 flex items-center gap-2">
              <input className="input" style={{ maxWidth: 200 }} placeholder={g.metric === "orders" ? S.zzRglPlaceholderCount : S.zzRglPlaceholderTaka} inputMode="numeric"
                value={draft[g.metric] ?? ""} onChange={(e) => setDraft((d) => ({ ...d, [g.metric]: e.target.value }))} />
              <button className="btn-primary btn-sm" onClick={() => save(g.metric)}>{g.target !== null ? S.zzRglChange : S.zzRglSet}</button>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
