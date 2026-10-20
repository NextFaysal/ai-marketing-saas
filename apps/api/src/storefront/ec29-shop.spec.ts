import { BadRequestException } from "@nestjs/common";
import { ApiException } from "../i18n";
import { StorefrontService } from "./storefront.service";
import { DiscountsService } from "../commerce/discounts.service";
import { PromotionsService } from "../commerce/promotions.service";
import { BundlesService } from "../commerce/bundles.service";

/** EC29 — shop bundles + gift + gift-wrap end to end (fake
 * harness in the ec8/ec18 style; REAL PromotionsService and
 * REAL BundlesService wired in, per the ec16-checkout harness
 * pattern). */

function matchWhere(row: any, where: any): boolean {
  for (const [k, v] of Object.entries(where ?? {})) {
    if (v === undefined) continue;
    if (k === "OR") {
      if (!(v as any[]).some((sub) => matchWhere(row, sub))) return false;
      continue;
    }
    if (v !== null && typeof v === "object" && !(v instanceof Date) && !Array.isArray(v)) {
      const cond: any = v;
      if ("in" in cond) {
        if (!cond.in.includes(row[k])) return false;
        continue;
      }
      if ("not" in cond) {
        if (row[k] === cond.not) return false;
        continue;
      }
      if ("gte" in cond || "lte" in cond) {
        if (row[k] === null || row[k] === undefined) return false;
        const t = new Date(row[k]).getTime();
        if ("gte" in cond && t < new Date(cond.gte).getTime()) return false;
        if ("lte" in cond && t > new Date(cond.lte).getTime()) return false;
        continue;
      }
      if ("contains" in cond) {
        const hay = String(row[k] ?? "");
        const hit = cond.mode === "insensitive"
          ? hay.toLowerCase().includes(String(cond.contains).toLowerCase())
          : hay.includes(String(cond.contains));
        if (!hit) return false;
        continue;
      }
      if (!matchWhere(row, cond)) return false;
    } else if (v === null) {
      if (row[k] !== null && row[k] !== undefined) return false;
    } else if (row[k] !== v) {
      return false;
    }
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
        const av = a[field];
        const bv = b[field];
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
    deliverySlot: makeTable(),
    storeCart: makeTable(),
    storeCartItem: makeTable(),
    storeCartBundle: makeTable(),
    bundle: makeTable(),
    order: makeTable(),
    orderItem: makeTable(),
    storeDiscount: makeTable(),
    promotion: makeTable(),
    customer: makeTable(),
    auditLog: makeTable(),
  } as any;
}

const T0 = new Date("2026-10-01T00:00:00Z");
const auditStub: any = { log: jest.fn(async () => undefined) };

function seed(prisma: any) {
  prisma.organization.rows.push({
    id: "org-1", slug: "shop-one", name: "Shop One", brandName: null, logoUrl: null,
    primaryColor: null, customDomain: null, createdAt: T0, updatedAt: T0,
  });
  prisma.storefrontSetting.rows.push({
    id: "set-1", organizationId: "org-1", shopEnabled: true, shopName: "Shop One",
    showFeatured: true, showCategories: true, showSearch: true,
    featuredProductIds: null, domainVerifyToken: null, domainVerifiedAt: null,
    referralDiscountPercent: null, referralMinSubtotalMinor: null,
    giftWrapEnabled: true, giftWrapFeeMinor: 5000n,
    createdAt: T0, updatedAt: T0,
  });
  prisma.product.rows.push(
    { id: "p-a", organizationId: "org-1", name: "ওয়ালেট", slug: "wallet", category: null, categoryId: null, sku: "WAL-1", status: "ACTIVE", priceMinor: 50000n, compareAtMinor: null, currency: "BDT", stockQuantity: 10, lowStockThreshold: null, imageUrl: null, bumpTitle: null, bumpPriceMinor: null, bumpImageUrl: null, preorderEnabled: false, digital: false, createdAt: T0, updatedAt: T0 },
    { id: "p-b", organizationId: "org-1", name: "ব্যাগ", slug: "bag", category: null, categoryId: null, sku: "BAG-1", status: "ACTIVE", priceMinor: 30000n, compareAtMinor: null, currency: "BDT", stockQuantity: 10, lowStockThreshold: null, imageUrl: null, bumpTitle: null, bumpPriceMinor: null, bumpImageUrl: null, preorderEnabled: false, digital: false, createdAt: T0, updatedAt: T0 },
    { id: "p-gift", organizationId: "org-1", name: "উপহার পণ্য", slug: "gift", category: null, categoryId: null, sku: "GFT-1", status: "ACTIVE", priceMinor: 5000n, compareAtMinor: null, currency: "BDT", stockQuantity: 10, lowStockThreshold: null, imageUrl: null, bumpTitle: null, bumpPriceMinor: null, bumpImageUrl: null, preorderEnabled: false, digital: false, createdAt: T0, updatedAt: T0 },
  );
  prisma.shippingZone.rows.push({
    id: "z-in", organizationId: "org-1", name: "ঢাকার ভিতরে", kind: "inside_dhaka",
    districts: null, chargeMinor: 6000n, deliveryDays: 1, freeAboveMinor: null,
    active: true, position: 0, createdAt: T0, updatedAt: T0,
  });
  prisma.bundle.rows.push({
    id: "b-1", organizationId: "org-1", name: "কম্বো সেট", description: "ওয়ালেট + ব্যাগ",
    imageUrl: null, bundlePriceMinor: 60000n, active: true, sortOrder: 0,
    items: [
      { productId: "p-a", variantSku: null, qty: 1 },
      { productId: "p-b", variantSku: null, qty: 1 },
    ],
    createdAt: T0, updatedAt: T0,
  });
}

