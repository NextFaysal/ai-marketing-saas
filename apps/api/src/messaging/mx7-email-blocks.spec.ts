import { validateEmailBlocks, renderEmailBlocks, BRAND_FONT_KEYS } from "./email-blocks";
import { FESTIVAL_TEMPLATE_PACKS } from "./festival-templates";

/**
 * MX7 (pure) — block validation + rendering: slots with no real
 * catalog row render EMPTY (never a sample product/price/coupon),
 * real rows fill with their real values, brand kit wraps with
 * the org's own name/logo/colors/font, invalid blocks are
 * refused, and rendering is deterministic (byte-identical for
 * identical inputs — the property the old-format proof relies on
 * at the service layer).
 */
const product = { name: "পাঞ্জাবি", priceMinor: 125050n, currency: "BDT", url: "https://app.example.com/checkout/panjabi", imageUrl: null };
const discount = { code: "EID20", kind: "percent", value: 20 };

describe("MX7 validateEmailBlocks", () => {
  it("accepts all six block types and normalizes slots to null", () => {
    const out = validateEmailBlocks([
      { type: "text", text: "হ্যালো" }, { type: "image", url: "https://x.example/a.png" },
      { type: "button", label: "কিনুন", url: "https://x.example" }, { type: "product" },
      { type: "coupon" }, { type: "divider" },
    ]);
    expect(out).toHaveLength(6);
    expect(out[3]).toEqual({ type: "product", productId: null });
    expect(out[4]).toEqual({ type: "coupon", discountId: null, code: null, label: null });
  });
  it("refuses unknown types, empty text, non-http URLs and empty arrays", () => {
    expect(() => validateEmailBlocks([{ type: "video", url: "https://x" }])).toThrow(/unknown block type/);
    expect(() => validateEmailBlocks([{ type: "text", text: "  " }])).toThrow(/non-empty text/);
    expect(() => validateEmailBlocks([{ type: "button", label: "x", url: "javascript:alert(1)" }])).toThrow(/http\(s\) URL/);
    expect(() => validateEmailBlocks([{ type: "image", url: "data:image/png;base64,xx" }])).toThrow(/http\(s\) image URL/);
    expect(() => validateEmailBlocks([])).toThrow(/must not be empty/);
    expect(() => validateEmailBlocks("nope")).toThrow(/must be an array/);
  });
});

describe("MX7 renderEmailBlocks", () => {
  const blocks = validateEmailBlocks([
    { type: "text", text: "ঈদ মোবারক!" }, { type: "product", productId: "p1" },
    { type: "coupon", discountId: "d1" }, { type: "button", label: "এখনই কিনুন", url: "https://shop.example.com" }, { type: "divider" },
  ]);
  const ctx = {
    brand: { brandName: "Meghna Attire", logoUrl: "https://cdn.example.com/logo.png", primaryColor: "#0E7490", secondaryColor: "#B45309", font: "hind-siliguri" },
    products: new Map([["p1", product]]), discounts: new Map([["d1", discount]]),
  };

  it("fills product + coupon slots from the REAL rows handed in (real price, real code)", () => {
    const r = renderEmailBlocks(blocks, ctx);
    expect(r.emptySlots).toEqual([]);
    expect(r.htmlBody).toContain("পাঞ্জাবি");
    expect(r.htmlBody).toContain("৳1,250.50");
    expect(r.htmlBody).toContain("EID20");
    expect(r.htmlBody).toContain("20% ছাড়");
    expect(r.body).toContain("কুপন কোড: EID20");
  });

  it("applies the brand kit: logo, brand name, primary color on the button, font stack", () => {
    const r = renderEmailBlocks(blocks, ctx);
    expect(r.htmlBody).toContain("https://cdn.example.com/logo.png");
    expect(r.htmlBody).toContain("Meghna Attire");
    expect(r.htmlBody).toContain("background:#0E7490");
    expect(r.htmlBody).toContain("Hind Siliguri");
    expect(BRAND_FONT_KEYS).toContain("hind-siliguri");
  });

  it("an unfilled or missing slot renders EMPTY — no sample product, price or coupon is invented", () => {
    const slotBlocks = validateEmailBlocks([{ type: "product", productId: null }, { type: "product", productId: "gone" }, { type: "coupon", discountId: null }, { type: "coupon", discountId: "gone" }]);
    const r = renderEmailBlocks(slotBlocks, ctx);
    expect(r.emptySlots).toHaveLength(4);
    expect(r.htmlBody).not.toContain("৳");
    expect(r.htmlBody).not.toContain("কুপন কোড");
    expect(r.body).not.toContain("কুপন কোড");
  });

  it("escapes author HTML in text blocks (stored HTML is generated, never raw-authored here)", () => {
    const r = renderEmailBlocks(validateEmailBlocks([{ type: "text", text: "<script>alert(1)</script>" }]), ctx);
    expect(r.htmlBody).not.toContain("<script>");
    expect(r.htmlBody).toContain("&lt;script&gt;");
  });

  it("is deterministic: identical inputs render byte-identical output", () => {
    expect(renderEmailBlocks(blocks, ctx).htmlBody).toBe(renderEmailBlocks(blocks, ctx).htmlBody);
    expect(renderEmailBlocks(blocks, ctx).body).toBe(renderEmailBlocks(blocks, ctx).body);
  });

  it("a free-text coupon code (MS5 semantics) renders as authored text", () => {
    const r = renderEmailBlocks(validateEmailBlocks([{ type: "coupon", code: "BOISHAKH10", label: "নববর্ষ" }]), ctx);
    expect(r.body).toContain("কুপন কোড: BOISHAKH10 — নববর্ষ");
    expect(r.emptySlots).toEqual([]);
  });
});

describe("MX7 festival packs", () => {
  it("has exactly the four named packs, all blocks valid, slots unfilled, no baked-in price/code/url", () => {
    expect(FESTIVAL_TEMPLATE_PACKS.map((p) => p.key)).toEqual(["eid", "puja", "pohela_boishakh", "winter_sale"]);
    for (const pack of FESTIVAL_TEMPLATE_PACKS) {
      const blocks = validateEmailBlocks(pack.blocks);
      const serialized = JSON.stringify(blocks);
      expect(serialized).not.toMatch(/৳|\d+\s*%|code":\s*"/);
      for (const b of blocks) {
        if (b.type === "product") expect(b.productId).toBeNull();
        if (b.type === "coupon") { expect(b.discountId).toBeNull(); expect(b.code ?? null).toBeNull(); }
      }
      const r = renderEmailBlocks(blocks, { brand: null, products: new Map(), discounts: new Map() });
      expect(r.emptySlots.map((s) => s.type).sort()).toEqual(["coupon", "product"]);
      expect(r.htmlBody).not.toContain("কুপন কোড");
    }
  });
});
