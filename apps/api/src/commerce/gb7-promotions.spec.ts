import { BadRequestException } from "@nestjs/common";
import { ApiException } from "../i18n";
import { validateDiscount, DISCOUNT_REASON_MESSAGES } from "./discounts";
import { evaluatePromotions, validatePromotionConfig, PROMOTION_CONFIG_MESSAGES } from "./promotions";
import { DiscountsService } from "./discounts.service";
import { PromotionsService } from "./promotions.service";
import { AbandonedCheckoutsService } from "./abandoned-checkouts.service";

/** GB7 (GC17) — promotions completion: customer-conditioned
 * coupons, promotion minPriorOrders, appliedDiscounts stamping,
 * the promotions report, and abandoned recovery coupons. */

function matchWhere(row: any, where: any): boolean {
  for (const [k, v] of Object.entries(where ?? {})) {
    if (v === undefined) continue;
    if (v && typeof v === "object" && !(v instanceof Date) && !Array.isArray(v)) {
      const cond: any = v;
      if ("in" in cond) {
        if (!cond.in.includes(row[k])) return false;
        continue;
      }
      if ("notIn" in cond) {
        if (cond.notIn.includes(row[k])) return false;
        continue;
      }
      if ("not" in cond) {
        if (cond.not === null) {
          if (row[k] === null || row[k] === undefined) return false;
        } else if (row[k] === cond.not) return false;
        continue;
      }
      if ("gte" in cond || "lte" in cond || "gt" in cond || "lt" in cond) {
        if (row[k] === null || row[k] === undefined) return false;
        const rv = row[k] instanceof Date ? row[k].getTime() : row[k];
        if ("gte" in cond && !(rv >= (cond.gte instanceof Date ? cond.gte.getTime() : cond.gte))) return false;
        if ("lte" in cond && !(rv <= (cond.lte instanceof Date ? cond.lte.getTime() : cond.lte))) return false;
        if ("gt" in cond && !(rv > cond.gt)) return false;
        if ("lt" in cond && !(rv < cond.lt)) return false;
        continue;
      }
      if (!matchWhere(row, cond)) return false;
    } else if (row[k] !== v) return false;
  }
  return true;
}

function applyOrderBy(rows: any[], orderBy: any): any[] {
  if (!orderBy) return rows;
  const specs = Array.isArray(orderBy) ? orderBy : [orderBy];
  const out = [...rows];
  for (const spec of [...specs].reverse()) {
    for (const [field, dir] of Object.entries(spec)) {
      out.sort((a: any, b: any) => {
        const av = a[field]; const bv = b[field];
        if (av === bv) return 0;
        if (av === null || av === undefined) return 1;
        if (bv === null || bv === undefined) return -1;
        const cmp = av instanceof Date || bv instanceof Date
          ? new Date(av).getTime() - new Date(bv).getTime()
          : av < bv ? -1 : 1;
        return dir === "desc" ? -cmp : cmp;
      });
    }
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
      // simulate the StoreDiscount unique(org, code) constraint
      if (data?.code && rows.some((r) => r.code === data.code && r.organizationId === data.organizationId)) {
        throw new Error("Unique constraint failed on the fields: (`organizationId`,`code`)");
      }
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
    upsert: async ({ where, update, create }: any) => {
      const row = rows.find((r) => matchWhere(r, where));
      if (row) { Object.assign(row, update); return row; }
      const created = { id: create.id ?? `row-${++seq}`, createdAt: new Date(), updatedAt: new Date(), ...create };
      rows.push(created);
      return created;
    },
    count: async ({ where }: any = {}) => rows.filter((r) => matchWhere(r, where)).length,
  };
}

function makePrisma() {
  return {
    organization: makeTable(),
    storefrontSetting: makeTable(),
    category: makeTable(),
    productCategory: makeTable(),
    product: makeTable(),
    productVariant: makeTable(),
    order: makeTable(),
    customer: makeTable(),
    storeDiscount: makeTable(),
    storeDiscountSync: makeTable(),
    promotion: makeTable(),
    taxSetting: makeTable(),
    abandonedCouponSetting: makeTable(),
    abandonedStoreCheckout: makeTable(),
    store: makeTable(),
    storeCart: makeTable(),
    storeCartItem: makeTable(),
    auditLog: makeTable(),
  } as any;
}

const auditStub: any = { log: jest.fn(async () => undefined) };

