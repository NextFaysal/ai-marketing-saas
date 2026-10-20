"use client";
import React from "react";
import { fmtDateTime, fmtMoneyMinor, fmtNumber } from "@repo/contracts";
import { useLocale } from "@/lib/i18n/provider";

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

// Meta study times arrive as unix SECONDS (numbers or numeric
// strings); date-shaped strings pass through as dates.
const fmtStudyTime = (v: unknown, locale: "bn" | "en" = "bn"): string => {
  if (v == null || v === "") return "—";
  const n = Number(v);
  if (Number.isFinite(n) && n > 0 && /^\d+$/.test(String(v).trim())) return fmtDateTime(locale, n * 1000);
  const d = new Date(String(v));
  return Number.isNaN(d.getTime()) ? String(v) : fmtDateTime(locale, d);
};

const fmtTotalsSpend = (tot: any, locale: "bn" | "en" = "bn"): string => {
  try { return tot?.spendMinor != null ? fmtMoneyMinor(locale, BigInt(String(tot.spendMinor))) : "—"; } catch { return String(tot?.spendMinor ?? "—"); }
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
  const { t, locale } = useLocale();
  // NB7 CN15: one experiment's read-back block. Meta's study
  // + cells render VERBATIM (labelled as Meta's own words);
  // local totals are the API's raw synced numbers beside
  // the API's own note — no winner is ever named here.
  const renderExpReadback = (exp: ExperimentRow) => {
    const rb: ExpReadback | null = expReadbacks[exp.id] ?? (exp.lastReadback ? { metaVerbatim: exp.lastReadback as ExpReadback["metaVerbatim"], localNumbers: null } : null);
    if (!rb) return null;
    const study: any = rb.metaVerbatim?.study ?? null;
    const cells: any[] = Array.isArray(rb.metaVerbatim?.cells) ? (rb.metaVerbatim?.cells as any[]) : [];
    const cellCampaigns = (c: any): string => {
      const arr = Array.isArray(c?.campaigns) ? c.campaigns : [];
      return arr.map((x: any) => (typeof x === "string" ? x : x?.id ?? "")).filter(Boolean).join(", ");
    };
    const totalsCol = (label: string, tot: any) => (
      <div className="rounded bg-white/70 p-2">
        <p className="font-semibold">{label}</p>
        {!tot ? <p className="text-slate-400">{t("campaignBuilder.expNoLocalTotals")}</p> : (<>
          <p>{t("campaignBuilder.expSpend")}<b>{fmtTotalsSpend(tot, locale)}</b> · Conversions: <b>{tot.conversions ?? "—"}</b></p>
          <p>Impressions: <b>{tot.impressions != null ? fmtNumber(locale, tot.impressions) : "—"}</b> · Clicks: <b>{tot.clicks != null ? fmtNumber(locale, tot.clicks) : "—"}</b></p>
        </>)}
      </div>
    );
    return (
      <div className="space-y-2">
        {study ? (
          <div className="space-y-0.5 rounded bg-white p-2 text-xs text-slate-700">
            <p className="font-semibold">{t("campaignBuilder.expMetaVerbatim")}</p>
            <p>{t("campaignBuilder.expNameType", { name: study.name ?? "—", type: study.type ?? "—" })}</p>
            <p>{t("campaignBuilder.expTimes", { start: fmtStudyTime(study.start_time, locale), end: fmtStudyTime(study.end_time, locale), first: fmtStudyTime(study.results_first_available_date, locale) })}</p>
            {cells.length ? (
              <div className="pt-1">
                <p className="font-semibold">{t("campaignBuilder.expCellsVerbatim")}</p>
                {cells.map((c, i) => (
                  <p key={c?.id ?? i}>{c?.name ?? `Cell ${i + 1}`} · Treatment: {c?.treatment_percentage ?? "—"}%{cellCampaigns(c) ? ` · Campaign: ${cellCampaigns(c)}` : ""}</p>
                ))}
              </div>
            ) : null}
            <details className="pt-1">
              <summary className="cursor-pointer font-medium">{t("campaignBuilder.expRawJson")}</summary>
              <pre className="mt-1 overflow-x-auto whitespace-pre-wrap rounded bg-slate-50 p-2">{JSON.stringify(study, null, 1)}</pre>
            </details>
          </div>
        ) : <p className="text-xs text-slate-500">{t("campaignBuilder.expNoReadback")}</p>}
        {rb.localNumbers ? (
          <div className="space-y-1">
            <div className="grid gap-2 sm:grid-cols-2 text-xs text-slate-700">
              {totalsCol(t("campaignBuilder.expVariantALocalTotals"), rb.localNumbers.planA)}
              {totalsCol(t("campaignBuilder.expVariantBLocalTotals"), rb.localNumbers.planB)}
            </div>
            {rb.localNumbers.note ? <p className="text-xs text-slate-500">{rb.localNumbers.note}</p> : null}
          </div>
        ) : null}
      </div>
    );
  };

  return (
    <div className={`space-y-3 rounded-xl border border-fuchsia-200 bg-fuchsia-50 p-3 text-sm ${activeStep !== 4 ? "hidden" : ""}`}>
      <p className="font-semibold">{t("campaignBuilder.xpExpTitle")}</p>
      <p className="text-xs text-slate-500">{t("campaignBuilder.xpExpIntro")}</p>
      <div className="space-y-2 rounded-lg bg-white/60 p-3">
        <div className="text-xs font-semibold text-slate-600">{t("campaignBuilder.xpExpCreateTitle")}</div>
        {expSiblings.length === 0 ? <p className="text-xs font-medium text-amber-700">{t("campaignBuilder.xpExpNeedVariant")}</p> : (
          <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
            <label className="block text-xs">{t("campaignBuilder.xpExpVariantB")}
              <select className="input mt-1" value={expForm.planBId} onChange={(e) => setExpForm({ ...expForm, planBId: e.target.value })}>
                <option value="">{t("campaignBuilder.xpExpVariantChoose")}</option>
                {expSiblings.map((v) => <option key={v.planId} value={v.planId}>{v.name}{v.variant ? ` (Variant ${v.variant})` : ""} · {v.status ?? ""}</option>)}
              </select>
            </label>
            <label className="block text-xs">{t("campaignBuilder.xpExpSplit")}<input type="number" min={10} max={90} className="input mt-1" value={expForm.splitA} onChange={(e) => setExpForm({ ...expForm, splitA: Number(e.target.value) })} /></label>
            <label className="block text-xs">{t("campaignBuilder.xpExpMetric")}<input className="input mt-1" value={expForm.metricEvent} onChange={(e) => setExpForm({ ...expForm, metricEvent: e.target.value })} placeholder="PURCHASE" /></label>
            <label className="block text-xs">{t("campaignBuilder.xpExpDuration")}<input type="number" min={1} max={30} className="input mt-1" value={expForm.durationDays} onChange={(e) => setExpForm({ ...expForm, durationDays: Number(e.target.value) })} /></label>
          </div>
        )}
        <button className="btn-primary btn-sm disabled:opacity-50" disabled={busy !== "" || expSiblings.length === 0 || !expForm.planBId} onClick={createExperiment}>{busy === "exp-create" ? t("campaignBuilder.xpExpCreating") : t("campaignBuilder.xpExpCreateBtn")}</button>
      </div>
      {experiments.length === 0 ? <p className="text-xs text-slate-500">{t("campaignBuilder.xpExpNone")}</p> : experiments.map((exp) => (
        <div key={exp.id} className="space-y-2 rounded-lg bg-white/70 p-3">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <span className="font-medium">{exp.name ?? "Meta Experiment"}</span>
            <button className="btn-secondary btn-sm disabled:opacity-50" disabled={busy !== ""} onClick={() => refreshExperiment(exp)}>{t("campaignBuilder.xpExpReadbackBtn")}</button>
          </div>
          <div className="text-xs text-slate-600">Meta Study ID: <span className="font-mono">{exp.metaStudyId ?? "—"}</span> · Split: A {exp.splitA}% / B {100 - Number(exp.splitA)}% · Metric: {exp.metricEvent ?? "—"}</div>
          <div className="text-xs text-slate-600">{t("campaignBuilder.xpExpTime", { start: exp.startTime ? fmtDateTime(locale, exp.startTime) : "—", end: exp.endTime ? fmtDateTime(locale, exp.endTime) : "—", last: exp.lastReadbackAt ? fmtDateTime(locale, exp.lastReadbackAt) : t("campaignBuilder.xpExpNever") })}</div>
          {exp.significanceNote ? <p className="text-xs text-slate-500">{exp.significanceNote}</p> : null}
          {renderExpReadback(exp)}
        </div>
      ))}
    </div>
  );
}
