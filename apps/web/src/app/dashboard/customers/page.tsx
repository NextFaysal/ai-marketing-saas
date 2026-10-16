"use client";
import React, { useCallback, useEffect, useState } from "react";
import { apiFetch, API_URL, getToken } from "@/lib/api";
import { getOrganizationId } from "@/lib/org";
import { EmptyState } from "@repo/ui";
import {
  CustomFieldsEditor, buildCustomFieldsPayload, customFieldsToRaw, fetchCustomFieldDefs,
  type CustomFieldDef,
} from "@/components/custom-fields";
import { minorToTaka, takaToMinor } from "@/lib/orders-on1";
import { agingRows, isOverLimit, type CustomerKhata } from "@/lib/orders-on7";
import RfmRetentionStudio from "./components/RfmRetentionStudio";

interface CustomerRow {
  id: string; name?: string | null; phone?: string | null; email?: string | null;
  source: string; createdAt: string; orderCount: number; totalSpentMinor: string;
  // ON7: list rows now carry the open due + credit limit.
  dueMinor?: string; creditLimitMinor?: string | null;
}
interface Detail {
  customer: {
    id: string; name?: string | null; firstName?: string | null; lastName?: string | null;
    phone?: string | null; email?: string | null; source: string; createdAt: string; mergedIntoId?: string | null;
    customFields?: Record<string, unknown> | null;
    // EC24d: staff-set wholesale flag.
    isWholesale?: boolean;
  };
  orders: { id: string; externalNumber?: string | null; status: string; source: string; isCod: boolean; totalMinor: string; createdAt: string }[];
  conversations: { id: string; channel: string; status: string; lastMessagePreview?: string | null; lastMessageAt?: string | null; unreadCount: number }[];
  shipments: { id: string; trackingCode?: string | null; status: string; provider: string }[];
  lead: { id: string; stage: string; source: string } | null;
  lifetime: { orderCount: number; totalSpentMinor: string; currency: string };
  storeIdentities?: { storeId: string; storeName?: string | null; platform?: string | null; externalId: string; emailSnapshot?: string | null; phoneSnapshot?: string | null }[];
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
  const [stores, setStores] = useState<{ id: string; name: string; platform?: string; syncMode?: string }[]>([]);
  const [q, setQ] = useState("");
  // ON7: due-only filter + the খাতা (ledger) section state.
  const [hasDue, setHasDue] = useState(false);
  const [khata, setKhata] = useState<CustomerKhata | null>(null);
  const [khataError, setKhataError] = useState("");
  const [creditTaka, setCreditTaka] = useState("");
  const [creditBusy, setCreditBusy] = useState(false);
  const [creditNotice, setCreditNotice] = useState("");
  const [creditError, setCreditError] = useState("");
  const [detail, setDetail] = useState<Detail | null>(null);
  // CX12b: the open customer's reviews for the 360 view.
  const [custReviews, setCustReviews] = useState<{ id: string; orderId: string; rating: number | null; comment: string | null; status: string; receivedAt: string | null; orderNumber: string | null }[]>([]);
  const [mergeTarget, setMergeTarget] = useState("");
  const [custDefs, setCustDefs] = useState<CustomFieldDef[]>([]);
  const [editForm, setEditForm] = useState({ firstName: "", lastName: "", email: "", phone: "" });
  // EC24d: wholesale toggle in the customer edit form.
  const [editWholesale, setEditWholesale] = useState(false);
  const [editCf, setEditCf] = useState<Record<string, string>>({});
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [busy, setBusy] = useState("");
  const [loading, setLoading] = useState(true);
  // CP6: GDPR erasure report for the last erased customer.
  const [eraseReport, setEraseReport] = useState<{ customerId: string; ordersAnonymized: number; identitiesDeleted: number; reviewsRedacted: number; abandonedCheckoutsDeleted: number } | null>(null);
  const [activeTab, setActiveTab] = useState<"directory" | "rfm">("directory");

