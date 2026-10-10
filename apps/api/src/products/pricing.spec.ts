import { computeMargin } from "./pricing";

describe("computeMargin", () => {
  it("computes margin and percentages", () => {
    const r = computeMargin(10000n, 6000n); // price 100.00, cost 60.00
    expect(r.marginMinor).toBe(4000n);
    expect(r.marginPercent).toBe(40);
    expect(r.markupPercent).toBe(66.66);
  });
  it("returns nulls when cost is unknown - never invents a margin", () => {
    const r = computeMargin(10000n, null);
    expect(r.marginMinor).toBeNull();
    expect(r.marginPercent).toBeNull();
  });
  it("handles a loss-making product", () => {
    const r = computeMargin(5000n, 7000n);
    expect(r.marginMinor).toBe(-2000n);
    expect(r.marginPercent).toBe(-40);
  });
  it("handles zero price without dividing by zero", () => {
    expect(computeMargin(0n, 100n).marginPercent).toBeNull();
  });
});
