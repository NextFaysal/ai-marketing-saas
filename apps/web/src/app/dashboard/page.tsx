"use client";
import React, { useEffect, useState } from "react";
import Link from "next/link";
import { apiFetch } from "@/lib/api";
import { getOrganizationId } from "@/lib/org";
import { formatMinor } from "@repo/contracts";
import { KpiCard } from "@repo/ui";
import type { Overview } from "@/components/analytics-shared";

interface ReportLite { id: string; title: string; provider: string; createdAt: string }
interface AnomalyResult { anomalies: { severity: string; message: string }[]; sufficientData: boolean }
interface OnboardingState { steps: { key: string; label: string; done: boolean; href: string }[]; completed: number; total: number; allDone: boolean }

function OnboardingCard() {
  const [state, setState] = useState<OnboardingState | null>(null);
  useEffect(() => {
    const orgId = getOrganizationId();
    if (!orgId) return;
    apiFetch<OnboardingState>(`/organizations/${orgId}/onboarding`).then(setState).catch(() => undefined);
  }, []);
  if (!state || state.allDone) return null;
  return (
    <div className="card border-indigo-200 bg-indigo-50/60 p-5">
      <div className="flex items-center justify-between">
        <div className="font-semibold">🚀 শুরু করার চেকলিস্ট</div>
        <span className="badge-brand">{state.completed}/{state.total} সম্পন্ন</span>
      </div>
      <div className="mt-3 grid gap-2 sm:grid-cols-2">
        {state.steps.map((s) => (
          <a key={s.key} href={s.href} className={`flex items-center gap-2 rounded-lg px-3 py-2 text-sm ring-1 ${s.done ? "bg-white/60 text-slate-500 ring-emerald-200" : "bg-white font-medium text-slate-800 ring-indigo-100 hover:ring-indigo-300"}`}>
            <span>{s.done ? "✅" : "⬜"}</span>
            <span className={s.done ? "line-through decoration-slate-300" : ""}>{s.label}</span>
          </a>
        ))}
      </div>
      <p className="mt-3 text-xs text-slate-500">প্রতিটি ধাপ আসল ডেটা থেকে যাচাই করা — কাজ শেষ হলেই টিক নিজে নিজে পড়ে।</p>
    </div>
  );
}

export default function OverviewPage() {
  const [data, setData] = useState<Overview | null>(null);
  const [report, setReport] = useState<ReportLite | null>(null);
  const [anomalies, setAnomalies] = useState<AnomalyResult | null>(null);
  const [error, setError] = useState("");

  useEffect(() => {
    const orgId = getOrganizationId();
    if (!orgId) { setError("প্রথমে একটি Organization বেছে নিন বা তৈরি করুন।"); return; }
    const to = new Date(); const from = new Date(Date.now() - 6 * 86400000);
    const f = (d: Date) => d.toISOString().slice(0, 10);
    apiFetch<Overview>(`/organizations/${orgId}/analytics/overview?from=${f(from)}&to=${f(to)}`).then(setData).catch((e) => setError(e instanceof Error ? e.message : "Failed"));
    apiFetch<ReportLite[]>(`/organizations/${orgId}/ai/reports`).then((r) => setReport(r[0] ?? null)).catch(() => undefined);
    apiFetch<AnomalyResult>(`/organizations/${orgId}/ai/anomalies?days=14`).then(setAnomalies).catch(() => undefined);
  }, []);

  const money = (minor: string) => formatMinor(BigInt(minor));
  return (
    <div className="space-y-6">
      <div>
        <h1 className="page-title">Overview</h1>
        <p className="text-sm text-slate-500">শেষ ৭ দিনের সারসংক্ষেপ, আসল ডেটা থেকে। ডেটা না থাকলে সংখ্যার বদলে সেটাই দেখানো হয়।</p>
      </div>
      {error ? <p className="rounded-lg bg-red-50 p-3 text-sm text-red-700">{error}</p> : null}
      <OnboardingCard />
      {data ? (
        <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
          <KpiCard label="Revenue (৭ দিন)" value={money(data.totals.revenueMinor)} hint={`${data.totals.orders}টি অর্ডার`} />
          <KpiCard label="Ad Spend" value={money(data.totals.adSpendMinor)} />
          <KpiCard label="MER" value={data.kpis.mer === null ? "—" : String(data.kpis.mer)} hint="Revenue / Spend" />
          <KpiCard label="Contribution Profit" value={money(data.profit.contributionProfitMinor)} hint={`COGS Coverage ${data.profit.cogsCoverage.percent}%`} />
        </div>
      ) : !error ? <p className="text-sm text-slate-500">লোড হচ্ছে...</p> : null}

      <div className="grid gap-4 lg:grid-cols-2">
        <div className="card p-5">
          <div className="flex items-center justify-between">
            <div className="font-semibold">সর্বশেষ AI Report</div>
            <Link className="text-sm font-semibold text-blue-600" href="/dashboard/reports">Reports →</Link>
          </div>
          {report ? (
            <div className="mt-2 text-sm">
              <div className="font-medium">{report.title}</div>
              <div className="text-slate-400">{new Date(report.createdAt).toLocaleString()} · {report.provider === "dev-template" ? "Dev Template" : report.provider}</div>
            </div>
          ) : <p className="mt-2 text-sm text-slate-500">এখনো কোনো রিপোর্ট তৈরি হয়নি। Reports পেজ থেকে প্রথমটি বানান।</p>}
        </div>
        <div className="card p-5">
          <div className="flex items-center justify-between">
            <div className="font-semibold">Anomaly</div>
            <Link className="text-sm font-semibold text-blue-600" href="/dashboard/ai">AI Assistant →</Link>
          </div>
          {anomalies ? (
            anomalies.sufficientData ? (
              anomalies.anomalies.length ? (
                <ul className="mt-2 space-y-1">{anomalies.anomalies.map((a, i) => <li key={i} className="text-sm">[{a.severity}] {a.message}</li>)}</ul>
              ) : <p className="mt-2 text-sm text-slate-500">কোনো বড় অস্বাভাবিকতা ধরা পড়েনি।</p>
            ) : <p className="mt-2 text-sm text-slate-500">ডেটা কম থাকায় নির্ভরযোগ্য Anomaly বলা যাচ্ছে না।</p>
          ) : <p className="mt-2 text-sm text-slate-500">যাচাই করা যাচ্ছে না।</p>}
        </div>
      </div>
    </div>
  );
}
