import { encryptJson } from "../crypto";
import * as shopifyCatalog from "./shopify-catalog";

/* ------------------------------------------------------------------ */
/* Hand-rolled fake prisma (B1 style: in-memory tables)                */
/* ------------------------------------------------------------------ */

function matchWhere(row: any, where: any): boolean {
  for (const [k, v] of Object.entries(where ?? {})) {
    if (v === undefined) continue;
    if (v && typeof v === "object" && !(v instanceof Date)) {
      if (!matchWhere(row, v)) return false;
    } else if (row[k] !== v) {
      return false;
    }
  }
  return true;
}

function makeTable() {
  const rows: any[] = [];
  let seq = 0;
  return {
    rows,
    findFirst: async ({ where }: any) => rows.find((r) => matchWhere(r, where)) ?? null,
    findMany: async ({ where, orderBy }: any = {}) => {
      let out = rows.filter((r) => matchWhere(r, where));
      if (orderBy) {
        const [field, dir] = Object.entries(orderBy)[0] as any;
        out = [...out].sort((a, b) => {
          const av = a[field] instanceof Date ? a[field].getTime() : a[field];
          const bv = b[field] instanceof Date ? b[field].getTime() : b[field];
          return (av < bv ? -1 : av > bv ? 1 : 0) * (dir === "desc" ? -1 : 1);
        });
      }
      return out;
    },
    create: async ({ data }: any) => {
      const row = { id: data.id ?? `row-${++seq}`, ...data };
      rows.push(row);
      return row;
    },
    update: async ({ where, data }: any) => {
      const row = rows.find((r) => matchWhere(r, where));
      if (!row) throw new Error("record not found");
      Object.assign(row, data);
      return row;
    },
    upsert: async ({ where, create, update }: any) => {
      const row = rows.find((r) => matchWhere(r, where));
      if (row) {
        Object.assign(row, update);
        return row;
      }
      const created = { id: create.id ?? `row-${++seq}`, ...create };
      rows.push(created);
      return created;
    },
  };
}

function fakePrisma() {
  return {
    storeListing: makeTable(),
    product: makeTable(),
    productVariant: makeTable(),
    productImage: makeTable(),
    category: makeTable(),
    productTag: makeTable(),
    productTagAssignment: makeTable(),
    storeTaxonomyMap: makeTable(),
    storeLocation: makeTable(),
    integration: makeTable(),
    integrationCredential: makeTable(),
  } as any;
}

/* ------------------------------------------------------------------ */
/* Stubbed Shopify GraphQL server                                      */
/* ------------------------------------------------------------------ */

function stubShopify() {
  const calls: { query: string; variables: any }[] = [];
  const state = {
    productSetUserErrors: null as any[] | null,
    lastProduct: null as any,
    inventoryQuantity: null as number | null,
    inventorySets: [] as any[],
  };

  const respond = (data: any) => ({
    ok: true,
    status: 200,
    text: async () => JSON.stringify({ data }),
    json: async () => ({ data }),
  });

  const fn = async (_url: string, init: any = {}) => {
    const parsed = JSON.parse(init.body);
    const query: string = parsed.query;
    const variables = parsed.variables ?? {};
    calls.push({ query, variables });

    if (query.includes("inventorySetQuantities")) {
      if (state.productSetUserErrors && query.includes("inventorySetQuantities") && false) {
        // unreachable; inventory userErrors not used in these specs
      }
      const input = variables.input;
      state.inventorySets.push(input);
      const q = input.quantities?.[0];
      if (q) state.inventoryQuantity = q.quantity;
      return respond({ inventorySetQuantities: { inventoryAdjustmentGroup: { id: "gid://shopify/InventoryAdjustmentGroup/1" }, userErrors: [] } });
    }
    if (query.includes("productSet")) {
      if (state.productSetUserErrors) {
        return respond({ productSet: { product: null, userErrors: state.productSetUserErrors } });
      }
      const input = variables.input;
      const gid = input.id ?? "gid://shopify/Product/7001";
      const variants = (input.variants ?? []).map((v: any, i: number) => ({
        id: `gid://shopify/ProductVariant/${8001 + i}`,
        sku: v.sku ?? null,
        price: v.price,
        compareAtPrice: v.compareAtPrice ?? null,
        inventoryItem: { id: `gid://shopify/InventoryItem/${9001 + i}` },
      }));
      const product = {
        id: gid,
        title: input.title,
        status: input.status,
        variants: { edges: variants.map((node: any) => ({ node })) },
      };
      state.lastProduct = { ...product, tags: input.tags ?? [] };
      return respond({ productSet: { product, userErrors: [] } });
    }
    if (query.includes("inventoryLevel")) {
      return respond({
        inventoryItem: {
          inventoryLevel: {
            quantities: [{ name: "available", quantity: state.inventoryQuantity ?? 0 }],
          },
        },
      });
    }
    if (query.includes("collectionCreate")) {
      return respond({
        collectionCreate: {
          collection: { id: "gid://shopify/Collection/3001", title: variables.input.title },
          userErrors: [],
        },
      });
    }
    if (query.includes("collectionAddProducts")) {
      return respond({ collectionAddProducts: { collection: { id: variables.id }, userErrors: [] } });
    }
    if (query.includes("product(id")) {
      const p = state.lastProduct;
      if (!p) throw new Error("stub shopify: no product set yet");
      return respond({
        product: {
          id: p.id,
          title: p.title,
          status: p.status,
          tags: p.tags ?? [],
          variants: {
            edges: p.variants.edges.map((e: any) => ({
              node: { id: e.node.id, price: e.node.price, sku: e.node.sku },
            })),
          },
        },
      });
    }
    throw new Error(`stub shopify: unhandled query ${query.slice(0, 80)}`);
  };

  return { fn: fn as any, calls, state };
}

