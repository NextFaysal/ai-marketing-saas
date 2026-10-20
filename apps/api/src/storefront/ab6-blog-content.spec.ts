import { BadRequestException, NotFoundException, ValidationPipe } from "@nestjs/common";
import { ApiException } from "../i18n";
import { StorefrontService } from "./storefront.service";
import { ProductsService } from "../products/products.service";
import { CreateProductDto } from "../products/products.dto";
import { displayProductDescription, displayProductName } from "../products/product-display";
import { parseProductsCsv } from "../imports/csv";
import { LandingsService } from "../landings/landings.service";

/**
 * AB6 — AX12 (shop blog API) + AX13 completion (multi-language
 * product content). Fake-prisma harness in the neighbouring
 * storefront spec style (matchWhere + applyOrderBy tables).
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
      if ("gte" in cond) { if (new Date(row[k]).getTime() < new Date(cond.gte).getTime()) return false; continue; }
      if ("contains" in cond) {
        const hay = String(row[k] ?? "");
        const hit = cond.mode === "insensitive" ? hay.toLowerCase().includes(String(cond.contains).toLowerCase()) : hay.includes(String(cond.contains));
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

function makeTable(name: string) {
  const rows: any[] = [];
  let seq = 0;
  return {
    rows,
    findFirst: async ({ where, orderBy }: any = {}) =>
      applyOrderBy(rows.filter((r) => matchWhere(r, where)), orderBy)[0] ?? null,
    findUnique: async ({ where }: any = {}) => {
      if (where?.organizationId_sku) {
        return rows.find((r) => r.organizationId === where.organizationId_sku.organizationId && r.sku === where.organizationId_sku.sku) ?? null;
      }
      if (where?.id) return rows.find((r) => r.id === where.id) ?? null;
      return rows.filter((r) => matchWhere(r, where))[0] ?? null;
    },
    findMany: async ({ where, orderBy, take, skip }: any = {}) => {
      let found = applyOrderBy(rows.filter((r) => matchWhere(r, where)), orderBy);
      if (skip) found = found.slice(skip);
      if (take !== undefined) found = found.slice(0, take);
      return found;
    },
    count: async ({ where }: any = {}) => rows.filter((r) => matchWhere(r, where)).length,
    create: async ({ data }: any) => {
      const row = { id: data.id ?? `${name}-${++seq}`, createdAt: new Date(), updatedAt: new Date(), ...data };
      rows.push(row);
      return row;
    },
    update: async ({ where, data }: any) => {
      const row = rows.find((r) => matchWhere(r, where));
      if (!row) throw new Error("record not found");
      Object.assign(row, data, { updatedAt: new Date() });
      return row;
    },
    delete: async ({ where }: any) => {
      const idx = rows.findIndex((r) => matchWhere(r, where));
      if (idx < 0) throw new Error("record not found");
      return rows.splice(idx, 1)[0];
    },
    deleteMany: async ({ where }: any = {}) => {
      const before = rows.length;
      for (let i = rows.length - 1; i >= 0; i--) if (matchWhere(rows[i], where)) rows.splice(i, 1);
      return { count: before - rows.length };
    },
  };
}

function makePrisma() {
  const prisma: any = {
    organization: makeTable("org"), storefrontSetting: makeTable("setting"),
    businessProfile: makeTable("bp"), category: makeTable("cat"), brand: makeTable("brand"),
    product: makeTable("product"), productVariant: makeTable("variant"),
    productImage: makeTable("image"), productCost: makeTable("cost"),
    tag: makeTable("tag"), productTagAssignment: makeTable("tagassign"),
    order: makeTable("order"), orderItem: makeTable("orderitem"),
    courierShipment: makeTable("shipment"), shopPage: makeTable("page"),
    blogPost: makeTable("blog"), searchSynonym: makeTable("syn"), searchQueryLog: makeTable("qlog"),
    storeCart: makeTable("cart"), storeCartItem: makeTable("cartitem"), storeCartBundle: makeTable("cartbundle"),
    bundle: makeTable("bundle"), shippingZone: makeTable("zone"), promotion: makeTable("promo"),
    storeDiscount: makeTable("discount"), customer: makeTable("customer"),
    deliverySlot: makeTable("slot"), landingPage: makeTable("landing"),
    landingVariant: makeTable("lvar"), landingEvent: makeTable("levent"),
    membership: makeTable("membership"), subscription: makeTable("sub"),
  };
  // Honor product includes (variants / costs / images) like the
  // gb2-catalog harness.
  const attach = (row: any, include: any) => {
    if (!row || !include) return row;
    if (include.variants) row.variants = prisma.productVariant.rows.filter((v: any) => v.productId === row.id);
    if (include.costs) {
      let costs = prisma.productCost.rows.filter((c: any) => c.productId === row.id);
      if (include.costs.take) costs = costs.slice(0, include.costs.take);
      row.costs = costs;
    }
    if (include.images) row.images = prisma.productImage.rows.filter((i: any) => i.productId === row.id);
    if (include.tagAssignments) row.tagAssignments = [];
    return row;
  };
  const origFirst = prisma.product.findFirst;
  prisma.product.findFirst = async (args: any = {}) => attach(await origFirst(args), args?.include);
  const origMany = prisma.product.findMany;
  prisma.product.findMany = async (args: any = {}) => {
    const rows = await origMany(args);
    if (args?.include) for (const r of rows) attach(r, args.include);
    return rows;
  };
  return prisma;
}

const auditStub: any = { log: jest.fn(async () => undefined) };
const T0 = new Date("2026-10-01T00:00:00Z");

function seedShop(prisma: any, locale = "bn") {
  prisma.organization.rows.push(
    { id: "org-1", slug: "shop-one", name: "Shop One", brandName: null, logoUrl: null, primaryColor: null, customDomain: null },
    { id: "org-2", slug: "shop-two", name: "Shop Two", brandName: null, logoUrl: null, primaryColor: null, customDomain: null },
  );
  prisma.storefrontSetting.rows.push({
    id: "set-1", organizationId: "org-1", shopEnabled: true, shopName: "ShopOne", locale,
    giftWrapEnabled: false, giftWrapFeeMinor: null, createdAt: T0, updatedAt: T0,
  });
}

// ---------- 1. product-display pure ----------

describe("AB6 product-display pure helpers", () => {
  const p = { name: "লাল শাড়ি", nameEn: "Red Saree", description: "সুতি", descriptionEn: "Cotton" };
  it("en + nameEn → English; en + blank/null nameEn → primary; bn → primary", () => {
    expect(displayProductName(p, "en")).toBe("Red Saree");
    expect(displayProductName({ ...p, nameEn: "   " }, "en")).toBe("লাল শাড়ি");
    expect(displayProductName({ ...p, nameEn: null }, "en")).toBe("লাল শাড়ি");
    expect(displayProductName(p, "bn")).toBe("লাল শাড়ি");
    expect(displayProductName(p, null)).toBe("লাল শাড়ি");
    expect(displayProductName(null, "en")).toBe("");
  });
  it("description follows the same rule (null when no primary)", () => {
    expect(displayProductDescription(p, "en")).toBe("Cotton");
    expect(displayProductDescription({ ...p, descriptionEn: "" }, "en")).toBe("সুতি");
    expect(displayProductDescription(p, "bn")).toBe("সুতি");
    expect(displayProductDescription({ name: "x", description: null, descriptionEn: null }, "en")).toBeNull();
  });
});

// ---------- 2. Blog ----------

describe("AB6 AX12 blog API", () => {
  function setup() {
    const prisma = makePrisma();
    seedShop(prisma);
    const svc = new StorefrontService(prisma, undefined, undefined, auditStub);
    return { prisma, svc };
  }

  it("draft → staff-only; publish → public; unpublish → public 404 again", async () => {
    const { svc } = setup();
    const created: any = await svc.createBlogPost("org-1", "user-1", {
      title: "First Post",
      blocks: [{ type: "paragraph", data: { text: "হ্যালো" } }],
      tags: [" টিপস ", "টিপস", "গাইড"],
    } as any);
    expect(created.post.status).toBe("draft");
    expect(created.post.slug).toBe("first-post");
    expect(created.post.tags).toEqual(["টিপস", "গাইড"]);
    expect(created.post.publishedAt).toBeNull();

    const staff: any = await svc.listBlogPosts("org-1");
    expect(staff.posts.map((x: any) => x.id)).toContain(created.post.id);
    const staffDrafts: any = await svc.listBlogPosts("org-1", "draft");
    expect(staffDrafts.posts).toHaveLength(1);
    await expect(svc.listBlogPosts("org-1", "bogus")).rejects.toBeInstanceOf(ApiException);

    const pubList0: any = await svc.listPublicBlogPosts("shop-one");
    expect(pubList0.posts).toHaveLength(0);
    expect(pubList0.settings.shopName).toBe("ShopOne");
    expect(pubList0.organization.slug).toBe("shop-one");
    await expect(svc.getPublicBlogPost("shop-one", "first-post")).rejects.toBeInstanceOf(ApiException);

    const published: any = await svc.updateBlogPost("org-1", "user-1", created.post.id, { status: "published" } as any);
    expect(published.post.status).toBe("published");
    expect(published.post.publishedAt).not.toBeNull();

    const pubList: any = await svc.listPublicBlogPosts("shop-one");
    expect(pubList.posts).toHaveLength(1);
    expect(pubList.posts[0].slug).toBe("first-post");
    const pubGet: any = await svc.getPublicBlogPost("shop-one", "first-post");
    expect(pubGet.post.title).toBe("First Post");
    expect(pubGet.post.blocks).toHaveLength(1);
    expect(pubGet.post.seo).toEqual({ title: null, description: null });

    const unpub: any = await svc.updateBlogPost("org-1", "user-1", created.post.id, { status: "draft" } as any);
    expect(unpub.post.status).toBe("draft");
    // publishedAt records the LAST publish — kept on unpublish.
    expect(unpub.post.publishedAt).not.toBeNull();
    await expect(svc.getPublicBlogPost("shop-one", "first-post")).rejects.toBeInstanceOf(ApiException);
  });

  it("slug clash 400, unknown block type 400, tag limits 400, foreign-org update 404", async () => {
    const { svc } = setup();
    const a: any = await svc.createBlogPost("org-1", "user-1", { title: "Alpha Post" } as any);
    await expect(
      svc.createBlogPost("org-1", "user-1", { title: "Other", slug: "alpha-post" } as any),
    ).rejects.toBeInstanceOf(ApiException);
    await expect(
      svc.createBlogPost("org-1", "user-1", { title: "Bad Blocks", blocks: [{ type: "nope", data: {} }] } as any),
    ).rejects.toBeInstanceOf(ApiException);
    await expect(
      svc.createBlogPost("org-1", "user-1", { title: "Too Many Tags", tags: Array.from({ length: 11 }, (_, i) => `t${i}`) } as any),
    ).rejects.toBeInstanceOf(ApiException);
    await expect(
      svc.createBlogPost("org-1", "user-1", { title: "Long Tag", tags: ["x".repeat(41)] } as any),
    ).rejects.toBeInstanceOf(ApiException);
    await expect(
      svc.updateBlogPost("org-2", "user-1", a.post.id, { title: "Hijack" } as any),
    ).rejects.toBeInstanceOf(ApiException);
    // Delete works and returns the documented shape.
    const del: any = await svc.deleteBlogPost("org-1", "user-1", a.post.id);
    expect(del).toEqual({ deleted: true, postId: a.post.id });
  });
});

// ---------- 3. AX13 product writes ----------

describe("AB6 AX13 product writes", () => {
  it("the global ValidationPipe (forbidNonWhitelisted) accepts nameEn/descriptionEn", async () => {
    const pipe = new ValidationPipe({ whitelist: true, transform: true, forbidNonWhitelisted: true });
    const out: any = await pipe.transform(
      { name: "Ab Product", price: "10.00", nameEn: "English Name", descriptionEn: "English desc" },
      { type: "body", metatype: CreateProductDto, data: "" },
    );
    expect(out.nameEn).toBe("English Name");
    expect(out.descriptionEn).toBe("English desc");
  });

  it("create stores normalized nameEn/descriptionEn; update '' → null", async () => {
    const prisma = makePrisma();
    const svc = new ProductsService(prisma, auditStub);
    const created: any = await svc.create("org-1", "user-1", {
      name: "নতুন পণ্য", price: "100.00", nameEn: "  New Product  ", descriptionEn: "English desc",
    } as any);
    expect(created.nameEn).toBe("New Product");
    const row = prisma.product.rows.find((r: any) => r.id === created.id);
    expect(row.nameEn).toBe("New Product");
    expect(row.descriptionEn?.trim()).toBe("English desc");

    const blanked: any = await svc.update("org-1", "user-1", created.id, { nameEn: "", descriptionEn: "" } as any);
    expect(blanked.nameEn).toBeNull();
    expect(row.nameEn).toBeNull();
    expect(row.descriptionEn).toBeNull();

    const renamed: any = await svc.update("org-1", "user-1", created.id, { nameEn: "  Renamed EN  " } as any);
    expect(renamed.nameEn).toBe("Renamed EN");
  });
});

// ---------- 4. CSV import/export ----------

describe("AB6 AX13 CSV columns", () => {
  it("parseProductsCsv carries name_en/description_en; legacy files parse with undefined", () => {
    const withEn = parseProductsCsv("name,price,name_en,description_en\nশাড়ি,100,Red Saree,Cotton saree\n");
    expect(withEn.errors).toHaveLength(0);
    expect(withEn.rows[0].nameEn).toBe("Red Saree");
    expect(withEn.rows[0].descriptionEn).toBe("Cotton saree");
    const legacy = parseProductsCsv("name,price\nশাড়ি,100\n");
    expect(legacy.rows[0].nameEn).toBeUndefined();
    expect(legacy.rows[0].descriptionEn).toBeUndefined();
  });

  it("exportProductsCsv header + row carry the En values after description", async () => {
    const prisma = makePrisma();
    prisma.product.rows.push({
      id: "p-1", organizationId: "org-1", name: "লাল শাড়ি", nameEn: "Red Saree",
      description: "সুতি", descriptionEn: "Cotton saree", sku: "SAR-1", status: "ACTIVE",
      priceMinor: 10000n, compareAtMinor: null, currency: "BDT", stockQuantity: 3,
      category: null, imageUrl: null, brandId: null, createdAt: T0, updatedAt: T0,
    });
    const svc = new ProductsService(prisma, auditStub);
    const csv = await svc.exportProductsCsv("org-1", "user-1");
    const lines = csv.split("\n");
    expect(lines[0]).toBe(
      "name,sku,price,compare_at_price,currency,cost,stock,category,description,name_en,description_en,image_url,brand,status,variant_name,variant_sku,variant_price,variant_stock,variant_cost",
    );
    expect(lines[1]).toContain("Red Saree");
    expect(lines[1]).toContain("Cotton saree");
  });
});

// ---------- 5. Display surfaces ----------

describe("AB6 AX13 display surfaces", () => {
  it("serializeCart productName uses nameEn when the shop locale is en", async () => {
    const prisma = makePrisma();
    seedShop(prisma, "en");
    prisma.product.rows.push({
      id: "p-1", organizationId: "org-1", name: "লাল শাড়ি", nameEn: "Red Saree",
      priceMinor: 1000n, imageUrl: null, bumpTitle: null, bumpPriceMinor: null,
    });
    prisma.storeCart.rows.push({ id: "cart-1", organizationId: "org-1", status: "open", email: null, phone: null, updatedAt: T0 });
    prisma.storeCartItem.rows.push({
      id: "ci-1", cartId: "cart-1", productId: "p-1", variantId: null, quantity: 2,
      includeBump: false, createdAt: T0,
    });
    const svc = new StorefrontService(prisma, undefined, undefined, auditStub);
    const cart: any = await (svc as any).serializeCart(prisma.storeCart.rows[0]);
    expect(cart.items[0].productName).toBe("Red Saree");
  });

  it("single-product payload uses nameEn/descriptionEn under en locale", async () => {
    const prisma = makePrisma();
    prisma.product.rows.push({
      id: "p-1", organizationId: "org-1", name: "লাল শাড়ি", nameEn: "Red Saree",
      description: "সুতি শাড়ি", descriptionEn: "Cotton saree", slug: "prod-one",
      sku: "P-1", status: "ACTIVE", priceMinor: 100000n, compareAtMinor: null,
      category: null, stockQuantity: null, preorderEnabled: false, digital: false,
      bumpTitle: null, bumpPriceMinor: null, bumpImageUrl: null,
      organization: {
        id: "org-1", name: "Shop One",
        businessProfile: { deliveryChargeInsideMinor: 6000n, deliveryChargeOutsideMinor: 12000n },
      },
      createdAt: T0, updatedAt: T0,
    });
    prisma.storefrontSetting.rows.push({
      id: "set-1", organizationId: "org-1", shopEnabled: true, locale: "en",
      giftWrapEnabled: false, giftWrapFeeMinor: null, createdAt: T0, updatedAt: T0,
    });
    const svc = new ProductsService(prisma, auditStub);
    const res: any = await svc.getPublicProductBySlug("prod-one");
    expect(res.product.name).toBe("Red Saree");
    expect(res.product.description).toBe("Cotton saree");
  });

  it("landing payload uses nameEn/descriptionEn under en locale", async () => {
    const prisma = makePrisma();
    prisma.organization.rows.push({ id: "org-1", slug: "shop-one", name: "Shop One" });
    prisma.businessProfile.rows.push({ id: "bp-1", organizationId: "org-1", codAvailable: true, deliveryChargeInsideMinor: null, deliveryChargeOutsideMinor: null });
    prisma.storefrontSetting.rows.push({
      id: "set-1", organizationId: "org-1", shopEnabled: true, locale: "en", createdAt: T0, updatedAt: T0,
    });
    prisma.product.rows.push({
      id: "p-a", organizationId: "org-1", name: "লেদার ওয়ালেট", nameEn: "Leather Wallet",
      description: "আসল চামড়া", descriptionEn: "Real leather", slug: "leather-wallet",
      category: null, sku: "WAL-1", status: "ACTIVE", priceMinor: 50000n, compareAtMinor: null,
      stockQuantity: 10, imageUrl: null, bumpTitle: null, bumpPriceMinor: null, bumpImageUrl: null,
      createdAt: T0, updatedAt: T0,
    });
    prisma.landingPage.rows.push({
      id: "land-1", organizationId: "org-1", productId: "p-a", slug: "wallet-offer",
      title: "ওয়ালেট অফার", status: "published", sections: null, upsellProductId: null,
      createdAt: T0, updatedAt: T0,
    });
    const svc = new LandingsService(prisma, auditStub);
    const res: any = await svc.getPublicLanding("wallet-offer", "visitor-1");
    expect(res.product.name).toBe("Leather Wallet");
    expect(res.product.description).toBe("Real leather");
  });
});
