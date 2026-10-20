"use client";
import React, { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { apiFetch } from "@/lib/api";
import { getOrganizationId } from "@/lib/org";
import { formatMinorTaka } from "@/lib/storefront-money";
import {
  FUNNEL_PRESETS,
  type FunnelPresetId,
  type FunnelDraft,
  createInitialFunnelDraft,
  buildFunnelSections,
  calculateSavingsPercent,
  funnelPresetForLocale,
  slugifyFunnelTitle,
} from "@/lib/funnel-builder";
import { fmtNumber } from "@repo/contracts";
import { useLocale } from "@/lib/i18n/provider";

interface ProductItem {
  id: string;
  name: string;
  priceMinor: string;
  compareAtMinor?: string | null;
  imageUrl?: string | null;
  stockQuantity?: number | null;
  description?: string | null;
}

interface LandingItem {
  id: string;
  productId: string;
  slug: string;
  title: string;
  status: string;
  orderCount?: number;
  revenueMinor?: string;
}

export default function FunnelBuilderPage() {
  const { t, locale } = useLocale();
  const [products, setProducts] = useState<ProductItem[]>([]);
  const [recentLandings, setRecentLandings] = useState<LandingItem[]>([]);
  const [selectedProductId, setSelectedProductId] = useState<string>("");
  const [draft, setDraft] = useState<FunnelDraft | null>(null);

  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [successLink, setSuccessLink] = useState<{ slug: string; id: string } | null>(null);
  const [copied, setCopied] = useState(false);

  // Editor sub-tabs
  const [activeTab, setActiveTab] = useState<"offer" | "benefits" | "trust" | "faq">("offer");
  const [previewDevice, setPreviewDevice] = useState<"mobile" | "desktop">("mobile");

  // Load products and existing funnels
  const loadData = useCallback(async () => {
    const orgId = getOrganizationId();
    if (!orgId) return;
    setLoading(true);
    setError("");
    try {
      const [prodRes, landRes] = await Promise.all([
        apiFetch<{ items: ProductItem[] }>(`/organizations/${orgId}/products?pageSize=100`).catch(() => ({ items: [] as ProductItem[] })),
        apiFetch<{ items: LandingItem[] }>(`/organizations/${orgId}/landings`).catch(() => ({ items: [] as LandingItem[] })),
      ]);

      const items = prodRes.items || [];
      setProducts(items);
      setRecentLandings(landRes.items || []);

      if (items.length > 0) {
        const first = items[0];
        setSelectedProductId(first.id);
        setDraft(createInitialFunnelDraft(first, "flash_sale", locale));
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : t("ads.funLoadError"));
    } finally {
      setLoading(false);
    }
  }, [locale, t]);

  useEffect(() => {
    void loadData();
  }, [loadData]);

  // When selected product changes
  function handleProductChange(productId: string) {
    setSelectedProductId(productId);
    const prod = products.find((p) => p.id === productId);
    if (!prod) return;
    setDraft(createInitialFunnelDraft(prod, draft?.presetId || "flash_sale", locale));
    setSuccessLink(null);
  }

  // When preset changes
  function handlePresetChange(presetId: FunnelPresetId) {
    if (!draft) return;
    const prod = products.find((p) => p.id === selectedProductId);
    if (!prod) return;
    setDraft(createInitialFunnelDraft(prod, presetId, locale));
  }

  // Publish to backend
  async function handlePublish() {
    if (!draft) return;
    const orgId = getOrganizationId();
    if (!orgId) {
      setError(t("ads.funOrgError"));
      return;
    }

    setBusy(true);
    setError("");
    setSuccessLink(null);

    try {
      const sections = buildFunnelSections(draft);
      const res = await apiFetch<LandingItem>(`/organizations/${orgId}/landings`, {
        method: "POST",
        body: JSON.stringify({
          productId: draft.productId,
          title: draft.headline.slice(0, 200),
          slug: draft.slug.slice(0, 200),
          status: "published",
          sections,
        }),
      });

      // Create primary variant
      await apiFetch(`/organizations/${orgId}/landings/${res.id}/variants`, {
        method: "POST",
        body: JSON.stringify({
          name: "Main High-Converting Variant",
          isControl: true,
          weight: 100,
          headline: draft.headline.slice(0, 300),
          ctaText: draft.ctaText.slice(0, 120),
          heroImageUrl: draft.imageUrl || null,
          showCompareAt: true,
        }),
      }).catch(() => {
        // Variant creation failure shouldn't block the published landing
      });

      setSuccessLink({ slug: res.slug, id: res.id });
      // Refresh landings list
      const updatedLandings = await apiFetch<{ items: LandingItem[] }>(`/organizations/${orgId}/landings`).catch(() => null);
      if (updatedLandings?.items) {
        setRecentLandings(updatedLandings.items);
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : t("ads.funPublishError"));
    } finally {
      setBusy(false);
    }
  }

  const publicUrl = (slug: string) =>
    typeof window !== "undefined" ? `${window.location.origin}/l/${slug}` : `/l/${slug}`;

  async function copyPublicLink(slug: string) {
    try {
      await navigator.clipboard.writeText(publicUrl(slug));
      setCopied(true);
      setTimeout(() => setCopied(false), 2500);
    } catch {
      // fallback
    }
  }

  const selectedProduct = products.find((p) => p.id === selectedProductId);
  const savingsPct = draft
    ? calculateSavingsPercent(draft.priceMinor, draft.compareAtMinor)
    : 0;

  return (
    <div className="space-y-6 p-4 md:p-6 max-w-7xl mx-auto">
      {/* Top Header */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 border-b border-slate-200 pb-5">
        <div>
          <div className="flex items-center gap-2">
            <span className="flex h-9 w-9 items-center justify-center rounded-xl bg-gradient-to-tr from-amber-500 to-rose-500 text-white shadow-sm font-bold">
              ⚡
            </span>
            <h1 className="text-2xl font-black text-slate-900">{t("ads.funTitle")}</h1>
          </div>
          <p className="mt-1 text-sm text-slate-600">
            {t("ads.funIntro")}
          </p>
        </div>

        <div className="flex items-center gap-2">
          <Link
            href="/dashboard/commerce/landings"
            className="rounded-xl border border-slate-300 bg-white px-3.5 py-2 text-xs font-semibold text-slate-700 shadow-xs hover:bg-slate-50 transition"
          >
            {t("ads.funAllLandings")}
          </Link>
          <button
            onClick={handlePublish}
            disabled={busy || !draft}
            className="inline-flex items-center gap-2 rounded-xl bg-gradient-to-r from-emerald-600 to-teal-600 px-5 py-2.5 text-xs font-bold text-white shadow-md hover:from-emerald-700 hover:to-teal-700 transition disabled:opacity-50"
          >
            {busy ? t("ads.funPublishing") : t("ads.funPublish")}
          </button>
        </div>
      </div>

      {/* Success Notification Alert */}
      {successLink && (
        <div className="rounded-2xl border-2 border-emerald-300 bg-gradient-to-r from-emerald-50 via-teal-50 to-emerald-50 p-4 shadow-sm">
          <div className="flex flex-col md:flex-row md:items-center justify-between gap-3">
            <div className="flex items-start gap-3">
              <span className="flex h-8 w-8 items-center justify-center rounded-full bg-emerald-600 text-white font-bold text-sm">
                ✓
              </span>
              <div>
                <h3 className="text-sm font-bold text-emerald-950">
                  {t("ads.funSuccessTitle")}
                </h3>
                <p className="text-xs text-emerald-800 mt-0.5 font-mono break-all">
                  {publicUrl(successLink.slug)}
                </p>
              </div>
            </div>

            <div className="flex items-center gap-2">
              <button
                onClick={() => copyPublicLink(successLink.slug)}
                className="rounded-lg bg-white px-3.5 py-1.5 text-xs font-bold text-emerald-800 border border-emerald-300 shadow-xs hover:bg-emerald-100 transition"
              >
                {copied ? t("ads.funCopied") : t("ads.funCopyLink")}
              </button>
              <a
                href={`/l/${successLink.slug}`}
                target="_blank"
                rel="noreferrer"
                className="rounded-lg bg-emerald-700 px-4 py-1.5 text-xs font-bold text-white shadow-xs hover:bg-emerald-800 transition"
              >
                {t("ads.funOpenPage")}
              </a>
            </div>
          </div>
        </div>
      )}

      {error && (
        <div className="rounded-xl border border-rose-300 bg-rose-50 p-3 text-xs text-rose-800">
          ❌ {error}
        </div>
      )}

      {/* Product & AI Funnel Preset Selector */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        {/* Product selector card */}
        <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-xs">
          <label className="block text-xs font-bold uppercase tracking-wider text-slate-500 mb-2">
            {t("ads.funStep1")}
          </label>
          {loading ? (
            <div className="h-10 rounded-xl bg-slate-100 animate-pulse" />
          ) : products.length === 0 ? (
            <div className="p-3 text-center text-xs text-slate-500">
              {t("ads.funNoProducts")}
            </div>
          ) : (
            <select
              value={selectedProductId}
              onChange={(e) => handleProductChange(e.target.value)}
              className="w-full rounded-xl border border-slate-300 bg-white p-2.5 text-sm font-semibold text-slate-800 focus:border-amber-500 focus:outline-hidden"
            >
              {products.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name} ({formatMinorTaka(p.priceMinor)})
                </option>
              ))}
            </select>
          )}

          {selectedProduct && (
            <div className="mt-3 flex items-center gap-3 rounded-xl bg-slate-50 p-2.5 border border-slate-100">
              {selectedProduct.imageUrl ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  src={selectedProduct.imageUrl}
                  alt={selectedProduct.name}
                  className="h-12 w-12 rounded-lg object-cover border border-slate-200"
                />
              ) : (
                <div className="flex h-12 w-12 items-center justify-center rounded-lg bg-slate-200 text-lg">
                  🛍️
                </div>
              )}
              <div className="min-w-0 flex-1">
                <p className="text-xs font-bold text-slate-900 truncate">{selectedProduct.name}</p>
                <div className="flex items-center gap-2 mt-0.5">
                  <span className="text-xs font-black text-emerald-700">
                    {formatMinorTaka(selectedProduct.priceMinor)}
                  </span>
                  {selectedProduct.compareAtMinor && (
                    <span className="text-[11px] text-slate-400 line-through">
                      {formatMinorTaka(selectedProduct.compareAtMinor)}
                    </span>
                  )}
                  {savingsPct > 0 && (
                    <span className="rounded bg-rose-100 px-1.5 py-0.2 text-[10px] font-bold text-rose-700">
                      {t("ads.funSavings", { pct: fmtNumber(locale, savingsPct) })}
                    </span>
                  )}
                </div>
              </div>
            </div>
          )}
        </div>

        {/* Funnel Preset Cards */}
        <div className="lg:col-span-2 rounded-2xl border border-slate-200 bg-white p-4 shadow-xs">
          <label className="block text-xs font-bold uppercase tracking-wider text-slate-500 mb-2">
            {t("ads.funStep2")}
          </label>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
            {(Object.keys(FUNNEL_PRESETS) as FunnelPresetId[]).map((key) => {
              const preset = funnelPresetForLocale(FUNNEL_PRESETS[key], locale);
              const isSelected = draft?.presetId === key;
              return (
                <button
                  key={key}
                  type="button"
                  onClick={() => handlePresetChange(key)}
                  className={`flex flex-col text-left p-3 rounded-xl border transition-all ${
                    isSelected
                      ? "border-amber-500 bg-amber-50/50 ring-2 ring-amber-400 shadow-xs"
                      : "border-slate-200 hover:border-slate-300 hover:bg-slate-50/50"
                  }`}
                >
                  <div className="flex items-center justify-between w-full">
                    <span className="text-xs font-black text-slate-900">{preset.name}</span>
                    <span className="rounded-full bg-slate-100 px-2 py-0.5 text-[10px] font-bold text-slate-700">
                      {preset.badge}
                    </span>
                  </div>
                  <p className="mt-1 text-[11px] text-slate-500 line-clamp-1">{preset.tagline}</p>
                </button>
              );
            })}
          </div>
        </div>
      </div>

      {/* Main Studio Grid: Editor (Left) & Realtime Phone Frame Preview (Right) */}
      {draft && (
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
          {/* Left Editor Column (7 cols) */}
          <div className="lg:col-span-7 rounded-2xl border border-slate-200 bg-white shadow-xs overflow-hidden">
            {/* Editor Navigation Tabs */}
            <div className="flex border-b border-slate-200 bg-slate-50/80 px-4 pt-3 gap-2 overflow-x-auto">
              <button
                type="button"
                onClick={() => setActiveTab("offer")}
                className={`border-b-2 pb-2.5 px-3 text-xs font-bold transition ${
                  activeTab === "offer"
                    ? "border-amber-600 text-amber-900"
                    : "border-transparent text-slate-600 hover:text-slate-900"
                }`}
              >
                {t("ads.funTabOffer")}
              </button>
              <button
                type="button"
                onClick={() => setActiveTab("benefits")}
                className={`border-b-2 pb-2.5 px-3 text-xs font-bold transition ${
                  activeTab === "benefits"
                    ? "border-amber-600 text-amber-900"
                    : "border-transparent text-slate-600 hover:text-slate-900"
                }`}
              >
                {t("ads.funTabBenefits", { count: fmtNumber(locale, draft.benefits.length) })}
              </button>
              <button
                type="button"
                onClick={() => setActiveTab("trust")}
                className={`border-b-2 pb-2.5 px-3 text-xs font-bold transition ${
                  activeTab === "trust"
                    ? "border-amber-600 text-amber-900"
                    : "border-transparent text-slate-600 hover:text-slate-900"
                }`}
              >
                {t("ads.funTabTrust")}
              </button>
              <button
                type="button"
                onClick={() => setActiveTab("faq")}
                className={`border-b-2 pb-2.5 px-3 text-xs font-bold transition ${
                  activeTab === "faq"
                    ? "border-amber-600 text-amber-900"
                    : "border-transparent text-slate-600 hover:text-slate-900"
                }`}
              >
                {t("ads.funTabFaq", { count: fmtNumber(locale, draft.faqs.length) })}
              </button>
            </div>

            <div className="p-5 space-y-4">
              {/* Tab 1: Offer & Hook */}
              {activeTab === "offer" && (
                <div className="space-y-4">
                  <div>
                    <label className="block text-xs font-bold text-slate-700 mb-1">
                      {t("ads.funHeadlineLabel")}
                    </label>
                    <textarea
                      rows={2}
                      value={draft.headline}
                      onChange={(e) => setDraft({ ...draft, headline: e.target.value })}
                      className="w-full rounded-xl border border-slate-300 p-2.5 text-xs font-semibold text-slate-900 focus:border-amber-500 focus:outline-hidden"
                    />
                    <p className="mt-1 text-[11px] text-slate-400">
                      {t("ads.funHeadlineHelp")}
                    </p>
                  </div>

                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                    <div>
                      <label className="block text-xs font-bold text-slate-700 mb-1">
                        {t("ads.funSlugLabel")}
                      </label>
                      <div className="flex items-center gap-1">
                        <span className="text-xs text-slate-400 font-mono">/l/</span>
                        <input
                          type="text"
                          value={draft.slug}
                          onChange={(e) => setDraft({ ...draft, slug: e.target.value })}
                          className="w-full rounded-lg border border-slate-300 p-2 text-xs font-mono font-bold text-slate-800"
                        />
                        <button
                          type="button"
                          onClick={() => setDraft({ ...draft, slug: slugifyFunnelTitle(draft.productName) })}
                          title="Generate new slug"
                          className="rounded-lg bg-slate-100 p-2 text-xs hover:bg-slate-200"
                        >
                          🔄
                        </button>
                      </div>
                    </div>

                    <div>
                      <label className="block text-xs font-bold text-slate-700 mb-1">
                        {t("ads.funStockLabel")}
                      </label>
                      <input
                        type="number"
                        min={2}
                        max={20}
                        value={draft.urgencyStock}
                        onChange={(e) => setDraft({ ...draft, urgencyStock: Number(e.target.value) || 5 })}
                        className="w-full rounded-lg border border-slate-300 p-2 text-xs font-bold text-slate-800"
                      />
                    </div>
                  </div>

                  <div>
                    <label className="block text-xs font-bold text-slate-700 mb-1">
                      {t("ads.funCtaLabel")}
                    </label>
                    <input
                      type="text"
                      value={draft.ctaText}
                      onChange={(e) => setDraft({ ...draft, ctaText: e.target.value })}
                      className="w-full rounded-xl border border-slate-300 p-2.5 text-xs font-bold text-slate-900"
                    />
                  </div>

                  {/* Order Bump Toggle */}
                  <div className="rounded-xl border border-amber-200 bg-amber-50/60 p-3">
                    <label className="flex items-center gap-2 cursor-pointer">
                      <input
                        type="checkbox"
                        checked={draft.showBump}
                        onChange={(e) => setDraft({ ...draft, showBump: e.target.checked })}
                        className="h-4 w-4 rounded text-amber-600 focus:ring-amber-500"
                      />
                      <span className="text-xs font-bold text-amber-950">
                        {t("ads.funBumpLabel")}
                      </span>
                    </label>
                    <p className="mt-1 text-[11px] text-amber-800 pl-6">
                      {t("ads.funBumpHelp")}
                    </p>
                  </div>
                </div>
              )}

              {/* Tab 2: Benefits */}
              {activeTab === "benefits" && (
                <div className="space-y-3">
                  <div className="flex items-center justify-between">
                    <p className="text-xs font-bold text-slate-700">
                      {t("ads.funBenefitsTitle")}
                    </p>
                    <span className="text-[11px] text-slate-400">{t("ads.funBenefitsHint")}</span>
                  </div>

                  {draft.benefits.map((b, idx) => (
                    <div key={idx} className="rounded-xl border border-slate-200 p-3 bg-slate-50/50 space-y-2">
                      <div className="flex items-center gap-2">
                        <input
                          type="text"
                          value={b.icon}
                          onChange={(e) => {
                            const next = [...draft.benefits];
                            next[idx] = { ...next[idx], icon: e.target.value };
                            setDraft({ ...draft, benefits: next });
                          }}
                          className="w-10 rounded border border-slate-300 p-1.5 text-center text-sm"
                        />
                        <input
                          type="text"
                          value={b.title}
                          placeholder={t("ads.funBenefitTitlePh")}
                          onChange={(e) => {
                            const next = [...draft.benefits];
                            next[idx] = { ...next[idx], title: e.target.value };
                            setDraft({ ...draft, benefits: next });
                          }}
                          className="flex-1 rounded border border-slate-300 p-1.5 text-xs font-bold text-slate-800"
                        />
                      </div>
                      <textarea
                        rows={2}
                        value={b.text}
                        placeholder={t("ads.funBenefitTextPh")}
                        onChange={(e) => {
                          const next = [...draft.benefits];
                          next[idx] = { ...next[idx], text: e.target.value };
                          setDraft({ ...draft, benefits: next });
                        }}
                        className="w-full rounded border border-slate-300 p-1.5 text-xs text-slate-700"
                      />
                    </div>
                  ))}
                </div>
              )}

              {/* Tab 3: BD COD Trust */}
              {activeTab === "trust" && (
                <div className="space-y-4">
                  <div className="rounded-xl bg-blue-50 border border-blue-200 p-3 text-xs text-blue-900">
                    💡 <strong>{t("ads.funTrustNoteLead")}</strong> {t("ads.funTrustNoteBody")}
                  </div>

                  <div>
                    <label className="block text-xs font-bold text-slate-700 mb-1">
                      {t("ads.funCodLabel")}
                    </label>
                    <textarea
                      rows={2}
                      value={draft.trust.codText}
                      onChange={(e) =>
                        setDraft({
                          ...draft,
                          trust: { ...draft.trust, codText: e.target.value },
                        })
                      }
                      className="w-full rounded-xl border border-slate-300 p-2 text-xs font-semibold text-slate-800"
                    />
                  </div>

                  <div>
                    <label className="block text-xs font-bold text-slate-700 mb-1">
                      {t("ads.funDeliveryLabel")}
                    </label>
                    <textarea
                      rows={2}
                      value={draft.trust.deliveryText}
                      onChange={(e) =>
                        setDraft({
                          ...draft,
                          trust: { ...draft.trust, deliveryText: e.target.value },
                        })
                      }
                      className="w-full rounded-xl border border-slate-300 p-2 text-xs font-semibold text-slate-800"
                    />
                  </div>

                  <div>
                    <label className="block text-xs font-bold text-slate-700 mb-1">
                      {t("ads.funReturnLabel")}
                    </label>
                    <textarea
                      rows={2}
                      value={draft.trust.returnText}
                      onChange={(e) =>
                        setDraft({
                          ...draft,
                          trust: { ...draft.trust, returnText: e.target.value },
                        })
                      }
                      className="w-full rounded-xl border border-slate-300 p-2 text-xs font-semibold text-slate-800"
                    />
                  </div>
                </div>
              )}

              {/* Tab 4: FAQ */}
              {activeTab === "faq" && (
                <div className="space-y-3">
                  <div className="flex items-center justify-between">
                    <p className="text-xs font-bold text-slate-700">
                      {t("ads.funFaqTitle")}
                    </p>
                    <button
                      type="button"
                      onClick={() =>
                        setDraft({
                          ...draft,
                          faqs: [...draft.faqs, { q: t("ads.funFaqNewQ"), a: t("ads.funFaqNewA") }],
                        })
                      }
                      className="rounded bg-slate-100 px-2 py-1 text-xs font-bold text-slate-700 hover:bg-slate-200"
                    >
                      {t("ads.funFaqNew")}
                    </button>
                  </div>

                  {draft.faqs.map((f, idx) => (
                    <div key={idx} className="rounded-xl border border-slate-200 p-3 bg-slate-50/50 space-y-2">
                      <div className="flex items-center justify-between gap-2">
                        <input
                          type="text"
                          value={f.q}
                          placeholder={t("ads.funFaqQPh")}
                          onChange={(e) => {
                            const next = [...draft.faqs];
                            next[idx] = { ...next[idx], q: e.target.value };
                            setDraft({ ...draft, faqs: next });
                          }}
                          className="flex-1 rounded border border-slate-300 p-1.5 text-xs font-bold text-slate-800"
                        />
                        <button
                          type="button"
                          onClick={() => {
                            const next = draft.faqs.filter((_, i) => i !== idx);
                            setDraft({ ...draft, faqs: next });
                          }}
                          className="text-xs text-rose-500 hover:text-rose-700"
                        >
                          ✕
                        </button>
                      </div>
                      <textarea
                        rows={2}
                        value={f.a}
                        placeholder={t("ads.funFaqAPh")}
                        onChange={(e) => {
                          const next = [...draft.faqs];
                          next[idx] = { ...next[idx], a: e.target.value };
                          setDraft({ ...draft, faqs: next });
                        }}
                        className="w-full rounded border border-slate-300 p-1.5 text-xs text-slate-700"
                      />
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>

          {/* Right Preview Column (5 cols) */}
          <div className="lg:col-span-5 flex flex-col items-center">
            {/* Device Toggle */}
            <div className="flex items-center gap-2 mb-3 bg-slate-100 p-1 rounded-xl">
              <button
                type="button"
                onClick={() => setPreviewDevice("mobile")}
                className={`rounded-lg px-3 py-1 text-xs font-bold transition ${
                  previewDevice === "mobile" ? "bg-white text-slate-900 shadow-xs" : "text-slate-500"
                }`}
              >
                {t("ads.funMobileView")}
              </button>
              <button
                type="button"
                onClick={() => setPreviewDevice("desktop")}
                className={`rounded-lg px-3 py-1 text-xs font-bold transition ${
                  previewDevice === "desktop" ? "bg-white text-slate-900 shadow-xs" : "text-slate-500"
                }`}
              >
                {t("ads.funDesktopView")}
              </button>
            </div>

            {/* Phone Mockup Frame */}
            <div
              className={`border-4 border-slate-800 rounded-[36px] bg-slate-900 p-2 shadow-2xl transition-all duration-300 ${
                previewDevice === "mobile" ? "w-[360px]" : "w-full max-w-md"
              }`}
            >
              {/* Phone Camera Notch */}
              <div className="h-4 w-full flex justify-center items-center mb-1">
                <div className="h-3 w-20 bg-slate-800 rounded-full" />
              </div>

              {/* Screen Content */}
              <div className="rounded-[26px] bg-white overflow-hidden max-h-[640px] overflow-y-auto scrollbar-thin text-slate-900 relative">
                {/* Live Top Urgency Ticker */}
                <div className="bg-slate-900 text-white text-[10px] text-center py-1.5 font-bold px-2">
                  {t("misc.zzFunnelCodTicker")}
                </div>

                {/* Urgency Stock Bar */}
                <div className="p-3 bg-amber-50 border-b border-amber-200">
                  <div className="flex items-center justify-between text-[11px] font-bold text-amber-950">
                    <span className="flex items-center gap-1">
                      <span className="animate-pulse">🔥</span> {t("misc.zzFunnelStockLimited")}
                    </span>
                    <span className="text-rose-600 font-mono">{t("misc.zzFunnelTimeLeft")}</span>
                  </div>
                  <div className="mt-1.5 h-1.5 w-full bg-amber-200 rounded-full overflow-hidden">
                    <div className="h-full bg-gradient-to-r from-amber-500 to-rose-500 w-3/4 rounded-full" />
                  </div>
                  <p className="mt-1 text-[10px] text-amber-800 font-semibold text-center">
                    {t("misc.zzFunnelStockLeft", { stock: fmtNumber(locale, draft.urgencyStock) })}
                  </p>
                </div>

                {/* Product Image & Badge */}
                <div className="relative bg-slate-100 p-4 flex justify-center">
                  {draft.imageUrl ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img
                      src={draft.imageUrl}
                      alt={draft.productName}
                      className="h-48 w-full object-contain rounded-xl"
                    />
                  ) : (
                    <div className="flex h-44 w-full items-center justify-center rounded-xl bg-slate-200 text-3xl">
                      🛍️
                    </div>
                  )}
                  {savingsPct > 0 && (
                    <span className="absolute top-2 right-2 rounded-lg bg-rose-600 px-2.5 py-1 text-[11px] font-black text-white shadow-sm">
                      {t("ads.funSavings", { pct: fmtNumber(locale, savingsPct) })}
                    </span>
                  )}
                </div>

                {/* Headline & Price */}
                <div className="p-4 space-y-2 border-b border-slate-100">
                  <h2 className="text-sm font-black text-slate-900 leading-snug">{draft.headline}</h2>
                  <div className="flex items-baseline gap-2">
                    <span className="text-xl font-black text-rose-600">
                      {formatMinorTaka(draft.priceMinor)}
                    </span>
                    {draft.compareAtMinor && (
                      <span className="text-xs text-slate-400 line-through">
                        {formatMinorTaka(draft.compareAtMinor)}
                      </span>
                    )}
                  </div>
                </div>

                {/* Bundle Offer Simulator */}
                <div className="p-3 bg-slate-50 border-b border-slate-100 space-y-2">
                  <p className="text-[11px] font-black text-slate-700">{t("misc.zzFunnelPackageTitle")}</p>
                  <div className="border-2 border-amber-500 rounded-xl bg-white p-2 text-xs flex justify-between items-center shadow-xs">
                    <div>
                      <p className="font-bold text-slate-900">{t("misc.zzFunnelBundle1Title")}</p>
                      <p className="text-[10px] text-slate-500">{t("misc.zzFunnelBundleCod")}</p>
                    </div>
                    <span className="font-black text-slate-900">{formatMinorTaka(draft.priceMinor)}</span>
                  </div>
                  <div className="border border-slate-200 rounded-xl bg-white p-2 text-xs flex justify-between items-center opacity-85">
                    <div>
                      <p className="font-bold text-slate-900">{t("misc.zzFunnelBundle2Title")}</p>
                      <p className="text-[10px] text-emerald-600 font-semibold">{t("misc.zzFunnelBundle2Sub")}</p>
                    </div>
                    <span className="font-black text-emerald-700">
                      {formatMinorTaka(draft.priceMinor * 2 - 20000)}
                    </span>
                  </div>
                </div>

                {/* Benefits List */}
                <div className="p-3 space-y-2">
                  <p className="text-[11px] font-black text-slate-700">{t("misc.zzFunnelBenefitsTitle")}</p>
                  <div className="grid grid-cols-1 gap-1.5">
                    {draft.benefits.slice(0, 4).map((b, i) => (
                      <div key={i} className="flex items-start gap-2 rounded-lg bg-slate-50 p-2 text-left">
                        <span className="text-sm">{b.icon}</span>
                        <div>
                          <p className="text-[11px] font-bold text-slate-900">{b.title}</p>
                          <p className="text-[10px] text-slate-500">{b.text}</p>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>

                {/* Trust COD Badges */}
                <div className="p-3 bg-emerald-50/60 border-y border-emerald-100 space-y-1.5">
                  <div className="flex items-center gap-1.5 text-[11px] font-bold text-emerald-950">
                    <span>🛡️</span> {draft.trust.codText}
                  </div>
                  <div className="flex items-center gap-1.5 text-[10px] text-emerald-800">
                    <span>🚚</span> {draft.trust.deliveryText}
                  </div>
                  <div className="flex items-center gap-1.5 text-[10px] text-emerald-800">
                    <span>🔄</span> {draft.trust.returnText}
                  </div>
                </div>

                {/* Simulated Order Form */}
                <div className="p-3 space-y-2 bg-slate-50">
                  <p className="text-[11px] font-black text-slate-800 text-center">
                    {t("misc.zzFunnelOrderFormTitle")}
                  </p>
                  <input
                    type="text"
                    disabled
                    placeholder={t("misc.zzFunnelNamePlaceholder")}
                    className="w-full rounded-lg border border-slate-300 p-1.5 text-[11px] bg-white"
                  />
                  <input
                    type="text"
                    disabled
                    placeholder={t("misc.zzFunnelPhonePlaceholder")}
                    className="w-full rounded-lg border border-slate-300 p-1.5 text-[11px] bg-white"
                  />
                  <input
                    type="text"
                    disabled
                    placeholder={t("misc.zzFunnelAddressPlaceholder")}
                    className="w-full rounded-lg border border-slate-300 p-1.5 text-[11px] bg-white"
                  />
                </div>

                {/* Floating Bottom CTA */}
                <div className="sticky bottom-0 bg-white/95 backdrop-blur-xs p-2.5 border-t border-slate-200">
                  <div className="w-full rounded-xl bg-gradient-to-r from-emerald-600 to-teal-600 py-2.5 text-center text-xs font-black text-white shadow-md">
                    {draft.ctaText}
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Existing Funnels List */}
      <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-xs">
        <div className="flex items-center justify-between mb-4">
          <div>
            <h3 className="text-base font-black text-slate-900">{t("ads.funListTitle")}</h3>
            <p className="text-xs text-slate-500">{t("ads.funListIntro")}</p>
          </div>
          <Link
            href="/dashboard/commerce/landings"
            className="text-xs font-bold text-amber-600 hover:underline"
          >
            {t("ads.funListLink")}
          </Link>
        </div>

        {recentLandings.length === 0 ? (
          <p className="text-xs text-slate-400 py-4 text-center">
            {t("ads.funListEmpty")}
          </p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs">
              <thead className="border-b border-slate-200 bg-slate-50 text-slate-600 font-bold">
                <tr>
                  <th className="py-2.5 px-3">{t("ads.funColTitle")}</th>
                  <th className="py-2.5 px-3">{t("ads.funColStatus")}</th>
                  <th className="py-2.5 px-3">{t("ads.funColOrders")}</th>
                  <th className="py-2.5 px-3">{t("ads.funColRevenue")}</th>
                  <th className="py-2.5 px-3 text-right">{t("ads.funColAction")}</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {recentLandings.slice(0, 5).map((l) => (
                  <tr key={l.id} className="hover:bg-slate-50/60">
                    <td className="py-3 px-3">
                      <p className="font-bold text-slate-900">{l.title}</p>
                      <p className="font-mono text-[11px] text-slate-400">/l/{l.slug}</p>
                    </td>
                    <td className="py-3 px-3">
                      <span
                        className={`rounded-full px-2 py-0.5 text-[10px] font-bold ${
                          l.status === "published"
                            ? "bg-emerald-100 text-emerald-800"
                            : "bg-slate-100 text-slate-600"
                        }`}
                      >
                        {l.status === "published" ? t("ads.funLive") : l.status}
                      </span>
                    </td>
                    <td className="py-3 px-3 font-bold text-slate-800">
                      {t("ads.funOrderCount", { count: fmtNumber(locale, l.orderCount ?? 0) })}
                    </td>
                    <td className="py-3 px-3 font-bold text-emerald-700">
                      {formatMinorTaka(l.revenueMinor || "0")}
                    </td>
                    <td className="py-3 px-3 text-right space-x-2">
                      <button
                        type="button"
                        onClick={() => copyPublicLink(l.slug)}
                        className="rounded bg-slate-100 px-2.5 py-1 text-[11px] font-bold text-slate-700 hover:bg-slate-200"
                      >
                        {t("ads.funCopy")}
                      </button>
                      <a
                        href={`/l/${l.slug}`}
                        target="_blank"
                        rel="noreferrer"
                        className="rounded bg-amber-500 px-2.5 py-1 text-[11px] font-bold text-white hover:bg-amber-600"
                      >
                        {t("ads.funVisit")}
                      </a>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
