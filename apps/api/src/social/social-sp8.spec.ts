import { SocialService } from "./social.service";
import { SocialPublishService } from "./social-publish.service";
import { SocialOAuthService, TIKTOK_NOT_CONFIGURED_MSG } from "./social-oauth.service";
import { TikTokClient, TikTokPublisher } from "./tiktok.client";
import { AdminService } from "../admin/admin.service";
import { decryptJson, encryptJson } from "../integrations/crypto";
import {
  effectiveGoogleAppConfig, effectiveTiktokAppConfig, setPlatformConfigSnapshot,
} from "../common/platform-config";

/**
 * SP8 — TikTok (operator-app OAuth + inbox upload), proven at
 * the client boundary with a stub fetch + fake Prisma (the SP6
 * pattern):
 * - Platform config: tiktokApp/googleApp snapshot + env
 *   resolution (key-without-secret = NOT configured), admin PATCH
 *   areas seal secrets and never echo them in the safe view.
 * - Connect: not configured → the honest Bengali 400; configured
 *   → authorize URL (upload-only scopes by default, video.publish
 *   only when the operator declared the app audited) + a state
 *   row binding org/user/platform.
 * - Callback: platform error / missing params / unknown /
 *   expired / REPLAYED state → social_error redirects; a happy
 *   exchange creates the Integration + sealed credential +
 *   connected SocialAccount (audit metadata carries NO tokens).
 * - Publish: exactly-one-video gate (image or multi → permanent,
 *   attempts stay 0); inbox success → status sent_to_creator with
 *   publishedAt NULL + the finish-in-app note; audited direct
 *   success → published with the creator_info privacy level in
 *   the note; TikTok FAILED status → verbatim fail_reason through
 *   the SP5 retry path.
 * - Token refresh: inside the skew window the shared resolver
 *   refreshes + re-seals (rotated refresh token persisted); a
 *   failed refresh marks the account "error" with the verbatim
 *   message and fails permanently.
 * - Schedule gate: a TikTok post without exactly one video is a
 *   Bengali 400 at schedule time.
 *
 * Evidence ceiling: no real TikTok app exists in this sandbox —
 * these specs prove request shapes, state handling and status
 * semantics, never a real TikTok round-trip.
 */
const ORG = "org-1";
const ACTOR = "owner-1";

const SAVED_ENV = { ...process.env };
beforeAll(() => {
  delete process.env.API_PUBLIC_URL;
  delete process.env.WEB_URL;
  delete process.env.TIKTOK_CLIENT_KEY;
  delete process.env.TIKTOK_CLIENT_SECRET;
  delete process.env.TIKTOK_REDIRECT_URI;
  delete process.env.TIKTOK_APP_AUDITED;
  delete process.env.GOOGLE_CLIENT_ID;
  delete process.env.GOOGLE_CLIENT_SECRET;
});
afterAll(() => { process.env = { ...SAVED_ENV }; });
beforeEach(() => {
  setPlatformConfigSnapshot({
    llm: null, metaApp: null, smtp: null, sms: null, loadedAt: Date.now(),
    tiktokApp: { clientKey: "tt-key", clientSecret: "tt-secret", audited: false },
    googleApp: null,
  } as any);
});

type Row = Record<string, any>;

function matches(row: Row, where: any): boolean {
  return Object.entries(where ?? {}).every(([k, v]) => {
    if (v === null) return row[k] === null || row[k] === undefined;
    if (v && typeof v === "object" && !(v instanceof Date)) {
      if ("in" in v) return (v as any).in.includes(row[k]);
      if ("lte" in v) return row[k] != null && new Date(row[k]).getTime() <= new Date((v as any).lte).getTime();
      if ("lt" in v) return row[k] != null && new Date(row[k]).getTime() < new Date((v as any).lt).getTime();
      if ("gte" in v) return row[k] != null && new Date(row[k]).getTime() >= new Date((v as any).gte).getTime();
      if ("gt" in v) return row[k] != null && new Date(row[k]).getTime() > new Date((v as any).gt).getTime();
      return true;
    }
    return row[k] === v;
  });
}

