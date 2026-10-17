import { describe, it, expect } from "vitest";
import {
  extractQuantityFromComment,
  extractBdPhoneFromComment,
  extractSizeVariant,
  parseLiveComment,
  buildLiveWhatsAppOrderMessage,
  DEFAULT_SAMPLE_RULES,
  convertBnDigitsToEn,
} from "./live-selling";

describe("live-selling engine", () => {
  it("converts Bengali digits to English digits reliably", () => {
    expect(convertBnDigitsToEn("১০১")).toBe("101");
    expect(convertBnDigitsToEn("০১৭xxxxxxxx")).toBe("017xxxxxxxx");
    expect(convertBnDigitsToEn("২ পিস")).toBe("2 পিস");
  });

  it("extracts quantities from varied Bengali and English comments", () => {
    expect(extractQuantityFromComment("101 ami 2 ta nibo")).toBe(2);
    expect(extractQuantityFromComment("102 ৩ পিস দিন")).toBe(3);
    expect(extractQuantityFromComment("ORDER-101 qty: 4 please")).toBe(4);
    expect(extractQuantityFromComment("101 single order")).toBe(1);
    expect(extractQuantityFromComment("103 5pcs")).toBe(5);
  });

  it("extracts Bangladeshi phone numbers from comment strings", () => {
    expect(extractBdPhoneFromComment("101 ami nibo 01712345678")).toBe("8801712345678");
    expect(extractBdPhoneFromComment("call me +8801812345678 fast")).toBe("8801812345678");
    expect(extractBdPhoneFromComment("102 ০১৯১২৩৪৫৬৭৮ ২টা")).toBe("8801912345678");
    expect(extractBdPhoneFromComment("no phone number here")).toBeNull();
  });

  it("extracts apparel size from comment", () => {
    expect(extractSizeVariant("101 size XL nibo")).toBe("XL");
    expect(extractSizeVariant("101 সাইজ 42")).toBe("42");
    expect(extractSizeVariant("polo shirt M size")).toBe("M");
    expect(extractSizeVariant("saree 102")).toBeNull();
  });

  it("parses live comments and generates instant checkout links", () => {
    const comment = "101 2 ta nibo 01711223344 size 42";
    const parsed = parseLiveComment(comment, DEFAULT_SAMPLE_RULES, "আমার ফ্যাশন");

    expect(parsed).not.toBeNull();
    if (!parsed) return;

    expect(parsed.keywordMatched).toBe("101");
    expect(parsed.quantity).toBe(2);
    expect(parsed.customerPhone).toBe("8801711223344");
    expect(parsed.extractedSize).toBe("42");
    expect(parsed.totalPriceMinor).toBe("290000"); // 1450 * 2 = 2900
    expect(parsed.checkoutUrl).toContain("rule=rule-101");
    expect(parsed.checkoutUrl).toContain("qty=2");
    expect(parsed.whatsappReplyMessage).toContain("আমার ফ্যাশন");
    expect(parsed.whatsappReplyMessage).toContain("৳2900");
  });

  it("handles Bengali digits for keywords and quantities", () => {
    const comment = "১০১ ২টা দিন";
    const parsed = parseLiveComment(comment, DEFAULT_SAMPLE_RULES);

    expect(parsed).not.toBeNull();
    if (!parsed) return;

    expect(parsed.keywordMatched).toBe("101");
    expect(parsed.quantity).toBe(2);
  });

  it("returns null when no registered keyword is found in comment", () => {
    const comment = "লাইভটা দারুণ হচ্ছে! অনেক সুন্দর কালেকশন";
    const parsed = parseLiveComment(comment, DEFAULT_SAMPLE_RULES);
    expect(parsed).toBeNull();
  });

  it("builds clear WhatsApp order message with store branding", () => {
    const msg = buildLiveWhatsAppOrderMessage({
      rule: DEFAULT_SAMPLE_RULES[0]!,
      quantity: 1,
      checkoutUrl: "https://shop.example.com/checkout?rule=101",
    }, "ফ্যাশন হাউজ");

    expect(msg).toContain("ফ্যাশন হাউজ");
    expect(msg).toContain("১৫ মিনিটের জন্য রিজার্ভ");
    expect(msg).toContain("https://shop.example.com/checkout");
  });
});
