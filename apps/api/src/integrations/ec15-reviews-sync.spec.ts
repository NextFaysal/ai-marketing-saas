import { IntegrationsService } from "./integrations.service";
import { WooClient } from "./woocommerce/woo.client";
import { encryptJson } from "./crypto";

/**
 * EC15 — Woo review pull (stub fetch) + Shopify metafield probe
 * (stub GraphQL). Avatars are never review photos; unresolved
 * products are skipped, never created; a Shopify store with no
 * reviews source returns the honest unsupported result.
 */
function matches(row: any, where: any): boolean {
  return Object.entries(where ?? {}).every(([k, v]) => v === undefined || row[k] === v);
}
function table(rows: any[] = []) {
  let seq = 0;
  return {
    rows,
    findFirst: async ({ where }: any) => rows.find((r) => matches(r, where)) ?? null,
    findMany: async ({ where }: any = {}) => rows.filter((r) => matches(r, where ?? {})),
    create: async ({ data }: any) => { const row = { id: `row-${++seq}-${Math.random().toString(36).slice(2, 7)}`, ...data }; rows.push(row); return row; },
    update: async ({ where, data }: any) => { const r = rows.find((x) => x.id === where.id)!; Object.assign(r, data); return r; },
  };
}

const WOO_REVIEWS = [
  { id: 101, product_id: 42, rating: 5, review: "<p>খুব <b>ভালো</b></p>", reviewer: "Nadia", status: "approved", date_created_gmt: "2026-10-01T10:00:00", reviewer_avatar_urls: { "96": "https://avatar.example/nadia.png" } },
  { id: 102, product_id: 99, rating: 3, review: "অচেনা পণ্য", reviewer: "Ghost", status: "approved", date_created_gmt: "2026-10-02T10:00:00" },
  { id: 103, product_id: 42, rating: 4, review: "মোটামুটি", reviewer: "Karim", status: "hold", date_created_gmt: "2026-10-03T10:00:00" },
];

function wooFetch() {
  return async (url: string) => ({
    ok: true, status: 200,
    headers: new Headers({ "x-wp-totalpages": "1", "x-wp-total": String(WOO_REVIEWS.length) }),
    json: async () => WOO_REVIEWS,
    text: async () => JSON.stringify(WOO_REVIEWS),
  }) as any;
}

function makeSvc(provider: "woocommerce" | "shopify") {
  const integration: any = {
    id: provider === "woocommerce" ? "int-woo" : "int-shop",
    organizationId: "org-1",
    provider,
    storeId: provider === "woocommerce" ? "store-woo" : "store-shop",
    store: { id: provider === "woocommerce" ? "store-woo" : "store-shop", url: "https://shop.example.com" },
    credential: { encryptedData: encryptJson(provider === "woocommerce" ? { consumerKey: "ck", consumerSecret: "cs" } : { accessToken: "tok", apiSecret: "sec" }) },
  };
  const prisma: any = {
    integration: table([integration]),
    syncJob: table(),
    storeListing: table([
      { id: "lst-1", storeId: "store-woo", externalId: "42", productId: "prod-1" },
      { id: "lst-2", storeId: "store-shop", externalId: "42", productId: "prod-1" },
    ]),
    externalReview: table(),
  };
  // getIntegration uses findFirst with include — our fake returns the row as stored (store/credential nested).
  const svc = new IntegrationsService(prisma as any, { log: async () => undefined } as any);
  return { svc, prisma };
}

describe("EC15 WooClient.listProductReviews", () => {
  it("hits /products/reviews and passes the product filter only when given", async () => {
    const calls: string[] = [];
    const fn = async (url: string) => { calls.push(url); return { ok: true, status: 200, headers: new Headers({ "x-wp-totalpages": "2", "x-wp-total": "3" }), json: async () => [], text: async () => "[]" } as any; };
    const client = new WooClient("https://shop.example.com", { consumerKey: "ck", consumerSecret: "cs" }, fn as any);
    const page = await client.listProductReviews(1, 100, 42);
    expect(calls[0]).toContain("/wp-json/wc/v3/products/reviews");
    expect(calls[0]).toContain("product=42");
    expect(page.totalPages).toBe(2);
    await client.listProductReviews(1);
    expect(calls[1]).not.toContain("product=");
  });
});

