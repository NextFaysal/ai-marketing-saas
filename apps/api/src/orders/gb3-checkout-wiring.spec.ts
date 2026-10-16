import "reflect-metadata";
process.env.ENCRYPTION_KEY = Buffer.alloc(32, 7).toString("base64");

import { seal } from "../common/platform-config";
import { StorefrontService } from "../storefront/storefront.service";
import { ShopAccountService } from "../storefront/shop-account.service";
import { ProductsService } from "../products/products.service";
import { LandingsService } from "../landings/landings.service";
import { DiscountsService } from "../commerce/discounts.service";
import { PromotionsService } from "../commerce/promotions.service";
import { CheckoutGuardService } from "../fraud/checkout-guard.service";
import { IdentifierListsService } from "../fraud/identifier-lists.service";
import { FraudAttemptLogService } from "../fraud/fraud-attempt-log.service";
import { IdempotencyService } from "../fraud/idempotency.service";
import { OrdersService } from "./orders.service";
import { OrderInsightsService } from "./order-insights.service";
import { OrganizationsService } from "../organizations/organizations.service";

/**
 * GB3 (GC8 + GC9) — Builder B wiring: the fraud core wired into
 * the shop / single / landing checkouts (terms, gate, COD rules
 * parity, fraud-rule block, stamps, idempotency), the OTP gate,
 * the needs_confirmation union, the manual open-order warning
 * and the timeline fraud-rule source. Service-level fakes in the
 * ec8/ec29/gb2 style; the guard + idempotency services are REAL.
 */

// ---------- shared fake prisma ----------

function matchWhere(row: any, where: any): boolean {
  for (const [k, v] of Object.entries(where ?? {})) {
    if (v === undefined) continue;
    if (k === "OR") {
      if (!(v as any[]).some((sub) => matchWhere(row, sub))) return false;
      continue;
    }
    if (v !== null && typeof v === "object" && !(v instanceof Date) && !Array.isArray(v)) {
      const c: any = v;
      if ("in" in c) { if (!c.in.map(String).includes(String(row[k]))) return false; continue; }
      if ("notIn" in c) { if (c.notIn.map(String).includes(String(row[k]))) return false; continue; }
      if ("not" in c) { if (String(row[k]) === String(c.not)) return false; continue; }
      if ("gte" in c || "lte" in c) {
        if (row[k] == null) return false;
        const t = new Date(row[k]).getTime();
        if ("gte" in c && t < new Date(c.gte).getTime()) return false;
        if ("lte" in c && t > new Date(c.lte).getTime()) return false;
        continue;
      }
      if ("contains" in c) {
        const hay = String(row[k] ?? "");
        const hit = c.mode === "insensitive"
          ? hay.toLowerCase().includes(String(c.contains).toLowerCase())
          : hay.includes(String(c.contains));
        if (!hit) return false;
        continue;
      }
      if (!matchWhere(row, c)) return false;
    } else if (v === null) {
      if (row[k] !== null && row[k] !== undefined) return false;
    } else if (String(row[k]) !== String(v)) {
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
        const av = a[field]; const bv = b[field];
        if (av === bv) return 0;
        if (av == null) return 1;
        if (bv == null) return -1;
        const cmp = av instanceof Date || bv instanceof Date
          ? new Date(av).getTime() - new Date(bv).getTime()
          : av < bv ? -1 : 1;
        return dir === "desc" ? -cmp : cmp;
      });
    }
  }
  return out;
}

function makeTable(name = "t") {
  const rows: any[] = [];
  let seq = 0;
  return {
    rows,
    findFirst: async ({ where, orderBy }: any = {}) =>
      applyOrderBy(rows.filter((r) => matchWhere(r, where)), orderBy)[0] ?? null,
    findUnique: async ({ where }: any = {}) => rows.find((r) => matchWhere(r, where)) ?? null,
    findMany: async ({ where, orderBy, take, skip }: any = {}) => {
      let found = applyOrderBy(rows.filter((r) => matchWhere(r, where)), orderBy);
      if (skip) found = found.slice(skip);
      if (take !== undefined) found = found.slice(0, take);
      return found;
    },
    create: async ({ data }: any) => {
      const row = { id: data.id ?? `${name}-${++seq}`, createdAt: new Date(), updatedAt: new Date(), ...data };
      rows.push(row);
      return row;
    },
    update: async ({ where, data }: any) => {
      const row = rows.find((r) => matchWhere(r, where));
      if (!row) throw new Error("record not found");
      Object.assign(row, data);
      return row;
    },
    updateMany: async ({ where, data }: any) => {
      let count = 0;
      for (const row of rows) if (matchWhere(row, where)) { Object.assign(row, data); count++; }
      return { count };
    },
    count: async ({ where }: any = {}) => rows.filter((r) => matchWhere(r, where)).length,
    delete: async ({ where }: any) => {
      const idx = rows.findIndex((r) => matchWhere(r, where));
      if (idx < 0) throw new Error("record not found");
      return rows.splice(idx, 1)[0];
    },
    upsert: async ({ where, create, update }: any) => {
      const row = rows.find((r) => matchWhere(r, where));
      if (row) { Object.assign(row, update); return row; }
      const created = { id: `${name}-${++seq}`, createdAt: new Date(), updatedAt: new Date(), ...create };
      rows.push(created);
      return created;
    },
  };
}

