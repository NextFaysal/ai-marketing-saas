import { describe, expect, it } from "vitest";
import {
  EXPENSE_CATEGORIES,
  EXPENSE_PAYMENT_METHODS,
  REPORT_TYPES,
  SCHEDULED_REPORT_TYPES,
  cadenceLabel,
  currentMonth,
  defaultRange,
  discountKindLabel,
  expenseCategoryLabel,
  expensePaymentMethodLabel,
  formatMonthLabel,
  isReportType,
  isValidMonth,
  minorToTakaInput,
  partialFullLabel,
  paymentMethodLabel,
  refundResolutionLabel,
  reportTypeLabel,
  scheduledRunStatusLabel,
  shiftMonth,
  takaToMinor,
} from "./finance-gb8";

describe("GB8 report types", () => {
  it("the 5 new report types each have a Bengali label + description", () => {
    expect(REPORT_TYPES.map((r) => r.type)).toEqual([
      "discounts", "refunds", "payment_sales", "category_sales", "shipping_cost",
    ]);
    for (const r of REPORT_TYPES) {
      expect(r.label.length).toBeGreaterThan(0);
      expect(r.description.length).toBeGreaterThan(0);
      expect(reportTypeLabel(r.type)).toBe(r.label);
      expect(isReportType(r.type)).toBe(true);
    }
    expect(isReportType("profit")).toBe(false);
    expect(isReportType("nope")).toBe(false);
  });

  it("scheduled report types are the 5 + profit + messaging_summary (MX16)", () => {
    expect(SCHEDULED_REPORT_TYPES.map((r) => r.type)).toEqual([
      "discounts", "refunds", "payment_sales", "category_sales", "shipping_cost", "profit", "messaging_summary",
    ]);
    for (const r of SCHEDULED_REPORT_TYPES) expect(r.label.length).toBeGreaterThan(0);
    expect(reportTypeLabel("profit")).toBe("লাভের রিপোর্ট");
    expect(reportTypeLabel("messaging_summary")).toBe("মেসেজিং সারসংক্ষেপ");
    // MX16: the messaging summary is schedulable but is NOT a
    // commerce report type.
    expect(isReportType("messaging_summary")).toBe(false);
  });
});

describe("GB8 expense vocabularies", () => {
  it("every category has a Bengali label", () => {
    expect(EXPENSE_CATEGORIES.map((c) => c.value)).toEqual([
      "rent", "salary", "marketing", "packaging", "delivery", "utilities", "inventory_purchase", "other",
    ]);
    expect(expenseCategoryLabel("rent")).toBe("ভাড়া");
    expect(expenseCategoryLabel("salary")).toBe("বেতন");
    expect(expenseCategoryLabel("marketing")).toBe("মার্কেটিং");
    expect(expenseCategoryLabel("packaging")).toBe("প্যাকেজিং");
    expect(expenseCategoryLabel("delivery")).toBe("ডেলিভারি");
    expect(expenseCategoryLabel("utilities")).toBe("ইউটিলিটি");
    expect(expenseCategoryLabel("inventory_purchase")).toBe("ইনভেন্টরি ক্রয়");
    expect(expenseCategoryLabel("other")).toBe("অন্যান্য");
  });

  it("every payment method has a Bengali label", () => {
    expect(EXPENSE_PAYMENT_METHODS.map((c) => c.value)).toEqual(["cash", "bank", "bkash", "other"]);
    expect(expensePaymentMethodLabel("cash")).toBe("নগদ");
    expect(expensePaymentMethodLabel("bank")).toBe("ব্যাংক");
    expect(expensePaymentMethodLabel("bkash")).toBe("বিকাশ");
    expect(expensePaymentMethodLabel("other")).toBe("অন্যান্য");
  });
});

