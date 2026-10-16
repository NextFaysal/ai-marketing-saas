import { describe, expect, it } from "vitest";
import {
  campaignCounts, demandBasisLabel, formatConversionRate, formatPValue,
  insightNeedsRegeneration, isShopRelativeUrl, minorToMinTotalTaka,
  minTotalTakaToMinor, pickStockoutDisplay, pushCampaignStatusLabel,
  sentimentPercents, sequenceStatusLabel, shortenPublicKey, themeLabels,
  trendGrowthDisplay, urlBase64ToUint8Array, variantSignificance,
} from "./ab7";

describe("AB7 AX15 review insight helpers", () => {
  it("sentimentPercents: shares of the total, zero-safe", () => {
    expect(sentimentPercents({ positive: 8, neutral: 1, negative: 1, total: 10 }))
      .toEqual({ positive: 80, neutral: 10, negative: 10 });
    expect(sentimentPercents({ positive: 0, neutral: 0, negative: 0, total: 0 }))
      .toEqual({ positive: 0, neutral: 0, negative: 0 });
    expect(sentimentPercents(null)).toEqual({ positive: 0, neutral: 0, negative: 0 });
    // total missing (0) falls back to the parts sum, never NaN
    expect(sentimentPercents({ positive: 1, neutral: 1, negative: 2, total: 0 }))
      .toEqual({ positive: 25, neutral: 25, negative: 50 });
  });

  it("insightNeedsRegeneration fires at >= 10 new reviews", () => {
    expect(insightNeedsRegeneration(9)).toBe(false);
    expect(insightNeedsRegeneration(10)).toBe(true);
    expect(insightNeedsRegeneration(undefined)).toBe(false);
  });

  it("themeLabels renders labels from every server shape", () => {
    expect(themeLabels(["ডেলিভারি", "দাম"])).toEqual(["ডেলিভারি", "দাম"]);
    expect(themeLabels([{ theme: "মানের কথা", count: 3 }])).toEqual(["মানের কথা (3)"]);
    expect(themeLabels({ প্যাকেজিং: 2 })).toEqual(["প্যাকেজিং (2)"]);
    expect(themeLabels(null)).toEqual([]);
    expect(themeLabels(undefined)).toEqual([]);
  });
});

describe("AB7 AX16 push helpers", () => {
  it("campaignCounts accepts flat or nested count shapes", () => {
    expect(campaignCounts({ id: "1", title: "", body: "", status: "sent", sentCount: 5, failedCount: 1, goneCount: 2 }))
      .toEqual({ sent: 5, failed: 1, gone: 2 });
    expect(campaignCounts({ id: "1", title: "", body: "", status: "sent", counts: { sent: 3, failed: 0, gone: 1 } }))
      .toEqual({ sent: 3, failed: 0, gone: 1 });
    expect(campaignCounts({ id: "1", title: "", body: "", status: "queued" }))
      .toEqual({ sent: 0, failed: 0, gone: 0 });
  });

  it("isShopRelativeUrl: only single-slash relative paths pass", () => {
    expect(isShopRelativeUrl("")).toBe(true);
    expect(isShopRelativeUrl("/shop/org/product")).toBe(true);
    expect(isShopRelativeUrl("https://evil.example/x")).toBe(false);
    expect(isShopRelativeUrl("//evil.example/x")).toBe(false);
    expect(isShopRelativeUrl("shop/org")).toBe(false);
  });

  it("shortenPublicKey truncates long keys, keeps short ones", () => {
    expect(shortenPublicKey(null)).toBe("—");
    expect(shortenPublicKey("shortkey")).toBe("shortkey");
    const long = "BCDEFGHIJKLMNOPQRSTUVWXYZ0123456789abcdef";
    const out = shortenPublicKey(long);
    expect(out.startsWith("BCDEFGHIJKLM")).toBe(true);
    expect(out.endsWith("abcdef")).toBe(true);
    expect(out.length).toBeLessThan(long.length);
  });

  it("urlBase64ToUint8Array decodes base64url (VAPID key shape)", () => {
    // "hello" in base64url
    expect(Array.from(urlBase64ToUint8Array("aGVsbG8"))).toEqual([104, 101, 108, 108, 111]);
    // bytes that differ between base64 and base64url alphabets
    expect(Array.from(urlBase64ToUint8Array("-_8"))).toEqual([251, 255]);
  });

  it("pushCampaignStatusLabel maps known statuses, passes others through", () => {
    expect(pushCampaignStatusLabel("sent")).toBe("পাঠানো হয়েছে");
    expect(pushCampaignStatusLabel("weird_state")).toBe("weird_state");
  });
});

