// AB1 — loyalty points + referral rewards: staff-side shapes and
// Bengali labels shared by the loyalty settings page, the customer
// 360 detail, the order detail and POS. Shapes mirror the API
// contract in apps/api/src/commerce/loyalty.service.ts:
//   GET/PUT organizations/:id/commerce/loyalty/settings
//   GET/PUT organizations/:id/commerce/loyalty/referral-settings
//   GET     organizations/:id/commerce/loyalty/customers/:customerId
//   POST    organizations/:id/commerce/loyalty/customers/:customerId/adjust
//   GET     organizations/:id/commerce/loyalty/orders/:orderId
// Money from these endpoints is paisa: settings carry integer
// paisa counts (redeemValueMinorPerPoint) and the referral minimum
// is a paisa STRING (rewardMinOrderMinor), like other commerce
// minor strings in the staff zone.

import type { UiLocale } from "./i18n/dict";
import { sharedBn, sharedEn } from "./i18n/shared";

/** MB2 F2: ledger labels resolve through the `shared`
 * namespace; locale defaults to "bn" so existing callers stay
 * byte-identical. */
const SD = (locale: UiLocale = "bn"): typeof sharedBn =>
  locale === "en" ? sharedEn : sharedBn;

export interface LoyaltySetting {
  enabled: boolean;
  earnPointsPer1000Minor: number;
  redeemValueMinorPerPoint: number;
  minRedeemPoints: number;
  maxRedeemSharePct: number | null;
  pointsExpiryDays: number | null;
}

export interface ReferralRewardSetting {
  enabled: boolean;
  rewardType: "points" | "coupon";
  rewardPoints: number | null;
  couponPercent: number | null;
  /** Paisa as a string, or null when there is no minimum. */
  rewardMinOrderMinor: string | null;
}

export interface LoyaltyEntry {
  id: string;
  deltaPoints: number;
  reason: string;
  orderId?: string | null;
  orderNumber?: string | null;
  balanceAfter: number;
  expiresAt?: string | null;
  remainingPoints?: number | null;
  note?: string | null;
  createdById?: string | null;
  createdAt: string;
}

export interface ReferralRewardCoupon {
  id: string;
  code: string;
  value: number;
  kind: string;
  endsAt?: string | null;
  active: boolean;
  usedCount: number;
  sourceOrderNumber?: string | null;
  createdAt: string;
}

export interface CustomerLoyalty {
  customerId: string;
  enabled: boolean;
  balance: number;
  redeemValueMinorPerPoint: number;
  /** Paisa (number) — the taka value of a positive balance. */
  balanceValueMinor: number;
  entries: LoyaltyEntry[];
  referralRewards: { coupons: ReferralRewardCoupon[] };
}

export interface OrderLoyalty {
  orderId: string;
  orderNumber?: string | null;
  customerId?: string | null;
  totals: {
    earned: number;
    redeemed: number;
    referralReward: number;
    clawedBack: number;
  };
  entries: LoyaltyEntry[];
}

/** Ledger reason → label per locale (AB1 spec wording; the bn
 * record below stays the pinned source). */
export function loyaltyReasonLabelsFor(locale: UiLocale = "bn"): Record<string, string> {
  const d = SD(locale);
  return {
    earn: d.loyReasonEarn,
    redeem: d.loyReasonRedeem,
    expire: d.loyReasonExpire,
    adjust: d.loyReasonAdjust,
    referral_reward: d.loyReasonReferral,
  };
}

/** Machine note marker → label per locale. The markers are what
 * the API writes on reversal entries — shown as human labels,
 * never as the raw marker text. */
export function loyaltyNoteLabelsFor(locale: UiLocale = "bn"): Record<string, string> {
  const d = SD(locale);
  return {
    redeem_reversal: d.loyNoteRedeemReversal,
    earn_clawback: d.loyNoteEarnClawback,
    referral_reward_clawback: d.loyNoteReferralClawback,
  };
}

export const LOYALTY_REASON_LABEL: Record<string, string> = loyaltyReasonLabelsFor("bn");

export const LOYALTY_NOTE_LABEL: Record<string, string> = loyaltyNoteLabelsFor("bn");

/** Display label for one ledger entry: a known note marker wins
 * over the generic reason label (a clawback is an "adjust" row
 * whose marker carries the real meaning). */
export function loyaltyEntryLabel(entry: Pick<LoyaltyEntry, "reason" | "note">, locale: UiLocale = "bn"): string {
  const noteLabels = loyaltyNoteLabelsFor(locale);
  const note = entry.note?.trim() ?? "";
  if (note && noteLabels[note]) return noteLabels[note];
  return loyaltyReasonLabelsFor(locale)[entry.reason] ?? entry.reason;
}

/** The staff/free-text note to show under an entry, or null when
 * the note is a machine marker (already covered by the label) or
 * empty — raw markers are never rendered. */
export function loyaltyEntryNote(entry: Pick<LoyaltyEntry, "note">): string | null {
  const note = entry.note?.trim() ?? "";
  if (!note || LOYALTY_NOTE_LABEL[note]) return null;
  return note;
}

/** Signed points for ledger rows: "+120" / "−40" (ASCII minus is
 * avoided so a negative delta never reads as a separator). */
export function formatPointsDelta(deltaPoints: number): string {
  if (deltaPoints > 0) return `+${deltaPoints}`;
  if (deltaPoints < 0) return `−${Math.abs(deltaPoints)}`;
  return "0";
}

/** Paisa NUMBER (loyalty payloads) → "৳60.50" display text. */
export function formatPaisaNumber(paisa?: number | null): string {
  if (paisa == null || !Number.isFinite(paisa)) return "—";
  const taka = paisa / 100;
  return `৳${taka.toLocaleString("en-IN", { maximumFractionDigits: 2 })}`;
}
