"use client";
import React from "react";
import AdminShell from "@/components/AdminShell";
import { DataTable, FilterBar, PageHead, SortableTh, DetailDrawer, EmptyState, ErrorState, SavedViewsBar, useLastFilters, type SortDir } from "@/components/ui";
import { apiFetch } from "@/lib/api";
import { fmtDateTime } from "@/lib/dates";
import { fmtNumber } from "@repo/contracts";
import { useAdminLocale } from "@/components/AdminLocale";

interface UserRow { id: string; email: string; name: string; isSuperAdmin: boolean; adminTier?: string | null; status: string; lastLoginAt?: string | null; createdAt: string; organizationCount: number }

const STATUS_BADGE = (s: string) => (s === "ACTIVE" ? "abadge-green" : s === "SUSPENDED" ? "abadge-amber" : "abadge-red");

export default function UsersPage() {
  const { dict, locale, t } = useAdminLocale();
  const [rows, setRows] = React.useState<UserRow[]>([]);
  const [q, setQ] = React.useState("");
  const [error, setError] = React.useState("");
  // ADX6: status/admin filters are CLIENT-side over the rows the
  // existing API already returned — GET /admin/users accepts only
  // q/page/take (verified in admin.controller.ts), so no new server
  // param is invented here.
  const [statusFilter, setStatusFilter] = React.useState("");
  const [adminFilter, setAdminFilter] = React.useState("");
  const [sortKey, setSortKey] = React.useState("created");
  const [sortDir, setSortDir] = React.useState<SortDir>("desc");
  const [quick, setQuick] = React.useState<UserRow | null>(null);
  // ADX12: loading state — before, the empty state flashed while
  // the first load was still in flight.
  const [loading, setLoading] = React.useState(true);
  const load = React.useCallback(async () => {
    setLoading(true); setError("");
    setRows(await apiFetch<UserRow[]>(`/admin/users?take=50${q ? `&q=${encodeURIComponent(q)}` : ""}`).catch((e) => { setError(e.message); return []; }));
    setLoading(false);
  }, [q]);
  React.useEffect(() => { load(); }, [load]);
  // ADNX15: one apply function for saved views AND last-used
  // filter persistence (restored on mount, stored on change).
  const applyFilters = (s: Record<string, string>) => { setQ(s.q ?? ""); setStatusFilter(s.statusFilter ?? ""); setAdminFilter(s.adminFilter ?? ""); };
  useLastFilters("users", { q, statusFilter, adminFilter }, applyFilters);

  const onSort = (key: string) => {
    if (key === sortKey) setSortDir((d) => (d === "asc" ? "desc" : "asc"));
    else { setSortKey(key); setSortDir(key === "name" ? "asc" : "desc"); }
  };
  const filtered = rows.filter((u) =>
    (!statusFilter || u.status === statusFilter) &&
    (!adminFilter || (adminFilter === "admin" ? u.isSuperAdmin : !u.isSuperAdmin)));
  const sorted = [...filtered].sort((a, b) => {
    const dir = sortDir === "asc" ? 1 : -1;
    if (sortKey === "name") return dir * a.name.localeCompare(b.name);
    if (sortKey === "orgs") return dir * (a.organizationCount - b.organizationCount);
    if (sortKey === "lastLogin") return dir * ((a.lastLoginAt ? +new Date(a.lastLoginAt) : 0) - (b.lastLoginAt ? +new Date(b.lastLoginAt) : 0));
    return dir * (+new Date(a.createdAt) - +new Date(b.createdAt));
  });

  return (
    <AdminShell title={dict.users.title}>
      <PageHead sub={dict.users.sub} />
      {error ? <div className="mb-3"><ErrorState message={error} onRetry={load} /></div> : null}
      <div className="acard overflow-hidden p-0">
        <FilterBar collapsible activeCount={(q ? 1 : 0) + (statusFilter ? 1 : 0) + (adminFilter ? 1 : 0)}>
          <input className="ainput max-w-sm" placeholder={dict.users.searchPlaceholder} value={q} onChange={(e) => setQ(e.target.value)} />
          <button className="abtn-secondary" onClick={load}>{dict.users.searchButton}</button>
          <select className="ainput" aria-label={dict.users.statusFilterAria} value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)}>
            <option value="">{dict.users.allStatuses}</option>
            {["ACTIVE", "SUSPENDED", "DELETED"].map((s) => <option key={s} value={s}>{s}</option>)}
          </select>
          <select className="ainput" aria-label={dict.users.adminFilterAria} value={adminFilter} onChange={(e) => setAdminFilter(e.target.value)}>
            <option value="">{dict.users.everyone}</option>
            <option value="admin">{dict.users.adminsOnly}</option>
            <option value="normal">{dict.users.normalUsers}</option>
          </select>
          <span className="text-xs text-slate-400">{t("users.showingCount", { count: fmtNumber(locale, sorted.length) })}</span>
        </FilterBar>
        {/* ADNX8: active-filter chips (same pattern as /orgs) */}
        {(q || statusFilter || adminFilter) ? (
          <div className="flex flex-wrap items-center gap-1.5 border-b border-slate-800 px-4 py-2">
            {q ? <span className="inline-flex items-center gap-1 rounded-full border border-slate-700 bg-slate-800/70 py-0.5 pl-2.5 pr-1 text-xs text-slate-200">{t("users.chipSearch", { value: q })}<button type="button" className="rounded-full px-1 text-slate-400 hover:text-red-300" aria-label={dict.users.chipSearchClear} onClick={() => setQ("")}>✕</button></span> : null}
            {statusFilter ? <span className="inline-flex items-center gap-1 rounded-full border border-slate-700 bg-slate-800/70 py-0.5 pl-2.5 pr-1 text-xs text-slate-200">{t("users.chipStatus", { value: statusFilter })}<button type="button" className="rounded-full px-1 text-slate-400 hover:text-red-300" aria-label={dict.users.chipStatusClear} onClick={() => setStatusFilter("")}>✕</button></span> : null}
            {adminFilter ? <span className="inline-flex items-center gap-1 rounded-full border border-slate-700 bg-slate-800/70 py-0.5 pl-2.5 pr-1 text-xs text-slate-200">{adminFilter === "admin" ? dict.users.chipAdminOnly : dict.users.chipNormal}<button type="button" className="rounded-full px-1 text-slate-400 hover:text-red-300" aria-label={dict.users.chipAdminClear} onClick={() => setAdminFilter("")}>✕</button></span> : null}
            <button type="button" className="text-xs font-medium text-indigo-300 hover:text-indigo-200" onClick={() => { setQ(""); setStatusFilter(""); setAdminFilter(""); }}>{dict.users.clearAllFilters}</button>
          </div>
        ) : null}
        {/* ADX14: saved views over this page's existing filter state */}
        <div className="border-b border-slate-800">
          <SavedViewsBar
            page="users"
            current={{ q, statusFilter, adminFilter }}
            onApply={applyFilters}
          />
        </div>
        <DataTable>
          <thead className="bg-slate-900"><tr>
            <SortableTh label={dict.users.colUser} sortKey="name" current={sortKey} dir={sortDir} onSort={onSort} />
            <SortableTh label={dict.users.colOrg} sortKey="orgs" current={sortKey} dir={sortDir} onSort={onSort} />
            <th className="ath">{dict.users.colStatus}</th>
            <SortableTh label={dict.users.colLastLogin} sortKey="lastLogin" current={sortKey} dir={sortDir} onSort={onSort} />
            <SortableTh label={dict.users.colJoined} sortKey="created" current={sortKey} dir={sortDir} onSort={onSort} />
            <th className="ath"></th>
          </tr></thead>
          <tbody>{sorted.map((u) => (
            <tr key={u.id} className="arow border-t border-slate-800 hover:bg-slate-800/40">
              <td data-label={dict.users.colUser} className="atd"><a className="font-medium text-indigo-300 hover:underline" href={`/users/${u.id}`}>{u.name}</a><div className="text-xs text-slate-400">{u.email}{u.isSuperAdmin ? ` · ${t("users.adminBadge", { tier: u.adminTier ?? "SUPER" })}` : ""}</div></td>
              <td data-label={dict.users.colOrg} className="atd">{fmtNumber(locale, u.organizationCount)}</td>
              <td data-label={dict.users.colStatus} className="atd"><span className={STATUS_BADGE(u.status)}>{u.status}</span></td>
              <td data-label={dict.users.colLastLogin} className="atd text-slate-400">{u.lastLoginAt ? fmtDateTime(locale, u.lastLoginAt) : "—"}</td>
              <td data-label={dict.users.colJoined} className="atd text-slate-400">{fmtDateTime(locale, u.createdAt, "date")}</td>
              <td className="atd"><button type="button" className="abtn-secondary atable-row-actions !px-2 !py-1 text-xs" onClick={() => setQuick(u)}>{dict.users.quickView}</button></td>
            </tr>
          ))}</tbody>
        </DataTable>
        {loading && rows.length === 0 ? <div className="askel-table m-4" /> : null}
        {sorted.length === 0 && !loading && !error ? <EmptyState title={dict.users.emptyTitle} sub={dict.users.emptySub} /> : null}
      </div>

      <DetailDrawer
        open={quick !== null}
        title={quick?.name ?? ""}
        sub={quick?.email}
        onClose={() => setQuick(null)}
        footer={quick ? <a className="abtn w-full" href={`/users/${quick.id}`}>{dict.users.openFullDetails}</a> : null}
      >
        {quick ? (
          <div className="space-y-2.5 text-sm">
            <div><span className="text-slate-400">{dict.users.drawerStatus}</span> <span className={STATUS_BADGE(quick.status)}>{quick.status}</span>{quick.isSuperAdmin ? <span className="abadge-slate ml-2">{t("users.adminBadge", { tier: quick.adminTier ?? "SUPER" })}</span> : null}</div>
            <div><span className="text-slate-400">{dict.users.drawerMembership}</span> {t("users.drawerMembershipCount", { count: fmtNumber(locale, quick.organizationCount) })}</div>
            <div><span className="text-slate-400">{dict.users.drawerLastLogin}</span> {quick.lastLoginAt ? fmtDateTime(locale, quick.lastLoginAt) : "—"}</div>
            <div><span className="text-slate-400">{dict.users.drawerJoined}</span> {fmtDateTime(locale, quick.createdAt, "date")}</div>
            <p className="pt-1 text-xs text-slate-400">{dict.users.drawerNote}</p>
          </div>
        ) : null}
      </DetailDrawer>
    </AdminShell>
  );
}