describe("AB7 AX17 social-proof money conversion", () => {
  it("টাকায় input converts to a paisa string exactly (no floats)", () => {
    expect(minTotalTakaToMinor("500")).toBe("50000");
    expect(minTotalTakaToMinor("60.50")).toBe("6050");
    expect(minTotalTakaToMinor("0.07")).toBe("7");
    expect(minTotalTakaToMinor("")).toBeNull();
    expect(minTotalTakaToMinor("abc")).toBeNull();
    expect(minTotalTakaToMinor("1.234")).toBeNull();
  });

  it("paisa string converts back to the editable টাকায় string", () => {
    expect(minorToMinTotalTaka("50000")).toBe("500");
    expect(minorToMinTotalTaka("6050")).toBe("60.50");
    expect(minorToMinTotalTaka(null)).toBe("");
  });
});

describe("AB7 AX18 sequence labels", () => {
  it("sequenceStatusLabel maps workflow states to Bengali", () => {
    expect(sequenceStatusLabel("running")).toBe("চলমান");
    expect(sequenceStatusLabel("completed")).toBe("সম্পন্ন");
    expect(sequenceStatusLabel(null)).toBe("—");
    expect(sequenceStatusLabel("custom_state")).toBe("custom_state");
  });
});

describe("AB7 AX20 inventory v2 helpers", () => {
  it("demandBasisLabel distinguishes the two bases", () => {
    expect(demandBasisLabel("trend_seasonal")).toBe("ট্রেন্ড+সিজনাল");
    expect(demandBasisLabel("velocity")).toBe("গতি-ভিত্তিক");
    expect(demandBasisLabel(undefined)).toBe("গতি-ভিত্তিক");
  });

  it("trendGrowthDisplay: signed, colored tones, null is a dash", () => {
    expect(trendGrowthDisplay(12.34)).toEqual({ text: "+12.3%", tone: "up" });
    expect(trendGrowthDisplay(-5)).toEqual({ text: "-5%", tone: "down" });
    expect(trendGrowthDisplay(0)).toEqual({ text: "0%", tone: "flat" });
    expect(trendGrowthDisplay(null)).toEqual({ text: "—", tone: "none" });
  });

  it("pickStockoutDisplay: v2 primary, v1 secondary only when different", () => {
    expect(pickStockoutDisplay("2026-11-01", "2026-10-28"))
      .toEqual({ primary: "2026-10-28", secondary: "2026-11-01" });
    expect(pickStockoutDisplay("2026-11-01T00:00:00Z", "2026-11-01"))
      .toEqual({ primary: "2026-11-01", secondary: null });
    expect(pickStockoutDisplay("2026-11-01", null))
      .toEqual({ primary: "2026-11-01", secondary: null });
    expect(pickStockoutDisplay(null, null)).toEqual({ primary: null, secondary: null });
  });
});

describe("AB7 AX20 landing statistics helpers", () => {
  it("formatConversionRate: fractions become percents", () => {
    expect(formatConversionRate(0.125)).toBe("12.5%");
    expect(formatConversionRate(0)).toBe("0%");
    expect(formatConversionRate(1)).toBe("100%");
    expect(formatConversionRate(12.5)).toBe("12.5%");
    expect(formatConversionRate(null)).toBe("—");
    expect(formatConversionRate(undefined)).toBe("—");
  });

  it("formatPValue: compact, floored below 0.001", () => {
    expect(formatPValue(0.0324)).toBe("0.032");
    expect(formatPValue(0.0004)).toBe("<0.001");
    expect(formatPValue(0.5)).toBe("0.5");
    expect(formatPValue(null)).toBe("—");
  });

  it("variantSignificance: significant / insufficient / silent", () => {
    expect(variantSignificance({ pValue: 0.01, significant: true }).kind).toBe("significant");
    expect(variantSignificance({ pValue: 0.4, significant: false, note: "insufficient_data" }))
      .toEqual({ kind: "insufficient", label: "পর্যাপ্ত ডেটা নেই" });
    expect(variantSignificance({ pValue: 0.4, significant: false }).kind).toBe("none");
    expect(variantSignificance(null).kind).toBe("none");
  });
});
