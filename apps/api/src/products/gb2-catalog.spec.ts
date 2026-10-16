import { ProductsService } from "./products.service";
import { InventoryService } from "../inventory/inventory.service";
import { parseProductsCsv } from "../imports/csv";

/**
 * GB2 (GC6) — catalog completion specs: brands CRUD + delete
 * null-out, product brand link validation, the brand list
 * filter, CSV export in the importer's own column shape (with
 * an export→import round-trip), bulk delete outcomes, and the
 * product history endpoint. In-memory fake Prisma in the EC
 * makeTable style.
 */
function matches(row: any, where: any): boolean {
  return Object.entries(where ?? {}).every(([k, v]: [string, any]) => {
    if (v === undefined) return true;
    if (v !== null && typeof v === "object" && !(v instanceof Date)) {
      if ("in" in v && !v.in.includes(row[k])) return false;
      if ("notIn" in v && v.notIn.includes(row[k])) return false;
      if ("gte" in v && !(row[k] != null && new Date(row[k]).getTime() >= new Date(v.gte).getTime())) return false;
      if ("gt" in v && !(row[k] != null && new Date(row[k]).getTime() > new Date(v.gt).getTime())) return false;
      if ("lte" in v && !(row[k] != null && new Date(row[k]).getTime() <= new Date(v.lte).getTime())) return false;
      if ("lt" in v && !(row[k] != null && new Date(row[k]).getTime() < new Date(v.lt).getTime())) return false;
      if ("contains" in v) {
        const hay = String(row[k] ?? "");
        const hit = (v as any).mode === "insensitive"
          ? hay.toLowerCase().includes(String((v as any).contains).toLowerCase())
          : hay.includes(String((v as any).contains));
        return hit;
      }
      return true;
    }
    if (v === null) return row[k] === null || row[k] === undefined;
    return row[k] === v;
  });
}

