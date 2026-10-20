process.env.ENCRYPTION_KEY = Buffer.alloc(32, 7).toString("base64");
process.env.JWT_SECRET = "test-secret";

import { ConnectionsService, deriveHealth, categoryForProvider } from "./connections.service";
import { setPlatformConfigSnapshot } from "../common/platform-config";

/**
 * CC1/CC2 — Connect Center: overview aggregation over the REAL
 * backing tables (fake Prisma, codebase style), health derivation
 * from stored fields, default selection scoped to the category
 * group, and per-account disconnect that leaves siblings alone.
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
    return row[k] === v;
  });
}

function makeTable(name: string) {
  const rows: any[] = [];
  let seq = 0;
  return {
    rows,
    findFirst: async ({ where }: any = {}) => rows.filter((r) => matches(r, where ?? {}))[0] ?? null,
    findMany: async ({ where }: any = {}) => rows.filter((r) => matches(r, where ?? {})),
    findUnique: async ({ where }: any) => rows.filter((r) => matches(r, where ?? {}))[0] ?? null,
    create: async ({ data }: any) => { const row = { id: `${name}-${++seq}`, createdAt: new Date(), updatedAt: new Date(), ...data }; rows.push(row); return row; },
    update: async ({ where, data }: any) => {
      const row = rows.find((r) => matches(r, where));
      if (row) Object.assign(row, data);
      return row;
    },
    deleteMany: async ({ where }: any) => {
      let count = 0;
      for (let i = rows.length - 1; i >= 0; i--) if (matches(rows[i], where ?? {})) { rows.splice(i, 1); count++; }
      return { count };
    },
  };
}

function buildService(seed?: (tables: any) => void) {
  const tables: any = {
    integration: makeTable("int"),
    integrationCredential: makeTable("cred"),
    socialAccount: makeTable("soc"),
    adAccount: makeTable("ad"),
    store: makeTable("store"),
    messagingSenderConfig: makeTable("sender"),
    businessProfile: makeTable("profile"),
    systemSetting: makeTable("setting"),
  };
  seed?.(tables);
  const auditLogs: any[] = [];
  const audit = { log: async (entry: any) => { auditLogs.push(entry); } } as any;
  const svc = new ConnectionsService(tables as any, audit);
  return { svc, tables, auditLogs };
}

const NOW = new Date();
const inDays = (d: number) => new Date(NOW.getTime() + d * 24 * 60 * 60 * 1000);

describe("CC1 deriveHealth (stored fields only)", () => {
  it("maps status/lastError/token expiry to the honest health values", () => {
    expect(deriveHealth({ status: "CONNECTED" }, NOW).health).toBe("ok");
    expect(deriveHealth({ status: "DISCONNECTED" }, NOW).health).toBe("disconnected");
    expect(deriveHealth({ status: "CONNECTED", lastError: "token invalid" }, NOW).health).toBe("error");
    expect(deriveHealth({ status: "CONNECTED", tokenExpiresAt: inDays(-1) }, NOW)).toEqual({ health: "error", expiringSoon: true });
    expect(deriveHealth({ status: "CONNECTED", tokenExpiresAt: inDays(3) }, NOW)).toEqual({ health: "expiring", expiringSoon: true });
    expect(deriveHealth({ status: "CONNECTED", tokenExpiresAt: inDays(30) }, NOW)).toEqual({ health: "ok", expiringSoon: false });
    expect(deriveHealth({}, NOW).health).toBe("unknown");
    expect(deriveHealth({ status: "connected" }, NOW).health).toBe("ok"); // social-account casing
  });

  it("classifies the providers seen in the wild", () => {
    expect(categoryForProvider("whatsapp")).toBe("messaging");
    expect(categoryForProvider("telegram")).toBe("messaging");
    expect(categoryForProvider("email")).toBe("messaging");
    expect(categoryForProvider("meta_social")).toBe("social");
    expect(categoryForProvider("youtube_social")).toBe("social");
    expect(categoryForProvider("google_ads")).toBe("ads");
    expect(categoryForProvider("woocommerce")).toBe("commerce");
    expect(categoryForProvider("steadfast")).toBe("courier");
    expect(categoryForProvider("redx")).toBe("courier");
    expect(categoryForProvider("legacy_unknown")).toBe("other");
  });
});

describe("CC1 overview aggregation", () => {
  it("lands every source in the right category with derived health and no secrets", async () => {
    const { svc } = buildService((t) => {
      t.integration.rows.push(
        { id: "wa-1", organizationId: "org-1", provider: "whatsapp", status: "CONNECTED", externalAccountId: "111", lastSyncAt: NOW, lastError: null, tokenExpiresAt: null, isDefault: true, createdAt: NOW },
        { id: "wa-2", organizationId: "org-1", provider: "whatsapp", status: "DISCONNECTED", externalAccountId: "222", lastError: null, tokenExpiresAt: null, isDefault: false, createdAt: NOW },
        { id: "msg-1", organizationId: "org-1", provider: "messenger", status: "CONNECTED", externalAccountId: "page-9", lastError: "Session expired", tokenExpiresAt: null, isDefault: false, createdAt: NOW },
        { id: "shop-1", organizationId: "org-1", provider: "shopify", status: "CONNECTED", externalAccountId: null, storeId: "store-1", lastError: null, tokenExpiresAt: inDays(3), isDefault: false, createdAt: NOW },
        { id: "courier-1", organizationId: "org-1", provider: "steadfast", status: "CONNECTED", externalAccountId: null, lastError: null, tokenExpiresAt: null, isDefault: true, createdAt: NOW },
        { id: "legacy-1", organizationId: "org-1", provider: "legacy_sms", status: "CONNECTED", externalAccountId: null, lastError: null, tokenExpiresAt: null, isDefault: false, createdAt: NOW },
        { id: "other-org", organizationId: "org-2", provider: "whatsapp", status: "CONNECTED", externalAccountId: "999", createdAt: NOW },
      );
      t.socialAccount.rows.push({ id: "soc-1", organizationId: "org-1", platform: "meta_page", externalId: "page-9", name: "আমার শপ", status: "connected", lastError: null, createdAt: NOW });
      t.adAccount.rows.push(
        { id: "ad-1", organizationId: "org-1", platform: "meta", externalId: "act_1", name: "Main Ads", status: "ACTIVE", platformStatusBucket: "active", platformStatusCheckedAt: NOW, createdAt: NOW },
        { id: "ad-2", organizationId: "org-1", platform: "google", externalId: "123", name: "Google", status: "ACTIVE", platformStatusBucket: null, platformStatusCheckedAt: null, createdAt: NOW },
      );
      t.store.rows.push({ id: "store-1", organizationId: "org-1", platform: "SHOPIFY", name: "My Shop", url: "shop.example.com", isActive: true, createdAt: NOW });
      t.messagingSenderConfig.rows.push({ id: "sender-1", organizationId: "org-1", smtpHost: "smtp.example.com", fromAddress: "hello@shop.example.com", smsGateway: "sslwireless", smsSenderId: "SHOP", createdAt: NOW });
      t.businessProfile.rows.push({ id: "profile-1", organizationId: "org-1", bkashNumber: "01700000000", nagadNumber: null, codAvailable: true, createdAt: NOW });
    });

    const overview = await svc.getOverview("org-1");
    const byKey = Object.fromEntries(overview.categories.map((c) => [c.key, c]));

    // messaging: both WhatsApp numbers coexist + the messenger row.
    expect(byKey.messaging.totalCount).toBe(3);
    const wa = byKey.messaging.accounts.filter((a) => a.provider === "whatsapp");
    expect(wa.map((a) => a.health).sort()).toEqual(["disconnected", "ok"]);
    expect(wa.find((a) => a.id === "wa-1")?.isDefault).toBe(true);
    expect(byKey.messaging.accounts.find((a) => a.id === "msg-1")?.health).toBe("error");
    expect(byKey.messaging.accounts.find((a) => a.id === "msg-1")?.lastError).toBe("Session expired");

    // commerce: the shopify integration (expiring token, store name) + the store row.
    expect(byKey.commerce.totalCount).toBe(2);
    const shopify = byKey.commerce.accounts.find((a) => a.id === "shop-1");
    expect(shopify?.health).toBe("expiring");
    expect(shopify?.expiringSoon).toBe(true);
    expect(shopify?.displayName).toContain("My Shop");
    expect(byKey.commerce.accounts.find((a) => a.source === "store")?.externalAccountId).toBe("shop.example.com");

    expect(byKey.courier.accounts.map((a) => a.provider)).toEqual(["steadfast"]);
    expect(byKey.social.accounts[0]).toMatchObject({ provider: "meta_page", displayName: "আমার শপ", health: "ok" });
    expect(byKey.ads.accounts.find((a) => a.id === "ad-1")?.health).toBe("ok");
    expect(byKey.ads.accounts.find((a) => a.id === "ad-2")?.health).toBe("unknown"); // never checked on the platform: honestly unknown
    expect(byKey.senders.totalCount).toBe(2);
    expect(byKey.senders.accounts.map((a) => a.status)).toEqual(["CONFIGURED", "CONFIGURED"]);
    expect(byKey.payment.totalCount).toBe(1);
    expect(byKey.payment.accounts[0].displayName).toContain("বিকাশ");
    expect(byKey.other.accounts.map((a) => a.provider)).toEqual(["legacy_sms"]);

    // AI has no per-org store today and no platform LLM is seeded.
    expect(byKey.ai.status).toBe("not_configured");
    expect(byKey.ai.accounts).toEqual([]);

    expect(overview.summary.totalAccounts).toBe(13);
    expect(overview.summary.errorAccounts).toBe(1);
    expect(overview.summary.byCategory.messaging).toEqual({ connected: 2, total: 3 });
    // No credential material exists anywhere in this API's output.
    expect(JSON.stringify(overview)).not.toContain("encryptedData");
  });

  it("an empty org returns honest empty categories, not invented rows", async () => {
    const { svc } = buildService();
    const overview = await svc.getOverview("org-empty");
    expect(overview.summary.totalAccounts).toBe(0);
    for (const category of overview.categories) {
      expect(category.accounts).toEqual([]);
      expect(category.totalCount).toBe(0);
    }
    expect(overview.categories.find((c) => c.key === "payment")?.status).toBe("not_configured");
    expect(overview.categories.find((c) => c.key === "ai")?.status).toBe("not_configured");
    expect(overview.categories.find((c) => c.key === "messaging")?.note).toBe("no_accounts");
  });
});

describe("CC2 setDefault (category-group scoped)", () => {
  it("clears the previous default in the same category only and audits", async () => {
    const { svc, tables, auditLogs } = buildService((t) => {
      t.integration.rows.push(
        { id: "wa-1", organizationId: "org-1", provider: "whatsapp", status: "CONNECTED", externalAccountId: "111", isDefault: true, createdAt: NOW },
        { id: "wa-2", organizationId: "org-1", provider: "whatsapp", status: "CONNECTED", externalAccountId: "222", isDefault: false, createdAt: NOW },
        { id: "sf-1", organizationId: "org-1", provider: "steadfast", status: "CONNECTED", isDefault: true, createdAt: NOW },
      );
    });
    const out = await svc.setDefault("org-1", "owner-1", "wa-2");
    expect(out).toMatchObject({ id: "wa-2", category: "messaging", isDefault: true, clearedDefaults: ["wa-1"] });
    const rows = Object.fromEntries(tables.integration.rows.map((r: any) => [r.id, r.isDefault]));
    expect(rows).toEqual({ "wa-1": false, "wa-2": true, "sf-1": true }); // courier default untouched
    expect(auditLogs).toHaveLength(1);
    expect(auditLogs[0]).toMatchObject({ action: "integration.default_set", entityId: "wa-2" });
    expect(auditLogs[0].metadata).toMatchObject({ provider: "whatsapp", category: "messaging", clearedDefaults: ["wa-1"] });
  });

  it("404s for an integration of another org", async () => {
    const { svc } = buildService((t) => {
      t.integration.rows.push({ id: "wa-x", organizationId: "org-2", provider: "whatsapp", status: "CONNECTED", createdAt: NOW });
    });
    await expect(svc.setDefault("org-1", "owner-1", "wa-x")).rejects.toMatchObject({ code: "connections.integrationNotFound" });
  });
});

describe("CC2 disconnect (single row only)", () => {
  it("disconnecting one WhatsApp number leaves the other CONNECTED with its credential intact", async () => {
    const { svc, tables, auditLogs } = buildService((t) => {
      t.integration.rows.push(
        { id: "wa-1", organizationId: "org-1", provider: "whatsapp", status: "CONNECTED", externalAccountId: "111", isDefault: true, createdAt: NOW },
        { id: "wa-2", organizationId: "org-1", provider: "whatsapp", status: "CONNECTED", externalAccountId: "222", isDefault: false, createdAt: NOW },
      );
      t.integrationCredential.rows.push(
        { id: "cred-1", integrationId: "wa-1", encryptedData: "sealed-1" },
        { id: "cred-2", integrationId: "wa-2", encryptedData: "sealed-2" },
      );
    });
    const out = await svc.disconnect("org-1", "owner-1", "wa-1");
    expect(out).toEqual({ id: "wa-1", provider: "whatsapp", status: "DISCONNECTED" });
    const wa1 = tables.integration.rows.find((r: any) => r.id === "wa-1");
    const wa2 = tables.integration.rows.find((r: any) => r.id === "wa-2");
    expect(wa1.status).toBe("DISCONNECTED");
    expect(wa1.isDefault).toBe(false);
    expect(wa2.status).toBe("CONNECTED");
    expect(tables.integrationCredential.rows.map((r: any) => r.integrationId)).toEqual(["wa-2"]);
    expect(auditLogs[0]).toMatchObject({ action: "integration.disconnect", entityId: "wa-1" });
    expect(auditLogs[0].metadata).toMatchObject({ provider: "whatsapp", via: "connections" });
  });
});

describe("CC1 AI category (platform-managed honesty)", () => {
  it("reports platform_managed only when the platform LLM config really exists", async () => {
    const { svc } = buildService((t) => {
      t.systemSetting.rows.push({ id: "set-1", key: "llmConfig", value: { provider: "openai" } });
    });
    // Force the snapshot stale so ensurePlatformConfig re-reads the store.
    setPlatformConfigSnapshot({ llm: null, metaApp: null, smtp: null, sms: null, loadedAt: 0 } as any);
    const overview = await svc.getOverview("org-1");
    const ai = overview.categories.find((c) => c.key === "ai");
    expect(ai?.status).toBe("platform_managed");
    expect(ai?.note).toBe("ai_platform_managed");
    expect(ai?.accounts).toEqual([]); // still no invented per-org row
  });
});
