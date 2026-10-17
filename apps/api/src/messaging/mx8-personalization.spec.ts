import {
  parsePersonalizationConfig, readPersonalizationConfig, buildUniqueCouponCode,
  pickRecommendations, renderRecommendationBlock, applyDynamicBlocks,
} from "./personalization";

/**
 * MX8 (pure) — personalization config validation, the
 * deterministic recommendation rule, recommendation rendering
 * and segment-block application. No DB, no IO: the service
 * hands real rows in, these functions decide + format.
 */
describe("MX8 parsePersonalizationConfig", () => {
  it("accepts a full valid config and normalizes defaults", () => {
    const cfg = parsePersonalizationConfig({
      uniqueCoupon: { kind: "percent", value: 10 },
      recommendations: { enabled: true },
      segmentBlocks: [{ definition: { entity: "customers", match: "all", conditions: [{ field: "orders_count", op: "gte", value: 1 }] }, body: "VIP" }],
    });
    expect(cfg?.uniqueCoupon).toMatchObject({ kind: "percent", value: 10, expiryDays: 30, prefix: "MX" });
    expect(cfg?.recommendations).toMatchObject({ enabled: true, limit: 3 });
    expect(cfg?.segmentBlocks).toHaveLength(1);
  });

  it("refuses bad coupon shapes (kind, percent range, fixed value, expiry, prefix)", () => {
    expect(() => parsePersonalizationConfig({ uniqueCoupon: { kind: "bogus", value: 10 } })).toThrow(/kind/);
    expect(() => parsePersonalizationConfig({ uniqueCoupon: { kind: "percent", value: 0 } })).toThrow(/1\.\.90/);
    expect(() => parsePersonalizationConfig({ uniqueCoupon: { kind: "percent", value: 91 } })).toThrow(/1\.\.90/);
    expect(() => parsePersonalizationConfig({ uniqueCoupon: { kind: "fixed", value: 0 } })).toThrow(/positive integer/);
    expect(() => parsePersonalizationConfig({ uniqueCoupon: { kind: "percent", value: 10, expiryDays: 0 } })).toThrow(/expiryDays/);
    expect(() => parsePersonalizationConfig({ uniqueCoupon: { kind: "percent", value: 10, prefix: "!!!" } })).toThrow(/prefix/);
    // free_shipping needs no value (the StoreDiscount semantics).
    expect(parsePersonalizationConfig({ uniqueCoupon: { kind: "free_shipping" } })?.uniqueCoupon?.value).toBe(0);
  });

  it("refuses an empty config and malformed segment blocks", () => {
    expect(() => parsePersonalizationConfig({})).toThrow(/configures nothing/);
    expect(() => parsePersonalizationConfig({ segmentBlocks: [{ body: "x" }] })).toThrow(/exactly one of/);
    expect(() => parsePersonalizationConfig({
      segmentBlocks: [{ savedAudienceId: "a1", definition: { entity: "customers", conditions: [] }, body: "x" }],
    })).toThrow(/exactly one of/);
    expect(() => parsePersonalizationConfig({
      segmentBlocks: [{ definition: { entity: "customers", conditions: [{ field: "nope", op: "eq", value: 1 }] }, body: "x" }],
    })).toThrow(/definition/);
    expect(() => parsePersonalizationConfig({
      segmentBlocks: Array.from({ length: 11 }, () => ({ savedAudienceId: "a", body: "x" })),
    })).toThrow(/at most 10/);
  });

  it("readPersonalizationConfig returns null for a corrupt stored value (pre-MX8 behaviour)", () => {
    expect(readPersonalizationConfig(null)).toBeNull();
    expect(readPersonalizationConfig({ uniqueCoupon: { kind: "bogus" } })).toBeNull();
    expect(readPersonalizationConfig({ uniqueCoupon: { kind: "percent", value: 5 } })).not.toBeNull();
  });

  it("buildUniqueCouponCode formats prefix + suffix deterministically", () => {
    expect(buildUniqueCouponCode("EID", "abcdef0123ffff")).toBe("EID-ABCDEF0123");
  });
});

