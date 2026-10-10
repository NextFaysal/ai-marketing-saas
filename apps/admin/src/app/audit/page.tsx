"use client";
import React from "react";
import AdminShell from "@/components/AdminShell";
import { apiFetch } from "@/lib/api";

interface Row { id: string; action: string; entityType: string; entityId?: string | null; userId?: string | null; ipAddress?: string | null; createdAt: string; metadata?: Record<string, unknown> | null }

export default function AuditPage() {
  const [rows, setRows] = React.useState<Row[]>([]);
  const [prefix, setPrefix] = React.useState("admin.");
  React.useEffect(() => {
    apiFetch<Row[]>(`/admin/audit?take=100${prefix ? `&action=${encodeURIComponent(prefix)}` : ""}`).then(setRows).catch(() => setRows([]));
  }, [prefix]);
  return (
    <AdminShell title="🧾 Audit Trail">
      <div className="acard overflow-hidden p-0">
        <div className="flex items-center gap-2 border-b border-slate-800 p-4">
          <span className="text-sm text-slate-400">Action prefix:</span>
          <select className="ainput w-48" value={prefix} onChange={(e) => setPrefix(e.target.value)}>
            <option value="admin.">শুধু Admin অ্যাকশন</option>
            <option value="">সব অ্যাকশন</option>
            <option value="auth.">Auth</option>
            <option value="campaign.">Campaign</option>
            <option value="audience.">Audience</option>
          </select>
        </div>
        <table className="atable">
          <thead className="bg-slate-900"><tr><th className="ath">সময়</th><th className="ath">Action</th><th className="ath">Entity</th><th className="ath">Actor</th><th className="ath">IP</th><th className="ath">বিস্তারিত</th></tr></thead>
          <tbody>{rows.map((r) => (
            <tr key={r.id} className="border-t border-slate-800">
              <td className="atd whitespace-nowrap text-slate-400">{new Date(r.createdAt).toLocaleString("bn-BD")}</td>
              <td className="atd font-medium">{r.action}</td>
              <td className="atd text-slate-400">{r.entityType}{r.entityId ? ` · ${r.entityId.slice(0, 8)}…` : ""}</td>
              <td className="atd text-slate-400">{r.userId ? `${r.userId.slice(0, 8)}…` : "—"}</td>
              <td className="atd text-slate-400">{r.ipAddress ?? "—"}</td>
              <td className="atd max-w-xs truncate text-slate-500">{r.metadata ? JSON.stringify(r.metadata) : ""}</td>
            </tr>
          ))}</tbody>
        </table>
        {rows.length === 0 ? <p className="p-4 text-sm text-slate-500">কোনো রেকর্ড নেই।</p> : null}
      </div>
    </AdminShell>
  );
}
