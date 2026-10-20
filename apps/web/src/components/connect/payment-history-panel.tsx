"use client";
import React, { useCallback, useEffect, useState } from "react";
import { apiFetch } from "@/lib/api";
import { getOrganizationId } from "@/lib/org";
import {
  formatTakaMinor, formatWhen, txnStatusMeta,
  type PaymentIpnView, type PaymentTransactionView,
} from "@/lib/connections";
import { useLocale } from "@/lib/i18n/provider";

/**
 * CC19 — গেটওয়ে লেনদেনের ইতিহাস + IPN প্রমাণ viewer।
 *
 * তালিকার প্রতিটি সারি আসল TenantPaymentTransaction রেকর্ড —
 * নিজের গেটওয়ে ও প্ল্যাটফর্ম, Live ও Sandbox (আলাদা ব্যাজে)।
 * IPN viewer সার্ভারে সেভ করা যাচাই-প্রমাণই দেখায়;
 * credential-আকৃতির key (store password, secret, sign ইত্যাদি)
 * সার্ভারেই "***" দিয়ে ঢাকা থাকে — ব্রাউজারে কখনো আসে না।
 * Sandbox লেনদেন কখনো আসল অর্ডারকে paid করে না — ব্যাজে তা
 * স্পষ্ট লেখা থাকে।
 */
