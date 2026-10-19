/**
 * RFM Customer Segmentation, Predictive CLV, and VIP Retention Engine
 * Tailored for Bangladeshi e-commerce merchants and retail stores.
 */

import { fmtMoney } from "@repo/contracts";
import type { UiLocale } from "@repo/contracts";
import { crmBn, crmEn } from "./i18n/crm";
import { interpolate } from "./i18n/lookup";

/** crm dictionary for the given UI locale (bn is the default). */
const D = (locale?: string) => (locale === "en" ? crmEn : crmBn);
const locOf = (locale?: string): "bn" | "en" => (locale === "en" ? "en" : "bn");

export type RfmSegmentKey =
  | "champions"
  | "loyal"
  | "big_spenders"
  | "at_risk"
  | "lost"
  | "new"
  | "regular";

export type ChurnRiskLevel = "low" | "medium" | "high" | "critical";

export interface ChurnPredictionResult {
  churnPct: number;
  level: ChurnRiskLevel;
  levelLabelBangla: string;
  badgeCls: string;
}

export interface ClvPredictionResult {
  predicted12MonthSpendMinor: bigint;
  predictedOrdersNextYear: number;
  formattedTaka: string;
}

export interface RfmRetentionCampaignTemplate {
  segment: RfmSegmentKey;
  channel: "whatsapp" | "sms";
  templateText: string;
  promoCode: string;
  discountSummary: string;
}

const CHURN_LABEL_KEY = {
  low: "crmZChurnLow",
  medium: "crmZChurnMedium",
  high: "crmZChurnHigh",
  critical: "crmZChurnCritical",
} as const;

/** Localised churn-risk label for a level (bn default). The bn text
 * lives in the crm dictionary; `levelLabelBangla` on the prediction
 * result below is sourced from the same keys. */
export function churnLevelLabel(level: ChurnRiskLevel, locale: UiLocale = "bn"): string {
  return D(locale)[CHURN_LABEL_KEY[level]];
}

/**
 * Calculates customer churn probability (0-100%) based on order recency vs repurchase frequency
 */
export function calculateChurnProbability(
  recencyDays: number,
  frequency: number,
  avgCadenceDays = 45
): ChurnPredictionResult {
  const safeRecency = Math.max(0, Number(recencyDays) || 0);
  const safeFreq = Math.max(1, Number(frequency) || 1);

  // If customer has only 1 order, cadence expectation is standard 60 days
  const expectedCadence = safeFreq === 1 ? 60 : Math.max(20, avgCadenceDays);
  const ratio = safeRecency / expectedCadence;

  let churnPct = Math.min(99, Math.max(5, Math.round(ratio * 35)));

  // Repeat buyers who haven't purchased in a long time have very high churn risk
  if (safeFreq >= 2 && safeRecency > 90) {
    churnPct = Math.min(98, Math.max(75, 40 + Math.round((safeRecency / 180) * 55)));
  } else if (safeRecency <= 21) {
    // Very active recently
    churnPct = Math.min(25, Math.max(5, Math.round((safeRecency / 21) * 20)));
  }

  let level: ChurnRiskLevel = "low";
  let badgeCls = "bg-emerald-100 text-emerald-800 border-emerald-300";

  if (churnPct >= 75) {
    level = "critical";
    badgeCls = "bg-red-100 text-red-800 border-red-300";
  } else if (churnPct >= 50) {
    level = "high";
    badgeCls = "bg-amber-100 text-amber-800 border-amber-300";
  } else if (churnPct >= 25) {
    level = "medium";
    badgeCls = "bg-yellow-100 text-yellow-800 border-yellow-300";
  }

  return {
    churnPct,
    level,
    levelLabelBangla: churnLevelLabel(level, "bn"),
    badgeCls,
  };
}

/**
 * Predicts next 12-month expected customer spend based on past monetary value and purchase frequency
 */
