/**
 * ON4 (Orders Next): Fraud Shield v2 + COD-call helpers for the
 * Orders Command Center. Pure, side-effect free, unit-testable.
 *
 * NOTE: the fraud band here is the ON4 PERSISTED band on the
 * order row (riskBand / riskScore / riskReasons) — it is NOT the
 * M50 advisory `risk` object (return-risk, never holds an order).
 * The two chips render side by side and are labelled distinctly.
 */

export type FraudBand = "low" | "medium" | "high";

/** Band -> Bengali label + chip classes. Mirrors the RISK_LABEL
 * style in the orders page (soft tint background + strong text). */
export const FRAUD_BAND_LABEL: Record<string, { text: string; cls: string }> = {
  low: { text: "কম ঝুঁকি", cls: "bg-emerald-100 text-emerald-700" },
  medium: { text: "মাঝারি ঝুঁকি", cls: "bg-amber-100 text-amber-700" },
  high: { text: "উচ্চ ঝুঁকি", cls: "bg-rose-100 text-rose-700" },
};

export interface RiskReason { key: string; label: string; points: number }

export interface CodCallOutcome { key: string; label: string }

/** The four outcomes staff can record for a COD confirmation
 * call. Keys are the FIXED API vocabulary of
 * POST /orders/:orderId/cod-call. */
export const COD_CALL_OUTCOMES: CodCallOutcome[] = [
  { key: "confirmed", label: "নিশ্চিত" },
  { key: "rejected", label: "প্রত্যাখ্যান" },
  { key: "unreachable", label: "পাইনি" },
  { key: "callback_requested", label: "পরে কল করবে" },
];

/** Bengali label for a stored codLastCallOutcome key; unknown /
 * missing keys render as an em dash, never an invented label. */
export function codCallOutcomeLabel(key?: string | null): string {
  if (!key) return "—";
  return COD_CALL_OUTCOMES.find((o) => o.key === key)?.label ?? key;
}
