import { BadRequestException } from "@nestjs/common";
import { ApiException } from "../i18n";
import { StorefrontService } from "./storefront.service";
import { ProductsService } from "../products/products.service";
import { selectWholesaleTier, validateWholesaleTiers } from "../commerce/ec24";

/** EC24d — wholesale tiers: validation, boundary pricing, evaluator order. */
function matchWhere(row: any, where: any): boolean {
  for (const [k, v] of Object.entries(where ?? {})) {
    if (v === undefined) continue;
    if (k === "OR") { if (!(v as any[]).some((s) => matchWhere(row, s))) return false; continue; }
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
    findUnique: async ({ where }: any = {}) => rows.find((r) => r.id === where?.id) ?? null,
    findMany: async ({ where }: any = {}) => rows.filter((r) => matchWhere(r, where ?? {})),
    count: async ({ where }: any = {}) => rows.filter((r) => matchWhere(r, where ?? {})).length,
    create: async ({ data }: any) => { const row = { id: data.id ?? `${name}-${++seq}`, createdAt: new Date(), updatedAt: new Date(), ...data }; rows.push(row); return row; },
    update: async ({ where, data }: any) => {
      const row = rows.find((r) => r.id === where.id) ?? rows.find((r) => matchWhere(r, where));
      if (!row) throw new Error("not found");
      Object.assign(row, data);
      return row;
    },
    deleteMany: async () => ({ count: 0 }),
  };
}
function fakePrisma() {
  return {
    organization: makeTable("org"), storefrontSetting: makeTable("setting"),
    product: makeTable("product"), productVariant: makeTable("variant"),
    storeCart: makeTable("cart"), storeCartItem: makeTable("cartItem"),
    shippingZone: makeTable("zone"), customer: makeTable("customer"),
    order: makeTable("order"), orderItem: makeTable("item"),
    productImage: makeTable("img"),
  } as any;
}
const auditStub: any = { log: jest.fn(async () => undefined) };
const TIERS = [
  { minQty: 10, priceMinor: "40000" },
  { minQty: 20, priceMinor: "35000" },
];

function seedShop(prisma: any, over: { priceMinor?: bigint; isWholesale?: boolean } = {}) {
  prisma.organization.rows.push({ id: "org-1", slug: "shop-one", name: "Shop One" });
  prisma.storefrontSetting.rows.push({ id: "s-1", organizationId: "org-1", shopEnabled: true, shopName: "Shop", trackingPageEnabled: true });
  prisma.product.rows.push({
    id: "p-1", organizationId: "org-1", name: "চাল", slug: "rice", sku: "RICE-1", status: "ACTIVE",
    priceMinor: over.priceMinor ?? 50000n, compareAtMinor: null, currency: "BDT", stockQuantity: null,
    wholesaleTiers: TIERS, bumpPriceMinor: null, bumpTitle: null,
  });
  prisma.shippingZone.rows.push({ id: "z-1", organizationId: "org-1", name: "সব", kind: "all", active: true, chargeMinor: 6000, freeAboveMinor: null, position: 0 });
  prisma.customer.rows.push({ id: "c-1", organizationId: "org-1", firstName: "পাইকার", phone: "01711111111", isWholesale: over.isWholesale ?? true });
  prisma.storeCart.rows.push({ id: "cart-1", organizationId: "org-1", token: "tok-1", status: "open", email: null, phone: null });
}
async function quoteWith(prisma: any, qty: number, svc: StorefrontService, wholesaleCustomer: any) {
  prisma.storeCartItem.rows.length = 0;
  prisma.storeCartItem.rows.push({ id: "ci-1", cartId: "cart-1", productId: "p-1", variantId: null, quantity: qty, includeBump: false });
  const cart = prisma.storeCart.rows[0];
  return svc.computeQuote("org-1", cart, "ঢাকা", undefined, { wholesaleCustomer });
}

