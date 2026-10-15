"use client";
import React from "react";
import AdminShell from "@/components/AdminShell";
import { Chart, DataTable, EmptyState, ErrorState, PageHead, toast } from "@/components/ui";
import { apiFetch, formatMinorStr } from "@/lib/api";

interface SeriesMonth { month: string; collectedMinor: string; newOrgs: number; newUsers: number; newSubscriptions: number; orders: number; orderRevenueMinor: string }
interface Series { months: SeriesMonth[]; current: { mrrMinor: string; activeSubscriptions: number; trialing: number; pastDue: number; organizationsWithSubscription: number; paidOrganizations: number; paidSharePercent: number | null } }
interface Tenant { organizationId: string; name: string; plan: string | null; subscriptionStatus: string | null; members: number; orders30d: number; orderRevenue30dMinor: string; aiTokens30d: number; collectedTotalMinor: string }
interface Health { organizationId: string; name: string; score: number; band: string; plan: string | null; subscriptionStatus: string | null; daysIdle: number; deductions: { reason: string; points: number }[] }
interface AiRow { organizationId: string; organizationName: string; provider: string; calls: number; tokens: number; estimatedTokens: number; rateMinorPerMillion: number | null; estimatedCostMinor: number | null }
interface AiCost { rates: Record<string, number>; rows: AiRow[]; note: string }

