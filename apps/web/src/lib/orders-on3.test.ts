import { describe, expect, it } from "vitest";
import {
  buildEditItemsBody, draftsFromOrderItems, surgeryAvailability, surgeryMoneySummary,
  validateDraft, type DraftLine, type PreviewResult,
} from "./orders-on3";

const line = (patch: Partial<DraftLine> = {}): DraftLine => ({
  name: "পাঞ্জাবি", quantity: 1, unitPriceMinor: "125000",
  isGift: false, kind: "line", ...patch,
});

describe("buildEditItemsBody — bundle collapse", () => {
  it("a bundle draft becomes ONE { bundleId, quantity } entry with no price/product fields", () => {
    const body = buildEditItemsBody([
      line({ kind: "bundle", bundleId: "b1", bundleName: "ঈদ কম্বো", name: "ঈদ কম্বো", quantity: 3, unitPriceMinor: "999999" }),
      line({ orderItemId: "i2", name: "টুপি" }),
    ]);
    expect(body.items).toHaveLength(2);
    expect(body.items[0]).toEqual({ bundleId: "b1", quantity: 3 });
    expect(body.items[1]).toEqual({ orderItemId: "i2", quantity: 1, unitPriceMinor: "125000" });
  });
  it("draftsFromOrderItems groups components under one bundle draft", () => {
    const drafts = draftsFromOrderItems([
      { id: "c1", name: "শার্ট", quantity: 2, priceMinor: "50000", totalMinor: "100000", bundleId: "b1", bundleName: "কম্বো" },
      { id: "c2", name: "প্যান্ট", quantity: 2, priceMinor: "70000", totalMinor: "140000", bundleId: "b1", bundleName: "কম্বো" },
      { id: "g1", name: "মগ", quantity: 1, priceMinor: "0", totalMinor: "0", isGift: true },
    ]);
    expect(drafts).toHaveLength(2);
    expect(drafts[0].kind).toBe("bundle");
    expect(drafts[0].quantity).toBe(2);
    expect(drafts[0].components).toHaveLength(2);
    expect(drafts[0].lineTotalMinor).toBe("240000");
    expect(drafts[1].isGift).toBe(true);
    // …and the whole order round-trips to 2 body entries.
    const body = buildEditItemsBody(drafts);
    expect(body.items).toEqual([
      { bundleId: "b1", quantity: 2 },
      { orderItemId: "g1", quantity: 1 },
    ]);
  });
});

describe("buildEditItemsBody — gift lock + new lines", () => {
  it("gift drafts keep their quantity and never carry a price", () => {
    const body = buildEditItemsBody([
      line({ orderItemId: "g1", name: "উপহার মগ", isGift: true, quantity: 2, unitPriceMinor: "0" }),
    ]);
    expect(body.items[0]).toEqual({ orderItemId: "g1", quantity: 2 });
    expect(body.items[0]).not.toHaveProperty("unitPriceMinor");
  });
  it("a draft without orderItemId is a new line (productId/variantId ride along)", () => {
    const body = buildEditItemsBody([
      line({ productId: "p9", variantId: "v3", name: "নতুন", quantity: 4, unitPriceMinor: "30000" }),
    ]);
    expect(body.items[0]).toEqual({ productId: "p9", variantId: "v3", quantity: 4, unitPriceMinor: "30000" });
  });
  it("coupon / recalculateDelivery options ride only when set", () => {
    expect(buildEditItemsBody([line()])).not.toHaveProperty("couponCode");
    const body = buildEditItemsBody([line()], { couponCode: null, recalculateDelivery: true });
    expect(body.couponCode).toBeNull();
    expect(body.recalculateDelivery).toBe(true);
  });
});

describe("buildEditItemsBody — omission semantics", () => {
  it("a removed draft line simply isn't in the body (that absence removes it server-side)", () => {
    const drafts = draftsFromOrderItems([
      { id: "i1", name: "A", quantity: 1, priceMinor: "100" },
      { id: "i2", name: "B", quantity: 1, priceMinor: "200" },
    ]);
    const kept = drafts.filter((d) => d.orderItemId !== "i2");
    const body = buildEditItemsBody(kept);
    expect(body.items.map((i) => i.orderItemId)).toEqual(["i1"]);
  });
});

