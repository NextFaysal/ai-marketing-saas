import { BadRequestException, NotFoundException } from "@nestjs/common";
import { StorefrontService } from "./storefront.service";
import { AbandonedCheckoutsService, NATIVE_CART_RECOVERY_ACTION } from "../commerce/abandoned-checkouts.service";
import { validateDiscount } from "../commerce/discounts";

/* Fake prisma (EC spec style, self-contained copy). */
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
    abandonedStoreCheckout: makeTable(),
    store: makeTable(),
    customer: makeTable(),
    auditLog: makeTable(),
    channelConversation: makeTable(),
    integration: makeTable(),
    integrationCredential: makeTable(),
  } as any;
}

const T0 = new Date("2026-10-01T00:00:00Z");

function seedShop(prisma: any) {
  prisma.organization.rows.push(
    { id: "org-1", slug: "shop-one", name: "Shop One Ltd", brandName: "ShopOne", logoUrl: null, primaryColor: null, customDomain: null },
    { id: "org-2", slug: "shop-two", name: "Shop Two", brandName: null, logoUrl: null, primaryColor: null, customDomain: null },
  );
  prisma.storefrontSetting.rows.push(
    { id: "set-1", organizationId: "org-1", shopEnabled: true, shopName: null, announcementText: null, showFeatured: true, showCategories: true, showSearch: true, metaDescription: null, featuredProductIds: null, domainVerifyToken: null, domainVerifiedAt: null, createdAt: T0, updatedAt: T0 },
    { id: "set-2", organizationId: "org-2", shopEnabled: true, shopName: null, announcementText: null, showFeatured: true, showCategories: true, showSearch: true, metaDescription: null, featuredProductIds: null, domainVerifyToken: null, domainVerifiedAt: null, createdAt: T0, updatedAt: T0 },
  );
  prisma.product.rows.push(
    { id: "p-a", organizationId: "org-1", name: "লেদার ওয়ালেট", slug: "leather-wallet", description: null, category: null, categoryId: null, sku: "WAL-1", status: "ACTIVE", priceMinor: 50000n, compareAtMinor: null, currency: "BDT", stockQuantity: 10, lowStockThreshold: null, imageUrl: null, bumpTitle: "কি-রিং যোগ করুন", bumpPriceMinor: 10000n, bumpImageUrl: null, createdAt: T0, updatedAt: T0 },
    { id: "p-b", organizationId: "org-1", name: "ক্যানভাস ব্যাগ", slug: "canvas-bag", description: null, category: null, categoryId: null, sku: "BAG-1", status: "ACTIVE", priceMinor: 120000n, compareAtMinor: null, currency: "BDT", stockQuantity: null, lowStockThreshold: null, imageUrl: null, bumpTitle: null, bumpPriceMinor: null, bumpImageUrl: null, createdAt: T0, updatedAt: T0 },
  );
  prisma.productVariant.rows.push(
    { id: "v-a1", productId: "p-a", name: "কালো", sku: "WAL-1-BLK", priceMinor: 55000n, stockQuantity: 3, attributes: null, createdAt: T0, updatedAt: T0 },
  );
  prisma.shippingZone.rows.push(
    { id: "z-all", organizationId: "org-1", name: "সব জায়গায়", kind: "all", districts: null, chargeMinor: 15000n, deliveryDays: 5, freeAboveMinor: null, active: true, position: 0, createdAt: T0, updatedAt: T0 },
    { id: "z-ctg", organizationId: "org-1", name: "চট্টগ্রাম", kind: "district_list", districts: ["চট্টগ্রাম"], chargeMinor: 8000n, deliveryDays: 2, freeAboveMinor: 100000n, active: true, position: 1, createdAt: T0, updatedAt: T0 },
    { id: "z-out", organizationId: "org-1", name: "ঢাকার বাইরে", kind: "outside_dhaka", districts: null, chargeMinor: 12000n, deliveryDays: 3, freeAboveMinor: null, active: true, position: 3, createdAt: T0, updatedAt: T0 },
    { id: "z-in", organizationId: "org-1", name: "ঢাকার ভিতরে", kind: "inside_dhaka", districts: null, chargeMinor: 6000n, deliveryDays: 1, freeAboveMinor: null, active: true, position: 5, createdAt: T0, updatedAt: T0 },
    { id: "z-list-dhaka", organizationId: "org-1", name: "ঢাকা বিশেষ", kind: "district_list", districts: ["ঢাকা"], chargeMinor: 4000n, deliveryDays: 1, freeAboveMinor: null, active: true, position: 9, createdAt: T0, updatedAt: T0 },
  );
  prisma.storeDiscount.rows.push(
    { id: "d-10", organizationId: "org-1", code: "SAVE10", kind: "percent", value: 10, minOrderMinor: null, scopeType: "all", scopeIds: null, startsAt: null, endsAt: null, usageLimit: null, usedCount: 0, active: true },
    { id: "d-20", organizationId: "org-1", code: "SAVE20", kind: "percent", value: 20, minOrderMinor: null, scopeType: "all", scopeIds: null, startsAt: null, endsAt: null, usageLimit: null, usedCount: 0, active: true },
    { id: "d-ship", organizationId: "org-1", code: "SHIPFREE", kind: "free_shipping", value: 0, minOrderMinor: null, scopeType: "all", scopeIds: null, startsAt: null, endsAt: null, usageLimit: null, usedCount: 0, active: true },
  );
}

