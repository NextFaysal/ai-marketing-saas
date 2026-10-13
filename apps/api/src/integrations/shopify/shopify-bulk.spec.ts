import { IntegrationsService } from "../integrations.service";
import { ShopifyService } from "./shopify.service";
import { parseBulkProductsJsonl, gidNumeric, BULK_PRODUCTS_QUERY } from "./shopify-bulk";
import { encryptJson } from "../crypto";

// In-memory fakes (same makeTable pattern as ec2-connection.spec.ts),
// except deleteMany reports a count like real Prisma.
function makeTable() {
  const rows: any[] = [];
  let seq = 0;
  const matches = (row: any, where: any) =>
    Object.entries(where ?? {}).every(([k, v]) => v === undefined || row[k] === v);
  return {
    rows,
    findFirst: async ({ where }: any) => rows.find((r) => matches(r, where)) ?? null,
    findMany: async ({ where }: any = {}) => rows.filter((r) => matches(r, where ?? {})),
    findUnique: async ({ where }: any) => rows.find((r) => r.id === where.id) ?? null,
    create: async ({ data }: any) => { const row = { id: data.id ?? `id-${++seq}`, ...data }; rows.push(row); return row; },
    update: async ({ where, data }: any) => {
      const row = rows.find((r) => r.id === where.id);
      if (row) Object.assign(row, data);
      return row;
    },
    upsert: async ({ where, create, update }: any) => {
      const key = where.integrationId ?? where.id;
      const field = where.integrationId ? "integrationId" : "id";
      const existing = rows.find((r) => r[field] === key);
      if (existing) { Object.assign(existing, update); return existing; }
      const row = { id: `id-${++seq}`, ...create }; rows.push(row); return row;
    },
    deleteMany: async ({ where }: any) => {
      let count = 0;
      for (let i = rows.length - 1; i >= 0; i--) if (matches(rows[i], where)) { rows.splice(i, 1); count++; }
      return { count };
    },
  };
}

function fakePrisma() {
  return {
    product: makeTable(), productVariant: makeTable(), customer: makeTable(),
    order: makeTable(), orderItem: makeTable(), store: makeTable(),
    integration: makeTable(), syncJob: makeTable(),
    integrationCredential: makeTable(), webhookEvent: makeTable(),
  };
}

const auditLogs: any[] = [];
const audit = { log: async (input: any) => { auditLogs.push(input); } } as any;

const originalFetch = globalThis.fetch;
const originalPollMs = process.env.SHOPIFY_BULK_POLL_MS;
const originalMaxPolls = process.env.SHOPIFY_BULK_MAX_POLLS;

beforeEach(() => {
  auditLogs.length = 0;
  process.env.SHOPIFY_BULK_POLL_MS = "0";
});
afterEach(() => {
  globalThis.fetch = originalFetch;
  if (originalPollMs === undefined) delete process.env.SHOPIFY_BULK_POLL_MS; else process.env.SHOPIFY_BULK_POLL_MS = originalPollMs;
  if (originalMaxPolls === undefined) delete process.env.SHOPIFY_BULK_MAX_POLLS; else process.env.SHOPIFY_BULK_MAX_POLLS = originalMaxPolls;
});

function jsonResponse(status: number, body: any) {
  const text = typeof body === "string" ? body : JSON.stringify(body);
  return {
    ok: status >= 200 && status < 300, status, headers: new Headers(),
    json: async () => JSON.parse(text), text: async () => text,
  };
}

const JSONL_URL = "https://storage.example.com/bulk-result.jsonl?token=sig";

const BULK_JSONL = [
  JSON.stringify({ id: "gid://shopify/Product/111", title: "Bulk Shirt", bodyHtml: "<p>Nice</p>", status: "ACTIVE", productType: "Clothing", updatedAt: "2026-10-01T00:00:00Z", featuredImage: { url: "https://cdn.example/shirt.jpg" } }),
  JSON.stringify({ id: "gid://shopify/ProductVariant/1001", __parentId: "gid://shopify/Product/111", title: "M", sku: "BS-M", price: "500.00", compareAtPrice: "650.00", inventoryQuantity: 4 }),
  JSON.stringify({ id: "gid://shopify/ProductVariant/1002", __parentId: "gid://shopify/Product/111", title: "L", sku: "BS-L", price: "520.00", compareAtPrice: null, inventoryQuantity: 6 }),
  JSON.stringify({ id: "gid://shopify/Product/222", title: "Bulk Cap", status: "DRAFT", updatedAt: "2026-10-02T00:00:00Z" }),
  JSON.stringify({ id: "gid://shopify/ProductVariant/1003", __parentId: "gid://shopify/Product/222", title: "Default", sku: "BC-1", price: "250.00", inventoryQuantity: 9 }),
].join("\n");

