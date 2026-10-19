"use client";
import React, { useEffect, useRef, useState } from "react";
import dynamic from "next/dynamic";
import { API_URL } from "@/lib/api";
import { MediaImage } from "@/components/media-image";
import { captureAffiliateRef, currentAffiliateCode } from "@/lib/affiliate-ref";
import { captureFirstTouchAttribution, getAttributionForCheckout } from "@/lib/shop-tracking";
import { getDeviceHashForCheckout } from "@/lib/device-hash";
import { captchaSiteKeyFor, exceedsMinor, termsHrefFor, type CheckoutTrust } from "@/lib/orders-gb3";
import { TurnstileWidget, useIdempotencyKey } from "@/components/TurnstileWidget";
import { type PublicReviewItem, type PublicReviewsSummary } from "@/components/product-reviews";

// ED6 (EB2) — below-fold section chunks. The landing page is one
// monolithic component whose sections close over the shared order
// state, so the sections themselves cannot be split mechanically;
// the two blocks that are already self-contained components CAN:
// FaqBlock (extracted verbatim to ./FaqBlock) and ReviewsBlock.
// Both keep SSR (default) — their markup still renders server-side,
// only the JS chunks leave this route's first load.
const FaqBlock = dynamic(() => import("./FaqBlock").then((m) => m.FaqBlock));
const ReviewsBlock = dynamic(
  () => import("@/components/product-reviews").then((m) => m.ReviewsBlock),
);
import {
  UrgencyStockBar,
  BundleSelector,
  StickyBuyBar,
  RecentBuyersToast,
} from "./ConversionBoosters";
import {
  buildFieldAnswers,
  missingRequiredFields,
  normalizeCheckoutFields,
  type FieldAnswers,
} from "@/lib/checkout-fields";
import { CheckoutFieldsSection } from "@/components/CheckoutFieldsSection";
import { generateWhatsAppProductOrderUrl } from "@/lib/whatsapp-catalog-bot";
import { fmtDate, fmtMoneyMinor, fmtNumber } from "@repo/contracts";
import { pubLocaleOf, pubT, type PublicLocale } from "@/lib/i18n/public";

// EC13 — public landing page client. Mirrors checkout/[slug]:
// same-origin /backend fetches, the same fbq injection snippet,
// the same order-form fields (PublicCheckoutOrderDto) and the
// same verbatim-server-error discipline. The server wrapper
// (page.tsx) only supplies metadata; everything rendered here
// comes from GET /public/landing/:slug?visitor=<id>, where the
// visitor token drives the server-side A/B variant assignment.

interface LandingVariant {
  id: string;
  isControl: boolean;
  headline?: string | null;
  heroImageUrl?: string | null;
  ctaText?: string | null;
  showCompareAt: boolean;
}
interface LandingSection {
  type: string;
  enabled: boolean;
  order: number;
  data: Record<string, any>;
}
interface LandingPayload {
  landing: { id: string; slug: string; title: string };
  product: {
    id: string;
    name: string;
    slug?: string | null;
    description?: string | null;
    imageUrl?: string | null;
    images: string[];
    priceMinor: string;
    compareAtMinor?: string | null;
    stockQuantity?: number | null;
    // EC24a/b: pre-order info + digital flag (badges only).
    preorder?: { enabled: true; releaseDate: string | null } | null;
    digital?: boolean;
    bumpTitle?: string | null;
    bumpPriceMinor?: string | null;
    bumpImageUrl?: string | null;
    variants: { id: string; name: string; sku?: string | null; priceMinor?: string | null; stockQuantity?: number | null }[];
  };
  organization: {
    name?: string | null;
    slug?: string | null;
    metaPixelId?: string | null;
    tikTokPixelId?: string | null;
    // EC18 trust copy — rendered verbatim when non-empty.
    deliveryPromiseText?: string | null;
    supportPhone?: string | null;
    returnPolicyText?: string | null;
  };
  sections: LandingSection[];
  variant: LandingVariant | null;
  upsell: { productId: string; name: string; priceMinor: string; imageUrl?: string | null } | null;
  reviews: { summary: PublicReviewsSummary; items: PublicReviewItem[] };
  districts: string[];
  delivery: { hasZones: boolean };
  // EC18: ALL active slots — the client filters by district scope.
  deliverySlots?: { id: string; label: string; startTime: string; endTime: string; districtScope?: string[] | null }[];
  deliveryPromiseText?: string | null;
  supportPhone?: string | null;
  returnPolicyText?: string | null;
  // GB3 (GC8): checkout trust block (settings-level sibling).
  checkoutTrust?: CheckoutTrust;
  // AB4 (AX5): the org's custom checkout fields for this surface.
  checkoutFields?: unknown;
  deposit?: { amountMinor: string; note: string } | null;
  // ML8: optional locale when the payload supplies one; absent =
  // platform default bn via pubLocaleOf.
  locale?: string;
}

function slotDateString(offsetDays = 0): string {
  const d = new Date();
  d.setDate(d.getDate() + offsetDays);
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");
  return `${d.getFullYear()}-${mm}-${dd}`;
}
interface OrderResult {
  success: boolean;
  orderId: string | null;
  orderNumber: string;
  productName: string;
  totals: {
    subtotalMinor: string;
    discountMinor: string;
    shippingMinor: string;
    totalMinor: string;
    codDueMinor: string;
  };
  // EC16: promotion / referral outcome (top-level, next to totals).
  promotionDiscountMinor?: string;
  promotionsApplied?: { promotionId: string; name: string; type: string; amountMinor: string }[];
  referralDiscountMinor?: string;
  referral?: { code: string } | null;
  yourReferralCode?: string | null;
  upsellEligible: boolean;
  // EC24b: order contains digital items (success-screen note).
  hasDigitalItems?: boolean;
  // AB4 (AX5): deposit due on this order (notice only).
  deposit?: { amountMinor: string; note: string } | null;
}

const takaFor = (locale: PublicLocale, minor?: string | number | null) =>
  minor == null ? "—" : fmtMoneyMinor(locale, Number(minor));

function getVisitorId(): string {
  try {
    const existing = localStorage.getItem("landingVisitorId");
    if (existing) return existing;
    const id =
      typeof crypto !== "undefined" && "randomUUID" in crypto
        ? crypto.randomUUID()
        : `v-${Date.now()}-${Math.random().toString(36).slice(2, 12)}`;
    localStorage.setItem("landingVisitorId", id);
    return id;
  } catch {
    return "anon";
  }
}