function makeServices(prisma: any) {
  const discounts = new DiscountsService(prisma, {} as any, auditStub);
  const promotions = new PromotionsService(prisma, discounts, auditStub);
  return { discounts, promotions };
}

const ITEMS = [{ productId: "p-1", categoryId: "cat-1", totalMinor: 10000n }];
function baseDiscount(over: Record<string, any> = {}): any {
  return {
    id: "d-1", organizationId: "org-1", code: "SAVE10", kind: "percent", value: 10,
    minOrderMinor: null, scopeType: "all", scopeIds: null, startsAt: null, endsAt: null,
    usageLimit: null, usedCount: 0, active: true, ...over,
  };
}
const CTX = { subtotalMinor: 10000n, items: ITEMS };

describe("GB7 (a) pure validateDiscount — customer conditions", () => {
  it("firstOrderOnly: accepts prior count 0, refuses 2 and null", () => {
    const d = baseDiscount({ firstOrderOnly: true });
    expect(validateDiscount(d, { ...CTX, priorOrderCount: 0 }).valid).toBe(true);
    expect(validateDiscount(d, { ...CTX, priorOrderCount: 2 }).reason).toBe("not_first_order");
    expect(validateDiscount(d, { ...CTX, priorOrderCount: null }).reason).toBe("not_first_order");
    expect(validateDiscount(d, { ...CTX }).reason).toBe("not_first_order");
    expect(DISCOUNT_REASON_MESSAGES.not_first_order).toBe("এই কুপনটি শুধু প্রথম অর্ডারের জন্য প্রযোজ্য");
  });

  it("repeatCustomerOnly: accepts >=1, refuses 0 and null", () => {
    const d = baseDiscount({ repeatCustomerOnly: true });
    expect(validateDiscount(d, { ...CTX, priorOrderCount: 1 }).valid).toBe(true);
    expect(validateDiscount(d, { ...CTX, priorOrderCount: 3 }).valid).toBe(true);
    expect(validateDiscount(d, { ...CTX, priorOrderCount: 0 }).reason).toBe("not_repeat_customer");
    expect(validateDiscount(d, { ...CTX, priorOrderCount: null }).reason).toBe("not_repeat_customer");
  });

  it("perCustomerLimit: refuses at the limit and on null usage, accepts below", () => {
    const d = baseDiscount({ perCustomerLimit: 2 });
    expect(validateDiscount(d, { ...CTX, customerUsageCount: 1 }).valid).toBe(true);
    expect(validateDiscount(d, { ...CTX, customerUsageCount: 2 }).reason).toBe("customer_limit_reached");
    expect(validateDiscount(d, { ...CTX, customerUsageCount: 5 }).reason).toBe("customer_limit_reached");
    expect(validateDiscount(d, { ...CTX, customerUsageCount: null }).reason).toBe("customer_limit_reached");
  });

  it("maxOrderMinor: refuses above, accepts at exactly the max", () => {
    const d = baseDiscount({ maxOrderMinor: 10000n });
    expect(validateDiscount(d, CTX).valid).toBe(true);
    expect(validateDiscount(d, { ...CTX, subtotalMinor: 10001n }).reason).toBe("above_max_order");
  });

  it("exclusions: refuses by product id and by category id", () => {
    expect(validateDiscount(baseDiscount({ excludedProductIds: ["p-1"] }), CTX).reason).toBe("excluded_items");
    expect(validateDiscount(baseDiscount({ excludedCategoryIds: ["cat-1"] }), CTX).reason).toBe("excluded_items");
    expect(validateDiscount(baseDiscount({ excludedProductIds: ["other"], excludedCategoryIds: ["other-cat"] }), CTX).valid).toBe(true);
  });
});

