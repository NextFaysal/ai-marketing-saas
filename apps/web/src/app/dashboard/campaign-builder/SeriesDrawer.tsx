"use client";
import React from "react";

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

const SERIES_CADENCE_LABEL: Record<string, string> = {
  weekly: "সাপ্তাহিক",
  monthly: "মাসিক",
  dates: "তারিখের তালিকা",
};

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
  return (
    <div className={`space-y-3 rounded-xl border border-violet-200 bg-violet-50 p-3 text-sm ${activeStep !== 4 ? "hidden" : ""}`}>
      <p className="font-semibold">🔁 Recurring Series (CN16) — এই Plan থেকে নিয়মিত Instance</p>
      <p className="text-xs text-slate-500">Series শুধু Draft Instance তৈরি করে — প্রতিটি Instance আলাদাভাবে Approval Flow দিয়ে যাবে; Series নিজে কিছু Publish করে না। আগের Instance Draft-এ থাকলে পরেরটি তৈরি আটকে থাকে (একটির বেশি Pending Draft জমে না)।</p>
      <div className="space-y-2 rounded-lg bg-white/60 p-3">
        <div className="text-xs font-semibold text-slate-600">নতুন Series তৈরি করুন</div>
        <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
          <label className="block text-xs">নাম (ঐচ্ছিক)<input className="input mt-1" value={seriesForm.name} onChange={(e) => setSeriesForm({ ...seriesForm, name: e.target.value })} placeholder="যেমন: সাপ্তাহিক অফার" /></label>
          <label className="block text-xs">Cadence
            <select className="input mt-1" value={seriesForm.cadence} onChange={(e) => setSeriesForm({ ...seriesForm, cadence: e.target.value })}>
              <option value="weekly">সাপ্তাহিক</option><option value="monthly">মাসিক</option><option value="dates">তারিখের তালিকা</option>
            </select>
          </label>
          {seriesForm.cadence !== "dates" ? <label className="block text-xs">Interval (প্রতি কত {seriesForm.cadence === "weekly" ? "সপ্তাহ" : "মাস"})<input type="number" min={1} max={12} className="input mt-1" value={seriesForm.interval} onChange={(e) => setSeriesForm({ ...seriesForm, interval: Number(e.target.value) })} /></label> : null}
          {seriesForm.cadence !== "dates" ? <label className="block text-xs">প্রথম Instance এর তারিখ (Anchor)<input type="datetime-local" className="input mt-1" value={seriesForm.anchor} onChange={(e) => setSeriesForm({ ...seriesForm, anchor: e.target.value })} /></label> : null}
          <label className="block text-xs">আগে থেকে তৈরি (Lead Days)<input type="number" min={0} max={30} className="input mt-1" value={seriesForm.leadDays} onChange={(e) => setSeriesForm({ ...seriesForm, leadDays: Number(e.target.value) })} /></label>
        </div>
        {seriesForm.cadence === "dates" ? <label className="block text-xs">তারিখের তালিকা — প্রতি লাইনে একটি তারিখ/সময়<textarea className="input mt-1" rows={3} value={seriesForm.datesText} onChange={(e) => setSeriesForm({ ...seriesForm, datesText: e.target.value })} placeholder={"2026-11-01T10:00\n2026-11-15T10:00"} /></label> : null}
        <button className="btn-primary btn-sm disabled:opacity-50" disabled={busy !== ""} onClick={createSeries}>{busy === "series-create" ? "তৈরি হচ্ছে..." : "🔁 Series তৈরি করুন"}</button>
      </div>
      {seriesList.length === 0 ? <p className="text-xs text-slate-500">এই Plan থেকে এখনো কোনো Series তৈরি হয়নি।</p> : seriesList.map((s) => (
        <div key={s.id} className="space-y-1 rounded-lg bg-white/70 p-3">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <span className="font-medium">{s.name} <span className={`ml-1 rounded px-1.5 py-0.5 text-[11px] font-semibold ${s.status === "active" ? "bg-green-100 text-green-700" : s.status === "paused" ? "bg-amber-100 text-amber-700" : "bg-slate-200 text-slate-600"}`}>{s.status === "active" ? "সক্রিয়" : s.status === "paused" ? "বিরতি" : "শেষ"}</span></span>
            <span className="flex gap-1">
              {s.status === "active" ? <button className="btn-secondary btn-sm" disabled={busy !== ""} onClick={() => doSeriesAction(s.id, "pause")}>⏸ Pause</button> : null}
              {s.status === "paused" ? <button className="btn-secondary btn-sm" disabled={busy !== ""} onClick={() => doSeriesAction(s.id, "resume")}>▶ Resume</button> : null}
              {s.status !== "ended" ? <button className="btn-secondary btn-sm" disabled={busy !== ""} onClick={() => doSeriesAction(s.id, "end")}>⏹ End</button> : null}
            </span>
          </div>
          <div className="text-xs text-slate-600">Cadence: {SERIES_CADENCE_LABEL[s.cadence] ?? s.cadence}{s.cadence !== "dates" && s.interval ? ` (প্রতি ${s.interval})` : ""} · পরের Instance: {s.nextInstanceDate ? new Date(s.nextInstanceDate).toLocaleString("bn-BD") : "—"}{s.pendingPlan ? ` · Pending Instance: ${s.pendingPlan.name} (${s.pendingPlan.status})` : ""}</div>
          {s.generationHeld ? <p className="text-xs font-medium text-amber-700">আগের Instance Draft-এ আছে — সেটি Approval Flow-তে গেলেই পরেরটি তৈরি হবে</p> : null}
        </div>
      ))}
    </div>
  );
}