function makeDiscountsStub(prisma: any) {
  return {
    validateForCheckout: jest.fn(async (orgId: string, code: string, ctx: any) => {
      const row = prisma.storeDiscount.rows.find(
        (r: any) => r.organizationId === orgId && r.code === String(code).trim().toUpperCase(),
      );
      if (!row) return { valid: false, reason: "not_found", discountMinor: 0n, freeShipping: false };
      return validateDiscount(row, ctx);
    }),
    redeem: jest.fn(async (_orgId: string, id: string) => {
      const row = prisma.storeDiscount.rows.find((r: any) => r.id === id);
      if (row) row.usedCount++;
      return row ?? null;
    }),
  };
}

function makeIntegrationsStub(prisma: any) {
  let seq = 0;
  return {
    upsertOrder: jest.fn(async (orgId: string, _storeId: any, payload: any, source: string) => {
      prisma.order.rows.push({
        id: `order-${++seq}`,
        organizationId: orgId,
        source,
        externalId: payload.externalId,
        externalNumber: payload.externalNumber,
        totalMinor: payload.totalMinor,
        createdAt: new Date(),
        updatedAt: new Date(),
      });
      return "created";
    }),
  };
}

function makeService(prisma: any, extra: { dns?: any; fetch?: any } = {}) {
  const discounts = makeDiscountsStub(prisma);
  const integrations = makeIntegrationsStub(prisma);
  const audit = { log: jest.fn(async () => undefined) };
  const svc = new StorefrontService(
    prisma,
    integrations as any,
    discounts as any,
    audit as any,
    extra.dns,
    extra.fetch,
  );
  return { svc, discounts, integrations, audit };
}

async function cartWith(svc: StorefrontService, slug: string, lines: Array<any>) {
  const { cartToken } = await svc.createCart(slug);
  for (const line of lines) {
    await svc.patchCartLine(slug, cartToken, line);
  }
  return cartToken;
}