describe("EC15 Woo review sync", () => {
  const originalFetch = global.fetch;
  afterEach(() => { global.fetch = originalFetch; });

  it("resolves via StoreListing, skips unresolved, strips HTML, never uses avatars as photos, upserts idempotently", async () => {
    global.fetch = wooFetch() as any;
    const { svc, prisma } = makeSvc("woocommerce");
    const out: any = await svc.syncReviews("org-1", "user-1", "int-woo");
    expect(out).toMatchObject({ created: 2, updated: 0, skipped: 1, total: 3, platform: "woocommerce" });
    const rows = prisma.externalReview.rows;
    expect(rows).toHaveLength(2);
    const nadia = rows.find((r: any) => r.externalId === "101");
    expect(nadia.productId).toBe("prod-1");
    expect(nadia.text).toBe("খুব ভালো");
    expect(nadia.imageUrls).toEqual([]);
    expect(JSON.stringify(nadia)).not.toContain("avatar.example");
    expect(nadia.status).toBe("visible");
    expect(rows.find((r: any) => r.externalId === "103").status).toBe("hidden"); // hold != approved
    expect(prisma.syncJob.rows[prisma.syncJob.rows.length - 1]).toMatchObject({ kind: "reviews", status: "COMPLETED", created: 2, skipped: 1 });

    const again: any = await svc.syncReviews("org-1", "user-1", "int-woo");
    expect(again).toMatchObject({ created: 0, updated: 2, skipped: 1 });
    expect(prisma.externalReview.rows).toHaveLength(2);
  });
});

describe("EC15 Shopify reviews probe", () => {
  it("no metafields -> NORMAL unsupported result (not an exception), recorded on the SyncJob", async () => {
    const { svc, prisma } = makeSvc("shopify");
    (svc as any).buildShopifyGraphqlClientForReviews = async () => ({
      request: async () => ({ products: { edges: [{ node: { id: "gid://shopify/Product/42", legacyResourceId: 42, metafields: { edges: [] } } }] } }),
    });
    const out: any = await svc.syncReviews("org-1", "user-1", "int-shop");
    expect(out.platform).toBe("shopify");
    expect(out.reviews).toBe("unsupported_no_reviews_source");
    expect(prisma.externalReview.rows).toHaveLength(0);
    const job = prisma.syncJob.rows[prisma.syncJob.rows.length - 1];
    expect(job.status).toBe("COMPLETED");
    expect(job.error).toContain("unsupported_no_reviews_source");
  });

  it("unusable client -> same unsupported result", async () => {
    const { svc } = makeSvc("shopify");
    (svc as any).buildShopifyGraphqlClientForReviews = async () => null;
    const out: any = await svc.syncReviews("org-1", "user-1", "int-shop");
    expect(out.reviews).toBe("unsupported_no_reviews_source");
  });

  it("parseable metafield JSON array -> upserted as shopify ExternalReviews", async () => {
    const { svc, prisma } = makeSvc("shopify");
    const value = JSON.stringify([{ id: "s1", authorName: "Sadia", rating: 5, text: "অসাধারণ", createdAt: "2026-10-01T00:00:00.000Z" }]);
    (svc as any).buildShopifyGraphqlClientForReviews = async () => ({
      request: async () => ({ products: { edges: [{ node: { id: "gid://shopify/Product/42", legacyResourceId: 42, metafields: { edges: [{ node: { namespace: "reviews", key: "reviews", value } }] } } }] } }),
    });
    const out: any = await svc.syncReviews("org-1", "user-1", "int-shop");
    expect(out).toMatchObject({ created: 1, platform: "shopify" });
    const row = prisma.externalReview.rows[0];
    expect(row).toMatchObject({ externalId: "s1", authorName: "Sadia", rating: 5, productId: "prod-1", storeId: "store-shop" });
  });
});
