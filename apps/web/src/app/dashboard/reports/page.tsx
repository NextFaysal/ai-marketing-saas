"use client";
import React, { useCallback, useEffect, useState } from "react";
import { apiFetch } from "@/lib/api";
import { getOrganizationId } from "@/lib/org";
import { Markdown } from "@/components/markdown";
import { EmptyState } from "@repo/ui";
import { fmtDate, fmtDateTime, fmtMoney, fmtNumber } from "@repo/contracts";
import { useLocale } from "@/lib/i18n/provider";

interface Report { id: string; type: string; title: string; content: string; provider: string; version: number; createdAt: string; periodStart: string; periodEnd: string }
interface Recommendation { id: string; title: string; detail?: string | null; priority: string; status: string }
interface Anomaly { type: string; severity: string; message: string }
interface CenterData {
  catalog: { key: string; title: string; route: string; description: string }[];
  shares: { activeCount: number };
  jobs: { id: string; name: string; type: string; enabled: boolean; lastRunAt: string | null; lastStatus: string | null }[];
  freshness: { storeLastSyncAt: string | null; latestAdMetricDate: string | null; latestOrderAt: string | null };
}
interface ExecutiveData {
  range: { from: string; to: string };
  sales: { orders: number; revenueMinor: string; profit: { contributionProfitMinor: string; contributionMarginPercent: number | null } };
  ads: { spendMinor: string; platformConversions: number; topCampaigns: { name: string; spendMinor: string; conversions: number }[] };
  customers: { newInRange: number; withOrders: number; segments: Record<string, number> };
  operations: { ordersByStatus: Record<string, number>; topProducts: { name: string; quantity: number; totalMinor: string }[] };
}