function makeIntegrations(prisma: any) {
  let seq = 0;
  const captured: any[] = [];
  return {
    captured,
    upsertOrder: jest.fn(async (orgId: string, _storeId: any, payload: any, source: string) => {
      captured.push(payload);
      prisma.order.rows.push({
        id: `order-${++seq}`, organizationId: orgId, source,
        externalId: payload.externalId, externalNumber: payload.externalNumber,
        status: payload.status, totalMinor: payload.totalMinor,
        createdAt: new Date(), updatedAt: new Date(),
      });
      return "created";
    }),
  };
}

function makeShop(prisma: any) {
  const discounts = new DiscountsService(prisma, {} as any, auditStub);
  const promotions = new PromotionsService(prisma, discounts, auditStub);
  const bundles = new BundlesService(prisma, auditStub);
  const integrations = makeIntegrations(prisma);
  const svc = new StorefrontService(
    prisma, integrations as any, discounts as any, auditStub,
    undefined, undefined, promotions as any, bundles as any,
  );
  return { svc, integrations, promotions, bundles };
}

const CHECKOUT = {
  name: "Buyer", phone: "01711111111", address: "Dhaka address", district: "ঢাকা",
};

describe("EC29 shop — bundle cart + home payload", () => {
  it("bundle add/remove round-trips through serializeCart bundleItems; vanished bundle → null name + 0 prices", async () => {
    const prisma = makePrisma();
    seed(prisma);
    const { svc } = makeShop(prisma);
    const { cartToken } = await svc.createCart("shop-one");
    const added: any = await svc.patchCartBundle("shop-one", cartToken, { bundleId: "b-1", quantity: 2 } as any);
    expect(added.cart.bundleItems).toHaveLength(1);
    expect(added.cart.bundleItems[0]).toMatchObject({
      bundleId: "b-1", name: "কম্বো সেট", quantity: 2,
      bundlePriceMinor: "60000", lineTotalMinor: "120000",
    });
    expect(added.cart.bundleItems[0].components).toHaveLength(2);
    expect(added.cart.bundleItems[0].components[0]).toMatchObject({ productId: "p-a", name: "ওয়ালেট", qty: 1 });

    // Bundle deleted after being carted → honest vanished shape.
    prisma.bundle.rows.splice(0, prisma.bundle.rows.length);
    const vanished: any = await svc.getCart("shop-one", cartToken);
    expect(vanished.cart.bundleItems[0].name).toBeNull();
    expect(vanished.cart.bundleItems[0].bundlePriceMinor).toBe("0");
    expect(vanished.cart.bundleItems[0].lineTotalMinor).toBe("0");
    expect(vanished.cart.bundleItems[0].components).toEqual([]);

    const removed: any = await svc.patchCartBundle("shop-one", cartToken, { bundleId: "b-1", quantity: 0 } as any).catch(() => null);
    // The bundle row is gone, so removal 404s on lookup — restore it and remove cleanly.
    expect(removed).toBeNull();
    prisma.bundle.rows.push({
      id: "b-1", organizationId: "org-1", name: "কম্বো সেট", description: null, imageUrl: null,
      bundlePriceMinor: 60000n, active: true, sortOrder: 0,
      items: [{ productId: "p-a", variantSku: null, qty: 1 }, { productId: "p-b", variantSku: null, qty: 1 }],
      createdAt: T0, updatedAt: T0,
    });
    const afterRemove: any = await svc.patchCartBundle("shop-one", cartToken, { bundleId: "b-1", quantity: 0 } as any);
    expect(afterRemove.cart.bundleItems).toEqual([]);
  });

  it("inactive bundle cannot be added to the cart", async () => {
    const prisma = makePrisma();
    seed(prisma);
    prisma.bundle.rows[0].active = false;
    const { svc } = makeShop(prisma);
    const { cartToken } = await svc.createCart("shop-one");
    await expect(
      svc.patchCartBundle("shop-one", cartToken, { bundleId: "b-1", quantity: 1 } as any),
    ).rejects.toThrow(/পাওয়া যাচ্ছে না/);
  });

  it("shopHome bundles: savings null when bundlePrice ≥ regularTotal; inactive component excludes the bundle", async () => {
    const prisma = makePrisma();
    seed(prisma);
    const { svc } = makeShop(prisma);
    const home: any = await svc.shopHome("shop-one", {});
    expect(home.bundles).toHaveLength(1);
    expect(home.bundles[0]).toMatchObject({
      id: "b-1", bundlePriceMinor: "60000", regularTotalMinor: "80000", savingsMinor: "20000",
    });
    expect(home.bundles[0].components).toHaveLength(2);

    prisma.bundle.rows[0].bundlePriceMinor = 90000n; // above regular total
    const home2: any = await svc.shopHome("shop-one", {});
    expect(home2.bundles[0].savingsMinor).toBeNull();

    prisma.product.rows.find((p: any) => p.id === "p-b").status = "DRAFT";
    const home3: any = await svc.shopHome("shop-one", {});
    expect(home3.bundles).toEqual([]);
  });
});

