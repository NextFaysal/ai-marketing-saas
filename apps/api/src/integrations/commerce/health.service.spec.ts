import { StoreHealthService } from "./health.service";
import { encryptJson, decryptJson } from "../crypto";

// WooClient is constructed inside the service with the global fetch;
// stub it per-test through globalThis.fetch.
const originalFetch = globalThis.fetch;
const originalPublicUrl = process.env.API_PUBLIC_URL;

afterEach(() => {
  globalThis.fetch = originalFetch;
  if (originalPublicUrl === undefined) delete process.env.API_PUBLIC_URL;
  else process.env.API_PUBLIC_URL = originalPublicUrl;
});

function wooIntegration(overrides: any = {}) {
  return {
    id: "int-woo",
    provider: "woocommerce",
    organizationId: "org-1",
    storeId: "store-1",
    store: { id: "store-1", url: "https://shop.example.com", currency: "BDT" },
    credential: { encryptedData: encryptJson({ consumerKey: "ck_test", consumerSecret: "cs_test", webhookSecret: "whsec" }) },
    lastSyncAt: new Date(),
    ...overrides,
  };
}

function fakeIntegrations(integration: any) {
  return {
    getIntegration: async () => integration,
    getSecrets: (i: any) => decryptJson(i.credential.encryptedData),
  } as any;
}

describe("StoreHealthService", () => {
  it("worst-status rollup: a fail beats warn/unknown/pass", async () => {
    // store url not https -> store_url_https fail; everything else benign.
    delete process.env.API_PUBLIC_URL;
    globalThis.fetch = (async (url: any) => {
      const u = String(url);
      if (u.includes("/system_status")) {
        return { ok: true, status: 200, headers: new Headers(), json: async () => ({ environment: { site_title: "Shop", version: "6.5" }, database: { wc_database_version: "8.0" } }), text: async () => "" };
      }
      throw new Error(`unexpected ${u}`);
    }) as any;
    const integration = wooIntegration({ store: { id: "store-1", url: "http://shop.example.com", currency: "BDT" } });
    const svc = new StoreHealthService(fakeIntegrations(integration), {} as any);
    const out = await svc.getHealth("org-1", "int-woo");
    expect(out.overall).toBe("fail");
    expect(out.checks.find((c) => c.key === "store_url_https")?.status).toBe("fail");
  });

  it("woo write-permission check always stays unknown (honest)", async () => {
    delete process.env.API_PUBLIC_URL;
    globalThis.fetch = (async () => ({
      ok: true, status: 200, headers: new Headers(),
      json: async () => ({ environment: { site_title: "Shop", version: "6.5" }, database: {} }),
      text: async () => "",
    })) as any;
    const svc = new StoreHealthService(fakeIntegrations(wooIntegration()), {} as any);
    const out = await svc.getHealth("org-1", "int-woo");
    const check = out.checks.find((c) => c.key === "key_write_permission");
    expect(check?.status).toBe("unknown");
    expect(check?.evidence).toContain("Read/Write");
    // No sync yet is not in this fixture; freshness passes with a fresh lastSyncAt.
    expect(out.checks.find((c) => c.key === "connection")?.status).toBe("pass");
  });

  it("shopify missing scopes are named verbatim in evidence", async () => {
    delete process.env.API_PUBLIC_URL;
    const integration = {
      id: "int-shop", provider: "shopify", organizationId: "org-1", storeId: "store-1",
      store: { id: "store-1", url: "https://shop.myshopify.com", currency: "BDT" },
      credential: { encryptedData: "x" }, lastSyncAt: new Date(), authType: null, tokenExpiresAt: null,
    };
    const fakeShopify = {
      buildGraphQLClient: async () => ({
        shopProbe: async () => ({ name: "Shop", primaryDomain: { url: "https://shop.myshopify.com" } }),
        accessScopes: async () => ["read_products", "read_orders"],
        webhookTopics: async () => [],
      }),
    } as any;
    const svc = new StoreHealthService(fakeIntegrations(integration), fakeShopify);
    const out = await svc.getHealth("org-1", "int-shop");
    const scopes = out.checks.find((c) => c.key === "scopes");
    expect(scopes?.status).toBe("warn");
    expect(scopes?.evidence).toContain("write_products");
    expect(scopes?.evidence).toContain("write_discounts");
    expect(scopes?.evidence).not.toContain("read_products,");
    const token = out.checks.find((c) => c.key === "token");
    expect(token?.status).toBe("unknown");
    expect(token?.evidence).toContain("Legacy Token");
    expect(out.overall).toBe("warn");
  });

  it("shopify expired client-credentials token fails the token check", async () => {
    delete process.env.API_PUBLIC_URL;
    const integration = {
      id: "int-shop", provider: "shopify", organizationId: "org-1", storeId: "store-1",
      store: { id: "store-1", url: "https://shop.myshopify.com", currency: "BDT" },
      credential: { encryptedData: "x" }, lastSyncAt: new Date(),
      authType: "client_credentials", tokenExpiresAt: new Date(Date.now() - 1000),
    };
    const fakeShopify = {
      buildGraphQLClient: async () => ({
        shopProbe: async () => ({ name: "Shop" }),
        accessScopes: async () => ["read_products", "write_products", "read_inventory", "write_inventory", "read_orders", "write_orders", "read_customers", "write_customers", "read_discounts", "write_discounts"],
        webhookTopics: async () => [],
      }),
    } as any;
    const svc = new StoreHealthService(fakeIntegrations(integration), fakeShopify);
    const out = await svc.getHealth("org-1", "int-shop");
    expect(out.checks.find((c) => c.key === "token")?.status).toBe("fail");
    expect(out.overall).toBe("fail");
  });
});
