import { validate } from "class-validator";
import { plainToInstance } from "class-transformer";
import { StorefrontService } from "./storefront.service";
import { UpdateStorefrontSettingsDto } from "./storefront.dto";

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
  } as any;
}

const daysAgo = (n: number) => new Date(Date.now() - n * 24 * 3600 * 1000);

function seedWorld(prisma: any, settingOver: Record<string, any> = {}) {
  prisma.organization.rows.push({
    id: "org-1", slug: "shop-one", name: "Shop One Ltd", brandName: "ShopOne",
    logoUrl: "logo.png", primaryColor: "#123456", customDomain: null,
  });
  prisma.storefrontSetting.rows.push({
    id: "set-1", organizationId: "org-1", shopEnabled: true, shopName: null,
    announcementText: null, showFeatured: true, showCategories: true, showSearch: true,
    metaDescription: null, featuredProductIds: null, domainVerifyToken: null, domainVerifiedAt: null,
    featuredMode: "top_sellers", locale: "en", trackingPageEnabled: true,
    returnPolicyText: "৭ দিনের রিটার্ন", deliveryPromiseText: "২৪ ঘণ্টায় ডেলিভারি", supportPhone: "01700000000",
    createdAt: daysAgo(40), updatedAt: daysAgo(40),
    ...settingOver,
  });
  const base = {
    organizationId: "org-1", description: null, category: null, categoryId: null,
    status: "ACTIVE", currency: "BDT", stockQuantity: null, lowStockThreshold: null,
    imageUrl: null, bumpTitle: null, bumpPriceMinor: null, bumpImageUrl: null,
    compareAtMinor: null, seoTitle: null, seoDescription: null, updatedAt: daysAgo(40),
  };
  prisma.product.rows.push(
    { ...base, id: "p-a", name: "ওয়ালেট", slug: "wallet", sku: "WAL-1", priceMinor: 50000n, createdAt: daysAgo(3) },
    { ...base, id: "p-b", name: "ব্যাগ", slug: "bag", sku: "BAG-1", priceMinor: 120000n, createdAt: daysAgo(2) },
    { ...base, id: "p-c", name: "কার্ড হোল্ডার", slug: "card", sku: "CRD-1", priceMinor: 30000n, createdAt: daysAgo(1) },
  );
  return prisma;
}

function order(prisma: any, id: string, over: Record<string, any> = {}) {
  prisma.order.rows.push({
    id, organizationId: "org-1", isPractice: false, status: "completed",
    placedAt: daysAgo(2), totalMinor: 0n, ...over,
  });
}
function item(prisma: any, orderId: string, over: Record<string, any> = {}) {
  prisma.orderItem.rows.push({
    id: `it-${prisma.orderItem.rows.length + 1}`, orderId,
    productId: null, sku: null, name: "x", quantity: 1, priceMinor: 0n, totalMinor: 0n, ...over,
  });
}
function makeService(prisma: any) {
  const audit = { log: jest.fn(async () => undefined) };
  const svc = new StorefrontService(prisma, undefined, undefined, audit as any, undefined, undefined);
  return { svc, audit };
}

