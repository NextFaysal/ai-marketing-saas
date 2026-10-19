"use client";
import React, { useCallback, useEffect, useState } from "react";
import { apiFetch, API_URL, getToken } from "@/lib/api";
import { getOrganizationId } from "@/lib/org";
import { fmtMoneyMinor, fmtNumber } from "@repo/contracts";
import { useLocale } from "@/lib/i18n/provider";
import { EmptyState } from "@repo/ui";

/** Reports Advanced RP2 — custom report builder. The
 *  metric list follows the server's honest matrix:
 *  day = order-side metrics; platform/campaign = ad
 *  metrics. Money values arrive as minor-unit strings. */
const DAY_METRICS = [
  { key: "orders", label: "Orders", money: false }, { key: "revenue", label: "Revenue", money: true },
  { key: "refunds", label: "Refunds", money: true }, { key: "cogs", label: "COGS", money: true },
  { key: "adSpend", label: "Ad Spend", money: true }, { key: "profit", label: "Profit", money: true },
  { key: "aov", label: "AOV", money: true },
];
const ADS_METRICS = [
  { key: "spend", label: "Spend", money: true }, { key: "impressions", label: "Impressions", money: false },
  { key: "clicks", label: "Clicks", money: false }, { key: "conversions", label: "Platform Conversions", money: false },
  { key: "conversionValue", label: "Conversion Value (Platform)", money: true },
  { key: "ctr", label: "CTR %", money: false }, { key: "cpm", label: "CPM", money: true }, { key: "cpa", label: "CPA", money: true },
];
const PRESETS = [
  { key: "last_7d", labelKey: "analytics.builderRangeLast7" }, { key: "last_30d", labelKey: "analytics.builderRangeLast30" },
  { key: "this_month", labelKey: "analytics.builderRangeThisMonth" }, { key: "last_month", labelKey: "analytics.builderRangeLastMonth" },
];
interface RunResult { dimension: string; metrics: string[]; range: { from: string; to: string }; rows: { key: string; label: string; values: Record<string, string | number | null> }[]; totals: Record<string, string | number | null> }
interface Saved { id: string; name: string; dimension: string; metrics: string[]; rangePreset: string; recipients: string[] }