/** Idempotency table with the REAL unique(org, key) constraint. */
function makeIdempotencyTable() {
  const table = makeTable("idem");
  const baseCreate = table.create;
  table.create = async ({ data }: any) => {
    if (table.rows.some((r: any) => r.organizationId === data.organizationId && r.key === data.key)) {
      const e: any = new Error("Unique constraint failed on the fields: (organizationId, key)");
      e.code = "P2002";
      throw e;
    }
    return baseCreate({ data });
  };
  return table;
}

function baseTables() {
  return {
    organization: makeTable("org"),
    storefrontSetting: makeTable("set"),
    businessProfile: makeTable("bp"),
    shopPage: makeTable("page"),
    fraudShieldSetting: makeTable("fss"),
    blockedIdentifier: makeTable("bi"),
    trustedIdentifier: makeTable("ti"),
    fraudAttemptLog: makeTable("fal"),
    fraudRule: makeTable("fr"),
    fraudRuleHit: makeTable("frh"),
    customer: makeTable("cust"),
    order: makeTable("ord"),
    idempotencyRecord: makeIdempotencyTable(),
  } as any;
}

const T0 = new Date("2026-10-01T00:00:00Z");
const auditStub: any = { log: jest.fn(async () => undefined) };

const COD_PROFILE = {
  codMaxOrderMinor: 100000n,
  codBlockedDistricts: ["Khulna"],
  codAdvanceRequiredAboveMinor: 50000n,
};

function makeGuard(prisma: any, turnstile?: any) {
  const identifiers = new IdentifierListsService(prisma, auditStub);
  const attempts = new FraudAttemptLogService(prisma);
  const ts = turnstile ?? { verify: jest.fn(async () => ({ ok: true, providerError: false })) };
  return new CheckoutGuardService(prisma, identifiers, attempts, ts as any);
}

function makeIntegrations(prisma: any, source0?: string) {
  let seq = 0;
  const captured: any[] = [];
  return {
    captured,
    upsertOrder: jest.fn(async (orgId: string, _s: any, payload: any, source: string) => {
      captured.push(payload);
      prisma.order.rows.push({
        id: `order-${++seq}`, organizationId: orgId, source,
        externalId: payload.externalId, externalNumber: payload.externalNumber,
        status: payload.status, totalMinor: payload.totalMinor,
        isCod: payload.isCod, isPractice: false,
        createdAt: new Date(), updatedAt: new Date(),
      });
      return "created";
    }),
  };
}

// ---------- SHOP world ----------

function makeShopWorld(opts: { termsRequired?: boolean; captcha?: boolean } = {}) {
  const prisma: any = {
    ...baseTables(),
    category: makeTable("cat"),
    product: makeTable("p"),
    productVariant: makeTable("pv"),
    productImage: makeTable("pi"),
    shippingZone: makeTable("z"),
    deliverySlot: makeTable("slot"),
    storeCart: makeTable("cart"),
    storeCartItem: makeTable("ci"),
    storeCartBundle: makeTable("cb"),
    bundle: makeTable("b"),
    orderItem: makeTable("oi"),
    storeDiscount: makeTable("disc"),
    promotion: makeTable("promo"),
    auditLog: makeTable("al"),
  };
  prisma.organization.rows.push({
    id: "org-1", slug: "shop-one", name: "Shop One", brandName: null, logoUrl: null,
    primaryColor: null, customDomain: null, createdAt: T0, updatedAt: T0,
  });
  prisma.storefrontSetting.rows.push({
    id: "set-1", organizationId: "org-1", shopEnabled: true, shopName: "Shop One",
    showFeatured: true, showCategories: true, showSearch: true,
    featuredProductIds: null, domainVerifyToken: null, domainVerifiedAt: null,
    giftWrapEnabled: false, giftWrapFeeMinor: null,
    requireTermsConsent: opts.termsRequired === true,
    termsUrl: null,
    createdAt: T0, updatedAt: T0,
  });
  prisma.businessProfile.rows.push({
    id: "bp-1", organizationId: "org-1", codAvailable: true,
    deliveryChargeInsideMinor: 6000n, deliveryChargeOutsideMinor: 12000n,
    bkashNumber: null, nagadNumber: null, paymentNote: null,
    ...COD_PROFILE,
    createdAt: T0, updatedAt: T0,
  });
  prisma.shopPage.rows.push({
    id: "page-terms", organizationId: "org-1", slug: "terms", title: "শর্তাবলি",
    blocks: [], published: true, showInFooter: true, showInMenu: false, sortOrder: 0,
    isSystem: true, createdAt: T0, updatedAt: T0,
  });
  prisma.product.rows.push(
    { id: "p-50", organizationId: "org-1", name: "পণ্য ৫০০", slug: "p50", category: null, categoryId: null, sku: "P50", status: "ACTIVE", priceMinor: 50000n, compareAtMinor: null, currency: "BDT", stockQuantity: 20, lowStockThreshold: null, imageUrl: null, bumpTitle: null, bumpPriceMinor: null, bumpImageUrl: null, preorderEnabled: false, digital: false, createdAt: T0, updatedAt: T0 },
    { id: "p-74", organizationId: "org-1", name: "পণ্য ৭৪০", slug: "p74", category: null, categoryId: null, sku: "P74", status: "ACTIVE", priceMinor: 74000n, compareAtMinor: null, currency: "BDT", stockQuantity: 20, lowStockThreshold: null, imageUrl: null, bumpTitle: null, bumpPriceMinor: null, bumpImageUrl: null, preorderEnabled: false, digital: false, createdAt: T0, updatedAt: T0 },
    { id: "p-34", organizationId: "org-1", name: "পণ্য ৩৪০", slug: "p34", category: null, categoryId: null, sku: "P34", status: "ACTIVE", priceMinor: 34000n, compareAtMinor: null, currency: "BDT", stockQuantity: 20, lowStockThreshold: null, imageUrl: null, bumpTitle: null, bumpPriceMinor: null, bumpImageUrl: null, preorderEnabled: false, digital: false, createdAt: T0, updatedAt: T0 },
  );
  prisma.shippingZone.rows.push({
    id: "z-all", organizationId: "org-1", name: "সব জায়গায়", kind: "all",
    districts: null, chargeMinor: 6000n, deliveryDays: 2, freeAboveMinor: null,
    active: true, position: 0, createdAt: T0, updatedAt: T0,
  });
  if (opts.captcha) {
    prisma.fraudShieldSetting.rows.push({
      id: "fss-1", organizationId: "org-1", enabled: true,
      openOrderPolicy: "off", openOrderWindowHours: 72, waitingPeriodMinutes: 0,
      maxOrdersPerPhonePerDay: 0, captchaEnabled: true, captchaOnCheckout: true,
      captchaOnOtp: true, turnstileSiteKey: "site-1", turnstileSecretEncrypted: seal("s3cret"),
      createdAt: T0, updatedAt: T0,
    });
  }
  const discounts = new DiscountsService(prisma, {} as any, auditStub);
  const promotions = new PromotionsService(prisma, discounts, auditStub);
  const integrations = makeIntegrations(prisma);
  const guard = makeGuard(prisma);
  const idempotency = new IdempotencyService(prisma);
  const svc = new StorefrontService(
    prisma, integrations as any, discounts as any, auditStub,
    undefined, undefined, promotions as any, undefined,
    undefined, undefined, undefined, undefined, undefined,
    guard as any, idempotency as any,
  );
  return { prisma, svc, integrations, guard, idempotency };
}