/* ------------------------------------------------------------------ */
/* Fixtures                                                            */
/* ------------------------------------------------------------------ */

const store = { id: "store-9", url: "https://shop.myshopify.com", platform: "SHOPIFY" };
const integration = {
  id: "int-9",
  credential: { encryptedData: encryptJson({ accessToken: "shpat_test", apiSecret: "shpss_x" }) },
};

function seedSimpleProduct(prisma: any) {
  prisma.product.rows.push({
    id: "prod-1",
    organizationId: "org-1",
    name: "Cotton Shirt",
    sku: "P-1",
    description: "Nice shirt",
    priceMinor: 15000n,
    compareAtMinor: null,
    currency: "BDT",
    stockQuantity: 8,
    imageUrl: null,
    category: null,
    categoryId: null,
    barcode: null,
    weightGrams: null,
    lengthCm: null,
    widthCm: null,
    heightCm: null,
    seoTitle: null,
    seoDescription: null,
  });
  prisma.storeListing.rows.push({
    id: "lst-1",
    organizationId: "org-1",
    storeId: "store-9",
    productId: "prod-1",
    externalId: "",
    externalVariantMap: null,
    publishState: "published",
    channelPriceMinor: null,
    channelStock: null,
    syncStatus: "synced",
    lastSyncError: null,
    lastPushedHash: null,
    saleStartsAt: null,
    saleEndsAt: null,
    saleActive: false,
  });
}

describe("shopify-catalog pushProduct", () => {
  it("productSet create + read-back match -> listing synced; no default location -> inventorySkipped note, not a failure", async () => {
    const prisma = fakePrisma();
    seedSimpleProduct(prisma);
    const shop = stubShopify();

    const res = await shopifyCatalog.pushProduct({
      prisma,
      organizationId: "org-1",
      store,
      integration,
      payload: { listingId: "lst-1", productId: "prod-1" },
      fetchFn: shop.fn,
    });

    expect(res.ok).toBe(true);
    expect(res.responseSummary.remoteId).toBe("gid://shopify/Product/7001");
    expect(res.responseSummary.inventorySkipped).toBe("shopify_location_not_mapped");

    const setCall = shop.calls.find((c) => c.query.includes("productSet"));
    expect(setCall).toBeTruthy();
    expect(setCall!.variables.input.title).toBe("Cotton Shirt");
    expect(setCall!.variables.input.status).toBe("ACTIVE");
    expect(setCall!.variables.input.variants[0].price).toBe("150.00");
    expect(setCall!.variables.input.variants[0].sku).toBe("P-1");

    const listing = prisma.storeListing.rows[0];
    expect(listing.syncStatus).toBe("synced");
    expect(listing.externalId).toBe("gid://shopify/Product/7001");
    expect(listing.lastPushedHash).toMatch(/^[0-9a-f]{64}$/);
    expect(listing.channelStock).toBe(8);
    expect(listing.lastSyncError).toBeNull();
  });

  it("productSet userErrors fail verbatim and mark the listing failed", async () => {
    const prisma = fakePrisma();
    seedSimpleProduct(prisma);
    const shop = stubShopify();
    shop.state.productSetUserErrors = [
      { field: ["title"], message: "Title is too long" },
      { field: ["variants"], message: "Variants are invalid" },
    ];

    const res = await shopifyCatalog.pushProduct({
      prisma,
      organizationId: "org-1",
      store,
      integration,
      payload: { listingId: "lst-1", productId: "prod-1" },
      fetchFn: shop.fn,
    });

    expect(res.ok).toBe(false);
    expect(res.error).toBe("Title is too long; Variants are invalid");
    const listing = prisma.storeListing.rows[0];
    expect(listing.syncStatus).toBe("failed");
    expect(listing.lastSyncError).toBe("Title is too long; Variants are invalid");
  });
});

