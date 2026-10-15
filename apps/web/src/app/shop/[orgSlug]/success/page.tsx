"use client";
import React, { Suspense, useEffect, useState } from "react";
import Link from "next/link";
import { useParams, useSearchParams } from "next/navigation";
import { formatMinor } from "@repo/contracts";
import { API_URL } from "@/lib/api";
import { lastOrderKey, type CheckoutResult } from "@/lib/storefront-cart";
import { shopLocaleOf, shopT, type ShopLocale } from "@/lib/shop-i18n";
import { payOnlineAvailable, payOptionLabel, type PayOption } from "@/lib/connections";

function money(minor: string): string {
  try {
    return formatMinor(BigInt(minor));
  } catch {
    return minor;
  }
}

function SuccessInner() {
  const params = useParams();
  const search = useSearchParams();
  const orgSlug = String(params.orgSlug ?? "");
  const orderFromQuery = search.get("order") ?? "";
  const [order, setOrder] = useState<CheckoutResult | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [locale, setLocale] = useState<ShopLocale>("bn");
  const [trackingEnabled, setTrackingEnabled] = useState(true);
  const t = shopT(locale);
  // CC19: buyer "Pay online" — options come from the shop's
  // PUBLIC payment-options answer, which lists an option only
  // when it would really work (enabled own LIVE gateway, or a
  // tenant-enabled platform provider the platform offers).
  const [payOptions, setPayOptions] = useState<PayOption[]>([]);
  const [payBusy, setPayBusy] = useState("");
  const [payError, setPayError] = useState("");
  const paymentVerifying = search.get("payment") === "verifying";

  useEffect(() => {
    try {
      const raw = sessionStorage.getItem(lastOrderKey(orgSlug));
      if (raw) setOrder(JSON.parse(raw) as CheckoutResult);
    } catch { /* no stored response — honest generic confirmation below */ }
    setLoaded(true);
  }, [orgSlug]);

  // EC19 locale + EC18 tracking availability from the shop payload.
  useEffect(() => {
    (async () => {
      try {
        const res = await fetch(`${API_URL}/public/shop/${encodeURIComponent(orgSlug)}`);
        if (!res.ok) return;
        const json = await res.json();
        setLocale(shopLocaleOf(json?.settings?.locale));
        if (json?.settings?.trackingPageEnabled === false) setTrackingEnabled(false);
      } catch { /* defaults: bn, tracking link shown */ }
    })();
  }, [orgSlug]);

  useEffect(() => {
    if (!order?.orderId) return;
    (async () => {
      try {
        const res = await fetch(`${API_URL}/public/tenant-payments/${encodeURIComponent(orgSlug)}/payment-options`);
        if (!res.ok) return;
        const json = await res.json();
        setPayOptions(Array.isArray(json?.options) ? json.options : []);
      } catch { /* no options — the button simply never appears */ }
    })();
  }, [orgSlug, order?.orderId]);

  async function payOnline(option: PayOption) {
    if (!order?.orderId || !order?.orderNumber) return;
    setPayBusy(`${option.provider}:${option.source}`);
    setPayError("");
    try {
      const res = await fetch(`${API_URL}/public/tenant-payments/initiate/${encodeURIComponent(orgSlug)}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ orderId: order.orderId, orderNumber: order.orderNumber, provider: option.provider, source: option.source }),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(json?.message ?? "এই মুহূর্তে অনলাইন পেমেন্ট শুরু করা যাচ্ছে না।");
      const url = json?.redirectUrl ?? json?.bkashURL;
      if (!url) throw new Error("গেটওয়ে কোনো পেমেন্ট লিংক দেয়নি — পেমেন্ট শুরু হয়নি।");
      window.location.href = url;
    } catch (e) {
      // Honest refusal, verbatim from the server — never a fake
      // "payment successful" state.
      setPayError(e instanceof Error ? e.message : "পেমেন্ট শুরু করা যায়নি");
      setPayBusy("");
    }
  }

  const orderNumber = order?.orderNumber ?? orderFromQuery;

  return (
    <div className="mx-auto max-w-lg px-4 py-12">
      <div className="space-y-6 rounded-3xl border border-slate-100 bg-white p-8 text-center shadow-xl">
        <div className="mx-auto flex h-16 w-16 items-center justify-center rounded-full bg-emerald-100 text-3xl text-emerald-600">✓</div>
        <div>
          <h1 className="text-2xl font-black text-slate-900">{t.success.title}</h1>
          <p className="mt-1 text-xs text-slate-500">{t.success.thanks}</p>
          {orderNumber ? (
            <p className="mt-3 inline-block rounded-full bg-indigo-50 px-4 py-1.5 text-sm font-black text-indigo-800">{t.success.orderNumber} {orderNumber}</p>
          ) : null}
        </div>

        {loaded && order ? (
          <div className="space-y-2 rounded-2xl border bg-slate-50 p-4 text-left text-xs">
            <div className="flex justify-between border-b pb-2"><span className="text-slate-500">{t.success.itemsSubtotal}</span><span className="font-bold text-slate-800">{money(order.itemsSubtotalMinor)}</span></div>
            {BigInt(order.bumpMinor) > 0n ? (
              <div className="flex justify-between border-b pb-2"><span className="text-slate-500">{t.success.bumpLine}</span><span className="font-bold text-slate-800">+ {money(order.bumpMinor)}</span></div>
            ) : null}
            {BigInt(order.discountMinor) > 0n ? (
              <div className="flex justify-between border-b pb-2"><span className="text-slate-500">{t.success.couponDiscount}</span><span className="font-bold text-emerald-700">− {money(order.discountMinor)}</span></div>
            ) : null}
            {(order.promotionsApplied ?? []).length > 0 ? (
              <>
                <div className="border-b pb-1 pt-1 font-bold text-slate-700">{t.success.promotionsHeader}</div>
                {(order.promotionsApplied ?? []).map((p) => (
                  <div key={p.promotionId} className="flex justify-between border-b pb-2"><span className="text-slate-500">{p.name}</span><span className="font-bold text-emerald-700">− {money(p.amountMinor)}</span></div>
                ))}
              </>
            ) : null}
            {order.referralDiscountMinor && BigInt(order.referralDiscountMinor) > 0n ? (
              <div className="flex justify-between border-b pb-2"><span className="text-slate-500">{t.checkout.referralApplied}{order.referral ? ` (${order.referral.code})` : ""}:</span><span className="font-bold text-emerald-700">− {money(order.referralDiscountMinor)}</span></div>
            ) : null}
            {order.gift ? (
              <div className="flex justify-between border-b pb-2"><span className="text-slate-500">🎁 {t.success.giftLine}: {order.gift.productName} × {order.gift.quantity} ({order.gift.promotionName})</span><span className="font-bold text-pink-700">{money("0")}</span></div>
            ) : null}
            {order.giftSkipped ? (
              <div className="rounded-lg bg-amber-50 px-2 py-1.5 text-amber-800">{t.success.giftSkippedNote}</div>
            ) : null}
            {order.giftWrapMinor && BigInt(order.giftWrapMinor) > 0n ? (
              <div className="flex justify-between border-b pb-2"><span className="text-slate-500">{t.success.wrapLine}:</span><span className="font-bold text-slate-800">+ {money(order.giftWrapMinor)}</span></div>
            ) : null}
            <div className="flex justify-between border-b pb-2"><span className="text-slate-500">{t.success.deliveryCharge}</span><span className="font-bold text-slate-800">{BigInt(order.deliveryMinor) === 0n ? t.success.free : money(order.deliveryMinor)}</span></div>
            {order.deliverySlot ? (
              <div className="flex justify-between border-b pb-2"><span className="text-slate-500">{t.track.deliverySlot}:</span><span className="font-bold text-slate-800">{order.deliverySlot.label} · {order.deliverySlot.date}</span></div>
            ) : null}
            {order.deliveryMethod === "pickup" && order.pickupPoint ? (
              <div className="space-y-1 rounded-xl bg-indigo-50 p-3 text-left">
                <p className="font-bold text-indigo-900">{t.success.pickupHeading}</p>
                <p className="font-bold text-slate-800">{order.pickupPoint.name}</p>
                <p className="text-slate-600">{order.pickupPoint.address}{order.pickupPoint.district ? `, ${order.pickupPoint.district}` : ""}</p>
                <p className="text-slate-600">{t.success.pickupNote}</p>
              </div>
            ) : null}
            <div className="flex justify-between pt-1 text-sm font-bold"><span className="text-slate-900">{t.success.total}</span><span className="text-indigo-700">{money(order.totalMinor)}</span></div>

            {order.paymentClaimStatus === "cod_due" ? (
              <div className="rounded-xl bg-emerald-50 p-3 text-center">
                <p className="text-[11px] font-semibold text-emerald-800">{t.success.codDueTitle}</p>
                <p className="text-lg font-black text-emerald-900">{money(order.codDueMinor)}</p>
                <p className="text-[11px] text-emerald-700">{t.success.codDueHelp}</p>
              </div>
            ) : (
              <div className="space-y-1 rounded-xl bg-amber-50 p-3 text-center">
                <p className="text-[11px] font-semibold text-amber-800">{t.success.amountDueTitle}</p>
                <p className="text-lg font-black text-amber-900">{money(order.amountDueMinor)}</p>
                <p className="text-[11px] leading-relaxed text-amber-800">
                  {t.success.amountDueHelpPrefix}<b>{t.success.amountDueHelpBold}</b>{t.success.amountDueHelpSuffix}
                </p>
              </div>
            )}
          </div>
        ) : loaded ? (
          <div className="rounded-2xl border bg-slate-50 p-4 text-xs leading-relaxed text-slate-600">
            {orderNumber
              ? <>{t.success.genericWithNumberPrefix}<b>{orderNumber}</b>{t.success.genericWithNumberSuffix}</>
              : t.success.genericNoNumber}
          </div>
        ) : null}

        {loaded && order?.hasDigitalItems ? (
          <div className="rounded-2xl border border-sky-200 bg-sky-50 p-4 text-sm font-semibold text-sky-900">
            ডিজিটাল পণ্য: ডেলিভারির পর ট্র্যাকিং পেজে ডাউনলোড লিংক পাওয়া যাবে
          </div>
        ) : null}

        {loaded && order?.yourReferralCode ? (
          <div className="rounded-2xl border border-indigo-200 bg-indigo-50 p-4 text-sm font-bold text-indigo-900">
            🎁 {t.success.yourReferralCodePrefix}<span className="font-mono">{order.yourReferralCode}</span>{t.success.yourReferralCodeSuffix}
          </div>
        ) : null}

        {paymentVerifying ? (
          <div className="rounded-2xl border border-sky-200 bg-sky-50 p-4 text-left text-xs leading-relaxed text-sky-900">
            <p className="font-bold">আপনার পেমেন্ট যাচাই করা হচ্ছে…</p>
            <p>গেটওয়ে থেকে ফিরে এসেছেন — পেমেন্ট সফল ধরা হবে শুধু গেটওয়ের সার্ভার-যাচাই (IPN) পৌঁছালে। যাচাই সম্পন্ন হলে অর্ডারের অবস্থা ট্র্যাকিং পেজে হালনাগাদ দেখা যাবে। ফিরে আসা মানেই পেমেন্ট সফল নয়।</p>
          </div>
        ) : null}

        {loaded && order?.orderId && payOnlineAvailable(payOptions) ? (
          <div className="space-y-2 rounded-2xl border border-indigo-100 bg-indigo-50/60 p-4 text-left">
            <p className="text-sm font-bold text-slate-800">💳 এখনই অনলাইনে পেমেন্ট করুন</p>
            <p className="text-[11px] leading-relaxed text-slate-500">
              নিচের যেকোনো মাধ্যমে অর্ডারের টাকা এখনই পরিশোধ করতে পারেন। পেমেন্ট সম্পন্ন ধরা হবে গেটওয়ের সার্ভার-যাচাইয়ের পরেই।
            </p>
            {payError ? <p className="rounded-lg bg-red-50 px-3 py-2 text-xs font-medium text-red-600">{payError}</p> : null}
            {payOptions.map((option) => (
              <button
                key={`${option.provider}:${option.source}`}
                type="button"
                disabled={payBusy !== ""}
                onClick={() => void payOnline(option)}
                className="block w-full rounded-xl bg-emerald-600 py-3 text-xs font-semibold text-white hover:bg-emerald-700 disabled:opacity-50"
              >
                {payBusy === `${option.provider}:${option.source}` ? "গেটওয়েতে নিয়ে যাওয়া হচ্ছে…" : `${payOptionLabel(option)} দিয়ে পেমেন্ট করুন`}
              </button>
            ))}
          </div>
        ) : null}

        {orderNumber && trackingEnabled ? (
          <Link href={`/track/${orgSlug}`} className="block w-full rounded-xl bg-indigo-600 py-3 text-xs font-semibold text-white hover:bg-indigo-700">
            📦 {t.success.trackOrder}
          </Link>
        ) : null}

        <Link href={`/shop/${orgSlug}`} className="block w-full rounded-xl bg-slate-900 py-3 text-xs font-semibold text-white hover:bg-black">
          {t.success.continueShopping}
        </Link>
      </div>
    </div>
  );
}

export default function ShopSuccessPage() {
  return (
    <Suspense fallback={<div className="mx-auto max-w-lg px-4 py-16 text-center text-sm font-semibold text-slate-500">{shopT("bn").success.loading}</div>}>
      <SuccessInner />
    </Suspense>
  );
}
