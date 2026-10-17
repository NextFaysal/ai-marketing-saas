process.env.ENCRYPTION_KEY = Buffer.alloc(32, 7).toString("base64");

import { BadRequestException } from "@nestjs/common";
import { SocialService } from "./social.service";
import { SocialOAuthService, THREADS_NOT_CONFIGURED_MSG, OWN_THREADS_NOT_CONFIGURED_MSG } from "./social-oauth.service";
import { SocialPublishService, PermanentPublishError } from "./social-publish.service";
import { SocialHealthService } from "./social-health.service";
import { SocialInsightsService, engagementScore } from "./social-insights.service";
import { ThreadsClient, ThreadsPublisher } from "./threads.client";
import { validateForPlatform } from "./social-preflight";
import { decryptJson, encryptJson } from "../integrations/crypto";
import { setPlatformConfigSnapshot } from "../common/platform-config";

/**
 * SN7 — Threads publishing, proven at stubbed boundaries
 * (docs/social-sn7-threads-spike.md; no live call anywhere):
 * - Connect URL: not configured → honest Bengali refusal (both
 *   app paths); configured → threads.net authorize URL with the
 *   three documented scopes + a threads/connect state row.
 * - Callback: code → short-lived → LONG-lived exchange (the
 *   stored credential is the long-lived token, never the 1-hour
 *   one); profile → threads account; a replayed state stores
 *   nothing twice; an exchange failure stores nothing.
 * - Refresh: the 60-day token refreshes through th_refresh_token
 *   with NO refresh token and NO app secret involved.
 * - Publish dispatch: pre-flight (500 chars / 20 items) refuses
 *   BEFORE the publisher; the refresh-aware token is what the
 *   publisher receives; permalink failure → published with a
 *   null URL.
 * - Container flow (ThreadsPublisher): TEXT create → bounded
 *   poll → publish; an ERROR container fails with Meta's
 *   verbatim error_message; a never-ready container fails with
 *   the honest timeout (publish is never attempted); carousel
 *   children are created as carousel items and polled before
 *   the parent publishes.
 * - Client request shapes: token-exchange form, th_exchange /
 *   th_refresh URLs (refresh carries NO client_secret),
 *   insights value mapping (absent metric stays absent),
 *   followers_count via total_value.
 * - Insights: documented metrics stored under platform
 *   "threads"; engagementScore uses the threads key set.
 * - Follower snapshot: followers_count stored; null → skipped.
 * - Health: profile-GET identity probe, ok + verbatim failure.
 */

const ORG = "org-1";
const ACTOR = "owner-1";
type Row = Record<string, any>;

const SAVED_ENV = { ...process.env };
beforeAll(() => {
  delete process.env.API_PUBLIC_URL;
  delete process.env.WEB_URL;
  delete process.env.THREADS_APP_ID;
  delete process.env.THREADS_APP_SECRET;
  delete process.env.THREADS_REDIRECT_URI;
});
afterAll(() => { process.env = { ...SAVED_ENV }; });

function threadsSnapshot(configured = true) {
  setPlatformConfigSnapshot({
    llm: null, metaApp: null, smtp: null, sms: null, loadedAt: Date.now(),
    threadsApp: configured ? { clientId: "th-app-id", clientSecret: "th-app-secret" } : null,
  } as any);
}
beforeEach(() => threadsSnapshot(true));
afterEach(() => threadsSnapshot(false));

function matches(row: Row, where: any): boolean {
  return Object.entries(where ?? {}).every(([k, v]) => {
    if (v === undefined) return true;
    if (v === null) return row[k] === null || row[k] === undefined;
    if (typeof v === "object" && !(v instanceof Date)) {
      if ("in" in v) return (v as any).in.includes(row[k]);
      if ("gt" in v) return row[k] != null && new Date(row[k]).getTime() > new Date((v as any).gt).getTime();
      return true;
    }
    return row[k] === v;
  });
}

