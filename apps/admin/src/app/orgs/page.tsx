"use client";
import React from "react";
import AdminShell from "@/components/AdminShell";
import { apiFetch } from "@/lib/api";

interface OrgRow { id: string; name: string; slug: string; status: string; country: string; createdAt: string; memberCount: number; orderCount: number; subscription?: { plan: string; status: string } | null }

export default function OrgsPage() {
  const [rows, setRows] = React.useState<OrgRow[]>([]);
  const [q, setQ] = React.useState("");
  const load = React.useCallback(async () => {
    setRows(await apiFetch<OrgRow[]>(`/admin/orgs?take=50${q ? `&q=${encodeURIComponent(q)}` : ""}`).catch(() => []));
  }, [q]);
  React.useEffect(() => { load(); }, [load]);
  return (
    <AdminShell title="🏢 Organizations">
      <div className="acard overflow-hidden p-0">
        <div className="flex gap-2 border-b border-slate-800 p-4">
          <input className="ainput max-w-sm" placeholder="নাম বা slug দিয়ে খুঁজুন…" value={q} onChange={(e) => setQ(e.target.value)} />
          <button className="abtn-secondary" onClick={load}>খুঁজুন</button>
        </div>
        <table className="w-full">
          <thead className="bg-slate-900"><tr><th className="ath">Organization</th><th className="ath">Plan</th><th className="ath">সদস্য</th><th className="ath">Order</th><th className="ath">অবস্থা</th><th className="ath">তৈরি</th></tr></thead>
          <tbody>{rows.map((o) => (
            <tr key={o.id} className="border-t border-slate-800 hover:bg-slate-800/40">
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