function table(store: Row[]) {
  return {
    findMany: jest.fn(async (args: any = {}) => {
      let rows = store.filter((r) => matches(r, args.where));
      if (args.orderBy?.createdAt === "asc") rows = [...rows].sort((a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime());
      if (args.orderBy?.createdAt === "desc") rows = [...rows].sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
      if (args.take) rows = rows.slice(0, args.take);
      return rows.map((r) => ({ ...r }));
    }),
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
      for (const row of store) {
        if (matches(row, where)) { Object.assign(row, data, { updatedAt: new Date() }); count++; }
      }
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

let seq = 0;
function fakeDb() {
  const db: any = {
    socialAccounts: [] as Row[], socialPosts: [] as Row[], mediaAssets: [] as Row[],
    integrations: [] as Row[], credentials: [] as Row[], oauthStates: [] as Row[],
    memberships: [] as Row[], notifications: [] as Row[], auditRows: [] as Row[],
    settings: [] as Row[],
  };
  db.socialAccount = table(db.socialAccounts);
  db.mediaAsset = table(db.mediaAssets);
  db.membership = table(db.memberships);
  db.socialOAuthState = table(db.oauthStates);
  db.integrationCredential = table(db.credentials);
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
  };
  db.agentNotification = {
    create: jest.fn(async ({ data }: any) => {
      const row = { id: `notif-${++seq}`, createdAt: new Date(), ...data };
      db.notifications.push(row);
      return { ...row };
    }),
  };
  db.socialPost = {
    ...table(db.socialPosts),
    create: jest.fn(async ({ data }: any) => {
      const row = {
        id: `post-${++seq}`, createdAt: new Date(), updatedAt: new Date(),
        linkUrl: null, scheduledAt: null, publishedAt: null, platformPostId: null,
        platformUrl: null, publishNote: null, error: null, attempts: 0, mediaRefs: [], ...data,
      };
      db.socialPosts.push(row);
      return { ...row };
    }),
  };
  db.systemSetting = {
    findUnique: jest.fn(async ({ where }: any) => db.settings.find((s: Row) => s.key === where.key) ?? null),
    upsert: jest.fn(async ({ where, create, update }: any) => {
      const existing = db.settings.find((s: Row) => s.key === where.key);
      if (existing) { Object.assign(existing, update); return { ...existing }; }
      const row = { ...create };
      db.settings.push(row);
      return { ...row };
    }),
    deleteMany: jest.fn(async ({ where }: any) => {
      const before = db.settings.length;
      for (let i = db.settings.length - 1; i >= 0; i--) if (db.settings[i].key === where.key) db.settings.splice(i, 1);
      return { count: before - db.settings.length };
    }),
  };
  return db;
}

function mkAudit(db: any) {
  return { log: jest.fn(async (input: any) => { db.auditRows.push({ id: `audit-${db.auditRows.length + 1}`, createdAt: new Date(), ...input }); }) };
}

/** A stub TikTokClient with the full happy path; tests override
 * individual methods to force failures. */
function stubTikTokClient(overrides: Partial<Record<string, any>> = {}) {
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
    queryCreatorInfo: jest.fn(async () => ({ privacyLevelOptions: ["PUBLIC_TO_EVERYONE", "SELF_ONLY"] })),
    inboxInit: jest.fn(async () => "pub-1"),
    directInit: jest.fn(async () => "pub-2"),
    fetchStatus: jest.fn(async () => ({ status: "SEND_TO_USER_INBOX" })),
    ...overrides,
  };
}

function seedTiktokAccount(db: any, cred: Record<string, any> = {}) {
  const integration = { id: "int-tt-1", organizationId: ORG, provider: "tiktok_social", status: "CONNECTED", externalAccountId: "open-123", createdAt: new Date(), updatedAt: new Date() };
  db.integrations.push(integration);
  db.credentials.push({
    id: "cred-tt-1", integrationId: "int-tt-1",
    encryptedData: encryptJson({
      accessToken: "tt-access-1", refreshToken: "tt-refresh-1",
      expiresAt: Date.now() + 3600_000, scope: "user.info.basic,video.upload", openId: "open-123", ...cred,
    }),
    createdAt: new Date(), updatedAt: new Date(),
  });
  const account = {
    id: "acct-tt-1", organizationId: ORG, integrationId: "int-tt-1", platform: "tiktok",
    externalId: "open-123", name: "Dhaka Shop", username: null, pictureUrl: null,
    status: "connected", lastError: null, createdById: ACTOR, createdAt: new Date(), updatedAt: new Date(),
  };
  db.socialAccounts.push(account);
  return account;
}

function seedVideoPost(db: any, accountId: string, refs: any[] = [{ assetId: "asset-vid-1", kind: "video" }]) {
  const asset = {
    id: "asset-vid-1", organizationId: ORG, kind: "video", name: "promo.mp4",
    contentType: "video/mp4", sizeBytes: 1000, storageKey: `${ORG}/social/asset-vid-1.mp4`,
    publicToken: "tok-public-1", origin: "upload", createdById: ACTOR, createdAt: new Date(), updatedAt: new Date(),
  };
  if (!db.mediaAssets.some((a: Row) => a.id === asset.id)) db.mediaAssets.push(asset);
  const post = {
    id: "post-tt-1", organizationId: ORG, socialAccountId: accountId, caption: "নতুন অফার!",
    linkUrl: null, mediaRefs: refs, status: "draft", scheduledAt: null, publishedAt: null,
    platformPostId: null, platformUrl: null, publishNote: null, error: null, attempts: 0,
    approvalStatus: null, createdById: ACTOR, createdAt: new Date(), updatedAt: new Date(),
  };
  db.socialPosts.push(post);
  return post;
}

/** Publish service wired with a stub OAuth token path (returns a
 * fixed fresh token) and a REAL TikTokPublisher over the stub
 * client, so dispatch + orchestration are both exercised. */
function publishServices(db: any, clientOverrides: Record<string, any> = {}) {
  const audit = mkAudit(db);
  const social = new SocialService(db as any, audit as any);
  const client = stubTikTokClient(clientOverrides);
  const oauth = new SocialOAuthService(db as any, audit as any, client as any);
  const publisher = new TikTokPublisher(client as any, { pollIntervalMs: 0, maxPolls: 5, sleep: async () => {} });
  const publish = new SocialPublishService(db as any, audit as any, social, undefined, oauth, publisher);
  return { audit, social, oauth, publish, client };
}

// ---------------------------------------------------------------------------

describe("SP8 platform config resolution", () => {
  it("admin snapshot wins; a key without a secret is NOT configured", () => {
    expect(effectiveTiktokAppConfig()?.clientKey).toBe("tt-key");
    setPlatformConfigSnapshot({
      llm: null, metaApp: null, smtp: null, sms: null, loadedAt: Date.now(),
      tiktokApp: { clientKey: "tt-key", clientSecret: "", audited: false }, googleApp: null,
    } as any);
    expect(effectiveTiktokAppConfig()).toBeNull();
  });

  it("env fallback applies when no admin config exists", () => {
    setPlatformConfigSnapshot({ llm: null, metaApp: null, smtp: null, sms: null, loadedAt: Date.now(), tiktokApp: null, googleApp: null } as any);
    process.env.TIKTOK_CLIENT_KEY = "env-key";
    process.env.TIKTOK_CLIENT_SECRET = "env-secret";
    const cfg = effectiveTiktokAppConfig();
    expect(cfg?.source).toBe("env");
    expect(cfg?.clientKey).toBe("env-key");
    expect(effectiveGoogleAppConfig()).toBeNull();
    delete process.env.TIKTOK_CLIENT_KEY;
    delete process.env.TIKTOK_CLIENT_SECRET;
  });

  it("admin PATCH seals the TikTok secret; the safe view never echoes it", async () => {
    const db = fakeDb();
    const admin = new AdminService(db as any, mkAudit(db) as any);
    const view = await admin.updatePlatformConfig({ id: "super-1" }, "tiktok", {
      clientKey: "key-abc", clientSecret: "super-secret-value", audited: true,
    });
    const stored = db.settings.find((s: Row) => s.key === "tiktokAppConfig");
    expect(stored.value.clientKey).toBe("key-abc");
    expect(stored.value.audited).toBe(true);
    expect(JSON.stringify(stored.value)).not.toContain("super-secret-value");
    expect(decryptJson<any>(stored.value.clientSecretEncrypted).v).toBe("super-secret-value");
    expect(view.tiktokApp.secretConfigured).toBe(true);
    expect(JSON.stringify(view)).not.toContain("super-secret-value");
    // The refreshed snapshot now serves the config to the resolvers.
    expect(effectiveTiktokAppConfig()?.audited).toBe(true);
  });
});

describe("SP8 TikTok connect URL", () => {
  it("not configured → the honest Bengali 400, no state row", async () => {
    setPlatformConfigSnapshot({ llm: null, metaApp: null, smtp: null, sms: null, loadedAt: Date.now(), tiktokApp: null, googleApp: null } as any);
    const db = fakeDb();
    const oauth = new SocialOAuthService(db as any, mkAudit(db) as any, stubTikTokClient() as any);
    await expect(oauth.tiktokConnectUrl(ORG, ACTOR)).rejects.toThrow(TIKTOK_NOT_CONFIGURED_MSG);
    expect(db.oauthStates).toHaveLength(0);
  });

  it("configured → authorize URL with upload-only scopes + a bound state row", async () => {
    const db = fakeDb();
    const oauth = new SocialOAuthService(db as any, mkAudit(db) as any, stubTikTokClient() as any);
    const { url } = await oauth.tiktokConnectUrl(ORG, ACTOR);
    const parsed = new URL(url);
    expect(parsed.origin + parsed.pathname).toBe("https://www.tiktok.com/v2/auth/authorize/");
    expect(parsed.searchParams.get("client_key")).toBe("tt-key");
    expect(parsed.searchParams.get("scope")).toBe("user.info.basic,video.upload");
    const state = parsed.searchParams.get("state")!;
    const row = db.oauthStates.find((s: Row) => s.id === state);
    expect(row).toMatchObject({ organizationId: ORG, userId: ACTOR, platform: "tiktok", purpose: "connect" });
    expect(row.consumedAt ?? null).toBeNull();
    expect(new Date(row.expiresAt).getTime()).toBeGreaterThan(Date.now());
  });

  it("audited app → video.publish joins the scopes", async () => {
    setPlatformConfigSnapshot({
      llm: null, metaApp: null, smtp: null, sms: null, loadedAt: Date.now(),
      tiktokApp: { clientKey: "tt-key", clientSecret: "tt-secret", audited: true }, googleApp: null,
    } as any);
    const db = fakeDb();
    const oauth = new SocialOAuthService(db as any, mkAudit(db) as any, stubTikTokClient() as any);
    const { url } = await oauth.tiktokConnectUrl(ORG, ACTOR);
    expect(new URL(url).searchParams.get("scope")).toBe("user.info.basic,video.upload,video.publish");
  });
});

describe("SP8 TikTok callback", () => {
  async function connectState(db: any, oauth: SocialOAuthService) {
    const { url } = await oauth.tiktokConnectUrl(ORG, ACTOR);
    return new URL(url).searchParams.get("state")!;
  }

  it("platform error param → social_error redirect, nothing stored", async () => {
    const db = fakeDb();
    const oauth = new SocialOAuthService(db as any, mkAudit(db) as any, stubTikTokClient() as any);
    const redirect = await oauth.handleTikTokCallback({ error: "access_denied", errorDescription: "User denied" });
    expect(redirect).toContain("social_error=");
    expect(db.socialAccounts).toHaveLength(0);
  });

  it("happy path: account + sealed credential created, redirect confirms, audit carries no tokens", async () => {
    const db = fakeDb();
    const client = stubTikTokClient();
    const oauth = new SocialOAuthService(db as any, mkAudit(db) as any, client as any);
    const state = await connectState(db, oauth);
    const redirect = await oauth.handleTikTokCallback({ code: "code-1", state });
    expect(redirect).toContain("social_connected=tiktok");
    const account = db.socialAccounts.find((a: Row) => a.platform === "tiktok");
    expect(account).toMatchObject({ externalId: "open-123", name: "Dhaka Shop", status: "connected" });
    const integration = db.integrations.find((i: Row) => i.id === account.integrationId);
    expect(integration.provider).toBe("tiktok_social");
    const cred = db.credentials.find((c: Row) => c.integrationId === integration.id);
    const sealed = decryptJson<any>(cred.encryptedData);
    expect(sealed.accessToken).toBe("tt-access-1");
    expect(sealed.refreshToken).toBe("tt-refresh-1");
    expect(JSON.stringify(db.auditRows)).not.toContain("tt-access-1");
    expect(JSON.stringify(db.auditRows)).not.toContain("tt-refresh-1");
  });

  it("replayed state is rejected — the same callback cannot create a second account", async () => {
    const db = fakeDb();
    const oauth = new SocialOAuthService(db as any, mkAudit(db) as any, stubTikTokClient() as any);
    const state = await connectState(db, oauth);
    await oauth.handleTikTokCallback({ code: "code-1", state });
    const second = await oauth.handleTikTokCallback({ code: "code-1", state });
    expect(second).toContain("social_error=");
    expect(db.socialAccounts).toHaveLength(1);
    expect(db.integrations).toHaveLength(1);
  });

  it("expired state → social_error, no exchange attempted", async () => {
    const db = fakeDb();
    const client = stubTikTokClient();
    const oauth = new SocialOAuthService(db as any, mkAudit(db) as any, client as any);
    const state = await connectState(db, oauth);
    const row = db.oauthStates.find((s: Row) => s.id === state);
    row.expiresAt = new Date(Date.now() - 1000);
    const redirect = await oauth.handleTikTokCallback({ code: "code-1", state });
    expect(redirect).toContain("social_error=");
    expect(client.exchangeCode).not.toHaveBeenCalled();
    expect(db.socialAccounts).toHaveLength(0);
  });

  it("exchange failure → TikTok's verbatim message in the redirect, no account", async () => {
    const db = fakeDb();
    const client = stubTikTokClient({
      exchangeCode: jest.fn(async () => { throw new Error("The authorization code is expired"); }),
    });
    const oauth = new SocialOAuthService(db as any, mkAudit(db) as any, client as any);
    const state = await connectState(db, oauth);
    const redirect = await oauth.handleTikTokCallback({ code: "bad-code", state });
    const msg = new URL(redirect).searchParams.get("social_error")!;
    expect(msg).toContain("The authorization code is expired");
    expect(db.socialAccounts).toHaveLength(0);
  });
});

describe("SP8 TikTok publish dispatch", () => {
  it("inbox success → sent_to_creator, publishedAt NULL, publish_id + finish-in-app note stored", async () => {
    const db = fakeDb();
    const account = seedTiktokAccount(db);
    const post = seedVideoPost(db, account.id);
    const { publish, client } = publishServices(db);
    const out = await publish.publishNow(ORG, ACTOR, post.id);
    expect(out.status).toBe("sent_to_creator");
    expect(out.publishedAt).toBeNull();
    expect(out.platformPostId).toBe("pub-1");
    expect(out.publishNote).toContain("TikTok app-এ গিয়ে post সম্পূর্ণ করুন");
    expect(out.error).toBeNull();
    // PULL_FROM_URL pulled our SP1 public link (existing token reused).
    expect(client.inboxInit).toHaveBeenCalledWith("tt-access-1", "http://localhost:4000/public/media/tok-public-1");
  });

  it("image media → permanent failure, attempts stay 0, publisher never called", async () => {
    const db = fakeDb();
    const account = seedTiktokAccount(db);
    db.mediaAssets.push({
      id: "asset-img-1", organizationId: ORG, kind: "image", name: "pic.jpg", contentType: "image/jpeg",
      sizeBytes: 10, storageKey: "x", publicToken: null, origin: "upload", createdById: ACTOR, createdAt: new Date(), updatedAt: new Date(),
    });
    const post = seedVideoPost(db, account.id, [{ assetId: "asset-img-1", kind: "image" }]);
    const { publish, client } = publishServices(db);
    const out = await publish.publishNow(ORG, ACTOR, post.id);
    expect(out.status).toBe("failed");
    expect(out.attempts).toBe(0);
    expect(out.error).toContain("ঠিক একটি Video লাগবে");
    expect(client.inboxInit).not.toHaveBeenCalled();
  });

  it("two videos → permanent failure as well (exactly one)", async () => {
    const db = fakeDb();
    const account = seedTiktokAccount(db);
    const post = seedVideoPost(db, account.id, [
      { assetId: "asset-vid-1", kind: "video" }, { assetId: "asset-vid-1", kind: "video" },
    ]);
    const { publish, client } = publishServices(db);
    const out = await publish.publishNow(ORG, ACTOR, post.id);
    expect(out.status).toBe("failed");
    expect(out.attempts).toBe(0);
    expect(client.inboxInit).not.toHaveBeenCalled();
  });

  it("audited direct success → published, note names the creator_info privacy level", async () => {
    setPlatformConfigSnapshot({
      llm: null, metaApp: null, smtp: null, sms: null, loadedAt: Date.now(),
      tiktokApp: { clientKey: "tt-key", clientSecret: "tt-secret", audited: true }, googleApp: null,
    } as any);
    const db = fakeDb();
    const account = seedTiktokAccount(db);
    const post = seedVideoPost(db, account.id);
    const { publish, client } = publishServices(db, {
      fetchStatus: jest.fn(async () => ({ status: "PUBLISH_COMPLETE" })),
    });
    const out = await publish.publishNow(ORG, ACTOR, post.id);
    expect(out.status).toBe("published");
    expect(out.publishedAt).not.toBeNull();
    expect(out.platformPostId).toBe("pub-2");
    expect(out.publishNote).toContain("PUBLIC_TO_EVERYONE");
    expect(client.directInit).toHaveBeenCalledWith("tt-access-1", expect.objectContaining({ privacyLevel: "PUBLIC_TO_EVERYONE" }));
  });

  it("TikTok FAILED status → verbatim fail_reason, post goes through SP5 retry (rescheduled, attempts 1)", async () => {
    const db = fakeDb();
    const account = seedTiktokAccount(db);
    const post = seedVideoPost(db, account.id);
    post.status = "scheduled";
    (post as any).scheduledAt = new Date(Date.now() - 1000);
    const { publish } = publishServices(db, {
      fetchStatus: jest.fn(async () => ({ status: "FAILED", failReason: "Video format unsupported" })),
    });
    const counts = await publish.runDuePublishes(ORG);
    expect(counts.rescheduled).toBe(1);
    const fresh = db.socialPosts.find((p: Row) => p.id === post.id);
    expect(fresh.status).toBe("scheduled");
    expect(fresh.attempts).toBe(1);
    expect(fresh.error).toContain("Video format unsupported");
  });
});

describe("SP8 TikTok client boundary", () => {
  function jsonFetch(handler: (url: string, opts: any) => any) {
    const calls: { url: string; opts: any }[] = [];
    const fetchFn = jest.fn(async (url: string, opts: any = {}) => {
      calls.push({ url, opts });
      const body = handler(url, opts);
      return { ok: true, status: 200, json: async () => body };
    });
    return { fetchFn: fetchFn as unknown as typeof fetch, calls };
  }

  it("inbox init sends PULL_FROM_URL with our public URL; error envelope throws TikTok's verbatim message", async () => {
    const { fetchFn, calls } = jsonFetch(() => ({ error: { code: "ok" }, data: { publish_id: "pub-9" } }));
    const client = new TikTokClient(fetchFn);
    const id = await client.inboxInit("tok", "https://api.qosprey.com/public/media/xyz");
    expect(id).toBe("pub-9");
    expect(JSON.parse(calls[0].opts.body)).toEqual({
      source_info: { source: "PULL_FROM_URL", video_url: "https://api.qosprey.com/public/media/xyz" },
    });

    const failing = new TikTokClient(jsonFetch(() => ({ error: { code: "invalid_request", message: "The video URL is unreachable" } })).fetchFn);
    await expect(failing.inboxInit("tok", "https://x")).rejects.toThrow("The video URL is unreachable");
  });

  it("token exchange posts the documented form fields and maps the token set", async () => {
    const { fetchFn, calls } = jsonFetch(() => ({
      error: { code: "ok" }, access_token: "a1", refresh_token: "r1", expires_in: 3600, open_id: "o1", scope: "video.upload",
    }));
    const client = new TikTokClient(fetchFn);
    const set = await client.exchangeCode({ clientKey: "k", clientSecret: "s", redirectUri: "https://api/cb" }, "code-7");
    const form = new URLSearchParams(calls[0].opts.body);
    expect(form.get("grant_type")).toBe("authorization_code");
    expect(form.get("code")).toBe("code-7");
    expect(form.get("client_key")).toBe("k");
    expect(set.accessToken).toBe("a1");
    expect(set.refreshToken).toBe("r1");
    expect(set.expiresAt).toBeGreaterThan(Date.now());
  });
});

describe("SP8 token refresh (shared resolver)", () => {
  it("expired access token → refresh runs, rotated tokens are re-sealed", async () => {
    const db = fakeDb();
    const account = seedTiktokAccount(db, { expiresAt: Date.now() - 1000 });
    const client = stubTikTokClient();
    const oauth = new SocialOAuthService(db as any, mkAudit(db) as any, client as any);
    const token = await oauth.ensureAccessToken(ORG, account);
    expect(token).toBe("tt-access-2");
    expect(client.refreshAccessToken).toHaveBeenCalledWith(expect.objectContaining({ clientKey: "tt-key" }), "tt-refresh-1");
    const cred = db.credentials.find((c: Row) => c.integrationId === "int-tt-1");
    const sealed = decryptJson<any>(cred.encryptedData);
    expect(sealed.accessToken).toBe("tt-access-2");
    expect(sealed.refreshToken).toBe("tt-refresh-2");
  });

  it("fresh token → no refresh call", async () => {
    const db = fakeDb();
    const account = seedTiktokAccount(db);
    const client = stubTikTokClient();
    const oauth = new SocialOAuthService(db as any, mkAudit(db) as any, client as any);
    expect(await oauth.ensureAccessToken(ORG, account)).toBe("tt-access-1");
    expect(client.refreshAccessToken).not.toHaveBeenCalled();
  });

  it("failed refresh → account marked error with verbatim message + permanent failure", async () => {
    const db = fakeDb();
    const account = seedTiktokAccount(db, { expiresAt: Date.now() - 1000 });
    const client = stubTikTokClient({
      refreshAccessToken: jest.fn(async () => { throw new Error("The refresh token is invalid"); }),
    });
    const oauth = new SocialOAuthService(db as any, mkAudit(db) as any, client as any);
    await expect(oauth.ensureAccessToken(ORG, account)).rejects.toThrow("The refresh token is invalid");
    const fresh = db.socialAccounts.find((a: Row) => a.id === account.id);
    expect(fresh.status).toBe("error");
    expect(fresh.lastError).toContain("The refresh token is invalid");
  });
});

describe("SP8 schedule gate", () => {
  it("TikTok post with an image cannot be scheduled (Bengali 400); with a video it schedules", async () => {
    const db = fakeDb();
    const account = seedTiktokAccount(db);
    const social = new SocialService(db as any, mkAudit(db) as any);
    const imgPost = seedVideoPost(db, account.id, [{ assetId: "asset-img-1", kind: "image" }]);
    imgPost.id = "post-img";
    await expect(
      social.schedulePost(ORG, ACTOR, "post-img", { scheduledAt: new Date(Date.now() + 3600_000).toISOString() }),
    ).rejects.toThrow("ঠিক একটি Video লাগবে");
    const vidPost = seedVideoPost(db, account.id);
    vidPost.id = "post-vid";
    const out = await social.schedulePost(ORG, ACTOR, "post-vid", { scheduledAt: new Date(Date.now() + 3600_000).toISOString() });
    expect(out.status).toBe("scheduled");
  });
});
