import { BadRequestException } from "@nestjs/common";
import { StorefrontService } from "./storefront.service";

/**
 * AB2 (AX3) — gift cards on the shop surface: gift-card line
 * pricing in computeQuote (the cart line's chosen amount IS the
 * unit price / face value), redemption resolution + quote
 * serialization, the digital-access gift-card reveal, the
 * trackOrder gift-card summary (names only — never a code), and
 * the public balance delegation. Fake prisma in the ec24-digital
 * harness style; GiftCardsService + PromotionsService are stubs
 * (the REAL evaluator's gift-card line is covered by
 * commerce/ab2-evaluator.spec.ts).
 */

function matchWhere(row: any, where: any): boolean {
  for (const [k, v] of Object.entries(where ?? {})) {
    if (v === undefined) continue;
    if (k === "OR") {
      if (!(v as any[]).some((sub) => matchWhere(row, sub))) return false;
      continue;
    }
    if (v !== null && typeof v === "object" && !(v instanceof Date) && !Array.isArray(v)) {
      if ("in" in (v as any)) { if (!(v as any).in.includes(row[k])) return false; continue; }
      if ("not" in (v as any)) { if (row[k] === (v as any).not) return false; continue; }
      if (!matchWhere(row[k] ?? {}, v)) return false;
    } else if (v === null) {
      if (row[k] !== null && row[k] !== undefined) return false;
    } else if (row[k] !== v) return false;
  }
  return true;
}

function makeTable(name: string) {
  const rows: any[] = [];
  let seq = 0;
  return {
    rows,
    findFirst: async ({ where }: any = {}) => rows.find((r) => matchWhere(r, where)) ?? null,
    findMany: async ({ where }: any = {}) => rows.filter((r) => matchWhere(r, where ?? {})),
    count: async ({ where }: any = {}) => rows.filter((r) => matchWhere(r, where ?? {})).length,
    create: async ({ data }: any) => {
      const row = { id: data.id ?? `${name}-${++seq}`, createdAt: new Date(), ...data };
      rows.push(row);
      return row;
    },
    update: async ({ where, data }: any) => {
      const row = rows.find((r) => r.id === where.id);
      if (!row) throw new Error("not found");
      Object.assign(row, data);
      return row;
    },
    delete: async ({ where }: any) => {
      const idx = rows.findIndex((r) => r.id === where.id);
      if (idx >= 0) rows.splice(idx, 1);
      return null;
    },
  };
}

function fakePrisma() {
  return {
    organization: makeTable("org"), storefrontSetting: makeTable("setting"),
    businessProfile: makeTable("bp"), shippingZone: makeTable("zone"),
    product: makeTable("product"), productVariant: makeTable("variant"),
    productImage: makeTable("img"), category: makeTable("cat"),
    storeCart: makeTable("cart"), storeCartItem: makeTable("ci"),
    storeCartBundle: makeTable("cb"),
    order: makeTable("order"), orderItem: makeTable("item"),
    customer: makeTable("customer"), fulfillment: makeTable("fulfillment"),
    courierShipment: makeTable("ship"), paymentVerification: makeTable("pv"),
    deliverySlot: makeTable("slot"), integration: makeTable("int"),
    installmentPlan: makeTable("plan"), returnRequest: makeTable("rr"),
    giftCard: makeTable("giftCard"),
  } as any;
}

const PHONE = "01711111111";
const GC_CONFIG = { presetAmountsMinor: [50000, 100000], allowCustomAmount: false, minAmountMinor: null, maxAmountMinor: null };

function seedShop(prisma: any) {
  prisma.organization.rows.push({ id: "org-1", slug: "shop-one", name: "Shop One" });
  prisma.storefrontSetting.rows.push({
    id: "s-1", organizationId: "org-1", shopEnabled: true, trackingPageEnabled: true, shopName: "Shop",
  });
  prisma.shippingZone.rows.push({
    id: "z-1", organizationId: "org-1", name: "ঢাকা", kind: "inside_dhaka", districts: null,
    chargeMinor: 6000n, deliveryDays: 1, freeAboveMinor: null, active: true, position: 0,
  });
  // A gift-card product: stock 0 on purpose — gift-card lines
  // bypass the stock guard entirely.
  prisma.product.rows.push({
    id: "p-gc", organizationId: "org-1", name: "গিফট কার্ড", status: "ACTIVE",
    priceMinor: 10000n, compareAtMinor: null, stockQuantity: 0, digital: false,
    isGiftCard: true, giftCardConfig: GC_CONFIG,
  });
  prisma.product.rows.push({
    id: "p-plain", organizationId: "org-1", name: "মগ", status: "ACTIVE",
    priceMinor: 40000n, compareAtMinor: null, stockQuantity: 10, digital: false, isGiftCard: false,
  });
  prisma.storeCart.rows.push({ id: "cart-1", organizationId: "org-1", token: "tok-1", status: "open" });
}