const SHOP_DTO = {
  name: "Buyer", phone: "01711111111", address: "House 1, Dhaka", district: "ঢাকা",
};

async function shopCartWith(svc: StorefrontService, productId: string, quantity: number) {
  const { cartToken } = await svc.createCart("shop-one");
  await svc.patchCartLine("shop-one", cartToken, { productId, quantity } as any);
  return cartToken;
}

// ---------- SINGLE world ----------

function makeSingleWorld(opts: { termsRequired?: boolean } = {}) {
  const prisma: any = {
    ...baseTables(),
    product: makeTable("p"),
    productVariant: makeTable("pv"),
    promotion: makeTable("promo"),
    storeDiscount: makeTable("disc"),
    deliverySlot: makeTable("slot"),
    category: makeTable("cat"),
  };
  prisma.product.rows.push({
    id: "p-1", organizationId: "org-1", name: "প্রিমিয়াম পণ্য", slug: "prod-one",
    sku: "P-1", status: "ACTIVE", priceMinor: 100000n, compareAtMinor: null,
    categoryId: null, currency: "BDT", stockQuantity: null, preorderEnabled: false,
    digital: false, bumpTitle: null, bumpPriceMinor: null, variants: [],
    organization: {
      id: "org-1", name: "Shop One",
      businessProfile: {
        deliveryChargeInsideMinor: 6000n, deliveryChargeOutsideMinor: 12000n,
        codAvailable: true, bkashNumber: null, nagadNumber: null, paymentNote: null,
        ...COD_PROFILE,
      },
    },
    createdAt: T0, updatedAt: T0,
  });
  prisma.storefrontSetting.rows.push({
    id: "set-1", organizationId: "org-1", shopEnabled: true,
    giftWrapEnabled: false, giftWrapFeeMinor: null,
    requireTermsConsent: opts.termsRequired === true, termsUrl: null,
    createdAt: T0, updatedAt: T0,
  });
  prisma.shopPage.rows.push({
    id: "page-terms", organizationId: "org-1", slug: "terms", title: "শর্তাবলি",
    blocks: [], published: true, showInFooter: true, showInMenu: false, sortOrder: 0,
    isSystem: true, createdAt: T0, updatedAt: T0,
  });
  const discounts = new DiscountsService(prisma, {} as any, auditStub);
  const promotions = new PromotionsService(prisma, discounts, auditStub);
  const integrations = makeIntegrations(prisma);
  const guard = makeGuard(prisma);
  const idempotency = new IdempotencyService(prisma);
  const products = new ProductsService(
    prisma, auditStub, undefined, integrations as any, undefined,
    discounts as any, promotions as any, undefined, undefined,
    guard as any, idempotency as any,
  );
  return { prisma, products, integrations, guard, idempotency };
}

const SINGLE_DTO = {
  customerName: "Buyer", customerPhone: "01711111111", customerAddress: "House 1, Dhaka",
  quantity: 1, deliveryZone: "inside_dhaka",
};

