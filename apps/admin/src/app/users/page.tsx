"use client";
import React from "react";
import AdminShell from "@/components/AdminShell";
import { apiFetch } from "@/lib/api";

interface UserRow { id: string; email: string; name: string; isSuperAdmin: boolean; adminTier?: string | null; status: string; lastLoginAt?: string | null; createdAt: string; organizationCount: number }

export default function UsersPage() {
  const [rows, setRows] = React.useState<UserRow[]>([]);
  const [q, setQ] = React.useState("");
  const [error, setError] = React.useState("");
  const load = React.useCallback(async () => {
    setRows(await apiFetch<UserRow[]>(`/admin/users?take=50${q ? `&q=${encodeURIComponent(q)}` : ""}`).catch((e) => { setError(e.message); return []; }));
  }, [q]);
  React.useEffect(() => { load(); }, [load]);
  return (
    <AdminShell title="👤 Users">
      {error ? <p className="mb-3 rounded-lg bg-red-500/10 p-3 text-sm text-red-300">{error}</p> : null}
      <div className="acard overflow-hidden p-0">
        <div className="flex gap-2 border-b border-slate-800 p-4">
          <input className="ainput max-w-sm" placeholder="ইমেইল বা নাম দিয়ে খুঁজুন…" value={q} onChange={(e) => setQ(e.target.value)} />
          <button className="abtn-secondary" onClick={load}>খুঁজুন</button>
        </div>
        <table className="w-full">
          <thead className="bg-slate-900"><tr><th className="ath">User</th><th className="ath">Org</th><th className="ath">অবস্থা</th><th className="ath">শেষ লগইন</th><th className="ath">যোগ দিয়েছেন</th></tr></thead>
          <tbody>{rows.map((u) => (
            <tr key={u.id} className="border-t border-slate-800 hover:bg-slate-800/40">
              <td className="atd"><a className="font-medium text-indigo-300 hover:underline" href={`/users/${u.id}`}>{u.name}</a><div className="text-xs text-slate-500">{u.email}{u.isSuperAdmin ? ` · 🛡 ${u.adminTier ?? "SUPER"}` : ""}</div></td>
              <td className="atd">{u.organizationCount}</td>
              <td className="atd"><span className={u.status === "ACTIVE" ? "abadge-green" : u.status === "SUSPENDED" ? "abadge-amber" : "abadge-red"}>{u.status}</span></td>
              <td className="atd text-slate-400">{u.lastLoginAt ? new Date(u.lastLoginAt).toLocaleString("bn-BD") : "—"}</td>
              <td className="atd text-slate-400">{new Date(u.createdAt).toLocaleDateString("bn-BD")}</td>
            </tr>
          ))}</tbody>
        </table>
        {rows.length === 0 ? <p className="p-4 text-sm text-slate-500">কোনো User পাওয়া যায়নি।</p> : null}
      </div>
    </AdminShell>
  );
}
