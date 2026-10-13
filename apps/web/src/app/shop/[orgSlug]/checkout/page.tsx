"use client";
import React, { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { BD_DISTRICTS, formatMinor } from "@repo/contracts";
import { API_URL } from "@/lib/api";
import {
  clearCartToken,
  fetchCart,
  getCartToken,
  lastOrderKey,
  placeCheckout,
  requestQuote,
  setCartContact,
  type Cart,
  type Quote,
} from "@/lib/storefront-cart";

interface ShopPublic {
  businessProfile: { codAvailable: boolean; bkashNumber: string | null; nagadNumber: string | null; paymentNote: string | null };
}

function money(minor: string): string {
  try {
    return formatMinor(BigInt(minor));
  } catch {
    return minor;
  }
}

export default function ShopCheckoutPage() {
  const params = useParams();
  const router = useRouter();
  const orgSlug = String(params.orgSlug ?? "");

  const [cart, setCart] = useState<Cart | null>(null);
  const [shop, setShop] = useState<ShopPublic | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState("");

  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");
  const [email, setEmail] = useState("");
  const [address, setAddress] = useState("");
  const [district, setDistrict] = useState<string>("ঢাকা");
  const [couponCode, setCouponCode] = useState("");
  const [paymentMethod, setPaymentMethod] = useState<"cod" | "bkash" | "nagad">("cod");
  const [advanceNote, setAdvanceNote] = useState("");
  const [note, setNote] = useState("");

  const [quote, setQuote] = useState<Quote | null>(null);
  const [quoteError, setQuoteError] = useState("");
  const [quoteLoading, setQuoteLoading] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");
  const quoteSeq = useRef(0);

  useEffect(() => {
    (async () => {
      setLoading(true);
      try {
        const [c, shopRes] = await Promise.all([
          fetchCart(orgSlug),
          fetch(`${API_URL}/public/shop/${encodeURIComponent(orgSlug)}`).then(async (r) => {
            if (!r.ok) {
              const b = await r.json().catch(() => ({}));
              throw new Error(b.message ?? "দোকান লোড করা যায়নি");
            }
            return r.json() as Promise<ShopPublic>;
          }),
        ]);
        setCart(c);
        setShop(shopRes);
        if (c) {
          if (c.phone) setPhone(c.phone);
          if (c.email) setEmail(c.email);
        }
      } catch (e) {
        setLoadError(e instanceof Error ? e.message : "লোড করা যায়নি");
      } finally {
        setLoading(false);
      }
    })();
  }, [orgSlug]);

  const refreshQuote = useCallback(async () => {
    const token = getCartToken(orgSlug);
    if (!token || !district) {
      setQuote(null);
      return;
    }
    const seq = ++quoteSeq.current;
    setQuoteLoading(true);
    try {
      const q = await requestQuote(orgSlug, {
        cartToken: token,
        district,
        couponCode: couponCode.trim() || undefined,
      });
      if (seq !== quoteSeq.current) return;
      setQuote(q);
      setQuoteError("");
    } catch (e) {
      if (seq !== quoteSeq.current) return;
      setQuote(null);
      setQuoteError(e instanceof Error ? e.message : "হিসাব পাওয়া যায়নি");
    } finally {
      if (seq === quoteSeq.current) setQuoteLoading(false);
    }
  }, [orgSlug, district, couponCode]);

  useEffect(() => {
    if (loading || !cart || cart.items.length === 0) return;
    const t = setTimeout(refreshQuote, 350);
    return () => clearTimeout(t);
  }, [refreshQuote, loading, cart]);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    const token = getCartToken(orgSlug);
    if (!token) {
      setError("কার্ট পাওয়া যায়নি — কার্টে পণ্য যোগ করে আবার চেষ্টা করুন।");
      return;
    }
    setSubmitting(true);
    setError("");
    try {
      // Contact first (abandonment + order email), then the order.
      const contact: { phone: string; email?: string } = { phone: phone.trim() };
      if (email.trim()) contact.email = email.trim();
      await setCartContact(orgSlug, contact).catch(() => undefined);
      const out = await placeCheckout(orgSlug, {
        cartToken: token,
        name: name.trim(),
        phone: phone.trim(),
        address: address.trim(),
        district,
        couponCode: couponCode.trim() || undefined,
        paymentMethod,
        note: note.trim() || undefined,
        advanceNote: paymentMethod === "cod" ? undefined : advanceNote.trim() || undefined,
      });
      try {
        sessionStorage.setItem(lastOrderKey(orgSlug), JSON.stringify(out));
      } catch { /* session storage unavailable — success page falls back to the query param */ }
      clearCartToken(orgSlug);
      router.push(`/shop/${orgSlug}/success?order=${encodeURIComponent(out.orderNumber)}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : "অর্ডার সম্পন্ন করা যায়নি");
    } finally {
      setSubmitting(false);
    }
  }

  if (loading) {
    return (
      <div className="mx-auto max-w-4xl px-4 py-16 text-center">
        <div className="mx-auto h-10 w-10 animate-spin rounded-full border-4 border-indigo-600 border-t-transparent" />
        <p className="mt-3 text-sm font-semibold text-slate-600">চেকআউট লোড হচ্ছে…</p>
      </div>
    );
  }

  if (loadError) {
    return (
      <div className="mx-auto max-w-md px-4 py-16">
        <div className="rounded-2xl border bg-white p-8 text-center shadow-sm">
          <p className="text-4xl">⚠️</p>
          <p className="mt-2 text-sm font-medium text-rose-600">{loadError}</p>
          <Link href={`/shop/${orgSlug}`} className="mt-4 inline-block rounded-lg bg-indigo-600 px-5 py-2 text-xs font-bold text-white">দোকানে ফিরুন</Link>
        </div>
      </div>
    );
  }

  if (!cart || cart.items.length === 0) {
    return (
      <div className="mx-auto max-w-md px-4 py-16">
        <div className="rounded-2xl border bg-white p-8 text-center shadow-sm">
          <p className="text-4xl">🛒</p>
          <h1 className="mt-2 text-lg font-black text-slate-900">কার্ট খালি</h1>
          <p className="mt-1 text-sm text-slate-500">চেকআউটের আগে কার্টে পণ্য যোগ করুন।</p>
          <Link href={`/shop/${orgSlug}`} className="mt-4 inline-block rounded-lg bg-indigo-600 px-5 py-2 text-xs font-bold text-white">কেনাকাটা করুন</Link>
        </div>
      </div>
    );
  }

  const bp = shop?.businessProfile;
  const showBkash = !!bp?.bkashNumber;
  const showNagad = !!bp?.nagadNumber;
  const freeDelivery = quote ? BigInt(quote.deliveryMinor) === 0n : false;

  return (
    <div className="mx-auto max-w-5xl px-4 py-8 sm:px-6">
      <h1 className="mb-6 text-2xl font-black text-slate-900">চেকআউট</h1>
      <form onSubmit={submit} className="grid gap-6 md:grid-cols-12">
        <div className="space-y-4 rounded-2xl border border-slate-200 bg-white p-6 shadow-sm md:col-span-7">
          <h2 className="border-b pb-2 text-base font-bold text-slate-900">📍 ডেলিভারি তথ্য</h2>
          <div>
            <label className="mb-1 block text-xs font-bold text-slate-700">আপনার নাম *</label>
            <input required value={name} onChange={(e) => setName(e.target.value)} placeholder="যেমন: মোঃ সাব্বির আহমেদ" className="w-full rounded-xl border border-slate-300 p-2.5 text-sm focus:border-indigo-600 focus:outline-none" />
          </div>
          <div className="grid gap-3 sm:grid-cols-2">
            <div>
              <label className="mb-1 block text-xs font-bold text-slate-700">মোবাইল নম্বর *</label>
              <input required type="tel" value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="01XXXXXXXXX" className="w-full rounded-xl border border-slate-300 p-2.5 font-mono text-sm font-bold focus:border-indigo-600 focus:outline-none" />
            </div>
            <div>
              <label className="mb-1 block text-xs font-bold text-slate-700">ইমেইল (ঐচ্ছিক)</label>
              <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="you@example.com" className="w-full rounded-xl border border-slate-300 p-2.5 text-sm focus:border-indigo-600 focus:outline-none" />
            </div>
          </div>
          <div>
            <label className="mb-1 block text-xs font-bold text-slate-700">পূর্ণ ঠিকানা *</label>
            <textarea required rows={2} value={address} onChange={(e) => setAddress(e.target.value)} placeholder="বাড়ি নং, রোড নং, এলাকা, থানার নাম লিখুন…" className="w-full rounded-xl border border-slate-300 p-2.5 text-sm focus:border-indigo-600 focus:outline-none" />
          </div>
          <div>
            <label className="mb-1 block text-xs font-bold text-slate-700">জেলা *</label>
            <select value={district} onChange={(e) => setDistrict(e.target.value)} className="w-full rounded-xl border border-slate-300 p-2.5 text-sm focus:border-indigo-600 focus:outline-none">
              {BD_DISTRICTS.map((d) => (
                <option key={d} value={d}>{d}</option>
              ))}
            </select>
          </div>
          <div>
            <label className="mb-1 block text-[11px] font-semibold text-slate-500">বিশেষ নির্দেশনা (ঐচ্ছিক)</label>
            <input value={note} onChange={(e) => setNote(e.target.value)} placeholder="যেমন: বিকেলে ডেলিভারি দিলে ভালো হয়" className="w-full rounded-lg border border-slate-200 p-2 text-sm" />
          </div>

          <div className="space-y-2 border-t pt-4">
            <label className="block text-xs font-bold text-slate-700">পেমেন্ট মেথড *</label>
            <label className="flex cursor-pointer items-center gap-2 rounded-xl border border-emerald-300 bg-emerald-50/60 p-3 text-sm font-bold text-emerald-950">
              <input type="radio" name="pay" checked={paymentMethod === "cod"} onChange={() => setPaymentMethod("cod")} />
              💵 ক্যাশ অন ডেলিভারি — পণ্য হাতে পেয়ে টাকা দিন
            </label>
            {showBkash ? (
              <label className="flex cursor-pointer items-center gap-2 rounded-xl border border-pink-300 bg-pink-50/60 p-3 text-sm font-bold text-pink-950">
                <input type="radio" name="pay" checked={paymentMethod === "bkash"} onChange={() => setPaymentMethod("bkash")} />
                বিকাশে অগ্রিম পাঠান: <span className="font-mono">{bp?.bkashNumber}</span>
              </label>
            ) : null}
            {showNagad ? (
              <label className="flex cursor-pointer items-center gap-2 rounded-xl border border-orange-300 bg-orange-50/60 p-3 text-sm font-bold text-orange-950">
                <input type="radio" name="pay" checked={paymentMethod === "nagad"} onChange={() => setPaymentMethod("nagad")} />
                নগদে অগ্রিম পাঠান: <span className="font-mono">{bp?.nagadNumber}</span>
              </label>
            ) : null}
            {paymentMethod !== "cod" ? (
              <div className="space-y-1 rounded-xl bg-amber-50 p-3">
                <label className="block text-xs font-bold text-amber-900">
                  অগ্রিম পাঠালে এখানে লিখুন (পরিমাণ / TrxID) — এটি যাচাই ছাড়া &lsquo;পেমেন্ট হয়েছে&rsquo; হিসেবে ধরা হবে না
                </label>
                <input value={advanceNote} onChange={(e) => setAdvanceNote(e.target.value)} placeholder="যেমন: ২০০ টাকা পাঠিয়েছি, TrxID: 9HX…" className="w-full rounded-lg border border-amber-300 bg-white p-2 text-sm focus:outline-none" />
                <p className="text-[11px] text-amber-800">দোকান আপনার পেমেন্ট যাচাই করে নিশ্চিত করবে। যাচাইয়ের আগে পুরো টাকাই বকেয়া হিসেবে দেখানো হবে।</p>
              </div>
            ) : null}
            {bp?.paymentNote ? <p className="text-[11px] text-slate-500">{bp.paymentNote}</p> : null}
          </div>
        </div>

        <div className="md:col-span-5">
          <div className="space-y-4 rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
            <h2 className="border-b pb-2 text-base font-bold text-slate-900">🧾 অর্ডার সারাংশ</h2>
            <ul className="space-y-1.5 text-xs text-slate-600">
              {cart.items.map((i) => (
                <li key={i.id} className="flex justify-between gap-2">
                  <span className="line-clamp-1">{i.productName ?? "পণ্য"}{i.variantName ? ` (${i.variantName})` : ""} × {i.quantity}{i.includeBump && i.bump ? " + অ্যাড-অন" : ""}</span>
                  <span className="shrink-0 font-semibold text-slate-900">{money(i.lineTotalMinor)}</span>
                </li>
              ))}
            </ul>

            <div>
              <label className="mb-1 block text-xs font-semibold text-slate-700">কুপন কোড (যদি থাকে)</label>
              <input value={couponCode} onChange={(e) => setCouponCode(e.target.value.toUpperCase())} placeholder="যেমন: EID10" className="w-full rounded-xl border border-slate-300 px-3 py-2 font-mono text-sm uppercase focus:border-indigo-500 focus:outline-none" />
            </div>

            {quoteLoading && !quote ? <p className="text-xs font-semibold text-slate-500">সার্ভার থেকে হিসাব আসছে…</p> : null}
            {quoteError ? <p className="rounded-lg bg-rose-50 px-3 py-2 text-xs font-medium text-rose-700">{quoteError}</p> : null}
            {!quote && !quoteError && !quoteLoading ? (
              <p className="text-xs text-slate-400">সার্ভারের হিসাব (quote) আসার অপেক্ষায় — জেলা বেছে নিলেই চূড়ান্ত হিসাব দেখাবে।</p>
            ) : null}

            {quote ? (
              <div className="space-y-2 border-t pt-3 text-sm">
                <div className="flex justify-between text-slate-600"><span>পণ্যের মূল্য:</span><span className="font-semibold text-slate-900">{money(quote.itemsSubtotalMinor)}</span></div>
                {BigInt(quote.bumpMinor) > 0n ? (
                  <div className="flex justify-between text-amber-800"><span>⚡ অ্যাড-অন:</span><span className="font-semibold">+ {money(quote.bumpMinor)}</span></div>
                ) : null}
                {BigInt(quote.discountMinor) > 0n || quote.coupon ? (
                  <div className="flex justify-between text-emerald-700"><span>কুপন ছাড়{quote.coupon ? ` (${quote.coupon.code})` : ""}:</span><span className="font-semibold">− {money(quote.discountMinor)}{quote.coupon?.freeShipping ? " + ফ্রি ডেলিভারি" : ""}</span></div>
                ) : null}
                <div className="flex justify-between text-slate-600">
                  <span>ডেলিভারি{quote.zone ? ` (${quote.zone.name}${quote.zone.deliveryDays != null ? `, ${quote.zone.deliveryDays} দিন` : ""})` : ""}:</span>
                  <span className="font-semibold text-slate-900">{freeDelivery ? "ফ্রি 🎉" : money(quote.deliveryMinor)}</span>
                </div>
                <div className="flex justify-between border-t pt-2 text-base font-black text-slate-900">
                  <span>সর্বমোট:</span><span className="text-indigo-700">{money(quote.totalMinor)}</span>
                </div>
                <div className="flex justify-between text-xs font-bold text-slate-700">
                  <span>{paymentMethod === "cod" ? "ডেলিভারিতে পরিশোধযোগ্য:" : "মোট বকেয়া (অগ্রিম দাবি অযাচাইকৃত):"}</span>
                  <span>{money(quote.codDueMinor)}</span>
                </div>
              </div>
            ) : null}

            {error ? <p className="rounded-lg bg-rose-50 px-3 py-2 text-xs font-medium text-rose-700">{error}</p> : null}
            <button type="submit" disabled={submitting} className="w-full rounded-2xl bg-indigo-600 py-3.5 text-sm font-extrabold text-white shadow-lg shadow-indigo-600/30 hover:bg-indigo-700 disabled:opacity-50">
              {submitting ? "অর্ডার প্রসেস হচ্ছে…" : "🚀 অর্ডার নিশ্চিত করুন"}
            </button>
            <Link href={`/shop/${orgSlug}/cart`} className="block text-center text-xs font-bold text-indigo-700 hover:underline">← কার্টে ফিরুন</Link>
          </div>
        </div>
      </form>
    </div>
  );
}
