"use client";
import React from "react";
import { fmtMoneyBn } from "@/lib/money-bn";

export interface ExperimentRow {
  id: string;
  name?: string | null;
  groupId?: string | null;
  planAId: string;
  planBId: string;
  splitA: number;
  metricEvent?: string | null;
  startTime?: string | null;
  endTime?: string | null;
  metaBusinessId?: string | null;
  metaStudyId?: string | null;
  lastReadback?: unknown;
  lastReadbackAt?: string | null;
  significanceNote?: string | null;
}

export interface ExpReadback {
  experiment?: ExperimentRow;
  metaVerbatim: { study?: any; cells?: any[] } | null;
  localNumbers: { planA: any; planB: any; note?: string } | null;
}

const fmtStudyTime = (v: unknown): string => {
  if (v == null || v === "") return "—";
  const n = Number(v);
  if (Number.isFinite(n) && n > 0 && /^\d+$/.test(String(v).trim())) return new Date(n * 1000).toLocaleString("bn-BD");
  const d = new Date(String(v));
  return Number.isNaN(d.getTime()) ? String(v) : d.toLocaleString("bn-BD");
};

const fmtTotalsSpend = (t: any): string => {
  try { return t?.spendMinor != null ? fmtMoneyBn(t.spendMinor) : "—"; } catch { return String(t?.spendMinor ?? "—"); }
};

interface ExperimentsDrawerProps {
  experiments: ExperimentRow[];
  expSiblings: { planId: string; name: string; variant?: string | null; status?: string | null }[];
  expForm: { planBId: string; splitA: number; metricEvent: string; durationDays: number };
  setExpForm: React.Dispatch<React.SetStateAction<{ planBId: string; splitA: number; metricEvent: string; durationDays: number }>>;
  createExperiment: () => Promise<void>;
  refreshExperiment: (exp: ExperimentRow) => Promise<void>;
  expReadbacks: Record<string, ExpReadback>;
  busy: string;
  activeStep: number;
}

