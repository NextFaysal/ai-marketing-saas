"use client";
import React, { useCallback, useEffect, useState } from "react";
import { apiFetch } from "@/lib/api";
import { getOrganizationId } from "@/lib/org";
import { formatMinor } from "@repo/contracts";
import { EmptyState, KpiCard } from "@repo/ui";

interface Store { id: string; name: string; url: string; trackingKey?: string | null }
interface Report {
  model: string; windowDays: number;
  totals: { orders: number; ordersRevenueMinor: string; attributedRevenueMinor: string; unattributedRevenueMinor: string; ordersWithoutCredits: number };
  byChannel: { source: string; campaign: string | null; revenueMinor: string; orders: number }[];
  reconciliation: { trackedPurchaseEvents: number; purchaseEventsWithoutMatchingOrder: number; uncreditedRevenueMinor: string; note: string };
}

const MODELS = [
  { value: "LAST_TOUCH", label: "Last Touch" },
  { value: "FIRST_TOUCH", label: "First Touch" },
  { value: "LAST_NON_DIRECT", label: "Last Non-Direct" },
  { value: "LINEAR", label: "Linear" },
];
const API_URL = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:4000";

export default function AttributionPage() {
  const [stores, setStores] = useState<Store[]>([]);
  const [report, setReport] = useState<Report | null>(null);
  const [model, setModel] = useState("LAST_TOUCH");
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    const orgId = getOrganizationId();
    if (!orgId) { setError("কোনো Organization নির্বাচিত নেই।"); setLoading(false); return; }
    setLoading(true);
    try {
      const [s, r] = await Promise.all([
        apiFetch<Store[]>(`/organizations/${orgId}/stores`),
        apiFetch<Report>(`/organizations/${orgId}/attribution/report?model=${model}`),
      ]);
      setStores(s); setReport(r); setError("");
    } catch (e) { setError(e instanceof Error ? e.message : "Failed to load"); }
    finally { setLoading(false); }
  }, [model]);

  useEffect(() => { load(); }, [load]);

  async function reconcile() {
    const orgId = getOrganizationId(); if (!orgId) return;
    setNotice("");
    try {
      const res = await apiFetch<{ checked: number; computed: number; noTrackingEvidence: number }>(
        `/organizations/${orgId}/attribution/reconcile`, { method: "POST" });
      setNotice(`Reconcile শেষ: ${res.checked}টি অর্ডার যাচাই, ${res.computed}টি নতুন করে Attributed, ${res.noTrackingEvidence}টির কোনো Tracking প্রমাণ নেই (সেগুলো Unattributed থাকবে)।`);
      await load();
    } catch (e) { setError(e instanceof Error ? e.message : "Reconcile failed"); }
  }

  const webOrigin = typeof window !== "undefined" ? window.location.origin : "";

  return (
    <div className="space-y-6">
      <div>
        <h1 className="page-title">Attribution</h1>
        <p className="text-sm text-slate-500">First-party Tracking দিয়ে কোন চ্যানেল আসল Revenue আনছে তা দেখুন। যার প্রমাণ নেই তা Unattributed, অনুমান করে কোনো চ্যানেলে দেওয়া হয় না। Window: {report?.windowDays ?? 30} দিন।</p>
        <label className="mt-2 block text-sm">Attribution Window
          <select className="input ml-2 w-32" value={report?.windowDays ?? 30} onChange={async (e) => {
            const orgId = getOrganizationId(); if (!orgId) return;
            try {
              await apiFetch(`/organizations/${orgId}/attribution/settings`, { method: "PATCH", body: JSON.stringify({ windowDays: Number(e.target.value) }) });
              setNotice("Window বদলানো হয়েছে। আগের অর্ডারের Credit এ প্রয়োগ করতে Reconcile চালান।");
              await load();
            } catch (err) { setError(err instanceof Error ? err.message : "Window update failed"); }
          }}>
            {[7, 14, 30, 60, 90].map((d) => <option key={d} value={d}>{d} দিন</option>)}
          </select>
        </label>
      </div>
      {error ? <p className="rounded-lg bg-red-50 p-3 text-sm text-red-700">{error}</p> : null}
      {notice ? <p className="rounded-lg bg-green-50 p-3 text-sm text-green-700">{notice}</p> : null}

      <div className="card p-5">
        <div className="font-semibold">Tracking Script বসান</div>
        <p className="mt-1 text-sm text-slate-500">প্রতিটি স্টোরের আলাদা Key। স্ক্রিপ্টটি স্টোরের সব পেজে (WooCommerce এ Header/Footer প্লাগইন বা Child Theme দিয়ে) বসান। Thank-you পেজে <code>window.TP.purchase(orderId, total, "BDT")</code> কল করলে Purchase Event যাবে।</p>
        {stores.length === 0 ? <p className="mt-2 text-sm text-slate-500">আগে Stores & Integrations থেকে একটি স্টোর যোগ করুন।</p> : stores.map((s) => (
          <div key={s.id} className="mt-3">
            <div className="text-sm font-medium">{s.name}</div>
            <pre className="mt-1 overflow-auto rounded-lg bg-slate-900 p-3 text-xs text-green-300">{`<script async src="${webOrigin}/tracker.js" data-key="${s.trackingKey ?? "(key তৈরি হয়নি, স্টোরটি আবার তৈরি করুন)"}" data-api="${API_URL}"></script>`}</pre>
          </div>
        ))}
      </div>

      <div className="flex items-center gap-3">
        <label className="text-sm">মডেল
          <select className="ml-2 rounded-lg border bg-white px-3 py-2" value={model} onChange={(e) => setModel(e.target.value)}>
            {MODELS.map((m) => <option key={m.value} value={m.value}>{m.label}</option>)}
          </select>
        </label>
        <button className="btn-primary" onClick={reconcile}>Reconcile চালান</button>
      </div>

      {loading ? <p className="text-sm text-slate-500">লোড হচ্ছে...</p> : report ? (
        <>
          <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
            <KpiCard label="মোট Revenue (অর্ডার)" value={formatMinor(BigInt(report.totals.ordersRevenueMinor))} hint={`${report.totals.orders}টি অর্ডার, cancelled/refunded বাদ`} />
            <KpiCard label="Attributed Revenue" value={formatMinor(BigInt(report.totals.attributedRevenueMinor))} hint={`${model} মডেলে`} />
            <KpiCard label="Unattributed Revenue" value={formatMinor(BigInt(report.totals.unattributedRevenueMinor))} hint={`${report.totals.ordersWithoutCredits}টি অর্ডারের কোনো Credit নেই`} />
            <KpiCard label="Tracked Purchase Events" value={String(report.reconciliation.trackedPurchaseEvents)} hint={`অর্ডার পাওয়া যায়নি: ${report.reconciliation.purchaseEventsWithoutMatchingOrder}টি`} />
          </div>
          {report.byChannel.length === 0 ? (
            <EmptyState title="এখনো কোনো Attribution Credit নেই" description="Tracking Script বসিয়ে Purchase Event আসলে অথবা Reconcile চালালে এখানে চ্যানেলভিত্তিক Revenue দেখা যাবে।" />
          ) : (
            <div className="overflow-hidden card">
              <table className="w-full text-left text-sm">
                <thead className="bg-slate-50 text-slate-500"><tr>
                  <th className="px-4 py-3">Source</th><th className="px-4 py-3">Campaign</th><th className="px-4 py-3">অর্ডার</th><th className="px-4 py-3">Revenue</th>
                </tr></thead>
                <tbody>
                  {report.byChannel.map((c, i) => (
                    <tr key={i} className="border-t">
                      <td className="px-4 py-3 font-medium">{c.source === "unattributed" ? <span className="text-slate-400">Unattributed (প্রমাণ নেই)</span> : c.source}</td>
                      <td className="px-4 py-3">{c.campaign ?? "—"}</td>
                      <td className="px-4 py-3">{c.orders}</td>
                      <td className="px-4 py-3">{formatMinor(BigInt(c.revenueMinor))}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          <p className="text-xs text-slate-400">{report.reconciliation.note} Cross-device ও Cross-platform Attribution কখনো নিখুঁত হয় না, তাই এই সংখ্যা প্ল্যাটফর্মের নিজের রিপোর্টের সাথে হুবহু মিলবে না, এটাই স্বাভাবিক।</p>
        </>
      ) : null}
    </div>
  );
}
