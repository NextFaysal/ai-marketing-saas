process.env.ENCRYPTION_KEY = Buffer.alloc(32, 7).toString("base64");
import { NotFoundException } from "@nestjs/common";
import { CatalogsService, buildBatchRequests, buildDeleteRequests } from "./catalogs.service";
import { ProductsService } from "../products/products.service";
import { AutomationService, JOB_TEMPLATES, JOB_TYPES } from "../automation/automation.service";
import { encryptJson } from "../integrations/crypto";

/**
 * AB5 (AX10) — Meta catalog sync lifecycle specs.
 *
 * Network boundary: the global fetch is stubbed (the phase-h
 * graphFetch pattern) — graphPost/graphGet run for real against
 * it, so request shapes (URL, item_type, the requests JSON) are
 * proven, never a live Meta call. Prisma is an in-memory fake in
 * the established makeTable style.
 *
 * Evidence ceiling: stub level only — no real Meta catalog,
 * token, or Page exists in this sandbox.
 */
const ORG = "org-1";
const ORG2 = "org-2";
const ACTOR = "owner-1";
const SITE = "https://shop.example";

const REAL_FETCH = (global as any).fetch;
afterAll(() => {
  (global as any).fetch = REAL_FETCH;
});

function matches(row: any, where: any): boolean {
  return Object.entries(where ?? {}).every(([k, v]: [string, any]) => {
    if (v === undefined) return true;
    if (v !== null && typeof v === "object" && !(v instanceof Date)) {
      if ("in" in v) return v.in.includes(row[k]);
      if ("not" in v) return v.not === null ? row[k] !== null && row[k] !== undefined : row[k] !== v.not;
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
    findMany: async ({ where, take, orderBy }: any = {}) => {
      let f = rows.filter((r) => matches(r, where ?? {}));
      if (orderBy?.createdAt === "asc") f = [...f].sort((a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime());
      if (orderBy?.createdAt === "desc") f = [...f].sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
      return take ? f.slice(0, take) : f;
    },
    count: async ({ where }: any = {}) => rows.filter((r) => matches(r, where ?? {})).length,
    create: async ({ data }: any) => {
      const row = { id: `${name}-${++seq}`, createdAt: new Date(1700000000000 + seq * 1000), updatedAt: new Date(), attempts: 0, ...data };
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
      if (i < 0) throw new Error(`row not found in ${name}`);
      return rows.splice(i, 1)[0];
    },
  };
}

function fakePrisma() {
  const prisma: any = {
    catalogRecord: makeTable("catalog"),
    catalogSyncRecord: makeTable("sync"),
    product: makeTable("product"),
    productVariant: makeTable("variant"),
    businessProfile: makeTable("profile"),
    integration: makeTable("integration"),
  };
  // Emulate Prisma's `include: { variants }` on product reads.
  const attach = (row: any, args: any) => {
    if (!row || !args?.include?.variants) return row;
    return { ...row, variants: prisma.productVariant.rows.filter((v: any) => v.productId === row.id) };
  };
  const first = prisma.product.findFirst;
  prisma.product.findFirst = async (args: any = {}) => attach(await first(args), args);
  const many = prisma.product.findMany;
  prisma.product.findMany = async (args: any = {}) => {
    const rows = await many(args);
    return args?.include?.variants ? rows.map((r: any) => attach(r, args)) : rows;
  };
  return prisma;
}

function makeAudit() {
  const calls: any[] = [];
  return { calls, log: async (entry: any) => { calls.push(entry); } };
}

function graphFetch(handler: (url: string, body: URLSearchParams) => any) {
  const calls: { url: string; body: URLSearchParams }[] = [];
  (global as any).fetch = async (url: string, init: any) => {
    const body = new URLSearchParams(String(init?.body ?? ""));
    calls.push({ url: String(url), body });
    const out = handler(String(url), body);
    return { ok: true, status: 200, json: async () => out, statusText: "OK" } as any;
  };
  return calls;
}

function batchRequests(call: { body: URLSearchParams }): any[] {
  return JSON.parse(call.body.get("requests")!);
}

function seedCatalog(prisma: any, over: Record<string, any> = {}) {
  const row = {
    id: "cat-1", organizationId: ORG, name: "Main", externalCatalogId: "ext-1", businessId: "biz-1",
    status: "connected", autoSync: true, pageId: "pg-1", pageName: "Shop Page",
    instagramId: null, instagramName: null, lastSyncAt: null, lastSyncSummary: null,
    createdAt: new Date(), ...over,
  };
  prisma.catalogRecord.rows.push(row);
  return row;
}

function seedProduct(prisma: any, over: Record<string, any> = {}) {
  const row = {
    id: "p1", organizationId: ORG, name: "Shirt", slug: "shirt-x1", description: "Comfy",
    category: "Fashion", sku: "SKU-1", status: "ACTIVE", priceMinor: 10000n, currency: "BDT",
    stockQuantity: 5, imageUrl: "https://img/a.jpg", createdAt: new Date(), ...over,
  };
  prisma.product.rows.push(row);
  return row;
}

function seedVariant(prisma: any, over: Record<string, any> = {}) {
  const row = { id: "v1", productId: "p1", name: "Red / M", sku: "SKU-RED", priceMinor: 12000n, stockQuantity: 0, createdAt: new Date(), ...over };
  prisma.productVariant.rows.push(row);
  return row;
}

function seedProfile(prisma: any, websiteUrl: string | null = SITE) {
  prisma.businessProfile.rows.push({ id: "bp-1", organizationId: ORG, websiteUrl });
}

function seedIntegration(prisma: any) {
  prisma.integration.rows.push({
    id: "int-1", organizationId: ORG, provider: "meta", status: "CONNECTED", createdAt: new Date(),
    credential: { encryptedData: encryptJson({ accessToken: "tok-1" }) },
  });
}

function seedPending(prisma: any, over: Record<string, any> = {}) {
  const row = {
    id: `sync-seed-${prisma.catalogSyncRecord.rows.length + 1}`, organizationId: ORG, catalogId: "cat-1",
    productId: "p1", retailerId: "SKU-1", action: "create", status: "pending", attempts: 0,
    lastError: null, processedAt: null, createdAt: new Date(Date.now() + prisma.catalogSyncRecord.rows.length), ...over,
  };
  prisma.catalogSyncRecord.rows.push(row);
  return row;
}

const svc = (prisma: any, audit: any = makeAudit()) => new CatalogsService(prisma as any, audit as any);

// ---------- Part 1: the payload builder ----------

describe("AX10 builder — product without variants is today's exact shape", () => {
  const p = {
    id: "p1", name: "Shirt", description: "Comfy", category: "Fashion", sku: "SKU-1",
    priceMinor: 10000n, currency: "BDT", stockQuantity: 5, slug: "shirt-x1",
    imageUrl: "https://img/a.jpg", variants: [] as any[],
  };

  it("one CREATE request, field-for-field the pre-AX10 push payload", () => {
    expect(buildBatchRequests([p], SITE, "CREATE")).toEqual([
      {
        method: "CREATE",
        retailer_id: "SKU-1",
        data: {
          name: "Shirt", description: "Comfy", category: "Fashion", price: 10000,
          currency: "BDT", availability: "in stock", condition: "new",
          url: "https://shop.example/product/shirt-x1", image_url: "https://img/a.jpg",
        },
      },
    ]);
  });

  it("omits absent optional fields, falls back to id, stock 0 is out of stock, UPDATE propagates", () => {
    const bare = { id: "p9", name: "Bare", priceMinor: 500n, stockQuantity: 0 };
    const [req] = buildBatchRequests([bare], SITE, "UPDATE");
    expect(req.method).toBe("UPDATE");
    expect(req.retailer_id).toBe("p9");
    expect(req.data).toEqual({
      name: "Bare", price: 500, currency: "BDT", availability: "out of stock",
      condition: "new", url: "https://shop.example/product/p9",
    });
  });
});

describe("AX10 builder — variant items", () => {
  it("one request per variant: grouping id, stable retailer ids, variant price/stock win, product fields inherited", () => {
    const p = {
      id: "p1", name: "Shirt", description: "Comfy", category: "Fashion", sku: "SKU-1",
      priceMinor: 10000n, currency: "BDT", stockQuantity: 5, slug: "shirt-x1",
      imageUrl: "https://img/a.jpg",
      variants: [
        { id: "v1", name: "Red / M", sku: "SKU-RED", priceMinor: 12000n, stockQuantity: 0 },
        { id: "v2", name: "Blue / M", sku: null, priceMinor: null, stockQuantity: null },
      ],
    };
    const reqs = buildBatchRequests([p], SITE, "CREATE");
    expect(reqs).toHaveLength(2);
    expect(reqs[0].retailer_id).toBe("SKU-RED");
    expect(reqs[0].data).toMatchObject({
      name: "Shirt — Red / M", price: 12000, availability: "out of stock",
      item_group_id: "SKU-1", category: "Fashion", currency: "BDT",
      url: "https://shop.example/product/shirt-x1", image_url: "https://img/a.jpg",
    });
    // No variant sku → `${base}--v${variant.id}`; null price/stock
    // fall back to the product's.
    expect(reqs[1].retailer_id).toBe("SKU-1--vv2");
    expect(reqs[1].data).toMatchObject({
      name: "Shirt — Blue / M", price: 10000, availability: "in stock", item_group_id: "SKU-1",
    });
  });
});

describe("AX10 builder — DELETE requests", () => {
  it("archived product that still loads: base + every variant retailer id, empty data", () => {
    const p = {
      id: "p1", sku: "SKU-1",
      variants: [
        { id: "v1", sku: "SKU-RED" },
        { id: "v2", sku: null },
      ],
    };
    expect(buildDeleteRequests(p, "SKU-1")).toEqual([
      { method: "DELETE", retailer_id: "SKU-1", data: {} },
      { method: "DELETE", retailer_id: "SKU-RED", data: {} },
      { method: "DELETE", retailer_id: "SKU-1--vv2", data: {} },
    ]);
  });

  it("gone product: only the snapshot retailer id; no snapshot → no requests", () => {
    expect(buildDeleteRequests(null, "SKU-9")).toEqual([{ method: "DELETE", retailer_id: "SKU-9", data: {} }]);
    expect(buildDeleteRequests(null, null)).toEqual([]);
  });
});

// ---------- Part 3: enqueue + collapse ----------

describe("AX10 noteProductChanged — enqueue + collapse", () => {
  function setup() {
    const prisma = fakePrisma();
    seedCatalog(prisma);
    seedCatalog(prisma, { id: "cat-off", externalCatalogId: "ext-off", autoSync: false });
    seedProduct(prisma);
    return { prisma, service: svc(prisma) };
  }

  it("enqueues a pending create with the retailer snapshot, only for autoSync catalogs", async () => {
    const { prisma, service } = setup();
    await service.noteProductChanged(ORG, "p1", "create");
    expect(prisma.catalogSyncRecord.rows).toHaveLength(1);
    expect(prisma.catalogSyncRecord.rows[0]).toMatchObject({
      organizationId: ORG, catalogId: "cat-1", productId: "p1",
      retailerId: "SKU-1", action: "create", status: "pending",
    });
  });

  it("update + update collapses to a single pending row (latest action, retailer refreshed)", async () => {
    const { prisma, service } = setup();
    await service.noteProductChanged(ORG, "p1", "update");
    prisma.product.rows[0].sku = "SKU-2";
    await service.noteProductChanged(ORG, "p1", "update");
    expect(prisma.catalogSyncRecord.rows).toHaveLength(1);
    expect(prisma.catalogSyncRecord.rows[0]).toMatchObject({ action: "update", retailerId: "SKU-2" });
  });

  it("create then update collapses to update; update then delete collapses to delete", async () => {
    const { prisma, service } = setup();
    await service.noteProductChanged(ORG, "p1", "create");
    await service.noteProductChanged(ORG, "p1", "update");
    expect(prisma.catalogSyncRecord.rows).toHaveLength(1);
    expect(prisma.catalogSyncRecord.rows[0].action).toBe("update");
    await service.noteProductChanged(ORG, "p1", "delete");
    expect(prisma.catalogSyncRecord.rows).toHaveLength(1);
    expect(prisma.catalogSyncRecord.rows[0].action).toBe("delete");
  });

  it("delete then update stays delete (a delete is never resurrected)", async () => {
    const { prisma, service } = setup();
    await service.noteProductChanged(ORG, "p1", "delete");
    await service.noteProductChanged(ORG, "p1", "update");
    expect(prisma.catalogSyncRecord.rows).toHaveLength(1);
    expect(prisma.catalogSyncRecord.rows[0].action).toBe("delete");
  });

  it("gone product snapshots the productId itself as the retailer id", async () => {
    const { prisma, service } = setup();
    await service.noteProductChanged(ORG, "p-gone", "delete");
    expect(prisma.catalogSyncRecord.rows[0]).toMatchObject({ productId: "p-gone", retailerId: "p-gone" });
  });

  it("autoSync off everywhere → nothing enqueued", async () => {
    const prisma = fakePrisma();
    seedCatalog(prisma, { autoSync: false });
    seedProduct(prisma);
    await svc(prisma).noteProductChanged(ORG, "p1", "create");
    expect(prisma.catalogSyncRecord.rows).toHaveLength(0);
  });

  it("never throws even when the catalog lookup explodes", async () => {
    const prisma = fakePrisma();
    prisma.catalogRecord.findMany = async () => { throw new Error("db down"); };
    await expect(svc(prisma).noteProductChanged(ORG, "p1", "create")).resolves.toBeUndefined();
  });
});

// ---------- Part 3: state + settings ----------

describe("AX10 productSyncState / syncStatus / updateCatalog", () => {
  it("never_queued when no record exists, with the honest basis + note", async () => {
    const prisma = fakePrisma();
    seedCatalog(prisma);
    const state = await svc(prisma).productSyncState(ORG, "cat-1", "p1");
    expect(state).toEqual({
      basis: "auto_sync_records", state: "never_queued",
      note: "manual pushes update catalog-level state only",
    });
  });

  it("returns the latest record's state after an enqueue", async () => {
    const prisma = fakePrisma();
    seedCatalog(prisma);
    seedProduct(prisma);
    const service = svc(prisma);
    await service.noteProductChanged(ORG, "p1", "create");
    const state: any = await service.productSyncState(ORG, "cat-1", "p1");
    expect(state.basis).toBe("auto_sync_records");
    expect(state.state).toBe("pending");
    expect(state.action).toBe("create");
    expect(state.attempts).toBe(0);
    expect(state.lastError).toBeNull();
    expect(state.processedAt).toBeNull();
    expect(state.queuedAt).toBeInstanceOf(Date);
    expect(state.note).toBe("manual pushes update catalog-level state only");
  });

  it("syncStatus counts the queue and passes the catalog stamp through", async () => {
    const prisma = fakePrisma();
    const stamp = new Date();
    seedCatalog(prisma, { lastSyncAt: stamp, lastSyncSummary: { via: "auto_sync", done: 1 } });
    seedPending(prisma, { id: "s1" });
    seedPending(prisma, { id: "s2" });
    seedPending(prisma, { id: "s3", status: "done" });
    seedPending(prisma, { id: "s4", status: "failed" });
    const out: any = await svc(prisma).syncStatus(ORG, "cat-1");
    expect(out.autoSync).toBe(true);
    expect(out.counts).toEqual({ pending: 2, failed: 1, done: 1 });
    expect(out.lastSyncAt).toBe(stamp);
    expect(out.lastSyncSummary).toEqual({ via: "auto_sync", done: 1 });
  });

  it("updateCatalog is partial, null clears, and audits the written fields", async () => {
    const prisma = fakePrisma();
    seedCatalog(prisma, { autoSync: false });
    const audit = makeAudit();
    const service = svc(prisma, audit);
    const updated: any = await service.updateCatalog(ORG, ACTOR, "cat-1", { autoSync: true });
    expect(updated.autoSync).toBe(true);
    expect(updated.pageId).toBe("pg-1"); // untouched
    expect(audit.calls).toHaveLength(1);
    expect(audit.calls[0]).toMatchObject({ action: "catalog.updated", entityId: "cat-1", metadata: { fields: ["autoSync"] } });
    const cleared: any = await service.updateCatalog(ORG, ACTOR, "cat-1", { pageId: null, instagramName: "shop.ig" });
    expect(cleared.pageId).toBeNull();
    expect(cleared.instagramName).toBe("shop.ig");
  });

  it("updateCatalog / productSyncState 404 for a foreign catalog", async () => {
    const prisma = fakePrisma();
    seedCatalog(prisma, { organizationId: ORG2 });
    const service = svc(prisma);
    await expect(service.updateCatalog(ORG, ACTOR, "cat-1", { autoSync: true })).rejects.toThrow(NotFoundException);
    await expect(service.productSyncState(ORG, "cat-1", "p1")).rejects.toThrow(NotFoundException);
  });
});

// ---------- Part 2: manual push upgrade ----------

describe("AX10 pushProducts — variant items via the builder, no sync records", () => {
  it("pushes per-variant items, summary gains items, and writes NO CatalogSyncRecord rows", async () => {
    const prisma = fakePrisma();
    seedCatalog(prisma);
    seedProfile(prisma);
    seedIntegration(prisma);
    seedProduct(prisma);
    seedVariant(prisma);
    seedProduct(prisma, { id: "p2", name: "Shoes", slug: "shoes-x1", sku: "SKU-2", description: null, category: null, imageUrl: null });
    const calls = graphFetch(() => ({ handles: ["h1", "h2"], errors: [] }));
    const summary: any = await svc(prisma).pushProducts(ORG, ACTOR, "cat-1");
    expect(summary.total).toBe(2);
    expect(summary.items).toBe(2); // p1's single variant item + p2's product item
    expect(summary.pushed).toBe(2);
    expect(summary.errors).toBe(0);
    const reqs = batchRequests(calls[0]);
    expect(reqs.map((r: any) => r.method)).toEqual(["CREATE", "CREATE"]);
    expect(reqs[0].retailer_id).toBe("SKU-RED");
    expect(reqs[0].data.item_group_id).toBe("SKU-1");
    expect(reqs[1].retailer_id).toBe("SKU-2");
    expect(prisma.catalogSyncRecord.rows).toHaveLength(0);
    expect(prisma.catalogRecord.rows[0].lastSyncSummary.items).toBe(2);
  });
});

// ---------- Part 4: the sweep ----------

describe("AX10 runCatalogSyncSweep", () => {
  function setup(over: { website?: string | null; withToken?: boolean } = {}) {
    const prisma = fakePrisma();
    seedCatalog(prisma);
    seedProfile(prisma, over.website === undefined ? SITE : over.website);
    if (over.withToken !== false) seedIntegration(prisma);
    seedProduct(prisma);
    seedVariant(prisma);
    return { prisma, service: svc(prisma) };
  }

  it("success: record done + processedAt, catalog stamped with the auto_sync summary, variant item sent as CREATE", async () => {
    const { prisma, service } = setup();
    seedPending(prisma);
    const calls = graphFetch(() => ({ handles: ["h1"], errors: [] }));
    const out = await service.runCatalogSyncSweep(ORG);
    expect(out).toEqual({ catalogs: 1, done: 1, failed: 0, pending: 0 });
    const rec = prisma.catalogSyncRecord.rows[0];
    expect(rec.status).toBe("done");
    expect(rec.attempts).toBe(1);
    expect(rec.lastError).toBeNull();
    expect(rec.processedAt).toBeInstanceOf(Date);
    expect(calls).toHaveLength(1);
    expect(calls[0].url).toContain("/ext-1/batch");
    expect(calls[0].body.get("item_type")).toBe("PRODUCT_ITEM");
    const reqs = batchRequests(calls[0]);
    expect(reqs).toHaveLength(1);
    expect(reqs[0]).toMatchObject({ method: "CREATE", retailer_id: "SKU-RED" });
    expect(reqs[0].data.item_group_id).toBe("SKU-1");
    const catalog = prisma.catalogRecord.rows[0];
    expect(catalog.lastSyncAt).toBeInstanceOf(Date);
    expect(catalog.lastSyncSummary).toMatchObject({ via: "auto_sync", done: 1, failed: 0, stillPending: 0 });
  });

  it("an update record sends UPDATE for the current product", async () => {
    const { prisma, service } = setup();
    seedPending(prisma, { action: "update" });
    const calls = graphFetch(() => ({ handles: ["h1"], errors: [] }));
    await service.runCatalogSyncSweep(ORG);
    expect(batchRequests(calls[0])[0].method).toBe("UPDATE");
  });

  it("batch errors retry: attempts 1 and 2 stay pending, the 3rd turns failed with Meta's message", async () => {
    const { prisma, service } = setup();
    seedPending(prisma);
    const calls = graphFetch(() => ({ handles: [], errors: [{ message: "bad item data" }] }));
    let out = await service.runCatalogSyncSweep(ORG);
    expect(out).toEqual({ catalogs: 1, done: 0, failed: 0, pending: 1 });
    expect(prisma.catalogSyncRecord.rows[0]).toMatchObject({ status: "pending", attempts: 1, lastError: "bad item data" });
    out = await service.runCatalogSyncSweep(ORG);
    expect(out.pending).toBe(1);
    expect(prisma.catalogSyncRecord.rows[0]).toMatchObject({ status: "pending", attempts: 2 });
    out = await service.runCatalogSyncSweep(ORG);
    expect(out).toEqual({ catalogs: 1, done: 0, failed: 1, pending: 0 });
    expect(prisma.catalogSyncRecord.rows[0]).toMatchObject({ status: "failed", attempts: 3, lastError: "bad item data" });
    // A failed record is never drained again.
    await service.runCatalogSyncSweep(ORG);
    expect(calls).toHaveLength(3);
  });

  it("a thrown batch call (Meta error response) follows the same retry rule", async () => {
    const { prisma, service } = setup();
    seedPending(prisma);
    (global as any).fetch = async () => ({
      ok: false, status: 400, statusText: "Bad Request",
      json: async () => ({ error: { message: "OAuth token expired" } }),
    });
    await service.runCatalogSyncSweep(ORG);
    expect(prisma.catalogSyncRecord.rows[0]).toMatchObject({ status: "pending", attempts: 1, lastError: "OAuth token expired" });
  });

  it("create for an inactive (archived) product converts to DELETE incl. variants", async () => {
    const { prisma, service } = setup();
    prisma.product.rows[0].status = "ARCHIVED";
    seedPending(prisma, { action: "create" });
    const calls = graphFetch(() => ({ handles: ["h1", "h2"], errors: [] }));
    const out = await service.runCatalogSyncSweep(ORG);
    expect(out.done).toBe(1);
    const reqs = batchRequests(calls[0]);
    expect(reqs).toEqual([
      { method: "DELETE", retailer_id: "SKU-1", data: {} },
      { method: "DELETE", retailer_id: "SKU-RED", data: {} },
    ]);
  });

  it("update for a gone product converts to DELETE with the snapshot only", async () => {
    const { prisma, service } = setup();
    seedPending(prisma, { action: "update", productId: "p-gone", retailerId: "SKU-OLD" });
    const calls = graphFetch(() => ({ handles: ["h1"], errors: [] }));
    await service.runCatalogSyncSweep(ORG);
    expect(batchRequests(calls[0])).toEqual([{ method: "DELETE", retailer_id: "SKU-OLD", data: {} }]);
    expect(prisma.catalogSyncRecord.rows[0].status).toBe("done");
  });

  it("website missing: payload-needing records fail website_missing, DELETEs still proceed", async () => {
    const { prisma, service } = setup({ website: null });
    seedPending(prisma, { id: "s-upd", action: "update" });
    seedPending(prisma, { id: "s-del", action: "delete", productId: "p2", retailerId: "SKU-2" });
    const calls = graphFetch(() => ({ handles: ["h1"], errors: [] }));
    const out = await service.runCatalogSyncSweep(ORG);
    expect(out).toEqual({ catalogs: 1, done: 1, failed: 0, pending: 1 });
    const upd = prisma.catalogSyncRecord.rows.find((r: any) => r.id === "s-upd");
    expect(upd).toMatchObject({ status: "pending", attempts: 1, lastError: "website_missing" });
    const del = prisma.catalogSyncRecord.rows.find((r: any) => r.id === "s-del");
    expect(del.status).toBe("done");
    expect(calls).toHaveLength(1); // only the DELETE was sent
    expect(batchRequests(calls[0])).toEqual([{ method: "DELETE", retailer_id: "SKU-2", data: {} }]);
  });

  it("token resolution failure fails the whole drain under the same retry rule, with no Meta call", async () => {
    const { prisma, service } = setup({ withToken: false });
    seedPending(prisma);
    const calls = graphFetch(() => ({ handles: [], errors: [] }));
    const out = await service.runCatalogSyncSweep(ORG);
    expect(out).toEqual({ catalogs: 1, done: 0, failed: 0, pending: 1 });
    expect(prisma.catalogSyncRecord.rows[0].attempts).toBe(1);
    expect(prisma.catalogSyncRecord.rows[0].lastError).toContain("No connected Meta integration");
    expect(calls).toHaveLength(0);
  });

  it("catalogs without autoSync are not drained at all", async () => {
    const prisma = fakePrisma();
    seedCatalog(prisma, { autoSync: false });
    seedPending(prisma);
    const calls = graphFetch(() => ({ handles: [], errors: [] }));
    const out = await svc(prisma).runCatalogSyncSweep(ORG);
    expect(out).toEqual({ catalogs: 0, done: 0, failed: 0, pending: 0 });
    expect(prisma.catalogSyncRecord.rows[0]).toMatchObject({ status: "pending", attempts: 0 });
    expect(calls).toHaveLength(0);
  });
});

// ---------- Part 3: product-write hooks ----------

describe("AX10 ProductsService hooks", () => {
  function setup() {
    const prisma = fakePrisma();
    seedCatalog(prisma);
    prisma.product.rows.push({
      id: "p1", organizationId: ORG, name: "Shirt", slug: "shirt-x1", category: "Fashion",
      sku: "SKU-1", status: "ACTIVE", priceMinor: 10000n, compareAtMinor: null, currency: "BDT",
      stockQuantity: 5, imageUrl: null, variants: [], costs: [], createdAt: new Date(),
    });
    const catalogs = svc(prisma);
    // ProductsService positional discipline: catalogSync is the
    // LAST (16th) constructor param — 13 optionals before it.
    const products = new ProductsService(
      prisma as any, makeAudit() as any,
      undefined, undefined, undefined, undefined, undefined, undefined, undefined,
      undefined, undefined, undefined, undefined, undefined, undefined,
      catalogs as any,
    );
    return { prisma, products };
  }

  it("archive enqueues a pending delete for autoSync catalogs", async () => {
    const { prisma, products } = setup();
    await products.archive(ORG, ACTOR, "p1");
    expect(prisma.product.rows[0].status).toBe("ARCHIVED");
    expect(prisma.catalogSyncRecord.rows).toHaveLength(1);
    expect(prisma.catalogSyncRecord.rows[0]).toMatchObject({ productId: "p1", action: "delete", status: "pending", retailerId: "SKU-1" });
  });

  it("createVariant enqueues a pending update for the product", async () => {
    const { prisma, products } = setup();
    await products.createVariant(ORG, ACTOR, "p1", { name: "Red / M" } as any);
    expect(prisma.catalogSyncRecord.rows).toHaveLength(1);
    expect(prisma.catalogSyncRecord.rows[0]).toMatchObject({ productId: "p1", action: "update", status: "pending" });
  });

  it("a throwing catalog service never fails the product write", async () => {
    const prisma = fakePrisma();
    prisma.product.rows.push({
      id: "p1", organizationId: ORG, name: "Shirt", slug: "shirt-x1", sku: "SKU-1",
      status: "ACTIVE", priceMinor: 10000n, compareAtMinor: null, stockQuantity: 5,
      variants: [], costs: [], createdAt: new Date(),
    });
    const throwing = { noteProductChanged: async () => { throw new Error("catalog exploded"); } };
    const products = new ProductsService(
      prisma as any, makeAudit() as any,
      undefined, undefined, undefined, undefined, undefined, undefined, undefined,
      undefined, undefined, undefined, undefined, undefined, undefined,
      throwing as any,
    );
    const out: any = await products.archive(ORG, ACTOR, "p1");
    expect(out.status).toBe("ARCHIVED");
    expect(prisma.product.rows[0].status).toBe("ARCHIVED");
  });
});

// ---------- Part 4: job registration ----------

describe("AX10 catalog_sync_sweep job registration", () => {
  it("is a real JOB_TYPES member with an org template at 10 minutes", () => {
    expect(JOB_TYPES as readonly string[]).toContain("catalog_sync_sweep");
    const tpl = JOB_TEMPLATES.find((t) => t.key === "catalog_sync_sweep");
    expect(tpl).toMatchObject({ type: "catalog_sync_sweep", targetKind: "org", intervalMinutes: 10 });
  });

  it("executeJob dispatches to CatalogsService.runCatalogSyncSweep; absent service skips honestly", async () => {
    const seen: string[] = [];
    const stub = { runCatalogSyncSweep: async (orgId: string) => { seen.push(orgId); return { catalogs: 1, done: 2, failed: 0, pending: 0 }; } };
    // AutomationService positional discipline: catalogs is the
    // LAST constructor param — 32 optionals precede it after
    // (prisma, audit, integrations … giftCards).
    const withSvc = new (AutomationService as any)(
      {}, { log: async () => undefined },
      ...Array(32).fill(undefined),
      stub,
    );
    const out = await withSvc.executeJob({ organizationId: ORG, type: "catalog_sync_sweep", createdById: ACTOR, targetId: ORG });
    expect(out).toEqual({ catalogs: 1, done: 2, failed: 0, pending: 0 });
    expect(seen).toEqual([ORG]);

    const without = new (AutomationService as any)({}, { log: async () => undefined }, ...Array(33).fill(undefined));
    const skipped = await without.executeJob({ organizationId: ORG, type: "catalog_sync_sweep", createdById: ACTOR, targetId: ORG });
    expect(skipped).toEqual({ skipped: "catalogs unavailable" });
  });
});
