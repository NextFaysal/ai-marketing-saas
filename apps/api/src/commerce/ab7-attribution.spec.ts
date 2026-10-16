import "reflect-metadata";
import { plainToInstance } from "class-transformer";
import { validate } from "class-validator";
import {
  AttributionDto,
  CLICK_ID_TYPES,
  hasAttribution,
  normalizeAttribution,
} from "../common/attribution.dto";
import { CheckoutDto, ExpressCheckoutDto } from "../storefront/storefront.dto";
import { PublicCheckoutOrderDto } from "../products/products.dto";
import { LandingOrderDto } from "../landings/landings.dto";
import { StorefrontService } from "../storefront/storefront.service";
import { hashShopSecret } from "../storefront/shop-auth.util";
import { ProductsService } from "../products/products.service";
import { DiscountsService } from "./discounts.service";
import { PromotionsService } from "./promotions.service";
import { LandingsService } from "../landings/landings.service";
import { InventoryService } from "../inventory/inventory.service";
import { IntegrationsService } from "../integrations/integrations.service";
import { CommerceAnalyticsService } from "./commerce-analytics.service";
import { OrdersService } from "../orders/orders.service";

/**
 * AB7 (AX19) — order-level attribution stamps.
 *
 * Covered here:
 *  - normalizeAttribution: trims, drops empty/whitespace values
 *    to ABSENT keys, drops an out-of-vocabulary clickIdType;
 *  - DTO validation (the codebase's plainToInstance + validate
 *    approach): a bad clickIdType / over-long UTM value is
 *    rejected on AttributionDto itself AND nested inside the
 *    shop / express / single-product (+ inherited landing)
 *    checkout DTOs;
 *  - the placement chokes: shop checkout, express checkout
 *    (forwards into shop checkout), single-product checkout
 *    (ProductsService.placePublicOrder) and landing checkout
 *    (LandingsService.placeOrder) each pass the normalized
 *    block into IntegrationsService.upsertOrder's payload —
 *    asserted via the capturing integrations doubles used by
 *    the neighbouring specs (ab4 / ec29 / landings harnesses);
 *  - the REAL upsertOrder: stamps land on the Order row on the
 *    CREATE branch only; absent attribution writes NO keys
 *    (columns stay null); a re-upsert never rewrites stamps;
 *  - the staff serializer (pubOrder via OrdersService.list):
 *    utmSource + clickIdType ride list rows, null when
 *    untracked;
 *  - CommerceAnalyticsService.sourceBreakdown: sold-only
 *    (REVENUE_EXCLUDED_STATUSES), Dhaka-day window, null
 *    sources grouped under "সরাসরি/অজানা", revenue as
 *    BigInt-safe strings, totals withClickId / stampedOrders.
 */

const ATTR_KEYS = [
  "utmSource", "utmMedium", "utmCampaign", "utmContent", "utmTerm", "clickIdType", "clickId",
] as const;

function expectNoAttributionKeys(payload: any) {
  for (const k of ATTR_KEYS) expect(k in payload).toBe(false);
}

// ---------- shared fake-prisma (house style) ----------

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
    updateMany: async ({ where, data }: any) => {
      let count = 0;
      for (const row of rows) if (matchWhere(row, where)) { Object.assign(row, data); count++; }
      return { count };
    },
    delete: async ({ where }: any) => {
      const idx = rows.findIndex((r) => matchWhere(r, where));
      if (idx < 0) throw new Error("record not found");
      return rows.splice(idx, 1)[0];
    },
    deleteMany: async ({ where }: any = {}) => {
      const before = rows.length;
      for (let i = rows.length - 1; i >= 0; i--) {
        if (matchWhere(rows[i], where)) rows.splice(i, 1);
      }
      return { count: before - rows.length };
    },
  };
}

// ---------- 1. normalizer ----------