describe("EC29 shop — bundle quote + checkout", () => {
  it("quote: merchandise subtotal is bundlePrice×qty EXACTLY plus the normal line; items carry bundle markers", async () => {
    const prisma = makePrisma();
    seed(prisma);
    const { svc } = makeShop(prisma);
    const { cartToken } = await svc.createCart("shop-one");
    await svc.patchCartLine("shop-one", cartToken, { productId: "p-a", quantity: 1 } as any);
    await svc.patchCartBundle("shop-one", cartToken, { bundleId: "b-1", quantity: 2 } as any);
    const q: any = await svc.quote("shop-one", { cartToken, district: "ঢাকা" } as any);
    // 50000 (normal) + 2 × 60000 (bundle) = 170000 exactly.
    expect(q.itemsSubtotalMinor).toBe("170000");
    expect(q.totalMinor).toBe("176000"); // + 6000 delivery, no discounts
    const bundleLines = q.items.filter((i: any) => i.bundleId === "b-1");
    expect(bundleLines).toHaveLength(2);
    expect(bundleLines.every((i: any) => i.bundleName === "কম্বো সেট")).toBe(true);
    const bundleLineSum = bundleLines.reduce((s: number, i: any) => s + Number(i.lineTotalMinor), 0);
    expect(bundleLineSum).toBe(120000);
    const normal = q.items.find((i: any) => i.bundleId === null);
    expect(normal.productId).toBe("p-a");
  });

  it("checkout: captured upsert items carry productId + bundle markers and totals sum exactly", async () => {
    const prisma = makePrisma();
    seed(prisma);
    const { svc, integrations } = makeShop(prisma);
    const { cartToken } = await svc.createCart("shop-one");
    await svc.patchCartBundle("shop-one", cartToken, { bundleId: "b-1", quantity: 1 } as any);
    const res: any = await svc.checkout("shop-one", { cartToken, ...CHECKOUT } as any);
    expect(res.totalMinor).toBe("66000"); // 60000 bundle + 6000 delivery
    expect(integrations.upsertOrder).toHaveBeenCalledTimes(1);
    const payload = integrations.captured[0];
    expect(payload.items).toHaveLength(2);
    for (const item of payload.items) {
      expect(item.productId).toBeTruthy();
      expect(item.bundleId).toBe("b-1");
      expect(item.bundleName).toBe("কম্বো সেট");
    }
    const itemsTotal = payload.items.reduce((s: bigint, i: any) => s + BigInt(i.totalMinor), 0n);
    expect(itemsTotal).toBe(60000n);
  });

  it("component out of stock → checkout 400 and upsertOrder is NEVER called", async () => {
    const prisma = makePrisma();
    seed(prisma);
    prisma.product.rows.find((p: any) => p.id === "p-b").stockQuantity = 0;
    const { svc, integrations } = makeShop(prisma);
    const { cartToken } = await svc.createCart("shop-one");
    await svc.patchCartBundle("shop-one", cartToken, { bundleId: "b-1", quantity: 1 } as any);
    await expect(
      svc.checkout("shop-one", { cartToken, ...CHECKOUT } as any),
    ).rejects.toBeInstanceOf(ApiException);
    expect(integrations.upsertOrder).not.toHaveBeenCalled();
  });
});

