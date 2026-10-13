"use client";
import React, { useCallback, useEffect, useState } from "react";
import { apiFetch } from "@/lib/api";
import { getOrganizationId } from "@/lib/org";

interface ReturnLine { orderItemId: string; quantity: number; condition?: string; restock?: boolean }
interface ReturnRow {
  id: string; orderId: string; orderNumber: string | null; status: string;
  reason: string | null; resolution: string | null;
  refundAmountMinor: string | null; restockDecision: string | null;
  notificationStatus: string | null; exchangeOrderId: string | null;
  returnShipmentId: string | null; createdAt: string;
  items?: ReturnLine[] | null;
}
interface ReturnDetail extends ReturnRow { items: ReturnLine[] | null }

const STATUSES = ["", "requested", "approved", "rejected", "return_shipped", "received", "completed"];
const RESOLUTIONS = [
  { value: "refund", label: "Refund (টাকা ফেরত)" },
  { value: "exchange", label: "Exchange (বদলি পণ্য)" },
  { value: "store_credit_note", label: "Store credit note (শুধু রেকর্ড)" },
];

function statusBadge(status: string): string {
  switch (status) {
    case "requested": return "bg-amber-100 text-amber-700";
    case "approved": return "bg-blue-100 text-blue-700";
    case "rejected": return "bg-red-100 text-red-700";
    case "return_shipped": return "bg-purple-100 text-purple-700";
    case "received": return "bg-indigo-100 text-indigo-700";
    case "completed": return "bg-green-100 text-green-700";
    default: return "bg-slate-200 text-slate-600";
  }
}

function formatMoney(minor: string | null): string {
  if (minor == null) return "—";
  const n = Number(minor);
  if (!Number.isFinite(n)) return minor;
  return `৳${(n / 100).toFixed(2)}`;
}

