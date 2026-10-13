import { DiscountsService } from "./discounts.service";
import { SyncOutboxService } from "./sync-outbox.service";
import { ProductsService } from "../products/products.service";
import {
  parseShopifyDiscountNode,
  parseWooCoupon,
  validateDiscount,
} from "./discounts";

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
function makeTable() {
  const rows: any[] = [];
  let seq = 0;
  return {
    rows,
    findFirst: async ({ where }: any) => rows.find((r) => matchWhere(r, where)) ?? null,
    findMany: async ({ where }: any = {}) => rows.filter((r) => matchWhere(r, where)),
    create: async ({ data }: any) => { const row = { id: data.id ?? `row-${++seq}`, createdAt: new Date(), ...data }; rows.push(row); return row; },
    update: async ({ where, data }: any) => {
      const row = rows.find((r) => matchWhere(r, where));
      if (!row) throw new Error("record not found");
      Object.assign(row, data);
      return row;
    },
    count: async ({ where }: any = {}) => rows.filter((r) => matchWhere(r, where)).length,
  };
}

function makePrisma() {
  return {
    store: makeTable(),
    storeDiscount: makeTable(),
    storeDiscountSync: makeTable(),
    syncOutbox: makeTable(),
    integration: makeTable(),
    storeListing: makeTable(),
    storeTaxonomyMap: makeTable(),
    product: makeTable(),
  } as any;
}

const auditStub: any = { log: async () => undefined };
const registryStub: any = { get: () => undefined };

function baseDiscount(over: Record<string, any> = {}): any {
  return {
    id: "d1", organizationId: "org-1", code: "SAVE", kind: "percent", value: 10,
    minOrderMinor: null, scopeType: "all", scopeIds: null,
    startsAt: null, endsAt: null, usageLimit: null, usedCount: 0, active: true,
    ...over,
  };
}

describe("EC7 validateDiscount", () => {
  const items = [
    { productId: "p1", categoryId: "c1", totalMinor: 9999n },
    { productId: "p2", categoryId: "c2", totalMinor: 5000n },
  ];
  it("percent floors on the scoped base only", () => {
    const v = validateDiscount(
      baseDiscount({ value: 33, scopeType: "products", scopeIds: ["p1"] }),
      { subtotalMinor: 14999n, items },
    );
    expect(v.valid).toBe(true);
    expect(v.discountMinor).toBe(3299n); // floor(9999 * 33 / 100)
  });
  it("categories scope filters by categoryId", () => {
    const v = validateDiscount(
      baseDiscount({ value: 10, scopeType: "categories", scopeIds: ["c2"] }),
      { subtotalMinor: 14999n, items },
    );
    expect(v.discountMinor).toBe(500n);
  });
  it("fixed is capped at the eligible base", () => {
    const v = validateDiscount(
      baseDiscount({ kind: "fixed", value: 5000 }),
      { subtotalMinor: 3000n, items: [{ productId: "p1", totalMinor: 3000n }] },
    );
    expect(v.discountMinor).toBe(3000n);
  });
  it("free_shipping yields 0 discount + the flag", () => {
    const v = validateDiscount(
      baseDiscount({ kind: "free_shipping", value: 0 }),
      { subtotalMinor: 3000n, items },
    );
    expect(v).toMatchObject({ valid: true, discountMinor: 0n, freeShipping: true });
  });
  it("min order, window, usage limit and inactive are enforced in order", () => {
    expect(validateDiscount(baseDiscount({ minOrderMinor: 20000n }), { subtotalMinor: 14999n, items }).reason)
      .toBe("below_min_order");
    expect(validateDiscount(baseDiscount({ startsAt: new Date(Date.now() + 86400000) }), { subtotalMinor: 14999n, items }).reason)
      .toBe("not_started");
    expect(validateDiscount(baseDiscount({ endsAt: new Date(Date.now() - 86400000) }), { subtotalMinor: 14999n, items }).reason)
      .toBe("expired");
    expect(validateDiscount(baseDiscount({ usageLimit: 3, usedCount: 3 }), { subtotalMinor: 14999n, items }).reason)
      .toBe("usage_limit_reached");
    expect(validateDiscount(baseDiscount({ active: false }), { subtotalMinor: 14999n, items }).reason)
      .toBe("inactive");
    expect(validateDiscount(null, { subtotalMinor: 14999n, items }).reason).toBe("inactive");
  });
  it("scoped discount with no eligible items fails honestly", () => {
    const v = validateDiscount(
      baseDiscount({ scopeType: "products", scopeIds: ["nope"] }),
      { subtotalMinor: 14999n, items },
    );
    expect(v).toMatchObject({ valid: false, reason: "no_eligible_items" });
  });
  it("out-of-range percent is invalid_kind", () => {
    expect(validateDiscount(baseDiscount({ value: 95 }), { subtotalMinor: 14999n, items }).reason)
      .toBe("invalid_kind");
  });
});