function table(store: Row[], prefix: string) {
  let seq = 0;
  return {
    findMany: jest.fn(async (args: any = {}) => store.filter((r) => matches(r, args.where)).map((r) => ({ ...r }))),
    findFirst: jest.fn(async (args: any = {}) => {
      const row = store.find((r) => matches(r, args.where));
      return row ? { ...row } : null;
    }),
    create: jest.fn(async ({ data }: any) => {
      const row = { id: data.id ?? `${prefix}-${++seq}-${Math.random().toString(36).slice(2, 7)}`, createdAt: new Date(), updatedAt: new Date(), ...data };
      store.push(row);
      return { ...row };
    }),
    update: jest.fn(async ({ where, data }: any) => {
      const row = store.find((r) => matches(r, where));
      if (row) Object.assign(row, data);
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
      const snapKey = where.socialAccountId_day;
      const existing = key
        ? store.find((r) => r.organizationId === key.organizationId && r.platform === key.platform && r.externalId === key.externalId)
        : snapKey
          ? store.find((r) => r.socialAccountId === snapKey.socialAccountId && r.day === snapKey.day)
          : store.find((r) => matches(r, where));
      if (existing) {
        Object.assign(existing, Object.fromEntries(Object.entries(update).filter(([, v]) => v !== undefined)));
        return { ...existing };
      }
      const row = { id: `${prefix}-${++seq}`, createdAt: new Date(), updatedAt: new Date(), ...create };
      store.push(row);
      return { ...row };
    }),
  };
}

