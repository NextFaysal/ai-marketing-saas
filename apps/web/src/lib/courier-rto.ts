/**
 * Courier Delivery Success & Return/RTO Prediction Engine
 * Analyzes past courier history (Steadfast, Pathao, RedX, eCourier), predicts RTO return risk,
 * suggests advance delivery charges (৳100 - ৳200), and generates 1-click WhatsApp advance payment requests.
 */

import { fmtNumber } from "@repo/contracts";
import { formatCleanPhone } from "./abandoned-chase";
import { ordersBn, ordersEn } from "@/lib/i18n/orders";
import { interpolate } from "@/lib/i18n/lookup";

/** ML5 i18n: locale for lib label helpers — defaults to bn so
 * existing callers and tests keep the Bengali copy. */
export type LibLocale = "bn" | "en";
const D = (locale?: string): typeof ordersBn =>
  locale === "en" ? ordersEn : ordersBn;

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
    text.includes(ordersBn.dhaka) ||
    text.includes("mirpur") ||
    text.includes(ordersBn.mirpur) ||
    text.includes("uttara") ||
    text.includes(ordersBn.uttara) ||
    text.includes("dhanmondi") ||
    text.includes(ordersBn.dhanmondi) ||
    text.includes("gulshan") ||
    text.includes(ordersBn.gulshan) ||
    text.includes("banani") ||
    text.includes(ordersBn.banani) ||
    text.includes("mohammadpur") ||
    text.includes(ordersBn.mohammadpur);

  if (isDhakaMetro) {
    return 100;
  }

  const isRemote =
    text.includes(ordersBn.upazila) ||
    text.includes("upazila") ||
    text.includes("thana") ||
    text.includes(ordersBn.thana2) ||
    text.includes("union") ||
    text.includes(ordersBn.union) ||
    text.includes("gram") ||
    text.includes(ordersBn.village) ||
    text.includes("char") ||
    text.includes(ordersBn.char) ||
    text.includes("bandarban") ||
    text.includes(ordersBn.bandarban) ||
    text.includes("rangamati") ||
    text.includes(ordersBn.rangamati) ||
    text.includes("khagrachhari") ||
    text.includes(ordersBn.khagrachhari);

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
  locale?: LibLocale;
}): RtoEvaluation {
  const locale = params.locale ?? "bn";
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
      reasons.push(interpolate(D(locale).newCustomerSHighValue, { totalTaka: fmtNumber(locale, totalTaka) }));
      return {
        successRate: null,
        rtoRate: null,
        band: "medium",
        badgeText: D(locale).cautionNewHighValue,
        badgeColor: "bg-amber-100 text-amber-800 border-amber-300",
        reasons,
        recommendedAdvanceTaka,
        requiresAdvance: true,
      };
    }

    reasons.push(D(locale).noPreviousCourierHistoryFirst);
    return {
      successRate: null,
      rtoRate: null,
      band: "low",
      badgeText: D(locale).newCustomer2,
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
    reasons.push(interpolate(D(locale).courierDeliverySuccessRateIs, { successRate: successRate, decided: decided, returned: returned }));
    if (returned >= 2) reasons.push(interpolate(D(locale).returnedParcelsTimesWithoutReceiving, { returned: returned }));
    return {
      successRate,
      rtoRate,
      band: "high",
      badgeText: interpolate(D(locale).highRtoRiskReturns, { rtoRate: rtoRate }),
      badgeColor: "bg-red-100 text-red-800 border-red-300",
      reasons,
      recommendedAdvanceTaka,
      requiresAdvance: true,
    };
  }

  // Medium Risk: Success rate between 60% and 80%, or returned = 1
  if (successRate < 80 || returned >= 1 || (totalTaka >= 4000 && successRate < 90)) {
    reasons.push(interpolate(D(locale).deliverySuccessRateDeliveredReturned, { successRate: successRate, delivered: delivered, returned: returned }));
    if (totalTaka >= 4000) reasons.push(interpolate(D(locale).highValueOrder, { totalTaka: fmtNumber(locale, totalTaka) }));
    return {
      successRate,
      rtoRate,
      band: "medium",
      badgeText: interpolate(D(locale).mediumRiskSuccess, { successRate: successRate }),
      badgeColor: "bg-amber-100 text-amber-800 border-amber-300",
      reasons,
      recommendedAdvanceTaka,
      requiresAdvance: true,
    };
  }

  // Low Risk: High delivery success rate (>= 80%)
  reasons.push(interpolate(D(locale).excellentCourierTrackRecordSuccessful, { successRate: successRate }));
  return {
    successRate,
    rtoRate,
    band: "low",
    badgeText: interpolate(D(locale).safeBuyerSuccess, { successRate: successRate }),
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
  locale?: LibLocale;
}): string {
  const locale = params.locale ?? "bn";
  const name = params.customerName?.trim() || D(locale).valuedCustomer;
  const items = params.itemSummary?.trim() ? ` (${params.itemSummary.trim()})` : "";
  const methodLabel = params.paymentMethod === "bkash" ? D(locale).bKash : params.paymentMethod === "nagad" ? D(locale).cash : D(locale).rocket;
  const accType = params.isMerchantAccount ? D(locale).merchantPayment : D(locale).personalSendMoney;

  return (
    interpolate(D(locale).assalamuAlaikum, { name: name }) +
    interpolate(D(locale).thankYouForYourOrder, { orderNumber: params.orderNumber, items: items }) +
    interpolate(D(locale).pleasePayTheDeliveryCharge, { advanceAmount: params.advanceAmount }) +
    interpolate(D(locale).number, { methodLabel: methodLabel, paymentNumber: params.paymentNumber, accType: accType }) +
    interpolate(D(locale).reference, { orderNumber: params.orderNumber }) +
    interpolate(D(locale).afterCompletingThePaymentReply, { dueAmount: params.dueAmount })
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
