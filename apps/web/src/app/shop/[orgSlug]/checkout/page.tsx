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
  type CheckoutResult,
  type PickupPoint,
  type Quote,
} from "@/lib/storefront-cart";
import { shopLocaleOf, shopT, type ShopLocale } from "@/lib/shop-i18n";
import { captchaSiteKeyFor, termsHrefFor, type CheckoutTrust } from "@/lib/orders-gb3";
import {
  depositKindForPaymentMethod,
  depositSummaryLines,
  initiatePayment,
  onlineOptionLabel,
  onlineSelectionValue,
  parseOnlineSelection,
  saveOnlinePaymentChoice,
  type OnlinePaymentOption,
} from "@/lib/checkout-gc10";
import {
  buildFieldAnswers,
  missingRequiredFields,
  normalizeCheckoutFields,
  type FieldAnswers,
} from "@/lib/checkout-fields";
import { CheckoutFieldsSection } from "@/components/CheckoutFieldsSection";
import { TurnstileWidget, useIdempotencyKey } from "@/components/TurnstileWidget";
import { fetchMe, getShopSession } from "@/lib/storefront-account";
import { CrossSellRail } from "../CrossSellRail";
import { captureAffiliateRef, currentAffiliateCode } from "@/lib/affiliate-ref";
import { getAttributionForCheckout, trackShopEvent } from "@/lib/shop-tracking";
import { getDeviceHashForCheckout } from "@/lib/device-hash";
import { effectiveThemeId, isV2Theme } from "@/lib/shop-theme";
import { setBuyBarActive, setBuyBarLiftPx } from "@/lib/shop-bottom-chrome";

interface ShopPublic {
  businessProfile: { codAvailable: boolean; bkashNumber: string | null; nagadNumber: string | null; paymentNote: string | null };
  settings?: {
    locale?: string;
    // ED9: the public shop payload DOES carry settings.themeId
    // (API shopHome returns `themeId: setting.themeId ??
    // "classic"` — verified in apps/api storefront.service.ts);
    // the client type simply omitted it until now.
    themeId?: string;
    trackingPageEnabled?: boolean;
    returnPolicyText?: string | null;
    deliveryPromiseText?: string | null;
    supportPhone?: string | null;
    // EC29: gift-wrap offer.
    giftWrapEnabled?: boolean;
    giftWrapFeeMinor?: string | null;
  };
  // GB3 (GC8): checkout trust block (settings-level sibling).
  checkoutTrust?: CheckoutTrust;
  // GC10: real online-payment options (top level of shopHome).
  paymentOptions?: { online: OnlinePaymentOption[] };
  // AB4 (AX5): the org's custom checkout fields for this surface.
  checkoutFields?: unknown;
}

function money(minor: string): string {
  try {
    return formatMinor(BigInt(minor));
  } catch {
    return minor;
  }
}

/**
 * ED9 (v2 only): visual step chrome inserted BEFORE an existing
 * checkout section — a numbered badge + label + connector rule.
 * It re-parents nothing: the section it heads keeps its exact
 * place, fields and handlers.
 */
