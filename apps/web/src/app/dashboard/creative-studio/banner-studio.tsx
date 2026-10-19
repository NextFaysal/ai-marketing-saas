"use client";
import React, { useEffect, useRef, useState, useCallback } from "react";
import { fmtMoneyMinor, fmtNumber } from "@repo/contracts";
import { useLocale } from "@/lib/i18n/provider";
import { useRouter } from "next/navigation";
import {
  BANNER_PALETTES,
  BANNER_TEMPLATES,
  type AspectRatio,
  type TemplateStyle,
  formatBannerDimensions,
  calculateDiscountPercent,
} from "@/lib/banner-presets";

export interface ProductItem {
  id: string;
  name: string;
  priceMinor: string;
  currency?: string | null;
  category?: string | null;
  stockQuantity?: number | null;
  imageUrl?: string | null;
  compareAtMinor?: string | null;
  description?: string | null;
}

export interface AdAccount {
  id: string;
  name: string;
  platform: string;
  integrationId?: string | null;
}

interface BannerStudioProps {
  products: ProductItem[];
  adAccounts: AdAccount[];
  selectedAdAccountId: string;
  onDraftWithBanner?: (product: ProductItem, headline: string, primaryText: string) => void;
}

const QUICK_BADGES = [
  "🌙 ঈদ স্পেশাল কালেকশন",
  "🪕 শুভ নববর্ষ ১৪৩৩",
  "🔥 ফ্ল্যাট ৫০% মেগা ছাড়",
  "🚚 ফ্রি হোম ডেলিভারি",
  "💵 শতভাগ ক্যাশ অন ডেলিভারি",
  "⚡ সীমিত সময়ের ধামাকা অফার",
  "📦 পার্সেল খুলে দেখে পেমেন্ট",
  "⭐ বেস্ট সেলার কালেকশন",
];

