import { describe, expect, it } from "vitest";
import {
  generateInfluencerTrackingUrl,
  calculateInfluencerRoi,
  getPlatformMeta,
  SOCIAL_PLATFORMS,
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
});
