"use client";
import React, { useCallback, useEffect, useState } from "react";
import { apiFetch } from "@/lib/api";
import { getOrganizationId } from "@/lib/org";
import {
  formatTakaMinor, formatWhen, refundStatusMeta,
  type PaymentRefundView, type PaymentTransactionView,
} from "@/lib/connections";
import { useLocale } from "@/lib/i18n/provider";

/**
 * CC24 — গেটওয়ে রিফান্ড।
 *
 * যাচাইকৃত পেইড লেনদেনের টাকা একই গেটওয়ে দিয়ে ফেরত পাঠানো
 * যায়। এখানে "রিফান্ড শুরু" মানেই টাকা ফিরে যায়নি — গেটওয়ে
 * অনুরোধ গ্রহণ করলে রিফান্ড "প্রক্রিয়াধীন" থাকে; গেটওয়ের
 * নিজের status যাচাই (Refresh) সফল বললেই কেবল "রিফান্ড
 * যাচাইকৃত" হয়, অর্ডারের refunded অঙ্ক বাড়ে এবং প্ল্যাটফর্ম
 * পেমেন্ট হলে Wallet থেকে ডেবিট-ব্যাক হয়। ShurjoPay /
 * aamarPay / Nagad-এর কোনো refund API সংযুক্ত নেই — OU5
 * Refund Center-এ সেগুলোর (ও gateway-manual কেসের) refund
 * provider dashboard-এ হাতে করে এখানে ট্র্যাক করা হয়:
 * অনুরোধ → dashboard reference রেকর্ড → সম্পূর্ণ (একই
 * bookkeeping)। প্যানেল কখনো বলে না প্ল্যাটফর্ম টাকা ফিরিয়েছে।
 */