const REST_PRODUCTS = [
  {
    id: 9001, title: "REST Fallback Shirt", status: "active", product_type: "Clothing",
    body_html: "<p>fb</p>", images: [{ src: "https://cdn.example/fb.jpg" }], updated_at: "2026-10-03T00:00:00Z",
    variants: [{ id: 1, title: "M", sku: "FB-M", price: "700.00", compare_at_price: null, inventory_quantity: 3 }],
  },
];

describe("parseBulkProductsJsonl (pure)", () => {
  it("groups variant lines under their product and reshapes to REST-like raws", () => {
    const raws = parseBulkProductsJsonl(BULK_JSONL);
    expect(raws).toHaveLength(2);
    expect(raws[0]).toMatchObject({
      id: 111, title: "Bulk Shirt", body_html: "<p>Nice</p>", status: "active",
      product_type: "Clothing", updated_at: "2026-10-01T00:00:00Z",
      images: [{ src: "https://cdn.example/shirt.jpg" }],
    });
    expect(raws[0].variants).toHaveLength(2);
    expect(raws[0].variants[0]).toEqual({
      id: 1001, title: "M", sku: "BS-M", price: "500.00", compare_at_price: "650.00", inventory_quantity: 4,
    });
    expect(raws[0].variants[1].compare_at_price).toBeNull();
    expect(raws[1]).toMatchObject({ id: 222, title: "Bulk Cap", status: "draft", images: [] });
    expect(raws[1].variants[0]).toMatchObject({ id: 1003, sku: "BC-1", price: "250.00", inventory_quantity: 9 });
  });

  it("empty / blank text yields []", () => {
    expect(parseBulkProductsJsonl("")).toEqual([]);
    expect(parseBulkProductsJsonl("\n  \n")).toEqual([]);
  });

  it("gidNumeric takes the last path segment", () => {
    expect(gidNumeric("gid://shopify/Product/12345")).toBe("12345");
    expect(gidNumeric("gid://shopify/ProductVariant/999")).toBe("999");
    expect(gidNumeric("")).toBe("");
  });

  it("bulk query is in bulk form (products connection, variant edges, no pagination args)", () => {
    expect(BULK_PRODUCTS_QUERY).toContain("products");
    expect(BULK_PRODUCTS_QUERY).toContain("variants");
    expect(BULK_PRODUCTS_QUERY).not.toMatch(/first\s*:/);
  });
});