describe("EC19 featured top_sellers", () => {
  it("orders by quantity desc across qualifying orders (completed OR delivered fulfillment)", async () => {
    const prisma = seedWorld(makePrisma());
    order(prisma, "o1"); // completed
    item(prisma, "o1", { productId: "p-a", quantity: 3, totalMinor: 150000n });
    item(prisma, "o1", { productId: "p-b", quantity: 3, totalMinor: 360000n });
    order(prisma, "o2", { status: "processing" });
    prisma.fulfillment.rows.push({ id: "f1", organizationId: "org-1", orderId: "o2", status: "delivered" });
    item(prisma, "o2", { productId: "p-a", quantity: 2, totalMinor: 100000n });
    const { svc } = makeService(prisma);
    const home = await svc.shopHome("shop-one", {});
    // p-a total qty 5 beats p-b qty 3.
    expect(home.featuredProducts.map((p: any) => p.id)).toEqual(["p-a", "p-b"]);
  });

  it("breaks quantity ties by revenue desc", async () => {
    const prisma = seedWorld(makePrisma());
    order(prisma, "o1");
    item(prisma, "o1", { productId: "p-a", quantity: 3, totalMinor: 150000n });
    item(prisma, "o1", { productId: "p-b", quantity: 3, totalMinor: 360000n });
    const { svc } = makeService(prisma);
    const home = await svc.shopHome("shop-one", {});
    expect(home.featuredProducts.map((p: any) => p.id)).toEqual(["p-b", "p-a"]);
  });

  it("excludes cancelled/refunded/failed, practice, stale (>30d) and unqualified processing orders", async () => {
    const prisma = seedWorld(makePrisma());
    order(prisma, "o-cancel", { status: "cancelled" });
    item(prisma, "o-cancel", { productId: "p-c", quantity: 99, totalMinor: 999999n });
    order(prisma, "o-refund", { status: "refunded" });
    item(prisma, "o-refund", { productId: "p-c", quantity: 99, totalMinor: 999999n });
    order(prisma, "o-practice", { isPractice: true });
    item(prisma, "o-practice", { productId: "p-c", quantity: 99, totalMinor: 999999n });
    order(prisma, "o-old", { placedAt: daysAgo(45) });
    item(prisma, "o-old", { productId: "p-c", quantity: 99, totalMinor: 999999n });
    order(prisma, "o-processing", { status: "processing" }); // no delivered fulfillment
    item(prisma, "o-processing", { productId: "p-c", quantity: 99, totalMinor: 999999n });
    order(prisma, "o-ok");
    item(prisma, "o-ok", { productId: "p-a", quantity: 1, totalMinor: 50000n });
    const { svc } = makeService(prisma);
    const home = await svc.shopHome("shop-one", {});
    expect(home.featuredProducts.map((p: any) => p.id)).toEqual(["p-a"]);
  });

  it("resolves productId-less items via SKU against ACTIVE products; skips bump + unknown + non-active", async () => {
    const prisma = seedWorld(makePrisma());
    prisma.product.rows.push({
      id: "p-draft", organizationId: "org-1", name: "খসড়া", slug: "draft", sku: "DRF-1",
      description: null, category: null, categoryId: null, status: "DRAFT", currency: "BDT",
      priceMinor: 1000n, compareAtMinor: null, stockQuantity: null, lowStockThreshold: null,
      imageUrl: null, bumpTitle: null, bumpPriceMinor: null, bumpImageUrl: null,
      seoTitle: null, seoDescription: null, createdAt: daysAgo(1), updatedAt: daysAgo(1),
    });
    order(prisma, "o1");
    item(prisma, "o1", { sku: "BAG-1", quantity: 4, totalMinor: 480000n }); // → p-b
    item(prisma, "o1", { sku: "ADD-ON-BUMP", quantity: 50, totalMinor: 500000n }); // skipped
    item(prisma, "o1", { sku: "NOPE-1", quantity: 50, totalMinor: 500000n }); // unresolved
    item(prisma, "o1", { productId: "p-draft", quantity: 50, totalMinor: 500000n }); // not ACTIVE
    const { svc } = makeService(prisma);
    const home = await svc.shopHome("shop-one", {});
    expect(home.featuredProducts.map((p: any) => p.id)).toEqual(["p-b"]);
  });

  it("empty sales fall back to merchant picks, then to newest", async () => {
    const prisma = seedWorld(makePrisma(), { featuredProductIds: ["p-c", "p-a"] });
    const { svc } = makeService(prisma);
    const home = await svc.shopHome("shop-one", {});
    expect(home.featuredProducts.map((p: any) => p.id)).toEqual(["p-c", "p-a"]);
    prisma.storefrontSetting.rows[0].featuredProductIds = null;
    const home2 = await svc.shopHome("shop-one", {});
    expect(home2.featuredProducts.map((p: any) => p.id)).toEqual(["p-c", "p-b", "p-a"]); // newest first (all list order)
  });

  it("merchant_picks mode keeps the existing behaviour even when sales exist", async () => {
    const prisma = seedWorld(makePrisma(), { featuredMode: "merchant_picks", featuredProductIds: ["p-c"] });
    order(prisma, "o1");
    item(prisma, "o1", { productId: "p-a", quantity: 9, totalMinor: 450000n });
    const { svc } = makeService(prisma);
    const home = await svc.shopHome("shop-one", {});
    expect(home.featuredProducts.map((p: any) => p.id)).toEqual(["p-c"]);
  });
});

