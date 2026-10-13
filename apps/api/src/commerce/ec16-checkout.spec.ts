import { BadRequestException, NotFoundException } from "@nestjs/common";
import { DiscountsService } from "./discounts.service";
import { PromotionsService } from "./promotions.service";
import { validateDiscount } from "./discounts";
import { ProductsService } from "../products/products.service";
import { StorefrontService } from "../storefront/storefront.service";
import { LandingsService } from "../landings/landings.service";

/** EC16 — unified checkout evaluation (promotions → EC7 coupon →
 * referral), CRUD validation, and the three-checkout-path parity
 * proof: the SAME cart must produce the SAME totals in the shop,
 * single-product and landing checkouts. */

function matchWhere(row: any, where: any): boolean {
  for (const [k, v] of Object.entries(where ?? {})) {
    if (v === undefined) continue;
    if (v && typeof v === "object" && !(v instanceof Date) && !Array.isArray(v)) {
      if ("in" in (v as any)) {
        if (!((v as any).in as any[]).includes(row[k])) return false;
        continue;
      }
      if ("not" in (v as any)) {
        if (row[k] === (v as any).not) return false;
        continue;
      }
      if (!matchWhere(row, v)) return false;
    } else if (row[k] !== v) return false;
  }
  return true;
}

function applyOrderBy(rows: any[], orderBy: any): any[] {
  if (!orderBy) return rows;
  const specs = Array.isArray(orderBy) ? orderBy : [orderBy];
  const out = [...rows];
  for (const spec of [...specs].reverse()) {
    const [key, dir] = Object.entries(spec)[0] as [string, string];
    out.sort((a, b) => {
      const av = a[key];
      const bv = b[key];
      if (av === bv) return 0;
      if (av === null || av === undefined) return 1;
      if (bv === null || bv === undefined) return -1;
      const cmp =
        av instanceof Date || bv instanceof Date
          ? new Date(av).getTime() - new Date(bv).getTime()
          : av < bv
            ? -1
            : 1;
      return dir === "desc" ? -cmp : cmp;
    });
  }
  return out;
}

function makeTable() {
  const rows: any[] = [];
  let seq = 0;
  return {
    rows,
    findFirst: async ({ where, orderBy }: any = {}) =>
      applyOrderBy(rows.filter((r) => matchWhere(r, where)), orderBy)[0] ?? null,
    findMany: async ({ where, orderBy, take, skip }: any = {}) => {
      let found = applyOrderBy(rows.filter((r) => matchWhere(r, where)), orderBy);
      if (skip) found = found.slice(skip);
      if (take !== undefined) found = found.slice(0, take);
      return found;
    },
    create: async ({ data }: any) => {
      const row = { id: data.id ?? `row-${++seq}`, createdAt: new Date(), updatedAt: new Date(), ...data };
      rows.push(row);
      return row;
    },
    update: async ({ where, data }: any) => {
      const row = rows.find((r) => matchWhere(r, where));
      if (!row) throw new Error("record not found");
      Object.assign(row, data);
      return row;
    },
    delete: async ({ where }: any) => {
      const idx = rows.findIndex((r) => matchWhere(r, where));
      if (idx < 0) throw new Error("record not found");
      return rows.splice(idx, 1)[0];
    },
    count: async ({ where }: any = {}) => rows.filter((r) => matchWhere(r, where)).length,
  };
}

function makePrisma() {
  return {
    organization: makeTable(),
    storefrontSetting: makeTable(),
    businessProfile: makeTable(),
    category: makeTable(),
    product: makeTable(),
    productVariant: makeTable(),
    productImage: makeTable(),
    shippingZone: makeTable(),
    storeCart: makeTable(),
    storeCartItem: makeTable(),
    order: makeTable(),
    storeDiscount: makeTable(),
    promotion: makeTable(),
    customer: makeTable(),
    landingPage: makeTable(),
    landingVariant: makeTable(),
    auditLog: makeTable(),
    store: makeTable(),
    integration: makeTable(),
  } as any;
}

