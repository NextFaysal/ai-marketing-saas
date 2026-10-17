/**
 * MX11 — engagement score + rule-based predictive segments.
 *
 * EVERYTHING in this module is a deterministic, documented RULE
 * over real records — there is no model, no ML and no "AI
 * prediction" anywhere in MX11. The UI labels every surface
 * built on this module "rule-based estimate" (নিয়ম-ভিত্তিক
 * অনুমান), and the formula + segment rules below are shown to
 * the org verbatim (ENGAGEMENT_FORMULA_TEXT /
 * PREDICTIVE_SEGMENT_RULES) — no black box.
 *
 * Score storage decision (recorded in
 * docs/messaging-mx11-acceptance.md): COMPUTED ON READ, never
 * stored — the RFM precedent (messaging/rfm.ts computes quintiles
 * at report/resolve time and stores nothing). A score therefore
 * always reflects the records as they are at the moment it is
 * read: there is no refresh job and no stale copy; the honest
 * cost is one bounded aggregate pass per read, exactly like RFM.
 *
 * Per-channel data limits (honest, never faked): the score only
 * counts signals a channel actually records. Email records an
 * open only via the signed open pixel (blocked pixels undercount
 * — the MS-package caveat), SMS records NO delivered/open signal
 * at all (no documented DLR API), WhatsApp records delivered/read
 * via webhooks. A contact reached only by SMS can still earn
 * click points (tracked links) and order points, but the
 * delivered/open points are simply ABSENT for them — the formula
 * never invents a signal a channel cannot produce. Orders link
 * to CUSTOMERS only; a lead's score rests on delivery/click data
 * alone (a lead's manual pipeline valueMinor is NOT an order and
 * is never counted as one).
 */

/** The raw per-contact inputs, gathered by the service from real
 * rows (MessageDelivery / MessageLinkClick / order aggregates).
 * deliveredOnlyCount excludes deliveries that also carry an
 * open/read signal, so one delivery never earns both the
 * delivered points and the open points. */
export interface EngagementRawFacts {
  sentCount: number;
  deliveredOnlyCount: number;
  openCount: number;
  clickCount: number;
  /** customers only — real non-cancelled orders (computeOrderAggregates). Leads: 0. */
  orderFrequency: number;
  /** epoch ms of the newest engagement signal (open/read, click or order); null = never engaged. */
  lastEngagementAt: number | null;
}

export const ENGAGEMENT_SCORE_FLOOR = 0;

/** A contact's fully-derived engagement picture, built by the
 * service from the raw facts + order aggregates. */
export interface EngagementContact extends EngagementRawFacts {
  type: "customer" | "lead";
  id: string;
  totalSpentMinor: number;
  score: number;
  segments: string[];
  daysSinceLastEngagement: number | null;
  firstSendAt: number | null;
  lastSendAt: number | null;
  /** Confirmed sends after the last engagement (all sends when never engaged). */
  sendsSinceLastEngagement: number;
}

/**
 * THE formula (0–100, deterministic — same inputs + same `now`
 * always give the same score):
 *   clicks    min(clickCount × 15, 30)        — strongest signal
 *   opens     min(openCount × 8, 24)          — openedAt/readAt/deliveryStatus "read"
 *   delivered min(deliveredOnlyCount × 4, 12) — delivered signal, no open/read
 *   orders    min(orderFrequency × 6, 18)     — customers only
 *   recency   last engagement ≤7d: 16 · ≤30d: 10 · ≤90d: 5 · older/none: 0
 * A contact with zero history scores exactly the floor, 0.
 */
export function computeEngagementScore(facts: EngagementRawFacts, now: number): number {
  const clicks = Math.min(Math.max(0, facts.clickCount) * 15, 30);
  const opens = Math.min(Math.max(0, facts.openCount) * 8, 24);
  const delivered = Math.min(Math.max(0, facts.deliveredOnlyCount) * 4, 12);
  const orders = Math.min(Math.max(0, facts.orderFrequency) * 6, 18);
  let recency = 0;
  if (facts.lastEngagementAt !== null && Number.isFinite(facts.lastEngagementAt)) {
    const days = Math.max(0, Math.floor((now - facts.lastEngagementAt) / 86400000));
    recency = days <= 7 ? 16 : days <= 30 ? 10 : days <= 90 ? 5 : 0;
  }
  return Math.min(100, clicks + opens + delivered + orders + recency);
}

/** Shown verbatim in the UI info panel — keep in sync with the
 * formula above (the MX11 spec pins the point values). */
export const ENGAGEMENT_FORMULA_TEXT =
  "Engagement Score (0–100) — rule-based estimate, computed from real records only: " +
  "link clicks 15 points each (max 30) · message opens/reads 8 points each (max 24) · " +
  "delivered-but-not-opened messages 4 points each (max 12) · orders 6 points each (max 18, customers only) · " +
  "recency of last engagement: within 7 days 16 points, within 30 days 10, within 90 days 5, older or never 0. " +
  "A contact with no history scores 0. Channels that do not record a signal (e.g. SMS has no open/delivered data) " +
  "simply earn no points for it — nothing is estimated or filled in.";

