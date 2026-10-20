"use client";
import React, { useEffect, useState } from "react";
import Link from "next/link";
import { apiFetch } from "@/lib/api";
import { getOrganizationId } from "@/lib/org";
import { fmtDate, fmtDateTime, fmtMoneyMinor, fmtNumber, shopSubdomainHost } from "@repo/contracts";
import { useLocale } from "@/lib/i18n/provider";
import type { Overview } from "@/components/analytics-shared";

interface ReportLite { id: string; title: string; provider: string; createdAt: string }
interface AnomalyResult { anomalies: { severity: string; message: string }[]; sufficientData: boolean }
interface OnboardingState { steps: { key: string; label: string; done: boolean; href: string }[]; completed: number; total: number; allDone: boolean }
interface OrgLite { name?: string; brandName?: string | null; slug?: string }

function OnboardingCard() {
  const { dict, t } = useLocale();
  const [state, setState] = useState<OnboardingState | null>(null);
  useEffect(() => {
    const orgId = getOrganizationId();
    if (!orgId) return;
    apiFetch<OnboardingState>(`/organizations/${orgId}/onboarding`).then(setState).catch(() => undefined);
  }, []);
  if (!state || state.allDone) return null;
  return (
    <div className="card p-5" style={{ borderColor: "var(--brand-ring)", background: "linear-gradient(180deg, var(--brand-soft), #ffffff 60%)" }}>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="section-title flex items-center gap-2">
          <span className="stat-icon stat-icon-brand !h-9 !w-9 !rounded-xl text-base">🚀</span>
          {dict.shell.homeChecklistTitle}
        </div>
        <span className="badge-brand">{t("shell.homeChecklistDone", { completed: state.completed, total: state.total })}</span>
      </div>
      <div className="mt-3 h-2 w-full overflow-hidden rounded-full bg-white ring-1 ring-inset ring-slate-200/70">
        <div className="h-full rounded-full transition-[width] duration-500" style={{ width: `${state.total ? (state.completed / state.total) * 100 : 0}%`, backgroundImage: "linear-gradient(90deg, var(--brand-from), var(--brand-to))" }} />
      </div>
      <div className="mt-3 grid gap-2 sm:grid-cols-2">
        {state.steps.map((s) => (
          <a key={s.key} href={s.href} className={`flex min-h-[44px] items-center gap-2 rounded-xl px-3 py-2 text-sm ring-1 transition ${s.done ? "bg-white/60 text-slate-500 ring-emerald-200" : "bg-white font-medium text-slate-800 ring-slate-200 hover:ring-brand-300"}`}>
            <span>{s.done ? "✅" : "⬜"}</span>
            <span className={s.done ? "line-through decoration-slate-300" : ""}>{s.label}</span>
          </a>
        ))}
      </div>
      <p className="mt-3 text-xs text-slate-500">{dict.shell.homeChecklistNote}</p>
    </div>
  );
}

/**
 * Design v2: revenue vs ad-spend chart drawn as inline SVG from the
 * overview payload's OWN dailySeries (same 7 days as the KPI cards).
 * No chart library, no derived/invented points — every dot is a day
 * the API returned, with its real values in the tooltip.
 */
