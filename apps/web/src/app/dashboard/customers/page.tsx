"use client";
import React, { useCallback, useEffect, useState } from "react";
import { apiFetch, API_URL, getToken } from "@/lib/api";
import { getOrganizationId } from "@/lib/org";
import { EmptyState } from "@repo/ui";
import {
  CustomFieldsEditor, buildCustomFieldsPayload, customFieldsToRaw, fetchCustomFieldDefs,
  type CustomFieldDef,
} from "@/components/custom-fields";

interface CustomerRow {
  id: string; name?: string | null; phone?: string | null; email?: string | null;
  source: string; createdAt: string; orderCount: number; totalSpentMinor: string;
}
interface Detail {
  customer: {
    id: string; name?: string | null; firstName?: string | null; lastName?: string | null;
    phone?: string | null; email?: string | null; source: string; createdAt: string; mergedIntoId?: string | null;
    customFields?: Record<string, unknown> | null;
  };
  orders: { id: string; externalNumber?: string | null; status: string; source: string; isCod: boolean; totalMinor: string; createdAt: string }[];
  conversations: { id: string; channel: string; status: string; lastMessagePreview?: string | null; lastMessageAt?: string | null; unreadCount: number }[];
  shipments: { id: string; trackingCode?: string | null; status: string; provider: string }[];
  lead: { id: string; stage: string; source: string } | null;
  lifetime: { orderCount: number; totalSpentMinor: string; currency: string };
  risk?: { band: string; score: number | null; history: { total: number; delivered: number; returned: number; cancelledOrFailed: number; refunded: number }; reasons: string[]; suggestion: string | null } | null;
  courierRecord?: { decided: number; delivered: number; returned: number; cancelledOrFailed: number; refunded: number; successRatePct: number | null; perCourier: { provider: string; decided: number; delivered: number; successRatePct: number | null }[]; lastDeliveryAt: string | null; totalShipments: number; riskBand: string; riskScore: number | null } | null;
}
const RISK_LABEL: Record<string, { text: string; cls: string }> = {
  high: { text: "ঝুঁকি: উচ্চ", cls: "bg-red-100 text-red-700" },
  medium: { text: "ঝুঁকি: মাঝারি", cls: "bg-amber-100 text-amber-700" },
  low: { text: "ঝুঁকি: কম", cls: "bg-emerald-100 text-emerald-700" },
  unknown: { text: "ঝুঁকি: তথ্য নেই", cls: "bg-slate-100 text-slate-500" },
};

const money = (minor?: string | null, currency = "BDT") =>
  minor == null ? "—" : `${currency === "BDT" ? "৳" : currency + " "}${(Number(minor) / 100).toLocaleString("en-IN", { maximumFractionDigits: 2 })}`;

