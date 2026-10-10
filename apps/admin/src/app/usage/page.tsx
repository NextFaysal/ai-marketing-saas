"use client";
import React from "react";
import AdminShell from "@/components/AdminShell";
import { apiFetch } from "@/lib/api";

interface Row { organizationId: string; name: string; status: string; aiCalls30d: number; aiTokens30d: number; deliveries30d: number; broadcastsTotal: number; workflowRuns30d: number; courierShipmentsTotal: number; orders30d: number }

export default function UsagePage() {
  const [rows, setRows] = React.useState<Row[]>([]);
  React.useEffect(() => { apiFetch<Row[]>("/admin/usage").then(setRows).catch(() => setRows([])); }, []);
  return (
    <AdminShell title="📈 Usage & Cost (শেষ ৩০ দিন)">
      <div className="acard overflow-hidden p-0">
        <table className="w-full">
          <thead className="bg-slate-900"><tr><th className="ath">Organization</th><th className="ath">AI কল</th><th className="ath">AI টোকেন</th><th className="ath">Message Delivery</th><th className="ath">Broadcast</th><th className="ath">Workflow Run</th><th className="ath">Courier</th><th className="ath">Order</th></tr></thead>
          <tbody>{rows.map((r) => (
            <tr key={r.organizationId} className="border-t border-slate-800">
              <td className="atd"><a className="text-indigo-300 hover:underline" href={`/orgs/${r.organizationId}`}>{r.name}</a>{r.status !== "ACTIVE" ? <span className="abadge-amber ml-2">{r.status}</span> : null}</td>
              <td className="atd">{r.aiCalls30d}</td><td className="atd">{r.aiTokens30d.toLocaleString()}</td>
              <td className="atd">{r.deliveries30d}</td><td className="atd">{r.broadcastsTotal}</td>
              <td className="atd">{r.workflowRuns30d}</td><td className="atd">{r.courierShipmentsTotal}</td><td className="atd">{r.orders30d}</td>
            </tr>
          ))}</tbody>
        </table>
        {rows.length === 0 ? <p className="p-4 text-sm text-slate-500">কোনো Organization নেই।</p> : null}
      </div>
      <p className="mt-3 text-xs text-slate-500">AI খরচ টাকায় দেখানো হয়নি — প্রোভাইডার অনুযায়ী টোকেনের দাম বদলায়; এখানে শুধু প্রকৃত ব্যবহার (কল ও টোকেন) দেখানো হচ্ছে।</p>
    </AdminShell>
  );
}