describe("EC19 locale + trust fields in payloads", () => {
  it("shopHome settings carry locale/featuredMode/tracking + trust copy", async () => {
    const prisma = seedWorld(makePrisma());
    const { svc } = makeService(prisma);
    const home = await svc.shopHome("shop-one", {});
    expect(home.settings).toMatchObject({
      locale: "en", featuredMode: "top_sellers", trackingPageEnabled: true,
      returnPolicyText: "৭ দিনের রিটার্ন", deliveryPromiseText: "২৪ ঘণ্টায় ডেলিভারি", supportPhone: "01700000000",
    });
  });

  it("productDetail carries settings + organization blocks", async () => {
    const prisma = seedWorld(makePrisma());
    const { svc } = makeService(prisma);
    const detail: any = await svc.productDetail("shop-one", "wallet");
    expect(detail.settings).toEqual({
      locale: "en", trackingPageEnabled: true,
      returnPolicyText: "৭ দিনের রিটার্ন", deliveryPromiseText: "২৪ ঘণ্টায় ডেলিভারি", supportPhone: "01700000000",
    });
    expect(detail.organization).toEqual({
      id: "org-1", name: "Shop One Ltd", slug: "shop-one",
      brandName: "ShopOne", logoUrl: "logo.png", primaryColor: "#123456",
    });
  });

  it("staffState setting serialization carries the new fields with defaults", async () => {
    const prisma = seedWorld(makePrisma(), {
      featuredMode: undefined, locale: undefined, trackingPageEnabled: undefined,
      returnPolicyText: undefined, deliveryPromiseText: undefined, supportPhone: undefined,
    });
    const { svc } = makeService(prisma);
    const state = await svc.staffState("org-1");
    expect(state.setting).toMatchObject({
      featuredMode: "merchant_picks", locale: "bn", trackingPageEnabled: true,
      returnPolicyText: null, deliveryPromiseText: null, supportPhone: null,
    });
  });

  it("updateSettings persists featuredMode/locale/tracking/trust and audits", async () => {
    const prisma = seedWorld(makePrisma());
    const { svc, audit } = makeService(prisma);
    const out: any = await svc.updateSettings("org-1", "user-1", {
      featuredMode: "merchant_picks", locale: "bn", trackingPageEnabled: false,
      returnPolicyText: "নতুন নীতি", deliveryPromiseText: null, supportPhone: "01800000000",
    });
    expect(out.setting).toMatchObject({
      featuredMode: "merchant_picks", locale: "bn", trackingPageEnabled: false,
      returnPolicyText: "নতুন নীতি", deliveryPromiseText: null, supportPhone: "01800000000",
    });
    expect(prisma.storefrontSetting.rows[0].featuredMode).toBe("merchant_picks");
    expect(prisma.storefrontSetting.rows[0].locale).toBe("bn");
    expect(audit.log).toHaveBeenCalledWith(expect.objectContaining({ action: "storefront.settings_updated" }));
  });

  it("DTO validation rejects bad featuredMode / locale values and accepts valid ones", async () => {
    const bad = plainToInstance(UpdateStorefrontSettingsDto, { featuredMode: "random", locale: "fr" });
    const errors = await validate(bad);
    const fields = errors.map((e) => e.property).sort();
    expect(fields).toEqual(["featuredMode", "locale"]);
    const good = plainToInstance(UpdateStorefrontSettingsDto, { featuredMode: "top_sellers", locale: "en" });
    expect(await validate(good)).toHaveLength(0);
  });
});
