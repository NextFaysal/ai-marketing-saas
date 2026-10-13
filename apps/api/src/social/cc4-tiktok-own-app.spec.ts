process.env.ENCRYPTION_KEY = Buffer.alloc(32, 7).toString("base64");
process.env.JWT_SECRET = "test-secret";

import { SocialOAuthService, OWN_TIKTOK_NOT_CONFIGURED_MSG } from "./social-oauth.service";
import { encryptJson } from "../integrations/crypto";
import { setPlatformConfigSnapshot } from "../common/platform-config";

/**
 * CC4 — TikTok OAuth through the tenant's OWN app (CC3 config):
 * - connect-url with appSource "own" and no config → the honest
 *   Bengali 400, no state minted.
 * - With a config, the authorize URL carries the TENANT client
 *   key (not the platform's), and the choice is bound into the
 *   OAuth state's payload.
 * - The callback exchanges the code with the SAME (tenant) app
 *   credentials, and the created SocialAccount + Integration
 *   carry appSource "own".
 * - Token refresh for an own-app account uses the tenant app's
 *   credentials, never the platform's.
 * - The platform default path is byte-for-byte the SP8 behaviour
 *   (account lands as appSource "platform").
 * Fake Prisma + stub TikTokClient, the SP8 spec's harness shape.
 */

const ORG = "org-1";
const ACTOR = "owner-1";

const SAVED_ENV = { ...process.env };
beforeAll(() => {
  delete process.env.TIKTOK_CLIENT_KEY;
  delete process.env.TIKTOK_CLIENT_SECRET;
  delete process.env.TIKTOK_REDIRECT_URI;
  delete process.env.TIKTOK_APP_AUDITED;
});
afterAll(() => { process.env = { ...SAVED_ENV }; });
beforeEach(() => {
  setPlatformConfigSnapshot({
    llm: null, metaApp: null, smtp: null, sms: null, loadedAt: Date.now(),
    tiktokApp: { clientKey: "platform-tt-key", clientSecret: "platform-tt-secret", audited: false },
    googleApp: null,
  } as any);
});

type Row = Record<string, any>;

function matches(row: Row, where: any): boolean {
  return Object.entries(where ?? {}).every(([k, v]) => {
    if (v === undefined) return true;
    if (v === null) return row[k] === null || row[k] === undefined;
    if (v && typeof v === "object" && !(v instanceof Date)) {
      if ("in" in v) return (v as any).in.includes(row[k]);
      if ("gt" in v) return row[k] != null && new Date(row[k]).getTime() > new Date((v as any).gt).getTime();
      return true;
    }
    return row[k] === v;
  });
}

function table(store: Row[]) {
  return {
    findMany: jest.fn(async (args: any = {}) => store.filter((r) => matches(r, args.where)).map((r) => ({ ...r }))),
    findFirst: jest.fn(async (args: any = {}) => {
      const row = store.find((r) => matches(r, args.where));
      return row ? { ...row } : null;
    }),
    create: jest.fn(async ({ data }: any) => {
      const row = { id: data.id ?? `row-${store.length + 1}-${Math.random().toString(36).slice(2, 7)}`, createdAt: new Date(), updatedAt: new Date(), ...data };
      store.push(row);
      return { ...row };
    }),
    update: jest.fn(async ({ where, data }: any) => {
      const row = store.find((r) => matches(r, where));
      if (row) Object.assign(row, data, { updatedAt: new Date() });
      return row ? { ...row } : null;
    }),
    updateMany: jest.fn(async ({ where, data }: any) => {
      let count = 0;
      for (const row of store) if (matches(row, where)) { Object.assign(row, data); count++; }
      return { count };
    }),
    deleteMany: jest.fn(async ({ where }: any = {}) => {
      const before = store.length;
      for (let i = store.length - 1; i >= 0; i--) if (matches(store[i], where)) store.splice(i, 1);
      return { count: before - store.length };
    }),
    upsert: jest.fn(async ({ where, update, create }: any) => {
      const key = where.organizationId_platform_externalId;
      const existing = key
        ? store.find((r) => r.organizationId === key.organizationId && r.platform === key.platform && r.externalId === key.externalId)
        : store.find((r) => matches(r, where));
      if (existing) {
        Object.assign(existing, Object.fromEntries(Object.entries(update).filter(([, v]) => v !== undefined)), { updatedAt: new Date() });
        return { ...existing };
      }
      const row = { id: `row-${store.length + 1}-${Math.random().toString(36).slice(2, 7)}`, createdAt: new Date(), updatedAt: new Date(), ...create };
      store.push(row);
      return { ...row };
    }),
  };
}

