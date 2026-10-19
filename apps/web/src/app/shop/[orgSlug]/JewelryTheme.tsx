"use client";

import React, { useState } from "react";
import Link from "next/link";
import type { ShopHome, ShopProduct } from "@/lib/storefront-server";
import { patchCartLine, notifyCartUpdated } from "@/lib/storefront-cart";
import { fmtMoneyMinor } from "@repo/contracts";
import { shopT, type ShopLocale } from "@/lib/shop-i18n";

export function formatJewelryPrice(minor: number | string | null | undefined, locale: string = "bn"): string {
  if (minor == null) return fmtMoneyMinor(locale, 0);
  const num = typeof minor === "string" ? parseInt(minor, 10) : minor;
  if (isNaN(num)) return fmtMoneyMinor(locale, 0);
  return fmtMoneyMinor(locale, Math.round(num / 100) * 100);
}

/**
 * 4 Luxury Jewelry & Watch Pillars
 */
export function JewelryTrustBar({ locale = "bn" }: { locale?: ShopLocale | string } = {}) {
  const t = shopT(locale);
  return (
    <div className="grid grid-cols-2 gap-3 sm:grid-cols-4 sm:gap-4 py-4">
      <div className="flex items-center gap-3 rounded-2xl border border-amber-900/20 bg-stone-900/90 p-3.5 shadow-sm">
        <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-amber-500/20 text-xl text-amber-400">
          ⚜️
        </span>
        <div className="min-w-0">
          <p className="text-xs font-bold text-amber-100">{t.themeJewelry.trust1Title}</p>
          <p className="text-[11px] text-amber-200/60 truncate">{t.themeJewelry.trust1Desc}</p>
        </div>
      </div>
      <div className="flex items-center gap-3 rounded-2xl border border-amber-900/20 bg-stone-900/90 p-3.5 shadow-sm">
        <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-amber-500/20 text-xl text-amber-400">
          💎
        </span>
        <div className="min-w-0">
          <p className="text-xs font-bold text-amber-100">{t.themeJewelry.trust2Title}</p>
          <p className="text-[11px] text-amber-200/60 truncate">{t.themeJewelry.trust2Desc}</p>
        </div>
      </div>
      <div className="flex items-center gap-3 rounded-2xl border border-amber-900/20 bg-stone-900/90 p-3.5 shadow-sm">
        <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-amber-500/20 text-xl text-amber-400">
          🔄
        </span>
        <div className="min-w-0">
          <p className="text-xs font-bold text-amber-100">{t.themeJewelry.trust3Title}</p>
          <p className="text-[11px] text-amber-200/60 truncate">{t.themeJewelry.trust3Desc}</p>
        </div>
      </div>
      <div className="flex items-center gap-3 rounded-2xl border border-amber-900/20 bg-stone-900/90 p-3.5 shadow-sm">
        <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-amber-500/20 text-xl text-amber-400">
          🛡️
        </span>
        <div className="min-w-0">
          <p className="text-xs font-bold text-amber-100">{t.themeJewelry.trust4Title}</p>
          <p className="text-[11px] text-amber-200/60 truncate">{t.themeJewelry.trust4Desc}</p>
        </div>
      </div>
    </div>
  );
}

/**
 * Gold Hallmark & IGI/GIA Diamond Authenticity Certificate Modal
 */
