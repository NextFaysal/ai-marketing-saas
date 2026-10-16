"use client";
import React, { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { formatMinor } from "@repo/contracts";
import { MediaImage } from "@/components/media-image";
import type { ShopProduct } from "@/lib/storefront-server";
import { fetchCart, getCartToken, patchCartLine } from "@/lib/storefront-cart";
import { ExpressCheckout } from "../../ExpressCheckout";
import { shopT, type ShopLocale } from "@/lib/shop-i18n";
import { priceText, stockBadge } from "../../ProductCard";
import { WishlistHeart } from "../../WishlistHeart";
import { StockAlertForm } from "../../StockAlertForm";
import {
  FashionSizeGuideModal,
  FashionFitAssistantModal,
  FashionRestockAlertModal,
  FashionModelStats,
  FashionFabricCareGuide,
  FashionCompleteTheLook,
} from "../../FashionTheme";
import {
  ElectronicsEmiCalculatorModal,
  ElectronicsWarrantyBox,
  ElectronicsBranchStock,
  ElectronicsAccessoriesCombo,
  ElectronicsCompareModal,
  ElectronicsWarrantyLookupModal,
  ElectronicsCompatibilityChecker,
} from "../../ElectronicsTheme";
import {
  GroceryWeightSelector,
  GroceryMonthlyBazarBundle,
  GroceryPurityCertModal,
  GroceryNutritionFacts,
  GroceryDeliverySlotPicker,
} from "../../GroceryTheme";
import {
  BeautyShadeSelector,
  BeautyRoutineBundle,
  BeautyIngredientsGuide,
  BeautyAuthenticityModal,
  BeautySkinQuizModal,
} from "../../BeautyTheme";
import {
  FurnitureFinishSelector,
  FurnitureDimensionSpecs,
  FurnitureRoomSetBundle,
  FurnitureWarrantyModal,
  FurnitureRoomVisualizerModal,
} from "../../FurnitureTheme";
import {
  BooksLookInsideModal,
  BooksBindingSelector,
  BooksDetailSpecs,
  BooksAuthorBox,
  BooksReadingBundle,
} from "../../BooksTheme";
import {
  KidsAgeSelector,
  KidsSafetySpecs,
  KidsSafetyModal,
  KidsGiftHamperBundle,
} from "../../KidsTheme";
import {
  AutomotiveFitmentModal,
  AutomotiveViscositySelector,
  AutomotivePartSpecs,
  AutomotiveTuneupBundle,
} from "../../AutomotiveTheme";
import {
  SportsAssemblyModal,
  SportsWeightSelector,
  SportsEquipmentSpecs,
  SportsWorkoutBundle,
} from "../../SportsTheme";
import {
  JewelryKaratSelector,
  JewelryCertificateModal,
  JewelryRingSizeModal,
  JewelryBridalBundle,
} from "../../JewelryTheme";

export function ProductDetailClient({
  orgSlug,
  product,
  locale = "bn",
  isFashion = false,
  isElectronics = false,
  isGrocery = false,
  isBeauty = false,
  isFurniture = false,
  isBooks = false,
  isKids = false,
  isAutomotive = false,
  isSports = false,
  isJewelry = false,
  relatedProducts = [],
}: {
  orgSlug: string;
  product: ShopProduct;
  locale?: ShopLocale | string;
  isFashion?: boolean;
  isElectronics?: boolean;
  isGrocery?: boolean;
  isBeauty?: boolean;
  isFurniture?: boolean;
  isBooks?: boolean;
  isKids?: boolean;
  isAutomotive?: boolean;
  isSports?: boolean;
  isJewelry?: boolean;
  relatedProducts?: ShopProduct[];
}) {
  const t = shopT(locale);
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
  const [sizeGuideOpen, setSizeGuideOpen] = useState(false);
  const [fitModalOpen, setFitModalOpen] = useState(false);
  const [restockOpen, setRestockOpen] = useState(false);
  const [restockSize, setRestockSize] = useState("");
  const [emiModalOpen, setEmiModalOpen] = useState(false);
  const [compareModalOpen, setCompareModalOpen] = useState(false);
  const [warrantyLookupOpen, setWarrantyLookupOpen] = useState(false);
  const [purityCertOpen, setPurityCertOpen] = useState(false);
  const [selectedWeight, setSelectedWeight] = useState("১ কেজি");
  const [authModalOpen, setAuthModalOpen] = useState(false);
  const [skinQuizOpen, setSkinQuizOpen] = useState(false);
  const [selectedShade, setSelectedShade] = useState("Fair Ivory 110");
  const [furnitureWarrantyOpen, setFurnitureWarrantyOpen] = useState(false);
  const [visualizerOpen, setVisualizerOpen] = useState(false);
  const [selectedFinish, setSelectedFinish] = useState("সেগুন কাঠ ফিনিশ (Solid Teak)");
  const [lookInsideModalOpen, setLookInsideModalOpen] = useState(false);
  const [selectedBinding, setSelectedBinding] = useState("হার্ডকভার বাঁধাই");
  const [kidsSafetyModalOpen, setKidsSafetyModalOpen] = useState(false);
  const [selectedAgeGroup, setSelectedAgeGroup] = useState("০ – ৬ মাস (নবজাতক)");
  const [fitmentModalOpen, setFitmentModalOpen] = useState(false);
  const [selectedViscosity, setSelectedViscosity] = useState("10W-40 (Full Synthetic)");
  const [assemblyModalOpen, setAssemblyModalOpen] = useState(false);
  const [selectedGymWeight, setSelectedGymWeight] = useState("১০ কেজি (জোড়া)");
  const [certModalOpen, setCertModalOpen] = useState(false);
  const [ringSizeModalOpen, setRingSizeModalOpen] = useState(false);
  const [selectedKarat, setSelectedKarat] = useState("২২ ক্যারেট হলুদ সোনা");
  const [selectedRingSize, setSelectedRingSize] = useState("US 7 (17.3 mm)");

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

  useEffect(() => {
    if (!lightbox) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setLightbox(false);
      if (e.key === "ArrowRight") setLightboxIdx((i) => (images.length ? (i + 1) % images.length : i));
      if (e.key === "ArrowLeft") setLightboxIdx((i) => (images.length ? (i - 1 + images.length) % images.length : i));
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [lightbox, images.length]);

  const variant = product.variants.find((v) => v.id === variantId) ?? null;
  const unitMinor = variant?.priceMinor ?? product.priceMinor;
  const stockState = variant ? variant.stockState : product.stockState;
  // EC24a: preorder products are orderable at zero stock.
  // AB2: gift-card products are minted value, not stock — the API
  // bypasses the stock guard for them, so they are never out of stock.
  const outOfStock = !product.isGiftCard && stockState === "out_of_stock" && !product.preorder;
  const badge = product.isGiftCard ? null : stockBadge(stockState, locale);

  async function addToCart() {
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
          return;
        }
        if (gcCustom.trim() && gcConfig?.allowCustomAmount) {
          if (gcConfig.minAmountMinor != null && amount < gcConfig.minAmountMinor) {
            setGcHint(`সর্বনিম্ন পরিমাণ ${priceText(String(gcConfig.minAmountMinor))} — এর কমে কার্ড কেনা যাবে না।`);
            return;
          }
          if (gcConfig.maxAmountMinor != null && amount > gcConfig.maxAmountMinor) {
            setGcHint(`সর্বোচ্চ পরিমাণ ${priceText(String(gcConfig.maxAmountMinor))} — এর বেশি কার্ড কেনা যাবে না।`);
            return;
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
    } catch (e) {
      setError(e instanceof Error ? e.message : t.product.addToCartError);
    } finally {
      setBusy(false);
    }
  }

  return (
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
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={product.video.posterUrl} alt="" className="h-full w-full object-cover" />
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
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/90 p-4" onClick={() => setLightbox(false)}>
            <button type="button" aria-label={t.popup.close} onClick={() => setLightbox(false)} className="absolute right-4 top-4 flex h-10 w-10 items-center justify-center rounded-full bg-white/10 text-2xl text-white">×</button>
            {images.length > 1 ? (
              <>
                <button type="button" aria-label="Previous" onClick={(e) => { e.stopPropagation(); setLightboxIdx((lightboxIdx - 1 + images.length) % images.length); }} className="absolute left-4 top-1/2 flex h-10 w-10 -translate-y-1/2 items-center justify-center rounded-full bg-white/10 text-2xl text-white">‹</button>
                <button type="button" aria-label="Next" onClick={(e) => { e.stopPropagation(); setLightboxIdx((lightboxIdx + 1) % images.length); }} className="absolute right-4 top-1/2 flex h-10 w-10 -translate-y-1/2 items-center justify-center rounded-full bg-white/10 text-2xl text-white">›</button>
              </>
            ) : null}
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={images[lightboxIdx]} alt={product.name} className="max-h-[90vh] max-w-full object-contain" onClick={(e) => e.stopPropagation()} />
          </div>
        ) : null}
      </div>

      {/* Buy panel */}
      <div className="space-y-4 rounded-3xl border border-slate-200 bg-white p-6 shadow-sm">
        <div>
          <h1 className="text-2xl font-black text-slate-900">{product.name}</h1>
          <div className="mt-2 flex flex-wrap items-center gap-2">
            <span className="text-2xl font-extrabold text-indigo-700">{priceText(unitMinor)}</span>
            {product.compareAtMinor && !variant ? (
              <span className="text-sm text-slate-400 line-through">{priceText(product.compareAtMinor)}</span>
            ) : null}
            {product.freeShipping ? <span className="rounded-full bg-sky-100 px-2 py-0.5 text-[11px] font-bold text-sky-700">{t.brand.freeDeliveryBadge}</span> : null}
            {badge ? <span className={`rounded-full px-2 py-0.5 text-[11px] font-bold ${badge.cls}`}>{badge.label}</span> : null}
            {isElectronics || Number(unitMinor) >= 500000 ? (
              <button
                type="button"
                onClick={() => setEmiModalOpen(true)}
                className="inline-flex items-center gap-1.5 rounded-full border border-indigo-200 bg-indigo-50 px-3 py-1 text-xs font-bold text-indigo-700 hover:bg-indigo-100 transition shadow-xs"
              >
                <span>💳 ০% ইএমআই কিস্তি ক্যালকুলেটর</span>
              </button>
            ) : null}
            {isElectronics ? (
              <>
                <button
                  type="button"
                  onClick={() => setCompareModalOpen(true)}
                  className="inline-flex items-center gap-1.5 rounded-full border border-slate-200 bg-white px-3 py-1 text-xs font-bold text-slate-700 hover:bg-slate-50 transition shadow-xs"
                >
                  <span>⚖️ গ্যাজেট তুলনা</span>
                </button>
                <button
                  type="button"
                  onClick={() => setWarrantyLookupOpen(true)}
                  className="inline-flex items-center gap-1.5 rounded-full border border-emerald-200 bg-emerald-50 px-3 py-1 text-xs font-bold text-emerald-800 hover:bg-emerald-100 transition shadow-xs"
                >
                  <span>🔍 ওয়ারেন্টি চেক</span>
                </button>
              </>
            ) : null}
            {isGrocery ? (
              <button
                type="button"
                onClick={() => setPurityCertOpen(true)}
                className="inline-flex items-center gap-1.5 rounded-full border border-emerald-300 bg-emerald-50 px-3 py-1 text-xs font-bold text-emerald-800 hover:bg-emerald-100 transition shadow-xs"
              >
                <span>🌿 ১০০% অর্গানিক ল্যাব টেস্ট সনদ</span>
              </button>
            ) : null}
            {isBeauty ? (
              <>
                <button
                  type="button"
                  onClick={() => setAuthModalOpen(true)}
                  className="inline-flex items-center gap-1.5 rounded-full border border-rose-300 bg-pink-50 px-3 py-1 text-xs font-bold text-rose-900 hover:bg-pink-100 transition shadow-xs"
                >
                  <span>🔒 ১০০% অরিজিনাল অথেন্টিসিটি সনদ</span>
                </button>
                <button
                  type="button"
                  onClick={() => setSkinQuizOpen(true)}
                  className="inline-flex items-center gap-1.5 rounded-full border border-pink-200 bg-white px-3 py-1 text-xs font-bold text-rose-800 hover:bg-pink-50 transition shadow-xs"
                >
                  <span>🪄 স্কিন কনসার্ন ম্যাচিং</span>
                </button>
              </>
            ) : null}
            {isFurniture ? (
              <>
                <button
                  type="button"
                  onClick={() => setFurnitureWarrantyOpen(true)}
                  className="inline-flex items-center gap-1.5 rounded-full border border-amber-300 bg-amber-50 px-3 py-1 text-xs font-bold text-amber-900 hover:bg-amber-100 transition shadow-xs"
                >
                  <span>🛡️ ১০ বছর কাঠামোগত ওয়ারেন্টি</span>
                </button>
                <button
                  type="button"
                  onClick={() => setVisualizerOpen(true)}
                  className="inline-flex items-center gap-1.5 rounded-full border border-amber-200 bg-white px-3 py-1 text-xs font-bold text-amber-800 hover:bg-amber-50 transition shadow-xs"
                >
                  <span>📐 ৩ডি রুম ভিজ্যুয়ালাইজার</span>
                </button>
              </>
            ) : null}
            {isBooks ? (
              <button
                type="button"
                onClick={() => setLookInsideModalOpen(true)}
                className="inline-flex items-center gap-1.5 rounded-full border border-amber-400 bg-amber-100/80 px-3.5 py-1 text-xs font-extrabold text-amber-950 hover:bg-amber-200 transition shadow-xs"
              >
                <span>📖 একটু পড়ে দেখুন (ফ্রি প্রিভিউ)</span>
              </button>
            ) : null}
            {isKids ? (
              <button
                type="button"
                onClick={() => setKidsSafetyModalOpen(true)}
                className="inline-flex items-center gap-1.5 rounded-full border border-sky-300 bg-sky-50 px-3.5 py-1 text-xs font-bold text-sky-900 hover:bg-sky-100 transition shadow-xs"
              >
                <span>🍼 ১০০% নন-টক্সিক ও সুরক্ষা সনদ</span>
              </button>
            ) : null}
            {isAutomotive ? (
              <button
                type="button"
                onClick={() => setFitmentModalOpen(true)}
                className="inline-flex items-center gap-1.5 rounded-full border border-red-500/40 bg-zinc-900 px-3.5 py-1 text-xs font-bold text-red-400 hover:bg-zinc-800 transition shadow-xs font-mono"
              >
                <span>🏍️ বাইক মডেল ফিটমেন্ট চেকার</span>
              </button>
            ) : null}
            {isSports ? (
              <button
                type="button"
                onClick={() => setAssemblyModalOpen(true)}
                className="inline-flex items-center gap-1.5 rounded-full border border-sky-400 bg-sky-50 px-3.5 py-1 text-xs font-bold text-sky-900 hover:bg-sky-100 transition shadow-xs"
              >
                <span>🛠️ ফ্রি হোম অ্যাসেম্বলি ও টেকনিশিয়ান</span>
              </button>
            ) : null}
            {isJewelry ? (
              <>
                <button
                  type="button"
                  onClick={() => setCertModalOpen(true)}
                  className="inline-flex items-center gap-1.5 rounded-full border border-amber-400 bg-amber-50 px-3.5 py-1 text-xs font-bold text-amber-950 hover:bg-amber-100 transition shadow-xs"
                >
                  <span>⚜️ হলমার্ক ও ডায়মন্ড সনদ</span>
                </button>
                <button
                  type="button"
                  onClick={() => setRingSizeModalOpen(true)}
                  className="inline-flex items-center gap-1.5 rounded-full border border-stone-300 bg-stone-900 px-3.5 py-1 text-xs font-bold text-amber-300 hover:bg-stone-800 transition shadow-xs"
                >
                  <span>💍 রিং সাইজ গাইড</span>
                </button>
              </>
            ) : null}
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

        {/* Beauty Shade Swatch Selector */}
        {isBeauty && !product.isGiftCard ? (
          <BeautyShadeSelector
            selectedShade={selectedShade}
            onSelectShade={(s) => setSelectedShade(s)}
          />
        ) : null}

        {/* Grocery Weight / Pack Size Selector */}
        {isGrocery && !product.isGiftCard ? (
          <GroceryWeightSelector
            selectedWeight={selectedWeight}
            onSelectWeight={(w) => setSelectedWeight(w)}
          />
        ) : null}

        {/* Furniture Wood Finish Selector */}
        {isFurniture && !product.isGiftCard ? (
          <FurnitureFinishSelector
            selectedFinish={selectedFinish}
            onSelectFinish={(f) => setSelectedFinish(f)}
          />
        ) : null}

        {/* Books Binding & Edition Selector */}
        {isBooks && !product.isGiftCard ? (
          <BooksBindingSelector
            selectedBinding={selectedBinding}
            onSelectBinding={(b) => setSelectedBinding(b)}
          />
        ) : null}

        {/* Kids Age Group Selector */}
        {isKids && !product.isGiftCard ? (
          <KidsAgeSelector
            selectedAge={selectedAgeGroup}
            onSelectAge={(a) => setSelectedAgeGroup(a)}
          />
        ) : null}

        {/* Automotive Engine Oil Grade & Viscosity Selector */}
        {isAutomotive && !product.isGiftCard ? (
          <AutomotiveViscositySelector
            selectedGrade={selectedViscosity}
            onSelectGrade={(g) => setSelectedViscosity(g)}
          />
        ) : null}

        {/* Sports Weight & Capacity Selector */}
        {isSports && !product.isGiftCard ? (
          <SportsWeightSelector
            selectedWeight={selectedGymWeight}
            onChangeWeight={(w) => setSelectedGymWeight(w)}
          />
        ) : null}

        {/* Jewelry Karat & Metal Selector */}
        {isJewelry && !product.isGiftCard ? (
          <div className="space-y-3">
            <JewelryKaratSelector
              selectedKarat={selectedKarat}
              onChangeKarat={(k) => setSelectedKarat(k)}
            />
            <div className="flex items-center justify-between rounded-2xl border border-amber-200 bg-amber-50/60 p-3 text-xs">
              <span className="font-bold text-stone-800">নির্বাচিত রিং/চুড়ি সাইজ:</span>
              <button
                type="button"
                onClick={() => setRingSizeModalOpen(true)}
                className="font-bold text-amber-800 underline hover:text-amber-950"
              >
                {selectedRingSize} (পরিবর্তন)
              </button>
            </div>
          </div>
        ) : null}

        {product.variants.length > 0 && !product.isGiftCard ? (
          <div className="space-y-2.5">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <label className="text-xs font-bold text-slate-800" htmlFor="variant">
                {isGrocery
                  ? "প্যাকেজিং ধরন বেছে নিন:"
                  : isBeauty
                    ? "সাইজ বা ভলিউম (মিলি) বেছে নিন:"
                    : "সাইজ / ভ্যারিয়েন্ট বেছে নিন:"}
              </label>
              {isFashion ? (
                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={() => setFitModalOpen(true)}
                    className="flex items-center gap-1 rounded-full border border-amber-300 bg-amber-50 px-2.5 py-1 text-[11px] font-bold text-amber-900 hover:bg-amber-100 transition shadow-xs"
                  >
                    ✨ সাইজ ফাইন্ডার (Find My Fit)
                  </button>
                  <button
                    type="button"
                    onClick={() => setSizeGuideOpen(true)}
                    className="flex items-center gap-1 text-[11px] font-bold text-indigo-600 hover:text-indigo-800 underline"
                  >
                    📏 সাইজ চার্ট
                  </button>
                </div>
              ) : null}
            </div>
            {/* Interactive Fashion Size Pills */}
            <div className="flex flex-wrap gap-2">
              {product.variants.map((v) => {
                const isSelected = variantId === v.id;
                const isOut = v.stockState === "out_of_stock";
                return (
                  <button
                    key={v.id}
                    type="button"
                    onClick={() => {
                      if (isOut) {
                        setRestockSize(v.name);
                        setRestockOpen(true);
                      } else {
                        setVariantId(isSelected ? "" : v.id);
                      }
                    }}
                    title={isOut ? "স্টক শেষ — রিস্টক অ্যালার্ট পেতে ক্লিক করুন" : v.name}
                    className={`rounded-xl border px-3.5 py-2 text-xs font-bold transition ${
                      isSelected
                        ? "border-neutral-900 bg-neutral-900 text-white shadow-sm"
                        : isOut
                        ? "border-dashed border-rose-300 bg-rose-50/50 text-rose-400 line-through hover:border-rose-400 hover:text-rose-600"
                        : "border-slate-200 bg-white text-slate-800 hover:border-neutral-900"
                    }`}
                  >
                    {v.name}
                    {v.priceMinor && v.priceMinor !== product.priceMinor ? ` (${priceText(v.priceMinor)})` : ""}
                    {isOut ? <span className="ml-1 text-[9px] no-underline font-normal">🔔</span> : null}
                  </button>
                );
              })}
            </div>
            {variant ? (
              <p className="mt-1 text-[11px] text-slate-500">
                {t.product.selected} <b>{variant.name}</b> — {priceText(variant.priceMinor ?? product.priceMinor)}
              </p>
            ) : null}
          </div>
        ) : !product.isGiftCard ? (
          <div className="flex flex-wrap items-center justify-between gap-2 rounded-2xl bg-stone-50 p-3 text-xs">
            <span className="text-stone-600">সাইজ নির্ধারণে সহায়তা প্রয়োজন?</span>
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={() => setFitModalOpen(true)}
                className="font-bold text-amber-800 bg-amber-100/70 px-2 py-0.5 rounded-md hover:bg-amber-200"
              >
                ✨ সাইজ ফাইন্ডার
              </button>
              <button
                type="button"
                onClick={() => setSizeGuideOpen(true)}
                className="font-bold text-indigo-600 hover:text-indigo-800 underline"
              >
                📏 সাইজ চার্ট
              </button>
            </div>
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

        {added ? (
          <div className="space-y-2 rounded-xl bg-emerald-50 p-3 text-center">
            <p className="text-sm font-bold text-emerald-800">{t.product.added}</p>
            <div className="flex justify-center gap-2">
              <Link href={`/shop/${orgSlug}/cart`} className="rounded-lg bg-white px-4 py-2 text-xs font-bold text-slate-700 border">{t.product.viewCart}</Link>
              <Link href={`/shop/${orgSlug}/checkout`} className="rounded-lg bg-indigo-600 px-4 py-2 text-xs font-bold text-white">{t.product.checkoutNow}</Link>
            </div>
          </div>
        ) : (
          <button
            type="button"
            onClick={addToCart}
            disabled={busy || outOfStock}
            className="w-full rounded-2xl bg-indigo-600 py-3.5 text-sm font-extrabold text-white shadow-lg shadow-indigo-600/30 transition hover:bg-indigo-700 disabled:opacity-50"
          >
            {outOfStock ? t.product.outOfStockOrder : busy ? t.product.adding : t.product.addToCart}
          </button>
        )}
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

        {/* Bangladeshi Fashion Delivery & Return Assurance Box */}
        {isFashion ? (
          <div className="mt-4 space-y-2.5 rounded-2xl border border-stone-200 bg-stone-50/80 p-4 text-xs text-stone-700">
            <div className="flex items-center gap-2.5 font-bold text-stone-900">
              <span>🚚</span>
              <span>ঢাকার ভিতর ২৪-৪৮ ঘণ্টা এক্সপ্রেস হোম ডেলিভারি, ঢাকার বাইরে ২-৩ দিন</span>
            </div>
            <div className="flex items-center gap-2.5">
              <span>🔄</span>
              <span>৭ দিনের সহজ সাইজ বা কালার এক্সচেঞ্জ গ্যারান্টি</span>
            </div>
            <div className="flex items-center gap-2.5">
              <span>💵</span>
              <span>ক্যাশ অন ডেলিভারি (COD) ও বিকাশ পেমেন্ট সুবিধা</span>
            </div>
            <div className="flex items-center gap-2.5">
              <span>🧵</span>
              <span>১০০% প্রিমিয়াম কোয়ালিটি ও অরিজিনাল ফেব্রিক ফিনিশ</span>
            </div>
          </div>
        ) : null}

        {/* Grocery 1-Hour Slot Picker & Nutrition Facts */}
        {isGrocery && !product.isGiftCard ? (
          <div className="mt-4 space-y-3">
            <GroceryDeliverySlotPicker />
            <GroceryNutritionFacts />
          </div>
        ) : null}

        {/* Beauty Active Ingredients & Usage Guide */}
        {isBeauty && !product.isGiftCard ? (
          <div className="mt-4 space-y-3">
            <BeautyIngredientsGuide />
          </div>
        ) : null}

        {/* Furniture Dimensions & Free Assembly Assurance */}
        {isFurniture && !product.isGiftCard ? (
          <div className="mt-4 space-y-3">
            <div className="rounded-2xl border border-amber-200 bg-amber-50/70 p-4 text-xs text-amber-900 space-y-2">
              <div className="flex items-center gap-2 font-bold text-amber-950">
                <span>🛋️</span>
                <span>সম্পূর্ণ ফ্রি হোম ফিটিং এবং এক্সপার্ট অ্যাসেম্বলি সার্ভিস অন্তর্ভুক্ত</span>
              </div>
              <div className="flex items-center gap-2">
                <span>🚚</span>
                <span>সারাদেশে নিরাপদ ডোরস্টেপ ফার্নিচার ডেলিভারি ভ্যান</span>
              </div>
              <div className="flex items-center gap-2">
                <span>🪵</span>
                <span>১০০% সিজনড সলিড কাঠ ও ইকো-ফ্রেন্ডলি ল্যাকার পলিশ</span>
              </div>
            </div>
            <FurnitureDimensionSpecs />
          </div>
        ) : null}

        {/* Books Assurance, Author Info & Specifications */}
        {isBooks && !product.isGiftCard ? (
          <div className="mt-4 space-y-3">
            <div className="rounded-2xl border border-amber-900/10 bg-[#fbf9f4] p-4 text-xs text-amber-950 space-y-2">
              <div className="flex items-center gap-2 font-bold">
                <span>📖</span>
                <span>১০০% আসল প্রকাশনীর মূল সংস্করণ ও নির্ভুল বাঁধাই গ্যারান্টি</span>
              </div>
              <div className="flex items-center gap-2">
                <span>🚚</span>
                <span>সারা দেশে ক্যাশ অন ডেলিভারি ও দ্রুত হোম ডেলিভারি</span>
              </div>
              <div className="flex items-center gap-2">
                <span>🔖</span>
                <span>প্রতিটি বইয়ের সাথে আকর্ষণীয় এক্সক্লুসিভ বুকমার্ক ফ্রি</span>
              </div>
            </div>
            <BooksAuthorBox authorName={product.brand?.name ?? "হুমায়ূন আহমেদ"} />
            <BooksDetailSpecs />
          </div>
        ) : null}

        {/* Kids Safety Assurance & Pediatric Specifications */}
        {isKids && !product.isGiftCard ? (
          <div className="mt-4 space-y-3">
            <div className="rounded-3xl border border-sky-100 bg-[#f7fbff] p-4 text-xs text-slate-800 space-y-2">
              <div className="flex items-center gap-2 font-bold text-sky-900">
                <span>🍼</span>
                <span>১০০% BPA-Free ও ফুড-গ্রেড সিলিকন / অর্গানিক সুতি উপাদান</span>
              </div>
              <div className="flex items-center gap-2">
                <span>🧸</span>
                <span>চোকিং-হ্যাজার্ড টেস্টেড — কোনো ধারালো কোণা বা আলগা পার্টস নেই</span>
              </div>
              <div className="flex items-center gap-2">
                <span>🚚</span>
                <span>সারাদেশে হোম ডেলিভারি ও সাইজ না মিললে সহজ রিটার্ন</span>
              </div>
            </div>
            <KidsSafetySpecs />
          </div>
        ) : null}

        {/* Automotive Assurance & OEM Specs */}
        {isAutomotive && !product.isGiftCard ? (
          <div className="mt-4 space-y-3">
            <div className="rounded-2xl border border-zinc-800 bg-[#16181d] p-4 text-xs text-zinc-300 space-y-2">
              <div className="flex items-center gap-2 font-bold text-white">
                <span>⚙️</span>
                <span>১০০% জেনুইন পার্টস ও স্ক্র্যাচ কিউআর সিকিউরিটি কোড</span>
              </div>
              <div className="flex items-center gap-2">
                <span>🏍️</span>
                <span>মডেল অনুযায়ী সরাসরি ফিটমেন্ট গ্যারান্টি (১০০% নো-মডিফিকেশন)</span>
              </div>
              <div className="flex items-center gap-2">
                <span>🚚</span>
                <span>সারা দেশে ৪৮ ঘণ্টায় সুপারফাস্ট কুরিয়ার পার্সেল ডেলিভারি</span>
              </div>
            </div>
            <AutomotivePartSpecs />
          </div>
        ) : null}

        {/* Sports Assurance & Equipment Specs */}
        {isSports && !product.isGiftCard ? (
          <div className="mt-4 space-y-3">
            <div className="rounded-2xl border border-sky-200 bg-sky-50/70 p-4 text-xs text-sky-950 space-y-2">
              <div className="flex items-center gap-2 font-bold text-sky-900">
                <span>🏆</span>
                <span>১০০% অরিজিনাল অ্যাথলেটিক গিয়ার ও ডিরেক্ট ব্র্যান্ড ওয়ারেন্টি</span>
              </div>
              <div className="flex items-center gap-2">
                <span>🛠️</span>
                <span>ফ্রি হোম জিম সেটআপ ও সার্টিফাইড টেকনিশিয়ান ইন্সটলেশন সার্ভিস</span>
              </div>
              <div className="flex items-center gap-2">
                <span>🚚</span>
                <span>হেভি ফ্রেইট ইকুইপমেন্ট ডেলিভারি ও সেফটি ইন্সপেকশন ট্রায়াল</span>
              </div>
            </div>
            <SportsEquipmentSpecs />
          </div>
        ) : null}

        {/* Jewelry Hallmark & Authenticity Assurance */}
        {isJewelry && !product.isGiftCard ? (
          <div className="mt-4 space-y-3">
            <div className="rounded-2xl border border-amber-500/30 bg-stone-950 p-4 text-xs text-amber-100 space-y-2">
              <div className="flex items-center gap-2 font-bold text-amber-300">
                <span>⚜️</span>
                <span>১০০% বিএসটিআই হলমার্ক সার্টিফাইড ও ক্যাডমিয়াম মুক্ত খাঁটি সোনা</span>
              </div>
              <div className="flex items-center gap-2">
                <span>💎</span>
                <span>আইজিআই/জিআইএ সনদপ্রাপ্ত আসল ডায়মন্ড ও লেজার ইনস্ক্রিপশন কোড</span>
              </div>
              <div className="flex items-center gap-2">
                <span>🔄</span>
                <span>১০০% এক্সচেঞ্জ ভ্যালু ও আজীবন বাইব্যাক ক্যাশ গ্যারান্টি</span>
              </div>
              <div className="flex items-center gap-2">
                <span>🛡️</span>
                <span>সারাদেশে বিশেষায়িত আর্মার্ড কুরিয়ারে ফুল-ইন্সুরড ডেলিভারি</span>
              </div>
            </div>
          </div>
        ) : null}

        {/* Fashion Model Stats Card */}
        {isFashion && !product.isGiftCard ? (
          <FashionModelStats />
        ) : null}

        {/* Fashion Fabric & Wash Care Guide */}
        {isFashion && !product.isGiftCard ? (
          <FashionFabricCareGuide />
        ) : null}

        {/* Electronics Official Warranty Box */}
        {isElectronics && !product.isGiftCard ? (
          <ElectronicsWarrantyBox />
        ) : null}

        {/* Electronics Device Compatibility Checker */}
        {isElectronics && !product.isGiftCard ? (
          <ElectronicsCompatibilityChecker />
        ) : null}

        {/* Electronics Branch & Showroom Stock */}
        {isElectronics && !product.isGiftCard ? (
          <ElectronicsBranchStock productName={product.name} />
        ) : null}

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

      {/* Complete The Look Outfit Bundle Builder (Fashion) */}
      {isFashion && relatedProducts.length > 0 && !product.isGiftCard ? (
        <div className="lg:col-span-2 mt-6">
          <FashionCompleteTheLook
            orgSlug={orgSlug}
            mainProduct={product}
            relatedProducts={relatedProducts}
          />
        </div>
      ) : null}

      {/* Essentials Protection & Charger Combo Pack (Electronics) */}
      {isElectronics && !product.isGiftCard ? (
        <div className="lg:col-span-2 mt-6">
          <ElectronicsAccessoriesCombo
            orgSlug={orgSlug}
            mainProduct={product}
          />
        </div>
      ) : null}

      {/* Monthly Family Bazar Bundle (Grocery) */}
      {isGrocery && !product.isGiftCard ? (
        <div className="lg:col-span-2 mt-6">
          <GroceryMonthlyBazarBundle
            orgSlug={orgSlug}
            mainProduct={product}
          />
        </div>
      ) : null}

      {/* Complete 3-Step Skincare Routine Bundle (Beauty) */}
      {isBeauty && !product.isGiftCard ? (
        <div className="lg:col-span-2 mt-6">
          <BeautyRoutineBundle
            orgSlug={orgSlug}
            mainProduct={product}
          />
        </div>
      ) : null}

      {/* Complete Room Set Decor Bundle (Furniture) */}
      {isFurniture && !product.isGiftCard ? (
        <div className="lg:col-span-2 mt-6">
          <FurnitureRoomSetBundle
            orgSlug={orgSlug}
            mainProduct={product}
          />
        </div>
      ) : null}

      {/* Complete 3-Book Reading Bundle (Books) */}
      {isBooks && !product.isGiftCard ? (
        <div className="lg:col-span-2 mt-6">
          <BooksReadingBundle
            orgSlug={orgSlug}
            mainProduct={product}
          />
        </div>
      ) : null}

      {/* Complete Newborn / Toddler Gift Hamper Bundle (Kids) */}
      {isKids && !product.isGiftCard ? (
        <div className="lg:col-span-2 mt-6">
          <KidsGiftHamperBundle
            orgSlug={orgSlug}
            mainProduct={product}
          />
        </div>
      ) : null}

      {/* Complete Periodic Bike Service & Tune-Up Bundle (Automotive) */}
      {isAutomotive && !product.isGiftCard ? (
        <div className="lg:col-span-2 mt-6">
          <AutomotiveTuneupBundle
            orgSlug={orgSlug}
            mainProduct={product}
          />
        </div>
      ) : null}

      {/* Complete Workout & Strength Combo Bundle (Sports) */}
      {isSports && !product.isGiftCard ? (
        <div className="lg:col-span-2 mt-6">
          <SportsWorkoutBundle
            orgSlug={orgSlug}
            mainProduct={product}
          />
        </div>
      ) : null}

      {/* Complete Royal Bridal Jewelry Suite (Jewelry) */}
      {isJewelry && !product.isGiftCard ? (
        <div className="lg:col-span-2 mt-6">
          <JewelryBridalBundle
            orgSlug={orgSlug}
            mainProduct={product}
          />
        </div>
      ) : null}

      {/* Sizing Modal */}
      <FashionSizeGuideModal open={sizeGuideOpen} onClose={() => setSizeGuideOpen(false)} />

      {/* Find My Fit AI Assistant Modal */}
      <FashionFitAssistantModal
        open={fitModalOpen}
        onClose={() => setFitModalOpen(false)}
        availableSizes={product.variants.map((v) => v.name)}
        onApplySize={(recSize) => {
          const matched = product.variants.find((v) => {
            const vName = v.name.toUpperCase();
            const rName = recSize.toUpperCase();
            return vName.includes(rName) || rName.includes(vName);
          });
          if (matched) setVariantId(matched.id);
        }}
      />

      {/* Restock Notification Alert Modal */}
      <FashionRestockAlertModal
        open={restockOpen}
        onClose={() => setRestockOpen(false)}
        productName={product.name}
        sizeName={restockSize}
      />

      {/* Electronics EMI Calculator Modal */}
      <ElectronicsEmiCalculatorModal
        open={emiModalOpen}
        onClose={() => setEmiModalOpen(false)}
        productPriceMinor={unitMinor}
        productName={product.name}
      />

      {/* Electronics Gadget Compare Modal */}
      <ElectronicsCompareModal
        open={compareModalOpen}
        onClose={() => setCompareModalOpen(false)}
        productA={product}
        productB={relatedProducts[0] ?? null}
        orgSlug={orgSlug}
      />

      {/* Electronics Online Warranty Lookup Modal */}
      <ElectronicsWarrantyLookupModal
        open={warrantyLookupOpen}
        onClose={() => setWarrantyLookupOpen(false)}
      />

      {/* Grocery Purity Lab Test Certificate Modal */}
      <GroceryPurityCertModal
        open={purityCertOpen}
        onClose={() => setPurityCertOpen(false)}
        productName={product.name}
      />

      {/* Beauty Authenticity & Skin Quiz Modals */}
      <BeautyAuthenticityModal
        open={authModalOpen}
        onClose={() => setAuthModalOpen(false)}
        productName={product.name}
      />
      <BeautySkinQuizModal
        open={skinQuizOpen}
        onClose={() => setSkinQuizOpen(false)}
      />

      {/* Furniture Warranty & Room Visualizer Modals */}
      <FurnitureWarrantyModal
        open={furnitureWarrantyOpen}
        onClose={() => setFurnitureWarrantyOpen(false)}
        productName={product.name}
      />
      <FurnitureRoomVisualizerModal
        open={visualizerOpen}
        onClose={() => setVisualizerOpen(false)}
        productName={product.name}
      />

      {/* Books Look Inside Reader Modal */}
      <BooksLookInsideModal
        open={lookInsideModalOpen}
        onClose={() => setLookInsideModalOpen(false)}
        productName={product.name}
      />

      {/* Kids Safety & Pediatric Certificate Modal */}
      <KidsSafetyModal
        open={kidsSafetyModalOpen}
        onClose={() => setKidsSafetyModalOpen(false)}
        productName={product.name}
      />

      {/* Automotive Fitment Checker Modal */}
      <AutomotiveFitmentModal
        open={fitmentModalOpen}
        onClose={() => setFitmentModalOpen(false)}
        productName={product.name}
      />

      {/* Sports Home Gym Assembly Modal */}
      <SportsAssemblyModal
        open={assemblyModalOpen}
        onClose={() => setAssemblyModalOpen(false)}
        productName={product.name}
      />

      {/* Jewelry Certificate & Ring Size Modals */}
      <JewelryCertificateModal
        open={certModalOpen}
        onClose={() => setCertModalOpen(false)}
        productName={product.name}
      />
      <JewelryRingSizeModal
        open={ringSizeModalOpen}
        onClose={() => setRingSizeModalOpen(false)}
        productName={product.name}
        onSelectSize={(s) => setSelectedRingSize(s)}
      />
    </div>
  );
}
