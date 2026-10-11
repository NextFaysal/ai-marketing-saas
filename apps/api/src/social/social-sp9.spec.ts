import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { SocialService } from "./social.service";
import { SocialPublishService } from "./social-publish.service";
import { SocialOAuthService, GOOGLE_NOT_CONFIGURED_MSG } from "./social-oauth.service";
import { YouTubeClient, YouTubePublisher } from "./youtube.client";
import { MediaStore } from "../inbox/media-store";
import { decryptJson, encryptJson } from "../integrations/crypto";
import { setPlatformConfigSnapshot } from "../common/platform-config";

/**
 * SP9 — YouTube (Google OAuth + resumable upload, privacy
 * PRIVATE), proven at the client boundary with a stub fetch +
 * fake Prisma (the SP6/SP8 pattern):
 * - Connect URL: not configured → the honest Bengali 400;
 *   configured → Google authorize URL with youtube.upload +
 *   youtube.readonly, access_type=offline, prompt=consent.
 * - Callback: exactly one channel → account created; ZERO
 *   channels → honest error; MORE than one → nothing created,
 *   a channel_pick state is parked (sealed tokens inside) and
 *   the picker endpoints finish the connect — other-user peek
 *   refused, unlisted channel refused, selection consumes the
 *   state (replay refused). A token response with NO refresh
 *   token is refused honestly instead of connecting a time bomb.
 * - Resumable upload (real client + publisher over stub fetch):
 *   initiate carries the metadata with privacyStatus "private";
 *   a clean PUT completes; a mid-upload failure triggers the
 *   protocol status query BEFORE any resume, and the resume
 *   continues from the Range offset YouTube reports; a status
 *   query that finds the upload COMPLETE wins without a second
 *   PUT; a dead session surfaces the original error verbatim.
 * - Publish dispatch: a YouTube post publishes via bytes read
 *   from MediaStore (server-side, not the public URL), lands as
 *   status published with the watch URL + the Private publishNote.
 * - Refresh: Google's branch refreshes and re-seals, KEEPING the
 *   original refresh token (Google does not rotate it).
 *
 * Evidence ceiling: no real Google app exists in this sandbox —
 * these specs prove request shapes, protocol handling and state
 * semantics, never a real YouTube round-trip.
 */
const ORG = "org-1";
const ACTOR = "owner-1";

