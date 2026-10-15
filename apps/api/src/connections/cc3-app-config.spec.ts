process.env.ENCRYPTION_KEY = Buffer.alloc(32, 7).toString("base64");
process.env.JWT_SECRET = "test-secret";

import { ConnectionsService } from "./connections.service";
import { decryptJson } from "../integrations/crypto";
import { resolveTenantAppConfig } from "./tenant-app-config";

/**
 * CC3 — Connect Center: the tenant's OWN app configs.
 * - Meta: verify-before-save with a REAL Graph API check, here at
 *   the injectable-client boundary (stubbed — codebase pattern).
 *   Success saves the secret SEALED and marks the row "verified";
 *   failure saves NOTHING and surfaces Meta's own message.
 * - TikTok: TikTok has no credential-check endpoint usable
 *   without a user auth code, so the config saves as "configured"
 *   — no verification is fabricated (the Meta verifier stub is
 *   armed to explode if anything even tries to "verify" TikTok).
 * - Secrets never leave the API: no view contains the plaintext
 *   or the ciphertext.
 * - Overview flags appSource="own" connections whose config was
 *   deleted (ownAppConfigMissing).
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
      if (row) Object.assign(row, data, { updatedAt: new Date() });
      return row;
    },
    delete: async ({ where }: any) => {
      const idx = rows.findIndex((r) => matches(r, where));
      if (idx < 0) throw new Error("Record to delete does not exist.");
      return rows.splice(idx, 1)[0];
    },
    deleteMany: async ({ where }: any) => {
      let count = 0;
      for (let i = rows.length - 1; i >= 0; i--) if (matches(rows[i], where ?? {})) { rows.splice(i, 1); count++; }
      return { count };
    },
  };
}

function buildService(metaStub?: any) {
  const tables: any = {
    integration: makeTable("int"),
    integrationCredential: makeTable("cred"),
    socialAccount: makeTable("soc"),
    adAccount: makeTable("ad"),
    store: makeTable("store"),
    messagingSenderConfig: makeTable("sender"),
    businessProfile: makeTable("profile"),
    systemSetting: makeTable("setting"),
    tenantAppConfig: makeTable("appcfg"),
  };
  const auditLogs: any[] = [];
  const audit = { log: async (entry: any) => { auditLogs.push(entry); } } as any;
  const svc = new ConnectionsService(tables as any, audit, metaStub);
  return { svc, tables, auditLogs };
}

const META_SECRET = "meta-app-secret-xyz";
const okMeta = { verifyApp: async (appId: string) => ({ id: appId, name: "Tenant App" }) };

describe("CC3 Meta app config (verify-before-save)", () => {
  it("verify success saves the secret SEALED, marks verified, and never returns the secret", async () => {
    const { svc, tables, auditLogs } = buildService(okMeta);
    const view = await svc.putAppConfig("org-1", "owner-1", "meta", { appId: "123456", appSecret: META_SECRET });

    expect(view).toMatchObject({ platform: "meta", appId: "123456", status: "verified", verificationNote: "verified_with_meta" });
    expect(view.lastVerifiedAt).toBeInstanceOf(Date);
    expect(JSON.stringify(view)).not.toContain(META_SECRET);

    expect(tables.tenantAppConfig.rows).toHaveLength(1);
    const stored = tables.tenantAppConfig.rows[0];
    expect(stored.encryptedSecret).not.toContain(META_SECRET);
    expect(stored.encryptedSecret.startsWith("v1:")).toBe(true);
    expect(decryptJson<any>(stored.encryptedSecret)).toEqual({ appSecret: META_SECRET });

    const { configs } = await svc.listAppConfigs("org-1");
    expect(configs).toHaveLength(1);
    expect(JSON.stringify(configs)).not.toContain(META_SECRET);
    expect(JSON.stringify(configs)).not.toContain("encryptedSecret");
    expect(auditLogs[0]).toMatchObject({ action: "tenant_app_config.saved" });
    expect(JSON.stringify(auditLogs)).not.toContain(META_SECRET);

    // The shared resolver hands the connect flows the real pair.
    await expect(resolveTenantAppConfig(tables as any, "org-1", "meta"))
      .resolves.toEqual({ appId: "123456", appSecret: META_SECRET, status: "verified" });
  });

  it("verify failure saves NOTHING and surfaces Meta's own message as a 400", async () => {
    const failingMeta = { verifyApp: async () => { throw new Error("Invalid OAuth access token - cannot parse access token"); } };
    const { svc, tables } = buildService(failingMeta);
    await expect(svc.putAppConfig("org-1", "owner-1", "meta", { appId: "123456", appSecret: "wrong" }))
      .rejects.toThrow(/Invalid OAuth access token/);
    expect(tables.tenantAppConfig.rows).toHaveLength(0);
    const { configs } = await svc.listAppConfigs("org-1");
    expect(configs).toEqual([]);
  });

  it("re-saving replaces the row in place (one config per org+platform)", async () => {
    const { svc, tables } = buildService(okMeta);
    await svc.putAppConfig("org-1", "owner-1", "meta", { appId: "111", appSecret: "s1" });
    const view = await svc.putAppConfig("org-1", "owner-1", "meta", { appId: "222", appSecret: "s2" });
    expect(tables.tenantAppConfig.rows).toHaveLength(1);
    expect(view.appId).toBe("222");
    await expect(resolveTenantAppConfig(tables as any, "org-1", "meta"))
      .resolves.toMatchObject({ appId: "222", appSecret: "s2" });
  });

  it("refuses an unknown platform and missing fields", async () => {
    const { svc } = buildService(okMeta);
    await expect(svc.putAppConfig("org-1", "owner-1", "google", { appId: "x", appSecret: "y" })).rejects.toThrow(/platform/);
    await expect(svc.putAppConfig("org-1", "owner-1", "meta", { appId: "", appSecret: "y" })).rejects.toThrow();
    await expect(svc.putAppConfig("org-1", "owner-1", "meta", { appId: "x", appSecret: " " })).rejects.toThrow();
  });
});

describe("CC3 TikTok app config (honest 'configured' — no fabricated verification)", () => {
  it("saves as configured without any verification call, sealed, with the first-connect note", async () => {
    let verifyCalls = 0;
    const explodingMeta = { verifyApp: async () => { verifyCalls++; throw new Error("must never be called for tiktok"); } };
    const { svc, tables } = buildService(explodingMeta);
    const view = await svc.putAppConfig("org-1", "owner-1", "tiktok", { appId: "tt-client-key", appSecret: "tt-secret" });

    expect(verifyCalls).toBe(0);
    expect(view).toMatchObject({
      platform: "tiktok", appId: "tt-client-key", status: "configured",
      lastVerifiedAt: null, verificationNote: "verified_at_first_connect",
    });
    const stored = tables.tenantAppConfig.rows[0];
    expect(stored.encryptedSecret).not.toContain("tt-secret");
    expect(decryptJson<any>(stored.encryptedSecret)).toEqual({ appSecret: "tt-secret" });
    await expect(resolveTenantAppConfig(tables as any, "org-1", "tiktok"))
      .resolves.toEqual({ appId: "tt-client-key", appSecret: "tt-secret", status: "configured" });
  });
});

describe("CC3 delete + overview own-app flags", () => {
  it("delete removes the config; the overview then flags own connections as config-missing", async () => {
    const { svc, tables, auditLogs } = buildService(okMeta);
    const NOW = new Date();
    tables.integration.rows.push(
      { id: "wa-own", organizationId: "org-1", provider: "whatsapp", status: "CONNECTED", externalAccountId: "111", appSource: "own", isDefault: false, createdAt: NOW },
      { id: "wa-plat", organizationId: "org-1", provider: "whatsapp", status: "CONNECTED", externalAccountId: "222", appSource: "platform", isDefault: false, createdAt: NOW },
    );
    tables.socialAccount.rows.push(
      { id: "tt-own", organizationId: "org-1", platform: "tiktok", externalId: "open-1", name: "TT", status: "connected", appSource: "own", createdAt: NOW },
    );

    await svc.putAppConfig("org-1", "owner-1", "meta", { appId: "123456", appSecret: META_SECRET });
    await svc.putAppConfig("org-1", "owner-1", "tiktok", { appId: "tt-key", appSecret: "tt-secret" });

    let overview = await svc.getOverview("org-1");
    let messaging = overview.categories.find((c) => c.key === "messaging")!;
    expect(messaging.accounts.find((a) => a.id === "wa-own")).toMatchObject({ appSource: "own", ownAppConfigMissing: false });
    expect(messaging.accounts.find((a) => a.id === "wa-plat")).toMatchObject({ appSource: "platform", ownAppConfigMissing: false });
    let social = overview.categories.find((c) => c.key === "social")!;
    expect(social.accounts.find((a) => a.id === "tt-own")).toMatchObject({ appSource: "own", ownAppConfigMissing: false });

    const out = await svc.deleteAppConfig("org-1", "owner-1", "meta");
    expect(out).toEqual({ platform: "meta", deleted: true });
    expect(auditLogs[auditLogs.length - 1]).toMatchObject({ action: "tenant_app_config.deleted" });

    overview = await svc.getOverview("org-1");
    messaging = overview.categories.find((c) => c.key === "messaging")!;
    // The connection row itself is untouched — only the flag changes.
    expect(messaging.accounts.find((a) => a.id === "wa-own")).toMatchObject({ appSource: "own", ownAppConfigMissing: true, status: "CONNECTED" });
    social = overview.categories.find((c) => c.key === "social")!;
    expect(social.accounts.find((a) => a.id === "tt-own")).toMatchObject({ ownAppConfigMissing: false });

    await expect(svc.deleteAppConfig("org-1", "owner-1", "meta")).rejects.toThrow(/not found/i);
  });
});
