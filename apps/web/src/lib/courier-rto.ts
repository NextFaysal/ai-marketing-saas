/**
 * Courier Delivery Success & Return/RTO Prediction Engine
 * Analyzes past courier history (Steadfast, Pathao, RedX, eCourier), predicts RTO return risk,
 * suggests advance delivery charges (৳100 - ৳200), and generates 1-click WhatsApp advance payment requests.
 */

import { formatCleanPhone } from "./abandoned-chase";

export type RtoRiskBand = "low" | "medium" | "high";

export interface CourierHistory {
  delivered: number;
  returned: number;
  cancelledOrFailed?: number;
  totalOrders?: number;
}

export interface RtoEvaluation {
  successRate: number | null; // 0 - 100
  rtoRate: number | null; // 0 - 100
  band: RtoRiskBand;
  badgeText: string;
  badgeColor: string;
  reasons: string[];
  recommendedAdvanceTaka: number;
  requiresAdvance: boolean;
}

/**
 * Normalizes and determines default delivery charge based on district / address.
 */
export function estimateDistrictDeliveryCharge(districtOrAddress?: string | null): number {
  const text = String(districtOrAddress ?? "").toLowerCase().trim();
  if (!text) return 150; // Default outside Dhaka

  const isDhakaMetro =
    text.includes("dhaka") ||
    text.includes("ঢাকা") ||
    text.includes("mirpur") ||
    text.includes("মিরপুর") ||
    text.includes("uttara") ||
    text.includes("উত্তরা") ||
    text.includes("dhanmondi") ||
    text.includes("ধানমন্ডি") ||
    text.includes("gulshan") ||
    text.includes("গুলশান") ||
    text.includes("banani") ||
    text.includes("বনানী") ||
    text.includes("mohammadpur") ||
    text.includes("মোহাম্মদপুর");

  if (isDhakaMetro) {
    return 100;
  }

  const isRemote =
    text.includes("উপজেলা") ||
    text.includes("upazila") ||
    text.includes("thana") ||
    text.includes("থানা") ||
    text.includes("union") ||
    text.includes("ইউনিয়ন") ||
    text.includes("gram") ||
    text.includes("গ্রাম") ||
    text.includes("char") ||
    text.includes("চর") ||
    text.includes("bandarban") ||
    text.includes("বান্দরবান") ||
    text.includes("rangamati") ||
    text.includes("রাঙ্গামাটি") ||
    text.includes("khagrachhari") ||
    text.includes("খাগড়াছড়ি");

  if (isRemote) {
    return 200;
  }

  return 150;
}

/**
 * Evaluates Courier RTO risk based on past delivery performance, order value, and address.
 */
