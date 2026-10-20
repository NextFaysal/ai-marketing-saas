"use client";
import React, { useEffect, useState, useMemo } from "react";
import Link from "next/link";
import { apiFetch } from "@/lib/api";
import { getOrganizationId } from "@/lib/org";
import { takaToMinorString } from "@/lib/storefront-money";
import { fmtMoney, fmtMoneyMinor, fmtNumber } from "@repo/contracts";
import { useLocale } from "@/lib/i18n/provider";
import {
  generateInfluencerTrackingUrl,
  calculateInfluencerRoi,
  getPlatformMeta,
  SOCIAL_PLATFORMS,
  SocialPlatform,
  simulateInfluencerCampaign,
  platformLabelFor,
  buildInfluencerWhatsAppBriefing,
  buildInfluencerWhatsAppUrl,
  buildPayoutReceiptText,
  CampaignSimulationParams,
} from "@/lib/influencer-campaign";

interface PartnerAggregates {
  entries: {
    total: number;
    pending: { count: number; commissionMinor: string };
    approved: { count: number; commissionMinor: string };
    paid: { count: number; commissionMinor: string };
    voided: { count: number; commissionMinor: string };
  };
  payoutsTotalMinor: string;
  payoutsCount: number;
}

interface CreatorPartner {
  id: string;
  name: string;
  phone: string;
  email: string | null;
  code: string;
  commissionPercent: number;
  status: string;
  note: string | null;
  aggregates?: PartnerAggregates;
}

type TabType = "creators" | "simulator" | "analytics";

function calculatePartnerOutstandingMinor(p: CreatorPartner): string {
  if (!p.aggregates) return "0";
  const approved = BigInt(p.aggregates.entries.approved.commissionMinor || "0");
  const paid = BigInt(p.aggregates.entries.paid.commissionMinor || "0");
  const payouts = BigInt(p.aggregates.payoutsTotalMinor || "0");
  const unapplied = payouts - paid > 0n ? payouts - paid : 0n;
  const out = approved - unapplied;
  return (out > 0n ? out : 0n).toString();
}

function extractPlatformFromNote(note?: string | null): SocialPlatform {
  if (!note) return "instagram";
  if (note.includes("[Platform: youtube]")) return "youtube";
  if (note.includes("[Platform: tiktok]")) return "tiktok";
  if (note.includes("[Platform: facebook]")) return "facebook";
  if (note.includes("[Platform: other]")) return "other";
  return "instagram";
}

