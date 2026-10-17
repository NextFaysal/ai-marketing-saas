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

export interface CampaignSimulationParams {
  fixedFeeBdt: number;
  commissionPercent: number;
  estimatedViews: number;
  engagementRatePercent: number;
  conversionRatePercent: number;
  averageOrderValueBdt: number;
}

export interface CampaignSimulationResult {
  expectedClicks: number;
  expectedOrders: number;
  expectedRevenueBdt: number;
  expectedCommissionBdt: number;
  totalCostBdt: number;
  netProfitBdt: number;
  estimatedRoas: number;
  breakEvenOrders: number;
  isProfitable: boolean;
}

export interface InfluencerWhatsAppBriefingParams {
  creatorName: string;
  brandName: string;
  promoCode: string;
  trackingUrl: string;
  commissionPercent: number;
  paymentTerms?: string;
  phone?: string;
}

export interface PayoutReceiptParams {
  creatorName: string;
  brandName: string;
  amountBdt: number | string;
  method: string;
  reference?: string | null;
  date?: string;
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

/**
 * Simulates campaign profitability and break-even order volume
 * before booking or contracting an influencer.
 */
export function simulateInfluencerCampaign(params: CampaignSimulationParams): CampaignSimulationResult {
  const views = Math.max(0, params.estimatedViews || 0);
  const engRate = Math.max(0, params.engagementRatePercent || 0) / 100;
  const convRate = Math.max(0, params.conversionRatePercent || 0) / 100;
  const aov = Math.max(0, params.averageOrderValueBdt || 0);
  const fixed = Math.max(0, params.fixedFeeBdt || 0);
  const commPct = Math.max(0, Math.min(100, params.commissionPercent || 0));

  const expectedClicks = Math.round(views * engRate);
  const expectedOrders = Math.round(expectedClicks * convRate);
  const expectedRevenueBdt = Math.round(expectedOrders * aov);
  const expectedCommissionBdt = Math.round((expectedRevenueBdt * commPct) / 100);
  const totalCostBdt = fixed + expectedCommissionBdt;
  const netProfitBdt = expectedRevenueBdt - totalCostBdt;

  let estimatedRoas = 0;
  if (totalCostBdt > 0) {
    estimatedRoas = Math.round((expectedRevenueBdt / totalCostBdt) * 100) / 100;
  }

  // Margin per order after commission
  const revenuePerOrderAfterComm = aov * (1 - commPct / 100);
  let breakEvenOrders = 0;
  if (fixed > 0 && revenuePerOrderAfterComm > 0) {
    breakEvenOrders = Math.ceil(fixed / revenuePerOrderAfterComm);
  }

  return {
    expectedClicks,
    expectedOrders,
    expectedRevenueBdt,
    expectedCommissionBdt,
    totalCostBdt,
    netProfitBdt,
    estimatedRoas,
    breakEvenOrders,
    isProfitable: netProfitBdt >= 0,
  };
}

/**
 * Normalizes Bangladeshi phone numbers into an international wa.me format.
 */
export function formatBdPhoneForWhatsApp(phone: string): string {
  const digits = phone.replace(/\D/g, "");
  if (digits.startsWith("880")) return digits;
  if (digits.startsWith("0")) return `88${digits}`;
  return digits;
}

/**
 * Generates an onboarding & promo kit WhatsApp message in Bengali
 * tailored for Bangladeshi content creators.
 */
export function buildInfluencerWhatsAppBriefing(params: InfluencerWhatsAppBriefingParams): string {
  const terms = params.paymentTerms || "বিকাশ / নগদ / ব্যাংক অ্যাকাউন্টে প্রতি মাসের ১ ও ১৫ তারিখে";
  return `সালাম/হ্যালো ${params.creatorName}! 🌟

${params.brandName}-এর পক্ষ থেকে আপনাকে ইনফ্লুয়েন্সার পার্টনারশিপে আন্তরিক স্বাগতম।

আপনার জন্য কাস্টম ট্র্যাকিং ও প্রমো ডিটেইলস প্রস্তুত করা হয়েছে:
🏷️ আপনার কুপন কোড: *${params.promoCode.toUpperCase()}* (আপনার অডিয়েন্সকে বিশেষ ছাড়ের জন্য)
🔗 আপনার ইউনিক ট্র্যাকিং লিঙ্ক: ${params.trackingUrl}
💰 আপনার অর্জিত কমিশন: প্রতিটি সফল ডেলিভারিতে *${params.commissionPercent}%*
💳 পেআউট শর্তাবলী: ${terms}

📌 টিপস: আপনার টিকটক বায়ো, ইনস্টাগ্রাম স্টোরি/রিলস ডেসক্রিপশন অথবা ইউটিউব ভিডিও ক্যাপশনে এই লিঙ্কটি যুক্ত করুন। যে কেউ এই লিঙ্ক ব্যবহার করে বা কুপন কোড দিয়ে অর্ডার করলেই আপনার ড্যাশবোর্ডে কমিশন জমা হবে।

যেকোনো সহায়তায় আমাদের সাথে যোগাযোগ করুন। আপনার ক্যাম্পেইনের জন্য শুভকামনা! 🚀`.trim();
}

/**
 * Builds a direct wa.me deep link with pre-filled message text.
 */
export function buildInfluencerWhatsAppUrl(phone: string, text: string): string {
  const cleanPhone = formatBdPhoneForWhatsApp(phone);
  return `https://wa.me/${cleanPhone}?text=${encodeURIComponent(text)}`;
}

/**
 * Generates a commission payout voucher receipt text for WhatsApp/SMS.
 */
export function buildPayoutReceiptText(params: PayoutReceiptParams): string {
  const methodMap: Record<string, string> = {
    bkash: "bKash (বিকাশ)",
    nagad: "Nagad (নগদ)",
    rocket: "Rocket (রকেট)",
    bank: "Bank Transfer",
    cash: "Cash (নগদ টাকা)",
    other: "Other",
  };
  const mLabel = methodMap[params.method.toLowerCase()] || params.method;
  const refText = params.reference ? `\n🧾 ট্রানজেকশন আইডি / রেফারেন্স: *${params.reference}*` : "";
  const dateText = params.date || new Date().toLocaleDateString("en-GB");

  return `✅ কমিশন পেআউট সম্পন্ন — ${params.brandName}

প্রিয় ${params.creatorName},
আপনার ইনফ্লুয়েন্সার পার্টনারশিপের অর্জিত কমিশন বাবদ ৳${params.amountBdt} ${mLabel}-এ সফলভাবে ট্রান্সফার করা হয়েছে।${refText}
📅 তারিখ: ${dateText}

আমাদের সাথে পার্টনারশিপ অব্যাহত রাখার জন্য আন্তরিক ধন্যবাদ! 🌟`.trim();
}