function CheckoutStepHeader({ n, label, locale }: { n: number; label: string; locale: ShopLocale }) {
  const bnDigits = "০১২৩৪৫৬৭৮৯";
  const num = locale === "bn" ? String(n).replace(/\d/g, (d) => bnDigits[Number(d)]) : String(n);
  return (
    <div className="flex items-center gap-2 pt-1">
      <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-[var(--brand)] text-xs font-black text-white">{num}</span>
      <span className="text-xs font-black text-[var(--ink-strong)]">{label}</span>
      <span className="h-px flex-1 bg-[var(--border-soft)]" aria-hidden="true" />
    </div>
  );
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
  const [paymentMethod, setPaymentMethod] = useState<string>("cod");
  const [advanceNote, setAdvanceNote] = useState("");
  const [note, setNote] = useState("");
  // EC29: gift wrap + message.
  const [giftWrap, setGiftWrap] = useState(false);
  const [giftMessage, setGiftMessage] = useState("");

  const [quote, setQuote] = useState<Quote | null>(null);
  const [quoteError, setQuoteError] = useState("");
  const [quoteLoading, setQuoteLoading] = useState(false);
  // AB1: loyalty points redemption. `loyaltyApplied` is the
  // points count sent with quote/checkout requests (0 = none).
  // `loyaltyBalance` is learned from a quote response — the API
  // only carries the loyalty object on a quote that asked for
  // points, so a separate 1-point probe quote (below) discovers
  // the balance for the entered phone without changing the
  // totals of the quote actually shown.
  const [loyaltyInput, setLoyaltyInput] = useState("");
  const [loyaltyApplied, setLoyaltyApplied] = useState(0);
  const [loyaltyBalance, setLoyaltyBalance] = useState<number | null>(null);
  const loyaltyProbedPhone = useRef("");
  // AB2: gift-card code redemption — mirrors the loyalty pattern:
  // `giftCardApplied` is the code sent with quote/checkout
  // requests ("" = none); the priced result comes back on the
  // quote itself as `giftCard`.
  const [giftCardInput, setGiftCardInput] = useState("");
  const [giftCardApplied, setGiftCardApplied] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");
  const quoteSeq = useRef(0);
  // GB3 (GC8): terms consent + Turnstile token + idempotency key.
  const [termsAccepted, setTermsAccepted] = useState(false);
  const [captchaToken, setCaptchaToken] = useState<string | null>(null);
  const idempotency = useIdempotencyKey();
  // ED9: v2 gating + sticky-bar plumbing. The gate is the shop
  // payload's settings.themeId (see ShopPublic note), run
  // through effectiveThemeId with the ?themePreview= value read
  // from the URL — the same effective-theme rule the shop layout
  // applies server-side via its preview header.
  const [previewId, setPreviewId] = useState<string | null>(null);
  const submitBtnRef = useRef<HTMLButtonElement | null>(null);
  const stickyBarRef = useRef<HTMLDivElement | null>(null);
  const [submitInView, setSubmitInView] = useState(true);

  // EC18: delivery slot picker (slots arrive on the quote).
  const [slotId, setSlotId] = useState("");
  const [slotDate, setSlotDate] = useState("");

  // AB4 (AX5): custom checkout-field answers + the placed order
  // when it carries a deposit (the deposit offer panel replaces
  // the instant navigation for COD/manual placements).
  const [fieldAnswers, setFieldAnswers] = useState<FieldAnswers>({});
  const [placedDeposit, setPlacedDeposit] = useState<CheckoutResult | null>(null);
  const [depositOption, setDepositOption] = useState("");
  const [depositBusy, setDepositBusy] = useState(false);
  const [depositError, setDepositError] = useState("");

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
  const isV2 = isV2Theme(effectiveThemeId(shop?.settings?.themeId, previewId));

  useEffect(() => {
    try {
      setPreviewId(new URLSearchParams(window.location.search).get("themePreview"));
    } catch { /* no preview */ }
  }, []);

  // ED9: sticky-bar visibility — hide the bar while the main
  // place-order button is on screen (IntersectionObserver on
  // that button). Fallback (no IO): the bar stays always-on.
  useEffect(() => {
    if (!isV2 || loading) return;
    const el = submitBtnRef.current;
    if (!el || typeof IntersectionObserver === "undefined") {
      setSubmitInView(false);
      return;
    }
    const io = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) setSubmitInView(entry.isIntersecting);
      },
      { threshold: 0 },
    );
    io.observe(el);
    return () => io.disconnect();
  }, [isV2, loading, cart]);

  const stickyBarVisible = isV2 && !!quote && !submitInView && !placedDeposit;

  // ED9: while the sticky bar shows it owns the bottom edge —
  // the v2 bottom nav yields via setBuyBarActive, and overlays
  // lift by the bar's measured height. Both clear on hide/unmount.
  useEffect(() => {
    if (!stickyBarVisible) return;
    setBuyBarActive(true);
    const measure = () => setBuyBarLiftPx(stickyBarRef.current?.offsetHeight || 64);
    measure();
    window.addEventListener("resize", measure);
    return () => {
      window.removeEventListener("resize", measure);
      setBuyBarActive(false);
      setBuyBarLiftPx(0);
    };
  }, [stickyBarVisible]);
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
        if (c && c.items && c.items.length > 0) {
          const totalVal =
            c.items.reduce(
              (acc, it) => acc + Number(it.unitPriceMinor || 0) * (it.quantity || 1),
              0,
            ) / 100;
          trackShopEvent("InitiateCheckout", {
            content_name: c.items.map((i) => i.productName || "").filter(Boolean).join(", "),
            content_ids: c.items.map((i) => i.productId),
            value: totalVal,
            num_items: c.items.reduce((acc, it) => acc + (it.quantity || 1), 0),
            currency: "BDT",
          });
        }
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
        ...(loyaltyApplied > 0 ? { loyaltyPoints: loyaltyApplied } : {}),
        ...(giftCardApplied ? { giftCardCode: giftCardApplied } : {}),
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
  }, [orgSlug, district, couponCode, referralCode, phone, locale, giftWrap, deliveryMethod, pickupPointId, loyaltyApplied, giftCardApplied]);

  useEffect(() => {
    if (loading || !cart || (cart.items.length === 0 && (cart.bundleItems ?? []).length === 0)) return;
    const t = setTimeout(refreshQuote, 350);
    return () => clearTimeout(t);
  }, [refreshQuote, loading, cart]);

  // AB1: keep the known balance in sync with any quote that
  // carries the loyalty object (i.e. once points are applied).
  useEffect(() => {
    if (quote?.loyalty) {
      setLoyaltyBalance(quote.loyalty.balance);
      loyaltyProbedPhone.current = phone.trim();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [quote]);

  // AB1: balance discovery probe. The quote only carries the
  // loyalty object when points were requested, so before the
  // shopper applies anything we ask once per phone with a
  // 1-point quote and read ONLY its balance — the displayed
  // quote is never replaced by the probe's totals. A null
  // loyalty object (program off / unknown phone) records 0 so
  // the probe does not repeat and no control is shown.
  useEffect(() => {
    const buyerPhone = phone.trim();
    if (loading || !cart || loyaltyApplied > 0) return;
    if (buyerPhone.length < 11 || loyaltyProbedPhone.current === buyerPhone) return;
    const token = getCartToken(orgSlug);
    if (!token || !district) return;
    loyaltyProbedPhone.current = buyerPhone;
    (async () => {
      try {
        const q = await requestQuote(orgSlug, {
          cartToken: token,
          district,
          buyerPhone,
          loyaltyPoints: 1,
        });
        setLoyaltyBalance(q.loyalty?.balance ?? 0);
        if (q.loyalty && q.loyalty.balance > 0) {
          setLoyaltyInput((prev) => prev || String(q.loyalty!.balance));
        }
      } catch {
        setLoyaltyBalance(0);
      }
    })();
  }, [orgSlug, phone, loading, cart, district, loyaltyApplied]);

  function applyLoyalty() {
    const balance = quote?.loyalty?.balance ?? loyaltyBalance ?? 0;
    const parsed = Number.parseInt(loyaltyInput, 10);
    if (!Number.isFinite(parsed)) return;
    setLoyaltyApplied(Math.max(0, Math.min(balance, parsed)));
  }

  function removeLoyalty() {
    setLoyaltyApplied(0);
  }

  // AB2: applying a code just re-runs the quote with it — a
  // refusal comes back through the same quoteError path coupon
  // errors use, carrying the API's Bengali message verbatim.
  function applyGiftCard() {
    const code = giftCardInput.trim();
    if (!code) return;
    setGiftCardApplied(code);
  }

  function removeGiftCard() {
    setGiftCardApplied("");
    setGiftCardInput("");
  }

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
    const trust = shop?.checkoutTrust;
    if (trust?.termsRequired && !termsAccepted) {
      setError(t.checkout.termsRequiredError);
      return;
    }
    if (captchaSiteKeyFor(trust, "checkout") && !captchaToken) {
      setError(t.checkout.captchaRequiredError);
      return;
    }
    if (quote?.codRules?.unavailableForTotal && paymentMethod === "cod") {
      setError(t.checkout.codUnavailableNote);
      return;
    }
    // AB4: required custom fields must be answered.
    const checkoutFieldDefs = normalizeCheckoutFields(shop?.checkoutFields);
    const missingFields = missingRequiredFields(checkoutFieldDefs, fieldAnswers);
    if (missingFields.length > 0) {
      setError(`এই তথ্যগুলো আবশ্যক: ${missingFields.join(", ")}`);
      return;
    }
    setSubmitting(true);
    setError("");
    // GC10: an `online:{source}:{provider}` radio value means a
    // real gateway payment follows placement.
    const onlineSel = parseOnlineSelection(paymentMethod);
    try {
      // Contact first (abandonment + order email), then the order.
      const contact: { phone: string; email?: string } = { phone: phone.trim() };
      if (email.trim()) contact.email = email.trim();
      await setCartContact(orgSlug, contact).catch(() => undefined);
      // AB8 (AX27): weak device signal for the fraud guard —
      // omitted entirely when the hash cannot be computed.
      const deviceHash = await getDeviceHashForCheckout();
      const out = await placeCheckout(orgSlug, {
        cartToken: token,
        name: name.trim(),
        phone: phone.trim(),
        address: address.trim(),
        district,
        couponCode: couponCode.trim() || undefined,
        referralCode: referralCode.trim() || undefined,
        // AB1: the same points the last quote priced — the
        // server re-prices and clamps at placement.
        ...(loyaltyApplied > 0 ? { loyaltyPoints: loyaltyApplied } : {}),
        // AB2: the same gift-card code the last quote priced.
        ...(giftCardApplied ? { giftCardCode: giftCardApplied } : {}),
        // EC32: a stored partner ref (the window governs; the
        // server re-validates) — not cleared after purchase.
        affiliateCode: currentAffiliateCode(orgSlug) || undefined,
        paymentMethod: onlineSel ? undefined : (paymentMethod as "cod" | "bkash" | "nagad"),
        ...(onlineSel ? { onlinePayment: onlineSel } : {}),
        note: note.trim() || undefined,
        advanceNote: !onlineSel && paymentMethod !== "cod" ? advanceNote.trim() || undefined : undefined,
        ...(slotId && slotDate && deliveryMethod !== "pickup" ? { deliverySlotId: slotId, deliveryDate: slotDate } : {}),
        ...(giftWrap ? { giftWrap: true, giftMessage: giftMessage.trim() || undefined } : {}),
        deliveryMethod,
        ...(deliveryMethod === "pickup" ? { pickupPointId } : {}),
        // GB3 (GC8): consent + idempotency on every submit; the
        // captcha token only when one was produced.
        termsAccepted,
        idempotencyKey: idempotency.key,
        ...(captchaToken ? { captchaToken } : {}),
        // AB4: custom-field answers (omitted entirely when the
        // org defines none or nothing was answered).
        ...(buildFieldAnswers(checkoutFieldDefs, fieldAnswers)
          ? { fieldAnswers: buildFieldAnswers(checkoutFieldDefs, fieldAnswers) }
          : {}),
        // AB7 (AX19): first-touch attribution from the tracking
        // storage — the key is omitted entirely when empty.
        ...(getAttributionForCheckout()
          ? { attribution: getAttributionForCheckout() }
          : {}),
        // AB8 (AX27): device hash (omitted when unavailable).
        ...(deviceHash ? { deviceHash } : {}),
      });
      idempotency.reset();
      try {
        sessionStorage.setItem(lastOrderKey(orgSlug), JSON.stringify(out));
      } catch { /* session storage unavailable — success page falls back to the query param */ }
      clearCartToken(orgSlug);
      if (onlineSel) {
        // GC10: the result is stored BEFORE navigating (the
        // success page polls from it), the chosen pair is kept
        // for its retry button, and only then initiation runs.
        // An initiate failure still lands on the success page —
        // the order exists and is honestly unpaid.
        // AB4: with a deposit on the order, the FIRST initiation
        // collects the deposit only (purpose "deposit").
        saveOnlinePaymentChoice(orgSlug, onlineSel);
        try {
          const redirectUrl = await initiatePayment(orgSlug, {
            orderId: out.orderId!,
            orderNumber: out.orderNumber,
            provider: onlineSel.provider,
            source: onlineSel.source,
            ...(out.deposit ? { purpose: "deposit" as const } : {}),
          });
          window.location.assign(redirectUrl);
          return;
        } catch {
          router.push(`/shop/${orgSlug}/success?order=${encodeURIComponent(out.orderNumber)}&payment=initiate_failed`);
          return;
        }
      }
      // AB4: a non-online placement with a deposit stays here for
      // the deposit offer / manual instructions panel instead of
      // navigating straight to the success page.
      if (out.deposit) {
        const firstOnline = shop?.paymentOptions?.online?.[0];
        if (firstOnline) setDepositOption(onlineSelectionValue(firstOnline));
        setPlacedDeposit(out);
        return;
      }
      router.push(`/shop/${orgSlug}/success?order=${encodeURIComponent(out.orderNumber)}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : t.checkout.orderErrorFallback);
    } finally {
      setSubmitting(false);
    }
  }

  // AB4: pay the placed order's deposit now via a chosen online
  // option (purpose "deposit"); failure lands on the success page
  // honestly unpaid, exactly like a GC10 initiate failure.
  async function payDepositNow() {
    if (!placedDeposit?.orderId) return;
    const sel = parseOnlineSelection(depositOption);
    if (!sel) return;
    setDepositBusy(true);
    setDepositError("");
    saveOnlinePaymentChoice(orgSlug, sel);
    try {
      const redirectUrl = await initiatePayment(orgSlug, {
        orderId: placedDeposit.orderId,
        orderNumber: placedDeposit.orderNumber,
        provider: sel.provider,
        source: sel.source,
        purpose: "deposit",
      });
      window.location.assign(redirectUrl);
    } catch {
      router.push(`/shop/${orgSlug}/success?order=${encodeURIComponent(placedDeposit.orderNumber)}&payment=initiate_failed`);
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

  // AB4: the order is placed and carries a deposit — show the
  // deposit step (online pay-now when a gateway exists, truthful
  // manual instructions otherwise) instead of the checkout form.
  if (placedDeposit?.deposit) {
    const dep = placedDeposit.deposit;
    const onlineOptions = shop?.paymentOptions?.online ?? [];
    return (
      <div className="mx-auto max-w-md px-4 py-16">
        <div className="space-y-4 rounded-2xl border bg-white p-8 shadow-sm">
          <div className="text-center">
            <p className="text-4xl">✅</p>
            <h1 className="mt-2 text-lg font-black text-slate-900">অর্ডার গ্রহণ করা হয়েছে</h1>
            <p className="mt-1 text-sm text-slate-500">অর্ডার নম্বর: <b className="font-mono">{placedDeposit.orderNumber}</b></p>
          </div>
          <div className="space-y-1.5 rounded-xl bg-amber-50 p-4 text-sm text-amber-900">
            <div className="flex justify-between"><span>মোট</span><span className="font-bold">{money(placedDeposit.totalMinor)}</span></div>
            <div className="flex justify-between"><span>এখন পরিশোধ (ডিপোজিট)</span><span className="font-black">{money(dep.amountMinor)}</span></div>
            <div className="flex justify-between"><span>ডেলিভারিতে বাকি</span><span className="font-bold">{money(dep.dueAfterMinor)}</span></div>
            {dep.note ? <p className="pt-1 text-xs leading-relaxed">{dep.note}</p> : null}
          </div>
          {placedDeposit.paymentMethod === "cod" && onlineOptions.length > 0 ? (
            <div className="space-y-2">
              <label className="block text-xs font-bold text-slate-700">অনলাইন পেমেন্টের মাধ্যম</label>
              <select value={depositOption} onChange={(e) => setDepositOption(e.target.value)} className="w-full rounded-xl border border-slate-300 p-2.5 text-sm focus:border-indigo-600 focus:outline-none">
                {onlineOptions.map((option) => (
                  <option key={onlineSelectionValue(option)} value={onlineSelectionValue(option)}>{onlineOptionLabel(option)}</option>
                ))}
              </select>
              <button type="button" onClick={payDepositNow} disabled={depositBusy} className="w-full rounded-2xl bg-emerald-600 py-3 text-sm font-extrabold text-white hover:bg-emerald-700 disabled:opacity-50">
                {depositBusy ? "পেমেন্ট শুরু হচ্ছে…" : "ডিপোজিট এখনই পরিশোধ করুন"}
              </button>
              {depositError ? <p className="rounded-lg bg-rose-50 px-3 py-2 text-xs font-medium text-rose-700">{depositError}</p> : null}
            </div>
          ) : (
            <div className="space-y-1.5 rounded-xl bg-slate-50 p-4 text-sm text-slate-700">
              <p className="font-bold text-slate-900">ডিপোজিট পাঠানোর মাধ্যম</p>
              {dep.note ? <p className="text-xs leading-relaxed">{dep.note}</p> : null}
              {shop?.businessProfile?.bkashNumber ? (
                <p className="text-xs">বিকাশ: <span className="font-mono font-bold">{shop.businessProfile.bkashNumber}</span></p>
              ) : null}
              {shop?.businessProfile?.nagadNumber ? (
                <p className="text-xs">নগদ: <span className="font-mono font-bold">{shop.businessProfile.nagadNumber}</span></p>
              ) : null}
              {shop?.businessProfile?.paymentNote ? (
                <p className="text-xs leading-relaxed">{shop.businessProfile.paymentNote}</p>
              ) : null}
              {!shop?.businessProfile?.bkashNumber && !shop?.businessProfile?.nagadNumber && !shop?.businessProfile?.paymentNote && !dep.note ? (
                <p className="text-xs">ডিপোজিট পাঠানোর মাধ্যম জানতে দোকান আপনার সাথে যোগাযোগ করবে।</p>
              ) : null}
            </div>
          )}
          <button
            type="button"
            onClick={() => router.push(`/shop/${orgSlug}/success?order=${encodeURIComponent(placedDeposit.orderNumber)}`)}
            className="block w-full rounded-xl bg-slate-900 py-3 text-center text-xs font-semibold text-white hover:bg-black"
          >
            অর্ডারের বিবরণ দেখুন
          </button>
        </div>
      </div>
    );
  }

  const bp = shop?.businessProfile;
  const showBkash = !!bp?.bkashNumber;
  const showNagad = !!bp?.nagadNumber;
  const freeDelivery = quote ? BigInt(quote.deliveryMinor) === 0n : false;
  // AB1: the redeem control shows only with a known positive
  // balance (from the probe quote or an applied-points quote).
  const loyaltyBal = quote?.loyalty?.balance ?? loyaltyBalance;

  return (
    <div className="mx-auto max-w-5xl px-4 py-8 sm:px-6">
      <h1 className="mb-6 text-2xl font-black text-slate-900">{t.checkout.title}</h1>
      <form onSubmit={submit} className="grid gap-6 md:grid-cols-12">
        <div className="space-y-4 rounded-2xl border border-slate-200 bg-white p-6 shadow-sm md:col-span-7">
          {isV2 ? <CheckoutStepHeader n={1} label={t.checkout.stepInfo} locale={locale} /> : null}
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
          {/* ED9 (v2): step 2 heads the delivery-method block;
              the delivery-slot picker stays in the summary column
              exactly where it was — nothing is moved. */}
          {isV2 ? <CheckoutStepHeader n={2} label={t.checkout.stepDelivery} locale={locale} /> : null}
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
            {/* ED9 (v2): inline form of the existing pickup error
                (the banner in the summary stays as fallback). */}
            {isV2 && error === t.checkout.pickupRequired ? (
              <p className="text-xs font-medium text-rose-600">{error}</p>
            ) : null}
          </div>
          <div>
            <label className="mb-1 block text-[11px] font-semibold text-slate-500">{t.checkout.noteLabel}</label>
            <input value={note} onChange={(e) => setNote(e.target.value)} placeholder={t.checkout.notePlaceholder} className="w-full rounded-lg border border-slate-200 p-2 text-sm" />
          </div>

          {/* AB4 (AX5): the org's custom checkout fields. */}
          <CheckoutFieldsSection
            defs={normalizeCheckoutFields(shop?.checkoutFields)}
            answers={fieldAnswers}
            onChange={(k, v) => setFieldAnswers((prev) => ({ ...prev, [k]: v }))}
          />
          {/* ED9 (v2): the existing missing-required-fields error,
              also shown at the field group it belongs to. */}
          {isV2 && error.startsWith("এই তথ্যগুলো আবশ্যক:") ? (
            <p className="text-xs font-medium text-rose-600">{error}</p>
          ) : null}

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

          {isV2 ? <CheckoutStepHeader n={3} label={t.checkout.stepPayment} locale={locale} /> : null}
          <div className="space-y-2 border-t pt-4">
            <label className="block text-xs font-bold text-slate-700">{t.checkout.paymentMethodLabel}</label>
            <label className={`flex items-center gap-2 rounded-xl border border-emerald-300 bg-emerald-50/60 p-3 text-sm font-bold text-emerald-950 ${quote?.codRules?.unavailableForTotal ? "cursor-not-allowed opacity-50" : "cursor-pointer"}`}>
              <input type="radio" name="pay" checked={paymentMethod === "cod"} disabled={!!quote?.codRules?.unavailableForTotal} onChange={() => setPaymentMethod("cod")} />
              {t.checkout.codLabel}
            </label>
            {quote?.codRules?.unavailableForTotal ? (
              <p className="rounded-lg bg-amber-50 px-3 py-2 text-xs font-medium text-amber-800">{t.checkout.codUnavailableNote}</p>
            ) : null}
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
            {/* GC10: real online gateway options (own/platform),
                from the shop payload's real gates — never Nagad. */}
            {(shop?.paymentOptions?.online ?? []).map((option) => {
              const value = onlineSelectionValue(option);
              return (
                <label key={value} className="flex cursor-pointer items-center gap-2 rounded-xl border border-sky-300 bg-sky-50/60 p-3 text-sm font-bold text-sky-950">
                  <input type="radio" name="pay" checked={paymentMethod === value} onChange={() => setPaymentMethod(value)} />
                  {onlineOptionLabel(option)}
                  {option.sandbox ? (
                    <span className="rounded-full bg-amber-100 px-2 py-0.5 text-[10px] font-black text-amber-800">স্যান্ডবক্স</span>
                  ) : null}
                </label>
              );
            })}
            {paymentMethod !== "cod" && !parseOnlineSelection(paymentMethod) ? (
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
          <div className={isV2 ? "space-y-4 rounded-[var(--radius-xl)] border border-[var(--border-soft)] bg-[var(--surface)] p-6 shadow-[var(--shadow-card)]" : "space-y-4 rounded-2xl border border-slate-200 bg-white p-6 shadow-sm"}>
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

            {/* AB1: loyalty points redeem — only with a positive
                balance; applying re-quotes with loyaltyPoints and
                the discount comes back on the quote itself. */}
            {loyaltyBal != null && loyaltyBal > 0 ? (
              <div className="space-y-2 rounded-xl border border-violet-200 bg-violet-50/50 p-3">
                <p className="text-xs font-bold text-violet-900">⭐ লয়্যালটি পয়েন্ট</p>
                <p className="text-xs text-slate-600">
                  আপনার ব্যালেন্স: <b className="text-slate-900">{loyaltyBal} পয়েন্ট</b>
                  {quote?.loyalty && quote.loyalty.pointsApplied > 0 ? (
                    <> · ছাড় পেয়েছেন: <b className="text-emerald-700">− {money(quote.loyalty.discountMinor)}</b></>
                  ) : null}
                </p>
                <div className="flex gap-2">
                  <input
                    type="number"
                    min={0}
                    max={loyaltyBal}
                    value={loyaltyInput}
                    onChange={(e) => setLoyaltyInput(e.target.value)}
                    placeholder="কত পয়েন্ট ব্যবহার করবেন"
                    className="w-full rounded-xl border border-violet-300 bg-white px-3 py-2 text-sm focus:border-violet-500 focus:outline-none"
                  />
                  <button
                    type="button"
                    onClick={applyLoyalty}
                    className="shrink-0 rounded-xl bg-violet-600 px-4 py-2 text-xs font-bold text-white hover:bg-violet-700"
                  >
                    প্রয়োগ করুন
                  </button>
                </div>
                {loyaltyApplied > 0 ? (
                  <div className="flex items-center justify-between gap-2">
                    <p className="text-xs font-medium text-emerald-700">
                      {quote?.loyalty
                        ? `${quote.loyalty.pointsApplied} পয়েন্ট প্রয়োগ হয়েছে — ছাড় ${money(quote.loyalty.discountMinor)}`
                        : `${loyaltyApplied} পয়েন্ট প্রয়োগ করা হয়েছে — হিসাব আসছে…`}
                    </p>
                    <button type="button" onClick={removeLoyalty} className="shrink-0 text-xs font-bold text-rose-600 hover:underline">
                      সরিয়ে দিন
                    </button>
                  </div>
                ) : null}
              </div>
            ) : null}

            {/* AB2: gift-card code — applying re-quotes with the
                code; the priced discount comes back on the quote
                itself and a refusal surfaces via quoteError. */}
            <div className="space-y-2 rounded-xl border border-pink-200 bg-pink-50/50 p-3">
              <p className="text-xs font-bold text-pink-900">🎁 গিফট কার্ড</p>
              <div className="flex gap-2">
                <input
                  value={giftCardInput}
                  onChange={(e) => setGiftCardInput(e.target.value)}
                  placeholder="গিফট কার্ডের কোড লিখুন"
                  className="w-full rounded-xl border border-pink-300 bg-white px-3 py-2 font-mono text-sm uppercase focus:border-pink-500 focus:outline-none"
                />
                <button
                  type="button"
                  onClick={applyGiftCard}
                  disabled={!giftCardInput.trim()}
                  className="shrink-0 rounded-xl bg-pink-600 px-4 py-2 text-xs font-bold text-white hover:bg-pink-700 disabled:opacity-50"
                >
                  প্রয়োগ করুন
                </button>
              </div>
              {giftCardApplied ? (
                <div className="flex items-center justify-between gap-2">
                  <p className="text-xs font-medium text-emerald-700">
                    {quote?.giftCard
                      ? `কার্ড ••••${quote.giftCard.codeLast4} প্রয়োগ হয়েছে — ছাড় ${money(quote.giftCard.discountMinor)} (কার্ডে অবশিষ্ট ${money(quote.giftCard.balanceMinor)})`
                      : "কোড প্রয়োগ করা হয়েছে — হিসাব আসছে…"}
                  </p>
                  <button type="button" onClick={removeGiftCard} className="shrink-0 text-xs font-bold text-rose-600 hover:underline">
                    সরিয়ে দিন
                  </button>
                </div>
              ) : null}
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
                {quote.loyalty && quote.loyalty.pointsApplied > 0 ? (
                  <div className="flex justify-between text-emerald-700"><span>লয়্যালটি পয়েন্ট ছাড় ({quote.loyalty.pointsApplied} পয়েন্ট):</span><span className="font-semibold">− {money(quote.loyalty.discountMinor)}</span></div>
                ) : null}
                {quote.giftCard && BigInt(quote.giftCard.discountMinor) > 0n ? (
                  <div className="flex justify-between text-emerald-700"><span>গিফট কার্ড ছাড় (••••{quote.giftCard.codeLast4}):</span><span className="font-semibold">− {money(quote.giftCard.discountMinor)}</span></div>
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
                {/* AB4 (AX5): deposit split for the SELECTED payment
                    kind — amounts are the server's, picked from the
                    quote deposit map on every method change. */}
                {(() => {
                  const lines = depositSummaryLines({
                    totalMinor: quote.totalMinor,
                    deposit: quote.deposit,
                    kind: depositKindForPaymentMethod(paymentMethod),
                  });
                  if (!lines) return null;
                  return (
                    <div className="space-y-1 rounded-lg bg-amber-50 px-3 py-2 text-xs font-medium text-amber-900">
                      <div className="flex justify-between"><span>মোট</span><span className="font-bold">{money(lines.totalMinor)}</span></div>
                      <div className="flex justify-between"><span>এখন পরিশোধ (ডিপোজিট)</span><span className="font-bold">{money(lines.depositMinor)}</span></div>
                      <div className="flex justify-between"><span>ডেলিভারিতে বাকি</span><span className="font-bold">{money(lines.dueAfterMinor)}</span></div>
                      {lines.note ? <p className="pt-0.5 leading-relaxed">{lines.note}</p> : null}
                    </div>
                  );
                })()}
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
                {/* ED9 (v2): inline form of the existing slot error. */}
                {isV2 && error === t.checkout.slotHelp ? (
                  <p className="text-xs font-medium text-rose-600">{error}</p>
                ) : null}
              </div>
            ) : null}

            {/* GB3 (GC8): terms consent + Turnstile, when the shop requires them. */}
            {shop?.checkoutTrust?.termsRequired ? (
              <label className="flex cursor-pointer items-start gap-2 text-sm font-semibold text-slate-800">
                <input type="checkbox" className="mt-0.5" checked={termsAccepted} onChange={(e) => setTermsAccepted(e.target.checked)} />
                <span>
                  {t.checkout.termsConsentLabel}
                  {termsHrefFor(shop.checkoutTrust, orgSlug) ? (
                    <> — <a href={termsHrefFor(shop.checkoutTrust, orgSlug) ?? undefined} target="_blank" rel="noreferrer" className="font-bold text-indigo-700 underline" onClick={(e) => e.stopPropagation()}>{t.checkout.termsLinkText}</a></>
                  ) : null}
                </span>
              </label>
            ) : null}
            {/* ED9 (v2): inline forms of the existing terms /
                captcha errors (banner below stays as fallback). */}
            {isV2 && error === t.checkout.termsRequiredError ? (
              <p className="text-xs font-medium text-rose-600">{error}</p>
            ) : null}
            {captchaSiteKeyFor(shop?.checkoutTrust, "checkout") ? (
              <TurnstileWidget siteKey={captchaSiteKeyFor(shop?.checkoutTrust, "checkout") ?? ""} onToken={setCaptchaToken} />
            ) : null}
            {isV2 && error === t.checkout.captchaRequiredError ? (
              <p className="text-xs font-medium text-rose-600">{error}</p>
            ) : null}
            {quote?.codRules?.advanceRequiredForTotal ? (
              <p className="rounded-lg bg-amber-50 px-3 py-2 text-xs font-medium text-amber-800">{t.checkout.codAdvanceNotice}</p>
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

            <button ref={submitBtnRef} type="submit" disabled={submitting} className="btn-brand btn-brand-shadow w-full rounded-2xl py-3.5 text-sm font-extrabold disabled:opacity-50">
              {submitting ? t.checkout.placingOrder : t.checkout.placeOrder}
            </button>
            <Link href={`/shop/${orgSlug}/cart`} className="block text-center text-xs font-bold text-stone-600 hover:text-neutral-900 hover:underline">{t.checkout.backToCart}</Link>

            {/* Safe Shopping Guarantee (Fashion & Electronics) */}
            <div className="rounded-xl border border-slate-200 bg-slate-50/90 p-3 space-y-1.5 text-[11px] text-slate-700">
              <div className="flex items-center gap-2 font-bold text-slate-900">
                <span>🛡️</span>
                <span>নিরাপদ ও ১০০% আসল পণ্যের নিশ্চয়তা</span>
              </div>
              <p className="text-[10px] leading-relaxed text-slate-500">
                অফিশিয়াল ব্র্যান্ড ওয়ারেন্টি • দ্রুত এক্সপ্রেস ডেলিভারি • ত্রুটিযুক্ত পণ্যে ৭ দিনের সহজ রিপ্লেসমেন্ট/এক্সচেঞ্জ • পার্সেল হাতে পেয়ে চেক করে ক্যাশ অন ডেলিভারিতে পরিশোধের সুবিধা।
              </p>
            </div>

            {shop?.settings?.returnPolicyText?.trim() ? (
              <div className="border-t pt-3">
                <p className="text-[11px] font-bold text-slate-600">{t.common.returnPolicyLabel}</p>
                <p className="mt-1 whitespace-pre-line text-[11px] leading-relaxed text-slate-500">{shop.settings.returnPolicyText.trim()}</p>
              </div>
            ) : null}
          </div>
        </div>
      </form>

      {/* ED9 (v2, <lg): sticky place-order bar. The total is the
          summary's own quote total (quote.totalMinor — never
          recomputed); the button does not submit anything itself,
          it clicks the EXISTING submit button above, so the form's
          onSubmit handler (validation, idempotency, placement) is
          the one and only order path. Shown only while a quote
          exists and the main submit button is out of view. */}
      {stickyBarVisible && quote ? (
        <div
          ref={stickyBarRef}
          className="fixed inset-x-0 bottom-0 z-30 border-t border-[var(--border-soft)] bg-[var(--surface)] shadow-[var(--shadow-card)] lg:hidden"
          style={{ paddingBottom: "env(safe-area-inset-bottom)" }}
        >
          <div className="flex items-center gap-3 px-4 py-3">
            <div className="min-w-0 flex-1">
              <p className="text-[11px] font-semibold text-[var(--ink-muted)]">{t.checkout.total}</p>
              <p className="text-base font-black text-[var(--ink-strong)]">{money(quote.totalMinor)}</p>
            </div>
            <button
              type="button"
              disabled={submitting}
              onClick={() => submitBtnRef.current?.click()}
              className="btn-brand btn-brand-shadow min-h-11 shrink-0 rounded-[var(--radius-lg)] px-5 py-3 text-sm font-extrabold disabled:opacity-50"
            >
              {submitting ? t.checkout.placingOrder : t.checkout.placeOrder}
            </button>
          </div>
        </div>
      ) : null}

      {/* AB6 (AX14): cross-sell for the products in this cart. */}
      <div className="mt-8">
        <CrossSellRail orgSlug={orgSlug} productIds={cart.items.map((i) => i.productId)} locale={locale} />
      </div>
    </div>
  );
}