describe("shopify-catalog pushInventory", () => {
  function seedInventoryListing(prisma: any) {
    prisma.product.rows.push({
      id: "prod-1",
      organizationId: "org-1",
      name: "Cotton Shirt",
      priceMinor: 15000n,
      currency: "BDT",
      stockQuantity: 8,
    });
    prisma.productVariant.rows.push({
      id: "v1",
      productId: "prod-1",
      name: "Red",
      sku: "P-1-R",
      priceMinor: 15000n,
      stockQuantity: 8,
      attributes: null,
      createdAt: new Date(),
    });
    prisma.storeListing.rows.push({
      id: "lst-1",
      organizationId: "org-1",
      storeId: "store-9",
      productId: "prod-1",
      externalId: "gid://shopify/Product/7001",
      externalVariantMap: {
        v1: { id: "gid://shopify/ProductVariant/8001", inventoryItemId: "gid://shopify/InventoryItem/9001" },
      },
      publishState: "published",
      syncStatus: "synced",
      lastSyncError: null,
      lastPushedHash: "sentinel-hash",
      channelStock: 8,
    });
  }

  it("sets quantity at the mapped default location and verifies by read-back", async () => {
    const prisma = fakePrisma();
    seedInventoryListing(prisma);
    prisma.storeLocation.rows.push({
      id: "loc-1",
      organizationId: "org-1",
      storeId: "store-9",
      name: "Main",
      externalLocationId: "12345",
      isDefault: true,
    });
    const shop = stubShopify();

    const res = await shopifyCatalog.pushInventory({
      prisma,
      organizationId: "org-1",
      store,
      integration,
      payload: { listingId: "lst-1", productId: "prod-1", variantId: "v1", quantity: 33 },
      fetchFn: shop.fn,
    });

    expect(res.ok).toBe(true);
    expect(shop.state.inventorySets).toHaveLength(1);
    expect(shop.state.inventorySets[0].quantities).toEqual([
      {
        inventoryItemId: "gid://shopify/InventoryItem/9001",
        locationId: "gid://shopify/Location/12345",
        quantity: 33,
      },
    ]);
    expect(shop.state.inventorySets[0].ignoreCompareQuantity).toBe(true);
    const listing = prisma.storeListing.rows[0];
    expect(listing.channelStock).toBe(33);
    expect(listing.lastPushedHash).toBe("sentinel-hash");
  });

  it("without a mapped default location fails with the exact shopify_location_not_mapped error", async () => {
    const prisma = fakePrisma();
    seedInventoryListing(prisma);
    const shop = stubShopify();

    const res = await shopifyCatalog.pushInventory({
      prisma,
      organizationId: "org-1",
      store,
      integration,
      payload: { listingId: "lst-1", productId: "prod-1", variantId: "v1", quantity: 5 },
      fetchFn: shop.fn,
    });

    expect(res.ok).toBe(false);
    expect(res.error).toBe("shopify_location_not_mapped");
    expect(shop.state.inventorySets).toHaveLength(0);
    const listing = prisma.storeListing.rows[0];
    expect(listing.syncStatus).toBe("failed");
    expect(listing.lastSyncError).toBe("shopify_location_not_mapped");
  });
});
