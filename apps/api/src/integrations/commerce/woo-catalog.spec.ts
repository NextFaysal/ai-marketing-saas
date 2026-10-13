import { encryptJson } from "../crypto";
import { CommerceAdapterRegistry } from "./adapters";
import * as wooCatalog from "./woo-catalog";

/* ------------------------------------------------------------------ */
/* Hand-rolled fake prisma (B1 style: in-memory tables)                */
/* ------------------------------------------------------------------ */

function matchWhere(row: any, where: any): boolean {
  for (const [k, v] of Object.entries(where ?? {})) {
    if (v === undefined) continue;
    if (v && typeof v === "object" && !(v instanceof Date)) {
      // compound unique key, e.g. { storeId_kind_localId: { storeId, kind, localId } }
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
  } as any;
}

/* ------------------------------------------------------------------ */
/* Stubbed Woo REST server (global-fetch shaped)                       */
/* ------------------------------------------------------------------ */

function priceOf(body: any): string {
  if (body.sale_price !== undefined && body.sale_price !== "") return String(body.sale_price);
  if (body.regular_price !== undefined) return String(body.regular_price);
  return "";
}

function stubWooServer() {
  const calls: { method: string; path: string; body: any }[] = [];
  const products = new Map<string, any>();
  const variations = new Map<string, any[]>();
  let productSeq = 500;
  let variationSeq = 600;
  let categorySeq = 900;
  let tagSeq = 950;
  const state = { readBackPriceOverride: null as string | null };

  const respond = (data: any) => ({
    ok: true,
    status: 200,
    headers: new Headers(),
    text: async () => JSON.stringify(data),
    json: async () => data,
  });

  const fn = async (url: string, init: any = {}) => {
    const method = (init.method ?? "GET").toUpperCase();
    const path = new URL(url).pathname.replace(/^.*\/wp-json\/wc\/v3/, "");
    const body = init.body ? JSON.parse(init.body) : undefined;
    calls.push({ method, path, body });

    if (method === "POST" && path === "/products/categories") {
      return respond({ id: ++categorySeq, name: body.name });
    }
    if (method === "POST" && path === "/products/tags") {
      return respond({ id: ++tagSeq, name: body.name });
    }
    if (method === "POST" && path === "/products") {
      const id = ++productSeq;
      const p = { id, ...body, price: priceOf(body) };
      products.set(String(id), p);
      variations.set(String(id), []);
      return respond(p);
    }
    const batchVar = path.match(/^\/products\/(\d+)\/variations\/batch$/);
    if (method === "POST" && batchVar) {
      const pid = batchVar[1];
      const list = variations.get(pid) ?? [];
      const created: any[] = [];
      const updated: any[] = [];
      for (const c of body.create ?? []) {
        const v = { id: ++variationSeq, ...c, price: priceOf(c) };
        list.push(v);
        created.push(v);
      }
      for (const u of body.update ?? []) {
        const idx = list.findIndex((v) => v.id === u.id);
        const v = { ...(idx >= 0 ? list[idx] : {}), ...u, price: priceOf(u) };
        if (idx >= 0) list[idx] = v;
        else list.push(v);
        updated.push(v);
      }
      variations.set(pid, list);
      return respond({ create: created, update: updated });
    }
    const vars = path.match(/^\/products\/(\d+)\/variations$/);
    if (method === "GET" && vars) {
      return respond(variations.get(vars[1]) ?? []);
    }
    const singleVar = path.match(/^\/products\/(\d+)\/variations\/(\d+)$/);
    if (singleVar) {
      const list = variations.get(singleVar[1]) ?? [];
      const v = list.find((x) => String(x.id) === singleVar[2]);
      if (method === "PUT" && v) Object.assign(v, body);
      return respond(v ?? {});
    }
    const single = path.match(/^\/products\/(\d+)$/);
    if (single) {
      const p = products.get(single[1]);
      if (method === "PUT" && p) {
        Object.assign(p, body);
        p.price = priceOf({ ...p, ...body });
        return respond(p);
      }
      if (method === "DELETE") {
        products.delete(single[1]);
        return respond({ id: Number(single[1]) });
      }
      if (!p) return respond({});
      const out = { ...p };
      if (state.readBackPriceOverride !== null) out.price = state.readBackPriceOverride;
      return respond(out);
    }
    throw new Error(`stub woo: unhandled ${method} ${path}`);
  };

  return { fn: fn as any, calls, products, variations, state };
}

/* ------------------------------------------------------------------ */
/* Fixtures                                                            */
/* ------------------------------------------------------------------ */

const store = { id: "store-1", url: "https://woo.example.com", platform: "WOOCOMMERCE" };
const integration = {
  id: "int-1",
  credential: {
    encryptedData: encryptJson({ consumerKey: "ck_x", consumerSecret: "cs_x", webhookSecret: "wh" }),
  },
};

async function seedVariableProduct(prisma: any) {
  prisma.product.rows.push({
    id: "prod-1",
    organizationId: "org-1",
    name: "Cotton Shirt",
    sku: "P-1",
    description: "Nice shirt",
    priceMinor: 15000n,
    compareAtMinor: 20000n,
    currency: "BDT",
    stockQuantity: 10,
    imageUrl: "https://img.example.com/shirt.jpg",
    category: null,
    categoryId: "cat-1",
    barcode: "8901234",
    weightGrams: 1500,
    lengthCm: 30,
    widthCm: 20,
    heightCm: 5,
    seoTitle: null,
    seoDescription: null,
  });
  prisma.productVariant.rows.push(
    { id: "v1", productId: "prod-1", name: "Red", sku: "P-1-R", priceMinor: 15000n, stockQuantity: 4, attributes: { Color: "Red" }, createdAt: new Date("2026-01-01") },
    { id: "v2", productId: "prod-1", name: "Blue", sku: "P-1-B", priceMinor: 16000n, stockQuantity: 6, attributes: { Color: "Blue" }, createdAt: new Date("2026-01-02") },
  );
  prisma.category.rows.push({ id: "cat-1", organizationId: "org-1", name: "Clothing", parentId: null });
  prisma.productTag.rows.push({ id: "tag-1", organizationId: "org-1", name: "New" });
  prisma.productTagAssignment.rows.push({ id: "asg-1", productId: "prod-1", tagId: "tag-1" });
  prisma.storeListing.rows.push({
    id: "lst-1",
    organizationId: "org-1",
    storeId: "store-1",
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

describe("woo-catalog pushProduct", () => {
  it("creates a variable product: batch variations, taxonomy create-on-miss, read-back -> listing synced with variant map", async () => {
    const prisma = fakePrisma();
    await seedVariableProduct(prisma);
    const server = stubWooServer();

    const res = await wooCatalog.pushProduct({
      prisma,
      organizationId: "org-1",
      store,
      integration,
      payload: { listingId: "lst-1", productId: "prod-1" },
      fetchFn: server.fn,
    });

    expect(res.ok).toBe(true);
    expect(res.responseSummary.remoteId).toBe("501");

    const createCall = server.calls.find((c) => c.method === "POST" && c.path === "/products");
    expect(createCall).toBeTruthy();
    expect(createCall!.body.type).toBe("variable");
    expect(createCall!.body.status).toBe("publish");
    // Sale on: regular = compareAt (200.00), sale = effective (150.00)
    expect(createCall!.body.regular_price).toBe("200.00");
    expect(createCall!.body.sale_price).toBe("150.00");
    expect(createCall!.body.weight).toBe("1.5");
    expect(createCall!.body.categories).toEqual([{ id: 901 }]);
    expect(createCall!.body.tags).toEqual([{ id: 951 }]);
    expect(createCall!.body.attributes).toEqual([
      { name: "Color", options: ["Red", "Blue"], variation: true, visible: true },
    ]);

    const batchCall = server.calls.find((c) => c.path === "/products/501/variations/batch");
    expect(batchCall).toBeTruthy();
    expect(batchCall!.body.create).toHaveLength(2);
    expect(batchCall!.body.create[0].sku).toBe("P-1-R");

    const listing = prisma.storeListing.rows[0];
    expect(listing.syncStatus).toBe("synced");
    expect(listing.externalId).toBe("501");
    expect(listing.externalVariantMap).toEqual({ v1: { id: "601" }, v2: { id: "602" } });
    expect(listing.lastPushedHash).toMatch(/^[0-9a-f]{64}$/);
    expect(listing.lastPushedAt).toBeInstanceOf(Date);
    expect(listing.channelStock).toBe(10);
    expect(listing.lastSyncError).toBeNull();

    // Taxonomy maps persisted for both category and tag.
    const maps = prisma.storeTaxonomyMap.rows;
    expect(maps).toContainEqual(expect.objectContaining({ storeId: "store-1", kind: "category", localId: "cat-1", externalId: "901" }));
    expect(maps).toContainEqual(expect.objectContaining({ storeId: "store-1", kind: "tag", localId: "tag-1", externalId: "951" }));
  });

  it("read-back price mismatch fails the listing with the verbatim readback_mismatch error", async () => {
    const prisma = fakePrisma();
    prisma.product.rows.push({
      id: "prod-2",
      organizationId: "org-1",
      name: "Mug",
      sku: "M-1",
      description: null,
      priceMinor: 15000n,
      compareAtMinor: null,
      currency: "BDT",
      stockQuantity: 3,
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
      id: "lst-2",
      organizationId: "org-1",
      storeId: "store-1",
      productId: "prod-2",
      externalId: "777",
      externalVariantMap: null,
      publishState: "published",
      channelPriceMinor: null,
      syncStatus: "synced",
      lastSyncError: null,
      saleStartsAt: null,
      saleEndsAt: null,
      saleActive: false,
    });
    const server = stubWooServer();
    server.products.set("777", {
      id: 777,
      name: "Mug",
      status: "publish",
      price: "150.00",
      manage_stock: true,
      stock_quantity: 3,
    });
    server.state.readBackPriceOverride = "999.00";

    const res = await wooCatalog.pushProduct({
      prisma,
      organizationId: "org-1",
      store,
      integration,
      payload: { listingId: "lst-2", productId: "prod-2" },
      fetchFn: server.fn,
    });

    expect(res.ok).toBe(false);
    expect(res.error).toBe("readback_mismatch: price expected 15000 got 99900");
    const listing = prisma.storeListing.rows[0];
    expect(listing.syncStatus).toBe("failed");
    expect(listing.lastSyncError).toBe("readback_mismatch: price expected 15000 got 99900");
  });

  it("refuses to push a listing with an open conflict", async () => {
    const prisma = fakePrisma();
    prisma.storeListing.rows.push({
      id: "lst-3",
      organizationId: "org-1",
      storeId: "store-1",
      productId: "prod-x",
      externalId: "5",
      syncStatus: "conflict",
    });
    const server = stubWooServer();
    const res = await wooCatalog.pushProduct({
      prisma,
      organizationId: "org-1",
      store,
      integration,
      payload: { listingId: "lst-3", productId: "prod-x" },
      fetchFn: server.fn,
    });
    expect(res).toEqual({ ok: false, error: "listing_conflict_open" });
    expect(server.calls).toHaveLength(0);
  });
});

describe("woo-catalog pushInventory", () => {
  it("PUTs the quantity, verifies by read-back, and does not touch lastPushedHash", async () => {
    const prisma = fakePrisma();
    prisma.storeListing.rows.push({
      id: "lst-4",
      organizationId: "org-1",
      storeId: "store-1",
      productId: "prod-2",
      externalId: "777",
      externalVariantMap: null,
      publishState: "published",
      syncStatus: "synced",
      lastSyncError: null,
      lastPushedHash: "sentinel-hash",
      channelStock: 3,
    });
    const server = stubWooServer();
    server.products.set("777", { id: 777, name: "Mug", status: "publish", price: "150.00", manage_stock: true, stock_quantity: 3 });

    const res = await wooCatalog.pushInventory({
      prisma,
      organizationId: "org-1",
      store,
      integration,
      payload: { listingId: "lst-4", productId: "prod-2", variantId: null, quantity: 42 },
      fetchFn: server.fn,
    });

    expect(res.ok).toBe(true);
    const put = server.calls.find((c) => c.method === "PUT" && c.path === "/products/777");
    expect(put!.body).toEqual({ manage_stock: true, stock_quantity: 42 });
    const listing = prisma.storeListing.rows[0];
    expect(listing.channelStock).toBe(42);
    expect(listing.lastPushedHash).toBe("sentinel-hash");
    expect(listing.syncStatus).toBe("synced");
  });
});

describe("woo adapter dispatch (registry)", () => {
  it("returns adapter_prisma_unavailable without prisma and flips capabilities on", async () => {
    const bare = new CommerceAdapterRegistry();
    const woo = bare.get("woocommerce")!;
    expect(woo.capabilities.push_product).toBe(true);
    expect(woo.capabilities.push_inventory).toBe(true);
    expect(woo.capabilities.push_category).toBe(true);
    expect(woo.capabilities.archive_product).toBe(true);
    expect(woo.capabilities.delete_product_remote).toBe(true);
    const res = await woo.execute({
      organizationId: "org-1",
      store,
      integration,
      operation: "push_product",
      payload: { listingId: "lst-1", productId: "prod-1" },
    });
    expect(res).toEqual({ ok: false, error: "adapter_prisma_unavailable" });
    // Native stays untouched.
    expect(bare.get("native")!.capabilities.push_product).toBe(false);
  });
});