function setSinglePrice(prisma: any, minor: bigint) {
  prisma.product.rows[0].priceMinor = minor;
}

// ---------- LANDING world ----------

function makeLandingWorld() {
  const prisma: any = {
    ...baseTables(),
    product: makeTable("p"),
    productVariant: makeTable("pv"),
    productImage: makeTable("pi"),
    shippingZone: makeTable("z"),
    landingPage: makeTable("lp"),
    landingVariant: makeTable("lv"),
    landingEvent: makeTable("le"),
    orderItem: makeTable("oi"),
    deliverySlot: makeTable("slot"),
  };
  prisma.organization.rows.push({ id: "org-1", slug: "shop-one", name: "Shop One" });
  prisma.businessProfile.rows.push({
    id: "bp-1", organizationId: "org-1", codAvailable: true,
    deliveryChargeInsideMinor: null, deliveryChargeOutsideMinor: null,
    metaPixelId: null, tikTokPixelId: null,
    ...COD_PROFILE,
    createdAt: T0, updatedAt: T0,
  });
  prisma.storefrontSetting.rows.push({
    id: "set-1", organizationId: "org-1", shopEnabled: true,
    requireTermsConsent: false, termsUrl: null,
    returnPolicyText: null, deliveryPromiseText: null, supportPhone: null,
    createdAt: T0, updatedAt: T0,
  });
  prisma.product.rows.push({
    id: "p-a", organizationId: "org-1", name: "লেদার ওয়ালেট", slug: "leather-wallet",
    description: null, category: null, categoryId: null, sku: "WAL-1", status: "ACTIVE",
    priceMinor: 50000n, compareAtMinor: null, currency: "BDT", stockQuantity: 20,
    lowStockThreshold: null, imageUrl: null, bumpTitle: null, bumpPriceMinor: null,
    bumpImageUrl: null, preorderEnabled: false, digital: false,
    createdAt: T0, updatedAt: T0,
  });
  prisma.landingPage.rows.push({
    id: "land-1", organizationId: "org-1", productId: "p-a", slug: "wallet-offer",
    title: "ওয়ালেট অফার", status: "published", sections: null, upsellProductId: null,
    createdAt: T0, updatedAt: T0,
  });
  const integrations = makeIntegrations(prisma);
  const guard = makeGuard(prisma);
  const idempotency = new IdempotencyService(prisma);
  const svc = new LandingsService(
    prisma, auditStub, undefined, undefined, integrations as any, undefined,
    null, undefined, undefined, undefined, guard as any, idempotency as any,
  );
  return { prisma, svc, integrations, guard, idempotency };
}

const LANDING_DTO = {
  customerName: "Buyer", customerPhone: "01711111111", customerAddress: "House 1, Dhaka",
  quantity: 1,
};

// ================= SHOP: terms =================

describe("GB3 wiring — shop terms consent", () => {
  it("required + missing acceptance → 400 and upsertOrder NOT called", async () => {
    const { svc, integrations } = makeShopWorld({ termsRequired: true });
    const cartToken = await shopCartWith(svc, "p-50", 1);
    await expect(
      svc.checkout("shop-one", { cartToken, ...SHOP_DTO } as any),
    ).rejects.toThrow("অর্ডার সম্পূর্ণ করতে শর্তাবলি পড়ে সম্মতি দেওয়া বাধ্যতামূলক");
    expect(integrations.upsertOrder).not.toHaveBeenCalled();
  });

  it("required + accepted → order stamped with termsConsentedAt + page:terms@ ref", async () => {
    const { prisma, svc } = makeShopWorld({ termsRequired: true });
    const cartToken = await shopCartWith(svc, "p-50", 1);
    const res: any = await svc.checkout("shop-one", { cartToken, ...SHOP_DTO, termsAccepted: true } as any);
    expect(res.success).toBe(true);
    const order = prisma.order.rows[0];
    expect(order.termsConsentedAt).toBeInstanceOf(Date);
    expect(String(order.termsRef)).toContain("page:terms@");
    expect(String(order.termsRef)).toBe("page:terms@2026-10-01T00:00:00.000Z");
  });

  it("disabled → succeeds without termsAccepted and no terms stamp", async () => {
    const { prisma, svc } = makeShopWorld();
    const cartToken = await shopCartWith(svc, "p-50", 1);
    const res: any = await svc.checkout("shop-one", { cartToken, ...SHOP_DTO } as any);
    expect(res.success).toBe(true);
    expect(prisma.order.rows[0].termsConsentedAt).toBeUndefined();
  });
});

// ================= Idempotency =================

