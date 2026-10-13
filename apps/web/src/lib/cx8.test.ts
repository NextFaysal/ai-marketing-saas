import { describe, expect, it } from "vitest";
import {
  PRODUCT_MATCH_HONESTY,
  canAutoOpen,
  extractedSummary,
  productMatchDraftText,
  type LabelScanResultView,
} from "./cx8";

const base: LabelScanResultView = {
  available: true,
  extracted: {},
  matched: null,
  candidates: [],
};

describe("cx8 web helpers", () => {
  it("honesty wording ships verbatim", () => {
    expect(PRODUCT_MATCH_HONESTY).toBe(
      "এটি ছবির সাথে ছবির মিল নয় — AI ছবিটি বর্ণনা করে, সেই বর্ণনা দিয়ে catalog খোঁজা হয়",
    );
  });

  it("extractedSummary lists only the values actually extracted", () => {
    expect(extractedSummary({ ...base, extracted: { trackingCode: "TRK-1", phoneLast4: "2222" } }))
      .toBe("Tracking: TRK-1 · ফোনের শেষ ৪ ডিজিট: 2222");
    expect(extractedSummary(base)).toBe("");
    expect(extractedSummary({ ...base, extracted: { orderNumber: "1042" } })).toBe("অর্ডার নম্বর: 1042");
  });

  it("canAutoOpen: only a lone exact match opens directly; candidates never auto-open", () => {
    const match = { orderId: "o1", orderNumber: "1042", orderStatus: "processing", shipmentId: "s1", trackingCode: "TRK-1", provider: "steadfast", shipmentStatus: "in_transit" };
    expect(canAutoOpen({ ...base, matched: match })).toBe(true);
    expect(canAutoOpen({ ...base, candidates: [{ ...match, phoneLast4: "2222" }] })).toBe(false);
    expect(canAutoOpen(base)).toBe(false);
  });

  it("productMatchDraftText is a draft built from the real row (name + formatted price)", () => {
    const text = productMatchDraftText({
      productId: "p1", name: "Red Cotton Panjabi", priceMinor: "150000",
      priceText: "BDT 1500.00", currency: "BDT", imageUrl: null, score: 9, reasons: [],
    });
    expect(text).toBe('"Red Cotton Panjabi" — দাম BDT 1500.00।');
  });
});