describe("AB7 normalizeAttribution", () => {
  it("trims values and passes the full block through", () => {
    const out = normalizeAttribution({
      utmSource: "  facebook ", utmMedium: "cpc", utmCampaign: " eid-sale ",
      utmContent: "video-1", utmTerm: "wallet", clickIdType: "fbclid", clickId: " IwAR123 ",
    });
    expect(out).toEqual({
      utmSource: "facebook", utmMedium: "cpc", utmCampaign: "eid-sale",
      utmContent: "video-1", utmTerm: "wallet", clickIdType: "fbclid", clickId: "IwAR123",
    });
    expect(hasAttribution(out)).toBe(true);
  });

  it("drops empty / whitespace-only strings to ABSENT keys", () => {
    const out = normalizeAttribution({ utmSource: "   ", utmMedium: "", utmCampaign: "sale" });
    expect(out).toEqual({ utmCampaign: "sale" });
    expect("utmSource" in out).toBe(false);
    expect("utmMedium" in out).toBe(false);
  });

  it("undefined / null / empty input → {} (no keys at all)", () => {
    expect(normalizeAttribution(undefined)).toEqual({});
    expect(normalizeAttribution(null)).toEqual({});
    expect(normalizeAttribution({})).toEqual({});
    expect(hasAttribution(normalizeAttribution(undefined))).toBe(false);
  });

  it("drops an out-of-vocabulary clickIdType but keeps the clickId", () => {
    expect(normalizeAttribution({ clickIdType: "ref" as any, clickId: "x-1" })).toEqual({ clickId: "x-1" });
    for (const t of CLICK_ID_TYPES) {
      expect(normalizeAttribution({ clickIdType: t }).clickIdType).toBe(t);
    }
  });
});

// ---------- 2. DTO validation ----------

describe("AB7 AttributionDto validation", () => {
  it("accepts a valid block; rejects a bad clickIdType and over-long values", async () => {
    const good = plainToInstance(AttributionDto, {
      utmSource: "facebook", utmMedium: "cpc", clickIdType: "gclid", clickId: "abc",
    });
    expect(await validate(good)).toHaveLength(0);

    const badType = plainToInstance(AttributionDto, { clickIdType: "ref" });
    const typeErrors = await validate(badType);
    expect(typeErrors.map((e) => e.property)).toContain("clickIdType");

    const tooLong = plainToInstance(AttributionDto, { utmSource: "x".repeat(201) });
    expect((await validate(tooLong)).map((e) => e.property)).toContain("utmSource");

    const tooLongClick = plainToInstance(AttributionDto, { clickId: "x".repeat(501) });
    expect((await validate(tooLongClick)).map((e) => e.property)).toContain("clickId");
  });

  it("nested attribution is validated inside the checkout DTOs", async () => {
    const nestedError = async (dto: any) => {
      const errors = await validate(dto);
      return errors.find((e) => e.property === "attribution");
    };
    const bad = { attribution: { clickIdType: "snapclid" } };
    expect(await nestedError(plainToInstance(CheckoutDto, bad))).toBeDefined();
    expect(await nestedError(plainToInstance(ExpressCheckoutDto, bad))).toBeDefined();
    expect(await nestedError(plainToInstance(PublicCheckoutOrderDto, bad))).toBeDefined();
    // LandingOrderDto INHERITS the field from PublicCheckoutOrderDto.
    expect(await nestedError(plainToInstance(LandingOrderDto, bad))).toBeDefined();

    const ok = { attribution: { utmSource: "tiktok", clickIdType: "ttclid", clickId: "tt-1" } };
    expect(await nestedError(plainToInstance(CheckoutDto, ok))).toBeUndefined();
    expect(await nestedError(plainToInstance(PublicCheckoutOrderDto, ok))).toBeUndefined();
    expect(await nestedError(plainToInstance(LandingOrderDto, ok))).toBeUndefined();
  });
});

// ---------- 3a. shop + express checkout chokes (ab4 harness) ----------

function makeShopPrisma() {
  return {
    organization: makeTable(), storefrontSetting: makeTable(), businessProfile: makeTable(),
    category: makeTable(), brand: makeTable(), product: makeTable(), productVariant: makeTable(),
    productImage: makeTable(), shippingZone: makeTable(), storeCart: makeTable(), storeCartItem: makeTable(),
    storeCartBundle: makeTable(), bundle: makeTable(), order: makeTable(), orderItem: makeTable(),
    fulfillment: makeTable(), deliverySlot: makeTable(), shopPage: makeTable(), customer: makeTable(),
    checkoutFieldDef: makeTable(), customerAddress: makeTable(), shopSession: makeTable(),
  } as any;
}

