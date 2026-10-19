import { fmtMoneyMinor, fmtNumber } from "@repo/contracts";
import type { UiLocale } from "./i18n/dict";
import { tr } from "./i18n/lookup";
import { aiBn, aiEn } from "./i18n/ai";

const AI_DICTS = { bn: aiBn, en: aiEn };
/** MB2 (ML6): recommendation copy reads the `ai` namespace;
 * locale defaults to "bn" so existing callers keep today's copy. */
function L(locale: UiLocale | undefined, key: string, params?: Record<string, string | number>): string {
  return tr(AI_DICTS, locale ?? "bn", key, params) ?? key;
}

export interface PlanMetricInput {
  id: string;
  name: string;
  status: string;
  metaStatus?: string | null;
  performance?: {
    spendMinor: string;
    impressions: number;
    clicks: number;
    conversions: number;
    ctrPercent: number | null;
    cpaMinor: string | null;
  } | null;
  fatigue?: {
    frequency?: number | null;
    ctrDropPercent?: number | null;
    fatigued?: boolean;
  } | null;
}

export interface MediaBuyerRecommendation {
  id: string;
  type: "scale_budget" | "pause_loss" | "creative_refresh" | "ab_test_opportunity";
  severity: "high" | "medium" | "opportunity";
  badgeLabel: string;
  title: string;
  campaignName: string;
  planId: string;
  reason: string;
  metricBadge: string;
  suggestedActionLabel: string;
  proposalType?: "pause_campaign" | "pause_ad_set";
  actionUrl?: string;
}

/**
 * Analyzes active campaign plans and generates mathematically grounded,
 * honest marketing optimization recommendations.
 */
export function generateMediaBuyerRecommendations(
  plans: PlanMetricInput[],
  locale: UiLocale = "bn"
): MediaBuyerRecommendation[] {
  const recommendations: MediaBuyerRecommendation[] = [];

  for (const p of plans) {
    const perf = p.performance;
    const spend = BigInt(perf?.spendMinor || 0);
    const convs = perf?.conversions ?? 0;
    const isLive = p.status === "published" || p.metaStatus === "ACTIVE";

    // 1. Creative Fatigue Check (Highest Priority)
    if (p.fatigue?.fatigued || (p.fatigue?.frequency && p.fatigue.frequency >= 3.5 && (p.fatigue?.ctrDropPercent ?? 0) >= 30)) {
      recommendations.push({
        id: `fatigue-${p.id}`,
        type: "creative_refresh",
        severity: "high",
        badgeLabel: L(locale, "advFatigueBadge"),
        title: L(locale, "advFatigueTitle"),
        campaignName: p.name,
        planId: p.id,
        reason: L(locale, "advFatigueReason", { freq: p.fatigue.frequency?.toFixed(1) ?? "", drop: p.fatigue.ctrDropPercent ?? 30 }),
        metricBadge: `Freq: ${p.fatigue.frequency?.toFixed(1)}x`,
        suggestedActionLabel: L(locale, "advFatigueAction"),
        actionUrl: "/dashboard/creative-studio",
      });
      continue;
    }

    // 2. High Spend with Zero/Low Conversions (Stop the Leak)
    // Spend >= ৳200 (20000 minor units) and 0 conversions
    if (isLive && spend >= 20000n && convs === 0) {
      let spendFormatted = L(locale, "advLeakSpendFallback");
      try {
        spendFormatted = fmtMoneyMinor(locale, spend);
      } catch {
        // fallback
      }
      recommendations.push({
        id: `leak-${p.id}`,
        type: "pause_loss",
        severity: "high",
        badgeLabel: L(locale, "advLeakBadge"),
        title: L(locale, "advLeakTitle"),
        campaignName: p.name,
        planId: p.id,
        reason: L(locale, "advLeakReason", { spend: spendFormatted }),
        metricBadge: L(locale, "advLeakMetric", { spend: spendFormatted }),
        suggestedActionLabel: L(locale, "advLeakAction"),
        proposalType: "pause_campaign",
      });
      continue;
    }

    // 3. High Performing Winner (Scale Opportunity)
    // Conversions >= 4 and CTR >= 1.2% and CPA is reasonable
    if (isLive && convs >= 4 && (perf?.ctrPercent ?? 0) >= 1.2) {
      let cpaFormatted = "";
      if (perf?.cpaMinor) {
        try {
          cpaFormatted = fmtMoneyMinor(locale, BigInt(perf.cpaMinor));
        } catch {
          // fallback
        }
      }
      recommendations.push({
        id: `scale-${p.id}`,
        type: "scale_budget",
        severity: "opportunity",
        badgeLabel: L(locale, "advScaleBadge"),
        title: L(locale, "advScaleTitle"),
        campaignName: p.name,
        planId: p.id,
        reason: L(locale, "advScaleReason", { convs: fmtNumber(locale, convs), ctr: perf?.ctrPercent ?? "", cpaPart: cpaFormatted ? L(locale, "advScaleCpaPart", { cpa: cpaFormatted }) : "" }),
        metricBadge: L(locale, "advScaleMetric", { convs: fmtNumber(locale, convs), ctr: perf?.ctrPercent ?? "" }),
        suggestedActionLabel: L(locale, "advScaleAction"),
        actionUrl: `/dashboard/campaign-builder?id=${p.id}`,
      });
      continue;
    }

    // 4. Large Audience with no A/B test (Test Opportunity)
    if (isLive && (perf?.impressions ?? 0) >= 5000 && convs >= 1) {
      recommendations.push({
        id: `ab-${p.id}`,
        type: "ab_test_opportunity",
        severity: "medium",
        badgeLabel: L(locale, "advAbBadge"),
        title: L(locale, "advAbTitle"),
        campaignName: p.name,
        planId: p.id,
        reason: L(locale, "advAbReason", { impressions: fmtNumber(locale, perf?.impressions ?? 0) }),
        metricBadge: L(locale, "advAbMetric", { impressions: fmtNumber(locale, perf?.impressions ?? 0) }),
        suggestedActionLabel: L(locale, "advAbAction"),
        actionUrl: "/dashboard/campaigns",
      });
    }
  }

  // Sort: High severity first, then opportunity, then medium
  const order: Record<string, number> = { high: 0, opportunity: 1, medium: 2 };
  return recommendations.sort((a, b) => (order[a.severity] ?? 9) - (order[b.severity] ?? 9));
}