describe("EC8 quote — zone tiers", () => {
  it("district_list beats inside_dhaka and all regardless of position; outside beats all; all is the fallback", async () => {
    const prisma = makePrisma();
    seedShop(prisma);
    const { svc } = makeService(prisma);
    const token = await cartWith(svc, "shop-one", [{ productId: "p-a", quantity: 1 }]);

    const dhaka = await svc.quote("shop-one", { cartToken: token, district: "ঢাকা" });
    expect(dhaka.zone!.id).toBe("z-list-dhaka");
    expect(dhaka.deliveryMinor).toBe("4000");

    const khulna = await svc.quote("shop-one", { cartToken: token, district: "খুলনা" });
    expect(khulna.zone!.id).toBe("z-out");
    expect(khulna.deliveryMinor).toBe("12000");

    for (const z of prisma.shippingZone.rows) if (z.id !== "z-all") z.active = false;
    const fallback = await svc.quote("shop-one", { cartToken: token, district: "খুলনা" });
    expect(fallback.zone!.id).toBe("z-all");
    expect(fallback.deliveryMinor).toBe("15000");
  });

  it("no matching zone → Bengali BadRequest", async () => {
    const prisma = makePrisma();
    seedShop(prisma);
    const { svc } = makeService(prisma);
    const token = await cartWith(svc, "shop-two", []);
    // org-2 has no products; use a direct cart row + item instead.
    void token;
    const cart = await svc.createCart("shop-two");
    prisma.product.rows.push({ id: "p-x", organizationId: "org-2", name: "X", slug: "x", description: null, category: null, categoryId: null, sku: "X-1", status: "ACTIVE", priceMinor: 1000n, compareAtMinor: null, currency: "BDT", stockQuantity: null, lowStockThreshold: null, imageUrl: null, bumpTitle: null, bumpPriceMinor: null, bumpImageUrl: null, createdAt: T0, updatedAt: T0 });
    await svc.patchCartLine("shop-two", cart.cartToken, { productId: "p-x", quantity: 1 });
    await expect(
      svc.quote("shop-two", { cartToken: cart.cartToken, district: "ঢাকা" }),
    ).rejects.toThrow(/এই এলাকায় ডেলিভারি সেট করা নেই/);
  });

  it("empty cart quote is refused", async () => {
    const prisma = makePrisma();
    seedShop(prisma);
    const { svc } = makeService(prisma);
    const { cartToken } = await svc.createCart("shop-one");
    await expect(svc.quote("shop-one", { cartToken, district: "ঢাকা" })).rejects.toBeInstanceOf(BadRequestException);
  });
});

describe("EC8 quote — coupons, free-above, bump", () => {
  it("percent coupon: bump joins the subtotal, discount base is eligible product lines (mirrors single checkout); invalid coupon fails in Bengali", async () => {
    const prisma = makePrisma();
    seedShop(prisma);
    const { svc } = makeService(prisma);
    const token = await cartWith(svc, "shop-one", [{ productId: "p-a", quantity: 1, includeBump: true }]);
    const q = await svc.quote("shop-one", { cartToken: token, district: "ঢাকা", couponCode: "SAVE10" });
    expect(q.itemsSubtotalMinor).toBe("50000");
    expect(q.bumpMinor).toBe("10000");
    expect(q.subtotalMinor).toBe("60000");
    expect(q.discountMinor).toBe("5000"); // 10% of eligible product lines (validateDiscount base; bump counts toward subtotal/min-order only)
    expect(q.totalMinor).toBe("59000"); // 60000 - 5000 + 4000 delivery
    await expect(
      svc.quote("shop-one", { cartToken: token, district: "ঢাকা", couponCode: "NOPE" }),
    ).rejects.toThrow(/কুপন প্রয়োগ করা যায়নি/);
  });

  it("free-above is judged on the DISCOUNTED subtotal", async () => {
    const prisma = makePrisma();
    seedShop(prisma);
    const { svc } = makeService(prisma);
    const token = await cartWith(svc, "shop-one", [{ productId: "p-b", quantity: 1 }]); // 120000
    const plain = await svc.quote("shop-one", { cartToken: token, district: "চট্টগ্রাম" });
    expect(plain.deliveryMinor).toBe("0"); // 120000 >= 100000 free-above
    const ten = await svc.quote("shop-one", { cartToken: token, district: "চট্টগ্রাম", couponCode: "SAVE10" });
    expect(ten.deliveryMinor).toBe("0"); // 108000 still >= 100000
    const twenty = await svc.quote("shop-one", { cartToken: token, district: "চট্টগ্রাম", couponCode: "SAVE20" });
    expect(twenty.discountMinor).toBe("24000");
    expect(twenty.deliveryMinor).toBe("8000"); // 96000 < 100000 → zone charge returns
    expect(twenty.totalMinor).toBe("104000");
  });

  it("free_shipping coupon zeroes delivery regardless of the zone", async () => {
    const prisma = makePrisma();
    seedShop(prisma);
    const { svc } = makeService(prisma);
    const token = await cartWith(svc, "shop-one", [{ productId: "p-a", quantity: 1 }]);
    const q = await svc.quote("shop-one", { cartToken: token, district: "ঢাকা", couponCode: "SHIPFREE" });
    expect(q.deliveryMinor).toBe("0");
    expect(q.coupon?.freeShipping).toBe(true);
  });
});

