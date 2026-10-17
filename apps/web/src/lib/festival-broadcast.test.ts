import { describe, it, expect } from "vitest";
import {
  BROADCAST_SEGMENTS,
  FESTIVAL_BROADCAST_TEMPLATES,
  calculateSmsParts,
  hasOptOutStopWord,
  appendOptOutNotice,
  simulateBroadcastBlast,
  interpolateFestivalTemplate,
} from "./festival-broadcast";

describe("Bangladeshi Festival Broadcast & Blast Engine", () => {
  it("provides 5 core high-converting customer segments with filter criteria", () => {
    expect(BROADCAST_SEGMENTS.length).toBe(5);
    const ids = BROADCAST_SEGMENTS.map((s) => s.id);
    expect(ids).toContain("vip_champions");
    expect(ids).toContain("inactive_60_days");
    expect(ids).toContain("repeat_cod");
    expect(ids).toContain("cart_abandoners");
    expect(ids).toContain("all_customers");
  });

  it("contains pre-built templates for all key Bangladeshi festivals", () => {
    expect(FESTIVAL_BROADCAST_TEMPLATES.length).toBeGreaterThanOrEqual(7);
    const festivals = FESTIVAL_BROADCAST_TEMPLATES.map((t) => t.festivalKey);
    expect(festivals).toContain("eid_ul_fitr");
    expect(festivals).toContain("eid_ul_adha");
    expect(festivals).toContain("pohela_boishakh");
    expect(festivals).toContain("black_friday_11_11");
    expect(festivals).toContain("winter_clearance");
  });

  it("calculates single and multi-part SMS lengths for English and Bengali Unicode", () => {
    // English GSM-7
    const engShort = calculateSmsParts("Eid Mega Sale! Get 20% off. Order now!");
    expect(engShort.parts).toBe(1);
    expect(engShort.isUnicode).toBe(false);

    // Bengali Unicode (<= 70 chars is 1 part)
    const bnShort = calculateSmsParts("ঈদ মোবারক! ২০% ছাড়ে আজই অর্ডার করুন।");
    expect(bnShort.parts).toBe(1);
    expect(bnShort.isUnicode).toBe(true);

    // Bengali Unicode long (> 70 chars splits at 67 chars/part)
    const bnLong = calculateSmsParts(
      "ঈদ মোবারক! আমাদের সব প্রিমিয়াম পাঞ্জাবি ও থ্রি-পিস কালেকশনে চলছে অবিশ্বাস্য মূল্যছাড়। যেকোনো ২টি অর্ডারে ফ্রি ডেলিভারি!"
    );
    expect(bnLong.parts).toBeGreaterThanOrEqual(2);
    expect(bnLong.isUnicode).toBe(true);
  });

  it("verifies opt-out stop words for BTRC regulatory compliance", () => {
    expect(hasOptOutStopWord("Order now: https://shop.com/sale বন্ধ করতে STOP লিখুন")).toBe(true);
    expect(hasOptOutStopWord("Order now: https://shop.com/sale Unsub: STOP")).toBe(true);
    expect(hasOptOutStopWord("Order now: https://shop.com/sale")).toBe(false);

    const appendedSms = appendOptOutNotice("Order now: https://shop.com", "sms");
    expect(appendedSms).toContain("বন্ধ করতে STOP লিখুন");
  });

  it("simulates broadcast cost, conversions, GMV, and ROAS accurately", () => {
    const sim = simulateBroadcastBlast({
      channel: "sms",
      audienceSize: 5000,
      messageText: "ঈদ ধামাকা অফার! ২০% ছাড়ে আজই অর্ডার করুন। বন্ধ করতে STOP লিখুন",
      ratePerSmsPartBdt: 0.4,
      expectedAovBdt: 1800,
      estimatedConversionRatePercent: 3.0, // 150 orders
    });

    expect(sim.audienceSize).toBe(5000);
    expect(sim.smsPartsPerMessage).toBe(1);
    expect(sim.costPerRecipientBdt).toBe(0.4);
    expect(sim.totalCampaignCostBdt).toBe(2000); // 5000 * 0.40
    expect(sim.expectedConversions).toBe(150);
    expect(sim.expectedRevenueBdt).toBe(270000); // 150 * 1800
    expect(sim.expectedNetMarginBdt).toBe(268000); // 270000 - 2000
    expect(sim.projectedRoas).toBe(135); // 270,000 / 2,000 = 135x
    expect(sim.hasOptOutStopWord).toBe(true);
  });

  it("interpolates dynamic template variables cleanly", () => {
    const raw = "সালাম {customer_name}! {store_name}-এ ব্যবহার করুন কুপন {discount_code}: {shop_url}";
    const formatted = interpolateFestivalTemplate(raw, {
      customerName: "মাহমুদ হাসান",
      storeName: "স্মার্ট ফ্যাশন",
      discountCode: "EIDVIP",
      shopUrl: "https://smartfashion.bd",
    });

    expect(formatted).toContain("মাহমুদ হাসান");
    expect(formatted).toContain("স্মার্ট ফ্যাশন");
    expect(formatted).toContain("EIDVIP");
    expect(formatted).toContain("https://smartfashion.bd");
  });
});
