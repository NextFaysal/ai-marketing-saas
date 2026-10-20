/**
 * ON4 (Orders Next): Fraud Shield v2 + COD-call helpers for the
 * Orders Command Center. Pure, side-effect free, unit-testable.
 *
 * NOTE: the fraud band here is the ON4 PERSISTED band on the
 * order row (riskBand / riskScore / riskReasons) — it is NOT the
 * M50 advisory `risk` object (return-risk, never holds an order).
 * The two chips render side by side and are labelled distinctly.
 */
import { ordersBn, ordersEn } from "@/lib/i18n/orders";
import { interpolate } from "@/lib/i18n/lookup";

/** ML5 i18n: locale for lib label helpers — defaults to bn so
 * existing callers and tests keep the Bengali copy. */
export type LibLocale = "bn" | "en";
const D = (locale?: string): typeof ordersBn =>
  locale === "en" ? ordersEn : ordersBn;


export type FraudBand = "low" | "medium" | "high";

/** Band -> Bengali label + chip classes. Mirrors the RISK_LABEL
 * style in the orders page (soft tint background + strong text). */
export const FRAUD_BAND_LABEL: Record<string, { text: string; cls: string }> = {
  low: { text: ordersBn.lowRisk, cls: "bg-emerald-100 text-emerald-700" },
  medium: { text: ordersBn.mediumRisk, cls: "bg-amber-100 text-amber-700" },
  high: { text: ordersBn.highRisk, cls: "bg-rose-100 text-rose-700" },
};

export interface RiskReason { key: string; label: string; points: number }

export interface CodCallOutcome { key: string; label: string }

/** The four outcomes staff can record for a COD confirmation
 * call. Keys are the FIXED API vocabulary of
 * POST /orders/:orderId/cod-call. */
export const COD_CALL_OUTCOMES: CodCallOutcome[] = [
  { key: "confirmed", label: ordersBn.confirmed2 },
  { key: "rejected", label: ordersBn.rejection },
  { key: "unreachable", label: ordersBn.didNotAnswer },
  { key: "callback_requested", label: ordersBn.willCallLater },
];

/** Bengali label for a stored codLastCallOutcome key; unknown /
 * missing keys render as an em dash, never an invented label. */
export function codCallOutcomeLabel(key?: string | null, locale: LibLocale = "bn"): string {
  if (!key) return "—";
  return codCallOutcomes(locale).find((o) => o.key === key)?.label ?? key;
}

/** ML5 i18n: locale-aware COD call outcomes + fraud band label. */
export function codCallOutcomes(locale: LibLocale = "bn"): CodCallOutcome[] {
  const d = D(locale);
  return [
    { key: "confirmed", label: d.confirmed2 },
    { key: "rejected", label: d.rejection },
    { key: "unreachable", label: d.didNotAnswer },
    { key: "callback_requested", label: d.willCallLater },
  ];
}
export function fraudBandLabel(band?: string | null, locale: LibLocale = "bn"): { text: string; cls: string } | undefined {
  const base = band ? FRAUD_BAND_LABEL[band] : undefined;
  if (!base) return undefined;
  const d = D(locale);
  const text = band === "low" ? d.lowRisk : band === "medium" ? d.mediumRisk : band === "high" ? d.highRisk : base.text;
  return { text, cls: base.cls };
}
