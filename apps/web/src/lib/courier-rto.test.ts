import { describe, expect, it } from "vitest";
import {
  estimateDistrictDeliveryCharge,
  evaluateRtoRisk,
  buildAdvanceCodMessage,
  buildAdvanceWhatsAppLink,
} from "./courier-rto";

describe("courier-rto helpers", () => {
  describe("estimateDistrictDeliveryCharge", () => {
    it("returns 100 for Dhaka locations", () => {
      expect(estimateDistrictDeliveryCharge("Dhaka, Mirpur-10")).toBe(100);
      expect(estimateDistrictDeliveryCharge("ধানমন্ডি, ঢাকা")).toBe(100);
      expect(estimateDistrictDeliveryCharge("উত্তরা সেক্টর ৭")).toBe(100);
      expect(estimateDistrictDeliveryCharge("Gulshan-2")).toBe(100);
    });

    it("returns 150 for other regular districts", () => {
      expect(estimateDistrictDeliveryCharge("Chittagong, GEC Circle")).toBe(150);
      expect(estimateDistrictDeliveryCharge("সিলেট সদর")).toBe(150);
      expect(estimateDistrictDeliveryCharge("Rajshahi")).toBe(150);
    });

    it("returns 200 for remote upazilas or hill tracts", () => {
      expect(estimateDistrictDeliveryCharge("বান্দরবান সদর")).toBe(200);
      expect(estimateDistrictDeliveryCharge("রাঙ্গামাটি বাঘাইছড়ি উপজেলা")).toBe(200);
      expect(estimateDistrictDeliveryCharge("চর ফ্যাশন থানা")).toBe(200);
    });

    it("defaults to 150 when address is missing", () => {
      expect(estimateDistrictDeliveryCharge(null)).toBe(150);
      expect(estimateDistrictDeliveryCharge("")).toBe(150);
    });
  });

  describe("evaluateRtoRisk", () => {
    it("flags customers with high return count as high risk", () => {
      const evalResult = evaluateRtoRisk({
        history: { delivered: 2, returned: 3 },
        totalTaka: 2500,
        districtOrAddress: "Dhaka",
      });

      expect(evalResult.band).toBe("high");
      expect(evalResult.requiresAdvance).toBe(true);
      expect(evalResult.successRate).toBe(40);
      expect(evalResult.rtoRate).toBe(60);
      expect(evalResult.badgeText).toContain("উচ্চ RTO ঝুঁকি");
    });

    it("classifies customer with 10 delivered and 0 returned as low risk", () => {
      const evalResult = evaluateRtoRisk({
        history: { delivered: 10, returned: 0 },
        totalTaka: 1800,
        districtOrAddress: "Mirpur, Dhaka",
      });

      expect(evalResult.band).toBe("low");
      expect(evalResult.requiresAdvance).toBe(false);
      expect(evalResult.successRate).toBe(100);
      expect(evalResult.badgeText).toContain("নিরাপদ ক্রেতা");
    });

    it("requires advance for new customer placing high-value order", () => {
      const evalResult = evaluateRtoRisk({
        history: { delivered: 0, returned: 0 },
        totalTaka: 5000,
        districtOrAddress: "Sylhet",
      });

      expect(evalResult.band).toBe("medium");
      expect(evalResult.requiresAdvance).toBe(true);
      expect(evalResult.badgeText).toContain("সতর্কতা");
    });
  });

  describe("buildAdvanceCodMessage", () => {
    it("generates clear Bengali message with order number, amounts, and bKash details", () => {
      const msg = buildAdvanceCodMessage({
        customerName: "আব্দুল করিম",
        orderNumber: "ORD-9821",
        itemSummary: "কটন শার্ট ২ পিস",
        advanceAmount: 150,
        dueAmount: 1850,
        paymentMethod: "bkash",
        paymentNumber: "01712345678",
        isMerchantAccount: false,
      });

      expect(msg).toContain("আব্দুল করিম");
      expect(msg).toContain("#ORD-9821");
      expect(msg).toContain("কটন শার্ট ২ পিস");
      expect(msg).toContain("*৳150*");
      expect(msg).toContain("01712345678");
      expect(msg).toContain("পার্সোনাল");
      expect(msg).toContain("*৳1850*");
    });
  });

  describe("buildAdvanceWhatsAppLink", () => {
    it("creates valid wa.me link with phone formatting", () => {
      const link = buildAdvanceWhatsAppLink("01899112233", "হ্যালো!");
      expect(link).toContain("https://wa.me/8801899112233?text=");
      expect(link).toContain(encodeURIComponent("হ্যালো!"));
    });
  });
});
