/**
 * Multi-Tier Abandoned Cart WhatsApp Chase Bot Engine
 * Features 15-minute, 1-hour, and 24-hour progressive recovery sequences with dynamic coupon escalations.
 * Optimized for Bangladeshi shoppers, bKash/COD checkouts, and quiet hours compliance.
 */

import { formatCleanPhone, isDhakaQuietHour } from "./abandoned-chase";

export interface TierChaseSequenceConfig {
  enabled: boolean;
  tier1Enabled: boolean;
  tier1DelayMinutes: number; // default: 15
  tier2Enabled: boolean;
  tier2DelayMinutes: number; // default: 60 (1 hr)
  tier2CouponCode: string; // default: SAVE50
  tier2DiscountText: string; // default: ৳৫০ ছাড়
  tier3Enabled: boolean;
  tier3DelayMinutes: number; // default: 1440 (24 hrs)
  tier3CouponCode: string; // default: FINAL100
  tier3DiscountText: string; // default: ৳১০০ ছাড়
  quietHoursRespect: boolean;
  quietHoursStart: number; // 22 (10 PM)
  quietHoursEnd: number; // 8 (8 AM)
}

export const DEFAULT_TIER_CONFIG: TierChaseSequenceConfig = {
  enabled: true,
  tier1Enabled: true,
  tier1DelayMinutes: 15,
  tier2Enabled: true,
  tier2DelayMinutes: 60,
  tier2CouponCode: "SAVE50",
  tier2DiscountText: "৳৫০ স্পেশাল ক্যাশ ছাড়",
  tier3Enabled: true,
  tier3DelayMinutes: 1440,
  tier3CouponCode: "FINAL100",
  tier3DiscountText: "৳১০০ ফাইনাল কুপন ছাড়",
  quietHoursRespect: true,
  quietHoursStart: 22,
  quietHoursEnd: 8,
};

/**
 * Returns customized copy for each tier with appropriate escalation and urgency
 */
export function buildTierMessage(
  tier: 1 | 2 | 3,
  params: {
    productName?: string | null;
    customerName?: string | null;
    checkoutUrl?: string | null;
    storeName?: string;
    config?: Partial<TierChaseSequenceConfig>;
  }
): string {
  const store = params.storeName?.trim() || "আমাদের শপ";
  const name = params.customerName?.trim() || "সম্মানিত গ্রাহক";
  const product = params.productName?.trim() || "আপনার পছন্দের পণ্যসমূহ";
  const link = params.checkoutUrl?.trim() || "https://shop.amarbrand.com/checkout";
  const cfg = { ...DEFAULT_TIER_CONFIG, ...(params.config || {}) };

  if (tier === 1) {
    // Tier 1: 15 minutes - Gentle nudge & Stock reservation notice
    return `আসসালামু আলাইকুম ${name}! ${store}-এ (${product}) পণ্যটি আপনার জন্য কার্টে সংরক্ষিত আছে। 

কোনো কারণে কি অর্ডারটি অসম্পূর্ণ রয়ে গেছে? আমাদের স্টক দ্রুত ফুরিয়ে যাচ্ছে। এখনই ১ ক্লিকে ক্যাশ অন ডেলিভারিতে অর্ডার কনফার্ম করুন:
👉 ${link}

কোনো সহায়তা বা তথ্যের প্রয়োজন হলে এই মেসেজেই রিপ্লাই দিন।`;
  }

  if (tier === 2) {
    // Tier 2: 1 hour - Incentive Offer & Coupon Code
    const coupon = cfg.tier2CouponCode;
    const discount = cfg.tier2DiscountText;
    return `আসসালামু আলাইকুম ${name}! আপনার কার্টে থাকা (${product}) এর জন্য আমরা একটি বিশেষ ছাড় উপহার দিচ্ছি 🎁

চেকআউটে কুপন কোড ব্যবহার করে পান ${discount}:
🎟️ কুপন কোড: *${coupon}*

অর্ডার সম্পন্ন করার লিংক:
👉 ${link}

অফারটি আগামী ২ ঘণ্টার জন্য কার্যকর থাকবে। ধন্যবাদ!`;
  }

  // Tier 3: 24 hours - Final Urgency & Escalated Clearance Discount
  const finalCoupon = cfg.tier3CouponCode;
  const finalDiscount = cfg.tier3DiscountText;
  return `আসসালামু আলাইকুম ${name}! এটি আপনার জন্য শেষ সুযোগ ⏳ 

${store}-এ আপনার কার্টের (${product}) এর স্টক আজ রাতে রিলিজ হয়ে যাবে। শেষবারের মতো আপনার জন্য অতিরিক্ত ${finalDiscount} যুক্ত করা হয়েছে:
🔥 ফাইনাল কুপন: *${finalCoupon}*

এখনই অর্ডার ফাইনাল করুন:
👉 ${link}

আপনার পছন্দের পণ্যটি মিস করবেন না!`;
}