/** Promotions stub: no promotions/coupon/tax; the gift-card line
 * is priced exactly like the real evaluator (min(balance,
 * merchandise subtotal)) so quote totals stay honest. */
function makePromotions() {
  return {
    evaluateCheckout: jest.fn(async (_orgId: string, input: any) => {
      const subtotal = input.lines.reduce(
        (s: bigint, l: any) => s + l.unitPriceMinor * BigInt(l.quantity), 0n,
      ) + (input.bumpMinor ?? 0n);
      const giftCardDiscountMinor = input.giftCard
        ? (input.giftCard.balanceMinor < subtotal ? input.giftCard.balanceMinor : subtotal)
        : 0n;
      return {
        subtotalMinor: subtotal,
        promotionDiscountMinor: 0n, promotionsApplied: [],
        couponDiscountMinor: 0n, couponFreeShipping: false,
        appliedDiscountId: null, appliedCouponCode: null,
        referral: null, referralCodeToRecord: null, referralDiscountMinor: 0n,
        loyaltyDiscountMinor: 0n, loyaltyPointsApplied: 0,
        giftCardDiscountMinor,
        giftCardId: giftCardDiscountMinor > 0n ? input.giftCard?.giftCardId ?? null : null,
        giftCardCodeLast4: giftCardDiscountMinor > 0n ? input.giftCard?.codeLast4 ?? null : null,
        totalDiscountMinor: giftCardDiscountMinor,
        taxMinor: 0n, taxAddedMinor: 0n, taxBreakdown: [], gift: null,
      };
    }),
  };
}

function makeGiftCards(over: any = {}) {
  return {
    resolveForCheckout: jest.fn(async () => ({
      giftCardId: "gc-1", codeLast4: "1234", balanceMinor: 20000n, status: "active", expiresAt: null,
    })),
    postPlacementRedeem: jest.fn(async () => null),
    recordIntents: jest.fn(async () => undefined),
    buyerRevealForOrder: jest.fn(async () => []),
    publicBalance: jest.fn(async () => { throw new BadRequestException("গিফট কার্ডের কোডটি সঠিক নয় বা এই দোকানের কার্ড নয়"); }),
    ...over,
  };
}

function makeSvc(prisma: any, giftCards?: any, promotions: any = makePromotions()) {
  // Positional construction: giftCards is the LAST (18th) param.
  const svc = new StorefrontService(
    prisma, undefined, undefined, undefined, undefined, undefined,
    promotions as any, undefined, undefined, undefined, undefined, undefined,
    undefined, undefined, undefined, undefined, undefined,
    giftCards as any,
  );
  return svc;
}

const CART = { id: "cart-1" };

describe("AB2 shop — computeQuote gift-card line pricing", () => {
  it("a preset amount stored on the cart line becomes the line's unit price (face value)", async () => {
    const prisma = fakePrisma();
    seedShop(prisma);
    prisma.storeCartItem.rows.push({
      id: "ci-1", cartId: "cart-1", productId: "p-gc", variantId: null, quantity: 1,
      includeBump: false, giftCardAmountMinor: 50000n, giftCardRecipient: { name: "মা" },
    });
    const svc = makeSvc(prisma, makeGiftCards());
    const q: any = await svc.computeQuote("org-1", CART, "ঢাকা", undefined, {});
    expect(q.lines[0].unitPriceMinor).toBe(50000n);
    expect(q.itemsSubtotalMinor).toBe(50000n);
    const serialized: any = (svc as any).serializeQuote(q, "ঢাকা");
    expect(serialized.items[0].unitPriceMinor).toBe("50000");
    expect(serialized.items[0].lineTotalMinor).toBe("50000");
  });

  it("a stored amount the config does not allow is refused", async () => {
    const prisma = fakePrisma();
    seedShop(prisma);
    prisma.storeCartItem.rows.push({
      id: "ci-1", cartId: "cart-1", productId: "p-gc", variantId: null, quantity: 1,
      includeBump: false, giftCardAmountMinor: 30000n,
    });
    const svc = makeSvc(prisma, makeGiftCards());
    await expect(svc.computeQuote("org-1", CART, "ঢাকা", undefined, {}))
      .rejects.toThrow("গিফট কার্ডের পরিমাণটি এই পণ্যের জন্য প্রযোজ্য নয়");
  });

  it("no stored amount + the product price is not an allowed amount => choose-on-product-page refusal", async () => {
    const prisma = fakePrisma();
    seedShop(prisma);
    prisma.storeCartItem.rows.push({
      id: "ci-1", cartId: "cart-1", productId: "p-gc", variantId: null, quantity: 1, includeBump: false,
    });
    const svc = makeSvc(prisma, makeGiftCards());
    await expect(svc.computeQuote("org-1", CART, "ঢাকা", undefined, {}))
      .rejects.toThrow("গিফট কার্ডের পরিমাণ পণ্যের পেজ থেকে বেছে নিন");
  });
});