describe("GB7 (b) pure promotions — minPriorOrders", () => {
  const NOW = new Date("2026-10-15T10:00:00Z");
  const flash: any = {
    id: "promo-1", name: "Flash", type: "flash", active: true, priority: 0,
    startsAt: new Date("2026-10-15T00:00:00Z"), endsAt: new Date("2026-10-16T00:00:00Z"),
    createdAt: new Date("2026-10-01T00:00:00Z"),
    config: { percentOff: 20, minPriorOrders: 2 },
  };
  const lines = [{ productId: "p-1", categoryId: null, quantity: 1, unitPriceMinor: 10000n, compareAtMinor: null }];

  it("validatePromotionConfig normalization: accept integer >= 0, reject others for every type", () => {
    expect((validatePromotionConfig("flash", { percentOff: 10, minPriorOrders: 2 }) as any).minPriorOrders).toBe(2);
    expect((validatePromotionConfig("flash", { percentOff: 10, minPriorOrders: 0 }) as any).minPriorOrders).toBe(0);
    expect((validatePromotionConfig("flash", { percentOff: 10 }) as any).minPriorOrders).toBeUndefined();
    expect((validatePromotionConfig("flash", { percentOff: 10, minPriorOrders: null }) as any).minPriorOrders).toBeUndefined();
    expect((validatePromotionConfig("bogo", { buyProductId: "p", buyQty: 1, getProductId: "p", getQty: 1, getDiscountPercent: 50, minPriorOrders: 3 }) as any).minPriorOrders).toBe(3);
    expect((validatePromotionConfig("tiered", { scope: "subtotal", tiers: [{ minQty: 2, percentOff: 10 }], minPriorOrders: 1 }) as any).minPriorOrders).toBe(1);
    expect((validatePromotionConfig("gift", { minSubtotalMinor: "1000", giftProductId: "p", minPriorOrders: 1 }) as any).minPriorOrders).toBe(1);
    for (const bad of [-1, 1.5, "2", true]) {
      expect(() => validatePromotionConfig("flash", { percentOff: 10, minPriorOrders: bad })).toThrow("min_prior_orders");
    }
    expect(PROMOTION_CONFIG_MESSAGES.min_prior_orders).toBe("সর্বনিম্ন আগের অর্ডার সংখ্যা ০ বা তার বেশি পূর্ণসংখ্যা হতে হবে");
  });

  it("evaluatePromotions applies at count >= min, skips below and on null", () => {
    expect(evaluatePromotions([flash], lines, NOW, { priorOrderCount: 2 }).promotionDiscountMinor).toBe(2000n);
    expect(evaluatePromotions([flash], lines, NOW, { priorOrderCount: 5 }).promotionDiscountMinor).toBe(2000n);
    expect(evaluatePromotions([flash], lines, NOW, { priorOrderCount: 1 }).promotionDiscountMinor).toBe(0n);
    expect(evaluatePromotions([flash], lines, NOW, { priorOrderCount: null }).promotionDiscountMinor).toBe(0n);
    expect(evaluatePromotions([flash], lines, NOW).promotionDiscountMinor).toBe(0n);
    // ctx as the 3rd argument also works (windowless promo so the
    // default `now` cannot affect the result)
    const windowless = { ...flash, id: "promo-3", startsAt: null, endsAt: null };
    expect(evaluatePromotions([windowless], lines, { priorOrderCount: 3 } as any).promotionDiscountMinor).toBe(2000n);
    // a promotion without minPriorOrders is unaffected by a null count
    const plain = { ...flash, id: "promo-2", config: { percentOff: 20 } };
    expect(evaluatePromotions([plain], lines, NOW).promotionDiscountMinor).toBe(2000n);
  });
});

describe("GB7 (c) evaluateCheckout passes ctx through", () => {
  it("firstOrderOnly coupon + priorOrderCount 2 → the exact Bengali refusal", async () => {
    const prisma = makePrisma();
    prisma.storeDiscount.rows.push(baseDiscount({ firstOrderOnly: true }));
    const { promotions } = makeServices(prisma);
    await expect(
      promotions.evaluateCheckout("org-1", {
        lines: [{ productId: "p-1", categoryId: "cat-1", quantity: 1, unitPriceMinor: 10000n }],
        couponCode: "SAVE10",
        priorOrderCount: 2,
        customerId: "cust-1",
      }),
    ).rejects.toThrow("কুপন প্রয়োগ করা যায়নি: এই কুপনটি শুধু প্রথম অর্ডারের জন্য প্রযোজ্য");
    // and with prior count 0 the same coupon applies
    const ev = await promotions.evaluateCheckout("org-1", {
      lines: [{ productId: "p-1", categoryId: "cat-1", quantity: 1, unitPriceMinor: 10000n }],
      couponCode: "SAVE10",
      priorOrderCount: 0,
      customerId: "cust-1",
    });
    expect(ev.couponDiscountMinor).toBe(1000n);
  });

  it("priorOrderCountFor / customerIdForPhone helpers", async () => {
    const prisma = makePrisma();
    prisma.customer.rows.push({ id: "cust-1", organizationId: "org-1", phone: "+880 1712-345678" });
    prisma.order.rows.push(
      { id: "o-1", organizationId: "org-1", customerId: "cust-1", status: "processing", isPractice: false },
      { id: "o-2", organizationId: "org-1", customerId: "cust-1", status: "cancelled", isPractice: false },
      { id: "o-3", organizationId: "org-1", customerId: "cust-1", status: "processing", isPractice: true },
    );
    const { promotions } = makeServices(prisma);
    expect(await promotions.customerIdForPhone("org-1", "01712345678")).toBe("cust-1");
    expect(await promotions.customerIdForPhone("org-1", "01999999999")).toBeNull();
    expect(await promotions.customerIdForPhone("org-1", null)).toBeNull();
    expect(await promotions.priorOrderCountFor("org-1", "cust-1")).toBe(1);
    expect(await promotions.priorOrderCountFor("org-1", "cust-1", "o-1")).toBe(0);
    expect(await promotions.priorOrderCountFor("org-1", null)).toBeNull();
  });
});

