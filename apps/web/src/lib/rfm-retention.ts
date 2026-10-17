/**
 * RFM Customer Segmentation, Predictive CLV, and VIP Retention Engine
 * Tailored for Bangladeshi e-commerce merchants and retail stores.
 */

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
  let levelLabelBangla = "ঝুঁকিহীন (সক্রিয়)";
  let badgeCls = "bg-emerald-100 text-emerald-800 border-emerald-300";

  if (churnPct >= 75) {
    level = "critical";
    levelLabelBangla = "চূর্ণ সংকট (জরুরি উইন-ব্যাক প্রয়োজন)";
    badgeCls = "bg-red-100 text-red-800 border-red-300";
  } else if (churnPct >= 50) {
    level = "high";
    levelLabelBangla = "উচ্চ ঝুঁকি (At-Risk)";
    badgeCls = "bg-amber-100 text-amber-800 border-amber-300";
  } else if (churnPct >= 25) {
    level = "medium";
    levelLabelBangla = "মাঝারি ঝুঁকি";
    badgeCls = "bg-yellow-100 text-yellow-800 border-yellow-300";
  }

  return {
    churnPct,
    level,
    levelLabelBangla,
    badgeCls,
  };
}

/**
 * Predicts next 12-month expected customer spend based on past monetary value and purchase frequency
 */
export function predict12MonthClv(
  monetaryMinor: bigint | number | string,
  frequency: number,
  recencyDays: number
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
  const formattedTaka = `৳${Math.round(takaNum).toLocaleString("en-IN")}`;

  return {
    predicted12MonthSpendMinor,
    predictedOrdersNextYear: expectedOrdersNextYear,
    formattedTaka,
  };
}

/**
 * Formats minor units to Bengali Taka representation with Bengali digits
 */
export function formatClvTaka(minor: bigint | number | string | null | undefined): string {
  if (minor == null) return "৳০";
  const num = Math.round(Number(minor) / 100);
  const formatted = num.toLocaleString("en-IN");
  const bnFormatted = formatted.replace(/[0-9]/g, (d) => "০১২৩৪৫৬৭৮৯"[Number(d)]);
  return `৳${bnFormatted}`;
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

/**
 * Generates ready-to-blast personalized campaign copy for WhatsApp or SMS
 */
export function buildSegmentCampaignMessage(
  segment: RfmSegmentKey,
  customerName: string,
  promoCode: string,
  storeName = "আমাদের শপ"
): string {
  const name = customerName.trim() || "সম্মানিত গ্রাহক";

  switch (segment) {
    case "champions":
      return `আসসালামু আলাইকুম ${name}! ${storeName}-এর সবচেয়ে সম্মানিত VIP কাস্টমার হিসেবে আপনাকে অভিনন্দন। আপনার জন্য বিশেষ উপহার: *${promoCode}* কোড ব্যবহারে ২০% অতিরিক্ত ছাড় ও ফ্রি ডেলিভারি উপভোগ করুন। ধন্যবাদ আমাদের সাথে থাকার জন্য!`;
    case "at_risk":
      return `আসসালামু আলাইকুম ${name}! ${storeName} থেকে অনেক দিন আপনার কোনো অর্ডার পাইনি, আপনাকে ভীষণ মিস করছি! আপনার জন্য বিশেষ ১৫% উইন-ব্যাক ভাউচার: *${promoCode}*। যেকোনো কেনাকাটায় এখনই ব্যবহার করতে পারেন।`;
    case "loyal":
      return `আসসালামু আলাইকুম ${name}! ${storeName}-এর প্রতি আপনার বিশ্বস্ততার জন্য কৃতজ্ঞতা। আপনার পছন্দের কালেকশনে বিশেষ ১৫% ছাড় পেতে কুপন কোড: *${promoCode}* ব্যবহার করুন।`;
    case "big_spenders":
      return `আসসালামু আলাইকুম ${name}! ${storeName}-এর এক্সক্লুসিভ প্রিমিয়াম কালেকশনে আপনার জন্য ৳৫০০ ফ্ল্যাট ডিসকাউন্ট ভাউচার কোড: *${promoCode}*। নতুন লিমিটেড এডিশন স্টক দেখতে যোগাযোগ করুন।`;
    case "lost":
      return `আসসালামু আলাইকুম ${name}! ${storeName}-এর বিশেষ রি-অ্যাক্টিভেশন ধামাকা অফারে পাচ্ছেন ফ্ল্যাট ২০% ছাড়। কুপন কোড: *${promoCode}*। সীমিত সময়ের এই অফারটি মিস করবেন না!`;
    case "new":
      return `আসসালামু আলাইকুম ${name}! ${storeName} থেকে প্রথম অর্ডারের জন্য আন্তরিক ধন্যবাদ। আপনার দ্বিতীয় অর্ডারে ১০% ইনস্ট্যান্ট ছাড়ের জন্য কুপন কোড: *${promoCode}*।`;
    case "regular":
    default:
      return `আসসালামু আলাইকুম ${name}! ${storeName}-এ আপনার জন্য বিশেষ উপহার কুপন: *${promoCode}*। নতুন কালেকশন দেখতে ও সেরা অফার উপভোগ করতে যোগাযোগ করুন।`;
  }
}
