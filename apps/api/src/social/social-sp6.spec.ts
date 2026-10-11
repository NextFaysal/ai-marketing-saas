import { SocialService } from "./social.service";
import { SocialPublishService } from "./social-publish.service";
import { MetaSocialPublisher, isTokenDeadError } from "./meta-publisher";
import { MetaGraphError } from "../common/meta-graph";
import { encryptJson } from "../integrations/crypto";

/**
 * SP6 — Meta Page + Instagram publishing adapters, proven at the
 * client boundary (a stub fetch injected into graphPost/graphGet
 * via MetaSocialPublisher — the SP1-spec pattern):
 * - Page: text post (message, optional link), single photo
 *   (post_id preferred over id; existing publicToken reused with
 *   NO mint; missing token auto-created on the asset row),
 *   multi-photo (unpublished uploads → feed attached_media),
 *   single video (/videos file_url), video+image mix → permanent
 *   failure with zero fetch calls.
 * - Instagram: container → poll (IN_PROGRESS → FINISHED) →
 *   media_publish → permalink; video = REELS; permalink failure
 *   is not a publish failure (platformUrl null); container ERROR
 *   surfaces Meta's verbatim text; zero media → permanent.
 *   (PP4 superseded the two-media permanent refusal: 2–10 media
 *   now publish as a carousel — full sequence proven in
 *   social-pp4.spec.ts; the case below is the smoke assertion.)
 * - Service gates: PP1 CHANGED the SVG contract — an SVG asset
 *   is now converted to a cached PNG before publishing (success
 *   path proven in social-pp1.spec.ts); what remains here is the
 *   conversion-FAILING side: conversion error → permanent failure
 *   with the converter's verbatim message, before ANY platform
 *   call and before any public-token mint. Disconnected account /
 *   missing credential / cross-org account → permanent, fetch
 *   never called; token-dead error marks the account "error" with
 *   Meta's verbatim message while the post follows the normal
 *   SP5 retry path.
 * - The PermanentPublishError instanceof check across the
 *   meta-publisher ↔ social-publish.service circular import is
 *   exercised implicitly by every permanent-failure case below
 *   (attempts stay 0 only if instanceof holds in attemptPublish).
 *
 * Evidence ceiling: no real Meta app/Page token exists in this
 * sandbox — these specs prove request shapes and state handling,
 * never a real publish.
 */
const ORG = "org-1";
const ORG2 = "org-2";
const ACTOR = "owner-1";
const PAGE_TOKEN = "PAGE-TOKEN-1";
type Row = Record<string, any>;

const SAVED_API_PUBLIC_URL = process.env.API_PUBLIC_URL;
beforeAll(() => { delete process.env.API_PUBLIC_URL; });
afterAll(() => {
  if (SAVED_API_PUBLIC_URL === undefined) delete process.env.API_PUBLIC_URL;
  else process.env.API_PUBLIC_URL = SAVED_API_PUBLIC_URL;
});

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
      const row = { id: `row-${store.length + 1}-${Math.random().toString(36).slice(2, 7)}`, createdAt: new Date(), updatedAt: new Date(), ...data };
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
    delete: jest.fn(async ({ where }: any) => {
      const idx = store.findIndex((r) => matches(r, where));
      if (idx >= 0) store.splice(idx, 1);
      return {};
    }),
    deleteMany: jest.fn(async ({ where }: any = {}) => {
      const before = store.length;
      for (let i = store.length - 1; i >= 0; i--) if (matches(store[i], where)) store.splice(i, 1);
      return { count: before - store.length };
    }),
  };
}

let seq = 0;
function fakeDb() {
  const db: any = {
    socialAccounts: [] as Row[], socialPosts: [] as Row[], mediaAssets: [] as Row[],
    integrations: [] as Row[], credentials: [] as Row[],
    memberships: [] as Row[], notifications: [] as Row[], auditRows: [] as Row[],
  };
  db.socialAccount = table(db.socialAccounts);
  db.mediaAsset = table(db.mediaAssets);
  db.membership = table(db.memberships);
  db.integration = {
    ...table(db.integrations),
    // Honour include: { credential: true } by attaching the
    // credential row keyed by integrationId (Prisma relation).
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
        platformUrl: null, error: null, attempts: 0, mediaRefs: [], ...data,
      };
      db.socialPosts.push(row);
      return { ...row };
    }),
  };
  return db;
}