  const load = useCallback(async () => {
    const orgId = getOrganizationId(); if (!orgId) { setLoading(false); return; }
    setLoading(true);
    try {
      const params = new URLSearchParams();
      if (q) params.set("q", q);
      if (hasDue) params.set("hasDue", "true");
      const qs = params.toString();
      setRows(await apiFetch<CustomerRow[]>(`/organizations/${orgId}/customers${qs ? `?${qs}` : ""}`));
      setError("");
    } catch (e) { setError(e instanceof Error ? e.message : "Failed"); }
    finally { setLoading(false); }
  }, [q, hasDue]);

  /** ON7: load the customer's খাতা (ledger) — open orders with
   * paid/due split, aging buckets and the credit limit. A failed
   * load says so; it never renders as "no dues". */
  const loadKhata = useCallback(async (customerId: string) => {
    const orgId = getOrganizationId(); if (!orgId) return;
    try {
      const k = await apiFetch<CustomerKhata>(`/organizations/${orgId}/customers/${customerId}/khata`);
      setKhata(k); setKhataError("");
      setCreditTaka(k.creditLimitMinor ? minorToTaka(k.creditLimitMinor) : "");
    } catch (e) {
      setKhata(null);
      setKhataError(e instanceof Error ? e.message : "খাতা লোড ব্যর্থ");
    }
  }, []);

  /** ON7: save the credit limit via the existing customer PATCH
   * (taka input -> minor string; an empty input clears the
   * limit to null). The server's reply is shown verbatim. */
  async function saveCreditLimit() {
    const orgId = getOrganizationId(); if (!orgId || !detail) return;
    const raw = creditTaka.trim();
    let creditLimitMinor: string | null = null;
    if (raw) {
      const m = takaToMinor(raw);
      if (m === null) { setCreditError("ক্রেডিট সীমা টাকায় ঠিকভাবে লিখুন (যেমন: 5000 বা 5000.50)।"); return; }
      creditLimitMinor = m;
    }
    setCreditBusy(true); setCreditError(""); setCreditNotice("");
    try {
      await apiFetch(`/organizations/${orgId}/customers/${detail.customer.id}`, {
        method: "PATCH", body: JSON.stringify({ creditLimitMinor }),
      });
      setCreditNotice(creditLimitMinor === null ? "ক্রেডিট সীমা তুলে নেওয়া হয়েছে।" : "ক্রেডিট সীমা সংরক্ষণ হয়েছে।");
      await loadKhata(detail.customer.id);
      await load();
    } catch (e) { setCreditError(e instanceof Error ? e.message : "ক্রেডিট সীমা সংরক্ষণ ব্যর্থ"); }
    finally { setCreditBusy(false); }
  }
  useEffect(() => { load(); }, [load]);
  useEffect(() => { fetchCustomFieldDefs("customer").then(setCustDefs).catch(() => undefined); }, []);
  useEffect(() => {
    const orgId = getOrganizationId(); if (!orgId) return;
    apiFetch<{ id: string; name: string; platform?: string; syncMode?: string }[]>(`/organizations/${orgId}/stores`).then(setStores).catch(() => undefined);
  }, []);

