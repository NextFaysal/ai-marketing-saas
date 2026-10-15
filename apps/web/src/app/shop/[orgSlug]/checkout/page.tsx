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
  slotDateString,
  type Cart,
  type PickupPoint,
  type Quote,
} from "@/lib/storefront-cart";
import { shopLocaleOf, shopT, type ShopLocale } from "@/lib/shop-i18n";
import { fetchMe, getShopSession } from "@/lib/storefront-account";
import { captureAffiliateRef, currentAffiliateCode } from "@/lib/affiliate-ref";

interface ShopPublic {
  businessProfile: { codAvailable: boolean; bkashNumber: string | null; nagadNumber: string | null; paymentNote: string | null };
  settings?: {
    locale?: string;
    trackingPageEnabled?: boolean;
    returnPolicyText?: string | null;
    deliveryPromiseText?: string | null;
    supportPhone?: string | null;
    // EC29: gift-wrap offer.
    giftWrapEnabled?: boolean;
    giftWrapFeeMinor?: string | null;
  };
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
  const [referralCode, setReferralCode] = useState("");
  const [paymentMethod, setPaymentMethod] = useState<"cod" | "bkash" | "nagad">("cod");
  const [advanceNote, setAdvanceNote] = useState("");
  const [note, setNote] = useState("");
  // EC29: gift wrap + message.
  const [giftWrap, setGiftWrap] = useState(false);
  const [giftMessage, setGiftMessage] = useState("");

  const [quote, setQuote] = useState<Quote | null>(null);
  const [quoteError, setQuoteError] = useState("");
  const [quoteLoading, setQuoteLoading] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");
  const quoteSeq = useRef(0);

  // EC18: delivery slot picker (slots arrive on the quote).
  const [slotId, setSlotId] = useState("");
  const [slotDate, setSlotDate] = useState("");

  // EC30: delivery method + pickup points (public list, active only).
  const [deliveryMethod, setDeliveryMethod] = useState<"home" | "pickup">("home");
  const [pickupPointId, setPickupPointId] = useState("");
  const [pickupPoints, setPickupPoints] = useState<PickupPoint[]>([]);
  const [pickupLoading, setPickupLoading] = useState(true);

  useEffect(() => {
    (async () => {
      setPickupLoading(true);
      try {
        const res = await fetch(`${API_URL}/public/shop/${encodeURIComponent(orgSlug)}/pickup-points`);
        if (!res.ok) throw new Error("pickup points unavailable");
        const json = (await res.json()) as { items?: PickupPoint[] };
        setPickupPoints(json.items ?? []);
      } catch {
        // Failure reads as an empty list — home delivery still works.
        setPickupPoints([]);
      } finally {
        setPickupLoading(false);
      }
    })();
  }, [orgSlug]);

  // The selected district's points first, then the rest (server order kept within each group).
  const sortedPickupPoints = [...pickupPoints].sort((a, b) => {
    const aFirst = a.district === district ? 0 : 1;
    const bFirst = b.district === district ? 0 : 1;
    return aFirst - bFirst;
  });