export function BannerStudio({
  products,
  adAccounts,
  selectedAdAccountId,
  onDraftWithBanner,
}: BannerStudioProps) {
  const { t, locale } = useLocale();
  const router = useRouter();
  const canvasRef = useRef<HTMLCanvasElement | null>(null);

  const [selectedProductId, setSelectedProductId] = useState<string>(
    products[0]?.id ?? ""
  );
  const [ratio, setRatio] = useState<AspectRatio>("1:1");
  const [template, setTemplate] = useState<TemplateStyle>("eid_special");
  const [paletteId, setPaletteId] = useState<string>("eid_emerald_gold");

  const [badgeText, setBadgeText] = useState(t("misc.zzBannerDefaultBadge"));
  const [headline, setHeadline] = useState("");
  const [subtext, setSubtext] = useState("");
  const [priceText, setPriceText] = useState("");
  const [comparePriceText, setComparePriceText] = useState("");
  const [brandText, setBrandText] = useState("NEXT COMMERCE");
  const [ctaText, setCtaText] = useState(t("misc.zzBannerDefaultCta"));
  const [trustTag, setTrustTag] = useState(t("misc.zzBannerDefaultTrust"));

  const [downloading, setDownloading] = useState(false);
  const [copied, setCopied] = useState(false);

  // Sync selected product details
  const activeProduct = products.find((p) => p.id === selectedProductId) ?? products[0];

  useEffect(() => {
    if (activeProduct) {
      setHeadline(activeProduct.name);
      try {
        const pStr = fmtMoneyMinor(locale, BigInt(activeProduct.priceMinor), { currency: activeProduct.currency ?? "BDT" });
        setPriceText(pStr);
      } catch {
        setPriceText(activeProduct.priceMinor ? `${activeProduct.priceMinor} BDT` : fmtMoneyMinor(locale, BigInt(0), { currency: "BDT" }));
      }

      if (activeProduct.compareAtMinor) {
        try {
          const cpStr = fmtMoneyMinor(locale, BigInt(activeProduct.compareAtMinor), { currency: activeProduct.currency ?? "BDT" });
          setComparePriceText(cpStr);
        } catch {
          setComparePriceText("");
        }
      } else {
        setComparePriceText("");
      }

      if (activeProduct.category) {
        setSubtext(t("misc.zzBannerSubtextWithCategory", { category: activeProduct.category }));
      } else {
        setSubtext(t("misc.zzBannerSubtextFallback"));
      }
    }
  }, [activeProduct]);

  const selectedPalette = BANNER_PALETTES.find((p) => p.id === paletteId) ?? BANNER_PALETTES[0];

  // Canvas render function
  const renderBanner = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const dims = formatBannerDimensions(ratio, locale);
    const width = dims.width;
    const height = dims.height;
    canvas.width = width;
    canvas.height = height;

    // 1. Draw Rich Gradient Background
    const grad = ctx.createLinearGradient(0, 0, width, height);
    grad.addColorStop(0, selectedPalette.bgStart);
    grad.addColorStop(1, selectedPalette.bgEnd);
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, width, height);

    // 2. Geometry according to Aspect Ratio
    let prodCenterX = width / 2;
    let prodCenterY = 480;
    let imgSize = 540;
    let bottomStartY = 790;
    let bottomHeight = height - bottomStartY - 50;
    let headerY = 70;

    if (ratio === "9:16") {
      prodCenterY = 750;
      imgSize = 660;
      bottomStartY = 1150;
      bottomHeight = height - bottomStartY - 60;
      headerY = 100;
    } else if (ratio === "16:9") {
      prodCenterX = 1350;
      prodCenterY = 540;
      imgSize = 640;
      bottomStartY = 240;
      bottomHeight = height - bottomStartY - 100;
      headerY = 100;
    } else if (ratio === "4:5") {
      prodCenterY = 580;
      imgSize = 600;
      bottomStartY = 920;
      bottomHeight = height - bottomStartY - 50;
      headerY = 80;
    }

    const spotRad = ratio === "16:9" ? 450 : ratio === "9:16" ? 550 : 420;

    // Background Radial Spotlight behind product
    const spot = ctx.createRadialGradient(
      prodCenterX,
      prodCenterY,
      40,
      prodCenterX,
      prodCenterY,
      spotRad
    );
    spot.addColorStop(0, selectedPalette.glow);
    spot.addColorStop(1, "transparent");
    ctx.fillStyle = spot;
    ctx.beginPath();
    ctx.arc(prodCenterX, prodCenterY, spotRad, 0, Math.PI * 2);
    ctx.fill();

    // 3. Festival Sparkles & Themed Motifs
    if (template === "festive" || template === "eid_special") {
      ctx.fillStyle = selectedPalette.accent;
      ctx.globalAlpha = 0.35;
      for (let i = 0; i < 28; i++) {
        const sx = (i * 137) % width;
        const sy = (i * 189) % (height * 0.7);
        ctx.beginPath();
        ctx.arc(sx, sy, (i % 3) + 2, 0, Math.PI * 2);
        ctx.fill();
      }
      ctx.globalAlpha = 1.0;

      if (template === "eid_special") {
        ctx.font = "60px sans-serif";
        ctx.textAlign = "left";
        ctx.fillText("🌙", 60, headerY + 15);
      }
    } else if (template === "black_friday") {
      // Dark High-Voltage Corner Ribbons
      ctx.fillStyle = selectedPalette.accent;
      ctx.globalAlpha = 0.2;
      ctx.beginPath();
      ctx.moveTo(0, 0);
      ctx.lineTo(200, 0);
      ctx.lineTo(0, 200);
      ctx.fill();
      ctx.globalAlpha = 1.0;
    } else if (template === "winter_clearance") {
      ctx.fillStyle = "#e0f2fe";
      ctx.globalAlpha = 0.4;
      for (let i = 0; i < 22; i++) {
        const sx = (i * 163) % width;
        const sy = (i * 149) % height;
        ctx.font = "24px sans-serif";
        ctx.fillText("❄️", sx, sy);
      }
      ctx.globalAlpha = 1.0;
    }

    // 4. Header Bar: Brand Name & Badge
    const brandX = template === "eid_special" ? 140 : 70;
    ctx.font = "bold 32px 'Hind Siliguri', Inter, sans-serif";
    ctx.fillStyle = selectedPalette.accent;
    ctx.textAlign = "left";
    ctx.fillText(brandText.toUpperCase(), brandX, headerY + 10);

    // Badge Pill at top right
    if (badgeText.trim()) {
      ctx.font = "bold 28px 'Hind Siliguri', Inter, sans-serif";
      const badgeMetrics = ctx.measureText(badgeText);
      const bPadX = 28;
      const bW = badgeMetrics.width + bPadX * 2;
      const bH = 50;
      const bX = width - 70 - bW;
      const bY = headerY - 26;

      ctx.fillStyle = selectedPalette.badgeBg;
      ctx.beginPath();
      ctx.roundRect(bX, bY, bW, bH, 25);
      ctx.fill();

      ctx.strokeStyle = "rgba(255, 255, 255, 0.4)";
      ctx.lineWidth = 2;
      ctx.stroke();

      ctx.fillStyle = selectedPalette.badgeText;
      ctx.textAlign = "center";
      ctx.fillText(badgeText, bX + bW / 2, bY + 35);
    }

    // 5. Draw Product Image (with Drop Shadow & Border)
    const imgX = prodCenterX - imgSize / 2;
    const imgY = prodCenterY - imgSize / 2;

    const drawProductContent = (imgElem?: HTMLImageElement) => {
      // Pedestal / Base shadow
      ctx.save();
      ctx.beginPath();
      ctx.ellipse(prodCenterX, imgY + imgSize + 15, imgSize * 0.42, 28, 0, 0, Math.PI * 2);
      ctx.fillStyle = "rgba(0, 0, 0, 0.55)";
      ctx.filter = "blur(18px)";
      ctx.fill();
      ctx.restore();

      // Rounded container for product
      ctx.save();
      const r = 24;
      ctx.beginPath();
      ctx.roundRect(imgX, imgY, imgSize, imgSize, r);
      ctx.clip();

      if (imgElem && imgElem.complete && imgElem.naturalWidth > 0) {
        ctx.fillStyle = "#ffffff";
        ctx.fillRect(imgX, imgY, imgSize, imgSize);

        const imgRatio = imgElem.naturalWidth / imgElem.naturalHeight;
        let dw = imgSize;
        let dh = imgSize;
        let dx = imgX;
        let dy = imgY;

        if (imgRatio > 1) {
          dh = imgSize / imgRatio;
          dy = imgY + (imgSize - dh) / 2;
        } else {
          dw = imgSize * imgRatio;
          dx = imgX + (imgSize - dw) / 2;
        }
        ctx.drawImage(imgElem, dx + 10, dy + 10, dw - 20, dh - 20);
      } else {
        ctx.fillStyle = "rgba(255, 255, 255, 0.08)";
        ctx.fillRect(imgX, imgY, imgSize, imgSize);

        ctx.font = "80px sans-serif";
        ctx.textAlign = "center";
        ctx.fillStyle = selectedPalette.accent;
        ctx.fillText("🛍️", prodCenterX, prodCenterY - 20);

        ctx.font = "bold 28px 'Hind Siliguri', Inter, sans-serif";
        ctx.fillStyle = selectedPalette.textMuted;
        ctx.fillText(activeProduct?.name || t("misc.zzBannerProductImageFallback"), prodCenterX, prodCenterY + 60);
      }
      ctx.restore();

      // Sleek container border
      ctx.save();
      ctx.beginPath();
      ctx.roundRect(imgX, imgY, imgSize, imgSize, 24);
      ctx.strokeStyle = "rgba(255, 255, 255, 0.25)";
      ctx.lineWidth = 3;
      ctx.stroke();
      ctx.restore();

      // Discount % Badge on Product Corner
      if (activeProduct?.priceMinor && activeProduct?.compareAtMinor) {
        const discPct = calculateDiscountPercent(activeProduct.priceMinor, activeProduct.compareAtMinor);
        if (discPct && discPct > 0) {
          ctx.save();
          const dBadgeX = imgX + 20;
          const dBadgeY = imgY + 20;
          const dBadgeW = 120;
          const dBadgeH = 46;

          ctx.fillStyle = "#dc2626"; // Crimson Red
          ctx.beginPath();
          ctx.roundRect(dBadgeX, dBadgeY, dBadgeW, dBadgeH, 12);
          ctx.fill();

          ctx.strokeStyle = "#ffffff";
          ctx.lineWidth = 2;
          ctx.stroke();

          ctx.font = "bold 22px 'Hind Siliguri', Inter, sans-serif";
          ctx.fillStyle = "#ffffff";
          ctx.textAlign = "center";
          ctx.fillText(t("misc.zzBannerDiscountBadge", { pct: fmtNumber(locale, discPct) }), dBadgeX + dBadgeW / 2, dBadgeY + 31);
          ctx.restore();
        }
      }

      // 6. Draw Content Card / Information Panel
      if (ratio === "16:9") {
        // Landscape Mode: Left column info panel
        const cardX = 70;
        const cardY = 220;
        const cardW = 900;
        const cardH = 680;

        ctx.save();
        ctx.fillStyle = "rgba(0, 0, 0, 0.45)";
        ctx.beginPath();
        ctx.roundRect(cardX, cardY, cardW, cardH, 28);
        ctx.fill();
        ctx.strokeStyle = "rgba(255, 255, 255, 0.15)";
        ctx.lineWidth = 2;
        ctx.stroke();
        ctx.restore();

        ctx.font = "bold 52px 'Hind Siliguri', Inter, sans-serif";
        ctx.fillStyle = selectedPalette.textPrimary;
        ctx.textAlign = "left";
        const displayHeadline = headline.length > 28 ? headline.slice(0, 26) + "..." : headline;
        ctx.fillText(displayHeadline, cardX + 50, cardY + 90);

        ctx.font = "30px 'Hind Siliguri', Inter, sans-serif";
        ctx.fillStyle = selectedPalette.textMuted;
        const displaySubtext = subtext.length > 40 ? subtext.slice(0, 38) + "..." : subtext;
        ctx.fillText(displaySubtext, cardX + 50, cardY + 150);

        const priceY = cardY + 250;
        ctx.font = "bold 64px 'Hind Siliguri', Inter, sans-serif";
        ctx.fillStyle = selectedPalette.accent;
        ctx.fillText(priceText, cardX + 50, priceY);

        if (comparePriceText.trim()) {
          const priceM = ctx.measureText(priceText);
          const compX = cardX + 50 + priceM.width + 24;
          ctx.font = "36px 'Hind Siliguri', Inter, sans-serif";
          ctx.fillStyle = selectedPalette.textMuted;
          ctx.fillText(comparePriceText, compX, priceY - 8);

          const compM = ctx.measureText(comparePriceText);
          ctx.strokeStyle = "#ef4444";
          ctx.lineWidth = 4;
          ctx.beginPath();
          ctx.moveTo(compX - 4, priceY - 20);
          ctx.lineTo(compX + compM.width + 4, priceY - 20);
          ctx.stroke();
        }

        // CTA
        if (ctaText.trim()) {
          const ctaX = cardX + 50;
          const ctaY = priceY + 60;
          const ctaW = 380;
          const ctaH = 74;

          ctx.fillStyle = selectedPalette.accent;
          ctx.beginPath();
          ctx.roundRect(ctaX, ctaY, ctaW, ctaH, 37);
          ctx.fill();

          ctx.fillStyle = selectedPalette.bgStart;
          ctx.font = "bold 32px 'Hind Siliguri', Inter, sans-serif";
          ctx.textAlign = "center";
          ctx.fillText(ctaText, ctaX + ctaW / 2, ctaY + 48);
        }

        // Trust
        ctx.font = "bold 26px 'Hind Siliguri', Inter, sans-serif";
        ctx.fillStyle = selectedPalette.textMuted;
        ctx.textAlign = "left";
        ctx.fillText(trustTag, cardX + 50, cardY + cardH - 50);
      } else {
        // Square, Story, Portrait Modes
        ctx.save();
        ctx.fillStyle = "rgba(0, 0, 0, 0.45)";
        ctx.beginPath();
        ctx.roundRect(50, bottomStartY, width - 100, bottomHeight, 28);
        ctx.fill();
        ctx.strokeStyle = "rgba(255, 255, 255, 0.15)";
        ctx.lineWidth = 2;
        ctx.stroke();
        ctx.restore();

        // Product Title
        ctx.font = "bold 44px 'Hind Siliguri', Inter, sans-serif";
        ctx.fillStyle = selectedPalette.textPrimary;
        ctx.textAlign = "left";
        const displayHeadline = headline.length > 34 ? headline.slice(0, 32) + "..." : headline;
        ctx.fillText(displayHeadline, 85, bottomStartY + 64);

        // Subtext / Feature Tag
        ctx.font = "26px 'Hind Siliguri', Inter, sans-serif";
        ctx.fillStyle = selectedPalette.textMuted;
        const displaySubtext = subtext.length > 52 ? subtext.slice(0, 50) + "..." : subtext;
        ctx.fillText(displaySubtext, 85, bottomStartY + 108);

        // Price Tag Section
        const priceY = bottomStartY + 168;
        ctx.font = "bold 52px 'Hind Siliguri', Inter, sans-serif";
        ctx.fillStyle = selectedPalette.accent;
        ctx.fillText(priceText, 85, priceY);

        const priceMetrics = ctx.measureText(priceText);

        // Strike-through Price if present
        if (comparePriceText.trim()) {
          const compX = 85 + priceMetrics.width + 24;
          ctx.font = "30px 'Hind Siliguri', Inter, sans-serif";
          ctx.fillStyle = selectedPalette.textMuted;
          ctx.fillText(comparePriceText, compX, priceY - 6);

          const compMetrics = ctx.measureText(comparePriceText);
          ctx.strokeStyle = "#ef4444";
          ctx.lineWidth = 3;
          ctx.beginPath();
          ctx.moveTo(compX - 4, priceY - 16);
          ctx.lineTo(compX + compMetrics.width + 4, priceY - 16);
          ctx.stroke();
        }

        // CTA Button Pill at bottom right of card
        if (ctaText.trim()) {
          ctx.font = "bold 28px 'Hind Siliguri', Inter, sans-serif";
          const ctaMetrics = ctx.measureText(ctaText);
          const ctaPadX = 32;
          const ctaW = ctaMetrics.width + ctaPadX * 2;
          const ctaH = 64;
          const ctaX = width - 85 - ctaW;
          const ctaY = priceY - 48;

          ctx.fillStyle = selectedPalette.accent;
          ctx.beginPath();
          ctx.roundRect(ctaX, ctaY, ctaW, ctaH, 32);
          ctx.fill();

          ctx.fillStyle = selectedPalette.bgStart;
          ctx.textAlign = "center";
          ctx.fillText(ctaText, ctaX + ctaW / 2, ctaY + 43);
        }

        // 7. Trust Bar (COD / Delivery Guarantee)
        if (ratio === "9:16" || ratio === "4:5") {
          const trustY = bottomStartY + bottomHeight - 35;
          ctx.font = "bold 24px 'Hind Siliguri', Inter, sans-serif";
          ctx.fillStyle = selectedPalette.accent;
          ctx.textAlign = "center";
          ctx.fillText(trustTag, width / 2, trustY);
        }
      }
    };

    if (activeProduct?.imageUrl) {
      const img = new Image();
      img.crossOrigin = "anonymous";
      img.onload = () => {
        drawProductContent(img);
      };
      img.onerror = () => {
        drawProductContent();
      };
      img.src = activeProduct.imageUrl;
    } else {
      drawProductContent();
    }
  }, [
    activeProduct,
    ratio,
    template,
    selectedPalette,
    badgeText,
    headline,
    subtext,
    priceText,
    comparePriceText,
    brandText,
    ctaText,
    trustTag,
  ]);

  useEffect(() => {
    renderBanner();
  }, [renderBanner]);

  // Download high-res PNG
  const handleDownload = () => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    setDownloading(true);
    try {
      const dataUrl = canvas.toDataURL("image/png");
      const link = document.createElement("a");
      const safeName = (activeProduct?.name ?? "ad-banner").replace(/[^a-zA-Z0-9\u0980-\u09FF]/g, "-");
      link.download = `${safeName}-${ratio}.png`;
      link.href = dataUrl;
      link.click();
    } catch (e) {
      alert(t("ai.bsDownloadFail", { error: e instanceof Error ? e.message : "Error" }));
    } finally {
      setDownloading(false);
    }
  };

  // Copy to clipboard
  const handleCopy = async () => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    try {
      canvas.toBlob(async (blob) => {
        if (!blob) return;
        try {
          await navigator.clipboard.write([
            new ClipboardItem({ "image/png": blob }),
          ]);
          setCopied(true);
          setTimeout(() => setCopied(false), 2500);
        } catch {
          alert(t("ai.bsClipboardUnsupported"));
        }
      });
    } catch {
      // ignored
    }
  };

  return (
    <div className="space-y-6">
      {/* Top Banner Notice */}
      <div className="rounded-xl border border-sky-200 bg-gradient-to-r from-sky-50 via-amber-50 to-indigo-50 p-4">
        <div className="flex items-center gap-3">
          <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-sky-600 text-xl text-white shadow-sm">
            🎨
          </div>
          <div>
            <h3 className="font-semibold text-slate-900">
              {t("ai.bsTitle")}
            </h3>
            <p className="text-xs text-slate-600">
              {t("ai.bsSubtitle")}
            </p>
          </div>
        </div>
      </div>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-12">
        {/* Controls Column (5 cols) */}
        <div className="space-y-5 lg:col-span-5">
          {/* 1. Product Selector */}
          <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
            <label className="block text-xs font-semibold uppercase tracking-wider text-slate-500">
              {t("ai.bsStep1")}
            </label>
            <select
              className="mt-1.5 w-full rounded-lg border border-slate-300 p-2 text-sm focus:border-sky-500 focus:outline-none"
              value={selectedProductId}
              onChange={(e) => setSelectedProductId(e.target.value)}
            >
              {products.length === 0 ? (
                <option value="">{t("ai.bsNoProduct")}</option>
              ) : (
                products.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name} — {p.priceMinor ? `${Number(p.priceMinor) / 100} BDT` : ""}
                  </option>
                ))
              )}
            </select>
          </div>

          {/* 2. Format & Style Selector */}
          <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
            <label className="block text-xs font-semibold uppercase tracking-wider text-slate-500">
              {t("ai.bsStep2")}
            </label>

            {/* Aspect ratio */}
            <div className="mt-2 grid grid-cols-2 gap-2 sm:grid-cols-4">
              {[
                { id: "1:1", label: t("ai.bsRatioSquare") },
                { id: "9:16", label: t("ai.bsRatioReels") },
                { id: "16:9", label: t("ai.bsRatioWide") },
                { id: "4:5", label: t("ai.bsRatioPortrait") },
              ].map((r) => (
                <button
                  key={r.id}
                  type="button"
                  onClick={() => setRatio(r.id as AspectRatio)}
                  className={`rounded-lg border px-2.5 py-2 text-xs font-medium transition ${
                    ratio === r.id
                      ? "border-sky-600 bg-sky-50 text-sky-700 shadow-sm"
                      : "border-slate-200 text-slate-700 hover:bg-slate-50"
                  }`}
                >
                  {r.label}
                </button>
              ))}
            </div>

            {/* Template presets */}
            <div className="mt-3">
              <label className="block text-[11px] font-medium text-slate-600">{t("ai.bsTemplateLabel")}</label>
              <div className="mt-1 grid grid-cols-2 gap-1.5">
                {BANNER_TEMPLATES.map((tpl) => (
                  <button
                    key={tpl.id}
                    type="button"
                    onClick={() => {
                      setTemplate(tpl.id);
                      if (tpl.id === "eid_special") {
                        setPaletteId("eid_emerald_gold");
                        setBadgeText("🌙 ঈদ মেগা সেল");
                      } else if (tpl.id === "pohela_boishakh") {
                        setPaletteId("boishakh_red");
                        setBadgeText("🪕 বৈশাখী মেলা ১৪৩৩");
                      } else if (tpl.id === "black_friday") {
                        setPaletteId("cyber_neon");
                        setBadgeText("🔥 ১১.১১ মেগা ফ্ল্যাশ সেল");
                      } else if (tpl.id === "winter_clearance") {
                        setPaletteId("navy");
                        setBadgeText("❄️ উইন্টার ক্লিয়ারেন্স সেল");
                      }
                    }}
                    className={`rounded-md px-2.5 py-1.5 text-xs text-left transition ${
                      template === tpl.id
                        ? "bg-slate-900 text-white font-medium shadow-xs"
                        : "bg-slate-100 text-slate-700 hover:bg-slate-200"
                    }`}
                  >
                    {tpl.icon} {locale === "en" ? tpl.labelEn : tpl.label}
                  </button>
                ))}
              </div>
            </div>

            {/* Palette */}
            <div className="mt-3">
              <label className="block text-[11px] font-medium text-slate-600">{t("ai.bsPaletteLabel")}</label>
              <div className="mt-1.5 flex flex-wrap gap-2">
                {BANNER_PALETTES.map((pal) => (
                  <button
                    key={pal.id}
                    type="button"
                    title={pal.name}
                    onClick={() => setPaletteId(pal.id)}
                    className={`flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs transition ${
                      paletteId === pal.id
                        ? "border-slate-900 bg-slate-900 text-white shadow-sm"
                        : "border-slate-200 bg-white text-slate-700 hover:bg-slate-100"
                    }`}
                  >
                    <span
                      className="h-3 w-3 rounded-full border border-white"
                      style={{ backgroundColor: pal.accent }}
                    />
                    <span>{locale === "en" ? pal.nameEn : pal.name}</span>
                  </button>
                ))}
              </div>
            </div>
          </div>

          {/* 3. Text & Badges Customization */}
          <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm space-y-3">
            <label className="block text-xs font-semibold uppercase tracking-wider text-slate-500">
              {t("ai.bsStep3")}
            </label>

            <div>
              <label className="text-[11px] font-medium text-slate-600">{t("ai.bsBadgeLabel")}</label>
              <div className="mt-1 flex flex-wrap gap-1">
                {QUICK_BADGES.map((qb) => (
                  <button
                    key={qb}
                    type="button"
                    onClick={() => setBadgeText(qb)}
                    className="rounded bg-slate-100 px-2 py-0.5 text-[11px] text-slate-700 hover:bg-sky-100 hover:text-sky-800"
                  >
                    {qb}
                  </button>
                ))}
              </div>
              <input
                type="text"
                className="mt-1.5 w-full rounded-md border border-slate-300 p-1.5 text-xs focus:border-sky-500 focus:outline-none"
                value={badgeText}
                onChange={(e) => setBadgeText(e.target.value)}
                placeholder={t("ai.bsBadgePlaceholder")}
              />
            </div>

            <div>
              <label className="text-[11px] font-medium text-slate-600">{t("ai.bsHeadlineLabel")}</label>
              <input
                type="text"
                className="mt-1 w-full rounded-md border border-slate-300 p-1.5 text-xs focus:border-sky-500 focus:outline-none"
                value={headline}
                onChange={(e) => setHeadline(e.target.value)}
              />
            </div>

            <div>
              <label className="text-[11px] font-medium text-slate-600">{t("ai.bsSubtextLabel")}</label>
              <input
                type="text"
                className="mt-1 w-full rounded-md border border-slate-300 p-1.5 text-xs focus:border-sky-500 focus:outline-none"
                value={subtext}
                onChange={(e) => setSubtext(e.target.value)}
              />
            </div>

            <div className="grid grid-cols-2 gap-2">
              <div>
                <label className="text-[11px] font-medium text-slate-600">{t("ai.bsPriceLabel")}</label>
                <input
                  type="text"
                  className="mt-1 w-full rounded-md border border-slate-300 p-1.5 text-xs focus:border-sky-500 focus:outline-none"
                  value={priceText}
                  onChange={(e) => setPriceText(e.target.value)}
                />
              </div>
              <div>
                <label className="text-[11px] font-medium text-slate-600">{t("ai.bsCompareLabel")}</label>
                <input
                  type="text"
                  className="mt-1 w-full rounded-md border border-slate-300 p-1.5 text-xs focus:border-sky-500 focus:outline-none"
                  value={comparePriceText}
                  onChange={(e) => setComparePriceText(e.target.value)}
                  placeholder={t("ai.bsComparePlaceholder")}
                />
              </div>
            </div>

            <div className="grid grid-cols-2 gap-2">
              <div>
                <label className="text-[11px] font-medium text-slate-600">{t("ai.bsBrandLabel")}</label>
                <input
                  type="text"
                  className="mt-1 w-full rounded-md border border-slate-300 p-1.5 text-xs focus:border-sky-500 focus:outline-none"
                  value={brandText}
                  onChange={(e) => setBrandText(e.target.value)}
                />
              </div>
              <div>
                <label className="text-[11px] font-medium text-slate-600">{t("ai.bsCtaLabel")}</label>
                <input
                  type="text"
                  className="mt-1 w-full rounded-md border border-slate-300 p-1.5 text-xs focus:border-sky-500 focus:outline-none"
                  value={ctaText}
                  onChange={(e) => setCtaText(e.target.value)}
                />
              </div>
            </div>
          </div>
        </div>

        {/* Live Preview Column (7 cols) */}
        <div className="space-y-4 lg:col-span-7">
          <div className="rounded-xl border border-slate-200 bg-slate-900 p-4 text-white shadow-lg">
            <div className="flex items-center justify-between pb-3 border-b border-slate-800">
              <div className="flex items-center gap-2">
                <span className="h-2.5 w-2.5 rounded-full bg-emerald-500 animate-pulse" />
                <span className="text-xs font-medium text-slate-300">
                  {t("ai.bsLivePreview")} ({ratio === "1:1" ? "1080×1080 Feed" : ratio === "9:16" ? "1080×1920 Story" : ratio === "16:9" ? "1920×1080 Wide" : "1080×1350 Portrait"})
                </span>
              </div>
              <span className="text-[11px] text-slate-400">Crisp Ultra-HD 300 DPI</span>
            </div>

            {/* Canvas Container with Max Constraints */}
            <div className="mt-4 flex justify-center overflow-hidden rounded-lg bg-black/40 p-2">
              <canvas
                ref={canvasRef}
                style={{
                  maxWidth: ratio === "16:9" ? "520px" : ratio === "1:1" ? "420px" : ratio === "4:5" ? "360px" : "320px",
                  maxHeight: "540px",
                  width: "100%",
                  height: "auto",
                  aspectRatio: ratio === "1:1" ? "1 / 1" : ratio === "9:16" ? "9 / 16" : ratio === "16:9" ? "16 / 9" : "4 / 5",
                  boxShadow: "0 20px 40px rgba(0,0,0,0.6)",
                }}
                className="rounded-lg border border-slate-800"
              />
            </div>

            {/* Action Bar */}
            <div className="mt-5 flex flex-wrap items-center justify-between gap-3 pt-3 border-t border-slate-800">
              <div className="flex flex-wrap items-center gap-2">
                <button
                  type="button"
                  onClick={handleDownload}
                  disabled={downloading}
                  className="flex items-center gap-2 rounded-lg bg-sky-600 px-4 py-2.5 text-xs font-semibold text-white shadow-md hover:bg-sky-500 disabled:opacity-50"
                >
                  <span>📥</span>
                  <span>{downloading ? t("ai.bsPreparing") : t("ai.bsDownload")}</span>
                </button>
                <button
                  type="button"
                  onClick={handleCopy}
                  className="flex items-center gap-1.5 rounded-lg border border-slate-700 bg-slate-800 px-3 py-2.5 text-xs font-medium text-slate-200 hover:bg-slate-750 hover:text-white"
                >
                  <span>📋</span>
                  <span>{copied ? t("ai.bsCopied") : t("ai.bsCopyClipboard")}</span>
                </button>
                <button
                  type="button"
                  onClick={() => {
                    const caption = t("misc.zzBannerCaption", { headline, badge: badgeText, subtext, price: priceText, was: comparePriceText ? t("misc.zzBannerCaptionWas", { price: comparePriceText }) : "", trust: trustTag });
                    navigator.clipboard?.writeText(caption);
                    router.push("/dashboard/social-posts");
                  }}
                  className="flex items-center gap-1.5 rounded-lg border border-indigo-700 bg-indigo-900/60 px-3 py-2.5 text-xs font-medium text-indigo-200 hover:bg-indigo-800 hover:text-white"
                >
                  <span>📣</span>
                  <span>{t("ai.bsSocialPost")}</span>
                </button>
              </div>

              {onDraftWithBanner && activeProduct ? (
                <button
                  type="button"
                  onClick={() =>
                    onDraftWithBanner(
                      activeProduct,
                      headline,
                      t("misc.zzBannerPrimaryText", { headline, badge: badgeText, subtext, price: priceText, trust: trustTag })
                    )
                  }
                  disabled={!selectedAdAccountId || adAccounts.length === 0}
                  className="flex items-center gap-2 rounded-lg bg-emerald-600 px-4 py-2.5 text-xs font-semibold text-white shadow-md hover:bg-emerald-500 disabled:opacity-50"
                >
                  <span>📝</span>
                  <span>{t("ai.bsDraftCta")}</span>
                </button>
              ) : null}
            </div>
          </div>

          {/* Quick Marketer Tips */}
          <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm text-xs text-slate-600 space-y-1.5">
            <div className="font-semibold text-slate-800">{t("ai.bsTipsTitle")}</div>
            <p>• <strong>{t("ai.bsTip1Head")}</strong> {t("ai.bsTip1")}</p>
            <p>• <strong>{t("ai.bsTip2Head")}</strong> {t("ai.bsTip2")}</p>
            <p>• <strong>{t("ai.bsTip3Head")}</strong> {t("ai.bsTip3")}</p>
            <p>• <strong>{t("ai.bsTip4Head")}</strong> {t("ai.bsTip4")}</p>
          </div>
        </div>
      </div>
    </div>
  );
}