function fakeDb(withOwnTiktok = false) {
  const db: any = {
    socialAccounts: [] as Row[], integrations: [] as Row[], credentials: [] as Row[],
    oauthStates: [] as Row[], appConfigs: [] as Row[], auditRows: [] as Row[], settings: [] as Row[],
  };
  db.socialAccount = table(db.socialAccounts);
  db.socialOAuthState = table(db.oauthStates);
  db.integrationCredential = {
    ...table(db.credentials),
    update: jest.fn(async ({ where, data }: any) => {
      const row = db.credentials.find((c: Row) => c.integrationId === where.integrationId);
      if (row) Object.assign(row, data);
      return row ?? null;
    }),
  };
  db.integration = {
    ...table(db.integrations),
    findFirst: jest.fn(async (args: any = {}) => {
      const row = db.integrations.find((r: Row) => matches(r, args.where));
      if (!row) return null;
      const out: Row = { ...row };
      if (args.include?.credential) {
        const cred = db.credentials.find((c: Row) => c.integrationId === row.id);
        out.credential = cred ? { ...cred } : null;
      }
      return out;
    }),
    findUnique: jest.fn(async (args: any = {}) => {
      const row = db.integrations.find((r: Row) => matches(r, args.where));
      if (!row) return null;
      const out: Row = { ...row };
      if (args.include?.credential) {
        const cred = db.credentials.find((c: Row) => c.integrationId === row.id);
        out.credential = cred ? { ...cred } : null;
      }
      return out;
    }),
  };
  db.tenantAppConfig = table(db.appConfigs);
  db.systemSetting = {
    findUnique: jest.fn(async ({ where }: any) => db.settings.find((s: Row) => s.key === where.key) ?? null),
  };
  if (withOwnTiktok) {
    db.appConfigs.push({
      id: "cfg-tt", organizationId: ORG, platform: "tiktok", appId: "own-tt-key",
      encryptedSecret: encryptJson({ appSecret: "own-tt-secret" }),
      status: "configured", lastVerifiedAt: null, createdAt: new Date(), updatedAt: new Date(),
    });
  }
  return db;
}

function stubTikTokClient(overrides: Record<string, any> = {}) {
  return {
    exchangeCode: jest.fn(async () => ({
      accessToken: "tt-access-1", refreshToken: "tt-refresh-1",
      expiresAt: Date.now() + 3600_000, refreshExpiresAt: Date.now() + 86400_000,
      openId: "open-123", scope: "user.info.basic,video.upload",
    })),
    refreshAccessToken: jest.fn(async () => ({
      accessToken: "tt-access-2", refreshToken: "tt-refresh-2",
      expiresAt: Date.now() + 3600_000, openId: "open-123",
    })),
    getUserInfo: jest.fn(async () => ({ openId: "open-123", displayName: "Dhaka Shop", avatarUrl: null })),
    ...overrides,
  };
}

function build(db: any, client: any) {
  const audit = { log: jest.fn(async (input: any) => { db.auditRows.push(input); }) };
  return new SocialOAuthService(db as any, audit as any, client as any);
}