  const locale: ShopLocale = shopLocaleOf(shop?.settings?.locale);
  const t = shopT(locale);
  const deliverySlots = quote?.deliverySlots ?? [];
  // A slot that disappears from a fresh quote (district changed)
  // must not be submitted.
  useEffect(() => {
    if (slotId && deliverySlots.length > 0 && !deliverySlots.some((s) => s.id === slotId)) {
      setSlotId("");
      setSlotDate("");
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [quote]);

  useEffect(() => {
    // EC32: capture a direct ?ref= landing on the checkout too.
    captureAffiliateRef(orgSlug);
    (async () => {
      setLoading(true);
      try {
        const [c, shopRes] = await Promise.all([
          fetchCart(orgSlug),
          fetch(`${API_URL}/public/shop/${encodeURIComponent(orgSlug)}`).then(async (r) => {
            if (!r.ok) {
              const b = await r.json().catch(() => ({}));
              throw new Error(b.message ?? shopT("bn").checkout.shopLoadError);
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
        // EC25: a logged-in shopper gets name/phone/email + their
        // default address prefilled — into EMPTY fields only, so
        // nothing they (or the cart) already provided is clobbered.
        if (getShopSession(orgSlug)) {
          try {
            const me = await fetchMe(orgSlug);
            if (me.customer.name) setName((prev) => prev || me.customer.name || "");
            if (me.customer.phone) setPhone((prev) => prev || me.customer.phone);
            if (me.customer.email) setEmail((prev) => prev || me.customer.email || "");
            if (me.defaultAddress) {
              const a = me.defaultAddress;
              setName((prev) => prev || a.recipientName);
              setPhone((prev) => prev || a.phone);
              setAddress((prev) => prev || a.addressLine);
              if (a.district) setDistrict((prev) => (prev === "ঢাকা" ? a.district : prev));
            }
          } catch { /* prefill is best-effort; the form still works */ }
        }
      } catch (e) {
        setLoadError(e instanceof Error ? e.message : shopT("bn").checkout.loadErrorFallback);
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
        referralCode: referralCode.trim() || undefined,
        buyerPhone: phone.trim() || undefined,
        giftWrap: giftWrap || undefined,
        deliveryMethod,
        ...(deliveryMethod === "pickup" && pickupPointId ? { pickupPointId } : {}),
      });
      if (seq !== quoteSeq.current) return;
      setQuote(q);
      setQuoteError("");
    } catch (e) {
      if (seq !== quoteSeq.current) return;
      setQuote(null);
      setQuoteError(e instanceof Error ? e.message : shopT(locale).checkout.quoteErrorFallback);
    } finally {
      if (seq === quoteSeq.current) setQuoteLoading(false);
    }
  }, [orgSlug, district, couponCode, referralCode, phone, locale, giftWrap, deliveryMethod, pickupPointId]);

  useEffect(() => {
    if (loading || !cart || (cart.items.length === 0 && (cart.bundleItems ?? []).length === 0)) return;
    const t = setTimeout(refreshQuote, 350);
    return () => clearTimeout(t);
  }, [refreshQuote, loading, cart]);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    const token = getCartToken(orgSlug);
    if (!token) {
      setError(t.checkout.cartMissing);
      return;
    }
    if (slotId && !slotDate) {
      setError(t.checkout.slotHelp);
      return;
    }
    if (deliveryMethod === "pickup" && !pickupPointId) {
      setError(t.checkout.pickupRequired);
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
        referralCode: referralCode.trim() || undefined,
        // EC32: a stored partner ref (the window governs; the
        // server re-validates) — not cleared after purchase.
        affiliateCode: currentAffiliateCode(orgSlug) || undefined,
        paymentMethod,
        note: note.trim() || undefined,
        advanceNote: paymentMethod === "cod" ? undefined : advanceNote.trim() || undefined,
        ...(slotId && slotDate && deliveryMethod !== "pickup" ? { deliverySlotId: slotId, deliveryDate: slotDate } : {}),
        ...(giftWrap ? { giftWrap: true, giftMessage: giftMessage.trim() || undefined } : {}),
        deliveryMethod,
        ...(deliveryMethod === "pickup" ? { pickupPointId } : {}),
      });
      try {
        sessionStorage.setItem(lastOrderKey(orgSlug), JSON.stringify(out));
      } catch { /* session storage unavailable — success page falls back to the query param */ }
      clearCartToken(orgSlug);
      router.push(`/shop/${orgSlug}/success?order=${encodeURIComponent(out.orderNumber)}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : t.checkout.orderErrorFallback);
    } finally {
      setSubmitting(false);
    }
  }

  if (loading) {
    return (
      <div className="mx-auto max-w-4xl px-4 py-16 text-center">
        <div className="mx-auto h-10 w-10 animate-spin rounded-full border-4 border-indigo-600 border-t-transparent" />
        <p className="mt-3 text-sm font-semibold text-slate-600">{t.checkout.loading}</p>
      </div>
    );
  }

  if (loadError) {
    return (
      <div className="mx-auto max-w-md px-4 py-16">
        <div className="rounded-2xl border bg-white p-8 text-center shadow-sm">
          <p className="text-4xl">⚠️</p>
          <p className="mt-2 text-sm font-medium text-rose-600">{loadError}</p>
          <Link href={`/shop/${orgSlug}`} className="mt-4 inline-block rounded-lg bg-indigo-600 px-5 py-2 text-xs font-bold text-white">{t.checkout.backToShop}</Link>
        </div>
      </div>
    );
  }

  if (!cart || (cart.items.length === 0 && (cart.bundleItems ?? []).length === 0)) {
    return (
      <div className="mx-auto max-w-md px-4 py-16">
        <div className="rounded-2xl border bg-white p-8 text-center shadow-sm">
          <p className="text-4xl">🛒</p>
          <h1 className="mt-2 text-lg font-black text-slate-900">{t.checkout.emptyTitle}</h1>
          <p className="mt-1 text-sm text-slate-500">{t.checkout.emptyText}</p>
          <Link href={`/shop/${orgSlug}`} className="mt-4 inline-block rounded-lg bg-indigo-600 px-5 py-2 text-xs font-bold text-white">{t.checkout.shopNow}</Link>
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
      <h1 className="mb-6 text-2xl font-black text-slate-900">{t.checkout.title}</h1>
      <form onSubmit={submit} className="grid gap-6 md:grid-cols-12">
        <div className="space-y-4 rounded-2xl border border-slate-200 bg-white p-6 shadow-sm md:col-span-7">
          <h2 className="border-b pb-2 text-base font-bold text-slate-900">{t.checkout.deliveryInfo}</h2>
          <div>
            <label className="mb-1 block text-xs font-bold text-slate-700">{t.checkout.nameLabel}</label>
            <input required value={name} onChange={(e) => setName(e.target.value)} placeholder={t.checkout.namePlaceholder} className="w-full rounded-xl border border-slate-300 p-2.5 text-sm focus:border-indigo-600 focus:outline-none" />
          </div>
          <div className="grid gap-3 sm:grid-cols-2">
            <div>
              <label className="mb-1 block text-xs font-bold text-slate-700">{t.checkout.phoneLabel}</label>
              <input required type="tel" value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="01XXXXXXXXX" className="w-full rounded-xl border border-slate-300 p-2.5 font-mono text-sm font-bold focus:border-indigo-600 focus:outline-none" />
            </div>
            <div>
              <label className="mb-1 block text-xs font-bold text-slate-700">{t.checkout.emailLabel}</label>
              <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="you@example.com" className="w-full rounded-xl border border-slate-300 p-2.5 text-sm focus:border-indigo-600 focus:outline-none" />
            </div>
          </div>
          <div>
            <label className="mb-1 block text-xs font-bold text-slate-700">{t.checkout.addressLabel}</label>
            <textarea required rows={2} value={address} onChange={(e) => setAddress(e.target.value)} placeholder={t.checkout.addressPlaceholder} className="w-full rounded-xl border border-slate-300 p-2.5 text-sm focus:border-indigo-600 focus:outline-none" />
          </div>
          <div>
            <label className="mb-1 block text-xs font-bold text-slate-700">{t.checkout.districtLabel}</label>
            <select value={district} onChange={(e) => setDistrict(e.target.value)} className="w-full rounded-xl border border-slate-300 p-2.5 text-sm focus:border-indigo-600 focus:outline-none">
              {BD_DISTRICTS.map((d) => (
                <option key={d} value={d}>{d}</option>
              ))}
            </select>
          </div>
          {/* EC30: delivery method — home delivery or pickup point */}
          <div className="space-y-2">
            <label className="block text-xs font-bold text-slate-700">{t.checkout.deliveryMethodLabel}</label>
            <div className="grid gap-2 sm:grid-cols-2">
              <label className={`flex cursor-pointer items-center gap-2 rounded-xl border p-3 text-sm font-bold ${deliveryMethod === "home" ? "border-indigo-400 bg-indigo-50/60 text-indigo-950" : "border-slate-300 bg-white text-slate-800"}`}>
                <input type="radio" name="delivery-method" checked={deliveryMethod === "home"} onChange={() => setDeliveryMethod("home")} />
                {t.checkout.deliveryHome}
              </label>
              <label className={`flex items-center gap-2 rounded-xl border p-3 text-sm font-bold ${pickupPoints.length === 0 ? "cursor-not-allowed border-slate-200 bg-slate-50 text-slate-400" : deliveryMethod === "pickup" ? "cursor-pointer border-indigo-400 bg-indigo-50/60 text-indigo-950" : "cursor-pointer border-slate-300 bg-white text-slate-800"}`}>
                <input type="radio" name="delivery-method" checked={deliveryMethod === "pickup"} disabled={pickupPoints.length === 0} onChange={() => setDeliveryMethod("pickup")} />
                {t.checkout.deliveryPickup}
              </label>
            </div>
            {pickupLoading ? <p className="text-xs text-slate-400">{t.checkout.pickupLoading}</p> : null}
            {!pickupLoading && pickupPoints.length === 0 ? <p className="text-xs text-slate-400">{t.checkout.pickupEmpty}</p> : null}
            {deliveryMethod === "pickup" && pickupPoints.length > 0 ? (
              <div className="space-y-2">
                <label className="block text-xs font-bold text-slate-700">{t.checkout.pickupPointLabel}</label>
                {sortedPickupPoints.map((p) => (
                  <label key={p.id} className={`flex cursor-pointer items-start gap-2 rounded-xl border p-3 text-sm ${pickupPointId === p.id ? "border-indigo-400 bg-indigo-50/60" : "border-slate-300 bg-white"}`}>
                    <input type="radio" name="pickup-point" className="mt-1" checked={pickupPointId === p.id} onChange={() => setPickupPointId(p.id)} />
                    <span className="min-w-0 flex-1">
                      <span className="block font-bold text-slate-900">{p.name}</span>
                      <span className="block text-xs text-slate-500">{p.address} · {p.district}</span>
                    </span>
                    <span className="shrink-0 font-bold text-slate-900">{p.feeMinor === "0" ? t.checkout.pickupFree : money(p.feeMinor)}</span>
                  </label>
                ))}
              </div>
            ) : null}
          </div>
          <div>
            <label className="mb-1 block text-[11px] font-semibold text-slate-500">{t.checkout.noteLabel}</label>
            <input value={note} onChange={(e) => setNote(e.target.value)} placeholder={t.checkout.notePlaceholder} className="w-full rounded-lg border border-slate-200 p-2 text-sm" />
          </div>

          {/* EC29: gift wrap (only when the shop enables it with a fee) */}
          {shop?.settings?.giftWrapEnabled && shop.settings.giftWrapFeeMinor ? (
            <div className="space-y-2 rounded-xl border border-pink-200 bg-pink-50/50 p-3">
              <p className="text-xs font-bold text-pink-900">{t.checkout.giftHeading}</p>
              <label className="flex cursor-pointer items-center gap-2 text-sm font-semibold text-slate-800">
                <input type="checkbox" checked={giftWrap} onChange={(e) => setGiftWrap(e.target.checked)} />
                {t.checkout.wrapLabel} (+{money(shop.settings.giftWrapFeeMinor)}{t.checkout.wrapFeeSuffix})
              </label>
              {giftWrap ? (
                <div>
                  <label className="mb-1 block text-[11px] font-semibold text-slate-500">{t.checkout.giftMessageLabel}</label>
                  <textarea
                    rows={2}
                    maxLength={200}
                    value={giftMessage}
                    onChange={(e) => setGiftMessage(e.target.value)}
                    placeholder={t.checkout.giftMessagePlaceholder}
                    className="w-full rounded-lg border border-pink-200 bg-white p-2 text-sm focus:border-pink-400 focus:outline-none"
                  />
                </div>
              ) : null}
            </div>
          ) : null}

          <div className="space-y-2 border-t pt-4">
            <label className="block text-xs font-bold text-slate-700">{t.checkout.paymentMethodLabel}</label>
            <label className="flex cursor-pointer items-center gap-2 rounded-xl border border-emerald-300 bg-emerald-50/60 p-3 text-sm font-bold text-emerald-950">
              <input type="radio" name="pay" checked={paymentMethod === "cod"} onChange={() => setPaymentMethod("cod")} />
              {t.checkout.codLabel}
            </label>
            {showBkash ? (
              <label className="flex cursor-pointer items-center gap-2 rounded-xl border border-pink-300 bg-pink-50/60 p-3 text-sm font-bold text-pink-950">
                <input type="radio" name="pay" checked={paymentMethod === "bkash"} onChange={() => setPaymentMethod("bkash")} />
                {t.checkout.bkashAdvancePrefix} <span className="font-mono">{bp?.bkashNumber}</span>
              </label>
            ) : null}
            {showNagad ? (
              <label className="flex cursor-pointer items-center gap-2 rounded-xl border border-orange-300 bg-orange-50/60 p-3 text-sm font-bold text-orange-950">
                <input type="radio" name="pay" checked={paymentMethod === "nagad"} onChange={() => setPaymentMethod("nagad")} />
                {t.checkout.nagadAdvancePrefix} <span className="font-mono">{bp?.nagadNumber}</span>
              </label>
            ) : null}
            {paymentMethod !== "cod" ? (
              <div className="space-y-1 rounded-xl bg-amber-50 p-3">
                <label className="block text-xs font-bold text-amber-900">
                  {t.checkout.advanceNoteLabel}
                </label>
                <input value={advanceNote} onChange={(e) => setAdvanceNote(e.target.value)} placeholder={t.checkout.advanceNotePlaceholder} className="w-full rounded-lg border border-amber-300 bg-white p-2 text-sm focus:outline-none" />
                <p className="text-[11px] text-amber-800">{t.checkout.advanceNoteHelp}</p>
              </div>
            ) : null}
            {bp?.paymentNote ? <p className="text-[11px] text-slate-500">{bp.paymentNote}</p> : null}
          </div>
        </div>

        <div className="md:col-span-5">
          <div className="space-y-4 rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
            <h2 className="border-b pb-2 text-base font-bold text-slate-900">{t.checkout.orderSummary}</h2>
            <ul className="space-y-1.5 text-xs text-slate-600">
              {cart.items.map((i) => (
                <li key={i.id} className="flex justify-between gap-2">
                  <span className="line-clamp-1">{i.productName ?? t.checkout.productFallback}{i.variantName ? ` (${i.variantName})` : ""} × {i.quantity}{i.includeBump && i.bump ? t.checkout.bumpSuffix : ""}</span>
                  <span className="shrink-0 font-semibold text-slate-900">{money(i.lineTotalMinor)}</span>
                </li>
              ))}
              {(cart.bundleItems ?? []).map((b) => (
                <li key={b.id} className="flex justify-between gap-2">
                  <span className="line-clamp-1">🎁 {b.name} ({t.cart.bundleBadge}) × {b.quantity}</span>
                  <span className="shrink-0 font-semibold text-slate-900">{money(b.lineTotalMinor)}</span>
                </li>
              ))}
            </ul>

            <div>
              <label className="mb-1 block text-xs font-semibold text-slate-700">{t.checkout.couponLabel}</label>
              <input value={couponCode} onChange={(e) => setCouponCode(e.target.value.toUpperCase())} placeholder={t.checkout.couponPlaceholder} className="w-full rounded-xl border border-slate-300 px-3 py-2 font-mono text-sm uppercase focus:border-indigo-500 focus:outline-none" />
            </div>

            <div>
              <label className="mb-1 block text-xs font-semibold text-slate-700">{t.checkout.referralLabel}</label>
              <input value={referralCode} onChange={(e) => setReferralCode(e.target.value)} placeholder={t.checkout.referralPlaceholder} className="w-full rounded-xl border border-slate-300 px-3 py-2 font-mono text-sm focus:border-indigo-500 focus:outline-none" />
            </div>

            {quoteLoading && !quote ? <p className="text-xs font-semibold text-slate-500">{t.checkout.quoteLoading}</p> : null}
            {quoteError ? <p className="rounded-lg bg-rose-50 px-3 py-2 text-xs font-medium text-rose-700">{quoteError}</p> : null}
            {!quote && !quoteError && !quoteLoading ? (
              <p className="text-xs text-slate-400">{t.checkout.quoteWaiting}</p>
            ) : null}

            {quote ? (
              <div className="space-y-2 border-t pt-3 text-sm">
                <div className="flex justify-between text-slate-600"><span>{t.checkout.itemsSubtotal}</span><span className="font-semibold text-slate-900">{money(quote.itemsSubtotalMinor)}</span></div>
                {BigInt(quote.bumpMinor) > 0n ? (
                  <div className="flex justify-between text-amber-800"><span>{t.checkout.bumpLine}</span><span className="font-semibold">+ {money(quote.bumpMinor)}</span></div>
                ) : null}
                {BigInt(quote.discountMinor) > 0n || quote.coupon ? (
                  <div className="flex justify-between text-emerald-700"><span>{t.checkout.couponDiscount}{quote.coupon ? ` (${quote.coupon.code})` : ""}:</span><span className="font-semibold">− {money(quote.discountMinor)}{quote.coupon?.freeShipping ? t.checkout.freeShippingSuffix : ""}</span></div>
                ) : null}
                {(quote.promotionsApplied ?? []).map((p) => (
                  <div key={p.promotionId} className="flex justify-between text-emerald-700"><span>{t.checkout.promotionDiscount} — {p.name}:</span><span className="font-semibold">− {money(p.amountMinor)}</span></div>
                ))}
                {quote.referral ? (
                  <div className="flex justify-between text-emerald-700"><span>{t.checkout.referralApplied} ({quote.referral.code}):</span><span className="font-semibold">− {money(quote.referral.discountMinor)}</span></div>
                ) : quote.referralDiscountMinor && BigInt(quote.referralDiscountMinor) > 0n ? (
                  <div className="flex justify-between text-emerald-700"><span>{t.checkout.referralApplied}:</span><span className="font-semibold">− {money(quote.referralDiscountMinor)}</span></div>
                ) : null}
                {quote.gift ? (
                  <div className="flex justify-between text-pink-700">
                    <span>🎁 {t.checkout.giftLinePrefix}: {quote.gift.productName} × {quote.gift.quantity} ({quote.gift.promotionName})</span>
                    <span className="font-semibold">{money("0")}</span>
                  </div>
                ) : null}
                {quote.giftWrapMinor && BigInt(quote.giftWrapMinor) > 0n ? (
                  <div className="flex justify-between text-slate-600"><span>{t.success.wrapLine}:</span><span className="font-semibold text-slate-900">+ {money(quote.giftWrapMinor)}</span></div>
                ) : null}
                <div className="flex justify-between text-slate-600">
                  <span>{deliveryMethod === "pickup" ? `${t.checkout.pickupFeeLabel}:` : `${t.checkout.delivery}${quote.zone ? ` (${quote.zone.name}${quote.zone.deliveryDays != null ? `, ${quote.zone.deliveryDays}${t.checkout.deliveryDaysSuffix}` : ""})` : ""}:`}</span>
                  <span className="font-semibold text-slate-900">{freeDelivery ? (deliveryMethod === "pickup" ? t.checkout.pickupFree : t.checkout.free) : money(quote.deliveryMinor)}</span>
                </div>
                <div className="flex justify-between border-t pt-2 text-base font-black text-slate-900">
                  <span>{t.checkout.total}</span><span className="text-indigo-700">{money(quote.totalMinor)}</span>
                </div>
                <div className="flex justify-between text-xs font-bold text-slate-700">
                  <span>{paymentMethod === "cod" ? t.checkout.codDueCod : t.checkout.codDueAdvance}</span>
                  <span>{money(quote.codDueMinor)}</span>
                </div>
              </div>
            ) : null}

            {deliverySlots.length > 0 && deliveryMethod !== "pickup" ? (
              <div className="space-y-2 border-t pt-3">
                <label className="block text-xs font-bold text-slate-700" htmlFor="delivery-slot">{t.checkout.slotLabel}</label>
                <select
                  id="delivery-slot"
                  value={slotId}
                  onChange={(e) => {
                    const next = e.target.value;
                    setSlotId(next);
                    if (next && !slotDate) setSlotDate(slotDateString(0));
                    if (!next) setSlotDate("");
                  }}
                  className="w-full rounded-xl border border-slate-300 p-2.5 text-sm focus:border-indigo-600 focus:outline-none"
                >
                  <option value="">{t.checkout.slotNone}</option>
                  {deliverySlots.map((s) => (
                    <option key={s.id} value={s.id}>{s.label} ({s.startTime} – {s.endTime})</option>
                  ))}
                </select>
                {slotId ? (
                  <div>
                    <label className="mb-1 block text-xs font-bold text-slate-700" htmlFor="delivery-date">{t.checkout.slotDateLabel}</label>
                    <input
                      id="delivery-date"
                      type="date"
                      required
                      min={slotDateString(0)}
                      max={slotDateString(7)}
                      value={slotDate}
                      onChange={(e) => setSlotDate(e.target.value)}
                      className="w-full rounded-xl border border-slate-300 p-2.5 text-sm focus:border-indigo-600 focus:outline-none"
                    />
                    <p className="mt-1 text-[11px] text-slate-400">{t.checkout.slotHelp}</p>
                  </div>
                ) : null}
              </div>
            ) : null}

            {error ? <p className="rounded-lg bg-rose-50 px-3 py-2 text-xs font-medium text-rose-700">{error}</p> : null}

            {/* EC18 trust copy near the place-order button — hidden when empty. */}
            {shop?.settings?.deliveryPromiseText?.trim() || shop?.settings?.supportPhone?.trim() ? (
              <div className="space-y-1 rounded-xl bg-slate-50 p-3 text-center">
                {shop?.settings?.deliveryPromiseText?.trim() ? (
                  <p className="text-xs font-semibold text-slate-700">🚚 {shop.settings.deliveryPromiseText.trim()}</p>
                ) : null}
                {shop?.settings?.supportPhone?.trim() ? (
                  <p className="text-xs text-slate-500">{t.checkout.supportLabel}: <span className="font-mono font-semibold">{shop.settings.supportPhone.trim()}</span></p>
                ) : null}
              </div>
            ) : null}

            <button type="submit" disabled={submitting} className="w-full rounded-2xl bg-indigo-600 py-3.5 text-sm font-extrabold text-white shadow-lg shadow-indigo-600/30 hover:bg-indigo-700 disabled:opacity-50">
              {submitting ? t.checkout.placingOrder : t.checkout.placeOrder}
            </button>
            <Link href={`/shop/${orgSlug}/cart`} className="block text-center text-xs font-bold text-indigo-700 hover:underline">{t.checkout.backToCart}</Link>

            {shop?.settings?.returnPolicyText?.trim() ? (
              <div className="border-t pt-3">
                <p className="text-[11px] font-bold text-slate-600">{t.common.returnPolicyLabel}</p>
                <p className="mt-1 whitespace-pre-line text-[11px] leading-relaxed text-slate-500">{shop.settings.returnPolicyText.trim()}</p>
              </div>
            ) : null}
          </div>
        </div>
      </form>
    </div>
  );
}
