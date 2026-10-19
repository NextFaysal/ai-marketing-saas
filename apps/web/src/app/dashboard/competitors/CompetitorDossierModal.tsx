"use client";
import React from "react";
import { formatMinor } from "@repo/contracts";

export interface Competitor {
  id: string;
  name: string;
  facebookPageId?: string | null;
  facebookPageUrl?: string | null;
  websiteUrl?: string | null;
  notes?: string | null;
  stats: { ads: number; activeAds: number; priceObservations: number };
}

export interface Ad {
  id: string;
  externalAdId: string;
  pageName?: string | null;
  startedAt?: string | null;
  stoppedAt?: string | null;
  isActive: boolean;
  platforms: string[];
  creativeText?: string | null;
  snapshotUrl?: string | null;
  linkUrl?: string | null;
  daysRunning?: number;
  isWinning?: boolean;
  isFresh?: boolean;
}

export interface Obs {
  id: string;
  productName: string;
  priceMinor: string;
  currency: string;
  sourceUrl: string;
  sourceType: string;
  observedAt: string;
}

export interface Insight {
  id: string;
  kind: string;
  title: string;
  detail?: string | null;
  evidence: { ref: string; label: string; url?: string }[];
  provider: string;
  createdAt: string;
}

export interface ComparisonRow {
  productId: string;
  productName: string;
  ownPriceMinor: string;
  currency: string;
  competitorPrices: {
    competitorName: string;
    priceMinor: string;
    currency: string;
    sourceUrl: string;
    diffPercent: number | null;
  }[];
}

export interface DossierData {
  generatedAt: string;
  agencyBranding: {
    organizationName: string;
    currency: string;
    brandSettings?: Record<string, unknown> | null;
  };
  summary: {
    totalCompetitorsTracked: number;
    totalAlertsActive: number;
    priceGapsDetected: number;
  };
  competitors: {
    competitor: Competitor;
    totalAds: number;
    activeAds: number;
    winningAdsCount: number;
    winningAds: Ad[];
    recentAds: Ad[];
    priceObservationsCount: number;
    recentObservations: Obs[];
  }[];
  priceComparisonMatrix: ComparisonRow[];
  liveOpportunityAlerts: Insight[];
  strategicInsights: Insight[];
}

interface CompetitorDossierModalProps {
  isOpen: boolean;
  onClose: () => void;
  loading: boolean;
  data: DossierData | null;
}

