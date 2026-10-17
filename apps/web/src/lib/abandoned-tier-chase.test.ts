import { describe, expect, it } from "vitest";
import {
  DEFAULT_TIER_CONFIG,
  buildTierMessage,
  calculateSequenceRecoveryRoi,
  determineCurrentChaseTier,
} from "./abandoned-tier-chase";

describe("Multi-Tier Abandoned WhatsApp Chase Bot Engine", () => {
  it("builds friendly reminder copy for Tier 1 without discount codes", () => {
    const msg = buildTierMessage(1, {
      customerName: "কামাল ভাই",
      productName: "প্রিমিয়াম পান্জাবি",
      storeName: "রুপসী ফ্যাশন",
      checkoutUrl: "https://shop.example.com/cart/123",
    });

    expect(msg).toContain("কামাল ভাই");
    expect(msg).toContain("রুপসী ফ্যাশন");
    expect(msg).toContain("প্রিমিয়াম পান্জাবি");
    expect(msg).toContain("স্টক দ্রুত ফুরিয়ে যাচ্ছে");
    expect(msg).toContain("https://shop.example.com/cart/123");
    expect(msg).not.toContain("SAVE50");
  });

  it("builds incentive copy for Tier 2 with SAVE50 coupon", () => {
    const msg = buildTierMessage(2, {
      customerName: "সাদিয়া আপু",
      productName: "জামদানি শাড়ি",
      config: {
        tier2CouponCode: "SAVE50",
        tier2DiscountText: "৳৫০ স্পেশাল ক্যাশ ছাড়",
      },
    });

    expect(msg).toContain("সাদিয়া আপু");
    expect(msg).toContain("SAVE50");
    expect(msg).toContain("৳৫০ স্পেশাল ক্যাশ ছাড়");
    expect(msg).toContain("বিশেষ ছাড় উপহার দিচ্ছি");
  });

  it("builds urgency clearance copy for Tier 3 with FINAL100 coupon", () => {
    const msg = buildTierMessage(3, {
      customerName: "রাকিব",
      productName: "লেদার ওয়ালেট",
    });

    expect(msg).toContain("রাকিব");
    expect(msg).toContain("শেষ সুযোগ");
    expect(msg).toContain("FINAL100");
    expect(msg).toContain("৳১০০ ফাইনাল কুপন ছাড়");
  });

  it("determines correct tier readiness based on elapsed time and prior attempts", () => {
    const now = Date.now();

    // 5 minutes ago, 0 attempts -> Not ready for Tier 1 (15m required)
    const fiveMinAgo = new Date(now - 5 * 60 * 1000).toISOString();
    const t1NotReady = determineCurrentChaseTier(fiveMinAgo, 0);
    expect(t1NotReady.nextTier).toBe(1);
    expect(t1NotReady.isReady).toBe(false);
    expect(t1NotReady.waitMessageBangla).toContain("মিনিট অপেক্ষা");

    // 20 minutes ago, 0 attempts -> Ready for Tier 1
    const twentyMinAgo = new Date(now - 20 * 60 * 1000).toISOString();
    const t1Ready = determineCurrentChaseTier(twentyMinAgo, 0);
    expect(t1Ready.nextTier).toBe(1);
    expect(t1Ready.isReady).toBe(true);
    expect(t1Ready.waitMessageBangla).toContain("টিয়ার ১");

    // 40 minutes ago, 1 attempt -> Waiting for Tier 2 (60m required)
    const fortyMinAgo = new Date(now - 40 * 60 * 1000).toISOString();
    const t2NotReady = determineCurrentChaseTier(fortyMinAgo, 1);
    expect(t2NotReady.nextTier).toBe(2);
    expect(t2NotReady.isReady).toBe(false);

    // 70 minutes ago, 1 attempt -> Ready for Tier 2
    const seventyMinAgo = new Date(now - 70 * 60 * 1000).toISOString();
    const t2Ready = determineCurrentChaseTier(seventyMinAgo, 1);
    expect(t2Ready.nextTier).toBe(2);
    expect(t2Ready.isReady).toBe(true);

    // 25 hours ago, 2 attempts -> Ready for Tier 3
    const twentyFiveHrsAgo = new Date(now - 25 * 3600 * 1000).toISOString();
    const t3Ready = determineCurrentChaseTier(twentyFiveHrsAgo, 2);
    expect(t3Ready.nextTier).toBe(3);
    expect(t3Ready.isReady).toBe(true);

    // 3 attempts -> Finished
    const finished = determineCurrentChaseTier(twentyFiveHrsAgo, 3);
    expect(finished.nextTier).toBeNull();
    expect(finished.isReady).toBe(false);
  });

  it("calculates multi-tier recovery projections and ROI accurately", () => {
    const roi = calculateSequenceRecoveryRoi(100, 2000, 8.5, 6.2, 3.8);
    // 100 * 8.5% = 9, 100 * 6.2% = 6, 100 * 3.8% = 4 => total 19
    expect(roi.tier1Count).toBe(9);
    expect(roi.tier2Count).toBe(6);
    expect(roi.tier3Count).toBe(4);
    expect(roi.recoveredOrders).toBe(19);
    expect(roi.recoveredRevenueTaka).toBe(38000);
    expect(roi.overallRecoveryRatePct).toBe(19);
  });
});
