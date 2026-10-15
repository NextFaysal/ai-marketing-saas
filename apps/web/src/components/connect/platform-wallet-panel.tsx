"use client";
import React, { useCallback, useEffect, useState } from "react";
import { apiFetch, API_URL, getToken } from "@/lib/api";
import { getOrganizationId } from "@/lib/org";
import { buildPayoutBody, type PayoutForm } from "@/lib/connect-forms";
import {
  formatTakaMinor, formatWhen, ledgerTypeLabel, payoutStatusLabel,
  type PayoutRequestView, type PlatformPaymentsView, type WalletView,
} from "@/lib/connections";

/**
 * CC10 (Connect Center B5) — Platform gateway + Wallet.
 *
 * আমাদের (প্ল্যাটফর্মের) গেটওয়ে দিয়ে পেমেন্ট নিলে টাকা
 * প্ল্যাটফর্ম অ্যাকাউন্টে আসে — যাচাইকৃত পেমেন্টের নিট অংশ
 * (প্ল্যাটফর্ম ফি বাদে) এখানে Wallet-এ জমা হয়। ফি-র হার
 * হার্ডকোড নয়: API যেই বর্তমান হার পাঠায় সেটাই দেখানো হয়।
 * কোনো প্রোভাইডার প্ল্যাটফর্মে কনফিগার করা না থাকলে তা
 * "প্ল্যাটফর্মে এখনো কনফিগার করা হয়নি" হিসেবে দেখায় এবং
 * চালু করা যায় না — ভুয়া অপশন নয়। Payout অনুরোধ করলে
 * পরিমাণটি আটকে (hold) থাকে; টাকা আসলে বের হয় শুধু অ্যাডমিন
 * অনুমোদন + mark-paid-এর পর।
 */

const PROVIDER_META: { id: string; icon: string; title: string }[] = [
  { id: "sslcommerz", icon: "💳", title: "SSLCommerz (প্ল্যাটফর্মের)" },
  { id: "bkash", icon: "📱", title: "বিকাশ (bKash, প্ল্যাটফর্মের)" },
];

const inputCls = "mt-1 w-full rounded-lg border border-slate-200 px-3 py-2 text-sm outline-none focus:border-indigo-400";

const EMPTY_PAYOUT: PayoutForm = {
  amountTaka: "", method: "bkash", bkashNumber: "",
  accountName: "", accountNumber: "", bankName: "", branch: "",
};