export default function CustomersPage() {
  const [rows, setRows] = useState<CustomerRow[]>([]);
  const [q, setQ] = useState("");
  const [detail, setDetail] = useState<Detail | null>(null);
  const [mergeTarget, setMergeTarget] = useState("");
  const [custDefs, setCustDefs] = useState<CustomFieldDef[]>([]);
  const [editForm, setEditForm] = useState({ firstName: "", lastName: "", email: "", phone: "" });
  const [editCf, setEditCf] = useState<Record<string, string>>({});
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [busy, setBusy] = useState("");
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    const orgId = getOrganizationId(); if (!orgId) { setLoading(false); return; }
    setLoading(true);
    try {
      setRows(await apiFetch<CustomerRow[]>(`/organizations/${orgId}/customers${q ? `?q=${encodeURIComponent(q)}` : ""}`));
      setError("");
    } catch (e) { setError(e instanceof Error ? e.message : "Failed"); }
    finally { setLoading(false); }
  }, [q]);
  useEffect(() => { load(); }, [load]);
  useEffect(() => { fetchCustomFieldDefs("customer").then(setCustDefs).catch(() => undefined); }, []);

  // CRM C3: CSV export — blob download with the auth header (same
  // pattern as the orders PDF / scorecard CSV downloads).
  async function downloadExport() {
    const orgId = getOrganizationId(); if (!orgId) return;
    setError("");
    try {
      const res = await fetch(`${API_URL}/organizations/${orgId}/customers/export`, { headers: { Authorization: `Bearer ${getToken() ?? ""}` } });
      if (!res.ok) { const body: any = await res.json().catch(() => ({})); throw new Error(body?.message ?? `HTTP ${res.status}`); }
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a"); a.href = url; a.download = "customers-export.csv"; a.click();
      setTimeout(() => URL.revokeObjectURL(url), 5000);
    } catch (e) { setError(e instanceof Error ? e.message : "এক্সপোর্ট ব্যর্থ"); }
  }

  async function open(id: string) {
    const orgId = getOrganizationId(); if (!orgId) return;
    try {
      const d = await apiFetch<Detail>(`/organizations/${orgId}/customers/${id}`);
      setDetail(d); setMergeTarget("");
      setEditForm({
        firstName: d.customer.firstName ?? "", lastName: d.customer.lastName ?? "",
        email: d.customer.email ?? "", phone: d.customer.phone ?? "",
      });
      setEditCf(customFieldsToRaw(custDefs, d.customer.customFields));
    }
    catch (e) { setError(e instanceof Error ? e.message : "Failed"); }
  }

  // CRM C4: the first customer edit path — contact basics + custom
  // fields via PATCH /customers/:id (audited server-side).
  async function saveEdit() {
    const orgId = getOrganizationId(); if (!orgId || !detail) return;
    setBusy("edit"); setError(""); setNotice("");
    try {
      const customFields = buildCustomFieldsPayload(custDefs, editCf, detail.customer.customFields);
      const out = await apiFetch<Detail>(`/organizations/${orgId}/customers/${detail.customer.id}`, {
        method: "PATCH",
        body: JSON.stringify({
          firstName: editForm.firstName || null, lastName: editForm.lastName || null,
          email: editForm.email || null, phone: editForm.phone || null,
          ...(Object.keys(customFields).length ? { customFields } : {}),
        }),
      });
      setDetail(out);
      setEditCf(customFieldsToRaw(custDefs, out.customer.customFields));
      setNotice("কাস্টমারের তথ্য সেভ হয়েছে।");
      await load();
    } catch (e) { setError(e instanceof Error ? e.message : "সেভ ব্যর্থ"); }
    finally { setBusy(""); }
  }

  async function doMerge() {
    const orgId = getOrganizationId(); if (!orgId || !detail || !mergeTarget) return;
    if (!confirm("এই কাস্টমার রেকর্ডটি নির্বাচিত রেকর্ডে মার্জ হবে। অর্ডার ও কথোপকথন সরে যাবে; মূল রেকর্ডটি লুকানো থাকবে (মুছে যাবে না)। নিশ্চিত তো?")) return;
    setBusy("merge"); setNotice("");
    try {
      const merged = await apiFetch<Detail>(`/organizations/${orgId}/customers/merge`, {
        method: "POST", body: JSON.stringify({ sourceId: detail.customer.id, targetId: mergeTarget }),
      });
      setDetail(merged);
      setNotice("মার্জ সম্পন্ন হয়েছে।");
      await load();
    } catch (e) { setError(e instanceof Error ? e.message : "Merge ব্যর্থ"); }
    finally { setBusy(""); }
  }

  return (
    <div className="space-y-5">
      <div>
        <h1 className="page-title">Customers 360</h1>
        <p className="text-slate-500">প্রতিটি গ্রাহকের সম্পূর্ণ ছবি: অর্ডার, কথোপকথন, পার্সেল ও মোট কেনাকাটা। ডুপ্লিকেট রেকর্ড মার্জও এখান থেকে।</p>
      </div>
      {error ? <p className="rounded-xl bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p> : null}
      {notice ? <p className="rounded-xl bg-green-50 px-3 py-2 text-sm text-green-700">{notice}</p> : null}
      <div className="flex gap-2">
        <input className="input w-72" placeholder="নাম, ফোন বা ইমেইল দিয়ে খুঁজুন" value={q} onChange={(e) => setQ(e.target.value)} />
        <button className="rounded-lg border bg-white px-3 py-2 text-sm font-semibold" onClick={downloadExport}>📤 CSV এক্সপোর্ট</button>
      </div>
      <div className="grid gap-4 lg:grid-cols-5">
        <div className="card overflow-hidden p-0 lg:col-span-2">
          {loading ? <p className="p-4 text-sm text-slate-400">লোড হচ্ছে...</p> : rows.length === 0 ? (
            <div className="p-4"><EmptyState title="কোনো কাস্টমার নেই" description="অর্ডার Sync বা চ্যাট থেকে কাস্টমার তৈরি হলে এখানে দেখা যাবে।" /></div>
          ) : rows.map((c) => (
            <button key={c.id} onClick={() => open(c.id)} className={`block w-full border-b px-4 py-3 text-left transition hover:bg-slate-50 ${detail?.customer.id === c.id ? "bg-indigo-50/60" : ""}`}>
              <div className="flex items-center justify-between gap-2">
                <span className="font-medium">{c.name || "নাম নেই"}</span>
                <span className="text-sm font-semibold">{money(c.totalSpentMinor)}</span>
              </div>
              <div className="mt-0.5 text-xs text-slate-400">{c.phone ?? c.email ?? "—"} · {c.orderCount}টি অর্ডার · {c.source}</div>
            </button>
          ))}
        </div>
        <div className="lg:col-span-3">
          {detail ? (
            <div className="space-y-4">
              <div className="card">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div>
                    <h2 className="text-lg font-bold">{detail.customer.name || "নাম নেই"}</h2>
                    <p className="text-sm text-slate-500">{detail.customer.phone ?? "—"} · {detail.customer.email ?? "—"}</p>
                    <p className="text-xs text-slate-400">সূত্র: {detail.customer.source} · যোগ দিয়েছেন {new Date(detail.customer.createdAt).toLocaleDateString()}{detail.lead ? ` · Lead: ${detail.lead.stage}` : ""}</p>
                  </div>
                  <div className="text-right">
                    <div className="text-xl font-black">{money(detail.lifetime.totalSpentMinor, detail.lifetime.currency)}</div>
                    <div className="text-xs text-slate-400">মোট কেনাকাটা (বাতিল ছাড়া) · {detail.lifetime.orderCount}টি অর্ডার</div>
                  </div>
                </div>
                <div className="mt-3 flex flex-wrap items-end gap-2 border-t pt-3">
                  <label className="block text-sm">এই রেকর্ডটি মার্জ করুন যার মধ্যে:
                    <select className="input ml-2 w-56" value={mergeTarget} onChange={(e) => setMergeTarget(e.target.value)}>
                      <option value="">কাস্টমার বেছে নিন</option>
                      {rows.filter((r) => r.id !== detail.customer.id).map((r) => <option key={r.id} value={r.id}>{r.name || r.phone || r.id.slice(0, 8)} ({r.orderCount} অর্ডার)</option>)}
                    </select>
                  </label>
                  <button className="btn-warning" disabled={!mergeTarget || busy !== ""} onClick={doMerge}>{busy === "merge" ? "মার্জ হচ্ছে..." : "মার্জ করুন"}</button>
                </div>
              </div>
              <div className="card space-y-3">
                <h3 className="font-semibold">✏️ তথ্য সম্পাদনা</h3>
                <div className="grid gap-3 md:grid-cols-2">
                  <label className="block text-sm">নামের প্রথম অংশ
                    <input className="input mt-1" value={editForm.firstName} onChange={(e) => setEditForm({ ...editForm, firstName: e.target.value })} />
                  </label>
                  <label className="block text-sm">নামের শেষ অংশ
                    <input className="input mt-1" value={editForm.lastName} onChange={(e) => setEditForm({ ...editForm, lastName: e.target.value })} />
                  </label>
                  <label className="block text-sm">ফোন
                    <input className="input mt-1" value={editForm.phone} onChange={(e) => setEditForm({ ...editForm, phone: e.target.value })} />
                  </label>
                  <label className="block text-sm">ইমেইল
                    <input className="input mt-1" value={editForm.email} onChange={(e) => setEditForm({ ...editForm, email: e.target.value })} />
                  </label>
                  <CustomFieldsEditor defs={custDefs} raw={editCf} onChange={(k, v) => setEditCf({ ...editCf, [k]: v })} />
                </div>
                <div className="flex flex-wrap items-center gap-3">
                  <button className="btn-primary" disabled={busy !== ""} onClick={saveEdit}>{busy === "edit" ? "সেভ হচ্ছে..." : "সেভ করুন"}</button>
                  <span className="text-xs text-slate-400">কাস্টম ফিল্ডের সংজ্ঞা <a className="underline" href="/dashboard/leads">Leads & CRM পেজের</a> “কাস্টম ফিল্ড” অংশ থেকে ম্যানেজ করা হয়।</span>
                </div>
              </div>
              {detail.risk ? (
                <div className="card space-y-1">
                  <h3 className="font-semibold">↩️ রিটার্ন ঝুঁকি <span className={`ml-2 rounded px-2 py-0.5 text-xs font-semibold ${RISK_LABEL[detail.risk.band]?.cls ?? ""}`}>{RISK_LABEL[detail.risk.band]?.text ?? detail.risk.band}{detail.risk.score != null ? ` · স্কোর ${detail.risk.score}/১০০` : ""}</span></h3>
                  <p className="text-sm text-slate-600">মোট {detail.risk.history.total}টি অর্ডার · ডেলিভারি {detail.risk.history.delivered}টি · রিটার্ন {detail.risk.history.returned}টি · বাতিল/ব্যর্থ {detail.risk.history.cancelledOrFailed}টি · রিফান্ড {detail.risk.history.refunded}টি</p>
                  <ul className="list-disc space-y-0.5 pl-5 text-xs text-slate-500">
                    {detail.risk.reasons.slice(0, 4).map((r, i) => <li key={i}>{r}</li>)}
                  </ul>
                  {detail.risk.suggestion ? <p className="text-xs font-medium text-amber-700">{detail.risk.suggestion}</p> : null}
                </div>
              ) : null}
              {detail.courierRecord ? (
                <div className="card space-y-2">
                  <h3 className="font-semibold">🚚 Courier Record</h3>
                  {detail.courierRecord.decided === 0 ? (
                    <p className="text-sm text-slate-500">এখনো কোনো ডেলিভারি ইতিহাস নেই</p>
                  ) : (
                    <>
                      <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
                        <span className="text-3xl font-bold text-emerald-700">{detail.courierRecord.successRatePct}%</span>
                        <span className="text-sm font-medium text-slate-600">ডেলিভারি সফলতার হার</span>
                        <span className="text-xs text-slate-400">(সিদ্ধান্ত হয়েছে এমন {detail.courierRecord.decided}টি অর্ডারের মধ্যে ডেলিভারি {detail.courierRecord.delivered}টি — এই হারটি রিটার্ন ঝুঁকির স্কোরের উল্টো নয়, দুটি আলাদা হিসাব)</span>
                      </div>
                      <p className="text-sm text-slate-600">রিটার্ন {detail.courierRecord.returned}টি · বাতিল/ব্যর্থ {detail.courierRecord.cancelledOrFailed}টি · রিফান্ড {detail.courierRecord.refunded}টি · মোট শিপমেন্ট {detail.courierRecord.totalShipments}টি{detail.courierRecord.lastDeliveryAt ? ` · সর্বশেষ ডেলিভারি: ${new Date(detail.courierRecord.lastDeliveryAt).toLocaleDateString("bn-BD")}` : ""}</p>
                      {detail.courierRecord.perCourier.length > 0 ? (
                        <table className="w-full text-sm">
                          <thead>
                            <tr className="border-b text-left text-xs text-slate-400"><th className="py-1 font-medium">কুরিয়ার</th><th className="py-1 font-medium">সিদ্ধান্ত হয়েছে</th><th className="py-1 font-medium">ডেলিভারি</th><th className="py-1 font-medium">সফলতার হার</th></tr>
                          </thead>
                          <tbody>
                            {detail.courierRecord.perCourier.map((p) => (
                              <tr key={p.provider} className="border-b last:border-0">
                                <td className="py-1 font-medium">{p.provider}</td>
                                <td className="py-1">{p.decided}টি</td>
                                <td className="py-1">{p.delivered}টি</td>
                                <td className="py-1">{p.successRatePct != null ? `${p.successRatePct}%` : "—"}</td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      ) : null}
                    </>
                  )}
                </div>
              ) : null}
              <div className="card">
                <h3 className="mb-2 font-semibold">অর্ডারসমূহ</h3>
                {detail.orders.length === 0 ? <p className="text-sm text-slate-400">কোনো অর্ডার নেই</p> : detail.orders.map((o) => (
                  <div key={o.id} className="flex items-center justify-between border-b py-2 text-sm last:border-0">
                    <span>#{o.externalNumber ?? o.id.slice(0, 8)} <span className="badge-slate ml-1">{o.status}</span>{o.isCod ? <span className="badge-amber ml-1">COD</span> : null}</span>
                    <span className="font-medium">{money(o.totalMinor)}</span>
                  </div>
                ))}
                {detail.shipments.map((s) => (
                  <div key={s.id} className="py-1 text-xs text-slate-500">🚚 {s.provider}: {s.status}{s.trackingCode ? ` · ${s.trackingCode}` : ""}</div>
                ))}
              </div>
              <div className="card">
                <h3 className="mb-2 font-semibold">কথোপকথন</h3>
                {detail.conversations.length === 0 ? <p className="text-sm text-slate-400">কোনো কথোপকথন নেই</p> : detail.conversations.map((c) => (
                  <a key={c.id} href="/dashboard/inbox" className="block border-b py-2 text-sm last:border-0 hover:bg-slate-50">
                    <span className="badge-indigo">{c.channel}</span> <span className="badge-slate ml-1">{c.status}</span>
                    <span className="ml-2 text-slate-600">{c.lastMessagePreview ?? ""}</span>
                    {c.unreadCount > 0 ? <span className="badge-red ml-1">{c.unreadCount} অপঠিত</span> : null}
                  </a>
                ))}
              </div>
            </div>
          ) : (
            <div className="card"><EmptyState title="কাস্টমার বেছে নিন" description="বাম দিকের তালিকা থেকে একজন কাস্টমারে ক্লিক করলে তার সম্পূর্ণ প্রোফাইল এখানে দেখা যাবে।" /></div>
          )}
        </div>
      </div>
    </div>
  );
}
