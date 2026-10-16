import { BadRequestException } from "@nestjs/common";
import { StorefrontService } from "./storefront.service";

/**
 * GC10 — shop checkout with embedded online payment.
 *
 * Pinned rules:
 * - shopHome carries paymentOptions at the TOP level and
 *   mirrors checkoutTrust at the TOP level (the checkout page
 *   reads shop.checkoutTrust there; it used to be nested only
 *   inside settings — GB3 leftover, proven here).
 * - an onlinePayment pair the shop does not offer → 400, and
 *   NO order is written (the client is never trusted).
 * - a valid online pair: order is non-COD, paymentMethod is
 *   the provider, the note carries the pending-verification
 *   marker (never a paid claim, never the manual-advance note),
 *   and the response says paymentClaimStatus "online_pending".
 * - without onlinePayment the COD and manual paths are
 *   byte-identical to before GC10.
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
    delete: async ({ where }: any) => {
      const idx = rows.findIndex((r) => matchWhere(r, where));
      if (idx < 0) throw new Error("record not found");
      return rows.splice(idx, 1)[0];
    },
  };
}
function makePrisma() {
  return {
    organization: makeTable(), storefrontSetting: makeTable(), businessProfile: makeTable(),
    category: makeTable(), brand: makeTable(), product: makeTable(), productVariant: makeTable(),
    productImage: makeTable(), shippingZone: makeTable(), storeCart: makeTable(), storeCartItem: makeTable(),
    storeCartBundle: makeTable(), bundle: makeTable(), order: makeTable(), orderItem: makeTable(),
    fulfillment: makeTable(), deliverySlot: makeTable(), shopPage: makeTable(), customer: makeTable(),
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
}

const ONLINE = [{ provider: "bkash" as const, source: "own" as const, sandbox: false }];

/** TenantPaymentsService-shaped stub: the REAL gate logic is
 * spec-proven in connections/gc10-embedded-checkout.spec.ts;
 * here it only feeds the storefront wiring. */
function tenantPaymentsStub(online: any[] = ONLINE) {
  return {
    publicPaymentOptions: async () => ({ online }),
    assertPublicPaymentOption: async (_orgId: string, sel: any) => {
      const hit = online.find((o) => o.provider === sel?.provider && o.source === sel?.source);
      if (!hit) throw new BadRequestException("এই অনলাইন পেমেন্টের অপশনটি এই দোকানে উপলব্ধ নয়");
      return { provider: hit.provider, source: hit.source };
    },
  } as any;
}

function makeStorefront(prisma: any, tenantPayments?: any) {
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
    undefined, undefined, undefined, tenantPayments,
  );
  return { svc, integrations, placed };
}

async function cartReady(svc: StorefrontService) {
  const { cartToken } = await svc.createCart("shop-one");
  await svc.patchCartLine("shop-one", cartToken, { productId: "p-a", quantity: 1 });
  return cartToken;
}
const dto = (cartToken: string, over: Record<string, any> = {}) => ({
  cartToken, name: "রহিম", phone: "01711111111", address: "বাড়ি ১, রোড ২", district: "ঢাকা", ...over,
});

describe("GC10 shopHome payload", () => {
  it("paymentOptions at TOP level; checkoutTrust mirrored top-level AND inside settings (identical)", async () => {
    const prisma = makePrisma(); seedShop(prisma);
    const { svc } = makeStorefront(prisma, tenantPaymentsStub());
    const home: any = await svc.shopHome("shop-one", {});
    expect(home.paymentOptions).toEqual({ online: ONLINE });
    expect(home.checkoutTrust).toBeDefined();
    expect(home.settings.checkoutTrust).toEqual(home.checkoutTrust);
  });

  it("no TenantPaymentsService wired → paymentOptions is an empty list, home still serves", async () => {
    const prisma = makePrisma(); seedShop(prisma);
    const { svc } = makeStorefront(prisma, undefined);
    const home: any = await svc.shopHome("shop-one", {});
    expect(home.paymentOptions).toEqual({ online: [] });
  });
});

