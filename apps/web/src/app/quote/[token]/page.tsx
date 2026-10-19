"use client";
import React, { useCallback, useEffect, useState } from "react";
import { useParams } from "next/navigation";
import { API_URL } from "@/lib/api";
import { formatMinorTaka } from "@/lib/storefront-money";
import { fmtDate, fmtDateTime, fmtNumber } from "@repo/contracts";
import { pubT } from "@/lib/i18n/public";

const t = pubT();

// AB5 (AX7) — public quote page. Reached ONLY via the
// unguessable token in the staff-sent link (the API stores its
// SHA-256 hash). No dashboard chrome, no login: the shop's own
// branding + the offer + (while status is "sent") the
// accept/decline answer. An unknown token gets the same generic
// not-found as every other state — nothing about other quotes
// is ever revealed here.

interface PublicQuote {
  shop: { name: string | null; brandName: string | null; logoUrl: string | null };
  number: string;
  status: string;
  lines: { name: string; variantName: string | null; sku: string | null; qty: number; unitPriceMinor: string; lineTotalMinor: string }[];
  deliveryChargeMinor: string;
  totalMinor: string;
  expiresAt: string | null;
  note: string | null;
  respondedAt: string | null;
}

const STATUS_TEXT: Record<string, { title: string; body: string }> = {
  accepted: { title: t.quotePublic.acceptedTitle, body: t.quotePublic.acceptedBody },
  declined: { title: t.quotePublic.declinedTitle, body: t.quotePublic.declinedBody },
  expired: { title: t.quotePublic.expiredTitle, body: t.quotePublic.expiredBody },
  converted: { title: t.quotePublic.convertedTitle, body: t.quotePublic.convertedBody },
  cancelled: { title: t.quotePublic.cancelledTitle, body: t.quotePublic.cancelledBody },
  draft: { title: t.quotePublic.draftTitle, body: t.quotePublic.draftBody },
};

