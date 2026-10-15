/**
 * ON9 (Orders Next): Orders Analytics v2 + Owner Digest — pure
 * payload-shaping helpers for the analytics panel. Side-effect
 * free, unit-testable. Shapes mirror the API payload in
 * apps/api/src/orders/order-analytics.service.ts EXACTLY (money
 * stays a minor-unit STRING end to end; percentages are numbers
 * or null — null renders as "—", never a fabricated 0).
 */
import { minorToTaka } from "./orders-on1";

export interface AnalyticsPayload {
  from: string;
  to: string;
  timezone: string;
  ordersCount: number;
  soldCount: number;
  revenueMinor: string;
  aovMinor: string | null;
  repeatCustomerRate: number | null;
  cancellationRate: number | null;
  returnRate: number | null;
  cancelBreakdownBasis: string;
  cancelBreakdown: { source: string; count: number }[];
  topDistricts: { district: string; orders: number; revenueMinor: string }[];
  courierScorecard: {
    provider: string;
    shipments: number;
    delivered: number;
    returned: number;
    cancelled: number;
    deliveredPct: number | null;
    returnedPct: number | null;
    avgTransitDays: number | null;
    transitPairs: number;
    avgCodCollectLagDays: number | null;
    codPairs: number;
  }[];
  productReturnWarnings: { productId: string; productName: string; orders: number; returns: number; ratePct: number }[];
  stuckNow: number;
  slaBreachesNow: number;
}

export interface DigestRecipientResult {
  userId: string;
  channel: string;
  ok: boolean;
  skipped?: boolean;
  error?: string;
}

export interface DigestStatus {
  lastRun: {
    at: string | null;
    period: string | null;
    day: string | null;
    results: DigestRecipientResult[];
    figures: {
      ordersPlaced: number | null;
      revenueMinor: string | null;
      collectedMinor: string | null;
      dueOutstandingMinor: string | null;
      stuckNow: number | null;
      slaBreachesNow: number | null;
    };
  } | null;
  jobEnabled: boolean;
  jobInstalled: boolean;
  ownerEmails: string[];
}

export interface DigestRunSummary {
  period: string;
  day: string;
  recipients: DigestRecipientResult[];
  sentCount: number;
  failedCount: number;
  skippedCount: number;
}

/** "YYYY-MM-DD" calendar day in Asia/Dhaka for `d`. */
export function dhakaDayString(d: Date): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Dhaka" }).format(d);
}

/** Preset ranges: last N Dhaka days INCLUDING today. */
export function rangeForPreset(days: 7 | 30, now: Date = new Date()): { from: string; to: string } {
  const to = dhakaDayString(now);
  // Dhaka is UTC+6 year-round; stepping back whole UTC days from
  // the Dhaka-midnight instant keeps the calendar math exact.
  const toStartUtc = new Date(`${to}T00:00:00+06:00`).getTime();
  const from = dhakaDayString(new Date(toStartUtc - (days - 1) * 86400_000));
  return { from, to };
}

export function buildAnalyticsPath(orgId: string, from: string, to: string): string {
  return `/organizations/${orgId}/orders/analytics?from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}`;
}

/** Percent value → display; null (no denominator) is "—". */
export function formatPct(v: number | null | undefined): string {
  return v === null || v === undefined ? "—" : `${v}%`;
}

/** Money minor string → "৳x" display via the ON1 formatter. */
export function formatMoneyMinor(minor: string | null | undefined): string {
  if (minor === null || minor === undefined) return "—";
  const t = minorToTaka(minor);
  return t === "" ? "—" : `৳${t}`;
}

/** Proportional bar width (%) for a district row vs the top row. */
export function districtBarPct(orders: number, maxOrders: number): number {
  if (!maxOrders || orders <= 0) return 0;
  return Math.round((orders / maxOrders) * 1000) / 10;
}

/** One digest recipient result → a Bengali status label. */
export function digestResultLabel(r: DigestRecipientResult): string {
  const channel = r.channel === "sms" ? "SMS" : "ইমেইল";
  if (r.ok) return `${channel}: পাঠানো হয়েছে ✓`;
  if (r.skipped && r.error === "no_phone_on_record") return `${channel}: ফোন নম্বর রেকর্ডে নেই — পাঠানো হয়নি`;
  if (r.skipped) return `${channel}: পাঠানো হয়নি (${r.error ?? "বাদ দেওয়া হয়েছে"})`;
  return `${channel}: ব্যর্থ হয়েছে (${r.error ?? "অজানা ত্রুটি"})`;
}
