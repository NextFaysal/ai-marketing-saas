"use client";
import React from "react";
import AdminShell from "@/components/AdminShell";
import { apiFetch, formatMinorStr } from "@/lib/api";

interface Overview {
  organizations: number; users: number; newOrganizations30d: number; newUsers30d: number;
  monthOrders: number; monthOrderRevenueMinor: string; monthAdSpendMinor: string;
  monthAiCalls: number; monthAiTokens: number; failedSyncJobs24h: number; failedAutomationRuns24h: number;
  recentAdminActions: { id: string; action: string; entityType: string; entityId?: string | null; createdAt: string }[];
}

export default function OverviewPage() {
  const [data, setData] = React.useState<Overview | null>(null);
  const [error, setError] = React.useState("");
  React.useEffect(() => { apiFetch<Overview>("/admin/overview").then(setData).catch((e) => setError(e.message)); }, []);
  const cards = data ? [
    { label: "মোট Organization", value: String(data.organizations), sub: `নতুন (৩০ দিন): ${data.newOrganizations30d}` },
    { label: "মোট User", value: String(data.users), sub: `নতুন (৩০ দিন): ${data.newUsers30d}` },
    { label: "এই মাসের Order", value: String(data.monthOrders), sub: `আয় ${formatMinorStr(data.monthOrderRevenueMinor)} (সব Tenant মিলিয়ে)` },
    { label: "এই মাসের Ad Spend (Tracked)", value: formatMinorStr(data.monthAdSpendMinor), sub: "Campaign-level, সব Tenant" },
    { label: "AI ব্যবহার (এই মাস)", value: `${data.monthAiCalls} কল`, sub: `${data.monthAiTokens.toLocaleString()} টোকেন` },
    { label: "ব্যর্থ Job (২৪ ঘণ্টা)", value: String(data.failedSyncJobs24h + data.failedAutomationRuns24h), sub: `Sync ${data.failedSyncJobs24h} · Automation ${data.failedAutomationRuns24h}` },
  ] : [];
  return (
    <AdminShell title="📊 Command Center">
      {error ? <p className="rounded-lg bg-red-500/10 p-3 text-sm text-red-300">{error}</p> : null}
      {!data && !error ? <p className="text-slate-400">লোড হচ্ছে…</p> : null}
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {cards.map((c) => (
          <div key={c.label} className="acard">
            <div className="text-xs uppercase tracking-wide text-slate-400">{c.label}</div>
            <div className="mt-1 text-2xl font-bold">{c.value}</div>
            <div className="mt-0.5 text-xs text-slate-500">{c.sub}</div>
          </div>
        ))}
      </div>
      {data && (
        <div className="acard mt-6">
          <div className="mb-2 font-semibold">সাম্প্রতিক Admin কার্যকলাপ</div>
          {data.recentAdminActions.length === 0 ? <p className="text-sm text-slate-500">এখনো কোনো Admin অ্যাকশন হয়নি।</p> : (
            <ul className="space-y-1.5 text-sm">
              {data.recentAdminActions.map((a) => <li key={a.id} className="flex justify-between gap-3 border-b border-slate-800 pb-1.5"><span>{a.action} <span className="text-slate-500">({a.entityType}{a.entityId ? ` · ${a.entityId.slice(0, 8)}…` : ""})</span></span><span className="text-slate-500">{new Date(a.createdAt).toLocaleString("bn-BD")}</span></li>)}
            </ul>
          )}
        </div>
      )}
    </AdminShell>
  );
}
