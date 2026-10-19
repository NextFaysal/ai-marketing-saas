/**
 * AB7 (AX15–AX20) — dashboard surfaces: pure payload-shaping
 * helpers. Side-effect free, unit-testable. Shapes mirror the
 * API contracts for review insights, web push, social proof,
 * abandoned sequence state, commerce source analytics,
 * inventory velocity v2 and landing variant statistics.
 * Money stays a minor-unit (paisa) STRING end to end; nulls
 * render as "—", never a fabricated 0.
 */
import { minorToTakaString, takaToMinorString } from "./storefront-money";
import type { UiLocale } from "./i18n/dict";
import { sharedBn, sharedEn } from "./i18n/shared";

/** MB2 F2: status/basis/significance labels resolve through
 * the `shared` namespace; locale defaults to "bn" so existing
 * callers/tests stay byte-identical. */
const SD = (locale: UiLocale = "bn"): typeof sharedBn =>
  locale === "en" ? sharedEn : sharedBn;

/* ---------------- AX15: review insights ---------------- */

export interface ReviewSentiment {
  positive: number;
  neutral: number;
  negative: number;
  total: number;
}

export interface ReviewInsight {
  summaryText: string;
  sentimentJson: ReviewSentiment;
  themesJson: unknown;
  reviewCountAtGeneration: number;
  generatedAt: string;
  modelLabel?: string | null;
}

export interface ReviewInsightPayload {
  insight: ReviewInsight | null;
  currentReviewCount: number;
  reviewsSinceGeneration: number;
}

/** Sentiment counts → stacked-bar percentages (0 when no total). */
export function sentimentPercents(s: ReviewSentiment | null | undefined): {
  positive: number; neutral: number; negative: number;
} {
  if (!s) return { positive: 0, neutral: 0, negative: 0 };
  const total = s.total > 0 ? s.total : s.positive + s.neutral + s.negative;
  if (!total) return { positive: 0, neutral: 0, negative: 0 };
  const pct = (n: number) => Math.round((n / total) * 1000) / 10;
  return { positive: pct(s.positive), neutral: pct(s.neutral), negative: pct(s.negative) };
}

/** "নতুন রিভিউ এসেছে" badge threshold from the AX15 contract. */
export function insightNeedsRegeneration(reviewsSinceGeneration: number | null | undefined): boolean {
  return (reviewsSinceGeneration ?? 0) >= 10;
}

/**
 * themesJson is server-shaped JSON: accept a string list, a
 * list of { theme|label|name, count? } objects, or a
 * { theme: count } record — render labels, never raw JSON.
 */
export function themeLabels(themesJson: unknown): string[] {
  if (!themesJson) return [];
  if (Array.isArray(themesJson)) {
    return themesJson.map((t) => {
      if (typeof t === "string") return t;
      if (t && typeof t === "object") {
        const o = t as Record<string, unknown>;
        const name = o.theme ?? o.label ?? o.name ?? o.title;
        if (typeof name !== "string" || !name) return "";
        const count = o.count ?? o.mentions;
        return typeof count === "number" ? `${name} (${count})` : name;
      }
      return "";
    }).filter(Boolean);
  }
  if (typeof themesJson === "object") {
    return Object.entries(themesJson as Record<string, unknown>).map(([k, v]) =>
      typeof v === "number" ? `${k} (${v})` : k,
    );
  }
  return [];
}

/* ---------------- AX16: web push ---------------- */

export interface PushSetting {
  enabled: boolean;
  promptDelaySec: number;
  hasKeys: boolean;
  vapidPublicKey: string | null;
  subscriberCount: number;
  testDeviceCount: number;
}

export interface PushCampaignCounts {
  sent: number;
  failed: number;
  gone: number;
}

export interface PushCampaign {
  id: string;
  title: string;
  body: string;
  url?: string | null;
  status: string;
  createdAt?: string | null;
  sentCount?: number | null;
  failedCount?: number | null;
  goneCount?: number | null;
  totalCount?: number | null;
  counts?: Partial<PushCampaignCounts> & Record<string, number> | null;
  deliverySummary?: Record<string, number> | null;
}