describe("AB2 shop — gift-card redemption in quote", () => {
  it("redemption refusal propagates when the cart contains a gift-card product", async () => {
    const prisma = fakePrisma();
    seedShop(prisma);
    // Price the gift-card line itself at an allowed preset so the
    // quote reaches the redemption step.
    prisma.storeCartItem.rows.push({
      id: "ci-1", cartId: "cart-1", productId: "p-gc", variantId: null, quantity: 1,
      includeBump: false, giftCardAmountMinor: 50000n,
    });
    const giftCards = makeGiftCards({
      resolveForCheckout: jest.fn(async () => {
        throw new BadRequestException("গিফট কার্ড দিয়ে গিফট কার্ড কেনা যাবে না");
      }),
    });
    const svc = makeSvc(prisma, giftCards);
    await expect(
      svc.computeQuote("org-1", CART, "ঢাকা", undefined, { giftCardCode: "QG-AAAA-BBBB-CCCC" }),
    ).rejects.toThrow("গিফট কার্ড দিয়ে গিফট কার্ড কেনা যাবে না");
    expect(giftCards.resolveForCheckout).toHaveBeenCalledWith(
      "org-1", "QG-AAAA-BBBB-CCCC", { cartHasGiftCardProduct: true },
    );
  });

  it("a resolved card prices the discount and serializes WITHOUT the internal giftCardId", async () => {
    const prisma = fakePrisma();
    seedShop(prisma);
    prisma.storeCartItem.rows.push({
      id: "ci-1", cartId: "cart-1", productId: "p-plain", variantId: null, quantity: 1, includeBump: false,
    });
    const giftCards = makeGiftCards();
    const svc = makeSvc(prisma, giftCards);
    const q: any = await svc.computeQuote("org-1", CART, "ঢাকা", undefined, { giftCardCode: "QG-AAAA-BBBB-1234" });
    expect(q.giftCard).toMatchObject({ codeLast4: "1234", giftCardId: "gc-1" });
    expect(q.giftCard.discountMinor).toBe(20000n);
    const serialized: any = (svc as any).serializeQuote(q, "ঢাকা");
    expect(serialized.giftCard).toEqual({ codeLast4: "1234", balanceMinor: "20000", discountMinor: "20000" });
    expect(JSON.stringify(serialized)).not.toContain("gc-1");
    expect(serialized.discountMinor).toBe("20000");
  });

  it("a presented code with NO gift-cards service wired refuses honestly", async () => {
    const prisma = fakePrisma();
    seedShop(prisma);
    prisma.storeCartItem.rows.push({
      id: "ci-1", cartId: "cart-1", productId: "p-plain", variantId: null, quantity: 1, includeBump: false,
    });
    const svc = makeSvc(prisma, undefined);
    await expect(
      svc.computeQuote("org-1", CART, "ঢাকা", undefined, { giftCardCode: "QG-AAAA-BBBB-1234" }),
    ).rejects.toThrow("গিফট কার্ড সুবিধা এই দোকানে নেই");
  });
});