const T0 = new Date("2026-10-01T00:00:00Z");
const auditStub: any = { log: jest.fn(async () => undefined) };

function makeServices(prisma: any) {
  const discounts = new DiscountsService(prisma, {} as any, auditStub);
  const promotions = new PromotionsService(prisma, discounts, auditStub);
  return { discounts, promotions };
}

function couponRow(partial: any = {}) {
  return {
    id: "d-save", organizationId: "org-1", code: "SAVE10", kind: "percent", value: 10,
    minOrderMinor: null, scopeType: "all", scopeIds: null, startsAt: null, endsAt: null,
    usageLimit: null, usedCount: 0, active: true, origin: "manual",
    createdAt: T0, updatedAt: T0, ...partial,
  };
}

function tieredPromoRow(partial: any = {}) {
  return {
    id: "pr-tier", organizationId: "org-1", name: "৳১৫০০+ অর্ডারে ১০%",
    type: "tiered",
    config: { scope: "subtotal", tiers: [{ minAmountMinor: "150000", percentOff: 10 }] },
    startsAt: null, endsAt: null, active: true, priority: 0, createdBy: "u1",
    createdAt: T0, updatedAt: T0, ...partial,
  };
}

const LINE_2X = [
  { productId: "p-1", categoryId: "cat-1", quantity: 2, unitPriceMinor: 100000n, compareAtMinor: null },
];

describe("EC16 evaluateCheckout — stacking order", () => {
  it("coupon-only cart is byte-identical to EC7 validateDiscount (parity)", async () => {
    const prisma = makePrisma();
    prisma.storeDiscount.rows.push(couponRow());
    const { promotions } = makeServices(prisma);
    const ev = await promotions.evaluateCheckout("org-1", { lines: LINE_2X, couponCode: "SAVE10" });
    const direct = validateDiscount(couponRow(), {
      subtotalMinor: 200000n,
      items: [{ productId: "p-1", categoryId: "cat-1", totalMinor: 200000n }],
    });
    expect(direct.valid).toBe(true);
    expect(ev.couponDiscountMinor).toBe(direct.discountMinor);
    expect(ev.promotionDiscountMinor).toBe(0n);
    expect(ev.totalDiscountMinor).toBe(20000n);
  });

  it("promotions first, coupon on the post-promotion base", async () => {
    const prisma = makePrisma();
    prisma.storeDiscount.rows.push(couponRow());
    prisma.promotion.rows.push(tieredPromoRow());
    const { promotions } = makeServices(prisma);
    const ev = await promotions.evaluateCheckout("org-1", { lines: LINE_2X, couponCode: "SAVE10" });
    expect(ev.promotionDiscountMinor).toBe(20000n); // 10% of 200000
    expect(ev.couponDiscountMinor).toBe(18000n); // 10% of post-promo 180000
    expect(ev.totalDiscountMinor).toBe(38000n);
    expect(ev.promotionsApplied[0].name).toBe("৳১৫০০+ অর্ডারে ১০%");
  });

  it("coupon minimum-order is judged on the POST-promotion subtotal", async () => {
    const prisma = makePrisma();
    prisma.storeDiscount.rows.push(couponRow({ minOrderMinor: 190000n }));
    prisma.promotion.rows.push(tieredPromoRow());
    const { promotions } = makeServices(prisma);
    // Pre-promotion subtotal 200000 ≥ 190000 would pass under EC7's
    // old base; post-promotion 180000 < 190000 must refuse.
    await expect(
      promotions.evaluateCheckout("org-1", { lines: LINE_2X, couponCode: "SAVE10" }),
    ).rejects.toThrow(/কুপন প্রয়োগ করা যায়নি/);
  });

  it("invalid coupon throws the EC7 Bengali message; free-shipping coupon flags shipping only", async () => {
    const prisma = makePrisma();
    prisma.storeDiscount.rows.push(couponRow({ id: "d-ship", code: "SHIPFREE", kind: "free_shipping", value: 0 }));
    const { promotions } = makeServices(prisma);
    await expect(
      promotions.evaluateCheckout("org-1", { lines: LINE_2X, couponCode: "NOPE" }),
    ).rejects.toBeInstanceOf(BadRequestException);
    const ev = await promotions.evaluateCheckout("org-1", { lines: LINE_2X, couponCode: "SHIPFREE" });
    expect(ev.couponFreeShipping).toBe(true);
    expect(ev.couponDiscountMinor).toBe(0n);
  });
});

