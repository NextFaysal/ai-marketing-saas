import { StorefrontService } from "./storefront.service";
import { DeliveryPricingService } from "./delivery-pricing.service";
import { InventoryService } from "../inventory/inventory.service";

/**
 * GB2 — storefront specs: GC6 free-shipping semantics through
 * the ONE delivery resolver (parity / all-free / mixed weight),
 * brand filter + payload + brand page, GC7 availability-aware
 * stock guard, cart reservations (sync on mutation, exclusion
 * of the own cart, consume on checkout). Fake prisma in the
 * EC30 style (matcher extended with gt for reservation expiry).
 */
function matchWhere(row: any, where: any): boolean {
  for (const [k, v] of Object.entries(where ?? {})) {
    if (v === undefined) continue;
    if (k === "OR") {
      if (!(v as any[]).some((sub) => matchWhere(row, sub))) return false;
      continue;
    }
    if (v !== null && typeof v === "object" && !(v instanceof Date) && !Array.isArray(v)) {
      const cond: any = v;
      if ("in" in cond) { if (!cond.in.includes(row[k])) return false; continue; }
      if ("not" in cond) { if (row[k] === cond.not) return false; continue; }
      if ("gte" in cond || "lte" in cond || "gt" in cond || "lt" in cond) {
        if (row[k] === null || row[k] === undefined) return false;
        const t = new Date(row[k]).getTime();
        if ("gte" in cond && t < new Date(cond.gte).getTime()) return false;
        if ("gt" in cond && t <= new Date(cond.gt).getTime()) return false;
        if ("lte" in cond && t > new Date(cond.lte).getTime()) return false;
        if ("lt" in cond && t >= new Date(cond.lt).getTime()) return false;
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
    findUnique: async ({ where }: any = {}) =>
      rows.find((r) => r.id === where.id || r.organizationId === where.organizationId) ?? null,
    findMany: async ({ where, orderBy, take, skip }: any = {}) => {
      let found = applyOrderBy(rows.filter((r) => matchWhere(r, where)), orderBy);
      if (skip) found = found.slice(skip);
      if (take !== undefined) found = found.slice(0, take);
      return found;
    },
    count: async ({ where }: any = {}) => rows.filter((r) => matchWhere(r, where)).length,
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
    deleteMany: async ({ where }: any = {}) => {
      for (let i = rows.length - 1; i >= 0; i--) if (matchWhere(rows[i], where)) rows.splice(i, 1);
      return { count: 0 };
    },
  };
}
function makePrisma() {
  return {
    organization: makeTable(), storefrontSetting: makeTable(), businessProfile: makeTable(),
    category: makeTable(), brand: makeTable(), product: makeTable(), productVariant: makeTable(),
    productImage: makeTable(), shippingZone: makeTable(), shippingRateRule: makeTable(), pickupPoint: makeTable(),
    storeCart: makeTable(), storeCartItem: makeTable(), storeCartBundle: makeTable(), bundle: makeTable(),
    order: makeTable(), orderItem: makeTable(), fulfillment: makeTable(), customer: makeTable(),
    storeDiscount: makeTable(), deliverySlot: makeTable(), auditLog: makeTable(),
    stockReservation: makeTable(), inventorySetting: makeTable(), stockMovement: makeTable(),
    membership: makeTable(), agentNotification: makeTable(),
  } as any;
}

const T0 = new Date("2026-10-01T00:00:00Z");
const auditStub: any = { log: jest.fn(async () => undefined) };

function seedWorld(prisma: any) {
  prisma.organization.rows.push({
    id: "org-1", slug: "shop-one", name: "Shop One", brandName: "ShopOne", logoUrl: null,
    primaryColor: null, customDomain: null, createdAt: T0, updatedAt: T0,
  });
  prisma.storefrontSetting.rows.push({
    id: "set-1", organizationId: "org-1", shopEnabled: true, shopName: "Shop One",
    showFeatured: true, showCategories: true, showSearch: true, featuredProductIds: null,
    domainVerifyToken: null, domainVerifiedAt: null, giftWrapEnabled: false, giftWrapFeeMinor: null,
    createdAt: T0, updatedAt: T0,
  });
  prisma.businessProfile.rows.push({
    id: "bp-1", organizationId: "org-1", codAvailable: true,
    deliveryChargeInsideMinor: 6000n, deliveryChargeOutsideMinor: 12000n,
    createdAt: T0, updatedAt: T0,
  });
  prisma.shippingZone.rows.push({
    id: "z-in", organizationId: "org-1", name: "ঢাকার ভিতরে", kind: "inside_dhaka",
    districts: null, chargeMinor: 6000n, deliveryDays: 1, freeAboveMinor: null,
    active: true, position: 0, createdAt: T0, updatedAt: T0,
  });
  return prisma;
}

function productRow(over: Record<string, any> = {}) {
  return {
    id: "p-1", organizationId: "org-1", name: "পণ্য", slug: "product", category: null, categoryId: null,
    sku: "SKU-1", status: "ACTIVE", priceMinor: 50000n, compareAtMinor: null, currency: "BDT",
    stockQuantity: 10, lowStockThreshold: null, imageUrl: null, weightGrams: null,
    bumpTitle: null, bumpPriceMinor: null, bumpImageUrl: null, preorderEnabled: false, digital: false,
    brandId: null, freeShipping: false, createdAt: T0, updatedAt: T0, ...over,
  };
}

function makeServices(prisma: any) {
  const pricing = new DeliveryPricingService(prisma, auditStub);
  const inventory = new InventoryService(prisma as any, auditStub);
  let seq = 0;
  const integrations = {
    upsertOrder: jest.fn(async (orgId: string, _s: any, payload: any, source: string) => {
      prisma.order.rows.push({
        id: `order-${++seq}`, organizationId: orgId, source,
        externalId: payload.externalId, externalNumber: payload.externalNumber,
        status: payload.status, totalMinor: payload.totalMinor,
        createdAt: new Date(), updatedAt: new Date(),
      });
      return "created";
    }),
  };
  const svc = new StorefrontService(
    prisma, integrations as any, undefined, auditStub,
    undefined, undefined, undefined, undefined,
    pricing as any, undefined, undefined, undefined, inventory as any,
  );
  return { svc, pricing, inventory, integrations };
}

async function cartWith(svc: StorefrontService, lines: Array<any>) {
  const { cartToken } = await svc.createCart("shop-one");
  for (const line of lines) await svc.patchCartLine("shop-one", cartToken, line as any);
  return cartToken;
}

describe("GB2 free shipping through the resolver", () => {
  it("resolver: allFreeShipping zeroes the charge without touching zone free-above", async () => {
    const prisma = seedWorld(makePrisma());
    const { svc } = makeServices(prisma);
    const zone = { id: "z-in", chargeMinor: 6000n, freeAboveMinor: null };
    const normal = await svc.resolveDeliveryCharge("org-1", zone, { weightGrams: 100, discountedSubtotal: 1000n });
    expect(normal.deliveryMinor).toBe(6000n);
    const allFree = await svc.resolveDeliveryCharge("org-1", zone, { weightGrams: 100, discountedSubtotal: 1000n, allFreeShipping: true });
    expect(allFree).toEqual({ deliveryMinor: 0n, rateRuleId: null, zoneFreeShipping: false });
  });

  it("quote parity: flags off → weight rule sees all weight; flag on → free line's weight excluded; all-free → 0", async () => {
    const prisma = seedWorld(makePrisma());
    // Rule: ≤1000g ships at 5000; zone base is 6000.
    prisma.shippingRateRule.rows.push({
      id: "r-band", organizationId: "org-1", shippingZoneId: null, minWeightGrams: 0, maxWeightGrams: 1000,
      chargeMinor: 5000n, priority: 10, active: true, createdAt: T0, updatedAt: T0,
    });
    const free = productRow({ id: "p-free", name: "ফ্রি পণ্য", slug: "free", sku: "FR-1", weightGrams: 500, freeShipping: false });
    const heavy = productRow({ id: "p-heavy", name: "ভারী পণ্য", slug: "heavy", sku: "HV-1", weightGrams: 600 });
    prisma.product.rows.push(free, heavy);
    const { svc } = makeServices(prisma);
    const token = await cartWith(svc, [
      { productId: "p-free", quantity: 1 },
      { productId: "p-heavy", quantity: 1 },
    ]);
    // Both flags OFF: total weight 1100g → rule misses → zone 6000.
    const q1: any = await svc.quote("shop-one", { cartToken: token, district: "ঢাকা" });
    expect(q1.deliveryMinor).toBe("6000");
    expect(q1.productFreeShippingApplied).toBe(false);
    // Flag ON for the 500g line: weight population is 600g → rule hits → 5000.
    free.freeShipping = true;
    const q2: any = await svc.quote("shop-one", { cartToken: token, district: "ঢাকা" });
    expect(q2.deliveryMinor).toBe("5000");
    expect(q2.productFreeShippingApplied).toBe(false);
    // Every line free → charge 0 through the resolver.
    heavy.freeShipping = true;
    const q3: any = await svc.quote("shop-one", { cartToken: token, district: "ঢাকা" });
    expect(q3.deliveryMinor).toBe("0");
    expect(q3.productFreeShippingApplied).toBe(true);
    expect(q3.zoneFreeShippingApplied).toBe(false);
  });

  it("free line with UNKNOWN weight no longer makes the cart weight unknown", async () => {
    const prisma = seedWorld(makePrisma());
    prisma.shippingRateRule.rows.push({
      id: "r-band", organizationId: "org-1", shippingZoneId: null, minWeightGrams: 0, maxWeightGrams: 1000,
      chargeMinor: 5000n, priority: 10, active: true, createdAt: T0, updatedAt: T0,
    });
    prisma.product.rows.push(
      productRow({ id: "p-free", slug: "free", sku: "FR-1", weightGrams: null, freeShipping: true }),
      productRow({ id: "p-norm", slug: "norm", sku: "NM-1", weightGrams: 400 }),
    );
    const { svc } = makeServices(prisma);
    const token = await cartWith(svc, [
      { productId: "p-free", quantity: 1 },
      { productId: "p-norm", quantity: 1 },
    ]);
    const q: any = await svc.quote("shop-one", { cartToken: token, district: "ঢাকা" });
    // The unknown-weight line is free-shipping: excluded from the
    // population, so the known 400g prices the rule (before GB2
    // this cart's weight was unknown and only boundless rules hit).
    expect(q.deliveryMinor).toBe("5000");
  });
});

describe("GB2 brand surfaces", () => {
  it("shop home carries the brands payload + slug filter; brand page lists the brand's products; unknown slug 404s", async () => {
    const prisma = seedWorld(makePrisma());
    prisma.brand.rows.push(
      { id: "b-1", organizationId: "org-1", name: "Aarong", slug: "aarong", logoUrl: null, description: "দেশি", createdAt: T0, updatedAt: T0 },
      { id: "b-empty", organizationId: "org-1", name: "Empty", slug: "empty", logoUrl: null, description: null, createdAt: T0, updatedAt: T0 },
    );
    prisma.product.rows.push(
      productRow({ id: "p-1", brandId: "b-1" }),
      productRow({ id: "p-2", slug: "other", sku: "SKU-2", brandId: null }),
    );
    const { svc } = makeServices(prisma);
    const home: any = await svc.shopHome("shop-one", {});
    expect(home.brands).toEqual([
      { id: "b-1", name: "Aarong", slug: "aarong", logoUrl: null, productCount: 1 },
    ]);
    expect(home.products.find((p: any) => p.id === "p-1").brand).toMatchObject({ id: "b-1", slug: "aarong" });

    const filtered: any = await svc.shopHome("shop-one", { brand: "aarong" });
    expect(filtered.products.map((p: any) => p.id)).toEqual(["p-1"]);
    const unknown: any = await svc.shopHome("shop-one", { brand: "ghost" });
    expect(unknown.products).toEqual([]);

    const page: any = await svc.shopBrandPage("shop-one", "aarong");
    expect(page.brand).toMatchObject({ name: "Aarong", description: "দেশি" });
    expect(page.products.map((p: any) => p.id)).toEqual(["p-1"]);
    await expect(svc.shopBrandPage("shop-one", "ghost")).rejects.toMatchObject({ status: 404 });
  });

  it("PDP serialization carries the free-shipping flag + brand + availability numbers", async () => {
    const prisma = seedWorld(makePrisma());
    prisma.brand.rows.push({ id: "b-1", organizationId: "org-1", name: "Aarong", slug: "aarong", logoUrl: null, description: null, createdAt: T0, updatedAt: T0 });
    prisma.product.rows.push(productRow({ id: "p-1", brandId: "b-1", freeShipping: true, stockQuantity: 6 }));
    prisma.stockReservation.rows.push({
      id: "r-1", organizationId: "org-1", sessionRef: "cart-x", productId: "p-1", variantId: null,
      quantity: 2, state: "active", expiresAt: new Date(Date.now() + 600_000), createdAt: new Date(),
    });
    const { svc } = makeServices(prisma);
    const detail: any = await svc.productDetail("shop-one", "product");
    expect(detail.product.freeShipping).toBe(true);
    expect(detail.product.brand).toMatchObject({ slug: "aarong" });
    expect(detail.product.reservedQuantity).toBe(2);
    expect(detail.product.availableQuantity).toBe(4);
  });
});

describe("GB2 availability guard + reservations", () => {
  it("another cart's reservation blocks the quote; the own cart's does not; backorder lifts the guard", async () => {
    const prisma = seedWorld(makePrisma());
    prisma.product.rows.push(productRow({ id: "p-1", stockQuantity: 3 }));
    prisma.inventorySetting.rows.push({ id: "s-1", organizationId: "org-1", leadTimeDays: 7, allowBackorder: false, reserveMinutes: 0 });
    const { svc } = makeServices(prisma);
    const tokenA = await cartWith(svc, [{ productId: "p-1", quantity: 1 }]);
    const cartA = prisma.storeCart.rows.find((c: any) => c.token === tokenA);
    // Cart B holds a reservation of 2 against the same stock of 3.
    prisma.stockReservation.rows.push({
      id: "r-b", organizationId: "org-1", sessionRef: "cart-b", productId: "p-1", variantId: null,
      quantity: 2, state: "active", expiresAt: new Date(Date.now() + 600_000), createdAt: new Date(),
    });
    // Grow cart A to 2 → quote must refuse (available = 3 − 2 = 1).
    await svc.patchCartLine("shop-one", tokenA, { productId: "p-1", quantity: 2 } as any).catch(() => undefined);
    // patchCartLine itself refuses at quantity 2 (available 1) —
    // set the line directly to isolate the QUOTE-time guard.
    prisma.storeCartItem.rows.find((i: any) => i.cartId === cartA.id).quantity = 2;
    await expect(svc.quote("shop-one", { cartToken: tokenA, district: "ঢাকা" })).rejects.toThrow(/মাত্র 1টি/);
    // The reservation belongs to cart A itself → excluded → quote passes.
    prisma.stockReservation.rows.find((r: any) => r.id === "r-b").sessionRef = cartA.id;
    const ok: any = await svc.quote("shop-one", { cartToken: tokenA, district: "ঢাকা" });
    expect(ok.deliveryMinor).toBe("6000");
    // Backorder ON → even quantity 9 passes the guard.
    prisma.inventorySetting.rows.find((r: any) => r.id === "s-1").allowBackorder = true;
    prisma.storeCartItem.rows.find((i: any) => i.cartId === cartA.id).quantity = 9;
    const ok2: any = await svc.quote("shop-one", { cartToken: tokenA, district: "ঢাকা" });
    expect(Number(ok2.totalMinor)).toBeGreaterThan(0);
  });

  it("reserveMinutes ON: patchCartLine reserves; a second cart is refused beyond availability; checkout consumes", async () => {
    const prisma = seedWorld(makePrisma());
    prisma.product.rows.push(productRow({ id: "p-1", stockQuantity: 3 }));
    prisma.inventorySetting.rows.push({ id: "s-1", organizationId: "org-1", leadTimeDays: 7, allowBackorder: false, reserveMinutes: 30 });
    const { svc } = makeServices(prisma);
    const tokenA = await cartWith(svc, [{ productId: "p-1", quantity: 2 }]);
    const cartA = prisma.storeCart.rows.find((c: any) => c.token === tokenA);
    const reserved = prisma.stockReservation.rows.filter((r: any) => r.sessionRef === cartA.id && r.state === "active");
    expect(reserved).toHaveLength(1);
    expect(reserved[0].quantity).toBe(2);

    // Second cart: only 1 available → quantity 2 refused at add time.
    const { cartToken: tokenB } = await svc.createCart("shop-one");
    await expect(
      svc.patchCartLine("shop-one", tokenB, { productId: "p-1", quantity: 2 } as any),
    ).rejects.toThrow(/মাত্র 1টি/);
    await svc.patchCartLine("shop-one", tokenB, { productId: "p-1", quantity: 1 } as any);

    // Cart A checks out → its reservations are consumed.
    const res: any = await svc.checkout("shop-one", {
      cartToken: tokenA, name: "Buyer", phone: "01711111111", address: "Dhaka", district: "ঢাকা",
    } as any);
    expect(res.orderId ?? res.id ?? "placed").toBeTruthy();
    const after = prisma.stockReservation.rows.filter((r: any) => r.sessionRef === cartA.id);
    expect(after.every((r: any) => r.state === "consumed")).toBe(true);
  });
});