function seedShop(prisma: any) {
  prisma.organization.rows.push(
    { id: "org-1", slug: "shop-one", name: "Shop One Ltd", brandName: "ShopOne", logoUrl: null, primaryColor: null, customDomain: null },
  );
  prisma.storefrontSetting.rows.push({
    id: "set-1", organizationId: "org-1", shopEnabled: true, shopName: null, announcementText: null,
    showFeatured: true, showCategories: true, showSearch: true, metaDescription: null,
    featuredProductIds: null, domainVerifyToken: null, domainVerifiedAt: null,
  });
  prisma.product.rows.push({
    id: "p-a", organizationId: "org-1", name: "ওয়ালেট", slug: "wallet", description: null, category: null,
    categoryId: null, sku: "WAL-1", status: "ACTIVE", priceMinor: 50000n, compareAtMinor: null, currency: "BDT",
    stockQuantity: 10, lowStockThreshold: null, imageUrl: null, bumpTitle: null, bumpPriceMinor: null,
    bumpImageUrl: null, seoTitle: null, seoDescription: null, createdAt: new Date(), updatedAt: new Date(),
  });
  prisma.shippingZone.rows.push({
    id: "z-all", organizationId: "org-1", name: "সব জায়গায়", kind: "all", districts: null,
    chargeMinor: 6000n, deliveryDays: 2, freeAboveMinor: null, active: true, position: 0,
    createdAt: new Date(), updatedAt: new Date(),
  });
  prisma.businessProfile.rows.push({
    id: "bp-1", organizationId: "org-1", codAvailable: true, bkashNumber: null, nagadNumber: null, paymentNote: null,
  });
}

function makeStorefront(prisma: any) {
  const placed: any[] = [];
  const integrations = {
    upsertOrder: jest.fn(async (orgId: string, _s: any, o: any, source: string) => {
      placed.push(o);
      await prisma.order.create({
        data: {
          organizationId: orgId, source, externalId: o.externalId, externalNumber: o.externalNumber,
          status: o.status, paymentMethod: o.paymentMethod, isCod: o.isCod, totalMinor: o.totalMinor,
        },
      });
      return "created";
    }),
  };
  const svc = new StorefrontService(
    prisma, integrations as any, undefined, undefined, undefined, undefined,
    undefined, undefined, undefined, undefined, undefined, undefined,
    undefined, undefined, undefined, undefined,
  );
  return { svc, integrations, placed };
}

async function cartReady(svc: StorefrontService) {
  const { cartToken } = await svc.createCart("shop-one");
  await svc.patchCartLine("shop-one", cartToken, { productId: "p-a", quantity: 1 });
  return cartToken;
}
const shopDto = (cartToken: string, over: Record<string, any> = {}) => ({
  cartToken, name: "রহিম", phone: "01711111111", address: "বাড়ি ১, রোড ২", district: "ঢাকা", ...over,
});

