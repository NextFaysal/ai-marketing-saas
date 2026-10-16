"use client";
import React, { useEffect, useRef, useState } from "react";
import { API_URL } from "@/lib/api";
import { captureAffiliateRef, currentAffiliateCode } from "@/lib/affiliate-ref";
import { ReviewsBlock, type PublicReviewItem, type PublicReviewsSummary } from "@/components/product-reviews";
import {
  UrgencyStockBar,
  BundleSelector,
  StickyBuyBar,
  RecentBuyersToast,
} from "./ConversionBoosters";

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
}

const taka = (minor?: string | number | null) =>
  minor == null ? "—" : `৳${(Number(minor) / 100).toLocaleString("en-IN", { maximumFractionDigits: 2 })}`;

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

function FaqBlock({ items }: { items: { q: string; a: string }[] }) {
  const [open, setOpen] = useState(0);
  if (!items.length) return null;
  return (
    <section className="space-y-3">
      <h2 className="text-xl font-black text-slate-900">সাধারণ প্রশ্নোত্তর</h2>
      <div className="space-y-2">
        {items.map((it, i) => (
          <div key={i} className="rounded-2xl border border-slate-200 bg-white">
            <button
              type="button"
              onClick={() => setOpen(open === i ? -1 : i)}
              className="flex w-full items-center justify-between gap-2 px-4 py-3 text-left text-sm font-bold text-slate-800"
            >
              <span>{it.q}</span>
              <span className="text-slate-400">{open === i ? "−" : "+"}</span>
            </button>
            {open === i ? <p className="whitespace-pre-line px-4 pb-4 text-sm leading-relaxed text-slate-600">{it.a}</p> : null}
          </div>
        ))}
      </div>
    </section>
  );
}