function RevenueChart({ data }: { data: Overview }) {
  const { dict, t, locale } = useLocale();
  const series = data.dailySeries;
  const money = (minor: bigint) => fmtMoneyMinor(locale, minor);
  const W = 720, H = 230, padL = 10, padR = 10, padT = 18, padB = 26;
  const plotW = W - padL - padR, plotH = H - padT - padB;
  const values = series.map((d) => ({ rev: Number(BigInt(d.revenueMinor)), spend: Number(BigInt(d.spendMinor)) }));
  const max = Math.max(0, ...values.flatMap((v) => [v.rev, v.spend]));
  if (series.length === 0 || max === 0) {
    return (
      <div className="card p-5">
        <div className="section-title">{dict.shell.homeChartTitle}</div>
        <p className="mt-2 text-sm text-slate-500">{dict.shell.homeChartEmpty}</p>
      </div>
    );
  }
  const x = (i: number) => padL + (series.length === 1 ? plotW / 2 : (i / (series.length - 1)) * plotW);
  const y = (v: number) => padT + plotH - (v / max) * plotH;
  const line = (pick: (v: { rev: number; spend: number }) => number) =>
    values.map((v, i) => `${i === 0 ? "M" : "L"}${x(i).toFixed(1)},${y(pick(v)).toFixed(1)}`).join(" ");
  const area = `${line((v) => v.rev)} L${x(values.length - 1).toFixed(1)},${(padT + plotH).toFixed(1)} L${x(0).toFixed(1)},${(padT + plotH).toFixed(1)} Z`;
  return (
    <div className="card p-5">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="section-title">{dict.shell.homeChartTitle}</div>
        <div className="flex items-center gap-4 text-xs text-slate-500">
          <span className="inline-flex items-center gap-1.5"><span className="h-2 w-2 rounded-full bg-emerald-500" /> Revenue</span>
          <span className="inline-flex items-center gap-1.5"><span className="h-2 w-2 rounded-full bg-red-400" /> Ad Spend</span>
          <span className="hidden sm:inline">{dict.shell.homeChartMaxDay} {money(BigInt(Math.round(max)))}</span>
        </div>
      </div>
      <div className="mt-3 overflow-x-auto">
        <svg viewBox={`0 0 ${W} ${H}`} className="min-w-[520px] w-full" role="img" aria-label={dict.shell.homeChartAria}>
          {[0.25, 0.5, 0.75, 1].map((f) => (
            <line key={f} x1={padL} x2={W - padR} y1={padT + plotH - plotH * f} y2={padT + plotH - plotH * f} stroke="#e2e8f0" strokeDasharray="4 5" strokeWidth="1" />
          ))}
          <line x1={padL} x2={W - padR} y1={padT + plotH} y2={padT + plotH} stroke="#cbd5e1" strokeWidth="1" />
          <path d={area} fill="var(--brand-from)" opacity="0.10" />
          <path d={line((v) => v.rev)} fill="none" stroke="#059669" strokeWidth="2.5" strokeLinejoin="round" strokeLinecap="round" />
          <path d={line((v) => v.spend)} fill="none" stroke="#f87171" strokeWidth="2" strokeDasharray="6 4" strokeLinejoin="round" strokeLinecap="round" />
          {series.map((d, i) => (
            <g key={d.date}>
              <circle cx={x(i)} cy={y(values[i].rev)} r="3.5" fill="#059669" stroke="#fff" strokeWidth="1.5">
                <title>{t("shell.homeChartTip", { date: d.date, orders: fmtNumber(locale, d.orders), revenue: money(BigInt(d.revenueMinor)), spend: money(BigInt(d.spendMinor)) })}</title>
              </circle>
              <text x={x(i)} y={H - 6} textAnchor="middle" fontSize="11" fill="#94a3b8">{d.date.slice(5)}</text>
            </g>
          ))}
        </svg>
      </div>
    </div>
  );
}

const QUICK_ACTIONS = [
  { href: "/dashboard/inbox", icon: "💬", labelKey: "homeQuickInbox" },
  { href: "/dashboard/campaign-builder", icon: "🎯", labelKey: "homeQuickCampaign" },
  { href: "/dashboard/orders", icon: "📦", labelKey: "homeQuickOrders" },
  { href: "/dashboard/ai", icon: "🤖", labelKey: "homeQuickAi" },
] as const;

function greetingKey(): "greetMorning" | "greetNoon" | "greetAfternoon" | "greetEvening" {
  const h = new Date().getHours();
  if (h < 12) return "greetMorning";
  if (h < 17) return "greetNoon";
  if (h < 21) return "greetAfternoon";
  return "greetEvening";
}

