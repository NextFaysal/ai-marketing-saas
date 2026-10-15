process.env.ENCRYPTION_KEY = Buffer.alloc(32, 7).toString("base64");
process.env.JWT_SECRET = "test-secret";

import { ConnectionsService } from "./connections.service";
import { ConnectionMonitorService } from "./connection-monitor.service";
import { ProviderHealthService } from "./provider-health.service";
import { encryptJson } from "../integrations/crypto";
import { SHOPIFY_REQUIRED_SCOPES } from "../integrations/commerce/health.service";

/**
 * CC14/CC15/CC16 — provider-reported health honesty:
 *  - a successful fetch stores Meta's values VERBATIM; a field
 *    Meta did not return stays ABSENT (never 0, never estimated);
 *  - a failed fetch records the error and leaves the previous
 *    snapshot + timestamp untouched (no stale masquerade);
 *  - the CC12 sweep refreshes WhatsApp health and a quality
 *    DROP alerts exactly once through the B6 state machine;
 *  - Meta Page completeness unknowns stay unknown;
 *  - webhook repair calls the EXISTING EC2 registrar stub and
 *    returns its real outcome verbatim (partial stays partial);
 *  - the Shopify scope diff lists only genuinely missing scopes.
 */

function matches(row: any, where: any): boolean {
  return Object.entries(where ?? {}).every(([k, v]: [string, any]) => {
    if (v === undefined) return true;
    if (v !== null && typeof v === "object" && !(v instanceof Date)) {
      if ("in" in v) return v.in.includes(row[k]);
      if ("not" in v) return row[k] !== v.not;
      return true;
    }
    if (v instanceof Date) return new Date(row[k]).getTime() === v.getTime();
    if (v === null) return row[k] === null || row[k] === undefined;
    return row[k] === v;
  });
}

function makeTable(name: string) {
  const rows: any[] = [];
  let seq = 0;
  const applyOrderTake = (list: any[], args: any) => {
    let out = [...list];
    const orderBy = args?.orderBy;
    if (orderBy) {
      const [key, dir] = Object.entries(orderBy)[0] as [string, string];
      out.sort((a, b) => {
        const av = new Date(a[key]).getTime(), bv = new Date(b[key]).getTime();
        return dir === "desc" ? bv - av : av - bv;
      });
    }
    if (typeof args?.take === "number") out = out.slice(0, args.take);
    return out;
  };
  return {
    rows,
    findFirst: async (args: any = {}) => applyOrderTake(rows.filter((r) => matches(r, args.where ?? {})), args)[0] ?? null,
    findMany: async (args: any = {}) => applyOrderTake(rows.filter((r) => matches(r, args.where ?? {})), args),
    findUnique: async (args: any) => rows.filter((r) => matches(r, args.where ?? {}))[0] ?? null,
    create: async ({ data }: any) => { const row = { id: `${name}-${++seq}`, createdAt: new Date(), updatedAt: new Date(), ...data }; rows.push(row); return row; },
    update: async ({ where, data }: any) => {
      const row = rows.find((r) => matches(r, where));
      if (row) Object.assign(row, data);
      return row;
    },
    deleteMany: async ({ where }: any) => ({ count: rows.filter((r) => matches(r, where ?? {})).length }),
  };
}

function build(graphImpl: (path: string) => Promise<any>, extra: { shopifyAccessScopes?: (i: any) => Promise<string[]>; integrationsStub?: any } = {}) {
  const tables: any = {
    integration: makeTable("int"), integrationCredential: makeTable("cred"),
    socialAccount: makeTable("soc"), adAccount: makeTable("ad"), store: makeTable("store"),
    messagingSenderConfig: makeTable("sender"), businessProfile: makeTable("profile"),
    tenantAppConfig: makeTable("appcfg"), orgLlmConfig: makeTable("llm"),
    tenantPaymentGateway: makeTable("gw"), platformPaymentEnablement: makeTable("en"),
    connectionHealthCheck: makeTable("check"), connectionAlert: makeTable("alert"),
    connectionAlertState: makeTable("state"), connectionAlertPreference: makeTable("pref"),
    membership: makeTable("member"), user: makeTable("user"),
    agentNotification: makeTable("notif"), auditLog: makeTable("audit"),
    syncJob: makeTable("sync"), webhookEvent: makeTable("hook"),
    tenantPaymentTransaction: makeTable("txn"), systemSetting: makeTable("setting"),
    abandonedStoreCheckout: makeTable("abandoned"),
  };
  const audit = { log: async () => undefined } as any;
  const probes = {
    graphGet: async (_token: string, path: string) => graphImpl(path),
    shopifyAccessScopes: extra.shopifyAccessScopes ?? (async () => { throw new Error("no scopes stub"); }),
  };
  const health = new ProviderHealthService(tables as any, audit, probes, undefined, extra.integrationsStub);
  return { tables, audit, health };
}

