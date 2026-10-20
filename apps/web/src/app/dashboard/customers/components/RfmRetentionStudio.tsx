"use client";
import React, { useState, useEffect, useMemo } from "react";
import { apiFetch } from "@/lib/api";
import { getOrganizationId } from "@/lib/org";
import Link from "next/link";
import { useLocale } from "@/lib/i18n/provider";
import { crmBn, crmEn } from "@/lib/i18n/crm";
import { fmtNumber, fmtMoney } from "@repo/contracts";
import type { UiLocale } from "@repo/contracts";

const SEG_TEXT_KEYS: Record<string, { title: keyof typeof crmBn; desc: keyof typeof crmBn; strategy: keyof typeof crmBn; promo: keyof typeof crmBn }> = {
  champions: { title: "crmZSegChampionsTitle", desc: "segChampionsDesc", strategy: "segChampionsStrategy", promo: "segChampionsPromo" },
  loyal: { title: "crmZSegLoyalTitle", desc: "segLoyalDesc", strategy: "segLoyalStrategy", promo: "segLoyalPromo" },
  big_spenders: { title: "crmZSegBigTitle", desc: "segBigDesc", strategy: "segBigStrategy", promo: "segBigPromo" },
  at_risk: { title: "crmZSegAtRiskTitle", desc: "segAtRiskDesc", strategy: "segAtRiskStrategy", promo: "segAtRiskPromo" },
  lost: { title: "crmZSegLostTitle", desc: "segLostDesc", strategy: "segLostStrategy", promo: "segLostPromo" },
  new: { title: "crmZSegNewCustTitle", desc: "segNewDesc", strategy: "segNewStrategy", promo: "segNewPromo" },
  regular: { title: "crmZSegRegularTitle", desc: "segRegularDesc", strategy: "segRegularStrategy", promo: "segRegularPromo" },
};

/** All segment copy comes from the crm dictionary (both locales);
 * `altTitle` is the OTHER locale's title (bilingual card subtitle). */
function segText(key: string, locale: string): { title: string; altTitle: string; desc: string; strategy: string; promo: string } {
  const D = locale === "en" ? crmEn : crmBn;
  const A = locale === "en" ? crmBn : crmEn;
  const k = SEG_TEXT_KEYS[key] ?? SEG_TEXT_KEYS.regular;
  return { title: D[k.title], altTitle: A[k.title], desc: D[k.desc], strategy: D[k.strategy], promo: D[k.promo] };
}
import {
  calculateChurnProbability,
  churnLevelLabel,
  predict12MonthClv,
  formatClvTaka,
  extractSegmentPhoneNumbers,
  buildSegmentCampaignMessage,
  type RfmSegmentKey,
} from "@/lib/rfm-retention";

export interface RfmCustomerRow {
  customerId: string;
  name: string;
  phone: string | null;
  email: string | null;
  recencyDays: number;
  frequency: number;
  monetaryMinor: string;
  r: number;
  f: number;
  m: number;
  segment: string;
}

interface SegmentStat {
  count: number;
  totalSpendMinor: string;
  avgRecencyDays: number;
  avgFrequency: number;
}

interface RfmReportResponse {
  totalCustomers: number;
  segments: Record<string, number>;
  segmentStats?: Record<string, SegmentStat>;
  rows: RfmCustomerRow[];
}

interface RfmStudioProps {
  onSelectCustomer?: (customerId: string) => void;
}

const SEGMENT_META: Record<
  string,
  {
    title: string;
    icon: string;
    badgeCls: string;
    borderCls: string;
    bgCls: string;
    promoCode: string;
  }