/** Counts may arrive flat (sentCount…) or nested (counts.sent). */
export function campaignCounts(c: PushCampaign): PushCampaignCounts {
  const nested = c.counts ?? c.deliverySummary ?? {};
  const pick = (flat: number | null | undefined, key: string): number => {
    if (typeof flat === "number") return flat;
    const n = (nested as Record<string, unknown>)[key];
    return typeof n === "number" ? n : 0;
  };
  return {
    sent: pick(c.sentCount, "sent"),
    failed: pick(c.failedCount, "failed"),
    gone: pick(c.goneCount, "gone"),
  };
}

export function pushCampaignStatusLabel(status: string, locale: UiLocale = "bn"): string {
  const d = SD(locale);
  switch (status) {
    case "sent": return d.pushSent;
    case "sending": return d.pushSending;
    case "queued": return d.pushQueued;
    case "draft": return d.pushDraft;
    case "failed": return d.pushFailed;
    case "partial": return d.pushPartial;
    case "test": return d.pushTest;
    default: return status;
  }
}

/** Public key shown read-only, truncated — never the full key. */
export function shortenPublicKey(key: string | null | undefined): string {
  if (!key) return "—";
  const k = key.trim();
  if (k.length <= 20) return k;
  return `${k.slice(0, 12)}…${k.slice(-6)}`;
}

/** Composer URL must be shop-relative ("/…"), never absolute. */
export function isShopRelativeUrl(url: string): boolean {
  const u = url.trim();
  if (!u) return true; // empty = no link, allowed
  return u.startsWith("/") && !u.startsWith("//");
}

/** VAPID public key (base64url) → Uint8Array for pushManager.subscribe. */
export function urlBase64ToUint8Array(base64String: string): Uint8Array {
  const padding = "=".repeat((4 - (base64String.length % 4)) % 4);
  const base64 = (base64String + padding).replace(/-/g, "+").replace(/_/g, "/");
  const raw = atob(base64);
  const out = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; i += 1) out[i] = raw.charCodeAt(i);
  return out;
}

/* ---------------- AX17: social proof ---------------- */

export interface SocialProofSetting {
  enabled: boolean;
  lookbackHours: number;
  intervalSec: number;
  displaySec: number;
  maxPerSession: number;
  minTotalMinor: string | null;
  impressions: number;
}

/** টাকায় input → paisa string (empty = null / no minimum). */
export function minTotalTakaToMinor(takaInput: string): string | null {
  const t = takaInput.trim();
  if (!t) return null;
  return takaToMinorString(t);
}

/** Paisa string → টাকায় editable input string. */
export function minorToMinTotalTaka(minor: string | null | undefined): string {
  return minorToTakaString(minor);
}

/* ---------------- AX18: abandoned sequence state ---------------- */

export interface SequenceStep {
  step: string;
  status: string;
  detail?: string | null;
}

export interface CheckoutSequence {
  enrolled: boolean;
  workflowName?: string | null;
  runStatus?: string | null;
  currentStepIndex?: number | null;
  steps?: SequenceStep[];
  lastActivityAt?: string | null;
}

export function sequenceStatusLabel(status: string | null | undefined, locale: UiLocale = "bn"): string {
  if (!status) return "—";
  const d = SD(locale);
  switch (status) {
    case "running": case "active": case "in_progress": return d.seqRunning;
    case "completed": case "done": case "finished": return d.seqCompleted;
    case "failed": case "error": return d.seqFailed;
    case "waiting": case "pending": case "scheduled": return d.seqWaiting;
    case "sent": return d.seqSent;
    case "skipped": return d.seqSkipped;
    case "cancelled": case "canceled": case "stopped": return d.seqCancelled;
    default: return status;
  }
}

/* ---------------- AX19: commerce source analytics ---------------- */

export interface SourceRow {
  source: string;
  orders: number;
  revenueMinor: string;
}