function fakeDb() {
  const db: any = {
    organizations: [{ id: ORG, timezone: "Asia/Dhaka", socialRequireApproval: false }],
    socialAccounts: [] as Row[], socialPosts: [] as Row[], mediaAssets: [] as Row[],
    integrations: [] as Row[], credentials: [] as Row[], oauthStates: [] as Row[],
    tenantAppConfigs: [] as Row[], followerSnapshots: [] as Row[], auditRows: [] as Row[],
  };
  db.organization = table(db.organizations, "org");
  db.socialAccount = table(db.socialAccounts, "acct");
  db.socialPost = table(db.socialPosts, "post");
  db.mediaAsset = table(db.mediaAssets, "asset");
  db.socialOAuthState = table(db.oauthStates, "state");
  db.tenantAppConfig = table(db.tenantAppConfigs, "tac");
  db.socialAccountFollowerSnapshot = table(db.followerSnapshots, "snap");
  db.integrationCredential = table(db.credentials, "cred");
  db.integration = {
    ...table(db.integrations, "int"),
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
  return db;
}

function auditOf(db: any) {
  return { log: jest.fn(async (input: any) => { db.auditRows.push(input); }) };
}

function threadsClientStub(over: Partial<Record<string, any>> = {}): any {
  return {
    exchangeCode: jest.fn(async () => ({ shortLivedToken: "short-token-1h", userId: "th-user-1" })),
    exchangeLongLived: jest.fn(async () => ({ accessToken: "long-token-60d", expiresAt: Date.now() + 60 * 86_400_000, userId: null })),
    refreshLongLived: jest.fn(async () => ({ accessToken: "refreshed-token", expiresAt: Date.now() + 60 * 86_400_000, userId: null })),
    getProfile: jest.fn(async () => ({ id: "th-user-1", username: "faysal.threads", name: "Faysal", pictureUrl: "https://x/p.jpg" })),
    getPermalink: jest.fn(async () => "https://www.threads.net/@faysal.threads/post/ABC"),
    getMediaInsights: jest.fn(async () => ({ views: 120, likes: 30, replies: 4, reposts: 2, quotes: 1, shares: 3 })),
    getFollowerCount: jest.fn(async () => 4321),
    ...over,
  };
}

function oauthService(db: any, threads: any) {
  return new SocialOAuthService(db as any, auditOf(db) as any, undefined, undefined, undefined, undefined, threads);
}

function seedThreadsAccount(db: any, credOver: Row = {}) {
  db.integrations.push({ id: "int-th", organizationId: ORG, provider: "threads_social", status: "CONNECTED", externalAccountId: "th-user-1" });
  db.credentials.push({
    id: "cred-th", integrationId: "int-th",
    encryptedData: encryptJson({ accessToken: "long-token-60d", expiresAt: Date.now() + 3600_000, scope: "threads_basic,threads_content_publish,threads_manage_insights", ...credOver }),
  });
  db.socialAccounts.push({
    id: "acct-th", organizationId: ORG, integrationId: "int-th", platform: "threads",
    externalId: "th-user-1", name: "Faysal", username: "faysal.threads", status: "connected",
  });
}

describe("SN7 connect URL + platform modes", () => {
  it("platform app not configured → honest Bengali refusal, no state row", async () => {
    threadsSnapshot(false);
    const db = fakeDb();
    const err = await oauthService(db, threadsClientStub()).threadsConnectUrl(ORG, ACTOR).catch((e) => e);
    expect(err).toBeInstanceOf(BadRequestException);
    expect(err.message).toBe(THREADS_NOT_CONFIGURED_MSG);
    expect(db.oauthStates).toHaveLength(0);
  });

  it("configured → threads.net authorize URL with the documented scopes + state row", async () => {
    const db = fakeDb();
    const { url } = await oauthService(db, threadsClientStub()).threadsConnectUrl(ORG, ACTOR);
    expect(url.startsWith("https://www.threads.net/oauth/authorize?")).toBe(true);
    const params = new URLSearchParams(url.split("?")[1]);
    expect(params.get("client_id")).toBe("th-app-id");
    expect(params.get("scope")).toContain("threads_content_publish");
    expect(params.get("scope")).toContain("threads_manage_insights");
    expect(params.get("response_type")).toBe("code");
    expect(db.oauthStates).toHaveLength(1);
    expect(db.oauthStates[0].platform).toBe("threads");
    expect(db.oauthStates[0].id).toBe(params.get("state"));
  });

  it("appSource=own without an own app → OWN refusal; with one → its client id + bound state", async () => {
    const db = fakeDb();
    const svc = oauthService(db, threadsClientStub());
    const err = await svc.threadsConnectUrl(ORG, ACTOR, "own").catch((e) => e);
    expect(err.message).toBe(OWN_THREADS_NOT_CONFIGURED_MSG);
    db.tenantAppConfigs.push({
      id: "tac-1", organizationId: ORG, platform: "threads", appId: "own-th-id",
      encryptedSecret: encryptJson({ appSecret: "own-th-secret" }), status: "configured",
    });
    const { url } = await svc.threadsConnectUrl(ORG, ACTOR, "own");
    expect(new URLSearchParams(url.split("?")[1]).get("client_id")).toBe("own-th-id");
    expect(db.oauthStates[0].payload).toEqual({ appSource: "own" });
  });

  it("platform modes report threads configured honestly", async () => {
    const db = fakeDb();
    const svc = oauthService(db, threadsClientStub());
    expect((await svc.getPlatformModes()).threads).toEqual({ configured: true });
    threadsSnapshot(false);
    expect((await svc.getPlatformModes()).threads).toEqual({ configured: false });
  });
});

describe("SN7 callback — exchange, persist, replay", () => {
  async function startConnect(db: any, svc: any) {
    const { url } = await svc.threadsConnectUrl(ORG, ACTOR);
    return new URLSearchParams(url.split("?")[1]).get("state")!;
  }

  it("happy path: LONG-lived token stored (never the 1h one), account saved, tokens leak nowhere", async () => {
    const db = fakeDb();
    const th = threadsClientStub();
    const svc = oauthService(db, th);
    const state = await startConnect(db, svc);
    const redirect = await svc.handleThreadsCallback({ code: "code-1", state });
    expect(redirect).toContain("social_connected=threads");
    expect(th.exchangeCode).toHaveBeenCalled();
    expect(th.exchangeLongLived).toHaveBeenCalledWith(expect.objectContaining({ clientId: "th-app-id" }), "short-token-1h");
    expect(db.socialAccounts).toHaveLength(1);
    const acct = db.socialAccounts[0];
    expect(acct.platform).toBe("threads");
    expect(acct.externalId).toBe("th-user-1");
    expect(acct.username).toBe("faysal.threads");
    const cred = decryptJson<any>(db.credentials[0].encryptedData);
    expect(cred.accessToken).toBe("long-token-60d");
    expect(cred.expiresAt).toBeGreaterThan(Date.now() + 30 * 86_400_000);
    expect(JSON.stringify(db.socialAccounts)).not.toContain("long-token-60d");
    expect(JSON.stringify(db.auditRows)).not.toContain("long-token-60d");
    expect(JSON.stringify(db.auditRows)).not.toContain("short-token-1h");
  });

  it("replayed state → error redirect, nothing stored twice", async () => {
    const db = fakeDb();
    const svc = oauthService(db, threadsClientStub());
    const state = await startConnect(db, svc);
    await svc.handleThreadsCallback({ code: "code-1", state });
    const second = await svc.handleThreadsCallback({ code: "code-1", state });
    expect(decodeURIComponent(second.replace(/\+/g, "%20"))).toContain("social_error");
    expect(db.socialAccounts).toHaveLength(1);
    expect(db.integrations).toHaveLength(1);
  });

  it("exchange failure → error redirect with Meta's verbatim message, nothing stored", async () => {
    const db = fakeDb();
    const th = threadsClientStub({ exchangeCode: jest.fn(async () => { throw new Error("Invalid authorization code"); }) });
    const svc = oauthService(db, th);
    const state = await startConnect(db, svc);
    const redirect = await svc.handleThreadsCallback({ code: "bad", state });
    expect(decodeURIComponent(redirect.replace(/\+/g, "%20"))).toContain("Invalid authorization code");
    expect(db.socialAccounts).toHaveLength(0);
    expect(db.credentials).toHaveLength(0);
  });

  it("user denied on threads.net → error redirect, no state consumed, nothing stored", async () => {
    const db = fakeDb();
    const svc = oauthService(db, threadsClientStub());
    const redirect = await svc.handleThreadsCallback({ error: "access_denied", state: "whatever" });
    expect(decodeURIComponent(redirect.replace(/\+/g, "%20"))).toContain("access_denied");
    expect(db.socialAccounts).toHaveLength(0);
  });
});

describe("SN7 refresh — th_refresh_token with no refresh token, no secret", () => {
  it("an expired threads token refreshes via the access token itself and re-seals", async () => {
    const db = fakeDb();
    seedThreadsAccount(db, { accessToken: "old-long-token", expiresAt: Date.now() - 1000 });
    const th = threadsClientStub();
    const svc = oauthService(db, th);
    const account = db.socialAccounts[0];
    const fresh = await svc.ensureAccessToken(ORG, account);
    expect(fresh).toBe("refreshed-token");
    expect(th.refreshLongLived).toHaveBeenCalledWith("old-long-token");
    const cred = decryptJson<any>(db.credentials[0].encryptedData);
    expect(cred.accessToken).toBe("refreshed-token");
    expect(cred.expiresAt).toBeGreaterThan(Date.now());
  });

  it("a fresh threads token is returned as-is (no refresh call)", async () => {
    const db = fakeDb();
    seedThreadsAccount(db);
    const th = threadsClientStub();
    const svc = oauthService(db, th);
    const fresh = await svc.ensureAccessToken(ORG, db.socialAccounts[0]);
    expect(fresh).toBe("long-token-60d");
    expect(th.refreshLongLived).not.toHaveBeenCalled();
  });
});

describe("SN7 publish dispatch", () => {
  function publishService(db: any, stubs: { publisher?: any; client?: any; oauth?: any } = {}) {
    const audit = auditOf(db);
    return new SocialPublishService(
      db as any, audit as any, new SocialService(db as any, audit as any),
      undefined,
      stubs.oauth ?? ({ ensureAccessToken: jest.fn(async () => "fresh-th-token") } as any),
      undefined, undefined, undefined, undefined, undefined, undefined, undefined, undefined,
      stubs.publisher, stubs.client,
    );
  }

  function seedPost(db: any, over: Row = {}) {
    const post = {
      id: "post-th", organizationId: ORG, socialAccountId: "acct-th", createdById: ACTOR,
      caption: "নতুন কালেকশন এসেছে!", linkUrl: null, mediaRefs: [], status: "draft", isStory: false, ...over,
    };
    db.socialPosts.push(post);
    return post;
  }

  it("text post → TEXT publish with the refresh-aware token; permalink becomes the URL", async () => {
    const db = fakeDb();
    seedThreadsAccount(db);
    const publisher: any = { publish: jest.fn(async () => ({ mediaId: "media-1" })) };
    const client = threadsClientStub();
    const out = await publishService(db, { publisher, client }).publishToPlatform(seedPost(db));
    const arg = publisher.publish.mock.calls[0][0];
    expect(arg.accessToken).toBe("fresh-th-token");
    expect(arg.threadsUserId).toBe("th-user-1");
    expect(arg.text).toBe("নতুন কালেকশন এসেছে!");
    expect(arg.media).toEqual([]);
    expect(out.platformPostId).toBe("media-1");
    expect(out.platformUrl).toBe("https://www.threads.net/@faysal.threads/post/ABC");
  });

  it("permalink failure → still published, URL null (never fabricated)", async () => {
    const db = fakeDb();
    seedThreadsAccount(db);
    const publisher: any = { publish: jest.fn(async () => ({ mediaId: "media-2" })) };
    const client = threadsClientStub({ getPermalink: jest.fn(async () => { throw new Error("boom"); }) });
    const out = await publishService(db, { publisher, client }).publishToPlatform(seedPost(db));
    expect(out.platformPostId).toBe("media-2");
    expect(out.platformUrl).toBeNull();
  });

  it("image post → the public media URL rides the publisher input", async () => {
    const db = fakeDb();
    seedThreadsAccount(db);
    db.mediaAssets.push({
      id: "asset-1", organizationId: ORG, kind: "image", name: "a.jpg", contentType: "image/jpeg",
      sizeBytes: 10, storageKey: `${ORG}/social/a`, publicToken: "tok-th", createdById: ACTOR,
    });
    const publisher: any = { publish: jest.fn(async () => ({ mediaId: "media-3" })) };
    const out = await publishService(db, { publisher, client: threadsClientStub() })
      .publishToPlatform(seedPost(db, { mediaRefs: [{ assetId: "asset-1", kind: "image" }] }));
    const arg = publisher.publish.mock.calls[0][0];
    expect(arg.media).toHaveLength(1);
    expect(arg.media[0].kind).toBe("image");
    expect(arg.media[0].url).toContain("/public/media/tok-th");
    expect(out.platformPostId).toBe("media-3");
  });

  it("caption 501 chars → pre-flight refusal BEFORE the publisher runs", async () => {
    const db = fakeDb();
    seedThreadsAccount(db);
    const publisher: any = { publish: jest.fn(async () => ({ mediaId: "x" })) };
    const err = await publishService(db, { publisher, client: threadsClientStub() })
      .publishToPlatform(seedPost(db, { caption: "a".repeat(501) })).catch((e) => e);
    expect(err).toBeInstanceOf(PermanentPublishError);
    expect(err.message).toContain("৫০০");
    expect(publisher.publish).not.toHaveBeenCalled();
  });

  it("21 media → carousel pre-flight refusal; 20 pass pre-flight", async () => {
    const refs = (n: number) => Array.from({ length: n }, (_, i) => ({ assetId: `a${i}`, kind: "image" }));
    expect(validateForPlatform({ caption: "x", mediaRefs: refs(21) }, "threads")).toContain("২০টি");
    expect(validateForPlatform({ caption: "x", mediaRefs: refs(20) }, "threads")).toBeNull();
    expect(validateForPlatform({ caption: "a".repeat(500), mediaRefs: [] }, "threads")).toBeNull();
    expect(validateForPlatform({ caption: "a".repeat(501), mediaRefs: [] }, "threads")).toContain("৫০০");
  });
});

describe("SN7 ThreadsPublisher — container flow", () => {
  function clientWithStatuses(statuses: { status: string; errorMessage?: string | null }[], over: Row = {}): any {
    let i = 0;
    return {
      createContainer: jest.fn(async (_t: string, _u: string, input: any) => ({ containerId: `c-${input.mediaType}-${Math.random().toString(36).slice(2, 6)}` })),
      getContainerStatus: jest.fn(async () => {
        const s = statuses[Math.min(i++, statuses.length - 1)]!;
        return { status: s.status, errorMessage: s.errorMessage ?? null };
      }),
      publishContainer: jest.fn(async () => ({ mediaId: "published-1" })),
      ...over,
    };
  }

  it("TEXT: create → IN_PROGRESS → FINISHED → publish", async () => {
    const client = clientWithStatuses([{ status: "IN_PROGRESS" }, { status: "FINISHED" }]);
    const publisher = new ThreadsPublisher(client, { sleep: async () => undefined, pollDelayMs: 0 });
    const out = await publisher.publish({ accessToken: "t", threadsUserId: "u1", text: "hello", media: [] });
    expect(out.mediaId).toBe("published-1");
    expect(client.createContainer.mock.calls[0][2]).toEqual({ mediaType: "TEXT", text: "hello" });
    expect(client.getContainerStatus).toHaveBeenCalledTimes(2);
    expect(client.publishContainer).toHaveBeenCalledTimes(1);
  });

  it("ERROR container → fails with the container's verbatim error_message; publish never attempted", async () => {
    const client = clientWithStatuses([{ status: "ERROR", errorMessage: "The media could not be fetched" }]);
    const publisher = new ThreadsPublisher(client, { sleep: async () => undefined, pollDelayMs: 0 });
    const err = await publisher.publish({ accessToken: "t", threadsUserId: "u1", text: "x", media: [{ kind: "image", url: "https://x/1.jpg" }] }).catch((e) => e);
    expect(err.message).toBe("The media could not be fetched");
    expect(client.publishContainer).not.toHaveBeenCalled();
  });

  it("never-ready container → bounded polls exhaust → honest timeout; publish never attempted", async () => {
    const client = clientWithStatuses([{ status: "IN_PROGRESS" }]);
    const publisher = new ThreadsPublisher(client, { sleep: async () => undefined, maxPolls: 3, pollDelayMs: 0 });
    const err = await publisher.publish({ accessToken: "t", threadsUserId: "u1", text: "x", media: [] }).catch((e) => e);
    expect(err.message).toContain("timeout");
    expect(client.getContainerStatus).toHaveBeenCalledTimes(3);
    expect(client.publishContainer).not.toHaveBeenCalled();
  });

  it("carousel: children created as carousel items + polled, parent CAROUSEL carries them, then publish", async () => {
    const created: any[] = [];
    let n = 0;
    const client: any = {
      createContainer: jest.fn(async (_t: string, _u: string, input: any) => {
        created.push(input);
        return { containerId: `id-${++n}` };
      }),
      getContainerStatus: jest.fn(async () => ({ status: "FINISHED", errorMessage: null })),
      publishContainer: jest.fn(async () => ({ mediaId: "car-1" })),
    };
    const publisher = new ThreadsPublisher(client, { sleep: async () => undefined, pollDelayMs: 0 });
    const out = await publisher.publish({
      accessToken: "t", threadsUserId: "u1", text: "দুটো ছবি",
      media: [{ kind: "image", url: "https://x/1.jpg" }, { kind: "video", url: "https://x/2.mp4" }],
    });
    expect(out.mediaId).toBe("car-1");
    expect(created[0]).toEqual({ mediaType: "IMAGE", imageUrl: "https://x/1.jpg", isCarouselItem: true });
    expect(created[1]).toEqual({ mediaType: "VIDEO", videoUrl: "https://x/2.mp4", isCarouselItem: true });
    expect(created[2].mediaType).toBe("CAROUSEL");
    expect(created[2].children).toEqual(["id-1", "id-2"]);
    expect(created[2].text).toBe("দুটো ছবি");
    expect(client.publishContainer.mock.calls[0][2]).toBe("id-3");
  });
});

describe("SN7 ThreadsClient — request shapes at a stub fetch", () => {
  function fetchReturning(handler: (url: string, init?: any) => any) {
    const calls: { url: string; init?: any }[] = [];
    const fetchFn = async (url: string, init?: any) => {
      calls.push({ url, init });
      const body = handler(url, init);
      return { ok: true, status: 200, json: async () => body };
    };
    return { calls, fetchFn };
  }
  const CREDS = { clientId: "th-app-id", clientSecret: "th-app-secret", redirectUri: "https://api.example/social/oauth/threads/callback" };

  it("exchangeCode posts the documented form; exchangeLongLived uses th_exchange_token + secret", async () => {
    const { calls, fetchFn } = fetchReturning((url) =>
      url.includes("/oauth/access_token") ? { access_token: "short", user_id: 777 } : { access_token: "long", expires_in: 5184000 });
    const client = new ThreadsClient(fetchFn as any);
    const ex = await client.exchangeCode(CREDS, "code-9");
    expect(ex).toEqual({ shortLivedToken: "short", userId: "777" });
    const form = new URLSearchParams(calls[0].init.body);
    expect(calls[0].url).toBe("https://graph.threads.net/oauth/access_token");
    expect(form.get("grant_type")).toBe("authorization_code");
    expect(form.get("client_secret")).toBe("th-app-secret");
    expect(form.get("code")).toBe("code-9");
    const long = await client.exchangeLongLived(CREDS, "short");
    expect(long.accessToken).toBe("long");
    expect(calls[1].url).toContain("grant_type=th_exchange_token");
    expect(calls[1].url).toContain("client_secret=th-app-secret");
  });

  it("refresh uses th_refresh_token and carries NO client_secret anywhere", async () => {
    const { calls, fetchFn } = fetchReturning(() => ({ access_token: "new-long", expires_in: 5184000 }));
    const client = new ThreadsClient(fetchFn as any);
    const out = await client.refreshLongLived("old-long");
    expect(out.accessToken).toBe("new-long");
    expect(calls[0].url).toContain("https://graph.threads.net/refresh_access_token");
    expect(calls[0].url).toContain("grant_type=th_refresh_token");
    expect(calls[0].url).not.toContain("client_secret");
  });

  it("Graph error {error:{message}} propagates verbatim with its status", async () => {
    const fetchFn = async () => ({ ok: false, status: 400, json: async () => ({ error: { message: "Invalid OAuth access token", type: "OAuthException", code: 190 } }) });
    const client = new ThreadsClient(fetchFn as any);
    const err = await client.getProfile("bad").catch((e) => e);
    expect(err.message).toBe("Invalid OAuth access token");
    expect(err.status).toBe(400);
  });

  it("media insights map values[0].value; an omitted metric stays absent", async () => {
    const { fetchFn } = fetchReturning(() => ({
      data: [
        { name: "views", values: [{ value: 55 }] },
        { name: "likes", values: [{ value: 7 }] },
      ],
    }));
    const client = new ThreadsClient(fetchFn as any);
    const out = await client.getMediaInsights("t", "m-1");
    expect(out).toEqual({ views: 55, likes: 7 });
    expect("replies" in out).toBe(false);
  });

  it("follower count reads total_value; no value → null", async () => {
    const withCount = new ThreadsClient((async () => ({
      ok: true, status: 200,
      json: async () => ({ data: [{ name: "followers_count", total_value: { value: 987 } }] }),
    })) as any);
    expect(await withCount.getFollowerCount("t", "u1")).toBe(987);
    const without = new ThreadsClient((async () => ({
      ok: true, status: 200, json: async () => ({ data: [] }),
    })) as any);
    expect(await without.getFollowerCount("t", "u1")).toBeNull();
  });
});

describe("SN7 insights + followers + health", () => {
  it("post insights: documented metrics stored under platform threads; engagement uses the threads keys", async () => {
    const db = fakeDb();
    seedThreadsAccount(db);
    db.socialPosts.push({
      id: "post-th", organizationId: ORG, socialAccountId: "acct-th", caption: "x",
      status: "published", platformPostId: "media-9", publishedAt: new Date(), insights: null, mediaRefs: [],
    });
    const audit = auditOf(db);
    const publishStub: any = {
      resolveAccountToken: jest.fn(async () => ({ account: db.socialAccounts[0], accessToken: "stored" })),
      markAccountTokenDead: jest.fn(async () => undefined),
    };
    const insights = new SocialInsightsService(
      db as any, audit as any,
      { getPost: jest.fn(async () => ({ id: "post-th" })) } as any,
      publishStub, undefined,
      { ensureAccessToken: jest.fn(async () => "fresh-th") } as any,
      threadsClientStub(),
    );
    await insights.refreshPostInsights(ORG, ACTOR, "post-th");
    const stored = db.socialPosts[0].insights;
    expect(stored.platform).toBe("threads");
    expect(stored).toMatchObject({ views: 120, likes: 30, replies: 4, reposts: 2, quotes: 1, shares: 3 });
    // likes + replies + reposts + quotes (views excluded).
    expect(engagementScore(stored)).toBe(37);
  });

  it("follower snapshot: followers_count stored; a null count SKIPS (no row)", async () => {
    const db = fakeDb();
    seedThreadsAccount(db);
    const audit = auditOf(db);
    const insights = new SocialInsightsService(
      db as any, audit as any, {} as any, {} as any, undefined,
      { ensureAccessToken: jest.fn(async () => "fresh-th") } as any,
      threadsClientStub(),
    );
    const out = await insights.snapshotFollowers(ORG, ACTOR);
    expect(out.snapshotted).toBe(1);
    expect(db.followerSnapshots).toHaveLength(1);
    expect(db.followerSnapshots[0].followers).toBe(4321);

    const db2 = fakeDb();
    seedThreadsAccount(db2);
    const insights2 = new SocialInsightsService(
      db2 as any, auditOf(db2) as any, {} as any, {} as any, undefined,
      { ensureAccessToken: jest.fn(async () => "fresh-th") } as any,
      threadsClientStub({ getFollowerCount: jest.fn(async () => null) }),
    );
    const out2 = await insights2.snapshotFollowers(ORG, ACTOR);
    expect(out2.skipped).toBe(1);
    expect(db2.followerSnapshots).toHaveLength(0);
  });

  it("health: profile ok → ok:true; Meta's error → ok:false verbatim", async () => {
    const db = fakeDb();
    seedThreadsAccount(db);
    const audit = auditOf(db);
    const publish = new SocialPublishService(
      db as any, audit as any, new SocialService(db as any, audit as any),
      undefined, { ensureAccessToken: jest.fn(async () => "fresh-th") } as any,
    );
    const okHealth = new SocialHealthService(db as any, audit as any, publish, { ensureAccessToken: jest.fn(async () => "fresh-th") } as any, undefined, undefined, threadsClientStub());
    const okOut = await okHealth.checkAccountHealth(ORG, ACTOR, "acct-th");
    expect(okOut.ok).toBe(true);

    const badHealth = new SocialHealthService(db as any, audit as any, publish, { ensureAccessToken: jest.fn(async () => "fresh-th") } as any, undefined, undefined,
      threadsClientStub({ getProfile: jest.fn(async () => { throw new Error("Invalid OAuth access token"); }) }));
    const badOut = await badHealth.checkAccountHealth(ORG, ACTOR, "acct-th");
    expect(badOut.ok).toBe(false);
    expect(badOut.error).toContain("Invalid OAuth access token");
  });
});