describe("EC7 platform parsers", () => {
  it("parseWooCoupon: percent / fixed / free-shipping-wins / minimum / dates", () => {
    const pct = parseWooCoupon({ id: 7, code: "save10", discount_type: "percent", amount: "10", status: "publish" });
    expect(pct).toMatchObject({ code: "SAVE10", kind: "percent", value: 10, active: true, externalId: "7" });
    const fixed = parseWooCoupon({ id: 8, code: "flat", discount_type: "fixed_cart", amount: "25.50" });
    expect(fixed).toMatchObject({ kind: "fixed", value: 2550 });
    const ship = parseWooCoupon({ id: 9, code: "ship", discount_type: "percent", amount: "50", free_shipping: true });
    expect(ship).toMatchObject({ kind: "free_shipping", value: 0 });
    const rich = parseWooCoupon({
      id: 10, code: "rich", discount_type: "percent", amount: "5",
      minimum_amount: "100.00", date_expires: "2030-01-01T00:00:00.000Z", usage_limit: 5, status: "draft",
    });
    expect(rich.minOrderMinor).toBe(10000n);
    expect(rich.endsAt?.toISOString()).toBe("2030-01-01T00:00:00.000Z");
    expect(rich.usageLimit).toBe(5);
    expect(rich.active).toBe(false);
  });

  it("parseShopifyDiscountNode: percentage conversion + non-basic → null", () => {
    const node = {
      id: "gid://shopify/DiscountCodeNode/1",
      discount: {
        __typename: "DiscountCodeBasic",
        status: "ACTIVE",
        usageLimit: 100,
        endsAt: "2030-06-01T00:00:00.000Z",
        codes: { edges: [{ node: { code: "save20" } }] },
        customerGets: { value: { __typename: "DiscountPercentage", percentage: 0.2 } },
        minimumRequirement: { subtotal: { greaterThanOrEqualToSubtotal: "50.00" } },
      },
    };
    const parsed = parseShopifyDiscountNode(node);
    expect(parsed).toMatchObject({ code: "SAVE20", kind: "percent", value: 20, usageLimit: 100, active: true });
    expect(parsed?.minOrderMinor).toBe(5000n);
    const amt = parseShopifyDiscountNode({
      id: "gid://shopify/DiscountCodeNode/2",
      discount: {
        __typename: "DiscountCodeBasic", status: "ACTIVE",
        codes: { edges: [{ node: { code: "FLAT15" } }] },
        customerGets: { value: { __typename: "DiscountAmount", amount: { amount: "15.00" } } },
      },
    });
    expect(amt).toMatchObject({ kind: "fixed", value: 1500 });
    expect(parseShopifyDiscountNode({ id: "x", discount: { __typename: "DiscountCodeBxgy" } })).toBeNull();
    expect(parseShopifyDiscountNode({ id: "x", discount: { __typename: "DiscountCodeBasic", codes: { edges: [] } } })).toBeNull();
  });
});

describe("EC7 DiscountsService", () => {
  function setup() {
    const prisma = makePrisma();
    const outbox = new SyncOutboxService(prisma, registryStub);
    const svc = new DiscountsService(prisma, outbox, auditStub);
    return { prisma, outbox, svc };
  }

  it("create normalizes the code; a duplicate code conflicts", async () => {
    const { svc } = setup();
    const { discount } = await svc.create("org-1", "u1", { code: " eid10 ", kind: "percent", value: 10 });
    expect(discount.code).toBe("EID10");
    expect(discount.minOrderMinor).toBeNull();
    await expect(svc.create("org-1", "u1", { code: "Eid10", kind: "percent", value: 5 }))
      .rejects.toThrow("ইতিমধ্যে একটি ডিসকাউন্ট আছে");
  });

  it("create with storeIds enqueues push_discount only for a co-manage store", async () => {
    const { prisma, svc } = setup();
    prisma.store.rows.push(
      { id: "st-mirror", organizationId: "org-1", platform: "WOOCOMMERCE", name: "Mirror", syncMode: "mirror" },
      { id: "st-co", organizationId: "org-1", platform: "WOOCOMMERCE", name: "Co", syncMode: "co-manage" },
    );
    const { discount, pushes } = await svc.create("org-1", "u1", {
      code: "PUSHME", kind: "fixed", value: 500, storeIds: ["st-mirror", "st-co", "st-missing"],
    });
    expect(pushes).toEqual([
      { storeId: "st-mirror", enqueued: false, reason: "sync_mode_mirror" },
      { storeId: "st-co", enqueued: true, outboxId: expect.any(String) },
      { storeId: "st-missing", enqueued: false, reason: "store_not_found" },
    ]);
    expect(prisma.syncOutbox.rows).toHaveLength(1);
    expect(prisma.syncOutbox.rows[0]).toMatchObject({
      operation: "push_discount", entityType: "discount", entityId: discount.id, storeId: "st-co",
    });
    expect(prisma.syncOutbox.rows[0].payload).toMatchObject({ discountId: discount.id, storeId: "st-co" });
    const syncRow = prisma.storeDiscountSync.rows.find((r: any) => r.storeId === "st-co");
    expect(syncRow).toMatchObject({ discountId: discount.id, syncStatus: "pending" });
    expect(discount.syncs.map((s: any) => s.storeId)).toEqual(["st-co"]);
    expect(discount.syncs[0].storeName).toBe("Co");
  });

  it("generateCampaignCodes creates unique, well-formed codes", async () => {
    const { prisma, svc } = setup();
    const res = await svc.generateCampaignCodes("org-1", "u1", {
      prefix: "sale!", count: 5, kind: "percent", value: 10,
    });
    expect(res.created).toBe(5);
    expect(new Set(res.codes).size).toBe(5);
    for (const code of res.codes) expect(code).toMatch(/^SALE-[0-9A-F]{6}$/);
    expect(prisma.storeDiscount.rows).toHaveLength(5);
    await expect(svc.generateCampaignCodes("org-1", "u1", { prefix: "X", count: 0, kind: "percent", value: 10 }))
      .rejects.toThrow();
  });
});