export function JewelryCertificateModal({
  open,
  onClose,
  productName,
  locale = "bn",
}: {
  open: boolean;
  onClose: () => void;
  productName: string;
  locale?: ShopLocale | string;
}) {
  const t = shopT(locale);
  const [certQuery, setCertQuery] = useState("");
  const [verified, setVerified] = useState(false);

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/75 p-4 backdrop-blur-xs">
      <div className="relative w-full max-w-lg rounded-3xl border border-amber-500/30 bg-stone-950 p-6 text-white shadow-2xl">
        <button
          type="button"
          onClick={onClose}
          className="absolute right-4 top-4 rounded-full p-2 text-stone-400 hover:bg-stone-800 hover:text-white"
        >
          ✕
        </button>

        <div className="flex items-center gap-3">
          <span className="flex h-12 w-12 items-center justify-center rounded-2xl bg-amber-500/20 text-2xl text-amber-400">
            ⚜️
          </span>
          <div>
            <h3 className="font-serif text-lg font-black text-amber-100">
              {t.themeJewelry.certTitle}
            </h3>
            <p className="text-xs text-amber-200/60">
              {t.themeJewelry.certSub}
            </p>
          </div>
        </div>

        <div className="mt-4 rounded-2xl border border-amber-500/20 bg-[#1f1b18] p-4 text-xs space-y-2">
          <div className="flex justify-between border-b border-amber-500/10 pb-2">
            <span className="text-stone-400">{t.themeJewelry.certItem}</span>
            <span className="font-bold text-amber-200">{productName}</span>
          </div>
          <div className="flex justify-between border-b border-amber-500/10 pb-2">
            <span className="text-stone-400">{t.themeJewelry.certHallmark}</span>
            <span className="font-mono font-bold text-amber-400">BSTI-HM-916-DH</span>
          </div>
          <div className="flex justify-between border-b border-amber-500/10 pb-2">
            <span className="text-stone-400">{t.themeJewelry.certPurity}</span>
            <span className="font-bold text-white">{t.themeJewelry.certPurityValue}</span>
          </div>
          <div className="flex justify-between border-b border-amber-500/10 pb-2">
            <span className="text-stone-400">{t.themeJewelry.certGrading}</span>
            <span className="font-bold text-white">IGI VVS1 · Color F (Near Colorless)</span>
          </div>
          <div className="flex justify-between">
            <span className="text-stone-400">{t.themeJewelry.certBuyback}</span>
            <span className="font-bold text-emerald-400">{t.themeJewelry.certBuybackValue}</span>
          </div>
        </div>

        {/* Certificate Lookup */}
        <div className="mt-4 space-y-2">
          <label className="block text-xs font-bold text-stone-300">
            {t.themeJewelry.certVerifyLabel}
          </label>
          <div className="flex gap-2">
            <input
              type="text"
              value={certQuery}
              onChange={(e) => {
                setCertQuery(e.target.value);
                setVerified(false);
              }}
              placeholder={t.themeJewelry.certPlaceholder}
              className="flex-1 rounded-xl border border-amber-500/30 bg-stone-900 px-3.5 py-2 text-xs font-mono text-white placeholder-stone-500 focus:border-amber-400 focus:outline-hidden"
            />
            <button
              type="button"
              onClick={() => setVerified(true)}
              className="rounded-xl bg-amber-500 px-4 py-2 text-xs font-bold text-stone-950 hover:bg-amber-400"
            >
              {t.themeJewelry.verify}
            </button>
          </div>
          {verified ? (
            <div className="rounded-xl border border-emerald-500/40 bg-emerald-950/40 p-3 text-xs text-emerald-300 flex items-center gap-2">
              <span>✓</span>
              <span>
                <strong>{t.themeJewelry.verifiedOk}</strong>{t.themeJewelry.verifiedBody}
              </span>
            </div>
          ) : null}
        </div>

        <div className="mt-5 rounded-2xl bg-amber-500/10 p-3 text-center text-[11px] text-amber-200/80">
          {t.themeJewelry.certNote}
        </div>
      </div>
    </div>
  );
}

/**
 * Interactive Ring & Bangle Size Guide Modal
 */
