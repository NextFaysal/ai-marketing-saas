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

const QUICK_ACTIONS = [
  { icon: "💳", label: "বিলিং ও পেমেন্ট", sub: "MRR, ওভারডিউ, ম্যানুয়াল পেমেন্ট", href: "/billing" },
  { icon: "💚", label: "Platform Health", sub: "ব্যর্থ Job, ইন্টিগ্রেশন অবস্থা", href: "/health" },
  { icon: "⚙️", label: "Dynamic Config", sub: "LLM, Meta App, SMTP, SSLCommerz", href: "/settings" },
  { icon: "🔐", label: "Security ও 2FA", sub: "Admin তালিকা, সেশন রিভোক", href: "/security" },
];

export default function OverviewPage() {
  const [data, setData] = React.useState<Overview | null>(null);
  const [dbOk, setDbOk] = React.useState<boolean | null>(null);
  const [error, setError] = React.useState("");
  React.useEffect(() => {
    apiFetch<Overview>("/admin/overview").then(setData).catch((e) => setError(e.message));
    apiFetch<{ db: string }>("/admin/health").then((h) => setDbOk(h.db === "ok")).catch(() => setDbOk(false));
  }, []);

  const failedTotal = data ? data.failedSyncJobs24h + data.failedAutomationRuns24h : 0;
  const cards = data ? [
    { icon: "🏢", label: "মোট Organization", value: String(data.organizations), sub: `নতুন (৩০ দিন): ${data.newOrganizations30d}` },
    { icon: "👤", label: "মোট User", value: String(data.users), sub: `নতুন (৩০ দিন): ${data.newUsers30d}` },
    { icon: "🧾", label: "এই মাসের Order", value: String(data.monthOrders), sub: `আয় ${formatMinorStr(data.monthOrderRevenueMinor)} · সব Tenant` },
    { icon: "📣", label: "Ad Spend (Tracked)", value: formatMinorStr(data.monthAdSpendMinor), sub: "এই মাস · Campaign-level, সব Tenant" },
    { icon: "🤖", label: "AI ব্যবহার (এই মাস)", value: `${data.monthAiCalls} কল`, sub: `${data.monthAiTokens.toLocaleString()} টোকেন` },
    { icon: failedTotal > 0 ? "⚠️" : "✅", label: "ব্যর্থ Job (২৪ ঘণ্টা)", value: String(failedTotal), sub: `Sync ${data.failedSyncJobs24h} · Automation ${data.failedAutomationRuns24h}` },
  ] : [];

  const today = new Date().toLocaleDateString("bn-BD", { weekday: "long", day: "numeric", month: "long", year: "numeric" });

  return (
    <AdminShell title="📊 Command Center">
      {/* Hero strip */}
      <div className="acard mb-5 flex flex-wrap items-center gap-4 overflow-hidden !p-5">
        <div className="min-w-0">
          <div className="text-lg font-bold tracking-tight">প্ল্যাটফর্মের আজকের চিত্র</div>
          <div className="mt-0.5 text-sm text-slate-400">{today} · সব সংখ্যা আসল ডেটা থেকে — কোনো অনুমান নয়।</div>
        </div>
        <div className="ml-auto flex flex-wrap items-center gap-2">
          <span className={dbOk === null ? "abadge-slate" : dbOk ? "abadge-green" : "abadge-red"}>
            {dbOk === null ? "Database: যাচাই হচ্ছে…" : dbOk ? "● Database সংযুক্ত" : "● Database সমস্যা"}
          </span>
          <span className="abadge-indigo">● API চলছে</span>
          {data ? (
            <span className={failedTotal > 0 ? "abadge-amber" : "abadge-green"}>
              {failedTotal > 0 ? `⚠ ${failedTotal}টি ব্যর্থ Job (২৪ ঘণ্টা)` : "✓ কোনো ব্যর্থ Job নেই (২৪ ঘণ্টা)"}
            </span>
          ) : null}
        </div>
      </div>

      {error ? <p className="rounded-lg bg-red-500/10 p-3 text-sm text-red-300">{error}</p> : null}

      {/* KPI cards */}
      {!data && !error ? (
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
          {Array.from({ length: 6 }).map((_, i) => <div key={i} className="askel h-[118px]" />)}
        </div>
      ) : (
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
          {cards.map((c) => (
            <div key={c.label} className="astat acard-hover">
              <div className="flex items-center gap-3">
                <span className="astat-icon">{c.icon}</span>
                <div className="text-xs font-medium uppercase tracking-wide text-slate-400">{c.label}</div>
              </div>
              <div className="astat-value">{c.value}</div>
              <div className="mt-1.5 text-xs text-slate-500">{c.sub}</div>
            </div>
          ))}
        </div>
      )}

      <div className="mt-5 grid gap-4 xl:grid-cols-[1.6fr_1fr]">
        {/* Recent admin activity — timeline */}
        <div className="acard">
          <div className="mb-3 flex items-center justify-between">
            <div className="font-semibold">সাম্প্রতিক Admin কার্যকলাপ</div>
            <a className="text-sm font-medium text-indigo-300 hover:text-indigo-200" href="/audit">সব Audit →</a>
          </div>
          {!data ? <p className="text-sm text-slate-500">লোড হচ্ছে…</p>
            : data.recentAdminActions.length === 0 ? <p className="text-sm text-slate-500">এখনো কোনো Admin অ্যাকশন হয়নি।</p> : (
              <ol className="relative space-y-0 border-l border-slate-800 pl-5">
                {data.recentAdminActions.map((a) => (
                  <li key={a.id} className="relative pb-4 last:pb-0">
                    <span className="absolute -left-[23.5px] top-1.5 h-2 w-2 rounded-full bg-indigo-400 ring-4 ring-indigo-400/15" />
                    <div className="flex flex-wrap items-baseline justify-between gap-2">
                      <span className="text-sm font-medium">{a.action}
                        <span className="ml-1.5 font-normal text-slate-500">({a.entityType}{a.entityId ? ` · ${a.entityId.slice(0, 8)}…` : ""})</span>
                      </span>
                      <span className="text-xs text-slate-500">{new Date(a.createdAt).toLocaleString("bn-BD")}</span>
                    </div>
                  </li>
                ))}
              </ol>
            )}
        </div>

        {/* Quick actions + attention */}
        <div className="space-y-4">
          {data && failedTotal > 0 ? (
            <a href="/health" className="acard acard-hover block border-amber-500/40">
              <div className="font-semibold text-amber-300">⚠ মনোযোগ দরকার</div>
              <p className="mt-1 text-sm text-slate-400">গত ২৪ ঘণ্টায় {failedTotal}টি Job ব্যর্থ হয়েছে (Sync {data.failedSyncJobs24h} · Automation {data.failedAutomationRuns24h})। Health পেজে গিয়ে Retry করুন।</p>
            </a>
          ) : data ? (
            <div className="acard border-emerald-500/30">
              <div className="font-semibold text-emerald-300">✅ সব ঠিকঠাক চলছে</div>
              <p className="mt-1 text-sm text-slate-400">গত ২৪ ঘণ্টায় কোনো Sync বা Automation Job ব্যর্থ হয়নি।</p>
            </div>
          ) : null}
          <div className="acard">
            <div className="mb-3 font-semibold">দ্রুত কাজ</div>
            <div className="grid gap-2">
              {QUICK_ACTIONS.map((qa) => (
                <a key={qa.href} href={qa.href} className="flex items-center gap-3 rounded-xl border border-slate-800 bg-slate-900/60 px-3.5 py-3 transition hover:border-indigo-500/50 hover:bg-slate-800/70">
                  <span className="text-lg">{qa.icon}</span>
                  <span className="min-w-0">
                    <span className="block truncate text-sm font-medium">{qa.label}</span>
                    <span className="block truncate text-xs text-slate-500">{qa.sub}</span>
                  </span>
                  <span className="ml-auto text-slate-500">→</span>
                </a>
              ))}
            </div>
          </div>
        </div>
      </div>
    </AdminShell>
  );
}