export function PaymentRefundsPanel() {
  const { dict, t, locale } = useLocale();
  const D = dict.connections;
  const [paidTxns, setPaidTxns] = useState<PaymentTransactionView[]>([]);
  const [refunds, setRefunds] = useState<PaymentRefundView[]>([]);
  const [amounts, setAmounts] = useState<Record<string, string>>({});
  const [reasons, setReasons] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [loaded, setLoaded] = useState(false);

  const load = useCallback(async () => {
    const orgId = getOrganizationId();
    if (!orgId) return;
    try {
      const [txnsRes, refundsRes] = await Promise.all([
        apiFetch<{ transactions: PaymentTransactionView[] }>(
          `organizations/${orgId}/connections/payment-transactions?status=verified_paid&environment=live&limit=50`,
        ),
        apiFetch<{ refunds: PaymentRefundView[] }>(`organizations/${orgId}/connections/refunds?limit=50`),
      ]);
      setPaidTxns(txnsRes.transactions ?? []);
      setRefunds(refundsRes.refunds ?? []);
      setError("");
    } catch (e) {
      setError(e instanceof Error ? e.message : D.rfLoadFailed);
    } finally { setLoaded(true); }
  }, []);

  useEffect(() => { void load(); }, [load]);

  async function initiate(txn: PaymentTransactionView) {
    const orgId = getOrganizationId();
    if (!orgId) return;
    setBusy(txn.id); setError(""); setNotice("");
    try {
      const takaRaw = (amounts[txn.id] ?? "").trim();
      const body: Record<string, unknown> = {};
      if (takaRaw) {
        const taka = Number(takaRaw);
        if (!Number.isFinite(taka) || taka <= 0) throw new Error(D.rfAmountInvalid);
        body.amountMinor = String(Math.round(taka * 100));
      }
      const reason = (reasons[txn.id] ?? "").trim();
      if (reason) body.reason = reason;
      const out = await apiFetch<PaymentRefundView>(`organizations/${orgId}/connections/payment-transactions/${txn.id}/refunds`, {
        method: "POST", body: JSON.stringify(body),
      });
      setNotice(t("connections.rfStartedNotice", { amount: formatTakaMinor(out.amountMinor, locale) }));
      setAmounts((s) => ({ ...s, [txn.id]: "" }));
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : D.rfStartFailed);
    } finally { setBusy(""); }
  }

  async function refresh(refund: PaymentRefundView) {
    const orgId = getOrganizationId();
    if (!orgId) return;
    setBusy(refund.id); setError(""); setNotice("");
    try {
      const out = await apiFetch<PaymentRefundView>(`organizations/${orgId}/connections/refunds/${refund.id}/refresh`, {
        method: "POST", body: "{}",
      });
      if (out.status === "refunded") {
        setNotice(t("connections.rfVerifiedNotice", { amount: formatTakaMinor(out.amountMinor, locale), wallet: out.source === "platform" ? D.rfWalletSuffix : "" }));
      } else if (out.status === "failed") {
        setNotice(D.rfFailedNotice);
      } else {
        setNotice(D.rfProcessingNotice);
      }
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : D.rfRefreshFailed);
    } finally { setBusy(""); }
  }

  const refundableTxns = paidTxns.filter((t) => t.provider === "sslcommerz" || t.provider === "bkash");
  // OU5 Refund Center — providers WITHOUT a refund API here:
  // their refunds happen in the provider dashboard and are
  // only TRACKED in-platform (request → record → complete).
  const manualTxns = paidTxns.filter((t) => t.provider === "shurjopay" || t.provider === "aamarpay" || t.provider === "nagad");
  const [providerRefs, setProviderRefs] = useState<Record<string, string>>({});
  const [proofNotes, setProofNotes] = useState<Record<string, string>>({});

  function providerLabel(p: string) {
    return p === "bkash" ? D.payBkash : p === "nagad" ? D.rfNagad : p === "shurjopay" ? "ShurjoPay" : p === "aamarpay" ? "aamarPay" : "SSLCommerz";
  }

  async function buildAmountBody(txnId: string) {
    const body: Record<string, unknown> = {};
    const takaRaw = (amounts[txnId] ?? "").trim();
    if (takaRaw) {
      const taka = Number(takaRaw);
      if (!Number.isFinite(taka) || taka <= 0) throw new Error(D.rfAmountInvalid);
      body.amountMinor = String(Math.round(taka * 100));
    }
    const reason = (reasons[txnId] ?? "").trim();
    if (reason) body.reason = reason;
    return body;
  }

  async function initiateManual(txn: PaymentTransactionView) {
    const orgId = getOrganizationId();
    if (!orgId) return;
    setBusy(txn.id); setError(""); setNotice("");
    try {
      const body = await buildAmountBody(txn.id);
      await apiFetch<PaymentRefundView>(`organizations/${orgId}/connections/payment-transactions/${txn.id}/refunds/manual`, {
        method: "POST", body: JSON.stringify(body),
      });
      setNotice(D.rfManualCreated);
      setAmounts((s) => ({ ...s, [txn.id]: "" }));
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : D.rfManualCreateFailed);
    } finally { setBusy(""); }
  }

  async function recordManual(refund: PaymentRefundView) {
    const orgId = getOrganizationId();
    if (!orgId) return;
    const providerRef = (providerRefs[refund.id] ?? "").trim();
    if (!providerRef) { setError(D.rfRefRequired); return; }
    setBusy(refund.id); setError(""); setNotice("");
    try {
      await apiFetch<PaymentRefundView>(`organizations/${orgId}/connections/refunds/${refund.id}/manual/record`, {
        method: "POST", body: JSON.stringify({ providerRef, proofNote: (proofNotes[refund.id] ?? "").trim() || undefined }),
      });
      setNotice(D.rfRecordedNotice);
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : D.rfRecordFailed);
    } finally { setBusy(""); }
  }

  async function completeManual(refund: PaymentRefundView) {
    const orgId = getOrganizationId();
    if (!orgId) return;
    setBusy(refund.id); setError(""); setNotice("");
    try {
      const out = await apiFetch<PaymentRefundView>(`organizations/${orgId}/connections/refunds/${refund.id}/manual/complete`, {
        method: "POST", body: "{}",
      });
      setNotice(t("connections.rfManualCompleted", { amount: formatTakaMinor(out.amountMinor, locale), wallet: out.source === "platform" ? D.rfWalletSuffix : "" }));
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : D.rfCompleteFailed);
    } finally { setBusy(""); }
  }

  return (
    <div className="card space-y-3 p-4">
      <div className="font-semibold text-slate-800">{D.rfTitle}</div>
      {error ? <div className="rounded-xl bg-red-50 px-4 py-3 text-sm font-medium text-red-600">{error}</div> : null}
      {notice ? <div className="rounded-xl bg-green-50 px-4 py-3 text-sm font-medium text-green-700">{notice}</div> : null}
      <p className="text-xs leading-relaxed text-slate-500">{D.rfIntro}</p>

      {!loaded ? (
        <p className="text-xs text-slate-400">{dict.common.loading}</p>
      ) : refundableTxns.length === 0 ? (
        <p className="text-xs text-slate-400">{D.rfEmpty}</p>
      ) : (
        <ul className="space-y-1.5">
          {refundableTxns.map((txn) => (
            <li key={txn.id} className="space-y-2 rounded-lg bg-slate-50 px-3 py-2 text-xs">
              <div className="flex flex-wrap items-center gap-2">
                <span className="font-semibold text-slate-700">{formatTakaMinor(txn.amountMinor, locale)}</span>
                <span className="text-slate-500">{txn.provider === "bkash" ? D.payBkash : "SSLCommerz"} · {txn.source === "platform" ? D.phPlatform : D.phOwnGateway}</span>
                <span className="text-slate-400">{D.phOrderLabel}{txn.orderId}</span>
                <span className="text-slate-400">{formatWhen(txn.createdAt, locale) ?? ""}</span>
              </div>
              <div className="flex flex-wrap items-center gap-2">
                <input
                  aria-label={D.rfAriaAmount}
                  className="w-36 rounded-lg border border-slate-200 px-2 py-1.5 text-xs"
                  inputMode="decimal" placeholder={D.rfAmountPh}
                  value={amounts[txn.id] ?? ""} onChange={(e) => setAmounts((s) => ({ ...s, [txn.id]: e.target.value }))}
                />
                <input
                  aria-label={D.rfAriaReason}
                  className="w-48 rounded-lg border border-slate-200 px-2 py-1.5 text-xs"
                  placeholder={D.rfReasonPh}
                  value={reasons[txn.id] ?? ""} onChange={(e) => setReasons((s) => ({ ...s, [txn.id]: e.target.value }))}
                />
                <button type="button" disabled={busy === txn.id} onClick={() => void initiate(txn)} className="rounded-lg bg-red-600 px-3 py-1.5 font-semibold text-white hover:bg-red-700 disabled:opacity-50">
                  {busy === txn.id ? D.rfWorking : D.rfStartBtn}
                </button>
                <button type="button" disabled={busy === txn.id} onClick={() => void initiateManual(txn)} className="rounded-lg bg-slate-100 px-3 py-1.5 font-semibold text-slate-700 hover:bg-slate-200 disabled:opacity-50">
                  {D.rfManualStartBtn}
                </button>
              </div>
            </li>
          ))}
        </ul>
      )}

      {loaded && manualTxns.length > 0 ? (
        <div className="space-y-1.5">
          <div className="text-sm font-semibold text-slate-700">{D.rfCenterTitle}</div>
          <p className="text-xs leading-relaxed text-slate-500">{D.rfCenterIntro}</p>
          <ul className="space-y-1.5">
            {manualTxns.map((txn) => (
              <li key={txn.id} className="space-y-2 rounded-lg bg-amber-50 px-3 py-2 text-xs">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="font-semibold text-slate-700">{formatTakaMinor(txn.amountMinor, locale)}</span>
                  <span className="text-slate-500">{providerLabel(txn.provider)} · {txn.source === "platform" ? D.phPlatform : D.phOwnGateway}</span>
                  <span className="text-slate-400">{D.phOrderLabel}{txn.orderId}</span>
                  <span className="text-slate-400">{formatWhen(txn.createdAt, locale) ?? ""}</span>
                </div>
                <div className="flex flex-wrap items-center gap-2">
                  <input
                    aria-label={D.rfAriaManualAmount}
                    className="w-36 rounded-lg border border-slate-200 px-2 py-1.5 text-xs"
                    inputMode="decimal" placeholder={D.rfAmountPh}
                    value={amounts[txn.id] ?? ""} onChange={(e) => setAmounts((s) => ({ ...s, [txn.id]: e.target.value }))}
                  />
                  <input
                    aria-label={D.rfAriaManualReason}
                    className="w-48 rounded-lg border border-slate-200 px-2 py-1.5 text-xs"
                    placeholder={D.rfReasonPh}
                    value={reasons[txn.id] ?? ""} onChange={(e) => setReasons((s) => ({ ...s, [txn.id]: e.target.value }))}
                  />
                  <button type="button" disabled={busy === txn.id} onClick={() => void initiateManual(txn)} className="rounded-lg bg-amber-600 px-3 py-1.5 font-semibold text-white hover:bg-amber-700 disabled:opacity-50">
                    {busy === txn.id ? D.rfWorking : D.rfManualReqBtn}
                  </button>
                </div>
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      {refunds.length > 0 ? (
        <div className="space-y-1">
          <div className="text-sm font-semibold text-slate-700">{D.rfListTitle}</div>
          {refunds.map((r) => {
            const meta = refundStatusMeta(r.status, locale);
            const manual = r.mode === "manual";
            return (
              <div key={r.id} className="flex flex-wrap items-center gap-2 rounded-lg bg-slate-50 px-3 py-2 text-xs">
                <span className={`rounded-full px-2 py-0.5 font-semibold ${meta.cls}`}>{manual && r.status === "refunded" ? D.rfManualDone : manual && r.status === "processing" ? D.rfManualRecorded : manual && r.status === "initiated" ? D.rfManualRequested : meta.label}</span>
                {manual ? <span className="rounded-full bg-amber-100 px-2 py-0.5 font-semibold text-amber-700">{D.rfManualBadge}</span> : null}
                <span className="font-semibold text-slate-700">{formatTakaMinor(r.amountMinor, locale)}</span>
                <span className="text-slate-500">{providerLabel(r.provider)} · {r.source === "platform" ? D.phPlatform : D.phOwnGateway}</span>
                <span className="text-slate-400">{D.phOrderLabel}{r.orderId}</span>
                {r.gatewayRefundRef ? <span className="font-mono text-slate-400">{manual ? "Dashboard Ref" : "Ref"}: {r.gatewayRefundRef}</span> : null}
                {manual && r.manualProofNote ? <span className="text-slate-400">{D.rfProofNote}{r.manualProofNote}</span> : null}
                {r.reason ? <span className="text-slate-400">{r.reason}</span> : null}
                <span className="text-slate-400">{formatWhen(r.createdAt, locale) ?? ""}</span>
                {!manual && (r.status === "processing" || r.status === "initiated") ? (
                  <button type="button" disabled={busy === r.id} onClick={() => void refresh(r)} className="rounded-lg bg-indigo-50 px-2 py-1 font-semibold text-indigo-700 hover:bg-indigo-100 disabled:opacity-50">
                    {busy === r.id ? D.rfChecking : D.rfRefreshBtn}
                  </button>
                ) : null}
                {manual && r.status === "initiated" ? (
                  <span className="flex w-full flex-wrap items-center gap-2">
                    <input
                      aria-label="Provider dashboard refund reference"
                      className="w-52 rounded-lg border border-slate-200 px-2 py-1.5 text-xs"
                      placeholder={D.rfRefPh}
                      value={providerRefs[r.id] ?? ""} onChange={(e) => setProviderRefs((s) => ({ ...s, [r.id]: e.target.value }))}
                    />
                    <input
                      aria-label={D.rfAriaProof}
                      className="w-52 rounded-lg border border-slate-200 px-2 py-1.5 text-xs"
                      placeholder={D.rfProofPh}
                      value={proofNotes[r.id] ?? ""} onChange={(e) => setProofNotes((s) => ({ ...s, [r.id]: e.target.value }))}
                    />
                    <button type="button" disabled={busy === r.id} onClick={() => void recordManual(r)} className="rounded-lg bg-amber-600 px-2 py-1.5 font-semibold text-white hover:bg-amber-700 disabled:opacity-50">
                      {busy === r.id ? D.rfWorking : D.rfRecordBtn}
                    </button>
                  </span>
                ) : null}
                {manual && r.status === "processing" ? (
                  <button type="button" disabled={busy === r.id} onClick={() => void completeManual(r)} className="rounded-lg bg-green-600 px-2 py-1.5 font-semibold text-white hover:bg-green-700 disabled:opacity-50">
                    {busy === r.id ? D.rfWorking : D.rfCompleteBtn}
                  </button>
                ) : null}
                {!manual && r.gatewayStatusRaw ? (
                  <span className="w-full font-mono text-[10px] leading-relaxed text-slate-400">{D.rfGatewayRaw}{JSON.stringify(r.gatewayStatusRaw)}</span>
                ) : null}
              </div>
            );
          })}
        </div>
      ) : null}
    </div>
  );
}
