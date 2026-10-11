import { classifyDue, dhakaDayKey, dhakaDayStartUtc } from "./lead-followups";

/**
 * CRM C2 — deterministic lead scoring, compute-on-read.
 *
 * Modelled on the M50 COD risk-score discipline (orders/risk-score.ts):
 * a pure function over the lead's OWN real data — its row, its
 * LeadActivity history and its linked customer's delivered orders.
 * No stored score, no schema change, no ML: every point is explained
 * by a verbatim Bengali reason, and when the evidence is thin the
 * reasons say so instead of dressing a guess up as certainty.
 *
 * Scoring table (max 100, clamped 0..100) — mirrored verbatim in
 * docs/crm-c2-acceptance.md:
 *   Stage:        new +2 · contacted +12 · qualified +22 ·
 *                 proposal +30 · won +30 · lost +0 (and final cap 10)
 *   Value (BDT):  none +0 · <৳1,000 +5 · ৳1,000–4,999 +10 ·
 *                 ৳5,000–19,999 +15 · ≥৳20,000 +20
 *   Activities:   0 → +0 · 1–2 → +5 · 3–5 → +10 · ≥6 → +15
 *   Recency:      last touch ≤1d +15 · ≤3d +12 · ≤7d +8 · ≤14d +4 · older +0
 *                 (last touch = max(lastContactedAt, latest activity),
 *                  falling back to the lead's createdAt)
 *   Follow-up:    scheduled in future +10 · due today +5 ·
 *                 overdue −10 · none +0
 *   Customer:     linked customer +5 · ≥1 delivered order +5
 * Bands: won → hot; else score ≥60 hot · 30–59 warm · <30 cold.
 * Lost leads: final score capped at 10, band cold.
 */

export interface LeadScoreInput {
  stage: string;
  /** Lead value in minor units (poisha), as stored on the row. */
  valueMinor: number | null;
  activityCount: number;
  lastActivityAt: Date | string | null;
  lastContactedAt: Date | string | null;
  createdAt: Date | string;
  nextFollowUpAt: Date | string | null;
  customerId: string | null;
  deliveredOrderCount: number;
}

export interface LeadScore {
  score: number;
  band: "hot" | "warm" | "cold";
  reasons: string[];
  /** True when there is almost no evidence to score from. */
  thinData: boolean;
}

const STAGE_POINTS: Record<string, number> = {
  new: 2, contacted: 12, qualified: 22, proposal: 30, won: 30, lost: 0,
};
const STAGE_REASONS: Record<string, string> = {
  new: "ধাপ New: এখনো প্রাথমিক পর্যায়ে আছে (+2)।",
  contacted: "ধাপ Contacted: যোগাযোগ শুরু হয়েছে (+12)।",
  qualified: "ধাপ Qualified: আগ্রহ/যোগ্যতা যাচাই হয়ে গেছে (+22)।",
  proposal: "ধাপ Proposal: অফার/দাম পাঠানো হয়েছে (+30)।",
  won: "ধাপ Won: এই Lead ইতিমধ্যে Won হয়েছে (+30)।",
};
const THIN_DATA_REASON =
  "সতর্কতা: এই Lead সম্পর্কে তথ্য খুবই কম — কোনো কার্যকলাপ, মূল্য বা যোগাযোগের রেকর্ড প্রায় নেই। স্কোরটি শুধু প্রাথমিক ধারণা; আরও তথ্য জমলেই এটি বদলাবে।";

function toDate(v: Date | string | null | undefined): Date | null {
  if (v == null) return null;
  const d = v instanceof Date ? v : new Date(v);
  return Number.isNaN(d.getTime()) ? null : d;
}

/** Whole Asia/Dhaka calendar days from `from` to `to` (to - from). */
function dhakaDaysBetween(from: Date, to: Date): number {
  return Math.round((dhakaDayStartUtc(to).getTime() - dhakaDayStartUtc(from).getTime()) / 86400000);
}

function formatBdt(minor: number): string {
  return `৳${Math.round(minor / 100).toLocaleString("en-IN")}`;
}

