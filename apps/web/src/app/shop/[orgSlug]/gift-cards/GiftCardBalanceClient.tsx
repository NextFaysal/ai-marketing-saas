"use client";
import React, { useState } from "react";
import Link from "next/link";
import { formatMinor } from "@repo/contracts";
import { API_URL } from "@/lib/api";
import { fmtDate } from "@repo/contracts";
import { shopT, type ShopLocale } from "@/lib/shop-i18n";

// AB2 (AX3) — public gift-card balance check. The code + the
// shop are the whole credential: the API answers an unknown
// code and another shop's code with the SAME generic Bengali
// error, shown here verbatim. Nothing but balance / status /
// expiry ever comes back — no recipient or issuance data.

interface BalanceResult {
  balanceMinor: string;
  status: string;
  expiresAt: string | null;
}

function statusLabels(locale: ShopLocale | string | undefined): Record<string, string> {
  const w = shopT(locale).shopWidgets;
  return {
    active: w.gcStatusActive,
    depleted: w.gcStatusDepleted,
    expired: w.gcStatusExpired,
    void: w.gcStatusVoid,
  };
}

function money(minor: string): string {
  try {
    return formatMinor(BigInt(minor));
  } catch {
    return minor;
  }
}

export function GiftCardBalanceClient({ orgSlug, locale = "bn" }: { orgSlug: string; locale?: ShopLocale | string }) {
  const t = shopT(locale);
  const STATUS_LABELS = statusLabels(locale);
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [result, setResult] = useState<BalanceResult | null>(null);

  async function check(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError("");
    setResult(null);
    try {
      const res = await fetch(`${API_URL}/public/shop/${encodeURIComponent(orgSlug)}/gift-cards/balance`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ code: code.trim() }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        // The API's generic error, verbatim.
        throw new Error((body as { message?: string }).message ?? t.shopWidgets.gcInvalid);
      }
      setResult((await res.json()) as BalanceResult);
    } catch (err) {
      setError(err instanceof Error ? err.message : t.shopWidgets.gcLoadFailed);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="mx-auto max-w-md px-4 py-12">
      <div className="space-y-4 rounded-3xl border border-slate-200 bg-white p-6 shadow-sm">
        <h1 className="text-xl font-black text-slate-900">{t.shopWidgets.gcBalanceTitle}</h1>
        <p className="text-xs leading-relaxed text-slate-500">
          {t.shopWidgets.gcBalanceBody}
        </p>
        <form onSubmit={check} className="space-y-3">
          <div>
            <label className="mb-1 block text-xs font-bold text-slate-700" htmlFor="gift-card-code">{t.shopWidgets.gcCodeLabel}</label>
            <input
              id="gift-card-code"
              required
              value={code}
              onChange={(e) => setCode(e.target.value)}
              placeholder="QG-XXXX-XXXX-XXXX"
              className="w-full rounded-xl border border-slate-300 p-2.5 font-mono text-sm font-bold uppercase tracking-wider focus:border-pink-500 focus:outline-none"
            />
          </div>
          {error ? <p className="rounded-lg bg-rose-50 px-3 py-2 text-sm font-medium text-rose-700">{error}</p> : null}
          <button
            type="submit"
            disabled={busy || !code.trim()}
            className="w-full rounded-2xl bg-pink-600 py-3 text-sm font-extrabold text-white shadow hover:bg-pink-700 disabled:opacity-50"
          >
            {busy ? t.shopWidgets.gcChecking : t.shopWidgets.gcCheck}
          </button>
        </form>
        {result ? (
          <div className="space-y-2 rounded-2xl border border-pink-100 bg-pink-50/60 p-4 text-sm">
            <div className="flex justify-between">
              <span className="font-semibold text-slate-600">{t.shopWidgets.gcBalance}</span>
              <span className="text-lg font-black text-pink-700">{money(result.balanceMinor)}</span>
            </div>
            <div className="flex justify-between">
              <span className="font-semibold text-slate-600">{t.shopWidgets.gcStatus}</span>
              <span className="font-bold text-slate-900">{STATUS_LABELS[result.status] ?? result.status}</span>
            </div>
            {result.expiresAt ? (
              <div className="flex justify-between">
                <span className="font-semibold text-slate-600">{t.shopWidgets.gcExpiry}</span>
                <span className="font-bold text-slate-900">{fmtDate(locale === "en" ? "en" : "bn", result.expiresAt)}</span>
              </div>
            ) : null}
          </div>
        ) : null}
        <p className="text-center">
          <Link href={`/shop/${orgSlug}`} className="text-xs font-bold text-indigo-700 hover:underline">{t.shopWidgets.gcBackToShop}</Link>
        </p>
      </div>
    </div>
  );
}
