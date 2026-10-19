"use client";
import React from "react";
import AdminShell from "@/components/AdminShell";
import { Chart, DataTable, EmptyState, ErrorState, PageHead, toast } from "@/components/ui";
import { apiFetch, formatMinorStr } from "@/lib/api";
import { fmtNumber } from "@repo/contracts";
import { useAdminLocale } from "@/components/AdminLocale";

interface SeriesMonth { month: string; collectedMinor: string; newOrgs: number; newUsers: number; newSubscriptions: number; orders: number; orderRevenueMinor: string }
interface Series { months: SeriesMonth[]; current: { mrrMinor: string; activeSubscriptions: number; trialing: number; pastDue: number; organizationsWithSubscription: number; paidOrganizations: number; paidSharePercent: number | null } }
interface Tenant { organizationId: string; name: string; plan: string | null; subscriptionStatus: string | null; members: number; orders30d: number; orderRevenue30dMinor: string; aiTokens30d: number; collectedTotalMinor: string }
interface Health { organizationId: string; name: string; score: number; band: string; plan: string | null; subscriptionStatus: string | null; daysIdle: number; deductions: { reason: string; points: number }[] }
interface AiRow { organizationId: string; organizationName: string; provider: string; calls: number; tokens: number; estimatedTokens: number; rateMinorPerMillion: number | null; estimatedCostMinor: number | null }
interface AiCost { rates: Record<string, number>; rows: AiRow[]; note: string }