describe("AB7 shop checkout choke", () => {
  it("stamps the normalized attribution onto the order create payload", async () => {
    const prisma = makeShopPrisma(); seedShop(prisma);
    const { svc, placed } = makeStorefront(prisma);
    const token = await cartReady(svc);
    await svc.checkout("shop-one", shopDto(token, {
      attribution: {
        utmSource: "  facebook ", utmMedium: "cpc", utmCampaign: "eid",
        clickIdType: "fbclid", clickId: " IwAR-9 ",
        utmContent: "   ", // whitespace-only → dropped
      },
    }) as any);
    expect(placed).toHaveLength(1);
    expect(placed[0].utmSource).toBe("facebook");
    expect(placed[0].utmMedium).toBe("cpc");
    expect(placed[0].utmCampaign).toBe("eid");
    expect(placed[0].clickIdType).toBe("fbclid");
    expect(placed[0].clickId).toBe("IwAR-9");
    expect("utmContent" in placed[0]).toBe(false);
    expect("utmTerm" in placed[0]).toBe(false);
  });

  it("absent attribution → the create payload has NO attribution keys", async () => {
    const prisma = makeShopPrisma(); seedShop(prisma);
    const { svc, placed } = makeStorefront(prisma);
    const token = await cartReady(svc);
    await svc.checkout("shop-one", shopDto(token) as any);
    expect(placed).toHaveLength(1);
    expectNoAttributionKeys(placed[0]);
  });

  it("express checkout forwards its attribution block into placement", async () => {
    const prisma = makeShopPrisma(); seedShop(prisma);
    prisma.customer.rows.push({
      id: "cust-1", organizationId: "org-1", phone: "01711111111", firstName: "রহিম",
      mergedIntoId: null, createdAt: new Date(), updatedAt: new Date(),
    });
    prisma.shopSession.rows.push({
      id: "sess-1", organizationId: "org-1", customerId: "cust-1",
      tokenHash: hashShopSecret("tok-1"),
      expiresAt: new Date(Date.now() + 3600 * 1000), revokedAt: null,
      createdAt: new Date(), updatedAt: new Date(),
    });
    prisma.customerAddress.rows.push({
      id: "addr-1", organizationId: "org-1", customerId: "cust-1",
      recipientName: "রহিম উদ্দিন", phone: "01711111111",
      addressLine: "বাড়ি ১, রোড ২", district: "ঢাকা", isDefault: true,
      createdAt: new Date(), updatedAt: new Date(),
    });
    const { svc, placed } = makeStorefront(prisma);
    const token = await cartReady(svc);
    await svc.expressCheckout("shop-one", "tok-1", {
      cartToken: token,
      attribution: { utmSource: "google", clickIdType: "gclid", clickId: "g-77" },
    } as any);
    expect(placed).toHaveLength(1);
    expect(placed[0].utmSource).toBe("google");
    expect(placed[0].clickIdType).toBe("gclid");
    expect(placed[0].clickId).toBe("g-77");
  });
});

// ---------- 3b. the REAL upsertOrder create choke ----------

describe("AB7 IntegrationsService.upsertOrder stamping", () => {
  function fakePrisma() {
    return {
      product: makeTable(), productVariant: makeTable(), customer: makeTable(),
      order: makeTable(), orderItem: makeTable(), store: makeTable(),
      integration: makeTable(), syncJob: makeTable(),
      integrationCredential: makeTable(), webhookEvent: makeTable(),
    } as any;
  }
  const audit = { log: async () => {} } as any;
  const baseOrder = (over: Record<string, any> = {}) => ({
    externalId: "native-test-1",
    externalNumber: "ORD-T1",
    status: "processing",
    paymentMethod: "cod",
    isCod: true,
    currency: "BDT",
    subtotalMinor: 50000n, shippingMinor: 6000n, discountMinor: 0n,
    taxMinor: 0n, totalMinor: 56000n, refundedMinor: 0n,
    placedAt: new Date(),
    customer: { externalId: "01711111111", firstName: "রহিম", phone: "01711111111" },
    items: [{ name: "ওয়ালেট", quantity: 1, priceMinor: 50000n, totalMinor: 50000n }],
    ...over,
  });

  it("stamps the supplied attribution onto the created Order row", async () => {
    const prisma = fakePrisma();
    const svc = new IntegrationsService(prisma, audit);
    const result = await svc.upsertOrder("org-1", null, baseOrder({
      utmSource: "facebook", utmMedium: "cpc", utmCampaign: "eid",
      clickIdType: "fbclid", clickId: "IwAR-9",
    }) as any, "native_storefront");
    expect(result).toBe("created");
    const row = prisma.order.rows[0];
    expect(row.utmSource).toBe("facebook");
    expect(row.utmMedium).toBe("cpc");
    expect(row.utmCampaign).toBe("eid");
    expect(row.clickIdType).toBe("fbclid");
    expect(row.clickId).toBe("IwAR-9");
    expect(row.utmContent).toBeUndefined();
    expect(row.utmTerm).toBeUndefined();
  });

  it("no attribution supplied → the create payload carries NO stamp keys (columns stay null)", async () => {
    const prisma = fakePrisma();
    const svc = new IntegrationsService(prisma, audit);
    await svc.upsertOrder("org-1", null, baseOrder() as any, "native_storefront");
    expectNoAttributionKeys(prisma.order.rows[0]);
  });

  it("a re-upsert (update branch) never rewrites the placement stamps", async () => {
    const prisma = fakePrisma();
    const svc = new IntegrationsService(prisma, audit);
    await svc.upsertOrder("org-1", null, baseOrder({ utmSource: "facebook", clickId: "first" }) as any, "native_storefront");
    const again = await svc.upsertOrder("org-1", null, baseOrder({
      status: "completed", utmSource: "google", clickId: "second",
    }) as any, "native_storefront");
    expect(again).toBe("updated");
    expect(prisma.order.rows).toHaveLength(1);
    expect(prisma.order.rows[0].status).toBe("completed");
    expect(prisma.order.rows[0].utmSource).toBe("facebook");
    expect(prisma.order.rows[0].clickId).toBe("first");
  });
});