describe("GB3 wiring — idempotency", () => {
  it("single: same key twice → upsertOrder ONCE, both responses deep-equal", async () => {
    const { prisma, products, integrations } = makeSingleWorld();
    setSinglePrice(prisma, 34000n); // total 40000 — under every COD threshold
    const dto = { ...SINGLE_DTO, idempotencyKey: "key-abc" };
    const first: any = await products.placePublicOrder("prod-one", dto as any);
    const second: any = await products.placePublicOrder("prod-one", dto as any);
    expect(integrations.upsertOrder).toHaveBeenCalledTimes(1);
    expect(second).toEqual(first);
    expect(prisma.idempotencyRecord.rows).toHaveLength(1);
    expect(prisma.idempotencyRecord.rows[0].scope).toBe("single");
  });

  it("a first attempt that fails validation (terms missing) does NOT burn the key", async () => {
    const { prisma, products, integrations } = makeSingleWorld({ termsRequired: true });
    setSinglePrice(prisma, 34000n);
    await expect(
      products.placePublicOrder("prod-one", { ...SINGLE_DTO, idempotencyKey: "key-terms" } as any),
    ).rejects.toThrow("অর্ডার সম্পূর্ণ করতে শর্তাবলি পড়ে সম্মতি দেওয়া বাধ্যতামূলক");
    expect(prisma.idempotencyRecord.rows).toHaveLength(0);
    expect(integrations.upsertOrder).not.toHaveBeenCalled();
    const ok: any = await products.placePublicOrder(
      "prod-one", { ...SINGLE_DTO, idempotencyKey: "key-terms", termsAccepted: true } as any,
    );
    expect(ok.success).toBe(true);
    expect(integrations.upsertOrder).toHaveBeenCalledTimes(1);
    expect(prisma.idempotencyRecord.rows).toHaveLength(1);
  });

  it("IdempotencyService race: P2002 on create returns the WINNER's stored response; other errors return the caller's", async () => {
    const winner = { success: true, orderNumber: "winner" };
    const prisma: any = {
      idempotencyRecord: {
        findFirst: jest.fn(async () => ({ id: "idem-1", organizationId: "org-1", key: "k", responseJson: winner })),
        create: jest.fn(async () => {
          const e: any = new Error("Unique constraint failed");
          e.code = "P2002";
          throw e;
        }),
      },
    };
    const svc = new IdempotencyService(prisma);
    await expect(svc.record("org-1", "k", "shop", "o-1", { success: true, orderNumber: "loser" }))
      .resolves.toEqual(winner);
    await expect(svc.findReplay("org-1", "k")).resolves.toEqual(winner);

    const broken: any = {
      idempotencyRecord: {
        findFirst: jest.fn(async () => { throw new Error("db down"); }),
        create: jest.fn(async () => { throw new Error("db down"); }),
      },
    };
    const svc2 = new IdempotencyService(broken);
    await expect(svc2.findReplay("org-1", "k")).resolves.toBeNull();
    await expect(svc2.record("org-1", "k", "shop", null, { ok: 1 })).resolves.toEqual({ ok: 1 });
  });

  it("shop: same key twice → second checkout replays even though the cart is converted", async () => {
    const { svc, integrations } = makeShopWorld();
    const cartToken = await shopCartWith(svc, "p-34", 1);
    const dto = { cartToken, ...SHOP_DTO, idempotencyKey: "shop-key-1" };
    const first: any = await svc.checkout("shop-one", dto as any);
    const second: any = await svc.checkout("shop-one", dto as any);
    expect(integrations.upsertOrder).toHaveBeenCalledTimes(1);
    expect(second).toEqual(first);
  });
});

// ================= COD parity across the three paths =================