describe("CC4 TikTok own-app OAuth", () => {
  it("own + no config → honest 400, no state minted", async () => {
    const db = fakeDb(false);
    const oauth = build(db, stubTikTokClient());
    await expect(oauth.tiktokConnectUrl(ORG, ACTOR, "own")).rejects.toThrow(OWN_TIKTOK_NOT_CONFIGURED_MSG);
    expect(db.oauthStates).toHaveLength(0);
  });

  it("own authorize URL uses the TENANT client key and binds appSource into the state", async () => {
    const db = fakeDb(true);
    const oauth = build(db, stubTikTokClient());
    const { url } = await oauth.tiktokConnectUrl(ORG, ACTOR, "own");
    expect(url).toContain("client_key=own-tt-key");
    expect(url).not.toContain("platform-tt-key");
    expect(url).toContain("scope=user.info.basic%2Cvideo.upload");
    expect(db.oauthStates).toHaveLength(1);
    expect(db.oauthStates[0].payload).toEqual({ appSource: "own" });
    expect(db.oauthStates[0]).toMatchObject({ organizationId: ORG, userId: ACTOR, platform: "tiktok", purpose: "connect" });
  });

  it("callback exchanges with the TENANT app credentials and lands appSource 'own' on account + integration", async () => {
    const db = fakeDb(true);
    const client = stubTikTokClient();
    const oauth = build(db, client);
    const { url } = await oauth.tiktokConnectUrl(ORG, ACTOR, "own");
    const state = new URL(url).searchParams.get("state")!;

    const redirect = await oauth.handleTikTokCallback({ code: "auth-code-1", state });
    expect(redirect).toContain("social_connected=tiktok");
    expect(client.exchangeCode).toHaveBeenCalledTimes(1);
    const credsArg = (client.exchangeCode as jest.Mock).mock.calls[0][0];
    expect(credsArg).toMatchObject({ clientKey: "own-tt-key", clientSecret: "own-tt-secret" });

    expect(db.socialAccounts).toHaveLength(1);
    expect(db.socialAccounts[0]).toMatchObject({ platform: "tiktok", externalId: "open-123", status: "connected", appSource: "own" });
    const integration = db.integrations.find((i: Row) => i.id === db.socialAccounts[0].integrationId);
    expect(integration).toMatchObject({ provider: "tiktok_social", appSource: "own", status: "CONNECTED" });
    expect(db.auditRows[0].metadata).toMatchObject({ platform: "tiktok", via: "oauth", appSource: "own" });
  });

  it("own config deleted between start and callback → honest social_error, no account", async () => {
    const db = fakeDb(true);
    const client = stubTikTokClient();
    const oauth = build(db, client);
    const { url } = await oauth.tiktokConnectUrl(ORG, ACTOR, "own");
    const state = new URL(url).searchParams.get("state")!;
    db.appConfigs.splice(0, db.appConfigs.length);

    const redirect = await oauth.handleTikTokCallback({ code: "auth-code-1", state });
    expect(decodeURIComponent(redirect).replace(/\+/g, " ")).toContain("নিজের TikTok অ্যাপের কনফিগ পাওয়া যাচ্ছে না");
    expect(client.exchangeCode).not.toHaveBeenCalled();
    expect(db.socialAccounts).toHaveLength(0);
  });

  it("platform default is unchanged: platform key in the URL, account lands as appSource 'platform'", async () => {
    const db = fakeDb(true); // own config exists but is NOT chosen
    const client = stubTikTokClient();
    const oauth = build(db, client);
    const { url } = await oauth.tiktokConnectUrl(ORG, ACTOR);
    expect(url).toContain("client_key=platform-tt-key");
    const state = new URL(url).searchParams.get("state")!;
    const redirect = await oauth.handleTikTokCallback({ code: "auth-code-1", state });
    expect(redirect).toContain("social_connected=tiktok");
    const credsArg = (client.exchangeCode as jest.Mock).mock.calls[0][0];
    expect(credsArg).toMatchObject({ clientKey: "platform-tt-key", clientSecret: "platform-tt-secret" });
    expect(db.socialAccounts[0]).toMatchObject({ appSource: "platform" });
  });

  it("token refresh for an own-app account uses the TENANT app's credentials", async () => {
    const db = fakeDb(true);
    const client = stubTikTokClient();
    const oauth = build(db, client);
    // Seed an own-app account whose access token is already expired.
    db.integrations.push({ id: "int-own", organizationId: ORG, provider: "tiktok_social", status: "CONNECTED", externalAccountId: "open-123", appSource: "own", createdAt: new Date(), updatedAt: new Date() });
    db.credentials.push({
      id: "cred-own", integrationId: "int-own",
      encryptedData: encryptJson({ accessToken: "old-token", refreshToken: "old-refresh", expiresAt: Date.now() - 1000 }),
      createdAt: new Date(), updatedAt: new Date(),
    });
    const account = { id: "acc-own", organizationId: ORG, platform: "tiktok", integrationId: "int-own", appSource: "own" };
    const fresh = await oauth.ensureAccessToken(ORG, account);
    expect(fresh).toBe("tt-access-2");
    expect(client.refreshAccessToken).toHaveBeenCalledTimes(1);
    const credsArg = (client.refreshAccessToken as jest.Mock).mock.calls[0][0];
    expect(credsArg).toMatchObject({ clientKey: "own-tt-key", clientSecret: "own-tt-secret" });
  });

  it("an invalid appSource is refused at connect-url", async () => {
    const db = fakeDb(true);
    const oauth = build(db, stubTikTokClient());
    await expect(oauth.tiktokConnectUrl(ORG, ACTOR, "bogus")).rejects.toThrow(/appSource/);
    expect(db.oauthStates).toHaveLength(0);
  });
});
