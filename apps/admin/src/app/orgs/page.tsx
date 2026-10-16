"use client";
import React from "react";
import AdminShell from "@/components/AdminShell";
import { FilterBar, SortableTh, DetailDrawer, EmptyState, ErrorState, SavedViewsBar, type SortDir } from "@/components/ui";
import { apiFetch } from "@/lib/api";
import { fmtDateTime } from "@/lib/dates";

interface OrgRow { id: string; name: string; slug: string; status: string; country: string; createdAt: string; memberCount: number; orderCount: number; subscription?: { plan: string; status: string } | null }

interface TombstoneRow { id: string; slug: string; deletedOrgName: string | null; deletedAt: string; expiresAt: string; releasedAt: string | null; releasedById: string | null; active: boolean }

/** TD11: slug cooldown list — a permanently deleted org's slug
 * stays parked for 180 days so its old shop address cannot be
 * taken over. A SUPER admin can release a name early; the note
 * is mandatory and lands in the audit trail (same prompt pattern
 * as this page's bulk actions). Renders nothing when there are
 * no tombstones or the list cannot be loaded. */
function SlugTombstonesCard() {
  const [rows, setRows] = React.useState<TombstoneRow[]>([]);
  const [msg, setMsg] = React.useState("");
  const load = React.useCallback(async () => {
    const out = await apiFetch<{ tombstones: TombstoneRow[] }>(`/admin/slug-tombstones`).catch(() => null);
    if (out) setRows(out.tombstones);
  }, []);
  React.useEffect(() => { load(); }, [load]);
  const release = async (t: TombstoneRow) => {
    const note = window.prompt(`"${t.slug}" নামটি cooldown থেকে মুক্ত করুন — কারণ লিখুন (Audit-এ থাকবে):`);
    if (!note || note.trim().length < 3) return;
    try {
      await apiFetch(`/admin/slug-tombstones/${encodeURIComponent(t.slug)}/release`, { method: "POST", body: JSON.stringify({ note }) });
      setMsg(`"${t.slug}" মুক্ত হয়েছে — নামটি এখন আবার ব্যবহার করা যাবে।`);
      await load();
    } catch (e) { setMsg(e instanceof Error ? e.message : "মুক্তি ব্যর্থ হয়েছে"); }
  };
  if (rows.length === 0) return null;
  return (
    <div className="acard mt-4 p-4">
      <h3 className="text-sm font-semibold text-slate-200">🪦 Slug Cooldown — মুছে ফেলা দোকানের সংরক্ষিত নাম</h3>
      <p className="mt-1 text-xs text-slate-500">চিরতরে মুছে ফেলা Organization-এর slug ১৮০ দিন সংরক্ষিত থাকে — ওই সময়ের মধ্যে নতুন কেউ ওই নামে দোকান খুলতে পারে না (পুরনো ঠিকানা দখল রোধ)। জরুরি হলে SUPER অ্যাডমিন কারণ লিখে আগেই মুক্ত করতে পারেন।</p>
      {msg ? <p className="mt-2 rounded-lg bg-indigo-500/10 p-2.5 text-sm text-indigo-200">{msg}</p> : null}
      <table className="atable mt-3">
        <thead><tr>
          <th className="ath">Slug</th><th className="ath">মুছে ফেলা দোকান</th><th className="ath">মোছা হয়েছে</th><th className="ath">Cooldown শেষ</th><th className="ath">অবস্থা</th><th className="ath"></th>
        </tr></thead>
        <tbody>{rows.map((t) => (
          <tr key={t.id} className="arow border-t border-slate-800">
            <td className="atd font-mono text-indigo-300">{t.slug}<span className="text-slate-500">.qosprey.com</span></td>
            <td className="atd">{t.deletedOrgName ?? "—"}</td>
            <td className="atd text-slate-400">{fmtDateTime(t.deletedAt, "date")}</td>
            <td className="atd text-slate-400">{fmtDateTime(t.expiresAt, "date")}</td>
            <td className="atd">{t.active ? <span className="abadge-amber">Cooldown চলছে</span> : t.releasedAt ? <span className="abadge-green">মুক্ত করা হয়েছে</span> : <span className="abadge-red">মেয়াদ শেষ</span>}</td>
            <td className="atd">{t.active ? <button type="button" className="abtn-secondary !px-2 !py-1 text-xs" onClick={() => release(t)}>মুক্ত করুন</button> : null}</td>
          </tr>
        ))}</tbody>
      </table>
    </div>
  );
}