export default function OverviewPage() {
  const { dict, t, locale } = useLocale();
  const [data, setData] = useState<Overview | null>(null);
  const [report, setReport] = useState<ReportLite | null>(null);
  const [anomalies, setAnomalies] = useState<AnomalyResult | null>(null);
  const [org, setOrg] = useState<OrgLite | null>(null);
  const [error, setError] = useState("");

  useEffect(() => {
    const orgId = getOrganizationId();
    if (!orgId) { setError(dict.shell.homeNoOrgError); return; }
    const to = new Date(); const from = new Date(Date.now() - 6 * 86400000);
    const f = (d: Date) => d.toISOString().slice(0, 10);
    apiFetch<Overview>(`/organizations/${orgId}/analytics/overview?from=${f(from)}&to=${f(to)}`).then(setData).catch((e) => setError(e instanceof Error ? e.message : "Failed"));
    apiFetch<ReportLite[]>(`/organizations/${orgId}/ai/reports`).then((r) => setReport(r[0] ?? null)).catch(() => undefined);
    apiFetch<AnomalyResult>(`/organizations/${orgId}/ai/anomalies?days=14`).then(setAnomalies).catch(() => undefined);
    // Same org endpoint the shell itself uses — hero shows the org's
    // real (white-label) name, never a placeholder.
    apiFetch<OrgLite>(`/organizations/${orgId}`).then(setOrg).catch(() => undefined);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const money = (minor: string) => fmtMoneyMinor(locale, BigInt(minor));
  const orgName = org?.brandName ?? org?.name ?? dict.shell.homeWorkspaceFallback;
  const today = fmtDate(locale, new Date(), { weekday: true });
  const topCampaigns = data ? [...data.campaigns].sort((a, b) => Number(BigInt(b.spendMinor) - BigInt(a.spendMinor))).slice(0, 5) : [];

  return (
    <div className="space-y-5">
      {/* Hero / welcome strip */}
      <section className="hero-panel p-5 sm:p-7">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0">
            <div className="text-sm font-medium text-white/80">{dict.shell[greetingKey()]} 👋</div>
            <h1 className="mt-1 truncate text-2xl font-bold tracking-tight sm:text-[28px]">{orgName}</h1>
            <p className="mt-1 text-sm text-white/75">{today} · {dict.shell.homeHeroSummarySuffix}</p>
          </div>
          <span className="hero-chip">📊 Overview</span>
        </div>
        <div className="mt-5 grid grid-cols-2 gap-2.5 sm:flex sm:flex-wrap">
          {QUICK_ACTIONS.map((a) => (
            <Link key={a.href} href={a.href} className="quick-action">
              <span className="text-base leading-none">{a.icon}</span>
              <span className="truncate">{dict.shell[a.labelKey]}</span>
            </Link>
          ))}
          {/* TD8: the shop's public address is its tenant subdomain. */}
          {org?.slug ? (
            <a href={`https://${shopSubdomainHost(org.slug)}`} target="_blank" rel="noreferrer" className="quick-action">
              <span className="text-base leading-none">🛍️</span>
              <span className="truncate">{dict.shell.homeViewShop}</span>
            </a>
          ) : null}
        </div>
      </section>

      {error ? <div className="alert alert-red"><span>⚠️</span><span>{error}</span></div> : null}
      <OnboardingCard />

      {/* KPI stat cards */}
      {data ? (
        <div className="grid grid-cols-1 gap-4 min-[420px]:grid-cols-2 xl:grid-cols-4">
          <div className="stat-card">
            <div className="flex items-start justify-between gap-3">
              <div>
                <div className="stat-label">{t("shell.homeRevenueLabel", { days: fmtNumber(locale, 7) })}</div>
                <div className="stat-value">{money(data.totals.revenueMinor)}</div>
                <div className="stat-hint">{t("shell.homeOrdersFrom", { count: fmtNumber(locale, data.totals.orders) })}</div>
              </div>
              <span className="stat-icon stat-icon-green" aria-hidden>
                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="2" y="6" width="20" height="12" rx="2" /><circle cx="12" cy="12" r="2.5" /><path d="M6 12h.01M18 12h.01" /></svg>
              </span>
            </div>
          </div>
          <div className="stat-card">
            <div className="flex items-start justify-between gap-3">
              <div>
                <div className="stat-label">{t("shell.homeOrdersLabel", { days: fmtNumber(locale, 7) })}</div>
                <div className="stat-value">{fmtNumber(locale, data.totals.orders)}</div>
                <div className="stat-hint">{t("shell.homeAvgOrder", { amount: money(data.totals.averageOrderValueMinor) })}</div>
              </div>
              <span className="stat-icon stat-icon-brand" aria-hidden>
                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M6 3h12l1.5 13.5a2 2 0 0 1-2 2.5h-11a2 2 0 0 1-2-2.5L6 3Z" /><path d="M9 10V6a3 3 0 0 1 6 0v4" /></svg>
              </span>
            </div>
          </div>
          <div className="stat-card">
            <div className="flex items-start justify-between gap-3">
              <div>
                <div className="stat-label">{t("shell.homeAdSpendLabel", { days: fmtNumber(locale, 7) })}</div>
                <div className="stat-value">{money(data.totals.adSpendMinor)}</div>
                <div className="stat-hint">{data.kpis.mer === null ? dict.shell.homeMerMissing : t("shell.homeMerHint", { mer: data.kpis.mer })}</div>
              </div>
              <span className="stat-icon stat-icon-amber" aria-hidden>
                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="m3 11 18-7-4 16-6-4-3 5v-6L3 11Z" /><path d="M11 16 21 4" /></svg>
              </span>
            </div>
          </div>
          <div className="stat-card">
            <div className="flex items-start justify-between gap-3">
              <div>
                <div className="stat-label">Contribution Profit</div>
                <div className="stat-value">{money(data.profit.contributionProfitMinor)}</div>
                <div className="stat-hint">{t("shell.homeCogsCoverage", { percent: fmtNumber(locale, data.profit.cogsCoverage.percent) })}</div>
              </div>
              <span className="stat-icon stat-icon-sky" aria-hidden>
                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M3 17l6-6 4 4 8-8" /><path d="M14 7h7v7" /></svg>
              </span>
            </div>
          </div>
        </div>
      ) : !error ? (
        <div className="grid grid-cols-1 gap-4 min-[420px]:grid-cols-2 xl:grid-cols-4" aria-label={dict.common.loading}>
          {[0, 1, 2, 3].map((i) => (
            <div key={i} className="card p-5">
              <div className="skeleton h-3 w-24" />
              <div className="skeleton mt-3 h-8 w-32" />
              <div className="skeleton mt-3 h-3 w-20" />
            </div>
          ))}
        </div>
      ) : null}

      {data ? <RevenueChart data={data} /> : null}

      <div className="grid gap-4 lg:grid-cols-2">
        <div className="card p-5">
          <div className="flex items-center justify-between gap-2">
            <div className="section-title flex items-center gap-2">
              <span className="stat-icon stat-icon-sky !h-9 !w-9 !rounded-xl text-base">📄</span>
              {dict.shell.homeLatestReport}
            </div>
            <Link className="text-sm font-semibold text-brand-600 hover:underline" href="/dashboard/reports">Reports →</Link>
          </div>
          {report ? (
            <div className="mt-3 text-sm">
              <div className="font-medium text-slate-800">{report.title}</div>
              <div className="mt-0.5 text-slate-400">{fmtDateTime(locale, report.createdAt)} · {report.provider === "dev-template" ? "Dev Template" : report.provider}</div>
            </div>
          ) : <p className="mt-3 text-sm text-slate-500">{dict.shell.homeNoReport}</p>}
        </div>
        <div className="card p-5">
          <div className="flex items-center justify-between gap-2">
            <div className="section-title flex items-center gap-2">
              <span className="stat-icon stat-icon-amber !h-9 !w-9 !rounded-xl text-base">🔎</span>
              Anomaly
            </div>
            <Link className="text-sm font-semibold text-brand-600 hover:underline" href="/dashboard/ai">AI Assistant →</Link>
          </div>
          {anomalies ? (
            anomalies.sufficientData ? (
              anomalies.anomalies.length ? (
                <ul className="mt-3 space-y-1.5">{anomalies.anomalies.map((a, i) => <li key={i} className="rounded-xl bg-amber-50 px-3 py-2 text-sm text-amber-900 ring-1 ring-inset ring-amber-200/70">[{a.severity}] {a.message}</li>)}</ul>
              ) : <p className="mt-3 text-sm text-slate-500">{dict.shell.homeAnomalyNone}</p>
            ) : <p className="mt-3 text-sm text-slate-500">{dict.shell.homeAnomalyLowData}</p>
          ) : <p className="mt-3 text-sm text-slate-500">{dict.shell.homeAnomalyUnknown}</p>}
        </div>
      </div>

      {data && topCampaigns.length > 0 ? (
        <div className="card p-5">
          <div className="flex items-center justify-between gap-2">
            <div className="section-title">{t("shell.homeTopCampaigns", { days: fmtNumber(locale, 7) })}</div>
            <Link className="text-sm font-semibold text-brand-600 hover:underline" href="/dashboard/campaigns">{dict.shell.homeAllCampaigns}</Link>
          </div>
          <ul className="mt-3 divide-y divide-slate-100">
            {topCampaigns.map((c) => (
              <li key={`${c.platform}-${c.campaignExternalId}`} className="flex flex-wrap items-center gap-x-4 gap-y-1 py-2.5 text-sm">
                <span className="min-w-0 flex-1 truncate font-medium text-slate-800">{c.campaignName ?? c.campaignExternalId}</span>
                <span className="badge-slate">{c.platform}</span>
                <span className="text-slate-500">{dict.shell.homeSpendLabel} <b className="text-slate-800">{money(c.spendMinor)}</b></span>
                <span className="text-slate-500">ROAS <b className="text-slate-800">{c.platformRoas === null ? "—" : c.platformRoas}</b></span>
              </li>
            ))}
          </ul>
        </div>
      ) : null}
    </div>
  );
}