// ---------- 3c. single-product checkout choke (ec29 harness) ----------

describe("AB7 single-product checkout choke", () => {
  function makeProductsPrisma() {
    return {
      product: makeTable(), productVariant: makeTable(), promotion: makeTable(),
      storeDiscount: makeTable(), storefrontSetting: makeTable(), deliverySlot: makeTable(),
      customer: makeTable(), category: makeTable(), order: makeTable(),
    } as any;
  }
  const T0 = new Date("2026-10-01T00:00:00Z");
  const auditStub: any = { log: jest.fn(async () => undefined) };

  function seedProducts(prisma: any) {
    prisma.product.rows.push({
      id: "p-1", organizationId: "org-1", name: "প্রিমিয়াম পণ্য", slug: "prod-one",
      sku: "P-1", status: "ACTIVE", priceMinor: 100000n, compareAtMinor: null,
      categoryId: null, currency: "BDT", stockQuantity: null, preorderEnabled: false,
      digital: false, bumpTitle: null, bumpPriceMinor: null, variants: [],
      organization: {
        id: "org-1", name: "Shop One",
        businessProfile: { deliveryChargeInsideMinor: 6000n, deliveryChargeOutsideMinor: 12000n },
      },
      createdAt: T0, updatedAt: T0,
    });
    prisma.storefrontSetting.rows.push({
      id: "set-1", organizationId: "org-1", shopEnabled: true,
      referralDiscountPercent: null, referralMinSubtotalMinor: null,
      giftWrapEnabled: false, giftWrapFeeMinor: null,
      createdAt: T0, updatedAt: T0,
    });
  }

  function makeProducts(prisma: any) {
    const discounts = new DiscountsService(prisma, {} as any, auditStub);
    const promotions = new PromotionsService(prisma, discounts, auditStub);
    const captured: any[] = [];
    let seq = 0;
    const integrations: any = {
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
    const products = new ProductsService(prisma, auditStub, undefined, integrations, undefined, discounts, promotions);
    return { products, captured };
  }

  const ORDER_DTO = {
    customerName: "Buyer", customerPhone: "01711111111", customerAddress: "Dhaka address",
    quantity: 1, deliveryZone: "inside_dhaka",
  };

  it("stamps the normalized attribution onto the create payload", async () => {
    const prisma = makeProductsPrisma(); seedProducts(prisma);
    const { products, captured } = makeProducts(prisma);
    await products.placePublicOrder("prod-one", {
      ...ORDER_DTO,
      attribution: { utmSource: " tiktok ", utmCampaign: "launch", clickIdType: "ttclid", clickId: "tt-5" },
    } as any);
    expect(captured).toHaveLength(1);
    expect(captured[0].utmSource).toBe("tiktok");
    expect(captured[0].utmCampaign).toBe("launch");
    expect(captured[0].clickIdType).toBe("ttclid");
    expect(captured[0].clickId).toBe("tt-5");
    expect("utmMedium" in captured[0]).toBe(false);
  });

  it("absent attribution → NO attribution keys on the payload", async () => {
    const prisma = makeProductsPrisma(); seedProducts(prisma);
    const { products, captured } = makeProducts(prisma);
    await products.placePublicOrder("prod-one", { ...ORDER_DTO } as any);
    expect(captured).toHaveLength(1);
    expectNoAttributionKeys(captured[0]);
  });
});

// ---------- 3d. landing checkout choke (landings harness) ----------

describe("AB7 landing checkout choke", () => {
  function makeLandingsPrisma() {
    return {
      organization: makeTable(), businessProfile: makeTable(), product: makeTable(),
      productVariant: makeTable(), productImage: makeTable(), shippingZone: makeTable(),
      landingPage: makeTable(), landingVariant: makeTable(), landingEvent: makeTable(),
      order: makeTable(), orderItem: makeTable(), fulfillment: makeTable(),
      stockMovement: makeTable(), auditLog: makeTable(), bundleItem: makeTable(),
      membership: makeTable(), agentNotification: makeTable(),
    } as any;
  }
  const T0 = new Date("2026-10-01T00:00:00Z");
  const T1 = new Date("2026-10-02T00:00:00Z");

  function seedLandings(prisma: any) {
    prisma.organization.rows.push({ id: "org-1", slug: "shop-one", name: "Shop One Ltd" });
    prisma.businessProfile.rows.push({
      id: "bp-1", organizationId: "org-1", metaPixelId: "px-123", tikTokPixelId: "tt-456",
      codAvailable: true, deliveryChargeInsideMinor: null, deliveryChargeOutsideMinor: null,
    });
    prisma.product.rows.push(
      { id: "p-a", organizationId: "org-1", name: "লেদার ওয়ালেট", slug: "leather-wallet", description: "আসল চামড়া", category: "ওয়ালেট", categoryId: null, sku: "WAL-1", status: "ACTIVE", priceMinor: 50000n, compareAtMinor: 60000n, currency: "BDT", stockQuantity: 10, lowStockThreshold: null, imageUrl: "cover.jpg", bumpTitle: "কি-রিং যোগ করুন", bumpPriceMinor: 10000n, bumpImageUrl: null, createdAt: T0, updatedAt: T0 },
      { id: "p-up", organizationId: "org-1", name: "কার্ড হোল্ডার", slug: "card-holder", description: null, category: null, categoryId: null, sku: "UP-1", status: "ACTIVE", priceMinor: 20000n, compareAtMinor: null, currency: "BDT", stockQuantity: 5, lowStockThreshold: null, imageUrl: "up.jpg", bumpTitle: null, bumpPriceMinor: null, bumpImageUrl: null, createdAt: T0, updatedAt: T0 },
    );
    prisma.productVariant.rows.push(
      { id: "pv-1", productId: "p-a", name: "কালো", sku: "WAL-1-BLK", priceMinor: 55000n, stockQuantity: 3, createdAt: T0, updatedAt: T0 },
    );
    prisma.productImage.rows.push(
      { id: "img-1", productId: "p-a", url: "cover.jpg", altText: null, position: 0, createdAt: T0, updatedAt: T0 },
    );
    prisma.landingPage.rows.push(
      { id: "land-1", organizationId: "org-1", productId: "p-a", slug: "wallet-offer", title: "ওয়ালেট অফার", status: "published", sections: null, upsellProductId: "p-up", createdAt: T0, updatedAt: T0 },
    );
    prisma.landingVariant.rows.push(
      { id: "lv-a", landingId: "land-1", name: "A (control)", isControl: true, weight: 50, headline: "সেরা ওয়ালেট", heroImageUrl: null, ctaText: "অর্ডার করুন", showCompareAt: true, createdAt: T0, updatedAt: T0 },
    );
  }

  function makeLandings(prisma: any) {
    const captured: any[] = [];
    const integrations = {
      upsertOrder: jest.fn(async (orgId: string, _storeId: any, o: any, source: string) => {
        captured.push(o);
        const order = await prisma.order.create({
          data: {
            organizationId: orgId, source, externalId: o.externalId, externalNumber: o.externalNumber,
            status: o.status, paymentMethod: o.paymentMethod ?? null, isCod: o.isCod,
            currency: o.currency, subtotalMinor: o.subtotalMinor, shippingMinor: o.shippingMinor,
            discountMinor: o.discountMinor, taxMinor: o.taxMinor, totalMinor: o.totalMinor,
            refundedMinor: o.refundedMinor, placedAt: o.placedAt ?? null,
            landingPageId: null, landingVariantId: null,
          },
        });
        for (const item of o.items) {
          await prisma.orderItem.create({
            data: {
              orderId: order.id, productId: null, name: item.name, sku: item.sku ?? null,
              quantity: item.quantity, priceMinor: item.priceMinor, totalMinor: item.totalMinor,
            },
          });
        }
        return "created";
      }),
    };
    const audit = { log: jest.fn(async () => undefined) };
    const storefront = new StorefrontService(prisma);
    const discounts = {
      validateForCheckout: jest.fn(async () => ({ valid: false, reason: "not_found", discountMinor: 0n, freeShipping: false })),
      redeem: jest.fn(async () => ({})),
    };
    const inventory = new InventoryService(prisma, audit as any);
    const svc = new LandingsService(
      prisma, audit as any, storefront as any, discounts as any,
      integrations as any, inventory as any, undefined,
    );
    return { svc, captured };
  }

  const ORDER_BODY = {
    customerName: "রহিম উদ্দিন",
    customerPhone: "01700000000",
    customerAddress: "বাসা ১, রোড ২, ঢাকা",
  };

  it("stamps the normalized attribution (inherited DTO field) onto the create payload", async () => {
    const prisma = makeLandingsPrisma(); seedLandings(prisma);
    const { svc, captured } = makeLandings(prisma);
    await svc.placeOrder("wallet-offer", {
      ...ORDER_BODY,
      attribution: { utmSource: "facebook", utmMedium: " cpc ", clickIdType: "fbclid", clickId: "fb-3" },
    } as any);
    expect(captured).toHaveLength(1);
    expect(captured[0].utmSource).toBe("facebook");
    expect(captured[0].utmMedium).toBe("cpc");
    expect(captured[0].clickIdType).toBe("fbclid");
    expect(captured[0].clickId).toBe("fb-3");
  });

  it("absent attribution → NO attribution keys on the payload", async () => {
    const prisma = makeLandingsPrisma(); seedLandings(prisma);
    const { svc, captured } = makeLandings(prisma);
    await svc.placeOrder("wallet-offer", { ...ORDER_BODY } as any);
    expect(captured).toHaveLength(1);
    expectNoAttributionKeys(captured[0]);
  });
});

// ---------- 4. staff serializer (pubOrder via OrdersService.list) ----------

describe("AB7 staff order serializer", () => {
  it("list rows carry utmSource + clickIdType (null when untracked)", async () => {
    const base = {
      organizationId: "org-1", isPractice: false, isCod: true, codConfirmationStatus: null,
      customer: null, items: [], subtotalMinor: 0n, shippingMinor: 0n, discountMinor: 0n,
      taxMinor: 0n, refundedMinor: 0n, tags: null as any, assigneeId: null as any, address: null as any,
    };
    const orders: any[] = [
      { ...base, id: "stamped", status: "processing", source: "native_storefront", externalNumber: "2001", externalId: "n1", totalMinor: 56000n, placedAt: new Date("2026-10-10T10:00:00Z"), createdAt: new Date("2026-10-10T10:00:00Z"), utmSource: "facebook", clickIdType: "fbclid", clickId: "secret-click-id" },
      { ...base, id: "plain", status: "processing", source: "manual", externalNumber: "2002", externalId: "m1", totalMinor: 1000n, placedAt: new Date("2026-10-09T10:00:00Z"), createdAt: new Date("2026-10-09T10:00:00Z") },
    ];
    const prisma: any = {
      order: {
        findMany: jest.fn(async (args: any = {}) => {
          let rows = orders.filter((r) => matchWhere(r, args.where));
          if (args.skip) rows = rows.slice(args.skip);
          if (args.take) rows = rows.slice(0, args.take);
          return rows;
        }),
        count: jest.fn(async ({ where }: any = {}) => orders.filter((r) => matchWhere(r, where)).length),
        findFirst: jest.fn(async ({ where }: any = {}) => orders.find((r) => matchWhere(r, where)) ?? null),
      },
      courierShipment: { findMany: jest.fn(async () => []) },
      paymentVerification: {
        groupBy: jest.fn(async () => []),
        findMany: jest.fn(async () => []),
      },
    };
    const audit = { log: jest.fn(async () => undefined) };
    const svc = new OrdersService(prisma, undefined, undefined, audit as any);
    const out = await svc.list("org-1", {});
    const stamped = out.items.find((i: any) => i.id === "stamped");
    const plain = out.items.find((i: any) => i.id === "plain");
    expect(stamped.utmSource).toBe("facebook");
    expect(stamped.clickIdType).toBe("fbclid");
    expect(plain.utmSource).toBeNull();
    expect(plain.clickIdType).toBeNull();
  });
});

// ---------- 5. source breakdown ----------

describe("AB7 CommerceAnalyticsService.sourceBreakdown", () => {
  // 2026-10-13T10:00Z = 16:00 Dhaka → window (30d) ends
  // 2026-10-13T18:00Z, starts 2026-09-13T18:00Z.
  const NOW = new Date("2026-10-13T10:00:00.000Z");
  const IN = new Date("2026-10-10T05:00:00.000Z");

  function fixture() {
    const orderTable = makeTable();
    const prisma: any = {
      store: makeTable(), order: orderTable, product: makeTable(),
      productCost: makeTable(), storeListing: makeTable(),
      syncOutbox: makeTable(), syncConflict: makeTable(),
    };
    const order = (over: Record<string, any> = {}) => ({
      organizationId: "org-1", storeId: null, status: "completed",
      totalMinor: 0n, refundedMinor: 0n, currency: "BDT",
      placedAt: IN, createdAt: IN, items: [],
      utmSource: null, utmMedium: null, utmCampaign: null,
      clickIdType: null, clickId: null,
      ...over,
    });
    orderTable.rows.push(
      order({ id: "fb-1", utmSource: "facebook", clickIdType: "fbclid", clickId: "c-1", totalMinor: 10000n }),
      order({ id: "fb-2", utmSource: "facebook", clickIdType: "fbclid", clickId: "c-2", totalMinor: 5000n }),
      order({ id: "gg-1", utmSource: "google", totalMinor: 30000n }), // stamped, no click id
      order({ id: "direct-1", totalMinor: 7000n }),                    // untracked → সরাসরি/অজানা
      order({ id: "direct-2", utmSource: null, totalMinor: 3000n }),
      order({ id: "cancelled-fb", status: "cancelled", utmSource: "facebook", clickId: "c-x", totalMinor: 99999n }), // excluded (not sold)
      order({ id: "refunded-gg", status: "refunded", utmSource: "google", totalMinor: 88888n }),                      // excluded
      order({ id: "old-fb", utmSource: "facebook", clickId: "c-old", totalMinor: 77777n, placedAt: new Date("2026-08-01T05:00:00.000Z"), createdAt: new Date("2026-08-01T05:00:00.000Z") }), // out of window
      order({ id: "other-org", organizationId: "org-2", utmSource: "facebook", clickId: "c-z", totalMinor: 66666n }), // other tenant
    );
    return prisma;
  }

  it("groups sold orders by utmSource, nulls under সরাসরি/অজানা, revenue desc, BigInt-safe totals", async () => {
    const svc = new CommerceAnalyticsService(fixture());
    const out: any = await svc.sourceBreakdown("org-1", 30, NOW);
    expect(out.days).toBe(30);
    expect(out.sources).toEqual([
      { source: "google", orders: 1, revenueMinor: "30000" },
      { source: "facebook", orders: 2, revenueMinor: "15000" },
      { source: "সরাসরি/অজানা", orders: 2, revenueMinor: "10000" },
    ]);
    expect(out.totals).toEqual({
      orders: 5,
      revenueMinor: "55000",
      withClickId: 2,     // fb-1 + fb-2 only (cancelled / out-of-window clicks never count)
      stampedOrders: 3,   // fb-1, fb-2, gg-1
    });
    for (const row of out.sources) expect(typeof row.revenueMinor).toBe("string");
    expect(typeof out.totals.revenueMinor).toBe("string");
  });

  it("an org with no sold orders in range → empty sources + zero totals", async () => {
    const svc = new CommerceAnalyticsService(fixture());
    const out: any = await svc.sourceBreakdown("org-empty", 30, NOW);
    expect(out.sources).toEqual([]);
    expect(out.totals).toEqual({ orders: 0, revenueMinor: "0", withClickId: 0, stampedOrders: 0 });
  });

  it("rejects an out-of-range days value like the sibling analytics", async () => {
    const svc = new CommerceAnalyticsService(fixture());
    await expect(svc.sourceBreakdown("org-1", 0, NOW)).rejects.toThrow(/days/);
    await expect(svc.sourceBreakdown("org-1", 999, NOW)).rejects.toThrow(/days/);
  });
});