describe("EC16 referral-as-discount", () => {
  function seedReferral(prisma: any, settingPartial: any = {}) {
    prisma.storefrontSetting.rows.push({
      id: "set-1", organizationId: "org-1", shopEnabled: true,
      referralDiscountPercent: 10, referralMinSubtotalMinor: null, ...settingPartial,
    });
    prisma.customer.rows.push({
      id: "cust-ref", organizationId: "org-1", firstName: "Referrer", phone: "01812345678",
      referralCode: "REFABC123", createdAt: T0, updatedAt: T0,
    });
  }

  it("happy path: 10% of the post-promotion, post-coupon merchandise amount", async () => {
    const prisma = makePrisma();
    seedReferral(prisma);
    prisma.storeDiscount.rows.push(couponRow());
    prisma.promotion.rows.push(tieredPromoRow());
    const { promotions } = makeServices(prisma);
    const ev = await promotions.evaluateCheckout("org-1", {
      lines: LINE_2X, couponCode: "SAVE10", referralCode: "refabc123", buyerPhone: "01799999999",
    });
    // post-promo 180000 − coupon 18000 = 162000 → 10% = 16200
    expect(ev.referral?.discountMinor).toBe(16200n);
    expect(ev.referralCodeToRecord).toBe("REFABC123");
    expect(ev.totalDiscountMinor).toBe(20000n + 18000n + 16200n);
  });

  it("feature off (percent unset): no discount, but a REAL referrer's code is still recorded", async () => {
    const prisma = makePrisma();
    seedReferral(prisma, { referralDiscountPercent: null });
    const { promotions } = makeServices(prisma);
    const ev = await promotions.evaluateCheckout("org-1", {
      lines: LINE_2X, referralCode: "REFABC123", buyerPhone: "01799999999",
    });
    expect(ev.referral).toBeNull();
    expect(ev.referralDiscountMinor).toBe(0n);
    expect(ev.referralCodeToRecord).toBe("REFABC123");
  });

  it("unknown code: nothing granted, nothing recorded", async () => {
    const prisma = makePrisma();
    seedReferral(prisma);
    const { promotions } = makeServices(prisma);
    const ev = await promotions.evaluateCheckout("org-1", {
      lines: LINE_2X, referralCode: "REFZZZZ99", buyerPhone: "01799999999",
    });
    expect(ev.referral).toBeNull();
    expect(ev.referralCodeToRecord).toBeNull();
  });

  it("self-referral (same phone, different format) is silently refused", async () => {
    const prisma = makePrisma();
    seedReferral(prisma);
    const { promotions } = makeServices(prisma);
    const ev = await promotions.evaluateCheckout("org-1", {
      lines: LINE_2X, referralCode: "REFABC123", buyerPhone: "+8801812345678",
    });
    expect(ev.referral).toBeNull();
    expect(ev.referralDiscountMinor).toBe(0n);
  });

  it("repeat use by the same customer + code grants nothing; a cancelled prior order does not block", async () => {
    const prisma = makePrisma();
    seedReferral(prisma);
    prisma.customer.rows.push({
      id: "cust-buyer", organizationId: "org-1", firstName: "Buyer", phone: "01799999999",
      referralCode: null, createdAt: T0, updatedAt: T0,
    });
    prisma.order.rows.push({
      id: "ord-old", organizationId: "org-1", customerId: "cust-buyer", referralCode: "REFABC123",
      status: "processing", createdAt: T0, updatedAt: T0,
    });
    const { promotions } = makeServices(prisma);
    const blocked = await promotions.evaluateCheckout("org-1", {
      lines: LINE_2X, referralCode: "REFABC123", buyerPhone: "01799999999",
    });
    expect(blocked.referral).toBeNull();

    prisma.order.rows[0].status = "cancelled";
    const allowed = await promotions.evaluateCheckout("org-1", {
      lines: LINE_2X, referralCode: "REFABC123", buyerPhone: "01799999999",
    });
    expect(allowed.referral?.discountMinor).toBe(20000n); // 10% of 200000
  });

  it("below the configured minimum subtotal: no discount", async () => {
    const prisma = makePrisma();
    seedReferral(prisma, { referralMinSubtotalMinor: 500000n });
    const { promotions } = makeServices(prisma);
    const ev = await promotions.evaluateCheckout("org-1", {
      lines: LINE_2X, referralCode: "REFABC123", buyerPhone: "01799999999",
    });
    expect(ev.referral).toBeNull();
    expect(ev.referralCodeToRecord).toBe("REFABC123");
  });

  it("ensureCustomerReferralCode generates once and is stable", async () => {
    const prisma = makePrisma();
    prisma.customer.rows.push({
      id: "cust-1", organizationId: "org-1", phone: "01700000000", referralCode: null,
      createdAt: T0, updatedAt: T0,
    });
    const { promotions } = makeServices(prisma);
    const code1 = await promotions.ensureCustomerReferralCode("org-1", "cust-1");
    expect(code1).toMatch(/^REF[A-Z0-9]{6}$/);
    const code2 = await promotions.ensureCustomerReferralCode("org-1", "cust-1");
    expect(code2).toBe(code1);
    expect(await promotions.ensureCustomerReferralCode("org-1", "ghost")).toBeNull();
  });
});