export default function ReturnsPage() {
  const [items, setItems] = useState<ReturnRow[]>([]);
  const [total, setTotal] = useState(0);
  const [statusFilter, setStatusFilter] = useState("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [busy, setBusy] = useState("");
  const [resolutionById, setResolutionById] = useState<Record<string, string>>({});
  // Receive form: opened per return, lines come from the detail GET
  // (the list payload carries no per-line condition/restock inputs).
  const [receiveId, setReceiveId] = useState("");
  const [receiveLines, setReceiveLines] = useState<{ orderItemId: string; quantity: number; condition: string; restock: boolean }[]>([]);
  const [receiveError, setReceiveError] = useState("");

  const load = useCallback(async () => {
    const orgId = getOrganizationId();
    if (!orgId) { setError("কোনো Organization নির্বাচিত নেই।"); setLoading(false); return; }
    try {
      const qs = statusFilter ? `?status=${encodeURIComponent(statusFilter)}` : "";
      const data = await apiFetch<{ items: ReturnRow[]; total: number }>(`/organizations/${orgId}/returns${qs}`);
      setItems(data.items);
      setTotal(data.total);
      setError("");
    } catch (e) {
      setError(e instanceof Error ? e.message : "রিটার্নের তালিকা লোড করা যায়নি");
    } finally { setLoading(false); }
  }, [statusFilter]);

  useEffect(() => { load(); }, [load]);

  async function act(row: ReturnRow, key: string, path: string, body?: Record<string, unknown>, okMessage?: string) {
    const orgId = getOrganizationId(); if (!orgId) return;
    setError(""); setNotice(""); setBusy(`${key}-${row.id}`);
    try {
      await apiFetch(`/organizations/${orgId}/returns/${row.id}${path}`, {
        method: "POST", body: JSON.stringify(body ?? {}),
      });
      if (okMessage) setNotice(okMessage);
      await load();
    } catch (e) {
      // API errors are shown verbatim — never paraphrased as success.
      setError(e instanceof Error ? e.message : "অ্যাকশনটি করা যায়নি");
    } finally { setBusy(""); }
  }

  async function openReceive(row: ReturnRow) {
    const orgId = getOrganizationId(); if (!orgId) return;
    setReceiveError(""); setBusy(`receive-open-${row.id}`);
    try {
      const detail = await apiFetch<ReturnDetail>(`/organizations/${orgId}/returns/${row.id}`);
      setReceiveLines((detail.items ?? []).map((l) => ({
        orderItemId: l.orderItemId,
        quantity: l.quantity,
        condition: l.condition ?? "",
        restock: Boolean(l.restock),
      })));
      setReceiveId(row.id);
    } catch (e) {
      setReceiveError(e instanceof Error ? e.message : "রিটার্নের বিবরণ লোড করা যায়নি");
    } finally { setBusy(""); }
  }

  async function submitReceived(row: ReturnRow) {
    const orgId = getOrganizationId(); if (!orgId) return;
    setReceiveError(""); setBusy(`received-${row.id}`);
    try {
      await apiFetch(`/organizations/${orgId}/returns/${row.id}/received`, {
        method: "POST",
        body: JSON.stringify({
          items: receiveLines.map((l) => ({
            orderItemId: l.orderItemId,
            condition: l.condition.trim() || undefined,
            restock: l.restock,
          })),
        }),
      });
      setReceiveId("");
      setReceiveLines([]);
      setNotice("পণ্য পাওয়া গেছে বলে চিহ্নিত হয়েছে।");
      await load();
    } catch (e) {
      setReceiveError(e instanceof Error ? e.message : "পণ্য পেয়েছি চিহ্নিত করা যায়নি");
    } finally { setBusy(""); }
  }

  return (
    <div className="space-y-8">
      <div>
        <h1 className="page-title">রিটার্ন / RMA</h1>
        <p className="text-sm text-slate-500">
          কাস্টমারের জমা দেওয়া রিটার্নের আবেদন যাচাই, অনুমোদন, রিটার্ন কুরিয়ার বুকিং, পণ্য পাওয়া ও সম্পন্ন করার তালিকা।
          মোট {total}টি রিটার্ন।
        </p>
      </div>

      {error ? <p className="rounded-lg bg-red-50 p-3 text-sm text-red-700">{error}</p> : null}
      {notice ? <p className="rounded-lg bg-green-50 p-3 text-sm text-green-700">{notice}</p> : null}
      {receiveError ? <p className="rounded-lg bg-red-50 p-3 text-sm text-red-700">{receiveError}</p> : null}

      <div className="card p-5">
        <div className="flex flex-wrap items-center gap-3">
          <label className="block text-sm">অবস্থা
            <select className="input mt-1" value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)}>
              {STATUSES.map((s) => <option key={s || "all"} value={s}>{s === "" ? "সব" : s}</option>)}
            </select>
          </label>
        </div>

        {loading ? <p className="mt-4 text-sm text-slate-500">লোড হচ্ছে…</p> : null}
        {!loading && items.length === 0 ? <p className="mt-4 text-sm text-slate-500">এই ফিল্টারে কোনো রিটার্ন নেই।</p> : null}

        <div className="mt-4 space-y-4">
          {items.map((r) => {
            const submitted = r.items != null;
            const resolution = resolutionById[r.id] ?? r.resolution ?? "refund";
            return (
              <div key={r.id} className="rounded-lg border p-4">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div className="text-sm">
                    <span className="font-semibold">অর্ডার: {r.orderNumber ?? r.orderId}</span>
                    <span className={`ml-3 rounded px-2 py-0.5 text-xs font-semibold ${statusBadge(r.status)}`}>{r.status}</span>
                    <span className="mt-1 block text-xs text-slate-500">{new Date(r.createdAt).toLocaleString("bn-BD")}</span>
                    {r.reason ? <span className="mt-1 block">কারণ: {r.reason}</span> : null}
                    <span className="mt-1 block text-xs text-slate-600">
                      Resolution: {r.resolution ?? "—"} · Restock সিদ্ধান্ত: {r.restockDecision ?? "—"}
                      {r.refundAmountMinor != null ? ` · Refund পরিমাণ: ${formatMoney(r.refundAmountMinor)}` : ""}
                    </span>
                    {r.resolution === "refund" ? (
                      <span className="mt-1 block text-xs text-slate-500">
                        দ্রষ্টব্য: refund push স্টোর সেটিং অনুযায়ী হবে — স্টোরে refund push চালু না থাকলে refund শুধু এখানে রেকর্ড হবে, স্টোরে পাঠানো হবে না।
                      </span>
                    ) : null}
                    {r.exchangeOrderId ? <span className="mt-1 block text-xs text-slate-600">Exchange অর্ডার ID: {r.exchangeOrderId}</span> : null}
                    {r.returnShipmentId ? <span className="mt-1 block text-xs text-slate-600">Return shipment ID: {r.returnShipmentId}</span> : null}
                    <span className="mt-1 block text-xs text-slate-600">
                      নোটিফিকেশন: <span className="font-mono font-semibold">{r.notificationStatus ?? "—"}</span>
                      {r.notificationStatus === "not_sent_no_channel" ? (
                        <span className="block text-amber-700">কাস্টমারের কোনো চ্যানেল পাওয়া যায়নি — পাঠানো হয়নি</span>
                      ) : null}
                    </span>
                  </div>

                  <div className="flex flex-col items-end gap-2">
                    {r.status === "requested" && submitted ? (
                      <>
                        <label className="block text-xs text-slate-600">Resolution
                          <select
                            className="input mt-1"
                            value={resolution}
                            onChange={(e) => setResolutionById((prev) => ({ ...prev, [r.id]: e.target.value }))}
                          >
                            {RESOLUTIONS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
                          </select>
                        </label>
                        <div className="flex gap-2">
                          <button
                            type="button"
                            className="rounded-lg bg-green-600 px-3 py-1.5 text-xs font-semibold text-white disabled:opacity-50"
                            disabled={busy !== ""}
                            onClick={() => act(r, "decide", "/decide", { decision: "approve", resolution }, "রিটার্ন অনুমোদিত হয়েছে।")}
                          >
                            {busy === `decide-${r.id}` ? "হচ্ছে…" : "অনুমোদন করুন"}
                          </button>
                          <button
                            type="button"
                            className="rounded-lg border px-3 py-1.5 text-xs font-semibold text-red-600 disabled:opacity-50"
                            disabled={busy !== ""}
                            onClick={() => act(r, "decide", "/decide", { decision: "reject" }, "রিটার্ন প্রত্যাখ্যান করা হয়েছে।")}
                          >
                            প্রত্যাখ্যান করুন
                          </button>
                        </div>
                      </>
                    ) : null}
                    {r.status === "requested" && !submitted ? (
                      <span className="text-xs text-slate-500">কাস্টমার এখনো আবেদন জমা দেননি</span>
                    ) : null}

                    {r.status === "approved" ? (
                      <button
                        type="button"
                        className="rounded-lg border px-3 py-1.5 text-xs font-semibold disabled:opacity-50"
                        disabled={busy !== ""}
                        onClick={() => act(r, "book", "/book-return", { provider: "steadfast" }, "Return courier বুক করা হয়েছে।")}
                      >
                        {busy === `book-${r.id}` ? "বুক হচ্ছে…" : "Return courier বুক করুন"}
                      </button>
                    ) : null}

                    {(r.status === "approved" || r.status === "return_shipped") && receiveId !== r.id ? (
                      <button
                        type="button"
                        className="rounded-lg border px-3 py-1.5 text-xs font-semibold disabled:opacity-50"
                        disabled={busy !== ""}
                        onClick={() => openReceive(r)}
                      >
                        {busy === `receive-open-${r.id}` ? "লোড হচ্ছে…" : "পণ্য পেয়েছি"}
                      </button>
                    ) : null}

                    {r.status === "received" ? (
                      <button
                        type="button"
                        className="rounded-lg bg-green-600 px-3 py-1.5 text-xs font-semibold text-white disabled:opacity-50"
                        disabled={busy !== ""}
                        onClick={() => act(r, "complete", "/complete", {}, "রিটার্ন সম্পন্ন হয়েছে।")}
                      >
                        {busy === `complete-${r.id}` ? "হচ্ছে…" : "Complete করুন"}
                      </button>
                    ) : null}
                  </div>
                </div>

                {receiveId === r.id ? (
                  <div className="mt-4 rounded-lg bg-slate-50 p-3">
                    <div className="text-sm font-semibold">পণ্য পেয়েছি — প্রতিটি লাইনের অবস্থা লিখুন</div>
                    {receiveLines.length === 0 ? (
                      <p className="mt-2 text-sm text-slate-500">এই রিটার্নে কোনো আইটেম লাইন পাওয়া যায়নি।</p>
                    ) : (
                      <ul className="mt-3 space-y-2">
                        {receiveLines.map((l, idx) => (
                          <li key={l.orderItemId} className="flex flex-wrap items-center gap-3 text-sm">
                            <span className="min-w-40">
                              <span className="font-mono text-xs">{l.orderItemId}</span>
                              <span className="block text-xs text-slate-500">পরিমাণ: {l.quantity}</span>
                            </span>
                            <label className="block text-xs text-slate-600">অবস্থা (condition)
                              <input
                                className="input mt-1"
                                value={l.condition}
                                placeholder="যেমন: ভালো / ক্ষতিগ্রস্ত"
                                onChange={(e) => setReceiveLines((prev) => prev.map((x, i) => (i === idx ? { ...x, condition: e.target.value } : x)))}
                              />
                            </label>
                            <label className="flex items-center gap-1.5 pb-1 text-sm">
                              <input
                                type="checkbox"
                                checked={l.restock}
                                onChange={(e) => setReceiveLines((prev) => prev.map((x, i) => (i === idx ? { ...x, restock: e.target.checked } : x)))}
                              />
                              Restock করুন
                            </label>
                          </li>
                        ))}
                      </ul>
                    )}
                    <div className="mt-3 flex gap-2">
                      <button
                        type="button"
                        className="btn-primary disabled:opacity-50"
                        disabled={busy !== "" || receiveLines.length === 0}
                        onClick={() => submitReceived(r)}
                      >
                        {busy === `received-${r.id}` ? "সেভ হচ্ছে…" : "পণ্য পেয়েছি নিশ্চিত করুন"}
                      </button>
                      <button type="button" className="rounded-lg border px-3 py-1.5 text-sm" onClick={() => { setReceiveId(""); setReceiveLines([]); }}>
                        বাতিল
                      </button>
                    </div>
                  </div>
                ) : null}
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