export function PaymentHistoryPanel() {
  const { dict, locale } = useLocale();
  const D = dict.connections;
  const [txns, setTxns] = useState<PaymentTransactionView[]>([]);
  const [status, setStatus] = useState("");
  const [source, setSource] = useState("");
  const [environment, setEnvironment] = useState("");
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");
  const [ipn, setIpn] = useState<PaymentIpnView | null>(null);
  const [loaded, setLoaded] = useState(false);

  const load = useCallback(async () => {
    const orgId = getOrganizationId();
    if (!orgId) return;
    const params = new URLSearchParams({ limit: "50" });
    if (status) params.set("status", status);
    if (source) params.set("source", source);
    if (environment) params.set("environment", environment);
    try {
      const res = await apiFetch<{ transactions: PaymentTransactionView[] }>(
        `organizations/${orgId}/connections/payment-transactions?${params.toString()}`,
      );
      setTxns(res.transactions ?? []);
      setError("");
    } catch (e) {
      setError(e instanceof Error ? e.message : D.phLoadFailed);
    } finally { setLoaded(true); }
  }, [status, source, environment]);

  useEffect(() => { void load(); }, [load]);

  async function viewIpn(txn: PaymentTransactionView) {
    const orgId = getOrganizationId();
    if (!orgId) return;
    setBusy(txn.id); setError("");
    try {
      const res = await apiFetch<PaymentIpnView>(`organizations/${orgId}/connections/payment-transactions/${txn.id}/ipn`);
      setIpn(res);
    } catch (e) {
      setError(e instanceof Error ? e.message : D.phIpnLoadFailed);
    } finally { setBusy(""); }
  }

  return (
    <div className="card space-y-3 p-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="font-semibold text-slate-800">{D.phTitle}</div>
        <div className="flex flex-wrap gap-1.5">
          <select aria-label={D.phStatusAria} value={status} onChange={(e) => setStatus(e.target.value)} className="rounded-lg border border-slate-200 bg-white px-2 py-1.5 text-xs text-slate-600">
            <option value="">{D.phAllStatuses}</option>
            <option value="initiated">{D.txnInitiated}</option>
            <option value="verified_paid">{D.txnVerifiedPaid}</option>
            <option value="failed">{D.txnFailed}</option>
            <option value="cancelled">{D.txnCancelled}</option>
          </select>
          <select aria-label={D.phSourceAria} value={source} onChange={(e) => setSource(e.target.value)} className="rounded-lg border border-slate-200 bg-white px-2 py-1.5 text-xs text-slate-600">
            <option value="">{D.phOwnPlatform}</option>
            <option value="own">{D.phOwnOnly}</option>
            <option value="platform">{D.phPlatformOnly}</option>
          </select>
          <select aria-label={D.phEnvAria} value={environment} onChange={(e) => setEnvironment(e.target.value)} className="rounded-lg border border-slate-200 bg-white px-2 py-1.5 text-xs text-slate-600">
            <option value="">Live + Sandbox</option>
            <option value="live">{D.phLiveOnly}</option>
            <option value="sandbox">{D.phSandboxOnly}</option>
          </select>
        </div>
      </div>
      {error ? <p className="text-xs font-medium text-red-600">{error}</p> : null}
      {!loaded ? (
        <p className="text-xs text-slate-400">{dict.common.loading}</p>
      ) : txns.length === 0 ? (
        <p className="text-xs text-slate-400">{D.phEmpty}</p>
      ) : (
        <ul className="space-y-1.5">
          {txns.map((txn) => {
            const meta = txnStatusMeta(txn.status, locale);
            return (
              <li key={txn.id} className="flex flex-wrap items-center gap-2 rounded-lg bg-slate-50 px-3 py-2 text-xs">
                <span className={`rounded-full px-2 py-0.5 font-semibold ${meta.cls}`}>{meta.label}</span>
                {txn.environment === "sandbox" ? (
                  <span className="rounded-full bg-violet-100 px-2 py-0.5 font-semibold text-violet-700">{D.phSandboxBadge}</span>
                ) : null}
                <span className="font-semibold text-slate-700">{formatTakaMinor(txn.amountMinor, locale)}</span>
                <span className="text-slate-500">{txn.provider === "bkash" ? D.payBkash : txn.provider === "sslcommerz" ? "SSLCommerz" : txn.provider} · {txn.source === "platform" ? D.phPlatform : D.phOwnGateway}</span>
                <span className="text-slate-400">{D.phOrderLabel}{txn.orderId === "sandbox-test" ? D.phTestOrder : txn.orderId}</span>
                <span className="text-slate-400">{formatWhen(txn.createdAt, locale) ?? ""}</span>
                {txn.hasIpnPayload ? (
                  <button type="button" disabled={busy === txn.id} onClick={() => void viewIpn(txn)} className="rounded-lg bg-indigo-50 px-2 py-1 font-semibold text-indigo-700 hover:bg-indigo-100 disabled:opacity-50">
                    {busy === txn.id ? D.phLoading : D.phViewIpn}
                  </button>
                ) : (
                  <span className="text-slate-300">{D.phNoIpn}</span>
                )}
              </li>
            );
          })}
        </ul>
      )}
      {ipn ? (
        <div className="space-y-2 rounded-xl border border-slate-200 p-3">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="text-sm font-semibold text-slate-700">
              {D.phIpnTitle}{ipn.provider} · <span className={txnStatusMeta(ipn.status, locale).cls + " rounded-full px-2 py-0.5"}>{txnStatusMeta(ipn.status, locale).label}</span>
              {ipn.environment === "sandbox" ? <span className="ml-1 rounded-full bg-violet-100 px-2 py-0.5 text-[11px] font-semibold text-violet-700">{D.phSandboxChip}</span> : null}
            </div>
            <button type="button" onClick={() => setIpn(null)} className="rounded-lg bg-slate-100 px-2 py-1 text-xs font-semibold text-slate-600 hover:bg-slate-200">{dict.common.close}</button>
          </div>
          <div className="text-xs text-slate-500">
            {ipn.valId ? <div>Validation ID (val_id): <span className="font-mono">{ipn.valId}</span></div> : null}
            {ipn.providerTxnId ? <div>{D.phGatewayTxnId}<span className="font-mono">{ipn.providerTxnId}</span></div> : null}
          </div>
          {ipn.ipnPayload ? (
            <pre className="max-h-80 overflow-auto rounded-lg bg-slate-900 p-3 text-[11px] leading-relaxed text-slate-100">{JSON.stringify(ipn.ipnPayload, null, 2)}</pre>
          ) : (
            <p className="text-xs text-slate-400">{D.phNoPayload}</p>
          )}
          <p className="text-[11px] leading-relaxed text-slate-400">{D.phPayloadNote}</p>
        </div>
      ) : null}
    </div>
  );
}
