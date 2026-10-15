"use client";
import React from "react";
import AdminShell from "@/components/AdminShell";
import { DataTable, FilterBar, SortableTh, DetailDrawer, EmptyState, ErrorState, SavedViewsBar, type SortDir } from "@/components/ui";
import { apiFetch } from "@/lib/api";
import { fmtDateTime } from "@/lib/dates";

interface UserRow { id: string; email: string; name: string; isSuperAdmin: boolean; adminTier?: string | null; status: string; lastLoginAt?: string | null; createdAt: string; organizationCount: number }

const STATUS_BADGE = (s: string) => (s === "ACTIVE" ? "abadge-green" : s === "SUSPENDED" ? "abadge-amber" : "abadge-red");

export default function UsersPage() {
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
    <AdminShell title="👤 Users">
      {error ? <div className="mb-3"><ErrorState message={error} onRetry={load} /></div> : null}
      <div className="acard overflow-hidden p-0">
        <FilterBar collapsible>
          <input className="ainput max-w-sm" placeholder="ইমেইল বা নাম দিয়ে খুঁজুন…" value={q} onChange={(e) => setQ(e.target.value)} />
          <button className="abtn-secondary" onClick={load}>খুঁজুন</button>
          <select className="ainput" aria-label="অবস্থা দিয়ে ছাঁকুন" value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)}>
            <option value="">সব অবস্থা</option>
            {["ACTIVE", "SUSPENDED", "DELETED"].map((s) => <option key={s} value={s}>{s}</option>)}
          </select>
          <select className="ainput" aria-label="Admin দিয়ে ছাঁকুন" value={adminFilter} onChange={(e) => setAdminFilter(e.target.value)}>
            <option value="">সবাই</option>
            <option value="admin">শুধু Admin</option>
            <option value="normal">সাধারণ User</option>
          </select>
          <span className="text-xs text-slate-500">{sorted.length}জন দেখাচ্ছে</span>
        </FilterBar>
        {/* ADX14: saved views over this page's existing filter state */}
        <div className="border-b border-slate-800">
          <SavedViewsBar
            page="users"
            current={{ q, statusFilter, adminFilter }}
            onApply={(s) => { setQ(s.q ?? ""); setStatusFilter(s.statusFilter ?? ""); setAdminFilter(s.adminFilter ?? ""); }}
          />
        </div>
        <DataTable>
          <thead className="bg-slate-900"><tr>
            <SortableTh label="User" sortKey="name" current={sortKey} dir={sortDir} onSort={onSort} />
            <SortableTh label="Org" sortKey="orgs" current={sortKey} dir={sortDir} onSort={onSort} />
            <th className="ath">অবস্থা</th>
            <SortableTh label="শেষ লগইন" sortKey="lastLogin" current={sortKey} dir={sortDir} onSort={onSort} />
            <SortableTh label="যোগ দিয়েছেন" sortKey="created" current={sortKey} dir={sortDir} onSort={onSort} />
            <th className="ath"></th>
          </tr></thead>
          <tbody>{sorted.map((u) => (
            <tr key={u.id} className="arow border-t border-slate-800 hover:bg-slate-800/40">
              <td data-label="User" className="atd"><a className="font-medium text-indigo-300 hover:underline" href={`/users/${u.id}`}>{u.name}</a><div className="text-xs text-slate-500">{u.email}{u.isSuperAdmin ? ` · 🛡 ${u.adminTier ?? "SUPER"}` : ""}</div></td>
              <td data-label="Org" className="atd">{u.organizationCount}</td>
              <td data-label="অবস্থা" className="atd"><span className={STATUS_BADGE(u.status)}>{u.status}</span></td>
              <td data-label="শেষ লগইন" className="atd text-slate-400">{u.lastLoginAt ? fmtDateTime(u.lastLoginAt) : "—"}</td>
              <td data-label="যোগ দিয়েছেন" className="atd text-slate-400">{fmtDateTime(u.createdAt, "date")}</td>
              <td className="atd"><button type="button" className="abtn-secondary atable-row-actions !px-2 !py-1 text-xs" onClick={() => setQuick(u)}>দ্রুত দেখুন</button></td>
            </tr>
          ))}</tbody>
        </DataTable>
        {loading && rows.length === 0 ? <div className="askel-table m-4" /> : null}
        {sorted.length === 0 && !loading ? <EmptyState title="কোনো User পাওয়া যায়নি।" sub="খোঁজ বা ফিল্টার বদলে আবার দেখুন।" /> : null}
      </div>

      <DetailDrawer
        open={quick !== null}
        title={quick?.name ?? ""}
        sub={quick?.email}
        onClose={() => setQuick(null)}
        footer={quick ? <a className="abtn w-full" href={`/users/${quick.id}`}>সম্পূর্ণ বিবরণ খুলুন →</a> : null}
      >
        {quick ? (
          <div className="space-y-2.5 text-sm">
            <div><span className="text-slate-400">অবস্থা:</span> <span className={STATUS_BADGE(quick.status)}>{quick.status}</span>{quick.isSuperAdmin ? <span className="abadge-slate ml-2">🛡 Admin ({quick.adminTier ?? "SUPER"})</span> : null}</div>
            <div><span className="text-slate-400">Organization সদস্যতা:</span> {quick.organizationCount}টি</div>
            <div><span className="text-slate-400">শেষ লগইন:</span> {quick.lastLoginAt ? fmtDateTime(quick.lastLoginAt) : "—"}</div>
            <div><span className="text-slate-400">যোগ দিয়েছেন:</span> {fmtDateTime(quick.createdAt, "date")}</div>
            <p className="pt-1 text-xs text-slate-500">এটি তালিকার সারির সারসংক্ষেপ — সব তথ্য ও অ্যাকশন সম্পূর্ণ বিবরণ পেজে।</p>
          </div>
        ) : null}
      </DetailDrawer>
    </AdminShell>
  );
}
