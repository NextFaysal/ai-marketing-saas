"use client";
import React from "react";
import AdminShell from "@/components/AdminShell";
import { DataTable, FilterBar, PageHead, SortableTh, DetailDrawer, EmptyState, ErrorState, SavedViewsBar, askInput, toast, useLastFilters, type SortDir } from "@/components/ui";
import { apiFetch } from "@/lib/api";
import { fmtDateTime } from "@/lib/dates";
import { fmtNumber } from "@repo/contracts";
import { useAdminLocale } from "@/components/AdminLocale";

interface OrgRow { id: string; name: string; slug: string; status: string; country: string; createdAt: string; memberCount: number; orderCount: number; tags?: string[]; subscription?: { plan: string; status: string } | null }

interface TombstoneRow { id: string; slug: string; deletedOrgName: string | null; deletedAt: string; expiresAt: string; releasedAt: string | null; releasedById: string | null; active: boolean }

/** TD11: slug cooldown list — a permanently deleted org's slug
 * stays parked for 180 days so its old shop address cannot be
 * taken over. A SUPER admin can release a name early; the note
 * is mandatory and lands in the audit trail (same prompt pattern
 * as this page's bulk actions). Renders nothing when there are
 * no tombstones or the list cannot be loaded. */
function SlugTombstonesCard() {
  const { dict, locale, t: tr } = useAdminLocale();
  const [rows, setRows] = React.useState<TombstoneRow[]>([]);
  const [msg, setMsg] = React.useState("");
  const load = React.useCallback(async () => {
    const out = await apiFetch<{ tombstones: TombstoneRow[] }>(`/admin/slug-tombstones`).catch(() => null);
    if (out) setRows(out.tombstones);
  }, []);
  React.useEffect(() => { load(); }, [load]);
  const release = async (t: TombstoneRow) => {
    const note = window.prompt(tr("orgs.tombstonePrompt", { slug: t.slug }));
    if (!note || note.trim().length < 3) return;
    try {
      await apiFetch(`/admin/slug-tombstones/${encodeURIComponent(t.slug)}/release`, { method: "POST", body: JSON.stringify({ note }) });
      setMsg(tr("orgs.tombstoneReleased", { slug: t.slug }));
      await load();
    } catch (e) { setMsg(e instanceof Error ? e.message : dict.orgs.tombstoneReleaseFailed); }
  };
  if (rows.length === 0) return null;
  return (
    <div className="acard mt-4 p-4">
      <h3 className="text-sm font-semibold text-slate-200">{dict.orgs.tombstoneTitle}</h3>
      <p className="mt-1 text-xs text-slate-500">{dict.orgs.tombstoneNote}</p>
      {msg ? <p className="mt-2 rounded-lg bg-indigo-500/10 p-2.5 text-sm text-indigo-200">{msg}</p> : null}
      <table className="atable mt-3">
        <thead><tr>
          <th className="ath">{dict.orgs.colSlug}</th><th className="ath">{dict.orgs.colDeletedShop}</th><th className="ath">{dict.orgs.colDeletedAt}</th><th className="ath">{dict.orgs.colCooldownEnd}</th><th className="ath">{dict.orgs.colStatus}</th><th className="ath"></th>
        </tr></thead>
        <tbody>{rows.map((t) => (
          <tr key={t.id} className="arow border-t border-slate-800">
            <td className="atd font-mono text-indigo-300">{t.slug}<span className="text-slate-500">.qosprey.com</span></td>
            <td className="atd">{t.deletedOrgName ?? "—"}</td>
            <td className="atd text-slate-400">{fmtDateTime(locale, t.deletedAt, "date")}</td>
            <td className="atd text-slate-400">{fmtDateTime(locale, t.expiresAt, "date")}</td>
            <td className="atd">{t.active ? <span className="abadge-amber">{dict.orgs.cooldownActive}</span> : t.releasedAt ? <span className="abadge-green">{dict.orgs.released}</span> : <span className="abadge-red">{dict.orgs.expired}</span>}</td>
            <td className="atd">{t.active ? <button type="button" className="abtn-secondary !px-2 !py-1 text-xs" onClick={() => release(t)}>{dict.orgs.release}</button> : null}</td>
          </tr>
        ))}</tbody>
      </table>
    </div>
  );
}

const STATUS_BADGE = (s: string) => (s === "ACTIVE" ? "abadge-green" : s === "SUSPENDED" ? "abadge-amber" : "abadge-red");

