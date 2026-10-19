"use client";
import React, { useCallback, useEffect, useState } from "react";
import { apiFetch, API_URL, getToken } from "@/lib/api";
import { getOrganizationId } from "@/lib/org";
import { buildPayoutBody, type PayoutForm } from "@/lib/connect-forms";
import {
  formatTakaMinor, formatWhen, ledgerTypeLabel, payoutStatusLabel,
  type PayoutRequestView, type PlatformPaymentsView, type WalletView,
} from "@/lib/connections";
import { useLocale } from "@/lib/i18n/provider";
import { fmtNumber } from "@repo/contracts";

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

const PROVIDER_META: { id: string; icon: string; titleKey: string }[] = [
  { id: "sslcommerz", icon: "💳", titleKey: "pwTtlSsl" },
  { id: "bkash", icon: "📱", titleKey: "pwTtlBkash" },
];

const inputCls = "mt-1 w-full rounded-lg border border-slate-200 px-3 py-2 text-sm outline-none focus:border-indigo-400";

const EMPTY_PAYOUT: PayoutForm = {
  amountTaka: "", method: "bkash", bkashNumber: "",
  accountName: "", accountNumber: "", bankName: "", branch: "",
};

export function PlatformWalletPanel({ onChanged }: { onChanged?: () => void }) {
  const { dict, t, locale } = useLocale();
  const D = dict.connections;
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
      setNotice(enabled ? D.pwToggleOn : D.pwToggleOff);
      await load(); onChanged?.();
    } catch (e) {
      setError(e instanceof Error ? e.message : D.gwActionFailed);
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
      const base = D.pwPayoutBase;
      setNotice(res?.stepUpUnavailable ? `${base}${D.pwStepUpSuffix}` : base);
      setForm(EMPTY_PAYOUT);
      setTotpCode("");
      await load(); onChanged?.();
    } catch (err) {
      setError(err instanceof Error ? err.message : D.pwPayoutFailed);
    } finally { setBusy(""); }
  }, [form, load, onChanged, totpCode]);

  const cancel = useCallback(async (id: string) => {
    const orgId = getOrganizationId();
    if (!orgId) return;
    setBusy(id); setError("");
    try {
      await apiFetch(`organizations/${orgId}/connections/payout-requests/${id}/cancel`, { method: "POST", body: "{}" });
      setNotice(D.pwCancelled);
      await load(); onChanged?.();
    } catch (err) {
      setError(err instanceof Error ? err.message : D.pwCancelFailed);
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
      setError(e instanceof Error ? e.message : D.pwStmtFailed);
    } finally { setBusy(""); }
  }, [stmtFrom, stmtTo]);

  const feePercent = platform ? platform.feePercent : null;

  return (
    <div className="card space-y-4 p-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="font-semibold text-slate-800">{D.pwTitle}</div>
        {wallet ? (
          <span className="rounded-full bg-indigo-100 px-2 py-0.5 text-[11px] font-semibold text-indigo-700">
            {t("connections.pwBalanceChip", { amount: formatTakaMinor(wallet.balanceMinor, locale) })}
          </span>
        ) : null}
      </div>
      {error ? <div className="rounded-xl bg-red-50 px-4 py-3 text-sm font-medium text-red-600">{error}</div> : null}
      {notice ? <div className="rounded-xl bg-green-50 px-4 py-3 text-sm font-medium text-green-700">{notice}</div> : null}

      <p className="text-xs leading-relaxed text-slate-500">
        {D.pwIntro}
        {feePercent !== null ? <>{t("connections.pwFeePart", { fee: fmtNumber(locale, feePercent) })}</> : null}
      </p>

      <div className="grid gap-3 sm:grid-cols-2">
        {PROVIDER_META.map((meta) => {
          const view = platform?.providers.find((p) => p.provider === meta.id) ?? null;
          return (
            <div key={meta.id} className="space-y-2 rounded-xl border border-slate-200 p-3">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div className="text-sm font-semibold text-slate-800">{meta.icon} {D[meta.titleKey as keyof typeof D]}</div>
                {!view || !view.offered ? (
                  <span className="rounded-full bg-slate-100 px-2 py-0.5 text-[11px] font-semibold text-slate-500">{D.pwNotConfigured}</span>
                ) : view.enabled ? (
                  <span className="rounded-full bg-green-100 px-2 py-0.5 text-[11px] font-semibold text-green-700">{D.pwOn}</span>
                ) : (
                  <span className="rounded-full bg-amber-100 px-2 py-0.5 text-[11px] font-semibold text-amber-700">{D.gwOff}</span>
                )}
              </div>
              <p className="text-xs leading-relaxed text-slate-500">
                {!view || !view.offered ? D.pwNotOfferedNote : D.pwOfferedNote}
              </p>
              {view?.offered ? (
                <button
                  type="button"
                  disabled={busy === meta.id}
                  onClick={() => void toggle(meta.id, !view.enabled)}
                  className="rounded-lg bg-indigo-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-indigo-700 disabled:opacity-50"
                >
                  {busy === meta.id ? D.pwWorking : view.enabled ? dict.common.close : D.gwEnable}
                </button>
              ) : null}
            </div>
          );
        })}
      </div>

      {wallet ? (
        <div className="grid gap-3 sm:grid-cols-3">
          <div className="rounded-xl bg-slate-50 p-3">
            <div className="text-[11px] font-semibold uppercase tracking-wide text-slate-400">{D.pwTotalBalance}</div>
            <div className="mt-1 text-lg font-bold text-slate-800">{formatTakaMinor(wallet.balanceMinor, locale)}</div>
          </div>
          <div className="rounded-xl bg-slate-50 p-3">
            <div className="text-[11px] font-semibold uppercase tracking-wide text-slate-400">{D.pwHeld}</div>
            <div className="mt-1 text-lg font-bold text-slate-800">{formatTakaMinor(wallet.heldMinor, locale)}</div>
          </div>
          <div className="rounded-xl bg-slate-50 p-3">
            <div className="text-[11px] font-semibold uppercase tracking-wide text-slate-400">{D.pwAvailable}</div>
            <div className="mt-1 text-lg font-bold text-emerald-700">{formatTakaMinor(wallet.availableMinor, locale)}</div>
          </div>
        </div>
      ) : null}

      {wallet && wallet.ledger.length > 0 ? (
        <div className="space-y-1">
          <div className="text-sm font-semibold text-slate-700">{D.pwRecentTitle}</div>
          {wallet.ledger.slice(0, 10).map((row) => (
            <div key={row.id} className="flex flex-wrap items-center justify-between gap-2 rounded-lg bg-slate-50 px-3 py-2 text-xs">
              <span className="font-medium text-slate-700">{ledgerTypeLabel(row.type, locale)}{row.note ? <span className="block font-normal text-slate-400">{row.note}</span> : null}</span>
              <span className="text-slate-400">{formatWhen(row.createdAt, locale) ?? ""}</span>
              <span className={`font-semibold ${row.amountMinor.startsWith("-") ? "text-red-600" : "text-emerald-700"}`}>
                {formatTakaMinor(row.amountMinor, locale)}
              </span>
              <span className="text-slate-500">{D.pwBalanceLabel}{formatTakaMinor(row.balanceAfterMinor, locale)}</span>
            </div>
          ))}
        </div>
      ) : null}

      {wallet ? (
        <div className="space-y-2 rounded-xl border border-slate-200 p-3">
          <div className="text-sm font-semibold text-slate-700">{D.pwStmtTitle}</div>
          <div className="flex flex-wrap items-end gap-2">
            <label className="block text-xs text-slate-500">{D.pwFrom}
              <input type="date" className={inputCls} value={stmtFrom} onChange={(e) => setStmtFrom(e.target.value)} />
            </label>
            <label className="block text-xs text-slate-500">{D.pwTo}
              <input type="date" className={inputCls} value={stmtTo} onChange={(e) => setStmtTo(e.target.value)} />
            </label>
            <button type="button" disabled={busy === "statement-csv"} onClick={() => void downloadStatement("csv")} className="rounded-lg bg-indigo-600 px-3 py-2 text-xs font-semibold text-white hover:bg-indigo-700 disabled:opacity-50">
              {busy === "statement-csv" ? D.pwBuilding : D.pwCsvDl}
            </button>
            <button type="button" disabled={busy === "statement-pdf"} onClick={() => void downloadStatement("pdf")} className="rounded-lg bg-slate-100 px-3 py-2 text-xs font-semibold text-slate-700 hover:bg-slate-200 disabled:opacity-50">
              {busy === "statement-pdf" ? D.pwBuilding : D.pwPdfDl}
            </button>
          </div>
          <p className="text-[11px] leading-relaxed text-slate-400">{D.pwStmtNote}</p>
        </div>
      ) : null}

      <form onSubmit={(e) => void submitPayout(e)} className="space-y-2 rounded-xl border border-slate-200 p-3">
        <div className="text-sm font-semibold text-slate-700">{D.pwPayoutTitle}</div>
        <div className="grid gap-2 sm:grid-cols-2">
          <label className="block text-sm">{D.pwAmount}
            <input className={inputCls} inputMode="decimal" value={form.amountTaka} onChange={(e) => setForm({ ...form, amountTaka: e.target.value })} required placeholder={D.pwEg5000} />
          </label>
          <label className="block text-sm">{D.pwMethod}
            <select className={inputCls} value={form.method} onChange={(e) => setForm({ ...form, method: e.target.value as PayoutForm["method"] })}>
              <option value="bkash">{D.pwMethodBkash}</option>
              <option value="bank">{D.pwMethodBank}</option>
            </select>
          </label>
        </div>
        {form.method === "bkash" ? (
          <label className="block text-sm">{D.poBkashNumber}
            <input className={inputCls} value={form.bkashNumber} onChange={(e) => setForm({ ...form, bkashNumber: e.target.value })} required placeholder="01XXXXXXXXX" />
          </label>
        ) : (
          <div className="grid gap-2 sm:grid-cols-2">
            <label className="block text-sm">{D.pwAcctName}
              <input className={inputCls} value={form.accountName} onChange={(e) => setForm({ ...form, accountName: e.target.value })} required />
            </label>
            <label className="block text-sm">{D.pwAcctNumber}
              <input className={inputCls} value={form.accountNumber} onChange={(e) => setForm({ ...form, accountNumber: e.target.value })} required />
            </label>
            <label className="block text-sm">{D.pwBankName}
              <input className={inputCls} value={form.bankName} onChange={(e) => setForm({ ...form, bankName: e.target.value })} required />
            </label>
            <label className="block text-sm">{D.pwBranch}
              <input className={inputCls} value={form.branch} onChange={(e) => setForm({ ...form, branch: e.target.value })} />
            </label>
          </div>
        )}
        <label className="block max-w-sm text-sm">{D.pwTotpLabel}
          <input className={inputCls} value={totpCode} onChange={(e) => setTotpCode(e.target.value)} inputMode="numeric" autoComplete="one-time-code" placeholder={t("connections.gwTotpPh", { n: fmtNumber(locale, 6) })} />
        </label>
        <button type="submit" disabled={busy === "payout"} className="rounded-lg bg-indigo-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-indigo-700 disabled:opacity-50">
          {busy === "payout" ? D.pwSending : D.pwSendReq}
        </button>
        <p className="text-[11px] leading-relaxed text-slate-400">{D.pwPayoutNote}</p>
      </form>

      {requests.length > 0 ? (
        <div className="space-y-1">
          <div className="text-sm font-semibold text-slate-700">{D.pwRequestsTitle}</div>
          {requests.map((r) => (
            <div key={r.id} className="flex flex-wrap items-center justify-between gap-2 rounded-lg bg-slate-50 px-3 py-2 text-xs">
              <span className="font-medium text-slate-700">
                {formatTakaMinor(r.amountMinor, locale)} · {r.method === "bkash" ? D.payBkash : D.poMethodBank}
                <span className="block font-normal text-slate-400">{formatWhen(r.createdAt, locale) ?? ""}{r.payoutRef ? ` · Ref: ${r.payoutRef}` : ""}{r.adminNote ? t("connections.pwAdminNote", { note: r.adminNote }) : ""}</span>
              </span>
              <span className="rounded-full bg-slate-200 px-2 py-0.5 text-[11px] font-semibold text-slate-600">{payoutStatusLabel(r.status, locale)}</span>
              {r.status === "pending" ? (
                <button type="button" disabled={busy === r.id} onClick={() => void cancel(r.id)} className="rounded-lg bg-red-50 px-2 py-1 text-[11px] font-semibold text-red-600 hover:bg-red-100 disabled:opacity-50">{D.pwCancelBtn}</button>
              ) : null}
            </div>
          ))}
        </div>
      ) : null}
    </div>
  );
}