async function seedWhatsApp(tables: any, creds: any = { accessToken: "wa-token", phoneNumberId: "111", wabaId: "waba-1" }) {
  const integration = await tables.integration.create({
    data: { organizationId: "org-1", provider: "whatsapp", status: "CONNECTED", externalAccountId: "111", appSource: "platform", lastError: null, tokenExpiresAt: null, providerHealth: null, providerHealthAt: null, providerHealthError: null },
  });
  await tables.integrationCredential.create({
    data: { integrationId: integration.id, encryptedData: encryptJson(creds) },
  });
  return integration;
}

describe("CC14 — WhatsApp deep health fetch/store", () => {
  it("stores Meta's values verbatim; fields Meta did not return stay ABSENT", async () => {
    const { tables, health } = build(async (path) => {
      if (path.includes("account_review_status")) return { name: "My WABA", account_review_status: "APPROVED" };
      // No name_status / code_verification_status in this payload.
      return { display_phone_number: "+880 1711-000000", verified_name: "My Shop", quality_rating: "GREEN", messaging_limit: "TIER_1K", status: "CONNECTED" };
    });
    const integration = await seedWhatsApp(tables);
    const res = await health.refreshTarget("org-1", "owner-1", "integration", integration.id);
    expect(res.ok).toBe(true);
    const snap = res.providerHealth;
    expect(snap.kind).toBe("whatsapp");
    expect(snap.displayPhoneNumber).toBe("+880 1711-000000");
    expect(snap.qualityRating).toBe("GREEN");
    expect(snap.messagingLimit).toBe("TIER_1K");
    expect("nameStatus" in snap).toBe(false);
    expect("codeVerificationStatus" in snap).toBe(false);
    expect(snap.waba).toEqual({ id: "waba-1", name: "My WABA", accountReviewStatus: "APPROVED" });
    expect(res.providerHealthAt).toBeTruthy();
    expect(res.providerHealthError).toBeNull();
    // The row itself carries the snapshot (overview source).
    const row = tables.integration.rows.find((r: any) => r.id === integration.id);
    expect(row.providerHealth.qualityRating).toBe("GREEN");
  });

  it("a failed fetch records the error and leaves the previous snapshot + timestamp untouched", async () => {
    let fail = false;
    const { tables, health } = build(async (path) => {
      if (fail) throw new Error("Meta exploded (190)");
      if (path.includes("account_review_status")) return { account_review_status: "APPROVED" };
      return { quality_rating: "GREEN", messaging_limit: "TIER_250" };
    });
    const integration = await seedWhatsApp(tables);
    const first = await health.refreshWhatsAppHealth("org-1", integration.id);
    expect(first.ok).toBe(true);
    const row = tables.integration.rows.find((r: any) => r.id === integration.id);
    const atBefore = row.providerHealthAt;
    fail = true;
    const second = await health.refreshWhatsAppHealth("org-1", integration.id);
    expect(second.ok).toBe(false);
    expect(second.error).toContain("Meta exploded");
    expect(row.providerHealth.qualityRating).toBe("GREEN");
    expect(row.providerHealthAt).toBe(atBefore);
    expect(row.providerHealthError).toContain("Meta exploded");
  });

  it("a WABA sub-fetch failure degrades only the WABA entry, transparently", async () => {
    const { tables, health } = build(async (path) => {
      if (path.includes("account_review_status")) throw new Error("WABA node forbidden");
      return { quality_rating: "YELLOW" };
    });
    const integration = await seedWhatsApp(tables);
    const res = await health.refreshWhatsAppHealth("org-1", integration.id);
    expect(res.ok).toBe(true);
    expect(res.snapshot.qualityRating).toBe("YELLOW");
    expect(res.snapshot.waba).toBeUndefined();
    expect(res.snapshot.wabaError).toContain("WABA node forbidden");
  });
});

