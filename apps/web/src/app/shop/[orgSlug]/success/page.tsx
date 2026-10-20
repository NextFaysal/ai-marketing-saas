"use client";
import React, { Suspense, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useParams, useSearchParams } from "next/navigation";
import { formatMinor, fmtNumber } from "@repo/contracts";
import { API_URL } from "@/lib/api";
import { lastOrderKey, type CheckoutResult } from "@/lib/storefront-cart";
import {
  depositStateLines,
  hasOutstandingMinor,
  initiatePayment,
  isDepositFullyPaid,
  isOnlineCheckoutContext,
  isTerminalPaymentKind,
  paymentStateKind,
  readOnlinePaymentChoice,
  type DepositState,
  type InitiatePurpose,
  type OnlinePaymentOption,
  type PaymentStateKind,
} from "@/lib/checkout-gc10";
import { shopLocaleOf, shopT, type ShopLocale } from "@/lib/shop-i18n";
import { payOnlineAvailable, payOptionLabel, type PayOption } from "@/lib/connections";
import { shouldFireAdsConversion, trackingFromSettings, trackShopEvent } from "@/lib/shop-tracking";

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
  // GB7 (GC18): the whole settings object (carries settings.tracking).
  const [shopSettings, setShopSettings] = useState<unknown>(null);
  // AB4: the shop's online options (fallback payment choice for
  // the deposit/balance buttons when no choice was stored).
  const [shopOnlineOptions, setShopOnlineOptions] = useState<OnlinePaymentOption[]>([]);
  // GB7: true ONLY when `order` came from this browser's
  // sessionStorage — the ?order= query fallback is display-only
  // and must never fire an Ads conversion.
  const sessionOrderRef = useRef(false);
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
      if (raw) {
        setOrder(JSON.parse(raw) as CheckoutResult);
        sessionOrderRef.current = true;
      }
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
        setShopSettings(json?.settings ?? null);
        setShopOnlineOptions(json?.paymentOptions?.online ?? []);
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
      if (!res.ok) throw new Error(json?.message ?? t.successExtra.payStartUnavailable);
      const url = json?.redirectUrl ?? json?.bkashURL;
      if (!url) throw new Error(t.successExtra.gatewayNoLink);
      window.location.href = url;
    } catch (e) {
      // Honest refusal, verbatim from the server — never a fake
      // "payment successful" state.
      setPayError(e instanceof Error ? e.message : t.successExtra.payStartFailed);
      setPayBusy("");
    }
  }

  // Standard E-commerce Purchase tracking for Meta Pixel, TikTok, GA4
  useEffect(() => {
    if (!loaded || !order || !sessionOrderRef.current) return;
    const flagKey = `shopPurchaseFired:${order.orderNumber}`;
    let purchaseAlreadyFired = false;
    try {
      purchaseAlreadyFired = sessionStorage.getItem(flagKey) === "1";
    } catch { /* ignore */ }
    if (!purchaseAlreadyFired) {
      try { sessionStorage.setItem(flagKey, "1"); } catch { /* ignore */ }
      trackShopEvent("Purchase", {
        order_id: order.orderNumber,
        value: Number(order.totalMinor) / 100,
        currency: "BDT",
        content_name: order.shopName || `Order #${order.orderNumber}`,
      });
    }
  }, [loaded, order]);

  // GB7 (GC18): Google Ads conversion — fires at most once per
  // order, only for the genuinely placed order held in this
  // browser's sessionStorage, and only when the merchant
  // configured BOTH the Ads id and the conversion label.
  useEffect(() => {
    if (!loaded || !order || !sessionOrderRef.current) return;
    const tracking = trackingFromSettings(shopSettings);
    let alreadyFired = false;
    try {
      alreadyFired = sessionStorage.getItem(`adsConv:${order.orderNumber}`) === "1";
    } catch { /* storage unavailable — the pure check still gates */ }
    if (!shouldFireAdsConversion({ tracking, order, alreadyFired })) return;
    // Mark BEFORE firing so a re-render can never double-count.
    try {
      sessionStorage.setItem(`adsConv:${order.orderNumber}`, "1");
    } catch { /* ignore — gtag itself dedupes by transaction_id */ }
    const adsId = tracking.googleAdsId as string;
    const label = tracking.googleAdsConversionLabel as string;
    const w = window as unknown as {
      dataLayer?: unknown[];
      gtag?: (...args: unknown[]) => void;
    };
    const fire = () => {
      w.dataLayer = w.dataLayer || [];
      if (typeof w.gtag !== "function") {
        w.gtag = (...args: unknown[]) => {
          (w.dataLayer as unknown[]).push(args);
        };
      }
      w.gtag("config", adsId);
      w.gtag("event", "conversion", {
        send_to: `${adsId}/${label}`,
        value: Number(order.totalMinor) / 100,
        currency: "BDT",
        transaction_id: order.orderNumber,
      });
    };
    if (typeof w.gtag === "function") {
      fire();
      return;
    }
    // gtag.js may already be on its way (layout GA4/GTM tags use
    // the same library queue) — the dataLayer shim is then enough.
    if (document.querySelector('script[src^="https://www.googletagmanager.com/gtag/js"]')) {
      fire();
      return;
    }
    const script = document.createElement("script");
    script.async = true;
    script.src = `https://www.googletagmanager.com/gtag/js?id=${adsId}`;
    script.onload = fire;
    document.head.appendChild(script);
  }, [loaded, order, shopSettings]);

  const orderNumber = order?.orderNumber ?? orderFromQuery;

  // GC10: online-payment polling. The ?payment= flag alone is
  // informational (a gateway browser return proves NOTHING) —
  // only the polled server state "verified_paid" may render as
  // paid. Poll ~4s, max ~30 tries, stop on a terminal state.
  const paymentParam = search.get("payment");
  const onlineContext = isOnlineCheckoutContext(order?.paymentClaimStatus, paymentParam);
  const [payKind, setPayKind] = useState<PaymentStateKind | null>(null);
  // AB4: the raw polled state + its deposit block (the success
  // page renders ONLY from this polled data, never the return).
  const [payStateRaw, setPayStateRaw] = useState<string | null>(null);
  const [payDeposit, setPayDeposit] = useState<DepositState | null>(null);
  const [retrying, setRetrying] = useState(false);
  const [retryError, setRetryError] = useState("");
  // AB4: an order placed with a deposit also polls — its deposit
  // block only exists on the polled state response.
  const pollEnabled = onlineContext || !!order?.deposit;

  useEffect(() => {
    if (!pollEnabled || !order?.orderId || !order?.orderNumber) return;
    let cancelled = false;
    let tries = 0;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const poll = async () => {
      tries += 1;
      try {
        const qs = new URLSearchParams({ orderId: order.orderId!, orderNumber: order.orderNumber! });
        const res = await fetch(`${API_URL}/public/tenant-payments/state/${encodeURIComponent(orgSlug)}?${qs.toString()}`);
        if (res.ok) {
          const data = (await res.json()) as { state?: string; deposit?: DepositState | null };
          const kind = paymentStateKind(data.state);
          if (!cancelled) {
            setPayKind(kind);
            setPayStateRaw(data.state ?? null);
            setPayDeposit(data.deposit ?? null);
          }
          if (isTerminalPaymentKind(kind)) return;
        }
      } catch { /* a failed poll is not a payment result — keep waiting */ }
      if (!cancelled && tries < 30) timer = setTimeout(poll, 4000);
    };
    void poll();
    return () => { cancelled = true; if (timer) clearTimeout(timer); };
  }, [pollEnabled, order?.orderId, order?.orderNumber, orgSlug]);

  // The payment pair for (re)initiation: the pair stored at
  // checkout wins; otherwise the shop's first online option.
  function paymentChoice() {
    return (
      readOnlinePaymentChoice(orgSlug) ??
      (shopOnlineOptions[0] ? { provider: shopOnlineOptions[0].provider, source: shopOnlineOptions[0].source } : null)
    );
  }

  // GC10: retry — re-initiate the SAME stored order with the
  // pair chosen at checkout; redirect to the gateway on success.
  // AB4: a purpose ("deposit" | "balance") scopes the amount.
  async function retryPayment(purpose?: InitiatePurpose) {
    const choice = paymentChoice();
    if (!choice || !order?.orderId || !order?.orderNumber) return;
    setRetrying(true);
    setRetryError("");
    try {
      const redirectUrl = await initiatePayment(orgSlug, {
        orderId: order.orderId,
        orderNumber: order.orderNumber,
        provider: choice.provider,
        source: choice.source,
        ...(purpose ? { purpose } : {}),
      });
      window.location.assign(redirectUrl);
    } catch {
      setRetryError(t.successExtra.payRetryFailed);
      setRetrying(false);
    }
  }

  // Effective display kind: an initiate failure with no txn
  // state yet reads as failed; otherwise the polled kind rules.
  const effectivePayKind: PaymentStateKind =
    payKind ?? (paymentParam === "initiate_failed" ? "failed" : "pending");

  // AB4: deposit display state — all from the POLLED deposit
  // block. deposit_paid never renders the full-paid message.
  const depositPaidState = payStateRaw === "deposit_paid" || payKind === "deposit_paid";
  const depositDueUnpaid =
    !!payDeposit &&
    !depositPaidState &&
    hasOutstandingMinor(payDeposit.outstandingMinor) &&
    !isDepositFullyPaid(payDeposit) &&
    (effectivePayKind === "pending" || effectivePayKind === "none");
  const depositSettledBalanceDue =
    !!payDeposit &&
    hasOutstandingMinor(payDeposit.outstandingMinor) &&
    (depositPaidState || isDepositFullyPaid(payDeposit));

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
            {(order.loyaltyPointsUsed ?? 0) > 0 ? (
              <div className="flex justify-between border-b pb-2"><span className="text-slate-500">{t.successExtra.loyaltyDiscountPrefix}{fmtNumber(locale, order.loyaltyPointsUsed ?? 0)}{t.successExtra.loyaltyDiscountSuffix}</span><span className="font-bold text-emerald-700">− {money(order.loyaltyDiscountMinor ?? "0")}</span></div>
            ) : null}
            {order.giftCardDiscountMinor && BigInt(order.giftCardDiscountMinor) > 0n ? (
              <div className="flex justify-between border-b pb-2"><span className="text-slate-500">{t.successExtra.giftCardDiscount}{order.giftCardCodeLast4 ? ` (••••${order.giftCardCodeLast4})` : ""}:</span><span className="font-bold text-emerald-700">− {money(order.giftCardDiscountMinor)}</span></div>
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

            {/* AB4 (AX5): deposit status from the polled state —
                deposit_paid is NOT the full-paid message. */}
            {payDeposit || depositPaidState ? (
              <div className="space-y-2 rounded-xl bg-amber-50 p-3 text-center">
                {depositPaidState ? (
                  <p className="text-sm font-black text-emerald-900">
                    {t.successExtra.depositPaidPrefix}{payDeposit ? money(payDeposit.outstandingMinor) : ""}{t.successExtra.depositPaidSuffix}
                  </p>
                ) : null}
                {payDeposit ? (
                  <div className="space-y-0.5 text-[11px] font-medium text-amber-900">
                    {depositStateLines(payDeposit, money).map((line) => (
                      <p key={line}>{line}</p>
                    ))}
                  </div>
                ) : null}
                {depositDueUnpaid && paymentChoice() ? (
                  <button type="button" onClick={() => void retryPayment("deposit")} disabled={retrying} className="rounded-lg bg-emerald-600 px-4 py-2 text-xs font-bold text-white hover:bg-emerald-700 disabled:opacity-50">
                    {retrying ? t.successExtra.payStarting : t.successExtra.payDeposit}
                  </button>
                ) : null}
                {depositSettledBalanceDue && !depositDueUnpaid && paymentChoice() ? (
                  <button type="button" onClick={() => void retryPayment("balance")} disabled={retrying} className="rounded-lg bg-indigo-600 px-4 py-2 text-xs font-bold text-white hover:bg-indigo-700 disabled:opacity-50">
                    {retrying ? t.successExtra.payStarting : t.successExtra.payRemaining}
                  </button>
                ) : null}
                {retryError ? <p className="text-[11px] font-medium text-rose-700">{retryError}</p> : null}
              </div>
            ) : null}

            {depositPaidState ? null : onlineContext ? (
              effectivePayKind === "paid" ? (
                <div className="rounded-xl bg-emerald-50 p-3 text-center">
                  <p className="text-sm font-black text-emerald-900">{t.successExtra.verifiedTitle}</p>
                  <p className="text-[11px] text-emerald-700">{t.successExtra.verifiedBody}</p>
                </div>
              ) : effectivePayKind === "failed" || effectivePayKind === "cancelled" ? (
                <div className="space-y-2 rounded-xl bg-rose-50 p-3 text-center">
                  <p className="text-sm font-black text-rose-900">{t.successExtra.notCompletedTitle}</p>
                  <p className="text-[11px] text-rose-700">{t.successExtra.notCompletedBody}</p>
                  {readOnlinePaymentChoice(orgSlug) ? (
                    <button type="button" onClick={() => void retryPayment()} disabled={retrying} className="rounded-lg bg-rose-600 px-4 py-2 text-xs font-bold text-white hover:bg-rose-700 disabled:opacity-50">
                      {retrying ? t.successExtra.payStarting : t.successExtra.payAgain}
                    </button>
                  ) : null}
                  {retryError ? <p className="text-[11px] font-medium text-rose-700">{retryError}</p> : null}
                </div>
              ) : (
                <div className="rounded-xl bg-amber-50 p-3 text-center">
                  <p className="text-sm font-black text-amber-900">{t.successExtra.verifyingTitle}</p>
                  <p className="text-[11px] text-amber-700">{t.successExtra.verifyingBody}</p>
                </div>
              )
            ) : order.paymentClaimStatus === "cod_due" ? (
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
            {t.successExtra.digitalNote}
          </div>
        ) : null}

        {loaded && order?.yourReferralCode ? (
          <div className="rounded-2xl border border-indigo-200 bg-indigo-50 p-4 text-sm font-bold text-indigo-900">
            🎁 {t.success.yourReferralCodePrefix}<span className="font-mono">{order.yourReferralCode}</span>{t.success.yourReferralCodeSuffix}
          </div>
        ) : null}

        {paymentVerifying ? (
          <div className="rounded-2xl border border-sky-200 bg-sky-50 p-4 text-left text-xs leading-relaxed text-sky-900">
            <p className="font-bold">{t.successExtra.verifyingWaitTitle}</p>
            <p>{t.successExtra.verifyingWaitBody}</p>
          </div>
        ) : null}

        {loaded && order?.orderId && payOnlineAvailable(payOptions) ? (
          <div className="space-y-2 rounded-2xl border border-indigo-100 bg-indigo-50/60 p-4 text-left">
            <p className="text-sm font-bold text-slate-800">{t.successExtra.payNowTitle}</p>
            <p className="text-[11px] leading-relaxed text-slate-500">
              {t.successExtra.payNowBody}
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
                {payBusy === `${option.provider}:${option.source}` ? t.successExtra.redirecting : t.successExtra.payWith.replace("{method}", payOptionLabel(option))}
              </button>
            ))}
          </div>
        ) : null}

        {/* Bangladeshi Fashion & Apparel Assurance */}
        <div className="rounded-2xl border border-stone-200 bg-stone-50/70 p-4 text-left">
          <p className="text-xs font-bold text-stone-900">{t.successExtra.fashionCareTitle}</p>
          <ul className="mt-2 space-y-1.5 text-[11px] text-stone-600">
            <li className="flex items-center gap-1.5">
              <span className="text-emerald-600 font-bold">✓</span>
              <span><strong>{t.successExtra.sizeExchangePrefix}</strong>{t.successExtra.sizeExchangeBody}</span>
            </li>
            <li className="flex items-center gap-1.5">
              <span className="text-emerald-600 font-bold">✓</span>
              <span><strong>{t.successExtra.fastDeliveryPrefix}</strong>{t.successExtra.fastDeliveryBody}</span>
            </li>
            <li className="flex items-center gap-1.5">
              <span className="text-emerald-600 font-bold">✓</span>
              <span><strong>{t.successExtra.supportPrefix}</strong>{t.successExtra.supportBody}</span>
            </li>
          </ul>
        </div>

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