const STATUS_BADGE = (s: string) => (s === "ACTIVE" ? "abadge-green" : s === "SUSPENDED" ? "abadge-amber" : "abadge-red");

export default function OrgsPage() {
  const [rows, setRows] = React.useState<OrgRow[]>([]);
  const [q, setQ] = React.useState("");
  const [selected, setSelected] = React.useState<string[]>([]);
  const [bulkMsg, setBulkMsg] = React.useState("");
  // ADX6: status/plan filters are CLIENT-side over the rows the
  // existing API already returned — GET /admin/orgs accepts only
  // q/page/take (verified in admin.controller.ts), so no new
  // server param is invented here.
  const [statusFilter, setStatusFilter] = React.useState("");
  const [planFilter, setPlanFilter] = React.useState("");
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
    setRows(await apiFetch<OrgRow[]>(`/admin/orgs?take=50${q ? `&q=${encodeURIComponent(q)}` : ""}`).catch((e) => { setError(e instanceof Error ? e.message : "লোড ব্যর্থ হয়েছে"); return []; }));
    setLoading(false);
  }, [q]);
  React.useEffect(() => { load(); }, [load]);

  const bulk = async (status: string) => {
    const reason = window.prompt(`Bulk ${status} — ${selected.length}টি Org — কারণ (প্রতিটির Audit এ থাকবে):`);
    if (!reason || reason.trim().length < 3) return;
    try {
      const out = await apiFetch<{ succeeded: number; total: number }>(`/admin/orgs/bulk-status`, { method: "POST", body: JSON.stringify({ organizationIds: selected, status, reason }) });
      setBulkMsg(`${out.succeeded}/${out.total} টি Org ${status} হয়েছে।`);
      setSelected([]); await load();
    } catch (e) { setBulkMsg(e instanceof Error ? e.message : "Bulk action ব্যর্থ"); }
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
    <AdminShell title="🏢 Organizations">
      {bulkMsg ? <p className="mb-3 rounded-lg bg-indigo-500/10 p-3 text-sm text-indigo-200">{bulkMsg}</p> : null}
      {selected.length > 0 ? (
        <div className="mb-3 flex flex-wrap items-center gap-2 rounded-xl border border-indigo-500/40 bg-indigo-500/10 px-4 py-2.5 text-sm">
          <b>{selected.length}টি বাছাই হয়েছে</b> — Bulk (শুধু SUPER):
          <button className="abtn-secondary !px-2 !py-1 text-xs" onClick={() => bulk("ACTIVE")}>▶ Activate</button>
          <button className="abtn-secondary !px-2 !py-1 text-xs" onClick={() => bulk("SUSPENDED")}>⏸ Suspend</button>
          <button className="abtn-danger !px-2 !py-1 text-xs" onClick={() => bulk("DELETED")}>🗑 Soft-Delete</button>
          <button className="abtn-secondary !px-2 !py-1 text-xs" onClick={() => setSelected([])}>বাতিল</button>
        </div>
      ) : null}
      {error ? <div className="mb-3"><ErrorState message={error} onRetry={load} /></div> : null}
      <div className="acard overflow-hidden p-0">
        <FilterBar collapsible>
          <input className="ainput max-w-sm" placeholder="নাম বা slug দিয়ে খুঁজুন…" value={q} onChange={(e) => setQ(e.target.value)} />
          <button className="abtn-secondary" onClick={load}>খুঁজুন</button>
          <select className="ainput" aria-label="অবস্থা দিয়ে ছাঁকুন" value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)}>
            <option value="">সব অবস্থা</option>
            {["ACTIVE", "SUSPENDED", "DELETED"].map((s) => <option key={s} value={s}>{s}</option>)}
          </select>
          <select className="ainput" aria-label="Plan দিয়ে ছাঁকুন" value={planFilter} onChange={(e) => setPlanFilter(e.target.value)}>
            <option value="">সব Plan</option>
            {planOptions.map((p) => <option key={p} value={p}>{p}</option>)}
          </select>
          <span className="text-xs text-slate-500">{sorted.length}টি দেখাচ্ছে</span>
        </FilterBar>
        {/* ADX14: saved views over this page's existing filter state */}
        <div className="border-b border-slate-800">
          <SavedViewsBar
            page="orgs"
            current={{ q, statusFilter, planFilter }}
            onApply={(s) => { setQ(s.q ?? ""); setStatusFilter(s.statusFilter ?? ""); setPlanFilter(s.planFilter ?? ""); }}
          />
        </div>
        <table className="atable atable-sticky">
          <thead className="bg-slate-900"><tr><th className="ath"></th>
            <SortableTh label="Organization" sortKey="name" current={sortKey} dir={sortDir} onSort={onSort} />
            <th className="ath">Plan</th>
            <SortableTh label="সদস্য" sortKey="members" current={sortKey} dir={sortDir} onSort={onSort} />
            <SortableTh label="Order" sortKey="orders" current={sortKey} dir={sortDir} onSort={onSort} />
            <th className="ath">অবস্থা</th>
            <SortableTh label="তৈরি" sortKey="created" current={sortKey} dir={sortDir} onSort={onSort} />
            <th className="ath"></th>
          </tr></thead>
          <tbody>{sorted.map((o) => (
            <tr key={o.id} className="arow border-t border-slate-800 hover:bg-slate-800/40">
              <td className="atd"><input type="checkbox" checked={selected.includes(o.id)} onChange={(e) => setSelected(e.target.checked ? [...selected, o.id] : selected.filter((x) => x !== o.id))} /></td>
              <td className="atd"><a className="font-medium text-indigo-300 hover:underline" href={`/orgs/${o.id}`}>{o.name}</a><div className="text-xs text-slate-500">{o.slug} · {o.country}</div></td>
              <td className="atd">{o.subscription ? `${o.subscription.plan} (${o.subscription.status})` : "—"}</td>
              <td className="atd">{o.memberCount}</td>
              <td className="atd">{o.orderCount}</td>
              <td className="atd"><span className={STATUS_BADGE(o.status)}>{o.status}</span></td>
              <td className="atd text-slate-400">{fmtDateTime(o.createdAt, "date")}</td>
              <td className="atd"><button type="button" className="abtn-secondary atable-row-actions !px-2 !py-1 text-xs" onClick={() => setQuick(o)}>দ্রুত দেখুন</button></td>
            </tr>
          ))}</tbody>
        </table>
        {loading && rows.length === 0 ? <div className="askel-table m-4" /> : null}
        {sorted.length === 0 && !loading && !error ? <EmptyState title="কোনো Organization পাওয়া যায়নি।" sub="খোঁজ বা ফিল্টার বদলে আবার দেখুন।" /> : null}
      </div>

      <SlugTombstonesCard />

      <DetailDrawer
        open={quick !== null}
        title={quick?.name ?? ""}
        sub={quick ? `${quick.slug} · ${quick.country}` : undefined}
        onClose={() => setQuick(null)}
        footer={quick ? <a className="abtn w-full" href={`/orgs/${quick.id}`}>সম্পূর্ণ বিবরণ খুলুন →</a> : null}
      >
        {quick ? (
          <div className="space-y-2.5 text-sm">
            <div><span className="text-slate-400">অবস্থা:</span> <span className={STATUS_BADGE(quick.status)}>{quick.status}</span></div>
            <div><span className="text-slate-400">Subscription:</span> {quick.subscription ? `${quick.subscription.plan} · ${quick.subscription.status}` : "কোনো Subscription রেকর্ড নেই"}</div>
            <div><span className="text-slate-400">সদস্য:</span> {quick.memberCount}জন · <span className="text-slate-400">Order:</span> {quick.orderCount}টি</div>
            <div><span className="text-slate-400">তৈরি:</span> {fmtDateTime(quick.createdAt, "date")}</div>
            {quick.subscription?.status === "PAST_DUE" ? <p className="aerror">এই Org-এর Subscription PAST_DUE — Billing ঝুঁকিতে আছে।</p> : null}
            <p className="pt-1 text-xs text-slate-500">এটি তালিকার সারির সারসংক্ষেপ — সব তথ্য ও অ্যাকশন সম্পূর্ণ বিবরণ পেজে।</p>
          </div>
        ) : null}
      </DetailDrawer>
    </AdminShell>
  );
}