export default function AnalyticsPage() {
  const { dict, locale, t: tr } = useAdminLocale();
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
      toast(dict.analytics.rateSaved);
    } catch (e) { toast(e instanceof Error ? e.message : dict.analytics.saveFailed, "error"); }
    finally { setBusy(false); }
  }

  const months = series ? series.months.slice(-win) : [];
  const providers = ai ? [...new Set([...Object.keys(ai.rates), ...ai.rows.map((r) => r.provider)])] : [];
  const bandBadge = (band: string) => band === "good" ? "abadge-green" : band === "watch" ? "abadge-amber" : "abadge-red";

  return (
    <AdminShell title={dict.analytics.title}>
      <PageHead sub={dict.analytics.sub} />

      {!series && loadDone ? <div className="mb-4"><ErrorState message={dict.analytics.seriesLoadError} onRetry={load} /></div> : null}
      {!series && !loadDone ? <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">{Array.from({ length: 4 }).map((_, i) => <div key={i} className="askel h-[104px]" />)}</div> : !series ? null : (
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
          {[
            { icon: "💰", label: dict.analytics.cardMrr, value: formatMinorStr(series.current.mrrMinor, locale), sub: tr("analytics.cardMrrSub", { count: fmtNumber(locale, series.current.activeSubscriptions) }) },
            { icon: "🏢", label: dict.analytics.cardPaidOrg, value: fmtNumber(locale, series.current.paidOrganizations), sub: tr("analytics.cardPaidOrgSub", { total: fmtNumber(locale, series.current.organizationsWithSubscription), share: series.current.paidSharePercent != null ? fmtNumber(locale, series.current.paidSharePercent) : "—" }) },
            { icon: "⏳", label: dict.analytics.cardTrialing, value: fmtNumber(locale, series.current.trialing), sub: dict.analytics.cardTrialingSub },
            { icon: "⛔", label: dict.analytics.cardPastDue, value: fmtNumber(locale, series.current.pastDue), sub: dict.analytics.cardPastDueSub },
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
              <span className="text-sm font-medium">{dict.analytics.timeRange}</span>
              <span className="ml-auto flex gap-1.5">
                {[3, 6, 12].map((n) => (
                  <button key={n} type="button" onClick={() => setWin(n)} className={win === n ? "abtn !px-2.5 !py-1 text-xs" : "abtn-secondary !px-2.5 !py-1 text-xs"}>{tr("analytics.lastMonths", { count: fmtNumber(locale, n) })}</button>
                ))}
              </span>
            </div>
          </div>
          <div className="acard">
            <div className="mb-1 font-semibold">{tr("analytics.monthlyTitle", { count: fmtNumber(locale, win) })}</div>
            <p className="mb-3 text-xs text-slate-400">{dict.analytics.monthlyNote}</p>
            {/* ADNX12: the hand-rolled bar rows are replaced by the
                ADNX5 Chart (bar variant, same loaded series data,
                exact-value readout + data-table fallback). */}
            <Chart variant="bar" seriesLabel={dict.analytics.seriesCollected} points={months.map((m) => ({ label: m.month, value: Number(m.collectedMinor) }))} formatValue={(v) => formatMinorStr(String(v), locale)} />
            <div className="mt-4">
              <DataTable>
                <thead><tr><th className="ath">{dict.analytics.colMonth}</th><th className="ath">{dict.analytics.colCollected}</th><th className="ath">{dict.analytics.colNewOrg}</th><th className="ath">{dict.analytics.colNewUser}</th><th className="ath">{dict.analytics.colNewSub}</th><th className="ath">{dict.analytics.colTenantOrder}</th><th className="ath">{dict.analytics.colTenantRevenue}</th></tr></thead>
                <tbody>
                  {[...months].reverse().map((m) => (
                    <tr key={m.month}>
                      <td data-label={dict.analytics.colMonth} className="atd font-medium">{m.month}</td><td data-label={dict.analytics.colCollected} className="atd">{formatMinorStr(m.collectedMinor, locale)}</td>
                      <td data-label={dict.analytics.colNewOrg} className="atd">{fmtNumber(locale, m.newOrgs)}</td><td data-label={dict.analytics.colNewUser} className="atd">{fmtNumber(locale, m.newUsers)}</td><td data-label={dict.analytics.colNewSub} className="atd">{fmtNumber(locale, m.newSubscriptions)}</td>
                      <td data-label={dict.analytics.colTenantOrder} className="atd">{fmtNumber(locale, m.orders)}</td><td data-label={dict.analytics.colTenantRevenue} className="atd">{formatMinorStr(m.orderRevenueMinor, locale)}</td>
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
          <div className="mb-3 font-semibold">{dict.analytics.topTenantTitle}</div>
          {tenants.length === 0 ? <EmptyState title={dict.analytics.noTenant} /> : (
              <DataTable>
                <thead><tr><th className="ath">{dict.analytics.colOrg}</th><th className="ath">{dict.analytics.colPlan}</th><th className="ath">{dict.analytics.colOrder}</th><th className="ath">{dict.analytics.colRevenue30d}</th><th className="ath">{dict.analytics.colAiTokens}</th><th className="ath">{dict.analytics.colTotalCollected}</th></tr></thead>
                <tbody>
                  {tenants.map((t) => (
                    <tr key={t.organizationId}>
                      <td data-label={dict.analytics.colOrg} className="atd"><a className="font-medium text-indigo-300 hover:text-indigo-200" href={`/orgs/${t.organizationId}`}>{t.name}</a><div className="text-xs text-slate-400">{tr("analytics.members", { count: fmtNumber(locale, t.members) })}</div></td>
                      <td data-label={dict.analytics.colPlan} className="atd">{t.plan ? <span className="abadge-indigo">{t.plan}</span> : "—"}</td>
                      <td data-label={dict.analytics.colOrder} className="atd">{fmtNumber(locale, t.orders30d)}</td>
                      <td data-label={dict.analytics.colRevenue30d} className="atd">{formatMinorStr(t.orderRevenue30dMinor, locale)}</td>
                      <td data-label={dict.analytics.colAiTokens} className="atd">{fmtNumber(locale, t.aiTokens30d)}</td>
                      <td data-label={dict.analytics.colTotalCollected} className="atd">{formatMinorStr(t.collectedTotalMinor, locale)}</td>
                    </tr>
                  ))}
                </tbody>
              </DataTable>
          )}
        </div>

        <div className="acard">
          <div className="mb-1 font-semibold">{dict.analytics.healthTitle} <span className="abadge-slate">{dict.analytics.healthBadge}</span></div>
          <p className="mb-3 text-xs text-slate-400">{dict.analytics.healthNote}</p>
          {health.length === 0 ? <EmptyState title={dict.analytics.noTenant} /> : (
            <div className="space-y-2.5">
              {health.slice(0, 10).map((h) => (
                <div key={h.organizationId} className="rounded-xl border border-slate-800 bg-slate-900/60 px-3.5 py-3">
                  <div className="flex flex-wrap items-center gap-2">
                    <a className="font-medium text-indigo-300 hover:text-indigo-200" href={`/orgs/${h.organizationId}`}>{h.name}</a>
                    <span className={bandBadge(h.band)}>{fmtNumber(locale, h.score)}/{fmtNumber(locale, 100)} · {h.band}</span>
                    <span className="text-xs text-slate-400">{h.plan ?? "—"} · {h.subscriptionStatus ?? "—"} · {tr("analytics.idleDays", { days: fmtNumber(locale, h.daysIdle) })}</span>
                  </div>
                  {h.deductions.length > 0 ? (
                    <div className="mt-1.5 flex flex-wrap gap-1.5">
                      {h.deductions.map((d, i) => <span key={i} className="abadge-slate">−{fmtNumber(locale, d.points)} {d.reason}</span>)}
                    </div>
                  ) : <div className="mt-1 text-xs text-emerald-300">{dict.analytics.noIssues}</div>}
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      <div className="acard mt-5">
        <div className="mb-1 font-semibold">{dict.analytics.aiCostTitle}</div>
        <p className="mb-3 text-xs text-slate-400">{ai?.note ?? dict.analytics.aiCostNoteFallback}</p>
        {providers.length > 0 ? (
          <div className="mb-4 flex flex-wrap items-end gap-2">
            {providers.map((provider) => (
              <label key={provider} className="text-sm">{tr("analytics.ratePerMillion", { provider })}
                <input id={`rate-${provider}`} type="number" min="0" step="any" className="ainput mt-1 w-40" defaultValue={ai?.rates[provider] != null ? ai.rates[provider] / 100 : ""} placeholder={dict.analytics.rateNone} />
              </label>
            ))}
            <button className="abtn" disabled={busy} onClick={saveRates}>{dict.analytics.rateSave}</button>
          </div>
        ) : null}
        {!ai || ai.rows.length === 0 ? <EmptyState title={dict.analytics.aiEmptyTitle} /> : (
            <DataTable>
              <thead><tr><th className="ath">{dict.analytics.colOrg}</th><th className="ath">{dict.analytics.colProvider}</th><th className="ath">{dict.analytics.colCalls}</th><th className="ath">{dict.analytics.colTokensActual}</th><th className="ath">{dict.analytics.colTokensEstimated}</th><th className="ath">{dict.analytics.colEstCost}</th></tr></thead>
              <tbody>
                {ai.rows.map((r) => (
                  <tr key={`${r.organizationId}-${r.provider}`}>
                    <td data-label={dict.analytics.colOrg} className="atd font-medium">{r.organizationName}</td>
                    <td data-label={dict.analytics.colProvider} className="atd">{r.provider}</td>
                    <td data-label={dict.analytics.colCalls} className="atd">{fmtNumber(locale, r.calls)}</td>
                    <td data-label={dict.analytics.colTokensActual} className="atd">{fmtNumber(locale, r.tokens)}</td>
                    <td data-label={dict.analytics.colTokensEstimated} className="atd">{fmtNumber(locale, r.estimatedTokens)}</td>
                    <td data-label={dict.analytics.colEstCost} className="atd">{r.estimatedCostMinor != null ? formatMinorStr(String(r.estimatedCostMinor), locale) : <span className="text-slate-400">{dict.analytics.rateNotSet}</span>}</td>
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
  const { dict, locale, t } = useAdminLocale();
  const [rows, setRows] = React.useState<OnboardingRow[] | null>(null);
  // ADNX12: a failed board load is no longer indistinguishable
  // from "no organizations" — it gets its own error state + retry.
  const [loadError, setLoadError] = React.useState("");
  const load = React.useCallback(async () => {
    setLoadError("");
    try { setRows(await apiFetch<OnboardingRow[]>("/admin/onboarding-board")); }
    catch (e) { setRows(null); setLoadError(e instanceof Error ? e.message : dict.analytics.onboardingLoadFallback); }
  }, [dict]);
  React.useEffect(() => { load(); }, [load]);
  return (
    <div className="acard">
      <div className="mb-1 font-semibold">{dict.analytics.onboardingTitle}</div>
      <p className="mb-3 text-sm text-slate-400">{dict.analytics.onboardingNote}</p>
      {loadError ? <ErrorState message={t("analytics.onboardingLoadError", { message: loadError })} onRetry={load} />
        : rows === null ? <div className="askel-table" />
        : rows.length === 0 ? <EmptyState title={dict.analytics.noOrg} /> : (
          <div className="overflow-x-auto">
            <table className="atable">
              <thead><tr><th className="ath">{dict.analytics.colOrg}</th><th className="ath">{dict.analytics.colPlan}</th><th className="ath">{dict.analytics.colProgress}</th><th className="ath">{dict.analytics.colStuckAt}</th><th className="ath">{dict.analytics.colSteps}</th></tr></thead>
              <tbody>
                {rows.map((r) => (
                  <tr key={r.organizationId}>
                    <td className="atd font-medium"><a href={`/orgs/${r.organizationId}`}>{r.organizationName}</a></td>
                    <td className="atd">{r.plan ?? "—"} {r.subscriptionStatus ? `· ${r.subscriptionStatus}` : ""}</td>
                    <td className="atd">
                      <div className="flex items-center gap-2">
                        <div className="h-2 w-24 overflow-hidden rounded bg-slate-800"><div className="h-full bg-gradient-to-r from-indigo-500 to-violet-500" style={{ width: `${(r.completed / r.total) * 100}%` }} /></div>
                        <span>{fmtNumber(locale, r.completed)}/{fmtNumber(locale, r.total)}</span>
                      </div>
                    </td>
                    <td className="atd">{r.stuckAt ?? <span className="text-emerald-400">{dict.analytics.complete}</span>}</td>
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