export default function AnalyticsPage() {
  const [series, setSeries] = React.useState<Series | null>(null);
  const [tenants, setTenants] = React.useState<Tenant[]>([]);
  const [health, setHealth] = React.useState<Health[]>([]);
  const [ai, setAi] = React.useState<AiCost | null>(null);
  const [busy, setBusy] = React.useState(false);
  // ADX11: period window — verdict: the series endpoint is
  // month-bucketed (GET /admin/analytics/series?months=N); there is
  // NO day-level (৭/৩০/৯০ দিন) data in it, so the selector is a
  // client-side window over the already-loaded monthly series,
  // labelled as such below. No buckets are fabricated.
  const [win, setWin] = React.useState(12);

  // ADX12: loadDone distinguishes "still loading" from "the
  // series fetch failed" — before, a failed series fetch left the
  // KPI skeletons spinning forever.
  const [loadDone, setLoadDone] = React.useState(false);
  const load = React.useCallback(async () => {
    setLoadDone(false);
    const [s, t, h, a] = await Promise.all([
      apiFetch<Series>("/admin/analytics/series?months=12").catch(() => null),
      apiFetch<Tenant[]>("/admin/analytics/top-tenants?limit=10").catch(() => []),
      apiFetch<{ scores: Health[] }>("/admin/analytics/health-scores").catch(() => ({ scores: [] })),
      apiFetch<AiCost>("/admin/analytics/ai-cost").catch(() => null),
    ]);
    if (s) setSeries(s);
    setTenants(t); setHealth(h.scores); setAi(a);
    setLoadDone(true);
  }, []);
  React.useEffect(() => { load(); }, [load]);

  async function saveRates() {
    if (!ai) return;
    const rates: Record<string, number> = {};
    for (const provider of Object.keys(ai.rates).concat(ai.rows.map((r) => r.provider))) {
      const el = document.getElementById(`rate-${provider}`) as HTMLInputElement | null;
      if (!el) continue;
      const taka = Number(el.value);
      if (Number.isFinite(taka) && taka > 0) rates[provider] = Math.round(taka * 100);
    }
    setBusy(true);
    try {
      setAi(await apiFetch<AiCost>("/admin/analytics/ai-rates", { method: "PATCH", body: JSON.stringify({ rates }) }));
      toast("AI Rate সেভ হয়েছে — আনুমানিক খরচ এখন থেকে দেখা যাবে।");
    } catch (e) { toast(e instanceof Error ? e.message : "সেভ হয়নি", "error"); }
    finally { setBusy(false); }
  }

  const months = series ? series.months.slice(-win) : [];
  const providers = ai ? [...new Set([...Object.keys(ai.rates), ...ai.rows.map((r) => r.provider)])] : [];
  const bandBadge = (band: string) => band === "good" ? "abadge-green" : band === "watch" ? "abadge-amber" : "abadge-red";

  return (
    <AdminShell title="💹 Platform Analytics">
      <PageHead sub="MRR, Tenant Ranking, Health Score ও AI খরচ — আসল ডেটা থেকে।" />

      {!series && loadDone ? <div className="mb-4"><ErrorState message="Analytics Series লোড হয়নি — KPI ও চার্ট দেখানো যাচ্ছে না।" onRetry={load} /></div> : null}
      {!series && !loadDone ? <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">{Array.from({ length: 4 }).map((_, i) => <div key={i} className="askel h-[104px]" />)}</div> : !series ? null : (
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
          {[
            { icon: "💰", label: "বর্তমান MRR", value: formatMinorStr(series.current.mrrMinor), sub: `${series.current.activeSubscriptions}টি ACTIVE সাবস্ক্রিপশন` },
            { icon: "🏢", label: "Paid Organization", value: String(series.current.paidOrganizations), sub: `মোট ${series.current.organizationsWithSubscription}টির মধ্যে · Paid Share ${series.current.paidSharePercent ?? "—"}%` },
            { icon: "⏳", label: "Trialing", value: String(series.current.trialing), sub: "বর্তমানে ট্রায়ালে আছে" },
            { icon: "⛔", label: "Past Due", value: String(series.current.pastDue), sub: "মেয়াদ পেরিয়েছে — Dunning দরকার" },
          ].map((c) => (
            <div key={c.label} className="astat acard-hover">
              <div className="flex items-center gap-3"><span className="astat-icon">{c.icon}</span><div className="text-xs font-medium uppercase tracking-wide text-slate-400">{c.label}</div></div>
              <div className="astat-value">{c.value}</div>
              <div className="mt-1.5 text-xs text-slate-400">{c.sub}</div>
            </div>
          ))}
        </div>
      )}

      {series ? (
        <>
          {/* ADNX12: the time-range (window) selector is sticky so
              it stays reachable while the chart + tables scroll. */}
          <div className="sticky top-0 z-20 -mx-1 mt-5 bg-slate-950/90 px-1 py-2 backdrop-blur">
            <div className="flex flex-wrap items-center gap-2">
              <span className="text-sm font-medium">সময়-পরিসর</span>
              <span className="ml-auto flex gap-1.5">
                {[3, 6, 12].map((n) => (
                  <button key={n} type="button" onClick={() => setWin(n)} className={win === n ? "abtn !px-2.5 !py-1 text-xs" : "abtn-secondary !px-2.5 !py-1 text-xs"}>শেষ {n} মাস</button>
                ))}
              </span>
            </div>
          </div>
          <div className="acard">
            <div className="mb-1 font-semibold">মাসভিত্তিক চিত্র (শেষ {win} মাস)</div>
            <p className="mb-3 text-xs text-slate-400">বার = সংগৃহীত পেমেন্ট (আসল SaasPayment রেকর্ড থেকে)। Paid Share একটি বর্তমান Snapshot অনুপাত — Cohort Conversion নয়। সময়-বাছাইটি লোড করা মাসিক Series-এর ওপরের Window — এই Endpoint-এ দিনভিত্তিক (৭/৩০/৯০ দিন) হিসাব নেই, তাই তা বানানো হয়নি।</p>
            {/* ADNX12: the hand-rolled bar rows are replaced by the
                ADNX5 Chart (bar variant, same loaded series data,
                exact-value readout + data-table fallback). */}
            <Chart variant="bar" seriesLabel="সংগৃহীত পেমেন্ট" points={months.map((m) => ({ label: m.month, value: Number(m.collectedMinor) }))} formatValue={(v) => formatMinorStr(String(v))} />
            <div className="mt-4">
              <DataTable>
                <thead><tr><th className="ath">মাস</th><th className="ath">সংগ্রহ</th><th className="ath">নতুন Org</th><th className="ath">নতুন User</th><th className="ath">নতুন Subscription</th><th className="ath">Tenant Order</th><th className="ath">Tenant আয়</th></tr></thead>
                <tbody>
                  {[...months].reverse().map((m) => (
                    <tr key={m.month}>
                      <td data-label="মাস" className="atd font-medium">{m.month}</td><td data-label="সংগ্রহ" className="atd">{formatMinorStr(m.collectedMinor)}</td>
                      <td data-label="নতুন Org" className="atd">{m.newOrgs}</td><td data-label="নতুন User" className="atd">{m.newUsers}</td><td data-label="নতুন Subscription" className="atd">{m.newSubscriptions}</td>
                      <td data-label="Tenant Order" className="atd">{m.orders}</td><td data-label="Tenant আয়" className="atd">{formatMinorStr(m.orderRevenueMinor)}</td>
                    </tr>
                  ))}
                </tbody>
              </DataTable>
            </div>
          </div>
        </>
      ) : null}

      <div className="mt-5 grid gap-4 xl:grid-cols-2">
        <div className="acard">
          <div className="mb-3 font-semibold">🏆 Top Tenant (শেষ ৩০ দিনের আয় অনুযায়ী)</div>
          {tenants.length === 0 ? <EmptyState title="কোনো Tenant নেই।" /> : (
              <DataTable>
                <thead><tr><th className="ath">Organization</th><th className="ath">প্ল্যান</th><th className="ath">Order</th><th className="ath">আয় (৩০দিন)</th><th className="ath">AI টোকেন</th><th className="ath">মোট সংগ্রহ</th></tr></thead>
                <tbody>
                  {tenants.map((t) => (
                    <tr key={t.organizationId}>
                      <td data-label="Organization" className="atd"><a className="font-medium text-indigo-300 hover:text-indigo-200" href={`/orgs/${t.organizationId}`}>{t.name}</a><div className="text-xs text-slate-400">সদস্য {t.members}</div></td>
                      <td data-label="প্ল্যান" className="atd">{t.plan ? <span className="abadge-indigo">{t.plan}</span> : "—"}</td>
                      <td data-label="Order" className="atd">{t.orders30d}</td>
                      <td data-label="আয় (৩০দিন)" className="atd">{formatMinorStr(t.orderRevenue30dMinor)}</td>
                      <td data-label="AI টোকেন" className="atd">{t.aiTokens30d.toLocaleString()}</td>
                      <td data-label="মোট সংগ্রহ" className="atd">{formatMinorStr(t.collectedTotalMinor)}</td>
                    </tr>
                  ))}
                </tbody>
              </DataTable>
          )}
        </div>

        <div className="acard">
          <div className="mb-1 font-semibold">❤️ Tenant Health Score <span className="abadge-slate">Heuristic</span></div>
          <p className="mb-3 text-xs text-slate-400">স্কোর একটি Triage সাহায্য — প্রতিটি কাটা পয়েন্টের কারণ দেখানো আছে। সবচেয়ে ঝুঁকিতে থাকা Tenant আগে।</p>
          {health.length === 0 ? <EmptyState title="কোনো Tenant নেই।" /> : (
            <div className="space-y-2.5">
              {health.slice(0, 10).map((h) => (
                <div key={h.organizationId} className="rounded-xl border border-slate-800 bg-slate-900/60 px-3.5 py-3">
                  <div className="flex flex-wrap items-center gap-2">
                    <a className="font-medium text-indigo-300 hover:text-indigo-200" href={`/orgs/${h.organizationId}`}>{h.name}</a>
                    <span className={bandBadge(h.band)}>{h.score}/100 · {h.band}</span>
                    <span className="text-xs text-slate-400">{h.plan ?? "—"} · {h.subscriptionStatus ?? "—"} · নিষ্ক্রিয় {h.daysIdle} দিন</span>
                  </div>
                  {h.deductions.length > 0 ? (
                    <div className="mt-1.5 flex flex-wrap gap-1.5">
                      {h.deductions.map((d, i) => <span key={i} className="abadge-slate">−{d.points} {d.reason}</span>)}
                    </div>
                  ) : <div className="mt-1 text-xs text-emerald-300">কোনো সমস্যা ধরা পড়েনি</div>}
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      <div className="acard mt-5">
        <div className="mb-1 font-semibold">🤖 AI খরচ (আনুমানিক)</div>
        <p className="mb-3 text-xs text-slate-400">{ai?.note ?? "টোকেন আসল AIUsageRecord থেকে। Provider Rate সেট না করলে টাকার হিসাব দেখানো হয় না — Dev Adapter এর Estimated টোকেন খরচে ধরা হয় না।"}</p>
        {providers.length > 0 ? (
          <div className="mb-4 flex flex-wrap items-end gap-2">
            {providers.map((provider) => (
              <label key={provider} className="text-sm">{provider} — ৳ / 1M টোকেন
                <input id={`rate-${provider}`} type="number" min="0" step="any" className="ainput mt-1 w-40" defaultValue={ai?.rates[provider] != null ? ai.rates[provider] / 100 : ""} placeholder="Rate নেই" />
              </label>
            ))}
            <button className="abtn" disabled={busy} onClick={saveRates}>Rate সেভ করুন</button>
          </div>
        ) : null}
        {!ai || ai.rows.length === 0 ? <EmptyState title="শেষ ৩০ দিনে কোনো AI ব্যবহার নেই।" /> : (
            <DataTable>
              <thead><tr><th className="ath">Organization</th><th className="ath">Provider</th><th className="ath">কল</th><th className="ath">টোকেন (আসল)</th><th className="ath">টোকেন (Estimated)</th><th className="ath">আনুমানিক খরচ</th></tr></thead>
              <tbody>
                {ai.rows.map((r) => (
                  <tr key={`${r.organizationId}-${r.provider}`}>
                    <td data-label="Organization" className="atd font-medium">{r.organizationName}</td>
                    <td data-label="Provider" className="atd">{r.provider}</td>
                    <td data-label="কল" className="atd">{r.calls}</td>
                    <td data-label="টোকেন (আসল)" className="atd">{r.tokens.toLocaleString()}</td>
                    <td data-label="টোকেন (Estimated)" className="atd">{r.estimatedTokens.toLocaleString()}</td>
                    <td data-label="আনুমানিক খরচ" className="atd">{r.estimatedCostMinor != null ? formatMinorStr(String(r.estimatedCostMinor)) : <span className="text-slate-400">Rate সেট নেই</span>}</td>
                  </tr>
                ))}
              </tbody>
            </DataTable>
        )}
      </div>

      <OnboardingBoard />
    </AdminShell>
  );
}

interface OnboardingRow {
  organizationId: string; organizationName: string; plan: string | null; subscriptionStatus: string | null;
  completed: number; total: number; stuckAt: string | null;
  steps: { key: string; label: string; done: boolean }[];
}

function OnboardingBoard() {
  const [rows, setRows] = React.useState<OnboardingRow[] | null>(null);
  // ADNX12: a failed board load is no longer indistinguishable
  // from "no organizations" — it gets its own error state + retry.
  const [loadError, setLoadError] = React.useState("");
  const load = React.useCallback(async () => {
    setLoadError("");
    try { setRows(await apiFetch<OnboardingRow[]>("/admin/onboarding-board")); }
    catch (e) { setRows(null); setLoadError(e instanceof Error ? e.message : "Onboarding Board লোড ব্যর্থ হয়েছে"); }
  }, []);
  React.useEffect(() => { load(); }, [load]);
  return (
    <div className="acard">
      <div className="mb-1 font-semibold">🚀 Onboarding Funnel — কোন Org কোন ধাপে আটকে আছে</div>
      <p className="mb-3 text-sm text-slate-400">৭ ধাপের চেকলিস্ট (আসল ডেটা থেকে)। আটকে থাকা Org কে Org পেজ থেকে View-As করে সাহায্য করুন, অথবা Alerts পেজ থেকে Onboarding Nudge পাঠান।</p>
      {loadError ? <ErrorState message={`Onboarding Board লোড হয়নি: ${loadError}`} onRetry={load} />
        : rows === null ? <div className="askel-table" />
        : rows.length === 0 ? <EmptyState title="কোনো Organization নেই।" /> : (
          <div className="overflow-x-auto">
            <table className="atable">
              <thead><tr><th className="ath">Organization</th><th className="ath">প্ল্যান</th><th className="ath">অগ্রগতি</th><th className="ath">আটকে আছে</th><th className="ath">ধাপসমূহ</th></tr></thead>
              <tbody>
                {rows.map((r) => (
                  <tr key={r.organizationId}>
                    <td className="atd font-medium"><a href={`/orgs/${r.organizationId}`}>{r.organizationName}</a></td>
                    <td className="atd">{r.plan ?? "—"} {r.subscriptionStatus ? `· ${r.subscriptionStatus}` : ""}</td>
                    <td className="atd">
                      <div className="flex items-center gap-2">
                        <div className="h-2 w-24 overflow-hidden rounded bg-slate-800"><div className="h-full bg-gradient-to-r from-indigo-500 to-violet-500" style={{ width: `${(r.completed / r.total) * 100}%` }} /></div>
                        <span>{r.completed}/{r.total}</span>
                      </div>
                    </td>
                    <td className="atd">{r.stuckAt ?? <span className="text-emerald-400">✅ সম্পূর্ণ</span>}</td>
                    <td className="atd"><span className="flex flex-wrap gap-1">{r.steps.map((s) => <span key={s.key} className="abadge" style={s.done ? {} : { opacity: 0.45 }}>{s.done ? "✓" : "○"} {s.label}</span>)}</span></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
    </div>
  );
}
