"use client";
import React, { useCallback, useEffect, useState } from "react";
import { apiFetch } from "@/lib/api";
import { getOrganizationId } from "@/lib/org";
import { formatTakaMinor, formatWhen } from "@/lib/connections";
import { useLocale } from "@/lib/i18n/provider";
import { fmtNumber } from "@repo/contracts";

/**
 * GC12 — Payment Ops: the org's payment attempts
 * (TenantPaymentTransaction rows, via GET connections/
 * payment-attempts), with filters, an expandable evidence
 * detail, and the recovery resend action.
 *
 * Honesty rules mirrored from the API:
 * - "মেয়াদোত্তীর্ণ (initiated)" is the API's DERIVED label for
 *   an initiated attempt older than 24h — the stored status is
 *   still "initiated" and this panel never pretends otherwise.
 * - fee/net render only what the API returns; a null fee shows
 *   "—" here (the "ফি হার সেট করা হয়নি" wording lives on the
 *   accounting report, where the null is the story).
 * - The resend button's result shows the API's link + sendNote
 *   VERBATIM — a send is never claimed beyond what it says.
 */

export interface PaymentAttemptView {
  id: string;
  orderId: string;
  orderNumber: string | null;
  provider: string;
  source: string;
  amountMinor: string;
  currency: string;
  status: string;
  displayStatus: string;
  providerTxnId: string | null;
  failureReason: string | null;
  feeMinor: string | null;
  netMinor: string | null;
  createdAt: string;
  updatedAt: string;
}

interface PaymentAttemptDetail extends PaymentAttemptView {
  valId: string | null;
  ipnPayload: unknown;
}

interface AttemptsPage {
  items: PaymentAttemptView[];
  total: number;
  page: number;
  pageSize: number;
}

interface ResendResult {
  link: string;
  transactionId: string;
  provider: string;
  source: string;
  sentVia: string;
  sendNote: string;
}

const STATUS_META: Record<string, { labelKey: string; cls: string }> = {
  verified_paid: { labelKey: "paStatusVerified", cls: "bg-green-100 text-green-700" },
  initiated: { labelKey: "paStatusInitiated", cls: "bg-amber-100 text-amber-700" },
  expired: { labelKey: "paStatusExpired", cls: "bg-slate-200 text-slate-600" },
  failed: { labelKey: "paStatusFailed", cls: "bg-red-100 text-red-700" },
  cancelled: { labelKey: "", cls: "bg-slate-100 text-slate-500" },
};

const statusMeta = (a: PaymentAttemptView, D: Record<string, string>, cancelLabel: string) => {
  const m = STATUS_META[a.displayStatus] ?? STATUS_META[a.status];
  if (!m) return { label: a.displayStatus, cls: "bg-slate-100 text-slate-600" };
  return { label: m.labelKey ? D[m.labelKey] ?? m.labelKey : cancelLabel, cls: m.cls };
};

const inputCls = "rounded-lg border border-slate-200 px-3 py-2 text-sm outline-none focus:border-indigo-400";

