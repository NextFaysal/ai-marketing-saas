import { describe, expect, it } from "vitest";
import {
  DROPSHIP_PAYOUT_NOTE, PARTNER_STOCK_LABEL, agreementStatusLabel,
  partnerStockLabel, poStatusLabel, priceBelowFloor,
} from "./dropship-nf12";

// NF12 (FB4) — web helper pins. The payout note must stay
// byte-identical to the API's DROPSHIP_PAYOUT_NOTE
// (apps/api/src/dropship/dropship.service.ts): records only,
// no payout execution, OU11 legal gate.
describe("dropship-nf12 helpers", () => {
  it("payout note is the records-only OU11 statement", () => {
    expect(DROPSHIP_PAYOUT_NOTE).toContain("OU11");
    expect(DROPSHIP_PAYOUT_NOTE).toContain("কোনো পেআউট সম্পন্ন হয় না");
    expect(DROPSHIP_PAYOUT_NOTE).toContain("Records only");
  });

  it("partner stock is always labelled and never fabricates a count", () => {
    expect(PARTNER_STOCK_LABEL).toBe("পার্টনার স্টক");
    expect(partnerStockLabel(12)).toBe("পার্টনার স্টক: 12টি");
    expect(partnerStockLabel(0)).toBe("পার্টনার স্টক: 0টি");
    expect(partnerStockLabel(null)).toContain("ট্র্যাক হয়নি");
  });

  it("price-below-floor mirrors the server rule", () => {
    expect(priceBelowFloor("49999", "50000")).toBe(true);
    expect(priceBelowFloor("50000", "50000")).toBe(false);
    expect(priceBelowFloor("80000", "50000")).toBe(false);
    expect(priceBelowFloor("abc", "50000")).toBe(true);
  });

  it("status labels cover the agreement + PO vocabularies", () => {
    expect(agreementStatusLabel("accepted")).toContain("Accepted");
    expect(agreementStatusLabel("pending")).toContain("Pending");
    expect(agreementStatusLabel("revoked")).toContain("Revoked");
    expect(poStatusLabel("ordered")).toContain("Ordered");
    expect(poStatusLabel("received")).toContain("পৌঁছেছে");
  });
});