/** Stub fetch at the Graph client boundary; records every call. */
function stubFetch(handler: (url: string, params: URLSearchParams) => { status?: number; body: any }) {
  const calls: { url: string; method: string; params: URLSearchParams }[] = [];
  const fetchFn = jest.fn(async (url: string, opts: any = {}) => {
    const method: string = opts.method ?? "GET";
    const params: URLSearchParams = opts.body instanceof URLSearchParams
      ? opts.body
      : new URL(url).searchParams;
    calls.push({ url, method, params });
    const r = handler(url, params);
    const status = r.status ?? 200;
    return { ok: status >= 200 && status < 300, status, json: async () => r.body };
  });
  return { fetchFn: fetchFn as unknown as typeof fetch, calls, fetchMock: fetchFn };
}

function services(db: any, fetchFn: typeof fetch) {
  const audit = { log: jest.fn(async (input: any) => { db.auditRows.push({ id: `audit-${db.auditRows.length + 1}`, createdAt: new Date(), ...input }); }) };
  const social = new SocialService(db as any, audit as any);
  const publisher = new MetaSocialPublisher(fetchFn, { pollIntervalMs: 0, maxPolls: 5, sleep: async () => {} });
  const publish = new SocialPublishService(db as any, audit as any, social, publisher);
  return { social, publish, publisher, audit };
}

function seedIntegration(db: any, over: Row = {}, withCredential = true) {
  const row = {
    id: "int-1", organizationId: ORG, provider: "meta_social", status: "CONNECTED",
    externalAccountId: "page-1", createdAt: new Date(), updatedAt: new Date(), ...over,
  };
  db.integrations.push(row);
  if (withCredential) {
    // Sealed with the REAL encryptJson — the service must decrypt
    // it back to PAGE_TOKEN for the Graph calls.
    db.credentials.push({
      id: `cred-${row.id}`, integrationId: row.id,
      encryptedData: encryptJson({ accessToken: PAGE_TOKEN, pageId: "page-1" }),
      createdAt: new Date(),
    });
  }
  return row;
}

function seedAccount(db: any, over: Row = {}) {
  const row = {
    id: "sacc-1", organizationId: ORG, platform: "meta_page",
    externalId: "page-1", name: "Shop One", username: null, pictureUrl: null,
    status: "connected", lastError: null, integrationId: "int-1", createdById: ACTOR,
    createdAt: new Date(), updatedAt: new Date(), ...over,
  };
  db.socialAccounts.push(row);
  return row;
}

function seedAsset(db: any, over: Row = {}) {
  const row = {
    id: `asset-${db.mediaAssets.length + 1}`, organizationId: ORG, kind: "image",
    name: "photo.png", contentType: "image/png", sizeBytes: 100,
    storageKey: `${ORG}/social/seed.png`, publicToken: null, createdById: ACTOR,
    createdAt: new Date(), updatedAt: new Date(), ...over,
  };
  db.mediaAssets.push(row);
  return row;
}

function seedPost(db: any, over: Row = {}) {
  const row = {
    id: `post-seed-${db.socialPosts.length + 1}`, organizationId: ORG, socialAccountId: "sacc-1",
    caption: "ঈদ অফার — নতুন কালেকশন", linkUrl: null, mediaRefs: [], status: "draft",
    scheduledAt: null, publishedAt: null, platformPostId: null, platformUrl: null,
    error: null, attempts: 0, createdById: ACTOR,
    createdAt: new Date(), updatedAt: new Date(), ...over,
  };
  db.socialPosts.push(row);
  return row;
}

const storedPost = (db: any, id: string) => db.socialPosts.find((p: Row) => p.id === id);
const storedAccount = (db: any, id: string) => db.socialAccounts.find((a: Row) => a.id === id);
const storedAsset = (db: any, id: string) => db.mediaAssets.find((a: Row) => a.id === id);

afterEach(() => jest.restoreAllMocks());

