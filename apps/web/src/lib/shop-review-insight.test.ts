import { describe, expect, it } from "vitest";
import { reviewInsightFromPayload, sentimentPercents } from "./shop-review-insight";

/**
 * AB7 (AX15) — review-insight normalization. Pinned: only a
 * payload with a real summaryText counts as an insight;
 * { insight: null } and malformed payloads normalize to null
 * (the PDP box renders nothing); sentiment percents are
 * proportional to the counts.
 */
describe("reviewInsightFromPayload (AX15)", () => {
  const full = {
    summaryText: "ক্রেতারা কাপড়ের মান পছন্দ করেছেন।",
    sentiment: { positive: 8, neutral: 1, negative: 1, total: 10 },
    themes: ["মান", "ডেলিভারি"],
    generatedAt: "2026-10-16T00:00:00.000Z",
    reviewCount: 10,
  };

  it("accepts the top-level contract shape", () => {
    expect(reviewInsightFromPayload(full)).toEqual(full);
  });

  it("returns null for { insight: null } and other empty payloads", () => {
    expect(reviewInsightFromPayload({ insight: null })).toBeNull();
    expect(reviewInsightFromPayload(null)).toBeNull();
    expect(reviewInsightFromPayload({})).toBeNull();
    expect(reviewInsightFromPayload({ summaryText: "  " })).toBeNull();
  });

  it("accepts a nested insight object", () => {
    expect(reviewInsightFromPayload({ insight: full })).toEqual(full);
  });

  it("derives total/reviewCount from sentiment when absent", () => {
    const out = reviewInsightFromPayload({
      summaryText: "সারসংক্ষেপ",
      sentiment: { positive: 2, neutral: 1, negative: 0 },
      themes: [],
      generatedAt: "",
    });
    expect(out?.sentiment.total).toBe(3);
    expect(out?.reviewCount).toBe(3);
  });

  it("sentimentPercents are proportional", () => {
    expect(sentimentPercents({ positive: 8, neutral: 1, negative: 1, total: 10 })).toEqual({
      positive: 80,
      neutral: 10,
      negative: 10,
    });
    expect(sentimentPercents({ positive: 0, neutral: 0, negative: 0, total: 0 })).toEqual({
      positive: 0,
      neutral: 0,
      negative: 0,
    });
  });
});