export function evaluateRtoRisk(params: {
  history?: CourierHistory | null;
  totalTaka?: number;
  districtOrAddress?: string | null;
  isCod?: boolean;
}): RtoEvaluation {
  const history = params.history;
  const delivered = Math.max(0, history?.delivered ?? 0);
  const returned = Math.max(0, history?.returned ?? 0);
  const decided = delivered + returned;
  const totalTaka = params.totalTaka ?? 0;
  const recommendedAdvanceTaka = estimateDistrictDeliveryCharge(params.districtOrAddress);

  const reasons: string[] = [];

  // No prior history
  if (decided === 0) {
    if (totalTaka >= 3500) {
      reasons.push(`নতুন কাস্টমারের উচ্চ মূল্যের COD অর্ডার (৳${totalTaka.toLocaleString("en-IN")})`);
      return {
        successRate: null,
        rtoRate: null,
        band: "medium",
        badgeText: "সতর্কতা (নতুন উচ্চমূল্য)",
        badgeColor: "bg-amber-100 text-amber-800 border-amber-300",
        reasons,
        recommendedAdvanceTaka,
        requiresAdvance: true,
      };
    }

    reasons.push("কোনো পূর্ববর্তী কুরিয়ার ইতিহাস নেই (প্রথম অর্ডার)");
    return {
      successRate: null,
      rtoRate: null,
      band: "low",
      badgeText: "নতুন কাস্টমার",
      badgeColor: "bg-slate-100 text-slate-700 border-slate-300",
      reasons,
      recommendedAdvanceTaka,
      requiresAdvance: false,
    };
  }

  const successRate = Math.round((delivered / decided) * 100);
  const rtoRate = Math.round((returned / decided) * 100);

  // High Risk Criteria: Multiple returns AND success rate < 70% OR 3+ returned
  if (returned >= 3 || (returned >= 1 && successRate < 60) || successRate <= 50) {
    reasons.push(`কুরিয়ার ডেলিভারি সাকসেস রেট মাত্র ${successRate}% (${decided} টির মধ্যে ${returned} টি রিটার্ন)`);
    if (returned >= 2) reasons.push(`${returned} বার পার্সেল রিসিভ না করে ফেরত পাঠিয়েছেন`);
    return {
      successRate,
      rtoRate,
      band: "high",
      badgeText: `উচ্চ RTO ঝুঁকি (${rtoRate}% রিটার্ন)`,
      badgeColor: "bg-red-100 text-red-800 border-red-300",
      reasons,
      recommendedAdvanceTaka,
      requiresAdvance: true,
    };
  }

  // Medium Risk: Success rate between 60% and 80%, or returned = 1
  if (successRate < 80 || returned >= 1 || (totalTaka >= 4000 && successRate < 90)) {
    reasons.push(`ডেলিভারি সাকসেস রেট ${successRate}% (${delivered} ডেলিভার্ড, ${returned} রিটার্ন)`);
    if (totalTaka >= 4000) reasons.push(`উচ্চ মূল্যের অর্ডার (৳${totalTaka.toLocaleString("en-IN")})`);
    return {
      successRate,
      rtoRate,
      band: "medium",
      badgeText: `মাঝারি ঝুঁকি (${successRate}% সাকসেস)`,
      badgeColor: "bg-amber-100 text-amber-800 border-amber-300",
      reasons,
      recommendedAdvanceTaka,
      requiresAdvance: true,
    };
  }

  // Low Risk: High delivery success rate (>= 80%)
  reasons.push(`চমৎকার কুরিয়ার ট্র্যাক রেকর্ড (${successRate}% সফল ডেলিভারি)`);
  return {
    successRate,
    rtoRate,
    band: "low",
    badgeText: `নিরাপদ ক্রেতা (${successRate}% সাকসেস)`,
    badgeColor: "bg-emerald-100 text-emerald-800 border-emerald-300",
    reasons,
    recommendedAdvanceTaka,
    requiresAdvance: false,
  };
}

/**
 * Builds high-converting Bengali Advance Delivery Charge Message.
 */
export function buildAdvanceCodMessage(params: {
  customerName?: string | null;
  orderNumber: string;
  itemSummary?: string | null;
  advanceAmount: number;
  dueAmount: number;
  paymentMethod: "bkash" | "nagad" | "rocket";
  paymentNumber: string;
  isMerchantAccount?: boolean;
}): string {
  const name = params.customerName?.trim() || "সম্মানিত গ্রাহক";
  const items = params.itemSummary?.trim() ? ` (${params.itemSummary.trim()})` : "";
  const methodLabel = params.paymentMethod === "bkash" ? "বিকাশ" : params.paymentMethod === "nagad" ? "নগদ" : "রকেট";
  const accType = params.isMerchantAccount ? "মার্চেন্ট (Payment)" : "পার্সোনাল (Send Money)";

  return (
    `আসসালামু আলাইকুম ${name}!\n` +
    `আমাদের শপে আপনার #${params.orderNumber} অর্ডারটির${items} জন্য ধন্যবাদ।\n\n` +
    `পার্সেলটি প্যাকেজিং ও কুরিয়ারে বুকিং নিশ্চিত করার জন্য অনুগ্রহ করে ডেলিভারি চার্জ *৳${params.advanceAmount}* অগ্রিম প্রদান করুন:\n\n` +
    `📱 ${methodLabel} নম্বর: *${params.paymentNumber}* (${accType})\n` +
    `🔖 রেফারেন্স: *${params.orderNumber}*\n\n` +
    `পেমেন্ট সম্পন্ন করার পর ট্রানজেকশন আইডি (TrxID) দিয়ে মেসেজটি রিপ্লাই দিন। বাকি *৳${params.dueAmount}* পার্সেল হাতে পাওয়ার পর প্রদান করবেন। ধন্যবাদ!`
  );
}

/**
 * Generates direct wa.me link with encoded advance request message.
 */
export function buildAdvanceWhatsAppLink(phone: string, message: string): string {
  const clean = formatCleanPhone(phone);
  if (!clean) return "";
  return `https://wa.me/${clean}?text=${encodeURIComponent(message)}`;
}