export default function OrgsPage() {
  const { dict, locale, t } = useAdminLocale();
  const [rows, setRows] = React.useState<OrgRow[]>([]);
  const [q, setQ] = React.useState("");
  const [selected, setSelected] = React.useState<string[]>([]);
  // ADX6: status/plan filters are CLIENT-side over the rows the
  // existing API already returned — GET /admin/orgs accepts only
  // q/page/take (verified in admin.controller.ts), so no new
  // server param is invented here.
  const [statusFilter, setStatusFilter] = React.useState("");
  const [planFilter, setPlanFilter] = React.useState("");
  // ORG13 (OB4): the tag filter is different — it is a REAL server
  // param (GET /admin/orgs?tag=..., exact-match on the org's
  // admin-only tags array), so it rides the load() URL.
  const [tagFilter, setTagFilter] = React.useState("");
  const [sortKey, setSortKey] = React.useState("created");
  const [sortDir, setSortDir] = React.useState<SortDir>("desc");
  const [quick, setQuick] = React.useState<OrgRow | null>(null);
  // ADX12: loading + load-error states — before, the first load
  // flashed the empty state and a failed load was indistinguishable
  // from "no organizations".
  const [loading, setLoading] = React.useState(true);
  const [error, setError] = React.useState("");
  const load = React.useCallback(async () => {
    setLoading(true); setError("");
    setRows(await apiFetch<OrgRow[]>(`/admin/orgs?take=50${q ? `&q=${encodeURIComponent(q)}` : ""}${tagFilter ? `&tag=${encodeURIComponent(tagFilter)}` : ""}`).catch((e) => { setError(e instanceof Error ? e.message : dict.orgs.loadFailed); return []; }));
    setLoading(false);
  }, [q, tagFilter, dict]);
  React.useEffect(() => { load(); }, [load]);
  // ADNX15: one apply function for saved views AND last-used
  // filter persistence (restored on mount, stored on change).
  const applyFilters = (s: Record<string, string>) => { setQ(s.q ?? ""); setStatusFilter(s.statusFilter ?? ""); setPlanFilter(s.planFilter ?? ""); setTagFilter(s.tagFilter ?? ""); };
  useLastFilters("orgs", { q, statusFilter, planFilter, tagFilter }, applyFilters);

  const bulk = async (status: string) => {
    const reason = await askInput({ title: t("orgs.bulkTitle", { status, count: fmtNumber(locale, selected.length) }), description: dict.orgs.bulkReasonDesc, inputLabel: dict.common.reason, inputRequired: true, confirmLabel: dict.common.proceed });
    if (!reason) return;
    try {
      const out = await apiFetch<{ succeeded: number; total: number }>(`/admin/orgs/bulk-status`, { method: "POST", body: JSON.stringify({ organizationIds: selected, status, reason }) });
      toast(t("orgs.bulkDone", { succeeded: fmtNumber(locale, out.succeeded), total: fmtNumber(locale, out.total), status }));
      setSelected([]); await load();
    } catch (e) { toast(e instanceof Error ? e.message : dict.orgs.bulkFailed, "error"); }
  };

  const onSort = (key: string) => {
    if (key === sortKey) setSortDir((d) => (d === "asc" ? "desc" : "asc"));
    else { setSortKey(key); setSortDir(key === "name" ? "asc" : "desc"); }
  };
  const planOptions = [...new Set(rows.map((o) => o.subscription?.plan).filter(Boolean))] as string[];
  const filtered = rows.filter((o) =>
    (!statusFilter || o.status === statusFilter) &&
    (!planFilter || o.subscription?.plan === planFilter));
  const sorted = [...filtered].sort((a, b) => {
    const dir = sortDir === "asc" ? 1 : -1;
    if (sortKey === "name") return dir * a.name.localeCompare(b.name);
    if (sortKey === "members") return dir * (a.memberCount - b.memberCount);
    if (sortKey === "orders") return dir * (a.orderCount - b.orderCount);
    return dir * (+new Date(a.createdAt) - +new Date(b.createdAt));
  });

  return (
    <AdminShell title={dict.orgs.title}>
      <PageHead sub={dict.orgs.sub} />
      {selected.length > 0 ? (
        <div className="mb-3 flex flex-wrap items-center gap-2 rounded-xl border border-indigo-500/40 bg-indigo-500/10 px-4 py-2.5 text-sm">
          <b>{t("orgs.selectedCount", { count: fmtNumber(locale, selected.length) })}</b> — {dict.orgs.bulkPrefix}
          <button className="abtn-secondary !px-2 !py-1 text-xs" onClick={() => bulk("ACTIVE")}>{dict.orgs.bulkActivate}</button>
          <button className="abtn-secondary !px-2 !py-1 text-xs" onClick={() => bulk("SUSPENDED")}>{dict.orgs.bulkSuspend}</button>
          <button className="abtn-danger !px-2 !py-1 text-xs" onClick={() => bulk("DELETED")}>{dict.orgs.bulkDelete}</button>
          <button className="abtn-secondary !px-2 !py-1 text-xs" onClick={() => setSelected([])}>{dict.common.cancel}</button>
        </div>
      ) : null}
      {error ? <div className="mb-3"><ErrorState message={error} onRetry={load} /></div> : null}
      <div className="acard overflow-hidden p-0">
        <FilterBar collapsible activeCount={(q ? 1 : 0) + (statusFilter ? 1 : 0) + (planFilter ? 1 : 0) + (tagFilter ? 1 : 0)}>
          <input className="ainput max-w-sm" placeholder={dict.orgs.searchPlaceholder} value={q} onChange={(e) => setQ(e.target.value)} />
          <input className="ainput max-w-[11rem]" placeholder={dict.orgs.tagFilterPlaceholder} aria-label={dict.orgs.tagFilterAria} value={tagFilter} onChange={(e) => setTagFilter(e.target.value)} />
          <button className="abtn-secondary" onClick={load}>{dict.orgs.searchButton}</button>
          <select className="ainput" aria-label={dict.orgs.statusFilterAria} value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)}>
            <option value="">{dict.orgs.allStatuses}</option>
            {["ACTIVE", "SUSPENDED", "DELETED"].map((s) => <option key={s} value={s}>{s}</option>)}
          </select>
          <select className="ainput" aria-label={dict.orgs.planFilterAria} value={planFilter} onChange={(e) => setPlanFilter(e.target.value)}>
            <option value="">{dict.orgs.allPlans}</option>
            {planOptions.map((p) => <option key={p} value={p}>{p}</option>)}
          </select>
          <span className="text-xs text-slate-400">{t("orgs.showingCount", { count: fmtNumber(locale, sorted.length) })}</span>
        </FilterBar>
        {/* ADNX8: active-filter chips — visible even while the
            mobile FilterBar is collapsed; each chip clears only
            its own filter (same state setters as the bar). */}
        {(q || statusFilter || planFilter || tagFilter) ? (
          <div className="flex flex-wrap items-center gap-1.5 border-b border-slate-800 px-4 py-2">
            {q ? <span className="inline-flex items-center gap-1 rounded-full border border-slate-700 bg-slate-800/70 py-0.5 pl-2.5 pr-1 text-xs text-slate-200">{t("orgs.chipSearch", { value: q })}<button type="button" className="rounded-full px-1 text-slate-400 hover:text-red-300" aria-label={dict.orgs.chipSearchClear} onClick={() => setQ("")}>✕</button></span> : null}
            {statusFilter ? <span className="inline-flex items-center gap-1 rounded-full border border-slate-700 bg-slate-800/70 py-0.5 pl-2.5 pr-1 text-xs text-slate-200">{t("orgs.chipStatus", { value: statusFilter })}<button type="button" className="rounded-full px-1 text-slate-400 hover:text-red-300" aria-label={dict.orgs.chipStatusClear} onClick={() => setStatusFilter("")}>✕</button></span> : null}
            {planFilter ? <span className="inline-flex items-center gap-1 rounded-full border border-slate-700 bg-slate-800/70 py-0.5 pl-2.5 pr-1 text-xs text-slate-200">{t("orgs.chipPlan", { value: planFilter })}<button type="button" className="rounded-full px-1 text-slate-400 hover:text-red-300" aria-label={dict.orgs.chipPlanClear} onClick={() => setPlanFilter("")}>✕</button></span> : null}
            {tagFilter ? <span className="inline-flex items-center gap-1 rounded-full border border-slate-700 bg-slate-800/70 py-0.5 pl-2.5 pr-1 text-xs text-slate-200">{t("orgs.chipTag", { value: tagFilter })}<button type="button" className="rounded-full px-1 text-slate-400 hover:text-red-300" aria-label={dict.orgs.chipTagClear} onClick={() => setTagFilter("")}>✕</button></span> : null}
            <button type="button" className="text-xs font-medium text-indigo-300 hover:text-indigo-200" onClick={() => { setQ(""); setStatusFilter(""); setPlanFilter(""); setTagFilter(""); }}>{dict.orgs.clearAllFilters}</button>
          </div>
        ) : null}
        {/* ADX14: saved views over this page's existing filter state */}
        <div className="border-b border-slate-800">
          <SavedViewsBar
            page="orgs"
            current={{ q, statusFilter, planFilter, tagFilter }}
            onApply={applyFilters}
          />
        </div>
        <DataTable>
          <thead className="bg-slate-900"><tr><th className="ath"></th>
            <SortableTh label={dict.common.organization} sortKey="name" current={sortKey} dir={sortDir} onSort={onSort} />
            <th className="ath">{dict.common.plan}</th>
            <SortableTh label={dict.orgs.colMembers} sortKey="members" current={sortKey} dir={sortDir} onSort={onSort} />
            <SortableTh label={dict.orgs.colOrder} sortKey="orders" current={sortKey} dir={sortDir} onSort={onSort} />
            <th className="ath">{dict.orgs.colStatus}</th>
            <SortableTh label={dict.common.created} sortKey="created" current={sortKey} dir={sortDir} onSort={onSort} />
            <th className="ath"></th>
          </tr></thead>
          <tbody>{sorted.map((o) => (
            <tr key={o.id} className="arow border-t border-slate-800 hover:bg-slate-800/40">
              <td className="atd"><input type="checkbox" checked={selected.includes(o.id)} onChange={(e) => setSelected(e.target.checked ? [...selected, o.id] : selected.filter((x) => x !== o.id))} /></td>
              <td data-label={dict.common.organization} className="atd"><a className="font-medium text-indigo-300 hover:underline" href={`/orgs/${o.id}`}>{o.name}</a><div className="text-xs text-slate-400">{o.slug} · {o.country}</div>
                {o.tags && o.tags.length ? (
                  <div className="mt-1 flex flex-wrap gap-1">
                    {o.tags.map((t) => <button key={t} type="button" title={dict.orgs.tagFilterTitle} className="rounded-full border border-slate-700 bg-slate-800/70 px-2 py-0.5 text-[11px] text-slate-300 hover:border-indigo-500 hover:text-indigo-200" onClick={() => setTagFilter(t)}>🏷 {t}</button>)}
                  </div>
                ) : null}
              </td>
              <td data-label={dict.common.plan} className="atd">{o.subscription ? `${o.subscription.plan} (${o.subscription.status})` : "—"}</td>
              <td data-label={dict.orgs.colMembers} className="atd">{fmtNumber(locale, o.memberCount)}</td>
              <td data-label={dict.orgs.colOrder} className="atd">{fmtNumber(locale, o.orderCount)}</td>
              <td data-label={dict.orgs.colStatus} className="atd"><span className={STATUS_BADGE(o.status)}>{o.status}</span></td>
              <td data-label={dict.common.created} className="atd text-slate-400">{fmtDateTime(locale, o.createdAt, "date")}</td>
              <td className="atd"><button type="button" className="abtn-secondary atable-row-actions !px-2 !py-1 text-xs" onClick={() => setQuick(o)}>{dict.orgs.quickView}</button></td>
            </tr>
          ))}</tbody>
        </DataTable>
        {loading && rows.length === 0 ? <div className="askel-table m-4" /> : null}
        {sorted.length === 0 && !loading && !error ? <EmptyState title={dict.orgs.emptyTitle} sub={dict.orgs.emptySub} /> : null}
      </div>

      <SlugTombstonesCard />

      <DetailDrawer
        open={quick !== null}
        title={quick?.name ?? ""}
        sub={quick ? `${quick.slug} · ${quick.country}` : undefined}
        onClose={() => setQuick(null)}
        footer={quick ? <a className="abtn w-full" href={`/orgs/${quick.id}`}>{dict.orgs.openFullDetails}</a> : null}
      >
        {quick ? (
          <div className="space-y-2.5 text-sm">
            <div><span className="text-slate-400">{dict.orgs.drawerStatus}</span> <span className={STATUS_BADGE(quick.status)}>{quick.status}</span></div>
            <div><span className="text-slate-400">{dict.orgs.drawerSubscription}</span> {quick.subscription ? `${quick.subscription.plan} · ${quick.subscription.status}` : dict.orgs.drawerNoSubscription}</div>
            <div><span className="text-slate-400">{dict.orgs.drawerMembers}</span> {t("orgs.drawerMembersPart", { count: fmtNumber(locale, quick.memberCount) })} · <span className="text-slate-400">Order:</span> {t("orgs.drawerOrdersPart", { count: fmtNumber(locale, quick.orderCount) })}</div>
            <div><span className="text-slate-400">{dict.orgs.drawerCreated}</span> {fmtDateTime(locale, quick.createdAt, "date")}</div>
            {quick.subscription?.status === "PAST_DUE" ? <p className="aerror">{dict.orgs.drawerPastDue}</p> : null}
            <p className="pt-1 text-xs text-slate-400">{dict.orgs.drawerNote}</p>
          </div>
        ) : null}
      </DetailDrawer>
    </AdminShell>
  );
}
