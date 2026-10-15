import { IntegrationsService } from "./integrations.service";
import { WooAuthService } from "./woo-auth.service";
import { decryptJson } from "./crypto";

// Generic in-memory fake (same makeTable pattern as ec2-connection.spec.ts).
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
    wcAuthAttempt: makeTable(),
  };
}

const auditLogs: any[] = [];
const audit = { log: async (input: any) => { auditLogs.push(input); } } as any;

const originalFetch = globalThis.fetch;
const originalPublicUrl = process.env.API_PUBLIC_URL;
const originalWebPublicUrl = process.env.WEB_PUBLIC_URL;
const originalAppPublicUrl = process.env.APP_PUBLIC_URL;

beforeEach(() => { auditLogs.length = 0; });
afterEach(() => {
  globalThis.fetch = originalFetch;
  if (originalPublicUrl === undefined) delete process.env.API_PUBLIC_URL; else process.env.API_PUBLIC_URL = originalPublicUrl;
  if (originalWebPublicUrl === undefined) delete process.env.WEB_PUBLIC_URL; else process.env.WEB_PUBLIC_URL = originalWebPublicUrl;
  if (originalAppPublicUrl === undefined) delete process.env.APP_PUBLIC_URL; else process.env.APP_PUBLIC_URL = originalAppPublicUrl;
});

function jsonResponse(status: number, body: any) {
  const text = typeof body === "string" ? body : JSON.stringify(body);
  return {
    ok: status >= 200 && status < 300, status, headers: new Headers(),
    json: async () => JSON.parse(text), text: async () => text,
  };
}

function stubFetchOk() {
  globalThis.fetch = (async (url: any) => {
    expect(String(url)).toContain("/wp-json/wc/v3/system_status");
    return jsonResponse(200, { environment: { site_title: "Shop", version: "6.5" } });
  }) as any;
}

function seedStore(prisma: any, url = "https://shop.example.com") {
  prisma.store.rows.push({ id: "store-1", organizationId: "org-1", url, currency: "BDT", platform: "WOOCOMMERCE" });
}

function seedAttempt(prisma: any, overrides: any = {}) {
  const row = {
    id: "attempt-1", organizationId: "org-1", userId: "user-1", storeId: "store-1",
    storeUrl: "https://shop.example.com", state: "state-token-1", status: "pending",
    failureReason: null, expiresAt: new Date(Date.now() + 30 * 60 * 1000), consumedAt: null,
    ...overrides,
  };
  prisma.wcAuthAttempt.rows.push(row);
  return row;
}

function build(prisma: any) {
  const integrations = new IntegrationsService(prisma as any, audit);
  const wooAuth = new WooAuthService(prisma as any, audit, integrations);
  return { integrations, wooAuth };
}

const callbackPayload = {
  key_id: 123, user_id: "attempt-1",
  consumer_key: "ck_from_woo", consumer_secret: "cs_from_woo", key_permissions: "read_write",
};

describe("EC12 Woo wc-auth authorize-url", () => {
  it("refuses when API_PUBLIC_URL is unset and creates NO attempt", async () => {
    delete process.env.API_PUBLIC_URL;
    const prisma = fakePrisma();
    seedStore(prisma);
    const { wooAuth } = build(prisma);
    await expect(wooAuth.startAuthorizeUrl("org-1", "user-1", { storeId: "store-1" }))
      .rejects.toThrow(/API_PUBLIC_URL/);
    expect(prisma.wcAuthAttempt.rows).toHaveLength(0);
  });

  it("happy path: authorize URL carries scope/user_id/callback, attempt pending with ~30min expiry", async () => {
    process.env.API_PUBLIC_URL = "https://api.example.com";
    const prisma = fakePrisma();
    seedStore(prisma);
    const { wooAuth } = build(prisma);
    const out: any = await wooAuth.startAuthorizeUrl("org-1", "user-1", { storeId: "store-1" });
    expect(out.authorizeUrl).toContain("/wc-auth/v1/authorize");
    const url = new URL(out.authorizeUrl);
    expect(url.searchParams.get("scope")).toBe("read_write");
    expect(url.searchParams.get("user_id")).toBe(out.attemptId);
    expect(url.searchParams.get("callback_url")).toBe("https://api.example.com/integrations/woo/wc-auth/callback");
    expect(url.searchParams.get("callback_url")!.endsWith("/integrations/woo/wc-auth/callback")).toBe(true);
    expect(prisma.wcAuthAttempt.rows).toHaveLength(1);
    const attempt = prisma.wcAuthAttempt.rows[0];
    expect(attempt.id).toBe(out.attemptId);
    expect(attempt.status).toBe("pending");
    expect(attempt.storeUrl).toBe("https://shop.example.com");
    expect(typeof attempt.state).toBe("string");
    expect(attempt.state.length).toBeGreaterThanOrEqual(32);
    const ttlMs = new Date(attempt.expiresAt).getTime() - Date.now();
    expect(ttlMs).toBeGreaterThan(29 * 60 * 1000);
    expect(ttlMs).toBeLessThanOrEqual(30 * 60 * 1000 + 5000);
    expect(auditLogs.some((l) => l.action === "integration.wc_auth_started")).toBe(true);
  });
});