/**
 * Determines which tier is due based on time elapsed since abandonment and prior attempts
 */
export function determineCurrentChaseTier(
  abandonedAtIso: string,
  attemptsCount = 0,
  config = DEFAULT_TIER_CONFIG
): {
  nextTier: 1 | 2 | 3 | null;
  isReady: boolean;
  minutesElapsed: number;
  waitMessageBangla: string;
} {
  const abandonedTime = new Date(abandonedAtIso).getTime();
  const now = Date.now();
  const minutesElapsed = Math.max(0, Math.floor((now - abandonedTime) / 60000));

  if (attemptsCount >= 3) {
    return {
      nextTier: null,
      isReady: false,
      minutesElapsed,
      waitMessageBangla: "সর্বোচ্চ ৩টি সিকোয়েন্স সম্পন্ন হয়েছে।",
    };
  }

  if (attemptsCount === 0) {
    const isReady = minutesElapsed >= config.tier1DelayMinutes;
    return {
      nextTier: 1,
      isReady,
      minutesElapsed,
      waitMessageBangla: isReady
        ? "টিয়ার ১ (১৫ মিনিট) পাঠানোর সময় হয়েছে।"
        : `টিয়ার ১-এর জন্য আরও ${config.tier1DelayMinutes - minutesElapsed} মিনিট অপেক্ষা করতে হবে।`,
    };
  }

  if (attemptsCount === 1) {
    const isReady = minutesElapsed >= config.tier2DelayMinutes;
    return {
      nextTier: 2,
      isReady,
      minutesElapsed,
      waitMessageBangla: isReady
        ? "টিয়ার ২ (১ ঘণ্টা - ৳৫০ ছাড়) পাঠানোর সময় হয়েছে।"
        : `টিয়ার ২-এর জন্য আরও ${Math.max(1, config.tier2DelayMinutes - minutesElapsed)} মিনিট বাকি।`,
    };
  }

  // attemptsCount === 2
  const isReady = minutesElapsed >= config.tier3DelayMinutes;
  return {
    nextTier: 3,
    isReady,
    minutesElapsed,
    waitMessageBangla: isReady
      ? "টিয়ার ৩ (২৪ ঘণ্টা - ৳১০০ ফাইনাল ছাড়) পাঠানোর সময় হয়েছে।"
      : `টিয়ার ৩-এর জন্য আরও ${Math.max(1, Math.round((config.tier3DelayMinutes - minutesElapsed) / 60))} ঘণ্টা বাকি।`,
  };
}

/**
 * Projects recovery rate and ROI based on tiered sequences
 */
export function calculateSequenceRecoveryRoi(
  abandonedCount: number,
  avgOrderValueTaka = 1500,
  tier1Rate = 8.5,
  tier2Rate = 6.2,
  tier3Rate = 3.8
): {
  recoveredOrders: number;
  recoveredRevenueTaka: number;
  tier1Count: number;
  tier2Count: number;
  tier3Count: number;
  overallRecoveryRatePct: number;
} {
  const count = Math.max(0, abandonedCount);
  const t1 = Math.round((count * tier1Rate) / 100);
  const t2 = Math.round((count * tier2Rate) / 100);
  const t3 = Math.round((count * tier3Rate) / 100);

  const totalRecovered = t1 + t2 + t3;
  const recoveredRevenueTaka = totalRecovered * avgOrderValueTaka;
  const overallRate = count > 0 ? Number(((totalRecovered / count) * 100).toFixed(1)) : 0;

  return {
    recoveredOrders: totalRecovered,
    recoveredRevenueTaka,
    tier1Count: t1,
    tier2Count: t2,
    tier3Count: t3,
    overallRecoveryRatePct: overallRate,
  };
}
