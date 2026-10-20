import { BadRequestException, NotFoundException } from "@nestjs/common";
import { ApiException } from "../i18n";
import { StorefrontService } from "./storefront.service";
import { DeliveryPricingService, cartWeightOf, ruleMatches } from "./delivery-pricing.service";
import { validateDiscount } from "../commerce/discounts";

/* Fake prisma in the EC spec style (self-contained copy). */
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
    category: makeTable(), product: makeTable(), productVariant: makeTable(), productImage: makeTable(),
    shippingZone: makeTable(), storeCart: makeTable(), storeCartItem: makeTable(),
    order: makeTable(), orderItem: makeTable(), fulfillment: makeTable(),
    customer: makeTable(), storeDiscount: makeTable(), deliverySlot: makeTable(),
    shippingRateRule: makeTable(), pickupPoint: makeTable(),
  } as any;
}

const T0 = new Date("2026-10-01T00:00:00Z");
const T1 = new Date("2026-10-02T00:00:00Z");

function seedWorld(prisma: any, opts: { zones?: boolean } = {}) {
  prisma.organization.rows.push(
    { id: "org-1", slug: "shop-one", name: "Shop One Ltd", brandName: "ShopOne", logoUrl: null, primaryColor: null, customDomain: null },
    { id: "org-2", slug: "shop-two", name: "Shop Two", brandName: null, logoUrl: null, primaryColor: null, customDomain: null },
  );
  prisma.storefrontSetting.rows.push(
    { id: "set-1", organizationId: "org-1", shopEnabled: true, shopName: null, createdAt: T0, updatedAt: T0 },
  );
  const base = {
    organizationId: "org-1", description: null, category: null, categoryId: null,
    status: "ACTIVE", currency: "BDT", stockQuantity: null, lowStockThreshold: null,
    imageUrl: null, bumpTitle: null, bumpPriceMinor: null, bumpImageUrl: null,
    compareAtMinor: null, createdAt: T0, updatedAt: T0,
  };
  prisma.product.rows.push(
    { ...base, id: "p-heavy", name: "ভারী পণ্য", slug: "heavy", sku: "HVY-1", priceMinor: 50000n, weightGrams: 2000 },
    { ...base, id: "p-light", name: "হালকা পণ্য", slug: "light", sku: "LGT-1", priceMinor: 30000n, weightGrams: 500 },
    { ...base, id: "p-noweight", name: "ওজনহীন পণ্য", slug: "noweight", sku: "NW-1", priceMinor: 40000n, weightGrams: null },
  );
  if (opts.zones !== false) {
    prisma.shippingZone.rows.push({
      id: "z-main", organizationId: "org-1", name: "সব জায়গায়", kind: "all", districts: null,
      chargeMinor: 6000n, deliveryDays: 3, freeAboveMinor: null, active: true, position: 0,
      createdAt: T0, updatedAt: T0,
    });
  }
  prisma.pickupPoint.rows.push(
    { id: "pp-1", organizationId: "org-1", name: "খুলনা আউটলেট", address: "১২ সোনাডাঙ্গা", district: "খুলনা", phone: "01700000000", feeMinor: 1500n, active: true, createdAt: T0, updatedAt: T0 },
    { id: "pp-off", organizationId: "org-1", name: "বন্ধ আউটলেট", address: "ঠিকানা", district: "ঢাকা", phone: null, feeMinor: 0n, active: false, createdAt: T0, updatedAt: T0 },
    { id: "pp-foreign", organizationId: "org-2", name: "অন্য দোকানের পয়েন্ট", address: "ঠিকানা", district: "ঢাকা", phone: null, feeMinor: 0n, active: true, createdAt: T0, updatedAt: T0 },
  );
  return prisma;
}

