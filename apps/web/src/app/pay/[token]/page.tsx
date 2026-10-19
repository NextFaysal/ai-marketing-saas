"use client";
import React, { useEffect, useState } from "react";
import { useParams } from "next/navigation";
import { API_URL } from "@/lib/api";
import { formatTakaMinor, type PublicPaymentLinkView } from "@/lib/connections";
import { fmtDateTime } from "@repo/contracts";
import { pubT } from "@/lib/i18n/public";

const t = pubT();

/**
 * CC26(b) — public payment-link page (no login).
 *
 * The buyer sees only the shop name, the order number and the
 * amount due — the API never exposes internal ids or secrets
 * on this route. Pressing Pay asks the API to start the
 * payment through the shop's normal gateway flow; the buyer is
 * then sent to the gateway's own page. The order counts as
 * paid ONLY after the gateway's server-side verification —
 * this page says so plainly and never claims success itself.
 */
export default function PaymentLinkPage() {
  const params = useParams();
  const token = String(params.token ?? "");
  const [link, setLink] = useState<PublicPaymentLinkView | null>(null);
  const [notFound, setNotFound] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    (async () => {
      try {
        const res = await fetch(`${API_URL}/public/payment-links/${encodeURIComponent(token)}`);
        if (!res.ok) { setNotFound(true); return; }
        setLink((await res.json()) as PublicPaymentLinkView);
      } catch {
        setError(t.pay.loadFailed);
      }
    })();
  }, [token]);

  async function pay() {
    setBusy(true); setError("");
    try {
      const res = await fetch(`${API_URL}/public/payment-links/${encodeURIComponent(token)}/initiate`, { method: "POST" });
      const body = (await res.json().catch(() => ({}))) as { redirectUrl?: string; message?: string };
      if (!res.ok) throw new Error(body.message ?? t.pay.startFailed);
      if (body.redirectUrl) {
        window.location.href = body.redirectUrl;
        return;
      }
      throw new Error(t.pay.gatewayMissing);
    } catch (e) {
      setError(e instanceof Error ? e.message : t.pay.startFailed);
      setBusy(false);
    }
  }

  const providerName = link?.provider === "bkash" ? t.pay.bkash : t.pay.sslcommerz;

  return (
    <main className="mx-auto flex min-h-screen w-full max-w-md flex-col items-center justify-center px-4 py-10">
      <div className="w-full rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
        <h1 className="text-lg font-bold text-slate-900">{t.pay.title}</h1>

        {error ? <div className="mt-4 rounded-xl bg-red-50 px-4 py-3 text-sm font-medium text-red-600">{error}</div> : null}

        {notFound ? (
          <p className="mt-4 text-sm leading-relaxed text-slate-600">
            {t.pay.notFound}
          </p>
        ) : !link && !error ? (
          <p className="mt-4 text-sm text-slate-400">{t.pay.loading}</p>
        ) : link ? (
          <>
            <div className="mt-4 space-y-2 text-sm">
              <div className="flex justify-between"><span className="text-slate-500">{t.pay.shopLabel}</span><span className="font-semibold text-slate-800">{link.shopName}</span></div>
              {link.orderNumber ? (
                <div className="flex justify-between"><span className="text-slate-500">{t.pay.orderNumberLabel}</span><span className="font-semibold text-slate-800">{link.orderNumber}</span></div>
              ) : null}
              {link.amountDueMinor != null ? (
                <div className="flex justify-between"><span className="text-slate-500">{t.pay.amountDueLabel}</span><span className="text-base font-bold text-slate-900">{formatTakaMinor(link.amountDueMinor)}</span></div>
              ) : null}
              <div className="flex justify-between"><span className="text-slate-500">{t.pay.methodLabel}</span><span className="font-medium text-slate-700">{providerName}</span></div>
              {link.status === "active" ? (
                <div className="flex justify-between"><span className="text-slate-500">{t.pay.expiryLabel}</span><span className="text-slate-600">{fmtDateTime("bn", link.expiresAt)}</span></div>
              ) : null}
            </div>

            {link.status === "active" ? (
              <>
                <button
                  type="button" disabled={busy} onClick={() => void pay()}
                  className="mt-6 w-full rounded-xl bg-indigo-600 px-4 py-3 text-sm font-bold text-white hover:bg-indigo-700 disabled:opacity-50"
                >
                  {busy ? t.pay.redirecting : `${providerName}${t.pay.payWithSuffix}`}
                </button>
                <p className="mt-3 text-xs leading-relaxed text-slate-400">
                  {t.pay.note}
                </p>
              </>
            ) : link.status === "used" ? (
              <div className="mt-6 rounded-xl bg-green-50 px-4 py-3 text-sm font-medium text-green-700">
                {t.pay.alreadyPaid}
              </div>
            ) : link.status === "expired" ? (
              <div className="mt-6 rounded-xl bg-amber-50 px-4 py-3 text-sm font-medium text-amber-700">
                {t.pay.expired}
              </div>
            ) : (
              <div className="mt-6 rounded-xl bg-red-50 px-4 py-3 text-sm font-medium text-red-600">
                {t.pay.cancelled}

              </div>
            )}
          </>
        ) : null}
      </div>
    </main>
  );
}