describe("EC24d tier validation", () => {
  it("accepts ascending tiers and normalizes priceMinor to string", () => {
    expect(validateWholesaleTiers([{ minQty: 5, priceMinor: 45000 }, { minQty: 10, priceMinor: "40000" }]))
      .toEqual([{ minQty: 5, priceMinor: "45000" }, { minQty: 10, priceMinor: "40000" }]);
    expect(validateWholesaleTiers(null)).toBeNull();
    expect(validateWholesaleTiers(undefined)).toBeNull();
  });
  it("rejects descending, duplicate, minQty 1, zero price, >10 tiers, non-array", () => {
    expect(() => validateWholesaleTiers([{ minQty: 10, priceMinor: "1" }, { minQty: 5, priceMinor: "1" }])).toThrow(ApiException);
    expect(() => validateWholesaleTiers([{ minQty: 5, priceMinor: "1" }, { minQty: 5, priceMinor: "2" }])).toThrow(ApiException);
    expect(() => validateWholesaleTiers([{ minQty: 1, priceMinor: "100" }])).toThrow(/minQty কমপক্ষে ২/);
    expect(() => validateWholesaleTiers([{ minQty: 2, priceMinor: "0" }])).toThrow(ApiException);
    expect(() => validateWholesaleTiers(Array.from({ length: 11 }, (_, i) => ({ minQty: i + 2, priceMinor: "100" })))).toThrow(ApiException);
    expect(() => validateWholesaleTiers("nope")).toThrow(ApiException);
  });
  it("selectWholesaleTier: boundary + highest qualifying tier", () => {
    expect(selectWholesaleTier(TIERS, 9)).toBeNull();
    expect(selectWholesaleTier(TIERS, 10)).toEqual({ minQty: 10, priceMinor: "40000" });
    expect(selectWholesaleTier(TIERS, 19)).toEqual({ minQty: 10, priceMinor: "40000" });
    expect(selectWholesaleTier(TIERS, 20)).toEqual({ minQty: 20, priceMinor: "35000" });
    expect(selectWholesaleTier(null, 99)).toBeNull();
  });
});

describe("EC24d product create/update validation (ProductsService)", () => {
  function setup() {
    const prisma = fakePrisma();
    const svc = new ProductsService(prisma, auditStub);
    return { prisma, svc };
  }
  it("create stores normalized tiers; digital without URL and subscription without interval are Bengali 400s", async () => {
    const { prisma, svc } = setup();
    const created: any = await svc.create("org-1", "staff", {
      name: "চাল প্রিমিয়াম", price: "500.00", wholesaleTiers: [{ minQty: 10, priceMinor: 40000 }],
    } as any);
    expect(prisma.product.rows[0].wholesaleTiers).toEqual([{ minQty: 10, priceMinor: "40000" }]);
    expect(created.wholesaleTiers).toEqual([{ minQty: 10, priceMinor: "40000" }]);
    await expect(svc.create("org-1", "staff", { name: "ইবুক X", price: "100.00", digital: true } as any))
      .rejects.toThrow(/ডিজিটাল পণ্য চালু করতে ফাইল URL আবশ্যক/);
    await expect(svc.create("org-1", "staff", { name: "কফি X", price: "100.00", subscriptionEnabled: true } as any))
      .rejects.toThrow(/সাবস্ক্রিপশন চালু করতে ইন্টারভাল/);
    await expect(svc.create("org-1", "staff", { name: "চাল X", price: "100.00", wholesaleTiers: [{ minQty: 3, priceMinor: "1" }, { minQty: 2, priceMinor: "1" }] } as any))
      .rejects.toThrow(ApiException);
    const okDigital: any = await svc.create("org-1", "staff", {
      name: "ইবুক Y", price: "100.00", digital: true, digitalFileUrl: "https://files.example.com/y.pdf",
      subscriptionEnabled: true, subscriptionIntervalDays: 30, subscriptionDiscountPercent: 10,
      preorderEnabled: true, preorderLimit: 50,
    } as any);
    expect(okDigital.digital).toBe(true);
    expect(okDigital.subscriptionIntervalDays).toBe(30);
    expect(okDigital.preorderLimit).toBe(50);
  });
});