export function scoreLead(input: LeadScoreInput, now = new Date()): LeadScore {
  const reasons: string[] = [];
  let score = 0;

  // --- Stage progression ---
  const stagePts = STAGE_POINTS[input.stage] ?? 0;
  score += stagePts;
  if (input.stage === "lost") {
    reasons.push("ধাপ Lost: এই Lead হারানো হিসেবে চিহ্নিত — চূড়ান্ত স্কোর সর্বোচ্চ 10-এ সীমাবদ্ধ রাখা হয়েছে।");
  } else {
    reasons.push(STAGE_REASONS[input.stage] ?? `ধাপ "${input.stage}" (+${stagePts})।`);
  }

  // --- Value bands (valueMinor is poisha; thresholds in BDT) ---
  const value = input.valueMinor;
  if (value == null || value <= 0) {
    reasons.push("আনুমানিক মূল্য দেওয়া হয়নি (+0)।");
  } else if (value < 100_000) {
    score += 5;
    reasons.push(`আনুমানিক মূল্য ${formatBdt(value)} — কম মূল্যের Lead (+5)।`);
  } else if (value < 500_000) {
    score += 10;
    reasons.push(`আনুমানিক মূল্য ${formatBdt(value)} — মাঝারি মূল্যের Lead (+10)।`);
  } else if (value < 2_000_000) {
    score += 15;
    reasons.push(`আনুমানিক মূল্য ${formatBdt(value)} — ভালো মূল্যের Lead (+15)।`);
  } else {
    score += 20;
    reasons.push(`আনুমানিক মূল্য ${formatBdt(value)} — উচ্চ মূল্যের Lead (+20)।`);
  }

  // --- Activity count (all LeadActivity rows: notes, calls, stage moves…) ---
  const acts = Math.max(0, Math.floor(input.activityCount || 0));
  if (acts === 0) {
    reasons.push("কোনো কার্যকলাপ (Activity) রেকর্ড নেই (+0)।");
  } else {
    const pts = acts <= 2 ? 5 : acts <= 5 ? 10 : 15;
    score += pts;
    reasons.push(`${acts}টি কার্যকলাপ রেকর্ড হয়েছে (+${pts})।`);
  }

  // --- Recency of last touch ---
  const created = toDate(input.createdAt) ?? now;
  const touch = [toDate(input.lastContactedAt), toDate(input.lastActivityAt), created]
    .filter((d): d is Date => d != null)
    .sort((a, b) => b.getTime() - a.getTime())[0];
  const daysAgo = Math.max(0, dhakaDaysBetween(touch, now));
  const recencyPts = daysAgo <= 1 ? 15 : daysAgo <= 3 ? 12 : daysAgo <= 7 ? 8 : daysAgo <= 14 ? 4 : 0;
  score += recencyPts;
  reasons.push(daysAgo === 0
    ? "সর্বশেষ যোগাযোগ/কার্যকলাপ আজকেই হয়েছে (+15)।"
    : `সর্বশেষ যোগাযোগ/কার্যকলাপ ${daysAgo} দিন আগে হয়েছে (+${recencyPts})।`);

  // --- Follow-up state ---
  const followUp = toDate(input.nextFollowUpAt);
  if (!followUp) {
    reasons.push("কোনো ফলোআপ নির্ধারিত নেই (+0)।");
  } else {
    const due = classifyDue(followUp, now);
    if (!due) {
      score += 10;
      reasons.push(`পরবর্তী ফলোআপ নির্ধারিত আছে (${dhakaDayKey(followUp)}) — সক্রিয় অনুসরণ চলছে (+10)।`);
    } else if (due.bucket === "today") {
      score += 5;
      reasons.push("ফলোআপ আজই due — এখনই যোগাযোগ করা দরকার (+5)।");
    } else {
      score -= 10;
      reasons.push(`ফলোআপের তারিখ ${due.daysOverdue} দিন পেরিয়ে গেছে — দেরি হওয়া নেতিবাচক সংকেত (−10)।`);
    }
  }

  // --- Linked customer / delivered orders ---
  if (input.customerId) {
    score += 5;
    reasons.push("এই Lead ইতিমধ্যে একজন Customer-এর সঙ্গে যুক্ত (+5)।");
    if (input.deliveredOrderCount > 0) {
      score += 5;
      reasons.push(`যুক্ত Customer-এর ${input.deliveredOrderCount}টি অর্ডার সফলভাবে ডেলিভারি হয়েছে (+5)।`);
    }
  }

  // --- Thin-data honesty ---
  const thinData = acts <= 1 && (value == null || value <= 0) && !input.customerId && !toDate(input.lastContactedAt);
  if (thinData) reasons.push(THIN_DATA_REASON);

  // --- Clamp, lost cap, band ---
  score = Math.max(0, Math.min(100, score));
  if (input.stage === "lost") score = Math.min(score, 10);
  const band: LeadScore["band"] = input.stage === "won" ? "hot" : input.stage === "lost" ? "cold"
    : score >= 60 ? "hot" : score >= 30 ? "warm" : "cold";
  return { score, band, reasons, thinData };
}
