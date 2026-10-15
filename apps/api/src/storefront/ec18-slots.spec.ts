import { BadRequestException, NotFoundException } from "@nestjs/common";
import { StorefrontService } from "./storefront.service";
import { ProductsService } from "../products/products.service";
import { LandingsService } from "../landings/landings.service";

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
    order: makeTable(), orderItem: makeTable(), fulfillment: makeTable(), deliverySlot: makeTable(),
    landingPage: makeTable(), landingVariant: makeTable(), landingEvent: makeTable(),
  } as any;
}

const dhakaToday = () => new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Dhaka" }).format(new Date());
function addDays(dateStr: string, n: number): string {
  const [y, m, d] = dateStr.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d) + n * 24 * 3600 * 1000).toISOString().slice(0, 10);
}
const TODAY = dhakaToday();
const TOMORROW = addDays(TODAY, 1);

function seedShop(prisma: any) {
  prisma.organization.rows.push(
    { id: "org-1", slug: "shop-one", name: "Shop One Ltd", brandName: "ShopOne", logoUrl: null, primaryColor: null, customDomain: null },
    { id: "org-2", slug: "shop-two", name: "Shop Two", brandName: null, logoUrl: null, primaryColor: null, customDomain: null },
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
  prisma.deliverySlot.rows.push(
    { id: "slot-all", organizationId: "org-1", label: "সকাল ৯টা–১২টা", startTime: "09:00", endTime: "12:00", districtScope: null, capacityPerDay: null, active: true, createdAt: new Date(), updatedAt: new Date() },
    { id: "slot-ctg", organizationId: "org-1", label: "চট্টগ্রাম বিকেল", startTime: "15:00", endTime: "18:00", districtScope: ["চট্টগ্রাম"], capacityPerDay: null, active: true, createdAt: new Date(), updatedAt: new Date() },
    { id: "slot-off", organizationId: "org-1", label: "বন্ধ স্লট", startTime: "18:00", endTime: "20:00", districtScope: null, capacityPerDay: null, active: false, createdAt: new Date(), updatedAt: new Date() },
  );
}

function makeStorefront(prisma: any) {
  const audit = { log: jest.fn(async () => undefined) };
  const integrations = {
    upsertOrder: jest.fn(async (orgId: string, _s: any, o: any, source: string) => {
      await prisma.order.create({
        data: {
          organizationId: orgId, source, externalId: o.externalId, externalNumber: o.externalNumber,
          status: o.status, totalMinor: o.totalMinor, deliverySlotId: null, deliveryDate: null,
        },
      });
      return "created";
    }),
  };
  const svc = new StorefrontService(prisma, integrations as any, undefined, audit as any, undefined, undefined);
  return { svc, audit, integrations };
}

async function cartReady(svc: StorefrontService) {
  const { cartToken } = await svc.createCart("shop-one");
  await svc.patchCartLine("shop-one", cartToken, { productId: "p-a", quantity: 1 });
  return cartToken;
}
const checkoutDto = (cartToken: string, over: Record<string, any> = {}) => ({
  cartToken, name: "রহিম", phone: "01711111111", address: "বাড়ি ১, রোড ২", district: "ঢাকা", ...over,
});

describe("EC18 slots — staff CRUD", () => {
  it("create/update/delete are org-scoped, validated and audited; staffState lists slots", async () => {
    const prisma = makePrisma(); seedShop(prisma);
    const { svc, audit } = makeStorefront(prisma);
    const created: any = await svc.createSlot("org-1", "user-1", {
      label: " রাতের স্লট ", startTime: "20:00", endTime: "22:00",
      districtScope: ["ঢাকা", "ঢাকা"], capacityPerDay: 5,
    });
    expect(created.slot).toMatchObject({
      label: "রাতের স্লট", startTime: "20:00", endTime: "22:00",
      districtScope: ["ঢাকা"], capacityPerDay: 5, active: true,
    });
    expect(audit.log).toHaveBeenCalledWith(expect.objectContaining({
      action: "storefront.slot_created", entityType: "DeliverySlot", entityId: created.slot.id,
    }));
    await expect(svc.createSlot("org-1", "user-1", {
      label: "x", startTime: "10:00", endTime: "11:00", districtScope: ["টেকনাফ"],
    })).rejects.toThrow(/অজানা জেলা/);
    await expect(svc.updateSlot("org-2", "user-1", created.slot.id, { label: "hijack" }))
      .rejects.toBeInstanceOf(NotFoundException);
    await expect(svc.deleteSlot("org-2", "user-1", created.slot.id))
      .rejects.toThrow("Delivery slot not found in this organization");
    const upd: any = await svc.updateSlot("org-1", "user-1", created.slot.id, { capacityPerDay: null, active: false });
    expect(upd.slot.capacityPerDay).toBeNull();
    expect(upd.slot.active).toBe(false);
    expect(audit.log).toHaveBeenCalledWith(expect.objectContaining({ action: "storefront.slot_updated" }));
    const state = await svc.staffState("org-1");
    expect(state.slots.map((s: any) => s.id)).toContain(created.slot.id);
    const slotAll = state.slots.find((s: any) => s.id === "slot-all");
    expect(slotAll).toMatchObject({ districtScope: null, capacityPerDay: null, active: true });
    const del = await svc.deleteSlot("org-1", "user-1", created.slot.id);
    expect(del.deleted).toBe(true);
    expect(audit.log).toHaveBeenCalledWith(expect.objectContaining({ action: "storefront.slot_deleted" }));
  });
});

describe("EC18 slots — shop quote + checkout", () => {
  it("quote lists only slots applicable to the district (scoped slot hidden for other districts)", async () => {
    const prisma = makePrisma(); seedShop(prisma);
    const { svc } = makeStorefront(prisma);
    const cartToken = await cartReady(svc);
    const qDhaka: any = await svc.quote("shop-one", { cartToken, district: "ঢাকা" });
    expect(qDhaka.deliverySlots.map((s: any) => s.id)).toEqual(["slot-all"]);
    const cart2 = await cartReady(svc);
    const qCtg: any = await svc.quote("shop-one", { cartToken: cart2, district: "চট্টগ্রাম" });
    expect(qCtg.deliverySlots.map((s: any) => s.id).sort()).toEqual(["slot-all", "slot-ctg"]);
  });

  it("capacity-full slot refuses checkout and NO order is written; cancelled orders do not consume capacity", async () => {
    const prisma = makePrisma(); seedShop(prisma);
    prisma.deliverySlot.rows.push({
      id: "slot-cap1", organizationId: "org-1", label: "সীমিত স্লট", startTime: "10:00", endTime: "11:00",
      districtScope: null, capacityPerDay: 1, active: true, createdAt: new Date(), updatedAt: new Date(),
    });
    prisma.order.rows.push(
      { id: "o-existing", organizationId: "org-1", status: "processing", deliverySlotId: "slot-cap1", deliveryDate: TOMORROW },
      { id: "o-cancelled", organizationId: "org-1", status: "cancelled", deliverySlotId: "slot-cap1", deliveryDate: TOMORROW },
    );
    const { svc, integrations } = makeStorefront(prisma);
    const cartToken = await cartReady(svc);
    await expect(svc.checkout("shop-one", checkoutDto(cartToken, {
      deliverySlotId: "slot-cap1", deliveryDate: TOMORROW,
    }))).rejects.toThrow("এই স্লটটি পূর্ণ — অন্য স্লট বা তারিখ বেছে নিন");
    expect(integrations.upsertOrder).not.toHaveBeenCalled();
    expect(prisma.order.rows).toHaveLength(2);
  });

  it("district-mismatched slot is rejected at checkout with no order written", async () => {
    const prisma = makePrisma(); seedShop(prisma);
    const { svc, integrations } = makeStorefront(prisma);
    const cartToken = await cartReady(svc);
    await expect(svc.checkout("shop-one", checkoutDto(cartToken, {
      deliverySlotId: "slot-ctg", deliveryDate: TOMORROW,
    }))).rejects.toThrow("এই স্লটটি আপনার এলাকার জন্য প্রযোজ্য নয়");
    expect(integrations.upsertOrder).not.toHaveBeenCalled();
  });

  it("unlimited slot accepts, stamps the order and returns the slot summary", async () => {
    const prisma = makePrisma(); seedShop(prisma);
    const { svc } = makeStorefront(prisma);
    const cartToken = await cartReady(svc);
    const res: any = await svc.checkout("shop-one", checkoutDto(cartToken, {
      deliverySlotId: "slot-all", deliveryDate: TOMORROW,
    }));
    expect(res.success).toBe(true);
    expect(res.deliverySlot).toEqual({ id: "slot-all", label: "সকাল ৯টা–১২টা", date: TOMORROW });
    const orderRow = prisma.order.rows.find((o: any) => o.id === res.orderId);
    expect(orderRow.deliverySlotId).toBe("slot-all");
    expect(orderRow.deliveryDate).toBe(TOMORROW);
  });

  it("slot without date (and vice versa) is refused; inactive/unknown slots are refused; no order written", async () => {
    const prisma = makePrisma(); seedShop(prisma);
    const { svc, integrations } = makeStorefront(prisma);
    const c1 = await cartReady(svc);
    await expect(svc.checkout("shop-one", checkoutDto(c1, { deliverySlotId: "slot-all" })))
      .rejects.toThrow("স্লট বেছে নিলে তারিখও দিতে হবে");
    const c2 = await cartReady(svc);
    await expect(svc.checkout("shop-one", checkoutDto(c2, { deliverySlotId: "slot-off", deliveryDate: TOMORROW })))
      .rejects.toThrow("ডেলিভারি স্লটটি পাওয়া যায়নি বা বন্ধ আছে");
    const c3 = await cartReady(svc);
    await expect(svc.checkout("shop-one", checkoutDto(c3, { deliverySlotId: "nope", deliveryDate: TOMORROW })))
      .rejects.toThrow("ডেলিভারি স্লটটি পাওয়া যায়নি বা বন্ধ আছে");
    expect(integrations.upsertOrder).not.toHaveBeenCalled();
  });

  it("dates outside [today, today+7] (Asia/Dhaka) are rejected", async () => {
    const prisma = makePrisma(); seedShop(prisma);
    const { svc } = makeStorefront(prisma);
    await expect(svc.validateSlotChoice("org-1", "slot-all", addDays(TODAY, -1), "ঢাকা"))
      .rejects.toThrow("ডেলিভারির তারিখ আজ থেকে আগামী ৭ দিনের মধ্যে হতে হবে");
    await expect(svc.validateSlotChoice("org-1", "slot-all", addDays(TODAY, 8), "ঢাকা"))
      .rejects.toBeInstanceOf(BadRequestException);
    await expect(svc.validateSlotChoice("org-1", "slot-all", "2026-02-30", "ঢাকা"))
      .rejects.toThrow("ডেলিভারির তারিখ আজ থেকে আগামী ৭ দিনের মধ্যে হতে হবে");
    const ok = await svc.validateSlotChoice("org-1", "slot-all", addDays(TODAY, 7), "ঢাকা");
    expect(ok.id).toBe("slot-all");
    const todayOk = await svc.validateSlotChoice("org-1", "slot-all", TODAY, "ঢাকা");
    expect(todayOk.id).toBe("slot-all");
  });
});

describe("EC18 slots — single-product checkout (ProductsService)", () => {
  function setupSingle() {
    const prisma = makePrisma();
    prisma.product.rows.push({
      id: "p1", organizationId: "org-1", slug: "widget", status: "ACTIVE",
      name: "Widget", sku: "W-1", priceMinor: 10000n, currency: "BDT",
      categoryId: null, bumpTitle: null, bumpPriceMinor: null, variants: [],
      organization: {
        id: "org-1", name: "Shop",
        businessProfile: { deliveryChargeInsideMinor: 6000n, deliveryChargeOutsideMinor: 12000n },
      },
    });
    prisma.deliverySlot.rows.push(
      { id: "slot-all", organizationId: "org-1", label: "সকাল", startTime: "09:00", endTime: "12:00", districtScope: null, capacityPerDay: null, active: true },
      { id: "slot-dhaka", organizationId: "org-1", label: "ঢাকা শুধু", startTime: "12:00", endTime: "15:00", districtScope: ["ঢাকা"], capacityPerDay: null, active: true },
      { id: "slot-off", organizationId: "org-1", label: "বন্ধ", startTime: "15:00", endTime: "16:00", districtScope: null, capacityPerDay: null, active: false },
    );
    const audit: any = { log: jest.fn(async () => undefined) };
    const integrations: any = {
      upsertOrder: jest.fn(async (orgId: string, _x: any, o: any, source: string) => {
        await prisma.order.create({
          data: {
            organizationId: orgId, source, externalId: o.externalId, externalNumber: o.externalNumber,
            status: o.status, totalMinor: o.totalMinor, deliverySlotId: null, deliveryDate: null,
          },
        });
        return "created";
      }),
    };
    const products = new ProductsService(prisma, audit, undefined, integrations, undefined, undefined);
    const dto: any = {
      customerName: "Test User", customerPhone: "01700000000",
      customerAddress: "Khulna, Bangladesh", quantity: 1,
    };
    return { prisma, products, integrations, dto };
  }

  it("a district-scoped slot is rejected (district unknown on this path) and no order is written", async () => {
    const { products, integrations, dto } = setupSingle();
    await expect(products.placePublicOrder("widget", {
      ...dto, deliverySlotId: "slot-dhaka", deliveryDate: TOMORROW,
    })).rejects.toThrow("এই স্লটটি আপনার এলাকার জন্য প্রযোজ্য নয়");
    expect(integrations.upsertOrder).not.toHaveBeenCalled();
  });

  it("an all-district slot is accepted and stamped onto the created order", async () => {
    const { prisma, products, dto } = setupSingle();
    const res: any = await products.placePublicOrder("widget", {
      ...dto, deliverySlotId: "slot-all", deliveryDate: TOMORROW,
    });
    expect(res.success).toBe(true);
    expect(prisma.order.rows).toHaveLength(1);
    expect(prisma.order.rows[0].deliverySlotId).toBe("slot-all");
    expect(prisma.order.rows[0].deliveryDate).toBe(TOMORROW);
  });

  it("getPublicProductBySlug lists only active all-district slots", async () => {
    const { products } = setupSingle();
    const info: any = await products.getPublicProductBySlug("widget");
    expect(info.organization.deliverySlots).toEqual([
      { id: "slot-all", label: "সকাল", startTime: "09:00", endTime: "12:00" },
    ]);
  });
});

describe("EC18 slots — landing order (LandingsService)", () => {
  function setupLanding() {
    const prisma = makePrisma();
    prisma.organization.rows.push({ id: "org-1", slug: "shop-one", name: "Shop One Ltd" });
    prisma.businessProfile.rows.push({
      id: "bp-1", organizationId: "org-1", metaPixelId: null, tikTokPixelId: null,
      deliveryChargeInsideMinor: 6000n, deliveryChargeOutsideMinor: 12000n,
    });
    prisma.product.rows.push({
      id: "p-a", organizationId: "org-1", name: "ওয়ালেট", slug: "wallet", description: null, category: null,
      categoryId: null, sku: "WAL-1", status: "ACTIVE", priceMinor: 50000n, compareAtMinor: null, currency: "BDT",
      stockQuantity: 10, lowStockThreshold: null, imageUrl: null, bumpTitle: null, bumpPriceMinor: null, bumpImageUrl: null,
    });
    prisma.landingPage.rows.push({
      id: "land-1", organizationId: "org-1", productId: "p-a", slug: "wallet-offer",
      title: "অফার", status: "published", sections: null, upsellProductId: null,
    });
    prisma.deliverySlot.rows.push(
      { id: "slot-dhaka", organizationId: "org-1", label: "ঢাকা সকাল", startTime: "09:00", endTime: "12:00", districtScope: ["ঢাকা"], capacityPerDay: null, active: true },
      { id: "slot-all", organizationId: "org-1", label: "সবার জন্য", startTime: "12:00", endTime: "15:00", districtScope: null, capacityPerDay: null, active: true },
    );
    const audit: any = { log: jest.fn(async () => undefined) };
    const integrations: any = {
      upsertOrder: jest.fn(async (orgId: string, _x: any, o: any, source: string) => {
        await prisma.order.create({
          data: {
            organizationId: orgId, source, externalId: o.externalId, externalNumber: o.externalNumber,
            status: o.status, totalMinor: o.totalMinor, landingPageId: null, landingVariantId: null,
            deliverySlotId: null, deliveryDate: null,
          },
        });
        return "created";
      }),
    };
    const storefront = new StorefrontService(prisma);
    const svc = new LandingsService(prisma, audit, storefront as any, undefined, integrations as any, undefined, null);
    const dto: any = {
      customerName: "Test User", customerPhone: "01700000000",
      customerAddress: "Dhaka, Bangladesh", quantity: 1, district: "ঢাকা",
    };
    return { prisma, svc, integrations, dto };
  }

  it("a scoped slot with a matching district is accepted and stamped with the attribution update", async () => {
    const { prisma, svc, dto } = setupLanding();
    const res: any = await svc.placeOrder("wallet-offer", {
      ...dto, deliverySlotId: "slot-dhaka", deliveryDate: TOMORROW,
    });
    expect(res.success).toBe(true);
    expect(prisma.order.rows).toHaveLength(1);
    expect(prisma.order.rows[0].deliverySlotId).toBe("slot-dhaka");
    expect(prisma.order.rows[0].deliveryDate).toBe(TOMORROW);
    expect(prisma.order.rows[0].landingPageId).toBe("land-1");
  });

  it("a scoped slot with a mismatched district is refused and no order is written", async () => {
    const { prisma, svc, integrations, dto } = setupLanding();
    await expect(svc.placeOrder("wallet-offer", {
      ...dto, district: "খুলনা", deliverySlotId: "slot-dhaka", deliveryDate: TOMORROW,
    })).rejects.toThrow("এই স্লটটি আপনার এলাকার জন্য প্রযোজ্য নয়");
    expect(integrations.upsertOrder).not.toHaveBeenCalled();
    expect(prisma.order.rows).toHaveLength(0);
  });

  it("the public landing payload lists ALL active slots with their scopes", async () => {
    const { svc } = setupLanding();
    const payload: any = await svc.getPublicLanding("wallet-offer");
    expect(payload.deliverySlots).toEqual([
      { id: "slot-dhaka", label: "ঢাকা সকাল", startTime: "09:00", endTime: "12:00", districtScope: ["ঢাকা"] },
      { id: "slot-all", label: "সবার জন্য", startTime: "12:00", endTime: "15:00", districtScope: null },
    ]);
  });
});