describe("EC16 promotion CRUD + preview", () => {
  it("create validates config, window and referenced ids; foreign rows 404", async () => {
    const prisma = makePrisma();
    prisma.category.rows.push({ id: "cat-1", organizationId: "org-1", name: "Cat", createdAt: T0, updatedAt: T0 });
    prisma.product.rows.push({ id: "p-1", organizationId: "org-1", name: "P", status: "ACTIVE", priceMinor: 1000n, createdAt: T0, updatedAt: T0 });
    const { promotions } = makeServices(prisma);

    await expect(
      promotions.create("org-1", "u1", { name: "Bad", type: "bogo", config: { buyQty: 1, getQty: 1, getDiscountPercent: 50 } } as any),
    ).rejects.toThrow(/কেনার পণ্য বা ক্যাটাগরি/);
    await expect(
      promotions.create("org-1", "u1", {
        name: "FlashNoWindow", type: "flash", config: { percentOff: 10 },
      } as any),
    ).rejects.toThrow(/শুরু ও শেষের সময়/);
    await expect(
      promotions.create("org-1", "u1", {
        name: "Ghost", type: "bogo",
        config: { buyProductId: "ghost", buyQty: 1, getProductId: "p-1", getQty: 1, getDiscountPercent: 50 },
      } as any),
    ).rejects.toThrow(/পণ্য পাওয়া যায়নি/);

    const created = await promotions.create("org-1", "u1", {
      name: "ঠিক আছে", type: "tiered",
      config: { scope: "category", categoryId: "cat-1", tiers: [{ minQty: 2, percentOff: 5 }] },
    } as any);
    expect(created.promotion.id).toBeTruthy();
    await expect(promotions.getOne("org-2", created.promotion.id)).rejects.toBeInstanceOf(NotFoundException);
  });

  it("preview prices from REAL product rows and refuses unknown products", async () => {
    const prisma = makePrisma();
    prisma.product.rows.push({
      id: "p-1", organizationId: "org-1", name: "P", status: "ACTIVE",
      priceMinor: 50000n, compareAtMinor: null, categoryId: "cat-1", createdAt: T0, updatedAt: T0,
    });
    prisma.promotion.rows.push(tieredPromoRow({
      config: { scope: "subtotal", tiers: [{ minAmountMinor: "90000", percentOff: 10 }] },
    }));
    const { promotions } = makeServices(prisma);
    const res: any = await promotions.preview("org-1", { items: [{ productId: "p-1", quantity: 2 }] } as any);
    expect(res.subtotalMinor).toBe("100000");
    expect(res.promotionDiscountMinor).toBe("10000");
    expect(res.merchandiseTotalMinor).toBe("90000");
    await expect(
      promotions.preview("org-1", { items: [{ productId: "ghost", quantity: 1 }] } as any),
    ).rejects.toBeInstanceOf(BadRequestException);
  });
});

