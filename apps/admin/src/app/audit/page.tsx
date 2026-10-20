"use client";
import React from "react";
import AdminShell from "@/components/AdminShell";
import { DetailDrawer, EmptyState, ErrorState, FilterBar, PageHead, SavedViewsBar, useLastFilters } from "@/components/ui";
import { API_URL, apiFetch, getAdminToken } from "@/lib/api";
import { fmtDateTime } from "@/lib/dates";
import { fmtNumber } from "@repo/contracts";
import { useAdminLocale } from "@/components/AdminLocale";

interface Row { id: string; action: string; entityType: string; entityId?: string | null; userId?: string | null; organizationId?: string | null; ipAddress?: string | null; createdAt: string; metadata?: Record<string, unknown> | null }

// ADNX10: action-prefix colour mapping on the ONE v4 status scale
// (globals --a-status-*): auth.* is security-sensitive → warning,
// admin.* is the console's own work → info, everything else →
// neutral. Presentation only — the action text itself is unchanged.
const actionBadge = (action: string) =>
  action.startsWith("auth.") ? "astatus-warning" : action.startsWith("admin.") ? "astatus-info" : "astatus-neutral";

export default function AuditPage() {
  const { dict, locale, t } = useAdminLocale();
  const [rows, setRows] = React.useState<Row[]>([]);
  const [prefix, setPrefix] = React.useState("admin.");
  const [organizationId, setOrganizationId] = React.useState("");
  // ADX10: actor filter — GET /admin/audit ইতিমধ্যে userId param
  // সমর্থন করে (controller-এ আছে); page আগে পাঠাত না, এখন পাঠায়।
  // CSV export-ও একই buildQuery ব্যবহার করে, তাই সেখানেও প্রযোজ্য।
  const [userId, setUserId] = React.useState("");
  const [drawerRow, setDrawerRow] = React.useState<Row | null>(null);
  const [entityType, setEntityType] = React.useState("");
  const [dateFrom, setDateFrom] = React.useState("");
  const [dateTo, setDateTo] = React.useState("");
  const [take, setTake] = React.useState("100");
  const buildQuery = React.useCallback((forExport: boolean) => {
    const params = new URLSearchParams();
    if (!forExport) params.set("take", take);
    if (prefix) params.set("action", prefix);
    if (organizationId.trim()) params.set("organizationId", organizationId.trim());
    if (userId.trim()) params.set("userId", userId.trim());
    if (entityType.trim()) params.set("entityType", entityType.trim());
    if (dateFrom) params.set("dateFrom", dateFrom);
    if (dateTo) params.set("dateTo", dateTo);
    return params.toString();
  }, [prefix, organizationId, userId, entityType, dateFrom, dateTo, take]);
  // ADX12: loading + load-error states — before, a failed fetch
  // and an in-flight fetch both looked like "no records".
  const [loading, setLoading] = React.useState(true);
  const [loadError, setLoadError] = React.useState("");
  const load = React.useCallback(async () => {
    setLoading(true);
    try { setRows(await apiFetch<Row[]>(`/admin/audit?${buildQuery(false)}`)); setLoadError(""); }
    catch (e) { setRows([]); setLoadError(e instanceof Error ? e.message : dict.audit.loadFailedFallback); }
    finally { setLoading(false); }
  }, [buildQuery, dict]);
  React.useEffect(() => { load(); }, [load]);
  // ADNX15: one apply function for saved views AND last-used
  // filter persistence (restored on mount, stored on change).
  const applyFilters = (s: Record<string, string>) => {
    setPrefix(s.prefix ?? "admin."); setOrganizationId(s.organizationId ?? ""); setUserId(s.userId ?? "");
    setEntityType(s.entityType ?? ""); setDateFrom(s.dateFrom ?? ""); setDateTo(s.dateTo ?? ""); setTake(s.take ?? "100");
  };
  useLastFilters("audit", { prefix, organizationId, userId, entityType, dateFrom, dateTo, take }, applyFilters);
  async function exportCsv() {
    const token = getAdminToken();
    const res = await fetch(`${API_URL}/admin/audit/export.csv?${buildQuery(true)}`, { headers: token ? { Authorization: `Bearer ${token}` } : {} });
    if (!res.ok) return;
    const blob = await res.blob();
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url; a.download = "audit-export.csv"; a.click();
    setTimeout(() => URL.revokeObjectURL(url), 5000);
  }
  // ADNX10: FilterBar pattern completed — the bar already carried
  // actor (User ID) / action prefix / entity type / date range; it
  // now also reports its active-filter count on the mobile toggle,
  // like the NB2 list pages (defaults: prefix "admin.", take 100).
  const activeFilters = (prefix !== "admin." ? 1 : 0) + (organizationId.trim() ? 1 : 0) + (userId.trim() ? 1 : 0)
    + (entityType.trim() ? 1 : 0) + (dateFrom ? 1 : 0) + (dateTo ? 1 : 0) + (take !== "100" ? 1 : 0);
  return (
    <AdminShell title={dict.audit.title}>
      <PageHead sub={dict.audit.sub} />
      <div className="acard overflow-hidden p-0">
        <FilterBar collapsible activeCount={activeFilters} className="border-b border-slate-800">
          <span className="text-sm text-slate-400">{dict.audit.actionPrefix}</span>
          <select className="ainput w-full sm:w-48" value={prefix} onChange={(e) => setPrefix(e.target.value)}>
            <option value="admin.">{dict.audit.optAdminOnly}</option>
            <option value="">{dict.audit.optAllActions}</option>
            <option value="auth.">Auth</option>
            <option value="campaign.">Campaign</option>
            <option value="audience.">Audience</option>
          </select>
          <input className="ainput w-full sm:w-48" placeholder={dict.audit.orgIdPlaceholder} value={organizationId} onChange={(e) => setOrganizationId(e.target.value)} />
          <input className="ainput w-full sm:w-48" placeholder={dict.audit.actorPlaceholder} value={userId} onChange={(e) => setUserId(e.target.value)} />
          <input className="ainput w-full sm:w-40" placeholder={dict.audit.entityTypePlaceholder} value={entityType} onChange={(e) => setEntityType(e.target.value)} />
          <label className="flex w-full items-center gap-1 text-sm text-slate-400 sm:w-auto">{dict.audit.from} <input type="date" className="ainput w-full sm:w-40" value={dateFrom} onChange={(e) => setDateFrom(e.target.value)} /></label>
          <label className="flex w-full items-center gap-1 text-sm text-slate-400 sm:w-auto">{dict.audit.to} <input type="date" className="ainput w-full sm:w-40" value={dateTo} onChange={(e) => setDateTo(e.target.value)} /></label>
          <label className="flex items-center gap-1 text-sm text-slate-400">{dict.audit.take}
            <select className="ainput w-24" value={take} onChange={(e) => setTake(e.target.value)}>
              <option value="50">{fmtNumber(locale, 50)}</option>
              <option value="100">{fmtNumber(locale, 100)}</option>
              <option value="200">{fmtNumber(locale, 200)}</option>
            </select>
          </label>
          <button className="abtn-secondary !px-3 !py-1.5 text-xs w-full sm:w-auto" onClick={exportCsv}>{dict.audit.csvExport}</button>
        </FilterBar>
        {/* ADX14: saved views over this page's existing filter state */}
        <div className="border-b border-slate-800">
          <SavedViewsBar
            page="audit"
            current={{ prefix, organizationId, userId, entityType, dateFrom, dateTo, take }}
            onApply={applyFilters}
          />
        </div>
        <table className="atable atable-cards atable-v3">
          <thead className="bg-slate-900"><tr><th className="ath">{dict.audit.colTime}</th><th className="ath">{dict.audit.colAction}</th><th className="ath">{dict.audit.colEntity}</th><th className="ath">{dict.audit.colActor}</th><th className="ath">{dict.audit.colIp}</th><th className="ath">{dict.audit.colDetails}</th></tr></thead>
          <tbody>{rows.map((r) => (
            <tr key={r.id} className="border-t border-slate-800">
              <td data-label={dict.audit.colTime} className="atd whitespace-nowrap text-slate-400">{fmtDateTime(locale, r.createdAt)}</td>
              <td data-label={dict.audit.colAction} className="atd"><span className={actionBadge(r.action)}>{r.action}</span></td>
              <td data-label={dict.audit.colEntity} className="atd text-slate-400">{r.entityType}{r.entityId ? ` · ${r.entityId.slice(0, 8)}…` : ""}</td>
              <td data-label={dict.audit.colActor} className="atd text-slate-400">{r.userId ? `${r.userId.slice(0, 8)}…` : "—"}</td>
              <td data-label={dict.audit.colIp} className="atd text-slate-400">{r.ipAddress ?? "—"}</td>
              <td data-label={dict.audit.colDetails} className="atd max-w-xs text-slate-400"><span className="inline-block max-w-[180px] truncate align-middle">{r.metadata ? JSON.stringify(r.metadata) : ""}</span><button type="button" className="abtn-secondary ml-2 !px-2 !py-0.5 text-xs" onClick={() => setDrawerRow(r)}>{dict.audit.open}</button></td>
            </tr>
          ))}</tbody>
        </table>
        {loading && rows.length === 0 ? <div className="askel-table m-4" /> : null}
        {!loading && loadError ? <div className="p-4"><ErrorState message={t("audit.loadError", { message: loadError })} onRetry={load} /></div> : null}
        {!loading && !loadError && rows.length === 0 ? <EmptyState title={dict.audit.emptyTitle} sub={dict.audit.emptySub} /> : null}
      </div>
      <DetailDrawer open={drawerRow !== null} title={drawerRow?.action ?? ""} sub={drawerRow ? fmtDateTime(locale, drawerRow.createdAt) : undefined} onClose={() => setDrawerRow(null)}>
        {drawerRow ? (
          <div className="space-y-2.5 text-sm">
            <div><span className="text-slate-400">{dict.audit.drawerEntity} </span>{drawerRow.entityType}{drawerRow.entityId ? ` · ${drawerRow.entityId}` : ""}</div>
            <div><span className="text-slate-400">{dict.audit.drawerActor} </span>{drawerRow.userId ?? "—"}</div>
            <div><span className="text-slate-400">{dict.audit.drawerOrgId} </span>{drawerRow.organizationId ?? "—"}</div>
            <div><span className="text-slate-400">{dict.audit.drawerIp} </span>{drawerRow.ipAddress ?? "—"}</div>
            <div>
              <div className="mb-1 text-slate-400">{dict.audit.drawerMetadata}</div>
              <pre className="max-h-96 overflow-auto whitespace-pre-wrap break-all rounded-lg bg-slate-900 p-3 text-xs text-slate-300">{drawerRow.metadata ? JSON.stringify(drawerRow.metadata, null, 2) : "—"}</pre>
            </div>
          </div>
        ) : null}
      </DetailDrawer>
    </AdminShell>
  );
}