export default function InfluencerMarketingPage() {
  const { t, locale } = useLocale();
  const [activeTab, setActiveTab] = useState<TabType>("creators");
  const [creators, setCreators] = useState<CreatorPartner[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [copiedCode, setCopiedCode] = useState<string | null>(null);

  // Store domain & brand info
  const [storeDomain, setStoreDomain] = useState("https://yourstore.com");
  const [brandName, setBrandName] = useState("আমাদের শপ");

  // Filter & Search
  const [searchQuery, setSearchQuery] = useState("");
  const [platformFilter, setPlatformFilter] = useState<string>("all");

  // Create Modal
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [submittingCreate, setSubmittingCreate] = useState(false);
  const [formData, setFormData] = useState({
    name: "",
    phone: "",
    email: "",
    code: "",
    commissionPercent: 10,
    platform: "tiktok" as SocialPlatform,
    note: "",
  });

  // 1-Click WhatsApp Briefing Modal
  const [briefingCreator, setBriefingCreator] = useState<CreatorPartner | null>(null);
  const [customBriefingNote, setCustomBriefingNote] = useState("");

  // In-Dashboard Commission Payout Modal
  const [payoutCreator, setPayoutCreator] = useState<CreatorPartner | null>(null);
  const [payoutAmountTaka, setPayoutAmountTaka] = useState("");
  const [payoutMethod, setPayoutMethod] = useState("bkash");
  const [payoutRef, setPayoutRef] = useState("");
  const [payoutNote, setPayoutNote] = useState("");
  const [submittingPayout, setSubmittingPayout] = useState(false);
  const [recordedVoucher, setRecordedVoucher] = useState<{ text: string; phone: string } | null>(null);

  // ROI Simulator State
  const [simParams, setSimParams] = useState<CampaignSimulationParams>({
    fixedFeeBdt: 8000,
    commissionPercent: 10,
    estimatedViews: 80000,
    engagementRatePercent: 2.5,
    conversionRatePercent: 2.0,
    averageOrderValueBdt: 1500,
  });

  const loadCreators = async () => {
    const orgId = getOrganizationId();
    if (!orgId) return;
    setLoading(true);
    setError("");
    try {
      const [partnersData, orgData] = await Promise.all([
        apiFetch<CreatorPartner[]>(`/organizations/${orgId}/affiliates/partners`).catch(() => []),
        apiFetch<{ name?: string; slug: string; customDomain?: string | null }>(`/organizations/${orgId}`).catch(() => null),
      ]);
      setCreators(Array.isArray(partnersData) ? partnersData : []);

      if (orgData) {
        if (orgData.name) {
          setBrandName(orgData.name);
        }
        if (orgData.customDomain) {
          setStoreDomain(`https://${orgData.customDomain}`);
        } else if (orgData.slug) {
          const origin = typeof window !== "undefined" ? window.location.origin : "https://app.nextcommerce.com";
          setStoreDomain(`${origin}/shop/${orgData.slug}`);
        }
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : t("social.infLoadFailed"));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadCreators();
  }, []);

  const handleCreateCreator = async (e: React.FormEvent) => {
    e.preventDefault();
    const orgId = getOrganizationId();
    if (!orgId) return;
    setSubmittingCreate(true);
    setError("");
    setNotice("");
    try {
      const noteWithPlatform = `[Platform: ${formData.platform}] ${formData.note}`.trim();
      await apiFetch(`/organizations/${orgId}/affiliates/partners`, {
        method: "POST",
        body: JSON.stringify({
          name: formData.name.trim(),
          phone: formData.phone.trim(),
          email: formData.email.trim() ? formData.email.trim() : null,
          code: formData.code.trim().toUpperCase(),
          commissionPercent: Number(formData.commissionPercent),
          note: noteWithPlatform,
        }),
      });
      setNotice(t("social.infCreated", { name: formData.name }));
      setShowCreateModal(false);
      setFormData({
        name: "",
        phone: "",
        email: "",
        code: "",
        commissionPercent: 10,
        platform: "tiktok",
        note: "",
      });
      await loadCreators();
    } catch (e) {
      setError(e instanceof Error ? e.message : t("social.infCreateFailed"));
    } finally {
      setSubmittingCreate(false);
    }
  };

  const handleRecordPayout = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!payoutCreator) return;
    const orgId = getOrganizationId();
    if (!orgId) return;

    const minor = takaToMinorString(payoutAmountTaka);
    if (!minor || BigInt(minor) <= 0n) {
      setError(t("social.infPayoutInvalid"));
      return;
    }

    setSubmittingPayout(true);
    setError("");
    try {
      await apiFetch(`/organizations/${orgId}/affiliates/partners/${payoutCreator.id}/payouts`, {
        method: "POST",
        body: JSON.stringify({
          amountMinor: minor,
          method: payoutMethod,
          reference: payoutRef.trim() || undefined,
          note: payoutNote.trim() || undefined,
        }),
      });

      const receipt = buildPayoutReceiptText({
        creatorName: payoutCreator.name,
        brandName,
        amountBdt: payoutAmountTaka,
        method: payoutMethod,
        reference: payoutRef.trim() || null,
      }, locale);

      setRecordedVoucher({
        text: receipt,
        phone: payoutCreator.phone,
      });

      setNotice(t("social.infPayoutSaved", { name: payoutCreator.name, amount: fmtNumber(locale, Number(payoutAmountTaka) || 0) }));
      await loadCreators();
    } catch (e) {
      setError(e instanceof Error ? e.message : t("social.infPayoutFailed"));
    } finally {
      setSubmittingPayout(false);
    }
  };

  const copyToClipboard = (text: string, id: string) => {
    navigator.clipboard?.writeText(text);
    setCopiedCode(id);
    setTimeout(() => setCopiedCode(null), 2500);
  };

  // Aggregated Stats
  const stats = useMemo(() => {
    let totalOrders = 0;
    let totalRevenueMinor = 0n;
    let totalCommissionMinor = 0n;
    let totalPaidMinor = 0n;

    for (const c of creators) {
      const agg = c.aggregates?.entries;
      if (agg) {
        totalOrders += agg.total;
        const appComm = BigInt(agg.approved.commissionMinor || 0);
        const paidComm = BigInt(agg.paid.commissionMinor || 0);
        totalCommissionMinor += appComm + paidComm;
        totalPaidMinor += BigInt(c.aggregates?.payoutsTotalMinor || 0);

        if (c.commissionPercent > 0) {
          const rev = ((appComm + paidComm) * 100n) / BigInt(c.commissionPercent);
          totalRevenueMinor += rev;
        }
      }
    }

    const roi = calculateInfluencerRoi(totalRevenueMinor, totalCommissionMinor, totalOrders);

    return {
      creatorsCount: creators.length,
      totalOrders,
      totalRevenueFormatted: fmtMoneyMinor(locale, totalRevenueMinor),
      totalCommissionFormatted: fmtMoneyMinor(locale, totalCommissionMinor),
      totalPaidFormatted: fmtMoneyMinor(locale, totalPaidMinor),
      roiMultiplier: roi.roiMultiplier,
    };
  }, [creators, locale]);

  // Filtered Creators
  const filteredCreators = useMemo(() => {
    return creators.filter((c) => {
      const q = searchQuery.toLowerCase().trim();
      const matchQuery =
        !q ||
        c.name.toLowerCase().includes(q) ||
        c.code.toLowerCase().includes(q) ||
        c.phone.includes(q);

      const creatorPlatform = extractPlatformFromNote(c.note);
      const matchPlatform = platformFilter === "all" || creatorPlatform === platformFilter;

      return matchQuery && matchPlatform;
    });
  }, [creators, searchQuery, platformFilter]);

  // Platform Analytics Breakdown
  const platformBreakdown = useMemo(() => {
    const map: Record<
      SocialPlatform,
      { count: number; orders: number; revenueMinor: bigint; commissionMinor: bigint }
    > = {
      tiktok: { count: 0, orders: 0, revenueMinor: 0n, commissionMinor: 0n },
      instagram: { count: 0, orders: 0, revenueMinor: 0n, commissionMinor: 0n },
      youtube: { count: 0, orders: 0, revenueMinor: 0n, commissionMinor: 0n },
      facebook: { count: 0, orders: 0, revenueMinor: 0n, commissionMinor: 0n },
      other: { count: 0, orders: 0, revenueMinor: 0n, commissionMinor: 0n },
    };

    for (const c of creators) {
      const p = extractPlatformFromNote(c.note);
      const agg = c.aggregates?.entries;
      const orders = agg?.total ?? 0;
      const commMinor =
        BigInt(agg?.approved.commissionMinor || 0) + BigInt(agg?.paid.commissionMinor || 0);
      const revMinor =
        c.commissionPercent > 0 ? (commMinor * 100n) / BigInt(c.commissionPercent) : 0n;

      if (map[p]) {
        map[p].count += 1;
        map[p].orders += orders;
        map[p].commissionMinor += commMinor;
        map[p].revenueMinor += revMinor;
      }
    }

    return map;
  }, [creators]);

  // Leaderboard Top Creators
  const topCreators = useMemo(() => {
    return [...creators]
      .map((c) => {
        const agg = c.aggregates?.entries;
        const totalOrders = agg?.total ?? 0;
        const commMinor =
          BigInt(agg?.approved.commissionMinor || 0) + BigInt(agg?.paid.commissionMinor || 0);
        const revMinor =
          c.commissionPercent > 0 ? (commMinor * 100n) / BigInt(c.commissionPercent) : 0n;
        const roi = calculateInfluencerRoi(revMinor, commMinor, totalOrders);
        return {
          ...c,
          totalOrders,
          revMinor,
          commMinor,
          roiMultiplier: roi.roiMultiplier,
        };
      })
      .sort((a, b) => (b.revMinor > a.revMinor ? 1 : -1));
  }, [creators]);

  // Simulator Computed Results
  const simulationResult = useMemo(() => {
    return simulateInfluencerCampaign(simParams);
  }, [simParams]);

  const applyPreset = (preset: "tiktok" | "instagram" | "youtube" | "micro") => {
    if (preset === "tiktok") {
      setSimParams({
        fixedFeeBdt: 8000,
        commissionPercent: 10,
        estimatedViews: 100000,
        engagementRatePercent: 2.5,
        conversionRatePercent: 2.0,
        averageOrderValueBdt: 1400,
      });
    } else if (preset === "instagram") {
      setSimParams({
        fixedFeeBdt: 5000,
        commissionPercent: 10,
        estimatedViews: 45000,
        engagementRatePercent: 3.5,
        conversionRatePercent: 2.2,
        averageOrderValueBdt: 1600,
      });
    } else if (preset === "youtube") {
      setSimParams({
        fixedFeeBdt: 15000,
        commissionPercent: 12,
        estimatedViews: 80000,
        engagementRatePercent: 4.0,
        conversionRatePercent: 2.8,
        averageOrderValueBdt: 2200,
      });
    } else {
      setSimParams({
        fixedFeeBdt: 2500,
        commissionPercent: 8,
        estimatedViews: 20000,
        engagementRatePercent: 2.0,
        conversionRatePercent: 1.8,
        averageOrderValueBdt: 1200,
      });
    }
  };

  return (
    <div className="space-y-6">
      {/* Top Banner */}
      <div className="rounded-2xl border border-amber-200 bg-gradient-to-r from-amber-50 via-orange-50 to-pink-50 p-6 shadow-sm">
        <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
          <div className="space-y-1">
            <div className="flex items-center gap-2.5">
              <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-amber-500 text-xl text-white shadow-sm">
                🌟
              </span>
              <h1 className="text-xl font-bold text-slate-900">
                {t("social.infTitle")}
              </h1>
            </div>
            <p className="text-xs text-slate-600 max-w-2xl">
              {t("social.infSub")}
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              onClick={() => setShowCreateModal(true)}
              className="flex items-center gap-2 rounded-xl bg-gradient-to-r from-amber-600 to-orange-600 px-4 py-2.5 text-xs font-semibold text-white shadow hover:opacity-95 transition"
            >
              <span>➕</span>
              <span>{t("social.infAddNew")}</span>
            </button>
          </div>
        </div>

        {/* Navigation Tabs */}
        <div className="mt-6 flex flex-wrap gap-2 border-t border-amber-200/60 pt-4 text-xs font-medium">
          <button
            type="button"
            onClick={() => setActiveTab("creators")}
            className={`flex items-center gap-2 rounded-lg px-3.5 py-2 transition ${
              activeTab === "creators"
                ? "bg-amber-600 text-white font-semibold shadow-sm"
                : "bg-white/80 text-slate-700 hover:bg-white"
            }`}
          >
            <span>👥</span>
            <span>{t("social.infTabCreators", { count: fmtNumber(locale, creators.length) })}</span>
          </button>

          <button
            type="button"
            onClick={() => setActiveTab("simulator")}
            className={`flex items-center gap-2 rounded-lg px-3.5 py-2 transition ${
              activeTab === "simulator"
                ? "bg-amber-600 text-white font-semibold shadow-sm"
                : "bg-white/80 text-slate-700 hover:bg-white"
            }`}
          >
            <span>🧮</span>
            <span>{t("social.infTabSimulator")}</span>
          </button>

          <button
            type="button"
            onClick={() => setActiveTab("analytics")}
            className={`flex items-center gap-2 rounded-lg px-3.5 py-2 transition ${
              activeTab === "analytics"
                ? "bg-amber-600 text-white font-semibold shadow-sm"
                : "bg-white/80 text-slate-700 hover:bg-white"
            }`}
          >
            <span>📊</span>
            <span>{t("social.infTabAnalytics")}</span>
          </button>
        </div>
      </div>

      {/* Metrics Row */}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <div className="card p-4 space-y-1">
          <div className="text-[11px] font-semibold uppercase text-slate-400">{t("social.infKpiCreators")}</div>
          <div className="text-2xl font-bold text-slate-900">{t("social.infCountPeople", { count: fmtNumber(locale, stats.creatorsCount) })}</div>
          <div className="text-[11px] text-slate-500">TikTok, Insta, FB & YT</div>
        </div>

        <div className="card p-4 space-y-1">
          <div className="text-[11px] font-semibold uppercase text-slate-400">{t("social.infKpiOrders")}</div>
          <div className="text-2xl font-bold text-indigo-600">{t("social.infCountItems", { count: fmtNumber(locale, stats.totalOrders) })}</div>
          <div className="text-[11px] text-slate-500">{t("social.infKpiOrdersSub")}</div>
        </div>

        <div className="card p-4 space-y-1">
          <div className="text-[11px] font-semibold uppercase text-slate-400">{t("social.infKpiRevenue")}</div>
          <div className="text-2xl font-bold text-emerald-600">{stats.totalRevenueFormatted}</div>
          <div className="text-[11px] text-slate-500">{t("social.infKpiRevenueSub")}</div>
        </div>

        <div className="card p-4 space-y-1">
          <div className="text-[11px] font-semibold uppercase text-slate-400">{t("social.infKpiRoi")}</div>
          <div className="text-2xl font-bold text-amber-600">
            {stats.roiMultiplier ? `${stats.roiMultiplier}x` : "—"}
          </div>
          <div className="text-[11px] text-slate-500">{t("social.infKpiRoiSub")}</div>
        </div>
      </div>

      {/* Alerts */}
      {error && (
        <div className="rounded-xl border border-red-200 bg-red-50 p-4 text-xs text-red-700 flex items-center justify-between">
          <span>⚠️ {error}</span>
          <button type="button" onClick={() => setError("")} className="font-bold text-red-500">✕</button>
        </div>
      )}

      {notice && (
        <div className="rounded-xl border border-emerald-200 bg-emerald-50 p-4 text-xs text-emerald-800 flex items-center justify-between">
          <span>{notice}</span>
          <button type="button" onClick={() => setNotice("")} className="font-bold text-emerald-600">✕</button>
        </div>
      )}

      {/* TAB 1: CREATORS LIST */}
      {activeTab === "creators" && (
        <div className="space-y-4">
          {/* Search & Platform Filter Bar */}
          <div className="card p-3 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <div className="flex flex-1 items-center gap-2">
              <span className="text-slate-400 text-sm">🔍</span>
              <input
                type="text"
                placeholder={t("social.infSearchPlaceholder")}
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="w-full text-xs bg-transparent focus:outline-none"
              />
              {searchQuery && (
                <button
                  type="button"
                  onClick={() => setSearchQuery("")}
                  className="text-xs text-slate-400 hover:text-slate-600"
                >
                  ✕
                </button>
              )}
            </div>

            <div className="flex items-center gap-2 border-t sm:border-t-0 sm:border-l border-slate-200 pt-2 sm:pt-0 sm:pl-3">
              <span className="text-[11px] font-semibold text-slate-500">{t("social.infPlatformLabel")}</span>
              <select
                value={platformFilter}
                onChange={(e) => setPlatformFilter(e.target.value)}
                className="rounded-lg border border-slate-200 bg-white px-2.5 py-1 text-xs text-slate-700 focus:outline-none"
              >
                <option value="all">{t("social.infAllPlatforms")}</option>
                {SOCIAL_PLATFORMS.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.icon} {locale === "en" ? p.labelEn : p.label}
                  </option>
                ))}
              </select>
            </div>
          </div>

          {/* Creators List Display */}
          {loading ? (
            <div className="card p-12 text-center text-xs text-slate-500">
              <div className="inline-block h-6 w-6 animate-spin rounded-full border-2 border-amber-600 border-t-transparent mb-2" />
              <p>{t("social.infLoading")}</p>
            </div>
          ) : filteredCreators.length === 0 ? (
            <div className="card p-12 text-center space-y-3">
              <div className="text-4xl">🌟</div>
              <h3 className="font-bold text-slate-800">{t("social.infEmptyTitle")}</h3>
              <p className="max-w-md mx-auto text-xs text-slate-500">
                {searchQuery || platformFilter !== "all"
                  ? t("social.infEmptyFiltered")
                  : t("social.infEmptyFresh")}
              </p>
              <button
                type="button"
                onClick={() => setShowCreateModal(true)}
                className="rounded-lg bg-amber-600 px-4 py-2 text-xs font-semibold text-white shadow hover:bg-amber-700 transition"
              >
                {t("social.infAddFirst")}
              </button>
            </div>
          ) : (
            <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
              {filteredCreators.map((c) => {
                const agg = c.aggregates?.entries;
                const totalOrders = agg?.total ?? 0;
                const approvedMinor = BigInt(agg?.approved.commissionMinor || 0);
                const paidMinor = BigInt(agg?.paid.commissionMinor || 0);
                const earnedMinor = approvedMinor + paidMinor;
                const outstandingMinor = calculatePartnerOutstandingMinor(c);

                // Revenue calculation
                let revMinor = 0n;
                if (c.commissionPercent > 0) {
                  revMinor = (earnedMinor * 100n) / BigInt(c.commissionPercent);
                }
                const roi = calculateInfluencerRoi(revMinor, earnedMinor, totalOrders);
                const platform = extractPlatformFromNote(c.note);
                const platformMeta = getPlatformMeta(platform);

                const trackingUrl = generateInfluencerTrackingUrl({
                  baseUrl: storeDomain,
                  code: c.code,
                  platform,
                  campaignName: c.name,
                });

                return (
                  <div
                    key={c.id}
                    className="card p-5 border border-slate-200 space-y-4 hover:shadow-md transition"
                  >
                    {/* Header */}
                    <div className="flex items-start justify-between gap-2">
                      <div className="space-y-1">
                        <div className="flex items-center gap-2">
                          <span className="flex items-center gap-1 rounded bg-slate-100 px-2 py-0.5 text-[11px] font-semibold text-slate-700">
                            {platformMeta.icon} {platformLabelFor(platform, locale)}
                          </span>
                          <span className="rounded-full bg-emerald-100 px-2 py-0.5 text-[10px] font-bold text-emerald-800">
                            {t("social.infCommissionBadge", { pct: fmtNumber(locale, c.commissionPercent) })}
                          </span>
                          <span className={`rounded-full px-2 py-0.5 text-[10px] font-bold uppercase ${
                            c.status === "active" ? "bg-emerald-50 text-emerald-700 border border-emerald-200" : "bg-slate-100 text-slate-600"
                          }`}>
                            {c.status}
                          </span>
                        </div>
                        <h3 className="font-bold text-slate-900 text-base">{c.name}</h3>
                        <p className="text-[11px] text-slate-500">{t("social.infPhonePrefix", { phone: c.phone })} {c.email ? `• ${c.email}` : ""}</p>
                      </div>

                      <div className="text-right">
                        <div className="text-[11px] font-semibold uppercase text-slate-400">{t("social.infCardRoi")}</div>
                        <div className={`text-lg font-bold ${roi.profitable ? "text-emerald-600" : "text-amber-600"}`}>
                          {roi.roiMultiplier ? `${roi.roiMultiplier}x` : "—"}
                        </div>
                      </div>
                    </div>

                    {/* Promo Code & Tracking Box */}
                    <div className="rounded-xl bg-slate-50 p-3 border border-slate-100 space-y-2.5 text-xs">
                      <div className="flex items-center justify-between">
                        <div className="flex items-center gap-2">
                          <span className="text-[10px] uppercase font-semibold text-slate-400">{t("social.infCouponCode")}</span>
                          <code className="rounded bg-amber-100 px-2 py-0.5 font-bold text-amber-900">
                            {c.code}
                          </code>
                        </div>
                        <button
                          type="button"
                          onClick={() => copyToClipboard(c.code, `code-${c.id}`)}
                          className="text-[11px] font-semibold text-indigo-600 hover:underline"
                        >
                          {copiedCode === `code-${c.id}` ? t("social.infCopiedBang") : t("social.infCopyCode")}
                        </button>
                      </div>

                      <div className="flex items-center justify-between pt-1 border-t border-slate-200/60">
                        <div className="truncate max-w-[240px] text-[11px] text-slate-500">
                          {trackingUrl}
                        </div>
                        <button
                          type="button"
                          onClick={() => copyToClipboard(trackingUrl, `url-${c.id}`)}
                          className="text-[11px] font-semibold text-amber-700 hover:underline shrink-0 ml-2"
                        >
                          {copiedCode === `url-${c.id}` ? t("social.infLinkCopiedBang") : t("social.infCopyTracking")}
                        </button>
                      </div>
                    </div>

                    {/* Performance Matrix */}
                    <div className="grid grid-cols-4 gap-2 text-center text-xs">
                      <div className="rounded-lg bg-slate-50 p-2 border border-slate-100">
                        <div className="text-[10px] text-slate-400 font-semibold uppercase">{t("social.infOrders")}</div>
                        <div className="font-bold text-slate-800">{t("social.infOrdersValue", { count: fmtNumber(locale, totalOrders) })}</div>
                      </div>
                      <div className="rounded-lg bg-slate-50 p-2 border border-slate-100">
                        <div className="text-[10px] text-slate-400 font-semibold uppercase">{t("social.infTotalSales")}</div>
                        <div className="font-bold text-emerald-600">{fmtMoneyMinor(locale, revMinor)}</div>
                      </div>
                      <div className="rounded-lg bg-slate-50 p-2 border border-slate-100">
                        <div className="text-[10px] text-slate-400 font-semibold uppercase">{t("social.infTotalCommission")}</div>
                        <div className="font-bold text-indigo-600">{fmtMoneyMinor(locale, earnedMinor)}</div>
                      </div>
                      <div className="rounded-lg bg-amber-50/70 p-2 border border-amber-100">
                        <div className="text-[10px] text-amber-700 font-semibold uppercase">{t("social.infOutstanding")}</div>
                        <div className="font-bold text-amber-900">{fmtMoneyMinor(locale, BigInt(outstandingMinor))}</div>
                      </div>
                    </div>

                    {/* Action Buttons */}
                    <div className="pt-2 flex flex-wrap items-center justify-between gap-2 border-t border-slate-100">
                      <div className="flex items-center gap-2">
                        <button
                          type="button"
                          onClick={() => {
                            setBriefingCreator(c);
                            setCustomBriefingNote("");
                          }}
                          className="flex items-center gap-1.5 rounded-lg bg-emerald-50 px-2.5 py-1.5 text-xs font-semibold text-emerald-800 border border-emerald-200 hover:bg-emerald-100 transition"
                        >
                          <span>💬</span>
                          <span>{t("social.infWaBriefing")}</span>
                        </button>

                        <button
                          type="button"
                          onClick={() => {
                            setPayoutCreator(c);
                            const outMinor = calculatePartnerOutstandingMinor(c);
                            const defTaka = outMinor !== "0" ? (BigInt(outMinor) / 100n).toString() : "";
                            setPayoutAmountTaka(defTaka);
                            setPayoutRef("");
                            setPayoutNote("");
                            setRecordedVoucher(null);
                          }}
                          className="flex items-center gap-1.5 rounded-lg bg-indigo-50 px-2.5 py-1.5 text-xs font-semibold text-indigo-800 border border-indigo-200 hover:bg-indigo-100 transition"
                        >
                          <span>💳</span>
                          <span>{t("social.infPayoutRecord")}</span>
                        </button>
                      </div>

                      <Link
                        href="/dashboard/commerce/affiliates"
                        className="text-[11px] font-medium text-slate-500 hover:text-slate-800 hover:underline"
                      >
                        {t("social.infLedgerHistory")}
                      </Link>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}

      {/* TAB 2: CAMPAIGN ROI SIMULATOR & CALCULATOR */}
      {activeTab === "simulator" && (
        <div className="space-y-6">
          <div className="card p-6 border border-amber-200 bg-gradient-to-br from-white via-amber-50/30 to-orange-50/20 space-y-6">
            <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between border-b border-slate-100 pb-4">
              <div>
                <h3 className="font-bold text-slate-900 text-base">
                  {t("social.infSimTitle")}
                </h3>
                <p className="text-xs text-slate-500">
                  {t("social.infSimSub")}
                </p>
              </div>

              {/* Presets */}
              <div className="flex flex-wrap items-center gap-1.5">
                <span className="text-[11px] font-semibold text-slate-400">{t("social.infPresetLabel")}</span>
                <button
                  type="button"
                  onClick={() => applyPreset("tiktok")}
                  className="rounded-lg bg-white px-2.5 py-1 text-[11px] font-semibold text-slate-700 border border-slate-200 hover:bg-slate-50"
                >
                  {t("social.infPresetTiktok")}
                </button>
                <button
                  type="button"
                  onClick={() => applyPreset("instagram")}
                  className="rounded-lg bg-white px-2.5 py-1 text-[11px] font-semibold text-slate-700 border border-slate-200 hover:bg-slate-50"
                >
                  {t("social.infPresetInsta")}
                </button>
                <button
                  type="button"
                  onClick={() => applyPreset("youtube")}
                  className="rounded-lg bg-white px-2.5 py-1 text-[11px] font-semibold text-slate-700 border border-slate-200 hover:bg-slate-50"
                >
                  {t("social.infPresetYoutube")}
                </button>
                <button
                  type="button"
                  onClick={() => applyPreset("micro")}
                  className="rounded-lg bg-white px-2.5 py-1 text-[11px] font-semibold text-slate-700 border border-slate-200 hover:bg-slate-50"
                >
                  {t("social.infPresetMicro")}
                </button>
              </div>
            </div>

            <div className="grid grid-cols-1 gap-6 lg:grid-cols-12">
              {/* Inputs Form */}
              <div className="space-y-4 lg:col-span-6 text-xs">
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="block font-semibold text-slate-700 mb-1">
                      {t("social.infFeeLabel")}
                    </label>
                    <input
                      type="number"
                      min={0}
                      step={500}
                      value={simParams.fixedFeeBdt}
                      onChange={(e) => setSimParams({ ...simParams, fixedFeeBdt: Number(e.target.value) })}
                      className="w-full rounded-lg border border-slate-300 p-2 focus:border-amber-500 focus:outline-none font-semibold"
                    />
                    <span className="text-[10px] text-slate-400">{t("social.infFeeHint")}</span>
                  </div>

                  <div>
                    <label className="block font-semibold text-slate-700 mb-1">
                      {t("social.infCommLabel")}
                    </label>
                    <input
                      type="number"
                      min={0}
                      max={50}
                      value={simParams.commissionPercent}
                      onChange={(e) => setSimParams({ ...simParams, commissionPercent: Number(e.target.value) })}
                      className="w-full rounded-lg border border-slate-300 p-2 focus:border-amber-500 focus:outline-none font-semibold"
                    />
                    <span className="text-[10px] text-slate-400">{t("social.infCommHint")}</span>
                  </div>
                </div>

                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="block font-semibold text-slate-700 mb-1">
                      {t("social.infViewsLabel")}
                    </label>
                    <input
                      type="number"
                      min={1000}
                      step={5000}
                      value={simParams.estimatedViews}
                      onChange={(e) => setSimParams({ ...simParams, estimatedViews: Number(e.target.value) })}
                      className="w-full rounded-lg border border-slate-300 p-2 focus:border-amber-500 focus:outline-none"
                    />
                    <span className="text-[10px] text-slate-400">{t("social.infViewsHint")}</span>
                  </div>

                  <div>
                    <label className="block font-semibold text-slate-700 mb-1">
                      {t("social.infEngLabel")}
                    </label>
                    <input
                      type="number"
                      min={0.1}
                      max={20}
                      step={0.1}
                      value={simParams.engagementRatePercent}
                      onChange={(e) => setSimParams({ ...simParams, engagementRatePercent: Number(e.target.value) })}
                      className="w-full rounded-lg border border-slate-300 p-2 focus:border-amber-500 focus:outline-none"
                    />
                    <span className="text-[10px] text-slate-400">{t("social.infEngHint")}</span>
                  </div>
                </div>

                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="block font-semibold text-slate-700 mb-1">
                      {t("social.infConvLabel")}
                    </label>
                    <input
                      type="number"
                      min={0.1}
                      max={20}
                      step={0.1}
                      value={simParams.conversionRatePercent}
                      onChange={(e) => setSimParams({ ...simParams, conversionRatePercent: Number(e.target.value) })}
                      className="w-full rounded-lg border border-slate-300 p-2 focus:border-amber-500 focus:outline-none"
                    />
                    <span className="text-[10px] text-slate-400">{t("social.infConvHint")}</span>
                  </div>

                  <div>
                    <label className="block font-semibold text-slate-700 mb-1">
                      {t("social.infAovLabel")}
                    </label>
                    <input
                      type="number"
                      min={100}
                      step={100}
                      value={simParams.averageOrderValueBdt}
                      onChange={(e) => setSimParams({ ...simParams, averageOrderValueBdt: Number(e.target.value) })}
                      className="w-full rounded-lg border border-slate-300 p-2 focus:border-amber-500 focus:outline-none"
                    />
                    <span className="text-[10px] text-slate-400">{t("social.infAovHint")}</span>
                  </div>
                </div>
              </div>

              {/* Simulation Results Dashboard */}
              <div className="space-y-4 lg:col-span-6 rounded-2xl bg-slate-900 p-5 text-white">
                <div className="flex items-center justify-between border-b border-slate-800 pb-3">
                  <div>
                    <div className="text-[11px] uppercase font-semibold text-slate-400">{t("social.infProjTitle")}</div>
                    <div className="text-xl font-bold text-amber-400">
                      {t("social.infProjRoas", { roas: simulationResult.estimatedRoas })}
                    </div>
                  </div>
                  <span className={`rounded-full px-3 py-1 text-xs font-bold ${
                    simulationResult.isProfitable ? "bg-emerald-500/20 text-emerald-400 border border-emerald-500/40" : "bg-rose-500/20 text-rose-400 border border-rose-500/40"
                  }`}>
                    {simulationResult.isProfitable ? t("social.infProfitable") : t("social.infLossRisk")}
                  </span>
                </div>

                <div className="grid grid-cols-2 gap-3 text-xs">
                  <div className="rounded-xl bg-slate-800/80 p-3 space-y-1">
                    <div className="text-[11px] text-slate-400">{t("social.infExpClicks")}</div>
                    <div className="text-base font-bold text-slate-100">{t("social.infClicksValue", { count: fmtNumber(locale, simulationResult.expectedClicks) })}</div>
                  </div>

                  <div className="rounded-xl bg-slate-800/80 p-3 space-y-1">
                    <div className="text-[11px] text-slate-400">{t("social.infExpOrders")}</div>
                    <div className="text-base font-bold text-indigo-400">{t("social.infOrdersValue", { count: fmtNumber(locale, simulationResult.expectedOrders) })}</div>
                  </div>

                  <div className="rounded-xl bg-slate-800/80 p-3 space-y-1">
                    <div className="text-[11px] text-slate-400">{t("social.infExpRevenue")}</div>
                    <div className="text-base font-bold text-emerald-400">{fmtMoney(locale, simulationResult.expectedRevenueBdt)}</div>
                  </div>

                  <div className="rounded-xl bg-slate-800/80 p-3 space-y-1">
                    <div className="text-[11px] text-slate-400">{t("social.infTotalCost")}</div>
                    <div className="text-base font-bold text-amber-400">{fmtMoney(locale, simulationResult.totalCostBdt)}</div>
                  </div>
                </div>

                <div className="rounded-xl border border-slate-800 bg-slate-800/40 p-3 space-y-2 text-xs">
                  <div className="flex items-center justify-between">
                    <span className="text-slate-300">{t("social.infNetProfit")}</span>
                    <span className={`font-bold ${simulationResult.netProfitBdt >= 0 ? "text-emerald-400" : "text-rose-400"}`}>
                      {fmtMoney(locale, simulationResult.netProfitBdt)}
                    </span>
                  </div>
                  <div className="flex items-center justify-between">
                    <span className="text-slate-300">{t("social.infBreakEven")}</span>
                    <span className="font-bold text-amber-300">{t("social.infBreakEvenValue", { count: fmtNumber(locale, simulationResult.breakEvenOrders) })}</span>
                  </div>
                </div>

                <p className="text-[11px] text-slate-400 leading-relaxed">
                  <strong>{t("social.infStrategyTip")}</strong> {t("social.infStrategyTipText")}
                </p>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* TAB 3: PLATFORM ANALYTICS & LEADERBOARD */}
      {activeTab === "analytics" && (
        <div className="space-y-6">
          {/* Platforms Grid */}
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
            {SOCIAL_PLATFORMS.filter((p) => p.id !== "other").map((p) => {
              const data = platformBreakdown[p.id];
              const roi = calculateInfluencerRoi(data.revenueMinor, data.commissionMinor, data.orders);

              return (
                <div key={p.id} className="card p-5 space-y-3 border border-slate-200">
                  <div className="flex items-center justify-between">
                    <span className="flex items-center gap-1.5 font-bold text-slate-900 text-sm">
                      <span className="text-xl">{p.icon}</span> {p.label}
                    </span>
                    <span className="text-[11px] text-slate-500 font-semibold">{t("social.infCreatorsCount", { count: fmtNumber(locale, data.count) })}</span>
                  </div>

                  <div className="space-y-1.5 text-xs">
                    <div className="flex items-center justify-between">
                      <span className="text-slate-500">{t("social.infSalesLabel")}</span>
                      <span className="font-bold text-emerald-600">{fmtMoneyMinor(locale, data.revenueMinor)}</span>
                    </div>
                    <div className="flex items-center justify-between">
                      <span className="text-slate-500">{t("social.infOrderCountLabel")}</span>
                      <span className="font-bold text-slate-800">{t("social.infOrdersCountValue", { count: fmtNumber(locale, data.orders) })}</span>
                    </div>
                    <div className="flex items-center justify-between">
                      <span className="text-slate-500">{t("social.infCommissionGiven")}</span>
                      <span className="font-bold text-indigo-600">{fmtMoneyMinor(locale, data.commissionMinor)}</span>
                    </div>
                    <div className="flex items-center justify-between border-t border-slate-100 pt-1.5">
                      <span className="text-slate-500 font-semibold">{t("social.infPlatformRoi")}</span>
                      <span className="font-bold text-amber-600">
                        {roi.roiMultiplier ? `${roi.roiMultiplier}x` : "—"}
                      </span>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>

          {/* Leaderboard Table */}
          <div className="card p-6 space-y-4">
            <div className="flex items-center justify-between">
              <div>
                <h3 className="font-bold text-slate-900 text-base">{t("social.infLeaderboardTitle")}</h3>
                <p className="text-xs text-slate-500">{t("social.infLeaderboardSub")}</p>
              </div>
            </div>

            {topCreators.length === 0 ? (
              <p className="text-xs text-slate-500 text-center py-6">{t("social.infNoPartnerData")}</p>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-left text-xs text-slate-700">
                  <thead className="bg-slate-50 text-[11px] uppercase text-slate-400 font-semibold">
                    <tr>
                      <th className="p-3">{t("social.infThRank")}</th>
                      <th className="p-3">{t("social.infThInfluencer")}</th>
                      <th className="p-3">{t("social.infThPlatform")}</th>
                      <th className="p-3 text-right">{t("social.infThOrders")}</th>
                      <th className="p-3 text-right">{t("social.infThGmv")}</th>
                      <th className="p-3 text-right">{t("social.infThCommission")}</th>
                      <th className="p-3 text-right">ROI</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {topCreators.map((c, idx) => {
                      const platform = extractPlatformFromNote(c.note);
                      const platformMeta = getPlatformMeta(platform);
                      let rankBadge = fmtNumber(locale, idx + 1);
                      if (idx === 0) rankBadge = t("social.infRank1");
                      else if (idx === 1) rankBadge = t("social.infRank2");
                      else if (idx === 2) rankBadge = t("social.infRank3");

                      return (
                        <tr key={c.id} className="hover:bg-slate-50/80 transition">
                          <td className="p-3 font-bold text-slate-900">{rankBadge}</td>
                          <td className="p-3">
                            <div className="font-bold text-slate-900">{c.name}</div>
                            <code className="text-[10px] text-amber-700 font-bold">{c.code}</code>
                          </td>
                          <td className="p-3">
                            <span className="inline-flex items-center gap-1 rounded bg-slate-100 px-2 py-0.5 text-[11px]">
                              {platformMeta.icon} {platformLabelFor(platform, locale)}
                            </span>
                          </td>
                          <td className="p-3 text-right font-bold text-slate-800">{t("social.infOrdersValue", { count: fmtNumber(locale, c.totalOrders) })}</td>
                          <td className="p-3 text-right font-bold text-emerald-600">
                            {fmtMoneyMinor(locale, c.revMinor)}
                          </td>
                          <td className="p-3 text-right font-semibold text-indigo-600">
                            {fmtMoneyMinor(locale, c.commMinor)}
                          </td>
                          <td className="p-3 text-right font-bold text-amber-600">
                            {c.roiMultiplier ? `${c.roiMultiplier}x` : "—"}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </div>
      )}

      {/* CREATE INFLUENCER MODAL */}
      {showCreateModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4 backdrop-blur-sm">
          <div className="w-full max-w-lg rounded-2xl bg-white p-6 shadow-2xl space-y-4">
            <div className="flex items-center justify-between pb-3 border-b border-slate-100">
              <h3 className="font-bold text-slate-900 text-sm">{t("social.infCreateTitle")}</h3>
              <button
                type="button"
                onClick={() => setShowCreateModal(false)}
                className="text-slate-400 hover:text-slate-600 font-bold"
              >
                ✕
              </button>
            </div>

            <form onSubmit={handleCreateCreator} className="space-y-3.5 text-xs">
              <div>
                <label className="block font-semibold text-slate-700 mb-1">
                  {t("social.infNameLabel")}
                </label>
                <input
                  type="text"
                  required
                  placeholder={t("social.infNamePlaceholder")}
                  value={formData.name}
                  onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                  className="w-full rounded-lg border border-slate-300 p-2 text-xs focus:border-amber-500 focus:outline-none"
                />
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block font-semibold text-slate-700 mb-1">
                    {t("social.infPhoneLabel")}
                  </label>
                  <input
                    type="text"
                    required
                    placeholder="017XXXXXXXX"
                    value={formData.phone}
                    onChange={(e) => setFormData({ ...formData, phone: e.target.value })}
                    className="w-full rounded-lg border border-slate-300 p-2 text-xs focus:border-amber-500 focus:outline-none"
                  />
                </div>
                <div>
                  <label className="block font-semibold text-slate-700 mb-1">
                    {t("social.infPlatformSelectLabel")}
                  </label>
                  <select
                    value={formData.platform}
                    onChange={(e) => setFormData({ ...formData, platform: e.target.value as SocialPlatform })}
                    className="w-full rounded-lg border border-slate-300 p-2 text-xs focus:border-amber-500 focus:outline-none"
                  >
                    {SOCIAL_PLATFORMS.map((p) => (
                      <option key={p.id} value={p.id}>
                        {p.icon} {locale === "en" ? p.labelEn : p.label}
                      </option>
                    ))}
                  </select>
                </div>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block font-semibold text-slate-700 mb-1">
                    {t("social.infCodeLabel")}
                  </label>
                  <input
                    type="text"
                    required
                    placeholder={t("social.infCodePlaceholder")}
                    value={formData.code}
                    onChange={(e) => setFormData({ ...formData, code: e.target.value.toUpperCase() })}
                    className="w-full rounded-lg border border-slate-300 p-2 text-xs uppercase font-bold focus:border-amber-500 focus:outline-none"
                  />
                </div>
                <div>
                  <label className="block font-semibold text-slate-700 mb-1">
                    {t("social.infCommRateLabel")}
                  </label>
                  <input
                    type="number"
                    min={0}
                    max={50}
                    required
                    value={formData.commissionPercent}
                    onChange={(e) => setFormData({ ...formData, commissionPercent: Number(e.target.value) })}
                    className="w-full rounded-lg border border-slate-300 p-2 text-xs focus:border-amber-500 focus:outline-none"
                  />
                </div>
              </div>

              <div>
                <label className="block font-semibold text-slate-700 mb-1">
                  {t("social.infEmailLabel")}
                </label>
                <input
                  type="email"
                  placeholder="creator@gmail.com"
                  value={formData.email}
                  onChange={(e) => setFormData({ ...formData, email: e.target.value })}
                  className="w-full rounded-lg border border-slate-300 p-2 text-xs focus:border-amber-500 focus:outline-none"
                />
              </div>

              <div>
                <label className="block font-semibold text-slate-700 mb-1">
                  {t("social.infNoteLabel")}
                </label>
                <input
                  type="text"
                  placeholder={t("social.infNotePlaceholder")}
                  value={formData.note}
                  onChange={(e) => setFormData({ ...formData, note: e.target.value })}
                  className="w-full rounded-lg border border-slate-300 p-2 text-xs focus:border-amber-500 focus:outline-none"
                />
              </div>

              <div className="flex items-center justify-end gap-2 pt-3 border-t border-slate-100">
                <button
                  type="button"
                  onClick={() => setShowCreateModal(false)}
                  className="rounded-lg border border-slate-300 px-4 py-2 text-xs text-slate-700 hover:bg-slate-50"
                >
                  {t("common.cancel")}
                </button>
                <button
                  type="submit"
                  disabled={submittingCreate}
                  className="rounded-lg bg-amber-600 px-4 py-2 text-xs font-semibold text-white hover:bg-amber-700 disabled:opacity-50"
                >
                  {submittingCreate ? t("social.infSaving") : t("social.infSaveCreator")}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* 1-CLICK WHATSAPP BRIEFING MODAL */}
      {briefingCreator && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4 backdrop-blur-sm">
          <div className="w-full max-w-lg rounded-2xl bg-white p-6 shadow-2xl space-y-4">
            <div className="flex items-center justify-between pb-3 border-b border-slate-100">
              <div className="flex items-center gap-2">
                <span className="text-xl">💬</span>
                <h3 className="font-bold text-slate-900 text-sm">
                  {t("social.infBriefingTitle", { name: briefingCreator.name })}
                </h3>
              </div>
              <button
                type="button"
                onClick={() => setBriefingCreator(null)}
                className="text-slate-400 hover:text-slate-600 font-bold"
              >
                ✕
              </button>
            </div>

            {(() => {
              const platform = extractPlatformFromNote(briefingCreator.note);
              const trackingUrl = generateInfluencerTrackingUrl({
                baseUrl: storeDomain,
                code: briefingCreator.code,
                platform,
                campaignName: briefingCreator.name,
              });

              const briefingText = buildInfluencerWhatsAppBriefing({
                creatorName: briefingCreator.name,
                brandName,
                promoCode: briefingCreator.code,
                trackingUrl,
                commissionPercent: briefingCreator.commissionPercent,
                paymentTerms: customBriefingNote || undefined,
              }, locale);

              const waUrl = buildInfluencerWhatsAppUrl(briefingCreator.phone, briefingText);

              return (
                <div className="space-y-3 text-xs">
                  <div>
                    <label className="block font-semibold text-slate-700 mb-1">
                      {t("social.infBriefingPreviewLabel")}
                    </label>
                    <textarea
                      readOnly
                      rows={10}
                      value={briefingText}
                      className="w-full rounded-xl border border-slate-200 bg-slate-50 p-3 text-[11px] font-mono leading-relaxed text-slate-800 focus:outline-none"
                    />
                  </div>

                  <div>
                    <label className="block font-semibold text-slate-700 mb-1">
                      {t("social.infBriefingTermsLabel")}
                    </label>
                    <input
                      type="text"
                      placeholder={t("social.infBriefingTermsPlaceholder")}
                      value={customBriefingNote}
                      onChange={(e) => setCustomBriefingNote(e.target.value)}
                      className="w-full rounded-lg border border-slate-300 p-2 text-xs focus:border-amber-500 focus:outline-none"
                    />
                  </div>

                  <div className="flex flex-wrap items-center justify-between gap-2 pt-3 border-t border-slate-100">
                    <button
                      type="button"
                      onClick={() => copyToClipboard(briefingText, `brief-${briefingCreator.id}`)}
                      className="rounded-lg border border-slate-300 px-3 py-2 text-xs font-semibold text-slate-700 hover:bg-slate-50"
                    >
                      {copiedCode === `brief-${briefingCreator.id}` ? t("social.infTextCopiedBang") : t("social.infCopyText")}
                    </button>

                    <a
                      href={waUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="rounded-lg bg-emerald-600 px-4 py-2 text-xs font-semibold text-white shadow hover:bg-emerald-700 transition flex items-center gap-1.5"
                    >
                      <span>🟢</span>
                      <span>{t("social.infSendWa", { phone: briefingCreator.phone })}</span>
                    </a>
                  </div>
                </div>
              );
            })()}
          </div>
        </div>
      )}

      {/* RECORD COMMISSION PAYOUT MODAL */}
      {payoutCreator && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4 backdrop-blur-sm">
          <div className="w-full max-w-lg rounded-2xl bg-white p-6 shadow-2xl space-y-4">
            <div className="flex items-center justify-between pb-3 border-b border-slate-100">
              <div className="flex items-center gap-2">
                <span className="text-xl">💳</span>
                <h3 className="font-bold text-slate-900 text-sm">
                  {t("social.infPayoutTitle", { name: payoutCreator.name })}
                </h3>
              </div>
              <button
                type="button"
                onClick={() => setPayoutCreator(null)}
                className="text-slate-400 hover:text-slate-600 font-bold"
              >
                ✕
              </button>
            </div>

            {recordedVoucher ? (
              <div className="space-y-4 text-xs">
                <div className="rounded-xl border border-emerald-200 bg-emerald-50 p-4 space-y-2">
                  <div className="flex items-center gap-2 text-emerald-800 font-bold text-sm">
                    <span>{t("social.infVoucherSavedTitle")}</span>
                  </div>
                  <p className="text-slate-600 text-xs">
                    {t("social.infVoucherSavedSub")}
                  </p>
                  <textarea
                    readOnly
                    rows={6}
                    value={recordedVoucher.text}
                    className="w-full rounded-lg border border-emerald-300 bg-white p-2.5 text-[11px] font-mono text-slate-800"
                  />
                </div>

                <div className="flex items-center justify-between pt-2">
                  <button
                    type="button"
                    onClick={() => copyToClipboard(recordedVoucher.text, "voucher-copy")}
                    className="rounded-lg border border-slate-300 px-3 py-2 text-xs font-semibold text-slate-700 hover:bg-slate-50"
                  >
                    {copiedCode === "voucher-copy" ? t("social.infReceiptCopiedBang") : t("social.infCopyReceipt")}
                  </button>

                  <a
                    href={buildInfluencerWhatsAppUrl(recordedVoucher.phone, recordedVoucher.text)}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="rounded-lg bg-emerald-600 px-4 py-2 text-xs font-semibold text-white shadow hover:bg-emerald-700 transition"
                  >
                    {t("social.infSendReceiptWa")}
                  </a>
                </div>
              </div>
            ) : (
              <form onSubmit={handleRecordPayout} className="space-y-3.5 text-xs">
                <div className="rounded-xl bg-slate-50 p-3 border border-slate-100 flex items-center justify-between">
                  <span className="text-slate-500">{t("social.infApprovedDue")}</span>
                  <span className="font-bold text-amber-700 text-sm">
                    {fmtMoneyMinor(locale, BigInt(calculatePartnerOutstandingMinor(payoutCreator)))}
                  </span>
                </div>

                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="block font-semibold text-slate-700 mb-1">
                      {t("social.infPayoutAmountLabel")}
                    </label>
                    <input
                      type="number"
                      required
                      min={1}
                      step="any"
                      placeholder={t("social.infPayoutAmountPlaceholder")}
                      value={payoutAmountTaka}
                      onChange={(e) => setPayoutAmountTaka(e.target.value)}
                      className="w-full rounded-lg border border-slate-300 p-2 text-xs font-bold focus:border-amber-500 focus:outline-none"
                    />
                  </div>

                  <div>
                    <label className="block font-semibold text-slate-700 mb-1">
                      {t("social.infMethodLabel")}
                    </label>
                    <select
                      value={payoutMethod}
                      onChange={(e) => setPayoutMethod(e.target.value)}
                      className="w-full rounded-lg border border-slate-300 p-2 text-xs focus:border-amber-500 focus:outline-none"
                    >
                      <option value="bkash">{t("social.infMethodBkash")}</option>
                      <option value="nagad">{t("social.infMethodNagad")}</option>
                      <option value="rocket">{t("social.infMethodRocket")}</option>
                      <option value="bank">{t("social.infMethodBank")}</option>
                      <option value="cash">{t("social.infMethodCash")}</option>
                      <option value="other">{t("social.infMethodOther")}</option>
                    </select>
                  </div>
                </div>

                <div>
                  <label className="block font-semibold text-slate-700 mb-1">
                    {t("social.infRefLabel")}
                  </label>
                  <input
                    type="text"
                    placeholder={t("social.infRefPlaceholder")}
                    value={payoutRef}
                    onChange={(e) => setPayoutRef(e.target.value)}
                    className="w-full rounded-lg border border-slate-300 p-2 text-xs focus:border-amber-500 focus:outline-none"
                  />
                </div>

                <div>
                  <label className="block font-semibold text-slate-700 mb-1">
                    {t("social.infPayoutNoteLabel")}
                  </label>
                  <input
                    type="text"
                    placeholder={t("social.infPayoutNotePlaceholder")}
                    value={payoutNote}
                    onChange={(e) => setPayoutNote(e.target.value)}
                    className="w-full rounded-lg border border-slate-300 p-2 text-xs focus:border-amber-500 focus:outline-none"
                  />
                </div>

                <div className="flex items-center justify-end gap-2 pt-3 border-t border-slate-100">
                  <button
                    type="button"
                    onClick={() => setPayoutCreator(null)}
                    className="rounded-lg border border-slate-300 px-4 py-2 text-xs text-slate-700 hover:bg-slate-50"
                  >
                    {t("common.cancel")}
                  </button>
                  <button
                    type="submit"
                    disabled={submittingPayout}
                    className="rounded-lg bg-indigo-600 px-4 py-2 text-xs font-semibold text-white hover:bg-indigo-700 disabled:opacity-50"
                  >
                    {submittingPayout ? t("social.infPayoutSaving") : t("social.infPayoutSave")}
                  </button>
                </div>
              </form>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
