import {
  evaluatePromotions,
  validatePromotionConfig,
  phoneKeyLoose,
  type PromotionLine,
} from "./promotions";

const NOW = new Date("2026-10-13T10:00:00Z");

function line(partial: Partial<PromotionLine> & { unitPriceMinor: bigint }): PromotionLine {
  return {
    productId: "p-1",
    categoryId: null,
    quantity: 1,
    compareAtMinor: null,
    ...partial,
  };
}

function promo(partial: any): any {
  return {
    id: "promo-1",
    name: "Promo",
    active: true,
    priority: 0,
    startsAt: null,
    endsAt: null,
    createdAt: new Date("2026-10-01T00:00:00Z"),
    ...partial,
  };
}

describe("EC16 evaluator — BOGO", () => {
  const bogo = promo({
    type: "bogo",
    config: { buyProductId: "p-1", buyQty: 2, getProductId: "p-1", getQty: 1, getDiscountPercent: 100 },
  });

  it("buy 2 get 1 free on the same product", () => {
    const ev = evaluatePromotions([bogo], [line({ quantity: 3, unitPriceMinor: 10000n })], NOW);
    expect(ev.promotionDiscountMinor).toBe(10000n);
    expect(ev.lineTotalsMinor).toEqual([20000n]);
    expect(ev.breakdown).toHaveLength(1);
    expect(ev.breakdown[0].amountMinor).toBe(10000n);
  });

  it("buy threshold unmet ⇒ nothing", () => {
    const ev = evaluatePromotions([bogo], [line({ quantity: 1, unitPriceMinor: 10000n })], NOW);
    expect(ev.promotionDiscountMinor).toBe(0n);
    expect(ev.breakdown).toHaveLength(0);
  });

  it("get items are the CHEAPEST matching units; get not in cart ⇒ no auto-add, no discount", () => {
    const p = promo({
      type: "bogo",
      config: { buyProductId: "p-buy", buyQty: 1, getCategoryId: "cat-gift", getQty: 1, getDiscountPercent: 100 },
    });
    const ev = evaluatePromotions(
      [p],
      [
        line({ productId: "p-buy", quantity: 1, unitPriceMinor: 5000n }),
        line({ productId: "p-g1", categoryId: "cat-gift", quantity: 1, unitPriceMinor: 3000n }),
        line({ productId: "p-g2", categoryId: "cat-gift", quantity: 1, unitPriceMinor: 2000n }),
      ],
      NOW,
    );
    expect(ev.promotionDiscountMinor).toBe(2000n); // cheapest gift unit
    expect(ev.lineTotalsMinor).toEqual([5000n, 3000n, 0n]);

    const absent = evaluatePromotions(
      [p],
      [line({ productId: "p-buy", quantity: 1, unitPriceMinor: 5000n })],
      NOW,
    );
    expect(absent.promotionDiscountMinor).toBe(0n);
  });

  it("partial get discount (50%): overlapping scopes form complete groups only", () => {
    const p = promo({
      type: "bogo",
      config: { buyCategoryId: "c", buyQty: 1, getCategoryId: "c", getQty: 2, getDiscountPercent: 50 },
    });
    const ev = evaluatePromotions(
      [p],
      [line({ productId: "p-9", categoryId: "c", quantity: 3, unitPriceMinor: 4000n })],
      NOW,
    );
    // One complete group (1 buy + 2 get) fits in 3 units; a unit
    // never counts as both. Discount = 2 units × 4000 × 50% = 4000.
    expect(ev.promotionDiscountMinor).toBe(4000n);
    expect(ev.lineTotalsMinor).toEqual([8000n]);
  });

  it("buy 2 get 1 with only 2 units in the cart forms NO group (no double-counting)", () => {
    const ev = evaluatePromotions(
      [bogo],
      [line({ quantity: 2, unitPriceMinor: 10000n })],
      NOW,
    );
    expect(ev.promotionDiscountMinor).toBe(0n);
  });
});