export function predict12MonthClv(
  monetaryMinor: bigint | number | string,
  frequency: number,
  recencyDays: number,
  locale: UiLocale = "bn"
): ClvPredictionResult {
  const pastSpend = BigInt(monetaryMinor || 0);
  const safeFreq = Math.max(1, Number(frequency) || 1);
  const safeRecency = Math.max(0, Number(recencyDays) || 0);

  // Average Order Value (AOV) in minor
  const aovMinor = pastSpend / BigInt(safeFreq);

  // Annualized purchase frequency expectation
  let expectedOrdersNextYear = safeFreq;
  if (safeRecency > 180) {
    expectedOrdersNextYear = Math.max(1, Math.round(safeFreq * 0.4));
  } else if (safeRecency > 90) {
    expectedOrdersNextYear = Math.max(1, Math.round(safeFreq * 0.7));
  } else if (safeRecency <= 30) {
    expectedOrdersNextYear = Math.round(safeFreq * 1.3);
  }

  const predicted12MonthSpendMinor = aovMinor * BigInt(expectedOrdersNextYear);
  const takaNum = Number(predicted12MonthSpendMinor) / 100;
  const formattedTaka = fmtMoney(locOf(locale), Math.round(takaNum), { maximumFractionDigits: 0 });

  return {
    predicted12MonthSpendMinor,
    predictedOrdersNextYear: expectedOrdersNextYear,
    formattedTaka,
  };
}

/**
 * Formats minor units to a whole-Taka amount in the given locale
 * (bn default: Bengali digits + Taka sign via the contracts money formatter).
 */
export function formatClvTaka(minor: bigint | number | string | null | undefined, locale: UiLocale = "bn"): string {
  if (minor == null) return fmtMoney(locOf(locale), 0, { maximumFractionDigits: 0 });
  const num = Math.round(Number(minor) / 100);
  return fmtMoney(locOf(locale), num, { maximumFractionDigits: 0 });
}

/**
 * Normalizes a Bangladeshi phone number to international E.164 without '+' (e.g. 88017XXXXXXXX)
 */
export function normalizeBdPhoneForCampaign(phone: string): string | null {
  const clean = phone.replace(/[^0-9]/g, "");
  if (!clean) return null;
  if (clean.startsWith("880") && clean.length === 13) return clean;
  if (clean.startsWith("0") && clean.length === 11) return "88" + clean;
  if (clean.length === 10 && clean.startsWith("1")) return "880" + clean;
  return clean.length >= 10 ? clean : null;
}

/**
 * Extracts and normalizes list of customer phones for SMS or WhatsApp bulk campaigns
 */
export function extractSegmentPhoneNumbers(
  rows: Array<{ phone?: string | null; name?: string | null }>
): { rawCount: number; validCount: number; formattedList: string[]; textCsv: string } {
  const formattedList: string[] = [];
  for (const r of rows) {
    if (r.phone) {
      const normalized = normalizeBdPhoneForCampaign(r.phone);
      if (normalized && !formattedList.includes(normalized)) {
        formattedList.push(normalized);
      }
    }
  }

  return {
    rawCount: rows.length,
    validCount: formattedList.length,
    formattedList,
    textCsv: formattedList.join(", "),
  };
}

const CAMPAIGN_MESSAGE_KEY: Record<RfmSegmentKey, keyof typeof crmBn> = {
  champions: "crmZCampaignChampions",
  at_risk: "crmZCampaignAtRisk",
  loyal: "crmZCampaignLoyal",
  big_spenders: "crmZCampaignBigSpenders",
  lost: "crmZCampaignLost",
  new: "crmZCampaignNew",
  regular: "crmZCampaignRegular",
};

/**
 * Generates ready-to-blast personalized campaign copy for WhatsApp or SMS.
 * The copy lives in the crm dictionary (crmZCampaign*); `locale` picks
 * the message language (bn default). `storeName` defaults to the
 * dictionary's rfmOurShop for the locale.
 */
export function buildSegmentCampaignMessage(
  segment: RfmSegmentKey,
  customerName: string,
  promoCode: string,
  storeName?: string,
  locale: UiLocale = "bn"
): string {
  const d = D(locale);
  const name = customerName.trim() || d.crmZCampaignDefaultName;
  const store = storeName ?? d.rfmOurShop;
  return interpolate(d[CAMPAIGN_MESSAGE_KEY[segment] ?? "crmZCampaignRegular"], {
    name,
    store,
    code: promoCode,
  });
}