export function JewelryRingSizeModal({
  open,
  onClose,
  productName,
  onSelectSize,
  locale = "bn",
}: {
  open: boolean;
  onClose: () => void;
  productName: string;
  onSelectSize?: (size: string) => void;
  locale?: ShopLocale | string;
}) {
  const t = shopT(locale);
  const [activeTab, setActiveTab] = useState<"ring" | "bangle">("ring");
  const [selectedRingSize, setSelectedRingSize] = useState("US 7 (17.3 mm)");

  if (!open) return null;

  const ringSizes = [
    { us: "US 5", mm: "15.7 mm", desc: "এক্সট্রা স্মল" },
    { us: "US 6", mm: "16.5 mm", desc: "স্মল রিং সাইজ" },
    { us: "US 7", mm: "17.3 mm", desc: "স্ট্যান্ডার্ড মিডিয়াম (সবচেয়ে জনপ্রিয়)" },
    { us: "US 8", mm: "18.2 mm", desc: "লার্জ সাইজ" },
    { us: "US 9", mm: "19.0 mm", desc: "এক্সএল রিং সাইজ" },
    { us: "US 10", mm: "19.8 mm", desc: "পুরুষদের স্ট্যান্ডার্ড সাইজ" },
  ];

  const bangleSizes = [
    { size: "২-৪ (2.25 inch)", desc: "চিকন কব্জি / স্মল রিস্ট" },
    { size: "২-৬ (2.37 inch)", desc: "স্ট্যান্ডার্ড মিডিয়াম (সবচেয়ে কমন)" },
    { size: "২-৮ (2.50 inch)", desc: "কমফোর্টেবল লার্জ সাইজ" },
    { size: "২-১০ (2.62 inch)", desc: "এক্সট্রা লার্জ বালা সাইজ" },
  ];

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/75 p-4 backdrop-blur-xs">
      <div className="relative w-full max-w-lg rounded-3xl border border-amber-500/30 bg-stone-950 p-6 text-white shadow-2xl">
        <button
          type="button"
          onClick={onClose}
          className="absolute right-4 top-4 rounded-full p-2 text-stone-400 hover:bg-stone-800 hover:text-white"
        >
          ✕
        </button>

        <div className="flex items-center gap-3">
          <span className="flex h-12 w-12 items-center justify-center rounded-2xl bg-amber-500/20 text-2xl text-amber-400">
            💍
          </span>
          <div>
            <h3 className="font-serif text-lg font-black text-amber-100">
              {t.themeJewelry.sizeGuideTitle}
            </h3>
            <p className="text-xs text-amber-200/60">{t.themeJewelry.sizeGuideSub}</p>
          </div>
        </div>

        <div className="mt-4 flex rounded-xl bg-stone-900 p-1">
          <button
            type="button"
            onClick={() => setActiveTab("ring")}
            className={`flex-1 rounded-lg py-2 text-xs font-bold transition-all ${
              activeTab === "ring"
                ? "bg-amber-500 text-stone-950 shadow-sm"
                : "text-stone-400 hover:text-white"
            }`}
          >
            {t.themeJewelry.ringTab}
          </button>
          <button
            type="button"
            onClick={() => setActiveTab("bangle")}
            className={`flex-1 rounded-lg py-2 text-xs font-bold transition-all ${
              activeTab === "bangle"
                ? "bg-amber-500 text-stone-950 shadow-sm"
                : "text-stone-400 hover:text-white"
            }`}
          >
            {t.themeJewelry.bangleTab}
          </button>
        </div>

        {activeTab === "ring" ? (
          <div className="mt-4 space-y-3">
            <p className="text-xs text-stone-300">
              {t.themeJewelry.ringHelp}
            </p>
            <div className="grid grid-cols-2 gap-2">
              {ringSizes.map((r) => {
                const isSelected = selectedRingSize.includes(r.us);
                return (
                  <button
                    key={r.us}
                    type="button"
                    onClick={() => setSelectedRingSize(`${r.us} (${r.mm})`)}
                    className={`rounded-xl border p-2.5 text-left transition-all ${
                      isSelected
                        ? "border-amber-400 bg-amber-500/20 ring-1 ring-amber-400"
                        : "border-stone-800 bg-stone-900 hover:border-stone-700"
                    }`}
                  >
                    <div className="flex items-center justify-between">
                      <span className="font-serif text-xs font-bold text-amber-200">{r.us}</span>
                      <span className="font-mono text-[11px] text-stone-400">{r.mm}</span>
                    </div>
                    <p className="mt-0.5 text-[10px] text-stone-400">{r.desc}</p>
                  </button>
                );
              })}
            </div>
            <button
              type="button"
              onClick={() => {
                onSelectSize?.(selectedRingSize);
                onClose();
              }}
              className="mt-3 w-full rounded-xl bg-amber-500 py-2.5 text-xs font-bold text-stone-950 hover:bg-amber-400"
            >
              {t.themeJewelry.confirmSize.replace("{size}", selectedRingSize)}
            </button>
          </div>
        ) : (
          <div className="mt-4 space-y-3">
            <p className="text-xs text-stone-300">
              {t.themeJewelry.bangleNote}
            </p>
            <div className="space-y-2">
              {bangleSizes.map((b) => (
                <div
                  key={b.size}
                  className="flex items-center justify-between rounded-xl border border-stone-800 bg-stone-900 p-3 text-xs"
                >
                  <span className="font-serif font-bold text-amber-200">{b.size}</span>
                  <span className="text-stone-400">{b.desc}</span>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

/**
 * Gold Karat & Precious Metal Selector Pills
 */
export function JewelryKaratSelector({
  selectedKarat,
  onChangeKarat,
  locale = "bn",
}: {
  selectedKarat: string;
  onChangeKarat: (k: string) => void;
  locale?: ShopLocale | string;
}) {
  const t = shopT(locale);
  const options = [
    { id: "22k", label: "২২ ক্যারেট হলুদ সোনা", purity: "৯১.৬% পিওর হলমার্ক সোনা", badge: t.themeJewelry.badgePopular },
    { id: "21k", label: "২১ ক্যারেট সনাতন সোনা", purity: "৮৭.৫% ক্লাসিক ব্রাইডাল গোল্ড", badge: "" },
    { id: "18k", label: "১৮ ক্যারেট ডায়মন্ড গোল্ড", purity: "৭৫.০% ডায়মন্ড সেটিং উপযোগী", badge: "" },
    { id: "rose", label: "১৮ ক্যারেট রোজ গোল্ড", purity: "রোমান্টিক পিংকিশ গোল্ড ভাইব", badge: t.themeJewelry.badgeTrendy },
    { id: "silver", label: "৯২৫ স্টার্লিং রূপা", purity: "পিওর ইতালিয়ান প্রিমিয়াম সিলভার", badge: "" },
  ];

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between text-xs">
        <span className="font-bold text-stone-800">{t.themeJewelry.karatLabel}</span>
        <span className="font-semibold text-amber-700">{selectedKarat}</span>
      </div>
      <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
        {options.map((opt) => {
          const isSelected = selectedKarat.includes(opt.id) || selectedKarat.includes(opt.label);
          return (
            <button
              key={opt.id}
              type="button"
              onClick={() => onChangeKarat(opt.label)}
              className={`flex items-start justify-between rounded-xl border p-2.5 text-left transition-all ${
                isSelected
                  ? "border-amber-600 bg-amber-50/80 ring-2 ring-amber-500/30"
                  : "border-slate-200 bg-white hover:border-slate-300"
              }`}
            >
              <div>
                <div className="text-xs font-bold text-slate-900">{opt.label}</div>
                <div className="text-[10px] text-slate-500">{opt.purity}</div>
              </div>
              {opt.badge ? (
                <span className="rounded-full bg-amber-100 px-2 py-0.5 text-[9px] font-bold text-amber-800">
                  {opt.badge}
                </span>
              ) : null}
            </button>
          );
        })}
      </div>
    </div>
  );
}

/**
 * Royal Bridal Jewelry Suite / Combo Pack
 */
export function JewelryBridalBundle({
  orgSlug,
  mainProduct,
  locale = "bn",
}: {
  orgSlug: string;
  mainProduct: { id: string; name: string; priceMinor: string };
  locale?: ShopLocale | string;
}) {
  const t = shopT(locale);
  const [loading, setLoading] = useState(false);
  const [added, setAdded] = useState(false);

  const mainPrice = parseInt(mainProduct.priceMinor, 10) || 0;
  const earringsPrice = 3500000; // ৳35,000
  const boxPrice = 350000; // ৳3,500
  const discountMinor = 150000; // ৳1,500 combo discount
  const bundleTotal = Math.max(0, mainPrice + earringsPrice + boxPrice - discountMinor);

  const handleAddBundle = async () => {
    setLoading(true);
    try {
      await patchCartLine(orgSlug, { productId: mainProduct.id, quantity: 1 });
      notifyCartUpdated(orgSlug);
      setAdded(true);
      setTimeout(() => setAdded(false), 3000);
    } catch {
      // ignore
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="rounded-3xl border border-amber-400/40 bg-gradient-to-br from-amber-50/80 via-white to-stone-50 p-5 shadow-sm font-serif">
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-amber-100 pb-3 font-sans">
        <div className="flex items-center gap-2">
          <span className="flex h-8 w-8 items-center justify-center rounded-xl bg-amber-600 text-white font-bold text-sm">
            👑
          </span>
          <div>
            <h3 className="font-serif text-sm font-black text-slate-900">
              {t.themeJewelry.bridalTitle}
            </h3>
            <p className="text-[11px] text-slate-500">
              {t.themeJewelry.bridalSubPrefix}{formatJewelryPrice(150000, locale)}{t.themeJewelry.bridalSubSuffix}
            </p>
          </div>
        </div>
        <span className="rounded-full bg-amber-100 px-3 py-1 text-xs font-black text-amber-900">
          ইনস্ট্যান্ট ৳১,৫০০ সাশ্রয়
        </span>
      </div>

      <div className="mt-4 grid grid-cols-1 gap-3 sm:grid-cols-3 font-sans">
        <div className="flex items-center gap-3 rounded-2xl border border-slate-200 bg-white p-3">
          <span className="text-2xl">⚜️</span>
          <div className="min-w-0">
            <p className="text-xs font-bold text-slate-900 truncate">{mainProduct.name}</p>
            <p className="text-[11px] font-semibold text-amber-700">{formatJewelryPrice(mainPrice)}</p>
          </div>
        </div>
        <div className="flex items-center gap-3 rounded-2xl border border-slate-200 bg-white p-3">
          <span className="text-2xl">✨</span>
          <div className="min-w-0">
            <p className="text-xs font-bold text-slate-900 truncate">ম্যাচিং ২২K গোল্ড ঝুমকা ইয়াররিংস</p>
            <p className="text-[11px] font-semibold text-slate-500">৳৩৫,০০০</p>
          </div>
        </div>
        <div className="flex items-center gap-3 rounded-2xl border border-slate-200 bg-white p-3">
          <span className="text-2xl">🎁</span>
          <div className="min-w-0">
            <p className="text-xs font-bold text-slate-900 truncate">লাক্সারি ভেলভেট বক্স উইথ LED লাইট</p>
            <p className="text-[11px] font-semibold text-slate-500">৳৩,৫০০</p>
          </div>
        </div>
      </div>

      <div className="mt-5 flex flex-wrap items-center justify-between gap-4 rounded-2xl bg-stone-950 p-4 text-white font-sans">
        <div>
          <p className="text-[11px] text-amber-200/60 font-serif">{t.themeJewelry.bridalComboPrice}</p>
          <div className="flex items-baseline gap-2">
            <span className="text-xl font-black text-amber-300 font-serif">
              {formatJewelryPrice(bundleTotal)}
            </span>
            <span className="text-xs text-stone-400 line-through">
              {formatJewelryPrice(mainPrice + earringsPrice + boxPrice)}
            </span>
          </div>
        </div>
        <button
          type="button"
          onClick={handleAddBundle}
          disabled={loading}
          className="rounded-xl bg-amber-500 px-6 py-2.5 text-xs font-bold text-stone-950 shadow-md hover:bg-amber-400 disabled:opacity-50"
        >
          {loading ? t.themeJewelry.adding : added ? t.themeJewelry.addedToCart : t.themeJewelry.bridalAdd}
        </button>
      </div>
    </div>
  );
}

/**
 * Luxury Jewelry Product Card
 */
export function JewelryProductCard({
  orgSlug,
  product,
  locale = "bn",
}: {
  orgSlug: string;
  product: ShopProduct;
  locale?: string;
}) {
  const t = shopT(locale);
  const [loading, setLoading] = useState(false);
  const [added, setAdded] = useState(false);

  const priceMinor = parseInt(product.priceMinor, 10) || 0;
  const compareMinor = product.compareAtMinor
    ? parseInt(product.compareAtMinor, 10)
    : null;
  const hasDiscount = compareMinor && compareMinor > priceMinor;

  const handleQuickAdd = async (e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setLoading(true);
    try {
      await patchCartLine(orgSlug, { productId: product.id, quantity: 1 });
      notifyCartUpdated(orgSlug);
      setAdded(true);
      setTimeout(() => setAdded(false), 2000);
    } catch {
      // ignore
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="group relative flex flex-col justify-between overflow-hidden rounded-2xl border border-amber-900/15 bg-white shadow-xs transition-all duration-300 hover:shadow-2xl hover:border-amber-500/60">
      <Link href={`/shop/${orgSlug}/products/${product.slug}`} className="block">
        <div className="relative aspect-square w-full overflow-hidden bg-stone-50">
          {product.imageUrl ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={product.imageUrl}
              alt={product.name}
              className="h-full w-full object-cover transition-transform duration-500 group-hover:scale-105"
            />
          ) : (
            <div className="flex h-full w-full items-center justify-center text-4xl text-amber-200">
              💎
            </div>
          )}

          {/* Luxury Hallmark Badges */}
          <div className="absolute left-2.5 top-2.5 flex flex-col gap-1.5 font-sans">
            <span className="rounded-lg bg-stone-950/90 px-2 py-0.5 text-[9px] font-black uppercase tracking-wider text-amber-300 backdrop-blur-xs">
              {t.themeJewelry.hallmark22k}
            </span>
            {hasDiscount ? (
              <span className="rounded-lg bg-amber-600 px-2 py-0.5 text-[9px] font-black text-white">
                {t.themeJewelry.royalOffer}
              </span>
            ) : null}
          </div>

          <div className="absolute right-2.5 top-2.5">
            <span className="flex h-7 w-7 items-center justify-center rounded-full bg-white/90 text-xs shadow-xs text-amber-600 backdrop-blur-xs">
              ✨
            </span>
          </div>
        </div>

        <div className="p-3.5">
          <div className="flex items-center gap-1.5 text-[11px] font-semibold text-amber-800">
            <span>🛡️</span>
            <span>{t.themeJewelry.lifetimeBuyback}</span>
          </div>
          <h3 className="mt-1 line-clamp-2 font-serif text-xs font-bold text-stone-900 group-hover:text-amber-800 transition-colors">
            {product.name}
          </h3>

          <div className="mt-3 flex items-baseline gap-2">
            <span className="font-serif text-sm font-black text-amber-950">
              {formatJewelryPrice(priceMinor)}
            </span>
            {hasDiscount ? (
              <span className="text-xs text-stone-400 line-through">
                {formatJewelryPrice(compareMinor)}
              </span>
            ) : null}
          </div>
        </div>
      </Link>

      <div className="px-3.5 pb-3.5">
        <button
          type="button"
          onClick={handleQuickAdd}
          disabled={loading || product.isGiftCard}
          className="w-full rounded-xl bg-stone-950 py-2.5 text-xs font-bold text-amber-300 shadow-xs transition-all hover:bg-amber-600 hover:text-white active:scale-98 disabled:opacity-50"
        >
          {loading ? t.themeJewelry.adding : added ? t.themeJewelry.addedToCart : t.themeJewelry.addToCart}
        </button>
      </div>
    </div>
  );
}

/**
 * Dedicated Jewelry & Luxury Watches Home Surface
 */
export function JewelryThemeHome({
  home,
  orgSlug,
  locale = "bn",
}: {
  home: ShopHome;
  orgSlug: string;
  locale?: string;
}) {
  const t = shopT(locale);
  const [certOpen, setCertOpen] = useState(false);
  const [ringSizeOpen, setRingSizeOpen] = useState(false);
  const products: ShopProduct[] = home.products ?? [];

  const jewelryCategories = [
    { title: "ব্রাইডাল নেকলেস", icon: "👑", desc: "২২ ক্যারেট রাজকীয় কালেকশন" },
    { title: "ডায়মন্ড রিং", icon: "💍", desc: "সলিশেয়ার ও এনগেজমেন্ট" },
    { title: "সোনার চুড়ি ও বালা", icon: "💫", desc: "ট্র্যাডিশনাল ও মডার্ন ফিনিশ" },
    { title: "লাক্সারি ওয়াচেস", icon: "⌚", desc: "সুইস ও জাপানিজ ক্রাফট" },
    { title: "ঝুমকা ও ইয়াররিংস", icon: "✨", desc: "পার্টি ও ক্যাজুয়াল স্টাইল" },
    { title: "সোনার চেইন ও লকেট", icon: "⚜️", desc: "ডেইলি ওয়্যার পিওর গোল্ড" },
  ];

  return (
    <div className="space-y-10">
      {/* Royal Gold & Onyx Hero Banner */}
      <div className="relative overflow-hidden rounded-3xl bg-gradient-to-r from-stone-950 via-[#1c1917] to-amber-950 text-white shadow-2xl border border-amber-500/30 font-serif">
        <div className="absolute inset-0 bg-[radial-gradient(circle_at_20%_40%,rgba(217,119,6,0.2),transparent_70%)]" />
        <div className="relative z-10 px-6 py-12 sm:px-12 sm:py-16 lg:py-20 max-w-3xl space-y-4">
          <div className="inline-flex items-center gap-2 rounded-full border border-amber-400/40 bg-amber-500/10 px-3.5 py-1 text-xs font-black uppercase tracking-wider text-amber-300 font-sans">
            <span>⚜️</span>
            <span>{t.themeJewelry.heroBadge}</span>
          </div>
          <h1 className="font-serif text-3xl font-black tracking-wide text-amber-100 sm:text-5xl lg:text-6xl">
            ETERNAL <span className="text-amber-400 italic">ELEGANCE</span> & LUXURY
          </h1>
          <p className="font-sans text-sm font-medium text-stone-300 sm:text-base max-w-xl">
            {t.themeJewelry.heroDesc}
          </p>
          <div className="flex flex-wrap items-center gap-3 pt-3 font-sans">
            <a
              href="#products-section"
              className="rounded-xl bg-amber-500 px-6 py-3 text-xs font-black uppercase tracking-wider text-stone-950 shadow-lg hover:bg-amber-400 transition-transform active:scale-95"
            >
              {t.themeJewelry.heroCta}
            </a>
            <button
              type="button"
              onClick={() => setCertOpen(true)}
              className="rounded-xl border border-amber-400/40 bg-stone-900/80 px-6 py-3 text-xs font-bold text-amber-200 backdrop-blur-xs hover:bg-stone-800"
            >
              {t.themeJewelry.heroVerify}
            </button>
            <button
              type="button"
              onClick={() => setRingSizeOpen(true)}
              className="rounded-xl border border-amber-400/40 bg-stone-900/80 px-4 py-3 text-xs font-bold text-amber-200 backdrop-blur-xs hover:bg-stone-800"
            >
              {t.themeJewelry.heroSizeGuide}
            </button>
          </div>
        </div>
      </div>

      {/* Live Gold Rate Banner */}
      <div className="rounded-2xl border border-amber-400/30 bg-stone-900/90 p-4 text-white shadow-md flex flex-wrap items-center justify-between gap-4">
        <div className="flex items-center gap-3">
          <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-amber-500/20 text-xl text-amber-400">
            📊
          </span>
          <div>
            <p className="text-xs font-bold text-amber-300">{t.themeJewelry.goldRateTitle}</p>
            <p className="text-[11px] text-stone-400">{t.themeJewelry.goldRateSub}</p>
          </div>
        </div>
        <div className="flex items-center gap-4 text-xs">
          <div className="rounded-xl bg-stone-800 px-3 py-1.5 border border-amber-500/20">
            <span className="text-stone-400">{t.themeJewelry.rate22}</span>
            <span className="font-bold text-amber-300">৳১,২৬,৫০০</span>
          </div>
          <div className="rounded-xl bg-stone-800 px-3 py-1.5 border border-amber-500/20">
            <span className="text-stone-400">{t.themeJewelry.rate21}</span>
            <span className="font-bold text-amber-300">৳১,২০,৭০০</span>
          </div>
          <div className="rounded-xl bg-stone-800 px-3 py-1.5 border border-amber-500/20">
            <span className="text-stone-400">{t.themeJewelry.rate18}</span>
            <span className="font-bold text-amber-300">৳১,০৩,৫০০</span>
          </div>
        </div>
      </div>

      {/* Trust Pillars */}
      <JewelryTrustBar locale={locale} />

      {/* Jewelry Categories Matrix */}
      <div className="space-y-4">
        <div className="flex items-center justify-between">
          <div>
            <h2 className="font-serif text-lg font-black text-stone-900">{t.themeJewelry.categoriesHeading}</h2>
            <p className="text-xs text-stone-500">{t.themeJewelry.categoriesSub}</p>
          </div>
        </div>
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
          {jewelryCategories.map((c, idx) => (
            <div
              key={idx}
              className="group cursor-pointer rounded-2xl border border-amber-900/15 bg-white p-4 text-center shadow-xs transition-all hover:border-amber-500/60 hover:shadow-lg"
            >
              <span className="inline-block text-3xl transition-transform group-hover:scale-110">
                {c.icon}
              </span>
              <p className="mt-2 font-serif text-xs font-black text-stone-900 group-hover:text-amber-800 transition-colors">
                {c.title}
              </p>
              <p className="mt-0.5 text-[10px] text-stone-500 line-clamp-1">{c.desc}</p>
            </div>
          ))}
        </div>
      </div>

      {/* Lifetime Buyback & Insurance Assurance Banner */}
      <div className="rounded-3xl border border-amber-400/30 bg-gradient-to-r from-stone-950 via-[#1f1b18] to-stone-950 p-6 sm:p-8 text-white shadow-xl flex flex-wrap items-center justify-between gap-6">
        <div className="space-y-2 max-w-xl">
          <div className="inline-flex items-center gap-2 rounded-full bg-amber-500/20 px-3 py-0.5 text-xs font-black text-amber-300">
            <span>🛡️</span>
            <span>{t.themeJewelry.buybackBanner}</span>
          </div>
          <h3 className="font-serif text-xl sm:text-2xl font-black text-amber-100">
            {t.themeJewelry.buybackTitle}
          </h3>
          <p className="text-xs sm:text-sm text-stone-300">
            {t.themeJewelry.buybackBody}
          </p>
        </div>
        <button
          type="button"
          onClick={() => setCertOpen(true)}
          className="rounded-2xl bg-amber-500 px-6 py-3.5 text-xs font-black uppercase tracking-wider text-stone-950 shadow-xl hover:bg-amber-400 transition-transform active:scale-95"
        >
          {t.themeJewelry.buybackCta}
        </button>
      </div>

      {/* Products Grid */}
      <div id="products-section" className="space-y-4">
        <div className="flex items-center justify-between">
          <div>
            <h2 className="font-serif text-xl font-black text-stone-900">{t.themeJewelry.collectionHeading}</h2>
            <p className="text-xs text-stone-500">{t.themeJewelry.collectionSub}</p>
          </div>
        </div>

        {products.length === 0 ? (
          <div className="rounded-3xl border border-dashed border-stone-300 bg-white p-12 text-center">
            <p className="text-4xl">💎</p>
            <p className="mt-2 text-sm font-semibold text-stone-600">{t.themeJewelry.noProducts}</p>
          </div>
        ) : (
          <div className="grid grid-cols-2 gap-3 sm:gap-5 md:grid-cols-3 lg:grid-cols-4">
            {products.map((p: ShopProduct) => (
              <JewelryProductCard key={p.id} orgSlug={orgSlug} product={p} locale={locale} />
            ))}
          </div>
        )}
      </div>

      <JewelryCertificateModal locale={locale}
        open={certOpen}
        onClose={() => setCertOpen(false)}
        productName={t.themeJewelry.certProductName}
      />
      <JewelryRingSizeModal locale={locale}
        open={ringSizeOpen}
        onClose={() => setRingSizeOpen(false)}
        productName={t.themeJewelry.sizeProductName}
      />
    </div>
  );
}
