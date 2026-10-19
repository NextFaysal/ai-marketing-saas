"use client";
import React from "react";
import AdminShell from "@/components/AdminShell";
import { API_URL, apiFetch, getAdminToken } from "@/lib/api";
import { EmptyState, ErrorState, PageHead, SavedViewsBar, SortableTh, useLastFilters, type SortDir } from "@/components/ui";
import { fmtNumber, type UiLocale } from "@repo/contracts";
import { useAdminLocale } from "@/components/AdminLocale";

interface Row { organizationId: string; name: string; status: string; aiCalls30d: number; aiTokens30d: number; deliveries30d: number; broadcastsTotal: number; workflowRuns30d: number; courierShipmentsTotal: number; orders30d: number; storageBytes: number; mediaAssets: number }

function formatBytes(n: number, locale: UiLocale): string {
  if (!n) return "0 B";
  if (n < 1024) return `${fmtNumber(locale, n)} B`;
  if (n < 1024 * 1024) return `${fmtNumber(locale, n / 1024, { minimumFractionDigits: 1, maximumFractionDigits: 1 })} KB`;
  if (n < 1024 * 1024 * 1024) return `${fmtNumber(locale, n / (1024 * 1024), { minimumFractionDigits: 1, maximumFractionDigits: 1 })} MB`;
  return `${fmtNumber(locale, n / (1024 * 1024 * 1024), { minimumFractionDigits: 1, maximumFractionDigits: 1 })} GB`;
}

export default function UsagePage() {
  const { dict, locale, t } = useAdminLocale();
  const [rows, setRows] = React.useState<Row[]>([]);
  // ADX12: loading + load-error states for the ranking table —
  // before, load-in-flight and load-failed both read as
  // "কোনো Organization নেই"।
  const [loading, setLoading] = React.useState(true);
  const [loadError, setLoadError] = React.useState("");
  const load = React.useCallback(async () => {
    setLoading(true); setLoadError("");
    try { setRows(await apiFetch<Row[]>("/admin/usage")); }
    catch (e) { setLoadError(e instanceof Error ? e.message : dict.usage.loadFailedFallback); }
    finally { setLoading(false); }
  }, [dict]);
  React.useEffect(() => { load(); }, [load]);
  // ADX11: per-org ranking — sortable by every numeric column,
  // client-side over the loaded rows only (default = server order).
  // Money verdict: neither this payload nor the ai-detail payload
  // carries a cost field, so this table ranks USAGE, not cost; the
  // money view stays on Analytics' operator-rate AI-cost board.
  const [sortKey, setSortKey] = React.useState("");
  const [sortDir, setSortDir] = React.useState<SortDir>("desc");
  const onSort = (k: string) => {
    if (sortKey === k) setSortDir(sortDir === "asc" ? "desc" : "asc");
    else { setSortKey(k); setSortDir("desc"); }
  };
  const shown = React.useMemo(() => {
    if (!sortKey) return rows;
    const f = (r: Row) => Number((r as unknown as Record<string, unknown>)[sortKey] ?? 0);
    return [...rows].sort((a, b) => (sortDir === "asc" ? f(a) - f(b) : f(b) - f(a)));
  }, [rows, sortKey, sortDir]);
  const th = (label: string, key: string) => <SortableTh label={label} sortKey={key} current={sortKey} dir={sortDir} onSort={onSort} />;
  return (
    <AdminShell title={dict.usage.title}>
      <PageHead sub={dict.usage.sub} />
      <p className="mb-3 text-sm text-slate-400">{dict.usage.intro}</p>
      <div className="acard overflow-hidden p-0">
        <table className="atable atable-sticky atable-cards atable-v3">
          <thead className="bg-slate-900"><tr><th className="ath">{dict.common.organization}</th>{th(dict.usage.colAiCalls, "aiCalls30d")}{th(dict.usage.colAiTokens, "aiTokens30d")}{th(dict.usage.colDeliveries, "deliveries30d")}{th(dict.usage.colBroadcast, "broadcastsTotal")}{th(dict.usage.colWorkflow, "workflowRuns30d")}{th(dict.usage.colCourier, "courierShipmentsTotal")}{th(dict.usage.colOrder, "orders30d")}{th(dict.usage.colStorage, "storageBytes")}</tr></thead>
          <tbody>{shown.map((r) => (
            <tr key={r.organizationId} className="border-t border-slate-800">
              <td data-label={dict.common.organization} className="atd"><a className="text-indigo-300 hover:underline" href={`/orgs/${r.organizationId}`}>{r.name}</a>{r.status !== "ACTIVE" ? <span className="abadge-amber ml-2">{r.status}</span> : null}</td>
              <td data-label={dict.usage.colAiCalls} className="atd">{fmtNumber(locale, r.aiCalls30d)}</td><td data-label={dict.usage.colAiTokens} className="atd">{fmtNumber(locale, r.aiTokens30d)}</td>
              <td data-label={dict.usage.colDeliveries} className="atd">{fmtNumber(locale, r.deliveries30d)}</td><td data-label={dict.usage.colBroadcast} className="atd">{fmtNumber(locale, r.broadcastsTotal)}</td>
              <td data-label={dict.usage.colWorkflow} className="atd">{fmtNumber(locale, r.workflowRuns30d)}</td><td data-label={dict.usage.colCourier} className="atd">{fmtNumber(locale, r.courierShipmentsTotal)}</td><td data-label={dict.usage.colOrder} className="atd">{fmtNumber(locale, r.orders30d)}</td>
              <td data-label={dict.usage.colStorage} className="atd">{formatBytes(r.storageBytes ?? 0, locale)}<span className="block text-xs text-slate-400">{t("usage.filesCount", { count: fmtNumber(locale, r.mediaAssets ?? 0) })}</span></td>
            </tr>
          ))}</tbody>
        </table>
        {loading && rows.length === 0 ? <div className="askel-table m-4" /> : null}
        {!loading && loadError ? <div className="p-4"><ErrorState message={t("usage.loadError", { message: loadError })} onRetry={load} /></div> : null}
        {!loading && !loadError && rows.length === 0 ? <EmptyState title={dict.usage.emptyTitle} sub={dict.usage.emptySub} /> : null}
      </div>
      <p className="mt-3 text-xs text-slate-400">{dict.usage.moneyNote}</p>
      <AiFeatureSection />
    </AdminShell>
  );
}