export interface SourcesPayload {
  rows: SourceRow[];
  totals: {
    orders: number;
    revenueMinor: string;
    withClickId: number;
    stampedOrders: number;
  };
}

/* ---------------- AX20: inventory velocity v2 ---------------- */

export type DemandBasis = "velocity" | "trend_seasonal";

/** v2 forecast fields that arrive ALONGSIDE the v1 velocity fields. */
export interface VelocityV2Fields {
  trendGrowthPct: number | null;
  weekdayFactors: number[];
  projectedDailyDemand: number;
  projectedStockoutDateV2: string | null;
  daysOfStockLeftV2: number | null;
  demandBasis: DemandBasis;
}

export function demandBasisLabel(basis: DemandBasis | string | null | undefined, locale: UiLocale = "bn"): string {
  const d = SD(locale);
  return basis === "trend_seasonal" ? d.basisTrendSeasonal : d.basisVelocity;
}

export interface TrendDisplay { text: string; tone: "up" | "down" | "flat" | "none" }

/** Trend growth % → signed display; null is an honest "—". */
export function trendGrowthDisplay(pct: number | null | undefined): TrendDisplay {
  if (pct === null || pct === undefined || Number.isNaN(pct)) return { text: "—", tone: "none" };
  const rounded = Math.round(pct * 10) / 10;
  const body = `${Math.abs(rounded)}%`;
  if (rounded > 0) return { text: `+${body}`, tone: "up" };
  if (rounded < 0) return { text: `-${body}`, tone: "down" };
  return { text: body, tone: "flat" };
}

export interface StockoutDisplay { primary: string | null; secondary: string | null }

/**
 * Projected stockout: the v2 (trend+seasonal) date is primary
 * when present; the v1 (velocity) date shows secondarily only
 * when it is a DIFFERENT calendar day.
 */
export function pickStockoutDisplay(
  v1Date: string | null | undefined,
  v2Date: string | null | undefined,
): StockoutDisplay {
  const day = (d: string | null | undefined) => (d ? d.slice(0, 10) : null);
  const v1 = day(v1Date);
  const v2 = day(v2Date);
  if (v2) return { primary: v2Date ?? null, secondary: v1 && v1 !== v2 ? (v1Date ?? null) : null };
  return { primary: v1Date ?? null, secondary: null };
}

/* ---------------- AX20: landing variant statistics ---------------- */

export interface VariantVsControl {
  pValue: number;
  significant: boolean;
  note?: string | null;
}

export interface LandingVariantStatV2 {
  conversionRate?: number | null;
  vsControl?: VariantVsControl | null;
}

/**
 * conversionRate arrives as a fraction (0.125 = 12.5%). A value
 * above 1 can only be an already-percent number — display as-is.
 */
export function formatConversionRate(rate: number | null | undefined): string {
  if (rate === null || rate === undefined || Number.isNaN(rate)) return "—";
  const pct = rate <= 1 ? rate * 100 : rate;
  const rounded = Math.round(pct * 100) / 100;
  return `${rounded}%`;
}

/** p-value → compact display ("<0.001" below the floor). */
export function formatPValue(p: number | null | undefined): string {
  if (p === null || p === undefined || Number.isNaN(p)) return "—";
  if (p < 0.001) return "<0.001";
  return String(Math.round(p * 1000) / 1000);
}

export type VariantSignificance =
  | { kind: "significant"; label: string }
  | { kind: "insufficient"; label: string }
  | { kind: "none"; label: string };

/** vsControl → marker state. Display only — never auto-switch. */
export function variantSignificance(vs: VariantVsControl | null | undefined, locale: UiLocale = "bn"): VariantSignificance {
  if (!vs) return { kind: "none", label: "" };
  const d = SD(locale);
  if (vs.note === "insufficient_data") return { kind: "insufficient", label: d.variantInsufficient };
  if (vs.significant) return { kind: "significant", label: d.variantSignificant };
  return { kind: "none", label: "" };
}
