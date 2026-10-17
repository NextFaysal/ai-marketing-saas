import { describe, expect, it } from "vitest";
import { cleanBlock, moveBlock, newEmailBlock } from "./email-blocks";

describe("MX7 email builder helpers", () => {
  it("moveBlock reorders and ignores out-of-range moves", () => {
    const blocks = [newEmailBlock("text"), newEmailBlock("divider"), newEmailBlock("button")];
    expect(moveBlock(blocks, 0, 2).map((b) => b.type)).toEqual(["divider", "button", "text"]);
    expect(moveBlock(blocks, 0, 5)).toBe(blocks);
    expect(moveBlock(blocks, 1, 1)).toBe(blocks);
  });
  it("newEmailBlock creates unfilled product/coupon slots (null ids — no sample data)", () => {
    expect(newEmailBlock("product")).toEqual({ type: "product", productId: null });
    expect(newEmailBlock("coupon")).toEqual({ type: "coupon", discountId: null, code: null, label: null });
  });
  it("cleanBlock strips empty optionals and keeps slot ids", () => {
    expect(cleanBlock({ type: "coupon", discountId: "d1", code: "", label: "" })).toEqual({ type: "coupon", discountId: "d1", code: null, label: null });
    expect(cleanBlock({ type: "image", url: "https://x/a.png", alt: "" })).toEqual({ type: "image", url: "https://x/a.png" });
  });
});