describe("GB8 other labels", () => {
  it("discount kinds, refund resolutions, run statuses, cadences", () => {
    expect(discountKindLabel("coupon")).toBe("কুপন");
    expect(discountKindLabel("promotion")).toBe("প্রমোশন");
    expect(discountKindLabel("referral")).toBe("রেফারেল");
    expect(refundResolutionLabel("refund")).toBe("টাকা ফেরত");
    expect(refundResolutionLabel("exchange")).toBe("এক্সচেঞ্জ");
    expect(refundResolutionLabel("store_credit_note")).toBe("স্টোর ক্রেডিট নোট");
    expect(scheduledRunStatusLabel("sent")).toBe("পাঠানো হয়েছে");
    expect(scheduledRunStatusLabel("failed_no_provider")).toBe("ইমেইল সার্ভিস সেটআপ নেই");
    expect(scheduledRunStatusLabel("failed_error")).toBe("ব্যর্থ হয়েছে");
    expect(cadenceLabel("daily")).toBe("প্রতিদিন");
    expect(cadenceLabel("weekly")).toBe("প্রতি সপ্তাহে");
    expect(partialFullLabel("full")).toBe("পূর্ণ");
    expect(partialFullLabel("partial")).toBe("আংশিক");
    expect(partialFullLabel("unknown")).toBe("পরিমাণ অজানা");
    expect(paymentMethodLabel("unknown")).toBe("অন্যান্য/অজানা");
    expect(paymentMethodLabel("")).toBe("অন্যান্য/অজানা");
    expect(paymentMethodLabel(null)).toBe("অন্যান্য/অজানা");
    expect(paymentMethodLabel("cod")).toBe("cod");
  });
});

describe("GB8 date helpers", () => {
  it("defaultRange returns a 30-day inclusive YYYY-MM-DD range ending today (Dhaka)", () => {
    const r = defaultRange(new Date("2026-10-15T10:00:00Z"));
    expect(r.to).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(r.from).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    // 2026-10-15 10:00 UTC = 16:00 Dhaka, same calendar day.
    expect(r.to).toBe("2026-10-15");
    expect(r.from).toBe("2026-09-16");
    const days = (Date.parse(r.to) - Date.parse(r.from)) / 86400000;
    expect(days).toBe(29);
  });

  it("defaultRange uses the Dhaka calendar day near midnight UTC", () => {
    // 2026-10-15 20:00 UTC = 2026-10-16 02:00 Dhaka.
    const r = defaultRange(new Date("2026-10-15T20:00:00Z"));
    expect(r.to).toBe("2026-10-16");
    expect(r.from).toBe("2026-09-17");
  });
});

describe("GB8 month helpers", () => {
  it("formatMonthLabel renders Bengali month + Bengali-digit year", () => {
    expect(formatMonthLabel("2026-10")).toBe("অক্টোবর ২০২৬");
    expect(formatMonthLabel("2026-01")).toBe("জানুয়ারি ২০২৬");
    expect(formatMonthLabel("bad")).toBe("bad");
  });

  it("currentMonth / shiftMonth / isValidMonth", () => {
    expect(currentMonth(new Date("2026-10-15T10:00:00Z"))).toBe("2026-10");
    expect(shiftMonth("2026-10", 1)).toBe("2026-11");
    expect(shiftMonth("2026-01", -1)).toBe("2025-12");
    expect(shiftMonth("2026-12", 1)).toBe("2027-01");
    expect(isValidMonth("2026-10")).toBe(true);
    expect(isValidMonth("2026-13")).toBe(false);
    expect(isValidMonth("2026-1")).toBe(false);
  });
});

describe("GB8 taka ↔ minor conversion (string math, no float)", () => {
  it("takaToMinor converts decimal taka to paisa strings", () => {
    expect(takaToMinor("123.45")).toBe("12345");
    expect(takaToMinor("100")).toBe("10000");
    expect(takaToMinor("0.5")).toBe("50");
    expect(takaToMinor("0.05")).toBe("5");
    expect(takaToMinor("0")).toBe("0");
    expect(takaToMinor(" 250.5 ")).toBe("25050");
  });

  it("takaToMinor rejects invalid / negative / over-precise input", () => {
    expect(takaToMinor("")).toBeNull();
    expect(takaToMinor("abc")).toBeNull();
    expect(takaToMinor("-10")).toBeNull();
    expect(takaToMinor("1.234")).toBeNull();
    expect(takaToMinor(null)).toBeNull();
  });

  it("minorToTakaInput round-trips for the edit form", () => {
    expect(minorToTakaInput("12345")).toBe("123.45");
    expect(minorToTakaInput("10000")).toBe("100.00");
    expect(minorToTakaInput("5")).toBe("0.05");
    expect(minorToTakaInput(takaToMinor("999.99"))).toBe("999.99");
    expect(minorToTakaInput(null)).toBe("");
  });
});
