import { describe, it, expect } from "vitest";
import {
  DEFAULT_BOT_CONFIG,
  normalizeBdPhoneNumber,
  generateWhatsAppClickToChatUrl,
  formatWhatsAppProductSnippet,
  parseCustomerOrderDetails,
  generateWhatsAppOrderSummaryReceipt,
} from "./whatsapp-catalog-bot";

describe("WhatsApp Conversational Catalog & Order Bot Engine", () => {
  it("normalizes Bangladeshi phone numbers accurately", () => {
    expect(normalizeBdPhoneNumber("01712345678")).toBe("8801712345678");
    expect(normalizeBdPhoneNumber("+8801811223344")).toBe("8801811223344");
    expect(normalizeBdPhoneNumber("8801912345678")).toBe("8801912345678");
    expect(normalizeBdPhoneNumber("01300-112233")).toBe("8801300112233");
  });

  it("generates wa.me click-to-chat links with URL-encoded messages", () => {
    const url1 = generateWhatsAppClickToChatUrl("01712345678");
    expect(url1).toBe("https://wa.me/8801712345678");

    const url2 = generateWhatsAppClickToChatUrl("01712345678", "আমি পণ্যটি নিতে চাই");
    expect(url2).toContain("https://wa.me/8801712345678?text=");
    expect(url2).toContain("%E0%A6%86%E0%A6%AE%E0%A6%BF");
  });

  it("formats product snippet with bold headings, taka price, and discount percentage", () => {
    const snippet = formatWhatsAppProductSnippet(
      {
        id: "p-1",
        name: "প্রিমিয়াম চামড়ার ওয়ালেট",
        priceMinor: 120000, // ৳1200
        compareAtMinor: 160000, // ৳1600 -> 25% off
        description: "জেনুইন লেদারের তৈরি দীর্ঘস্থায়ী ক্লাসিক ওয়ালেট",
      },
      "স্মার্ট লেদার বিডি",
      "leather-wallet-deal"
    );

    expect(snippet).toContain("*🛍️ প্রিমিয়াম চামড়ার ওয়ালেট*");
    expect(snippet).toContain("স্মার্ট লেদার বিডি");
    expect(snippet).toContain("৳1,200");
    expect(snippet).toContain("25% ছাড়!");
    expect(snippet).toContain("https://myshop.com/l/leather-wallet-deal");
  });

  it("parses customer order details from labelled message text", () => {
    const text = `নাম: তামিম ইকবাল
মোবাইল: 01711223344
ঠিকানা: বাড়ি ১২, রোড ৫, সেক্টর ৩, উত্তরা, ঢাকা`;

    const parsed = parseCustomerOrderDetails(text);
    expect(parsed.confidence).toBe("high");
    expect(parsed.customerName).toBe("তামিম ইকবাল");
    expect(parsed.phone).toBe("01711223344");
    expect(parsed.address).toContain("উত্তরা, ঢাকা");
  });

  it("parses customer details from unlabelled multi-line message", () => {
    const text = `রাকিবুল হাসান
01822334455
মিরপুর ১০, ব্লক সি, ঢাকা`;

    const parsed = parseCustomerOrderDetails(text);
    expect(parsed.customerName).toBe("রাকিবুল হাসান");
    expect(parsed.phone).toBe("01822334455");
    expect(parsed.address).toContain("মিরপুর ১০");
  });

  it("generates formatted WhatsApp order confirmation receipt", () => {
    const receipt = generateWhatsAppOrderSummaryReceipt({
      orderNumber: "ORD-9821",
      customerName: "আব্দুল করিম",
      phone: "01999887766",
      address: "ধানমন্ডি ২৭, ঢাকা",
      productName: "স্পোর্টস স্নিকার্স",
      quantity: 1,
      totalMinor: 210000,
      deliveryChargeMinor: 6000,
    });

    expect(receipt).toContain("🎉 *অর্ডার কনফার্মেশন স্লিপ");
    expect(receipt).toContain("#ORD-9821");
    expect(receipt).toContain("আব্দুল করিম");
    expect(receipt).toContain("01999887766");
    expect(receipt).toContain("স্পোর্টস স্নিকার্স");
    expect(receipt).toContain("৳2,100");
    expect(receipt).toContain("ক্যাশ অন ডেলিভারি");
  });
});