describe("validateDraft", () => {
  it("accepts a valid draft list", () => {
    expect(validateDraft([line(), line({ isGift: true, unitPriceMinor: "0" })])).toEqual([]);
  });
  it("refuses an empty list and an all-gift list", () => {
    expect(validateDraft([])).toHaveLength(1);
    expect(validateDraft([line({ isGift: true })])[0]).toContain("কমপক্ষে একটি");
  });
  it("a bundle draft counts as a non-gift line", () => {
    expect(validateDraft([line({ kind: "bundle", bundleId: "b1" })])).toEqual([]);
  });
  it("quantities must be integers ≥ 1", () => {
    expect(validateDraft([line({ quantity: 0 })])[0]).toContain("পরিমাণ");
    expect(validateDraft([line({ quantity: 1.5 })])[0]).toContain("পরিমাণ");
    expect(validateDraft([line({ quantity: -2 })])[0]).toContain("পরিমাণ");
  });
  it("prices must parse as non-negative integers (minor strings)", () => {
    expect(validateDraft([line({ unitPriceMinor: "abc" })])[0]).toContain("দাম");
    expect(validateDraft([line({ unitPriceMinor: "-5" })])[0]).toContain("দাম");
    expect(validateDraft([line({ unitPriceMinor: "10.5" })])[0]).toContain("দাম");
    expect(validateDraft([line({ unitPriceMinor: "0" })])).toEqual([]);
  });
  it("gift prices are not validated (locked, never sent)", () => {
    expect(validateDraft([line(), line({ isGift: true, unitPriceMinor: "" })])).toEqual([]);
  });
});

describe("surgeryAvailability", () => {
  it("allows pending / on-hold / processing", () => {
    for (const status of ["pending", "on-hold", "processing"]) {
      expect(surgeryAvailability({ status, source: "native" }).allowed).toBe(true);
    }
  });
  it("hides terminal statuses and store sources (with a note)", () => {
    for (const status of ["completed", "cancelled", "refunded", "failed", "returned"]) {
      expect(surgeryAvailability({ status, source: "native" }).allowed).toBe(false);
    }
    const woo = surgeryAvailability({ status: "pending", source: "woocommerce" });
    expect(woo.allowed).toBe(false);
    expect(woo.note).toContain("স্টোরের অর্ডার");
    expect(surgeryAvailability({ status: "processing", source: "shopify" }).allowed).toBe(false);
  });
});

describe("surgeryMoneySummary", () => {
  const preview = (patch: Partial<PreviewResult> = {}): PreviewResult => ({
    lines: [], subtotalMinor: "250000", promotionDiscountMinor: "0", promotionsApplied: [],
    couponMinor: "0", couponDropped: false, couponPinnedMinor: "0",
    referralDiscountMinor: "0", referralDropped: false,
    discountMinor: "0", taxMinor: "0", shippingMinor: "6000", totalMinor: "256000",
    warnings: [], ...patch,
  });
  it("renders subtotal / delivery / total, tax only when non-zero", () => {
    const rows = surgeryMoneySummary(preview());
    expect(rows.map((r) => r.key)).toEqual(["subtotal", "shipping", "total"]);
    expect(rows[rows.length - 1].isTotal).toBe(true);
    expect(surgeryMoneySummary(preview({ taxMinor: "1000" })).map((r) => r.key)).toContain("tax");
  });
  it("promotion lines render individually as negative rows", () => {
    const rows = surgeryMoneySummary(preview({
      promotionsApplied: [{ name: "ঈদ অফার", amountMinor: "20000" }],
      promotionDiscountMinor: "20000", discountMinor: "20000",
    }));
    const promo = rows.find((r) => r.key.startsWith("promo"));
    expect(promo?.label).toBe("প্রমোশন: ঈদ অফার");
    expect(promo?.negative).toBe(true);
  });
  it("a dropped coupon is said out loud even at 0; a pinned coupon carries its note", () => {
    const dropped = surgeryMoneySummary(preview({ couponDropped: true }));
    expect(dropped.find((r) => r.key === "coupon")?.note).toBe("কুপন বাতিল হয়েছে");
    const pinned = surgeryMoneySummary(preview({ couponMinor: "5000", couponPinnedMinor: "5000" }));
    expect(pinned.find((r) => r.key === "coupon")?.note).toBe("কুপন যাচাই ছাড়া রাখা হয়েছে");
  });
  it("referral dropped note + fallback plain-discount row", () => {
    const ref = surgeryMoneySummary(preview({ referralDropped: true }));
    expect(ref.find((r) => r.key === "referral")?.note).toBe("রেফারেল ছাড় বাতিল হয়েছে");
    const plain = surgeryMoneySummary(preview({ discountMinor: "7000" }));
    expect(plain.find((r) => r.key === "discount")?.amountMinor).toBe("7000");
  });
});