export function PlatformWalletPanel({ onChanged }: { onChanged?: () => void }) {
  const [platform, setPlatform] = useState<PlatformPaymentsView | null>(null);
  const [wallet, setWallet] = useState<WalletView | null>(null);
  const [requests, setRequests] = useState<PayoutRequestView[]>([]);
  const [form, setForm] = useState<PayoutForm>(EMPTY_PAYOUT);
  // CC23: TOTP step-up code for the payout request (sent only
  // when filled; the server requires it iff TOTP is enabled).
  const [totpCode, setTotpCode] = useState("");
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [stmtFrom, setStmtFrom] = useState("");
  const [stmtTo, setStmtTo] = useState("");

  const load = useCallback(async () => {
    const orgId = getOrganizationId();
    if (!orgId) return;
    try {
      const [pp, w, pr] = await Promise.all([
        apiFetch<PlatformPaymentsView>(`organizations/${orgId}/connections/platform-payments`),
        apiFetch<WalletView>(`organizations/${orgId}/connections/wallet`),
        apiFetch<{ requests: PayoutRequestView[] }>(`organizations/${orgId}/connections/payout-requests`),
      ]);
      setPlatform(pp); setWallet(w); setRequests(pr.requests ?? []);
    } catch { /* section stays empty rather than inventing state */ }
  }, []);

  useEffect(() => { void load(); }, [load]);

  const toggle = useCallback(async (provider: string, enabled: boolean) => {
    const orgId = getOrganizationId();
    if (!orgId) return;
    setBusy(provider); setError(""); setNotice("");
    try {
      await apiFetch(`organizations/${orgId}/connections/platform-payments/${provider}/enabled`, {
        method: "PUT", body: JSON.stringify({ isEnabled: enabled }),
      });
      setNotice(enabled ? "প্ল্যাটফর্ম গেটওয়ে চালু হয়েছে — এখন এই প্রোভাইডারে প্ল্যাটফর্ম পেমেন্ট নেওয়া যাবে।" : "প্ল্যাটফর্ম গেটওয়ে বন্ধ করা হয়েছে।");
      await load(); onChanged?.();
    } catch (e) {
      setError(e instanceof Error ? e.message : "কাজটি সম্পন্ন হয়নি");
    } finally { setBusy(""); }
  }, [load, onChanged]);

  const submitPayout = useCallback(async (e: React.FormEvent) => {
    e.preventDefault();
    const orgId = getOrganizationId();
    if (!orgId) return;
    setBusy("payout"); setError(""); setNotice("");
    try {
      const res = await apiFetch<{ stepUpUnavailable?: boolean }>(`organizations/${orgId}/connections/payout-requests`, {
        method: "POST", body: JSON.stringify({ ...buildPayoutBody(form), ...(totpCode.trim() ? { totpCode: totpCode.trim() } : {}) }),
      });
      const base = "Payout অনুরোধ পাঠানো হয়েছে — পরিমাণটি অনুমোদন পর্যন্ত আটকে (hold) থাকবে। অ্যাডমিন অনুমোদন দিয়ে পাঠালে তবেই ব্যালেন্স থেকে কাটা হবে।";
      setNotice(res?.stepUpUnavailable ? `${base} (আপনার Two-Factor চালু নেই — Wallet থেকে টাকা তোলার মতো সংবেদনশীল কাজে অতিরিক্ত সুরক্ষার জন্য Settings থেকে Two-Factor চালু করুন।)` : base);
      setForm(EMPTY_PAYOUT);
      setTotpCode("");
      await load(); onChanged?.();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Payout অনুরোধ পাঠানো যায়নি");
    } finally { setBusy(""); }
  }, [form, load, onChanged, totpCode]);

  const cancel = useCallback(async (id: string) => {
    const orgId = getOrganizationId();
    if (!orgId) return;
    setBusy(id); setError("");
    try {
      await apiFetch(`organizations/${orgId}/connections/payout-requests/${id}/cancel`, { method: "POST", body: "{}" });
      setNotice("অনুরোধটি বাতিল করা হয়েছে — আটকে থাকা পরিমাণ আবার উপলব্ধ হয়েছে।");
      await load(); onChanged?.();
    } catch (err) {
      setError(err instanceof Error ? err.message : "বাতিল করা যায়নি");
    } finally { setBusy(""); }
  }, [load, onChanged]);

  // CC19: Wallet statement download — সার্ভার আসল ledger থেকেই
  // opening/entries/closing হিসাব করে ফাইল বানায়; এখানে শুধু
  // তারিখের পরিসর পাঠানো হয় (auth header সহ blob download,
  // customers export-এর একই প্যাটার্ন)।
  const downloadStatement = useCallback(async (format: "csv" | "pdf") => {
    const orgId = getOrganizationId();
    if (!orgId) return;
    setBusy(`statement-${format}`); setError("");
    try {
      const params = new URLSearchParams();
      if (stmtFrom) params.set("from", stmtFrom);
      if (stmtTo) params.set("to", stmtTo);
      const res = await fetch(`${API_URL}/organizations/${orgId}/connections/wallet/statement.${format}?${params.toString()}`, {
        headers: { Authorization: `Bearer ${getToken() ?? ""}` },
      });
      if (!res.ok) { const body: any = await res.json().catch(() => ({})); throw new Error(body?.message ?? `HTTP ${res.status}`); }
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url; a.download = `wallet-statement.${format}`; a.click();
      setTimeout(() => URL.revokeObjectURL(url), 5000);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Statement ডাউনলোড হয়নি");
    } finally { setBusy(""); }
  }, [stmtFrom, stmtTo]);

  const feePercent = platform ? platform.feePercent : null;

  return (
    <div className="card space-y-4 p-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="font-semibold text-slate-800">🏦 প্ল্যাটফর্ম গেটওয়ে + Wallet</div>
        {wallet ? (
          <span className="rounded-full bg-indigo-100 px-2 py-0.5 text-[11px] font-semibold text-indigo-700">
            ব্যালেন্স {formatTakaMinor(wallet.balanceMinor)}
          </span>
        ) : null}
      </div>
      {error ? <div className="rounded-xl bg-red-50 px-4 py-3 text-sm font-medium text-red-600">{error}</div> : null}
      {notice ? <div className="rounded-xl bg-green-50 px-4 py-3 text-sm font-medium text-green-700">{notice}</div> : null}

      <p className="text-xs leading-relaxed text-slate-500">
        আমাদের গেটওয়ে দিয়ে কাস্টমার পেমেন্ট করলে টাকা প্ল্যাটফর্ম অ্যাকাউন্টে আসে; গেটওয়ের সার্ভার-যাচাই সফল হলেই
        কেবল নিট অংশ আপনার Wallet-এ জমা হয় — পেমেন্ট শুরু বা ব্রাউজার ফেরত কখনোই জমা ধরা হয় না।
        {feePercent !== null ? <> বর্তমান প্ল্যাটফর্ম ফি: <b>{feePercent}%</b> (প্রতি যাচাইকৃত পেমেন্টে, অ্যাডমিন কনফিগ থেকে)।</> : null}
      </p>

      <div className="grid gap-3 sm:grid-cols-2">
        {PROVIDER_META.map((meta) => {
          const view = platform?.providers.find((p) => p.provider === meta.id) ?? null;
          return (
            <div key={meta.id} className="space-y-2 rounded-xl border border-slate-200 p-3">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div className="text-sm font-semibold text-slate-800">{meta.icon} {meta.title}</div>
                {!view || !view.offered ? (
                  <span className="rounded-full bg-slate-100 px-2 py-0.5 text-[11px] font-semibold text-slate-500">প্ল্যাটফর্মে এখনো কনফিগার করা হয়নি</span>
                ) : view.enabled ? (
                  <span className="rounded-full bg-green-100 px-2 py-0.5 text-[11px] font-semibold text-green-700">চালু আছে</span>
                ) : (
                  <span className="rounded-full bg-amber-100 px-2 py-0.5 text-[11px] font-semibold text-amber-700">বন্ধ আছে</span>
                )}
              </div>
              <p className="text-xs leading-relaxed text-slate-500">
                {!view || !view.offered
                  ? "প্ল্যাটফর্ম অ্যাডমিন এই গেটওয়েটি যোগ করলে তবেই এটি চালু করা যাবে — তার আগে কোনো চেকআউট এই পথে চলবে না।"
                  : "চালু থাকলে আপনার স্টোরের কাস্টমার এই গেটওয়েতে পেমেন্ট করতে পারবে; যাচাইকৃত টাকার নিট অংশ Wallet-এ জমা হবে।"}
              </p>
              {view?.offered ? (
                <button
                  type="button"
                  disabled={busy === meta.id}
                  onClick={() => void toggle(meta.id, !view.enabled)}
                  className="rounded-lg bg-indigo-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-indigo-700 disabled:opacity-50"
                >
                  {busy === meta.id ? "হচ্ছে..." : view.enabled ? "বন্ধ করুন" : "চালু করুন"}
                </button>
              ) : null}
            </div>
          );
        })}
      </div>

      {wallet ? (
        <div className="grid gap-3 sm:grid-cols-3">
          <div className="rounded-xl bg-slate-50 p-3">
            <div className="text-[11px] font-semibold uppercase tracking-wide text-slate-400">মোট ব্যালেন্স</div>
            <div className="mt-1 text-lg font-bold text-slate-800">{formatTakaMinor(wallet.balanceMinor)}</div>
          </div>
          <div className="rounded-xl bg-slate-50 p-3">
            <div className="text-[11px] font-semibold uppercase tracking-wide text-slate-400">আটকে আছে (Payout অনুরোধে)</div>
            <div className="mt-1 text-lg font-bold text-slate-800">{formatTakaMinor(wallet.heldMinor)}</div>
          </div>
          <div className="rounded-xl bg-slate-50 p-3">
            <div className="text-[11px] font-semibold uppercase tracking-wide text-slate-400">উপলব্ধ</div>
            <div className="mt-1 text-lg font-bold text-emerald-700">{formatTakaMinor(wallet.availableMinor)}</div>
          </div>
        </div>
      ) : null}

      {wallet && wallet.ledger.length > 0 ? (
        <div className="space-y-1">
          <div className="text-sm font-semibold text-slate-700">সাম্প্রতিক Wallet লেনদেন</div>
          {wallet.ledger.slice(0, 10).map((row) => (
            <div key={row.id} className="flex flex-wrap items-center justify-between gap-2 rounded-lg bg-slate-50 px-3 py-2 text-xs">
              <span className="font-medium text-slate-700">{ledgerTypeLabel(row.type)}{row.note ? <span className="block font-normal text-slate-400">{row.note}</span> : null}</span>
              <span className="text-slate-400">{formatWhen(row.createdAt) ?? ""}</span>
              <span className={`font-semibold ${row.amountMinor.startsWith("-") ? "text-red-600" : "text-emerald-700"}`}>
                {formatTakaMinor(row.amountMinor)}
              </span>
              <span className="text-slate-500">ব্যালেন্স: {formatTakaMinor(row.balanceAfterMinor)}</span>
            </div>
          ))}
        </div>
      ) : null}

      {wallet ? (
        <div className="space-y-2 rounded-xl border border-slate-200 p-3">
          <div className="text-sm font-semibold text-slate-700">📄 Wallet স্টেটমেন্ট (Ledger থেকে)</div>
          <div className="flex flex-wrap items-end gap-2">
            <label className="block text-xs text-slate-500">শুরু (থেকে)
              <input type="date" className={inputCls} value={stmtFrom} onChange={(e) => setStmtFrom(e.target.value)} />
            </label>
            <label className="block text-xs text-slate-500">শেষ (পর্যন্ত)
              <input type="date" className={inputCls} value={stmtTo} onChange={(e) => setStmtTo(e.target.value)} />
            </label>
            <button type="button" disabled={busy === "statement-csv"} onClick={() => void downloadStatement("csv")} className="rounded-lg bg-indigo-600 px-3 py-2 text-xs font-semibold text-white hover:bg-indigo-700 disabled:opacity-50">
              {busy === "statement-csv" ? "তৈরি হচ্ছে…" : "CSV ডাউনলোড"}
            </button>
            <button type="button" disabled={busy === "statement-pdf"} onClick={() => void downloadStatement("pdf")} className="rounded-lg bg-slate-100 px-3 py-2 text-xs font-semibold text-slate-700 hover:bg-slate-200 disabled:opacity-50">
              {busy === "statement-pdf" ? "তৈরি হচ্ছে…" : "PDF ডাউনলোড"}
            </button>
          </div>
          <p className="text-[11px] leading-relaxed text-slate-400">
            তারিখ খালি রাখলে পুরো ইতিহাস আসবে। Opening ব্যালেন্স হিসাব হয় পরিসরের আগের শেষ ledger এন্ট্রি থেকে — কোনো অনুমান নয়।
            PDF-তে শুধু তারিখ/ধরন/পরিমাণ থাকে (পূর্ণ নোট CSV-তে) — এটি ফাইলের গায়েই লেখা থাকে।
          </p>
        </div>
      ) : null}

      <form onSubmit={(e) => void submitPayout(e)} className="space-y-2 rounded-xl border border-slate-200 p-3">
        <div className="text-sm font-semibold text-slate-700">💸 Payout অনুরোধ</div>
        <div className="grid gap-2 sm:grid-cols-2">
          <label className="block text-sm">পরিমাণ (টাকা)
            <input className={inputCls} inputMode="decimal" value={form.amountTaka} onChange={(e) => setForm({ ...form, amountTaka: e.target.value })} required placeholder="যেমন: 5000" />
          </label>
          <label className="block text-sm">মাধ্যম
            <select className={inputCls} value={form.method} onChange={(e) => setForm({ ...form, method: e.target.value as PayoutForm["method"] })}>
              <option value="bkash">বিকাশ (bKash)</option>
              <option value="bank">ব্যাংক অ্যাকাউন্ট</option>
            </select>
          </label>
        </div>
        {form.method === "bkash" ? (
          <label className="block text-sm">বিকাশ নম্বর
            <input className={inputCls} value={form.bkashNumber} onChange={(e) => setForm({ ...form, bkashNumber: e.target.value })} required placeholder="01XXXXXXXXX" />
          </label>
        ) : (
          <div className="grid gap-2 sm:grid-cols-2">
            <label className="block text-sm">অ্যাকাউন্টের নাম
              <input className={inputCls} value={form.accountName} onChange={(e) => setForm({ ...form, accountName: e.target.value })} required />
            </label>
            <label className="block text-sm">অ্যাকাউন্ট নম্বর
              <input className={inputCls} value={form.accountNumber} onChange={(e) => setForm({ ...form, accountNumber: e.target.value })} required />
            </label>
            <label className="block text-sm">ব্যাংকের নাম
              <input className={inputCls} value={form.bankName} onChange={(e) => setForm({ ...form, bankName: e.target.value })} required />
            </label>
            <label className="block text-sm">শাখা (ঐচ্ছিক)
              <input className={inputCls} value={form.branch} onChange={(e) => setForm({ ...form, branch: e.target.value })} />
            </label>
          </div>
        )}
        <label className="block max-w-sm text-sm">🔐 TOTP কোড (শুধু আপনার Two-Factor চালু থাকলেই লাগবে)
          <input className={inputCls} value={totpCode} onChange={(e) => setTotpCode(e.target.value)} inputMode="numeric" autoComplete="one-time-code" placeholder="৬-সংখ্যার কোড" />
        </label>
        <button type="submit" disabled={busy === "payout"} className="rounded-lg bg-indigo-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-indigo-700 disabled:opacity-50">
          {busy === "payout" ? "পাঠানো হচ্ছে..." : "অনুরোধ পাঠান"}
        </button>
        <p className="text-[11px] leading-relaxed text-slate-400">অনুরোধ পাঠালেই টাকা কাটা হয় না — পরিমাণটি hold থাকে। অ্যাডমিন অনুমোদন দিয়ে আসল টাকা পাঠিয়ে mark-paid করলে তবেই ব্যালেন্স থেকে কাটা হয়।</p>
      </form>

      {requests.length > 0 ? (
        <div className="space-y-1">
          <div className="text-sm font-semibold text-slate-700">আপনার Payout অনুরোধসমূহ</div>
          {requests.map((r) => (
            <div key={r.id} className="flex flex-wrap items-center justify-between gap-2 rounded-lg bg-slate-50 px-3 py-2 text-xs">
              <span className="font-medium text-slate-700">
                {formatTakaMinor(r.amountMinor)} · {r.method === "bkash" ? "বিকাশ" : "ব্যাংক"}
                <span className="block font-normal text-slate-400">{formatWhen(r.createdAt) ?? ""}{r.payoutRef ? ` · Ref: ${r.payoutRef}` : ""}{r.adminNote ? ` · অ্যাডমিন নোট: ${r.adminNote}` : ""}</span>
              </span>
              <span className="rounded-full bg-slate-200 px-2 py-0.5 text-[11px] font-semibold text-slate-600">{payoutStatusLabel(r.status)}</span>
              {r.status === "pending" ? (
                <button type="button" disabled={busy === r.id} onClick={() => void cancel(r.id)} className="rounded-lg bg-red-50 px-2 py-1 text-[11px] font-semibold text-red-600 hover:bg-red-100 disabled:opacity-50">বাতিল করুন</button>
              ) : null}
            </div>
          ))}
        </div>
      ) : null}
    </div>
  );
}