describe("GB7 (d) DiscountsService.validateForCheckout counts usage", () => {
  it("counts stamped orders for this customer+code (count args asserted); excludeOrderId excluded", async () => {
    const prisma = makePrisma();
    prisma.storeDiscount.rows.push(baseDiscount({ perCustomerLimit: 1 }));
    prisma.order.rows.push({
      id: "o-prior", organizationId: "org-1", customerId: "cust-1", couponCode: "SAVE10",
      status: "processing", isPractice: false,
    });
    const { discounts } = makeServices(prisma);
    const captured: any[] = [];
    const origCount = prisma.order.count;
    prisma.order.count = jest.fn(async (args: any) => { captured.push(args); return origCount(args); });

    const refused = await discounts.validateForCheckout("org-1", "SAVE10", {
      subtotalMinor: 10000n, items: ITEMS, customerId: "cust-1", priorOrderCount: 1,
    });
    expect(refused.valid).toBe(false);
    expect(refused.reason).toBe("customer_limit_reached");
    expect(captured).toHaveLength(1);
    expect(captured[0].where).toEqual({
      organizationId: "org-1",
      customerId: "cust-1",
      couponCode: "SAVE10",
      isPractice: false,
      status: { notIn: ["cancelled", "failed", "refunded"] },
    });

    // excluding the prior order itself (surgery) → usage 0 → valid
    const ok = await discounts.validateForCheckout("org-1", "SAVE10", {
      subtotalMinor: 10000n, items: ITEMS, customerId: "cust-1", priorOrderCount: 1, excludeOrderId: "o-prior",
    });
    expect(ok.valid).toBe(true);
    expect(captured[1].where.id).toEqual({ not: "o-prior" });

    // no customer identity → usage null → refuses conservatively
    const anon = await discounts.validateForCheckout("org-1", "SAVE10", {
      subtotalMinor: 10000n, items: ITEMS, customerId: null,
    });
    expect(anon.reason).toBe("customer_limit_reached");
    expect(captured).toHaveLength(2); // no count call without a customer
  });
});

describe("GB7 (e) stampOrder writes appliedDiscounts", () => {
  it("builds the stamp from the evaluation; empty evaluation stamps nothing", async () => {
    const prisma = makePrisma();
    prisma.order.rows.push({
      id: "ord-1", organizationId: "org-1", source: "manual", externalId: "ext-1",
      status: "processing", couponCode: null,
    });
    const { promotions } = makeServices(prisma);
    const ev: any = {
      promotionDiscountMinor: 2000n,
      promotionsApplied: [{ promotionId: "pr-1", name: "Promo", type: "flash", amountMinor: 2000n }],
      couponDiscountMinor: 1000n,
      couponFreeShipping: false,
      appliedDiscountId: "d-1",
      appliedCouponCode: "SAVE10",
      referralDiscountMinor: 500n,
      referralCodeToRecord: null,
      taxBreakdown: [],
      gift: null,
    };
    await promotions.stampOrder("org-1", "manual", "ext-1", ev);
    expect(prisma.order.rows[0].appliedDiscounts).toEqual([
      { promotionId: "pr-1", kind: "promotion", name: "Promo", discountMinor: "2000" },
      { couponCode: "SAVE10", kind: "coupon", name: "SAVE10", discountMinor: "1000" },
      { kind: "referral", name: "রেফারেল ছাড়", discountMinor: "500" },
    ]);

    const empty: any = {
      promotionDiscountMinor: 0n, promotionsApplied: [], couponDiscountMinor: 0n,
      appliedDiscountId: null, appliedCouponCode: null, referralDiscountMinor: 0n,
      referralCodeToRecord: null, taxBreakdown: [], gift: null,
    };
    prisma.order.rows[0].appliedDiscounts = undefined;
    await promotions.stampOrder("org-1", "manual", "ext-1", empty);
    expect(prisma.order.rows[0].appliedDiscounts).toBeUndefined();
  });
});