> = {
  champions: {
    title: "Champions",
    icon: "👑",
    badgeCls: "bg-emerald-100 text-emerald-800 border-emerald-300",
    borderCls: "border-emerald-300 hover:border-emerald-500",
    bgCls: "bg-emerald-50/50",
    promoCode: "VIP20",
  },
  loyal: {
    title: "Loyal Customers",
    icon: "💖",
    badgeCls: "bg-blue-100 text-blue-800 border-blue-300",
    borderCls: "border-blue-300 hover:border-blue-500",
    bgCls: "bg-blue-50/50",
    promoCode: "LOYAL15",
  },
  big_spenders: {
    title: "Big Spenders",
    icon: "💰",
    badgeCls: "bg-purple-100 text-purple-800 border-purple-300",
    borderCls: "border-purple-300 hover:border-purple-500",
    bgCls: "bg-purple-50/50",
    promoCode: "BIGSPEND500",
  },
  at_risk: {
    title: "At Risk",
    icon: "⚠️",
    badgeCls: "bg-amber-100 text-amber-800 border-amber-300",
    borderCls: "border-amber-300 hover:border-amber-500",
    bgCls: "bg-amber-50/50",
    promoCode: "COMEBACK15",
  },
  lost: {
    title: "Lost / Inactive",
    icon: "💤",
    badgeCls: "bg-rose-100 text-rose-800 border-rose-300",
    borderCls: "border-rose-300 hover:border-rose-500",
    bgCls: "bg-rose-50/50",
    promoCode: "REACTIVATE20",
  },
  new: {
    title: "New Customers",
    icon: "🌱",
    badgeCls: "bg-cyan-100 text-cyan-800 border-cyan-300",
    borderCls: "border-cyan-300 hover:border-cyan-500",
    bgCls: "bg-cyan-50/50",
    promoCode: "NEXT10",
  },
  regular: {
    title: "Regular Customers",
    icon: "📦",
    badgeCls: "bg-slate-100 text-slate-800 border-slate-300",
    borderCls: "border-slate-300 hover:border-slate-400",
    bgCls: "bg-slate-50/50",
    promoCode: "SAVE100",
  },
};

const formatBDT = (minorStr?: string | number | null, locale: UiLocale = "bn") => {
  if (minorStr == null) return fmtMoney(locale, 0);
  const num = Number(minorStr) / 100;
  return fmtMoney(locale, num);
};