describe("EC29 shop — gift + gift wrap at checkout", () => {
  function seedGiftPromo(prisma: any) {
    prisma.promotion.rows.push({
      id: "pr-gift", organizationId: "org-1", name: "ফ্রি উপহার", type: "gift",
      config: { minSubtotalMinor: "40000", giftProductId: "p-gift", giftQty: 1 },
      startsAt: null, endsAt: null, active: true, priority: 0, createdBy: "u1",
      createdAt: T0, updatedAt: T0,
    });
  }

  it("gift applied: price-0 isGift line appended, outcome stamped on the order", async () => {
    const prisma = makePrisma();
    seed(prisma);
    seedGiftPromo(prisma);
    const { svc, integrations } = makeShop(prisma);
    const { cartToken } = await svc.createCart("shop-one");
    await svc.patchCartLine("shop-one", cartToken, { productId: "p-a", quantity: 1 } as any);
    const res: any = await svc.checkout("shop-one", { cartToken, ...CHECKOUT } as any);
    expect(res.gift).toEqual({ promotionName: "ফ্রি উপহার", productName: "উপহার পণ্য", quantity: 1 });
    expect(res.giftSkipped).toBe(false);
    const giftItem = integrations.captured[0].items.find((i: any) => i.isGift);
    expect(giftItem).toBeTruthy();
    expect(giftItem.productId).toBe("p-gift");
    expect(BigInt(giftItem.priceMinor)).toBe(0n);
    expect(BigInt(giftItem.totalMinor)).toBe(0n);
    const order = prisma.order.rows[0];
    expect(order.giftPromotionId).toBe("pr-gift");
    expect(order.giftSkipped).toBe(false);
  });

  it("gift out of stock: order succeeds WITHOUT the gift line, outcome skipped + stamped", async () => {
    const prisma = makePrisma();
    seed(prisma);
    seedGiftPromo(prisma);
    prisma.product.rows.find((p: any) => p.id === "p-gift").stockQuantity = 0;
    const { svc, integrations } = makeShop(prisma);
    const { cartToken } = await svc.createCart("shop-one");
    await svc.patchCartLine("shop-one", cartToken, { productId: "p-a", quantity: 1 } as any);
    const res: any = await svc.checkout("shop-one", { cartToken, ...CHECKOUT } as any);
    expect(res.success).toBe(true);
    expect(res.gift).toBeNull();
    expect(res.giftSkipped).toBe(true);
    expect(integrations.captured[0].items.some((i: any) => i.isGift)).toBe(false);
    const order = prisma.order.rows[0];
    expect(order.giftPromotionId).toBe("pr-gift");
    expect(order.giftSkipped).toBe(true);
  });

  it("wrap: enabled + fee + requested → total includes the fee exactly once and the order is stamped", async () => {
    const prisma = makePrisma();
    seed(prisma);
    const { svc } = makeShop(prisma);
    const { cartToken } = await svc.createCart("shop-one");
    await svc.patchCartLine("shop-one", cartToken, { productId: "p-a", quantity: 1 } as any);
    const res: any = await svc.checkout("shop-one", {
      cartToken, ...CHECKOUT, giftWrap: true, giftMessage: "শুভ জন্মদিন!",
    } as any);
    // 50000 + 6000 delivery + 5000 wrap = 61000.
    expect(res.totalMinor).toBe("61000");
    expect(res.giftWrapMinor).toBe("5000");
    const order = prisma.order.rows[0];
    expect(BigInt(order.giftWrapMinor)).toBe(5000n);
    expect(order.giftMessage).toBe("শুভ জন্মদিন!");
  });

  it("wrap requested but disabled in settings → fee 0 and no stamp", async () => {
    const prisma = makePrisma();
    seed(prisma);
    prisma.storefrontSetting.rows[0].giftWrapEnabled = false;
    const { svc } = makeShop(prisma);
    const { cartToken } = await svc.createCart("shop-one");
    await svc.patchCartLine("shop-one", cartToken, { productId: "p-a", quantity: 1 } as any);
    const res: any = await svc.checkout("shop-one", {
      cartToken, ...CHECKOUT, giftWrap: true, giftMessage: "hi",
    } as any);
    expect(res.totalMinor).toBe("56000");
    expect(res.giftWrapMinor).toBe("0");
    expect(prisma.order.rows[0].giftWrapMinor).toBeUndefined();
  });

  it("plain cart parity: no bundle/gift/wrap → totals unchanged, gift fields neutral", async () => {
    const prisma = makePrisma();
    seed(prisma);
    const { svc } = makeShop(prisma);
    const { cartToken } = await svc.createCart("shop-one");
    await svc.patchCartLine("shop-one", cartToken, { productId: "p-a", quantity: 2 } as any);
    const res: any = await svc.checkout("shop-one", { cartToken, ...CHECKOUT } as any);
    expect(res.subtotalMinor).toBe("100000");
    expect(res.discountMinor).toBe("0");
    expect(res.deliveryMinor).toBe("6000");
    expect(res.totalMinor).toBe("106000");
    expect(res.gift).toBeNull();
    expect(res.giftSkipped).toBe(false);
    expect(res.giftWrapMinor).toBe("0");
  });
});