function seedTrackedOrder(prisma: any) {
  seedShop(prisma);
  prisma.customer.rows.push({ id: "c-1", organizationId: "org-1", phone: PHONE, firstName: "রহিম" });
  prisma.order.rows.push({
    id: "o-1", organizationId: "org-1", externalId: "native-1", externalNumber: "ORD-1",
    customerId: "c-1", status: "completed", totalMinor: 50000n, currency: "BDT",
    digitalAccessCount: 0, placedAt: new Date(),
  });
  prisma.orderItem.rows.push({
    id: "i-1", orderId: "o-1", productId: "p-gc", name: "গিফট কার্ড", quantity: 1, totalMinor: 50000n,
  });
}

describe("AB2 shop — digitalAccess gift-card reveal", () => {
  it("returns issued gift cards for an order whose ONLY lines are gift cards (no digital-product refusal, no access counting)", async () => {
    const prisma = fakePrisma();
    seedTrackedOrder(prisma);
    const giftCards = makeGiftCards({
      buyerRevealForOrder: jest.fn(async () => [{
        code: "QG-FAKE-CODE-1234", codeLast4: "1234",
        initialAmountMinor: "50000", balanceMinor: "50000", status: "active", expiresAt: null,
      }]),
    });
    const svc = makeSvc(prisma, giftCards);
    const out: any = await svc.digitalAccess("shop-one", { phone: PHONE, orderNumber: "ORD-1" });
    expect(out.links).toEqual([]);
    expect(out.giftCards).toEqual([{
      code: "QG-FAKE-CODE-1234", codeLast4: "1234",
      initialAmountMinor: "50000", balanceMinor: "50000", status: "active", expiresAt: null,
    }]);
    // Gift-card-only reveals are NOT counted against the digital cap.
    expect(prisma.order.rows[0].digitalAccessCount).toBe(0);
  });
});

describe("AB2 shop — trackOrder gift-card summary", () => {
  it("carries giftCardItems (name + issued) and a note, but NO code anywhere in the payload", async () => {
    const prisma = fakePrisma();
    seedTrackedOrder(prisma);
    prisma.giftCard.rows.push({
      id: "gc-row-1", organizationId: "org-1", issuedOrderId: "o-1",
      codeSealed: "QG-SECRET-9999", codeLast4: "9999",
    });
    const svc = makeSvc(prisma, makeGiftCards());
    const out: any = await svc.trackOrder("shop-one", { phone: PHONE, orderNumber: "ORD-1" });
    expect(out.giftCardItems).toEqual([{ name: "গিফট কার্ড", issued: true }]);
    expect(typeof out.giftCardNote).toBe("string");
    expect(JSON.stringify(out)).not.toContain("QG-SECRET-9999");
    expect(JSON.stringify(out)).not.toContain("codeSealed");
  });
});

describe("AB2 shop — public balance delegation", () => {
  it("delegates to GiftCardsService.publicBalance for the resolved org", async () => {
    const prisma = fakePrisma();
    seedShop(prisma);
    const giftCards = makeGiftCards({
      publicBalance: jest.fn(async () => ({ balanceMinor: "7500", status: "active", expiresAt: null })),
    });
    const svc = makeSvc(prisma, giftCards);
    await expect(svc.giftCardBalance("shop-one", { code: "QG-AAAA-BBBB-1234" }))
      .resolves.toEqual({ balanceMinor: "7500", status: "active", expiresAt: null });
    expect(giftCards.publicBalance).toHaveBeenCalledWith("org-1", "QG-AAAA-BBBB-1234");
  });

  it("an unknown code and a wrong-org code surface the IDENTICAL generic error", async () => {
    const prisma = fakePrisma();
    seedShop(prisma);
    const svc = makeSvc(prisma, makeGiftCards());
    const e1 = await svc.giftCardBalance("shop-one", { code: "QG-UNKN-OWN0-0000" }).catch((e) => e);
    const e2 = await svc.giftCardBalance("shop-one", { code: "QG-OTHE-RORG-1111" }).catch((e) => e);
    expect(e1).toBeInstanceOf(BadRequestException);
    expect(e2.message).toBe(e1.message);
  });

  it("no gift-cards service wired => the shop-honest refusal", async () => {
    const prisma = fakePrisma();
    seedShop(prisma);
    const svc = makeSvc(prisma, undefined);
    await expect(svc.giftCardBalance("shop-one", { code: "QG-AAAA-BBBB-1234" }))
      .rejects.toThrow("গিফট কার্ড সুবিধা এই দোকানে নেই");
  });
});
