"use client";
import React, { useCallback, useEffect, useState } from "react";
import { fmtDateTime, fmtMoney, fmtNumber } from "@repo/contracts";
import { useLocale } from "@/lib/i18n/provider";
import { apiFetch } from "@/lib/api";
import { getOrganizationId } from "@/lib/org";

interface ReturnLine { orderItemId: string; quantity: number; condition?: string; restock?: boolean }
interface ReturnRow {
  id: string; orderId: string; orderNumber: string | null; status: string;
  // EC28: who opened the request + the customer's ask, when self-service.
  source?: string | null; requestType?: string | null;
  reason: string | null; resolution: string | null;
  refundAmountMinor: string | null; restockDecision: string | null;
  notificationStatus: string | null; exchangeOrderId: string | null;
  returnShipmentId: string | null; createdAt: string;
  items?: ReturnLine[] | null;
}
interface ReturnDetail extends ReturnRow { items: ReturnLine[] | null }

const STATUSES = ["", "requested", "approved", "rejected", "return_shipped", "received", "completed"];
const RESOLUTIONS = [
  { value: "refund", labelKey: "refundMoneyBack" },
  { value: "exchange", labelKey: "exchangeReplacementProduct" },
  { value: "store_credit_note", labelKey: "storeCreditNoteRecordOnly" },
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

function formatMoney(minor: string | null, locale: "bn" | "en" = "bn"): string {
  if (minor == null) return "—";
  const n = Number(minor);
  if (!Number.isFinite(n)) return minor;
  return fmtMoney(locale, n / 100, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

export default function ReturnsPage() {
  const { dict, t, locale } = useLocale();
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
    if (!orgId) { setError(dict.commerce.noOrganizationSelected); setLoading(false); return; }
    try {
      const qs = statusFilter ? `?status=${encodeURIComponent(statusFilter)}` : "";
      const data = await apiFetch<{ items: ReturnRow[]; total: number }>(`/organizations/${orgId}/returns${qs}`);
      setItems(data.items);
      setTotal(data.total);
      setError("");
    } catch (e) {
      setError(e instanceof Error ? e.message : dict.commerce.couldNotLoadTheReturn);
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
      setError(e instanceof Error ? e.message : dict.commerce.theActionCouldNotBe);
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
      setReceiveError(e instanceof Error ? e.message : dict.commerce.couldNotLoadReturnDetails);
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
      setNotice(dict.commerce.markedAsProductReceived);
      await load();
    } catch (e) {
      setReceiveError(e instanceof Error ? e.message : dict.commerce.couldNotMarkAsReceived);
    } finally { setBusy(""); }
  }

  return (
    <div className="space-y-8">
      <div>
        <h1 className="page-title">{dict.commerce.returnsRMA}</h1>
        <p className="text-sm text-slate-500">
          {dict.commerce.theListToVerifyCustomers}{total}{dict.commerce.returns}</p>
      </div>

      {error ? <p className="rounded-lg bg-red-50 p-3 text-sm text-red-700">{error}</p> : null}
      {notice ? <p className="rounded-lg bg-green-50 p-3 text-sm text-green-700">{notice}</p> : null}
      {receiveError ? <p className="rounded-lg bg-red-50 p-3 text-sm text-red-700">{receiveError}</p> : null}

      <div className="card p-5">
        <div className="flex flex-wrap items-center gap-3">
          <label className="block text-sm">{dict.commerce.status}<select className="input mt-1" value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)}>
              {STATUSES.map((s) => <option key={s || "all"} value={s}>{s === "" ? dict.commerce.all : s}</option>)}
            </select>
          </label>
        </div>

        {loading ? <p className="mt-4 text-sm text-slate-500">{dict.common.loading}</p> : null}
        {!loading && items.length === 0 ? <p className="mt-4 text-sm text-slate-500">{dict.commerce.noReturnsInThisFilter}</p> : null}

        <div className="mt-4 space-y-4">
          {items.map((r) => {
            const submitted = r.items != null;
            const resolution = resolutionById[r.id] ?? r.resolution ?? "refund";
            return (
              <div key={r.id} className="rounded-lg border p-4">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div className="text-sm">
                    <span className="font-semibold">{dict.commerce.order3}{r.orderNumber ?? r.orderId}</span>
                    <span className={`ml-3 rounded px-2 py-0.5 text-xs font-semibold ${statusBadge(r.status)}`}>{r.status}</span>
                    {/* EC28: source badge — customer self-service requests are
                        handled identically, just labelled. */}
                    {r.source === "customer" ? (
                      <span className="ml-2 rounded bg-sky-100 px-2 py-0.5 text-xs font-semibold text-sky-700">
                        {dict.commerce.customerThemselves}{r.requestType ? ` · ${r.requestType === "exchange" ? dict.commerce.exchange : dict.commerce.return}` : ""}
                      </span>
                    ) : (
                      <span className="ml-2 rounded bg-slate-100 px-2 py-0.5 text-xs font-semibold text-slate-500">{dict.commerce.staff}</span>
                    )}
                    <span className="mt-1 block text-xs text-slate-500">{fmtDateTime(locale, new Date(r.createdAt))}</span>
                    {r.reason ? <span className="mt-1 block">{dict.commerce.reason}{r.reason}</span> : null}
                    <span className="mt-1 block text-xs text-slate-600">
                      Resolution: {r.resolution ?? "—"} {dict.commerce.restockDecision}{r.restockDecision ?? "—"}
                      {r.refundAmountMinor != null ? t("commerce.refundAmount", { formatMoney: formatMoney(r.refundAmountMinor, locale) }) : ""}
                    </span>
                    {r.resolution === "refund" ? (
                      <span className="mt-1 block text-xs text-slate-500">
                        {dict.commerce.noteRefundPushesWillFollow}</span>
                    ) : null}
                    {r.exchangeOrderId ? <span className="mt-1 block text-xs text-slate-600">{dict.commerce.exchangeOrderID}{r.exchangeOrderId}</span> : null}
                    {r.returnShipmentId ? <span className="mt-1 block text-xs text-slate-600">Return shipment ID: {r.returnShipmentId}</span> : null}
                    <span className="mt-1 block text-xs text-slate-600">
                      {dict.commerce.notification}<span className="font-mono font-semibold">{r.notificationStatus ?? "—"}</span>
                      {r.notificationStatus === "not_sent_no_channel" ? (
                        <span className="block text-amber-700">{dict.commerce.noCustomerChannelFoundNot}</span>
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
                            {RESOLUTIONS.map((o) => <option key={o.value} value={o.value}>{dict.commerce[o.labelKey as keyof typeof dict.commerce]}</option>)}
                          </select>
                        </label>
                        <div className="flex gap-2">
                          <button
                            type="button"
                            className="rounded-lg bg-green-600 px-3 py-1.5 text-xs font-semibold text-white disabled:opacity-50"
                            disabled={busy !== ""}
                            onClick={() => act(r, "decide", "/decide", { decision: "approve", resolution }, dict.commerce.returnApproved)}
                          >
                            {busy === `decide-${r.id}` ? dict.commerce.ing : dict.commerce.approve2}
                          </button>
                          <button
                            type="button"
                            className="rounded-lg border px-3 py-1.5 text-xs font-semibold text-red-600 disabled:opacity-50"
                            disabled={busy !== ""}
                            onClick={() => act(r, "decide", "/decide", { decision: "reject" }, dict.commerce.returnRejected)}
                          >
                            {dict.commerce.reject}</button>
                        </div>
                      </>
                    ) : null}
                    {r.status === "requested" && !submitted ? (
                      <span className="text-xs text-slate-500">{dict.commerce.customerHasNotSubmittedThe}</span>
                    ) : null}

                    {r.status === "approved" ? (
                      <button
                        type="button"
                        className="rounded-lg border px-3 py-1.5 text-xs font-semibold disabled:opacity-50"
                        disabled={busy !== ""}
                        onClick={() => act(r, "book", "/book-return", { provider: "steadfast" }, dict.commerce.returnCourierBooked)}
                      >
                        {busy === `book-${r.id}` ? dict.commerce.booking2 : dict.commerce.bookReturnCourier}
                      </button>
                    ) : null}

                    {(r.status === "approved" || r.status === "return_shipped") && receiveId !== r.id ? (
                      <button
                        type="button"
                        className="rounded-lg border px-3 py-1.5 text-xs font-semibold disabled:opacity-50"
                        disabled={busy !== ""}
                        onClick={() => openReceive(r)}
                      >
                        {busy === `receive-open-${r.id}` ? dict.common.loading : dict.commerce.productReceived}
                      </button>
                    ) : null}

                    {r.status === "received" ? (
                      <button
                        type="button"
                        className="rounded-lg bg-green-600 px-3 py-1.5 text-xs font-semibold text-white disabled:opacity-50"
                        disabled={busy !== ""}
                        onClick={() => act(r, "complete", "/complete", {}, dict.commerce.returnCompleted)}
                      >
                        {busy === `complete-${r.id}` ? dict.commerce.ing : dict.commerce.complete2}
                      </button>
                    ) : null}
                  </div>
                </div>

                {receiveId === r.id ? (
                  <div className="mt-4 rounded-lg bg-slate-50 p-3">
                    <div className="text-sm font-semibold">{dict.commerce.productReceivedWriteEachLine}</div>
                    {receiveLines.length === 0 ? (
                      <p className="mt-2 text-sm text-slate-500">{dict.commerce.noItemLinesFoundIn}</p>
                    ) : (
                      <ul className="mt-3 space-y-2">
                        {receiveLines.map((l, idx) => (
                          <li key={l.orderItemId} className="flex flex-wrap items-center gap-3 text-sm">
                            <span className="min-w-40">
                              <span className="font-mono text-xs">{l.orderItemId}</span>
                              <span className="block text-xs text-slate-500">{dict.commerce.quantity2}{l.quantity}</span>
                            </span>
                            <label className="block text-xs text-slate-600">{dict.commerce.condition}<input
                                className="input mt-1"
                                value={l.condition}
                                placeholder={dict.commerce.eGGoodDamaged}
                                onChange={(e) => setReceiveLines((prev) => prev.map((x, i) => (i === idx ? { ...x, condition: e.target.value } : x)))}
                              />
                            </label>
                            <label className="flex items-center gap-1.5 pb-1 text-sm">
                              <input
                                type="checkbox"
                                checked={l.restock}
                                onChange={(e) => setReceiveLines((prev) => prev.map((x, i) => (i === idx ? { ...x, restock: e.target.checked } : x)))}
                              />
                              {dict.commerce.restock}</label>
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
                        {busy === `received-${r.id}` ? dict.commerce.saving2 : dict.commerce.confirmProductReceived}
                      </button>
                      <button type="button" className="rounded-lg border px-3 py-1.5 text-sm" onClick={() => { setReceiveId(""); setReceiveLines([]); }}>
                        {dict.common.cancel}</button>
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