describe("CC15 — Meta Page completeness", () => {
  async function seedPage(tables: any) {
    const integration = await tables.integration.create({
      data: { organizationId: "org-1", provider: "meta_social", status: "CONNECTED", externalAccountId: "page-1", appSource: "platform", providerHealth: null, providerHealthAt: null, providerHealthError: null },
    });
    await tables.integrationCredential.create({
      data: { integrationId: integration.id, encryptedData: encryptJson({ accessToken: "page-token", pageId: "page-1" }) },
    });
    const account = await tables.socialAccount.create({
      data: { organizationId: "org-1", integrationId: integration.id, platform: "meta_page", externalId: "page-1", name: "My Page", status: "connected", providerHealth: null, providerHealthAt: null, providerHealthError: null },
    });
    return { integration, account };
  }

  async function seedAdAccount(tables: any) {
    const adIntegration = await tables.integration.create({
      data: { organizationId: "org-1", provider: "meta", status: "CONNECTED", externalAccountId: null, appSource: "platform" },
    });
    adIntegration.credential = { encryptedData: encryptJson({ accessToken: "ad-token" }) };
    const ad = await tables.adAccount.create({
      data: { organizationId: "org-1", integrationId: adIntegration.id, platform: "meta", sourceType: "api", externalId: "12345", name: "Ads", status: "ACTIVE", platformStatusBucket: "active", platformStatusRaw: "1", providerHealth: null, providerHealthAt: null, providerHealthError: null },
    });
    return ad;
  }

  it("IG linked + pixel present + catalog empty — each exactly as Meta answered", async () => {
    const { tables, health } = build(async (path) => {
      if (path.includes("instagram_business_account")) return { instagram_business_account: { id: "ig-1", username: "myshop" } };
      if (path.includes("adspixels")) return { data: [{ id: "px-1", name: "Main Pixel" }] };
      if (path.includes("productcatalogs")) return { data: [] };
      throw new Error(`unexpected path ${path}`);
    });
    const { account } = await seedPage(tables);
    await seedAdAccount(tables);
    const res = await health.refreshMetaPageHealth("org-1", account.id);
    expect(res.ok).toBe(true);
    const snap = res.providerHealth;
    expect(snap.instagram).toEqual({ linked: true, id: "ig-1", username: "myshop" });
    expect(snap.pixel).toEqual({ associated: true, count: 1, scope: "meta_ad_account" });
    expect(snap.catalog).toEqual({ associated: false, count: 0, scope: "meta_ad_account" });
  });

  it("no connected Meta ad account → pixel/catalog stay UNKNOWN (associated: null), IG still answered", async () => {
    const { tables, health } = build(async (path) => {
      if (path.includes("instagram_business_account")) return {};
      throw new Error(`unexpected path ${path}`);
    });
    const { account } = await seedPage(tables);
    const res = await health.refreshMetaPageHealth("org-1", account.id);
    expect(res.ok).toBe(true);
    expect(res.providerHealth.instagram).toEqual({ linked: false });
    expect(res.providerHealth.pixel.associated).toBeNull();
    expect(res.providerHealth.pixel.error).toContain("Ad Account");
    expect(res.providerHealth.catalog.associated).toBeNull();
  });

  it("a failed Page fetch stores NOTHING and records the error", async () => {
    const { tables, health } = build(async () => { throw new Error("Graph down"); });
    const { account } = await seedPage(tables);
    const res = await health.refreshMetaPageHealth("org-1", account.id);
    expect(res.ok).toBe(false);
    const row = tables.socialAccount.rows.find((r: any) => r.id === account.id);
    expect(row.providerHealth).toBeNull();
    expect(row.providerHealthAt).toBeNull();
    expect(row.providerHealthError).toContain("Graph down");
  });
});