describe("SP6 Page publishing", () => {
  it("text post → /feed with message + the decrypted PAGE token; published with facebook.com URL", async () => {
    const db = fakeDb(); seedIntegration(db); seedAccount(db);
    const post = seedPost(db);
    const { fetchFn, calls } = stubFetch((url) => {
      if (url.endsWith("/page-1/feed")) return { body: { id: "page-1_555" } };
      return { body: {} };
    });
    const { publish } = services(db, fetchFn);
    const res = await publish.publishNow(ORG, ACTOR, post.id);
    expect(res.status).toBe("published");
    expect(res.platformPostId).toBe("page-1_555");
    expect(res.platformUrl).toBe("https://www.facebook.com/page-1_555");
    expect(calls).toHaveLength(1);
    expect(calls[0].method).toBe("POST");
    expect(calls[0].params.get("message")).toBe("ঈদ অফার — নতুন কালেকশন");
    expect(calls[0].params.get("link")).toBeNull();
    expect(calls[0].params.get("access_token")).toBe(PAGE_TOKEN);
  });

  it("text post with linkUrl → link param present", async () => {
    const db = fakeDb(); seedIntegration(db); seedAccount(db);
    const post = seedPost(db, { linkUrl: "https://shop.example.com/p/1" });
    const { fetchFn, calls } = stubFetch((url) => {
      if (url.endsWith("/page-1/feed")) return { body: { id: "page-1_556" } };
      return { body: {} };
    });
    const { publish } = services(db, fetchFn);
    const res = await publish.publishNow(ORG, ACTOR, post.id);
    expect(res.status).toBe("published");
    expect(calls).toHaveLength(1);
    expect(calls[0].params.get("link")).toBe("https://shop.example.com/p/1");
  });

  it("single photo with EXISTING publicToken → /photos uses it, NO token is minted, post_id preferred over id", async () => {
    const db = fakeDb(); seedIntegration(db); seedAccount(db);
    const asset = seedAsset(db, { publicToken: "tok-existing" });
    const post = seedPost(db, { mediaRefs: [{ assetId: asset.id, kind: "image" }] });
    const { fetchFn, calls } = stubFetch((url) => {
      if (url.endsWith("/page-1/photos")) return { body: { id: "photo-1", post_id: "page-1_777" } };
      return { body: {} };
    });
    const { publish } = services(db, fetchFn);
    const res = await publish.publishNow(ORG, ACTOR, post.id);
    expect(res.status).toBe("published");
    expect(res.platformPostId).toBe("page-1_777"); // post_id wins over the photo id
    expect(res.platformUrl).toBe("https://www.facebook.com/page-1_777");
    expect(calls).toHaveLength(1);
    expect(calls[0].params.get("url")).toBe("http://localhost:4000/public/media/tok-existing");
    expect(calls[0].params.get("caption")).toBe("ঈদ অফার — নতুন কালেকশন");
    // the seeded token is untouched and no mediaAsset write minted one
    expect(storedAsset(db, asset.id).publicToken).toBe("tok-existing");
    expect(db.mediaAsset.update).not.toHaveBeenCalled();
  });

  it("single photo WITHOUT token → token auto-created on the asset row and used in the /photos call", async () => {
    const db = fakeDb(); seedIntegration(db); seedAccount(db);
    const asset = seedAsset(db, { publicToken: null });
    const post = seedPost(db, { mediaRefs: [{ assetId: asset.id, kind: "image" }] });
    const { fetchFn, calls } = stubFetch((url) => {
      if (url.endsWith("/page-1/photos")) return { body: { id: "photo-2", post_id: "page-1_778" } };
      return { body: {} };
    });
    const { publish } = services(db, fetchFn);
    const res = await publish.publishNow(ORG, ACTOR, post.id);
    expect(res.status).toBe("published");
    const minted = storedAsset(db, asset.id).publicToken;
    expect(typeof minted).toBe("string");
    expect(minted.length).toBeGreaterThanOrEqual(20);
    expect(calls).toHaveLength(1);
    expect(calls[0].params.get("url")).toBe(`http://localhost:4000/public/media/${minted}`);
  });

  it("multi-image → two unpublished /photos uploads then /feed with attached_media[0]/[1]", async () => {
    const db = fakeDb(); seedIntegration(db); seedAccount(db);
    const a1 = seedAsset(db, { publicToken: "tok-a" });
    const a2 = seedAsset(db, { publicToken: "tok-b" });
    const post = seedPost(db, { mediaRefs: [{ assetId: a1.id, kind: "image" }, { assetId: a2.id, kind: "image" }] });
    const { fetchFn, calls } = stubFetch((url, params) => {
      if (url.endsWith("/page-1/photos")) {
        return { body: { id: params.get("url")?.includes("tok-a") ? "photo-a" : "photo-b" } };
      }
      if (url.endsWith("/page-1/feed")) return { body: { id: "page-1_888" } };
      return { body: {} };
    });
    const { publish } = services(db, fetchFn);
    const res = await publish.publishNow(ORG, ACTOR, post.id);
    expect(res.status).toBe("published");
    expect(res.platformPostId).toBe("page-1_888");
    expect(calls).toHaveLength(3);
    expect(calls[0].params.get("published")).toBe("false");
    expect(calls[1].params.get("published")).toBe("false");
    expect(calls[2].params.get("message")).toBe("ঈদ অফার — নতুন কালেকশন");
    expect(calls[2].params.get("attached_media[0]")).toBe(JSON.stringify({ media_fbid: "photo-a" }));
    expect(calls[2].params.get("attached_media[1]")).toBe(JSON.stringify({ media_fbid: "photo-b" }));
  });

  it("single video → /videos with file_url + description", async () => {
    const db = fakeDb(); seedIntegration(db); seedAccount(db);
    const asset = seedAsset(db, { kind: "video", name: "clip.mp4", contentType: "video/mp4", publicToken: "tok-vid" });
    const post = seedPost(db, { mediaRefs: [{ assetId: asset.id, kind: "video" }] });
    const { fetchFn, calls } = stubFetch((url) => {
      if (url.endsWith("/page-1/videos")) return { body: { id: "vid-1" } };
      return { body: {} };
    });
    const { publish } = services(db, fetchFn);
    const res = await publish.publishNow(ORG, ACTOR, post.id);
    expect(res.status).toBe("published");
    expect(res.platformPostId).toBe("vid-1");
    expect(res.platformUrl).toBe("https://www.facebook.com/vid-1");
    expect(calls).toHaveLength(1);
    expect(calls[0].params.get("file_url")).toBe("http://localhost:4000/public/media/tok-vid");
    expect(calls[0].params.get("description")).toBe("ঈদ অফার — নতুন কালেকশন");
  });

  it("video + image mix → failed permanently, attempts stays 0, fetch NEVER called", async () => {
    const db = fakeDb(); seedIntegration(db); seedAccount(db);
    const vid = seedAsset(db, { kind: "video", contentType: "video/mp4", publicToken: "tok-v" });
    const img = seedAsset(db, { publicToken: "tok-i" });
    const post = seedPost(db, { mediaRefs: [{ assetId: vid.id, kind: "video" }, { assetId: img.id, kind: "image" }] });
    const { fetchFn, fetchMock } = stubFetch(() => ({ body: { id: "should-not-happen" } }));
    const { publish } = services(db, fetchFn);
    const res = await publish.publishNow(ORG, ACTOR, post.id);
    expect(res.status).toBe("failed");
    expect(res.attempts).toBe(0);
    expect(res.error).toContain("একসাথে প্রকাশ করা যায় না");
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe("SP6 Instagram publishing", () => {
  function seedIg(db: any) {
    seedIntegration(db);
    seedAccount(db, { id: "sacc-ig", platform: "instagram", externalId: "ig-1", username: "shopone" });
  }

  it("photo happy path: container (image_url, no media_type) → poll IN_PROGRESS → FINISHED → publish → permalink", async () => {
    const db = fakeDb(); seedIg(db);
    const asset = seedAsset(db, { publicToken: "tok-ig" });
    const post = seedPost(db, { socialAccountId: "sacc-ig", mediaRefs: [{ assetId: asset.id, kind: "image" }] });
    let polls = 0;
    const { fetchFn, calls } = stubFetch((url) => {
      if (url.endsWith("/ig-1/media")) return { body: { id: "creation-1" } };
      if (url.includes("/creation-1") && url.includes("fields=status_code")) {
        polls++;
        return { body: { status_code: polls === 1 ? "IN_PROGRESS" : "FINISHED" } };
      }
      if (url.includes("/ig-1/media_publish")) return { body: { id: "media-9" } };
      if (url.includes("/media-9") && url.includes("fields=permalink")) {
        return { body: { permalink: "https://www.instagram.com/p/ABC123/" } };
      }
      return { body: {} };
    });
    const { publish } = services(db, fetchFn);
    const res = await publish.publishNow(ORG, ACTOR, post.id);
    expect(res.status).toBe("published");
    expect(res.platformPostId).toBe("media-9");
    expect(res.platformUrl).toBe("https://www.instagram.com/p/ABC123/");
    expect(polls).toBe(2);
    const container = calls.find((c) => c.url.endsWith("/ig-1/media"));
    expect(container?.params.get("image_url")).toBe("http://localhost:4000/public/media/tok-ig");
    expect(container?.params.get("media_type")).toBeNull();
    expect(container?.params.get("caption")).toBe("ঈদ অফার — নতুন কালেকশন");
    const publishCall = calls.find((c) => c.url.includes("/ig-1/media_publish"));
    expect(publishCall?.params.get("creation_id")).toBe("creation-1");
  });

  it("video → container with media_type REELS + video_url", async () => {
    const db = fakeDb(); seedIg(db);
    const asset = seedAsset(db, { kind: "video", contentType: "video/mp4", publicToken: "tok-reel" });
    const post = seedPost(db, { socialAccountId: "sacc-ig", mediaRefs: [{ assetId: asset.id, kind: "video" }] });
    const { fetchFn, calls } = stubFetch((url) => {
      if (url.endsWith("/ig-1/media")) return { body: { id: "creation-2" } };
      if (url.includes("/creation-2")) return { body: { status_code: "FINISHED" } };
      if (url.includes("/ig-1/media_publish")) return { body: { id: "media-10" } };
      if (url.includes("/media-10")) return { body: { permalink: "https://www.instagram.com/reel/XYZ/" } };
      return { body: {} };
    });
    const { publish } = services(db, fetchFn);
    const res = await publish.publishNow(ORG, ACTOR, post.id);
    expect(res.status).toBe("published");
    expect(res.platformUrl).toBe("https://www.instagram.com/reel/XYZ/");
    const container = calls.find((c) => c.url.endsWith("/ig-1/media"));
    expect(container?.params.get("media_type")).toBe("REELS");
    expect(container?.params.get("video_url")).toBe("http://localhost:4000/public/media/tok-reel");
    expect(container?.params.get("image_url")).toBeNull();
  });

  it("permalink GET fails → still published, platformUrl null (never fabricated)", async () => {
    const db = fakeDb(); seedIg(db);
    const asset = seedAsset(db, { publicToken: "tok-ig2" });
    const post = seedPost(db, { socialAccountId: "sacc-ig", mediaRefs: [{ assetId: asset.id, kind: "image" }] });
    const { fetchFn } = stubFetch((url) => {
      if (url.endsWith("/ig-1/media")) return { body: { id: "creation-3" } };
      if (url.includes("/creation-3")) return { body: { status_code: "FINISHED" } };
      if (url.includes("/ig-1/media_publish")) return { body: { id: "media-11" } };
      if (url.includes("/media-11")) return { status: 500, body: { error: { message: "permalink boom" } } };
      return { body: {} };
    });
    const { publish } = services(db, fetchFn);
    const res = await publish.publishNow(ORG, ACTOR, post.id);
    expect(res.status).toBe("published");
    expect(res.platformPostId).toBe("media-11");
    expect(res.platformUrl).toBeNull();
  });

  it("container status ERROR on the last attempt → failed, error carries Meta's verbatim status text", async () => {
    const db = fakeDb(); seedIg(db);
    const asset = seedAsset(db, { publicToken: "tok-ig3" });
    // attempts=2: one more failure is terminal under SP5's cap.
    const post = seedPost(db, { socialAccountId: "sacc-ig", attempts: 2, mediaRefs: [{ assetId: asset.id, kind: "image" }] });
    const { fetchFn, fetchMock } = stubFetch((url) => {
      if (url.endsWith("/ig-1/media")) return { body: { id: "creation-err" } };
      if (url.includes("/creation-err")) {
        return { body: { status_code: "ERROR", status: "Media processing failed: unsupported aspect ratio" } };
      }
      return { body: {} };
    });
    const { publish } = services(db, fetchFn);
    const res = await publish.publishNow(ORG, ACTOR, post.id);
    expect(res.status).toBe("failed");
    expect(res.attempts).toBe(3);
    expect(res.error).toContain("Media processing failed: unsupported aspect ratio");
    expect(fetchMock).toHaveBeenCalled(); // container + poll really happened
  });

  it("zero media → failed permanently, attempts unchanged, fetch not called", async () => {
    const db = fakeDb(); seedIg(db);
    const post = seedPost(db, { socialAccountId: "sacc-ig", mediaRefs: [] });
    const { fetchFn, fetchMock } = stubFetch(() => ({ body: { id: "x" } }));
    const { publish } = services(db, fetchFn);
    const res = await publish.publishNow(ORG, ACTOR, post.id);
    expect(res.status).toBe("failed");
    expect(res.attempts).toBe(0);
    expect(res.error).toContain("শুধু লেখার পোস্ট Instagram-এ করা যায় না");
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("two media → PP4 carousel publishes (was a permanent refusal before PP4; full sequence in social-pp4.spec.ts)", async () => {
    const db = fakeDb(); seedIg(db);
    const a1 = seedAsset(db, { publicToken: "tok-1" });
    const a2 = seedAsset(db, { publicToken: "tok-2" });
    const post = seedPost(db, {
      socialAccountId: "sacc-ig",
      mediaRefs: [{ assetId: a1.id, kind: "image" }, { assetId: a2.id, kind: "image" }],
    });
    let items = 0;
    const { fetchFn, calls } = stubFetch((url, params) => {
      if (url.endsWith("/ig-1/media") && params.get("media_type") === "CAROUSEL") return { body: { id: "car-1" } };
      if (url.endsWith("/ig-1/media")) return { body: { id: `item-${++items}` } };
      if (url.includes("/item-") || url.includes("/car-1")) return { body: { status_code: "FINISHED" } };
      if (url.includes("/ig-1/media_publish")) return { body: { id: "media-c1" } };
      if (url.includes("/media-c1")) return { body: { permalink: "https://www.instagram.com/p/C1/" } };
      return { body: {} };
    });
    const { publish } = services(db, fetchFn);
    const res = await publish.publishNow(ORG, ACTOR, post.id);
    expect(res.status).toBe("published");
    expect(res.platformPostId).toBe("media-c1");
    const carousel = calls.find((c) => c.params.get("media_type") === "CAROUSEL");
    expect(carousel?.params.get("children")).toBe("item-1,item-2");
  });
});

describe("SP6 service gates", () => {
  it("SVG asset with conversion failing → failed permanently with the converter's verbatim message, attempts unchanged, fetch not called, no publicToken minted (PP1: success path in social-pp1.spec.ts)", async () => {
    const db = fakeDb(); seedIntegration(db); seedAccount(db);
    const asset = seedAsset(db, { name: "poster.svg", contentType: "image/svg+xml", publicToken: null });
    const post = seedPost(db, { mediaRefs: [{ assetId: asset.id, kind: "image" }] });
    const { fetchFn, fetchMock } = stubFetch(() => ({ body: { id: "x" } }));
    const audit = { log: jest.fn(async () => undefined) };
    const social = new SocialService(db as any, audit as any);
    const publisher = new MetaSocialPublisher(fetchFn, { pollIntervalMs: 0, maxPolls: 5, sleep: async () => {} });
    const failingRaster = {
      ensurePngAsset: jest.fn(async () => { throw new Error("raster-fixture-down"); }),
    };
    const publish = new SocialPublishService(
      db as any, audit as any, social, publisher, undefined, undefined, undefined, failingRaster as any,
    );
    const res = await publish.publishNow(ORG, ACTOR, post.id);
    expect(res.status).toBe("failed");
    expect(res.error).toBe("SVG থেকে PNG তৈরি করা যায়নি: raster-fixture-down");
    expect(res.attempts).toBe(0);
    expect(fetchMock).not.toHaveBeenCalled();
    expect(storedAsset(db, asset.id).publicToken).toBeNull();
  });

  it("token-dead error → account marked error + verbatim lastError; post rescheduled (attempts 1) with the verbatim error", async () => {
    const db = fakeDb(); seedIntegration(db); seedAccount(db);
    const post = seedPost(db);
    const MSG = "Error validating access token: The session has been invalidated because the user changed their password";
    const { fetchFn } = stubFetch((url) => {
      if (url.endsWith("/page-1/feed")) return { status: 400, body: { error: { message: MSG } } };
      return { body: {} };
    });
    const { publish } = services(db, fetchFn);
    const res = await publish.publishNow(ORG, ACTOR, post.id);
    expect(res.status).toBe("scheduled"); // normal SP5 retry path, NOT a permanent failure
    expect(res.attempts).toBe(1);
    expect(res.error).toBe(MSG);
    const account = storedAccount(db, "sacc-1");
    expect(account.status).toBe("error");
    expect(account.lastError).toBe(MSG);
  });

  it("disconnected account → failed permanently, fetch not called", async () => {
    const db = fakeDb(); seedIntegration(db);
    seedAccount(db, { status: "disconnected", integrationId: null });
    const post = seedPost(db);
    const { fetchFn, fetchMock } = stubFetch(() => ({ body: { id: "x" } }));
    const { publish } = services(db, fetchFn);
    const res = await publish.publishNow(ORG, ACTOR, post.id);
    expect(res.status).toBe("failed");
    expect(res.attempts).toBe(0);
    expect(res.error).toContain("সংযুক্ত নেই");
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("missing credential → failed permanently, fetch not called", async () => {
    const db = fakeDb(); seedIntegration(db, {}, false); seedAccount(db);
    const post = seedPost(db);
    const { fetchFn, fetchMock } = stubFetch(() => ({ body: { id: "x" } }));
    const { publish } = services(db, fetchFn);
    const res = await publish.publishNow(ORG, ACTOR, post.id);
    expect(res.status).toBe("failed");
    expect(res.attempts).toBe(0);
    expect(res.error).toContain("Credentials পাওয়া যাচ্ছে না");
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("cross-org account (post in org-1, account belongs to org-2) → failed permanently, fetch not called", async () => {
    const db = fakeDb(); seedIntegration(db);
    seedAccount(db, { id: "sacc-foreign", organizationId: ORG2 });
    const post = seedPost(db, { socialAccountId: "sacc-foreign" });
    const { fetchFn, fetchMock } = stubFetch(() => ({ body: { id: "x" } }));
    const { publish } = services(db, fetchFn);
    const res = await publish.publishNow(ORG, ACTOR, post.id);
    expect(res.status).toBe("failed");
    expect(res.attempts).toBe(0);
    expect(res.error).toContain("Social অ্যাকাউন্টটি পাওয়া যায়নি");
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe("SP6 isTokenDeadError", () => {
  it("matches Meta's token-dead message shapes and HTTP 401", () => {
    expect(isTokenDeadError(new Error("Error validating access token: The session has been invalidated"))).toBe(true);
    expect(isTokenDeadError(new Error("Invalid OAuth access token - Cannot parse access token"))).toBe(true);
    expect(isTokenDeadError(new Error("OAuthException: The access token has expired"))).toBe(true);
    expect(isTokenDeadError(new Error("The session has expired"))).toBe(true);
    expect(isTokenDeadError(new MetaGraphError(401, "Some unrelated auth failure"))).toBe(true);
  });

  it("does not match ordinary errors or non-errors", () => {
    expect(isTokenDeadError(new Error("Meta API timeout"))).toBe(false);
    expect(isTokenDeadError(new MetaGraphError(400, "(#100) The parameter message is required"))).toBe(false);
    expect(isTokenDeadError("Error validating access token")).toBe(false);
    expect(isTokenDeadError(null)).toBe(false);
    expect(isTokenDeadError(undefined)).toBe(false);
  });
});
