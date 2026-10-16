/**
 * AB7 (AX15) — AI review-insight payload normalization (pure).
 *
 * Contract: GET /public/shop/:orgSlug/products/:productSlug/
 * review-insight returns either the insight fields at top level
 * ({ summaryText, sentiment, themes, generatedAt, reviewCount })
 * or { insight: null } when no insight exists. A nested
 * { insight: {...} } shape is also tolerated. Anything without
 * a non-empty summaryText is NOT an insight — the PDP box
 * renders nothing for it.
 */

export interface ReviewInsight {
  summaryText: string;
  sentiment: { positive: number; neutral: number; negative: number; total: number };
  themes: string[];
  generatedAt: string;
  reviewCount: number;
}

function countOf(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value) && value > 0 ? Math.floor(value) : 0;
}

/** Normalize the endpoint payload; null when there is no insight. */
export function reviewInsightFromPayload(payload: unknown): ReviewInsight | null {
  if (!payload || typeof payload !== "object") return null;
  const p = payload as Record<string, unknown>;
  if (p.insight === null) return null;
  const src =
    p.insight && typeof p.insight === "object" ? (p.insight as Record<string, unknown>) : p;
  const summaryText = typeof src.summaryText === "string" ? src.summaryText.trim() : "";
  if (!summaryText) return null;
  const sRaw =
    src.sentiment && typeof src.sentiment === "object"
      ? (src.sentiment as Record<string, unknown>)
      : {};
  const positive = countOf(sRaw.positive);
  const neutral = countOf(sRaw.neutral);
  const negative = countOf(sRaw.negative);
  const total = countOf(sRaw.total) || positive + neutral + negative;
  const themes = Array.isArray(src.themes)
    ? src.themes.filter((t): t is string => typeof t === "string" && !!t.trim()).map((t) => t.trim())
    : [];
  return {
    summaryText,
    sentiment: { positive, neutral, negative, total },
    themes,
    generatedAt: typeof src.generatedAt === "string" ? src.generatedAt : "",
    reviewCount: countOf(src.reviewCount) || total,
  };
}

/** Segment widths (%) for the sentiment bar; always sums sanely for total > 0. */
export function sentimentPercents(sentiment: ReviewInsight["sentiment"]): {
  positive: number;
  neutral: number;
  negative: number;
} {
  const total = sentiment.total || sentiment.positive + sentiment.neutral + sentiment.negative;
  if (total <= 0) return { positive: 0, neutral: 0, negative: 0 };
  const pct = (n: number) => Math.max(0, Math.min(100, (n / total) * 100));
  return {
    positive: pct(sentiment.positive),
    neutral: pct(sentiment.neutral),
    negative: pct(sentiment.negative),
  };
}
