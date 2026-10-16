"use client";
import React, { useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import dynamic from "next/dynamic";
import { useRouter } from "next/navigation";
import { formatMinor } from "@repo/contracts";
import { MediaImage } from "@/components/media-image";
import type { ShopProduct } from "@/lib/storefront-server";
import { fetchCart, getCartToken, patchCartLine } from "@/lib/storefront-cart";
import { shopT, type ShopLocale } from "@/lib/shop-i18n";
import { priceText, stockBadge } from "../../ProductCard";
import { WishlistHeart } from "../../WishlistHeart";
import { StockAlertForm } from "../../StockAlertForm";
import { setBuyBarActive, setBuyBarLiftPx } from "@/lib/shop-bottom-chrome";
import type { ShopTheme } from "@/lib/shop-theme";

// ED6 (EB2) — deferred chunks. ExpressCheckout renders null until
// its session check (an effect) resolves, so its SSR output is
// already empty and ssr:false is behaviour-identical; the sheet
// itself only opens on click. The lightbox renders only after the
// gallery image is clicked. Both chunks leave the PDP first load;
// props and behaviour are unchanged.
const ExpressCheckout = dynamic(
  () => import("../../ExpressCheckout").then((m) => m.ExpressCheckout),
  { ssr: false, loading: () => null },
);
const ProductLightbox = dynamic(
  () => import("./ProductLightbox").then((m) => m.ProductLightbox),
  { ssr: false, loading: () => null },
);

export function ProductDetailClient({
  orgSlug,
  product,
  locale = "bn",
  isV2 = false,
}: {
  orgSlug: string;
  product: ShopProduct;
  locale?: ShopLocale | string;
  /** ED8: v2 tokens, passed by the server page ONLY when the
   * effective theme is v2. Legacy rendering passes neither prop. */
  theme?: ShopTheme;
  isV2?: boolean;
}) {
  const t = shopT(locale);
  const router = useRouter();
  // ED8: sticky buy bar visibility — an IntersectionObserver on
  // the main buy block (buyRef) shows the bar once that block has
  // scrolled out of view. Documented fallback: where IO is
  // unavailable, the bar is simply always visible on mobile.
  const buyRef = useRef<HTMLDivElement | null>(null);
  const buyBarRef = useRef<HTMLDivElement | null>(null);
  const [barVisible, setBarVisible] = useState(false);
  const images = useMemo(() => {
    const list: string[] = [];
    for (const src of product.images ?? []) if (src && !list.includes(src)) list.push(src);
    if (product.imageUrl && !list.includes(product.imageUrl)) list.unshift(product.imageUrl);
    return list;
  }, [product]);

  const hasVideo = !!product.video;
  const slideOffset = hasVideo ? 1 : 0;
  const [slide, setSlide] = useState(0);
  const image = slide >= slideOffset ? (images[slide - slideOffset] ?? "") : "";
  const isVideoSlide = hasVideo && slide === 0;
  const [zoom, setZoom] = useState(false);
  const [origin, setOrigin] = useState("50% 50%");
  const [lightbox, setLightbox] = useState(false);
  const [lightboxIdx, setLightboxIdx] = useState(0);
  const [variantId, setVariantId] = useState<string>("");
  const [quantity, setQuantity] = useState(1);
  const [includeBump, setIncludeBump] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [added, setAdded] = useState(false);

  // ED8: buy-bar visibility via IntersectionObserver on the main
  // buy block. Fallback (no IO in the environment): always visible.
  useEffect(() => {
    if (!isV2) return;
    const el = buyRef.current;
    if (!el || typeof IntersectionObserver === "undefined") {
      setBarVisible(true);
      return;
    }
    const io = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) setBarVisible(!entry.isIntersecting);
      },
      { threshold: 0 },
    );
    io.observe(el);
    return () => io.disconnect();
  }, [isV2]);

  // ED8: while the buy bar is actually shown, it owns the phone's
  // bottom edge — the v2 bottom nav yields (shop-bottom-chrome).
  useEffect(() => {
    if (!isV2) return;
    setBuyBarActive(barVisible);
    return () => setBuyBarActive(false);
  }, [isV2, barVisible]);

  // ED9: while the buy bar is shown, publish its height as the
  // buy-bar bottom lift so floating overlays sit above it
  // (lib/shop-bottom-chrome takes max(navLift, buyBarLift)).
  useEffect(() => {
    if (!isV2 || !barVisible) {
      setBuyBarLiftPx(0);
      return;
    }
    const measure = () => setBuyBarLiftPx(buyBarRef.current?.offsetHeight || 64);
    measure();
    window.addEventListener("resize", measure);
    return () => {
      window.removeEventListener("resize", measure);
      setBuyBarLiftPx(0);
    };
  }, [isV2, barVisible]);

  // AB2 (AX3): gift-card purchase state — the chosen face value
  // (a preset chip, or a custom taka amount when allowed) plus
  // the optional recipient the card is delivered to.
  const gcConfig = product.isGiftCard ? (product.giftCardConfig ?? null) : null;
  const gcPresets = gcConfig?.presetAmountsMinor ?? [];
  const [gcPreset, setGcPreset] = useState<number | null>(gcPresets[0] ?? null);
  const [gcCustom, setGcCustom] = useState("");
  const [gcName, setGcName] = useState("");
  const [gcEmail, setGcEmail] = useState("");
  const [gcPhone, setGcPhone] = useState("");
  const [gcMessage, setGcMessage] = useState("");
  const [gcHint, setGcHint] = useState("");

  /** The face value (minor) the shopper picked, or null when
   * the custom amount is not a usable number yet. */
  function gcAmountMinor(): number | null {
    if (!product.isGiftCard) return null;
    if (gcCustom.trim()) {
      const taka = Number(gcCustom);
      if (!Number.isFinite(taka) || taka <= 0) return null;
      return Math.round(taka * 100);
    }
    if (gcPreset != null) return gcPreset;
    const price = Number(product.priceMinor);
    return Number.isFinite(price) && price > 0 ? price : null;
  }

  // ED6: the lightbox keyboard listener (Escape / arrows) moved
  // into ProductLightbox itself — it mounts exactly while the
  // lightbox is open, the same window this effect subscribed for.

  const variant = product.variants.find((v) => v.id === variantId) ?? null;
  const unitMinor = variant?.priceMinor ?? product.priceMinor;
  const stockState = variant ? variant.stockState : product.stockState;
  // EC24a: preorder products are orderable at zero stock.
  // AB2: gift-card products are minted value, not stock — the API
  // bypasses the stock guard for them, so they are never out of stock.
  const outOfStock = !product.isGiftCard && stockState === "out_of_stock" && !product.preorder;
  const badge = product.isGiftCard ? null : stockBadge(stockState, locale);

  // ED8: returns whether the line was actually added, so the
  // sticky buy bar's buy-now can reuse this EXACT handler and
  // navigate to checkout only on success. Existing callers ignore
  // the return value — behaviour is unchanged for them.
  async function addToCart(): Promise<boolean> {
    setBusy(true);
    setError("");
    setAdded(false);
    setGcHint("");
    try {
      // AB2: a gift-card line carries its face value + recipient
      // through the SAME cart PATCH. Client-side min/max checks
      // are a hint only — the server re-validates the amount
      // against the product's giftCardConfig.
      let gcFields: {
        giftCardAmountMinor?: string;
        giftCardRecipientName?: string;
        giftCardRecipientEmail?: string;
        giftCardRecipientPhone?: string;
        giftCardRecipientMessage?: string;
      } = {};
      if (product.isGiftCard) {
        const amount = gcAmountMinor();
        if (amount == null) {
          setGcHint("গিফট কার্ডের পরিমাণটি সঠিকভাবে লিখুন।");
          return false;
        }
        if (gcCustom.trim() && gcConfig?.allowCustomAmount) {
          if (gcConfig.minAmountMinor != null && amount < gcConfig.minAmountMinor) {
            setGcHint(`সর্বনিম্ন পরিমাণ ${priceText(String(gcConfig.minAmountMinor))} — এর কমে কার্ড কেনা যাবে না।`);
            return false;
          }
          if (gcConfig.maxAmountMinor != null && amount > gcConfig.maxAmountMinor) {
            setGcHint(`সর্বোচ্চ পরিমাণ ${priceText(String(gcConfig.maxAmountMinor))} — এর বেশি কার্ড কেনা যাবে না।`);
            return false;
          }
        }
        gcFields = {
          giftCardAmountMinor: String(amount),
          ...(gcName.trim() ? { giftCardRecipientName: gcName.trim() } : {}),
          ...(gcEmail.trim() ? { giftCardRecipientEmail: gcEmail.trim() } : {}),
          ...(gcPhone.trim() ? { giftCardRecipientPhone: gcPhone.trim() } : {}),
          ...(gcMessage.trim() ? { giftCardRecipientMessage: gcMessage.trim() } : {}),
        };
      }
      // PATCH sets the line's absolute quantity — merge with any
      // existing line for the same product/variant first.
      const cart = await fetchCart(orgSlug);
      const existing = cart?.items.find(
        (i) => i.productId === product.id && (i.variantId ?? null) === (variantId || null),
      );
      const nextQty = Math.min(99, (existing?.quantity ?? 0) + quantity);
      await patchCartLine(orgSlug, {
        productId: product.id,
        variantId: variantId || null,
        quantity: nextQty,
        includeBump: product.isGiftCard ? false : includeBump,
        ...gcFields,
      });
      setAdded(true);
      return true;
    } catch (e) {
      setError(e instanceof Error ? e.message : t.product.addToCartError);
      return false;
    } finally {
      setBusy(false);
    }
  }

  // ED8: buy-now for the sticky bar — there is no separate buy-now
  // flow on this page today (the main buy button IS addToCart, and
  // the post-add state offers the checkout link), so buy-now =
  // the existing addToCart handler + navigation to the existing
  // checkout route, only when the add actually succeeded.
  async function buyNow() {
    const ok = await addToCart();
    if (ok) router.push(`/shop/${orgSlug}/checkout`);
  }

  // ED8: the main buy block, extracted verbatim so the v2 branch
  // can wrap it in the IntersectionObserver sentinel div while the
  // legacy branch renders it exactly as before (no extra node).
  const buyBlock = added ? (
    <div className="space-y-2 rounded-xl bg-emerald-50 p-3 text-center">
      <p className="text-sm font-bold text-emerald-800">{t.product.added}</p>
      <div className="flex justify-center gap-2">
        <Link href={`/shop/${orgSlug}/cart`} className="rounded-lg bg-white px-4 py-2 text-xs font-bold text-slate-700 border">{t.product.viewCart}</Link>
        <Link href={`/shop/${orgSlug}/checkout`} className="btn-brand rounded-lg px-4 py-2 text-xs font-bold">{t.product.checkoutNow}</Link>
      </div>
    </div>
  ) : (
    <button
      type="button"
      onClick={addToCart}
      disabled={busy || outOfStock}
      className="btn-brand btn-brand-shadow w-full rounded-2xl py-3.5 text-sm font-extrabold disabled:opacity-50"
    >
      {outOfStock ? t.product.outOfStockOrder : busy ? t.product.adding : t.product.addToCart}
    </button>
  );

  const mainContent = (
    <div className="grid gap-6 md:grid-cols-2">
      {/* Gallery — GC: video slide 0 + image zoom + lightbox */}
      <div className="space-y-3">
        <div className="overflow-hidden rounded-3xl border border-slate-200 bg-white">
          {isVideoSlide && product.video ? (
            product.video.kind === "file" ? (
              <video controls poster={product.video.posterUrl ?? undefined} src={product.video.url} className="aspect-square w-full bg-black object-contain" />
            ) : (
              <iframe
                src={product.video.embedUrl}
                title={t.product.watchVideo}
                allowFullScreen
                className="aspect-square w-full bg-black"
                allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
              />
            )
          ) : image ? (
            <div
              className="relative overflow-hidden"
              onMouseMove={(e) => {
                const rect = e.currentTarget.getBoundingClientRect();
                const x = rect.width ? ((e.clientX - rect.left) / rect.width) * 100 : 50;
                const y = rect.height ? ((e.clientY - rect.top) / rect.height) * 100 : 50;
                setOrigin(`${x}% ${y}%`);
              }}
              onMouseEnter={() => {
                try {
                  if (window.matchMedia("(hover: hover)").matches) setZoom(true);
                } catch { /* no hover — no zoom */ }
              }}
              onMouseLeave={() => setZoom(false)}
              onClick={() => {
                setLightboxIdx(Math.max(0, slide - slideOffset));
                setLightbox(true);
              }}
            >
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <MediaImage
                src={image}
                alt={product.name}
                width={1200}
                height={1200}
                priority
                sizes="(max-width: 768px) 100vw, 600px"
                style={{ transformOrigin: origin }}
                className={`aspect-square w-full cursor-zoom-in object-cover transition-transform duration-200 ${zoom ? "scale-[1.8]" : ""}`}
              />
            </div>
          ) : (
            <div className="flex aspect-square w-full items-center justify-center bg-indigo-50 text-7xl">📦</div>
          )}
        </div>
        {images.length + slideOffset > 1 ? (
          <div className="flex flex-wrap gap-2">
            {hasVideo && product.video ? (
              <button
                type="button"
                onClick={() => setSlide(0)}
                title={t.product.watchVideo}
                aria-label={t.product.watchVideo}
                className={`relative h-16 w-16 overflow-hidden rounded-xl border-2 ${slide === 0 ? "border-indigo-600" : "border-slate-200"}`}
              >
                {product.video.posterUrl ? (
                  <MediaImage src={product.video.posterUrl} alt="" width={128} height={128} className="h-full w-full object-cover" />
                ) : (
                  <span className="flex h-full w-full items-center justify-center bg-slate-900" />
                )}
                <span className="absolute inset-0 flex items-center justify-center text-xl text-white drop-shadow">▶</span>
              </button>
            ) : null}
            {images.map((src, i) => (
              <button
                key={src}
                type="button"
                onClick={() => setSlide(i + slideOffset)}
                className={`h-16 w-16 overflow-hidden rounded-xl border-2 ${src === image && !isVideoSlide ? "border-indigo-600" : "border-slate-200"}`}
              >
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <MediaImage src={src} alt="" width={160} height={160} className="h-full w-full object-cover" />
              </button>
            ))}
          </div>
        ) : null}
        {lightbox && images.length > 0 ? (
          <ProductLightbox
            images={images}
            index={lightboxIdx}
            productName={product.name}
            closeLabel={t.popup.close}
            onClose={() => setLightbox(false)}
            onNavigate={setLightboxIdx}
          />
        ) : null}
      </div>

      {/* Buy panel — ED8: v2 gets the token-native info-panel
          surface + large brand price; legacy classes unchanged. */}
      <div className={isV2 ? "space-y-4 rounded-[var(--radius-xl)] border border-[var(--border-soft)] bg-[var(--surface)] p-6 shadow-[var(--shadow-card)]" : "space-y-4 rounded-3xl border border-slate-200 bg-white p-6 shadow-sm"}>
        <div>
          <h1 className={isV2 ? "text-2xl font-black text-[var(--ink-strong)]" : "text-2xl font-black text-slate-900"}>{product.name}</h1>
          <div className="mt-2 flex flex-wrap items-center gap-2">
            <span className={isV2 ? "text-3xl font-extrabold text-[var(--brand)]" : "text-2xl font-extrabold text-indigo-700"}>{priceText(unitMinor)}</span>
            {product.compareAtMinor && !variant ? (
              <span className={isV2 ? "text-sm text-[var(--ink-faint)] line-through" : "text-sm text-slate-400 line-through"}>{priceText(product.compareAtMinor)}</span>
            ) : null}
            {product.freeShipping ? <span className="rounded-full bg-sky-100 px-2 py-0.5 text-[11px] font-bold text-sky-700">{t.brand.freeDeliveryBadge}</span> : null}
            {badge ? <span className={`rounded-full px-2 py-0.5 text-[11px] font-bold ${badge.cls}`}>{badge.label}</span> : null}
            {product.preorder ? (
              <span className="rounded-full bg-violet-100 px-2 py-0.5 text-[11px] font-bold text-violet-700">
                প্রি-অর্ডার{product.preorder.releaseDate ? ` · ${new Date(product.preorder.releaseDate).toLocaleDateString("bn-BD")}` : ""}
              </span>
            ) : null}
            {product.digital ? (
              <span className="rounded-full bg-sky-100 px-2 py-0.5 text-[11px] font-bold text-sky-700">ডিজিটাল পণ্য</span>
            ) : null}
            {product.isGiftCard ? (
              <span className="rounded-full bg-pink-100 px-2 py-0.5 text-[11px] font-bold text-pink-700">🎁 গিফট কার্ড</span>
            ) : null}
          </div>
          {product.sku ? <p className="mt-1 text-[11px] text-slate-400">SKU: {product.sku}</p> : null}
          {product.brand ? (
            <p className="mt-1 text-xs text-slate-500">
              {t.brand.brandLabel}:{" "}
              <Link href={`/shop/${orgSlug}/brands/${product.brand.slug}`} className="font-bold text-indigo-700 hover:underline">
                {product.brand.name}
              </Link>
            </p>
          ) : null}
        </div>

        {product.description ? <p className="whitespace-pre-line text-sm leading-relaxed text-slate-600">{product.description}</p> : null}

        {/* AB2 (AX3): gift-card panel — face-value picker +
            optional recipient, INSTEAD of the normal variant /
            stock semantics (a gift card is minted value). */}
        {product.isGiftCard ? (
          <div className="space-y-3 rounded-2xl border border-pink-200 bg-pink-50/50 p-4">
            <p className="text-sm font-bold text-pink-900">🎁 গিফট কার্ডের পরিমাণ বেছে নিন</p>
            <p className="text-xs leading-relaxed text-slate-600">
              এটি একটি গিফট কার্ড — কেনার পর অর্ডার ডেলিভারি সম্পন্ন হলে কোডটি পাওয়া যাবে।
              প্রাপকের ইমেইল বা ফোন দিলে কোডটি সরাসরি প্রাপকের কাছে পাঠানো হবে; না দিলে
              ক্রেতা নিজের অর্ডারের ট্র্যাকিং পেজে কোডটি দেখতে পাবেন।
            </p>
            {gcPresets.length > 0 ? (
              <div className="flex flex-wrap gap-2">
                {gcPresets.map((preset) => {
                  const active = !gcCustom.trim() && gcPreset === preset;
                  return (
                    <button
                      key={preset}
                      type="button"
                      onClick={() => { setGcPreset(preset); setGcCustom(""); setGcHint(""); }}
                      className={`rounded-xl px-4 py-2 text-sm font-extrabold ${active ? "bg-pink-600 text-white" : "border border-pink-300 bg-white text-pink-800"}`}
                    >
                      {priceText(String(preset))}
                    </button>
                  );
                })}
              </div>
            ) : null}
            {gcConfig?.allowCustomAmount ? (
              <div>
                <label className="mb-1 block text-xs font-bold text-slate-700" htmlFor="gc-custom-amount">নিজের পছন্দমতো পরিমাণ (৳)</label>
                <input
                  id="gc-custom-amount"
                  type="number"
                  min={0}
                  step="0.01"
                  value={gcCustom}
                  onChange={(e) => { setGcCustom(e.target.value); setGcHint(""); }}
                  placeholder="যেমন: ৭৫০"
                  className="w-full rounded-xl border border-pink-300 bg-white p-2.5 text-sm focus:border-pink-500 focus:outline-none"
                />
                <p className="mt-1 text-[11px] text-slate-500">
                  {gcConfig.minAmountMinor != null ? `সর্বনিম্ন ${priceText(String(gcConfig.minAmountMinor))}` : ""}
                  {gcConfig.minAmountMinor != null && gcConfig.maxAmountMinor != null ? " · " : ""}
                  {gcConfig.maxAmountMinor != null ? `সর্বোচ্চ ${priceText(String(gcConfig.maxAmountMinor))}` : ""}
                  {(gcConfig.minAmountMinor != null || gcConfig.maxAmountMinor != null) ? " — চূড়ান্ত যাচাই সার্ভারেই হবে।" : "চূড়ান্ত যাচাই সার্ভারেই হবে।"}
                </p>
              </div>
            ) : null}
            <div className="grid gap-2 sm:grid-cols-2">
              <div>
                <label className="mb-1 block text-xs font-bold text-slate-700" htmlFor="gc-recipient-name">প্রাপকের নাম (ঐচ্ছিক)</label>
                <input id="gc-recipient-name" value={gcName} onChange={(e) => setGcName(e.target.value)} className="w-full rounded-xl border border-slate-300 bg-white p-2.5 text-sm focus:border-pink-500 focus:outline-none" />
              </div>
              <div>
                <label className="mb-1 block text-xs font-bold text-slate-700" htmlFor="gc-recipient-phone">প্রাপকের ফোন (ঐচ্ছিক)</label>
                <input id="gc-recipient-phone" type="tel" value={gcPhone} onChange={(e) => setGcPhone(e.target.value)} placeholder="01XXXXXXXXX" className="w-full rounded-xl border border-slate-300 bg-white p-2.5 font-mono text-sm focus:border-pink-500 focus:outline-none" />
              </div>
              <div className="sm:col-span-2">
                <label className="mb-1 block text-xs font-bold text-slate-700" htmlFor="gc-recipient-email">প্রাপকের ইমেইল (ঐচ্ছিক)</label>
                <input id="gc-recipient-email" type="email" value={gcEmail} onChange={(e) => setGcEmail(e.target.value)} placeholder="you@example.com" className="w-full rounded-xl border border-slate-300 bg-white p-2.5 text-sm focus:border-pink-500 focus:outline-none" />
              </div>
              <div className="sm:col-span-2">
                <label className="mb-1 block text-xs font-bold text-slate-700" htmlFor="gc-recipient-message">বার্তা (ঐচ্ছিক)</label>
                <textarea id="gc-recipient-message" rows={2} maxLength={500} value={gcMessage} onChange={(e) => setGcMessage(e.target.value)} className="w-full rounded-xl border border-slate-300 bg-white p-2.5 text-sm focus:border-pink-500 focus:outline-none" />
              </div>
            </div>
            {gcHint ? <p className="rounded-lg bg-amber-50 px-3 py-2 text-xs font-medium text-amber-800">{gcHint}</p> : null}
          </div>
        ) : null}

        {product.variants.length > 0 && !product.isGiftCard ? (
          <div>
            <label className="mb-1.5 block text-xs font-bold text-slate-700" htmlFor="variant">{t.product.variantLabel}</label>
            <select
              id="variant"
              value={variantId}
              onChange={(e) => setVariantId(e.target.value)}
              className="w-full rounded-xl border border-slate-300 p-2.5 text-sm focus:border-indigo-600 focus:outline-none"
            >
              <option value="">{t.product.defaultVariant}</option>
              {product.variants.map((v) => (
                <option key={v.id} value={v.id} disabled={v.stockState === "out_of_stock"}>
                  {v.name}
                  {v.priceMinor ? ` — ${priceText(v.priceMinor)}` : ""}
                  {v.stockState === "out_of_stock" ? ` (${t.product.outOfStock})` : v.stockState === "low" ? ` (${t.product.lowStock})` : ""}
                </option>
              ))}
            </select>
            {variant ? (
              <p className="mt-1 text-[11px] text-slate-500">
                {t.product.selected} <b>{variant.name}</b> — {priceText(variant.priceMinor ?? product.priceMinor)}
              </p>
            ) : null}
          </div>
        ) : null}

        <div className="flex items-center justify-between border-y py-3">
          <span className="text-xs font-bold text-slate-700">{product.isGiftCard ? "কয়টি কার্ড" : t.product.quantity}</span>
          <div className="flex items-center overflow-hidden rounded-lg border">
            <button type="button" onClick={() => setQuantity(Math.max(1, quantity - 1))} className="bg-slate-50 px-3 py-1 font-bold text-slate-600 hover:bg-slate-100">−</button>
            <span className="px-4 py-1 text-sm font-bold text-slate-900">{quantity}</span>
            <button type="button" onClick={() => setQuantity(Math.min(99, quantity + 1))} className="bg-slate-50 px-3 py-1 font-bold text-slate-600 hover:bg-slate-100">+</button>
          </div>
        </div>

        {product.bump && !product.isGiftCard ? (
          <label
            className={`flex cursor-pointer items-start gap-2.5 rounded-xl border p-3.5 transition ${includeBump ? "border-amber-500 bg-amber-50/70 ring-2 ring-amber-400" : "border-dashed border-amber-300 bg-amber-50/20"}`}
          >
            <input type="checkbox" checked={includeBump} onChange={(e) => setIncludeBump(e.target.checked)} className="mt-0.5" />
            <span className="space-y-1">
              <span className="flex flex-wrap items-center gap-1.5">
                <span className="rounded bg-amber-500 px-1.5 py-0.5 text-[10px] font-bold text-white">{t.product.bumpBadge}</span>
                <span className="text-xs font-bold text-slate-900">{product.bump.title}</span>
              </span>
              <span className="block text-[11px] font-bold text-amber-900">
                {t.product.bumpExtraPrefix}{formatMinor(BigInt(product.bump.priceMinor))}{t.product.bumpExtraSuffix}
              </span>
            </span>
          </label>
        ) : null}

        <div className="flex items-center gap-2">
          <span className="text-xs font-bold text-slate-700">{t.common.wishlist}:</span>
          <WishlistHeart orgSlug={orgSlug} productId={product.id} locale={locale} />
        </div>

        {error ? <p className="rounded-lg bg-rose-50 px-3 py-2 text-xs font-medium text-rose-700">{error}</p> : null}

        {isV2 ? <div ref={buyRef}>{buyBlock}</div> : buyBlock}
        {/* AB4 (AX5c): express checkout for logged-in shoppers —
            ensures a cart for THIS product/variant/quantity first,
            mirroring the add-to-cart merge above. Gift-card lines
            need their recipient flow, so they stay on the normal
            checkout. */}
        {!product.isGiftCard && !outOfStock ? (
          <ExpressCheckout
            orgSlug={orgSlug}
            ensureCart={async () => {
              const cart = await fetchCart(orgSlug);
              const existing = cart?.items.find(
                (i) => i.productId === product.id && (i.variantId ?? null) === (variantId || null),
              );
              const nextQty = Math.min(99, (existing?.quantity ?? 0) + quantity);
              await patchCartLine(orgSlug, {
                productId: product.id,
                variantId: variantId || null,
                quantity: nextQty,
                includeBump,
              });
              const token = getCartToken(orgSlug);
              if (!token) throw new Error("কার্ট তৈরি করা যায়নি — আবার চেষ্টা করুন।");
              return token;
            }}
          />
        ) : null}
        <p className="text-center text-[11px] text-slate-400">{t.product.priceNote}</p>

        {/* EC28: back-in-stock alert — only while actually out of stock. */}
        {outOfStock ? (
          <StockAlertForm
            orgSlug={orgSlug}
            productId={product.id}
            variantSku={variant?.sku ?? null}
            locale={locale}
          />
        ) : null}
      </div>
    </div>
  );

  if (!isV2) return mainContent;

  // ED8: sticky buy bar (v2, mobile only). Price is variant-aware
  // via the same unitMinor computation as the panel; for gift-card
  // products it shows the currently selected face value
  // (gcAmountMinor — the same state addToCart validates), falling
  // back to unitMinor while a custom amount is not yet usable.
  // Both buttons reuse the existing handlers (addToCart / buyNow);
  // out-of-stock disables them exactly like the main button.
  const gcBarMinor = product.isGiftCard ? gcAmountMinor() : null;
  const barPriceMinor = gcBarMinor != null ? String(gcBarMinor) : unitMinor;
  const buyBar = barVisible ? (
    <div
      ref={buyBarRef}
      className="fixed inset-x-0 bottom-0 z-30 border-t border-[var(--border-soft)] bg-[var(--surface)] shadow-[var(--shadow-card)] lg:hidden"
      style={{ paddingBottom: "env(safe-area-inset-bottom)" }}
    >
      <div className="flex items-center gap-2.5 px-3 py-2.5">
        {product.imageUrl ? (
          // eslint-disable-next-line @next/next/no-img-element
          <MediaImage src={product.imageUrl} alt="" width={88} height={88} className="h-11 w-11 shrink-0 rounded-[var(--radius-md)] object-cover" />
        ) : (
          <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-[var(--radius-md)] bg-[var(--brand-soft)] text-lg">📦</div>
        )}
        <div className="min-w-0 flex-1">
          <p className="line-clamp-1 text-xs font-bold text-[var(--ink-strong)]">{product.name}</p>
          <p className="text-sm font-extrabold text-[var(--brand)]">{priceText(barPriceMinor)}</p>
        </div>
        <button
          type="button"
          onClick={addToCart}
          disabled={busy || outOfStock}
          className="btn-brand min-h-11 shrink-0 rounded-[var(--radius-md)] px-2.5 py-2.5 text-[11px] font-extrabold disabled:opacity-50"
        >
          {outOfStock ? t.product.outOfStock : busy ? t.product.adding : t.product.addToCart}
        </button>
        <button
          type="button"
          onClick={buyNow}
          disabled={busy || outOfStock}
          className="btn-brand min-h-11 shrink-0 rounded-[var(--radius-md)] px-2.5 py-2.5 text-[11px] font-extrabold disabled:opacity-50"
        >
          {t.product.buyNow}
        </button>
      </div>
    </div>
  ) : null;

  return (
    <>
      {mainContent}
      {buyBar}
    </>
  );
}
