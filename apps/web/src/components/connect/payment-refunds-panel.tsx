"use client";
import React, { useCallback, useEffect, useState } from "react";
import { apiFetch } from "@/lib/api";
import { getOrganizationId } from "@/lib/org";
import {
  formatTakaMinor, formatWhen, refundStatusMeta,
  type PaymentRefundView, type PaymentTransactionView,
} from "@/lib/connections";

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
      setError(e instanceof Error ? e.message : "রিফান্ডের তথ্য লোড হয়নি");
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
        if (!Number.isFinite(taka) || taka <= 0) throw new Error("রিফান্ডের পরিমাণ সঠিক টাকায় দিন (খালি রাখলে পুরো অবশিষ্ট পরিমাণ)।");
        body.amountMinor = String(Math.round(taka * 100));
      }
      const reason = (reasons[txn.id] ?? "").trim();
      if (reason) body.reason = reason;
      const out = await apiFetch<PaymentRefundView>(`organizations/${orgId}/connections/payment-transactions/${txn.id}/refunds`, {
        method: "POST", body: JSON.stringify(body),
      });
      setNotice(`রিফান্ড শুরু হয়েছে (${formatTakaMinor(out.amountMinor)}) — গেটওয়ে গ্রহণ করেছে, এখন প্রক্রিয়াধীন। গেটওয়ের যাচাই সফল হলেই কেবল এটি "রিফান্ড যাচাইকৃত" হবে; Refresh চাপলেই সর্বশেষ অবস্থা আসবে।`);
      setAmounts((s) => ({ ...s, [txn.id]: "" }));
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "রিফান্ড শুরু করা যায়নি");
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
        setNotice(`রিফান্ড যাচাইকৃত — ${formatTakaMinor(out.amountMinor)} গেটওয়ে নিশ্চিত করেছে। অর্ডারের refunded অঙ্ক হালনাগাদ হয়েছে${out.source === "platform" ? " এবং Wallet থেকে ডেবিট-ব্যাক হয়েছে" : ""}।`);
      } else if (out.status === "failed") {
        setNotice("গেটওয়ে জানিয়েছে এই রিফান্ডটি ব্যর্থ/বাতিল — কোনো টাকা ফেরেনি।");
      } else {
        setNotice("গেটওয়ে এখনো প্রক্রিয়াধীন বলছে — কিছুক্ষণ পর আবার Refresh করুন।");
      }
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "রিফান্ডের অবস্থা যাচাই করা যায়নি");
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
    return p === "bkash" ? "বিকাশ" : p === "nagad" ? "নগদ" : p === "shurjopay" ? "ShurjoPay" : p === "aamarpay" ? "aamarPay" : "SSLCommerz";
  }

  async function buildAmountBody(txnId: string) {
    const body: Record<string, unknown> = {};
    const takaRaw = (amounts[txnId] ?? "").trim();
    if (takaRaw) {
      const taka = Number(takaRaw);
      if (!Number.isFinite(taka) || taka <= 0) throw new Error("রিফান্ডের পরিমাণ সঠিক টাকায় দিন (খালি রাখলে পুরো অবশিষ্ট পরিমাণ)।");
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
      setNotice("ম্যানুয়াল রিফান্ড অনুরোধ তৈরি হয়েছে — এখন provider dashboard থেকে refund করে নিচের তালিকায় তার reference রেকর্ড করুন। অনুরোধ তৈরি মানেই টাকা ফেরেনি।");
      setAmounts((s) => ({ ...s, [txn.id]: "" }));
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "ম্যানুয়াল রিফান্ড অনুরোধ তৈরি করা যায়নি");
    } finally { setBusy(""); }
  }

  async function recordManual(refund: PaymentRefundView) {
    const orgId = getOrganizationId();
    if (!orgId) return;
    const providerRef = (providerRefs[refund.id] ?? "").trim();
    if (!providerRef) { setError("Provider dashboard-এর refund reference/transaction ID দিন — রেফারেন্স ছাড়া রেকর্ড হবে না।"); return; }
    setBusy(refund.id); setError(""); setNotice("");
    try {
      await apiFetch<PaymentRefundView>(`organizations/${orgId}/connections/refunds/${refund.id}/manual/record`, {
        method: "POST", body: JSON.stringify({ providerRef, proofNote: (proofNotes[refund.id] ?? "").trim() || undefined }),
      });
      setNotice("Dashboard refund রেকর্ড হয়েছে — যাচাই করে “সম্পূর্ণ করুন” চাপলেই অর্ডারের refunded অঙ্ক হালনাগাদ হবে।");
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "রেকর্ড করা যায়নি");
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
      setNotice(`ম্যানুয়াল রিফান্ড সম্পূর্ণ রেকর্ড হয়েছে — ${formatTakaMinor(out.amountMinor)}। provider dashboard-এ হাতে করা হয়েছে — প্ল্যাটফর্ম ট্র্যাক করছে। অর্ডারের refunded অঙ্ক হালনাগাদ হয়েছে${out.source === "platform" ? " এবং Wallet থেকে ডেবিট-ব্যাক হয়েছে" : ""}।`);
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "সম্পূর্ণ করা যায়নি");
    } finally { setBusy(""); }
  }

  return (
    <div className="card space-y-3 p-4">
      <div className="font-semibold text-slate-800">↩️ রিফান্ড (গেটওয়ে + Refund Center)</div>
      {error ? <div className="rounded-xl bg-red-50 px-4 py-3 text-sm font-medium text-red-600">{error}</div> : null}
      {notice ? <div className="rounded-xl bg-green-50 px-4 py-3 text-sm font-medium text-green-700">{notice}</div> : null}
      <p className="text-xs leading-relaxed text-slate-500">
        রিফান্ড শুরু করা মানেই টাকা ফেরা নয় — গেটওয়ের status যাচাই সফল হলেই কেবল রিফান্ড সম্পূর্ণ ধরা হয়।
        আংশিক রিফান্ডও করা যায়; সব মিলিয়ে যাচাইকৃত + প্রক্রিয়াধীন রিফান্ড কখনো পেমেন্টের পরিমাণ ছাড়াতে পারবে না।
        ShurjoPay, aamarPay ও Nagad-এর কোনো refund API সংযুক্ত নেই — সেগুলোর রিফান্ড provider dashboard-এ হাতে করে
        Refund Center-এ রেকর্ড রাখুন: প্ল্যাটফর্ম টাকা ফেরায় না, শুধু ট্র্যাক করে এবং সম্পূর্ণ হলে অর্ডারের refunded অঙ্ক হালনাগাদ করে।
      </p>

      {!loaded ? (
        <p className="text-xs text-slate-400">লোড হচ্ছে…</p>
      ) : refundableTxns.length === 0 ? (
        <p className="text-xs text-slate-400">এখনো কোনো যাচাইকৃত পেইড লেনদেন নেই — পেমেন্ট যাচাই সম্পন্ন হলেই এখানে রিফান্ডের অপশন আসবে।</p>
      ) : (
        <ul className="space-y-1.5">
          {refundableTxns.map((txn) => (
            <li key={txn.id} className="space-y-2 rounded-lg bg-slate-50 px-3 py-2 text-xs">
              <div className="flex flex-wrap items-center gap-2">
                <span className="font-semibold text-slate-700">{formatTakaMinor(txn.amountMinor)}</span>
                <span className="text-slate-500">{txn.provider === "bkash" ? "বিকাশ" : "SSLCommerz"} · {txn.source === "platform" ? "প্ল্যাটফর্ম" : "নিজের গেটওয়ে"}</span>
                <span className="text-slate-400">অর্ডার: {txn.orderId}</span>
                <span className="text-slate-400">{formatWhen(txn.createdAt) ?? ""}</span>
              </div>
              <div className="flex flex-wrap items-center gap-2">
                <input
                  aria-label="রিফান্ডের পরিমাণ (টাকা)"
                  className="w-36 rounded-lg border border-slate-200 px-2 py-1.5 text-xs"
                  inputMode="decimal" placeholder="টাকা (খালি = পুরোটা)"
                  value={amounts[txn.id] ?? ""} onChange={(e) => setAmounts((s) => ({ ...s, [txn.id]: e.target.value }))}
                />
                <input
                  aria-label="রিফান্ডের কারণ"
                  className="w-48 rounded-lg border border-slate-200 px-2 py-1.5 text-xs"
                  placeholder="কারণ (ঐচ্ছিক)"
                  value={reasons[txn.id] ?? ""} onChange={(e) => setReasons((s) => ({ ...s, [txn.id]: e.target.value }))}
                />
                <button type="button" disabled={busy === txn.id} onClick={() => void initiate(txn)} className="rounded-lg bg-red-600 px-3 py-1.5 font-semibold text-white hover:bg-red-700 disabled:opacity-50">
                  {busy === txn.id ? "হচ্ছে…" : "রিফান্ড শুরু করুন"}
                </button>
                <button type="button" disabled={busy === txn.id} onClick={() => void initiateManual(txn)} className="rounded-lg bg-slate-100 px-3 py-1.5 font-semibold text-slate-700 hover:bg-slate-200 disabled:opacity-50">
                  ম্যানুয়াল রেকর্ড শুরু (dashboard-এ করে থাকলে)
                </button>
              </div>
            </li>
          ))}
        </ul>
      )}

      {loaded && manualTxns.length > 0 ? (
        <div className="space-y-1.5">
          <div className="text-sm font-semibold text-slate-700">🧾 Refund Center — ম্যানুয়াল রিফান্ড (API নেই)</div>
          <p className="text-xs leading-relaxed text-slate-500">
            এই প্রোভাইডারগুলোর refund API নেই — টাকা ফেরাতে হবে provider dashboard-এ হাতে। এখানে অনুরোধ তৈরি করুন,
            dashboard-এর reference রেকর্ড করুন, তারপর সম্পূর্ণ করুন। লেবেল: provider dashboard-এ হাতে করা হয়েছে — প্ল্যাটফর্ম ট্র্যাক করছে।
          </p>
          <ul className="space-y-1.5">
            {manualTxns.map((txn) => (
              <li key={txn.id} className="space-y-2 rounded-lg bg-amber-50 px-3 py-2 text-xs">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="font-semibold text-slate-700">{formatTakaMinor(txn.amountMinor)}</span>
                  <span className="text-slate-500">{providerLabel(txn.provider)} · {txn.source === "platform" ? "প্ল্যাটফর্ম" : "নিজের গেটওয়ে"}</span>
                  <span className="text-slate-400">অর্ডার: {txn.orderId}</span>
                  <span className="text-slate-400">{formatWhen(txn.createdAt) ?? ""}</span>
                </div>
                <div className="flex flex-wrap items-center gap-2">
                  <input
                    aria-label="ম্যানুয়াল রিফান্ডের পরিমাণ (টাকা)"
                    className="w-36 rounded-lg border border-slate-200 px-2 py-1.5 text-xs"
                    inputMode="decimal" placeholder="টাকা (খালি = পুরোটা)"
                    value={amounts[txn.id] ?? ""} onChange={(e) => setAmounts((s) => ({ ...s, [txn.id]: e.target.value }))}
                  />
                  <input
                    aria-label="ম্যানুয়াল রিফান্ডের কারণ"
                    className="w-48 rounded-lg border border-slate-200 px-2 py-1.5 text-xs"
                    placeholder="কারণ (ঐচ্ছিক)"
                    value={reasons[txn.id] ?? ""} onChange={(e) => setReasons((s) => ({ ...s, [txn.id]: e.target.value }))}
                  />
                  <button type="button" disabled={busy === txn.id} onClick={() => void initiateManual(txn)} className="rounded-lg bg-amber-600 px-3 py-1.5 font-semibold text-white hover:bg-amber-700 disabled:opacity-50">
                    {busy === txn.id ? "হচ্ছে…" : "ম্যানুয়াল রিফান্ড অনুরোধ"}
                  </button>
                </div>
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      {refunds.length > 0 ? (
        <div className="space-y-1">
          <div className="text-sm font-semibold text-slate-700">রিফান্ডসমূহ</div>
          {refunds.map((r) => {
            const meta = refundStatusMeta(r.status);
            const manual = r.mode === "manual";
            return (
              <div key={r.id} className="flex flex-wrap items-center gap-2 rounded-lg bg-slate-50 px-3 py-2 text-xs">
                <span className={`rounded-full px-2 py-0.5 font-semibold ${meta.cls}`}>{manual && r.status === "refunded" ? "রিফান্ড রেকর্ড সম্পূর্ণ" : manual && r.status === "processing" ? "রেকর্ড হয়েছে — সম্পূর্ণ বাকি" : manual && r.status === "initiated" ? "অনুরোধ — dashboard রেকর্ড বাকি" : meta.label}</span>
                {manual ? <span className="rounded-full bg-amber-100 px-2 py-0.5 font-semibold text-amber-700">ম্যানুয়াল · provider dashboard-এ হাতে করা হয়েছে — প্ল্যাটফর্ম ট্র্যাক করছে</span> : null}
                <span className="font-semibold text-slate-700">{formatTakaMinor(r.amountMinor)}</span>
                <span className="text-slate-500">{providerLabel(r.provider)} · {r.source === "platform" ? "প্ল্যাটফর্ম" : "নিজের গেটওয়ে"}</span>
                <span className="text-slate-400">অর্ডার: {r.orderId}</span>
                {r.gatewayRefundRef ? <span className="font-mono text-slate-400">{manual ? "Dashboard Ref" : "Ref"}: {r.gatewayRefundRef}</span> : null}
                {manual && r.manualProofNote ? <span className="text-slate-400">প্রমাণ নোট: {r.manualProofNote}</span> : null}
                {r.reason ? <span className="text-slate-400">{r.reason}</span> : null}
                <span className="text-slate-400">{formatWhen(r.createdAt) ?? ""}</span>
                {!manual && (r.status === "processing" || r.status === "initiated") ? (
                  <button type="button" disabled={busy === r.id} onClick={() => void refresh(r)} className="rounded-lg bg-indigo-50 px-2 py-1 font-semibold text-indigo-700 hover:bg-indigo-100 disabled:opacity-50">
                    {busy === r.id ? "যাচাই হচ্ছে…" : "অবস্থা Refresh"}
                  </button>
                ) : null}
                {manual && r.status === "initiated" ? (
                  <span className="flex w-full flex-wrap items-center gap-2">
                    <input
                      aria-label="Provider dashboard refund reference"
                      className="w-52 rounded-lg border border-slate-200 px-2 py-1.5 text-xs"
                      placeholder="Dashboard refund reference / TrxID (আবশ্যক)"
                      value={providerRefs[r.id] ?? ""} onChange={(e) => setProviderRefs((s) => ({ ...s, [r.id]: e.target.value }))}
                    />
                    <input
                      aria-label="ম্যানুয়াল রিফান্ডের প্রমাণ নোট"
                      className="w-52 rounded-lg border border-slate-200 px-2 py-1.5 text-xs"
                      placeholder="প্রমাণ নোট (ঐচ্ছিক)"
                      value={proofNotes[r.id] ?? ""} onChange={(e) => setProofNotes((s) => ({ ...s, [r.id]: e.target.value }))}
                    />
                    <button type="button" disabled={busy === r.id} onClick={() => void recordManual(r)} className="rounded-lg bg-amber-600 px-2 py-1.5 font-semibold text-white hover:bg-amber-700 disabled:opacity-50">
                      {busy === r.id ? "হচ্ছে…" : "Dashboard কাজ রেকর্ড করুন"}
                    </button>
                  </span>
                ) : null}
                {manual && r.status === "processing" ? (
                  <button type="button" disabled={busy === r.id} onClick={() => void completeManual(r)} className="rounded-lg bg-green-600 px-2 py-1.5 font-semibold text-white hover:bg-green-700 disabled:opacity-50">
                    {busy === r.id ? "হচ্ছে…" : "সম্পূর্ণ করুন"}
                  </button>
                ) : null}
                {!manual && r.gatewayStatusRaw ? (
                  <span className="w-full font-mono text-[10px] leading-relaxed text-slate-400">গেটওয়ের সর্বশেষ উত্তর: {JSON.stringify(r.gatewayStatusRaw)}</span>
                ) : null}
              </div>
            );
          })}
        </div>
      ) : null}
    </div>
  );
}
