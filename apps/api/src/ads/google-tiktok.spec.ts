import { GoogleAdsClient, microsToMinor, normalizeGoogleRow } from "./google/google.client";
import { TikTokAdsClient, normalizeTikTokRow } from "./tiktok/tiktok.client";

describe("Google Ads conversions", () => {
  it("micros convert to minor units exactly", () => {
    expect(microsToMinor("123456789")).toBe(12346n); // 123.456789 -> 123.46
    expect(microsToMinor("1000000")).toBe(100n);     // 1.00
    expect(microsToMinor(0)).toBe(0n);
  });
  it("normalizes a GAQL row", () => {
    const row = normalizeGoogleRow({
      segments: { date: "2026-10-05" }, campaign: { id: 111, name: "Search - Shoes" },
      customer: { currencyCode: "BDT" },
      metrics: { costMicros: "250000000", impressions: "900", clicks: "45", conversions: 3, conversionsValue: 5400.5 },
    });
    expect(row).toMatchObject({ date: "2026-10-05", campaignExternalId: "111", spendMinor: 25000n, clicks: 45, conversions: 3, conversionValueMinor: 540050n, currency: "BDT" });
  });
  it("OAuth failures surface Google's description", async () => {
    const fetchFn = async () => ({ ok: false, status: 400, json: async () => ({ error: "invalid_grant", error_description: "Token has been revoked" }) }) as any;
    const client = new GoogleAdsClient({ clientId: "a", clientSecret: "b", refreshToken: "r", developerToken: "d" }, fetchFn as any);
    await expect(client.getAccessToken()).rejects.toThrow("revoked");
  });
});

describe("TikTok normalization", () => {
  it("normalizes an integrated report row", () => {
    const row = normalizeTikTokRow({
      dimensions: { campaign_id: 777, stat_time_day: "2026-10-05 00:00:00" },
      metrics: { spend: "321.40", impressions: "5000", clicks: "120", conversion: "8", complete_payment_value: "4100.00", currency: "BDT", campaign_name: "Spark Sale" },
    });
    expect(row).toMatchObject({ date: "2026-10-05", campaignExternalId: "777", spendMinor: 32140n, clicks: 120, conversions: 8, conversionValueMinor: 410000n, currency: "BDT", campaignName: "Spark Sale" });
  });
  it("API envelope errors are surfaced, not swallowed", async () => {
    const fetchFn = async () => ({ ok: true, status: 200, json: async () => ({ code: 40002, message: "Advertiser not authorized" }) }) as any;
    const client = new TikTokAdsClient("tok", fetchFn as any);
    await expect(client.verifyAdvertiser("123")).rejects.toThrow("not authorized");
  });
});
