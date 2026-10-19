"use client";
import React from "react";
import Link from "next/link";
import { fmtDate, fmtMoneyMinor, fmtNumber } from "@repo/contracts";
import { EmptyState, KpiCard } from "@repo/ui";
import { useLocale } from "@/lib/i18n/provider";
import { useOverview, DailyBars } from "@/components/analytics-shared";
import { ReportGoals } from "@/components/report-goals";

// RP5: previous-period delta — null means the previous
// period was zero, so no honest percentage exists.
const deltaHint = (d: number | null | undefined, label: string) =>
  d === null || d === undefined ? "" : ` · ${label} ${d > 0 ? "▲" : d < 0 ? "▼" : ""} ${Math.abs(d)}%`;

function CreativeSection() {
  const { t, locale } = useLocale();
  const [accounts, setAccounts] = React.useState<{ id: string; name: string; platform: string; integrationId?: string | null }[]>([]);
  const [accountId, setAccountId] = React.useState("");
  const [ads, setAds] = React.useState<{ adExternalId: string; adName?: string; campaignName?: string; spendMinor: string; impressions: number; clicks: number; reach: number; videoViews: number; conversions: number; ctr: number | null; cpaMinor: string | null; frequency: number | null }[]>([]);
  const [ageGender, setAgeGender] = React.useState<{ key: string; spendMinor: string; impressions: number; clicks: number; conversions: number; ctr: number | null }[]>([]);
  const [placement, setPlacement] = React.useState<typeof ageGender>([]);
  const [device, setDevice] = React.useState<typeof ageGender>([]);
  const [region, setRegion] = React.useState<typeof ageGender>([]);
  const [hourly, setHourly] = React.useState<typeof ageGender>([]);
  const [msg, setMsg] = React.useState("");
  const fmtMoney = (minor: string) => fmtMoneyMinor(locale, BigInt(minor));

  React.useEffect(() => {
    (async () => {
      const { apiFetch } = await import("@/lib/api");
      const { getOrganizationId } = await import("@/lib/org");
      const orgId = getOrganizationId(); if (!orgId) return;
      const list = await apiFetch(`/organizations/${orgId}/ad-accounts`).catch(() => []) as typeof accounts;
      const meta = list.filter((x) => x.platform === "meta" && x.integrationId);
      setAccounts(meta);
      if (meta[0]) setAccountId(meta[0].id);
    })();
  }, []);

  React.useEffect(() => {
    if (!accountId) return;
    (async () => {
      const { apiFetch } = await import("@/lib/api");
      const { getOrganizationId } = await import("@/lib/org");
      const orgId = getOrganizationId(); if (!orgId) return;
      setAds(await apiFetch(`/organizations/${orgId}/ad-accounts/${accountId}/ad-metrics?days=30`).catch(() => []) as any);
      setAgeGender(await apiFetch(`/organizations/${orgId}/ad-accounts/${accountId}/breakdowns?dimension=age_gender&days=30`).catch(() => []) as any);
      setPlacement(await apiFetch(`/organizations/${orgId}/ad-accounts/${accountId}/breakdowns?dimension=placement&days=30`).catch(() => []) as any);
      setDevice(await apiFetch(`/organizations/${orgId}/ad-accounts/${accountId}/breakdowns?dimension=device&days=30`).catch(() => []) as any);
      setRegion(await apiFetch(`/organizations/${orgId}/ad-accounts/${accountId}/breakdowns?dimension=region&days=30`).catch(() => []) as any);
      setHourly(await apiFetch(`/organizations/${orgId}/ad-accounts/${accountId}/breakdowns?dimension=hourly&days=30`).catch(() => []) as any);
      setMsg("");
    })().catch(() => setMsg(t("analytics.anLoadError")));
  }, [accountId]);

  if (accounts.length === 0) return null;
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="font-semibold">{t("analytics.anCreativeTitle")}</h2>
        <select className="input w-56" value={accountId} onChange={(e) => setAccountId(e.target.value)}>
          {accounts.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
        </select>
      </div>
      {msg ? <p className="text-sm text-red-600">{msg}</p> : null}
      {ads.length === 0 ? (
        <div className="card p-4 text-sm text-slate-500">{t("analytics.anNoAdData")}</div>
      ) : (
        <div className="overflow-hidden card">
          <table className="w-full text-left text-sm">
            <thead className="bg-slate-50 text-slate-500"><tr><th className="px-4 py-3">Ad</th><th className="px-4 py-3">Campaign</th><th className="px-4 py-3">Spend</th><th className="px-4 py-3">Reach</th><th className="px-4 py-3">Freq.</th><th className="px-4 py-3">CTR</th><th className="px-4 py-3">Video Views</th><th className="px-4 py-3">Conv. (Platform)</th><th className="px-4 py-3">CPA</th></tr></thead>
            <tbody>{ads.map((a) => (
              <tr key={a.adExternalId} className="border-t">
                <td className="px-4 py-3 font-medium">{a.adName ?? a.adExternalId}</td>
                <td className="px-4 py-3">{a.campaignName ?? "—"}</td>
                <td className="px-4 py-3">{fmtMoney(a.spendMinor)}</td>
                <td className="px-4 py-3">{fmtNumber(locale, a.reach)}</td>
                <td className="px-4 py-3">{a.frequency ?? "—"}</td>
                <td className="px-4 py-3">{a.ctr === null ? "—" : `${a.ctr}%`}</td>
                <td className="px-4 py-3">{fmtNumber(locale, a.videoViews)}</td>
                <td className="px-4 py-3">{a.conversions}</td>
                <td className="px-4 py-3">{a.cpaMinor === null ? "—" : fmtMoney(a.cpaMinor)}</td>
              </tr>
            ))}</tbody>
          </table>
        </div>
      )}
      <div className="grid gap-4 lg:grid-cols-2">
        {[{ title: t("analytics.anPanelAgeGender"), rows: ageGender }, { title: t("analytics.anPanelPlacement"), rows: placement }, { title: t("analytics.anPanelDevice"), rows: device }, { title: t("analytics.anPanelRegion"), rows: region }, { title: t("analytics.anPanelHourly"), rows: hourly }].map((panel) => (
          <div key={panel.title} className="card p-4">
            <div className="mb-2 font-medium">{panel.title}</div>
            {panel.rows.length === 0 ? <p className="text-sm text-slate-400">{t("analytics.anBreakdownEmpty")}</p> : (
              <table className="w-full text-left text-sm">
                <thead className="text-slate-500"><tr><th className="py-1">Segment</th><th className="py-1">Spend</th><th className="py-1">CTR</th><th className="py-1">Conv.</th></tr></thead>
                <tbody>{panel.rows.slice(0, 8).map((r) => (
                  <tr key={r.key} className="border-t"><td className="py-1.5">{r.key}</td><td className="py-1.5">{fmtMoney(r.spendMinor)}</td><td className="py-1.5">{r.ctr === null ? "—" : `${r.ctr}%`}</td><td className="py-1.5">{r.conversions}</td></tr>
                ))}</tbody>
              </table>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}

interface LeaderAd { adExternalId: string; adName: string; campaign: string; spendMinor: string; impressions: number; clicks: number; conversions: number; ctrPercent: number | null; frequency: number | null; cpaMinor: string | null; ctrDropPercent: number | null; fatigued: boolean; fatigueReasons: string[] }
function LeaderboardSection() {
  const { t, locale } = useLocale();
  const [ads, setAds] = React.useState<LeaderAd[]>([]);
  React.useEffect(() => {
    (async () => {
      const { apiFetch } = await import("@/lib/api");
      const { getOrganizationId } = await import("@/lib/org");
      const orgId = getOrganizationId(); if (!orgId) return;
      const out = await apiFetch<{ days: number; ads: LeaderAd[] }>(`/organizations/${orgId}/creative-leaderboard?days=14`).catch(() => null);
      if (out) setAds(out.ads);
    })();
  }, []);
  if (ads.length === 0) return null;
  return (
    <div className="card overflow-hidden">
      <div className="border-b px-4 py-3 font-semibold">{t("analytics.anLeaderboardTitle")}</div>
      <table className="w-full text-left text-sm">
        <thead className="bg-slate-50 text-slate-500"><tr><th className="px-4 py-2">Ad</th><th className="px-4 py-2">Spend</th><th className="px-4 py-2">CTR</th><th className="px-4 py-2">{t("analytics.anColChange")}</th><th className="px-4 py-2">Freq.</th><th className="px-4 py-2">CPA</th><th className="px-4 py-2">{t("analytics.anColStatus")}</th></tr></thead>
        <tbody>{ads.map((a) => (
          <tr key={a.adExternalId} className="border-t">
            <td className="px-4 py-2 font-medium">{a.adName}<div className="text-xs text-slate-400">{a.campaign}</div></td>
            <td className="px-4 py-2">{fmtMoneyMinor(locale, BigInt(a.spendMinor))}</td>
            <td className="px-4 py-2">{a.ctrPercent === null ? "—" : `${a.ctrPercent}%`}</td>
            <td className="px-4 py-2">{a.ctrDropPercent === null ? "—" : `${a.ctrDropPercent > 0 ? "▼" : "▲"} ${Math.abs(a.ctrDropPercent)}%`}</td>
            <td className="px-4 py-2">{a.frequency ?? "—"}</td>
            <td className="px-4 py-2">{a.cpaMinor ? fmtMoneyMinor(locale, BigInt(a.cpaMinor)) : "—"}</td>
            <td className="px-4 py-2">{a.fatigued ? <span className="badge badge-danger">{t("analytics.anFatigued")}</span> : a.fatigueReasons.length ? <span className="badge badge-muted">{t("analytics.anWatch")}</span> : <span className="badge badge-success">{t("analytics.anHealthy")}</span>}</td>
          </tr>
        ))}</tbody>
      </table>
    </div>
  );
}

interface Pacing { monthSpendMinor: string; dayOfMonth: number; daysInMonth: number; projectedMonthSpendMinor: string; monthlyBudgetMinor: string | null; pacePercent: number | null; campaigns: { name: string; spendMinor: string; conversions: number; cpaMinor: string | null }[]; suggestions: string[] }
function PacingSection() {
  const { t, locale } = useLocale();
  const [budget, setBudget] = React.useState("");
  const [data, setData] = React.useState<Pacing | null>(null);
  async function load(b?: string) {
    const { apiFetch } = await import("@/lib/api");
    const { getOrganizationId } = await import("@/lib/org");
    const orgId = getOrganizationId(); if (!orgId) return;
    setData(await apiFetch<Pacing>(`/organizations/${orgId}/pacing${b ? `?budget=${encodeURIComponent(b)}` : ""}`).catch(() => null));
  }
  React.useEffect(() => { load(); }, []);
  if (!data) return null;
  return (
    <div className="card space-y-3 p-5">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="font-semibold">{t("analytics.anPacingTitle", { day: fmtNumber(locale, data.dayOfMonth), days: fmtNumber(locale, data.daysInMonth) })}</div>
        <span className="flex gap-2">
          <input className="input w-44" placeholder={t("analytics.anBudgetPlaceholder")} value={budget} onChange={(e) => setBudget(e.target.value)} />
          <button className="btn-secondary btn-sm" onClick={() => load(budget || undefined)}>{t("analytics.anCalculate")}</button>
        </span>
      </div>
      <div className="grid gap-3 sm:grid-cols-3 text-sm">
        <div className="rounded-xl bg-slate-50 p-3">{t("analytics.anMonthSpend")}<br /><span className="text-lg font-bold">{fmtMoneyMinor(locale, BigInt(data.monthSpendMinor))}</span></div>
        <div className="rounded-xl bg-slate-50 p-3">{t("analytics.anProjected")}<br /><span className="text-lg font-bold">{fmtMoneyMinor(locale, BigInt(data.projectedMonthSpendMinor))}</span></div>
        <div className="rounded-xl bg-slate-50 p-3">{t("analytics.anPaceLabel")}<br /><span className="text-lg font-bold">{data.pacePercent === null ? t("analytics.anBudgetPrompt") : `${data.pacePercent}%`}</span></div>
      </div>
      {data.suggestions.length > 0 && <ul className="list-inside list-disc text-sm text-amber-800">{data.suggestions.map((s, i) => <li key={i}>{s}</li>)}</ul>}
      {data.campaigns.length > 0 && (
        <table className="w-full text-left text-sm">
          <thead className="text-slate-500"><tr><th className="py-1">Campaign</th><th className="py-1">{t("analytics.anColMonthSpend")}</th><th className="py-1">Conv.</th><th className="py-1">CPA</th></tr></thead>
          <tbody>{data.campaigns.slice(0, 8).map((c) => <tr key={c.name} className="border-t"><td className="py-1.5">{c.name}</td><td className="py-1.5">{fmtMoneyMinor(locale, BigInt(c.spendMinor))}</td><td className="py-1.5">{fmtNumber(locale, c.conversions)}</td><td className="py-1.5">{c.cpaMinor ? fmtMoneyMinor(locale, BigInt(c.cpaMinor)) : "—"}</td></tr>)}</tbody>
        </table>
      )}
    </div>
  );
}

interface AbGroup { groupId: string; metric: string; verdict: string; winnerPlanId: string | null; variants: { planId: string; name: string; variant: string; status: string; spendMinor: string; platformConversions: number; firstPartyOrders: number; firstPartyCpaMinor: string | null; platformCpaMinor: string | null }[] }
function AbSection() {
  const { t, locale } = useLocale();
  const [groups, setGroups] = React.useState<AbGroup[]>([]);
  React.useEffect(() => {
    (async () => {
      const { apiFetch } = await import("@/lib/api");
      const { getOrganizationId } = await import("@/lib/org");
      const orgId = getOrganizationId(); if (!orgId) return;
      setGroups(await apiFetch<AbGroup[]>(`/organizations/${orgId}/campaign-plans/ab-tests/list`).catch(() => []));
    })();
  }, []);
  if (groups.length === 0) return null;
  return (
    <div className="card overflow-hidden">
      <div className="border-b px-4 py-3 font-semibold">{t("analytics.anAbTitle")}</div>
      {groups.map((g) => (
        <div key={g.groupId} className="border-b px-4 py-3 last:border-0">
          <div className="mb-2 text-sm text-slate-500">{t("analytics.anAbMeta", { metric: g.metric, verdict: g.verdict === "insufficient_data" ? t("analytics.anAbInsufficient") : t("analytics.anAbWinner", { metric: g.metric }) })}</div>
          <table className="w-full text-left text-sm">
            <thead className="text-slate-500"><tr><th className="py-1">Variant</th><th className="py-1">Plan</th><th className="py-1">Spend</th><th className="py-1">Platform Conv.</th><th className="py-1">First-party Orders</th><th className="py-1">First-party CPA</th></tr></thead>
            <tbody>{g.variants.map((v) => (
              <tr key={v.planId} className="border-t">
                <td className="py-1.5 font-bold">{v.variant} {g.winnerPlanId === v.planId ? "🏆" : ""}</td>
                <td className="py-1.5">{v.name} <span className="text-xs text-slate-400">({v.status})</span></td>
                <td className="py-1.5">{fmtMoneyMinor(locale, BigInt(v.spendMinor))}</td>
                <td className="py-1.5">{fmtNumber(locale, v.platformConversions)}</td>
                <td className="py-1.5">{fmtNumber(locale, v.firstPartyOrders)}</td>
                <td className="py-1.5">{v.firstPartyCpaMinor ? fmtMoneyMinor(locale, BigInt(v.firstPartyCpaMinor)) : "—"}</td>
              </tr>
            ))}</tbody>
          </table>
        </div>
      ))}
    </div>
  );
}

function ShareLinksCard() {
  const { t, locale } = useLocale();
  const [shares, setShares] = React.useState<{ id: string; token: string; title: string; days: number; expiresAt: string }[]>([]);
  const [form, setForm] = React.useState({ title: "", days: 30, expiresInDays: 30, kind: "overview" });
  const [msg, setMsg] = React.useState("");
  const loadShares = React.useCallback(async () => {
    const { apiFetch } = await import("@/lib/api");
    const { getOrganizationId } = await import("@/lib/org");
    const orgId = getOrganizationId(); if (!orgId) return;
    setShares(await apiFetch(`/organizations/${orgId}/report-shares`).catch(() => []) as any);
  }, []);
  React.useEffect(() => { loadShares(); }, [loadShares]);
  return (
    <div className="card space-y-3 p-5">
      <div className="font-semibold">{t("analytics.anShareTitle")}</div>
      <p className="text-sm text-slate-500">{t("analytics.anShareIntro")}</p>
      <form className="flex flex-wrap gap-2" onSubmit={async (e) => {
        e.preventDefault();
        const { apiFetch } = await import("@/lib/api");
        const { getOrganizationId } = await import("@/lib/org");
        const orgId = getOrganizationId(); if (!orgId) return;
        try {
          await apiFetch(`/organizations/${orgId}/report-shares`, { method: "POST", body: JSON.stringify(form) });
          setForm({ ...form, title: "" }); setMsg(t("analytics.anShareCreated")); await loadShares();
        } catch (err) { setMsg(err instanceof Error ? err.message : "Failed"); }
      }}>
        <input className="input flex-1" placeholder={t("analytics.anShareTitlePlaceholder")} value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} required />
        <select className="input w-32" value={form.days} onChange={(e) => setForm({ ...form, days: Number(e.target.value) })}>
          {[7, 14, 30, 60, 90].map((d) => <option key={d} value={d}>{t("analytics.anShareLastDays", { days: fmtNumber(locale, d) })}</option>)}
        </select>
        <select className="input w-36" value={form.expiresInDays} onChange={(e) => setForm({ ...form, expiresInDays: Number(e.target.value) })}>
          {[7, 30, 90].map((d) => <option key={d} value={d}>{t("analytics.anShareExpiryDays", { days: fmtNumber(locale, d) })}</option>)}
        </select>
        <select className="input w-40" value={form.kind} onChange={(e) => setForm({ ...form, kind: e.target.value })}>
          <option value="overview">{t("analytics.anShareKindOverview")}</option>
          <option value="executive">{t("analytics.anShareKindExecutive")}</option>
        </select>
        <button className="btn-primary">{t("analytics.anShareCreate")}</button>
      </form>
      {msg ? <p className="text-sm text-green-700">{msg}</p> : null}
      <ul className="space-y-1 text-sm">
        {shares.map((s) => (
          <li key={s.id} className="flex flex-wrap items-center justify-between gap-2 rounded-lg bg-slate-50 px-3 py-2">
            <span>{s.title} <span className="text-xs text-slate-400">{t("analytics.anShareItemMeta", { days: fmtNumber(locale, s.days), date: fmtDate(locale, s.expiresAt) })}</span></span>
            <span className="flex gap-2">
              <button className="btn-secondary btn-sm" onClick={() => { const url = `${window.location.origin}/r/${s.token}`; void navigator.clipboard?.writeText(url); setMsg(t("analytics.anShareCopied", { url })); }}>{t("analytics.anShareCopy")}</button>
              <button className="btn-secondary btn-sm text-red-600" onClick={async () => {
                const { apiFetch } = await import("@/lib/api");
                const { getOrganizationId } = await import("@/lib/org");
                const orgId = getOrganizationId(); if (!orgId) return;
                await apiFetch(`/organizations/${orgId}/report-shares/${s.id}`, { method: "DELETE" }).catch(() => undefined);
                await loadShares();
              }}>{t("analytics.anShareCancel")}</button>
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}

export default function AnalyticsPage() {
  const { t, locale } = useLocale();
  const { range, setRange, data, error, loading } = useOverview();
  const fmtRatio = (v: number | null) => (v === null ? "—" : String(v));
  const fmtMoney = (minor: string) => fmtMoneyMinor(locale, BigInt(minor));

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="page-title">Analytics</h1>
          <p className="text-sm text-slate-500">{t("analytics.anIntro")}</p>
        </div>
        <div className="flex items-center gap-2 text-sm">
          <input type="date" className="rounded-lg border bg-white px-2 py-1.5" value={range.from} onChange={(e) => setRange({ ...range, from: e.target.value })} />
          <span>{t("analytics.anFrom")}</span>
          <input type="date" className="rounded-lg border bg-white px-2 py-1.5" value={range.to} onChange={(e) => setRange({ ...range, to: e.target.value })} />
        </div>
      </div>
      <Link href="/dashboard/analytics/cohorts" className="card block p-4 font-semibold text-indigo-700 transition hover:bg-slate-50">{t("analytics.anCohortsLink")}</Link>
      <ReportGoals />
      {error ? <p className="rounded-lg bg-red-50 p-3 text-sm text-red-700">{error}</p> : null}
      {data?.mixedCurrencies ? <p className="rounded-lg bg-amber-50 p-3 text-sm text-amber-700">{t("analytics.anMixedWarning", { currencies: data.currencies.join(", ") })}</p> : null}
      {loading ? <p className="text-sm text-slate-500">{t("analytics.anLoading")}</p> : data ? (
        <>
          <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
            <KpiCard label="Revenue" value={fmtMoney(data.totals.revenueMinor)} hint={t("analytics.anOrdersHint", { count: fmtNumber(locale, data.totals.orders), aov: fmtMoney(data.totals.averageOrderValueMinor), delta: deltaHint((data as any).comparison?.deltas?.revenue, t("analytics.anDeltaVsPrevious")) })} />
            <KpiCard label="Ad Spend" value={fmtMoney(data.totals.adSpendMinor)} hint={t("analytics.anImpressionsHint", { count: fmtNumber(locale, data.totals.impressions), delta: deltaHint((data as any).comparison?.deltas?.adSpend, t("analytics.anDeltaVsPrevious")) })} />
            <KpiCard label="MER (Revenue/Spend)" value={fmtRatio(data.kpis.mer)} hint={t("analytics.anMerHint")} />
            <KpiCard label="Platform ROAS" value={fmtRatio(data.kpis.platformRoas)} hint={t("analytics.anRoasHint")} />
            <KpiCard label="CTR" value={data.kpis.ctrPercent === null ? "—" : `${data.kpis.ctrPercent}%`} hint={t("analytics.anClicksHint", { count: fmtNumber(locale, data.totals.clicks) })} />
            <KpiCard label="CPC" value={data.kpis.cpcMinor === null ? "—" : fmtMoney(String(Math.round(data.kpis.cpcMinor)))} />
            <KpiCard label="CPA (Platform)" value={data.kpis.cpaMinor === null ? "—" : fmtMoney(String(Math.round(data.kpis.cpaMinor)))} hint={t("analytics.anPlatformConvHint", { count: fmtNumber(locale, data.totals.platformConversions) })} />
            <KpiCard label="Cost per Order" value={data.kpis.costPerOrderMinor === null ? "—" : fmtMoney(String(Math.round(data.kpis.costPerOrderMinor)))} hint={t("analytics.anCpoHint")} />
          </div>

          <DailyBars data={data} />

          <div className="card p-5">
            <div className="font-semibold">Contribution Profit</div>
            <div className="mt-3 grid grid-cols-2 gap-4 lg:grid-cols-5">
              <KpiCard label="Revenue" value={fmtMoney(data.profit.revenueMinor)} />
              <KpiCard label={t("analytics.anRefundLabel")} value={`- ${fmtMoney(data.profit.refundedMinor)}`} />
              <KpiCard label={t("analytics.anCogsLabel")} value={`- ${fmtMoney(data.profit.cogsMinor)}`} hint={t("analytics.anCogsHint", { percent: fmtNumber(locale, data.profit.cogsCoverage.percent) })} />
              <KpiCard label={t("analytics.anAdSpendLabel")} value={`- ${fmtMoney(data.profit.adSpendMinor)}`} />
              <KpiCard label="Contribution Profit" value={fmtMoney(data.profit.contributionProfitMinor)} hint={t("analytics.anMarginHint", { value: data.profit.contributionMarginPercent === null ? "—" : data.profit.contributionMarginPercent + "%" })} />
            </div>
            <p className="mt-3 text-xs text-slate-400">{data.profit.note}</p>
          </div>

          {data.campaigns.length === 0 ? (
            <EmptyState title={t("analytics.anEmptyTitle")} description={t("analytics.anEmptyDesc")} />
          ) : (
            <div className="overflow-hidden card">
              <table className="w-full text-left text-sm">
                <thead className="bg-slate-50 text-slate-500"><tr>
                  <th className="px-4 py-3">Campaign</th><th className="px-4 py-3">Platform / Source</th><th className="px-4 py-3">Spend</th>
                  <th className="px-4 py-3">Clicks</th><th className="px-4 py-3">CTR</th><th className="px-4 py-3">Conv. (Platform)</th>
                  <th className="px-4 py-3">CPA</th><th className="px-4 py-3">ROAS (Platform)</th>
                </tr></thead>
                <tbody>
                  {data.campaigns.map((c, i) => (
                    <tr key={i} className="border-t">
                      <td className="px-4 py-3 font-medium">{c.campaignName ?? c.campaignExternalId ?? "(Account level)"}</td>
                      <td className="px-4 py-3 capitalize">{c.platform} · {c.source}</td>
                      <td className="px-4 py-3">{fmtMoney(c.spendMinor)}</td>
                      <td className="px-4 py-3">{fmtNumber(locale, c.clicks)}</td>
                      <td className="px-4 py-3">{c.ctrPercent === null ? "—" : `${c.ctrPercent}%`}</td>
                      <td className="px-4 py-3">{fmtNumber(locale, c.platformConversions)}</td>
                      <td className="px-4 py-3">{c.cpaMinor === null ? "—" : fmtMoney(String(Math.round(c.cpaMinor)))}</td>
                      <td className="px-4 py-3">{fmtRatio(c.platformRoas)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </>
      ) : null}
      <CreativeSection />
      <LeaderboardSection />
      <PacingSection />
      <AbSection />
      <ShareLinksCard />
    </div>
  );
}
