import { describe, expect, it } from "vitest";
import {
  generateInfluencerTrackingUrl,
  calculateInfluencerRoi,
  getPlatformMeta,
  SOCIAL_PLATFORMS,
  simulateInfluencerCampaign,
  formatBdPhoneForWhatsApp,
  buildInfluencerWhatsAppBriefing,
  buildInfluencerWhatsAppUrl,
  buildPayoutReceiptText,
} from "./influencer-campaign";

describe("Influencer Campaign Tracking & ROI Helpers", () => {
  it("should generate fully UTM-tagged tracking URL", () => {
    const url = generateInfluencerTrackingUrl({
      baseUrl: "https://myshop.com",
      code: "RAFI10",
      platform: "instagram",
      campaignName: "Eid Campaign 2026",
    });

    expect(url).toContain("https://myshop.com");
    expect(url).toContain("ref=RAFI10");
    expect(url).toContain("utm_source=instagram");
    expect(url).toContain("utm_medium=influencer");
    expect(url).toContain("utm_campaign=eid_campaign_2026");
  });

  it("should calculate correct ROI multiplier", () => {
    // ৳50,000 revenue from ৳5,000 influencer cost -> 10.0x ROI
    const res = calculateInfluencerRoi("5000000", "500000", 15);
    expect(res.roiMultiplier).toBe(10);
    expect(res.profitable).toBe(true);
    expect(res.ordersCount).toBe(15);
  });

  it("should flag unprofitable influencer deal if cost exceeds revenue", () => {
    // ৳3,000 revenue from ৳5,000 influencer cost -> 0.6x ROI (Loss)
    const res = calculateInfluencerRoi("300000", "500000", 2);
    expect(res.roiMultiplier).toBe(0.6);
    expect(res.profitable).toBe(false);
  });

  it("should map supported social platforms with labels and icons", () => {
    expect(SOCIAL_PLATFORMS.length).toBeGreaterThanOrEqual(4);
    const meta = getPlatformMeta("youtube");
    expect(meta.label).toBe("YouTube");
    expect(meta.icon).toBe("▶️");
  });

  it("should simulate influencer campaign ROI and break-even points", () => {
    const simulation = simulateInfluencerCampaign({
      fixedFeeBdt: 10000,
      commissionPercent: 10,
      estimatedViews: 100000,
      engagementRatePercent: 2.0, // 2,000 clicks
      conversionRatePercent: 2.5, // 50 orders
      averageOrderValueBdt: 1500, // ৳75,000 GMV
    });

    expect(simulation.expectedClicks).toBe(2000);
    expect(simulation.expectedOrders).toBe(50);
    expect(simulation.expectedRevenueBdt).toBe(75000);
    expect(simulation.expectedCommissionBdt).toBe(7500); // 10% of 75,000
    expect(simulation.totalCostBdt).toBe(17500); // 10,000 fixed + 7,500 commission
    expect(simulation.netProfitBdt).toBe(57500);
    expect(simulation.estimatedRoas).toBe(4.29); // 75,000 / 17,500
    expect(simulation.isProfitable).toBe(true);
    expect(simulation.breakEvenOrders).toBe(8); // 10,000 / (1500 * 0.9 = 1350) = 7.4 -> 8 orders
  });

  it("should correctly format Bangladeshi mobile numbers for WhatsApp deep links", () => {
    expect(formatBdPhoneForWhatsApp("01712345678")).toBe("8801712345678");
    expect(formatBdPhoneForWhatsApp("+880 1812-345678")).toBe("8801812345678");
    expect(formatBdPhoneForWhatsApp("8801912345678")).toBe("8801912345678");
  });

  it("should build high-converting WhatsApp briefing for content creators", () => {
    const text = buildInfluencerWhatsAppBriefing({
      creatorName: "তানিয়া ইসলাম",
      brandName: "StyleBD",
      promoCode: "TANIA10",
      trackingUrl: "https://stylebd.com?ref=TANIA10&utm_source=tiktok",
      commissionPercent: 10,
    });

    expect(text).toContain("তানিয়া ইসলাম");
    expect(text).toContain("StyleBD");
    expect(text).toContain("*TANIA10*");
    expect(text).toContain("10%");
    expect(text).toContain("https://stylebd.com?ref=TANIA10&utm_source=tiktok");
  });

  it("should build direct wa.me link with encoded briefing message", () => {
    const link = buildInfluencerWhatsAppUrl("01712345678", "Hello Tania! Check promo");
    expect(link).toContain("https://wa.me/8801712345678?text=Hello%20Tania!%20Check%20promo");
  });

  it("should format payout voucher confirmation message with transaction details", () => {
    const voucher = buildPayoutReceiptText({
      creatorName: "রাফি আহমেদ",
      brandName: "GadgetHub",
      amountBdt: 4500,
      method: "bkash",
      reference: "TRX99882233",
      date: "17/10/2026",
    });

    expect(voucher).toContain("রাফি আহমেদ");
    expect(voucher).toContain("GadgetHub");
    expect(voucher).toContain("৳4500");
    expect(voucher).toContain("bKash (বিকাশ)");
    expect(voucher).toContain("TRX99882233");
    expect(voucher).toContain("17/10/2026");
  });
});