export default function ExperimentsDrawer({
  experiments,
  expSiblings,
  expForm,
  setExpForm,
  createExperiment,
  refreshExperiment,
  expReadbacks,
  busy,
  activeStep,
}: ExperimentsDrawerProps) {
  const renderExpReadback = (exp: ExperimentRow) => {
    const rb: ExpReadback | null = expReadbacks[exp.id] ?? (exp.lastReadback ? { metaVerbatim: exp.lastReadback as ExpReadback["metaVerbatim"], localNumbers: null } : null);
    if (!rb) return null;
    const study: any = rb.metaVerbatim?.study ?? null;
    const cells: any[] = Array.isArray(rb.metaVerbatim?.cells) ? (rb.metaVerbatim?.cells as any[]) : [];
    const cellCampaigns = (c: any): string => {
      const arr = Array.isArray(c?.campaigns) ? c.campaigns : [];
      return arr.map((x: any) => (typeof x === "string" ? x : x?.id ?? "")).filter(Boolean).join(", ");
    };
    const totalsCol = (label: string, t: any) => (
      <div className="rounded bg-white/70 p-2">
        <p className="font-semibold">{label}</p>
        {!t ? <p className="text-slate-400">Local Totals নেই (Sync হওয়া ডেটা নেই)।</p> : (<>
          <p>খরচ: <b>{fmtTotalsSpend(t)}</b> · Conversions: <b>{t.conversions ?? "—"}</b></p>
          <p>Impressions: <b>{t.impressions?.toLocaleString?.() ?? t.impressions ?? "—"}</b> · Clicks: <b>{t.clicks?.toLocaleString?.() ?? t.clicks ?? "—"}</b></p>
        </>)}
      </div>
    );
    return (
      <div className="space-y-2">
        {study ? (
          <div className="space-y-0.5 rounded bg-white p-2 text-xs text-slate-700">
            <p className="font-semibold">Meta-র নিজের তথ্য (Verbatim)</p>
            <p>নাম: {study.name ?? "—"} · ধরন: {study.type ?? "—"}</p>
            <p>শুরু: {fmtStudyTime(study.start_time)} · শেষ: {fmtStudyTime(study.end_time)} · ফলাফল প্রথম পাওয়া যাবে: {fmtStudyTime(study.results_first_available_date)}</p>
            {cells.length ? (
              <div className="pt-1">
                <p className="font-semibold">Cells — Meta-র নিজের তথ্য (Verbatim)</p>
                {cells.map((c, i) => (
                  <p key={c?.id ?? i}>{c?.name ?? `Cell ${i + 1}`} · Treatment: {c?.treatment_percentage ?? "—"}%{cellCampaigns(c) ? ` · Campaign: ${cellCampaigns(c)}` : ""}</p>
                ))}
              </div>
            ) : null}
            <details className="pt-1">
              <summary className="cursor-pointer font-medium">Meta Study-র সম্পূর্ণ Raw Response (JSON)</summary>
              <pre className="mt-1 overflow-x-auto whitespace-pre-wrap rounded bg-slate-50 p-2">{JSON.stringify(study, null, 1)}</pre>
            </details>
          </div>
        ) : <p className="text-xs text-slate-500">Meta-র Verbatim Read-back এখনো পাওয়া যায়নি।</p>}
        {rb.localNumbers ? (
          <div className="space-y-1">
            <div className="grid gap-2 sm:grid-cols-2 text-xs text-slate-700">
              {totalsCol("Variant A — Local Totals", rb.localNumbers.planA)}
              {totalsCol("Variant B — Local Totals", rb.localNumbers.planB)}
            </div>
            {rb.localNumbers.note ? <p className="text-xs text-slate-500">{rb.localNumbers.note}</p> : null}
          </div>
        ) : null}
      </div>
    );
  };

  return (
    <div className={`space-y-3 rounded-xl border border-fuchsia-200 bg-fuchsia-50 p-3 text-sm ${activeStep !== 4 ? "hidden" : ""}`}>
      <p className="font-semibold">🧪 Meta Experiment (CN15) — Meta Ad Study (SPLIT_TEST)</p>
      <p className="text-xs text-slate-500">দুটি Published Variant Campaign এর উপর Meta নিজে Study চালায় — Experiment তৈরি করলে Campaign দুটির অবস্থা বদলায় না, কিছু Publish হয় না। Significance/Winner এই Platform হিসাব করে না; Meta-র Read-back হুবহু দেখানো হয়।</p>
      <div className="space-y-2 rounded-lg bg-white/60 p-3">
        <div className="text-xs font-semibold text-slate-600">নতুন Experiment তৈরি করুন</div>
        {expSiblings.length === 0 ? <p className="text-xs font-medium text-amber-700">আগে A/B Variant তৈরি করুন — এই Plan এর A/B Group এ অন্য কোনো Variant পাওয়া যায়নি।</p> : (
          <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
            <label className="block text-xs">Variant B (অন্য Plan)
              <select className="input mt-1" value={expForm.planBId} onChange={(e) => setExpForm({ ...expForm, planBId: e.target.value })}>
                <option value="">Variant বেছে নিন</option>
                {expSiblings.map((v) => <option key={v.planId} value={v.planId}>{v.name}{v.variant ? ` (Variant ${v.variant})` : ""} · {v.status ?? ""}</option>)}
              </select>
            </label>
            <label className="block text-xs">Split — A এর শতাংশ (১০–৯০)<input type="number" min={10} max={90} className="input mt-1" value={expForm.splitA} onChange={(e) => setExpForm({ ...expForm, splitA: Number(e.target.value) })} /></label>
            <label className="block text-xs">Metric Event<input className="input mt-1" value={expForm.metricEvent} onChange={(e) => setExpForm({ ...expForm, metricEvent: e.target.value })} placeholder="PURCHASE" /></label>
            <label className="block text-xs">মেয়াদ (দিন, ১–৩০)<input type="number" min={1} max={30} className="input mt-1" value={expForm.durationDays} onChange={(e) => setExpForm({ ...expForm, durationDays: Number(e.target.value) })} /></label>
          </div>
        )}
        <button className="btn-primary btn-sm disabled:opacity-50" disabled={busy !== "" || expSiblings.length === 0 || !expForm.planBId} onClick={createExperiment}>{busy === "exp-create" ? "তৈরি হচ্ছে..." : "🧪 Experiment তৈরি করুন (Meta তে)"}</button>
      </div>
      {experiments.length === 0 ? <p className="text-xs text-slate-500">এই Plan এর কোনো Experiment এখনো নেই।</p> : experiments.map((exp) => (
        <div key={exp.id} className="space-y-2 rounded-lg bg-white/70 p-3">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <span className="font-medium">{exp.name ?? "Meta Experiment"}</span>
            <button className="btn-secondary btn-sm disabled:opacity-50" disabled={busy !== ""} onClick={() => refreshExperiment(exp)}>🔄 Meta Read-back</button>
          </div>
          <div className="text-xs text-slate-600">Meta Study ID: <span className="font-mono">{exp.metaStudyId ?? "—"}</span> · Split: A {exp.splitA}% / B {100 - Number(exp.splitA)}% · Metric: {exp.metricEvent ?? "—"}</div>
          <div className="text-xs text-slate-600">সময়: {exp.startTime ? new Date(exp.startTime).toLocaleString("bn-BD") : "—"} → {exp.endTime ? new Date(exp.endTime).toLocaleString("bn-BD") : "—"} · সর্বশেষ Read-back: {exp.lastReadbackAt ? new Date(exp.lastReadbackAt).toLocaleString("bn-BD") : "এখনো হয়নি"}</div>
          {exp.significanceNote ? <p className="text-xs text-slate-500">{exp.significanceNote}</p> : null}
          {renderExpReadback(exp)}
        </div>
      ))}
    </div>
  );
}
