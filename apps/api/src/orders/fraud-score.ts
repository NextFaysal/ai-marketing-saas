/**
 * ON4 — Fraud Shield v2 pure scorer. Every point explains
 * itself: each fired signal carries a Bengali label with the
 * real numbers in it, and the reasons array is persisted on
 * the order (riskReasons) so the score is never a black box.
 * This layer sits ON TOP of the M50 phone-history risk
 * (risk.service / risk-score) — it reuses its band/score as
 * ONE signal and never modifies its math.
 */

export interface FraudSignalInputs {
  /** Other orders from the same phone inside the burst window. */
  burstCount: number;
  burstThreshold: number;
  burstWindowHours: number;
  /** M50 history band/score for this phone (nulls when unknown). */
  historyBand: string | null;
  historyScore: number | null;
  /** Cancelled + returned outcomes in the customer's history. */
  badOutcomeCount: number;
  reliabilityPercent: number | null;
  reliabilityDecided: number;
  priorOrderCount: number;
  totalMinor: bigint;
  highValueMinor: bigint;
  nameMismatch: boolean;
  mismatchedName: string | null;
  blocked: boolean;
  /** AB8 (AX27): DISTINCT customer phones seen on the same
   * deviceHash in the last 24h (computed by the caller from
   * the bounded order load; 0 when the order has no hash). */
  deviceVelocity: number;
}

export interface FraudReason {
  key: string;
  label: string;
  points: number;
}

export interface FraudScore {
  score: number;
  band: "low" | "medium" | "high";
  reasons: FraudReason[];
}

export const FRAUD_WEIGHTS = {
  blocked: 100,
  burst: 30,
  historyBandHigh: 35,
  historyBandMedium: 15,
  historyOutcomes: 20,
  highValueNew: 20,
  nameMismatch: 15,
  deviceVelocity: 15,
} as const;

export const BAD_OUTCOME_THRESHOLD = 2;
export const RELIABILITY_FLOOR = 50;

function normalizeName(value: unknown): string {
  let s = String(value ?? "").toLowerCase().trim().replace(/\s+/g, " ");
  // Strip a leading "md" / "md." honorific token when more name follows.
  s = s.replace(/^md\.?(?=\s)/, "").trim();
  return s;
}

/**
 * True when two customer names are materially different: both
 * non-empty, neither contains the other, and their first tokens
 * differ. Empty/missing on either side → false (no evidence).
 */
export function namesMateriallyDifferent(a: unknown, b: unknown): boolean {
  const na = normalizeName(a);
  const nb = normalizeName(b);
  if (!na || !nb) return false;
  if (na === nb) return false;
  if (na.includes(nb) || nb.includes(na)) return false;
  const firstA = na.split(" ")[0];
  const firstB = nb.split(" ")[0];
  return firstA !== firstB;
}

/** Minor units → a plain grouped taka number (500000 → "5,000"). */
export function takaFromMinor(minor: bigint): string {
  let v: bigint;
  try { v = BigInt(minor as any); } catch { v = 0n; }
  const taka = v / 100n;
  return taka.toString().replace(/\B(?=(\d{3})+(?!\d))/g, ",");
}

export function scoreFraud(input: FraudSignalInputs): FraudScore {
  if (input.blocked) {
    return {
      score: 100,
      band: "high",
      reasons: [{ key: "blocked_phone", label: "এই ফোন নম্বরটি প্রতিষ্ঠানের ব্লকলিস্টে আছে", points: FRAUD_WEIGHTS.blocked }],
    };
  }

  const reasons: FraudReason[] = [];

  if (input.burstCount >= input.burstThreshold) {
    reasons.push({
      key: "duplicate_burst",
      label: `একই ফোন নম্বর থেকে গত ${input.burstWindowHours} ঘণ্টায় আরও ${input.burstCount}টি অর্ডার এসেছে (সতর্কতার সীমা ${input.burstThreshold}টি)`,
      points: FRAUD_WEIGHTS.burst,
    });
  }

  if (input.historyBand === "high" || input.historyBand === "medium") {
    const high = input.historyBand === "high";
    reasons.push({
      key: "history_band",
      label: `এই ফোনের আগের অর্ডারগুলোর রিটার্ন-ঝুঁকি ${high ? "উচ্চ" : "মাঝারি"} (ইতিহাস-স্কোর ${input.historyScore ?? "—"}/১০০)`,
      points: high ? FRAUD_WEIGHTS.historyBandHigh : FRAUD_WEIGHTS.historyBandMedium,
    });
  }

  const reliabilityTriggered =
    input.reliabilityPercent !== null &&
    input.reliabilityPercent !== undefined &&
    input.reliabilityPercent < RELIABILITY_FLOOR &&
    input.reliabilityDecided >= 3;
  if (input.badOutcomeCount >= BAD_OUTCOME_THRESHOLD || reliabilityTriggered) {
    let label = `এই গ্রাহকের আগের ${input.badOutcomeCount}টি অর্ডার বাতিল/ফেরত হয়েছে`;
    if (reliabilityTriggered) label += `; ডেলিভারি-সফলতার হার মাত্র ${input.reliabilityPercent}%`;
    reasons.push({ key: "history_outcomes", label, points: FRAUD_WEIGHTS.historyOutcomes });
  }

  let totalMinor: bigint | null = null;
  let highValueMinor: bigint | null = null;
  try { totalMinor = BigInt(input.totalMinor as any); } catch { totalMinor = null; }
  try { highValueMinor = BigInt(input.highValueMinor as any); } catch { highValueMinor = null; }
  if (
    input.priorOrderCount <= 1 && totalMinor !== null && highValueMinor !== null && totalMinor >= highValueMinor
  ) {
    reasons.push({
      key: "high_value_new_customer",
      label: `নতুন গ্রাহকের বড় অর্ডার — মোট ৳${takaFromMinor(totalMinor)} (সতর্কতার সীমা ৳${takaFromMinor(highValueMinor)})`,
      points: FRAUD_WEIGHTS.highValueNew,
    });
  }

  if (input.nameMismatch) {
    reasons.push({
      key: "phone_name_mismatch",
      label: `এই ফোন নম্বরটি আগে অন্য নামে ("${input.mismatchedName ?? ""}") ব্যবহৃত হয়েছে`,
      points: FRAUD_WEIGHTS.nameMismatch,
    });
  }

  // AB8 (AX27): device velocity — capped at 15 points so this
  // signal ALONE can never lift an order out of the low band.
  if (Number(input.deviceVelocity ?? 0) >= 3) {
    reasons.push({
      key: "device_velocity",
      label: `একই ডিভাইস থেকে গত ২৪ ঘণ্টায় ${input.deviceVelocity}টি আলাদা নম্বরে অর্ডার এসেছে`,
      points: FRAUD_WEIGHTS.deviceVelocity,
    });
  }

  if (reasons.length === 0) {
    return {
      score: 0,
      band: "low",
      reasons: [{ key: "no_signals", label: "কোনো ঝুঁকির সংকেত পাওয়া যায়নি", points: 0 }],
    };
  }

  const raw = reasons.reduce((s, r) => s + r.points, 0);
  const score = Math.min(100, raw);
  const band: FraudScore["band"] = score < 40 ? "low" : score < 70 ? "medium" : "high";
  return { score, band, reasons };
}