describe("CC15 — Ad Account payment-method-on-file", () => {
  it("funding source present → boolean true; absent on a successful answer → boolean false (not unknown)", async () => {
    let funding: any = { funding_source_details: { id: "fs-1", type: "FACEBOOK_AD_ACCOUNT_PAYMENT" } };
    const { tables, health } = build(async (path) => {
      if (path.includes("funding_source_details")) return funding;
      throw new Error(`unexpected path ${path}`);
    });
    const integration = await tables.integration.create({
      data: { organizationId: "org-1", provider: "meta", status: "CONNECTED", appSource: "platform" },
    });
    integration.credential = { encryptedData: encryptJson({ accessToken: "ad-token" }) };
    const ad = await tables.adAccount.create({
      data: { organizationId: "org-1", integrationId: integration.id, platform: "meta", sourceType: "api", externalId: "999", name: "Ads", status: "ACTIVE", platformStatusBucket: "restricted", platformStatusRaw: "3", providerHealth: null, providerHealthAt: null, providerHealthError: null },
    });
    const r1 = await health.refreshAdAccountHealth("org-1", ad.id);
    expect(r1.ok).toBe(true);
    expect(r1.providerHealth).toEqual({ kind: "ad_account", paymentMethodOnFile: true });
    // The AD3 bucket rides beside the boolean, from the row itself.
    expect(r1.platformStatusBucket).toBe("restricted");
    funding = {};
    const r2 = await health.refreshAdAccountHealth("org-1", ad.id);
    expect(r2.ok).toBe(true);
    expect(r2.providerHealth.paymentMethodOnFile).toBe(false);
  });

  it("a failed funding fetch records the error and stores no fact; a Google account is honestly unsupported", async () => {
    const { tables, health } = build(async () => { throw new Error("token expired"); });
    const integration = await tables.integration.create({
      data: { organizationId: "org-1", provider: "meta", status: "CONNECTED", appSource: "platform" },
    });
    integration.credential = { encryptedData: encryptJson({ accessToken: "ad-token" }) };
    const ad = await tables.adAccount.create({
      data: { organizationId: "org-1", integrationId: integration.id, platform: "meta", sourceType: "api", externalId: "999", name: "Ads", status: "ACTIVE", providerHealth: null, providerHealthAt: null, providerHealthError: null },
    });
    const r1 = await health.refreshAdAccountHealth("org-1", ad.id);
    expect(r1.ok).toBe(false);
    const row = tables.adAccount.rows.find((r: any) => r.id === ad.id);
    expect(row.providerHealth).toBeNull();
    expect(row.providerHealthError).toContain("token expired");
    const google = await tables.adAccount.create({
      data: { organizationId: "org-1", integrationId: null, platform: "google", sourceType: "api", externalId: "g-1", name: "G", status: "ACTIVE", providerHealth: null, providerHealthAt: null, providerHealthError: null },
    });
    const r2 = await health.refreshAdAccountHealth("org-1", google.id);
    expect(r2.supported).toBe(false);
    expect(tables.adAccount.rows.find((r: any) => r.id === google.id).providerHealth).toBeNull();
  });
});

describe("CC14 + CC12 — sweep refreshes WhatsApp health; a quality DROP alerts exactly once", () => {
  it("GREEN → RED alerts once, staying RED is silent, recovery notifies once", async () => {
    let quality = "GREEN";
    const { tables, audit, health } = build(async (path) => {
      if (path.includes("account_review_status")) return { account_review_status: "APPROVED" };
      return { quality_rating: quality, messaging_limit: "TIER_1K" };
    });
    const connections = new ConnectionsService(tables as any, audit);
    const email = { send: async () => ({ providerMessageId: "msg-1" }) } as any;
    const doctorStub: any = { diagnoseTarget: async () => ({ overall: "pass", steps: [] }), findTarget: async () => { throw new Error("n/a"); } };
    const monitor = new ConnectionMonitorService(tables as any, audit, connections, doctorStub, email, health);
    const owner = await tables.user.create({ data: { email: "owner@example.com", name: "Owner" } });
    const m = await tables.membership.create({ data: { organizationId: "org-1", userId: owner.id, role: "OWNER", status: "ACTIVE" } });
    m.user = owner;
    await seedWhatsApp(tables);

    const s1 = await monitor.runSweep("org-1");
    expect(s1.whatsappRefreshes).toBe(1);
    expect(tables.connectionAlert.rows.length).toBe(0);

    quality = "RED";
    const s2 = await monitor.runSweep("org-1");
    expect(s2.whatsappRefreshes).toBe(1);
    const drops = tables.connectionAlert.rows.filter((a: any) => a.state === "whatsapp_quality_drop");
    expect(drops.length).toBe(1);
    expect(drops[0].kind).toBe("broke");

    await monitor.runSweep("org-1");
    expect(tables.connectionAlert.rows.filter((a: any) => a.state === "whatsapp_quality_drop").length).toBe(1);

    quality = "GREEN";
    await monitor.runSweep("org-1");
    const all = tables.connectionAlert.rows.filter((a: any) => a.state === "whatsapp_quality_drop");
    expect(all.length).toBe(2);
    expect(all[1].kind).toBe("recovered");

    await monitor.runSweep("org-1");
    expect(tables.connectionAlert.rows.filter((a: any) => a.state === "whatsapp_quality_drop").length).toBe(2);
  });
});

