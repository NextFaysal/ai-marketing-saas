import { describe, it, expect } from "vitest";
import {
  calculateChurnProbability,
  predict12MonthClv,
  formatClvTaka,
  normalizeBdPhoneForCampaign,
  extractSegmentPhoneNumbers,
  buildSegmentCampaignMessage,
} from "./rfm-retention";

describe("rfm-retention helpers", () => {
  it("calculates churn risk level correctly", () => {
    // Recent buyer (10 days ago, 3 orders) -> low churn risk
    const low = calculateChurnProbability(10, 3);
    expect(low.level).toBe("low");
    expect(low.churnPct).toBeLessThan(30);

    // Mid recency (50 days ago, 2 orders)
    const mid = calculateChurnProbability(50, 2);
    expect(mid.churnPct).toBeGreaterThanOrEqual(25);

    // Repeat buyer who disappeared for 120 days -> high or critical churn risk
    const high = calculateChurnProbability(120, 4);
    expect(["high", "critical"]).toContain(high.level);
    expect(high.churnPct).toBeGreaterThanOrEqual(50);
  });

  it("predicts 12-month expected customer lifetime value (CLV)", () => {
    // Customer spent ৳10,000 across 2 orders in last 20 days
    const prediction = predict12MonthClv(1000000n, 2, 20);
    expect(prediction.predictedOrdersNextYear).toBeGreaterThanOrEqual(2);
    expect(prediction.predicted12MonthSpendMinor).toBeGreaterThan(0n);
    expect(prediction.formattedTaka).toContain("৳");
  });

  it("formats CLV into readable Bengali/Bangladeshi Taka format", () => {
    expect(formatClvTaka(500000n)).toBe("৳৫,০০০");
    expect(formatClvTaka("1250000")).toBe("৳১২,৫০০");
    expect(formatClvTaka(null)).toBe("৳০");
  });

  it("normalizes Bangladeshi phone numbers for WhatsApp/SMS", () => {
    expect(normalizeBdPhoneForCampaign("01712345678")).toBe("8801712345678");
    expect(normalizeBdPhoneForCampaign("8801812345678")).toBe("8801812345678");
    expect(normalizeBdPhoneForCampaign("+880 1912-345678")).toBe("8801912345678");
    expect(normalizeBdPhoneForCampaign("invalid")).toBeNull();
  });

  it("extracts and dedupes valid phone numbers from customer rows", () => {
    const rows = [
      { name: "Rahim", phone: "01711111111" },
      { name: "Karim", phone: "01711111111" }, // duplicate
      { name: "Jamal", phone: "01822222222" },
      { name: "No Phone", phone: null },
    ];
    const extracted = extractSegmentPhoneNumbers(rows);
    expect(extracted.rawCount).toBe(4);
    expect(extracted.validCount).toBe(2);
    expect(extracted.formattedList).toEqual(["8801711111111", "8801822222222"]);
    expect(extracted.textCsv).toBe("8801711111111, 8801822222222");
  });

  it("builds tailored Bengali promotional messages per RFM segment", () => {
    const vipMsg = buildSegmentCampaignMessage("champions", "কামরুল হাসান", "VIP20", "আমার শপ");
    expect(vipMsg).toContain("VIP কাস্টমার");
    expect(vipMsg).toContain("VIP20");

    const atRiskMsg = buildSegmentCampaignMessage("at_risk", "সাদিয়া রহমান", "COMEBACK15", "আমার শপ");
    expect(atRiskMsg).toContain("উইন-ব্যাক");
    expect(atRiskMsg).toContain("COMEBACK15");
  });
});
