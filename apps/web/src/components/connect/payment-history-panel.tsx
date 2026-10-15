"use client";
import React, { useCallback, useEffect, useState } from "react";
import { apiFetch } from "@/lib/api";
import { getOrganizationId } from "@/lib/org";
import {
  formatTakaMinor, formatWhen, txnStatusMeta,
  type PaymentIpnView, type PaymentTransactionView,
} from "@/lib/connections";

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
      setError(e instanceof Error ? e.message : "লেনদেনের তালিকা লোড হয়নি");
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
      setError(e instanceof Error ? e.message : "IPN প্রমাণ লোড হয়নি");
    } finally { setBusy(""); }
  }

  return (
    <div className="card space-y-3 p-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="font-semibold text-slate-800">🧾 গেটওয়ে লেনদেনের ইতিহাস</div>
        <div className="flex flex-wrap gap-1.5">
          <select aria-label="অবস্থা" value={status} onChange={(e) => setStatus(e.target.value)} className="rounded-lg border border-slate-200 bg-white px-2 py-1.5 text-xs text-slate-600">
            <option value="">সব অবস্থা</option>
            <option value="initiated">শুরু হয়েছে</option>
            <option value="verified_paid">যাচাইকৃত পেইড</option>
            <option value="failed">ব্যর্থ</option>
            <option value="cancelled">বাতিল</option>
          </select>
          <select aria-label="উৎস" value={source} onChange={(e) => setSource(e.target.value)} className="rounded-lg border border-slate-200 bg-white px-2 py-1.5 text-xs text-slate-600">
            <option value="">নিজের + প্ল্যাটফর্ম</option>
            <option value="own">শুধু নিজের গেটওয়ে</option>
            <option value="platform">শুধু প্ল্যাটফর্ম</option>
          </select>
          <select aria-label="পরিবেশ" value={environment} onChange={(e) => setEnvironment(e.target.value)} className="rounded-lg border border-slate-200 bg-white px-2 py-1.5 text-xs text-slate-600">
            <option value="">Live + Sandbox</option>
            <option value="live">শুধু Live</option>
            <option value="sandbox">শুধু Sandbox (টেস্ট)</option>
          </select>
        </div>
      </div>
      {error ? <p className="text-xs font-medium text-red-600">{error}</p> : null}
      {!loaded ? (
        <p className="text-xs text-slate-400">লোড হচ্ছে…</p>
      ) : txns.length === 0 ? (
        <p className="text-xs text-slate-400">এই ছাঁকনিতে কোনো লেনদেন নেই। অনলাইন পেমেন্ট শুরু হলেই এখানে রেকর্ড আসবে।</p>
      ) : (
        <ul className="space-y-1.5">
          {txns.map((txn) => {
            const meta = txnStatusMeta(txn.status);
            return (
              <li key={txn.id} className="flex flex-wrap items-center gap-2 rounded-lg bg-slate-50 px-3 py-2 text-xs">
                <span className={`rounded-full px-2 py-0.5 font-semibold ${meta.cls}`}>{meta.label}</span>
                {txn.environment === "sandbox" ? (
                  <span className="rounded-full bg-violet-100 px-2 py-0.5 font-semibold text-violet-700">🧪 Sandbox টেস্ট — আসল অর্ডারে প্রভাব নেই</span>
                ) : null}
                <span className="font-semibold text-slate-700">{formatTakaMinor(txn.amountMinor)}</span>
                <span className="text-slate-500">{txn.provider === "bkash" ? "বিকাশ" : txn.provider === "sslcommerz" ? "SSLCommerz" : txn.provider} · {txn.source === "platform" ? "প্ল্যাটফর্ম" : "নিজের গেটওয়ে"}</span>
                <span className="text-slate-400">অর্ডার: {txn.orderId === "sandbox-test" ? "টেস্ট (কোনো অর্ডার নয়)" : txn.orderId}</span>
                <span className="text-slate-400">{formatWhen(txn.createdAt) ?? ""}</span>
                {txn.hasIpnPayload ? (
                  <button type="button" disabled={busy === txn.id} onClick={() => void viewIpn(txn)} className="rounded-lg bg-indigo-50 px-2 py-1 font-semibold text-indigo-700 hover:bg-indigo-100 disabled:opacity-50">
                    {busy === txn.id ? "আসছে…" : "IPN প্রমাণ দেখুন"}
                  </button>
                ) : (
                  <span className="text-slate-300">IPN আসেনি</span>
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
              IPN প্রমাণ — {ipn.provider} · <span className={txnStatusMeta(ipn.status).cls + " rounded-full px-2 py-0.5"}>{txnStatusMeta(ipn.status).label}</span>
              {ipn.environment === "sandbox" ? <span className="ml-1 rounded-full bg-violet-100 px-2 py-0.5 text-[11px] font-semibold text-violet-700">Sandbox টেস্ট</span> : null}
            </div>
            <button type="button" onClick={() => setIpn(null)} className="rounded-lg bg-slate-100 px-2 py-1 text-xs font-semibold text-slate-600 hover:bg-slate-200">বন্ধ করুন</button>
          </div>
          <div className="text-xs text-slate-500">
            {ipn.valId ? <div>Validation ID (val_id): <span className="font-mono">{ipn.valId}</span></div> : null}
            {ipn.providerTxnId ? <div>গেটওয়ে লেনদেন আইডি: <span className="font-mono">{ipn.providerTxnId}</span></div> : null}
          </div>
          {ipn.ipnPayload ? (
            <pre className="max-h-80 overflow-auto rounded-lg bg-slate-900 p-3 text-[11px] leading-relaxed text-slate-100">{JSON.stringify(ipn.ipnPayload, null, 2)}</pre>
          ) : (
            <p className="text-xs text-slate-400">এই লেনদেনে এখনো কোনো IPN payload সেভ হয়নি।</p>
          )}
          <p className="text-[11px] leading-relaxed text-slate-400">
            এটি গেটওয়ের পাঠানো ও সার্ভারে সেভ করা payload — credential-আকৃতির মান (password/secret/sign) "***" দিয়ে ঢাকা।
            পেমেন্ট "সফল" ধরা হয়েছে শুধু সার্ভার-যাচাই (স্বাক্ষর + Validation API / execute-query) মিললেই।
          </p>
        </div>
      ) : null}
    </div>
  );
}
