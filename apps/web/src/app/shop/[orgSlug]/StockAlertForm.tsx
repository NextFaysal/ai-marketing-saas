"use client";
import React, { useState } from "react";
import { API_URL } from "@/lib/api";
import { getShopSession } from "@/lib/storefront-account";
import { shopT, type ShopLocale } from "@/lib/shop-i18n";

/**
 * EC28 — back-in-stock alert form, shown only when the selected
 * product/variant is out of stock. The API re-validates the stock
 * state server-side (subscribing while in stock is a 400, shown
 * verbatim). When the shopper is logged in, the session token
 * rides along so the subscription links to their account.
 */
export function StockAlertForm({
  orgSlug,
  productId,
  variantSku,
  locale = "bn",
}: {
  orgSlug: string;
  productId: string;
  variantSku?: string | null;
  locale?: ShopLocale | string;
}) {
  const t = shopT(locale);
  const [phone, setPhone] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [done, setDone] = useState<"saved" | "existing" | null>(null);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError("");
    try {
      const session = getShopSession(orgSlug);
      const res = await fetch(`${API_URL}/public/shop/${encodeURIComponent(orgSlug)}/stock-alerts`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...(session ? { "x-shop-session": session } : {}),
        },
        body: JSON.stringify({ productId, variantSku: variantSku ?? undefined, phone: phone.trim() }),
      });
      const data = await res.json().catch(() => null);
      if (!res.ok) throw new Error(data?.message ?? t.product.stockAlertTitle);
      setDone(data?.existing ? "existing" : "saved");
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }

  if (done) {
    return (
      <div className="rounded-xl bg-emerald-50 p-3 text-sm font-semibold text-emerald-800">
        {done === "existing" ? t.product.stockAlertExisting : t.product.stockAlertDone}
      </div>
    );
  }

  return (
    <form onSubmit={submit} className="space-y-2 rounded-xl border border-dashed border-indigo-300 bg-indigo-50/40 p-3.5">
      <p className="text-sm font-bold text-slate-800">{t.product.stockAlertTitle}</p>
      <p className="text-xs text-slate-500">{t.product.stockAlertText}</p>
      <div className="flex gap-2">
        <input
          value={phone}
          onChange={(e) => setPhone(e.target.value)}
          placeholder={t.product.stockAlertPhonePlaceholder}
          required
          minLength={6}
          maxLength={30}
          inputMode="tel"
          className="w-full rounded-xl border border-slate-300 px-3 py-2 text-sm focus:border-indigo-600 focus:outline-none"
        />
        <button
          type="submit"
          disabled={busy}
          className="shrink-0 rounded-xl bg-indigo-600 px-4 py-2 text-sm font-bold text-white disabled:opacity-50"
        >
          {busy ? t.product.stockAlertSubmitting : t.product.stockAlertSubmit}
        </button>
      </div>
      {error ? <p className="rounded-lg bg-rose-50 px-3 py-2 text-xs font-medium text-rose-700">{error}</p> : null}
    </form>
  );
}