describe("GB3 wiring — COD rules parity (shop / single / landing)", () => {
  const COD_MSG = "দুঃখিত, এই অর্ডারের জন্য ক্যাশ অন ডেলিভারি প্রযোজ্য নয়";

  it("(i) COD total above the max (150000+) → all three refuse with the COD message", async () => {
    // Shop: 3 × 50000 + 6000 delivery = 156000.
    const shop = makeShopWorld();
    const cartToken = await shopCartWith(shop.svc, "p-50", 3);
    await expect(shop.svc.checkout("shop-one", { cartToken, ...SHOP_DTO } as any)).rejects.toThrow(COD_MSG);
    expect(shop.integrations.upsertOrder).not.toHaveBeenCalled();

    // Single: 1 × 100000 + 6000 = 106000.
    const single = makeSingleWorld();
    await expect(single.products.placePublicOrder("prod-one", { ...SINGLE_DTO } as any)).rejects.toThrow(COD_MSG);
    expect(single.integrations.upsertOrder).not.toHaveBeenCalled();

    // Landing: 3 × 50000 + 6000 = 156000.
    const landing = makeLandingWorld();
    await expect(
      landing.svc.placeOrder("wallet-offer", { ...LANDING_DTO, quantity: 3 } as any),
    ).rejects.toThrow(COD_MSG);
    expect(landing.integrations.upsertOrder).not.toHaveBeenCalled();
  });

  it("(ii) blocked district Khulna → refuse (structured on shop + landing; parsed on single)", async () => {
    const shop = makeShopWorld();
    const cartToken = await shopCartWith(shop.svc, "p-50", 1);
    await expect(
      shop.svc.checkout("shop-one", { cartToken, ...SHOP_DTO, district: "Khulna" } as any),
    ).rejects.toThrow(COD_MSG);
    expect(shop.integrations.upsertOrder).not.toHaveBeenCalled();

    const landing = makeLandingWorld();
    await expect(
      landing.svc.placeOrder("wallet-offer", { ...LANDING_DTO, district: "Khulna" } as any),
    ).rejects.toThrow(COD_MSG);
    expect(landing.integrations.upsertOrder).not.toHaveBeenCalled();

    // Single: the address text parses to Khulna (Sonadanga thana
    // pins Khulna; the district word makes it high confidence).
    const single = makeSingleWorld();
    setSinglePrice(single.prisma, 34000n);
    await expect(
      single.products.placePublicOrder(
        "prod-one", { ...SINGLE_DTO, customerAddress: "House 1, Sonadanga, Khulna" } as any,
      ),
    ).rejects.toThrow(COD_MSG);
    expect(single.integrations.upsertOrder).not.toHaveBeenCalled();
  });

  it("(iii) COD total 80000 → all three succeed and stamp codAdvanceRequired=true", async () => {
    // Shop: 74000 + 6000 = 80000.
    const shop = makeShopWorld();
    const cartToken = await shopCartWith(shop.svc, "p-74", 1);
    const shopRes: any = await shop.svc.checkout("shop-one", { cartToken, ...SHOP_DTO } as any);
    expect(shopRes.totalMinor).toBe("80000");
    expect(shop.prisma.order.rows[0].codAdvanceRequired).toBe(true);

    // Single: price set so total = 74000 + 6000 = 80000.
    const single = makeSingleWorld();
    setSinglePrice(single.prisma, 74000n);
    const singleRes: any = await single.products.placePublicOrder("prod-one", { ...SINGLE_DTO } as any);
    expect(singleRes.totalMinor).toBe("80000");
    expect(single.prisma.order.rows[0].codAdvanceRequired).toBe(true);

    // Landing: price set so total = 74000 + 6000 = 80000.
    const landing = makeLandingWorld();
    landing.prisma.product.rows[0].priceMinor = 74000n;
    const landingRes: any = await landing.svc.placeOrder("wallet-offer", { ...LANDING_DTO } as any);
    expect(landingRes.totals.totalMinor).toBe("80000");
    expect(landing.prisma.order.rows[0].codAdvanceRequired).toBe(true);
  });

  it("(iv) COD total 40000 → all three succeed with NO advance stamp", async () => {
    const shop = makeShopWorld();
    const cartToken = await shopCartWith(shop.svc, "p-34", 1);
    const shopRes: any = await shop.svc.checkout("shop-one", { cartToken, ...SHOP_DTO } as any);
    expect(shopRes.totalMinor).toBe("40000");
    expect(shop.prisma.order.rows[0].codAdvanceRequired).toBeFalsy();

    const single = makeSingleWorld();
    setSinglePrice(single.prisma, 34000n);
    const singleRes: any = await single.products.placePublicOrder("prod-one", { ...SINGLE_DTO } as any);
    expect(singleRes.totalMinor).toBe("40000");
    expect(single.prisma.order.rows[0].codAdvanceRequired).toBeFalsy();

    const landing = makeLandingWorld();
    landing.prisma.product.rows[0].priceMinor = 34000n;
    const landingRes: any = await landing.svc.placeOrder("wallet-offer", { ...LANDING_DTO } as any);
    expect(landingRes.totals.totalMinor).toBe("40000");
    expect(landing.prisma.order.rows[0].codAdvanceRequired).toBeFalsy();
  });
});

// ================= Fraud-rule block at checkout =================

describe("GB3 wiring — fraud rules block at checkout (shop)", () => {
  it("a block_checkout rule over the total refuses with the generic message; hit + attempt rows written by the guard", async () => {
    const { prisma, svc, integrations } = makeShopWorld();
    prisma.fraudRule.rows.push({
      id: "r-1", organizationId: "org-1", name: "সব বড় অর্ডার ব্লক", enabled: true,
      conditions: { minTotalMinor: "1000" }, action: "block_checkout", tagValue: null,
      createdAt: T0, updatedAt: T0,
    });
    const cartToken = await shopCartWith(svc, "p-50", 1);
    await expect(
      svc.checkout("shop-one", { cartToken, ...SHOP_DTO } as any),
    ).rejects.toThrow("দুঃখিত, এই মুহূর্তে অর্ডারটি নেওয়া যাচ্ছে না");
    expect(integrations.upsertOrder).not.toHaveBeenCalled();
    expect(prisma.fraudRuleHit.rows).toHaveLength(1);
    expect(prisma.fraudRuleHit.rows[0].action).toBe("block_checkout");
    expect(prisma.fraudAttemptLog.rows).toHaveLength(1);
    expect(prisma.fraudAttemptLog.rows[0].kind).toBe("fraud_rule");
  });
});

// ================= OTP gate =================

