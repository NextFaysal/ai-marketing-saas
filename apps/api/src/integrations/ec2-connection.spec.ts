import { createHmac } from "crypto";
import { IntegrationsService } from "./integrations.service";
import { ShopifyService } from "./shopify/shopify.service";
import { encryptJson, decryptJson } from "./crypto";
import { ErasureService } from "../customers/erasure.service";

// Generic in-memory fake (same makeTable pattern as integrations.service.spec.ts).
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
    deleteMany: async ({ where }: any) => { for (let i = rows.length - 1; i >= 0; i--) if (matches(rows[i], where)) rows.splice(i, 1); },
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
const originalPublicUrl = process.env.API_PUBLIC_URL;
const originalAppSecret = process.env.SHOPIFY_APP_SECRET;

beforeEach(() => { auditLogs.length = 0; });
afterEach(() => {
  globalThis.fetch = originalFetch;
  if (originalPublicUrl === undefined) delete process.env.API_PUBLIC_URL; else process.env.API_PUBLIC_URL = originalPublicUrl;
  if (originalAppSecret === undefined) delete process.env.SHOPIFY_APP_SECRET; else process.env.SHOPIFY_APP_SECRET = originalAppSecret;
});

function jsonResponse(status: number, body: any) {
  const text = typeof body === "string" ? body : JSON.stringify(body);
  return {
    ok: status >= 200 && status < 300, status, headers: new Headers(),
    json: async () => JSON.parse(text), text: async () => text,
  };
}

describe("EC2 Woo connect", () => {
  it("(i) with API_PUBLIC_URL unset: registration skipped + recorded, generated webhookSecret saved", async () => {
    delete process.env.API_PUBLIC_URL;
    globalThis.fetch = (async (url: any) => {
      expect(String(url)).toContain("/wp-json/wc/v3/system_status");
      return jsonResponse(200, { environment: { site_title: "Shop", version: "6.5" } });
    }) as any;
    const prisma = fakePrisma();
    prisma.store.rows.push({ id: "store-1", organizationId: "org-1", url: "https://shop.example.com", currency: "BDT" });
    const svc = new IntegrationsService(prisma as any, audit);
    const out: any = await svc.connectWooCommerce("org-1", "user-1", { storeId: "store-1", consumerKey: "ck_test_long", consumerSecret: "cs_test_long" } as any);
    expect(out.webhookRegistration).toBe("skipped_no_public_url");
    expect(prisma.integration.rows).toHaveLength(1);
    expect(prisma.integration.rows[0].webhookStatus?.status).toBe("skipped_no_public_url");
    expect(prisma.integrationCredential.rows).toHaveLength(1);
    const secrets = decryptJson<any>(prisma.integrationCredential.rows[0].encryptedData);
    expect(secrets.consumerKey).toBe("ck_test_long");
    expect(typeof secrets.webhookSecret).toBe("string");
    expect(secrets.webhookSecret.length).toBe(48); // randomBytes(24) hex
  });
});

