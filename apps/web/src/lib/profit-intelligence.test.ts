import { describe, expect, it } from "vitest";
import {
  computeProfitWaterfall,
  computeUnitEconomics,
  getDateRangePreset,
} from "./profit-intelligence";

describe("Profit Intelligence", () => {
  it("should accurately compute profit waterfall", () => {
    const profit = {
      revenueMinor: "10000000", // 100,000 tk
      refundedMinor: "1000000",  // 10,000 tk
      cogsMinor: "4000000",      // 40,000 tk
      adSpendMinor: "2000000",   // 20,000 tk
      contributionProfitMinor: "3000000", // 30,000 tk
      contributionMarginPercent: 30,
    };

    const wf = computeProfitWaterfall(profit);
    expect(wf.grossRevenue).toBe(10000000n);
    expect(wf.refunded).toBe(1000000n);
    expect(wf.netRevenue).toBe(9000000n);
    expect(wf.cogs).toBe(4000000n);
    expect(wf.grossProfit).toBe(5000000n);
    expect(wf.adSpend).toBe(2000000n);
    expect(wf.contributionProfit).toBe(3000000n);
    expect(wf.isProfitable).toBe(true);
    expect(wf.contributionMarginPercent).toBe(30);
  });

  it("should accurately compute unit economics metrics", () => {
    const waterfall = {
      grossRevenue: 10000000n,
      refunded: 1000000n,
      netRevenue: 9000000n,
      cogs: 4000000n,
      grossProfit: 5000000n,
      adSpend: 2000000n,
      contributionProfit: 3000000n,
      contributionMarginPercent: 30,
      isProfitable: true,
    };

    const ue = computeUnitEconomics(waterfall, 100);
    expect(ue.ordersCount).toBe(100);
    expect(ue.averageOrderValue).toBe(100000n); // 1,000 tk
    expect(ue.profitPerOrder).toBe(30000n);     // 300 tk
    expect(ue.adSpendPerOrder).toBe(20000n);    // 200 tk
    expect(ue.returnLossRatePercent).toBe(10);
    expect(ue.adSpendRatioPercent).toBe(20);
    expect(ue.cogsRatioPercent).toBe(40);
  });

  it("should handle date presets properly", () => {
    const p7 = getDateRangePreset("last7");
    expect(p7.from).toBeDefined();
    expect(p7.to).toBeDefined();
    expect(p7.label).toContain("৭ দিন");

    const p30 = getDateRangePreset("last30");
    expect(p30.from).toBeDefined();
    expect(p30.to).toBeDefined();

    const pThis = getDateRangePreset("thisMonth");
    expect(pThis.from.endsWith("-01")).toBe(true);
  });
});
