import { describe, expect, it } from "vitest";
import {
  formatCleanPhone,
  buildWhatsAppRecoveryMessage,
  buildWhatsAppLink,
  isDhakaQuietHour,
  isChaseStopWord,
} from "./abandoned-chase";

describe("abandoned-chase helpers", () => {
  describe("formatCleanPhone", () => {
    it("handles Bangladeshi local format starting with 01", () => {
      expect(formatCleanPhone("01712345678")).toBe("8801712345678");
      expect(formatCleanPhone("01899887766")).toBe("8801899887766");
    });

    it("handles already international format +880 or 880", () => {
      expect(formatCleanPhone("+8801712345678")).toBe("8801712345678");
      expect(formatCleanPhone("8801912345678")).toBe("8801912345678");
    });

    it("strips dashes and whitespace", () => {
      expect(formatCleanPhone("01712-345 678")).toBe("8801712345678");
      expect(formatCleanPhone("+88 017 12 34 56 78")).toBe("8801712345678");
    });

    it("returns empty string for null or empty phone", () => {
      expect(formatCleanPhone(null)).toBe("");
      expect(formatCleanPhone("")).toBe("");
    });
  });

  describe("buildWhatsAppRecoveryMessage", () => {
    it("formats message with custom coupon and discount phrase", () => {
      const msg = buildWhatsAppRecoveryMessage({
        productName: "প্রিমিয়াম পাঞ্জাবি",
        couponCode: "VIP50",
        discountText: "৫০ টাকা ছাড়",
        checkoutUrl: "https://myshop.com/checkout/123",
      });

      expect(msg).toContain("প্রিমিয়াম পাঞ্জাবি");
      expect(msg).toContain("*VIP50*");
      expect(msg).toContain("(৫০ টাকা ছাড়)");
      expect(msg).toContain("https://myshop.com/checkout/123");
    });

    it("handles 100 Taka discount coupon", () => {
      const msg = buildWhatsAppRecoveryMessage({
        productName: "সিল্ক শাড়ি",
        couponCode: "COMEBACK100",
        discountText: "১০০ টাকা ছাড়",
        checkoutUrl: "https://myshop.com/shop",
      });

      expect(msg).toContain("সিল্ক শাড়ি");
      expect(msg).toContain("*COMEBACK100*");
      expect(msg).toContain("(১০০ টাকা ছাড়)");
    });

    it("defaults gracefully when missing parameters", () => {
      const msg = buildWhatsAppRecoveryMessage({});
      expect(msg).toContain("পণ্যসমূহ");
      expect(msg).toContain("*VIP50*");
      expect(msg).toContain("আমাদের শপে ভিজিট করুন");
    });
  });

  describe("buildWhatsAppLink", () => {
    it("generates wa.me link with encoded message and formatted phone", () => {
      const link = buildWhatsAppLink("01712345678", "আসসালামু আলাইকুম!");
      expect(link).toContain("https://wa.me/8801712345678?text=");
      expect(link).toContain(encodeURIComponent("আসসালামু আলাইকুম!"));
    });

    it("returns empty string if phone is empty", () => {
      expect(buildWhatsAppLink("", "test")).toBe("");
    });
  });

  describe("isDhakaQuietHour", () => {
    it("detects overnight quiet hours correctly in Dhaka", () => {
      // 23:30 Dhaka time is quiet
      const quietDate = new Date("2026-10-17T17:30:00Z"); // 17:30 UTC = 23:30 Dhaka (UTC+6)
      expect(isDhakaQuietHour(quietDate, 22, 8)).toBe(true);

      // 03:00 Dhaka time is quiet
      const quietMorning = new Date("2026-10-17T21:00:00Z"); // 21:00 UTC = 03:00 Dhaka
      expect(isDhakaQuietHour(quietMorning, 22, 8)).toBe(true);

      // 14:00 Dhaka time is NOT quiet
      const daytime = new Date("2026-10-17T08:00:00Z"); // 08:00 UTC = 14:00 Dhaka
      expect(isDhakaQuietHour(daytime, 22, 8)).toBe(false);
    });
  });

  describe("isChaseStopWord", () => {
    it("recognizes stop words in Bengali and English", () => {
      expect(isChaseStopWord("থামুন")).toBe(true);
      expect(isChaseStopWord("থামুন ভাই")).toBe(true);
      expect(isChaseStopWord("stop")).toBe(true);
      expect(isChaseStopWord("দরকার নেই")).toBe(true);
      expect(isChaseStopWord("লাস্ট কত")).toBe(true);
      expect(isChaseStopWord("আর মেসেজ পাঠাবেন না, চাই না")).toBe(true);
    });

    it("returns false for regular customer purchase queries", () => {
      expect(isChaseStopWord("ক্যাশ অন ডেলিভারি আছে?")).toBe(false);
      expect(isChaseStopWord("অর্ডার করতে চাই")).toBe(false);
      expect(isChaseStopWord("হ্যাঁ ভাই পাঠায় দেন")).toBe(false);
    });
  });
});
