"use client";
import React from "react";
import AdminShell from "@/components/AdminShell";
import { EmptyState, ErrorState, PageHead } from "@/components/ui";
import { useNavCounts, presentCounts } from "@/components/useNavCounts";
import type { NavCounts } from "@/components/nav";
import { apiFetch, formatMinorStr } from "@/lib/api";
import { fmtDateTime } from "@/lib/dates";
import { fmtNumber, type UiLocale } from "@repo/contracts";
import { useAdminLocale } from "@/components/AdminLocale";

interface Overview {
  organizations: number; users: number; newOrganizations30d: number; newUsers30d: number;
  monthOrders: number; monthOrderRevenueMinor: string; monthAdSpendMinor: string;
  monthAiCalls: number; monthAiTokens: number; failedSyncJobs24h: number; failedAutomationRuns24h: number;
  recentAdminActions: { id: string; action: string; entityType: string; entityId?: string | null; createdAt: string }[];
}

interface SeriesMonth { month: string; collectedMinor: string; newOrgs: number; newUsers: number; newSubscriptions: number; orders: number; orderRevenueMinor: string }
interface Series { months: SeriesMonth[] }

/** RB6/RM12: platform storage overview (StoredFile registry). */
interface StorageSplit { objects: number; bytes: string }
interface StorageOverview {
  mode: "s3" | "local"; registryAvailable: boolean;
  totalObjects: number; totalBytes: string;
  trashedObjects: number; trashedBytes: string;
  byBucket: ({ bucket: string } & StorageSplit)[];
  byVisibility: ({ visibility: string } & StorageSplit)[];
  bySurface: ({ surface: string } & StorageSplit)[];
  topOrgs: { organizationId: string; name: string | null; objects: number; bytes: string }[];
  truncated: boolean;
}

/** Decimal-string bytes -> human size (registry sums are BigInt
 *  strings; formatting must never go through a lossy Number for
 *  the integer part — TB-scale tenants stay exact). */
function formatBytes(bytes: string, locale: UiLocale): string {
  let v: bigint;
  try { v = BigInt(bytes); } catch { return "—"; }
  const units = ["B", "KB", "MB", "GB", "TB"];
  let u = 0;
  let scaled = v;
  while (scaled >= 1024n && u < units.length - 1) { scaled = scaled / 1024n; u += 1; }
  if (u === 0) return `${fmtNumber(locale, Number(v))} B`;
  // One decimal from the remainder, integer math only.
  let rem = v;
  for (let i = 0; i < u - 1; i += 1) rem = rem / 1024n;
  const tenth = Number((rem % 1024n) * 10n / 1024n);
  return `${fmtNumber(locale, Number(scaled))}.${fmtNumber(locale, tenth)} ${units[u]}`;
}

/** ADX5: TODAY row config — one card per nav-counts field, each
 *  linking to its queue page. Same labels as the Attention Bell. */
const TODO_ROWS: Record<keyof NavCounts, { labelKey: string; href: string; hintKey: string }> = {
  pendingPayouts: { labelKey: "overview.todoPendingPayouts", href: "/payouts", hintKey: "overview.todoPendingHint" },
  openTickets: { labelKey: "overview.todoOpenTickets", href: "/tickets", hintKey: "overview.todoOpenTicketsHint" },
  failedJobs24h: { labelKey: "overview.todoFailedJobs", href: "/health", hintKey: "overview.todoFailedJobsHint" },
  activeAlerts: { labelKey: "overview.todoActiveAlerts", href: "/alerts", hintKey: "overview.todoActiveAlertsHint" },
  overdueSubscriptions: { labelKey: "overview.todoOverdue", href: "/billing", hintKey: "overview.todoOverdueHint" },
};

/** Task-first order (ADX5): fix problems → pay out → bill → guard → configure. */
const QUICK_ACTIONS = [
  { icon: "💚", labelKey: "overview.qaHealth", subKey: "overview.qaHealthSub", href: "/health" },
  { icon: "🏦", labelKey: "overview.qaPayouts", subKey: "overview.qaPayoutsSub", href: "/payouts" },
  { icon: "💳", labelKey: "overview.qaBilling", subKey: "overview.qaBillingSub", href: "/billing" },
  { icon: "🔐", labelKey: "overview.qaSecurity", subKey: "overview.qaSecuritySub", href: "/security" },
  { icon: "⚙️", labelKey: "overview.qaConfig", subKey: "overview.qaConfigSub", href: "/settings" },
];