export const PREDICTIVE_SEGMENTS = ["churn_risk", "likely_to_buy", "high_ltv"] as const;
export type PredictiveSegment = (typeof PREDICTIVE_SEGMENTS)[number];

/** Org-visible thresholds (MessagingSetting, MX11 columns).
 * Defaults apply when no setting row/column exists — the MS2
 * defensive-read discipline. */
export interface EngagementThresholds {
  churnRiskSilentDays: number;
  likelyToBuyMinScore: number;
  highLtvMinSpentMinor: number;
  unengagedSuppressDays: number;
  unengagedMinSends: number;
}

export const DEFAULT_ENGAGEMENT_THRESHOLDS: EngagementThresholds = {
  churnRiskSilentDays: 60,
  likelyToBuyMinScore: 60,
  highLtvMinSpentMinor: 500000,
  unengagedSuppressDays: 90,
  unengagedMinSends: 3,
};

/** Fixed (not org-configurable) part of the likely-to-buy rule,
 * stated in the rule text shown in the UI. */
export const LIKELY_TO_BUY_RECENCY_DAYS = 30;

export interface SegmentFacts extends EngagementRawFacts {
  score: number;
  totalSpentMinor: number;
  isCustomer: boolean;
  /** null = never engaged (no open/read/click/order ever). */
  daysSinceLastEngagement: number | null;
}

/**
 * The three rule-based segments. Boundary semantics are exact and
 * spec-pinned: "silent for at least N days" includes exactly N;
 * "score at least S" includes exactly S; high-LTV includes
 * exactly the threshold spend.
 * - churn_risk: previously engaged (any open, click or order) AND
 *   silent for >= churnRiskSilentDays since the last engagement.
 * - likely_to_buy: score >= likelyToBuyMinScore AND last
 *   engagement within LIKELY_TO_BUY_RECENCY_DAYS days.
 * - high_ltv: CUSTOMERS only (leads have no orders) with
 *   total spent >= highLtvMinSpentMinor AND >= 2 orders. This is
 *   an ABSOLUTE org threshold over the same computeOrderAggregates
 *   numbers RFM reads — RFM's big_spenders is a relative quintile
 *   inside the org's own base, so the two are related but not the
 *   same rule; neither duplicates the other's computation.
 */
export function predictiveSegmentsFor(facts: SegmentFacts, thresholds: EngagementThresholds): string[] {
  const out: string[] = [];
  const previouslyEngaged = facts.openCount + facts.clickCount + facts.orderFrequency > 0;
  if (previouslyEngaged && facts.daysSinceLastEngagement !== null && facts.daysSinceLastEngagement >= thresholds.churnRiskSilentDays) {
    out.push("churn_risk");
  }
  if (facts.score >= thresholds.likelyToBuyMinScore && facts.daysSinceLastEngagement !== null && facts.daysSinceLastEngagement <= LIKELY_TO_BUY_RECENCY_DAYS) {
    out.push("likely_to_buy");
  }
  if (facts.isCustomer && facts.orderFrequency >= 2 && facts.totalSpentMinor >= thresholds.highLtvMinSpentMinor) {
    out.push("high_ltv");
  }
  return out;
}

/** The segment rules in plain language, shown verbatim in the
 * UI next to every segment surface (with the org's live
 * threshold values interpolated by the caller where marked). */
export const PREDICTIVE_SEGMENT_RULES: { segment: PredictiveSegment; label: string; rule: string }[] = [
  {
    segment: "churn_risk", label: "Churn Risk",
    rule: "Previously engaged (opened, clicked or ordered at least once) but silent for at least the churn threshold number of days since the last engagement.",
  },
  {
    segment: "likely_to_buy", label: "Likely to Buy",
    rule: `Engagement score at or above the likely-to-buy threshold AND engaged within the last ${LIKELY_TO_BUY_RECENCY_DAYS} days.`,
  },
  {
    segment: "high_ltv", label: "High LTV",
    rule: "Customers only: at least 2 real orders AND total spent at or above the high-LTV threshold. Leads have no order history, so they can never be in this segment.",
  },
];

/**
 * MX11 holdout — the SAME deterministic hash discipline as the
 * existing A/B split (messaging.service prepare paths):
 *   h = 0; for each char of `${type}:${id}`: h = (h * 31 + code) >>> 0
 * A/B reads h % 2; holdout reads h % 100 < percent — two buckets
 * of ONE hash. A recipient is therefore either held out, or in
 * exactly one A/B variant, never both and never neither-by-accident:
 * holdout is applied first and the A/B split runs over the
 * survivors, so the two compose without double exclusion.
 * Deterministic per (type, id): preparing the same broadcast
 * again can never re-roll a different holdout set, and a resumed
 * send never re-prepares at all (the MX1 recipient rows / MS1
 * snapshot are frozen at prepare).
 */
export function recipientHash(key: string): number {
  let h = 0;
  for (let i = 0; i < key.length; i++) h = (h * 31 + key.charCodeAt(i)) >>> 0;
  return h;
}

export function isHeldOut(key: string, percent: number | null | undefined): boolean {
  if (!percent || !Number.isFinite(percent) || percent <= 0) return false;
  const pct = Math.min(100, Math.floor(percent));
  return recipientHash(key) % 100 < pct;
}