export default function CompetitorDossierModal({
  isOpen,
  onClose,
  loading,
  data,
}: CompetitorDossierModalProps) {
  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center modal-backdrop sm:items-center sm:p-4">
      <div className="comp-sheet space-y-6 sm:max-w-4xl sm:p-8">
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-100 pb-4">
          <div className="flex min-w-0 items-center gap-3">
            <div className="comp-brand-bg shrink-0 rounded-lg px-3 py-1 text-xl font-black text-white shadow-sm">
              AGENCY AUDIT
            </div>
            <div className="min-w-0">
              <h3 className="text-lg font-bold text-slate-900">
                {data?.agencyBranding.organizationName || "Client"} Competitor Intelligence Dossier
              </h3>
              <p className="text-xs text-slate-500">
                তারিখ: {data ? new Date(data.generatedAt).toLocaleDateString() : ""} • প্রস্তুতকারক: Marketing Intelligence OS
              </p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={() => window.print()}
              className="btn-dark btn-sm min-h-[40px]"
            >
              🖨️ প্রিন্ট / PDF ডাউনলোড
            </button>
            <button
              onClick={onClose}
              className="flex h-10 w-10 items-center justify-center rounded-full text-slate-400 hover:bg-slate-100 hover:text-slate-700 text-sm"
            >
              ✕
            </button>
          </div>
        </div>

        {loading ? (
          <div className="space-y-5 py-4" aria-hidden="true">
            <div className="grid grid-cols-3 gap-3">
              {[0, 1, 2].map((i) => (
                <div key={i} className="space-y-2 rounded-xl bg-slate-50 p-4 ring-1 ring-inset ring-slate-200/60">
                  <div className="skeleton h-3 w-2/3" />
                  <div className="skeleton h-8 w-1/3" />
                </div>
              ))}
            </div>
            <div className="space-y-2">
              <div className="skeleton h-4 w-1/3" />
              <div className="skeleton h-20 w-full" />
              <div className="skeleton h-20 w-full" />
            </div>
            <p className="text-center text-sm text-slate-500">
              হোয়াইট-লেবেল অডিট রিপোর্ট প্রস্তুত হচ্ছে...
            </p>
          </div>
        ) : data ? (
          <div className="space-y-6 text-sm">
            {/* Executive Summary Cards */}
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
              <div className="rounded-2xl bg-slate-50 p-4 ring-1 ring-inset ring-slate-200/60">
                <span className="stat-label">ট্র্যাকড প্রতিযোগী</span>
                <p className="stat-value">{data.summary.totalCompetitorsTracked}</p>
              </div>
              <div className="rounded-2xl bg-slate-50 p-4 ring-1 ring-inset ring-slate-200/60">
                <span className="stat-label">সক্রিয় অপরচুনিটি অ্যালার্ট</span>
                <p className="stat-value text-amber-600">{data.summary.totalAlertsActive}</p>
              </div>
              <div className="rounded-2xl bg-slate-50 p-4 ring-1 ring-inset ring-slate-200/60">
                <span className="stat-label">মূল্য পার্থক্যের রেকর্ড</span>
                <p className="stat-value text-brand-700">{data.summary.priceGapsDetected}</p>
              </div>
            </div>

            {/* Competitors Detailed Breakdown */}
            <div className="space-y-4">
              <h4 className="font-bold text-slate-900 uppercase tracking-wider text-xs border-b pb-2">
                ১. প্রতিযোগী ব্র্যান্ড বিশ্লেষণ ও উইনিং ক্যাম্পেইন
              </h4>
              {data.competitors.map((item, idx) => (
                <div key={idx} className="rounded-2xl p-4 bg-slate-50/50 space-y-3 ring-1 ring-inset ring-slate-200/60">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <div className="min-w-0">
                      <span className="font-bold text-slate-900 text-base">{item.competitor.name}</span>
                      <span className="ml-2 text-xs text-slate-400">({item.competitor.websiteUrl || "No website"})</span>
                    </div>
                    <div className="text-xs font-semibold text-slate-600">
                      মোট বিজ্ঞাপন: {item.totalAds} • সক্রিয়: {item.activeAds} • 🔥 Winning: {item.winningAdsCount}
                    </div>
                  </div>

                  {item.winningAds.length > 0 ? (
                    <div>
                      <span className="text-xs font-bold text-amber-800">সেরা লাভজনক বিজ্ঞাপন (Winning Ads):</span>
                      <div className="mt-2 space-y-1.5">
                        {item.winningAds.map((w) => (
                          <div key={w.id} className="rounded bg-white p-2.5 text-xs border border-amber-200">
                            <span className="font-semibold text-slate-700">{w.daysRunning} দিন ধরে চলছে:</span>
                            <p className="mt-1 text-slate-800 whitespace-pre-wrap line-clamp-3">{w.creativeText}</p>
                          </div>
                        ))}
                      </div>
                    </div>
                  ) : null}
                </div>
              ))}
            </div>

            {/* Price Gap Matrix */}
            <div className="space-y-3">
              <h4 className="font-bold text-slate-900 uppercase tracking-wider text-xs border-b pb-2">
                ২. বাজার মূল্যের তুলনামূলক ম্যাট্রিক্স
              </h4>
              <div className="table-wrap">
                <table className="w-full text-left text-xs">
                  <thead>
                    <tr>
                      <th>আপনার প্রোডাক্ট</th>
                      <th>আপনার দাম</th>
                      <th>প্রতিযোগীর দাম</th>
                      <th>মূল্যের পার্থক্য</th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.priceComparisonMatrix.slice(0, 8).map((p, i) => (
                      <tr key={i}>
                        <td className="font-medium">{p.productName}</td>
                        <td>{formatMinor(BigInt(p.ownPriceMinor), p.currency)}</td>
                        <td>
                          {p.competitorPrices[0] ? `${p.competitorPrices[0].competitorName}: ${formatMinor(BigInt(p.competitorPrices[0].priceMinor), p.competitorPrices[0].currency)}` : "—"}
                        </td>
                        <td className="font-bold">
                          {p.competitorPrices[0]?.diffPercent !== undefined && p.competitorPrices[0]?.diffPercent !== null
                            ? `${p.competitorPrices[0].diffPercent}%`
                            : "—"}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>

            {/* Footer disclaimer */}
            <div className="border-t pt-3 text-[11px] text-slate-400 text-center">
              গোপনীয়তা চুক্তি: এই রিপোর্টটি ক্লায়েন্টের অভ্যন্তরীণ মার্কেটিং স্ট্র্যাটেজির জন্য সংরক্ষিত। কোনো বাণিজ্যিক বিজ্ঞাপনের অনুমান বা বিক্রয় ডেটা অন্তর্ভুক্ত নয়।
            </div>
          </div>
        ) : null}
      </div>
    </div>
  );
}