export default function ReportsPage() {
  const { t, locale } = useLocale();
  const [reports, setReports] = useState<Report[]>([]);
  const [selected, setSelected] = useState<Report | null>(null);
  const [recommendations, setRecommendations] = useState<Recommendation[]>([]);
  const [anomalies, setAnomalies] = useState<{ anomalies: Anomaly[]; sufficientData: boolean; note?: string } | null>(null);
  const [center, setCenter] = useState<CenterData | null>(null);
  const [exec, setExec] = useState<ExecutiveData | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState("");

  const load = useCallback(async () => {
    const orgId = getOrganizationId();
    if (!orgId) { setError(t("analytics.reportsNoOrg")); return; }
    try {
      const [r, recs, an] = await Promise.all([
        apiFetch<Report[]>(`/organizations/${orgId}/ai/reports`),
        apiFetch<Recommendation[]>(`/organizations/${orgId}/ai/recommendations`),
        apiFetch<any>(`/organizations/${orgId}/ai/anomalies?days=14`),
      ]);
      setReports(r); setRecommendations(recs); setAnomalies(an);
      if (r.length && !selected) setSelected(r[0]);
      apiFetch<CenterData>(`/organizations/${orgId}/reports/center`).then(setCenter).catch(() => setCenter(null));
      apiFetch<ExecutiveData>(`/organizations/${orgId}/reports/executive`).then(setExec).catch(() => setExec(null));
    } catch (e) { setError(e instanceof Error ? e.message : "Failed"); }
  }, [selected]);

  useEffect(() => { load(); }, [load]);

  async function generate(type: string) {
    const orgId = getOrganizationId(); if (!orgId) return;
    setBusy(type); setError("");
    try {
      const report = await apiFetch<Report>(`/organizations/${orgId}/ai/reports/generate`, {
        method: "POST", body: JSON.stringify({ type, language: "bn" }),
      });
      setSelected(report);
      await load();
    } catch (e) { setError(e instanceof Error ? e.message : "Generation failed"); }
    finally { setBusy(""); }
  }

  async function updateRec(id: string, status: string) {
    const orgId = getOrganizationId(); if (!orgId) return;
    await apiFetch(`/organizations/${orgId}/ai/recommendations/${id}`, { method: "PATCH", body: JSON.stringify({ status }) });
    await load();
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="page-title">Reports</h1>
          <p className="text-sm text-slate-500">{t("analytics.reportsIntro")}</p>
        </div>
        <div className="flex gap-2">
          {(["daily", "weekly", "monthly"] as const).map((rt) => (
            <button key={rt} className="btn-primary btn-sm disabled:opacity-50" disabled={busy !== ""} onClick={() => generate(rt)}>
              {busy === rt ? t("analytics.reportsGenerating") : rt === "daily" ? t("analytics.reportsDaily") : rt === "weekly" ? t("analytics.reportsWeekly") : t("analytics.reportsMonthly")}
            </button>
          ))}
        </div>
      </div>
      {error ? <p className="rounded-lg bg-red-50 p-3 text-sm text-red-700">{error}</p> : null}

      {center ? (
        <div className="card p-5">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="font-semibold">{t("analytics.reportsCenterTitle")}</div>
            <div className="text-xs text-slate-500">
              {t("analytics.reportsFreshnessPrefix")} {center.freshness.storeLastSyncAt ? fmtDateTime(locale, center.freshness.storeLastSyncAt) : t("analytics.reportsFreshnessNever")} · {t("analytics.reportsFreshnessAds")} {center.freshness.latestAdMetricDate ? fmtDate(locale, center.freshness.latestAdMetricDate) : t("analytics.reportsFreshnessNone")} · {t("analytics.reportsFreshnessLastOrder")} {center.freshness.latestOrderAt ? fmtDateTime(locale, center.freshness.latestOrderAt) : t("analytics.reportsFreshnessNone")}
            </div>
          </div>
          <div className="mt-3 grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
            {center.catalog.map((c) => (
              <a key={c.key} href={c.route} className="rounded-lg border p-3 transition hover:border-blue-400">
                <div className="text-sm font-medium">{c.title}</div>
                <div className="mt-0.5 text-xs text-slate-500">{c.description}</div>
              </a>
            ))}
          </div>
          <div className="mt-3 flex flex-wrap gap-4 text-xs text-slate-500">
            <span>{t("analytics.reportsActiveLinks")} <strong className="text-slate-700">{fmtNumber(locale, center.shares.activeCount)}</strong></span>
            {center.jobs.length > 0 ? <span>{t("analytics.reportsJobPrefix")} {center.jobs.map((j) => `${j.name} (${j.enabled ? t("analytics.reportsJobOn") : t("analytics.reportsJobOff")}${j.lastRunAt ? t("analytics.reportsJobLast", { date: fmtDate(locale, j.lastRunAt) }) : ""})`).join(" · ")}</span> : <span>{t("analytics.reportsNoJob")}</span>}
          </div>
        </div>
      ) : null}

      {exec ? (
        <div className="card p-5">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="font-semibold">{t("analytics.reportsExecTitle")}</div>
            <div className="text-xs text-slate-500">{exec.range.from} → {exec.range.to}</div>
          </div>
          <div className="mt-3 grid gap-3 sm:grid-cols-2 lg:grid-cols-4 text-sm">
            <div className="rounded-lg bg-slate-50 p-3"><div className="text-xs text-slate-400">Revenue</div><div className="mt-0.5 font-bold">{fmtMoney(locale, Number(BigInt(exec.sales.revenueMinor)) / 100, { minimumFractionDigits: 2 })}</div><div className="text-xs text-slate-500">{t("analytics.reportsOrdersCount", { count: fmtNumber(locale, exec.sales.orders) })}</div></div>
            <div className="rounded-lg bg-slate-50 p-3"><div className="text-xs text-slate-400">Contribution Profit</div><div className="mt-0.5 font-bold">{fmtMoney(locale, Number(BigInt(exec.sales.profit.contributionProfitMinor)) / 100, { minimumFractionDigits: 2 })}</div><div className="text-xs text-slate-500">Margin {exec.sales.profit.contributionMarginPercent ?? "—"}%</div></div>
            <div className="rounded-lg bg-slate-50 p-3"><div className="text-xs text-slate-400">Ad Spend</div><div className="mt-0.5 font-bold">{fmtMoney(locale, Number(BigInt(exec.ads.spendMinor)) / 100, { minimumFractionDigits: 2 })}</div><div className="text-xs text-slate-500">{t("analytics.reportsPlatformConversions", { count: fmtNumber(locale, exec.ads.platformConversions) })}</div></div>
            <div className="rounded-lg bg-slate-50 p-3"><div className="text-xs text-slate-400">Customer</div><div className="mt-0.5 font-bold">{t("analytics.reportsCustomersNew", { count: fmtNumber(locale, exec.customers.newInRange) })}</div><div className="text-xs text-slate-500">{t("analytics.reportsCustomersWithOrders", { count: fmtNumber(locale, exec.customers.withOrders) })} {Object.entries(exec.customers.segments).sort((a, b) => b[1] - a[1])[0]?.[0] ?? "—"}</div></div>
          </div>
          <div className="mt-3 grid gap-4 text-sm lg:grid-cols-2">
            <div>
              <div className="font-medium">Top Campaign</div>
              {exec.ads.topCampaigns.length === 0 ? <p className="text-slate-500">{t("analytics.reportsNoCampaignData")}</p> : (
                <ul className="mt-1 space-y-1">{exec.ads.topCampaigns.map((c, i) => <li key={i} className="flex justify-between gap-2"><span>{c.name}</span><span className="text-slate-500">{fmtMoney(locale, Number(BigInt(c.spendMinor)) / 100)} · {fmtNumber(locale, c.conversions)} conv.</span></li>)}</ul>
              )}
            </div>
            <div>
              <div className="font-medium">Top Product</div>
              {exec.operations.topProducts.length === 0 ? <p className="text-slate-500">{t("analytics.reportsNoProductSales")}</p> : (
                <ul className="mt-1 space-y-1">{exec.operations.topProducts.map((p, i) => <li key={i} className="flex justify-between gap-2"><span>{p.name}</span><span className="text-slate-500">{t("analytics.reportsQuantityCount", { count: fmtNumber(locale, p.quantity) })} · {fmtMoney(locale, Number(BigInt(p.totalMinor)) / 100)}</span></li>)}</ul>
              )}
            </div>
          </div>
        </div>
      ) : null}

      {anomalies ? (
        <div className="card p-5">
          <div className="font-semibold">{t("analytics.reportsAnomalyTitle")}</div>
          {!anomalies.sufficientData ? <p className="mt-1 text-sm text-slate-500">{t("analytics.reportsAnomalyInsufficient")} {anomalies.note ?? ""}</p>
            : anomalies.anomalies.length === 0 ? <p className="mt-1 text-sm text-slate-500">{t("analytics.reportsAnomalyNone")}</p>
            : <ul className="mt-2 space-y-1">{anomalies.anomalies.map((a, i) => <li key={i} className="text-sm"><span className={`rounded px-2 py-0.5 text-xs font-semibold ${a.severity === "critical" ? "bg-red-100 text-red-700" : "bg-amber-100 text-amber-700"}`}>{a.severity}</span> <span className="ml-1">{a.message}</span></li>)}</ul>}
        </div>
      ) : null}

      <div className="grid gap-4 lg:grid-cols-3">
        <div className="space-y-2">
          <div className="font-semibold">{t("analytics.reportsPreviousTitle")}</div>
          {reports.length === 0 ? <EmptyState title={t("analytics.reportsEmptyTitle")} description={t("analytics.reportsEmptyDesc")} /> : reports.map((r) => (
            <button key={r.id} onClick={() => setSelected(r)} className={`block w-full rounded-lg border bg-white px-3 py-2 text-left text-sm ${selected?.id === r.id ? "border-blue-500" : ""}`}>
              <div className="font-medium">{r.title}</div>
              <div className="text-xs text-slate-400">{r.type} · v{r.version} · {fmtDateTime(locale, r.createdAt)} · {r.provider === "dev-template" ? "Dev Template" : r.provider}</div>
            </button>
          ))}
          {recommendations.length > 0 ? (
            <div className="pt-2">
              <div className="font-semibold">{t("analytics.reportsOpenRecs", { count: fmtNumber(locale, recommendations.length) })}</div>
              <ul className="mt-2 space-y-2">
                {recommendations.map((rec) => (
                  <li key={rec.id} className="rounded-lg border bg-white p-3 text-sm">
                    <span className={`rounded px-1.5 py-0.5 text-[11px] font-semibold ${rec.priority === "high" ? "bg-red-100 text-red-700" : rec.priority === "medium" ? "bg-amber-100 text-amber-700" : "bg-slate-100 text-slate-600"}`}>{rec.priority}</span>
                    <div className="mt-1 font-medium">{rec.title}</div>
                    {rec.detail ? <div className="text-slate-500">{rec.detail}</div> : null}
                    <div className="mt-2 flex gap-2">
                      <button className="text-xs font-semibold text-green-600" onClick={() => updateRec(rec.id, "done")}>{t("analytics.reportsRecDone")}</button>
                      <button className="text-xs text-slate-500" onClick={() => updateRec(rec.id, "dismissed")}>{t("analytics.reportsRecDismiss")}</button>
                    </div>
                  </li>
                ))}
              </ul>
            </div>
          ) : null}
        </div>
        <div className="card p-5 lg:col-span-2">
          {selected ? (
            <>
              <div className="mb-3 flex items-center justify-between">
                <div className="font-semibold">{selected.title}</div>
                {selected.provider === "dev-template" ? <span className="rounded bg-amber-100 px-2 py-0.5 text-xs font-semibold text-amber-700">{t("analytics.reportsDevTemplateBadge")}</span> : <span className="rounded bg-green-100 px-2 py-0.5 text-xs font-semibold text-green-700">{selected.provider}</span>}
              </div>
              <Markdown text={selected.content} />
            </>
          ) : <p className="text-sm text-slate-500">{t("analytics.reportsSelectOne")}</p>}
        </div>
      </div>
    </div>
  );
}