async function postBeacon(slug: string, path: string, body: Record<string, unknown>) {
  try {
    await fetch(`${API_URL}/public/landing/${encodeURIComponent(slug)}/${path}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
  } catch {
    // Analytics beacons never break the page.
  }
}

// ED6: FaqBlock was extracted verbatim to ./FaqBlock (dynamic
// import at the top of this file) — same accordion, same defaults.

export default function LandingClient({ slug }: { slug: string }) {
  const [localeState, setLocaleState] = useState("bn");
  const locale = pubLocaleOf(localeState);
  const t = pubT(locale);
  const taka = (minor?: string | number | null) => takaFor(locale, minor);
  const [data, setData] = useState<LandingPayload | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [visitorId, setVisitorId] = useState("");
  const viewFiredRef = useRef(false);
  const checkoutFiredRef = useRef(false);

  // Order form state (same fields as checkout/[slug]).
  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");
  const [address, setAddress] = useState("");
  const [district, setDistrict] = useState("");
  const [deliveryZone, setDeliveryZone] = useState<"inside_dhaka" | "outside_dhaka">("inside_dhaka");
  const [productVariantId, setProductVariantId] = useState("");
  const [quantity, setQuantity] = useState(1);
  const [note, setNote] = useState("");
  const [includeBump, setIncludeBump] = useState(false);
  const [couponCode, setCouponCode] = useState("");
  const [referralCode, setReferralCode] = useState("");
  const [paymentMethod] = useState<"cod">("cod");
  const [submitting, setSubmitting] = useState(false);
  const [orderError, setOrderError] = useState("");
  const [orderCompleted, setOrderCompleted] = useState<OrderResult | null>(null);
  const [heroImage, setHeroImage] = useState("");
  // EC18: delivery slot picker state.
  const [slotId, setSlotId] = useState("");
  const [slotDate, setSlotDate] = useState("");
  // GB3 (GC8): terms consent + Turnstile token + idempotency key.
  const [termsAccepted, setTermsAccepted] = useState(false);
  const [captchaToken, setCaptchaToken] = useState<string | null>(null);
  const idempotency = useIdempotencyKey();
  // AB4 (AX5): custom checkout-field answers.
  const [fieldAnswers, setFieldAnswers] = useState<FieldAnswers>({});

  // Upsell state.
  const [upsellBusy, setUpsellBusy] = useState(false);
  const [upsellError, setUpsellError] = useState("");
  const [upsellAdded, setUpsellAdded] = useState(false);
  const [finalTotalMinor, setFinalTotalMinor] = useState<string | null>(null);

  useEffect(() => {
    if (!slug) return;
    // EC32: capture a partner ?ref= code (keyed by this landing's
    // slug; the submit below reads the same key).
    captureAffiliateRef(slug);
    // AB7 (AX19): capture first-touch utm/click params into the
    // tracking storage (never overwrites an existing session).
    captureFirstTouchAttribution();
    const visitor = getVisitorId();
    setVisitorId(visitor);
    (async () => {
      setLoading(true);
      setError("");
      try {
        const res = await fetch(
          `${API_URL}/public/landing/${encodeURIComponent(slug)}?visitor=${encodeURIComponent(visitor)}`,
        );
        if (!res.ok) {
          const errData = await res.json().catch(() => null);
          throw new Error(errData?.message || t.landingPage.notFound);
        }
        const json = (await res.json()) as LandingPayload;
        setData(json);
        setLocaleState((json as LandingPayload).organization?.locale ?? json.locale ?? "bn");
        setHeroImage(json.variant?.heroImageUrl || json.product.images?.[0] || json.product.imageUrl || "");
        // View beacon: once per mount AND once per tab session —
        // the ref stops React's double-effect in dev/StrictMode,
        // the sessionStorage flag stops remount double-counts.
        const flagKey = `landingViewed:${json.landing.slug}`;
        let already = false;
        try { already = sessionStorage.getItem(flagKey) === "1"; } catch { already = false; }
        if (!viewFiredRef.current && !already) {
          viewFiredRef.current = true;
          try { sessionStorage.setItem(flagKey, "1"); } catch { /* ignore */ }
          void postBeacon(json.landing.slug, "view", {
            visitorToken: visitor,
            variantId: json.variant?.id,
          });
        }
      } catch (e) {
        setError(e instanceof Error ? e.message : t.landingPage.loadFailed);
      } finally {
        setLoading(false);
      }
    })();
  }, [slug]);

  // EC18: slots filtered client-side by the shopper's district.
  // Empty/null scope = all districts. When the form uses the
  // inside/outside toggle (no zones), only empty-scope slots show.
  const visibleSlots = (data?.deliverySlots ?? []).filter((s) => {
    const scope = s.districtScope;
    if (!scope || scope.length === 0) return true;
    if (!data?.delivery.hasZones) return false;
    return district ? scope.includes(district) : false;
  });
  // Clear a choice that no longer matches the current district.
  useEffect(() => {
    if (slotId && !visibleSlots.some((s) => s.id === slotId)) {
      setSlotId("");
      setSlotDate("");
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [district, deliveryZone, data]);

  const trustPromise = data?.organization?.deliveryPromiseText ?? data?.deliveryPromiseText ?? null;
  const trustPhone = data?.organization?.supportPhone ?? data?.supportPhone ?? null;
  const trustReturn = data?.organization?.returnPolicyText ?? data?.returnPolicyText ?? null;

  function noteCheckoutStarted() {
    if (checkoutFiredRef.current || !data) return;
    checkoutFiredRef.current = true;
    void postBeacon(data.landing.slug, "checkout-started", {
      visitorToken: visitorId,
      variantId: data.variant?.id,
    });
  }

  function scrollToOrder() {
    document.getElementById("order-form")?.scrollIntoView({ behavior: "smooth", block: "start" });
  }

  async function handleOrderSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!data) return;
    const cleanPhone = phone.replace(/\D/g, "");
    if (cleanPhone.length < 11) {
      setOrderError(t.singleCheckout.phoneInvalid);
      return;
    }
    if (data.delivery.hasZones && !district) {
      setOrderError(t.landingPage.districtRequired);
      return;
    }
    const trust = data.checkoutTrust;
    if (trust?.termsRequired && !termsAccepted) {
      setOrderError(t.singleCheckout.termsRequired);
      return;
    }
    if (captchaSiteKeyFor(trust, "checkout") && !captchaToken) {
      setOrderError(t.singleCheckout.captchaRequired);
      return;
    }
    // AB4: required custom fields must be answered.
    const fieldDefs = normalizeCheckoutFields(data.checkoutFields);
    const missingFields = missingRequiredFields(fieldDefs, fieldAnswers);
    if (missingFields.length > 0) {
      setOrderError(`${t.singleCheckout.requiredFieldsPrefix}${missingFields.join(", ")}`);
      return;
    }
    setSubmitting(true);
    setOrderError("");
    try {
      // AB8 (AX27): weak device signal — omitted when unavailable.
      const deviceHash = await getDeviceHashForCheckout();
      const res = await fetch(`${API_URL}/public/landing/${encodeURIComponent(slug)}/order`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          customerName: name.trim(),
          customerPhone: phone.trim(),
          customerAddress: address.trim(),
          ...(data.delivery.hasZones
            ? { district: district || undefined }
            : { deliveryZone, district: district || undefined }),
          quantity,
          variantId: productVariantId || undefined,
          paymentMethod,
          note: note.trim() || undefined,
          includeBump,
          couponCode: couponCode.trim() || undefined,
          referralCode: referralCode.trim() || undefined,
          // EC32: stored partner ref (window governs; the server
          // re-validates) — not cleared after purchase.
          affiliateCode: currentAffiliateCode(slug) || undefined,
          servedVariantId: data.variant?.id,
          ...(slotId && slotDate && visibleSlots.some((s) => s.id === slotId)
            ? { deliverySlotId: slotId, deliveryDate: slotDate }
            : {}),
          // GB3 (GC8): consent + idempotency + captcha token.
          termsAccepted,
          idempotencyKey: idempotency.key,
          ...(captchaToken ? { captchaToken } : {}),
          // AB4: custom-field answers (omitted when none answered).
          ...(buildFieldAnswers(fieldDefs, fieldAnswers)
            ? { fieldAnswers: buildFieldAnswers(fieldDefs, fieldAnswers) }
            : {}),
          // AB7 (AX19): first-touch attribution — omitted when empty.
          ...(getAttributionForCheckout()
            ? { attribution: getAttributionForCheckout() }
            : {}),
          // AB8 (AX27): device hash (omitted when unavailable).
          ...(deviceHash ? { deviceHash } : {}),
        }),
      });
      if (!res.ok) {
        const errJson = await res.json().catch(() => null);
        // Server error verbatim — never paraphrased.
        throw new Error(errJson?.message || t.landingPage.orderFailed);
      }
      const out = (await res.json()) as OrderResult;
      idempotency.reset();
      setOrderCompleted(out);
      setFinalTotalMinor(out.totals.totalMinor);
      // fbq Purchase, exactly like checkout/[slug] values: BDT
      // major units (totalMinor / 100).
      const w = window as unknown as { fbq?: (...args: unknown[]) => void };
      if (typeof w.fbq === "function") {
        w.fbq("track", "Purchase", {
          content_name: out.productName,
          value: Number(out.totals.totalMinor) / 100,
          currency: "BDT",
        });
      }
      window.scrollTo({ top: 0, behavior: "smooth" });
    } catch (err) {
      setOrderError(err instanceof Error ? err.message : t.landingPage.orderFailedShort);
    } finally {
      setSubmitting(false);
    }
  }

  async function addUpsell() {
    if (!data || !orderCompleted?.orderId) return;
    setUpsellBusy(true);
    setUpsellError("");
    try {
      const res = await fetch(
        `${API_URL}/public/landing/${encodeURIComponent(slug)}/order/${encodeURIComponent(orderCompleted.orderId)}/upsell`,
        { method: "POST", headers: { "Content-Type": "application/json" } },
      );
      if (!res.ok) {
        const errJson = await res.json().catch(() => null);
        // The server's refusal reason, verbatim.
        throw new Error(errJson?.message || t.landingPage.upsellFailed);
      }
      const out = await res.json();
      setUpsellAdded(true);
      if (out.totalMinor) setFinalTotalMinor(String(out.totalMinor));
    } catch (err) {
      setUpsellError(err instanceof Error ? err.message : t.landingPage.upsellFailed);
    } finally {
      setUpsellBusy(false);
    }
  }

  if (loading) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-slate-50 p-4">
        <div className="space-y-3 text-center">
          <div className="mx-auto h-10 w-10 animate-spin rounded-full border-4 border-indigo-600 border-t-transparent" />
          <p className="text-sm font-semibold text-slate-600">{t.landingPage.loading}</p>
        </div>
      </div>
    );
  }

  if (error || !data) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-slate-50 p-4">
        <div className="w-full max-w-md space-y-4 rounded-2xl border bg-white p-8 text-center shadow-sm">
          <div className="text-4xl">⚠️</div>
          <h2 className="text-lg font-bold text-slate-800">{t.landingPage.sorryTitle}</h2>
          <p className="text-xs font-medium text-rose-600">{error || t.landingPage.pageNotFound}</p>
          <a href="/" className="inline-block rounded-lg bg-indigo-600 px-5 py-2 text-xs font-semibold text-white">
            {t.landingPage.backHome}
          </a>
        </div>
      </div>
    );
  }

  const { product, organization, variant, upsell } = data;
  const sections = [...(data.sections ?? [])]
    .filter((s) => s.enabled !== false)
    .sort((a, b) => a.order - b.order);
  const offerSection = sections.find((s) => s.type === "offer");
  const showBumpInOffer = !offerSection || offerSection.data?.showBump !== false;

  const selectedVariant = product.variants.find((v) => v.id === productVariantId) ?? null;
  const unitMinor = selectedVariant?.priceMinor ?? product.priceMinor;
  const showCompareAt = variant ? variant.showCompareAt !== false : true;
  const subtotalPreview = Number(unitMinor) * quantity + (includeBump && product.bumpPriceMinor ? Number(product.bumpPriceMinor) : 0);
  const headline = variant?.headline || product.name;
  const ctaText = variant?.ctaText || t.landingPage.orderNowDefault;
  const galleryImages = product.images?.length ? product.images : product.imageUrl ? [product.imageUrl] : [];
  const hasBump = !!(product.bumpTitle && product.bumpPriceMinor);

  // ---------- Success view ----------
  if (orderCompleted) {
    const totalMinor = finalTotalMinor ?? orderCompleted.totals.totalMinor;
    return (
      <div className="flex min-h-screen items-center justify-center bg-slate-100/60 px-4 py-12">
        <div className="w-full max-w-lg space-y-6 rounded-3xl border border-slate-100 bg-white p-8 text-center shadow-xl">
          <div className="mx-auto flex h-16 w-16 items-center justify-center rounded-full bg-emerald-100 text-3xl text-emerald-600">✓</div>
          <div>
            <h1 className="text-2xl font-black text-slate-900">{t.landingPage.successTitle}</h1>
            <p className="mt-1 text-xs text-slate-500">
              {t.landingPage.thanksText}
            </p>
          </div>
          <div className="space-y-2 rounded-2xl border bg-slate-50 p-4 text-left text-xs">
            <div className="flex justify-between border-b pb-2">
              <span className="text-slate-500">{t.landingPage.orderNumberLabel}</span>
              <span className="font-bold text-slate-800">{orderCompleted.orderNumber}</span>
            </div>
            <div className="flex justify-between border-b pb-2">
              <span className="text-slate-500">{t.landingPage.productLabel}</span>
              <span className="font-bold text-slate-800">{orderCompleted.productName}</span>
            </div>
            <div className="flex justify-between border-b pb-2">
              <span className="text-slate-500">{t.landingPage.subtotalLabel}</span>
              <span className="font-semibold text-slate-800">{taka(orderCompleted.totals.subtotalMinor)}</span>
            </div>
            {Number(orderCompleted.totals.discountMinor) > 0 ? (
              <div className="flex justify-between border-b pb-2">
                <span className="text-slate-500">{t.landingPage.couponDiscountLabel}</span>
                <span className="font-bold text-emerald-700">− {taka(orderCompleted.totals.discountMinor)}</span>
              </div>
            ) : null}
            {(orderCompleted.promotionsApplied ?? []).map((p) => (
              <div key={p.promotionId} className="flex justify-between border-b pb-2">
                <span className="text-slate-500">{t.landingPage.promotionDiscountPrefix}{p.name}:</span>
                <span className="font-bold text-emerald-700">− {taka(p.amountMinor)}</span>
              </div>
            ))}
            {orderCompleted.referralDiscountMinor && Number(orderCompleted.referralDiscountMinor) > 0 ? (
              <div className="flex justify-between border-b pb-2">
                <span className="text-slate-500">{t.landingPage.referralDiscountLabel}{orderCompleted.referral?.code ? ` (${orderCompleted.referral.code})` : ""}:</span>
                <span className="font-bold text-emerald-700">− {taka(orderCompleted.referralDiscountMinor)}</span>
              </div>
            ) : null}
            <div className="flex justify-between border-b pb-2">
              <span className="text-slate-500">{t.landingPage.deliveryChargeLabel}</span>
              <span className="font-semibold text-slate-800">{taka(orderCompleted.totals.shippingMinor)}</span>
            </div>
            <div className="flex justify-between pt-1 text-sm font-bold">
              <span className="text-slate-900">{t.landingPage.grandTotalCodLabel}</span>
              <span className="text-base text-emerald-700">{taka(totalMinor)}</span>
            </div>
          </div>

          {orderCompleted.hasDigitalItems ? (
            <div className="rounded-2xl border border-sky-200 bg-sky-50 p-4 text-sm font-semibold text-sky-900">
              {t.landingPage.digitalNote}
            </div>
          ) : null}

          {orderCompleted.yourReferralCode ? (
            <div className="rounded-2xl border border-indigo-200 bg-indigo-50 p-4 text-sm font-bold text-indigo-900">
              {t.landingPage.yourReferralPrefix}<span className="font-mono">{orderCompleted.yourReferralCode}</span>{t.landingPage.yourReferralSuffix}
            </div>
          ) : null}

          {/* AB4 (AX5): deposit notice from the placement response —
              notice only; this surface has no payment initiation. */}
          {orderCompleted.deposit ? (
            <div className="rounded-2xl border border-amber-200 bg-amber-50 p-4 text-sm font-semibold text-amber-900">
              {t.landingPage.depositPrefix}{taka(orderCompleted.deposit.amountMinor)}{t.landingPage.depositMid}{orderCompleted.deposit.note}{t.landingPage.depositSuffix}
            </div>
          ) : null}

          {upsell && orderCompleted.upsellEligible && !upsellAdded ? (
            <div className="space-y-3 rounded-2xl border-2 border-dashed border-amber-300 bg-amber-50/60 p-4 text-left">
              <div className="text-sm font-black text-slate-900">{t.landingPage.upsellHeading}</div>
              <div className="flex items-center gap-3">
                {upsell.imageUrl ? (
                  <MediaImage src={upsell.imageUrl} alt={upsell.name} width={128} height={128} className="h-16 w-16 rounded-xl border border-slate-200 object-cover" />
                ) : (
                  <div className="flex h-16 w-16 items-center justify-center rounded-xl bg-amber-100 text-2xl">📦</div>
                )}
                <div className="flex-1">
                  <div className="text-sm font-bold text-slate-900">{upsell.name}</div>
                  <div className="text-sm font-extrabold text-indigo-700">{taka(upsell.priceMinor)}</div>
                </div>
                <button
                  type="button"
                  onClick={addUpsell}
                  disabled={upsellBusy}
                  className="rounded-xl bg-amber-500 px-4 py-2.5 text-sm font-extrabold text-white shadow hover:bg-amber-600 disabled:opacity-50"
                >
                  {upsellBusy ? t.landingPage.adding : t.landingPage.add}
                </button>
              </div>
              <p className="text-[11px] text-slate-500">{t.landingPage.upsellNote}</p>
              {upsellError ? <p className="rounded-lg bg-rose-50 px-3 py-2 text-xs font-medium text-rose-700">{upsellError}</p> : null}
            </div>
          ) : null}
          {upsellAdded ? (
            <p className="rounded-xl bg-emerald-50 p-3 text-sm font-bold text-emerald-800">
              {t.landingPage.upsellAddedPrefix}{taka(totalMinor)}{t.landingPage.upsellAddedSuffix}
            </p>
          ) : null}

          {organization.slug ? (
            <a
              href={`/track/${organization.slug}`}
              className="block w-full rounded-xl bg-indigo-600 py-3 text-xs font-semibold text-white transition-colors hover:bg-indigo-700"
            >
              {t.landingPage.trackOrder}
            </a>
          ) : null}

          <button
            onClick={() => window.location.reload()}
            className="w-full rounded-xl bg-slate-900 py-3 text-xs font-semibold text-white transition-colors hover:bg-black"
          >
            {t.landingPage.orderAgain}
          </button>
        </div>
      </div>
    );
  }

  const reviewsData = data.reviews;

  // ---------- Section renderers ----------
  function renderSection(section: LandingSection) {
    switch (section.type) {
      case "hero":
        return (
          <section key="hero" className="space-y-4">
            <div className="overflow-hidden rounded-3xl border border-slate-200 bg-white">
              {heroImage ? (
                // eslint-disable-next-line @next/next/no-img-element
                <MediaImage src={heroImage} alt={product.name} priority sizes="(max-width: 1024px) 100vw, 1024px" className="aspect-square w-full object-cover sm:aspect-[4/3]" />
              ) : (
                <div className="flex aspect-square w-full items-center justify-center bg-indigo-50 text-7xl">📦</div>
              )}
            </div>
            {galleryImages.length > 1 ? (
              <div className="flex flex-wrap gap-2">
                {galleryImages.map((src) => (
                  <button
                    key={src}
                    type="button"
                    onClick={() => setHeroImage(src)}
                    className={`h-16 w-16 overflow-hidden rounded-xl border-2 ${src === heroImage ? "border-indigo-600" : "border-slate-200"}`}
                  >
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <MediaImage src={src} alt="" width={160} height={160} className="h-full w-full object-cover" />
                  </button>
                ))}
              </div>
            ) : null}
            <div className="space-y-3 text-center">
              <UrgencyStockBar stockCount={product.stockQuantity} locale={locale} />
              <h1 className="text-2xl font-black leading-snug text-slate-900 sm:text-3xl">{headline}</h1>
              <div className="flex items-center justify-center gap-3">
                <span className="text-3xl font-extrabold text-indigo-700">{taka(unitMinor)}</span>
                {showCompareAt && product.compareAtMinor ? (
                  <span className="text-lg text-slate-400 line-through">{taka(product.compareAtMinor)}</span>
                ) : null}
              </div>
              {product.preorder ? (
                <p className="text-sm font-bold text-violet-700">{t.landingPage.preorderPrefix}{product.preorder.releaseDate ? `${t.landingPage.releasePrefix}${fmtDate(locale, product.preorder.releaseDate)}` : ""}</p>
              ) : product.stockQuantity === 0 ? (
                <p className="text-sm font-bold text-rose-600">{t.landingPage.outOfStock}</p>
              ) : null}
              {product.digital ? <p className="text-sm font-bold text-sky-700">{t.landingPage.digitalBadge}</p> : null}
              <button
                type="button"
                onClick={scrollToOrder}
                className="w-full rounded-2xl bg-indigo-600 py-4 text-base font-extrabold text-white shadow-lg shadow-indigo-600/30 transition hover:bg-indigo-700 sm:w-auto sm:px-10"
              >
                🛒 {ctaText}
              </button>
              <p className="text-[11px] text-slate-400">{t.landingPage.codNote}</p>
            </div>
          </section>
        );
      case "description": {
        const text = (section.data?.text as string) || product.description || "";
        if (!text) return null;
        return (
          <section key="description" className="rounded-3xl border border-slate-200 bg-white p-6">
            <h2 className="text-xl font-black text-slate-900">{t.landingPage.descriptionHeading}</h2>
            <p className="mt-3 whitespace-pre-line text-sm leading-relaxed text-slate-600">{text}</p>
          </section>
        );
      }
      case "gallery":
        if (!galleryImages.length) return null;
        return (
          <section key="gallery" className="space-y-3">
            <h2 className="text-xl font-black text-slate-900">{t.landingPage.galleryHeading}</h2>
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
              {galleryImages.map((src) => (
                // eslint-disable-next-line @next/next/no-img-element
                <MediaImage key={src} src={src} alt={product.name} width={600} height={600} sizes="(max-width: 640px) 50vw, 320px" className="aspect-square w-full rounded-2xl border border-slate-200 object-cover" />
              ))}
            </div>
          </section>
        );
      case "benefits": {
        const items = (Array.isArray(section.data?.items) ? section.data.items : []) as { icon?: string; title?: string; text?: string }[];
        if (!items.length) return null;
        return (
          <section key="benefits" className="space-y-3">
            <h2 className="text-xl font-black text-slate-900">{t.landingPage.benefitsHeading}</h2>
            <div className="grid gap-3 sm:grid-cols-2">
              {items.map((it, i) => (
                <div key={i} className="rounded-2xl border border-slate-200 bg-white p-4">
                  <div className="flex items-start gap-2.5">
                    <span className="text-xl">{it.icon || "✅"}</span>
                    <div>
                      {it.title ? <div className="text-sm font-bold text-slate-900">{it.title}</div> : null}
                      {it.text ? <p className="mt-0.5 text-sm leading-relaxed text-slate-600">{it.text}</p> : null}
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </section>
        );
      }
      case "reviews":
        return (
          <div key="reviews" className="rounded-3xl border border-slate-200 bg-white p-6">
            <ReviewsBlock summary={reviewsData.summary} items={reviewsData.items} />
          </div>
        );
      case "faq": {
        const items = (Array.isArray(section.data?.items) ? section.data.items : []) as { q: string; a: string }[];
        if (!items.length) return null;
        return <FaqBlock key="faq" items={items} locale={locale} />;
      }
      case "offer":
        if (!hasBump || !showBumpInOffer) return null;
        return (
          <section key="offer" className="rounded-3xl border-2 border-dashed border-amber-300 bg-amber-50/60 p-6 text-center">
            <span className="rounded bg-amber-500 px-2 py-0.5 text-[11px] font-bold text-white">{t.landingPage.offerBadge}</span>
            <h2 className="mt-3 text-xl font-black text-slate-900">{product.bumpTitle}</h2>
            <p className="mt-1 text-sm font-bold text-amber-900">{t.landingPage.offerExtraPrefix}{taka(product.bumpPriceMinor)}{t.landingPage.offerExtraSuffix}</p>
            {product.bumpImageUrl ? (
              <MediaImage src={product.bumpImageUrl} alt={product.bumpTitle ?? ""} width={256} height={256} className="mx-auto mt-3 h-32 w-32 rounded-2xl border border-amber-200 object-cover" />
            ) : null}
            <button type="button" onClick={scrollToOrder} className="mt-4 rounded-xl bg-amber-500 px-6 py-2.5 text-sm font-extrabold text-white hover:bg-amber-600">
              {t.landingPage.offerOrderButton}
            </button>
          </section>
        );
      case "trust": {
        const codText = (section.data?.codText as string) || t.landingPage.trustCodDefault;
        const deliveryText = (section.data?.deliveryText as string) || t.landingPage.trustDeliveryDefault;
        const returnText = (section.data?.returnText as string) || t.landingPage.trustReturnDefault;
        return (
          <section key="trust" className="grid gap-3 sm:grid-cols-3">
            <div className="rounded-2xl border border-slate-200 bg-white p-4 text-center">
              <div className="text-2xl">💵</div>
              <p className="mt-2 text-xs leading-relaxed font-medium text-slate-600">{codText}</p>
            </div>
            <div className="rounded-2xl border border-slate-200 bg-white p-4 text-center">
              <div className="text-2xl">🚚</div>
              <p className="mt-2 text-xs leading-relaxed font-medium text-slate-600">{deliveryText}</p>
            </div>
            <div className="rounded-2xl border border-slate-200 bg-white p-4 text-center">
              <div className="text-2xl">↩️</div>
              <p className="mt-2 text-xs leading-relaxed font-medium text-slate-600">{returnText}</p>
            </div>
          </section>
        );
      }
      default:
        return null;
    }
  }

  const orderForm = (
    <section id="order-form" className="scroll-mt-4 rounded-3xl border border-slate-200 bg-white p-6 shadow-sm">
      <h2 className="border-b pb-2 text-base font-bold text-slate-900">{t.landingPage.formHeading}</h2>
      <form
        onSubmit={handleOrderSubmit}
        onFocus={noteCheckoutStarted}
        onChange={noteCheckoutStarted}
        className="mt-4 space-y-4"
      >
        <div>
          <label className="mb-1 block text-xs font-bold text-slate-700">{t.landingPage.nameLabel}</label>
          <input
            type="text" required value={name} onChange={(e) => setName(e.target.value)}
            placeholder={t.landingPage.namePlaceholder}
            className="w-full rounded-xl border border-slate-300 p-2.5 text-sm focus:border-indigo-600 focus:outline-none"
          />
        </div>
        <div>
          <label className="mb-1 block text-xs font-bold text-slate-700">{t.landingPage.phoneLabel}</label>
          <input
            type="tel" required value={phone} onChange={(e) => setPhone(e.target.value)}
            placeholder="01XXXXXXXXX"
            className="w-full rounded-xl border border-slate-300 p-2.5 font-mono text-sm font-bold focus:border-indigo-600 focus:outline-none"
          />
        </div>
        <div>
          <label className="mb-1 block text-xs font-bold text-slate-700">{t.landingPage.addressLabel}</label>
          <textarea
            required rows={2} value={address} onChange={(e) => setAddress(e.target.value)}
            placeholder={t.landingPage.addressPlaceholder}
            className="w-full rounded-xl border border-slate-300 p-2.5 text-sm focus:border-indigo-600 focus:outline-none"
          />
        </div>

        {data.delivery.hasZones ? (
          <div>
            <label className="mb-1 block text-xs font-bold text-slate-700">{t.landingPage.districtLabel}</label>
            <select
              required value={district} onChange={(e) => setDistrict(e.target.value)}
              className="w-full rounded-xl border border-slate-300 p-2.5 text-sm focus:border-indigo-600 focus:outline-none"
            >
              <option value="">{t.landingPage.districtPlaceholder}</option>
              {data.districts.map((d) => <option key={d} value={d}>{d}</option>)}
            </select>
            <p className="mt-1 text-[11px] text-slate-400">{t.landingPage.districtChargeNote}</p>
          </div>
        ) : (
          <div>
            <label className="mb-1.5 block text-xs font-bold text-slate-700">{t.landingPage.zoneLabel}</label>
            <div className="grid grid-cols-2 gap-3">
              <button
                type="button" onClick={() => setDeliveryZone("inside_dhaka")}
                className={`rounded-xl border p-3 text-left transition-all ${deliveryZone === "inside_dhaka" ? "border-indigo-600 bg-indigo-50/50 ring-2 ring-indigo-500" : "border-slate-200 bg-white"}`}
              >
                <div className="text-xs font-bold text-slate-900">{t.landingPage.insideDhaka}</div>
              </button>
              <button
                type="button" onClick={() => setDeliveryZone("outside_dhaka")}
                className={`rounded-xl border p-3 text-left transition-all ${deliveryZone === "outside_dhaka" ? "border-indigo-600 bg-indigo-50/50 ring-2 ring-indigo-500" : "border-slate-200 bg-white"}`}
              >
                <div className="text-xs font-bold text-slate-900">{t.landingPage.outsideDhaka}</div>
              </button>
            </div>
            <p className="mt-1 text-[11px] text-slate-400">{t.landingPage.zoneChargeNote}</p>
          </div>
        )}

        {visibleSlots.length > 0 ? (
          <div>
            <label className="mb-1 block text-xs font-bold text-slate-700">{t.landingPage.slotLabel}</label>
            <select
              value={slotId}
              onChange={(e) => {
                const next = e.target.value;
                setSlotId(next);
                if (next && !slotDate) setSlotDate(slotDateString(0));
                if (!next) setSlotDate("");
              }}
              className="w-full rounded-xl border border-slate-300 p-2.5 text-sm focus:border-indigo-600 focus:outline-none"
            >
              <option value="">{t.landingPage.slotNone}</option>
              {visibleSlots.map((s) => (
                <option key={s.id} value={s.id}>{s.label} ({s.startTime} – {s.endTime})</option>
              ))}
            </select>
            {slotId ? (
              <div className="mt-2">
                <label className="mb-1 block text-xs font-bold text-slate-700">{t.landingPage.slotDateLabel}</label>
                <input
                  type="date"
                  required
                  min={slotDateString(0)}
                  max={slotDateString(7)}
                  value={slotDate}
                  onChange={(e) => setSlotDate(e.target.value)}
                  className="w-full rounded-xl border border-slate-300 p-2.5 text-sm focus:border-indigo-600 focus:outline-none"
                />
                <p className="mt-1 text-[11px] text-slate-400">{t.landingPage.slotHelp}</p>
              </div>
            ) : null}
          </div>
        ) : null}

        {product.variants.length > 0 ? (
          <div>
            <label className="mb-1 block text-xs font-bold text-slate-700">{t.landingPage.variantLabel}</label>
            <select
              value={productVariantId} onChange={(e) => setProductVariantId(e.target.value)}
              className="w-full rounded-xl border border-slate-300 p-2.5 text-sm focus:border-indigo-600 focus:outline-none"
            >
              <option value="">{t.landingPage.variantDefault}</option>
              {product.variants.map((v) => (
                <option key={v.id} value={v.id} disabled={v.stockQuantity === 0}>
                  {v.name}{v.priceMinor ? ` — ${taka(v.priceMinor)}` : ""}{v.stockQuantity === 0 ? t.landingPage.variantOutOfStockSuffix : ""}
                </option>
              ))}
            </select>
          </div>
        ) : null}

        <BundleSelector
          unitMinor={unitMinor}
          quantity={quantity}
          onSelectQuantity={(q) => setQuantity(q)}
          takaFn={taka}
          locale={locale}
        />

        <div className="flex items-center justify-between border-y py-3">
          <span className="text-xs font-bold text-slate-700">{t.landingPage.customQtyLabel}</span>
          <div className="flex items-center overflow-hidden rounded-lg border">
            <button type="button" onClick={() => setQuantity(Math.max(1, quantity - 1))} className="bg-slate-50 px-3 py-1 font-bold text-slate-600 hover:bg-slate-100">−</button>
            <span className="px-4 py-1 text-sm font-bold text-slate-900">{fmtNumber(locale, quantity)}</span>
            <button type="button" onClick={() => setQuantity(Math.min(99, quantity + 1))} className="bg-slate-50 px-3 py-1 font-bold text-slate-600 hover:bg-slate-100">+</button>
          </div>
        </div>

        {hasBump ? (
          <label className={`flex cursor-pointer items-start gap-2.5 rounded-xl border p-3.5 transition ${includeBump ? "border-amber-500 bg-amber-50/70 ring-2 ring-amber-400" : "border-dashed border-amber-300 bg-amber-50/20"}`}>
            <input type="checkbox" checked={includeBump} onChange={(e) => setIncludeBump(e.target.checked)} className="mt-0.5" />
            <span className="space-y-1">
              <span className="flex flex-wrap items-center gap-1.5">
                <span className="rounded bg-amber-500 px-1.5 py-0.5 text-[10px] font-bold text-white">{t.landingPage.bumpBadge}</span>
                <span className="text-xs font-bold text-slate-900">{product.bumpTitle}</span>
              </span>
              <span className="block text-[11px] font-bold text-amber-900">{t.landingPage.bumpExtraPrefix}{taka(product.bumpPriceMinor)}{t.landingPage.bumpExtraSuffix}</span>
            </span>
          </label>
        ) : null}

        <div>
          <label className="mb-1 block text-xs font-semibold text-slate-700">{t.landingPage.couponLabel}</label>
          <input
            type="text" value={couponCode} onChange={(e) => setCouponCode(e.target.value.toUpperCase())}
            placeholder={t.landingPage.couponPlaceholder}
            className="w-full rounded-xl border border-slate-300 px-3 py-2 font-mono text-sm uppercase focus:border-indigo-500 focus:outline-none"
          />
          {couponCode.trim() ? <p className="mt-1 text-[11px] text-slate-400">{t.landingPage.couponNote}</p> : null}
        </div>

        <div>
          <label className="mb-1 block text-xs font-semibold text-slate-700">{t.landingPage.referralLabel}</label>
          <input
            type="text" value={referralCode} onChange={(e) => setReferralCode(e.target.value)}
            placeholder={t.landingPage.referralPlaceholder}
            className="w-full rounded-xl border border-slate-300 px-3 py-2 font-mono text-sm focus:border-indigo-500 focus:outline-none"
          />
        </div>

        <div className="rounded-xl border border-emerald-300 bg-emerald-50/60 p-3">
          <label className="flex cursor-pointer items-center gap-2 text-xs font-bold text-emerald-950">
            <input type="radio" name="payment" checked={paymentMethod === "cod"} readOnly className="text-emerald-600" />
            <span>{t.landingPage.codLabel}</span>
          </label>
        </div>

        <div>
          <label className="mb-1 block text-[11px] font-semibold text-slate-500">{t.landingPage.noteLabel}</label>
          <input
            type="text" value={note} onChange={(e) => setNote(e.target.value)}
            placeholder={t.landingPage.notePlaceholder}
            className="w-full rounded-lg border border-slate-200 p-2 text-xs"
          />
        </div>

        {/* AB4 (AX5): the org's custom checkout fields. */}
        <CheckoutFieldsSection
          defs={normalizeCheckoutFields(data.checkoutFields)}
          answers={fieldAnswers}
          onChange={(k, v) => setFieldAnswers((prev) => ({ ...prev, [k]: v }))}
        />

        <div className="space-y-2 text-xs">
          <div className="flex justify-between text-slate-600">
            <span>{t.landingPage.subtotalPrefix}{fmtNumber(locale, quantity)}{t.landingPage.subtotalItems}
{includeBump && hasBump ? t.landingPage.subtotalAddonSuffix : ""}{t.landingPage.subtotalSuffix}</span>
            <span className="font-semibold text-slate-900">{taka(subtotalPreview)}</span>
          </div>
          <div className="flex justify-between text-slate-600">
            <span>{t.landingPage.deliveryChargeLabel}</span>
            <span className="font-semibold text-slate-900">{t.landingPage.deliveryAtOrder}</span>
          </div>
        </div>

        {orderError ? <p className="rounded-lg bg-rose-50 px-3 py-2 text-xs font-medium text-rose-700">{orderError}</p> : null}

        {/* EC18 trust copy near the place-order button — hidden when empty. */}
        {trustPromise?.trim() || trustPhone?.trim() ? (
          <div className="space-y-1 rounded-xl bg-slate-50 p-3 text-center">
            {trustPromise?.trim() ? <p className="text-xs font-semibold text-slate-700">🚚 {trustPromise.trim()}</p> : null}
            {trustPhone?.trim() ? <p className="text-xs text-slate-500">{t.landingPage.supportLabel}<span className="font-mono font-semibold">{trustPhone.trim()}</span></p> : null}
          </div>
        ) : null}

        {/* GB3 (GC8): terms consent + Turnstile + advance notice. */}
        {data.checkoutTrust?.termsRequired ? (
          <label className="flex cursor-pointer items-start gap-2 text-sm font-semibold text-slate-800">
            <input type="checkbox" className="mt-0.5" checked={termsAccepted} onChange={(e) => setTermsAccepted(e.target.checked)} />
            <span>
              {t.landingPage.termsLabel}
              {termsHrefFor(data.checkoutTrust, organization.slug) ? (
                <> — <a href={termsHrefFor(data.checkoutTrust, organization.slug) ?? undefined} target="_blank" rel="noreferrer" className="font-bold text-indigo-700 underline" onClick={(e) => e.stopPropagation()}>{t.landingPage.termsLink}</a></>
              ) : null}
            </span>
          </label>
        ) : null}
        {captchaSiteKeyFor(data.checkoutTrust, "checkout") ? (
          <TurnstileWidget siteKey={captchaSiteKeyFor(data.checkoutTrust, "checkout") ?? ""} onToken={setCaptchaToken} />
        ) : null}
        {data.checkoutTrust?.cod.advanceAboveMinor && exceedsMinor(String(subtotalPreview), data.checkoutTrust.cod.advanceAboveMinor) ? (
          <p className="rounded-lg bg-amber-50 px-3 py-2 text-xs font-medium text-amber-800">{t.landingPage.codAdvanceNotice}</p>
        ) : null}
        {/* AB4: payload-carried deposit notice (when present). */}
        {data.deposit ? (
          <p className="rounded-lg bg-amber-50 px-3 py-2 text-xs font-medium text-amber-800">
            {t.landingPage.depositNoticePrefix}{taka(data.deposit.amountMinor)}{t.landingPage.depositNoticeMid}{data.deposit.note}{t.landingPage.depositNoticeSuffix}
          </p>
        ) : null}

        <button
          type="submit" disabled={submitting || product.stockQuantity === 0}
          className="w-full rounded-2xl bg-indigo-600 py-3.5 text-sm font-extrabold text-white shadow-lg shadow-indigo-600/30 transition hover:bg-indigo-700 disabled:opacity-50"
        >
          {submitting ? t.landingPage.submitting : `🚀 ${ctaText}${t.landingPage.submitCodSuffix}`}
        </button>

        {trustPhone?.trim() && product.stockQuantity !== 0 ? (
          <a
            href={generateWhatsAppProductOrderUrl({
              phone: trustPhone.trim(),
              productName: product.name,
              priceMinor: unitMinor,
              variantName: selectedVariant?.name ?? null,
              productUrl: typeof window !== "undefined" ? window.location.href : null,
            })}
            target="_blank"
            rel="noopener noreferrer"
            className="flex w-full items-center justify-center gap-2 rounded-2xl bg-[#25D366] py-3 text-sm font-extrabold text-white shadow-lg shadow-[#25D366]/25 transition hover:bg-[#20ba5a] active:scale-[0.99]"
          >
            <svg className="h-5 w-5 fill-current" viewBox="0 0 24 24">
              <path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347m-5.421 7.403h-.004a9.87 9.87 0 01-5.031-1.378l-.361-.214-3.741.982.998-3.648-.235-.374a9.86 9.86 0 01-1.51-5.26c.001-5.45 4.436-9.884 9.888-9.884 2.64 0 5.122 1.03 6.988 2.898a9.825 9.825 0 012.893 6.994c-.003 5.45-4.437 9.884-9.885 9.884m8.413-18.297A11.815 11.815 0 0012.05 0C5.495 0 .16 5.335.157 11.892c0 2.096.547 4.142 1.588 5.945L0 24l6.335-1.662c1.746.953 3.71 1.456 5.711 1.457h.005c6.554 0 11.89-5.335 11.893-11.893a11.821 11.821 0 00-3.48-8.413z" />
            </svg>
            <span>{t.landingPage.whatsappOrder}</span>
          </a>
        ) : null}

        <p className="text-center text-[10px] text-slate-400">{t.landingPage.secureNote}</p>

        {trustReturn?.trim() ? (
          <div className="border-t pt-3">
            <p className="text-[11px] font-bold text-slate-600">{t.landingPage.returnPolicyTitle}</p>
            <p className="mt-1 whitespace-pre-line text-[11px] leading-relaxed text-slate-500">{trustReturn.trim()}</p>
          </div>
        ) : null}
      </form>
    </section>
  );

  return (
    <div className="min-h-screen bg-slate-50 px-4 py-8 pb-24 sm:px-6 md:pb-8">
      {/* SaaS Multi-Tenant Merchant Facebook Pixel Injection — mirrored from checkout/[slug] */}
      {organization.metaPixelId ? (
        <script
          dangerouslySetInnerHTML={{
            __html: `
              !function(f,b,e,v,n,t,s)
              {if(f.fbq)return;n=f.fbq=function(){n.callMethod?
              n.callMethod.apply(n,arguments):n.queue.push(arguments)};
              if(!f._fbq)f._fbq=n;n.push=n;n.loaded=!0;n.version='2.0';
              n.queue=[];t=b.createElement(e);t.async=!0;
              t.src=v;s=b.getElementsByTagName(e)[0];
              s.parentNode.insertBefore(t,s)}(window, document,'script',
              'https://connect.facebook.net/en_US/fbevents.js');
              fbq('init', '${organization.metaPixelId}');
              fbq('track', 'PageView');
            `,
          }}
        />
      ) : null}

      <div className="mx-auto max-w-3xl space-y-8">
        <div className="text-center">
          {organization.name ? (
            <span className="rounded-full bg-indigo-100 px-3 py-1 text-[11px] font-bold text-indigo-800">{organization.name}</span>
          ) : null}
          <p className="mt-2 text-xs text-slate-500">{t.landingPage.headerCodNote}</p>
        </div>

        {sections.map((s) => renderSection(s))}

        {orderForm}
      </div>

      {/* High-Converting Sticky Bottom Bar (Mobile & Desktop) & Social Proof Toast */}
      <StickyBuyBar
        productName={product.name}
        imageUrl={product.imageUrl}
        unitMinor={unitMinor}
        quantity={quantity}
        onScrollToOrder={scrollToOrder}
        visible={true}
        takaFn={taka}
        locale={locale}
      />
      <RecentBuyersToast locale={locale} />

    </div>
  );
}