describe("EC8 checkout", () => {
  it("creates exactly one native_storefront order, converts the cart, redeems the coupon, refuses a second checkout", async () => {
    const prisma = makePrisma();
    seedShop(prisma);
    const { svc, integrations, discounts } = makeService(prisma);
    const token = await cartWith(svc, "shop-one", [{ productId: "p-a", quantity: 2, includeBump: true }]);
    const res = await svc.checkout("shop-one", {
      cartToken: token,
      name: "রহিম উদ্দিন",
      phone: "01711111111",
      address: "বাড়ি ১, রোড ২",
      district: "ঢাকা",
      couponCode: "SAVE10",
    });
    expect(integrations.upsertOrder).toHaveBeenCalledTimes(1);
    const [orgId, storeId, payload, source] = (integrations.upsertOrder as jest.Mock).mock.calls[0];
    expect(orgId).toBe("org-1");
    expect(storeId).toBeNull();
    expect(source).toBe("native_storefront");
    expect(payload.isCod).toBe(true);
    expect(payload.paymentMethod).toBe("cod");
    // subtotal 110000 (2×50000 + 10000 bump), discount 10000 (10% of product lines), delivery 4000
    expect(payload.subtotalMinor).toBe(110000n);
    expect(payload.discountMinor).toBe(10000n);
    expect(payload.shippingMinor).toBe(4000n);
    expect(payload.totalMinor).toBe(104000n);
    const bumpLine = payload.items.find((i: any) => i.sku === "ADD-ON-BUMP");
    expect(bumpLine).toMatchObject({ name: "[Special Add-On] কি-রিং যোগ করুন", quantity: 1, priceMinor: 10000n });
    const mainLine = payload.items.find((i: any) => i.sku === "WAL-1");
    expect(mainLine).toMatchObject({ quantity: 2, priceMinor: 50000n });
    expect(payload.customer.address.district).toBe("ঢাকা");

    expect(res.success).toBe(true);
    expect(res.orderId).toBe("order-1");
    expect(res.orderNumber).toMatch(/^ORD-/);
    expect(res.totalMinor).toBe("104000");
    expect(res.codDueMinor).toBe("104000");
    expect(res.paymentClaimStatus).toBe("cod_due");
    expect(discounts.redeem).toHaveBeenCalledTimes(1);
    expect(prisma.storeDiscount.rows.find((r: any) => r.id === "d-10").usedCount).toBe(1);

    const cartRow = prisma.storeCart.rows[0];
    expect(cartRow.status).toBe("converted");
    await expect(
      svc.checkout("shop-one", {
        cartToken: token, name: "রহিম", phone: "01711111111", address: "বাড়ি ১", district: "ঢাকা",
      }),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(integrations.upsertOrder).toHaveBeenCalledTimes(1);
  });

  it("bkash advance is an unverified note only — full total stays due, order is not COD", async () => {
    const prisma = makePrisma();
    seedShop(prisma);
    const { svc, integrations } = makeService(prisma);
    const token = await cartWith(svc, "shop-one", [{ productId: "p-b", quantity: 1 }]);
    const res = await svc.checkout("shop-one", {
      cartToken: token,
      name: "করিম",
      phone: "01811111111",
      address: "গ্রাম বাড়ি",
      district: "খুলনা",
      paymentMethod: "bkash",
      advanceNote: "TrxID ABC123 দিয়ে ২০০ টাকা পাঠিয়েছি",
    });
    const payload = (integrations.upsertOrder as jest.Mock).mock.calls[0][2];
    expect(payload.isCod).toBe(false);
    expect(payload.paymentMethod).toBe("bkash");
    expect(payload.customer.address.note).toContain("অযাচাইকৃত advance দাবি");
    expect(payload.customer.address.note).toContain("TrxID ABC123");
    expect(res.paymentClaimStatus).toBe("advance_unverified");
    expect(res.amountDueMinor).toBe(res.totalMinor); // nothing treated as paid
    expect(res.codDueMinor).toBe(res.totalMinor);
  });

  it("stock is re-validated at checkout time", async () => {
    const prisma = makePrisma();
    seedShop(prisma);
    const { svc, integrations } = makeService(prisma);
    const token = await cartWith(svc, "shop-one", [{ productId: "p-a", variantId: "v-a1", quantity: 3 }]);
    prisma.productVariant.rows[0].stockQuantity = 2; // sold elsewhere meanwhile
    await expect(
      svc.checkout("shop-one", {
        cartToken: token, name: "করিম", phone: "01811111111", address: "গ্রাম বাড়ি", district: "ঢাকা",
      }),
    ).rejects.toThrow(/স্টকে মাত্র 2টি/);
    expect(integrations.upsertOrder).not.toHaveBeenCalled();
  });
});

describe("EC8 custom domain", () => {
  function domainWorld() {
    const prisma = makePrisma();
    seedShop(prisma);
    prisma.organization.rows[0].customDomain = "shop.example.com";
    const dns = { resolveTxt: jest.fn(async (_host: string): Promise<string[]> => []) };
    const fetcher = { fetchText: jest.fn(async (_url: string) => ({ status: 200, finalUrl: _url, body: "" })) };
    const { svc } = makeService(prisma, { dns, fetch: fetcher });
    return { prisma, svc, dns, fetcher };
  }

  it("verify-token refuses when the org has no customDomain set", async () => {
    const prisma = makePrisma();
    seedShop(prisma);
    const { svc } = makeService(prisma);
    await expect(svc.issueDomainVerifyToken("org-1", "user-1")).rejects.toThrow(/Custom Domain/);
  });

  it("token issue resets verification; verify passes only on the exact TXT token; by-domain resolves only when verified", async () => {
    const { prisma, svc, dns } = domainWorld();
    await expect(svc.byDomain("shop.example.com")).rejects.toBeInstanceOf(NotFoundException);

    const issued = await svc.issueDomainVerifyToken("org-1", "user-1");
    expect(issued.recordHost).toBe("_qosprey-verify.shop.example.com");
    expect(issued.recordType).toBe("TXT");
    expect(issued.token).toMatch(/^[0-9a-f]{64}$/);
    expect(prisma.storefrontSetting.rows[0].domainVerifiedAt).toBeNull();
    await expect(svc.byDomain("shop.example.com")).rejects.toBeInstanceOf(NotFoundException);

    dns.resolveTxt.mockResolvedValue(["some-other-token"]);
    await expect(svc.verifyDomain("org-1", "user-1")).rejects.toThrow(/মেলেনি/);
    expect(prisma.storefrontSetting.rows[0].domainVerifiedAt).toBeNull();

    const enodata: any = new Error("queryTxt ENODATA _qosprey-verify.shop.example.com");
    enodata.code = "ENODATA";
    dns.resolveTxt.mockRejectedValue(enodata);
    await expect(svc.verifyDomain("org-1", "user-1")).rejects.toThrow(/কোনো TXT রেকর্ড পাওয়া যায়নি/);

    dns.resolveTxt.mockResolvedValue(["v=spf1 include:x", issued.token]);
    const verified = await svc.verifyDomain("org-1", "user-1");
    expect(verified.verified).toBe(true);
    expect(dns.resolveTxt).toHaveBeenCalledWith("_qosprey-verify.shop.example.com");

    const resolved = await svc.byDomain("shop.example.com");
    expect(resolved).toEqual({ organizationSlug: "shop-one", domain: "shop.example.com" });
    await expect(svc.byDomain("unknown.example.com")).rejects.toBeInstanceOf(NotFoundException);
  });

  it("check-routing requires verification and real shop evidence in the fetched body", async () => {
    const { svc, dns, fetcher } = domainWorld();
    await expect(svc.checkDomainRouting("org-1")).rejects.toBeInstanceOf(BadRequestException);

    const issued = await svc.issueDomainVerifyToken("org-1", "user-1");
    dns.resolveTxt.mockResolvedValue([issued.token]);
    await svc.verifyDomain("org-1", "user-1");

    fetcher.fetchText.mockResolvedValue({ status: 200, finalUrl: "https://shop.example.com/shop/shop-one", body: `<a href="/shop/shop-one">দোকান</a>` });
    const active = await svc.checkDomainRouting("org-1");
    expect(active.routingActive).toBe(true);
    expect(active.status).toBe(200);

    fetcher.fetchText.mockResolvedValue({ status: 200, finalUrl: "https://shop.example.com/", body: "someone else's site" });
    const wrongSite = await svc.checkDomainRouting("org-1");
    expect(wrongSite.routingActive).toBe(false);

    fetcher.fetchText.mockRejectedValue(new Error("ECONNREFUSED"));
    const down = await svc.checkDomainRouting("org-1");
    expect(down.routingActive).toBe(false);
    expect(down.reason).toContain("ECONNREFUSED");
  });
});

describe("EC8/EC10 native abandoned carts", () => {
  const H = 3600 * 1000;
  function abandonedWorld() {
    const prisma = makePrisma();
    seedShop(prisma);
    const mk = (id: string, over: any = {}) => ({
      id,
      organizationId: "org-1",
      token: `tok-${id}`,
      email: "buyer@example.com",
      phone: null,
      status: "open",
      createdAt: new Date(Date.now() - 3 * H),
      updatedAt: new Date(Date.now() - 2 * H),
      ...over,
    });
    prisma.storeCart.rows.push(
      mk("c1"),
      mk("c2", { updatedAt: new Date(Date.now() - 30 * 60 * 1000) }), // too recent
      mk("c3", { email: null, phone: "01700000000" }), // phone only
      mk("c4", { status: "converted" }), // already ordered
      mk("c5", { email: null, phone: null }), // no contact
      mk("c6", { updatedAt: new Date(Date.now() - 8 * 24 * H) }), // too old
      mk("c7"), // no items
    );
    prisma.storeCartItem.rows.push(
      { id: "ci-1", cartId: "c1", productId: "p-a", variantId: null, quantity: 2, includeBump: false, createdAt: T0, updatedAt: T0 },
      { id: "ci-2", cartId: "c2", productId: "p-a", variantId: null, quantity: 1, includeBump: false, createdAt: T0, updatedAt: T0 },
      { id: "ci-3", cartId: "c3", productId: "p-b", variantId: null, quantity: 1, includeBump: false, createdAt: T0, updatedAt: T0 },
      { id: "ci-4", cartId: "c4", productId: "p-a", variantId: null, quantity: 1, includeBump: false, createdAt: T0, updatedAt: T0 },
      { id: "ci-5", cartId: "c5", productId: "p-a", variantId: null, quantity: 1, includeBump: false, createdAt: T0, updatedAt: T0 },
      { id: "ci-6", cartId: "c6", productId: "p-a", variantId: null, quantity: 1, includeBump: false, createdAt: T0, updatedAt: T0 },
    );
    const audit = {
      log: jest.fn(async (input: any) => {
        prisma.auditLog.rows.push({
          id: `al-${prisma.auditLog.rows.length + 1}`,
          organizationId: input.organizationId,
          action: input.action,
          entityType: input.entityType,
          entityId: input.entityId,
          metadata: input.metadata,
          createdAt: new Date(),
        });
      }),
    };
    const email = { send: jest.fn(async () => ({ providerMessageId: "msg-1" })) };
    const events = { emit: jest.fn() };
    const svc = new AbandonedCheckoutsService(prisma, audit as any, email as any, events as any, undefined);
    return { prisma, svc, audit, email, events };
  }

  it("listUnified includes only qualifying native carts (open, contact, items, 1h–7d window), priced from current products", async () => {
    const { svc } = abandonedWorld();
    const unified = await svc.listUnified("org-1");
    const native = unified.items.filter((i: any) => i.source === "native");
    expect(native.map((i: any) => i.id).sort()).toEqual(["c1", "c3"]);
    const c1 = native.find((i: any) => i.id === "c1");
    expect(c1.totalMinor).toBe("100000"); // 2 × current 50000
    expect(c1.checkoutUrl).toBe("/shop/shop-one");
    expect(c1.recovered).toBe(false);
    expect(c1.items[0]).toMatchObject({ name: "লেদার ওয়ালেট", quantity: 2 });
    // value-desc sort holds across the unified list
    expect(unified.items[0].id).toBe("c3"); // 120000 > 100000
  });

  it("recovery: marker discipline pins lastCartActivity; new activity can be recovered again; phone-only refused", async () => {
    const { prisma, svc, email, events } = abandonedWorld();
    const sent = await svc.sendRecovery("org-1", "user-1", "c1");
    expect(sent.sent).toBe(true);
    expect(email.send).toHaveBeenCalledTimes(1);
    expect((email.send as jest.Mock).mock.calls[0][0].to).toBe("buyer@example.com");
    expect((email.send as jest.Mock).mock.calls[0][0].text).toContain("/shop/shop-one");
    expect(events.emit).toHaveBeenCalledWith("cart.abandoned", expect.objectContaining({
      context: expect.objectContaining({ source: "native", cartId: "c1" }),
    }));
    const marker = prisma.auditLog.rows.find((r: any) => r.action === NATIVE_CART_RECOVERY_ACTION);
    expect(marker.entityId).toBe("c1");

    // The list now reports the send for this activity.
    const after = await svc.listUnified("org-1");
    expect(after.items.find((i: any) => i.id === "c1").recoverySentAt).not.toBeNull();

    await expect(svc.sendRecovery("org-1", "user-1", "c1")).rejects.toThrow(/ইতিমধ্যে পাঠানো হয়েছে/);
    expect(email.send).toHaveBeenCalledTimes(1);

    // New cart activity (still inside the abandoned window) re-arms it.
    prisma.storeCart.rows.find((r: any) => r.id === "c1").updatedAt = new Date(Date.now() - 90 * 60 * 1000);
    const again = await svc.sendRecovery("org-1", "user-1", "c1");
    expect(again.sent).toBe(true);
    expect(email.send).toHaveBeenCalledTimes(2);

    await expect(svc.sendRecovery("org-1", "user-1", "c3")).rejects.toThrow(/ইমেইল ঠিকানা নেই/);
    await expect(svc.sendRecovery("org-1", "user-1", "c4")).rejects.toThrow(/রূপান্তরিত/);
    await expect(svc.sendRecovery("org-1", "user-1", "missing-id")).rejects.toBeInstanceOf(NotFoundException);
  });

  it("a failed send writes no marker and emits no event", async () => {
    const { prisma, svc, email, events } = abandonedWorld();
    (email.send as jest.Mock).mockRejectedValue(new Error("SMTP down"));
    await expect(svc.sendNativeRecovery("org-1", "user-1", "c1")).rejects.toThrow(/ইমেইল পাঠানো যায়নি/);
    expect(prisma.auditLog.rows.filter((r: any) => r.action === NATIVE_CART_RECOVERY_ACTION)).toHaveLength(0);
    expect(events.emit).not.toHaveBeenCalled();
  });
});