export default function PublicQuotePage() {
  const params = useParams();
  const token = String(params.token ?? "");
  const [quote, setQuote] = useState<PublicQuote | null>(null);
  const [state, setState] = useState<"loading" | "ready" | "notfound">("loading");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const load = useCallback(async () => {
    try {
      const res = await fetch(`${API_URL}/public/quote/${encodeURIComponent(token)}`);
      if (!res.ok) { setState("notfound"); return; }
      setQuote((await res.json()) as PublicQuote);
      setState("ready");
    } catch { setState("notfound"); }
  }, [token]);
  useEffect(() => { load(); }, [load]);

  async function respond(accept: boolean) {
    if (!window.confirm(accept ? t.quotePublic.confirmAccept : t.quotePublic.confirmDecline)) return;
    setBusy(true); setError("");
    try {
      const res = await fetch(`${API_URL}/public/quote/${encodeURIComponent(token)}/respond`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ accept }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error((body as { message?: string }).message ?? t.quotePublic.respondFailed);
      setQuote(body as PublicQuote);
    } catch (e) { setError(e instanceof Error ? e.message : t.quotePublic.respondFailed); }
    finally { setBusy(false); }
  }

  if (state === "loading") {
    return (
      <main className="mx-auto max-w-2xl px-4 py-16 text-center">
        <div className="mx-auto h-10 w-10 animate-spin rounded-full border-4 border-indigo-600 border-t-transparent" />
        <p className="mt-3 text-sm font-semibold text-slate-600">{t.quotePublic.loading}</p>
      </main>
    );
  }

  if (state === "notfound" || !quote) {
    return (
      <main className="mx-auto max-w-2xl px-4 py-16">
        <div className="rounded-3xl border border-dashed border-slate-300 bg-white p-10 text-center">
          <p className="text-4xl">🔎</p>
          <h1 className="mt-3 text-xl font-black text-slate-900">{t.quotePublic.notFoundTitle}</h1>
          <p className="mt-1 text-sm text-slate-500">{t.quotePublic.notFoundText}</p>
        </div>
      </main>
    );
  }

  const shopName = quote.shop.brandName || quote.shop.name || t.quotePublic.shopFallback;
  const statusInfo = STATUS_TEXT[quote.status];

  return (
    <div className="min-h-screen bg-slate-50">
      <header className="border-b border-slate-200 bg-white">
        <div className="mx-auto flex max-w-2xl items-center gap-3 px-4 py-4">
          {quote.shop.logoUrl ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={quote.shop.logoUrl} alt={shopName} className="h-11 w-11 rounded-2xl border border-slate-200 object-cover" />
          ) : (
            <span className="flex h-11 w-11 items-center justify-center rounded-2xl bg-indigo-600 text-lg font-black text-white">
              {shopName.slice(0, 1) || "🧾"}
            </span>
          )}
          <div>
            <p className="text-base font-black text-slate-900">{shopName}</p>
            <p className="text-xs font-semibold text-indigo-700">{t.quotePublic.quoteLabel}</p>
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-2xl space-y-5 px-4 py-8">
        <section className="space-y-3 rounded-3xl border border-slate-200 bg-white p-6 shadow-sm">
          <div className="flex flex-wrap items-baseline justify-between gap-2">
            <h1 className="text-lg font-black text-slate-900">{t.quotePublic.quoteNumberPrefix}{quote.number}</h1>
            {quote.expiresAt ? (
              <span className="text-xs text-slate-500">{t.quotePublic.expiryPrefix}{fmtDate("bn", quote.expiresAt)}</span>
            ) : null}
          </div>

          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead>
                <tr className="border-b text-xs text-slate-500">
                  <th className="py-2 pr-2 font-semibold">{t.quotePublic.productHeader}</th>
                  <th className="py-2 pr-2 font-semibold">{t.quotePublic.qtyHeader}</th>
                  <th className="py-2 pr-2 font-semibold">{t.quotePublic.unitPriceHeader}</th>
                  <th className="py-2 font-semibold">{t.quotePublic.totalHeader}</th>
                </tr>
              </thead>
              <tbody>
                {quote.lines.map((l, i) => (
                  <tr key={i} className="border-b last:border-0">
                    <td className="py-2 pr-2 font-medium text-slate-800">
                      {l.name}{l.variantName ? ` — ${l.variantName}` : ""}
                      {l.sku ? <span className="block text-xs text-slate-400">SKU: {l.sku}</span> : null}
                    </td>
                    <td className="py-2 pr-2">{fmtNumber("bn", l.qty)}</td>
                    <td className="py-2 pr-2">{formatMinorTaka(l.unitPriceMinor)}</td>
                    <td className="py-2 font-semibold">{formatMinorTaka(l.lineTotalMinor)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <div className="space-y-1 border-t pt-3 text-sm">
            <div className="flex justify-between"><span className="text-slate-500">{t.quotePublic.deliveryCharge}</span><span>{formatMinorTaka(quote.deliveryChargeMinor)}</span></div>
            <div className="flex justify-between text-base font-black text-slate-900"><span>{t.quotePublic.grandTotal}</span><span>{formatMinorTaka(quote.totalMinor)}</span></div>
          </div>

          {quote.note ? (
            <p className="rounded-xl bg-slate-50 px-3 py-2 text-sm text-slate-600">📝 {quote.note}</p>
          ) : null}
        </section>

        {error ? <p className="rounded-lg bg-rose-50 px-3 py-2 text-sm font-medium text-rose-700">{error}</p> : null}

        {quote.status === "sent" ? (
          <section className="space-y-3 rounded-3xl border border-slate-200 bg-white p-6 shadow-sm">
            <h2 className="text-sm font-bold text-slate-900">{t.quotePublic.decisionTitle}</h2>
            <p className="text-sm text-slate-500">{t.quotePublic.decisionText}</p>
            <div className="flex flex-wrap gap-3">
              <button type="button" disabled={busy} onClick={() => respond(true)}
                className="flex-1 rounded-2xl bg-emerald-600 py-3 text-sm font-extrabold text-white shadow hover:bg-emerald-700 disabled:opacity-50">
                {busy ? t.quotePublic.pleaseWait : t.quotePublic.accept}
              </button>
              <button type="button" disabled={busy} onClick={() => respond(false)}
                className="flex-1 rounded-2xl border border-rose-200 bg-rose-50 py-3 text-sm font-extrabold text-rose-700 hover:bg-rose-100 disabled:opacity-50">
                {busy ? t.quotePublic.pleaseWait : t.quotePublic.decline}
              </button>
            </div>
          </section>
        ) : statusInfo ? (
          <section className="rounded-3xl border border-slate-200 bg-white p-6 text-center shadow-sm">
            <h2 className="text-lg font-black text-slate-900">{statusInfo.title}</h2>
            <p className="mt-1 text-sm text-slate-500">{statusInfo.body}</p>
            {quote.respondedAt ? (
              <p className="mt-2 text-xs text-slate-400">{t.quotePublic.respondedPrefix}{fmtDateTime("bn", quote.respondedAt)}</p>

            ) : null}
          </section>
        ) : null}
      </main>
    </div>
  );
}