interface AiRow { organizationId: string; orgName: string; feature: string; calls: number; inputTokens: number; outputTokens: number; totalTokens: number; estimatedCalls: number }

/** AA7: AI usage drill-down — one row per organization x feature.
 * Tokens/calls only (money lives on the Analytics AI-cost board).
 * The org filter narrows the loaded rows client-side; if it is an
 * exact organizationId, the CSV export is scoped to that org too. */
function AiFeatureSection() {
  const { dict, locale, t } = useAdminLocale();
  const [days, setDays] = React.useState(30);
  const [rows, setRows] = React.useState<AiRow[]>([]);
  const [filter, setFilter] = React.useState("");
  const [loading, setLoading] = React.useState(false);
  // ADNX12: a failed ai-detail load gets its own error state —
  // before it silently became the "no records" text below.
  const [loadError, setLoadError] = React.useState("");

  const load = React.useCallback(async (d: number) => {
    setLoading(true); setLoadError("");
    try {
      const out = await apiFetch<{ days: number; rows: AiRow[] }>(`/admin/usage/ai-detail?days=${d}`);
      setRows(out?.rows ?? []);
    } catch (e) { setRows([]); setLoadError(e instanceof Error ? e.message : dict.usage.aiLoadFailedFallback); }
    finally { setLoading(false); }
  }, [dict]);
  React.useEffect(() => { load(days); }, [days, load]);
  // ADNX15: this section's filter state (day window + org text
  // filter) gains saved views and last-used persistence — the
  // main ranking table above has no filter state to save (sort
  // only), so it is intentionally not wired.
  const applyAiFilters = (s: Record<string, string>) => { setDays(Number(s.days) || 30); setFilter(s.filter ?? ""); };
  useLastFilters("usage-ai", { days: String(days), filter }, applyAiFilters);

  const f = filter.trim().toLowerCase();
  const filtered = f ? rows.filter((r) => r.orgName.toLowerCase().includes(f) || r.organizationId.toLowerCase().includes(f)) : rows;
  const [sortKey, setSortKey] = React.useState("");
  const [sortDir, setSortDir] = React.useState<SortDir>("desc");
  const onSort = (k: string) => {
    if (sortKey === k) setSortDir(sortDir === "asc" ? "desc" : "asc");
    else { setSortKey(k); setSortDir("desc"); }
  };
  const shown = React.useMemo(() => {
    if (!sortKey) return filtered;
    const g = (r: AiRow) => Number((r as unknown as Record<string, unknown>)[sortKey] ?? 0);
    return [...filtered].sort((a, b) => (sortDir === "asc" ? g(a) - g(b) : g(b) - g(a)));
  }, [filtered, sortKey, sortDir]);
  const th = (label: string, key: string) => <SortableTh label={label} sortKey={key} current={sortKey} dir={sortDir} onSort={onSort} />;

  async function downloadCsv() {
    const token = getAdminToken();
    const exact = rows.find((r) => r.organizationId === filter.trim());
    const qs = `days=${days}${exact ? `&organizationId=${encodeURIComponent(exact.organizationId)}` : ""}`;
    const res = await fetch(`${API_URL}/admin/usage/ai-detail/export.csv?${qs}`, { headers: token ? { Authorization: `Bearer ${token}` } : {} }).catch(() => null);
    if (!res || !res.ok) return;
    const blob = await res.blob();
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url; a.download = "ai-usage-by-feature.csv"; a.click();
    URL.revokeObjectURL(url);
  }

  return (
    <div className="mt-6">
      <div className="mb-3 flex flex-wrap items-center gap-3">
        <h2 className="text-base font-semibold">{dict.usage.aiTitle}</h2>
        <select className="ainput !w-auto px-2 py-1 text-sm" value={days} onChange={(e) => setDays(Number(e.target.value))}>
          <option value={7}>{dict.usage.last7}</option>
          <option value={30}>{dict.usage.last30}</option>
          <option value={90}>{dict.usage.last90}</option>
        </select>
        <input className="ainput px-2 py-1 text-sm sm:!w-64" placeholder={dict.usage.filterPlaceholder} value={filter} onChange={(e) => setFilter(e.target.value)} />
        <button className="abtn-secondary !px-3 !py-1.5 text-xs" onClick={downloadCsv}>{dict.usage.csvExport}</button>
        {loading ? <span className="text-xs text-slate-400">{dict.common.loadingEllipsis}</span> : null}
      </div>
      <div className="mb-3 rounded-xl border border-slate-800">
        <SavedViewsBar page="usage-ai" current={{ days: String(days), filter }} onApply={applyAiFilters} />
      </div>
      <div className="acard overflow-hidden p-0">
        <table className="atable atable-cards atable-v3">
          <thead className="bg-slate-900"><tr><th className="ath">{dict.common.organization}</th><th className="ath">{dict.usage.colFeature}</th>{th(dict.usage.colCalls, "calls")}{th(dict.usage.colInputTokens, "inputTokens")}{th(dict.usage.colOutputTokens, "outputTokens")}{th(dict.usage.colTotalTokens, "totalTokens")}{th(dict.usage.colEstimatedCalls, "estimatedCalls")}</tr></thead>
          <tbody>{shown.map((r) => (
            <tr key={`${r.organizationId}|${r.feature}`} className="border-t border-slate-800">
              <td data-label={dict.common.organization} className="atd"><a className="text-indigo-300 hover:underline" href={`/orgs/${r.organizationId}`}>{r.orgName}</a></td>
              <td data-label={dict.usage.colFeature} className="atd">{r.feature}</td>
              <td data-label={dict.usage.colCalls} className="atd">{fmtNumber(locale, r.calls)}</td>
              <td data-label={dict.usage.colInputTokens} className="atd">{fmtNumber(locale, r.inputTokens)}</td>
              <td data-label={dict.usage.colOutputTokens} className="atd">{fmtNumber(locale, r.outputTokens)}</td>
              <td data-label={dict.usage.colTotalTokens} className="atd">{fmtNumber(locale, r.totalTokens)}</td>
              <td data-label={dict.usage.colEstimatedCalls} className="atd">{r.estimatedCalls > 0 ? <span className="abadge-amber">{fmtNumber(locale, r.estimatedCalls)}</span> : fmtNumber(locale, 0)}</td>
            </tr>
          ))}</tbody>
        </table>
        {loading && shown.length === 0 ? <div className="askel-table m-4" /> : null}
        {!loading && loadError ? <div className="p-4"><ErrorState message={t("usage.aiLoadError", { message: loadError })} onRetry={() => load(days)} /></div> : null}
        {!loading && !loadError && shown.length === 0 ? <EmptyState title={dict.usage.aiEmptyTitle} /> : null}
      </div>
      <p className="mt-3 text-xs text-slate-400">{dict.usage.aiNote}</p>
    </div>
  );
}
