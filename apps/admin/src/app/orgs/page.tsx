"use client";
import React from "react";
import AdminShell from "@/components/AdminShell";
import { apiFetch } from "@/lib/api";

interface OrgRow { id: string; name: string; slug: string; status: string; country: string; createdAt: string; memberCount: number; orderCount: number; subscription?: { plan: string; status: string } | null }

export default function OrgsPage() {
  const [rows, setRows] = React.useState<OrgRow[]>([]);
  const [q, setQ] = React.useState("");
  const [selected, setSelected] = React.useState<string[]>([]);
  const [bulkMsg, setBulkMsg] = React.useState("");
  const load = React.useCallback(async () => {
    setRows(await apiFetch<OrgRow[]>(`/admin/orgs?take=50${q ? `&q=${encodeURIComponent(q)}` : ""}`).catch(() => []));
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
      <div className="acard overflow-hidden p-0">
        <div className="flex gap-2 border-b border-slate-800 p-4">
          <input className="ainput max-w-sm" placeholder="নাম বা slug দিয়ে খুঁজুন…" value={q} onChange={(e) => setQ(e.target.value)} />
          <button className="abtn-secondary" onClick={load}>খুঁজুন</button>
        </div>
        <table className="atable">
          <thead className="bg-slate-900"><tr><th className="ath"></th><th className="ath">Organization</th><th className="ath">Plan</th><th className="ath">সদস্য</th><th className="ath">Order</th><th className="ath">অবস্থা</th><th className="ath">তৈরি</th></tr></thead>
          <tbody>{rows.map((o) => (
            <tr key={o.id} className="border-t border-slate-800 hover:bg-slate-800/40">
              <td className="atd"><input type="checkbox" checked={selected.includes(o.id)} onChange={(e) => setSelected(e.target.checked ? [...selected, o.id] : selected.filter((x) => x !== o.id))} /></td>
              <td className="atd"><a className="font-medium text-indigo-300 hover:underline" href={`/orgs/${o.id}`}>{o.name}</a><div className="text-xs text-slate-500">{o.slug} · {o.country}</div></td>
              <td className="atd">{o.subscription ? `${o.subscription.plan} (${o.subscription.status})` : "—"}</td>
              <td className="atd">{o.memberCount}</td>
              <td className="atd">{o.orderCount}</td>
              <td className="atd"><span className={o.status === "ACTIVE" ? "abadge-green" : o.status === "SUSPENDED" ? "abadge-amber" : "abadge-red"}>{o.status}</span></td>
              <td className="atd text-slate-400">{new Date(o.createdAt).toLocaleDateString("bn-BD")}</td>
            </tr>
          ))}</tbody>
        </table>
        {rows.length === 0 ? <p className="p-4 text-sm text-slate-500">কোনো Organization পাওয়া যায়নি।</p> : null}
      </div>
    </AdminShell>
  );
}
