"use client";
import React, { useCallback, useEffect, useState } from "react";
import { useParams } from "next/navigation";
import { API_URL } from "@/lib/api";
import { formatMinorTaka } from "@/lib/storefront-money";

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
  accepted: { title: "ধন্যবাদ! ✅", body: "আপনি এই কোটটি গ্রহণ করেছেন। বিক্রেতা শীঘ্রই আপনার সঙ্গে যোগাযোগ করবেন।" },
  declined: { title: "উত্তর পাওয়া গেছে", body: "আপনি এই কোটটি প্রত্যাখ্যান করেছেন। মত বদলালে বিক্রেতার সঙ্গে সরাসরি যোগাযোগ করুন।" },
  expired: { title: "মেয়াদ শেষ", body: "এই কোটটির মেয়াদ শেষ হয়ে গেছে। নতুন কোটের জন্য বিক্রেতার সঙ্গে যোগাযোগ করুন।" },
  converted: { title: "অর্ডার তৈরি হয়েছে ✅", body: "এই কোটটি থেকে অর্ডার তৈরি হয়ে গেছে। ধন্যবাদ!" },
  cancelled: { title: "কোটটি বাতিল হয়েছে", body: "বিক্রেতা এই কোটটি বাতিল করেছেন। প্রয়োজনে তাদের সঙ্গে যোগাযোগ করুন।" },
  draft: { title: "কোটটি এখনো পাঠানো হয়নি", body: "এই লিংকটি এখনো সক্রিয় নয়।" },
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
    if (!window.confirm(accept ? "আপনি কি এই কোটটি গ্রহণ করতে চান?" : "আপনি কি এই কোটটি প্রত্যাখ্যান করতে চান?")) return;
    setBusy(true); setError("");
    try {
      const res = await fetch(`${API_URL}/public/quote/${encodeURIComponent(token)}/respond`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ accept }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error((body as { message?: string }).message ?? "উত্তর পাঠানো যায়নি");
      setQuote(body as PublicQuote);
    } catch (e) { setError(e instanceof Error ? e.message : "উত্তর পাঠানো যায়নি"); }
    finally { setBusy(false); }
  }

  if (state === "loading") {
    return (
      <main className="mx-auto max-w-2xl px-4 py-16 text-center">
        <div className="mx-auto h-10 w-10 animate-spin rounded-full border-4 border-indigo-600 border-t-transparent" />
        <p className="mt-3 text-sm font-semibold text-slate-600">লোড হচ্ছে…</p>
      </main>
    );
  }

  if (state === "notfound" || !quote) {
    return (
      <main className="mx-auto max-w-2xl px-4 py-16">
        <div className="rounded-3xl border border-dashed border-slate-300 bg-white p-10 text-center">
          <p className="text-4xl">🔎</p>
          <h1 className="mt-3 text-xl font-black text-slate-900">কোটটি পাওয়া যায়নি</h1>
          <p className="mt-1 text-sm text-slate-500">লিংকটি সঠিক নয় অথবা মেয়াদ শেষ হয়ে গেছে। বিক্রেতার কাছ থেকে নতুন লিংক নিন।</p>
        </div>
      </main>
    );
  }

  const shopName = quote.shop.brandName || quote.shop.name || "দোকান";
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
            <p className="text-xs font-semibold text-indigo-700">🧾 মূল্য প্রস্তাব (কোট)</p>
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-2xl space-y-5 px-4 py-8">
        <section className="space-y-3 rounded-3xl border border-slate-200 bg-white p-6 shadow-sm">
          <div className="flex flex-wrap items-baseline justify-between gap-2">
            <h1 className="text-lg font-black text-slate-900">কোট {quote.number}</h1>
            {quote.expiresAt ? (
              <span className="text-xs text-slate-500">মেয়াদ: {new Date(quote.expiresAt).toLocaleDateString("bn-BD")}</span>
            ) : null}
          </div>

          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead>
                <tr className="border-b text-xs text-slate-500">
                  <th className="py-2 pr-2 font-semibold">পণ্য</th>
                  <th className="py-2 pr-2 font-semibold">পরিমাণ</th>
                  <th className="py-2 pr-2 font-semibold">একক দাম</th>
                  <th className="py-2 font-semibold">মোট</th>
                </tr>
              </thead>
              <tbody>
                {quote.lines.map((l, i) => (
                  <tr key={i} className="border-b last:border-0">
                    <td className="py-2 pr-2 font-medium text-slate-800">
                      {l.name}{l.variantName ? ` — ${l.variantName}` : ""}
                      {l.sku ? <span className="block text-xs text-slate-400">SKU: {l.sku}</span> : null}
                    </td>
                    <td className="py-2 pr-2">{l.qty}</td>
                    <td className="py-2 pr-2">{formatMinorTaka(l.unitPriceMinor)}</td>
                    <td className="py-2 font-semibold">{formatMinorTaka(l.lineTotalMinor)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <div className="space-y-1 border-t pt-3 text-sm">
            <div className="flex justify-between"><span className="text-slate-500">ডেলিভারি চার্জ</span><span>{formatMinorTaka(quote.deliveryChargeMinor)}</span></div>
            <div className="flex justify-between text-base font-black text-slate-900"><span>সর্বমোট</span><span>{formatMinorTaka(quote.totalMinor)}</span></div>
          </div>

          {quote.note ? (
            <p className="rounded-xl bg-slate-50 px-3 py-2 text-sm text-slate-600">📝 {quote.note}</p>
          ) : null}
        </section>

        {error ? <p className="rounded-lg bg-rose-50 px-3 py-2 text-sm font-medium text-rose-700">{error}</p> : null}

        {quote.status === "sent" ? (
          <section className="space-y-3 rounded-3xl border border-slate-200 bg-white p-6 shadow-sm">
            <h2 className="text-sm font-bold text-slate-900">আপনার সিদ্ধান্ত জানান</h2>
            <p className="text-sm text-slate-500">কোটটি গ্রহণ করলে বিক্রেতা আপনার জন্য অর্ডার তৈরি করতে পারবেন।</p>
            <div className="flex flex-wrap gap-3">
              <button type="button" disabled={busy} onClick={() => respond(true)}
                className="flex-1 rounded-2xl bg-emerald-600 py-3 text-sm font-extrabold text-white shadow hover:bg-emerald-700 disabled:opacity-50">
                {busy ? "অপেক্ষা করুন…" : "✅ গ্রহণ করুন"}
              </button>
              <button type="button" disabled={busy} onClick={() => respond(false)}
                className="flex-1 rounded-2xl border border-rose-200 bg-rose-50 py-3 text-sm font-extrabold text-rose-700 hover:bg-rose-100 disabled:opacity-50">
                {busy ? "অপেক্ষা করুন…" : "প্রত্যাখ্যান করুন"}
              </button>
            </div>
          </section>
        ) : statusInfo ? (
          <section className="rounded-3xl border border-slate-200 bg-white p-6 text-center shadow-sm">
            <h2 className="text-lg font-black text-slate-900">{statusInfo.title}</h2>
            <p className="mt-1 text-sm text-slate-500">{statusInfo.body}</p>
            {quote.respondedAt ? (
              <p className="mt-2 text-xs text-slate-400">উত্তর দেওয়া হয়েছে: {new Date(quote.respondedAt).toLocaleString("bn-BD")}</p>
            ) : null}
          </section>
        ) : null}
      </main>
    </div>
  );
}
