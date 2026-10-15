import { BadRequestException, ConflictException, NotFoundException } from "@nestjs/common";
import { ProductsService, bulkPercentMinor, minorToDecimalString } from "./products.service";

// Fake Prisma in the variant-management.spec makeTable style.
function matches(row: any, where: any): boolean {
  return Object.entries(where ?? {}).every(([k, v]: [string, any]) => {
    if (v === undefined) return true;
    if (v !== null && typeof v === "object" && !(v instanceof Date)) {
      if ("in" in v && !v.in.includes(row[k])) return false;
      if ("not" in v) {
        const ok = v.not === null ? row[k] !== null && row[k] !== undefined : row[k] !== v.not;
        if (!ok) return false;
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
    findFirst: async ({ where }: any = {}) => rows.find((r) => matches(r, where)) ?? null,
    findUnique: async ({ where }: any = {}) => {
      if (where?.id) return rows.find((r) => r.id === where.id) ?? null;
      if (where?.organizationId_sku) {
        return (
          rows.find(
            (r) =>
              r.organizationId === where.organizationId_sku.organizationId &&
              r.sku === where.organizationId_sku.sku,
          ) ?? null
        );
      }
      return null;
    },
    findMany: async ({ where, take }: any = {}) => {
      const f = rows.filter((r) => matches(r, where ?? {}));
      return take ? f.slice(0, take) : f;
    },
    create: async ({ data }: any) => {
      const row = { id: `${name}-${++seq}`, createdAt: new Date(), ...data };
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
      const i = rows.findIndex((r) => r.id === where.id);
      if (i < 0) throw new Error(`row not found in ${name}: ${where.id}`);
      const [row] = rows.splice(i, 1);
      return row;
    },
  };
}

const auditStub: any = { log: async () => {} };

function makeCatalogPushStub() {
  const calls: any[] = [];
  return {
    calls,
    createListingsForNewProduct: async (...args: any[]) => {
      calls.push({ method: "createListingsForNewProduct", args });
      return 0;
    },
    enqueueForProductChange: async (...args: any[]) => {
      calls.push({ method: "enqueueForProductChange", args });
      return { enqueued: 0, skipped: 0 };
    },
    enqueueProductPush: async (...args: any[]) => {
      calls.push({ method: "enqueueProductPush", args });
      return { enqueued: 0, skipped: 0 };
    },
    enqueueInventoryPush: async (...args: any[]) => {
      calls.push({ method: "enqueueInventoryPush", args });
      return { enqueued: 0, skipped: 0 };
    },
    enqueueArchive: async (...args: any[]) => {
      calls.push({ method: "enqueueArchive", args });
      return { enqueued: 0, skipped: 0 };
    },
  };
}

function setup() {
  const prisma: any = {
    product: makeTable("product"),
    productVariant: makeTable("variant"),
    productImage: makeTable("image"),
    category: makeTable("category"),
    productTag: makeTable("tag"),
    productTagAssignment: makeTable("assignment"),
    bundleItem: makeTable("bundle"),
    store: makeTable("store"),
    storeListing: makeTable("listing"),
    syncOutbox: makeTable("outbox"),
  };
  prisma.category.rows.push(
    { id: "cat-1", organizationId: "org-1", name: "Fashion", slug: "fashion", parentId: null },
    { id: "cat-foreign", organizationId: "org-2", name: "Foreign", slug: "foreign", parentId: null },
  );
  prisma.productTag.rows.push(
    { id: "tag-1", organizationId: "org-1", name: "Bestseller", slug: "bestseller" },
    { id: "tag-2", organizationId: "org-1", name: "New", slug: "new" },
  );
  prisma.product.rows.push(
    { id: "p1", organizationId: "org-1", name: "Shirt", slug: "shirt-x1", category: "Fashion", categoryId: "cat-1", sku: "SHIRT-1", status: "ACTIVE", priceMinor: 10000n, compareAtMinor: 12000n, currency: "BDT", stockQuantity: 50, imageUrl: "https://img/a.jpg", weightGrams: 300, barcode: "123", variants: [], costs: [] },
    { id: "p2", organizationId: "org-1", name: "Shoes", slug: "shoes-x1", category: null, categoryId: null, sku: "SHOE-1", status: "ACTIVE", priceMinor: 10005n, compareAtMinor: null, currency: "BDT", stockQuantity: null, imageUrl: null, variants: [], costs: [] },
    { id: "p-foreign", organizationId: "org-2", name: "Foreign", slug: "f-x1", category: null, sku: null, priceMinor: 1000n, stockQuantity: 1, variants: [], costs: [] },
  );
  prisma.productVariant.rows.push(
    { id: "v1", productId: "p1", name: "Red / M", sku: "SHIRT-RED", priceMinor: 10000n, stockQuantity: 10 },
    { id: "v2", productId: "p1", name: "Blue / M", sku: null, priceMinor: null, stockQuantity: null },
    { id: "v-comp", productId: "p2", name: "42", sku: "SHOE-42", priceMinor: null, stockQuantity: 3 },
  );
  const catalogPush: any = makeCatalogPushStub();
  const svc = new ProductsService(prisma as any, auditStub, undefined, undefined, catalogPush);
  return { prisma, svc, catalogPush };
}

describe("EC3 bulk percent math (pure helpers)", () => {
  it("rounds half away from zero on BigInt, both directions", () => {
    expect(bulkPercentMinor(10000n, 10)).toBe(11000n);
    expect(bulkPercentMinor(10005n, 10)).toBe(11006n); // 11005.5 → 11006
    expect(bulkPercentMinor(10005n, -10)).toBe(9005n); // 9004.5 → 9005
    expect(bulkPercentMinor(10000n, -90)).toBe(1000n);
    expect(bulkPercentMinor(9999n, 0)).toBe(9999n);
  });
  it("minorToDecimalString formats for the price write path", () => {
    expect(minorToDecimalString(11000n)).toBe("110.00");
    expect(minorToDecimalString(9005n)).toBe("90.05");
    expect(minorToDecimalString(5n)).toBe("0.05");
  });
});

describe("EC3 bulk edit — preview + apply", () => {
  it("preview computes percent before/after, counts missing, and does NOT write", async () => {
    const { prisma, svc } = setup();
    const out = await svc.bulkEditPreview("org-1", {
      productIds: ["p1", "p2", "p-nope"],
      action: "price_percent",
      percent: 10,
    } as any);
    expect(out.affected).toBe(2);
    expect(out.missing).toBe(1);
    expect(out.items).toEqual([
      { productId: "p1", name: "Shirt", field: "price", before: "10000", after: "11000" },
      { productId: "p2", name: "Shoes", field: "price", before: "10005", after: "11006" },
    ]);
    // No writes happened.
    expect(prisma.product.rows.find((p: any) => p.id === "p1").priceMinor).toBe(10000n);
    expect(prisma.product.rows.find((p: any) => p.id === "p2").priceMinor).toBe(10005n);
  });

  it("preview with a negative percent rounds half away from zero", async () => {
    const { svc } = setup();
    const out = await svc.bulkEditPreview("org-1", {
      productIds: ["p2"],
      action: "price_percent",
      percent: -10,
    } as any);
    expect(out.items[0].after).toBe("9005");
  });

  it("stock_set preview notes the untracked→tracked baseline", async () => {
    const { svc } = setup();
    const out = await svc.bulkEditPreview("org-1", {
      productIds: ["p1", "p2"],
      action: "stock_set",
      quantity: 25,
    } as any);
    expect(out.items[0]).toMatchObject({ field: "stockQuantity", before: 50, after: 25 });
    expect(out.items[1]).toMatchObject({ before: null, after: 25, note: "untracked→tracked baseline" });
  });

  it("apply writes through the update path and returns per-item results", async () => {
    const { prisma, svc, catalogPush } = setup();
    const out = await svc.bulkEditApply("org-1", "actor-1", {
      productIds: ["p1", "p2"],
      action: "price_percent",
      percent: 10,
    } as any);
    expect(out.updated).toBe(2);
    expect(out.failed).toBe(0);
    expect(out.results).toEqual([
      { productId: "p1", ok: true },
      { productId: "p2", ok: true },
    ]);
    expect(prisma.product.rows.find((p: any) => p.id === "p1").priceMinor).toBe(11000n);
    expect(prisma.product.rows.find((p: any) => p.id === "p2").priceMinor).toBe(11006n);
    // The update path fired the catalog hooks.
    expect(catalogPush.calls.filter((c: any) => c.method === "enqueueForProductChange")).toHaveLength(2);
  });

  it("apply stock_set and category_set go through update (category string syncs)", async () => {
    const { prisma, svc } = setup();
    const stock = await svc.bulkEditApply("org-1", "actor-1", {
      productIds: ["p2"],
      action: "stock_set",
      quantity: 33,
    } as any);
    expect(stock.updated).toBe(1);
    expect(prisma.product.rows.find((p: any) => p.id === "p2").stockQuantity).toBe(33);

    const cat = await svc.bulkEditApply("org-1", "actor-1", {
      productIds: ["p2"],
      action: "category_set",
      categoryId: "cat-1",
    } as any);
    expect(cat.updated).toBe(1);
    const p2 = prisma.product.rows.find((p: any) => p.id === "p2");
    expect(p2.categoryId).toBe("cat-1");
    expect(p2.category).toBe("Fashion");
  });

  it("category_set with a foreign category 404s at preview time", async () => {
    const { svc } = setup();
    await expect(
      svc.bulkEditPreview("org-1", { productIds: ["p1"], action: "category_set", categoryId: "cat-foreign" } as any),
    ).rejects.toThrow(NotFoundException);
  });
});

describe("EC3 create / update with categoryId + tags", () => {
  it("create persists EC3 fields, syncs the category string, writes tag assignments and asks for listings", async () => {
    const { prisma, svc, catalogPush } = setup();
    const out = await svc.create("org-1", "actor-1", {
      name: "Kurti",
      price: "850.00",
      categoryId: "cat-1",
      tagIds: ["tag-1", "tag-2"],
      weightGrams: 250,
      barcode: "8801234",
      seoTitle: "Kurti SEO",
    } as any);
    expect(out.category).toBe("Fashion");
    expect(out.categoryId).toBe("cat-1");
    expect(out.weightGrams).toBe(250);
    expect(out.barcode).toBe("8801234");
    const assignments = prisma.productTagAssignment.rows.filter((a: any) => a.productId === out.id);
    expect(assignments.map((a: any) => a.tagId).sort()).toEqual(["tag-1", "tag-2"]);
    expect(catalogPush.calls).toContainEqual({
      method: "createListingsForNewProduct",
      args: ["org-1", out.id],
    });
  });

  it("create with a foreign category or tag 404s and writes nothing", async () => {
    const { prisma, svc } = setup();
    const before = prisma.product.rows.length;
    await expect(
      svc.create("org-1", "actor-1", { name: "Xyz", price: "10.00", categoryId: "cat-foreign" } as any),
    ).rejects.toThrow(NotFoundException);
    await expect(
      svc.create("org-1", "actor-1", { name: "Xyz", price: "10.00", tagIds: ["tag-nope"] } as any),
    ).rejects.toThrow(NotFoundException);
    expect(prisma.product.rows).toHaveLength(before);
  });

  it("update by categoryId syncs the string; categoryId null clears the link but keeps the string; tagIds replace assignments", async () => {
    const { prisma, svc } = setup();
    await svc.createCategory("org-1", "actor-1", { name: "Winter Wear" } as any);
    const winter = prisma.category.rows.find((c: any) => c.slug === "winter-wear");
    const out = await svc.update("org-1", "actor-1", "p2", { categoryId: winter.id, tagIds: ["tag-2"] } as any);
    expect(out.categoryId).toBe(winter.id);
    expect(prisma.product.rows.find((p: any) => p.id === "p2").category).toBe("Winter Wear");
    expect(
      prisma.productTagAssignment.rows.filter((a: any) => a.productId === "p2").map((a: any) => a.tagId),
    ).toEqual(["tag-2"]);
    const tags = (await svc.getOne("org-1", "p2")).tags;
    expect(tags).toEqual([{ id: "tag-2", name: "New", slug: "new" }]);

    const cleared = await svc.update("org-1", "actor-1", "p2", { categoryId: null } as any);
    expect(cleared.categoryId).toBeNull();
    expect(prisma.product.rows.find((p: any) => p.id === "p2").category).toBe("Winter Wear");
  });

  it("a catalog-push hook failure never fails the product write", async () => {
    const { prisma, svc, catalogPush } = setup();
    catalogPush.enqueueForProductChange = async () => {
      throw new Error("outbox down");
    };
    const out = await svc.update("org-1", "actor-1", "p1", { name: "Shirt V2" } as any);
    expect(out.name).toBe("Shirt V2");
    expect(prisma.product.rows.find((p: any) => p.id === "p1").name).toBe("Shirt V2");
  });

  it("baseline (plain-write) stock changes fire enqueueInventoryPush; tracked-name-only updates do not", async () => {
    const { svc, catalogPush } = setup();
    // Inventory service absent → plain write; p1 stock 50 → 33.
    await svc.update("org-1", "actor-1", "p1", { stockQuantity: 33 } as any);
    expect(catalogPush.calls).toContainEqual({
      method: "enqueueInventoryPush",
      args: ["org-1", "p1", null, 33],
    });
    // Variant baseline: v2 stock null → 7.
    await svc.updateVariant("org-1", "actor-1", "p1", "v2", { stockQuantity: 7 } as any);
    expect(catalogPush.calls).toContainEqual({
      method: "enqueueInventoryPush",
      args: ["org-1", "p1", "v2", 7],
    });
    const changes = catalogPush.calls.filter((c: any) => c.method === "enqueueForProductChange");
    expect(changes.length).toBeGreaterThanOrEqual(2);
  });
});

describe("EC3 categories & tags CRUD", () => {
  it("createCategory slugifies and conflicts on a duplicate slug; listCategories counts products", async () => {
    const { svc } = setup();
    const created = await svc.createCategory("org-1", "actor-1", { name: "Winter Wear!" } as any);
    expect(created.slug).toBe("winter-wear");
    await expect(
      svc.createCategory("org-1", "actor-1", { name: "winter wear" } as any),
    ).rejects.toThrow(ConflictException);
    const list = await svc.listCategories("org-1");
    const fashion = list.find((c: any) => c.id === "cat-1");
    expect(fashion.productCount).toBe(1); // p1
  });

  it("renaming a category updates the Product.category display string of its products", async () => {
    const { prisma, svc } = setup();
    await svc.updateCategory("org-1", "actor-1", "cat-1", { name: "Fashion & Style" } as any);
    expect(prisma.product.rows.find((p: any) => p.id === "p1").category).toBe("Fashion & Style");
  });

  it("parent validation: self-parent and child-parent are rejected; a valid parent works", async () => {
    const { svc } = setup();
    const child = await svc.createCategory("org-1", "actor-1", { name: "Sub", parentId: "cat-1" } as any);
    await expect(
      svc.updateCategory("org-1", "actor-1", "cat-1", { parentId: "cat-1" } as any),
    ).rejects.toThrow(BadRequestException);
    await expect(
      svc.updateCategory("org-1", "actor-1", "cat-1", { parentId: child.id } as any),
    ).rejects.toThrow(BadRequestException);
    await expect(
      svc.createCategory("org-1", "actor-1", { name: "Orphan", parentId: "cat-foreign" } as any),
    ).rejects.toThrow(NotFoundException);
  });

  it("createTag slugifies and conflicts on duplicates", async () => {
    const { svc } = setup();
    const tag = await svc.createTag("org-1", "actor-1", { name: "Hot Deal" } as any);
    expect(tag.slug).toBe("hot-deal");
    await expect(svc.createTag("org-1", "actor-1", { name: "hot deal" } as any)).rejects.toThrow(
      ConflictException,
    );
    await expect(svc.createTag("org-1", "actor-1", { name: "Bestseller" } as any)).rejects.toThrow(
      ConflictException,
    );
  });
});

describe("EC3 images", () => {
  function seedImages(prisma: any) {
    prisma.product.rows.push({
      id: "p-img", organizationId: "org-1", name: "Gallery", slug: "g-x1", category: null, sku: null,
      priceMinor: 5000n, compareAtMinor: null, currency: "BDT", stockQuantity: 5,
      imageUrl: "https://img/a.jpg", variants: [], costs: [],
    });
    prisma.productImage.rows.push(
      { id: "img-a", productId: "p-img", url: "https://img/a.jpg", altText: "A", position: 0 },
      { id: "img-b", productId: "p-img", url: "https://img/b.jpg", altText: "B", position: 1 },
    );
  }

  it("reorderImages mirrors the first image into product.imageUrl", async () => {
    const { prisma, svc } = setup();
    seedImages(prisma);
    const out = await svc.reorderImages("org-1", "actor-1", "p-img", ["img-b", "img-a"]);
    expect(out.map((i: any) => i.id)).toEqual(["img-b", "img-a"]);
    expect(out.map((i: any) => i.position)).toEqual([0, 1]);
    expect(prisma.product.rows.find((p: any) => p.id === "p-img").imageUrl).toBe("https://img/b.jpg");
    await expect(
      svc.reorderImages("org-1", "actor-1", "p-img", ["img-b", "img-foreign"]),
    ).rejects.toThrow(BadRequestException);
  });

  it("addImage appends at max+1 and fills an empty cover; deleteImage of the cover mirrors the next image", async () => {
    const { prisma, svc } = setup();
    seedImages(prisma);
    const added = await svc.addImage("org-1", "actor-1", "p-img", { url: "https://img/c.jpg" });
    expect(added.position).toBe(2);
    const images = await svc.listImages("org-1", "p-img");
    expect(images.map((i: any) => i.url)).toEqual([
      "https://img/a.jpg",
      "https://img/b.jpg",
      "https://img/c.jpg",
    ]);

    await svc.deleteImage("org-1", "actor-1", "p-img", "img-a");
    expect(prisma.product.rows.find((p: any) => p.id === "p-img").imageUrl).toBe("https://img/b.jpg");
    await expect(svc.deleteImage("org-1", "actor-1", "p-img", "img-a")).rejects.toThrow(
      NotFoundException,
    );

    // Empty cover adopts the first added image.
    prisma.product.rows.push({
      id: "p-nocover", organizationId: "org-1", name: "NoCover", slug: "n-x1", category: null,
      sku: null, priceMinor: 1000n, compareAtMinor: null, currency: "BDT", stockQuantity: null,
      imageUrl: null, variants: [], costs: [],
    });
    await svc.addImage("org-1", "actor-1", "p-nocover", { url: "https://img/first.jpg" });
    expect(prisma.product.rows.find((p: any) => p.id === "p-nocover").imageUrl).toBe(
      "https://img/first.jpg",
    );
  });
});

describe("EC3 duplicate", () => {
  it("copies variants/images/tags with -copy SKUs, DRAFT status — but NOT listings or costs", async () => {
    const { prisma, svc } = setup();
    prisma.productImage.rows.push(
      { id: "img-1", productId: "p1", url: "https://img/a.jpg", altText: null, position: 0 },
    );
    prisma.productTagAssignment.rows.push({ id: "as-1", productId: "p1", tagId: "tag-1" });
    prisma.storeListing.rows.push({
      id: "lst-1", organizationId: "org-1", storeId: "st-1", productId: "p1", externalId: "99",
      publishState: "published", syncStatus: "synced",
    });

    const copy = await svc.duplicate("org-1", "actor-1", "p1");
    expect(copy.name).toBe("Shirt (Copy)");
    expect(copy.sku).toBe("SHIRT-1-copy");
    expect(copy.status).toBe("DRAFT");
    expect(copy.source).toBe("manual");
    expect(copy.priceMinor).toBe("10000");
    expect(copy.weightGrams).toBe(300);
    expect(copy.categoryId).toBe("cat-1");
    expect(copy.variants).toHaveLength(2);
    expect(copy.variants.find((v: any) => v.name === "Red / M").sku).toBe("SHIRT-RED-copy");
    expect(copy.variants.find((v: any) => v.name === "Blue / M").sku).toBeNull();

    const copiedImages = prisma.productImage.rows.filter((i: any) => i.productId === copy.id);
    expect(copiedImages).toHaveLength(1);
    expect(copiedImages[0].url).toBe("https://img/a.jpg");
    const copiedTags = prisma.productTagAssignment.rows.filter((a: any) => a.productId === copy.id);
    expect(copiedTags.map((a: any) => a.tagId)).toEqual(["tag-1"]);
    // No listings were copied or created for the copy.
    expect(prisma.storeListing.rows.filter((l: any) => l.productId === copy.id)).toHaveLength(0);

    // Second duplicate of the original takes the -copy-2 suffix.
    const copy2 = await svc.duplicate("org-1", "actor-1", "p1");
    expect(copy2.sku).toBe("SHIRT-1-copy-2");
    await expect(svc.duplicate("org-1", "actor-1", "p-foreign")).rejects.toThrow(NotFoundException);
  });
});

describe("EC4 bundle items", () => {
  it("add validates self / foreign component / foreign variant / duplicates; list enriches the component; delete works", async () => {
    const { prisma, svc } = setup();
    await expect(
      svc.addBundleItem("org-1", "actor-1", "p1", { componentProductId: "p1", quantity: 1 }),
    ).rejects.toThrow(BadRequestException);
    await expect(
      svc.addBundleItem("org-1", "actor-1", "p1", { componentProductId: "p1", quantity: 1 }),
    ).rejects.toThrow(/component/);
    await expect(
      svc.addBundleItem("org-1", "actor-1", "p1", { componentProductId: "p-foreign", quantity: 1 }),
    ).rejects.toThrow(NotFoundException);
    await expect(
      svc.addBundleItem("org-1", "actor-1", "p1", {
        componentProductId: "p2",
        componentVariantId: "v1", // v1 belongs to p1, not p2
        quantity: 1,
      }),
    ).rejects.toThrow(NotFoundException);

    const item = await svc.addBundleItem("org-1", "actor-1", "p1", {
      componentProductId: "p2",
      componentVariantId: "v-comp",
      quantity: 2,
    });
    expect(item).toMatchObject({ parentProductId: "p1", componentProductId: "p2", quantity: 2 });
    await expect(
      svc.addBundleItem("org-1", "actor-1", "p1", {
        componentProductId: "p2",
        componentVariantId: "v-comp",
        quantity: 1,
      }),
    ).rejects.toThrow(ConflictException);

    const list = await svc.listBundleItems("org-1", "p1");
    expect(list).toHaveLength(1);
    expect(list[0].componentProduct).toMatchObject({ name: "Shoes", sku: "SHOE-1" });

    const del = await svc.deleteBundleItem("org-1", "actor-1", "p1", item.id);
    expect(del.deleted).toBe(true);
    expect(prisma.bundleItem.rows).toHaveLength(0);
    await expect(svc.deleteBundleItem("org-1", "actor-1", "p1", item.id)).rejects.toThrow(
      NotFoundException,
    );
  });
});

describe("EC3 channels view", () => {
  it("maps listings with string channel price, store info and divergence (suppressed by a pending push)", async () => {
    const { prisma, svc } = setup();
    prisma.store.rows.push({
      id: "st-1", organizationId: "org-1", name: "Main Woo", platform: "WOOCOMMERCE", syncMode: "full-manage",
    });
    prisma.storeListing.rows.push({
      id: "lst-1", organizationId: "org-1", storeId: "st-1", productId: "p1", externalId: "99",
      publishState: "published", syncStatus: "synced", channelPriceMinor: 9500n, channelStock: 40,
    });
    const out = await svc.getChannels("org-1", "p1");
    expect(out.productStock).toBe(50);
    expect(out.listings).toHaveLength(1);
    expect(out.listings[0]).toMatchObject({
      channelPriceMinor: "9500",
      storeName: "Main Woo",
      platform: "WOOCOMMERCE",
      syncMode: "full-manage",
      stockDiverged: true, // 40 (channel) vs 50 (product), nothing pending
    });
    prisma.syncOutbox.rows.push({
      id: "ob-1", organizationId: "org-1", storeId: "st-1", entityType: "product", entityId: "p1", status: "pending",
    });
    const withPending = await svc.getChannels("org-1", "p1");
    expect(withPending.listings[0].stockDiverged).toBe(false);
    await expect(svc.getChannels("org-1", "p-foreign")).rejects.toThrow(NotFoundException);
  });
});
