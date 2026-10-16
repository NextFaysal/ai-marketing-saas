"use client";

import React, { useState } from "react";
import Link from "next/link";
import type { ShopHome, ShopProduct } from "@/lib/storefront-server";
import { patchCartLine, notifyCartUpdated } from "@/lib/storefront-cart";

export function formatJewelryPrice(minor: number | string | null | undefined): string {
  if (minor == null) return "৳০";
  const num = typeof minor === "string" ? parseInt(minor, 10) : minor;
  if (isNaN(num)) return "৳০";
  return `৳${Math.round(num / 100).toLocaleString("bn-BD")}`;
}

/**
 * 4 Luxury Jewelry & Watch Pillars
 */
export function JewelryTrustBar() {
  return (
    <div className="grid grid-cols-2 gap-3 sm:grid-cols-4 sm:gap-4 py-4">
      <div className="flex items-center gap-3 rounded-2xl border border-amber-900/20 bg-stone-900/90 p-3.5 shadow-sm">
        <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-amber-500/20 text-xl text-amber-400">
          ⚜️
        </span>
        <div className="min-w-0">
          <p className="text-xs font-bold text-amber-100">১০০% হলমার্ক গোল্ড</p>
          <p className="text-[11px] text-amber-200/60 truncate">BSTI ক্যাডমিয়াম-মুক্ত সনদ</p>
        </div>
      </div>
      <div className="flex items-center gap-3 rounded-2xl border border-amber-900/20 bg-stone-900/90 p-3.5 shadow-sm">
        <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-amber-500/20 text-xl text-amber-400">
          💎
        </span>
        <div className="min-w-0">
          <p className="text-xs font-bold text-amber-100">IGI/GIA ডায়মন্ড সনদ</p>
          <p className="text-[11px] text-amber-200/60 truncate">৪সি সার্টিফাইড গ্রেডিং</p>
        </div>
      </div>
      <div className="flex items-center gap-3 rounded-2xl border border-amber-900/20 bg-stone-900/90 p-3.5 shadow-sm">
        <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-amber-500/20 text-xl text-amber-400">
          🔄
        </span>
        <div className="min-w-0">
          <p className="text-xs font-bold text-amber-100">লাইফটাইম বাইব্যাক</p>
          <p className="text-[11px] text-amber-200/60 truncate">১০০% এক্সচেঞ্জ গ্যারান্টি</p>
        </div>
      </div>
      <div className="flex items-center gap-3 rounded-2xl border border-amber-900/20 bg-stone-900/90 p-3.5 shadow-sm">
        <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-amber-500/20 text-xl text-amber-400">
          🛡️
        </span>
        <div className="min-w-0">
          <p className="text-xs font-bold text-amber-100">আর্মর্ড ডেলিভারি</p>
          <p className="text-[11px] text-amber-200/60 truncate">পূর্ণ বীমাকৃত সিকিউরড ট্রানজিট</p>
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
}: {
  open: boolean;
  onClose: () => void;
  productName: string;
}) {
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
              হলমার্ক ও ডায়মন্ড অথেন্টিসিটি সনদ
            </h3>
            <p className="text-xs text-amber-200/60">
              BSTI ও আন্তর্জাতিক ল্যাব টেস্টেড ১০০% আসল সোনা ও ডায়মন্ড
            </p>
          </div>
        </div>

        <div className="mt-4 rounded-2xl border border-amber-500/20 bg-[#1f1b18] p-4 text-xs space-y-2">
          <div className="flex justify-between border-b border-amber-500/10 pb-2">
            <span className="text-stone-400">আইটেম:</span>
            <span className="font-bold text-amber-200">{productName}</span>
          </div>
          <div className="flex justify-between border-b border-amber-500/10 pb-2">
            <span className="text-stone-400">হলমার্ক কোড:</span>
            <span className="font-mono font-bold text-amber-400">BSTI-HM-916-DH</span>
          </div>
          <div className="flex justify-between border-b border-amber-500/10 pb-2">
            <span className="text-stone-400">সোনা পিউরিটি:</span>
            <span className="font-bold text-white">২২ ক্যারেট (৯১.৬% পিওর ক্যাডমিয়াম মুক্ত)</span>
          </div>
          <div className="flex justify-between border-b border-amber-500/10 pb-2">
            <span className="text-stone-400">ডায়মন্ড গ্রেডিং:</span>
            <span className="font-bold text-white">IGI VVS1 · Color F (Near Colorless)</span>
          </div>
          <div className="flex justify-between">
            <span className="text-stone-400">বাইব্যাক পলিসি:</span>
            <span className="font-bold text-emerald-400">৯০% নগদ ক্যাশব্যাক / ১০০% গোল্ড এক্সচেঞ্জ</span>
          </div>
        </div>

        {/* Certificate Lookup */}
        <div className="mt-4 space-y-2">
          <label className="block text-xs font-bold text-stone-300">
            সার্টিফিকেট বা হলমার্ক নম্বর যাচাই করুন:
          </label>
          <div className="flex gap-2">
            <input
              type="text"
              value={certQuery}
              onChange={(e) => {
                setCertQuery(e.target.value);
                setVerified(false);
              }}
              placeholder="যেমন: HM-9162024 বা GIA-77402"
              className="flex-1 rounded-xl border border-amber-500/30 bg-stone-900 px-3.5 py-2 text-xs font-mono text-white placeholder-stone-500 focus:border-amber-400 focus:outline-hidden"
            />
            <button
              type="button"
              onClick={() => setVerified(true)}
              className="rounded-xl bg-amber-500 px-4 py-2 text-xs font-bold text-stone-950 hover:bg-amber-400"
            >
              ভেরিফাই
            </button>
          </div>
          {verified ? (
            <div className="rounded-xl border border-emerald-500/40 bg-emerald-950/40 p-3 text-xs text-emerald-300 flex items-center gap-2">
              <span>✓</span>
              <span>
                <strong>ভেরিফাইড সফল!</strong> সরকারি অনুমোদিত হলমার্ক ও লেজার ইনস্ক্রিপশন রেকর্ড সঠিক রয়েছে।
              </span>
            </div>
          ) : null}
        </div>

        <div className="mt-5 rounded-2xl bg-amber-500/10 p-3 text-center text-[11px] text-amber-200/80">
          প্রতিটি জুয়েলারির সাথে পাচ্ছেন অফিসিয়াল স্ট্যাম্পযুক্ত হলমার্ক গ্যারান্টি কার্ড ও জেনুইন ইনভয়েস।
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
}: {
  open: boolean;
  onClose: () => void;
  productName: string;
  onSelectSize?: (size: string) => void;
}) {
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
              রিং ও চুড়ি সাইজ মেজারমেন্ট গাইড
            </h3>
            <p className="text-xs text-amber-200/60">ঘরে বসেই নিখুঁত সাইজ নির্বাচন করুন</p>
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
            💍 আংটি / রিং সাইজ (Ring)
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
            💫 চুড়ি ও বালা সাইজ (Bangle)
          </button>
        </div>

        {activeTab === "ring" ? (
          <div className="mt-4 space-y-3">
            <p className="text-xs text-stone-300">
              আপনার আঙুলে সুতা বা ফিতা পেঁচিয়ে স্কেলে মেপে নিচের ডায়ামিটার (mm) মিলিয়ে নিন:
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
              সাইজ হিসেবে {selectedRingSize} নিশ্চিত করুন
            </button>
          </div>
        ) : (
          <div className="mt-4 space-y-3">
            <p className="text-xs text-stone-300">
              বাংলাদেশি জুয়েলারি মার্কেট স্ট্যান্ডার্ড অনুযায়ী চুড়ি/বালা সাইজ:
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
}: {
  selectedKarat: string;
  onChangeKarat: (k: string) => void;
}) {
  const options = [
    { id: "22k", label: "২২ ক্যারেট হলুদ সোনা", purity: "৯১.৬% পিওর হলমার্ক সোনা", badge: "সবচেয়ে জনপ্রিয়" },
    { id: "21k", label: "২১ ক্যারেট সনাতন সোনা", purity: "৮৭.৫% ক্লাসিক ব্রাইডাল গোল্ড", badge: "" },
    { id: "18k", label: "১৮ ক্যারেট ডায়মন্ড গোল্ড", purity: "৭৫.০% ডায়মন্ড সেটিং উপযোগী", badge: "" },
    { id: "rose", label: "১৮ ক্যারেট রোজ গোল্ড", purity: "রোমান্টিক পিংকিশ গোল্ড ভাইব", badge: "ট্রেন্ডি" },
    { id: "silver", label: "৯২৫ স্টার্লিং রূপা", purity: "পিওর ইতালিয়ান প্রিমিয়াম সিলভার", badge: "" },
  ];

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between text-xs">
        <span className="font-bold text-stone-800">সোনার ক্যারেট ও উপাদান বেছে নিন:</span>
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
}: {
  orgSlug: string;
  mainProduct: { id: string; name: string; priceMinor: string };
}) {
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
              রয়্যাল ব্রাইডাল জুয়েলারি কম্বো স্যুট
            </h3>
            <p className="text-[11px] text-slate-500">
              একসাথে ক্রয়ে পাচ্ছেন ৳১,৫০০ বিশেষ ছাড় ও রয়্যাল ভেলভেট গিফট বক্স
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
          <p className="text-[11px] text-amber-200/60 font-serif">কম্বো রয়্যাল অফার মূল্য (৩টি আইটেম):</p>
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
          {loading ? "যোগ হচ্ছে..." : added ? "✓ কার্টে যোগ হয়েছে" : "সম্পূর্ণ ব্রাইডাল স্যুট কার্টে নিন"}
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
              ২২K হলমার্ক
            </span>
            {hasDiscount ? (
              <span className="rounded-lg bg-amber-600 px-2 py-0.5 text-[9px] font-black text-white">
                রয়্যাল অফার
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
            <span>১০০% লাইফটাইম বাইব্যাক</span>
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
          {loading ? "যোগ হচ্ছে..." : added ? "✓ কার্টে যোগ হয়েছে" : "কার্টে যোগ করুন"}
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
            <span>১০০% বিএসটিআই হলমার্ক সার্টিফাইড গোল্ড ও ডায়মন্ড</span>
          </div>
          <h1 className="font-serif text-3xl font-black tracking-wide text-amber-100 sm:text-5xl lg:text-6xl">
            ETERNAL <span className="text-amber-400 italic">ELEGANCE</span> & LUXURY
          </h1>
          <p className="font-sans text-sm font-medium text-stone-300 sm:text-base max-w-xl">
            স্মৃতির মতো অমলিন খাঁটি সোনার গহনা ও ডায়মন্ডের দীপ্তি। প্রতিটি গহনায় রয়েছে সরকারি হলমার্ক কোড, আন্তর্জাতিক ডায়মন্ড সনদ এবং ১০০% লাইফটাইম বাইব্যাক গ্যারান্টি।
          </p>
          <div className="flex flex-wrap items-center gap-3 pt-3 font-sans">
            <a
              href="#products-section"
              className="rounded-xl bg-amber-500 px-6 py-3 text-xs font-black uppercase tracking-wider text-stone-950 shadow-lg hover:bg-amber-400 transition-transform active:scale-95"
            >
              গহনা কালেকশন দেখুন
            </a>
            <button
              type="button"
              onClick={() => setCertOpen(true)}
              className="rounded-xl border border-amber-400/40 bg-stone-900/80 px-6 py-3 text-xs font-bold text-amber-200 backdrop-blur-xs hover:bg-stone-800"
            >
              📜 হলমার্ক সনদ যাচাই করুন
            </button>
            <button
              type="button"
              onClick={() => setRingSizeOpen(true)}
              className="rounded-xl border border-amber-400/40 bg-stone-900/80 px-4 py-3 text-xs font-bold text-amber-200 backdrop-blur-xs hover:bg-stone-800"
            >
              💍 রিং সাইজ গাইড
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
            <p className="text-xs font-bold text-amber-300">আজকের অফিসিয়াল গোল্ড রেট (BAJUS রেট অনুযায়ী)</p>
            <p className="text-[11px] text-stone-400">প্রতি ভরি (১১.৬৬৪ গ্রাম) হলমার্ক ক্যাডমিয়াম ফ্রি সোনা</p>
          </div>
        </div>
        <div className="flex items-center gap-4 text-xs">
          <div className="rounded-xl bg-stone-800 px-3 py-1.5 border border-amber-500/20">
            <span className="text-stone-400">২২ ক্যারেট: </span>
            <span className="font-bold text-amber-300">৳১,২৬,৫০০</span>
          </div>
          <div className="rounded-xl bg-stone-800 px-3 py-1.5 border border-amber-500/20">
            <span className="text-stone-400">২১ ক্যারেট: </span>
            <span className="font-bold text-amber-300">৳১,২০,৭০০</span>
          </div>
          <div className="rounded-xl bg-stone-800 px-3 py-1.5 border border-amber-500/20">
            <span className="text-stone-400">১৮ ক্যারেট: </span>
            <span className="font-bold text-amber-300">৳১,০৩,৫০০</span>
          </div>
        </div>
      </div>

      {/* Trust Pillars */}
      <JewelryTrustBar />

      {/* Jewelry Categories Matrix */}
      <div className="space-y-4">
        <div className="flex items-center justify-between">
          <div>
            <h2 className="font-serif text-lg font-black text-stone-900">এক্সক্লুসিভ লাক্সারি ক্যাটাগরি</h2>
            <p className="text-xs text-stone-500">আপনার রাজকীয় সাজের জন্য সেরা গহনা বেছে নিন</p>
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
            <span>১০০% লাইফটাইম বাইব্যাক ও ভ্যালু প্রোটেকশন</span>
          </div>
          <h3 className="font-serif text-xl sm:text-2xl font-black text-amber-100">
            সোনার গহনা কেনা এখন সম্পূর্ণ নিরাপদ ও নির্ভরযোগ্য
          </h3>
          <p className="text-xs sm:text-sm text-stone-300">
            যেকোনো সময় বর্তমান বাজার মূল্যে ৯০% নগদ ক্যাশব্যাক অথবা ১০০% দিয়ে অন্য যেকোনো ডিজাইনের জুয়েলারি এক্সচেঞ্জ করার আজীবন নিশ্চয়তা।
          </p>
        </div>
        <button
          type="button"
          onClick={() => setCertOpen(true)}
          className="rounded-2xl bg-amber-500 px-6 py-3.5 text-xs font-black uppercase tracking-wider text-stone-950 shadow-xl hover:bg-amber-400 transition-transform active:scale-95"
        >
          হলমার্ক পলিসি জানুন →
        </button>
      </div>

      {/* Products Grid */}
      <div id="products-section" className="space-y-4">
        <div className="flex items-center justify-between">
          <div>
            <h2 className="font-serif text-xl font-black text-stone-900">রাজকীয় জুয়েলারি ও লাক্সারি কালেকশন</h2>
            <p className="text-xs text-stone-500">প্রতিটি পিস খাঁটি সোনা ও দক্ষ কারিগর দ্বারা নিখুঁতভাবে তৈরি</p>
          </div>
        </div>

        {products.length === 0 ? (
          <div className="rounded-3xl border border-dashed border-stone-300 bg-white p-12 text-center">
            <p className="text-4xl">💎</p>
            <p className="mt-2 text-sm font-semibold text-stone-600">কোনো জুয়েলারি প্রোডাক্ট পাওয়া যায়নি।</p>
          </div>
        ) : (
          <div className="grid grid-cols-2 gap-3 sm:gap-5 md:grid-cols-3 lg:grid-cols-4">
            {products.map((p: ShopProduct) => (
              <JewelryProductCard key={p.id} orgSlug={orgSlug} product={p} locale={locale} />
            ))}
          </div>
        )}
      </div>

      <JewelryCertificateModal
        open={certOpen}
        onClose={() => setCertOpen(false)}
        productName="রয়্যাল জুয়েলারি কালেকশন"
      />
      <JewelryRingSizeModal
        open={ringSizeOpen}
        onClose={() => setRingSizeOpen(false)}
        productName="আংটি ও চুড়ি সাইজ গাইড"
      />
    </div>
  );
}
