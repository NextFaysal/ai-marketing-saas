import { computeAdKpis, chooseCostForDate, contributionProfit, ratio2 } from "./metrics";

describe("computeAdKpis", () => {
  it("computes CTR, CPC, CPM, CPA, platform ROAS and MER", () => {
    const k = computeAdKpis({
      spendMinor: 100000n, impressions: 50000, clicks: 1000,
      platformConversions: 25, platformConversionValueMinor: 350000n, revenueMinor: 300000n,
    });
    expect(k.ctrPercent).toBe(2);
    expect(k.cpcMinor).toBe(100);      // 1000.00 spend / 1000 clicks = 1.00 = 100 minor
    expect(k.cpmMinor).toBe(2000);     // per 1000 impressions
    expect(k.cpaMinor).toBe(4000);     // 100000 / 25
    expect(k.platformRoas).toBe(3.5);
    expect(k.mer).toBe(3);
  });
  it("returns nulls instead of dividing by zero or inventing values", () => {
    const k = computeAdKpis({ spendMinor: 0n, impressions: 0, clicks: 0, platformConversions: 0, platformConversionValueMinor: 0n, revenueMinor: 0n });
    expect(k.ctrPercent).toBeNull();
    expect(k.cpcMinor).toBeNull();
    expect(k.platformRoas).toBeNull();
    expect(k.mer).toBeNull();
  });
});

describe("chooseCostForDate", () => {
  const costs = [
    { costMinor: 500n, effectiveFrom: new Date("2026-01-01") },
    { costMinor: 600n, effectiveFrom: new Date("2026-06-01") },
  ];
  it("uses the cost in effect on the order date", () => {
    expect(chooseCostForDate(costs, new Date("2026-03-01"))).toBe(500n);
    expect(chooseCostForDate(costs, new Date("2026-09-01"))).toBe(600n);
  });
  it("falls back to the earliest known cost before any effective date", () => {
    expect(chooseCostForDate(costs, new Date("2025-01-01"))).toBe(500n);
  });
  it("returns null when no cost is known", () => {
    expect(chooseCostForDate([], new Date())).toBeNull();
  });
});

describe("contributionProfit", () => {
  it("revenue - refunds - COGS - ad spend", () => {
    const r = contributionProfit({ revenueMinor: 100000n, refundedMinor: 5000n, cogsMinor: 40000n, adSpendMinor: 20000n });
    expect(r.profitMinor).toBe(35000n);
    expect(r.marginPercent).toBe(35);
  });
  it("can be negative and still reports a margin", () => {
    const r = contributionProfit({ revenueMinor: 10000n, refundedMinor: 0n, cogsMinor: 8000n, adSpendMinor: 5000n });
    expect(r.profitMinor).toBe(-3000n);
    expect(r.marginPercent).toBe(-30);
  });
  it("ratio2 handles bigint rounding", () => {
    expect(ratio2(1n, 3n)).toBe(0.33);
    expect(ratio2(10n, 0n)).toBeNull();
  });
});