describe("EC16 evaluator — tiered", () => {
  const tiered = promo({
    type: "tiered",
    config: {
      scope: "subtotal",
      tiers: [
        { minAmountMinor: "100000", percentOff: 5 },
        { minAmountMinor: "200000", percentOff: 10 },
      ],
    },
  });

  it("highest qualifying tier applies", () => {
    const ev = evaluatePromotions([tiered], [line({ quantity: 1, unitPriceMinor: 250000n })], NOW);
    expect(ev.promotionDiscountMinor).toBe(25000n);
    const lower = evaluatePromotions([tiered], [line({ quantity: 1, unitPriceMinor: 150000n })], NOW);
    expect(lower.promotionDiscountMinor).toBe(7500n);
    const none = evaluatePromotions([tiered], [line({ quantity: 1, unitPriceMinor: 90000n })], NOW);
    expect(none.promotionDiscountMinor).toBe(0n);
  });

  it("category scope with minQty tier judges and discounts only that category", () => {
    const p = promo({
      type: "tiered",
      config: { scope: "category", categoryId: "cat-1", tiers: [{ minQty: 3, percentOff: 15 }] },
    });
    const ev = evaluatePromotions(
      [p],
      [
        line({ productId: "p-a", categoryId: "cat-1", quantity: 3, unitPriceMinor: 1000n }),
        line({ productId: "p-b", categoryId: "cat-2", quantity: 1, unitPriceMinor: 5000n }),
      ],
      NOW,
    );
    expect(ev.promotionDiscountMinor).toBe(450n);
    expect(ev.lineTotalsMinor).toEqual([2550n, 5000n]);
  });
});

describe("EC16 evaluator — flash", () => {
  const flash = promo({
    type: "flash",
    startsAt: new Date("2026-10-13T00:00:00Z"),
    endsAt: new Date("2026-10-14T00:00:00Z"),
    config: { percentOff: 20 },
  });

  it("applies inside the window, not before start or after end", () => {
    const inside = evaluatePromotions([flash], [line({ unitPriceMinor: 10000n })], NOW);
    expect(inside.promotionDiscountMinor).toBe(2000n);
    const before = evaluatePromotions([flash], [line({ unitPriceMinor: 10000n })], new Date("2026-10-12T00:00:00Z"));
    expect(before.promotionDiscountMinor).toBe(0n);
    const after = evaluatePromotions([flash], [line({ unitPriceMinor: 10000n })], new Date("2026-10-15T00:00:00Z"));
    expect(after.promotionDiscountMinor).toBe(0n);
  });

  it("never stacks on a product-level sale line (compareAt > price), but hits regular lines", () => {
    const ev = evaluatePromotions(
      [flash],
      [
        line({ productId: "p-sale", unitPriceMinor: 15000n, compareAtMinor: 20000n }),
        line({ productId: "p-reg", unitPriceMinor: 10000n }),
      ],
      NOW,
    );
    expect(ev.promotionDiscountMinor).toBe(2000n);
    expect(ev.lineTotalsMinor).toEqual([15000n, 8000n]);
  });

  it("productIds scope limits the flash", () => {
    const p = promo({
      type: "flash",
      startsAt: flash.startsAt,
      endsAt: flash.endsAt,
      config: { percentOff: 50, productIds: ["p-yes"] },
    });
    const ev = evaluatePromotions(
      [p],
      [line({ productId: "p-yes", unitPriceMinor: 10000n }), line({ productId: "p-no", unitPriceMinor: 10000n })],
      NOW,
    );
    expect(ev.promotionDiscountMinor).toBe(5000n);
  });
});

