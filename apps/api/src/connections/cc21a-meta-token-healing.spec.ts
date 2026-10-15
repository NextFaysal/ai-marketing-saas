process.env.ENCRYPTION_KEY = Buffer.alloc(32, 7).toString("base64");
process.env.JWT_SECRET = "<MASKED_SECRET_001>";

import {
  ConnectionHealingService,
  META_TOKEN_ATTEMPT_ACTION, META_TOKEN_RESULT_ACTION, META_TOKEN_HEAL_MAX_ATTEMPTS_PER_DAY,
  metaStoredTokenExpiry, metaTokenInHealWindow,
} from "./connection-healing.service";
import { MetaTokenExchangeClient } from "./meta-token-exchange.client";
import { deriveFieldState } from "./connection-monitor.service";
import { deriveHealth } from "./connections.service";
import { encryptJson, decryptJson } from "../integrations/crypto";
import { setPlatformConfigSnapshot } from "../common/platform-config";

/**
 * CC21a (B10.5) — Meta long-lived-token auto-refresh inside the
 * monitoring sweep. Pinned:
 * - the exchange client calls Graph's /oauth/access_token with
 *   grant_type=fb_exchange_token + the app credentials + the
 *   current token, and keeps Meta's error verbatim;
 * - a messaging target whose stored expiry is inside the
 *   expiring_3/expiring_1 window (or just past) is exchanged:
 *   the new token is sealed into the SAME credential record
 *   (other fields verbatim) and the stored expiry moves to
 *   now + expires_in — for BOTH app paths (tenant's own app via
 *   TenantAppConfig, platform app via metaAppConfig);
 * - a social account (meta_page) heals through its linked
 *   integration's credential, expiry in the SocialOAuth
 *   credential shape (expiresAt epoch ms);
 * - failure leaves the stored credential BYTE-IDENTICAL and is
 *   recorded (attempt + result rows), never thrown;
 * - cap: max 1 recorded attempt per target per day;
 * - non-Meta targets and healthy-window tokens are never
 *   attempted; missing app credentials = honest skip, counted
 *   in the summary, no credential change, no attempt row;
 * - Integration.autoHealEnabled=false opts out a messaging
 *   target AND (via the linked integration) a social account;
 * - after a heal, the next state derivation for the target is
 *   no longer an expiring state.
 */

const DAY = 24 * 60 * 60 * 1000;
const NOW = new Date("2026-10-15T02:00:00.000Z");

