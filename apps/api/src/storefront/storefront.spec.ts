import { BadRequestException, NotFoundException } from "@nestjs/common";
import { ApiException } from "../i18n";
import { BD_DISTRICTS } from "@repo/contracts";
import { StorefrontService } from "./storefront.service";

/* Fake prisma in the EC spec style: equality, { in }, { not },
 * { gte/lte }, { contains, mode }, OR, orderBy (single or array),
 * skip/take. */
function matchWhere(row: any, where: any): boolean {
  for (const [k, v] of Object.entries(where ?? {})) {
    if (v === undefined) continue;
    if (k === "OR") {
      if (!(v as any[]).some((sub) => matchWhere(row, sub))) return false;
      continue;
    }
    if (k === "AND") {
      if (!(v as any[]).every((sub) => matchWhere(row, sub))) return false;
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
        const needle = String(cond.contains);
        const hit =
          cond.mode === "insensitive"
            ? hay.toLowerCase().includes(needle.toLowerCase())
            : hay.includes(needle);
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
        const cmp =
          av instanceof Date || bv instanceof Date
            ? new Date(av).getTime() - new Date(bv).getTime()
            : av < bv
              ? -1
              : 1;
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

export function makePrisma() {
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
  } as any;
}

const T0 = new Date("2026-10-01T00:00:00Z");

export function seedWorld(prisma: any) {
  const org1 = { id: "org-1", slug: "shop-one", name: "Shop One Ltd", brandName: "ShopOne", logoUrl: null, primaryColor: "#111111", customDomain: null };
  const org2 = { id: "org-2", slug: "shop-two", name: "Shop Two", brandName: null, logoUrl: null, primaryColor: null, customDomain: null };
  const org3 = { id: "org-3", slug: "shop-off", name: "Closed Shop", brandName: null, logoUrl: null, primaryColor: null, customDomain: null };
  prisma.organization.rows.push(org1, org2, org3);
  prisma.storefrontSetting.rows.push(
    { id: "set-1", organizationId: "org-1", shopEnabled: true, shopName: null, announcementText: "ঈদ অফার চলছে", showFeatured: true, showCategories: true, showSearch: true, metaDescription: null, featuredProductIds: null, domainVerifyToken: null, domainVerifiedAt: null, createdAt: T0, updatedAt: T0 },
    { id: "set-2", organizationId: "org-2", shopEnabled: true, shopName: "দ্বিতীয় দোকান", announcementText: null, showFeatured: true, showCategories: true, showSearch: true, metaDescription: null, featuredProductIds: null, domainVerifyToken: null, domainVerifiedAt: null, createdAt: T0, updatedAt: T0 },
    // org-3: no setting row at all ⇒ shop disabled.
  );
  prisma.businessProfile.rows.push({
    id: "bp-1", organizationId: "org-1", codAvailable: true, bkashNumber: "01700000000", nagadNumber: null, paymentNote: null,
    deliveryChargeInsideMinor: 6000n, deliveryChargeOutsideMinor: 12000n, freeDeliveryAboveMinor: null, deliveryDaysInside: 1, deliveryDaysOutside: 3,
  });
  prisma.category.rows.push({ id: "cat-1", organizationId: "org-1", name: "Wallets", slug: "wallets", createdAt: T0, updatedAt: T0 });
  prisma.product.rows.push(
    { id: "p-a", organizationId: "org-1", name: "লেদার ওয়ালেট", slug: "leather-wallet", description: "আসল চামড়া", category: "ওয়ালেট", categoryId: "cat-1", sku: "WAL-1", status: "ACTIVE", priceMinor: 50000n, compareAtMinor: 60000n, currency: "BDT", stockQuantity: 10, lowStockThreshold: null, imageUrl: "cover.jpg", bumpTitle: "কি-রিং যোগ করুন", bumpPriceMinor: 10000n, bumpImageUrl: null, seoTitle: null, seoDescription: null, createdAt: new Date("2026-10-02"), updatedAt: T0 },
    { id: "p-b", organizationId: "org-1", name: "ক্যানভাস ব্যাগ", slug: "canvas-bag", description: null, category: "ব্যাগ", categoryId: null, sku: "BAG-1", status: "ACTIVE", priceMinor: 120000n, compareAtMinor: null, currency: "BDT", stockQuantity: null, lowStockThreshold: null, imageUrl: null, bumpTitle: null, bumpPriceMinor: null, bumpImageUrl: null, seoTitle: null, seoDescription: null, createdAt: new Date("2026-10-03"), updatedAt: T0 },
    { id: "p-c", organizationId: "org-1", name: "কার্ড হোল্ডার", slug: "card-holder", description: null, category: null, categoryId: "cat-1", sku: "CRD-1", status: "ACTIVE", priceMinor: 30000n, compareAtMinor: null, currency: "BDT", stockQuantity: 0, lowStockThreshold: null, imageUrl: null, bumpTitle: null, bumpPriceMinor: null, bumpImageUrl: null, seoTitle: "কার্ড হোল্ডার SEO", seoDescription: null, createdAt: new Date("2026-10-04"), updatedAt: T0 },
    { id: "p-draft", organizationId: "org-1", name: "খসড়া পণ্য", slug: "draft-item", description: null, category: null, categoryId: null, sku: "DRF-1", status: "DRAFT", priceMinor: 1000n, compareAtMinor: null, currency: "BDT", stockQuantity: 5, lowStockThreshold: null, imageUrl: null, bumpTitle: null, bumpPriceMinor: null, bumpImageUrl: null, createdAt: new Date("2026-10-05"), updatedAt: T0 },
    { id: "p-other", organizationId: "org-2", name: "অন্য দোকানের পণ্য", slug: "other-item", description: null, category: null, categoryId: null, sku: "OTH-1", status: "ACTIVE", priceMinor: 9000n, compareAtMinor: null, currency: "BDT", stockQuantity: 5, lowStockThreshold: null, imageUrl: null, bumpTitle: null, bumpPriceMinor: null, bumpImageUrl: null, createdAt: T0, updatedAt: T0 },
  );
  prisma.productVariant.rows.push(
    { id: "v-a1", productId: "p-a", name: "কালো", sku: "WAL-1-BLK", priceMinor: 55000n, stockQuantity: 3, attributes: null, createdAt: T0, updatedAt: T0 },
  );
  prisma.productImage.rows.push(
    { id: "img-1", productId: "p-a", url: "cover.jpg", altText: null, position: 0, createdAt: T0, updatedAt: T0 },
    { id: "img-2", productId: "p-a", url: "side.jpg", altText: null, position: 1, createdAt: T0, updatedAt: T0 },
  );
  return { org1, org2, org3 };
}

function makeService(prisma: any) {
  const audit = { log: jest.fn(async () => undefined) };
  const svc = new StorefrontService(prisma, undefined, undefined, audit as any, undefined, undefined);
  return { svc, audit };
}

describe("BD_DISTRICTS (contracts)", () => {
  it("has exactly 64 unique districts including ঢাকা, and no non-district entries", () => {
    expect(BD_DISTRICTS.length).toBe(64);
    expect(new Set(BD_DISTRICTS).size).toBe(64);
    expect(BD_DISTRICTS).toContain("ঢাকা");
    expect(BD_DISTRICTS).toContain("কক্সবাজার");
    expect(BD_DISTRICTS).not.toContain("টেকনাফ" as any);
  });
});

describe("StorefrontService — shop availability + home", () => {
  it("404s when the org has no setting row, and when the slug is unknown", async () => {
    const prisma = makePrisma();
    seedWorld(prisma);
    const { svc } = makeService(prisma);
    await expect(svc.shopHome("shop-off", {})).rejects.toBeInstanceOf(ApiException);
    await expect(svc.shopHome("no-such-shop", {})).rejects.toBeInstanceOf(ApiException);
    await expect(svc.createCart("shop-off")).rejects.toBeInstanceOf(ApiException);
  });

  it("404s when shopEnabled is false", async () => {
    const prisma = makePrisma();
    seedWorld(prisma);
    prisma.storefrontSetting.rows[0].shopEnabled = false;
    const { svc } = makeService(prisma);
    await expect(svc.shopHome("shop-one", {})).rejects.toBeInstanceOf(ApiException);
  });

  it("home merges Category rows + legacy strings with ACTIVE counts, paginates, searches", async () => {
    const prisma = makePrisma();
    seedWorld(prisma);
    const { svc } = makeService(prisma);
    const home = await svc.shopHome("shop-one", {});
    expect(home.settings.shopName).toBe("ShopOne"); // brandName fallback
    expect(home.settings.announcementText).toBe("ঈদ অফার চলছে");
    expect(home.businessProfile.bkashNumber).toBe("01700000000");
    expect(home.districts.length).toBe(64);
    const wallets = home.categories.find((c: any) => c.id === "cat-1");
    expect(wallets!.productCount).toBe(2); // p-a + p-c, draft excluded
    const legacy = home.categories.find((c: any) => c.id === null && c.name === "ব্যাগ");
    expect(legacy!.productCount).toBe(1);
    expect(home.products.map((p: any) => p.id)).toEqual(["p-c", "p-b", "p-a"]); // newest first
    expect(home.pagination.total).toBe(3);
    const searched = await svc.shopHome("shop-one", { q: "ওয়ালেট" });
    expect(searched.products.map((p: any) => p.id)).toEqual(["p-a"]);
    const bySlug = await svc.shopHome("shop-one", { category: "wallets" });
    expect(bySlug.products.map((p: any) => p.id).sort()).toEqual(["p-a", "p-c"]);
    const byLegacy = await svc.shopHome("shop-one", { category: "ব্যাগ" });
    expect(byLegacy.products.map((p: any) => p.id)).toEqual(["p-b"]);
    const page2 = await svc.shopHome("shop-one", { page: 2, pageSize: 2 });
    expect(page2.products.map((p: any) => p.id)).toEqual(["p-a"]);
    expect(page2.pagination.totalPages).toBe(2);
  });

  it("featured follows the merchant's id order ∩ ACTIVE, else newest fallback", async () => {
    const prisma = makePrisma();
    seedWorld(prisma);
    const { svc } = makeService(prisma);
    const fallback = await svc.shopHome("shop-one", {});
    expect(fallback.featuredProducts.map((p: any) => p.id)).toEqual(["p-c", "p-b", "p-a"]);
    prisma.storefrontSetting.rows[0].featuredProductIds = ["p-b", "p-draft", "p-a"];
    const chosen = await svc.shopHome("shop-one", {});
    expect(chosen.featuredProducts.map((p: any) => p.id)).toEqual(["p-b", "p-a"]); // draft excluded
  });

  it("stock states: tracked 0 = out_of_stock, untracked product = untracked", async () => {
    const prisma = makePrisma();
    seedWorld(prisma);
    const { svc } = makeService(prisma);
    const home = await svc.shopHome("shop-one", {});
    const byId = Object.fromEntries(home.products.map((p: any) => [p.id, p]));
    expect(byId["p-c"].stockState).toBe("out_of_stock");
    expect(byId["p-b"].stockState).toBe("untracked");
    expect(byId["p-a"].stockState).toBe("in_stock");
    expect(byId["p-a"].priceMinor).toBe("50000");
  });
});

describe("StorefrontService — product detail", () => {
  it("gallery is cover-first without duplicating the cover; variants + related + SEO", async () => {
    const prisma = makePrisma();
    seedWorld(prisma);
    const { svc } = makeService(prisma);
    const detail = await svc.productDetail("shop-one", "leather-wallet");
    expect(detail.product.images).toEqual(["cover.jpg", "side.jpg"]);
    expect(detail.product.variants[0].stockState).toBe("low"); // 3 <= default threshold 5
    expect(detail.product.category).toMatchObject({ id: "cat-1", name: "Wallets", slug: "wallets", legacy: "ওয়ালেট" });
    expect(detail.related.map((p: any) => p.id)).toEqual(["p-c"]);
    const c = await svc.productDetail("shop-one", "card-holder");
    expect(c.product.seo.title).toBe("কার্ড হোল্ডার SEO");
  });

  it("detail 404s for drafts and for another org's product slug", async () => {
    const prisma = makePrisma();
    seedWorld(prisma);
    const { svc } = makeService(prisma);
    await expect(svc.productDetail("shop-one", "draft-item")).rejects.toBeInstanceOf(ApiException);
    await expect(svc.productDetail("shop-one", "other-item")).rejects.toBeInstanceOf(ApiException);
  });
});

describe("StorefrontService — cart", () => {
  async function setup() {
    const prisma = makePrisma();
    seedWorld(prisma);
    const { svc } = makeService(prisma);
    const { cartToken } = await svc.createCart("shop-one");
    return { prisma, svc, cartToken };
  }

  it("creates a cart and PATCH sets (not accumulates) a line; quantity 0 removes", async () => {
    const { svc, cartToken } = await setup();
    let r = await svc.patchCartLine("shop-one", cartToken, { productId: "p-a", quantity: 2 });
    expect(r.cart.items).toHaveLength(1);
    expect(r.cart.items[0]).toMatchObject({ productId: "p-a", quantity: 2, lineTotalMinor: "100000" });
    r = await svc.patchCartLine("shop-one", cartToken, { productId: "p-a", quantity: 5 });
    expect(r.cart.items[0].quantity).toBe(5);
    r = await svc.patchCartLine("shop-one", cartToken, { productId: "p-a", quantity: 0 });
    expect(r.cart.items).toHaveLength(0);
  });

  it("null-variant lines merge explicitly (no duplicate rows)", async () => {
    const { svc, prisma, cartToken } = await setup();
    await svc.patchCartLine("shop-one", cartToken, { productId: "p-b", quantity: 1 });
    await svc.patchCartLine("shop-one", cartToken, { productId: "p-b", quantity: 4 });
    expect(prisma.storeCartItem.rows).toHaveLength(1);
    expect(prisma.storeCartItem.rows[0].quantity).toBe(4);
  });

  it("tracked stock is enforced (product and variant), untracked is allowed", async () => {
    const { svc, cartToken } = await setup();
    await expect(
      svc.patchCartLine("shop-one", cartToken, { productId: "p-a", quantity: 11 }),
    ).rejects.toThrow(/স্টকে মাত্র 10টি/);
    await expect(
      svc.patchCartLine("shop-one", cartToken, { productId: "p-a", variantId: "v-a1", quantity: 4 }),
    ).rejects.toThrow(/স্টকে মাত্র 3টি/);
    const ok = await svc.patchCartLine("shop-one", cartToken, { productId: "p-a", variantId: "v-a1", quantity: 3 });
    expect(ok.cart.items[0].unitPriceMinor).toBe("55000"); // variant price wins
    const untracked = await svc.patchCartLine("shop-one", cartToken, { productId: "p-b", quantity: 99 });
    expect(untracked.cart.items.find((i: any) => i.productId === "p-b")?.quantity).toBe(99);
  });

  it("wrong token 404s, and a token never works under another org's slug", async () => {
    const { svc, cartToken } = await setup();
    await expect(svc.getCart("shop-one", "bogus-token")).rejects.toBeInstanceOf(ApiException);
    await expect(svc.getCart("shop-two", cartToken)).rejects.toBeInstanceOf(ApiException);
    await expect(
      svc.patchCartLine("shop-two", cartToken, { productId: "p-other", quantity: 1 }),
    ).rejects.toBeInstanceOf(ApiException);
    await expect(svc.getCart("shop-one", undefined)).rejects.toBeInstanceOf(ApiException);
  });

  it("rejects products of another org / inactive products and foreign variants", async () => {
    const { svc, cartToken } = await setup();
    await expect(
      svc.patchCartLine("shop-one", cartToken, { productId: "p-other", quantity: 1 }),
    ).rejects.toBeInstanceOf(ApiException);
    await expect(
      svc.patchCartLine("shop-one", cartToken, { productId: "p-draft", quantity: 1 }),
    ).rejects.toBeInstanceOf(ApiException);
    await expect(
      svc.patchCartLine("shop-one", cartToken, { productId: "p-b", variantId: "v-a1", quantity: 1 }),
    ).rejects.toBeInstanceOf(ApiException);
  });

  it("contact requires at least one of email/phone and stores trimmed values", async () => {
    const { svc, cartToken } = await setup();
    await expect(svc.setCartContact("shop-one", cartToken, {})).rejects.toBeInstanceOf(ApiException);
    const r = await svc.setCartContact("shop-one", cartToken, { email: "  a@b.com ", phone: " 01700000000 " });
    expect(r.cart.email).toBe("a@b.com");
    expect(r.cart.phone).toBe("01700000000");
  });
});

describe("StorefrontService — staff settings + zones", () => {
  it("settings upsert validates featured ids belong to the org", async () => {
    const prisma = makePrisma();
    seedWorld(prisma);
    const { svc, audit } = makeService(prisma);
    await expect(
      svc.updateSettings("org-1", "user-1", { featuredProductIds: ["p-other"] }),
    ).rejects.toBeInstanceOf(ApiException);
    const ok = await svc.updateSettings("org-1", "user-1", { shopName: "নতুন নাম", featuredProductIds: ["p-a"] });
    expect(ok.setting.shopName).toBe("নতুন নাম");
    expect(ok.setting.featuredProductIds).toEqual(["p-a"]);
    expect(audit.log).toHaveBeenCalled();
  });

  it("zone CRUD is org-scoped; money is minor-unit strings; district_list validates districts", async () => {
    const prisma = makePrisma();
    seedWorld(prisma);
    const { svc } = makeService(prisma);
    const created = await svc.createZone("org-1", "user-1", {
      name: "চট্টগ্রাম বিশেষ", kind: "district_list", districts: ["চট্টগ্রাম"], chargeMinor: "8000", freeAboveMinor: "100000",
    });
    expect(created.zone.chargeMinor).toBe("8000");
    expect(created.zone.freeAboveMinor).toBe("100000");
    await expect(
      svc.createZone("org-1", "user-1", { name: "x", kind: "district_list", districts: ["টেকনাফ"], chargeMinor: "1" }),
    ).rejects.toBeInstanceOf(ApiException);
    await expect(
      svc.createZone("org-1", "user-1", { name: "x", kind: "all", chargeMinor: "10.5" }),
    ).rejects.toBeInstanceOf(ApiException);
    await expect(svc.updateZone("org-2", "user-1", created.zone.id, { name: "hijack" })).rejects.toBeInstanceOf(ApiException);
    await expect(svc.deleteZone("org-2", "user-1", created.zone.id)).rejects.toBeInstanceOf(ApiException);
    const upd = await svc.updateZone("org-1", "user-1", created.zone.id, { chargeMinor: "9000" });
    expect(upd.zone.chargeMinor).toBe("9000");
    const del = await svc.deleteZone("org-1", "user-1", created.zone.id);
    expect(del.deleted).toBe(true);
  });

  it("default zones: refuses without BusinessProfile charges; creates only missing kinds", async () => {
    const prisma = makePrisma();
    seedWorld(prisma);
    const { svc } = makeService(prisma);
    // org-2 has no BusinessProfile row at all.
    await expect(svc.createDefaultZones("org-2", "user-1")).rejects.toThrow(/Business Profile/);
    const first = await svc.createDefaultZones("org-1", "user-1");
    expect(first.created.map((z: any) => z.kind).sort()).toEqual(["inside_dhaka", "outside_dhaka"]);
    expect(first.created.find((z: any) => z.kind === "inside_dhaka")?.chargeMinor).toBe("6000");
    expect(first.created.find((z: any) => z.kind === "inside_dhaka")?.name).toBe("ঢাকার ভিতরে");
    const second = await svc.createDefaultZones("org-1", "user-1");
    expect(second.created).toHaveLength(0);
    expect(second.zones).toHaveLength(2);
  });

  it("staff state reports setting, zones and domain info", async () => {
    const prisma = makePrisma();
    seedWorld(prisma);
    const { svc } = makeService(prisma);
    const state = await svc.staffState("org-1");
    expect(state.setting.exists).toBe(true);
    expect(state.organization.slug).toBe("shop-one");
    expect(state.domain.verifiedAt).toBeNull();
    expect(state.districts).toHaveLength(64);
    const empty = await svc.staffState("org-3");
    expect(empty.setting.exists).toBe(false);
    expect(empty.setting.shopEnabled).toBe(false);
  });
});
