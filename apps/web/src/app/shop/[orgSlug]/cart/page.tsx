"use client";
import React, { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { formatMinor } from "@repo/contracts";
import { fetchCart, patchCartLine, setCartContact, type Cart } from "@/lib/storefront-cart";

function money(minor: string): string {
  try {
    return formatMinor(BigInt(minor));
  } catch {
    return minor;
  }
}

export default function CartPage() {
  const params = useParams();
  const orgSlug = String(params.orgSlug ?? "");
  const [cart, setCart] = useState<Cart | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");
  const [email, setEmail] = useState("");
  const [phone, setPhone] = useState("");
  const [contactNotice, setContactNotice] = useState("");

  const load = useCallback(async () => {
    setLoading(true);
    const c = await fetchCart(orgSlug);
    setCart(c);
    if (c) {
      setEmail(c.email ?? "");
      setPhone(c.phone ?? "");
    }
    setLoading(false);
  }, [orgSlug]);

  useEffect(() => { load(); }, [load]);

  async function changeQty(itemId: string, productId: string, variantId: string | null, includeBump: boolean, quantity: number) {
    setBusy(itemId);
    setError("");
    try {
      const updated = await patchCartLine(orgSlug, { productId, variantId, quantity, includeBump });
      setCart(updated);
    } catch (e) {
      setError(e instanceof Error ? e.message : "কার্ট আপডেট করা যায়নি");
    } finally {
      setBusy("");
    }
  }

  async function saveContact() {
    setBusy("contact");
    setError("");
    setContactNotice("");
    try {
      const body: { email?: string; phone?: string } = {};
      if (email.trim()) body.email = email.trim();
      if (phone.trim()) body.phone = phone.trim();
      const updated = await setCartContact(orgSlug, body);
      setCart(updated);
      setContactNotice("যোগাযোগের তথ্য সংরক্ষণ হয়েছে — অর্ডার শেষ না করলেও দোকান আপনার সাথে যোগাযোগ করতে পারবে।");
    } catch (e) {
      setError(e instanceof Error ? e.message : "সংরক্ষণ করা যায়নি");
    } finally {
      setBusy("");
    }
  }

  if (loading) {
    return (
      <div className="mx-auto max-w-4xl px-4 py-16 text-center">
        <div className="mx-auto h-10 w-10 animate-spin rounded-full border-4 border-indigo-600 border-t-transparent" />
        <p className="mt-3 text-sm font-semibold text-slate-600">কার্ট লোড হচ্ছে…</p>
      </div>
    );
  }

  if (!cart || cart.items.length === 0) {
    return (
      <div className="mx-auto max-w-4xl px-4 py-16">
        <div className="rounded-3xl border border-dashed border-slate-300 bg-white p-10 text-center">
          <p className="text-4xl">🛒</p>
          <h1 className="mt-3 text-xl font-black text-slate-900">আপনার কার্ট খালি</h1>
          <p className="mt-1 text-sm text-slate-500">পছন্দের পণ্য কার্টে যোগ করে অর্ডার করুন।</p>
          <Link href={`/shop/${orgSlug}`} className="mt-4 inline-block rounded-xl bg-indigo-600 px-5 py-2.5 text-sm font-bold text-white">
            কেনাকাটা শুরু করুন
          </Link>
        </div>
      </div>
    );
  }

  // Preview only: server cart line totals + accepted bumps (once per line).
  let previewMinor = 0n;
  for (const item of cart.items) {
    try {
      previewMinor += BigInt(item.lineTotalMinor);
      if (item.includeBump && item.bump) previewMinor += BigInt(item.bump.priceMinor);
    } catch { /* ignore malformed */ }
  }

  return (
    <div className="mx-auto max-w-4xl space-y-6 px-4 py-8 sm:px-6">
      <h1 className="text-2xl font-black text-slate-900">🛒 আপনার কার্ট</h1>
      {error ? <p className="rounded-lg bg-rose-50 px-3 py-2 text-sm font-medium text-rose-700">{error}</p> : null}

      <div className="space-y-3">
        {cart.items.map((item) => (
          <div key={item.id} className="flex gap-4 rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
            {item.imageUrl ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={item.imageUrl} alt={item.productName ?? ""} className="h-20 w-20 rounded-xl border border-slate-200 object-cover" />
            ) : (
              <div className="flex h-20 w-20 items-center justify-center rounded-xl bg-indigo-50 text-3xl">📦</div>
            )}
            <div className="min-w-0 flex-1 space-y-1">
              <div className="flex items-start justify-between gap-2">
                <div>
                  <p className="text-sm font-bold text-slate-900">{item.productName ?? "পণ্য"}</p>
                  {item.variantName ? <p className="text-[11px] text-slate-500">{item.variantName}</p> : null}
                  <p className="text-xs text-slate-500">একক দাম: {money(item.unitPriceMinor)}</p>
                </div>
                <p className="text-sm font-extrabold text-indigo-700">{money(item.lineTotalMinor)}</p>
              </div>
              {item.includeBump && item.bump ? (
                <p className="rounded-lg bg-amber-50 px-2 py-1 text-[11px] font-bold text-amber-900">
                  ⚡ অ্যাড-অনসহ: {item.bump.title} (+{money(item.bump.priceMinor)})
                </p>
              ) : null}
              <div className="flex items-center justify-between pt-1">
                <div className="flex items-center overflow-hidden rounded-lg border">
                  <button
                    type="button"
                    disabled={busy === item.id}
                    onClick={() => changeQty(item.id, item.productId, item.variantId, item.includeBump, Math.max(0, item.quantity - 1))}
                    className="bg-slate-50 px-3 py-1 font-bold text-slate-600 hover:bg-slate-100 disabled:opacity-50"
                  >−</button>
                  <span className="px-3 py-1 text-xs font-bold">{item.quantity}</span>
                  <button
                    type="button"
                    disabled={busy === item.id}
                    onClick={() => changeQty(item.id, item.productId, item.variantId, item.includeBump, Math.min(99, item.quantity + 1))}
                    className="bg-slate-50 px-3 py-1 font-bold text-slate-600 hover:bg-slate-100 disabled:opacity-50"
                  >+</button>
                </div>
                <button
                  type="button"
                  disabled={busy === item.id}
                  onClick={() => changeQty(item.id, item.productId, item.variantId, item.includeBump, 0)}
                  className="text-xs font-bold text-rose-600 hover:underline disabled:opacity-50"
                >
                  সরিয়ে দিন
                </button>
              </div>
            </div>
          </div>
        ))}
      </div>

      {/* Contact capture — powers abandoned-cart recovery */}
      <div className="space-y-3 rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
        <h2 className="text-sm font-bold text-slate-900">যোগাযোগের তথ্য (ঐচ্ছিক)</h2>
        <p className="text-[11px] text-slate-500">ফোন/ইমেইল দিয়ে রাখলে অর্ডার শেষ না হলেও দোকান প্রয়োজনে যোগাযোগ করতে পারবে।</p>
        <div className="grid gap-3 sm:grid-cols-2">
          <input type="tel" value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="মোবাইল নম্বর 01XXXXXXXXX" className="rounded-xl border border-slate-300 p-2.5 text-sm focus:border-indigo-600 focus:outline-none" />
          <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="ইমেইল (ঐচ্ছিক)" className="rounded-xl border border-slate-300 p-2.5 text-sm focus:border-indigo-600 focus:outline-none" />
        </div>
        {contactNotice ? <p className="rounded-lg bg-emerald-50 px-3 py-2 text-xs font-medium text-emerald-700">{contactNotice}</p> : null}
        <button type="button" onClick={saveContact} disabled={busy === "contact" || (!email.trim() && !phone.trim())} className="rounded-xl bg-slate-900 px-5 py-2.5 text-xs font-bold text-white disabled:opacity-50">
          {busy === "contact" ? "সংরক্ষণ হচ্ছে…" : "তথ্য সংরক্ষণ করুন"}
        </button>
      </div>

      <div className="space-y-3 rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
        <div className="flex justify-between text-sm">
          <span className="font-semibold text-slate-600">সাবটোটাল প্রিভিউ:</span>
          <span className="font-extrabold text-slate-900">{formatMinor(previewMinor)}</span>
        </div>
        <p className="text-[11px] text-slate-400">প্রিভিউ — চূড়ান্ত হিসাব চেকআউটে সার্ভার থেকে আসবে (কুপন ও ডেলিভারি চার্জসহ)।</p>
        <Link href={`/shop/${orgSlug}/checkout`} className="block rounded-2xl bg-indigo-600 py-3.5 text-center text-sm font-extrabold text-white shadow-lg shadow-indigo-600/30 hover:bg-indigo-700">
          চেকআউটে যান →
        </Link>
        <Link href={`/shop/${orgSlug}`} className="block text-center text-xs font-bold text-indigo-700 hover:underline">← আরও কেনাকাটা করুন</Link>
      </div>
    </div>
  );
}