export default function ReportBuilderPage() {
  const { t, locale } = useLocale();
  const [dimension, setDimension] = useState("day");
  const [metrics, setMetrics] = useState<string[]>(["orders", "revenue", "profit"]);
  const [preset, setPreset] = useState("last_30d");
  const [result, setResult] = useState<RunResult | null>(null);
  const [saved, setSaved] = useState<Saved[]>([]);
  const [name, setName] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  const catalog = dimension === "day" ? DAY_METRICS : ADS_METRICS;
  const loadSaved = useCallback(async () => {
    const orgId = getOrganizationId(); if (!orgId) return;
    try { setSaved(await apiFetch<Saved[]>(`/organizations/${orgId}/reports/saved`)); } catch { /* list is secondary */ }
  }, []);
  useEffect(() => { loadSaved(); }, [loadSaved]);

  function changeDimension(d: string) {
    setDimension(d);
    setMetrics(d === "day" ? ["orders", "revenue", "profit"] : ["spend", "clicks", "conversions", "cpa"]);
    setResult(null);
  }
  function toggle(m: string) { setMetrics((cur) => (cur.includes(m) ? cur.filter((x) => x !== m) : [...cur, m])); }

  async function run(def?: { dimension: string; metrics: string[]; rangePreset: string }) {
    const orgId = getOrganizationId(); if (!orgId) return;
    setBusy(true); setError("");
    try {
      const out = def
        ? await apiFetch<RunResult>(`/organizations/${orgId}/reports/custom/run`, { method: "POST", body: JSON.stringify(def) })
        : await apiFetch<RunResult>(`/organizations/${orgId}/reports/custom/run`, { method: "POST", body: JSON.stringify({ dimension, metrics, rangePreset: preset }) });
      setResult(out);
    } catch (e) { setError(e instanceof Error ? e.message : "Run failed"); }
    finally { setBusy(false); }
  }
  async function save() {
    const orgId = getOrganizationId(); if (!orgId || !name.trim()) return;
    setBusy(true); setError("");
    try {
      await apiFetch(`/organizations/${orgId}/reports/saved`, { method: "POST", body: JSON.stringify({ name: name.trim(), dimension, metrics, rangePreset: preset }) });
      setName(""); await loadSaved();
    } catch (e) { setError(e instanceof Error ? e.message : "Save failed"); }
    finally { setBusy(false); }
  }
  async function remove(id: string) {
    const orgId = getOrganizationId(); if (!orgId) return;
    await apiFetch(`/organizations/${orgId}/reports/saved/${id}`, { method: "DELETE" }).catch(() => undefined);
    await loadSaved();
  }
  async function downloadCsv(id: string, name: string) {
    const orgId = getOrganizationId(); if (!orgId) return;
    try {
      const res = await fetch(`${API_URL}/organizations/${orgId}/reports/saved/${id}/export.csv`, { headers: { Authorization: `Bearer ${getToken() ?? ""}` } });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a"); a.href = url; a.download = `${name}.csv`; a.click();
      setTimeout(() => URL.revokeObjectURL(url), 5000);
    } catch (e) { setError(e instanceof Error ? e.message : "Download failed"); }
  }
  async function schedule(id: string, name: string, intervalMinutes: number) {
    const orgId = getOrganizationId(); if (!orgId) return;
    setError("");
    try {
      await apiFetch(`/organizations/${orgId}/automation/jobs`, {
        method: "POST",
        body: JSON.stringify({ name: `Report: ${name}`, type: "saved_report_delivery", targetId: id, intervalMinutes }),
      });
      setError("");
      alert(t("analytics.builderScheduleCreated"));
    } catch (e) { setError(e instanceof Error ? e.message : "Schedule failed"); }
  }
  async function openPrint(id: string) {
    const orgId = getOrganizationId(); if (!orgId) return;
    try {
      const res = await fetch(`${API_URL}/organizations/${orgId}/reports/saved/${id}/print`, { headers: { Authorization: `Bearer ${getToken() ?? ""}` } });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const blob = new Blob([await res.text()], { type: "text/html" });
      window.open(URL.createObjectURL(blob), "_blank");
    } catch (e) { setError(e instanceof Error ? e.message : "Print failed"); }
  }
  const fmt = (m: string, v: string | number | null) => {
    if (v === null || v === undefined) return "—";
    const meta = [...DAY_METRICS, ...ADS_METRICS].find((x) => x.key === m);
    if (meta?.money) { try { return fmtMoneyMinor(locale, BigInt(String(v))); } catch { return String(v); } }
    return fmtNumber(locale, Number(v));
  };

  return (
    <div className="space-y-6">
      <div>
        <h1 className="page-title">Custom Report Builder</h1>
        <p className="text-sm text-slate-500">{t("analytics.builderIntro")}</p>
      </div>
      {error ? <p className="rounded-lg bg-red-50 p-3 text-sm text-red-700">{error}</p> : null}

      <div className="card space-y-4 p-5">
        <div className="flex flex-wrap gap-4">
          <label className="text-sm">Dimension
            <select className="input ml-2" value={dimension} onChange={(e) => changeDimension(e.target.value)}>
              <option value="day">{t("analytics.builderDimDay")}</option>
              <option value="platform">{t("analytics.builderDimPlatform")}</option>
              <option value="campaign">{t("analytics.builderDimCampaign")}</option>
            </select>
          </label>
          <label className="text-sm">{t("analytics.builderRangeLabel")}
            <select className="input ml-2" value={preset} onChange={(e) => setPreset(e.target.value)}>
              {PRESETS.map((p) => <option key={p.key} value={p.key}>{t(p.labelKey)}</option>)}
            </select>
          </label>
        </div>
        <div className="flex flex-wrap gap-2">
          {catalog.map((m) => (
            <button key={m.key} onClick={() => toggle(m.key)} className={`rounded-full border px-3 py-1 text-sm ${metrics.includes(m.key) ? "border-blue-500 bg-blue-50 font-medium" : "text-slate-600"}`}>{m.label}</button>
          ))}
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <button className="btn-primary btn-sm disabled:opacity-50" disabled={busy || metrics.length === 0} onClick={() => run()}>{t("analytics.builderRun")}</button>
          <input className="input" placeholder={t("analytics.builderSavePlaceholder")} value={name} onChange={(e) => setName(e.target.value)} />
          <button className="btn-primary btn-sm disabled:opacity-50" disabled={busy || !name.trim()} onClick={save}>{t("analytics.builderSave")}</button>
        </div>
      </div>

      {result ? (
        <div className="card p-5">
          <div className="text-sm text-slate-500">{result.range.from} → {result.range.to} · {t("analytics.builderRowsCount", { count: fmtNumber(locale, result.rows.length) })}</div>
          {result.rows.length === 0 ? <EmptyState title={t("analytics.builderEmptyTitle")} description={t("analytics.builderEmptyDesc")} /> : (
            <div className="mt-3 overflow-x-auto">
              <table className="w-full text-sm">
                <thead><tr className="text-left text-slate-500">
                  <th className="py-2 pr-3">{result.dimension === "day" ? t("analytics.builderDateHeader") : result.dimension === "platform" ? "Platform" : "Campaign"}</th>
                  {result.metrics.map((m) => <th key={m} className="py-2 pr-3">{[...DAY_METRICS, ...ADS_METRICS].find((x) => x.key === m)?.label ?? m}</th>)}
                </tr></thead>
                <tbody>
                  {result.rows.map((r) => (
                    <tr key={r.key} className="border-t">
                      <td className="py-2 pr-3 font-medium">{r.label}</td>
                      {result.metrics.map((m) => <td key={m} className="py-2 pr-3">{fmt(m, r.values[m])}</td>)}
                    </tr>
                  ))}
                  <tr className="border-t bg-slate-50 font-semibold">
                    <td className="py-2 pr-3">{t("analytics.builderTotalRow")}</td>
                    {result.metrics.map((m) => <td key={m} className="py-2 pr-3">{fmt(m, result.totals[m])}</td>)}
                  </tr>
                </tbody>
              </table>
            </div>
          )}
        </div>
      ) : null}

      <div className="card p-5">
        <div className="font-semibold">{t("analytics.builderSavedTitle", { count: fmtNumber(locale, saved.length) })}</div>
        {saved.length === 0 ? <p className="mt-1 text-sm text-slate-500">{t("analytics.builderSavedEmpty")}</p> : (
          <ul className="mt-2 divide-y">
            {saved.map((s) => (
              <li key={s.id} className="flex flex-wrap items-center justify-between gap-2 py-2 text-sm">
                <span><span className="font-medium">{s.name}</span> <span className="text-slate-400">· {s.dimension} · {s.metrics.join(", ")} · {s.rangePreset}</span></span>
                <span className="flex flex-wrap items-center gap-3">
                  <button className="font-semibold text-blue-600" onClick={() => run({ dimension: s.dimension, metrics: s.metrics, rangePreset: s.rangePreset })}>{t("analytics.builderRunSaved")}</button>
                  <button className="text-slate-600" onClick={() => downloadCsv(s.id, s.name)}>CSV</button>
                  <button className="text-slate-600" onClick={() => openPrint(s.id)}>Print/PDF</button>
                  <select className="input" defaultValue="" onChange={(e) => { if (e.target.value) { schedule(s.id, s.name, Number(e.target.value)); e.target.value = ""; } }}>
                    <option value="">{t("analytics.builderSchedulePlaceholder")}</option>
                    <option value="1440">{t("analytics.builderScheduleDaily")}</option>
                    <option value="10080">{t("analytics.builderScheduleWeekly")}</option>
                    <option value="43200">{t("analytics.builderScheduleMonthly")}</option>
                  </select>
                  <button className="text-red-600" onClick={() => remove(s.id)}>{t("analytics.builderDelete")}</button>
                </span>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