export default function RfmRetentionStudio({ onSelectCustomer }: RfmStudioProps) {
  const { t, locale } = useLocale();
  const formatBDTL = (v?: string | number | null) => formatBDT(v, locale);
  const [data, setData] = useState<RfmReportResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [activeSegment, setActiveSegment] = useState<string>("all");
  const [searchQuery, setSearchQuery] = useState("");
  const [copiedCode, setCopiedCode] = useState<string | null>(null);
  const [blastModalOpen, setBlastModalOpen] = useState(false);
  const [selectedBlastSegment, setSelectedBlastSegment] = useState<RfmSegmentKey>("at_risk");
  const [blastMessage, setBlastMessage] = useState("");
  const [copiedPhonesToast, setCopiedPhonesToast] = useState(false);
  const [copiedBlastMsgToast, setCopiedBlastMsgToast] = useState(false);

  const openBlastModalForSegment = (seg: RfmSegmentKey) => {
    setSelectedBlastSegment(seg);
    const meta = SEGMENT_META[seg] || SEGMENT_META.regular;
    setBlastMessage(buildSegmentCampaignMessage(seg, "", meta.promoCode, t("crm.rfmOurShop"), locale));
    setBlastModalOpen(true);
  };

  useEffect(() => {
    const orgId = getOrganizationId();
    if (!orgId) {
      setLoading(false);
      return;
    }
    setLoading(true);
    apiFetch<RfmReportResponse>(`/organizations/${orgId}/messaging/rfm`)
      .then((res) => {
        setData(res);
        setError("");
      })
      .catch((err) => setError(err instanceof Error ? err.message : t("crm.rfmLoadFailed")))
      .finally(() => setLoading(false));
  }, []);

  const filteredRows = useMemo(() => {
    if (!data?.rows) return [];
    let list = data.rows;
    if (activeSegment !== "all") {
      list = list.filter((r) => r.segment === activeSegment);
    }
    if (searchQuery.trim()) {
      const q = searchQuery.toLowerCase().trim();
      list = list.filter(
        (r) =>
          r.name.toLowerCase().includes(q) ||
          (r.phone && r.phone.includes(q)) ||
          (r.email && r.email.toLowerCase().includes(q))
      );
    }
    return list;
  }, [data?.rows, activeSegment, searchQuery]);

  // Overall KPI sums
  const stats = useMemo(() => {
    if (!data?.rows) {
      return { totalRevenue: "0", championsCount: 0, atRiskCount: 0, atRiskRevenue: "0" };
    }
    let totalRev = 0n;
    let atRiskRev = 0n;
    let champs = 0;
    let atRisk = 0;

    for (const r of data.rows) {
      const val = BigInt(r.monetaryMinor || 0);
      totalRev += val;
      if (r.segment === "champions") champs++;
      if (r.segment === "at_risk" || r.segment === "lost") {
        atRisk++;
        atRiskRev += val;
      }
    }

    return {
      totalRevenue: String(totalRev),
      championsCount: champs,
      atRiskCount: atRisk,
      atRiskRevenue: String(atRiskRev),
    };
  }, [data?.rows]);

  const copyPromo = (code: string) => {
    navigator.clipboard.writeText(code);
    setCopiedCode(code);
    setTimeout(() => setCopiedCode(null), 3000);
  };

  const openWhatsApp = (customer: RfmCustomerRow) => {
    if (!customer.phone) {
      alert(t("crm.rfmNoPhone"));
      return;
    }
    let cleaned = customer.phone.replace(/[^0-9]/g, "");
    if (cleaned.startsWith("0")) cleaned = "88" + cleaned;
    else if (!cleaned.startsWith("880") && cleaned.length === 10) cleaned = "880" + cleaned;

    const meta = SEGMENT_META[customer.segment] || SEGMENT_META.regular;
    const name = customer.name || t("crm.rfmDearCustomer");

    let message = "";
    if (customer.segment === "at_risk") {
      message = t("crm.rfmMsgAtRisk", { name, code: meta.promoCode });
    } else if (customer.segment === "champions") {
      message = t("crm.rfmMsgChampions", { name, code: meta.promoCode });
    } else if (customer.segment === "new") {
      message = t("crm.rfmMsgNew", { name, code: meta.promoCode });
    } else {
      message = t("crm.rfmMsgDefault", { name, code: meta.promoCode, promo: segText(customer.segment, locale).promo });
    }

    window.open(`https://wa.me/${cleaned}?text=${encodeURIComponent(message)}`, "_blank");
  };

  if (loading) {
    return (
      <div className="card p-8 text-center text-slate-500">
        <div className="mx-auto mb-3 h-8 w-8 animate-spin rounded-full border-4 border-indigo-600 border-t-transparent" />
        <p className="font-medium">{t("crm.rfmLoadingTitle")}</p>
        <p className="mt-1 text-xs text-slate-400">{t("crm.rfmLoadingSub")}</p>
      </div>
    );
  }

  if (error) {
    return (
      <div className="card border-red-200 bg-red-50 p-6 text-red-700">
        <p className="font-bold">{t("crm.rfmLoadErrorPrefix")}</p>
        <p className="text-sm">{error}</p>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Top Banner & KPI Highlights */}
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <div className="card border-l-4 border-l-indigo-600 p-4">
          <p className="text-xs font-semibold uppercase tracking-wider text-slate-500">{t("crm.rfmTotalSegmented")}</p>
          <p className="mt-1 text-2xl font-black text-slate-900">{t("crm.rfmPeopleSuffix", { count: fmtNumber(locale, data?.totalCustomers ?? 0) })}</p>
          <p className="mt-1 text-xs text-slate-500">{t("crm.rfmUniqueBase")}</p>
        </div>

        <div className="card border-l-4 border-l-emerald-600 p-4">
          <p className="text-xs font-semibold uppercase tracking-wider text-slate-500">{t("crm.rfmTotalLtv")}</p>
          <p className="mt-1 text-2xl font-black text-emerald-700">{formatBDTL(stats.totalRevenue)}</p>
          <p className="mt-1 text-xs text-emerald-600 font-medium">{t("crm.rfmTotalRevenue")}</p>
        </div>

        <div className="card border-l-4 border-l-purple-600 p-4">
          <p className="text-xs font-semibold uppercase tracking-wider text-slate-500">{t("crm.rfmChampionsBase")}</p>
          <p className="mt-1 text-2xl font-black text-purple-700">{t("crm.rfmPeopleSuffix", { count: fmtNumber(locale, stats.championsCount) })}</p>
          <p className="mt-1 text-xs text-slate-500">{t("crm.rfmTopSatisfaction")}</p>
        </div>

        <div className="card border-l-4 border-l-amber-600 p-4">
          <p className="text-xs font-semibold uppercase tracking-wider text-slate-500">{t("crm.rfmAtRiskRevenue")}</p>
          <p className="mt-1 text-2xl font-black text-amber-700">{formatBDTL(stats.atRiskRevenue)}</p>
          <p className="mt-1 text-xs text-amber-600 font-medium">{t("crm.rfmAtRiskLine", { count: fmtNumber(locale, stats.atRiskCount) })}</p>
        </div>
      </div>

      {/* Retention Studio Guide Banner */}
      <div className="rounded-2xl border border-indigo-200 bg-gradient-to-r from-indigo-50/80 via-white to-purple-50/60 p-5 shadow-sm">
        <div className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
          <div>
            <span className="inline-flex items-center gap-1.5 rounded-full bg-indigo-100 px-3 py-1 text-xs font-bold text-indigo-700">
              💎 AI Retention & LTV Copilot
            </span>
            <h2 className="mt-2 text-lg font-bold text-slate-900">
              {t("crm.rfmScienceTitle")}
            </h2>
            <p className="mt-1 max-w-2xl text-xs text-slate-600">
              {t("crm.rfmScienceBody")}
              
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            <Link
              href="/dashboard/messaging"
              className="inline-flex items-center gap-2 rounded-xl bg-indigo-600 px-4 py-2.5 text-xs font-bold text-white shadow-sm transition hover:bg-indigo-700"
            >
              {t("crm.rfmBroadcastCampaign")}
            </Link>
            <Link
              href="/dashboard/audiences"
              className="inline-flex items-center gap-2 rounded-xl border border-slate-300 bg-white px-4 py-2.5 text-xs font-bold text-slate-700 shadow-sm transition hover:bg-slate-50"
            >
              {t("crm.rfmMetaAudience")}
            </Link>
          </div>
        </div>
      </div>

      {/* Segment Cards Grid */}
      <div>
        <div className="mb-3 flex items-center justify-between">
          <h3 className="font-bold text-slate-800">{t("crm.rfmSegmentsTitle")}</h3>
          {activeSegment !== "all" && (
            <button
              onClick={() => setActiveSegment("all")}
              className="text-xs font-bold text-indigo-600 hover:underline"
            >
              {t("crm.rfmShowAllSegments")}
            </button>
          )}
        </div>

        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
          {Object.entries(SEGMENT_META).map(([key, meta]) => {
            const count = data?.segments[key] ?? 0;
            const stat = data?.segmentStats?.[key];
            const isSelected = activeSegment === key;
            const pct = data?.totalCustomers ? Math.round((count / data.totalCustomers) * 100) : 0;

            return (
              <div
                key={key}
                onClick={() => setActiveSegment(isSelected ? "all" : key)}
                className={`cursor-pointer rounded-2xl border-2 p-4 transition duration-150 ${meta.borderCls} ${
                  isSelected ? "ring-2 ring-indigo-500 shadow-md " + meta.bgCls : "bg-white hover:shadow-sm"
                }`}
              >
                <div className="flex items-start justify-between">
                  <div className="flex items-center gap-2">
                    <span className="text-2xl">{meta.icon}</span>
                    <div>
                      <h4 className="text-sm font-bold text-slate-900">{segText(key, locale).title}</h4>
                      <p className="text-[11px] text-slate-500">{segText(key, locale).altTitle}</p>
                    </div>
                  </div>
                  <span className={`rounded-full border px-2 py-0.5 text-xs font-bold ${meta.badgeCls}`}>
                    {t("crm.rfmCountPct", { count: fmtNumber(locale, count), pct: fmtNumber(locale, pct) })}
                  </span>
                </div>

                <p className="mt-2.5 text-xs text-slate-600 line-clamp-2">{segText(key, locale).desc}</p>

                {stat && (
                  <div className="mt-3 grid grid-cols-2 gap-2 border-t border-slate-100 pt-2 text-[11px]">
                    <div>
                      <span className="text-slate-400">{t("crm.rfmTotalSales")} </span>
                      <span className="font-bold text-slate-800">{formatBDTL(stat.totalSpendMinor)}</span>
                    </div>
                    <div>
                      <span className="text-slate-400">{t("crm.rfmAvgDays")} </span>
                      <span className="font-bold text-slate-800">{t("crm.rfmDaysAgoSuffix", { count: fmtNumber(locale, stat.avgRecencyDays) })}</span>
                    </div>
                  </div>
                )}

                <div className="mt-3 rounded-xl bg-slate-50 p-2 text-[11px]">
                  <span className="font-semibold text-slate-700">{t("crm.rfmStrategyLabel")} </span>
                  <span className="text-slate-600">{segText(key, locale).strategy}</span>
                  <div className="mt-1.5 flex items-center justify-between font-mono text-[10px]">
                    <span className="rounded bg-indigo-50 px-1.5 py-0.5 text-indigo-700 font-bold">
                      {t("crm.rfmCodePrefix")} {meta.promoCode}
                    </span>
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        copyPromo(meta.promoCode);
                      }}
                      className="text-indigo-600 hover:underline"
                    >
                      {copiedCode === meta.promoCode ? t("crm.rfmCopied") : t("crm.rfmCopyCode")}
                    </button>
                  </div>
                  <div className="mt-2.5 flex items-center justify-between border-t border-slate-100 pt-2">
                    <button
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation();
                        openBlastModalForSegment(key as RfmSegmentKey);
                      }}
                      className="inline-flex items-center gap-1 text-[11px] font-bold text-indigo-600 hover:text-indigo-800"
                    >
                      <span>📢</span> {t("crm.rfmBlastCampaign")}
                    </button>
                    <span className="text-[10px] text-slate-400">
                      {t("crm.rfmCustomersCount", { count: fmtNumber(locale, count) })}
                    </span>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {/* Customer List & Retention Action Table */}
      <div className="card space-y-4">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <h3 className="text-base font-bold text-slate-900">
              {t("crm.rfmListTitle")}{" "}
              {activeSegment !== "all" && (
                <span className="text-xs font-normal text-indigo-600">
                  {t("crm.rfmFilterPrefix")} {SEGMENT_META[activeSegment] ? segText(activeSegment, locale).title : ""})
                </span>
              )}
            </h3>
            <p className="text-xs text-slate-500">
              {t("crm.rfmShowingLine", { count: fmtNumber(locale, filteredRows.length) })}
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              onClick={() => {
                const extracted = extractSegmentPhoneNumbers(filteredRows);
                if (!extracted.validCount) {
                  alert(t("crm.rfmNoValidPhones"));
                  return;
                }
                navigator.clipboard.writeText(extracted.textCsv);
                setCopiedPhonesToast(true);
                setTimeout(() => setCopiedPhonesToast(false), 3000);
              }}
              className="rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-xs font-semibold text-slate-700 hover:bg-slate-50 shadow-sm"
            >
              {copiedPhonesToast ? t("crm.rfmPhoneCopied") : t("crm.rfmCopyPhones")}
            </button>
            <button
              type="button"
              onClick={() => openBlastModalForSegment((activeSegment === "all" ? "at_risk" : activeSegment) as RfmSegmentKey)}
              className="rounded-lg border border-indigo-200 bg-indigo-50 px-3 py-1.5 text-xs font-semibold text-indigo-700 hover:bg-indigo-100 shadow-sm"
            >
              {t("crm.rfmSegmentBlast")}
            </button>
            <input
              type="text"
              placeholder={t("crm.rfmSearchPlaceholder")}
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="input w-52 text-xs"
            />
          </div>
        </div>

        {filteredRows.length === 0 ? (
          <div className="rounded-xl border border-dashed border-slate-200 p-8 text-center text-slate-400">
            {t("crm.rfmEmptySegment")}
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs">
              <thead className="border-b bg-slate-50 font-semibold text-slate-600">
                <tr>
                  <th className="py-2.5 px-3">{t("crm.rfmColCustomer")}</th>
                  <th className="py-2.5 px-3">{t("crm.rfmColSegment")}</th>
                  <th className="py-2.5 px-3">{t("crm.rfmColOrdersRecency")}</th>
                  <th className="py-2.5 px-3">{t("crm.rfmColMonetary")}</th>
                  <th className="py-2.5 px-3">{t("crm.rfmColClv")}</th>
                  <th className="py-2.5 px-3">{t("crm.rfmColChurn")}</th>
                  <th className="py-2.5 px-3">{t("crm.rfmColScore")}</th>
                  <th className="py-2.5 px-3 text-right">{t("crm.rfmColAction")}</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {filteredRows.map((c) => {
                  const meta = SEGMENT_META[c.segment] || SEGMENT_META.regular;
                  const churn = calculateChurnProbability(c.recencyDays, c.frequency);
                  const clv = predict12MonthClv(c.monetaryMinor, c.frequency, c.recencyDays, locale);
                  return (
                    <tr key={c.customerId} className="hover:bg-slate-50/70 transition">
                      <td className="py-3 px-3">
                        <div className="font-semibold text-slate-900">{c.name || t("crm.noName")}</div>
                        <div className="text-[11px] text-slate-500">{c.phone || c.email || t("crm.rfmNoContact")}</div>
                      </td>

                      <td className="py-3 px-3">
                        <span className={`inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[11px] font-bold ${meta.badgeCls}`}>
                          <span>{meta.icon}</span>
                          <span>{segText(c.segment, locale).title.split(" ")[0]}</span>
                        </span>
                      </td>

                      <td className="py-3 px-3">
                        <div className="font-semibold text-slate-800">{t("crm.rfmOrdersSuffix", { count: fmtNumber(locale, c.frequency) })}</div>
                        <div className="text-[10px] text-slate-400">
                          {t("crm.rfmDaysAgoSuffix", { count: fmtNumber(locale, c.recencyDays) })} ({c.recencyDays <= 30 ? t("crm.rfmRecentVery") : c.recencyDays <= 90 ? t("crm.rfmRecentMid") : t("crm.rfmRecentLong")})
                        </div>
                      </td>

                      <td className="py-3 px-3">
                        <div className="font-bold text-slate-900">{formatBDTL(c.monetaryMinor)}</div>
                      </td>

                      <td className="py-3 px-3">
                        <div className="font-bold text-indigo-700">{clv.formattedTaka}</div>
                        <div className="text-[10px] text-slate-400">{t("crm.rfmExpectedOrders", { count: fmtNumber(locale, clv.predictedOrdersNextYear) })}</div>
                      </td>

                      <td className="py-3 px-3">
                        <span className={`inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[10px] font-bold ${churn.badgeCls}`}>
                          <span>{churn.churnPct}%</span>
                          <span>{churnLevelLabel(churn.level, locale).split(" ")[0]}</span>
                        </span>
                      </td>

                      <td className="py-3 px-3">
                        <div className="flex gap-1">
                          <span
                            title={t("crm.rfmScoreRecency")}
                            className={`rounded px-1.5 py-0.5 text-[10px] font-bold ${
                              c.r >= 4 ? "bg-emerald-100 text-emerald-800" : c.r <= 2 ? "bg-red-100 text-red-800" : "bg-slate-100 text-slate-700"
                            }`}
                          >
                            R:{c.r}
                          </span>
                          <span
                            title={t("crm.rfmScoreFrequency")}
                            className={`rounded px-1.5 py-0.5 text-[10px] font-bold ${
                              c.f >= 4 ? "bg-indigo-100 text-indigo-800" : "bg-slate-100 text-slate-700"
                            }`}
                          >
                            F:{c.f}
                          </span>
                          <span
                            title={t("crm.rfmScoreMonetary")}
                            className={`rounded px-1.5 py-0.5 text-[10px] font-bold ${
                              c.m >= 4 ? "bg-purple-100 text-purple-800" : "bg-slate-100 text-slate-700"
                            }`}
                          >
                            M:{c.m}
                          </span>
                        </div>
                      </td>

                      <td className="py-3 px-3 text-right">
                        <div className="flex items-center justify-end gap-1.5">
                          {c.phone && (
                            <>
                              <button
                                onClick={() => openWhatsApp(c)}
                                title={t("crm.rfmWaTitle")}
                                className="inline-flex items-center gap-1 rounded-lg border border-emerald-300 bg-emerald-50 px-2.5 py-1 text-[11px] font-bold text-emerald-700 transition hover:bg-emerald-100"
                              >
                                <span>💬</span> WhatsApp
                              </button>
                              <a
                                href={`tel:${c.phone}`}
                                title={t("crm.rfmCallTitle")}
                                className="inline-flex items-center gap-1 rounded-lg border border-slate-200 bg-white px-2 py-1 text-[11px] font-semibold text-slate-600 transition hover:bg-slate-50"
                              >
                                📞
                              </a>
                            </>
                          )}
                          {onSelectCustomer && (
                            <button
                              onClick={() => onSelectCustomer(c.customerId)}
                              title={t("crm.rfmView360Title")}
                              className="inline-flex items-center gap-1 rounded-lg border border-indigo-200 bg-indigo-50 px-2 py-1 text-[11px] font-semibold text-indigo-700 transition hover:bg-indigo-100"
                            >
                              {t("crm.rfmKhataLink")}
                            </button>
                          )}
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* VIP Recall & Win-Back Blast Modal */}
      {blastModalOpen ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4">
          <div className="flex max-h-[90vh] w-full max-w-2xl flex-col rounded-2xl bg-white shadow-2xl">
            <div className="flex items-center justify-between border-b px-6 py-4">
              <div>
                <h2 className="text-base font-bold text-slate-800">
                  {t("crm.rfmBlastTitle")} ({selectedBlastSegment && SEGMENT_META[selectedBlastSegment] ? segText(selectedBlastSegment, locale).title : ""})
                </h2>
                <p className="text-xs text-slate-500">
                  {t("crm.rfmBlastSub")}
                </p>
              </div>
              <button
                type="button"
                className="rounded-lg p-1.5 text-slate-400 hover:bg-slate-100 hover:text-slate-600"
                onClick={() => setBlastModalOpen(false)}
              >
                ✕
              </button>
            </div>

            <div className="space-y-4 overflow-y-auto p-6 text-xs">
              {/* Target Segment Selector */}
              <div>
                <label className="block text-xs font-semibold text-slate-700">{t("crm.rfmPickSegment")}</label>
                <div className="mt-1.5 grid grid-cols-3 gap-2">
                  {Object.entries(SEGMENT_META).map(([key, meta]) => {
                    const count = data?.segments[key] ?? 0;
                    return (
                      <button
                        key={key}
                        type="button"
                        onClick={() => {
                          setSelectedBlastSegment(key as RfmSegmentKey);
                          setBlastMessage(buildSegmentCampaignMessage(key as RfmSegmentKey, "", meta.promoCode, undefined, locale));
                        }}
                        className={`rounded-xl border p-2 text-left transition ${
                          selectedBlastSegment === key
                            ? "border-indigo-600 bg-indigo-50/70 text-indigo-900 font-bold shadow-sm"
                            : "border-slate-200 text-slate-600 hover:bg-slate-50"
                        }`}
                      >
                        <div className="flex items-center gap-1.5">
                          <span>{meta.icon}</span>
                          <span className="truncate">{segText(key, locale).title.split(" ")[0]}</span>
                        </div>
                        <div className="mt-1 text-[10px] text-slate-400 font-normal">{t("crm.rfmRecipientsSuffix", { count: fmtNumber(locale, count) })}</div>
                      </button>
                    );
                  })}
                </div>
              </div>

              {/* Message Composer */}
              <div>
                <div className="flex items-center justify-between">
                  <label className="block text-xs font-semibold text-slate-700">{t("crm.rfmMsgContentLabel")}</label>
                  <span className="text-[11px] font-mono text-slate-400">
                    {t("crm.rfmCouponPrefix")} <strong className="text-indigo-600">{SEGMENT_META[selectedBlastSegment]?.promoCode}</strong>
                  </span>
                </div>
                <textarea
                  rows={4}
                  value={blastMessage}
                  onChange={(e) => setBlastMessage(e.target.value)}
                  className="mt-1.5 w-full rounded-xl border border-slate-200 p-3 text-xs leading-relaxed focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500"
                />
              </div>

              {/* Target Numbers Overview */}
              {(() => {
                const targetRows = (data?.rows ?? []).filter((r) => r.segment === selectedBlastSegment);
                const phones = extractSegmentPhoneNumbers(targetRows);
                return (
                  <div className="rounded-xl border border-slate-200 bg-slate-50 p-3">
                    <div className="flex items-center justify-between">
                      <span className="font-semibold text-slate-700">
                        {t("crm.rfmTargetRecipients")} <strong>{t("crm.rfmValidPhonesSuffix", { count: fmtNumber(locale, phones.validCount) })}</strong> {t("crm.rfmValidPhonesNote")}
                      </span>
                      <button
                        type="button"
                        onClick={() => {
                          navigator.clipboard.writeText(phones.textCsv);
                          setCopiedPhonesToast(true);
                          setTimeout(() => setCopiedPhonesToast(false), 3000);
                        }}
                        className="rounded-lg border border-slate-300 bg-white px-2.5 py-1 text-[11px] font-semibold text-slate-700 hover:bg-slate-100"
                      >
                        {copiedPhonesToast ? t("crm.rfmCopyDone") : t("crm.rfmCopyPhoneList")}
                      </button>
                    </div>
                    {phones.validCount > 0 ? (
                      <p className="mt-2 font-mono text-[10px] text-slate-500 line-clamp-2">
                        {phones.textCsv}
                      </p>
                    ) : (
                      <p className="mt-1 text-[11px] text-amber-700">{t("crm.rfmNoPhonesSegment")}</p>
                    )}
                  </div>
                );
              })()}
            </div>

            <div className="flex items-center justify-between border-t bg-slate-50 px-6 py-3.5">
              <span className="text-xs text-slate-500">
                {t("crm.rfmBlastNote")}
              </span>
              <div className="flex gap-2">
                <button
                  type="button"
                  className="rounded-lg border border-slate-200 px-4 py-2 text-xs font-semibold text-slate-600 hover:bg-slate-100"
                  onClick={() => setBlastModalOpen(false)}
                >
                  {t("crm.rfmClose")}
                </button>
                <button
                  type="button"
                  onClick={() => {
                    navigator.clipboard.writeText(blastMessage);
                    setCopiedBlastMsgToast(true);
                    setTimeout(() => setCopiedBlastMsgToast(false), 3000);
                  }}
                  className="rounded-lg border border-indigo-200 bg-white px-3 py-2 text-xs font-semibold text-indigo-700 hover:bg-indigo-50"
                >
                  {copiedBlastMsgToast ? t("crm.rfmMsgCopied") : t("crm.rfmCopyMessage")}
                </button>
                <Link
                  href="/dashboard/messaging"
                  className="btn-primary flex items-center gap-1.5 px-4 py-2 text-xs font-semibold"
                >
                  {t("crm.rfmSendToFestival")}
                </Link>
              </div>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}