describe("EC12 Woo wc-auth callback", () => {
  it("happy path: integration CONNECTED, credentials encrypted from Woo payload, attempt consumed", async () => {
    delete process.env.API_PUBLIC_URL; // connect-time webhook registration = skipped_no_public_url
    stubFetchOk();
    const prisma = fakePrisma();
    seedStore(prisma);
    seedAttempt(prisma);
    const { wooAuth } = build(prisma);
    const out: any = await wooAuth.handleCallback({ ...callbackPayload });
    expect(out.connected).toBe(true);
    expect(out.webhookRegistration).toBe("skipped_no_public_url");
    expect(prisma.integration.rows).toHaveLength(1);
    expect(prisma.integration.rows[0].id).toBe(out.integrationId);
    expect(prisma.integration.rows[0].status).toBe("CONNECTED");
    expect(prisma.integrationCredential.rows).toHaveLength(1);
    const secrets = decryptJson<any>(prisma.integrationCredential.rows[0].encryptedData);
    expect(secrets.consumerKey).toBe("ck_from_woo");
    expect(secrets.consumerSecret).toBe("cs_from_woo");
    const attempt = prisma.wcAuthAttempt.rows[0];
    expect(attempt.status).toBe("consumed");
    expect(attempt.consumedAt).toBeInstanceOf(Date);
  });

  it("expired attempt: refused, marked failed, NO integration row", async () => {
    delete process.env.API_PUBLIC_URL;
    stubFetchOk();
    const prisma = fakePrisma();
    seedStore(prisma);
    seedAttempt(prisma, { expiresAt: new Date(Date.now() - 60 * 1000) });
    const { wooAuth } = build(prisma);
    await expect(wooAuth.handleCallback({ ...callbackPayload })).rejects.toThrow(/expired/);
    expect(prisma.wcAuthAttempt.rows[0].status).toBe("failed");
    expect(prisma.wcAuthAttempt.rows[0].failureReason).toBe("expired");
    expect(prisma.integration.rows).toHaveLength(0);
    expect(prisma.integrationCredential.rows).toHaveLength(0);
  });

  it("unknown user_id: refused, nothing saved", async () => {
    delete process.env.API_PUBLIC_URL;
    stubFetchOk();
    const prisma = fakePrisma();
    seedStore(prisma);
    seedAttempt(prisma);
    const { wooAuth } = build(prisma);
    await expect(wooAuth.handleCallback({ ...callbackPayload, user_id: "no-such-attempt" }))
      .rejects.toThrow(/Unknown wc-auth attempt/);
    expect(prisma.wcAuthAttempt.rows[0].status).toBe("pending");
    expect(prisma.integration.rows).toHaveLength(0);
    expect(prisma.integrationCredential.rows).toHaveLength(0);
  });

  it("replay: second identical callback refused, still exactly one integration", async () => {
    delete process.env.API_PUBLIC_URL;
    stubFetchOk();
    const prisma = fakePrisma();
    seedStore(prisma);
    seedAttempt(prisma);
    const { wooAuth } = build(prisma);
    const out: any = await wooAuth.handleCallback({ ...callbackPayload });
    expect(out.connected).toBe(true);
    await expect(wooAuth.handleCallback({ ...callbackPayload })).rejects.toThrow(/already been used/);
    expect(prisma.integration.rows).toHaveLength(1);
    expect(prisma.integrationCredential.rows).toHaveLength(1);
  });

  it("verify failure (Woo testConnection 401): callback throws, attempt failed, NO integration/credential saved", async () => {
    delete process.env.API_PUBLIC_URL;
    globalThis.fetch = (async () => jsonResponse(401, { code: "woocommerce_rest_cannot_view", message: "Sorry, you cannot view this resource." })) as any;
    const prisma = fakePrisma();
    seedStore(prisma);
    seedAttempt(prisma);
    const { wooAuth } = build(prisma);
    await expect(wooAuth.handleCallback({ ...callbackPayload })).rejects.toThrow(/WooCommerce connection failed/);
    expect(prisma.wcAuthAttempt.rows[0].status).toBe("failed");
    expect(prisma.wcAuthAttempt.rows[0].failureReason).toMatch(/WooCommerce connection failed/);
    expect(prisma.integration.rows).toHaveLength(0);
    expect(prisma.integrationCredential.rows).toHaveLength(0);
  });

  it("storeUrl mismatch: store URL changed after attempt creation — refused + marked failed", async () => {
    delete process.env.API_PUBLIC_URL;
    stubFetchOk();
    const prisma = fakePrisma();
    seedStore(prisma);
    seedAttempt(prisma);
    prisma.store.rows[0].url = "https://other-shop.example.com";
    const { wooAuth } = build(prisma);
    await expect(wooAuth.handleCallback({ ...callbackPayload })).rejects.toThrow(/no longer matches/);
    expect(prisma.wcAuthAttempt.rows[0].status).toBe("failed");
    expect(prisma.wcAuthAttempt.rows[0].failureReason).toBe("store_mismatch");
    expect(prisma.integration.rows).toHaveLength(0);
    expect(prisma.integrationCredential.rows).toHaveLength(0);
  });
});