describe("EC24d storefront pricing", () => {
  it("boundaries: minQty-1 regular, minQty tier, higher tier at its boundary", async () => {
    const prisma = fakePrisma(); seedShop(prisma);
    const svc = new StorefrontService(prisma);
    const customer = prisma.customer.rows[0];
    let q = await quoteWith(prisma, 9, svc, customer);
    expect(q.lines[0].unitPriceMinor).toBe(50000n);
    expect(q.wholesaleApplied).toBe(false);
    q = await quoteWith(prisma, 10, svc, customer);
    expect(q.lines[0].unitPriceMinor).toBe(40000n);
    expect(q.wholesaleBreakdown).toEqual([{ productId: "p-1", minQty: 10, priceMinor: "40000" }]);
    q = await quoteWith(prisma, 20, svc, customer);
    expect(q.lines[0].unitPriceMinor).toBe(35000n);
  });

  it("tier REPLACES even a lower regular/sale price", async () => {
    const prisma = fakePrisma(); seedShop(prisma, { priceMinor: 30000n });
    const svc = new StorefrontService(prisma);
    const q = await quoteWith(prisma, 10, svc, prisma.customer.rows[0]);
    expect(q.lines[0].unitPriceMinor).toBe(40000n); // tier wins although regular is lower
  });

  it("non-wholesale customer and guest get regular pricing", async () => {
    const prisma = fakePrisma(); seedShop(prisma, { isWholesale: false });
    const svc = new StorefrontService(prisma);
    let q = await quoteWith(prisma, 20, svc, prisma.customer.rows[0]);
    expect(q.lines[0].unitPriceMinor).toBe(50000n);
    q = await quoteWith(prisma, 20, svc, null);
    expect(q.lines[0].unitPriceMinor).toBe(50000n);
    expect(q.wholesaleApplied).toBe(false);
  });

  it("promotions evaluator receives the TIER price and its discount applies on top", async () => {
    const prisma = fakePrisma(); seedShop(prisma);
    let seenLines: any[] = [];
    const promotionsStub: any = {
      evaluateCheckout: jest.fn(async (_org: string, input: any) => {
        seenLines = input.lines;
        return {
          subtotalMinor: 400000n, promotionDiscountMinor: 0n, promotionsApplied: [],
          couponDiscountMinor: 0n, couponFreeShipping: false, appliedDiscountId: null, appliedCouponCode: null,
          referral: null, referralCodeToRecord: null, referralDiscountMinor: 0n,
          totalDiscountMinor: 20000n, taxMinor: 0n, taxAddedMinor: 0n, taxBreakdown: [],
        };
      }),
      stampOrder: jest.fn(async () => undefined),
      yourReferralCodeForPhone: jest.fn(async () => null),
    };
    const svc = new StorefrontService(prisma, undefined, undefined, auditStub, undefined, undefined, promotionsStub);
    const q = await quoteWith(prisma, 10, svc, prisma.customer.rows[0]);
    expect(seenLines[0].unitPriceMinor).toBe(40000n);
    expect(q.discountMinor).toBe(20000n); // promotion discount on top of tier pricing
    expect(q.totalMinor).toBe(40000n * 10n - 20000n + 6000n);
  });

  it("checkout stamps wholesaleBreakdown and answers wholesaleApplied", async () => {
    const prisma = fakePrisma(); seedShop(prisma);
    prisma.storeCartItem.rows.push({ id: "ci-1", cartId: "cart-1", productId: "p-1", variantId: null, quantity: 10, includeBump: false });
    const integrationsStub: any = {
      upsertOrder: jest.fn(async (orgId: string, _s: any, o: any, source: string) => {
        const order = await prisma.order.create({
          data: {
            organizationId: orgId, source, externalId: o.externalId, externalNumber: o.externalNumber,
            status: o.status, totalMinor: o.totalMinor, subtotalMinor: o.subtotalMinor,
            discountMinor: o.discountMinor, shippingMinor: o.shippingMinor, customerId: "c-1",
          },
        });
        for (const item of o.items) {
          await prisma.orderItem.create({ data: { orderId: order.id, productId: "p-1", name: item.name, quantity: item.quantity, priceMinor: item.priceMinor, totalMinor: item.totalMinor } });
        }
        return "created";
      }),
    };
    const svc = new StorefrontService(prisma, integrationsStub, undefined, auditStub);
    const res: any = await svc.checkout("shop-one", {
      cartToken: "tok-1", name: "পাইকার", phone: "01711111111", address: "ঢাকা ঠিকানা", district: "ঢাকা",
    } as any);
    expect(res.wholesaleApplied).toBe(true);
    expect(res.subtotalMinor).toBe("400000");
    expect(prisma.order.rows[0].wholesaleBreakdown).toEqual([{ productId: "p-1", minQty: 10, priceMinor: "40000" }]);
  });
});
