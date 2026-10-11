"use client";
import React, { useCallback, useEffect, useState } from "react";
import { apiFetch } from "@/lib/api";
import { getOrganizationId } from "@/lib/org";
import { Markdown } from "@/components/markdown";
import { EmptyState } from "@repo/ui";

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
    if (!orgId) { setError("কোনো Organization নির্বাচিত নেই।"); return; }
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
          <p className="text-sm text-slate-500">AI Report শুধু যাচাইকৃত ডেটা দিয়ে তৈরি হয়। কোন ডেটা নেই তাও রিপোর্টে লেখা থাকে। সম্ভাব্য কারণ সবসময় Hypothesis হিসেবে লেবেল করা হয়, প্রমাণ হিসেবে নয়।</p>
        </div>
        <div className="flex gap-2">
          {(["daily", "weekly", "monthly"] as const).map((t) => (
            <button key={t} className="btn-primary btn-sm disabled:opacity-50" disabled={busy !== ""} onClick={() => generate(t)}>
              {busy === t ? "তৈরি হচ্ছে..." : t === "daily" ? "আজকের (গতকালের ডেটা) রিপোর্ট" : t === "weekly" ? "সাপ্তাহিক রিপোর্ট" : "মাসিক রিপোর্ট"}
            </button>
          ))}
        </div>
      </div>
      {error ? <p className="rounded-lg bg-red-50 p-3 text-sm text-red-700">{error}</p> : null}

      {center ? (
        <div className="card p-5">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="font-semibold">Report Center — সব রিপোর্ট এক জায়গায়</div>
            <div className="text-xs text-slate-500">
              ডেটা হালনাগাদ: Store Sync {center.freshness.storeLastSyncAt ? new Date(center.freshness.storeLastSyncAt).toLocaleString() : "কখনো হয়নি"} · Ads ডেটা {center.freshness.latestAdMetricDate ? new Date(center.freshness.latestAdMetricDate).toLocaleDateString() : "নেই"} · শেষ Order {center.freshness.latestOrderAt ? new Date(center.freshness.latestOrderAt).toLocaleString() : "নেই"}
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
            <span>সক্রিয় Client Report Link: <strong className="text-slate-700">{center.shares.activeCount}</strong></span>
            {center.jobs.length > 0 ? <span>Report Job: {center.jobs.map((j) => `${j.name} (${j.enabled ? "চালু" : "বন্ধ"}${j.lastRunAt ? `, শেষ: ${new Date(j.lastRunAt).toLocaleDateString()}` : ""})`).join(" · ")}</span> : <span>কোনো Report Job নেই — Automations থেকে তৈরি করুন।</span>}
          </div>
        </div>
      ) : null}

      {exec ? (
        <div className="card p-5">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="font-semibold">Executive Summary — শেষ ৩০ দিন</div>
            <div className="text-xs text-slate-500">{exec.range.from} → {exec.range.to}</div>
          </div>
          <div className="mt-3 grid gap-3 sm:grid-cols-2 lg:grid-cols-4 text-sm">
            <div className="rounded-lg bg-slate-50 p-3"><div className="text-xs text-slate-400">Revenue</div><div className="mt-0.5 font-bold">{(Number(BigInt(exec.sales.revenueMinor)) / 100).toLocaleString("en-US", { minimumFractionDigits: 2 })} ৳</div><div className="text-xs text-slate-500">{exec.sales.orders}টি অর্ডার</div></div>
            <div className="rounded-lg bg-slate-50 p-3"><div className="text-xs text-slate-400">Contribution Profit</div><div className="mt-0.5 font-bold">{(Number(BigInt(exec.sales.profit.contributionProfitMinor)) / 100).toLocaleString("en-US", { minimumFractionDigits: 2 })} ৳</div><div className="text-xs text-slate-500">Margin {exec.sales.profit.contributionMarginPercent ?? "—"}%</div></div>
            <div className="rounded-lg bg-slate-50 p-3"><div className="text-xs text-slate-400">Ad Spend</div><div className="mt-0.5 font-bold">{(Number(BigInt(exec.ads.spendMinor)) / 100).toLocaleString("en-US", { minimumFractionDigits: 2 })} ৳</div><div className="text-xs text-slate-500">{exec.ads.platformConversions}টি platform conversion</div></div>
            <div className="rounded-lg bg-slate-50 p-3"><div className="text-xs text-slate-400">Customer</div><div className="mt-0.5 font-bold">{exec.customers.newInRange} নতুন</div><div className="text-xs text-slate-500">অর্ডারসহ মোট {exec.customers.withOrders} · সেরা Segment: {Object.entries(exec.customers.segments).sort((a, b) => b[1] - a[1])[0]?.[0] ?? "—"}</div></div>
          </div>
          <div className="mt-3 grid gap-4 text-sm lg:grid-cols-2">
            <div>
              <div className="font-medium">Top Campaign</div>
              {exec.ads.topCampaigns.length === 0 ? <p className="text-slate-500">কোনো Campaign ডেটা নেই।</p> : (
                <ul className="mt-1 space-y-1">{exec.ads.topCampaigns.map((c, i) => <li key={i} className="flex justify-between gap-2"><span>{c.name}</span><span className="text-slate-500">{(Number(BigInt(c.spendMinor)) / 100).toLocaleString()} ৳ · {c.conversions} conv.</span></li>)}</ul>
              )}
            </div>
            <div>
              <div className="font-medium">Top Product</div>
              {exec.operations.topProducts.length === 0 ? <p className="text-slate-500">কোনো Product বিক্রি নেই।</p> : (
                <ul className="mt-1 space-y-1">{exec.operations.topProducts.map((p, i) => <li key={i} className="flex justify-between gap-2"><span>{p.name}</span><span className="text-slate-500">{p.quantity}টি · {(Number(BigInt(p.totalMinor)) / 100).toLocaleString()} ৳</span></li>)}</ul>
              )}
            </div>
          </div>
        </div>
      ) : null}

      {anomalies ? (
        <div className="card p-5">
          <div className="font-semibold">Anomaly (শেষ ১৪ দিন)</div>
          {!anomalies.sufficientData ? <p className="mt-1 text-sm text-slate-500">ডেটা কম থাকায় নির্ভরযোগ্য Anomaly বলা যাচ্ছে না। {anomalies.note ?? ""}</p>
            : anomalies.anomalies.length === 0 ? <p className="mt-1 text-sm text-slate-500">কোনো বড় অস্বাভাবিকতা ধরা পড়েনি।</p>
            : <ul className="mt-2 space-y-1">{anomalies.anomalies.map((a, i) => <li key={i} className="text-sm"><span className={`rounded px-2 py-0.5 text-xs font-semibold ${a.severity === "critical" ? "bg-red-100 text-red-700" : "bg-amber-100 text-amber-700"}`}>{a.severity}</span> <span className="ml-1">{a.message}</span></li>)}</ul>}
        </div>
      ) : null}

      <div className="grid gap-4 lg:grid-cols-3">
        <div className="space-y-2">
          <div className="font-semibold">আগের রিপোর্ট</div>
          {reports.length === 0 ? <EmptyState title="এখনো কোনো রিপোর্ট নেই" description="উপরের বাটন দিয়ে প্রথম রিপোর্ট তৈরি করুন।" /> : reports.map((r) => (
            <button key={r.id} onClick={() => setSelected(r)} className={`block w-full rounded-lg border bg-white px-3 py-2 text-left text-sm ${selected?.id === r.id ? "border-blue-500" : ""}`}>
              <div className="font-medium">{r.title}</div>
              <div className="text-xs text-slate-400">{r.type} · v{r.version} · {new Date(r.createdAt).toLocaleString()} · {r.provider === "dev-template" ? "Dev Template" : r.provider}</div>
            </button>
          ))}
          {recommendations.length > 0 ? (
            <div className="pt-2">
              <div className="font-semibold">খোলা পরামর্শ ({recommendations.length})</div>
              <ul className="mt-2 space-y-2">
                {recommendations.map((rec) => (
                  <li key={rec.id} className="rounded-lg border bg-white p-3 text-sm">
                    <span className={`rounded px-1.5 py-0.5 text-[11px] font-semibold ${rec.priority === "high" ? "bg-red-100 text-red-700" : rec.priority === "medium" ? "bg-amber-100 text-amber-700" : "bg-slate-100 text-slate-600"}`}>{rec.priority}</span>
                    <div className="mt-1 font-medium">{rec.title}</div>
                    {rec.detail ? <div className="text-slate-500">{rec.detail}</div> : null}
                    <div className="mt-2 flex gap-2">
                      <button className="text-xs font-semibold text-green-600" onClick={() => updateRec(rec.id, "done")}>হয়ে গেছে</button>
                      <button className="text-xs text-slate-500" onClick={() => updateRec(rec.id, "dismissed")}>বাদ দিন</button>
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
                {selected.provider === "dev-template" ? <span className="rounded bg-amber-100 px-2 py-0.5 text-xs font-semibold text-amber-700">Dev Template (আসল LLM নয়)</span> : <span className="rounded bg-green-100 px-2 py-0.5 text-xs font-semibold text-green-700">{selected.provider}</span>}
              </div>
              <Markdown text={selected.content} />
            </>
          ) : <p className="text-sm text-slate-500">একটি রিপোর্ট নির্বাচন করুন বা নতুন তৈরি করুন।</p>}
        </div>
      </div>
    </div>
  );
}
