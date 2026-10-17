import { describe, expect, it } from "vitest";
import {
  buildGrantPayload, buildTierPayload, creditDeltaLabel, creditReasonLabel,
  refundToCreditOffered, takaToMinorString,
} from "./membership";

// NF7 (FB3) — pure helpers for membership tiers + store credit.
describe("NF7 membership lib", () => {
  it("creditReasonLabel maps the four ledger reasons, falls back to raw", () => {
    expect(creditReasonLabel("grant_manual")).toBe("স্টাফ ক্রেডিট দিয়েছেন");
    expect(creditReasonLabel("refund_credit")).toBe("রিফান্ড → স্টোর ক্রেডিট");
    expect(creditReasonLabel("spend")).toBe("অর্ডারে খরচ");
    expect(creditReasonLabel("spend_reversal")).toBe("বাতিল অর্ডারের ক্রেডিট ফেরত");
    expect(creditReasonLabel("something_else")).toBe("something_else");
  });

  it("creditDeltaLabel signs credits + and spends −", () => {
    expect(creditDeltaLabel("5000")).toBe("+5000");
    expect(creditDeltaLabel("-5000")).toBe("-5000");
    expect(creditDeltaLabel("0")).toBe("0");
  });

  it("refundToCreditOffered is true only on an explicit enabled flag (default OFF)", () => {
    expect(refundToCreditOffered(null)).toBe(false);
    expect(refundToCreditOffered(undefined)).toBe(false);
    expect(refundToCreditOffered({})).toBe(false);
    expect(refundToCreditOffered({ refundToCreditEnabled: false })).toBe(false);
    expect(refundToCreditOffered({ refundToCreditEnabled: true })).toBe(true);
  });

  it("takaToMinorString converts taka to paisa and refuses junk/zero", () => {
    expect(takaToMinorString("250")).toBe("25000");
    expect(takaToMinorString("250.50")).toBe("25050");
    expect(takaToMinorString("250.5")).toBe("25050");
    expect(takaToMinorString("0")).toBeNull();
    expect(takaToMinorString("abc")).toBeNull();
    expect(takaToMinorString("")).toBeNull();
    expect(takaToMinorString("-5")).toBeNull();
  });

  it("buildTierPayload requires a name and a valid threshold", () => {
    expect(buildTierPayload({ name: " Gold ", minSpendTaka: "5000", sortOrder: "2" }))
      .toEqual({ name: "Gold", minSpendMinor: "500000", sortOrder: 2 });
    expect(buildTierPayload({ name: "", minSpendTaka: "5000", sortOrder: "0" })).toBeNull();
    expect(buildTierPayload({ name: "Gold", minSpendTaka: "x", sortOrder: "0" })).toBeNull();
  });

  it("buildGrantPayload refuses an empty note (the API requires a reason)", () => {
    expect(buildGrantPayload({ amountTaka: "100", note: " ক্ষতিপূরণ " }))
      .toEqual({ amountMinor: "10000", note: "ক্ষতিপূরণ" });
    expect(buildGrantPayload({ amountTaka: "100", note: "  " })).toBeNull();
    expect(buildGrantPayload({ amountTaka: "0", note: "কারণ" })).toBeNull();
  });
});