describe("GB7 (f) promotionsReport", () => {
  it("aggregates coupons + promotions from appliedDiscounts stamps, with the coverage note", async () => {
    const prisma = makePrisma();
    const t1 = new Date("2026-10-10T10:00:00Z");
    const t2 = new Date("2026-10-12T10:00:00Z");
    prisma.order.rows.push(
      {
        id: "o-1", organizationId: "org-1", status: "processing", isPractice: false, placedAt: t1,
        totalMinor: 100000n,
        appliedDiscounts: [
          { couponCode: "SAVE10", kind: "coupon", name: "SAVE10", discountMinor: "1000" },
          { promotionId: "pr-1", kind: "promotion", name: "Promo", discountMinor: "2000" },
        ],
      },
      {
        id: "o-2", organizationId: "org-1", status: "processing", isPractice: false, placedAt: t2,
        totalMinor: 50000n,
        appliedDiscounts: [
          { couponCode: "SAVE10", kind: "coupon", name: "SAVE10", discountMinor: "500" },
          { promotionId: "pr-1", kind: "promotion", name: "Promo v2", discountMinor: "1000" },
          { kind: "referral", name: "রেফারেল ছাড়", discountMinor: "300" },
        ],
      },
      {
        id: "o-cancelled", organizationId: "org-1", status: "cancelled", isPractice: false, placedAt: t2,
        totalMinor: 99900n,
        appliedDiscounts: [{ couponCode: "SAVE10", kind: "coupon", name: "SAVE10", discountMinor: "9000" }],
      },
      {
        id: "o-pre", organizationId: "org-1", status: "processing", isPractice: false, placedAt: t2,
        totalMinor: 1000n, appliedDiscounts: null,
      },
    );
    const { promotions } = makeServices(prisma);
    const report = await promotions.promotionsReport("org-1", "2026-10-01T00:00:00Z", "2026-10-15T23:59:59Z");
    expect(report.from).toBe("2026-10-01T00:00:00.000Z");
    expect(report.coupons).toEqual([
      { code: "SAVE10", redemptions: 2, discountTotalMinor: "1500", revenueMinor: "150000" },
    ]);
    expect(report.promotions).toEqual([
      { promotionId: "pr-1", name: "Promo v2", applications: 2, discountTotalMinor: "3000" },
    ]);
    expect(report.coverage).toEqual({
      ordersScanned: 2,
      truncated: false,
      note: "এই রিপোর্টে শুধু GB7 (appliedDiscounts স্ট্যাম্প) চালুর পর দেওয়া অর্ডার ধরা হয়েছে; আগের অর্ডারে এই তথ্য নেই।",
    });
    await expect(promotions.promotionsReport("org-1", "not-a-date")).rejects.toBeInstanceOf(ApiException);
  });
});

