"use client";
import React, { useEffect, useState } from "react";
import { useParams } from "next/navigation";
import { API_URL } from "@/lib/api";
import { formatTakaMinor, type PublicPaymentLinkView } from "@/lib/connections";

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
        setError("তথ্য লোড করা যায়নি — ইন্টারনেট সংযোগ পরীক্ষা করে আবার চেষ্টা করুন।");
      }
    })();
  }, [token]);

  async function pay() {
    setBusy(true); setError("");
    try {
      const res = await fetch(`${API_URL}/public/payment-links/${encodeURIComponent(token)}/initiate`, { method: "POST" });
      const body = (await res.json().catch(() => ({}))) as { redirectUrl?: string; message?: string };
      if (!res.ok) throw new Error(body.message ?? "পেমেন্ট শুরু করা যায়নি");
      if (body.redirectUrl) {
        window.location.href = body.redirectUrl;
        return;
      }
      throw new Error("গেটওয়ের পেমেন্ট পেজ পাওয়া যায়নি — কিছুক্ষণ পর আবার চেষ্টা করুন।");
    } catch (e) {
      setError(e instanceof Error ? e.message : "পেমেন্ট শুরু করা যায়নি");
      setBusy(false);
    }
  }

  const providerName = link?.provider === "bkash" ? "বিকাশ" : "SSLCommerz (কার্ড / মোবাইল ব্যাংকিং)";

  return (
    <main className="mx-auto flex min-h-screen w-full max-w-md flex-col items-center justify-center px-4 py-10">
      <div className="w-full rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
        <h1 className="text-lg font-bold text-slate-900">অনলাইন পেমেন্ট</h1>

        {error ? <div className="mt-4 rounded-xl bg-red-50 px-4 py-3 text-sm font-medium text-red-600">{error}</div> : null}

        {notFound ? (
          <p className="mt-4 text-sm leading-relaxed text-slate-600">
            এই পেমেন্ট লিঙ্কটি পাওয়া যায়নি। লিঙ্কটি সঠিকভাবে কপি হয়েছে কিনা যাচাই করুন, অথবা দোকানের সাথে যোগাযোগ করুন।
          </p>
        ) : !link && !error ? (
          <p className="mt-4 text-sm text-slate-400">লোড হচ্ছে…</p>
        ) : link ? (
          <>
            <div className="mt-4 space-y-2 text-sm">
              <div className="flex justify-between"><span className="text-slate-500">দোকান</span><span className="font-semibold text-slate-800">{link.shopName}</span></div>
              {link.orderNumber ? (
                <div className="flex justify-between"><span className="text-slate-500">অর্ডার নম্বর</span><span className="font-semibold text-slate-800">{link.orderNumber}</span></div>
              ) : null}
              {link.amountDueMinor != null ? (
                <div className="flex justify-between"><span className="text-slate-500">পরিশোধযোগ্য</span><span className="text-base font-bold text-slate-900">{formatTakaMinor(link.amountDueMinor)}</span></div>
              ) : null}
              <div className="flex justify-between"><span className="text-slate-500">পেমেন্ট পদ্ধতি</span><span className="font-medium text-slate-700">{providerName}</span></div>
              {link.status === "active" ? (
                <div className="flex justify-between"><span className="text-slate-500">লিঙ্কের মেয়াদ</span><span className="text-slate-600">{new Date(link.expiresAt).toLocaleString("bn-BD")}</span></div>
              ) : null}
            </div>

            {link.status === "active" ? (
              <>
                <button
                  type="button" disabled={busy} onClick={() => void pay()}
                  className="mt-6 w-full rounded-xl bg-indigo-600 px-4 py-3 text-sm font-bold text-white hover:bg-indigo-700 disabled:opacity-50"
                >
                  {busy ? "গেটওয়ের পেজে নেওয়া হচ্ছে…" : `${providerName} দিয়ে পেমেন্ট করুন`}
                </button>
                <p className="mt-3 text-xs leading-relaxed text-slate-400">
                  পেমেন্ট গেটওয়ের নিজের পেজে সম্পন্ন হবে। পেমেন্ট সফল ধরা হবে শুধু গেটওয়ের সার্ভার-যাচাইয়ের
                  পরেই — পেজটি বন্ধ হলেও চিন্তা নেই, যাচাই সম্পন্ন হলেই অর্ডারটি পেইড হিসেবে চিহ্নিত হবে।
                </p>
              </>
            ) : link.status === "used" ? (
              <div className="mt-6 rounded-xl bg-green-50 px-4 py-3 text-sm font-medium text-green-700">
                ✅ এই অর্ডারের পেমেন্ট ইতিমধ্যে সম্পন্ন হয়েছে — ধন্যবাদ!
              </div>
            ) : link.status === "expired" ? (
              <div className="mt-6 rounded-xl bg-amber-50 px-4 py-3 text-sm font-medium text-amber-700">
                এই পেমেন্ট লিঙ্কটির মেয়াদ শেষ হয়ে গেছে। নতুন লিঙ্কের জন্য দোকানের সাথে যোগাযোগ করুন।
              </div>
            ) : (
              <div className="mt-6 rounded-xl bg-red-50 px-4 py-3 text-sm font-medium text-red-600">
                এই পেমেন্ট লিঙ্কটি বাতিল করা হয়েছে। বিস্তারিত জানতে দোকানের সাথে যোগাযোগ করুন।
              </div>
            )}
          </>
        ) : null}
      </div>
    </main>
  );
}