function matches(row: any, where: any): boolean {
  return Object.entries(where ?? {}).every(([k, v]: [string, any]) => {
    if (v === undefined) return true;
    if (v !== null && typeof v === "object" && !(v instanceof Date) && !Array.isArray(v)) {
      if ("in" in v) return v.in.includes(row[k]);
      if ("gte" in v) return new Date(row[k]).getTime() >= new Date(v.gte).getTime();
      if ("lte" in v) return new Date(row[k]).getTime() <= new Date(v.lte).getTime();
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
  return {
    rows,
    findFirst: async (args: any = {}) => rows.filter((r) => matches(r, args.where ?? {}))[0] ?? null,
    findMany: async (args: any = {}) => rows.filter((r) => matches(r, args.where ?? {})),
    findUnique: async (args: any = {}) => rows.filter((r) => matches(r, args.where ?? {}))[0] ?? null,
    create: async ({ data }: any) => { const row = { id: `${name}-${++seq}`, createdAt: new Date(), updatedAt: new Date(), ...data }; rows.push(row); return row; },
    update: async ({ where, data }: any) => {
      const row = rows.find((r) => matches(r, where));
      if (row) Object.assign(row, data);
      return row;
    },
  };
}

function build(exchangeImpl?: (args: any) => Promise<any>) {
  const tables: any = {
    integration: makeTable("int"), integrationCredential: makeTable("cred"),
    socialAccount: makeTable("sa"), auditLog: makeTable("audit"),
    tenantAppConfig: makeTable("tac"),
  };
  // Prisma `include: { credential: true }` on integration reads.
  // The credential is copied too: a real Prisma read snapshots
  // the stored string, so a later write must not leak into an
  // earlier read's view (the sibling-heal test depends on it).
  const attach = (row: any) => {
    if (!row) return row;
    const cred = tables.integrationCredential.rows.find((c: any) => c.integrationId === row.id);
    return { ...row, credential: cred ? { ...cred } : null };
  };
  const rawFindFirst = tables.integration.findFirst;
  const rawFindMany = tables.integration.findMany;
  tables.integration.findFirst = async (args: any = {}) => attach(await rawFindFirst(args));
  tables.integration.findMany = async (args: any = {}) => (await rawFindMany(args)).map(attach);

  const auditRows: any[] = [];
  const audit = {
    log: async (entry: any) => {
      auditRows.push(entry);
      // Stamp every audit row at the test clock so the daily-cap
      // counting (which reads createdAt) is deterministic.
      const row = await tables.auditLog.create({ data: { ...entry } });
      row.createdAt = new Date(NOW);
    },
  } as any;
  const exchangeCalls: any[] = [];
  const exchange: any = {
    exchangeToken: async (args: any) => {
      exchangeCalls.push(args);
      if (exchangeImpl) return exchangeImpl(args);
      return { accessToken: "NEW-TOKEN", expiresIn: 60 * 24 * 60 * 60 };
    },
  };
  const healing = new ConnectionHealingService(tables as any, audit, undefined, exchange);
  return { tables, healing, auditRows, exchangeCalls };
}

function setPlatformMeta(app: { appId: string; appSecret: string } | null) {
  setPlatformConfigSnapshot({ llm: null, metaApp: app, smtp: null, sms: null, loadedAt: Date.now() } as any);
}

async function seedMessaging(tables: any, overrides: any = {}, credOverrides: any = {}) {
  const integration = await tables.integration.create({
    data: {
      organizationId: "org-1", provider: "whatsapp", status: "CONNECTED",
      externalAccountId: "8801", appSource: "platform", autoHealEnabled: true,
      tokenExpiresAt: new Date(NOW.getTime() + 2 * DAY), ...overrides,
    },
  });
  // The create above went through the raw table (no credential
  // attached to the stored row itself — credentials live in
  // their own table, attached by include at read time).
  await tables.integrationCredential.create({
    data: {
      integrationId: integration.id,
      encryptedData: encryptJson({ accessToken: "OLD-TOKEN", appSecret: "per-connect-secret", verifyToken: "vt", phoneNumberId: "8801", ...credOverrides }),
    },
  });
  return integration;
}

async function seedSocialPage(tables: any, overrides: any = {}, credOverrides: any = {}) {
  const integration = await tables.integration.create({
    data: {
      organizationId: "org-1", provider: "meta_social", status: "CONNECTED",
      externalAccountId: "page-1", appSource: "platform", autoHealEnabled: true,
      tokenExpiresAt: null, ...overrides,
    },
  });
  await tables.integrationCredential.create({
    data: {
      integrationId: integration.id,
      encryptedData: encryptJson({ accessToken: "OLD-PAGE-TOKEN", pageId: "page-1", expiresAt: NOW.getTime() + 1 * DAY, ...credOverrides }),
    },
  });
  const account = await tables.socialAccount.create({
    data: {
      organizationId: "org-1", platform: "meta_page", externalId: "page-1", name: "Page One",
      status: "connected", integrationId: integration.id, appSource: "platform",
    },
  });
  return { integration, account };
}

describe("MetaTokenExchangeClient", () => {
  it("calls Graph /oauth/access_token with fb_exchange_token params and returns token + expires_in", async () => {
    const seen: string[] = [];
    const client = new MetaTokenExchangeClient((async (url: string) => {
      seen.push(String(url));
      return { ok: true, status: 200, json: async () => ({ access_token: "FRESH", token_type: "bearer", expires_in: 5184000 }) };
    }) as any);
    const out = await client.exchangeToken({ appId: "app-1", appSecret: "secret-1", currentToken: "CUR" });
    expect(out).toEqual({ accessToken: "FRESH", expiresIn: 5184000 });
    const url = new URL(seen[0]);
    expect(url.pathname).toMatch(/\/oauth\/access_token$/);
    expect(url.searchParams.get("grant_type")).toBe("fb_exchange_token");
    expect(url.searchParams.get("client_id")).toBe("app-1");
    expect(url.searchParams.get("client_secret")).toBe("secret-1");
    expect(url.searchParams.get("fb_exchange_token")).toBe("CUR");
  });

  it("keeps Meta's error message verbatim and treats a token-less success body as failure", async () => {
    const failing = new MetaTokenExchangeClient((async () => ({
      ok: false, status: 400, json: async () => ({ error: { message: "Error validating access token: The session has been invalidated", code: 190 } }),
    })) as any);
    await expect(failing.exchangeToken({ appId: "a", appSecret: "s", currentToken: "DEAD" }))
      .rejects.toThrow("Error validating access token: The session has been invalidated");
    const empty = new MetaTokenExchangeClient((async () => ({
      ok: true, status: 200, json: async () => ({ token_type: "bearer" }),
    })) as any);
    await expect(empty.exchangeToken({ appId: "a", appSecret: "s", currentToken: "X" }))
      .rejects.toThrow("no access_token");
  });
});

describe("CC21a window helpers", () => {
  it("stored expiry prefers the credential expiresAt (epoch ms), falls back to the integration column, else null", () => {
    expect(metaStoredTokenExpiry({ tokenExpiresAt: null }, { expiresAt: NOW.getTime() + DAY })?.getTime()).toBe(NOW.getTime() + DAY);
    expect(metaStoredTokenExpiry({ tokenExpiresAt: new Date(NOW.getTime() + 2 * DAY) }, {})?.getTime()).toBe(NOW.getTime() + 2 * DAY);
    expect(metaStoredTokenExpiry({ tokenExpiresAt: null }, { accessToken: "t", pageId: "p" })).toBeNull();
    expect(metaStoredTokenExpiry(null, null)).toBeNull();
  });

  it("window = expiring_3 / expiring_1 / just-expired; expiring_7 and no-expiry are out", () => {
    expect(metaTokenInHealWindow(new Date(NOW.getTime() + 2 * DAY), NOW)).toBe(true);
    expect(metaTokenInHealWindow(new Date(NOW.getTime() + 12 * 60 * 60 * 1000), NOW)).toBe(true);
    expect(metaTokenInHealWindow(new Date(NOW.getTime() - 60 * 1000), NOW)).toBe(true);
    expect(metaTokenInHealWindow(new Date(NOW.getTime() + 5 * DAY), NOW)).toBe(false);
    expect(metaTokenInHealWindow(null, NOW)).toBe(false);
  });
});

describe("CC21a autoHealMetaTokens", () => {
  it("platform-app messaging target: rotates the token in place, preserves other credential fields, moves the stored expiry, records attempt + result", async () => {
    setPlatformMeta({ appId: "plat-app", appSecret: "plat-secret" });
    const { tables, healing, auditRows, exchangeCalls } = build();
    const integration = await seedMessaging(tables);
    const out = await healing.autoHealMetaTokens("org-1", NOW);
    expect(out.attempted).toBe(1);
    expect(out.healed).toBe(1);
    expect(exchangeCalls).toEqual([{ appId: "plat-app", appSecret: "plat-secret", currentToken: "OLD-TOKEN" }]);
    const credRow = tables.integrationCredential.rows.find((c: any) => c.integrationId === integration.id);
    const cred = decryptJson<any>(credRow.encryptedData);
    expect(cred.accessToken).toBe("NEW-TOKEN");
    expect(cred.appSecret).toBe("per-connect-secret");
    expect(cred.verifyToken).toBe("vt");
    expect(cred.phoneNumberId).toBe("8801");
    const row = tables.integration.rows.find((r: any) => r.id === integration.id);
    expect(new Date(row.tokenExpiresAt).getTime()).toBe(NOW.getTime() + 60 * DAY);
    expect(auditRows.some((r) => r.action === META_TOKEN_ATTEMPT_ACTION && r.entityType === "Integration" && r.entityId === integration.id)).toBe(true);
    const result = auditRows.find((r) => r.action === META_TOKEN_RESULT_ACTION);
    expect(result?.metadata?.outcome).toBe("healed");
    // Next derivation (the exact chain the sweep runs: overview
    // deriveHealth → deriveFieldState): before the heal this
    // stored expiry was expiring_3; after it, the state is ok.
    const extras = { syncStreak: 0, webhookBad: false, webhookSummary: null };
    const before = deriveFieldState(
      { status: "CONNECTED", expiringSoon: deriveHealth({ status: "CONNECTED", tokenExpiresAt: new Date(NOW.getTime() + 2 * DAY) }, NOW).expiringSoon, tokenExpiresAt: new Date(NOW.getTime() + 2 * DAY) },
      extras, NOW,
    );
    expect(before.state).toBe("expiring_3");
    const after = deriveFieldState(
      { status: "CONNECTED", expiringSoon: deriveHealth({ status: "CONNECTED", tokenExpiresAt: row.tokenExpiresAt }, NOW).expiringSoon, tokenExpiresAt: row.tokenExpiresAt },
      extras, NOW,
    );
    expect(after.state).toBe("ok");
  });

  it("own-app messaging target: the exchange runs under the tenant's OWN app credentials, not the platform's", async () => {
    setPlatformMeta({ appId: "plat-app", appSecret: "plat-secret" });
    const { tables, healing, exchangeCalls } = build();
    await tables.tenantAppConfig.create({
      data: { organizationId: "org-1", platform: "meta", appId: "own-app", encryptedSecret: encryptJson({ appSecret: "own-secret" }), status: "verified" },
    });
    await seedMessaging(tables, { appSource: "own" });
    const out = await healing.autoHealMetaTokens("org-1", NOW);
    expect(out.healed).toBe(1);
    expect(exchangeCalls).toEqual([{ appId: "own-app", appSecret: "own-secret", currentToken: "OLD-TOKEN" }]);
  });

  it("own-app target whose own config was deleted: honest skip — no attempt, no platform fallback, credential untouched, skip counted", async () => {
    setPlatformMeta({ appId: "plat-app", appSecret: "plat-secret" });
    const { tables, healing, auditRows, exchangeCalls } = build();
    const integration = await seedMessaging(tables, { appSource: "own" });
    const before = tables.integrationCredential.rows[0].encryptedData;
    const out = await healing.autoHealMetaTokens("org-1", NOW);
    expect(out.attempted).toBe(0);
    expect(out.skippedNoAppCredentials).toBe(1);
    expect(out.results[0].outcome).toBe("skipped_no_app_credentials");
    expect(exchangeCalls).toEqual([]);
    expect(tables.integrationCredential.rows[0].encryptedData).toBe(before);
    expect(auditRows.filter((r) => r.action === META_TOKEN_ATTEMPT_ACTION)).toHaveLength(0);
    void integration;
  });

  it("platform-app target with NO platform app configured: honest skip, counted, nothing changes", async () => {
    setPlatformMeta(null);
    const { tables, healing, exchangeCalls } = build();
    await seedMessaging(tables);
    const before = tables.integrationCredential.rows[0].encryptedData;
    const out = await healing.autoHealMetaTokens("org-1", NOW);
    expect(out.skippedNoAppCredentials).toBe(1);
    expect(out.attempted).toBe(0);
    expect(exchangeCalls).toEqual([]);
    expect(tables.integrationCredential.rows[0].encryptedData).toBe(before);
  });

  it("social account (meta_page): heals through the linked integration's credential; expiresAt rotates in the OAuth credential shape", async () => {
    setPlatformMeta({ appId: "plat-app", appSecret: "plat-secret" });
    const { tables, healing, auditRows, exchangeCalls } = build();
    const { integration, account } = await seedSocialPage(tables);
    const out = await healing.autoHealMetaTokens("org-1", NOW);
    expect(out.healed).toBe(1);
    expect(exchangeCalls[0].currentToken).toBe("OLD-PAGE-TOKEN");
    const cred = decryptJson<any>(tables.integrationCredential.rows.find((c: any) => c.integrationId === integration.id).encryptedData);
    expect(cred.accessToken).toBe("NEW-TOKEN");
    expect(cred.pageId).toBe("page-1");
    expect(cred.expiresAt).toBe(NOW.getTime() + 60 * DAY);
    // Audit rows land on the SocialAccount (the CC13 timeline
    // identity for this target), not on the integration.
    expect(auditRows.some((r) => r.action === META_TOKEN_ATTEMPT_ACTION && r.entityType === "SocialAccount" && r.entityId === account.id)).toBe(true);
    expect(auditRows.some((r) => r.action === META_TOKEN_RESULT_ACTION && r.entityType === "SocialAccount" && r.entityId === account.id)).toBe(true);
  });

  it("exchange failure: credential stays BYTE-IDENTICAL, expiry untouched, failure recorded verbatim, nothing throws", async () => {
    setPlatformMeta({ appId: "plat-app", appSecret: "plat-secret" });
    const { tables, healing, auditRows } = build(async () => { throw new Error("Error validating access token: The session has been invalidated"); });
    const integration = await seedMessaging(tables);
    const before = tables.integrationCredential.rows[0].encryptedData;
    const out = await healing.autoHealMetaTokens("org-1", NOW);
    expect(out.attempted).toBe(1);
    expect(out.healed).toBe(0);
    expect(out.results[0].outcome).toBe("error");
    expect(out.results[0].detail).toContain("session has been invalidated");
    expect(tables.integrationCredential.rows[0].encryptedData).toBe(before);
    const row = tables.integration.rows.find((r: any) => r.id === integration.id);
    expect(new Date(row.tokenExpiresAt).getTime()).toBe(NOW.getTime() + 2 * DAY);
    const result = auditRows.find((r) => r.action === META_TOKEN_RESULT_ACTION);
    expect(result?.metadata?.outcome).toBe("error");
    expect(String(result?.metadata?.detail)).toContain("session has been invalidated");
  });

  it("just-expired token IS attempted — the exchange itself arbitrates (here it refuses, recorded as error)", async () => {
    setPlatformMeta({ appId: "plat-app", appSecret: "plat-secret" });
    const { tables, healing, exchangeCalls } = build(async () => { throw new Error("token expired"); });
    await seedMessaging(tables, { tokenExpiresAt: new Date(NOW.getTime() - 60 * 1000) });
    const out = await healing.autoHealMetaTokens("org-1", NOW);
    expect(exchangeCalls).toHaveLength(1);
    expect(out.results[0].outcome).toBe("error");
  });

  it("cap: one recorded attempt today blocks a second pass; the cap constant is 1/day", async () => {
    setPlatformMeta({ appId: "plat-app", appSecret: "plat-secret" });
    const { tables, healing, exchangeCalls } = build(async () => { throw new Error("still dead"); });
    await seedMessaging(tables);
    const first = await healing.autoHealMetaTokens("org-1", NOW);
    expect(first.attempted).toBe(1);
    const second = await healing.autoHealMetaTokens("org-1", NOW);
    expect(second.attempted).toBe(0);
    expect(second.results[0].outcome).toBe("skipped_daily_cap");
    expect(exchangeCalls).toHaveLength(1);
    expect(META_TOKEN_HEAL_MAX_ATTEMPTS_PER_DAY).toBe(1);
  });

  it("opt-out: autoHealEnabled=false skips a messaging target AND a social account (via its linked integration)", async () => {
    setPlatformMeta({ appId: "plat-app", appSecret: "plat-secret" });
    const { tables, healing, exchangeCalls } = build();
    await seedMessaging(tables, { autoHealEnabled: false });
    await seedSocialPage(tables, { autoHealEnabled: false });
    const out = await healing.autoHealMetaTokens("org-1", NOW);
    expect(exchangeCalls).toEqual([]);
    expect(out.attempted).toBe(0);
    expect(out.results.map((r) => r.outcome)).toEqual(["skipped_opt_out", "skipped_opt_out"]);
  });

  it("never attempted: non-Meta providers, healthy-window Meta tokens, tokens with no stored expiry, disconnected rows", async () => {
    setPlatformMeta({ appId: "plat-app", appSecret: "plat-secret" });
    const { tables, healing, exchangeCalls } = build();
    // TikTok social account in-window — not Meta, never attempted.
    const tk = await tables.integration.create({ data: { organizationId: "org-1", provider: "tiktok", status: "CONNECTED", externalAccountId: "tk-1", appSource: "platform", autoHealEnabled: true, tokenExpiresAt: null } });
    await tables.integrationCredential.create({ data: { integrationId: tk.id, encryptedData: encryptJson({ accessToken: "TK", refreshToken: "RT", expiresAt: NOW.getTime() + DAY }) } });
    await tables.socialAccount.create({ data: { organizationId: "org-1", platform: "tiktok", externalId: "tk-1", name: "TK", status: "connected", integrationId: tk.id, appSource: "platform" } });
    // WhatsApp with a healthy 30-day expiry — outside the window.
    await seedMessaging(tables, { externalAccountId: "8802" }, {});
    tables.integration.rows[tables.integration.rows.length - 1].tokenExpiresAt = new Date(NOW.getTime() + 30 * DAY);
    // Messenger with NO stored expiry anywhere — never attempted.
    const msgr = await tables.integration.create({ data: { organizationId: "org-1", provider: "messenger", status: "CONNECTED", externalAccountId: "pg-9", appSource: "platform", autoHealEnabled: true, tokenExpiresAt: null } });
    await tables.integrationCredential.create({ data: { integrationId: msgr.id, encryptedData: encryptJson({ accessToken: "M", appSecret: "s", verifyToken: "v", pageId: "pg-9" }) } });
    // WhatsApp in-window but DISCONNECTED — not a target.
    await seedMessaging(tables, { externalAccountId: "8803", status: "DISCONNECTED" });
    const out = await healing.autoHealMetaTokens("org-1", NOW);
    expect(exchangeCalls).toEqual([]);
    expect(out.attempted).toBe(0);
    expect(out.results).toEqual([]);
  });

  it("Page + Instagram accounts sharing ONE integration: a single exchange heals the shared token; the sibling is reported, not re-attempted", async () => {
    setPlatformMeta({ appId: "plat-app", appSecret: "plat-secret" });
    const { tables, healing, exchangeCalls } = build();
    const { integration, account } = await seedSocialPage(tables);
    const ig = await tables.socialAccount.create({
      data: { organizationId: "org-1", platform: "instagram", externalId: "ig-1", name: "IG", status: "connected", integrationId: integration.id, appSource: "platform" },
    });
    const out = await healing.autoHealMetaTokens("org-1", NOW);
    expect(exchangeCalls).toHaveLength(1);
    expect(out.healed).toBe(1);
    const byTarget = new Map(out.results.map((r) => [r.targetId, r.outcome]));
    expect(byTarget.get(account.id)).toBe("healed");
    expect(byTarget.get(ig.id)).toBe("skipped_no_longer_expiring");
  });
});