const SAVED_ENV = { ...process.env };
let mediaDir = "";
beforeAll(() => {
  delete process.env.API_PUBLIC_URL;
  delete process.env.WEB_URL;
  delete process.env.GOOGLE_CLIENT_ID;
  delete process.env.GOOGLE_CLIENT_SECRET;
  mediaDir = mkdtempSync(join(tmpdir(), "sp9-media-"));
  process.env.MEDIA_LOCAL_DIR = mediaDir;
});
afterAll(() => {
  process.env = { ...SAVED_ENV };
  if (mediaDir) rmSync(mediaDir, { recursive: true, force: true });
});
beforeEach(() => {
  setPlatformConfigSnapshot({
    llm: null, metaApp: null, smtp: null, sms: null, loadedAt: Date.now(),
    tiktokApp: null,
    googleApp: { clientId: "gg-id", clientSecret: "gg-secret" },
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
  return db;
}

function mkAudit(db: any) {
  return { log: jest.fn(async (input: any) => { db.auditRows.push({ id: `audit-${db.auditRows.length + 1}`, createdAt: new Date(), ...input }); }) };
}

const CHANNEL_1 = { id: "chan-1", title: "Qosprey Main", pictureUrl: null };
const CHANNEL_2 = { id: "chan-2", title: "Qosprey Vlogs", pictureUrl: "https://img/2.jpg" };

function stubYouTubeClient(overrides: Partial<Record<string, any>> = {}) {
  return {
    exchangeCode: jest.fn(async () => ({
      accessToken: "gg-access-1", refreshToken: "gg-refresh-1",
      expiresAt: Date.now() + 3600_000, scope: "https://www.googleapis.com/auth/youtube.upload",
    })),
    refreshAccessToken: jest.fn(async () => ({
      accessToken: "gg-access-2", expiresAt: Date.now() + 3600_000,
    })),
    listChannels: jest.fn(async () => [CHANNEL_1]),
    ...overrides,
  };
}

function oauthWith(db: any, clientOverrides: Record<string, any> = {}) {
  const client = stubYouTubeClient(clientOverrides);
  const oauth = new SocialOAuthService(db as any, mkAudit(db) as any, undefined, client as any);
  return { oauth, client };
}

async function connectState(db: any, oauth: SocialOAuthService) {
  const { url } = await oauth.youtubeConnectUrl(ORG, ACTOR);
  return { url, state: new URL(url).searchParams.get("state")! };
}

// ---------------------------------------------------------------------------

describe("SP9 YouTube connect URL", () => {
  it("not configured → the honest Bengali 400, no state row", async () => {
    setPlatformConfigSnapshot({ llm: null, metaApp: null, smtp: null, sms: null, loadedAt: Date.now(), tiktokApp: null, googleApp: null } as any);
    const db = fakeDb();
    const { oauth } = oauthWith(db);
    await expect(oauth.youtubeConnectUrl(ORG, ACTOR)).rejects.toThrow(GOOGLE_NOT_CONFIGURED_MSG);
    expect(db.oauthStates).toHaveLength(0);
  });

  it("configured → Google authorize URL (upload+readonly scopes, offline, consent) + bound state", async () => {
    const db = fakeDb();
    const { oauth } = oauthWith(db);
    const { url, state } = await connectState(db, oauth);
    const parsed = new URL(url);
    expect(parsed.origin + parsed.pathname).toBe("https://accounts.google.com/o/oauth2/v2/auth");
    expect(parsed.searchParams.get("client_id")).toBe("gg-id");
    expect(parsed.searchParams.get("scope")).toContain("youtube.upload");
    expect(parsed.searchParams.get("scope")).toContain("youtube.readonly");
    expect(parsed.searchParams.get("access_type")).toBe("offline");
    expect(parsed.searchParams.get("prompt")).toBe("consent");
    const row = db.oauthStates.find((s: Row) => s.id === state);
    expect(row).toMatchObject({ organizationId: ORG, userId: ACTOR, platform: "youtube", purpose: "connect" });
  });
});

describe("SP9 YouTube callback + channel picker", () => {
  it("exactly one channel → account + sealed credential created immediately", async () => {
    const db = fakeDb();
    const { oauth } = oauthWith(db);
    const { state } = await connectState(db, oauth);
    const redirect = await oauth.handleYouTubeCallback({ code: "code-1", state });
    expect(redirect).toContain("social_connected=youtube");
    const account = db.socialAccounts.find((a: Row) => a.platform === "youtube");
    expect(account).toMatchObject({ externalId: "chan-1", name: "Qosprey Main", status: "connected" });
    const integration = db.integrations.find((i: Row) => i.id === account.integrationId);
    expect(integration.provider).toBe("youtube_social");
    const cred = db.credentials.find((c: Row) => c.integrationId === integration.id);
    const sealed = decryptJson<any>(cred.encryptedData);
    expect(sealed.accessToken).toBe("gg-access-1");
    expect(sealed.refreshToken).toBe("gg-refresh-1");
    expect(sealed.channelId).toBe("chan-1");
    expect(JSON.stringify(db.auditRows)).not.toContain("gg-access-1");
  });

  it("zero channels → honest error redirect, nothing created", async () => {
    const db = fakeDb();
    const { oauth } = oauthWith(db, { listChannels: jest.fn(async () => []) });
    const { state } = await connectState(db, oauth);
    const redirect = await oauth.handleYouTubeCallback({ code: "code-1", state });
    const msg = new URL(redirect).searchParams.get("social_error")!;
    expect(msg).toContain("কোনো YouTube Channel পাওয়া যায়নি");
    expect(db.socialAccounts).toHaveLength(0);
  });

  it("no refresh token in the exchange → refused honestly (no time-bomb connection)", async () => {
    const db = fakeDb();
    const { oauth } = oauthWith(db, {
      exchangeCode: jest.fn(async () => ({ accessToken: "gg-access-1", expiresAt: Date.now() + 3600_000 })),
    });
    const { state } = await connectState(db, oauth);
    const redirect = await oauth.handleYouTubeCallback({ code: "code-1", state });
    const msg = new URL(redirect).searchParams.get("social_error")!;
    expect(msg).toContain("refresh token দেয়নি");
    expect(db.socialAccounts).toHaveLength(0);
  });

  it("multiple channels → pick state parked; picker validates user, list and single use", async () => {
    const db = fakeDb();
    const { oauth } = oauthWith(db, { listChannels: jest.fn(async () => [CHANNEL_1, CHANNEL_2]) });
    const { state } = await connectState(db, oauth);
    const redirect = await oauth.handleYouTubeCallback({ code: "code-1", state });
    const pickState = new URL(redirect).searchParams.get("youtube_pick")!;
    expect(pickState).toBeTruthy();
    expect(db.socialAccounts).toHaveLength(0); // nothing created yet

    // Another user cannot peek at the offer.
    await expect(oauth.getYouTubePickInfo(ORG, "someone-else", pickState)).rejects.toThrow("মেয়াদোত্তীর্ণ বা অবৈধ");
    // The owner sees both channels — ids/titles only, no tokens.
    const info = await oauth.getYouTubePickInfo(ORG, ACTOR, pickState);
    expect(info.channels.map((c: any) => c.id)).toEqual(["chan-1", "chan-2"]);
    expect(JSON.stringify(info)).not.toContain("gg-access-1");

    // A channel outside the offered list is refused.
    await expect(oauth.selectYouTubeChannel(ORG, ACTOR, { state: pickState, channelId: "chan-999" }))
      .rejects.toThrow("তালিকায় নেই");
    expect(db.socialAccounts).toHaveLength(0);

    // The real selection creates the account for THAT channel.
    const account = await oauth.selectYouTubeChannel(ORG, ACTOR, { state: pickState, channelId: "chan-2" });
    expect(account).toMatchObject({ platform: "youtube", externalId: "chan-2", name: "Qosprey Vlogs", status: "connected" });
    const accountRow = db.socialAccounts.find((a: Row) => a.externalId === "chan-2");
    const cred = db.credentials.find((c: Row) => c.integrationId === accountRow.integrationId);
    expect(decryptJson<any>(cred.encryptedData).channelId).toBe("chan-2");

    // Replay: the pick state is consumed — a second selection fails.
    await expect(oauth.selectYouTubeChannel(ORG, ACTOR, { state: pickState, channelId: "chan-1" }))
      .rejects.toThrow("মেয়াদোত্তীর্ণ বা অবৈধ");
    expect(db.socialAccounts).toHaveLength(1);
  });
});

describe("SP9 resumable upload protocol", () => {
  interface Call { url: string; opts: any }
  function fetchStub(handler: (call: Call) => { status: number; headers?: any; body?: any }) {
    const calls: Call[] = [];
    const fetchFn = jest.fn(async (url: string, opts: any = {}) => {
      const call = { url, opts };
      calls.push(call);
      const r = handler(call);
      return { ok: r.status >= 200 && r.status < 300, status: r.status, headers: r.headers ?? {}, json: async () => r.body ?? {} };
    });
    return { fetchFn: fetchFn as unknown as typeof fetch, calls };
  }
  const SESSION = "https://upload.googleapis.com/youtube-session/abc";

  it("initiate sends metadata with privacyStatus PRIVATE; a clean PUT completes", async () => {
    const { fetchFn, calls } = fetchStub((call) => {
      if (call.url.includes("uploadType=resumable")) return { status: 200, headers: { location: SESSION } };
      return { status: 201, body: { id: "vid-1" } };
    });
    const publisher = new YouTubePublisher(new YouTubeClient(fetchFn));
    const out = await publisher.upload({
      accessToken: "tok", bytes: Buffer.alloc(1000, 7), contentType: "video/mp4",
      title: "প্রথম লাইন", description: "পুরো ক্যাপশন",
    });
    expect(out.videoId).toBe("vid-1");
    const initBody = JSON.parse(calls[0].opts.body);
    expect(initBody.status.privacyStatus).toBe("private");
    expect(initBody.snippet).toEqual({ title: "প্রথম লাইন", description: "পুরো ক্যাপশন" });
    expect(calls[0].opts.headers["X-Upload-Content-Length"]).toBe("1000");
    expect(calls[1].opts.headers["Content-Range"]).toBe("bytes 0-999/1000");
  });

  it("mid-upload failure → status query first → resume from the reported Range offset", async () => {
    let putCount = 0;
    const { fetchFn, calls } = fetchStub((call) => {
      if (call.url.includes("uploadType=resumable")) return { status: 200, headers: { location: SESSION } };
      if (call.opts.headers["Content-Range"] === "bytes */1000") {
        return { status: 308, headers: { range: "bytes=0-499" } };
      }
      putCount++;
      if (putCount === 1) return { status: 500, body: { error: { message: "backend error" } } };
      return { status: 201, body: { id: "vid-2" } };
    });
    const publisher = new YouTubePublisher(new YouTubeClient(fetchFn));
    const out = await publisher.upload({
      accessToken: "tok", bytes: Buffer.alloc(1000, 3), contentType: "video/mp4", title: "t", description: "d",
    });
    expect(out.videoId).toBe("vid-2");
    const resume = calls.find((c) => c.opts.headers["Content-Range"] === "bytes 500-999/1000");
    expect(resume).toBeTruthy();
    expect(resume!.opts.headers["Content-Length"]).toBe("500");
  });

  it("status query finds the upload COMPLETE despite the PUT error → no second PUT", async () => {
    let dataPuts = 0;
    const { fetchFn } = fetchStub((call) => {
      if (call.url.includes("uploadType=resumable")) return { status: 200, headers: { location: SESSION } };
      if (call.opts.headers["Content-Range"] === "bytes */1000") return { status: 200, body: { id: "vid-3" } };
      dataPuts++;
      return { status: 500, body: { error: { message: "connection reset" } } };
    });
    const publisher = new YouTubePublisher(new YouTubeClient(fetchFn));
    const out = await publisher.upload({
      accessToken: "tok", bytes: Buffer.alloc(1000, 1), contentType: "video/mp4", title: "t", description: "d",
    });
    expect(out.videoId).toBe("vid-3");
    expect(dataPuts).toBe(1);
  });

  it("dead session → the ORIGINAL Google error surfaces verbatim", async () => {
    const { fetchFn } = fetchStub((call) => {
      if (call.url.includes("uploadType=resumable")) return { status: 200, headers: { location: SESSION } };
      if (call.opts.headers["Content-Range"] === "bytes */1000") return { status: 404, body: { error: { message: "Session not found" } } };
      return { status: 500, body: { error: { message: "The upload failed mysteriously" } } };
    });
    const publisher = new YouTubePublisher(new YouTubeClient(fetchFn));
    await expect(publisher.upload({
      accessToken: "tok", bytes: Buffer.alloc(1000, 1), contentType: "video/mp4", title: "t", description: "d",
    })).rejects.toThrow("The upload failed mysteriously");
  });
});

describe("SP9 publish dispatch + refresh", () => {
  function seedYouTube(db: any, credOverrides: Record<string, any> = {}) {
    db.integrations.push({
      id: "int-yt-1", organizationId: ORG, provider: "youtube_social", status: "CONNECTED",
      externalAccountId: "chan-1", createdAt: new Date(), updatedAt: new Date(),
    });
    db.credentials.push({
      id: "cred-yt-1", integrationId: "int-yt-1",
      encryptedData: encryptJson({
        accessToken: "gg-access-1", refreshToken: "gg-refresh-1",
        expiresAt: Date.now() + 3600_000, channelId: "chan-1", ...credOverrides,
      }),
      createdAt: new Date(), updatedAt: new Date(),
    });
    const account = {
      id: "acct-yt-1", organizationId: ORG, integrationId: "int-yt-1", platform: "youtube",
      externalId: "chan-1", name: "Qosprey Main", username: null, pictureUrl: null,
      status: "connected", lastError: null, createdById: ACTOR, createdAt: new Date(), updatedAt: new Date(),
    };
    db.socialAccounts.push(account);
    return account;
  }

  it("publishes via MediaStore bytes → published + watch URL + Private note; title = caption's first line", async () => {
    const db = fakeDb();
    const account = seedYouTube(db);
    const storageKey = `${ORG}/social/asset-yt-1.mp4`;
    await MediaStore.fromEnv().put(storageKey, Buffer.alloc(64, 9), "video/mp4");
    db.mediaAssets.push({
      id: "asset-yt-1", organizationId: ORG, kind: "video", name: "clip.mp4", contentType: "video/mp4",
      sizeBytes: 64, storageKey, publicToken: null, origin: "upload", createdById: ACTOR, createdAt: new Date(), updatedAt: new Date(),
    });
    db.socialPosts.push({
      id: "post-yt-1", organizationId: ORG, socialAccountId: account.id,
      caption: "আজকের অফার!\nবিস্তারিত বিবরণ এখানে", linkUrl: null,
      mediaRefs: [{ assetId: "asset-yt-1", kind: "video" }], status: "draft",
      scheduledAt: null, publishedAt: null, platformPostId: null, platformUrl: null,
      publishNote: null, error: null, attempts: 0, approvalStatus: null,
      createdById: ACTOR, createdAt: new Date(), updatedAt: new Date(),
    });
    const seen: { initBody?: any } = {};
    const fetchFn = jest.fn(async (url: string, opts: any = {}) => {
      if (String(url).includes("uploadType=resumable")) {
        seen.initBody = JSON.parse(opts.body);
        return { ok: true, status: 200, headers: { location: "https://upload.session/1" }, json: async () => ({}) };
      }
      return { ok: true, status: 201, headers: {}, json: async () => ({ id: "vid-9" }) };
    }) as unknown as typeof fetch;
    const audit = mkAudit(db);
    const social = new SocialService(db as any, audit as any);
    const { oauth } = oauthWith(db);
    const publish = new SocialPublishService(
      db as any, audit as any, social, undefined, oauth, undefined,
      new YouTubePublisher(new YouTubeClient(fetchFn)),
    );
    const out = await publish.publishNow(ORG, ACTOR, "post-yt-1");
    expect(out.status).toBe("published");
    expect(out.publishedAt).not.toBeNull();
    expect(out.platformPostId).toBe("vid-9");
    expect(out.platformUrl).toBe("https://www.youtube.com/watch?v=vid-9");
    expect(out.publishNote).toContain("Private হিসেবে আপলোড হয়েছে");
    expect(seen.initBody.snippet.title).toBe("আজকের অফার!");
    expect(seen.initBody.snippet.description).toBe("আজকের অফার!\nবিস্তারিত বিবরণ এখানে");
    expect(seen.initBody.status.privacyStatus).toBe("private");
  });

  it("an image post to YouTube fails permanently (attempts 0) — the shared video gate", async () => {
    const db = fakeDb();
    const account = seedYouTube(db);
    db.mediaAssets.push({
      id: "asset-img", organizationId: ORG, kind: "image", name: "p.jpg", contentType: "image/jpeg",
      sizeBytes: 5, storageKey: "x", publicToken: null, origin: "upload", createdById: ACTOR, createdAt: new Date(), updatedAt: new Date(),
    });
    db.socialPosts.push({
      id: "post-yt-img", organizationId: ORG, socialAccountId: account.id, caption: "ছবি পোস্ট",
      linkUrl: null, mediaRefs: [{ assetId: "asset-img", kind: "image" }], status: "draft",
      scheduledAt: null, publishedAt: null, platformPostId: null, platformUrl: null,
      publishNote: null, error: null, attempts: 0, approvalStatus: null,
      createdById: ACTOR, createdAt: new Date(), updatedAt: new Date(),
    });
    const audit = mkAudit(db);
    const social = new SocialService(db as any, audit as any);
    const { oauth } = oauthWith(db);
    const publish = new SocialPublishService(db as any, audit as any, social, undefined, oauth);
    const out = await publish.publishNow(ORG, ACTOR, "post-yt-img");
    expect(out.status).toBe("failed");
    expect(out.attempts).toBe(0);
    expect(out.error).toContain("YouTube");
  });

  it("expired token → Google refresh re-seals and KEEPS the original refresh token", async () => {
    const db = fakeDb();
    const account = seedYouTube(db, { expiresAt: Date.now() - 1000 });
    const { oauth, client } = oauthWith(db);
    const token = await oauth.ensureAccessToken(ORG, account);
    expect(token).toBe("gg-access-2");
    expect(client.refreshAccessToken).toHaveBeenCalledWith(expect.objectContaining({ clientId: "gg-id" }), "gg-refresh-1");
    const cred = db.credentials.find((c: Row) => c.integrationId === "int-yt-1");
    const sealed = decryptJson<any>(cred.encryptedData);
    expect(sealed.accessToken).toBe("gg-access-2");
    expect(sealed.refreshToken).toBe("gg-refresh-1");
  });
});