  // EC6: explicit, opt-in push of this customer to one store —
  // never automatic. The server refuses mirror-mode stores with a
  // reason, which is surfaced verbatim.
  async function pushToStore(storeId: string) {
    const orgId = getOrganizationId(); if (!orgId || !detail) return;
    setBusy(`push-${storeId}`); setError(""); setNotice("");
    try {
      await apiFetch(`/organizations/${orgId}/customers/${detail.customer.id}/push-to-store/${storeId}`, { method: "POST" });
      setNotice("Push Outbox-এ জমা হয়েছে — Sync Center-এ ফলাফল দেখা যাবে।");
    } catch (e) { setError(e instanceof Error ? e.message : "Push ব্যর্থ"); }
    finally { setBusy(""); }
  }

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
    setKhata(null); setKhataError(""); setCreditNotice(""); setCreditError("");
    void loadKhata(id);
    try {
      const d = await apiFetch<Detail>(`/organizations/${orgId}/customers/${id}`);
      setDetail(d); setMergeTarget("");
      // CX12b: this customer's reviews (360 surface).
      apiFetch<{ id: string; orderId: string; rating: number | null; comment: string | null; status: string; receivedAt: string | null; orderNumber: string | null }[]>(`/organizations/${orgId}/reviews?customerId=${id}`).then(setCustReviews).catch(() => setCustReviews([]));
      setEditForm({
        firstName: d.customer.firstName ?? "", lastName: d.customer.lastName ?? "",
        email: d.customer.email ?? "", phone: d.customer.phone ?? "",
      });
      setEditWholesale(!!d.customer.isWholesale);
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
          isWholesale: editWholesale,
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

  // CP6: GDPR deep erasure — irreversible PII removal. Order
  // financial records stay; the confirm dialog says so plainly.
  async function doErase() {
    const orgId = getOrganizationId(); if (!orgId || !detail) return;
    if (!confirm("এই কাস্টমারের ব্যক্তিগত তথ্য (নাম, ফোন, ইমেইল, ঠিকানা) স্থায়ীভাবে মুছে ফেলা হবে — এটি ফেরত আনা যাবে না। অর্ডারের আর্থিক রেকর্ড (টাকার হিসাব) থেকে যাবে, কিন্তু অর্ডারের ঠিকানা মুছে যাবে। নিশ্চিত তো?")) return;
    setBusy("erase"); setError(""); setNotice(""); setEraseReport(null);
    try {
      const report = await apiFetch<{ customerId: string; ordersAnonymized: number; identitiesDeleted: number; reviewsRedacted: number; abandonedCheckoutsDeleted: number }>(
        `/organizations/${orgId}/customers/${detail.customer.id}/erase`, { method: "POST" },
      );
      setEraseReport(report);
      setNotice("কাস্টমারের ব্যক্তিগত তথ্য মুছে ফেলা হয়েছে।");
      await load();
      await open(report.customerId);
    } catch (e) { setError(e instanceof Error ? e.message : "মুছে ফেলা ব্যর্থ"); }
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
      <div className="flex flex-col gap-2 md:flex-row md:items-center md:justify-between">
        <div>
          <h1 className="page-title">Customers 360 & LTV Retention</h1>
          <p className="text-slate-500">প্রতিটি গ্রাহকের সম্পূর্ণ ছবি: অর্ডার, কথোপকথন, পার্সেল, RFM সেগমেন্টেশন ও গ্রাহক ধরে রাখার বিজ্ঞানসম্মত টুলস।</p>
        </div>
      </div>
      {error ? <p className="rounded-xl bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p> : null}
      {notice ? <p className="rounded-xl bg-green-50 px-3 py-2 text-sm text-green-700">{notice}</p> : null}

      {/* Main Mode Navigation Tabs */}
      <div className="flex border-b border-slate-200">
        <button
          onClick={() => setActiveTab("directory")}
          className={`flex items-center gap-2 border-b-2 px-5 py-3 text-sm font-bold transition ${
            activeTab === "directory"
              ? "border-indigo-600 text-indigo-600 bg-indigo-50/20"
              : "border-transparent text-slate-500 hover:text-slate-800"
          }`}
        >
          <span>👥 কাস্টমার ডিরেক্টরি (360 ভিউ)</span>
          <span className="rounded-full bg-slate-100 px-2 py-0.5 text-xs text-slate-600">{rows.length}</span>
        </button>

        <button
          onClick={() => setActiveTab("rfm")}
          className={`flex items-center gap-2 border-b-2 px-5 py-3 text-sm font-bold transition ${
            activeTab === "rfm"
              ? "border-indigo-600 text-indigo-600 bg-indigo-50/20"
              : "border-transparent text-slate-500 hover:text-slate-800"
          }`}
        >
          <span>💎 RFM সেগমেন্টেশন ও LTV Retention Studio</span>
          <span className="rounded-full bg-indigo-100 px-2 py-0.5 text-[10px] font-black text-indigo-700">
            AI CRM
          </span>
        </button>
      </div>

      {activeTab === "rfm" ? (
        <RfmRetentionStudio
          onSelectCustomer={(id) => {
            setActiveTab("directory");
            open(id);
          }}
        />
      ) : (
        <>
          <div className="flex flex-wrap items-center gap-2">
            <input className="input w-72" placeholder="নাম, ফোন বা ইমেইল দিয়ে খুঁজুন" value={q} onChange={(e) => setQ(e.target.value)} />
            <label className="flex items-center gap-2 text-sm">
              <input type="checkbox" checked={hasDue} onChange={(e) => setHasDue(e.target.checked)} />
              শুধু বকেয়া আছে
            </label>
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
              {/* ON7: বকেয়া (open due) on the list row — "—" when nothing is due. */}
              <div className="mt-0.5 text-xs">
                <span className="text-slate-400">বকেয়া: </span>
                {(() => { let due = 0n; try { due = BigInt(c.dueMinor ?? "0"); } catch { due = 0n; } return due > 0n
                  ? <span className="font-bold text-red-600">{money(c.dueMinor)}</span>
                  : <span className="text-slate-400">—</span>; })()}
                {c.creditLimitMinor ? <span className="ml-2 text-slate-400">· ক্রেডিট সীমা: {money(c.creditLimitMinor)}</span> : null}
              </div>
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
                <div className="mt-3 flex flex-wrap items-center gap-3 border-t border-red-100 pt-3">
                  <button className="rounded-lg bg-red-600 px-3 py-2 text-sm font-semibold text-white disabled:opacity-50" disabled={busy !== ""} onClick={doErase}>
                    {busy === "erase" ? "মোছা হচ্ছে..." : "🗑️ ব্যক্তিগত তথ্য মুছে ফেলুন (GDPR)"}
                  </button>
                  <span className="text-xs text-slate-500">শুধু Owner/Admin পারবেন। অর্ডারের আর্থিক রেকর্ড থেকে যাবে, ব্যক্তিগত তথ্য থাকবে না।</span>
                </div>
                {eraseReport ? (
                  <p className="mt-2 rounded-lg bg-slate-50 px-3 py-2 text-xs text-slate-600">
                    মোছার হিসাব: অর্ডার ঠিকানা মোছা হয়েছে {eraseReport.ordersAnonymized}টি · স্টোর পরিচিতি মোছা {eraseReport.identitiesDeleted}টি · রিভিউ পরিচয় গোপন {eraseReport.reviewsRedacted}টি · Abandoned checkout মোছা {eraseReport.abandonedCheckoutsDeleted}টি
                  </p>
                ) : null}
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
                  <label className="flex items-center gap-2 text-sm md:col-span-2">
                    <input type="checkbox" checked={editWholesale} onChange={(e) => setEditWholesale(e.target.checked)} />
                    পাইকারি ক্রেতা (দোকানে চেকআউটে পাইকারি স্তরের দাম প্রযোজ্য হবে)
                  </label>
                </div>
                <div className="flex flex-wrap items-center gap-3">
                  <button className="btn-primary" disabled={busy !== ""} onClick={saveEdit}>{busy === "edit" ? "সেভ হচ্ছে..." : "সেভ করুন"}</button>
                  <span className="text-xs text-slate-400">কাস্টম ফিল্ডের সংজ্ঞা <a className="underline" href="/dashboard/leads">Leads & CRM পেজের</a> “কাস্টম ফিল্ড” অংশ থেকে ম্যানেজ করা হয়।</span>
                </div>
              </div>
              <div className="card space-y-3">
                <h3 className="font-semibold">🏪 স্টোর পরিচিতি (Store Identities)</h3>
                <p className="text-xs text-slate-500">একই মানুষ একাধিক স্টোরে আলাদা customer id-তে থাকতে পারেন — পরিচিতিগুলো এখানে একসাথে দেখা যায়। Push কখনো স্বয়ংক্রিয় নয়; বোতাম চাপলেই Outbox-এ যায় (mirror মোডের স্টোরে push হয় না)।</p>
                {(detail.storeIdentities ?? []).length === 0 ? (
                  <p className="text-sm text-slate-400">কোনো স্টোর পরিচিতি নেই — স্টোর থেকে Customer Sync হলে বা নিচে Push করলে তৈরি হবে।</p>
                ) : (detail.storeIdentities ?? []).map((si) => (
                  <div key={si.storeId} className="flex flex-wrap items-center justify-between gap-2 border-b py-1.5 text-sm last:border-0">
                    <span><span className="font-medium">{si.storeName ?? "স্টোর"}</span> <span className="badge-slate ml-1">{si.platform ?? ""}</span>
                      <span className="ml-2 text-slate-500">ID: {si.externalId}</span>
                      {si.emailSnapshot ? <span className="ml-2 text-xs text-slate-400">{si.emailSnapshot}</span> : null}
                    </span>
                  </div>
                ))}
                <div className="flex flex-wrap gap-2 border-t pt-3">
                  {stores.map((s) => {
                    const mode = s.syncMode ?? "mirror";
                    const has = (detail.storeIdentities ?? []).some((si) => si.storeId === s.id);
                    return (
                      <button key={s.id} className="rounded-lg border px-3 py-1.5 text-xs font-semibold disabled:opacity-50"
                        disabled={busy !== "" || mode === "mirror"}
                        title={mode === "mirror" ? "Mirror মোডে push হয় না — Sync Center থেকে মোড বদলান" : undefined}
                        onClick={() => pushToStore(s.id)}>
                        {busy === `push-${s.id}` ? "যাচ্ছে…" : has ? `🔄 ${s.name}-এ আপডেট Push` : `➕ ${s.name}-এ Push`}
                        {mode === "mirror" ? " (mirror — হবে না)" : ""}
                      </button>
                    );
                  })}
                  {stores.length === 0 ? <span className="text-xs text-slate-400">কোনো স্টোর সংযুক্ত নেই</span> : null}
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
              {custReviews.filter((r) => r.rating != null).length > 0 ? (
                <div className="card space-y-1">
                  <h3 className="font-semibold">⭐ গ্রাহকের রিভিউ</h3>
                  {custReviews.filter((r) => r.rating != null).map((r) => (
                    <div key={r.id} className="border-b py-1.5 text-sm last:border-0">
                      <span className="text-amber-500">{"★★★★★".slice(0, r.rating ?? 0)}{"☆☆☆☆☆".slice(0, 5 - (r.rating ?? 0))}</span>
                      <span className="ml-2 font-medium">#{r.orderNumber ?? r.orderId.slice(0, 8)}</span>
                      {r.comment ? <span className="ml-2 text-slate-700">“{r.comment}”</span> : null}
                      {r.receivedAt ? <span className="ml-2 text-xs text-slate-400">{new Date(r.receivedAt).toLocaleDateString("bn-BD")}</span> : null}
                    </div>
                  ))}
                </div>
              ) : null}
              {/* ON7: খাতা — the customer's ledger: total due,
                  aging buckets, credit limit and the open
                  orders behind the numbers. */}
              <div className="card space-y-3">
                <h3 className="font-semibold">📒 খাতা (বকেয়ার হিসাব)</h3>
                {khataError ? (
                  <p className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-600">{khataError}</p>
                ) : !khata ? (
                  <p className="text-sm text-slate-400">লোড হচ্ছে…</p>
                ) : (
                  <>
                    <div className="flex flex-wrap items-center gap-3">
                      <div>
                        <div className="text-2xl font-black text-red-600">{money(khata.totalDueMinor)}</div>
                        <div className="text-xs text-slate-400">মোট বকেয়া</div>
                      </div>
                      {isOverLimit(khata) ? (
                        <span className="rounded bg-red-600 px-2 py-0.5 text-xs font-bold text-white">⚠️ ক্রেডিট সীমা ছাড়িয়ে গেছে</span>
                      ) : null}
                      {khata.availableCreditMinor != null ? (
                        <div className="text-sm">
                          <span className="text-slate-500">ব্যবহারযোগ্য ক্রেডিট: </span>
                          <b className={isOverLimit(khata) ? "text-red-600" : "text-emerald-700"}>{money(khata.availableCreditMinor)}</b>
                        </div>
                      ) : null}
                    </div>
                    <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
                      {agingRows(khata).map((r) => (
                        <div key={r.key} className="rounded-lg bg-slate-50 px-3 py-2 text-center">
                          <div className="text-sm font-bold">{money(r.amountMinor)}</div>
                          <div className="text-[11px] text-slate-500">{r.label}</div>
                        </div>
                      ))}
                    </div>
                    <div className="space-y-2 border-t pt-3">
                      <label className="block text-sm font-medium">ক্রেডিট সীমা (৳) — খালি রাখলে সীমা থাকবে না
                        <span className="mt-1 flex flex-wrap items-center gap-2">
                          <input className="input w-44" inputMode="decimal" placeholder="যেমন: 5000" value={creditTaka} onChange={(e) => setCreditTaka(e.target.value)} />
                          <button type="button" className="btn-primary btn-sm" disabled={creditBusy} onClick={() => void saveCreditLimit()}>
                            {creditBusy ? "সংরক্ষণ হচ্ছে…" : "সীমা সংরক্ষণ করুন"}
                          </button>
                          <span className="text-xs text-slate-400">বর্তমান: {khata.creditLimitMinor ? money(khata.creditLimitMinor) : "সীমা নির্ধারণ করা নেই"}</span>
                        </span>
                      </label>
                      {creditError ? <p className="rounded-lg bg-red-50 px-3 py-2 text-xs text-red-600">{creditError}</p> : null}
                      {creditNotice ? <p className="rounded-lg bg-emerald-50 px-3 py-2 text-xs text-emerald-700">{creditNotice}</p> : null}
                    </div>
                    {khata.orders.length === 0 ? (
                      <p className="text-sm text-slate-400">এই কাস্টমারের কোনো অর্ডার খাতায় নেই।</p>
                    ) : (
                      <div className="overflow-x-auto">
                        <table className="w-full text-left text-sm">
                          <thead>
                            <tr className="border-b text-xs text-slate-500">
                              <th className="py-1.5 pr-2 font-semibold">অর্ডার</th>
                              <th className="py-1.5 pr-2 font-semibold">তারিখ</th>
                              <th className="py-1.5 pr-2 font-semibold">মোট</th>
                              <th className="py-1.5 pr-2 font-semibold">পরিশোধিত</th>
                              <th className="py-1.5 pr-2 font-semibold">বকেয়া</th>
                              <th className="py-1.5 font-semibold">স্ট্যাটাস</th>
                            </tr>
                          </thead>
                          <tbody>
                            {khata.orders.map((o) => (
                              <tr key={o.id} className="border-b last:border-0">
                                <td className="py-1.5 pr-2 font-medium">#{o.number ?? o.id.slice(0, 8)}</td>
                                <td className="py-1.5 pr-2">{o.placedAt ? new Date(o.placedAt).toLocaleDateString("bn-BD") : "—"}</td>
                                <td className="py-1.5 pr-2">{money(o.totalMinor)}</td>
                                <td className="py-1.5 pr-2">{money(o.paidMinor)}</td>
                                <td className="py-1.5 pr-2">{(() => { let d = 0n; try { d = BigInt(o.dueMinor); } catch { d = 0n; } return d > 0n
                                  ? <span className="font-bold text-red-600">{money(o.dueMinor)}</span>
                                  : <span className="text-slate-400">—</span>; })()}</td>
                                <td className="py-1.5"><span className="badge-slate">{o.status}</span></td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    )}
                    {khata.ordersTruncated ? (
                      <p className="text-xs text-amber-700">আরও অর্ডার আছে — খাতায় শুধু সাম্প্রতিকগুলো দেখানো হচ্ছে; মোট বকেয়া সব অর্ডার মিলিয়েই হিসাব করা।</p>
                    ) : null}
                  </>
                )}
              </div>
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
        </>
      )}
    </div>
  );
}
