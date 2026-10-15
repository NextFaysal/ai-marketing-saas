"use client";
import React from "react";
import AdminShell from "@/components/AdminShell";
import { API_URL, apiFetch, getAdminToken } from "@/lib/api";
import { fmtDateTime } from "@/lib/dates";

interface Row { id: string; action: string; entityType: string; entityId?: string | null; userId?: string | null; organizationId?: string | null; ipAddress?: string | null; createdAt: string; metadata?: Record<string, unknown> | null }

export default function AuditPage() {
  const [rows, setRows] = React.useState<Row[]>([]);
  const [prefix, setPrefix] = React.useState("admin.");
  const [organizationId, setOrganizationId] = React.useState("");
  const [entityType, setEntityType] = React.useState("");
  const [dateFrom, setDateFrom] = React.useState("");
  const [dateTo, setDateTo] = React.useState("");
  const [take, setTake] = React.useState("100");
  const buildQuery = React.useCallback((forExport: boolean) => {
    const params = new URLSearchParams();
    if (!forExport) params.set("take", take);
    if (prefix) params.set("action", prefix);
    if (organizationId.trim()) params.set("organizationId", organizationId.trim());
    if (entityType.trim()) params.set("entityType", entityType.trim());
    if (dateFrom) params.set("dateFrom", dateFrom);
    if (dateTo) params.set("dateTo", dateTo);
    return params.toString();
  }, [prefix, organizationId, entityType, dateFrom, dateTo, take]);
  React.useEffect(() => {
    apiFetch<Row[]>(`/admin/audit?${buildQuery(false)}`).then(setRows).catch(() => setRows([]));
  }, [buildQuery]);
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
  return (
    <AdminShell title="🧾 Audit Trail">
      <div className="acard overflow-hidden p-0">
        <div className="flex flex-wrap items-center gap-2 border-b border-slate-800 p-4">
          <span className="text-sm text-slate-400">Action prefix:</span>
          <select className="ainput w-full sm:w-48" value={prefix} onChange={(e) => setPrefix(e.target.value)}>
            <option value="admin.">শুধু Admin অ্যাকশন</option>
            <option value="">সব অ্যাকশন</option>
            <option value="auth.">Auth</option>
            <option value="campaign.">Campaign</option>
            <option value="audience.">Audience</option>
          </select>
          <input className="ainput w-full sm:w-48" placeholder="Organization ID" value={organizationId} onChange={(e) => setOrganizationId(e.target.value)} />
          <input className="ainput w-full sm:w-40" placeholder="Entity Type" value={entityType} onChange={(e) => setEntityType(e.target.value)} />
          <label className="flex w-full items-center gap-1 text-sm text-slate-400 sm:w-auto">From <input type="date" className="ainput w-full sm:w-40" value={dateFrom} onChange={(e) => setDateFrom(e.target.value)} /></label>
          <label className="flex w-full items-center gap-1 text-sm text-slate-400 sm:w-auto">To <input type="date" className="ainput w-full sm:w-40" value={dateTo} onChange={(e) => setDateTo(e.target.value)} /></label>
          <label className="flex items-center gap-1 text-sm text-slate-400">Take
            <select className="ainput w-24" value={take} onChange={(e) => setTake(e.target.value)}>
              <option value="50">50</option>
              <option value="100">100</option>
              <option value="200">200</option>
            </select>
          </label>
          <button className="abtn-secondary !px-3 !py-1.5 text-xs w-full sm:w-auto" onClick={exportCsv}>⬇ CSV Export</button>
        </div>
        <table className="atable">
          <thead className="bg-slate-900"><tr><th className="ath">সময়</th><th className="ath">Action</th><th className="ath">Entity</th><th className="ath">Actor</th><th className="ath">IP</th><th className="ath">বিস্তারিত</th></tr></thead>
          <tbody>{rows.map((r) => (
            <tr key={r.id} className="border-t border-slate-800">
              <td className="atd whitespace-nowrap text-slate-400">{fmtDateTime(r.createdAt)}</td>
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