describe("EC2 Shopify client-credentials", () => {
  function stubFetch(opts: { probeFails?: boolean } = {}) {
    return (async (url: any) => {
      const u = String(url);
      if (u.includes("/admin/oauth/access_token")) {
        return jsonResponse(200, { access_token: "shpat_cc_token", expires_in: 86400, scope: "read_products" });
      }
      if (u.includes("/graphql.json")) {
        if (opts.probeFails) return jsonResponse(401, { errors: "Invalid API key or access token" });
        return jsonResponse(200, { data: { shop: { id: "gid://shopify/Shop/12345", name: "Test Shop", currencyCode: "BDT", primaryDomain: { url: "https://test.myshopify.com" } } } });
      }
      throw new Error(`unexpected fetch ${u}`);
    }) as any;
  }

  it("(ii) saves integration with authType + tokenExpiresAt, externalAccountId from probe", async () => {
    delete process.env.API_PUBLIC_URL;
    globalThis.fetch = stubFetch();
    const prisma = fakePrisma();
    prisma.store.rows.push({ id: "store-1", organizationId: "org-1", url: "https://test.myshopify.com", currency: "BDT" });
    const integrations = new IntegrationsService(prisma as any, audit);
    const shopify = new ShopifyService(prisma as any, audit, integrations);
    const out: any = await shopify.connectClientCredentials("org-1", "user-1", { storeId: "store-1", clientId: "cid-1", clientSecret: "csecret-1" });
    expect(out.authType).toBe("client_credentials");
    expect(out.webhookRegistration).toBe("skipped_no_public_url");
    expect(out.externalAccountId).toBe("12345");
    expect(prisma.integration.rows).toHaveLength(1);
    const row = prisma.integration.rows[0];
    expect(row.authType).toBe("client_credentials");
    expect(row.tokenExpiresAt).toBeInstanceOf(Date);
    expect(row.tokenExpiresAt.getTime()).toBeGreaterThan(Date.now() + 86000 * 1000);
    const secrets = decryptJson<any>(prisma.integrationCredential.rows[0].encryptedData);
    expect(secrets.accessToken).toBe("shpat_cc_token");
    expect(secrets.apiSecret).toBe("csecret-1");
    expect(secrets.clientId).toBe("cid-1");
    expect(auditLogs.some((l) => l.action === "integration.connect" && l.metadata?.authType === "client_credentials")).toBe(true);
  });

  it("(ii) failed probe: nothing saved, verbatim error surfaced", async () => {
    delete process.env.API_PUBLIC_URL;
    globalThis.fetch = stubFetch({ probeFails: true });
    const prisma = fakePrisma();
    prisma.store.rows.push({ id: "store-1", organizationId: "org-1", url: "https://test.myshopify.com", currency: "BDT" });
    const integrations = new IntegrationsService(prisma as any, audit);
    const shopify = new ShopifyService(prisma as any, audit, integrations);
    await expect(shopify.connectClientCredentials("org-1", "user-1", { storeId: "store-1", clientId: "cid-1", clientSecret: "csecret-1" }))
      .rejects.toThrow(/401/);
    expect(prisma.integration.rows).toHaveLength(0);
    expect(prisma.integrationCredential.rows).toHaveLength(0);
  });

  it("(iii) expired token: refresh re-exchanges and updates the stored credential", async () => {
    globalThis.fetch = (async (url: any) => {
      expect(String(url)).toContain("/admin/oauth/access_token");
      return jsonResponse(200, { access_token: "shpat_refreshed", expires_in: 86400, scope: "read_products" });
    }) as any;
    const prisma = fakePrisma();
    const encrypted = encryptJson({ accessToken: "shpat_old", apiSecret: "csecret-1", clientId: "cid-1", clientSecret: "csecret-1", authType: "client_credentials" });
    prisma.integration.rows.push({ id: "int-1", organizationId: "org-1", provider: "shopify", storeId: "store-1" });
    prisma.integrationCredential.rows.push({ id: "cred-1", integrationId: "int-1", encryptedData: encrypted });
    const integrations = new IntegrationsService(prisma as any, audit);
    const shopify = new ShopifyService(prisma as any, audit, integrations);
    const integration: any = {
      id: "int-1", organizationId: "org-1", provider: "shopify",
      store: { id: "store-1", url: "https://test.myshopify.com" },
      credential: { encryptedData: encrypted },
      tokenExpiresAt: new Date(Date.now() - 60 * 1000),
      authType: "client_credentials",
    };
    const secrets = await shopify.refreshTokenIfNeeded(integration);
    expect(secrets.accessToken).toBe("shpat_refreshed");
    expect(secrets.apiSecret).toBe("csecret-1");
    const stored = decryptJson<any>(prisma.integrationCredential.rows[0].encryptedData);
    expect(stored.accessToken).toBe("shpat_refreshed");
    expect(prisma.integration.rows[0].tokenExpiresAt.getTime()).toBeGreaterThan(Date.now() + 86000 * 1000);
  });

  it("(iii) fresh token: refresh is a no-op (no exchange call)", async () => {
    let calls = 0;
    globalThis.fetch = (async () => { calls++; return jsonResponse(200, {}); }) as any;
    const prisma = fakePrisma();
    const integrations = new IntegrationsService(prisma as any, audit);
    const shopify = new ShopifyService(prisma as any, audit, integrations);
    const integration: any = {
      id: "int-1", provider: "shopify", store: { url: "https://test.myshopify.com" },
      credential: { encryptedData: encryptJson({ accessToken: "shpat_fresh", apiSecret: "s", clientId: "cid", clientSecret: "cs", authType: "client_credentials" }) },
      tokenExpiresAt: new Date(Date.now() + 3600 * 1000), authType: "client_credentials",
    };
    const secrets = await shopify.refreshTokenIfNeeded(integration);
    expect(secrets.accessToken).toBe("shpat_fresh");
    expect(calls).toBe(0);
  });
});

