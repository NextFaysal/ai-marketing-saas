"use client";
import React from "react";
import { fmtDateTime, fmtNumber } from "@repo/contracts";
import { useLocale } from "@/lib/i18n/provider";

export interface SeriesRow {
  id: string;
  name: string;
  cadence: string;
  interval?: number | null;
  anchorDate?: string | null;
  dates?: string[] | null;
  leadDays?: number | null;
  nextIndex?: number | null;
  status: string;
  sourcePlanId: string;
  sourcePlanName?: string | null;
  sourcePlanStatus?: string | null;
  pendingPlan: { id: string; name: string; status: string } | null;
  nextInstanceDate?: string | null;
  generationHeld?: boolean;
}

const SERIES_CADENCE_KEY: Record<string, string> = { weekly: "ads.cgCadenceWeekly", monthly: "ads.cgCadenceMonthly", dates: "ads.cgCadenceDates" };

interface SeriesDrawerProps {
  seriesList: SeriesRow[];
  seriesForm: { name: string; cadence: string; interval: number; anchor: string; datesText: string; leadDays: number };
  setSeriesForm: React.Dispatch<React.SetStateAction<{ name: string; cadence: string; interval: number; anchor: string; datesText: string; leadDays: number }>>;
  createSeries: () => Promise<void>;
  doSeriesAction: (id: string, act: "pause" | "resume" | "end") => Promise<void>;
  busy: string;
  activeStep: number;
}

export default function SeriesDrawer({
  seriesList,
  seriesForm,
  setSeriesForm,
  createSeries,
  doSeriesAction,
  busy,
  activeStep,
}: SeriesDrawerProps) {
  const { t, locale } = useLocale();
  return (
    <div className={`space-y-3 rounded-xl border border-violet-200 bg-violet-50 p-3 text-sm ${activeStep !== 4 ? "hidden" : ""}`}>
      <p className="font-semibold">{t("campaignBuilder.srTitle")}</p>
      <p className="text-xs text-slate-500">{t("campaignBuilder.srIntro")}</p>
      <div className="space-y-2 rounded-lg bg-white/60 p-3">
        <div className="text-xs font-semibold text-slate-600">{t("campaignBuilder.srCreateTitle")}</div>
        <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
          <label className="block text-xs">{t("campaignBuilder.srNameLabel")}<input className="input mt-1" value={seriesForm.name} onChange={(e) => setSeriesForm({ ...seriesForm, name: e.target.value })} placeholder={t("campaignBuilder.srNamePlaceholder")} /></label>
          <label className="block text-xs">Cadence
            <select className="input mt-1" value={seriesForm.cadence} onChange={(e) => setSeriesForm({ ...seriesForm, cadence: e.target.value })}>
              <option value="weekly">{t("campaignBuilder.srWeekly")}</option><option value="monthly">{t("campaignBuilder.srMonthly")}</option><option value="dates">{t("campaignBuilder.srDates")}</option>
            </select>
          </label>
          {seriesForm.cadence !== "dates" ? <label className="block text-xs">{seriesForm.cadence === "weekly" ? t("campaignBuilder.srIntervalWeekly") : t("campaignBuilder.srIntervalMonthly")}<input type="number" min={1} max={12} className="input mt-1" value={seriesForm.interval} onChange={(e) => setSeriesForm({ ...seriesForm, interval: Number(e.target.value) })} /></label> : null}
          {seriesForm.cadence !== "dates" ? <label className="block text-xs">{t("campaignBuilder.srAnchorLabel")}<input type="datetime-local" className="input mt-1" value={seriesForm.anchor} onChange={(e) => setSeriesForm({ ...seriesForm, anchor: e.target.value })} /></label> : null}
          <label className="block text-xs">{t("campaignBuilder.srLeadDays")}<input type="number" min={0} max={30} className="input mt-1" value={seriesForm.leadDays} onChange={(e) => setSeriesForm({ ...seriesForm, leadDays: Number(e.target.value) })} /></label>
        </div>
        {seriesForm.cadence === "dates" ? <label className="block text-xs">{t("campaignBuilder.srDatesLabel")}<textarea className="input mt-1" rows={3} value={seriesForm.datesText} onChange={(e) => setSeriesForm({ ...seriesForm, datesText: e.target.value })} placeholder={"2026-11-01T10:00\n2026-11-15T10:00"} /></label> : null}
        <button className="btn-primary btn-sm disabled:opacity-50" disabled={busy !== ""} onClick={createSeries}>{busy === "series-create" ? t("campaignBuilder.srCreating") : t("campaignBuilder.srCreateBtn")}</button>
      </div>
      {seriesList.length === 0 ? <p className="text-xs text-slate-500">{t("campaignBuilder.srNone")}</p> : seriesList.map((s) => (
        <div key={s.id} className="space-y-1 rounded-lg bg-white/70 p-3">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <span className="font-medium">{s.name} <span className={`ml-1 rounded px-1.5 py-0.5 text-[11px] font-semibold ${s.status === "active" ? "bg-green-100 text-green-700" : s.status === "paused" ? "bg-amber-100 text-amber-700" : "bg-slate-200 text-slate-600"}`}>{s.status === "active" ? t("campaignBuilder.srStatusActive") : s.status === "paused" ? t("campaignBuilder.srStatusPaused") : t("campaignBuilder.srStatusEnded")}</span></span>
            <span className="flex gap-1">
              {s.status === "active" ? <button className="btn-secondary btn-sm" disabled={busy !== ""} onClick={() => doSeriesAction(s.id, "pause")}>{t("campaignBuilder.srPauseBtn")}</button> : null}
              {s.status === "paused" ? <button className="btn-secondary btn-sm" disabled={busy !== ""} onClick={() => doSeriesAction(s.id, "resume")}>{t("campaignBuilder.srResumeBtn")}</button> : null}
              {s.status !== "ended" ? <button className="btn-secondary btn-sm" disabled={busy !== ""} onClick={() => doSeriesAction(s.id, "end")}>{t("campaignBuilder.srEndBtn")}</button> : null}
            </span>
          </div>
          <div className="text-xs text-slate-600">{t("campaignBuilder.srCadenceLine", { cadence: SERIES_CADENCE_KEY[s.cadence] ? t(SERIES_CADENCE_KEY[s.cadence]) : s.cadence, interval: s.cadence !== "dates" && s.interval ? t("campaignBuilder.srIntervalPart", { interval: fmtNumber(locale, s.interval) }) : "", next: s.nextInstanceDate ? fmtDateTime(locale, s.nextInstanceDate) : "—", pending: s.pendingPlan ? t("campaignBuilder.srPendingPart", { name: s.pendingPlan.name, status: s.pendingPlan.status }) : "" })}</div>
          {s.generationHeld ? <p className="text-xs font-medium text-amber-700">{t("campaignBuilder.srHeld")}</p> : null}
        </div>
      ))}
    </div>
  );
}