function ruleRow(over: Record<string, any> = {}) {
  return {
    id: "r-1", organizationId: "org-1", shippingZoneId: null,
    minWeightGrams: null, maxWeightGrams: null, chargeMinor: 2500n,
    priority: 0, active: true, createdAt: T0, updatedAt: T0, ...over,
  };
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
    redeem: jest.fn(async () => null),
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

function makeServices(prisma: any, opts: { withPricing?: boolean } = {}) {
  const audit = { log: jest.fn(async () => undefined) };
  const pricing = new DeliveryPricingService(prisma, audit as any);
  const integrations = makeIntegrationsStub(prisma);
  const discounts = makeDiscountsStub(prisma);
  const svc = new StorefrontService(
    prisma,
    integrations as any,
    discounts as any,
    audit as any,
    undefined,
    undefined,
    undefined,
    undefined,
    opts.withPricing === false ? undefined : (pricing as any),
  );
  return { svc, pricing, integrations, audit };
}

async function cartWith(svc: StorefrontService, lines: Array<any>) {
  const { cartToken } = await svc.createCart("shop-one");
  for (const line of lines) {
    await svc.patchCartLine("shop-one", cartToken, line);
  }
  return cartToken;
}

describe("EC30 ruleMatches (pure)", () => {
  const bounded = { shippingZoneId: null, minWeightGrams: 1000, maxWeightGrams: 2000 };

  it("weight bounds are INCLUSIVE at min and at max", () => {
    expect(ruleMatches(bounded, "z-main", 1000)).toBe(true);
    expect(ruleMatches(bounded, "z-main", 2000)).toBe(true);
    expect(ruleMatches(bounded, "z-main", 1500)).toBe(true);
    expect(ruleMatches(bounded, "z-main", 999)).toBe(false);
    expect(ruleMatches(bounded, "z-main", 2001)).toBe(false);
  });

  it("unknown weight: bounded rule never matches, boundless rule matches", () => {
    expect(ruleMatches(bounded, "z-main", null)).toBe(false);
    expect(ruleMatches({ shippingZoneId: null, minWeightGrams: 0, maxWeightGrams: null }, "z-main", null)).toBe(false);
    expect(ruleMatches({ shippingZoneId: null, minWeightGrams: null, maxWeightGrams: null }, "z-main", null)).toBe(true);
  });

  it("zone-scoped rule does not match another zone; unscoped matches any zone", () => {
    const scoped = { shippingZoneId: "z-a", minWeightGrams: null, maxWeightGrams: null };
    expect(ruleMatches(scoped, "z-b", 500)).toBe(false);
    expect(ruleMatches(scoped, "z-a", 500)).toBe(true);
    expect(ruleMatches(bounded, "z-anything", 1500)).toBe(true);
  });
});

describe("EC30 cartWeightOf (pure)", () => {
  it("sums weightGrams × quantity when every line is weighed", () => {
    const out = cartWeightOf([
      { product: { weightGrams: 2000 }, quantity: 2 },
      { product: { weightGrams: 500 }, quantity: 3 },
    ]);
    expect(out).toEqual({ totalGrams: 5500, allKnown: true });
  });

  it("one unweighed line makes the whole cart weight unknown (never invented)", () => {
    const out = cartWeightOf([
      { product: { weightGrams: 2000 }, quantity: 1 },
      { product: { weightGrams: null }, quantity: 1 },
    ]);
    expect(out).toEqual({ totalGrams: null, allKnown: false });
  });
});

describe("EC30 matchRule ordering", () => {
  it("higher priority wins over lower priority", async () => {
    const prisma = seedWorld(makePrisma());
    prisma.shippingRateRule.rows.push(
      ruleRow({ id: "r-low", priority: 1, chargeMinor: 1111n, createdAt: T0 }),
      ruleRow({ id: "r-high", priority: 5, chargeMinor: 2222n, createdAt: T1 }),
    );
    const { pricing } = makeServices(prisma);
    const hit = await pricing.matchRule("org-1", "z-main", 100);
    expect(hit?.id).toBe("r-high");
  });

  it("priority tie breaks by earliest createdAt", async () => {
    const prisma = seedWorld(makePrisma());
    prisma.shippingRateRule.rows.push(
      ruleRow({ id: "r-later", priority: 5, createdAt: T1 }),
      ruleRow({ id: "r-earlier", priority: 5, createdAt: T0 }),
    );
    const { pricing } = makeServices(prisma);
    const hit = await pricing.matchRule("org-1", "z-main", 100);
    expect(hit?.id).toBe("r-earlier");
  });

  it("inactive rules and other orgs' rules never match; missing table reads as no rule", async () => {
    const prisma = seedWorld(makePrisma());
    prisma.shippingRateRule.rows.push(
      ruleRow({ id: "r-off", active: false }),
      ruleRow({ id: "r-foreign", organizationId: "org-2" }),
    );
    const { pricing } = makeServices(prisma);
    expect(await pricing.matchRule("org-1", "z-main", 100)).toBeNull();
    const bare = new DeliveryPricingService({} as any);
    expect(await bare.matchRule("org-1", "z-main", 100)).toBeNull();
  });
});

describe("EC30 resolveDeliveryCharge", () => {
  const zone = { id: "z-main", chargeMinor: 6000n, freeAboveMinor: null };

  it("a matching rule REPLACES the zone flat charge", async () => {
    const prisma = seedWorld(makePrisma());
    prisma.shippingRateRule.rows.push(ruleRow({ id: "r-band", minWeightGrams: 1000, maxWeightGrams: 3000, chargeMinor: 2500n }));
    const { svc } = makeServices(prisma);
    const res = await svc.resolveDeliveryCharge("org-1", zone, { weightGrams: 2000, discountedSubtotal: 50000n });
    expect(res).toEqual({ deliveryMinor: 2500n, rateRuleId: "r-band", zoneFreeShipping: false });
  });

  it("free-above zeroes the charge, reports rateRuleId null and the flag (threshold priced it, not the rule)", async () => {
    const prisma = seedWorld(makePrisma());
    prisma.shippingRateRule.rows.push(ruleRow({ id: "r-band", minWeightGrams: 1000, maxWeightGrams: 3000, chargeMinor: 2500n }));
    const { svc } = makeServices(prisma);
    const res = await svc.resolveDeliveryCharge(
      "org-1",
      { ...zone, freeAboveMinor: 100000n },
      { weightGrams: 2000, discountedSubtotal: 120000n },
    );
    expect(res).toEqual({ deliveryMinor: 0n, rateRuleId: null, zoneFreeShipping: true });
  });

  it("legacy parity without the EC30 service: flat below the threshold, zero at it", async () => {
    const prisma = seedWorld(makePrisma());
    const { svc } = makeServices(prisma, { withPricing: false });
    const below = await svc.resolveDeliveryCharge(
      "org-1", { ...zone, freeAboveMinor: 100000n }, { weightGrams: 2000, discountedSubtotal: 50000n },
    );
    expect(below).toEqual({ deliveryMinor: 6000n, rateRuleId: null, zoneFreeShipping: false });
    const at = await svc.resolveDeliveryCharge(
      "org-1", { ...zone, freeAboveMinor: 100000n }, { weightGrams: null, discountedSubtotal: 100000n },
    );
    expect(at).toEqual({ deliveryMinor: 0n, rateRuleId: null, zoneFreeShipping: true });
  });
});

describe("EC30 computeQuote — pickup", () => {
  it("pickup fee lands in the total and the zone is never consulted (org has NO zones at all)", async () => {
    const prisma = seedWorld(makePrisma(), { zones: false });
    const { svc } = makeServices(prisma);
    const token = await cartWith(svc, [{ productId: "p-heavy", quantity: 1 }]);
    const q = await svc.quote("shop-one", {
      cartToken: token, district: "ঢাকা", deliveryMethod: "pickup", pickupPointId: "pp-1",
    });
    expect(q.deliveryMethod).toBe("pickup");
    expect(q.zone).toBeNull();
    expect(q.deliveryMinor).toBe("1500");
    expect(q.totalMinor).toBe("51500"); // 50000 merchandise + 1500 point fee
    expect(q.pickupPoint).toEqual({
      id: "pp-1", name: "খুলনা আউটলেট", address: "১২ সোনাডাঙ্গা", district: "খুলনা",
      phone: "01700000000", feeMinor: "1500",
    });
    expect(q.shippingRateRuleId).toBeNull();
    expect(q.zoneFreeShippingApplied).toBe(false);
    expect(q.freeShippingZoneId).toBeNull();
  });

  it("foreign or inactive pickup point → verbatim Bengali 400", async () => {
    const prisma = seedWorld(makePrisma());
    const { svc } = makeServices(prisma);
    const token = await cartWith(svc, [{ productId: "p-heavy", quantity: 1 }]);
    const MSG = "পিকআপ পয়েন্টটি পাওয়া যায়নি বা বন্ধ আছে — অন্য পয়েন্ট বেছে নিন";
    await expect(
      svc.quote("shop-one", { cartToken: token, district: "ঢাকা", deliveryMethod: "pickup", pickupPointId: "pp-foreign" }),
    ).rejects.toThrow(MSG);
    await expect(
      svc.quote("shop-one", { cartToken: token, district: "ঢাকা", deliveryMethod: "pickup", pickupPointId: "pp-off" }),
    ).rejects.toThrow(MSG);
  });

  it("pickup without the EC30 service is honestly refused", async () => {
    const prisma = seedWorld(makePrisma());
    const { svc } = makeServices(prisma, { withPricing: false });
    const token = await cartWith(svc, [{ productId: "p-heavy", quantity: 1 }]);
    await expect(
      svc.quote("shop-one", { cartToken: token, district: "ঢাকা", deliveryMethod: "pickup", pickupPointId: "pp-1" }),
    ).rejects.toThrow("পিকআপ সুবিধা এই deployment-এ নেই");
  });

  it("home quote with a matching rule carries the rule id + stamp fields in the serialization", async () => {
    const prisma = seedWorld(makePrisma());
    prisma.shippingRateRule.rows.push(ruleRow({ id: "r-band", minWeightGrams: 1000, maxWeightGrams: 3000, chargeMinor: 2500n, priority: 10 }));
    const { svc } = makeServices(prisma);
    const token = await cartWith(svc, [{ productId: "p-heavy", quantity: 1 }]); // 2000g
    const q = await svc.quote("shop-one", { cartToken: token, district: "ঢাকা" });
    expect(q.deliveryMethod).toBe("home");
    expect(q.pickupPoint).toBeNull();
    expect(q.deliveryMinor).toBe("2500");
    expect(q.shippingRateRuleId).toBe("r-band");
    expect(q.zoneFreeShippingApplied).toBe(false);
    expect(q.freeShippingZoneId).toBeNull();
  });

  it("home quote over the free-above threshold: delivery 0, zone id stamped, rule id null", async () => {
    const prisma = seedWorld(makePrisma());
    prisma.shippingZone.rows[0].freeAboveMinor = 100000n;
    prisma.shippingRateRule.rows.push(ruleRow({ id: "r-band", minWeightGrams: 1000, maxWeightGrams: 9000, chargeMinor: 2500n, priority: 10 }));
    const { svc } = makeServices(prisma);
    const token = await cartWith(svc, [{ productId: "p-heavy", quantity: 3 }]); // 150000 subtotal, 6000g
    const q = await svc.quote("shop-one", { cartToken: token, district: "ঢাকা" });
    expect(q.deliveryMinor).toBe("0");
    expect(q.zoneFreeShippingApplied).toBe(true);
    expect(q.freeShippingZoneId).toBe("z-main");
    expect(q.shippingRateRuleId).toBeNull();
  });
});

describe("EC30 checkout stamps", () => {
  const buyer = { name: "রহিম উদ্দিন", phone: "01711111111", address: "বাড়ি ১, রোড ২", district: "ঢাকা" };

  it("home checkout with a matching rule charges the rule amount and stamps the order", async () => {
    const prisma = seedWorld(makePrisma());
    prisma.shippingRateRule.rows.push(ruleRow({ id: "r-band", minWeightGrams: 1000, maxWeightGrams: 3000, chargeMinor: 2500n, priority: 10 }));
    const { svc, integrations } = makeServices(prisma);
    const token = await cartWith(svc, [{ productId: "p-heavy", quantity: 1 }]);
    const res: any = await svc.checkout("shop-one", { cartToken: token, ...buyer });
    const payload = (integrations.upsertOrder as jest.Mock).mock.calls[0][2];
    expect(payload.shippingMinor).toBe(2500n);
    expect(res.deliveryMethod).toBe("home");
    expect(res.pickupPoint).toBeNull();
    const row = prisma.order.rows[0];
    expect(row.deliveryMethod).toBe("home");
    expect(row.pickupPointId).toBeNull();
    expect(row.freeShippingApplied).toBe(false);
    expect(row.freeShippingZoneId).toBeNull();
    expect(row.shippingRateRuleId).toBe("r-band");
  });

  it("home checkout without any rule charges the zone flat charge EXACTLY (parity)", async () => {
    const prisma = seedWorld(makePrisma());
    const { svc, integrations } = makeServices(prisma);
    const token = await cartWith(svc, [{ productId: "p-heavy", quantity: 1 }]);
    await svc.checkout("shop-one", { cartToken: token, ...buyer });
    const payload = (integrations.upsertOrder as jest.Mock).mock.calls[0][2];
    expect(payload.shippingMinor).toBe(6000n);
    expect(prisma.order.rows[0].shippingRateRuleId).toBeNull();
  });

  it("pickup checkout stamps method + point and the response carries them", async () => {
    const prisma = seedWorld(makePrisma());
    const { svc, integrations } = makeServices(prisma);
    const token = await cartWith(svc, [{ productId: "p-heavy", quantity: 1 }]);
    const res: any = await svc.checkout("shop-one", {
      cartToken: token, ...buyer, deliveryMethod: "pickup", pickupPointId: "pp-1",
    });
    const payload = (integrations.upsertOrder as jest.Mock).mock.calls[0][2];
    expect(payload.shippingMinor).toBe(1500n);
    expect(res.deliveryMethod).toBe("pickup");
    expect(res.pickupPoint?.id).toBe("pp-1");
    expect(res.totalMinor).toBe("51500");
    const row = prisma.order.rows[0];
    expect(row.deliveryMethod).toBe("pickup");
    expect(row.pickupPointId).toBe("pp-1");
    expect(row.shippingRateRuleId).toBeNull();
  });
});

describe("EC30 staff CRUD validation", () => {
  it("createRule: min > max → 400; negative charge → 400; foreign zone → 404", async () => {
    const prisma = seedWorld(makePrisma());
    const { pricing } = makeServices(prisma);
    await expect(
      pricing.createRule("org-1", "user-1", { chargeMinor: "2500", minWeightGrams: 3000, maxWeightGrams: 1000 }),
    ).rejects.toBeInstanceOf(ApiException);
    await expect(
      pricing.createRule("org-1", "user-1", { chargeMinor: "-5" }),
    ).rejects.toBeInstanceOf(ApiException);
    await expect(
      pricing.createRule("org-1", "user-1", { chargeMinor: "2500", shippingZoneId: "z-nope" }),
    ).rejects.toBeInstanceOf(ApiException);
    const ok: any = await pricing.createRule("org-1", "user-1", {
      chargeMinor: "2500", shippingZoneId: "z-main", minWeightGrams: 0, maxWeightGrams: 1000, priority: 3,
    });
    expect(ok.rule).toMatchObject({ chargeMinor: "2500", shippingZoneId: "z-main", priority: 3, active: true });
  });

  it("rules/points of another org are invisible to update/delete (404)", async () => {
    const prisma = seedWorld(makePrisma());
    const { pricing } = makeServices(prisma);
    await pricing.createRule("org-2", "user-9", { chargeMinor: "100" });
    const foreignRule = prisma.shippingRateRule.rows[prisma.shippingRateRule.rows.length - 1];
    await expect(pricing.updateRule("org-1", "user-1", foreignRule.id, { chargeMinor: "200" }))
      .rejects.toBeInstanceOf(ApiException);
    await expect(pricing.deletePoint("org-1", "user-1", "pp-foreign"))
      .rejects.toBeInstanceOf(ApiException);
  });

  it("createPoint: blank name → 400; fee defaults to \"0\" and serializes as a string", async () => {
    const prisma = seedWorld(makePrisma());
    const { pricing, audit } = makeServices(prisma);
    await expect(
      pricing.createPoint("org-1", "user-1", { name: "  ", address: "ঠিকানা", district: "ঢাকা" }),
    ).rejects.toBeInstanceOf(ApiException);
    const out: any = await pricing.createPoint("org-1", "user-1", {
      name: "নতুন পয়েন্ট", address: "বাজার রোড", district: "ঢাকা",
    });
    expect(out.point.feeMinor).toBe("0");
    expect(out.point.active).toBe(true);
    expect(audit.log).toHaveBeenCalledWith(
      expect.objectContaining({ action: "storefront.pickup_point_created", entityType: "PickupPoint" }),
    );
    const list: any = await pricing.listPoints("org-1");
    expect(list.points.map((p: any) => p.id)).toContain(out.point.id);
  });
});

describe("EC30 StorefrontService.listPublicPickupPoints (checkout picker feed)", () => {
  it("returns only the org's ACTIVE points, public fields only, fee as string", async () => {
    const prisma = seedWorld(makePrisma());
    const { svc } = makeServices(prisma);
    const out: any = await svc.listPublicPickupPoints("shop-one");
    expect(out.items).toEqual([
      { id: "pp-1", name: "খুলনা আউটলেট", address: "১২ সোনাডাঙ্গা", district: "খুলনা", phone: "01700000000", feeMinor: "1500" },
    ]);
  });

  it("404s for an unknown or disabled shop", async () => {
    const prisma = seedWorld(makePrisma());
    prisma.storefrontSetting.rows[0].shopEnabled = false;
    const { svc } = makeServices(prisma);
    await expect(svc.listPublicPickupPoints("shop-one")).rejects.toBeInstanceOf(ApiException);
    await expect(svc.listPublicPickupPoints("no-such-shop")).rejects.toBeInstanceOf(ApiException);
  });
});