export default function OverviewPage() {
  const { dict, locale, t } = useAdminLocale();
  const [data, setData] = React.useState<Overview | null>(null);
  const [dbOk, setDbOk] = React.useState<boolean | null>(null);
  const [error, setError] = React.useState("");
  const [series, setSeries] = React.useState<Series | null>(null);
  const [storage, setStorage] = React.useState<StorageOverview | null>(null);
  const counts = useNavCounts();
  // ADNX7: storage section collapse, persisted like every other
  // shell preference (guarded storage — private mode degrades to
  // the default, expanded, as before).
  const [storageOpen, setStorageOpen] = React.useState(true);
  React.useEffect(() => {
    try { const v = localStorage.getItem("admin_overview_storage_open"); if (v !== null) setStorageOpen(v === "1"); } catch { /* ignore */ }
  }, []);
  const toggleStorage = () => setStorageOpen((o) => {
    try { localStorage.setItem("admin_overview_storage_open", o ? "0" : "1"); } catch { /* ignore */ }
    return !o;
  });
  // ADX12: the load is a named callback so the error state can
  // offer a real retry (before, an overview failure was terminal
  // until a manual page reload).
  const loadAll = React.useCallback(() => {
    setError("");
    apiFetch<Overview>("/admin/overview").then(setData).catch((e) => setError(e.message));
    apiFetch<{ db: string }>("/admin/health").then((h) => setDbOk(h.db === "ok")).catch(() => setDbOk(false));
    // ADX5 comparison source: M37's monthly buckets. Failure simply
    // means no previous-month reference is shown (never invented).
    apiFetch<Series>("/admin/analytics/series?months=3").then(setSeries).catch(() => setSeries(null));
    // RM12 storage card: a failed/absent registry simply hides
    // the card — storage numbers are never invented.
    apiFetch<StorageOverview>("/admin/storage-overview").then(setStorage).catch(() => setStorage(null));
  }, []);
  React.useEffect(() => { loadAll(); }, [loadAll]);

  // Previous-month reference — ONLY for orders/revenue, the two
  // overview figures whose definitions match the series buckets
  // exactly (calendar-month, cancelled/refunded excluded). The
  // current month is incomplete, so this is shown as a plain
  // reference value ("গত মাস: …"), never as a % change or trend.
  const nowD = new Date();
  const curKey = `${nowD.getUTCFullYear()}-${String(nowD.getUTCMonth() + 1).padStart(2, "0")}`;
  const curIdx = series ? series.months.findIndex((m) => m.month === curKey) : -1;
  const prevMonth = series && curIdx > 0 ? series.months[curIdx - 1] : null;

  const todoPresent = presentCounts(counts);

  const failedTotal = data ? data.failedSyncJobs24h + data.failedAutomationRuns24h : 0;
  const cards = data ? [
    { icon: "🏢", label: dict.overview.cardTotalOrgs, value: fmtNumber(locale, data.organizations), sub: t("overview.newIn30d", { count: fmtNumber(locale, data.newOrganizations30d) }) },
    { icon: "👤", label: dict.overview.cardTotalUsers, value: fmtNumber(locale, data.users), sub: t("overview.newIn30d", { count: fmtNumber(locale, data.newUsers30d) }) },
    { icon: "🧾", label: dict.overview.cardMonthOrders, value: fmtNumber(locale, data.monthOrders), sub: t("overview.monthOrdersSub", { revenue: formatMinorStr(data.monthOrderRevenueMinor, locale) }), cmp: prevMonth ? t("overview.prevMonth", { orders: fmtNumber(locale, prevMonth.orders), revenue: formatMinorStr(prevMonth.orderRevenueMinor, locale) }) : undefined },
    { icon: "📣", label: dict.overview.cardAdSpend, value: formatMinorStr(data.monthAdSpendMinor, locale), sub: dict.overview.adSpendSub },
    { icon: "🤖", label: dict.overview.cardAiUsage, value: t("overview.aiCallsValue", { count: fmtNumber(locale, data.monthAiCalls) }), sub: t("overview.aiTokensSub", { count: fmtNumber(locale, data.monthAiTokens) }) },
    { icon: failedTotal > 0 ? "⚠️" : "✅", label: dict.overview.cardFailedJobs, value: fmtNumber(locale, failedTotal), sub: t("overview.failedJobsSub", { sync: fmtNumber(locale, data.failedSyncJobs24h), automation: fmtNumber(locale, data.failedAutomationRuns24h) }) },
  ] : [];

  const today = fmtDateTime(locale, new Date(), "date", { weekday: true });

  return (
    <AdminShell title={dict.overview.title}>
      {/* ADNX7: PageHead adoption (first adopter) — the shell owns
          the h1, so PageHead carries the sub-line + the page's
          status badges as its actions. */}
      <PageHead sub={dict.overview.sub}>
        <span className={dbOk === null ? "abadge-slate" : dbOk ? "abadge-green" : "abadge-red"}>
          {dbOk === null ? dict.overview.dbChecking : dbOk ? dict.overview.dbConnected : dict.overview.dbProblem}
        </span>
        <span className="abadge-indigo">{dict.overview.apiRunning}</span>
        {data ? (
          <span className={failedTotal > 0 ? "abadge-amber" : "abadge-green"}>
            {failedTotal > 0 ? t("overview.failedJobsBadge", { count: fmtNumber(locale, failedTotal) }) : dict.overview.noFailedJobsBadge}
          </span>
        ) : null}
      </PageHead>
      {/* Hero strip */}
      <div className="acard mb-5 flex flex-wrap items-center gap-4 overflow-hidden !p-5">
        <div className="min-w-0">
          <div className="text-lg font-bold tracking-tight">{dict.overview.heroTitle}</div>
          <div className="mt-0.5 text-sm text-slate-400">{t("overview.heroSub", { date: today })}</div>
        </div>
      </div>

      {/* ADX5: আজকের করণীয় — one card per AVAILABLE nav-count.
          When nav-counts is unavailable the whole row is absent:
          unknown is never dressed up as an all-clear. A genuine 0
          shows the calm state of that queue. */}
      {todoPresent.length > 0 ? (
        <div className="mb-5">
          <div className="mb-2.5 text-sm font-semibold text-slate-300">{dict.overview.todayTodo}</div>
          <div className="flex snap-x snap-mandatory gap-3 overflow-x-auto pb-1 sm:grid sm:snap-none sm:grid-cols-2 sm:overflow-visible sm:pb-0 xl:grid-cols-5">
            {todoPresent.map(([key, value]) => {
              const row = TODO_ROWS[key];
              const calm = value === 0;
              return (
                <a key={key} href={row.href} className={`acard acard-hover block min-w-[228px] snap-start !p-4 sm:min-w-0 ${calm ? "" : "border-red-500/40"}`}>
                  <div className="text-xs font-medium uppercase tracking-wide text-slate-400">{t(row.labelKey)}</div>
                  <div className={`mt-1.5 text-[26px] font-bold leading-none tracking-tight ${calm ? "text-emerald-300" : "text-red-300"}`}>{fmtNumber(locale, value)}</div>
                  <div className="mt-1.5 text-xs text-slate-400">{calm ? dict.overview.nothingLeft : t(row.hintKey)} →</div>
                </a>
              );
            })}
          </div>
        </div>
      ) : null}

      {error ? <div className="mb-4"><ErrorState message={error} onRetry={loadAll} /></div> : null}

      {/* KPI cards */}
      {!data && !error ? (
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
          {Array.from({ length: 6 }).map((_, i) => <div key={i} className="askel-card" />)}
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
              <div className="mt-1.5 text-xs text-slate-400">{c.sub}</div>
              {"cmp" in c && c.cmp ? <div className="mt-1 text-xs font-medium text-slate-400">↔ {c.cmp}</div> : null}
            </div>
          ))}
        </div>
      )}

      {/* ADNX4: full-page skeleton — the lower blocks also get a
          skeleton on first load (before, only the KPI grid did). */}
      {!data && !error ? (
        <div className="mt-5 grid gap-4 xl:grid-cols-[1.6fr_1fr]" aria-hidden="true">
          <div className="askel h-56" /><div className="askel h-56" />
        </div>
      ) : null}

      {/* RB6/RM12: Storage card — StoredFile registry totals.
          Hidden entirely when the overview cannot be loaded. */}
      {storage && storage.registryAvailable ? (
        <div className="acard mt-5">
          <div className="mb-3 flex flex-wrap items-center gap-2">
            <button type="button" className="font-semibold" aria-expanded={storageOpen} onClick={toggleStorage}>{dict.overview.storageTitle} {storageOpen ? "▲" : "▼"}</button>
            {storage.mode === "s3" ? (
              <span className="abadge-green">{dict.overview.storageR2}</span>
            ) : (
              <span className="abadge-amber">{dict.overview.storageLocal}</span>
            )}
            {storage.truncated ? <span className="abadge-slate">{dict.overview.storagePartial}</span> : null}
            <span className="ml-auto text-xs text-slate-400">{dict.overview.storageSource}</span>
          </div>
          {storageOpen ? (
          <>
          <div className="grid gap-4 sm:grid-cols-3">
            <div>
              <div className="text-xs font-medium uppercase tracking-wide text-slate-400">{dict.overview.totalFiles}</div>
              <div className="mt-1 text-[22px] font-bold leading-none">{fmtNumber(locale, storage.totalObjects)}</div>
              <div className="mt-1.5 text-xs text-slate-400">{t("overview.totalSize", { size: formatBytes(storage.totalBytes, locale) })}</div>
            </div>
            <div>
              <div className="text-xs font-medium uppercase tracking-wide text-slate-400">{dict.overview.publicPrivate}</div>
              <div className="mt-1 text-sm text-slate-300">
                {storage.byVisibility.map((v) => (
                  <div key={v.visibility} className="flex justify-between gap-2 py-0.5">
                    <span className="text-slate-400">{v.visibility === "public" ? dict.overview.publicLabel : dict.overview.privateLabel}</span>
                    <span>{t("overview.filesCount", { count: fmtNumber(locale, v.objects) })} · {formatBytes(v.bytes, locale)}</span>
                  </div>
                ))}
                {storage.byVisibility.length === 0 ? <span className="text-slate-400">{dict.overview.noFiles}</span> : null}
              </div>
            </div>
            <div>
              <div className="text-xs font-medium uppercase tracking-wide text-slate-400">{dict.overview.topOrgs}</div>
              <div className="mt-1 text-sm text-slate-300">
                {storage.topOrgs.slice(0, 5).map((o) => (
                  <div key={o.organizationId} className="flex justify-between gap-2 py-0.5">
                    <span className="min-w-0 truncate text-slate-400">{o.name ?? o.organizationId.slice(0, 8)}</span>
                    <span className="shrink-0">{formatBytes(o.bytes, locale)}</span>
                  </div>
                ))}
                {storage.topOrgs.length === 0 ? <span className="text-slate-400">{dict.overview.noData}</span> : null}
              </div>
            </div>
          </div>
          {storage.trashedObjects > 0 ? (
            <div className="mt-3 border-t border-slate-800 pt-2.5 text-xs text-slate-400">
              {t("overview.trashedLine", { count: fmtNumber(locale, storage.trashedObjects), size: formatBytes(storage.trashedBytes, locale) })}
            </div>
          ) : null}
          </>
          ) : null}
        </div>
      ) : null}

      <div className="mt-5 grid gap-4 xl:grid-cols-[1.6fr_1fr]">
        {/* Recent admin activity — timeline */}
        <div className="acard">
          <div className="mb-3 flex items-center justify-between">
            <div className="font-semibold">{dict.overview.recentActivity}</div>
            <a className="text-sm font-medium text-indigo-300 hover:text-indigo-200" href="/audit">{dict.overview.allAudit}</a>
          </div>
          {!data && !error ? (
              <div className="space-y-2.5" aria-hidden="true"><div className="askel-line" /><div className="askel-line" /><div className="askel-line" /><div className="askel-line" /></div>
            ) : !data ? null
            : data.recentAdminActions.length === 0 ? <EmptyState title={dict.overview.noActionsTitle} sub={dict.overview.noActionsSub} /> : (
              <ol className="relative space-y-0 border-l border-slate-800 pl-5">
                {data.recentAdminActions.map((a) => (
                  <li key={a.id} className="relative pb-4 last:pb-0">
                    <span className="absolute -left-[23.5px] top-1.5 h-2 w-2 rounded-full bg-indigo-400 ring-4 ring-indigo-400/15" />
                    <div className="flex flex-wrap items-baseline justify-between gap-2">
                      <span className="text-sm font-medium">{a.action}
                        <span className="ml-1.5 font-normal text-slate-400">({a.entityType}{a.entityId ? ` · ${a.entityId.slice(0, 8)}…` : ""})</span>
                      </span>
                      <span className="text-xs text-slate-400">{fmtDateTime(locale, a.createdAt)}</span>
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
              <div className="font-semibold text-amber-300">{dict.overview.attentionTitle}</div>
              <p className="mt-1 text-sm text-slate-400">{t("overview.attentionBody", { total: fmtNumber(locale, failedTotal), sync: fmtNumber(locale, data.failedSyncJobs24h), automation: fmtNumber(locale, data.failedAutomationRuns24h) })}</p>
            </a>
          ) : data ? (
            <div className="acard border-emerald-500/30">
              <div className="font-semibold text-emerald-300">{dict.overview.allOkTitle}</div>
              <p className="mt-1 text-sm text-slate-400">{dict.overview.allOkBody}</p>
            </div>
          ) : null}
          <div className="acard">
            <div className="mb-3 font-semibold">{dict.overview.quickActions}</div>
            <div className="grid grid-cols-2 gap-2 xl:grid-cols-1">
              {QUICK_ACTIONS.map((qa) => (
                <a key={qa.href} href={qa.href} className="flex items-center gap-3 rounded-xl border border-slate-800 bg-slate-900/60 px-3.5 py-3 transition hover:border-indigo-500/50 hover:bg-slate-800/70">
                  <span className="text-lg">{qa.icon}</span>
                  <span className="min-w-0">
                    <span className="block truncate text-sm font-medium">{t(qa.labelKey)}</span>
                    <span className="block truncate text-xs text-slate-400">{t(qa.subKey)}</span>
                  </span>
                  <span className="ml-auto text-slate-400">→</span>
                </a>
              ))}
            </div>
          </div>
        </div>
      </div>
    </AdminShell>
  );
}