describe("EC16 three-path parity — same cart, same totals", () => {
  function seedParity(prisma: any) {
    prisma.organization.rows.push({ id: "org-1", slug: "shop-one", name: "Shop One", brandName: null, createdAt: T0, updatedAt: T0 });
    prisma.storefrontSetting.rows.push({
      id: "set-1", organizationId: "org-1", shopEnabled: true, shopName: "Shop One",
      referralDiscountPercent: null, referralMinSubtotalMinor: null,
      featuredProductIds: null, domainVerifyToken: null, domainVerifiedAt: null,
      createdAt: T0, updatedAt: T0,
    });
    prisma.product.rows.push({
      id: "p-1", organizationId: "org-1", name: "প্রিমিয়াম পণ্য", slug: "prod-one",
      description: "বিবরণ", category: null, categoryId: "cat-1", sku: "P-1", status: "ACTIVE",
      priceMinor: 100000n, compareAtMinor: null, currency: "BDT", stockQuantity: null,
      imageUrl: null, bumpTitle: null, bumpPriceMinor: null, bumpImageUrl: null,
      variants: [],
      organization: {
        id: "org-1", name: "Shop One",
        businessProfile: { deliveryChargeInsideMinor: 6000n, deliveryChargeOutsideMinor: 12000n },
      },
      createdAt: T0, updatedAt: T0,
    });
    prisma.shippingZone.rows.push({
      id: "z-in", organizationId: "org-1", name: "ঢাকার ভিতরে", kind: "inside_dhaka",
      districts: null, chargeMinor: 6000n, deliveryDays: 1, freeAboveMinor: null,
      active: true, position: 0, createdAt: T0, updatedAt: T0,
    });
    prisma.storeDiscount.rows.push(couponRow());
    prisma.promotion.rows.push(tieredPromoRow());
    prisma.landingPage.rows.push({
      id: "lp-1", organizationId: "org-1", productId: "p-1", slug: "lp-one",
      title: "Landing", status: "published", sections: null, upsellProductId: null,
      createdAt: T0, updatedAt: T0,
    });
  }

  function makeIntegrations(prisma: any) {
    let seq = 0;
    return {
      upsertOrder: jest.fn(async (orgId: string, _storeId: any, payload: any, source: string) => {
        prisma.order.rows.push({
          id: `order-${++seq}`, organizationId: orgId, source,
          externalId: payload.externalId, externalNumber: payload.externalNumber,
          status: payload.status, subtotalMinor: payload.subtotalMinor,
          shippingMinor: payload.shippingMinor, discountMinor: payload.discountMinor,
          totalMinor: payload.totalMinor, customerId: null,
          createdAt: new Date(), updatedAt: new Date(),
        });
        return "created";
      }),
    };
  }

  const EXPECTED = { subtotal: "200000", discount: "38000", delivery: "6000", total: "168000", promo: "20000" };

  it("shop checkout, single checkout and landing order all total 168000 and stamp the split", async () => {
    const prisma = makePrisma();
    seedParity(prisma);
    const { discounts, promotions } = makeServices(prisma);
    const integrations = makeIntegrations(prisma);

    // --- shop path ---
    const shop = new StorefrontService(prisma, integrations as any, discounts as any, auditStub, undefined, undefined, promotions as any);
    const { cartToken } = await shop.createCart("shop-one");
    await shop.patchCartLine("shop-one", cartToken, { productId: "p-1", quantity: 2 } as any);
    const shopRes: any = await shop.checkout("shop-one", {
      cartToken, name: "Buyer", phone: "01711111111", address: "Dhaka address",
      district: "ঢাকা", couponCode: "SAVE10",
    } as any);
    expect(shopRes.subtotalMinor).toBe(EXPECTED.subtotal);
    expect(shopRes.discountMinor).toBe(EXPECTED.discount);
    expect(shopRes.deliveryMinor).toBe(EXPECTED.delivery);
    expect(shopRes.totalMinor).toBe(EXPECTED.total);
    expect(shopRes.promotionDiscountMinor).toBe(EXPECTED.promo);
    expect(shopRes.promotionsApplied[0].name).toBe("৳১৫০০+ অর্ডারে ১০%");

    // --- single-product path ---
    const products = new ProductsService(prisma, auditStub, undefined, integrations as any, undefined, discounts, promotions);
    const singleRes: any = await products.placePublicOrder("prod-one", {
      customerName: "Buyer", customerPhone: "01711111111", customerAddress: "Dhaka address",
      quantity: 2, couponCode: "SAVE10", deliveryZone: "inside_dhaka",
    } as any);
    expect(singleRes.discountMinor).toBe(EXPECTED.discount);
    expect(singleRes.totalMinor).toBe(EXPECTED.total);
    expect(singleRes.promotionDiscountMinor).toBe(EXPECTED.promo);

    // --- landing path ---
    const storefrontHelper = new StorefrontService(prisma);
    const landings = new LandingsService(prisma, auditStub, storefrontHelper as any, discounts as any, integrations as any, undefined, undefined, promotions as any);
    const landingRes: any = await landings.placeOrder("lp-one", {
      customerName: "Buyer", customerPhone: "01711111111", customerAddress: "Dhaka address",
      quantity: 2, couponCode: "SAVE10", district: "ঢাকা",
    } as any);
    expect(landingRes.totals.subtotalMinor).toBe(EXPECTED.subtotal);
    expect(landingRes.totals.discountMinor).toBe(EXPECTED.discount);
    expect(landingRes.totals.shippingMinor).toBe(EXPECTED.delivery);
    expect(landingRes.totals.totalMinor).toBe(EXPECTED.total);
    expect(landingRes.promotionDiscountMinor).toBe(EXPECTED.promo);

    // --- order stamps: all three orders carry the EC16 split ---
    expect(prisma.order.rows).toHaveLength(3);
    for (const o of prisma.order.rows) {
      expect(o.discountMinor).toBe(38000n);
      expect(o.totalMinor).toBe(168000n);
      expect(o.promotionDiscountMinor).toBe(20000n);
      expect(o.referralDiscountMinor ?? 0n).toBe(0n);
      expect(o.promotionsApplied?.[0]?.name).toBe("৳১৫০০+ অর্ডারে ১০%");
    }
    const sources = prisma.order.rows.map((o: any) => o.source).sort();
    expect(sources).toEqual(["landing", "manual", "native_storefront"]);
  });

  it("legacy harness (no PromotionsService injected) keeps EC7 coupon-only totals", async () => {
    const prisma = makePrisma();
    seedParity(prisma);
    const { discounts } = makeServices(prisma);
    const integrations = makeIntegrations(prisma);
    const products = new ProductsService(prisma, auditStub, undefined, integrations as any, undefined, discounts);
    const res: any = await products.placePublicOrder("prod-one", {
      customerName: "Buyer", customerPhone: "01711111111", customerAddress: "Dhaka address",
      quantity: 2, couponCode: "SAVE10", deliveryZone: "inside_dhaka",
    } as any);
    // Coupon only: 10% of 200000 = 20000; total = 200000 − 20000 + 6000.
    expect(res.discountMinor).toBe("20000");
    expect(res.totalMinor).toBe("186000");
    expect(res.promotionDiscountMinor).toBe("0");
  });
});