describe("CC16 — commerce diagnostics + webhook repair", () => {
  it("webhook repair dispatches to the existing registrar and returns its outcome verbatim (partial stays partial)", async () => {
    const newStatus = { provider: "woocommerce", status: "partial", topics: { "order.created": { status: "registered" }, "order.updated": { status: "failed", error: "store 500" } }, updatedAt: new Date().toISOString() };
    let integrationRow: any;
    const integrationsStub: any = {
      getIntegration: async () => integrationRow,
      repairWooWebhooks: async () => {
        integrationRow.webhookStatus = newStatus;
        return { integrationId: integrationRow.id, webhookRegistration: "partial", webhookStatus: newStatus };
      },
    };
    const { tables, health } = build(async () => { throw new Error("unused"); }, { integrationsStub });
    integrationRow = await tables.integration.create({
      data: { organizationId: "org-1", provider: "woocommerce", status: "CONNECTED", storeId: "store-1", webhookStatus: { provider: "woocommerce", status: "failed", topics: {} } },
    });
    const res = await health.repairWebhooks("org-1", "owner-1", integrationRow.id);
    expect(res.webhookRegistration).toBe("partial");
    expect(res.webhookStatus).toEqual(newStatus);
  });

  it("Shopify scope diff lists ONLY genuinely missing scopes; a failed scope fetch stays unknown", async () => {
    const granted = SHOPIFY_REQUIRED_SCOPES.filter((s) => !["write_discounts", "read_customers"].includes(s));
    let scopeImpl: (i: any) => Promise<string[]> = async () => granted;
    const integrationsStub: any = {
      getIntegration: async (_org: string, id: string) => ({ id, provider: "shopify", storeId: "store-9", webhookStatus: { provider: "shopify", status: "registered", topics: { "orders/create": { status: "registered" } } } }),
    };
    const { tables, health } = build(async () => { throw new Error("unused"); }, {
      integrationsStub,
      shopifyAccessScopes: (i: any) => scopeImpl(i),
    });
    void tables;
    const diag = await health.commerceDiagnostics("org-1", "int-shop-1");
    expect(diag.shopifyScopes?.missing).toEqual(["read_customers", "write_discounts"]);
    expect(diag.shopifyScopes?.granted).toEqual(granted);
    expect(diag.webhookStatus.status).toBe("registered");
    scopeImpl = async () => { throw new Error("accessScopes forbidden for legacy token"); };
    const diag2 = await health.commerceDiagnostics("org-1", "int-shop-1");
    expect(diag2.shopifyScopes).toBeNull();
    expect(diag2.shopifyScopesError).toContain("forbidden");
  });

  it("tracker freshness comes from the real abandoned-checkout records; none recorded → null, never invented", async () => {
    const integrationsStub: any = {
      getIntegration: async (_org: string, id: string) => ({ id, provider: "woocommerce", storeId: "store-1", webhookStatus: null }),
    };
    const { tables, health } = build(async () => { throw new Error("unused"); }, { integrationsStub });
    const older = await tables.abandonedStoreCheckout.create({
      data: { organizationId: "org-1", storeId: "store-1", externalCheckoutId: "c-1", abandonedAt: new Date(Date.now() - 86400000) },
    });
    const newer = await tables.abandonedStoreCheckout.create({
      data: { organizationId: "org-1", storeId: "store-1", externalCheckoutId: "c-2", abandonedAt: new Date() },
    });
    void older;
    const diag = await health.commerceDiagnostics("org-1", "int-woo-1");
    expect(diag.tracker?.label).toContain("tracker");
    expect(new Date(diag.tracker!.lastEventAt!).getTime()).toBe(new Date(newer.createdAt).getTime());
    const empty = build(async () => { throw new Error("unused"); }, { integrationsStub });
    const diag2 = await empty.health.commerceDiagnostics("org-1", "int-woo-1");
    expect(diag2.tracker?.lastEventAt).toBeNull();
  });
});