describe("GB3 wiring — OTP gate", () => {
  it("captcha enabled for OTP + no token → requestOtp refuses BEFORE generating a code (no OTP row, no SMS)", async () => {
    const prisma: any = {
      ...baseTables(),
      shopOtpChallenge: makeTable("otp"),
      shopSession: makeTable("sess"),
      customerAddress: makeTable("addr"),
      wishlistItem: makeTable("wl"),
      messagingSenderConfig: makeTable("msg"),
    };
    prisma.organization.rows.push({ id: "org-1", slug: "shop-one", name: "Shop One" });
    prisma.storefrontSetting.rows.push({
      id: "set-1", organizationId: "org-1", shopEnabled: true, shopName: "Shop One",
      createdAt: T0, updatedAt: T0,
    });
    prisma.fraudShieldSetting.rows.push({
      id: "fss-1", organizationId: "org-1", enabled: true,
      openOrderPolicy: "off", openOrderWindowHours: 72, waitingPeriodMinutes: 0,
      maxOrdersPerPhonePerDay: 0, captchaEnabled: true, captchaOnCheckout: true,
      captchaOnOtp: true, turnstileSiteKey: "site-1", turnstileSecretEncrypted: seal("s3cret"),
      createdAt: T0, updatedAt: T0,
    });
    const sms: any = {
      isConfigured: () => true,
      send: jest.fn(async () => ({ providerMessageId: "m-1" })),
      sendWithGateway: jest.fn(async () => ({ providerMessageId: "m-2" })),
    };
    const turnstile = { verify: jest.fn(async () => ({ ok: false, providerError: false })) };
    const guard = makeGuard(prisma, turnstile);
    const accounts = new ShopAccountService(prisma, sms as any, guard as any);
    await expect(
      accounts.requestOtp("shop-one", "01711111111", { captchaToken: null, ip: null }),
    ).rejects.toThrow("নিরাপত্তা যাচাই ব্যর্থ হয়েছে — আবার চেষ্টা করুন");
    expect(prisma.shopOtpChallenge.rows).toHaveLength(0);
    expect(sms.send).not.toHaveBeenCalled();
    expect(sms.sendWithGateway).not.toHaveBeenCalled();
    expect(prisma.fraudAttemptLog.rows).toHaveLength(1);
    expect(prisma.fraudAttemptLog.rows[0].kind).toBe("captcha");
  });
});

// ================= Payload shapes =================

describe("GB3 wiring — checkoutTrust payload shapes", () => {
  it("shopHome settings.checkoutTrust carries terms/captcha/cod; quote carries codRules", async () => {
    const { svc } = makeShopWorld({ captcha: true });
    const home: any = await svc.shopHome("shop-one", {});
    expect(home.settings.checkoutTrust).toEqual({
      termsRequired: false,
      termsRef: "page:terms@2026-10-01T00:00:00.000Z",
      termsUrl: null,
      termsPage: true,
      captcha: { checkoutEnabled: true, otpEnabled: true, siteKey: "site-1" },
      cod: { maxOrderMinor: "100000", advanceAboveMinor: "50000" },
      // AB4 (AX5a): the deposit config rides checkoutTrust too
      // (this world's profile configures no deposit).
      deposit: { mode: null, percent: null, fixedMinor: null, appliesTo: "cod", note: null },
    });
    const cartToken = await shopCartWith(svc, "p-74", 1);
    const q: any = await svc.quote("shop-one", { cartToken, district: "ঢাকা" } as any);
    expect(q.codRules).toEqual({
      maxOrderMinor: "100000",
      advanceAboveMinor: "50000",
      unavailableForTotal: false,
      advanceRequiredForTotal: true,
    });
  });

  it("single getPublicProduct checkoutTrust has otpEnabled=false", async () => {
    const { products } = makeSingleWorld();
    const info: any = await products.getPublicProductBySlug("prod-one");
    expect(info.checkoutTrust).toEqual({
      termsRequired: false,
      termsRef: "page:terms@2026-10-01T00:00:00.000Z",
      termsUrl: null,
      termsPage: true,
      captcha: { checkoutEnabled: false, otpEnabled: false, siteKey: null },
      cod: { maxOrderMinor: "100000", advanceAboveMinor: "50000" },
      // AB4 (AX5a): deposit config (unset in this world).
      deposit: { mode: null, percent: null, fixedMinor: null, appliesTo: "cod", note: null },
    });
  });

  it("landing getPublicLanding carries the same checkoutTrust shape", async () => {
    const { svc } = makeLandingWorld();
    const payload: any = await svc.getPublicLanding("wallet-offer");
    expect(payload.checkoutTrust.cod).toEqual({ maxOrderMinor: "100000", advanceAboveMinor: "50000" });
    expect(payload.checkoutTrust.captcha).toEqual({ checkoutEnabled: false, otpEnabled: false, siteKey: null });
    expect(payload.checkoutTrust.termsRequired).toBe(false);
  });
});

// ================= Orders: queue union / manual warning / timeline =================