export function PaymentAttemptsPanel() {
  const { dict, t, locale } = useLocale();
  const D = dict.connections;
  const fmtM = (minor?: string | null): string => (minor == null ? "—" : formatTakaMinor(minor, locale));
  const [status, setStatus] = useState("");
  const [provider, setProvider] = useState("");
  const [source, setSource] = useState("");
  const [page, setPage] = useState(1);
  const [data, setData] = useState<AttemptsPage | null>(null);
  const [error, setError] = useState("");
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [details, setDetails] = useState<Record<string, PaymentAttemptDetail | "loading" | "error">>({});
  const [resendBusy, setResendBusy] = useState("");
  const [resendOut, setResendOut] = useState<Record<string, { result?: ResendResult; error?: string }>>({});

  const load = useCallback(async () => {
    const orgId = getOrganizationId();
    if (!orgId) return;
    const params = new URLSearchParams({ page: String(page), pageSize: "20" });
    if (status) params.set("status", status);
    if (provider) params.set("provider", provider);
    if (source) params.set("source", source);
    try {
      const res = await apiFetch<AttemptsPage>(`organizations/${orgId}/connections/payment-attempts?${params.toString()}`);
      setData(res);
      setError("");
    } catch (e) {
      setError(e instanceof Error ? e.message : D.paLoadFailed);
    }
  }, [status, provider, source, page]);

  useEffect(() => { void load(); }, [load]);

  const toggleDetail = useCallback(async (row: PaymentAttemptView) => {
    if (expandedId === row.id) { setExpandedId(null); return; }
    setExpandedId(row.id);
    if (details[row.id]) return;
    const orgId = getOrganizationId();
    if (!orgId) return;
    setDetails((d) => ({ ...d, [row.id]: "loading" }));
    try {
      const detail = await apiFetch<PaymentAttemptDetail>(`organizations/${orgId}/connections/payment-attempts/${row.id}`);
      setDetails((d) => ({ ...d, [row.id]: detail }));
    } catch {
      setDetails((d) => ({ ...d, [row.id]: "error" }));
    }
  }, [expandedId, details]);

  const resend = useCallback(async (row: PaymentAttemptView) => {
    const orgId = getOrganizationId();
    if (!orgId) return;
    setResendBusy(row.id);
    setResendOut((o) => ({ ...o, [row.id]: {} }));
    try {
      const result = await apiFetch<ResendResult>(`organizations/${orgId}/orders/${row.orderId}/payment-link-resend`, {
        method: "POST",
        body: JSON.stringify({ provider: row.provider, source: row.source }),
      });
      setResendOut((o) => ({ ...o, [row.id]: { result } }));
      await load();
    } catch (e) {
      setResendOut((o) => ({ ...o, [row.id]: { error: e instanceof Error ? e.message : D.paResendFailed } }));
    } finally { setResendBusy(""); }
  }, [load]);

  const totalPages = data ? Math.max(1, Math.ceil(data.total / data.pageSize)) : 1;

  return (
    <div className="card space-y-3 p-4">
      <div className="flex flex-wrap items-center gap-2">
        <select className={inputCls} value={status} onChange={(e) => { setStatus(e.target.value); setPage(1); }} aria-label={D.paAriaStatus}>
          <option value="">{D.paAllStatuses}</option>
          <option value="initiated">{D.paStatusInitiated}</option>
          <option value="verified_paid">{D.paStatusVerified}</option>
          <option value="failed">{D.paStatusFailed}</option>
          <option value="cancelled">{dict.common.cancel}</option>
          <option value="expired">{D.paStatusExpired}</option>
        </select>
        <select className={inputCls} value={provider} onChange={(e) => { setProvider(e.target.value); setPage(1); }} aria-label={D.paAriaProvider}>
          <option value="">{D.paAllProviders}</option>
          <option value="sslcommerz">SSLCommerz</option>
          <option value="bkash">bKash</option>
          <option value="nagad">Nagad</option>
          <option value="shurjopay">ShurjoPay</option>
          <option value="aamarpay">aamarPay</option>
        </select>
        <select className={inputCls} value={source} onChange={(e) => { setSource(e.target.value); setPage(1); }} aria-label={D.paAriaSource}>
          <option value="">{D.paBothSources}</option>
          <option value="own">{D.phOwnGateway}</option>
          <option value="platform">{D.plPlatformGateway}</option>
        </select>
        <span className="text-xs text-slate-400">{t("connections.paTotalCount", { count: fmtNumber(locale, data?.total ?? 0) })}</span>
      </div>

      {error ? <div className="rounded-xl bg-red-50 px-4 py-3 text-sm font-medium text-red-600">{error}</div> : null}
      {!data && !error ? <p className="text-sm text-slate-400">{dict.common.loading}</p> : null}
      {data && data.items.length === 0 ? <p className="text-sm text-slate-400">{D.paEmpty}</p> : null}

      {data && data.items.length > 0 ? (
        <div className="overflow-x-auto">
          <table className="w-full min-w-[860px] text-sm">
            <thead>
              <tr className="border-b text-left text-xs text-slate-500">
                <th className="py-2 pr-2 font-semibold">{D.paColTime}</th>
                <th className="py-2 pr-2 font-semibold">{D.paColOrder}</th>
                <th className="py-2 pr-2 font-semibold">{D.paColProviderSource}</th>
                <th className="py-2 pr-2 font-semibold">{D.paColAmount}</th>
                <th className="py-2 pr-2 font-semibold">{D.paAriaStatus}</th>
                <th className="py-2 pr-2 font-semibold">{D.paColFailure}</th>
                <th className="py-2 pr-2 font-semibold">{D.paColFeeNet}</th>
                <th className="py-2 font-semibold">{D.paColAction}</th>
              </tr>
            </thead>
            <tbody>
              {data.items.map((row) => {
                const meta = statusMeta(row, D as unknown as Record<string, string>, dict.common.cancel);
                const detail = details[row.id];
                const out = resendOut[row.id];
                return (
                  <React.Fragment key={row.id}>
                    <tr className="border-b last:border-0 align-top">
                      <td className="py-2 pr-2 whitespace-nowrap text-xs text-slate-500">{formatWhen(row.createdAt, locale) ?? "—"}</td>
                      <td className="py-2 pr-2 font-medium">{row.orderNumber ?? row.orderId.slice(0, 8)}</td>
                      <td className="py-2 pr-2">{row.provider}<span className="block text-xs text-slate-400">{row.source === "platform" ? D.phPlatform : D.stOwnShort}</span></td>
                      <td className="py-2 pr-2 whitespace-nowrap">{fmtM(row.amountMinor)}</td>
                      <td className="py-2 pr-2"><span className={`rounded-full px-2 py-0.5 text-[11px] font-semibold ${meta.cls}`}>{meta.label}</span></td>
                      <td className="py-2 pr-2 max-w-[220px] text-xs text-red-600">{row.failureReason ?? "—"}</td>
                      <td className="py-2 pr-2 whitespace-nowrap text-xs">{row.feeMinor != null ? `${fmtM(row.feeMinor)} / ${fmtM(row.netMinor)}` : "—"}</td>
                      <td className="py-2">
                        <div className="flex flex-wrap gap-1.5">
                          <button type="button" onClick={() => void toggleDetail(row)} className="rounded-lg bg-slate-100 px-2.5 py-1 text-xs font-semibold text-slate-700 hover:bg-slate-200">
                            {expandedId === row.id ? dict.common.close : D.paDetails}
                          </button>
                          {row.status !== "verified_paid" ? (
                            <button type="button" disabled={resendBusy === row.id} onClick={() => void resend(row)} className="rounded-lg bg-indigo-600 px-2.5 py-1 text-xs font-semibold text-white hover:bg-indigo-700 disabled:opacity-50">
                              {resendBusy === row.id ? D.paSending : D.paResendLink}
                            </button>
                          ) : null}
                        </div>
                        {out?.error ? <p className="mt-1.5 text-xs font-medium text-red-600">{out.error}</p> : null}
                        {out?.result ? (
                          <div className="mt-1.5 space-y-1 text-xs">
                            <p className="font-medium text-slate-600">{out.result.sendNote}</p>
                            <a href={out.result.link} target="_blank" rel="noreferrer" className="block max-w-[260px] truncate font-medium text-indigo-600 hover:underline">{out.result.link}</a>
                          </div>
                        ) : null}
                      </td>
                    </tr>
                    {expandedId === row.id ? (
                      <tr className="border-b bg-slate-50">
                        <td colSpan={8} className="px-3 py-2">
                          {detail === "loading" || detail === undefined ? (
                            <p className="text-xs text-slate-400">{dict.common.loading}</p>
                          ) : detail === "error" ? (
                            <p className="text-xs font-medium text-red-600">{D.paDetailFailed}</p>
                          ) : (
                            <div className="space-y-1.5 text-xs text-slate-600">
                              <div>Provider Txn ID: <span className="font-mono">{detail.providerTxnId ?? "—"}</span></div>
                              <div>Val ID: <span className="font-mono">{detail.valId ?? "—"}</span></div>
                              {detail.ipnPayload != null ? (
                                <pre className="max-h-48 overflow-auto rounded-lg bg-white p-2 font-mono text-[11px] ring-1 ring-slate-200">{JSON.stringify(detail.ipnPayload, null, 2)}</pre>
                              ) : <div>IPN payload: —</div>}
                            </div>
                          )}
                        </td>
                      </tr>
                    ) : null}
                  </React.Fragment>
                );
              })}
            </tbody>
          </table>
        </div>
      ) : null}

      {data && totalPages > 1 ? (
        <div className="flex items-center gap-2 text-xs">
          <button type="button" disabled={page <= 1} onClick={() => setPage((p) => Math.max(1, p - 1))} className="rounded-lg bg-slate-100 px-3 py-1.5 font-semibold text-slate-700 hover:bg-slate-200 disabled:opacity-50">← {D.paPrev}</button>
          <span className="text-slate-500">{t("connections.paPageOf", { page: fmtNumber(locale, page), total: fmtNumber(locale, totalPages) })}</span>
          <button type="button" disabled={page >= totalPages} onClick={() => setPage((p) => Math.min(totalPages, p + 1))} className="rounded-lg bg-slate-100 px-3 py-1.5 font-semibold text-slate-700 hover:bg-slate-200 disabled:opacity-50">{D.paNext} →</button>
        </div>
      ) : null}
    </div>
  );
}