function makeTable(name: string) {
  const rows: any[] = [];
  let seq = 0;
  return {
    rows,
    findFirst: async ({ where }: any) => rows.find((r) => matches(r, where)) ?? null,
    findUnique: async ({ where }: any) =>
      rows.find((r) => r.id === where.id || r.organizationId === where.organizationId) ?? null,
    findMany: async ({ where, take, skip, orderBy }: any = {}) => {
      let f = rows.filter((r) => matches(r, where ?? {}));
      if (orderBy?.createdAt === "desc") f = [...f].sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
      if (orderBy?.createdAt === "asc") f = [...f].sort((a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime());
      if (orderBy?.effectiveFrom === "desc") f = [...f].sort((a, b) => new Date(b.effectiveFrom).getTime() - new Date(a.effectiveFrom).getTime());
      if (skip) f = f.slice(skip);
      if (take) f = f.slice(0, take);
      return f;
    },
    count: async ({ where }: any = {}) => rows.filter((r) => matches(r, where ?? {})).length,
    create: async ({ data }: any) => {
      const row = { id: `${name}-${++seq}`, createdAt: new Date(Date.now() + seq * 10), updatedAt: new Date(), ...data };
      rows.push(row);
      return row;
    },
    update: async ({ where, data }: any) => {
      const row = rows.find((r) => r.id === where.id);
      if (!row) throw new Error(`row not found in ${name}: ${where.id}`);
      Object.assign(row, data);
      return row;
    },
    delete: async ({ where }: any) => {
      const idx = rows.findIndex((r) => r.id === where.id);
      if (idx < 0) throw new Error(`row not found in ${name}`);
      return rows.splice(idx, 1)[0];
    },
    deleteMany: async ({ where }: any) => {
      for (let i = rows.length - 1; i >= 0; i--) if (matches(rows[i], where)) rows.splice(i, 1);
      return { count: 0 };
    },
  };
}

function fakePrisma() {
  const prisma: any = {
    product: makeTable("product"), productVariant: makeTable("variant"),
    productCost: makeTable("cost"), productImage: makeTable("image"),
    brand: makeTable("brand"), category: makeTable("category"),
    tag: makeTable("tag"), productTagAssignment: makeTable("tagassign"),
    orderItem: makeTable("orderitem"), auditLog: makeTable("audit"),
    stockMovement: makeTable("movement"), stockReservation: makeTable("reservation"),
    inventorySetting: makeTable("invsetting"), membership: makeTable("membership"),
    agentNotification: makeTable("notif"), user: makeTable("user"),
    organization: makeTable("org"), bundleItem: makeTable("bundleitem"),
  };
  // Honor the includes the services rely on (variants / costs /
  // images / tagAssignments) by attaching from sibling tables.
  const origProductFindMany = prisma.product.findMany;
  prisma.product.findMany = async (args: any = {}) => {
    const rows = await origProductFindMany(args);
    if (args?.include) {
      for (const row of rows) {
        if (args.include.variants) row.variants = prisma.productVariant.rows.filter((v: any) => v.productId === row.id);
        if (args.include.costs) {
          let costs = prisma.productCost.rows.filter((c: any) => c.productId === row.id);
          costs = [...costs].sort((a: any, b: any) => new Date(b.effectiveFrom).getTime() - new Date(a.effectiveFrom).getTime());
          if (args.include.costs.take) costs = costs.slice(0, args.include.costs.take);
          row.costs = costs;
        }
        if (args.include.images) row.images = prisma.productImage.rows.filter((i: any) => i.productId === row.id);
        if (args.include.tagAssignments) row.tagAssignments = [];
      }
    }
    return rows;
  };
  const origProductFindFirst = prisma.product.findFirst;
  prisma.product.findFirst = async (args: any = {}) => {
    const row = await origProductFindFirst(args);
    if (row && args?.include) {
      if (args.include.variants) row.variants = prisma.productVariant.rows.filter((v: any) => v.productId === row.id);
      if (args.include.costs) {
        let costs = prisma.productCost.rows.filter((c: any) => c.productId === row.id);
        costs = [...costs].sort((a: any, b: any) => new Date(b.effectiveFrom).getTime() - new Date(a.effectiveFrom).getTime());
        if (args.include.costs.take) costs = costs.slice(0, args.include.costs.take);
        row.costs = costs;
      }
      if (args.include.images) row.images = prisma.productImage.rows.filter((i: any) => i.productId === row.id);
      if (args.include.tagAssignments) row.tagAssignments = [];
    }
    return row;
  };
  return prisma;
}

function fakeAudit(prisma: any) {
  return {
    log: jest.fn(async (input: any) => {
      await prisma.auditLog.create({
        data: {
          organizationId: input.organizationId ?? null,
          userId: input.userId ?? null,
          action: input.action, entityType: input.entityType,
          entityId: input.entityId ?? null, metadata: input.metadata ?? null,
        },
      });
    }),
  } as any;
}

function setup() {
  const prisma: any = fakePrisma();
  const audit = fakeAudit(prisma);
  const inventory = new InventoryService(prisma as any, audit);
  const svc = new ProductsService(prisma as any, audit, inventory as any);
  return { prisma, audit, svc, inventory };
}

const ORG = "org-1";

describe("GB2 brands CRUD", () => {
  it("creates with a unique-per-org slug; Bengali names fall back to a brand- slug", async () => {
    const { svc } = setup();
    const a = await svc.createBrand(ORG, "owner-1", { name: "Aarong" });
    expect(a.slug).toBe("aarong");
    const b = await svc.createBrand(ORG, "owner-1", { name: "Aarong" });
    expect(b.slug).toBe("aarong-2");
    const c = await svc.createBrand(ORG, "owner-1", { name: "যমুনা" });
    expect(c.slug.startsWith("brand-")).toBe(true);
  });

  it("rename re-slugs; other edits keep the slug; audits fire", async () => {
    const { prisma, svc } = setup();
    const brand = await svc.createBrand(ORG, "owner-1", { name: "Aarong" });
    const edited = await svc.updateBrand(ORG, "owner-1", brand.id, { description: "দেশি ব্র্যান্ড" });
    expect(edited.slug).toBe("aarong");
    const renamed = await svc.updateBrand(ORG, "owner-1", brand.id, { name: "Aarong Lifestyle" });
    expect(renamed.slug).toBe("aarong-lifestyle");
    expect(prisma.auditLog.rows.some((r: any) => r.action === "product.brand.update" && r.entityId === brand.id)).toBe(true);
  });

  it("delete nulls product links (never deletes products) and reports the count", async () => {
    const { prisma, svc } = setup();
    const brand = await svc.createBrand(ORG, "owner-1", { name: "Aarong" });
    prisma.product.rows.push(
      { id: "p-1", organizationId: ORG, name: "শাড়ি", brandId: brand.id, status: "ACTIVE", priceMinor: 100n, stockQuantity: null, createdAt: new Date(), updatedAt: new Date() },
      { id: "p-2", organizationId: ORG, name: "কুর্তি", brandId: brand.id, status: "ACTIVE", priceMinor: 100n, stockQuantity: null, createdAt: new Date(), updatedAt: new Date() },
    );
    const out = await svc.deleteBrand(ORG, "owner-1", brand.id);
    expect(out).toEqual({ ok: true, unlinkedProducts: 2 });
    expect(prisma.product.rows.every((p: any) => p.brandId === null)).toBe(true);
    expect(prisma.brand.rows).toHaveLength(0);
    // Foreign brand id → 404.
    await expect(svc.deleteBrand(ORG, "owner-1", "nope")).rejects.toMatchObject({ status: 404 });
  });

  it("list carries ACTIVE-org product counts per brand", async () => {
    const { prisma, svc } = setup();
    const brand = await svc.createBrand(ORG, "owner-1", { name: "Aarong" });
    prisma.product.rows.push({ id: "p-1", organizationId: ORG, name: "শাড়ি", brandId: brand.id, status: "ACTIVE", priceMinor: 100n, stockQuantity: null, createdAt: new Date(), updatedAt: new Date() });
    const list = await svc.listBrands(ORG);
    expect(list).toHaveLength(1);
    expect(list[0]).toMatchObject({ id: brand.id, productCount: 1 });
  });
});

describe("GB2 product brand link + free-shipping flag", () => {
  it("create validates brandId in-org (404 for foreign) and stores flag + link", async () => {
    const { svc } = setup();
    const brand = await svc.createBrand(ORG, "owner-1", { name: "Aarong" });
    await expect(
      svc.create(ORG, "owner-1", { name: "শাড়ি X", price: "100.00", brandId: "foreign-brand" } as any),
    ).rejects.toMatchObject({ status: 404 });
    const created: any = await svc.create(ORG, "owner-1", {
      name: "শাড়ি X", price: "100.00", brandId: brand.id, freeShipping: true,
    } as any);
    expect(created.brandId).toBe(brand.id);
    expect(created.freeShipping).toBe(true);
  });

  it("update clears the link with null and validates new ids", async () => {
    const { prisma, svc } = setup();
    const brand = await svc.createBrand(ORG, "owner-1", { name: "Aarong" });
    prisma.product.rows.push({ id: "p-1", organizationId: ORG, name: "শাড়ি", brandId: brand.id, status: "ACTIVE", priceMinor: 100n, stockQuantity: null, createdAt: new Date(), updatedAt: new Date() });
    await expect(svc.update(ORG, "owner-1", "p-1", { brandId: "ghost" } as any)).rejects.toMatchObject({ status: 404 });
    const cleared: any = await svc.update(ORG, "owner-1", "p-1", { brandId: null } as any);
    expect(cleared.brandId).toBeNull();
  });

  it("products list filters by brandId", async () => {
    const { prisma, svc } = setup();
    const brand = await svc.createBrand(ORG, "owner-1", { name: "Aarong" });
    prisma.product.rows.push(
      { id: "p-1", organizationId: ORG, name: "শাড়ি", brandId: brand.id, status: "ACTIVE", priceMinor: 100n, stockQuantity: null, createdAt: new Date(), updatedAt: new Date() },
      { id: "p-2", organizationId: ORG, name: "কুর্তি", brandId: null, status: "ACTIVE", priceMinor: 100n, stockQuantity: null, createdAt: new Date(), updatedAt: new Date() },
    );
    const out = await svc.list(ORG, { brandId: brand.id });
    expect(out.total).toBe(1);
    expect(out.items[0].id).toBe("p-1");
  });
});

describe("GB2 product export (importer column shape)", () => {
  it("emits the import headers, one row per variant, and round-trips through the CSV importer", async () => {
    const { prisma, svc } = setup();
    const brand = await svc.createBrand(ORG, "owner-1", { name: "Aarong" });
    prisma.product.rows.push({
      id: "p-1", organizationId: ORG, name: "জামদানি শাড়ি", slug: "jamdani", sku: "JD-1", status: "ACTIVE",
      priceMinor: 250000n, compareAtMinor: 300000n, currency: "BDT", stockQuantity: 7,
      category: "শাড়ি", description: "হাতে বোনা", imageUrl: "https://img.example/jd.png",
      brandId: brand.id, freeShipping: false, createdAt: new Date(), updatedAt: new Date(),
    });
    prisma.productVariant.rows.push(
      { id: "v-1", productId: "p-1", name: "লাল", sku: "JD-1-R", priceMinor: 250000n, stockQuantity: 3, createdAt: new Date() },
      { id: "v-2", productId: "p-1", name: "নীল", sku: "JD-1-B", priceMinor: 260000n, stockQuantity: 4, createdAt: new Date() },
    );
    prisma.productCost.rows.push(
      { id: "c-1", productId: "p-1", variantId: null, costMinor: 180000n, effectiveFrom: new Date("2026-01-01T00:00:00Z"), createdAt: new Date() },
      { id: "c-2", productId: "p-1", variantId: "v-1", costMinor: 175000n, effectiveFrom: new Date("2026-01-01T00:00:00Z"), createdAt: new Date() },
    );
    const csv = await svc.exportProductsCsv(ORG, "owner-1");
    const lines = csv.trim().split("\n");
    expect(lines[0]).toBe(
      // AB6 (AX13): name_en/description_en added after description.
      "name,sku,price,compare_at_price,currency,cost,stock,category,description,name_en,description_en,image_url,brand,status,variant_name,variant_sku,variant_price,variant_stock,variant_cost",
    );
    expect(lines).toHaveLength(3); // header + 2 variant rows

    // Round-trip: the importer reads the export back row-wise
    // (brand by name, variant columns populated per row — the
    // service's grouping then rebuilds one product + variants).
    const parsed = parseProductsCsv(csv);
    expect(parsed.errors).toEqual([]);
    expect(parsed.rows).toHaveLength(2);
    const r0: any = parsed.rows[0];
    expect(r0.name).toBe("জামদানি শাড়ি");
    expect(r0.sku).toBe("JD-1");
    expect(r0.brand).toBe("Aarong");
    expect(r0.priceMinor).toBe(250000n);
    expect(r0.costMinor).toBe(180000n);
    expect(r0.variantSku).toBe("JD-1-R");
    expect(r0.variantCostMinor).toBe(175000n);
    expect(parsed.rows[1].variantSku).toBe("JD-1-B");
  });

  it("audits the export with counts only (no product data)", async () => {
    const { prisma, svc } = setup();
    prisma.product.rows.push({ id: "p-1", organizationId: ORG, name: "X", status: "ACTIVE", priceMinor: 100n, stockQuantity: null, createdAt: new Date(), updatedAt: new Date() });
    await svc.exportProductsCsv(ORG, "owner-1");
    const row = prisma.auditLog.rows.find((r: any) => r.action === "product.export");
    expect(row).toBeTruthy();
    expect(row.metadata).toEqual({ productCount: 1, rowCount: 1 });
  });
});

describe("GB2 bulk delete", () => {
  it("never-ordered → deleted; ordered → archived; foreign/missing → not_found", async () => {
    const { prisma, svc } = setup();
    prisma.product.rows.push(
      { id: "p-free", organizationId: ORG, name: "মুক্ত", status: "ACTIVE", priceMinor: 100n, stockQuantity: null, createdAt: new Date(), updatedAt: new Date() },
      { id: "p-ordered", organizationId: ORG, name: "অর্ডারকৃত", status: "ACTIVE", priceMinor: 100n, stockQuantity: null, createdAt: new Date(), updatedAt: new Date() },
      { id: "p-foreign", organizationId: "org-2", name: "অন্যের", status: "ACTIVE", priceMinor: 100n, stockQuantity: null, createdAt: new Date(), updatedAt: new Date() },
    );
    prisma.orderItem.rows.push({ id: "oi-1", orderId: "o-1", productId: "p-ordered", quantity: 1 });
    const out = await svc.bulkDelete(ORG, "owner-1", ["p-free", "p-ordered", "p-foreign", "ghost"]);
    expect(out.results).toEqual([
      { id: "p-free", outcome: "deleted" },
      { id: "p-ordered", outcome: "archived" },
      { id: "p-foreign", outcome: "not_found" },
      { id: "ghost", outcome: "not_found" },
    ]);
    expect(out).toMatchObject({ deleted: 1, archived: 1, notFound: 2 });
    expect(prisma.product.rows.some((p: any) => p.id === "p-free")).toBe(false);
    expect(prisma.product.rows.find((p: any) => p.id === "p-ordered").status).toBe("ARCHIVED");
    expect(prisma.product.rows.some((p: any) => p.id === "p-foreign")).toBe(true);
  });
});

describe("GB2 product history", () => {
  it("maps titles, carries safe stock details, includes variant + cost rows, newest first", async () => {
    const { prisma, svc } = setup();
    prisma.product.rows.push({ id: "p-1", organizationId: ORG, name: "শাড়ি", status: "ACTIVE", priceMinor: 100n, stockQuantity: 5, createdAt: new Date(), updatedAt: new Date() });
    prisma.productVariant.rows.push({ id: "v-1", productId: "p-1", name: "লাল", sku: "S-R", priceMinor: null, stockQuantity: 2, createdAt: new Date() });
    prisma.user.rows.push({ id: "u-1", name: "Rahim Uddin", email: "r@example.com" });
    const t = (s: string) => new Date(`2026-10-0${s}T00:00:00Z`);
    prisma.auditLog.rows.push(
      { id: "a-1", organizationId: ORG, userId: "u-1", action: "product.create", entityType: "Product", entityId: "p-1", metadata: null, createdAt: t("1") },
      { id: "a-2", organizationId: ORG, userId: "u-1", action: "inventory.adjusted", entityType: "Product", entityId: "p-1", metadata: { delta: -2, balanceAfter: 3 }, createdAt: t("3") },
      { id: "a-3", organizationId: ORG, userId: null, action: "product.variant.create", entityType: "ProductVariant", entityId: "v-1", metadata: null, createdAt: t("2") },
      { id: "a-4", organizationId: ORG, userId: "u-1", action: "product.cost.set", entityType: "ProductCost", entityId: "cost-9", metadata: { productId: "p-1" }, createdAt: t("4") },
      { id: "a-5", organizationId: ORG, userId: "u-1", action: "product.update", entityType: "Product", entityId: "p-other", metadata: null, createdAt: t("5") },
    );
    const out = await svc.productHistory(ORG, "p-1");
    expect(out.truncated).toBe(false);
    const actions = out.items.map((i: any) => i.action);
    expect(actions).toEqual(["product.cost.set", "inventory.adjusted", "product.variant.create", "product.create"]);
    const adj = out.items.find((i: any) => i.action === "inventory.adjusted")!;
    expect(adj.title).toBe("স্টক সমন্বয় হয়েছে");
    expect(adj.detail).toContain("বর্তমান ব্যালান্স: 3");
    expect(adj.actorName).toBe("Rahim Uddin");
    // Foreign product 404s.
    await expect(svc.productHistory(ORG, "ghost")).rejects.toMatchObject({ status: 404 });
  });
});