describe("GB3 wiring — orders surfaces", () => {
  function makeOrderTableWorld() {
    const prisma: any = { order: makeTable("ord"), customer: makeTable("cust") };
    return prisma;
  }

  it("needs_confirmation unions codAdvanceRequired orders (awaiting first, deduped)", async () => {
    const prisma = makeOrderTableWorld();
    prisma.order.rows.push(
      { id: "o-await", organizationId: "org-1", isPractice: false, isCod: true, codConfirmationStatus: "awaiting", codAdvanceRequired: false, status: "pending", placedAt: new Date("2026-10-10T00:00:00Z"), createdAt: T0 },
      { id: "o-adv", organizationId: "org-1", isPractice: false, isCod: true, codConfirmationStatus: null, codAdvanceRequired: true, status: "processing", placedAt: new Date("2026-10-09T00:00:00Z"), createdAt: T0 },
      { id: "o-both", organizationId: "org-1", isPractice: false, isCod: true, codConfirmationStatus: "awaiting", codAdvanceRequired: true, status: "on-hold", placedAt: new Date("2026-10-08T00:00:00Z"), createdAt: T0 },
      { id: "o-adv-done", organizationId: "org-1", isPractice: false, isCod: true, codConfirmationStatus: null, codAdvanceRequired: true, status: "completed", placedAt: new Date("2026-10-07T00:00:00Z"), createdAt: T0 },
      { id: "o-adv-practice", organizationId: "org-1", isPractice: true, isCod: true, codConfirmationStatus: null, codAdvanceRequired: true, status: "pending", placedAt: new Date("2026-10-07T00:00:00Z"), createdAt: T0 },
    );
    const svc = new OrdersService(prisma, undefined, undefined, auditStub as any);
    const ids = await svc.resolveQueueOrderIds("org-1", "needs_confirmation");
    expect(ids).toEqual(["o-await", "o-both", "o-adv"]);
  });

  it("createManual warns when another open order exists for the phone", async () => {
    const prisma: any = {
      ...baseTables(),
      orderItem: makeTable("oi"),
    };
    prisma.customer.rows.push({ id: "c-1", organizationId: "org-1", phone: "01711111111", firstName: "Buyer" });
    prisma.order.rows.push({
      id: "o-old", organizationId: "org-1", source: "manual", externalId: "old-1",
      customerId: "c-1", status: "pending", isPractice: false, isCod: true,
      totalMinor: 1000n, createdAt: new Date(), placedAt: new Date(),
    });
    const integrations: any = {
      upsertOrder: jest.fn(async (orgId: string, _s: any, payload: any, source: string) => {
        prisma.order.rows.push({
          id: "o-new", organizationId: orgId, source, externalId: payload.externalId,
          customerId: "c-1", status: payload.status, isPractice: false, isCod: true,
          totalMinor: payload.totalMinor, subtotalMinor: payload.subtotalMinor,
          shippingMinor: payload.shippingMinor, discountMinor: payload.discountMinor,
          taxMinor: 0n, refundedMinor: 0n, createdAt: new Date(), placedAt: new Date(),
          customer: { id: "c-1", phone: "01711111111", firstName: "Buyer", address: null },
          items: [],
        });
        return "created";
      }),
    };
    const guard = makeGuard(prisma);
    const svc = new OrdersService(
      prisma, undefined, integrations as any, auditStub as any,
      undefined, undefined, undefined, undefined, guard as any,
    );
    const res: any = await svc.createManual("org-1", "actor-1", {
      customerName: "Buyer", customerPhone: "01711111111",
      items: [{ name: "পণ্য", unitPriceMinor: "1000", quantity: 1 }],
    } as any);
    const warning = (res.warnings ?? []).find((w: any) => w.key === "open_order_exists");
    expect(warning).toBeTruthy();
    expect(warning.label).toBe("এই নম্বরে আরও 1টি খোলা অর্ডার আছে");
  });

  it("timeline carries the fraud_rule source with the rule name + action label", async () => {
    const prisma: any = {
      order: makeTable("ord"),
      fraudRuleHit: makeTable("frh"),
      fraudRule: makeTable("fr"),
    };
    prisma.order.rows.push({
      id: "o-1", organizationId: "org-1", source: "manual", status: "processing",
      placedAt: T0, createdAt: T0,
    });
    prisma.fraudRule.rows.push({ id: "r-1", organizationId: "org-1", name: "বড় অর্ডার যাচাই" });
    prisma.fraudRuleHit.rows.push({
      id: "h-1", organizationId: "org-1", orderId: "o-1", ruleId: "r-1", action: "hold",
      createdAt: new Date("2026-10-02T00:00:00Z"),
    });
    const svc = new OrderInsightsService(prisma, auditStub as any);
    const res: any = await svc.timeline("org-1", "o-1");
    const entry = res.entries.find((e: any) => e.kind === "fraud_rule");
    expect(entry).toBeTruthy();
    expect(entry.title).toBe("জালিয়াতি নিয়ম: বড় অর্ডার যাচাই");
    expect(entry.detail).toBe("অর্ডার আটকানো হয়েছে");
  });
});

// ================= Organizations: COD profile fields =================

describe("GB3 wiring — organizations COD profile", () => {
  it("updateBusinessProfile stores money as BigInt + trimmed districts; profileJson returns strings", async () => {
    const prisma: any = { businessProfile: makeTable("bp") };
    const svc = new OrganizationsService(prisma, auditStub as any);
    const out: any = await svc.updateBusinessProfile("org-1", "actor-1", {
      codMaxOrderMinor: 100000,
      codAdvanceRequiredAboveMinor: 50000,
      codBlockedDistricts: [" Khulna ", "Dhaka"],
    } as any);
    expect(out.codMaxOrderMinor).toBe("100000");
    expect(out.codAdvanceRequiredAboveMinor).toBe("50000");
    expect(out.codBlockedDistricts).toEqual(["Khulna", "Dhaka"]);
    const stored = prisma.businessProfile.rows[0];
    expect(stored.codMaxOrderMinor).toBe(100000n);
    // Empty array clears to null.
    const out2: any = await svc.updateBusinessProfile("org-1", "actor-1", { codBlockedDistricts: [] } as any);
    expect(out2.codBlockedDistricts).toBeNull();
    // Oversize entry is a Bengali 400.
    await expect(
      svc.updateBusinessProfile("org-1", "actor-1", { codBlockedDistricts: ["x".repeat(101)] } as any),
    ).rejects.toThrow(/জেলার নাম/);
  });
});