describe("EC2 Shopify GDPR", () => {
  function setup() {
    const prisma = fakePrisma();
    const apiSecret = "shpss_test_secret";
    const credential = { encryptedData: encryptJson({ accessToken: "shpat_x", apiSecret }) };
    prisma.integration.rows.push({
      id: "int-shop", organizationId: "org-1", provider: "shopify", storeId: "store-1",
      status: "CONNECTED", store: { id: "store-1", url: "https://test.myshopify.com" }, credential,
    });
    const integrations = new IntegrationsService(prisma as any, audit);
    const shopify = new ShopifyService(prisma as any, audit, integrations);
    return { prisma, shopify, apiSecret };
  }

  it("(iv) shop/redact with valid HMAC: event recorded + integration DISCONNECTED; duplicate delivery deduped", async () => {
    delete process.env.SHOPIFY_APP_SECRET;
    const { prisma, shopify, apiSecret } = setup();
    const payload = { shop_id: 12345, shop_domain: "test.myshopify.com" };
    const rawBody = JSON.stringify(payload);
    const hmac = createHmac("sha256", apiSecret).update(rawBody, "utf8").digest("base64");
    const out: any = await shopify.handleGdpr("shop/redact", rawBody, hmac, "wh-1");
    expect(out).toEqual({ received: true, recorded: true, topic: "shop/redact" });
    expect(prisma.webhookEvent.rows).toHaveLength(1);
    expect(prisma.webhookEvent.rows[0].topic).toBe("shop/redact");
    expect(prisma.integration.rows[0].status).toBe("DISCONNECTED");
    expect(auditLogs.some((l) => l.action === "shopify.gdpr.shop_redact")).toBe(true);

    const dup: any = await shopify.handleGdpr("shop/redact", rawBody, hmac, "wh-1");
    expect(dup).toEqual({ received: true, duplicate: true });
    expect(prisma.webhookEvent.rows).toHaveLength(1);
  });

  it("(iv) bad HMAC throws", async () => {
    delete process.env.SHOPIFY_APP_SECRET;
    const { shopify } = setup();
    const rawBody = JSON.stringify({ shop_id: 1, shop_domain: "test.myshopify.com" });
    await expect(shopify.handleGdpr("customers/redact", rawBody, "AAAAbad", "wh-2"))
      .rejects.toThrow("Invalid Shopify webhook signature");
  });

  it("CP6: customers/redact erases the resolved local customer; ack shape unchanged", async () => {
    delete process.env.SHOPIFY_APP_SECRET;
    const { prisma, apiSecret } = setup();
    (prisma as any).customerStoreIdentity = makeTable();
    (prisma as any).externalReview = makeTable();
    (prisma as any).abandonedStoreCheckout = makeTable();
    prisma.customer.rows.push({
      id: "cust-1", organizationId: "org-1", externalId: "777", firstName: "Ayesha", lastName: "Rahman",
      email: "ayesha@example.com", phone: "01700000000", address: { city: "Dhaka" }, customFields: null, referralCode: null,
    });
    prisma.order.rows.push({ id: "ord-1", organizationId: "org-1", customerId: "cust-1", address: "House 9, Dhaka", totalMinor: 12000n });
    const integrations = new IntegrationsService(prisma as any, audit);
    const erasure = new ErasureService(prisma as any, audit);
    const shopify = new ShopifyService(prisma as any, audit, integrations, undefined, erasure);
    const payload = { shop_id: 12345, shop_domain: "test.myshopify.com", customer: { id: 777, email: "ayesha@example.com" } };
    const rawBody = JSON.stringify(payload);
    const hmac = createHmac("sha256", apiSecret).update(rawBody, "utf8").digest("base64");
    const out: any = await shopify.handleGdpr("customers/redact", rawBody, hmac, "wh-cp6");
    expect(out).toEqual({ received: true, recorded: true, topic: "customers/redact" });
    const c = prisma.customer.rows[0];
    expect(c.firstName).toBe("মুছে ফেলা হয়েছে");
    expect(c.email).toBeNull();
    expect(c.phone).toBeNull();
    expect(prisma.order.rows[0].address).toBeNull();
    expect(prisma.order.rows[0].totalMinor).toBe(12000n);
    expect(auditLogs.some((l) => l.action === "customers.erase" && l.userId === "shopify_gdpr")).toBe(true);
  });
});