describe("EC16 evaluator — stacking, consumption, priority", () => {
  it("BOGO get units are consumed: a later flash cannot re-discount them", () => {
    const bogoFirst = promo({
      id: "bogo-1",
      type: "bogo",
      priority: 10,
      config: { buyProductId: "p-1", buyQty: 1, getProductId: "p-1", getQty: 1, getDiscountPercent: 100 },
    });
    const flashSecond = promo({
      id: "flash-1",
      type: "flash",
      priority: 5,
      startsAt: new Date("2026-10-13T00:00:00Z"),
      endsAt: new Date("2026-10-14T00:00:00Z"),
      config: { percentOff: 50 },
    });
    const cart = [line({ quantity: 2, unitPriceMinor: 10000n })];
    const ev = evaluatePromotions([flashSecond, bogoFirst], cart, NOW);
    // BOGO first: 1 unit free (10000). Flash then sees ONE remaining
    // unit: 50% of 10000 = 5000. Total 15000.
    expect(ev.promotionDiscountMinor).toBe(15000n);
    expect(ev.breakdown.map((b) => b.promotionId)).toEqual(["bogo-1", "flash-1"]);
  });

  it("priority flips the outcome: flash first consumes every unit, BOGO then finds none", () => {
    const bogoLow = promo({
      id: "bogo-1",
      type: "bogo",
      priority: 1,
      config: { buyProductId: "p-1", buyQty: 1, getProductId: "p-1", getQty: 1, getDiscountPercent: 100 },
    });
    const flashHigh = promo({
      id: "flash-1",
      type: "flash",
      priority: 9,
      startsAt: new Date("2026-10-13T00:00:00Z"),
      endsAt: new Date("2026-10-14T00:00:00Z"),
      config: { percentOff: 50 },
    });
    const ev = evaluatePromotions([bogoLow, flashHigh], [line({ quantity: 2, unitPriceMinor: 10000n })], NOW);
    // Flash first: 50% of 20000 = 10000, consuming both units.
    // BOGO: buy units exist but no REMAINING get units ⇒ 0.
    expect(ev.promotionDiscountMinor).toBe(10000n);
    expect(ev.breakdown.map((b) => b.promotionId)).toEqual(["flash-1"]);
  });

  it("inactive and out-of-window promotions are ignored; malformed stored config is skipped, never guessed", () => {
    const off = promo({ id: "off", type: "flash", active: false, config: { percentOff: 90 } });
    const broken = promo({ id: "broken", type: "bogo", config: { buyQty: 1 } });
    const ev = evaluatePromotions([off, broken], [line({ unitPriceMinor: 10000n })], NOW);
    expect(ev.promotionDiscountMinor).toBe(0n);
    expect(ev.breakdown).toHaveLength(0);
  });
});

describe("EC16 config validation", () => {
  it("rejects invalid configs with stable reason keys", () => {
    expect(() => validatePromotionConfig("bogo", { buyQty: 1, getQty: 1, getDiscountPercent: 50 })).toThrow("bogo_buy_scope_required");
    expect(() => validatePromotionConfig("bogo", { buyProductId: "p", buyQty: 1, getProductId: "p", getQty: 1, getDiscountPercent: 101 })).toThrow("bogo_percent");
    expect(() => validatePromotionConfig("tiered", { scope: "category", tiers: [{ minQty: 2, percentOff: 10 }] })).toThrow("tiered_category_required");
    expect(() => validatePromotionConfig("tiered", { scope: "subtotal", tiers: [{ minQty: 2, minAmountMinor: "100", percentOff: 10 }] })).toThrow("tiered_tier_threshold");
    expect(() => validatePromotionConfig("tiered", { scope: "subtotal", tiers: [] })).toThrow("tiered_tiers");
    expect(() => validatePromotionConfig("flash", { percentOff: 95 })).toThrow("flash_percent");
    expect(() => validatePromotionConfig("nope", {})).toThrow("unknown_type");
  });

  it("normalizes a valid tiered config", () => {
    const cfg: any = validatePromotionConfig("tiered", {
      scope: "subtotal",
      tiers: [{ minAmountMinor: "150000", percentOff: 10 }],
    });
    expect(cfg.tiers[0]).toEqual({ minAmountMinor: "150000", minQty: null, percentOff: 10 });
  });
});

describe("EC16 phone key", () => {
  it("normalizes BD formats to the last 11 digits", () => {
    expect(phoneKeyLoose("+880 1712-345678")).toBe("01712345678");
    expect(phoneKeyLoose("01712345678")).toBe("01712345678");
    expect(phoneKeyLoose("8801712345678")).toBe("01712345678");
    expect(phoneKeyLoose(null)).toBe("");
  });
});