describe("ShopifyService.syncProducts bulk", () => {
  function setup() {
    const prisma = fakePrisma();
    const credential = { encryptedData: encryptJson({ accessToken: "shpat_test", apiSecret: "shpss_test" }) };
    prisma.integration.rows.push({
      id: "int-1", organizationId: "org-1", provider: "shopify", storeId: "store-1",
      status: "CONNECTED", productsCursor: null,
      store: { id: "store-1", organizationId: "org-1", url: "https://test.myshopify.com", currency: "BDT" },
      credential,
    });
    const integrations = new IntegrationsService(prisma as any, audit);
    const shopify = new ShopifyService(prisma as any, audit, integrations);
    return { prisma, shopify };
  }

  function installFetch(currentOp: () => any, counters?: { polls?: number }) {
    globalThis.fetch = (async (url: any, init: any = {}) => {
      const u = String(url);
      if (u.includes("/graphql.json")) {
        const body = JSON.parse(init.body ?? "{}");
        const q = String(body.query ?? "");
        if (q.includes("bulkOperationRunQuery")) {
          return jsonResponse(200, { data: { bulkOperationRunQuery: { bulkOperation: { id: "gid://shopify/BulkOperation/1", status: "CREATED" }, userErrors: [] } } });
        }
        if (q.includes("currentBulkOperation")) {
          if (counters) counters.polls = (counters.polls ?? 0) + 1;
          return jsonResponse(200, { data: { currentBulkOperation: currentOp() } });
        }
        throw new Error(`unexpected GraphQL query: ${q.slice(0, 60)}`);
      }
      if (u === JSONL_URL) {
        return { ok: true, status: 200, headers: new Headers(), json: async () => ({}), text: async () => BULK_JSONL };
      }
      if (u.includes("/products.json")) {
        return jsonResponse(200, { products: REST_PRODUCTS });
      }
      throw new Error(`unexpected fetch ${u}`);
    }) as any;
  }

  it("(a) happy bulk: products + variants ingested via the shared path, job COMPLETED", async () => {
    const { prisma, shopify } = setup();
    installFetch(() => ({ id: "gid://shopify/BulkOperation/1", status: "COMPLETED", objectCount: "5", url: JSONL_URL }));
    const out: any = await shopify.syncProducts("org-1", "user-1", "int-1", { bulk: true });
    expect(out.status).toBe("COMPLETED");
    expect(out.fetched).toBe(2);
    expect(out.created).toBe(2);
    expect(out.bulkUsed).toBe("bulk");
    expect(prisma.product.rows).toHaveLength(2);
    const shirt = prisma.product.rows.find((p: any) => p.name === "Bulk Shirt");
    expect(shirt.priceMinor).toBe(50000n);
    expect(shirt.imageUrl).toBe("https://cdn.example/shirt.jpg");
    expect(shirt.status).toBe("ACTIVE");
    const cap = prisma.product.rows.find((p: any) => p.name === "Bulk Cap");
    expect(cap.status).toBe("DRAFT");
    expect(prisma.productVariant.rows).toHaveLength(3);
    expect(prisma.productVariant.rows.map((v: any) => v.sku).sort()).toEqual(["BC-1", "BS-L", "BS-M"]);
    const job = prisma.syncJob.rows[0];
    expect(job.status).toBe("COMPLETED");
    expect(prisma.integration.rows[0].productsCursor).toEqual(new Date("2026-10-02T00:00:00Z"));
    const log = auditLogs.find((l) => l.action === "sync.products");
    expect(log.metadata.syncMode).toBe("bulk");
  });

  it("(b) bulk FAILED: REST fallback ingests, result flagged bulkFallback with the bulk error, job COMPLETED", async () => {
    const { prisma, shopify } = setup();
    installFetch(() => ({ id: "gid://shopify/BulkOperation/1", status: "FAILED", errorCode: "ACCESS_DENIED", objectCount: "0", url: null }));
    const out: any = await shopify.syncProducts("org-1", "user-1", "int-1", { bulk: true });
    expect(out.status).toBe("COMPLETED");
    expect(out.bulkFallback).toBe(true);
    expect(out.bulkError).toContain("FAILED");
    expect(out.fetched).toBe(1);
    expect(prisma.product.rows).toHaveLength(1);
    expect(prisma.product.rows[0].name).toBe("REST Fallback Shirt");
    expect(prisma.product.rows[0].priceMinor).toBe(70000n);
    expect(prisma.syncJob.rows[0].status).toBe("COMPLETED");
    const log = auditLogs.find((l) => l.action === "sync.products");
    expect(log.metadata.bulkFallback).toBe(true);
    expect(log.metadata.bulkError).toContain("FAILED");
  });

  it("(c) bulk never completes (RUNNING): poll budget exhausts -> timeout fallback to REST", async () => {
    process.env.SHOPIFY_BULK_MAX_POLLS = "3";
    const { prisma, shopify } = setup();
    const counters = { polls: 0 };
    installFetch(() => ({ id: "gid://shopify/BulkOperation/1", status: "RUNNING", objectCount: "0", url: null }), counters);
    const out: any = await shopify.syncProducts("org-1", "user-1", "int-1", { bulk: true });
    expect(counters.polls).toBe(3);
    expect(out.bulkFallback).toBe(true);
    expect(out.bulkError).toContain("timed out");
    expect(out.status).toBe("COMPLETED");
    expect(prisma.product.rows).toHaveLength(1);
    expect(prisma.product.rows[0].name).toBe("REST Fallback Shirt");
  });

  it("non-bulk path unchanged: no GraphQL calls, plain job row returned", async () => {
    const { prisma, shopify } = setup();
    let graphqlCalls = 0;
    globalThis.fetch = (async (url: any) => {
      const u = String(url);
      if (u.includes("/graphql.json")) { graphqlCalls++; throw new Error("should not be called"); }
      if (u.includes("/products.json")) return jsonResponse(200, { products: REST_PRODUCTS });
      throw new Error(`unexpected fetch ${u}`);
    }) as any;
    const out: any = await shopify.syncProducts("org-1", "user-1", "int-1");
    expect(graphqlCalls).toBe(0);
    expect(out.status).toBe("COMPLETED");
    expect(out.bulkFallback).toBeUndefined();
    expect(out.bulkUsed).toBeUndefined();
    expect(prisma.product.rows).toHaveLength(1);
  });
});