export default function LandingClient({ slug }: { slug: string }) {
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
          throw new Error(errData?.message || "ল্যান্ডিং পেজটি পাওয়া যায়নি।");
        }
        const json = (await res.json()) as LandingPayload;
        setData(json);
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
        setError(e instanceof Error ? e.message : "লোড করতে ব্যর্থ হয়েছে");
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
      setOrderError("অনুগ্রহ করে সঠিক ১১ ডিজিটের মোবাইল নম্বর দিন (যেমন: 017XXXXXXXX)");
      return;
    }
    if (data.delivery.hasZones && !district) {
      setOrderError("ডেলিভারির জন্য আপনার জেলা বেছে নিন।");
      return;
    }
    setSubmitting(true);
    setOrderError("");
    try {
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
        }),
      });
      if (!res.ok) {
        const errJson = await res.json().catch(() => null);
        // Server error verbatim — never paraphrased.
        throw new Error(errJson?.message || "অর্ডার সম্পন্ন করতে সমস্যা হয়েছে");
      }
      const out = (await res.json()) as OrderResult;
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
      setOrderError(err instanceof Error ? err.message : "অর্ডার ব্যর্থ হয়েছে");
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
        throw new Error(errJson?.message || "আপসেল যোগ করা যায়নি");
      }
      const out = await res.json();
      setUpsellAdded(true);
      if (out.totalMinor) setFinalTotalMinor(String(out.totalMinor));
    } catch (err) {
      setUpsellError(err instanceof Error ? err.message : "আপসেল যোগ করা যায়নি");
    } finally {
      setUpsellBusy(false);
    }
  }

  if (loading) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-slate-50 p-4">
        <div className="space-y-3 text-center">
          <div className="mx-auto h-10 w-10 animate-spin rounded-full border-4 border-indigo-600 border-t-transparent" />
          <p className="text-sm font-semibold text-slate-600">লোড হচ্ছে...</p>
        </div>
      </div>
    );
  }

  if (error || !data) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-slate-50 p-4">
        <div className="w-full max-w-md space-y-4 rounded-2xl border bg-white p-8 text-center shadow-sm">
          <div className="text-4xl">⚠️</div>
          <h2 className="text-lg font-bold text-slate-800">দুঃখিত!</h2>
          <p className="text-xs font-medium text-rose-600">{error || "পেজটি পাওয়া যায়নি"}</p>
          <a href="/" className="inline-block rounded-lg bg-indigo-600 px-5 py-2 text-xs font-semibold text-white">
            হোমে ফিরে যান
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
  const ctaText = variant?.ctaText || "অর্ডার করুন";
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
            <h1 className="text-2xl font-black text-slate-900">অর্ডার সফলভাবে গ্রহণ করা হয়েছে!</h1>
            <p className="mt-1 text-xs text-slate-500">
              ধন্যবাদ! আমাদের প্রতিনিধি শীঘ্রই আপনাকে কল করে কনফার্ম করবেন।
            </p>
          </div>
          <div className="space-y-2 rounded-2xl border bg-slate-50 p-4 text-left text-xs">
            <div className="flex justify-between border-b pb-2">
              <span className="text-slate-500">অর্ডার নম্বর:</span>
              <span className="font-bold text-slate-800">{orderCompleted.orderNumber}</span>
            </div>
            <div className="flex justify-between border-b pb-2">
              <span className="text-slate-500">পণ্য:</span>
              <span className="font-bold text-slate-800">{orderCompleted.productName}</span>
            </div>
            <div className="flex justify-between border-b pb-2">
              <span className="text-slate-500">সাবটোটাল:</span>
              <span className="font-semibold text-slate-800">{taka(orderCompleted.totals.subtotalMinor)}</span>
            </div>
            {Number(orderCompleted.totals.discountMinor) > 0 ? (
              <div className="flex justify-between border-b pb-2">
                <span className="text-slate-500">কুপন ছাড়:</span>
                <span className="font-bold text-emerald-700">− {taka(orderCompleted.totals.discountMinor)}</span>
              </div>
            ) : null}
            {(orderCompleted.promotionsApplied ?? []).map((p) => (
              <div key={p.promotionId} className="flex justify-between border-b pb-2">
                <span className="text-slate-500">প্রমোশন ছাড় — {p.name}:</span>
                <span className="font-bold text-emerald-700">− {taka(p.amountMinor)}</span>
              </div>
            ))}
            {orderCompleted.referralDiscountMinor && Number(orderCompleted.referralDiscountMinor) > 0 ? (
              <div className="flex justify-between border-b pb-2">
                <span className="text-slate-500">রেফারেল ছাড়{orderCompleted.referral?.code ? ` (${orderCompleted.referral.code})` : ""}:</span>
                <span className="font-bold text-emerald-700">− {taka(orderCompleted.referralDiscountMinor)}</span>
              </div>
            ) : null}
            <div className="flex justify-between border-b pb-2">
              <span className="text-slate-500">ডেলিভারি চার্জ:</span>
              <span className="font-semibold text-slate-800">{taka(orderCompleted.totals.shippingMinor)}</span>
            </div>
            <div className="flex justify-between pt-1 text-sm font-bold">
              <span className="text-slate-900">সর্বমোট (ক্যাশ অন ডেলিভারিতে প্রদেয়):</span>
              <span className="text-base text-emerald-700">{taka(totalMinor)}</span>
            </div>
          </div>

          {orderCompleted.hasDigitalItems ? (
            <div className="rounded-2xl border border-sky-200 bg-sky-50 p-4 text-sm font-semibold text-sky-900">
              ডিজিটাল পণ্য: ডেলিভারির পর ট্র্যাকিং পেজে ডাউনলোড লিংক পাওয়া যাবে
            </div>
          ) : null}

          {orderCompleted.yourReferralCode ? (
            <div className="rounded-2xl border border-indigo-200 bg-indigo-50 p-4 text-sm font-bold text-indigo-900">
              🎁 আপনার রেফারেল কোড: <span className="font-mono">{orderCompleted.yourReferralCode}</span> — বন্ধুদের দিলে তারা ছাড় পাবেন
            </div>
          ) : null}

          {upsell && orderCompleted.upsellEligible && !upsellAdded ? (
            <div className="space-y-3 rounded-2xl border-2 border-dashed border-amber-300 bg-amber-50/60 p-4 text-left">
              <div className="text-sm font-black text-slate-900">সাথে এটাও যোগ করুন</div>
              <div className="flex items-center gap-3">
                {upsell.imageUrl ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={upsell.imageUrl} alt={upsell.name} className="h-16 w-16 rounded-xl border border-slate-200 object-cover" />
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
                  {upsellBusy ? "যোগ হচ্ছে…" : "যোগ করুন"}
                </button>
              </div>
              <p className="text-[11px] text-slate-500">এক ক্লিকেই এই পণ্যটি আপনার একই অর্ডারে যোগ হয়ে যাবে — আলাদা ডেলিভারি চার্জ লাগবে না।</p>
              {upsellError ? <p className="rounded-lg bg-rose-50 px-3 py-2 text-xs font-medium text-rose-700">{upsellError}</p> : null}
            </div>
          ) : null}
          {upsellAdded ? (
            <p className="rounded-xl bg-emerald-50 p-3 text-sm font-bold text-emerald-800">
              ✅ আপসেল পণ্য যোগ হয়েছে! নতুন সর্বমোট: {taka(totalMinor)} (ডেলিভারির সময় প্রদেয়)
            </p>
          ) : null}

          {organization.slug ? (
            <a
              href={`/track/${organization.slug}`}
              className="block w-full rounded-xl bg-indigo-600 py-3 text-xs font-semibold text-white transition-colors hover:bg-indigo-700"
            >
              📦 অর্ডার ট্র্যাক করুন
            </a>
          ) : null}

          <button
            onClick={() => window.location.reload()}
            className="w-full rounded-xl bg-slate-900 py-3 text-xs font-semibold text-white transition-colors hover:bg-black"
          >
            আরেকটি অর্ডার করুন
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
                <img src={heroImage} alt={product.name} className="aspect-square w-full object-cover sm:aspect-[4/3]" />
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
                    <img src={src} alt="" className="h-full w-full object-cover" />
                  </button>
                ))}
              </div>
            ) : null}
            <div className="space-y-3 text-center">
              <UrgencyStockBar stockCount={product.stockQuantity} />
              <h1 className="text-2xl font-black leading-snug text-slate-900 sm:text-3xl">{headline}</h1>
              <div className="flex items-center justify-center gap-3">
                <span className="text-3xl font-extrabold text-indigo-700">{taka(unitMinor)}</span>
                {showCompareAt && product.compareAtMinor ? (
                  <span className="text-lg text-slate-400 line-through">{taka(product.compareAtMinor)}</span>
                ) : null}
              </div>
              {product.preorder ? (
                <p className="text-sm font-bold text-violet-700">প্রি-অর্ডার{product.preorder.releaseDate ? ` · রিলিজ: ${new Date(product.preorder.releaseDate).toLocaleDateString("bn-BD")}` : ""}</p>
              ) : product.stockQuantity === 0 ? (
                <p className="text-sm font-bold text-rose-600">দুঃখিত, পণ্যটি এই মুহূর্তে স্টকে নেই।</p>
              ) : null}
              {product.digital ? <p className="text-sm font-bold text-sky-700">ডিজিটাল পণ্য</p> : null}
              <button
                type="button"
                onClick={scrollToOrder}
                className="w-full rounded-2xl bg-indigo-600 py-4 text-base font-extrabold text-white shadow-lg shadow-indigo-600/30 transition hover:bg-indigo-700 sm:w-auto sm:px-10"
              >
                🛒 {ctaText}
              </button>
              <p className="text-[11px] text-slate-400">ক্যাশ অন ডেলিভারি · পণ্য হাতে পেয়ে টাকা পরিশোধ করুন</p>
            </div>
          </section>
        );
      case "description": {
        const text = (section.data?.text as string) || product.description || "";
        if (!text) return null;
        return (
          <section key="description" className="rounded-3xl border border-slate-200 bg-white p-6">
            <h2 className="text-xl font-black text-slate-900">পণ্যের বিবরণ</h2>
            <p className="mt-3 whitespace-pre-line text-sm leading-relaxed text-slate-600">{text}</p>
          </section>
        );
      }
      case "gallery":
        if (!galleryImages.length) return null;
        return (
          <section key="gallery" className="space-y-3">
            <h2 className="text-xl font-black text-slate-900">পণ্যের ছবি</h2>
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
              {galleryImages.map((src) => (
                // eslint-disable-next-line @next/next/no-img-element
                <img key={src} src={src} alt={product.name} className="aspect-square w-full rounded-2xl border border-slate-200 object-cover" />
              ))}
            </div>
          </section>
        );
      case "benefits": {
        const items = (Array.isArray(section.data?.items) ? section.data.items : []) as { icon?: string; title?: string; text?: string }[];
        if (!items.length) return null;
        return (
          <section key="benefits" className="space-y-3">
            <h2 className="text-xl font-black text-slate-900">কেন এই পণ্যটি নেবেন?</h2>
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
        return <FaqBlock key="faq" items={items} />;
      }
      case "offer":
        if (!hasBump || !showBumpInOffer) return null;
        return (
          <section key="offer" className="rounded-3xl border-2 border-dashed border-amber-300 bg-amber-50/60 p-6 text-center">
            <span className="rounded bg-amber-500 px-2 py-0.5 text-[11px] font-bold text-white">🔥 বিশেষ অফার</span>
            <h2 className="mt-3 text-xl font-black text-slate-900">{product.bumpTitle}</h2>
            <p className="mt-1 text-sm font-bold text-amber-900">মাত্র {taka(product.bumpPriceMinor)} অতিরিক্ত যোগ করে অর্ডারের সাথেই নিয়ে নিন</p>
            {product.bumpImageUrl ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={product.bumpImageUrl} alt={product.bumpTitle ?? ""} className="mx-auto mt-3 h-32 w-32 rounded-2xl border border-amber-200 object-cover" />
            ) : null}
            <button type="button" onClick={scrollToOrder} className="mt-4 rounded-xl bg-amber-500 px-6 py-2.5 text-sm font-extrabold text-white hover:bg-amber-600">
              অফারসহ অর্ডার করুন
            </button>
          </section>
        );
      case "trust": {
        const codText = (section.data?.codText as string) || "ক্যাশ অন ডেলিভারি — পণ্য হাতে পেয়ে যাচাই করে টাকা পরিশোধ করুন।";
        const deliveryText = (section.data?.deliveryText as string) || "সারা দেশে হোম ডেলিভারি — সাধারণত ২–৩ কার্যদিবসে পৌঁছে যায়।";
        const returnText = (section.data?.returnText as string) || "পণ্যে ত্রুটি থাকলে সহজ রিটার্ন/বদলির সুবিধা রয়েছে।";
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
      <h2 className="border-b pb-2 text-base font-bold text-slate-900">📍 অর্ডার করতে ফর্মটি পূরণ করুন</h2>
      <form
        onSubmit={handleOrderSubmit}
        onFocus={noteCheckoutStarted}
        onChange={noteCheckoutStarted}
        className="mt-4 space-y-4"
      >
        <div>
          <label className="mb-1 block text-xs font-bold text-slate-700">আপনার নাম *</label>
          <input
            type="text" required value={name} onChange={(e) => setName(e.target.value)}
            placeholder="যেমন: মোঃ সাব্বির আহমেদ"
            className="w-full rounded-xl border border-slate-300 p-2.5 text-sm focus:border-indigo-600 focus:outline-none"
          />
        </div>
        <div>
          <label className="mb-1 block text-xs font-bold text-slate-700">মোবাইল নম্বর *</label>
          <input
            type="tel" required value={phone} onChange={(e) => setPhone(e.target.value)}
            placeholder="01XXXXXXXXX"
            className="w-full rounded-xl border border-slate-300 p-2.5 font-mono text-sm font-bold focus:border-indigo-600 focus:outline-none"
          />
        </div>
        <div>
          <label className="mb-1 block text-xs font-bold text-slate-700">পূর্ণ ঠিকানা *</label>
          <textarea
            required rows={2} value={address} onChange={(e) => setAddress(e.target.value)}
            placeholder="বাড়ি নং, রোড নং, এলাকা, থানা ও জেলার নাম লিখুন..."
            className="w-full rounded-xl border border-slate-300 p-2.5 text-sm focus:border-indigo-600 focus:outline-none"
          />
        </div>

        {data.delivery.hasZones ? (
          <div>
            <label className="mb-1 block text-xs font-bold text-slate-700">জেলা বেছে নিন *</label>
            <select
              required value={district} onChange={(e) => setDistrict(e.target.value)}
              className="w-full rounded-xl border border-slate-300 p-2.5 text-sm focus:border-indigo-600 focus:outline-none"
            >
              <option value="">— জেলা বেছে নিন —</option>
              {data.districts.map((d) => <option key={d} value={d}>{d}</option>)}
            </select>
            <p className="mt-1 text-[11px] text-slate-400">ডেলিভারি চার্জ আপনার জেলার জোন অনুযায়ী অর্ডার নিশ্চিত হলে সার্ভার থেকে হিসাব হবে।</p>
          </div>
        ) : (
          <div>
            <label className="mb-1.5 block text-xs font-bold text-slate-700">ডেলিভারি এরিয়া বেছে নিন *</label>
            <div className="grid grid-cols-2 gap-3">
              <button
                type="button" onClick={() => setDeliveryZone("inside_dhaka")}
                className={`rounded-xl border p-3 text-left transition-all ${deliveryZone === "inside_dhaka" ? "border-indigo-600 bg-indigo-50/50 ring-2 ring-indigo-500" : "border-slate-200 bg-white"}`}
              >
                <div className="text-xs font-bold text-slate-900">ঢাকা সিটির ভেতরে</div>
              </button>
              <button
                type="button" onClick={() => setDeliveryZone("outside_dhaka")}
                className={`rounded-xl border p-3 text-left transition-all ${deliveryZone === "outside_dhaka" ? "border-indigo-600 bg-indigo-50/50 ring-2 ring-indigo-500" : "border-slate-200 bg-white"}`}
              >
                <div className="text-xs font-bold text-slate-900">ঢাকার বাইরে (সারা দেশ)</div>
              </button>
            </div>
            <p className="mt-1 text-[11px] text-slate-400">ডেলিভারি চার্জ অর্ডার নিশ্চিত হলে সার্ভার থেকে হিসাব হয়ে মোটে যোগ হবে।</p>
          </div>
        )}

        {visibleSlots.length > 0 ? (
          <div>
            <label className="mb-1 block text-xs font-bold text-slate-700">ডেলিভারি স্লট বেছে নিন (ঐচ্ছিক)</label>
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
              <option value="">স্লট বেছে নিইনি</option>
              {visibleSlots.map((s) => (
                <option key={s.id} value={s.id}>{s.label} ({s.startTime} – {s.endTime})</option>
              ))}
            </select>
            {slotId ? (
              <div className="mt-2">
                <label className="mb-1 block text-xs font-bold text-slate-700">ডেলিভারির তারিখ *</label>
                <input
                  type="date"
                  required
                  min={slotDateString(0)}
                  max={slotDateString(7)}
                  value={slotDate}
                  onChange={(e) => setSlotDate(e.target.value)}
                  className="w-full rounded-xl border border-slate-300 p-2.5 text-sm focus:border-indigo-600 focus:outline-none"
                />
                <p className="mt-1 text-[11px] text-slate-400">স্লট বেছে নিলে তারিখ দেওয়া বাধ্যতামূলক।</p>
              </div>
            ) : null}
          </div>
        ) : null}

        {product.variants.length > 0 ? (
          <div>
            <label className="mb-1 block text-xs font-bold text-slate-700">ভ্যারিয়েন্ট বেছে নিন</label>
            <select
              value={productVariantId} onChange={(e) => setProductVariantId(e.target.value)}
              className="w-full rounded-xl border border-slate-300 p-2.5 text-sm focus:border-indigo-600 focus:outline-none"
            >
              <option value="">ডিফল্ট</option>
              {product.variants.map((v) => (
                <option key={v.id} value={v.id} disabled={v.stockQuantity === 0}>
                  {v.name}{v.priceMinor ? ` — ${taka(v.priceMinor)}` : ""}{v.stockQuantity === 0 ? " (স্টক শেষ)" : ""}
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
        />

        <div className="flex items-center justify-between border-y py-3">
          <span className="text-xs font-bold text-slate-700">কাস্টম পরিমাণ নির্বাচন:</span>
          <div className="flex items-center overflow-hidden rounded-lg border">
            <button type="button" onClick={() => setQuantity(Math.max(1, quantity - 1))} className="bg-slate-50 px-3 py-1 font-bold text-slate-600 hover:bg-slate-100">−</button>
            <span className="px-4 py-1 text-sm font-bold text-slate-900">{quantity}</span>
            <button type="button" onClick={() => setQuantity(Math.min(99, quantity + 1))} className="bg-slate-50 px-3 py-1 font-bold text-slate-600 hover:bg-slate-100">+</button>
          </div>
        </div>

        {hasBump ? (
          <label className={`flex cursor-pointer items-start gap-2.5 rounded-xl border p-3.5 transition ${includeBump ? "border-amber-500 bg-amber-50/70 ring-2 ring-amber-400" : "border-dashed border-amber-300 bg-amber-50/20"}`}>
            <input type="checkbox" checked={includeBump} onChange={(e) => setIncludeBump(e.target.checked)} className="mt-0.5" />
            <span className="space-y-1">
              <span className="flex flex-wrap items-center gap-1.5">
                <span className="rounded bg-amber-500 px-1.5 py-0.5 text-[10px] font-bold text-white">🔥 বিশেষ অ্যাড-অন অফার</span>
                <span className="text-xs font-bold text-slate-900">{product.bumpTitle}</span>
              </span>
              <span className="block text-[11px] font-bold text-amber-900">মাত্র {taka(product.bumpPriceMinor)} অতিরিক্ত যোগ হবে</span>
            </span>
          </label>
        ) : null}

        <div>
          <label className="mb-1 block text-xs font-semibold text-slate-700">কুপন কোড (যদি থাকে)</label>
          <input
            type="text" value={couponCode} onChange={(e) => setCouponCode(e.target.value.toUpperCase())}
            placeholder="যেমন: EID10"
            className="w-full rounded-xl border border-slate-300 px-3 py-2 font-mono text-sm uppercase focus:border-indigo-500 focus:outline-none"
          />
          {couponCode.trim() ? <p className="mt-1 text-[11px] text-slate-400">কুপনের ছাড় অর্ডার নিশ্চিত করার সময় সার্ভার থেকে যাচাই হয়ে মোটে যোগ হবে।</p> : null}
        </div>

        <div>
          <label className="mb-1 block text-xs font-semibold text-slate-700">রেফারেল কোড (বন্ধুর কোড, যদি থাকে)</label>
          <input
            type="text" value={referralCode} onChange={(e) => setReferralCode(e.target.value)}
            placeholder="বন্ধুর রেফারেল কোড"
            className="w-full rounded-xl border border-slate-300 px-3 py-2 font-mono text-sm focus:border-indigo-500 focus:outline-none"
          />
        </div>

        <div className="rounded-xl border border-emerald-300 bg-emerald-50/60 p-3">
          <label className="flex cursor-pointer items-center gap-2 text-xs font-bold text-emerald-950">
            <input type="radio" name="payment" checked={paymentMethod === "cod"} readOnly className="text-emerald-600" />
            <span>💵 ক্যাশ অন ডেলিভারি (পণ্য পেয়ে টাকা দিন)</span>
          </label>
        </div>

        <div>
          <label className="mb-1 block text-[11px] font-semibold text-slate-500">বিশেষ কোনো নির্দেশনা (ঐচ্ছিক)</label>
          <input
            type="text" value={note} onChange={(e) => setNote(e.target.value)}
            placeholder="যেমন: বিকেলে ডেলিভারি দিলে ভালো হয়"
            className="w-full rounded-lg border border-slate-200 p-2 text-xs"
          />
        </div>

        <div className="space-y-2 text-xs">
          <div className="flex justify-between text-slate-600">
            <span>সাবটোটাল ({quantity}টি পণ্য{includeBump && hasBump ? " + অ্যাড-অন" : ""}):</span>
            <span className="font-semibold text-slate-900">{taka(subtotalPreview)}</span>
          </div>
          <div className="flex justify-between text-slate-600">
            <span>ডেলিভারি চার্জ:</span>
            <span className="font-semibold text-slate-900">অর্ডারের সময় হিসাব হবে</span>
          </div>
        </div>

        {orderError ? <p className="rounded-lg bg-rose-50 px-3 py-2 text-xs font-medium text-rose-700">{orderError}</p> : null}

        {/* EC18 trust copy near the place-order button — hidden when empty. */}
        {trustPromise?.trim() || trustPhone?.trim() ? (
          <div className="space-y-1 rounded-xl bg-slate-50 p-3 text-center">
            {trustPromise?.trim() ? <p className="text-xs font-semibold text-slate-700">🚚 {trustPromise.trim()}</p> : null}
            {trustPhone?.trim() ? <p className="text-xs text-slate-500">সাপোর্ট: <span className="font-mono font-semibold">{trustPhone.trim()}</span></p> : null}
          </div>
        ) : null}

        <button
          type="submit" disabled={submitting || product.stockQuantity === 0}
          className="w-full rounded-2xl bg-indigo-600 py-3.5 text-sm font-extrabold text-white shadow-lg shadow-indigo-600/30 transition hover:bg-indigo-700 disabled:opacity-50"
        >
          {submitting ? "অর্ডার প্রসেস হচ্ছে..." : `🚀 ${ctaText} — ক্যাশ অন ডেলিভারি`}
        </button>
        <p className="text-center text-[10px] text-slate-400">🔒 ১০০% নিরাপদ চেকআউট · পণ্য হাতে পেয়ে পেমেন্ট</p>

        {trustReturn?.trim() ? (
          <div className="border-t pt-3">
            <p className="text-[11px] font-bold text-slate-600">রিটার্ন নীতি</p>
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
          <p className="mt-2 text-xs text-slate-500">ক্যাশ অন ডেলিভারি সুবিধা · পণ্য হাতে পেয়ে চেক করে পেমেন্ট করার নিশ্চয়তা</p>
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
      />
      <RecentBuyersToast />
    </div>
  );
}