describe("GB7 (g) abandoned recovery coupons", () => {
  function nativeSetup() {
    const prisma = makePrisma();
    prisma.organization.rows.push({ id: "org-1", name: "Test Shop", slug: "myshop" });
    prisma.product.rows.push({ id: "p-1", organizationId: "org-1", name: "T-Shirt", priceMinor: 50000n, status: "ACTIVE" });
    prisma.storeCart.rows.push({
      id: "cart-1", organizationId: "org-1", status: "open", email: "buyer@example.com", phone: null,
      items: [{ productId: "p-1", quantity: 1 }],
      updatedAt: new Date("2026-10-15T10:00:00Z"),
    });
    const audit: any = {
      log: async (input: any) => {
        prisma.auditLog.rows.push({
          id: `audit-${prisma.auditLog.rows.length + 1}`,
          organizationId: input.organizationId, userId: input.userId, action: input.action,
          entityType: input.entityType, entityId: input.entityId, metadata: input.metadata,
          createdAt: new Date(),
        });
      },
    };
    const sent: any[] = [];
    const email: any = { send: async (input: any) => { sent.push(input); return { providerMessageId: "msg-1" }; } };
    const service = new AbandonedCheckoutsService(prisma, audit, email, undefined, undefined);
    return { prisma, service, sent, audit };
  }

  const EXPECTED_OFF_TEXT = [
    "আসসালামু আলাইকুম,",
    "",
    "Test Shop-এ আপনি কিছু পণ্য কার্টে রেখেছিলেন, কিন্তু অর্ডারটি সম্পূর্ণ করেননি।",
    "",
    "আপনার কার্টে যা আছে:",
    "- T-Shirt ×1",
    "",
    "মোট মূল্য: ৳500.00",
    "",
    "আপনার অর্ডারটি সম্পূর্ণ করতে এখানে ফিরে যান: /shop/myshop",
    "",
    "ধন্যবাদান্তে,",
    "Test Shop",
  ].join("\n");

  it("setting OFF → native recovery email is byte-identical and no coupon is created", async () => {
    const { prisma, service, sent } = nativeSetup();
    const res = await service.sendNativeRecovery("org-1", "user-1", "cart-1");
    expect(res.sent).toBe(true);
    expect(sent).toHaveLength(1);
    expect(sent[0].text).toBe(EXPECTED_OFF_TEXT);
    expect(prisma.storeDiscount.rows).toHaveLength(0);
    const marker = prisma.auditLog.rows.find((r: any) => r.action === "commerce.native_cart_recovery_sent");
    expect(marker?.metadata?.couponCode).toBeUndefined();
  });

  it("setting ON → a real coupon is issued and its code line is in the email", async () => {
    const { prisma, service, sent } = nativeSetup();
    prisma.abandonedCouponSetting.rows.push({
      id: "set-1", organizationId: "org-1", enabled: true, kind: "percent", value: 10,
      expiryHours: 72, minOrderMinor: null,
    });
    const before = Date.now();
    await service.sendNativeRecovery("org-1", "user-1", "cart-1");
    const after = Date.now();
    expect(prisma.storeDiscount.rows).toHaveLength(1);
    const coupon = prisma.storeDiscount.rows[0];
    expect(coupon.code).toMatch(/^RCV-[A-Z0-9]{8}$/);
    expect(coupon).toMatchObject({
      organizationId: "org-1", kind: "percent", value: 10, perCustomerLimit: 1,
      firstOrderOnly: false, active: true, origin: "abandoned_recovery", sourceRef: "cart-1",
    });
    const expires = new Date(coupon.endsAt).getTime();
    expect(expires).toBeGreaterThanOrEqual(before + 72 * 3600_000 - 5000);
    expect(expires).toBeLessThanOrEqual(after + 72 * 3600_000 + 5000);
    expect(sent[0].text).toContain(coupon.code);
    expect(sent[0].text).toContain("10% ছাড়");
    expect(sent[0].text).toContain("72 ঘণ্টা পর্যন্ত বৈধ");
    const marker = prisma.auditLog.rows.find((r: any) => r.action === "commerce.native_cart_recovery_sent");
    expect(marker?.metadata?.couponCode).toBe(coupon.code);
  });

  it("setting validation: defaults, and percent 0 rejected when enabled", async () => {
    const { prisma, service } = nativeSetup();
    expect(await service.getCouponSetting("org-1")).toEqual({
      enabled: false, kind: "percent", value: 0, expiryHours: 72, minOrderMinor: null,
    });
    await expect(
      service.updateCouponSetting("org-1", "user-1", { enabled: true, kind: "percent", value: 0 }),
    ).rejects.toBeInstanceOf(ApiException);
    await expect(
      service.updateCouponSetting("org-1", "user-1", { enabled: true, kind: "percent", value: 95 }),
    ).rejects.toBeInstanceOf(ApiException);
    await expect(
      service.updateCouponSetting("org-1", "user-1", { expiryHours: 721 }),
    ).rejects.toBeInstanceOf(ApiException);
    const saved = await service.updateCouponSetting("org-1", "user-1", {
      enabled: true, kind: "fixed", value: 5000, expiryHours: 24, minOrderMinor: "10000",
    });
    expect(saved).toEqual({ enabled: true, kind: "fixed", value: 5000, expiryHours: 24, minOrderMinor: "10000" });
    expect(prisma.abandonedCouponSetting.rows).toHaveLength(1);
    const audits = (auditStub.log as jest.Mock);
    void audits;
  });
});
