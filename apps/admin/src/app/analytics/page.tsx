"use client";
import React from "react";
import AdminShell from "@/components/AdminShell";
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
  const [msg, setMsg] = React.useState("");
  const [busy, setBusy] = React.useState(false);

  const load = React.useCallback(async () => {
    const [s, t, h, a] = await Promise.all([
      apiFetch<Series>("/admin/analytics/series?months=12").catch(() => null),
      apiFetch<Tenant[]>("/admin/analytics/top-tenants?limit=10").catch(() => []),
      apiFetch<{ scores: Health[] }>("/admin/analytics/health-scores").catch(() => ({ scores: [] })),
      apiFetch<AiCost>("/admin/analytics/ai-cost").catch(() => null),
    ]);
    if (s) setSeries(s);
    setTenants(t); setHealth(h.scores); setAi(a);
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
    setBusy(true); setMsg("");
    try {
      setAi(await apiFetch<AiCost>("/admin/analytics/ai-rates", { method: "PATCH", body: JSON.stringify({ rates }) }));
      setMsg("AI Rate সেভ হয়েছে — আনুমানিক খরচ এখন থেকে দেখা যাবে।");
    } catch (e) { setMsg(e instanceof Error ? e.message : "সেভ হয়নি"); }
    finally { setBusy(false); }
  }

  const maxCollected = series ? Math.max(1, ...series.months.map((m) => Number(m.collectedMinor))) : 1;
  const providers = ai ? [...new Set([...Object.keys(ai.rates), ...ai.rows.map((r) => r.provider)])] : [];
  const bandBadge = (band: string) => band === "good" ? "abadge-green" : band === "watch" ? "abadge-amber" : "abadge-red";

  return (
    <AdminShell title="💹 Platform Analytics">
      {msg ? <p className="mb-4 rounded-lg bg-indigo-500/10 p-3 text-sm text-indigo-200">{msg}</p> : null}

      {!series ? <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">{Array.from({ length: 4 }).map((_, i) => <div key={i} className="askel h-[104px]" />)}</div> : (
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
              <div className="mt-1.5 text-xs text-slate-500">{c.sub}</div>
            </div>
          ))}
        </div>
      )}

      {series ? (
        <div className="acard mt-5">
          <div className="mb-1 font-semibold">মাসভিত্তিক চিত্র (শেষ ১২ মাস)</div>
          <p className="mb-3 text-xs text-slate-500">বার = সংগৃহীত পেমেন্ট (আসল SaasPayment রেকর্ড থেকে)। Paid Share একটি বর্তমান Snapshot অনুপাত — Cohort Conversion নয়।</p>
          <div className="mb-4 space-y-1.5">
            {series.months.map((m) => (
              <div key={m.month} className="flex items-center gap-3 text-xs">
                <span className="w-16 shrink-0 text-slate-400">{m.month}</span>
                <div className="h-4 flex-1 overflow-hidden rounded bg-slate-800">
                  <div className="h-full rounded bg-gradient-to-r from-indigo-500 to-fuchsia-500" style={{ width: `${Math.max(1.5, (Number(m.collectedMinor) / maxCollected) * 100)}%` }} />
                </div>
                <span className="w-24 shrink-0 text-right font-medium">{formatMinorStr(m.collectedMinor)}</span>
              </div>
            ))}
          </div>
          <div className="overflow-x-auto">
            <table className="atable">
              <thead><tr><th className="ath">মাস</th><th className="ath">সংগ্রহ</th><th className="ath">নতুন Org</th><th className="ath">নতুন User</th><th className="ath">নতুন Subscription</th><th className="ath">Tenant Order</th><th className="ath">Tenant আয়</th></tr></thead>
              <tbody>
                {[...series.months].reverse().map((m) => (
                  <tr key={m.month}>
                    <td className="atd font-medium">{m.month}</td><td className="atd">{formatMinorStr(m.collectedMinor)}</td>
                    <td className="atd">{m.newOrgs}</td><td className="atd">{m.newUsers}</td><td className="atd">{m.newSubscriptions}</td>
                    <td className="atd">{m.orders}</td><td className="atd">{formatMinorStr(m.orderRevenueMinor)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      ) : null}

      <div className="mt-5 grid gap-4 xl:grid-cols-2">
        <div className="acard">
          <div className="mb-3 font-semibold">🏆 Top Tenant (শেষ ৩০ দিনের আয় অনুযায়ী)</div>
          {tenants.length === 0 ? <p className="text-sm text-slate-500">কোনো Tenant নেই।</p> : (
            <div className="overflow-x-auto">
              <table className="atable">
                <thead><tr><th className="ath">Organization</th><th className="ath">প্ল্যান</th><th className="ath">Order</th><th className="ath">আয় (৩০দিন)</th><th className="ath">AI টোকেন</th><th className="ath">মোট সংগ্রহ</th></tr></thead>
                <tbody>
                  {tenants.map((t) => (
                    <tr key={t.organizationId}>
                      <td className="atd"><a className="font-medium text-indigo-300 hover:text-indigo-200" href={`/orgs/${t.organizationId}`}>{t.name}</a><div className="text-xs text-slate-500">সদস্য {t.members}</div></td>
                      <td className="atd">{t.plan ? <span className="abadge-indigo">{t.plan}</span> : "—"}</td>
                      <td className="atd">{t.orders30d}</td>
                      <td className="atd">{formatMinorStr(t.orderRevenue30dMinor)}</td>
                      <td className="atd">{t.aiTokens30d.toLocaleString()}</td>
                      <td className="atd">{formatMinorStr(t.collectedTotalMinor)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>

        <div className="acard">
          <div className="mb-1 font-semibold">❤️ Tenant Health Score <span className="abadge-slate">Heuristic</span></div>
          <p className="mb-3 text-xs text-slate-500">স্কোর একটি Triage সাহায্য — প্রতিটি কাটা পয়েন্টের কারণ দেখানো আছে। সবচেয়ে ঝুঁকিতে থাকা Tenant আগে।</p>
          {health.length === 0 ? <p className="text-sm text-slate-500">কোনো Tenant নেই।</p> : (
            <div className="space-y-2.5">
              {health.slice(0, 10).map((h) => (
                <div key={h.organizationId} className="rounded-xl border border-slate-800 bg-slate-900/60 px-3.5 py-3">
                  <div className="flex flex-wrap items-center gap-2">
                    <a className="font-medium text-indigo-300 hover:text-indigo-200" href={`/orgs/${h.organizationId}`}>{h.name}</a>
                    <span className={bandBadge(h.band)}>{h.score}/100 · {h.band}</span>
                    <span className="text-xs text-slate-500">{h.plan ?? "—"} · {h.subscriptionStatus ?? "—"} · নিষ্ক্রিয় {h.daysIdle} দিন</span>
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
        <p className="mb-3 text-xs text-slate-500">{ai?.note ?? "টোকেন আসল AIUsageRecord থেকে। Provider Rate সেট না করলে টাকার হিসাব দেখানো হয় না — Dev Adapter এর Estimated টোকেন খরচে ধরা হয় না।"}</p>
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
        {!ai || ai.rows.length === 0 ? <p className="text-sm text-slate-500">শেষ ৩০ দিনে কোনো AI ব্যবহার নেই।</p> : (
          <div className="overflow-x-auto">
            <table className="atable">
              <thead><tr><th className="ath">Organization</th><th className="ath">Provider</th><th className="ath">কল</th><th className="ath">টোকেন (আসল)</th><th className="ath">টোকেন (Estimated)</th><th className="ath">আনুমানিক খরচ</th></tr></thead>
              <tbody>
                {ai.rows.map((r) => (
                  <tr key={`${r.organizationId}-${r.provider}`}>
                    <td className="atd font-medium">{r.organizationName}</td>
                    <td className="atd">{r.provider}</td>
                    <td className="atd">{r.calls}</td>
                    <td className="atd">{r.tokens.toLocaleString()}</td>
                    <td className="atd">{r.estimatedTokens.toLocaleString()}</td>
                    <td className="atd">{r.estimatedCostMinor != null ? formatMinorStr(String(r.estimatedCostMinor)) : <span className="text-slate-500">Rate সেট নেই</span>}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </AdminShell>
  );
}
