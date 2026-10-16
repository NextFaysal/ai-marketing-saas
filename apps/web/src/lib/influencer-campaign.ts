export type SocialPlatform = "instagram" | "youtube" | "tiktok" | "facebook" | "other";

export interface InfluencerTrackParams {
  baseUrl: string;
  code: string;
  platform: SocialPlatform;
  campaignName?: string;
}

export interface InfluencerRoiSummary {
  revenueMinor: bigint;
  spendMinor: bigint;
  ordersCount: number;
  roiMultiplier: number | null;
  profitable: boolean;
}

export const SOCIAL_PLATFORMS: { id: SocialPlatform; label: string; icon: string }[] = [
  { id: "instagram", label: "Instagram", icon: "📷" },
  { id: "facebook", label: "Facebook", icon: "📘" },
  { id: "youtube", label: "YouTube", icon: "▶️" },
  { id: "tiktok", label: "TikTok", icon: "🎵" },
  { id: "other", label: "অন্যান্য / ব্লগ", icon: "🌐" },
];

/**
 * Builds a clean, fully tagged influencer tracking link
 * incorporating referral ref code and standard UTM parameters.
 */
export function generateInfluencerTrackingUrl(params: InfluencerTrackParams): string {
  const base = params.baseUrl.replace(/\/$/, "");
  const cleanCode = params.code.trim().toUpperCase();
  const camp = (params.campaignName || "influencer").trim().toLowerCase().replace(/[^a-z0-9]/g, "_");

  const url = new URL(base.startsWith("http") ? base : `https://${base}`);
  url.searchParams.set("ref", cleanCode);
  url.searchParams.set("utm_source", params.platform);
  url.searchParams.set("utm_medium", "influencer");
  url.searchParams.set("utm_campaign", camp);

  return url.toString();
}

/**
 * Computes ROI from sales revenue generated and total payout cost.
 */
export function calculateInfluencerRoi(
  revenueMinor: bigint | number | string,
  totalCostMinor: bigint | number | string,
  ordersCount: number
): InfluencerRoiSummary {
  const rev = BigInt(revenueMinor || 0);
  const cost = BigInt(totalCostMinor || 0);

  let multiplier: number | null = null;
  if (cost > 0n) {
    multiplier = Math.round((Number(rev) / Number(cost)) * 100) / 100;
  }

  return {
    revenueMinor: rev,
    spendMinor: cost,
    ordersCount,
    roiMultiplier: multiplier,
    profitable: multiplier !== null && multiplier >= 1.0,
  };
}

export function getPlatformMeta(platform: string): { label: string; icon: string } {
  return SOCIAL_PLATFORMS.find((p) => p.id === platform) ?? { label: platform, icon: "⭐" };
}
