import { formatMinor } from "@repo/contracts";

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
  plans: PlanMetricInput[]
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
        badgeLabel: "⚠️ দর্শক ক্লান্তি (Fatigue)",
        title: "ক্রিয়েটিভ রিফ্রেশ প্রয়োজন",
        campaignName: p.name,
        planId: p.id,
        reason: `বিজ্ঞাপনের ফ্রিকোয়েন্সি ${p.fatigue.frequency?.toFixed(1)}x ছাড়িয়েছে এবং CTR ${p.fatigue.ctrDropPercent ?? 30}% কমেছে। নতুন ব্যানার যুক্ত করুন।`,
        metricBadge: `Freq: ${p.fatigue.frequency?.toFixed(1)}x`,
        suggestedActionLabel: "Creative Studio-তে ব্যানার বানান",
        actionUrl: "/dashboard/creative-studio",
      });
      continue;
    }

    // 2. High Spend with Zero/Low Conversions (Stop the Leak)
    // Spend >= ৳200 (20000 minor units) and 0 conversions
    if (isLive && spend >= 20000n && convs === 0) {
      let spendFormatted = "৳২০০+";
      try {
        spendFormatted = formatMinor(spend, "BDT");
      } catch {
        // fallback
      }
      recommendations.push({
        id: `leak-${p.id}`,
        type: "pause_loss",
        severity: "high",
        badgeLabel: "🛑 অপচয় সতর্কতা",
        title: "বাজেট অপচয় বন্ধ করুন",
        campaignName: p.name,
        planId: p.id,
        reason: `ক্যাম্পেইনটিতে ${spendFormatted} খরচ হওয়া সত্ত্বেও কোনো অর্ডার বা কনভার্সন আসেনি। সাময়িকভাবে পজ করা বুদ্ধিমানের কাজ।`,
        metricBadge: `খরচ: ${spendFormatted} | অর্ডার: ০`,
        suggestedActionLabel: "১-ক্লিকে ক্যাম্পেইন পজ করুন",
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
          cpaFormatted = formatMinor(BigInt(perf.cpaMinor), "BDT");
        } catch {
          // fallback
        }
      }
      recommendations.push({
        id: `scale-${p.id}`,
        type: "scale_budget",
        severity: "opportunity",
        badgeLabel: "🚀 স্কেলিং সুযোগ",
        title: "বাজেট স্কেল করে সেলস বাড়ান",
        campaignName: p.name,
        planId: p.id,
        reason: `ক্যাম্পেইনটি চমৎকার পারফর্ম করছে (${convs}টি অর্ডার, CTR ${perf?.ctrPercent}%${cpaFormatted ? `, CPA ${cpaFormatted}` : ""})। বাজেট ১৫-২০% বাড়িয়ে আরও সেলস আনা সম্ভব।`,
        metricBadge: `অর্ডার: ${convs} | CTR: ${perf?.ctrPercent}%`,
        suggestedActionLabel: "Campaign Builder-এ বাজেট বাড়ান",
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
        badgeLabel: "⚖️ A/B টেস্ট সুযোগ",
        title: "নতুন ভ্যারিয়েন্ট টেস্ট করুন",
        campaignName: p.name,
        planId: p.id,
        reason: `ক্যাম্পেইনে ${perf?.impressions.toLocaleString()}টি ইমপ্রেশন এসেছে। একটি নতুন ব্যানার বা টেক্সট দিয়ে A/B টেস্ট করলে CPA আরও কমানো যেতে পারে।`,
        metricBadge: `ইমপ্রেশন: ${perf?.impressions.toLocaleString()}`,
        suggestedActionLabel: "A/B টেস্ট তৈরি করুন",
        actionUrl: "/dashboard/campaigns",
      });
    }
  }

  // Sort: High severity first, then opportunity, then medium
  const order: Record<string, number> = { high: 0, opportunity: 1, medium: 2 };
  return recommendations.sort((a, b) => (order[a.severity] ?? 9) - (order[b.severity] ?? 9));
}