describe("GC10 shop checkout placement", () => {
  it("valid online pair → non-COD order, provider stamped, pending marker note, online_pending response", async () => {
    const prisma = makePrisma(); seedShop(prisma);
    const { svc, placed } = makeStorefront(prisma, tenantPaymentsStub());
    const token = await cartReady(svc);
    const out: any = await svc.checkout("shop-one", dto(token, {
      onlinePayment: { provider: "bkash", source: "own" },
    }) as any);
    expect(out.paymentClaimStatus).toBe("online_pending");
    expect(out.paymentMethod).toBe("bkash");
    expect(placed).toHaveLength(1);
    expect(placed[0].paymentMethod).toBe("bkash");
    expect(placed[0].isCod).toBe(false);
    expect(placed[0].customer.address.note).toContain("[অনলাইন পেমেন্ট (bkash) — যাচাই বাকি]");
    expect(placed[0].customer.address.note).not.toContain("ম্যানুয়াল পেমেন্ট বেছে নিয়েছেন");
    expect(placed[0].customer.address.note).not.toContain("অযাচাইকৃত advance");
  });

  it("unoffered pair → 400 and NO order is written", async () => {
    const prisma = makePrisma(); seedShop(prisma);
    const { svc, integrations } = makeStorefront(prisma, tenantPaymentsStub());
    const token = await cartReady(svc);
    await expect(svc.checkout("shop-one", dto(token, {
      onlinePayment: { provider: "sslcommerz", source: "platform" },
    }) as any)).rejects.toBeInstanceOf(BadRequestException);
    expect(integrations.upsertOrder).not.toHaveBeenCalled();
    expect(prisma.order.rows).toHaveLength(0);
  });

  it("online selection with no payments service wired → 400, no order", async () => {
    const prisma = makePrisma(); seedShop(prisma);
    const { svc, integrations } = makeStorefront(prisma, undefined);
    const token = await cartReady(svc);
    await expect(svc.checkout("shop-one", dto(token, {
      onlinePayment: { provider: "bkash", source: "own" },
    }) as any)).rejects.toBeInstanceOf(BadRequestException);
    expect(integrations.upsertOrder).not.toHaveBeenCalled();
  });

  it("COD parity: no onlinePayment → cod_due, isCod order, no online marker", async () => {
    const prisma = makePrisma(); seedShop(prisma);
    const { svc, placed } = makeStorefront(prisma, tenantPaymentsStub());
    const token = await cartReady(svc);
    const out: any = await svc.checkout("shop-one", dto(token) as any);
    expect(out.paymentClaimStatus).toBe("cod_due");
    expect(out.paymentMethod).toBe("cod");
    expect(placed[0].isCod).toBe(true);
    expect(placed[0].customer.address.note).not.toContain("অনলাইন পেমেন্ট");
  });

  it("manual bkash parity: advance claim stays UNVERIFIED, exactly as before GC10", async () => {
    const prisma = makePrisma(); seedShop(prisma);
    prisma.businessProfile.rows.push({
      id: "bp-1", organizationId: "org-1", codAvailable: true, bkashNumber: "01700000000", nagadNumber: null, paymentNote: null,
    });
    const { svc, placed } = makeStorefront(prisma, tenantPaymentsStub());
    const token = await cartReady(svc);
    const out: any = await svc.checkout("shop-one", dto(token, {
      paymentMethod: "bkash", advanceNote: "TrxID XYZ123",
    }) as any);
    expect(out.paymentClaimStatus).toBe("advance_unverified");
    expect(placed[0].paymentMethod).toBe("bkash");
    expect(placed[0].isCod).toBe(false);
    expect(placed[0].customer.address.note).toContain("[অযাচাইকৃত advance দাবি — bkash] TrxID XYZ123");
    expect(placed[0].customer.address.note).not.toContain("অনলাইন পেমেন্ট");
  });
});