describe("EC7 checkout coupon flow (ProductsService.placePublicOrder)", () => {
  function setupCheckout() {
    const prisma = makePrisma();
    prisma.product.rows.push({
      id: "p1", organizationId: "org-1", slug: "widget", status: "ACTIVE",
      name: "Widget", sku: "W-1", priceMinor: 10000n, currency: "BDT",
      categoryId: "c1", bumpTitle: null, bumpPriceMinor: null, variants: [],
      organization: {
        id: "org-1", name: "Shop",
        businessProfile: { insideDhakaFeeMinor: 6000n, outsideDhakaFeeMinor: 12000n },
      },
    });
    const outbox = new SyncOutboxService(prisma, registryStub);
    const discounts = new DiscountsService(prisma, outbox, auditStub);
    const orderPayloads: any[] = [];
    const integrations: any = {
      upsertOrder: async (_org: string, _x: any, payload: any) => {
        orderPayloads.push(payload);
        return "created";
      },
    };
    const products = new ProductsService(prisma, auditStub, undefined, integrations, undefined, discounts);
    const dto: any = {
      customerName: "Test User", customerPhone: "01700000000",
      customerAddress: "Khulna, Bangladesh", quantity: 2,
    };
    return { prisma, discounts, products, orderPayloads, dto };
  }

  it("(i) a valid percent coupon reduces the total and is redeemed once", async () => {
    const { prisma, products, orderPayloads, dto } = setupCheckout();
    prisma.storeDiscount.rows.push(baseDiscount({
      id: "d-save", code: "SAVE10", kind: "percent", value: 10,
    }));
    const res: any = await products.placePublicOrder("widget", { ...dto, couponCode: "save10" });
    expect(orderPayloads).toHaveLength(1);
    expect(orderPayloads[0].discountMinor).toBe(2000n); // 10% of 20000
    expect(orderPayloads[0].shippingMinor).toBe(6000n);
    expect(orderPayloads[0].totalMinor).toBe(24000n);
    expect(res.totalMinor).toBe("24000");
    expect(res.discountMinor).toBe("2000");
    expect(res.couponApplied).toBe(true);
    expect(prisma.storeDiscount.rows[0].usedCount).toBe(1);
  });

  it("(ii) an invalid coupon throws BadRequest and NO order is written", async () => {
    const { products, orderPayloads, dto } = setupCheckout();
    await expect(products.placePublicOrder("widget", { ...dto, couponCode: "NOPE" }))
      .rejects.toThrow("কুপন প্রয়োগ করা যায়নি");
    expect(orderPayloads).toHaveLength(0);
  });

  it("(iii) a free-shipping coupon zeroes the shipping in the payload", async () => {
    const { prisma, products, orderPayloads, dto } = setupCheckout();
    prisma.storeDiscount.rows.push(baseDiscount({
      id: "d-ship", code: "FREESHIP", kind: "free_shipping", value: 0,
    }));
    const res: any = await products.placePublicOrder("widget", { ...dto, couponCode: "FREESHIP" });
    expect(orderPayloads[0].shippingMinor).toBe(0n);
    expect(orderPayloads[0].discountMinor).toBe(0n);
    expect(orderPayloads[0].totalMinor).toBe(20000n);
    expect(res.freeShippingApplied).toBe(true);
  });

  it("no coupon: behaviour is unchanged (discount 0, full shipping)", async () => {
    const { products, orderPayloads, dto } = setupCheckout();
    const res: any = await products.placePublicOrder("widget", { ...dto });
    expect(orderPayloads[0].discountMinor).toBe(0n);
    expect(orderPayloads[0].shippingMinor).toBe(6000n);
    expect(orderPayloads[0].totalMinor).toBe(26000n);
    expect(res.couponApplied).toBe(false);
  });
});