describe("MX8 pickRecommendations — deterministic rule from real data", () => {
  const catalog = [
    { id: "p4", name: "Runner Pro", priceMinor: 120000, currency: "BDT", category: "shoes" },
    { id: "p1", name: "Runner", priceMinor: 100000, currency: "BDT", category: "shoes" },
    { id: "p3", name: "Polo", priceMinor: 60000, currency: "BDT", category: "shirts" },
    { id: "p2", name: "Tee", priceMinor: 50000, currency: "BDT", category: "shirts" },
  ];

  it("most recent purchased category wins; already-purchased products are excluded", () => {
    const r = pickRecommendations({
      purchased: [{ productId: "p1", category: "shoes" }, { productId: "p2", category: "shirts" }],
      browsedCategories: ["shirts"],
      catalog, limit: 3,
    });
    expect(r.signal).toBe("purchase_category");
    expect(r.category).toBe("shoes");
    expect(r.products.map((p) => p.id)).toEqual(["p4"]);
  });

  it("falls back to the browsed category when there is no purchase signal", () => {
    const r = pickRecommendations({ purchased: [], browsedCategories: [null, "shirts"], catalog, limit: 3 });
    expect(r.signal).toBe("browsing_category");
    expect(r.products.map((p) => p.id)).toEqual(["p3", "p2"]);
  });

  it("a signal category with no eligible product falls through, then honestly to none", () => {
    // Purchased the only shoes product → purchase signal yields
    // nothing → browsing (shirts) is used.
    const r = pickRecommendations({
      purchased: [{ productId: "p1", category: "shoes" }, { productId: "p4", category: "shoes" }],
      browsedCategories: ["shirts"], catalog, limit: 3,
    });
    expect(r.signal).toBe("browsing_category");
    // No signals at all → none, and NEVER a substitute category.
    const none = pickRecommendations({ purchased: [], browsedCategories: [], catalog, limit: 3 });
    expect(none).toMatchObject({ signal: "none", products: [] });
    const noEligible = pickRecommendations({
      purchased: [{ productId: "p1", category: "shoes" }, { productId: "p4", category: "shoes" }],
      browsedCategories: ["shoes"], catalog, limit: 3,
    });
    expect(noEligible.signal).toBe("none");
  });

  it("respects the limit", () => {
    const r = pickRecommendations({ purchased: [], browsedCategories: ["shirts"], catalog, limit: 1 });
    expect(r.products).toHaveLength(1);
  });
});

describe("MX8 renderRecommendationBlock + applyDynamicBlocks", () => {
  it("renders real products with real prices; empty renders ONLY the org fallback", () => {
    const withProducts = renderRecommendationBlock(
      { products: [{ id: "p4", name: "Runner <Pro>", priceMinor: 120000, currency: "BDT", url: "https://x.test/checkout/p4", category: "shoes" }], signal: "purchase_category", category: "shoes" },
      { enabled: true, limit: 3, heading: "আপনার জন্য", fallbackText: null },
    );
    expect(withProducts.text).toContain("Runner <Pro> — ৳1,200.00");
    expect(withProducts.html).toContain("Runner &lt;Pro&gt;");
    expect(withProducts.html).not.toContain("Runner <Pro>");
    const empty = renderRecommendationBlock(
      { products: [], signal: "none", category: null },
      { enabled: true, limit: 3, fallbackText: "সাধারণ কালেকশন দেখুন" },
    );
    expect(empty.text).toBe("সাধারণ কালেকশন দেখুন");
    const emptyNoFallback = renderRecommendationBlock(
      { products: [], signal: "none", category: null },
      { enabled: true, limit: 3, fallbackText: null },
    );
    expect(emptyNoFallback).toEqual({ text: "", html: "" });
  });

  it("a non-member's content is byte-identical; a member gains the block (text escaped into the HTML part)", () => {
    const base = { body: "Hello", htmlBody: "<p>Hello</p>" };
    const nonMember = applyDynamicBlocks({ ...base, memberBlocks: [] });
    expect(nonMember.body).toBe("Hello");
    expect(nonMember.htmlBody).toBe("<p>Hello</p>");
    const member = applyDynamicBlocks({
      ...base,
      memberBlocks: [{ body: "VIP <b>offer</b>", htmlBody: null }],
    });
    expect(member.body).toBe("Hello\n\nVIP <b>offer</b>");
    expect(member.htmlBody).toContain("VIP &lt;b&gt;offer&lt;/b&gt;");
    expect(member.htmlBody).not.toContain("<b>offer</b>");
    // An authored htmlBody on the block is used as authored.
    const memberHtml = applyDynamicBlocks({
      ...base,
      memberBlocks: [{ body: "VIP", htmlBody: "<p><strong>VIP</strong></p>" }],
    });
    expect(memberHtml.htmlBody).toContain("<strong>VIP</strong>");
  });
});
