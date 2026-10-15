process.env.ENCRYPTION_KEY = Buffer.alloc(32, 7).toString("base64");

import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { MetaSocialPublisher } from "./meta-publisher";
import { YouTubeClient, YouTubePublisher } from "./youtube.client";
import { validateForPlatform } from "./social-preflight";
import { SocialService } from "./social.service";
import { SocialPublishService, PermanentPublishError } from "./social-publish.service";
import { MediaStore } from "../inbox/media-store";
import { encryptJson } from "../integrations/crypto";

/**
 * SU8 — Publishing depth, proven at the service/client boundary
 * (stub fetch + fake Prisma, SP6/SP9 patterns):
 * - publishPhotoStory: unpublished photo upload → photo_stories
 *   with that photo_id; success!==true / missing post_id throws;
 * - story pre-flight: only meta_page, exactly one image;
 * - the publish service routes a meta_page story to that flow
 *   with the stories URL;
 * - YouTube initiate adds tags/categoryId ONLY when present (the
 *   no-metadata body is byte-identical to SP9's pinned shape);
 * - publish-level: youtubeTitle wins, #Shorts is appended (and
 *   not duplicated), description stays the caption;
 * - setThumbnail posts the raw bytes; a thumbnail failure leaves
 *   the post PUBLISHED with the verbatim reason in the note;
 * - create/update/clone pass the SU8 fields through;
 * - derive: group reuse / group creation (+source grouped),
 *   incompatible target skipped with a warning, TikTok warning,
 *   isStory never copied.
 */

const ORG = "org-1";
const ACTOR = "owner-1";
type Row = Record<string, any>;

let mediaDir = "";
beforeAll(() => {
  mediaDir = mkdtempSync(join(tmpdir(), "su8-media-"));
  process.env.MEDIA_LOCAL_DIR = mediaDir;
});
afterAll(() => {
  if (mediaDir) rmSync(mediaDir, { recursive: true, force: true });
});

function matches(row: Row, where: any): boolean {
  return Object.entries(where ?? {}).every(([k, v]) => {
    if (v === undefined) return true;
    if (v !== null && typeof v === "object" && !(v instanceof Date)) {
      if ("in" in v) return (v as any).in.includes(row[k]);
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
      const row = { id: `${prefix}-${++seq}-${Math.random().toString(36).slice(2, 7)}`, createdAt: new Date(), updatedAt: new Date(), ...data };
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
  };
}

function fakeDb() {
  const db: any = {
    organizations: [{ id: ORG, timezone: "Asia/Dhaka", socialRequireApproval: false }],
    socialAccounts: [] as Row[], socialPosts: [] as Row[], socialPostGroups: [] as Row[],
    mediaAssets: [] as Row[], integrations: [] as Row[], credentials: [] as Row[],
    memberships: [] as Row[], auditRows: [] as Row[],
  };
  db.organization = table(db.organizations, "org");
  db.socialAccount = table(db.socialAccounts, "acct");
  db.socialPost = table(db.socialPosts, "post");
  db.socialPostGroup = table(db.socialPostGroups, "group");
  db.mediaAsset = table(db.mediaAssets, "asset");
  db.membership = table(db.memberships, "mem");
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

function seedMetaAccount(db: any, over: Row = {}) {
  db.integrations.push({ id: "int-1", organizationId: ORG, provider: "meta_social", status: "CONNECTED", externalAccountId: "page-1" });
  db.credentials.push({ id: "cred-1", integrationId: "int-1", encryptedData: encryptJson({ accessToken: "page-token" }) });
  const account = {
    id: "acct-page", organizationId: ORG, integrationId: "int-1", platform: "meta_page",
    externalId: "page-1", name: "Page One", status: "connected", ...over,
  };
  db.socialAccounts.push(account);
  return account;
}

describe("SU8 publishPhotoStory (MetaSocialPublisher, stub fetch)", () => {
  function stub(handler: (url: string, params: URLSearchParams) => { status?: number; body: any }) {
    const calls: { url: string; params: URLSearchParams }[] = [];
    const fetchFn = jest.fn(async (url: string, opts: any = {}) => {
      const params: URLSearchParams = opts.body instanceof URLSearchParams ? opts.body : new URL(url).searchParams;
      calls.push({ url, params });
      const r = handler(url, params);
      const status = r.status ?? 200;
      return { ok: status >= 200 && status < 300, status, json: async () => r.body };
    });
    return { pub: new MetaSocialPublisher(fetchFn as any), calls };
  }

  it("uploads the photo unpublished, then posts photo_stories with that photo_id", async () => {
    const { pub, calls } = stub((url) => {
      if (url.includes("/photos")) return { body: { id: "photo-77" } };
      if (url.includes("/photo_stories")) return { body: { success: true, post_id: "story-99" } };
      throw new Error(`unexpected ${url}`);
    });
    const out = await pub.publishPhotoStory("tok", "page-1", { imageUrl: "https://cdn.example/pic.jpg" });
    expect(out).toEqual({ platformPostId: "story-99" });
    expect(calls).toHaveLength(2);
    expect(calls[0].url).toContain("/page-1/photos");
    expect(calls[0].params.get("published")).toBe("false");
    expect(calls[0].params.get("url")).toBe("https://cdn.example/pic.jpg");
    expect(calls[1].url).toContain("/page-1/photo_stories");
    expect(calls[1].params.get("photo_id")).toBe("photo-77");
  });

  it("success !== true or a missing post_id is an honest throw", async () => {
    const noSuccess = stub((url) => url.includes("/photos") ? { body: { id: "p1" } } : { body: { success: false } });
    await expect(noSuccess.pub.publishPhotoStory("tok", "page-1", { imageUrl: "u" })).rejects.toThrow(/success\/post_id/);
    const noId = stub((url) => url.includes("/photos") ? { body: { id: "p1" } } : { body: { success: true } });
    await expect(noId.pub.publishPhotoStory("tok", "page-1", { imageUrl: "u" })).rejects.toThrow(/success\/post_id/);
  });
});

describe("SU8 story pre-flight", () => {
  const img = [{ assetId: "a", kind: "image" }];
  it("story on a non-Page platform is a violation", () => {
    expect(validateForPlatform({ caption: "c", mediaRefs: img, isStory: true }, "instagram"))
      .toContain("Story আপাতত শুধু Facebook Page-এ সমর্থিত");
    expect(validateForPlatform({ caption: "c", mediaRefs: img, isStory: true }, "tiktok"))
      .toContain("Story আপাতত শুধু Facebook Page-এ সমর্থিত");
  });
  it("a Page story needs exactly one image", () => {
    expect(validateForPlatform({ caption: "c", mediaRefs: img, isStory: true }, "meta_page")).toBeNull();
    expect(validateForPlatform({ caption: "c", mediaRefs: [...img, ...img], isStory: true }, "meta_page")).not.toBeNull();
    expect(validateForPlatform({ caption: "c", mediaRefs: [{ assetId: "a", kind: "video" }], isStory: true }, "meta_page")).not.toBeNull();
    expect(validateForPlatform({ caption: "c", mediaRefs: [], isStory: true }, "meta_page")).not.toBeNull();
  });
  it("non-story validation is unchanged", () => {
    expect(validateForPlatform({ caption: "c", mediaRefs: img }, "instagram")).toBeNull();
    expect(validateForPlatform({ caption: "c", mediaRefs: img, isStory: false }, "meta_page")).toBeNull();
  });
});

describe("SU8 publish service — FB story path", () => {
  it("a meta_page story post goes through publishPhotoStory with the stories URL", async () => {
    const db = fakeDb();
    const account = seedMetaAccount(db);
    db.mediaAssets.push({
      id: "asset-img", organizationId: ORG, kind: "image", name: "p.jpg", contentType: "image/jpeg",
      sizeBytes: 10, storageKey: "k", publicToken: "tok-img", createdById: ACTOR,
    });
    const publisherStub: any = {
      publishPhotoStory: jest.fn(async () => ({ platformPostId: "story-9" })),
      publishToPage: jest.fn(async () => { throw new Error("feed path must not run for a story"); }),
    };
    const publish = new SocialPublishService(db as any, auditOf(db) as any, new SocialService(db as any, auditOf(db) as any), publisherStub);
    const out = await publish.publishToPlatform({
      id: "post-1", organizationId: ORG, socialAccountId: account.id, caption: "story!",
      mediaRefs: [{ assetId: "asset-img", kind: "image" }], isStory: true, linkUrl: null,
    });
    expect(publisherStub.publishPhotoStory).toHaveBeenCalledWith("page-token", "page-1", { imageUrl: expect.stringContaining("/public/media/tok-img") });
    expect(out.platformPostId).toBe("story-9");
    expect(out.platformUrl).toBe("https://www.facebook.com/stories/story-9");
  });

  it("a story aimed at Instagram fails permanently at pre-flight (no platform call)", async () => {
    const db = fakeDb();
    seedMetaAccount(db, { id: "acct-ig", platform: "instagram", externalId: "ig-1" });
    const publisherStub: any = { publishPhotoStory: jest.fn(), publishToInstagram: jest.fn() };
    const publish = new SocialPublishService(db as any, auditOf(db) as any, new SocialService(db as any, auditOf(db) as any), publisherStub);
    await expect(publish.publishToPlatform({
      id: "post-1", organizationId: ORG, socialAccountId: "acct-ig", caption: "story!",
      mediaRefs: [{ assetId: "x", kind: "image" }], isStory: true, linkUrl: null,
    })).rejects.toBeInstanceOf(PermanentPublishError);
    expect(publisherStub.publishPhotoStory).not.toHaveBeenCalled();
  });
});

describe("SU8 YouTube client — metadata + thumbnail", () => {
  const SESSION = "https://upload.googleapis.com/youtube-session/xyz";
  function stubFetch(handler: (call: { url: string; opts: any }) => { status: number; headers?: any; body?: any }) {
    const calls: { url: string; opts: any }[] = [];
    const fetchFn = jest.fn(async (url: string, opts: any = {}) => {
      const call = { url, opts };
      calls.push(call);
      const r = handler(call);
      return { ok: r.status >= 200 && r.status < 300, status: r.status, headers: r.headers ?? {}, json: async () => r.body ?? {} };
    });
    return { fetchFn: fetchFn as unknown as typeof fetch, calls };
  }

  it("initiate adds tags/categoryId ONLY when present; absent = the exact SP9 body", async () => {
    const { fetchFn, calls } = stubFetch(() => ({ status: 200, headers: { location: SESSION } }));
    const client = new YouTubeClient(fetchFn);
    await client.initiateResumable("tok", { title: "t", description: "d", contentType: "video/mp4", contentLength: 10 });
    expect(JSON.parse(calls[0].opts.body).snippet).toEqual({ title: "t", description: "d" });
    await client.initiateResumable("tok", { title: "t", description: "d", contentType: "video/mp4", contentLength: 10, tags: ["a", "b"], categoryId: "22" });
    expect(JSON.parse(calls[1].opts.body).snippet).toEqual({ title: "t", description: "d", tags: ["a", "b"], categoryId: "22" });
  });

  it("upload() passes tags/category through to the initiate body", async () => {
    const { fetchFn, calls } = stubFetch((call) => {
      if (call.url.includes("uploadType=resumable")) return { status: 200, headers: { location: SESSION } };
      return { status: 201, body: { id: "vid-t" } };
    });
    const publisher = new YouTubePublisher(new YouTubeClient(fetchFn));
    const out = await publisher.upload({
      accessToken: "tok", bytes: Buffer.alloc(10, 1), contentType: "video/mp4",
      title: "t", description: "d", tags: ["x"], categoryId: "10",
    });
    expect(out.videoId).toBe("vid-t");
    expect(JSON.parse(calls[0].opts.body).snippet.tags).toEqual(["x"]);
    expect(JSON.parse(calls[0].opts.body).snippet.categoryId).toBe("10");
  });

  it("setThumbnail posts the raw bytes with the image content type; Google errors verbatim", async () => {
    const { fetchFn, calls } = stubFetch(() => ({ status: 200, body: {} }));
    const client = new YouTubeClient(fetchFn);
    const bytes = Buffer.from([0xff, 0xd8, 0xff, 0x01]);
    await client.setThumbnail("tok-9", "vid-1", bytes, "image/jpeg");
    expect(calls[0].url).toBe("https://www.googleapis.com/upload/youtube/v3/thumbnails/set?videoId=vid-1");
    expect(calls[0].opts.method).toBe("POST");
    expect(calls[0].opts.headers.Authorization).toBe("Bearer tok-9");
    expect(calls[0].opts.headers["Content-Type"]).toBe("image/jpeg");
    expect(calls[0].opts.body).toBe(bytes);

    const failing = stubFetch(() => ({ status: 403, body: { error: { message: "The authenticated user has no permission" } } }));
    await expect(new YouTubeClient(failing.fetchFn).setThumbnail("tok", "vid-1", bytes, "image/jpeg"))
      .rejects.toThrow("The authenticated user has no permission");
  });
});

describe("SU8 publish service — YouTube metadata, Shorts, cover", () => {
  const VIDEO_BYTES = Buffer.alloc(64, 9);
  const COVER_BYTES = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 1, 2, 3]);

  async function setup(ytStub: any, postOver: Row = {}) {
    const db = fakeDb();
    db.integrations.push({ id: "int-yt", organizationId: ORG, provider: "youtube_social", status: "CONNECTED", externalAccountId: "chan-1" });
    db.credentials.push({
      id: "cred-yt", integrationId: "int-yt",
      encryptedData: encryptJson({ accessToken: "gg-access", refreshToken: "gg-refresh", expiresAt: Date.now() + 3600_000, channelId: "chan-1" }),
    });
    db.socialAccounts.push({
      id: "acct-yt", organizationId: ORG, integrationId: "int-yt", platform: "youtube",
      externalId: "chan-1", name: "Channel", status: "connected",
    });
    const store = MediaStore.fromEnv();
    await store.put(`${ORG}/social/vid.mp4`, VIDEO_BYTES, "video/mp4");
    await store.put(`${ORG}/social/cover.jpg`, COVER_BYTES, "image/jpeg");
    db.mediaAssets.push(
      { id: "asset-vid", organizationId: ORG, kind: "video", name: "v.mp4", contentType: "video/mp4", sizeBytes: VIDEO_BYTES.length, storageKey: `${ORG}/social/vid.mp4`, publicToken: null, createdById: ACTOR },
      { id: "asset-cover", organizationId: ORG, kind: "image", name: "c.jpg", contentType: "image/jpeg", sizeBytes: COVER_BYTES.length, storageKey: `${ORG}/social/cover.jpg`, publicToken: null, createdById: ACTOR },
    );
    const oauthStub: any = { ensureAccessToken: jest.fn(async () => "gg-access") };
    const audit = auditOf(db);
    const publish = new SocialPublishService(
      db as any, audit as any, new SocialService(db as any, audit as any),
      undefined, oauthStub, undefined, ytStub,
    );
    const post = {
      id: "post-yt", organizationId: ORG, socialAccountId: "acct-yt",
      caption: "Caption first line\nfull description here", linkUrl: null,
      mediaRefs: [{ assetId: "asset-vid", kind: "video" }], status: "draft",
      createdById: ACTOR, ...postOver,
    };
    return { db, publish, post };
  }

  function ytStub(over: Row = {}): any {
    return {
      uploadFromSource: jest.fn(async (_args: any) => ({ videoId: "vid-1" })),
      setThumbnail: jest.fn(async (..._args: any[]) => undefined),
      ...over,
    };
  }

  it("youtubeTitle wins, tags/category pass through, #Shorts is appended, cover is set after upload", async () => {
    const stub = ytStub();
    const { publish, post } = await setup(stub, {
      youtubeTitle: "Custom Title", youtubeTags: ["sale", "bd"], youtubeCategoryId: "22",
      youtubeIsShort: true, coverAssetId: "asset-cover",
    });
    const out = await publish.publishToPlatform(post);
    expect(out.platformPostId).toBe("vid-1");
    const args = stub.uploadFromSource.mock.calls[0][0];
    expect(args.title).toBe("Custom Title #Shorts");
    expect(args.description).toBe("Caption first line\nfull description here");
    expect(args.tags).toEqual(["sale", "bd"]);
    expect(args.categoryId).toBe("22");
    expect(stub.setThumbnail).toHaveBeenCalledWith("gg-access", "vid-1", expect.any(Buffer), "image/jpeg");
    expect(Buffer.compare(stub.setThumbnail.mock.calls[0][2], COVER_BYTES)).toBe(0);
    expect(out.publishNote).not.toContain("Cover (thumbnail) সেট করা যায়নি");
  });

  it("#Shorts is not duplicated, and without youtubeTitle the caption first line is used", async () => {
    const stub = ytStub();
    const { publish, post } = await setup(stub, { youtubeTitle: "Cool #Shorts", youtubeIsShort: true });
    await publish.publishToPlatform(post);
    expect(stub.uploadFromSource.mock.calls[0][0].title).toBe("Cool #Shorts");

    const stub2 = ytStub();
    const s2 = await setup(stub2, { youtubeIsShort: false });
    await s2.publish.publishToPlatform(s2.post);
    const args2 = stub2.uploadFromSource.mock.calls[0][0];
    expect(args2.title).toBe("Caption first line");
    expect(args2.tags).toBeUndefined();
    expect(args2.categoryId).toBeUndefined();
    expect(stub2.setThumbnail).not.toHaveBeenCalled();
  });

  it("a thumbnail failure keeps the post published and appends the verbatim reason to the note", async () => {
    const stub = ytStub({
      setThumbnail: jest.fn(async () => { throw new Error("quota exceeded verbatim"); }),
    });
    const { publish, post } = await setup(stub, { coverAssetId: "asset-cover" });
    const out = await publish.publishToPlatform(post);
    expect(out.outcome).toBe("published");
    expect(out.platformPostId).toBe("vid-1");
    expect(out.publishNote).toContain("Private হিসেবে আপলোড হয়েছে");
    expect(out.publishNote).toContain("Cover (thumbnail) সেট করা যায়নি: quota exceeded verbatim");
  });
});

describe("SU8 SocialService — create/update/clone pass-through", () => {
  it("create stores the SU8 fields; the serializer exposes them", async () => {
    const db = fakeDb();
    db.socialAccounts.push({ id: "acct-1", organizationId: ORG, platform: "youtube", name: "Ch", status: "connected", createdAt: new Date() });
    const svc = new SocialService(db as any, auditOf(db) as any);
    const created = await svc.createPost(ORG, ACTOR, {
      socialAccountId: "acct-1", caption: "hello",
      youtubeTitle: "T", youtubeTags: ["a"], youtubeCategoryId: "22",
      youtubeIsShort: true, coverAssetId: "asset-cover", isStory: false,
    } as any);
    expect(created.youtubeTitle).toBe("T");
    expect(created.youtubeTags).toEqual(["a"]);
    expect(created.youtubeCategoryId).toBe("22");
    expect(created.youtubeIsShort).toBe(true);
    expect(created.coverAssetId).toBe("asset-cover");
    expect(created.isStory).toBe(false);
    const row = db.socialPosts.find((p: Row) => p.id === created.id);
    expect(row.youtubeTitle).toBe("T");
  });

  it("update patches the SU8 fields and clone copies them", async () => {
    const db = fakeDb();
    db.socialAccounts.push({ id: "acct-1", organizationId: ORG, platform: "youtube", name: "Ch", status: "connected", createdAt: new Date() });
    db.socialPosts.push({
      id: "post-1", organizationId: ORG, socialAccountId: "acct-1", caption: "orig", linkUrl: null,
      mediaRefs: [], status: "draft", createdById: ACTOR, createdAt: new Date(), updatedAt: new Date(),
      youtubeTitle: null, youtubeTags: null, youtubeCategoryId: null, youtubeIsShort: false, coverAssetId: null, isStory: false,
    });
    const svc = new SocialService(db as any, auditOf(db) as any);
    const updated = await svc.updatePost(ORG, ACTOR, "post-1", {
      youtubeTitle: "New", youtubeTags: ["x", "y"], youtubeIsShort: true, isStory: true,
    } as any);
    expect(updated.youtubeTitle).toBe("New");
    expect(updated.youtubeTags).toEqual(["x", "y"]);
    expect(updated.youtubeIsShort).toBe(true);
    expect(updated.isStory).toBe(true);

    const clone = await svc.clonePost(ORG, ACTOR, "post-1");
    expect(clone.id).not.toBe("post-1");
    expect(clone.youtubeTitle).toBe("New");
    expect(clone.youtubeTags).toEqual(["x", "y"]);
    expect(clone.youtubeIsShort).toBe(true);
    expect(clone.isStory).toBe(true);
    expect(clone.coverAssetId).toBeNull();
  });
});

describe("SU8 derive", () => {
  function seedDerive(db: any, sourceOver: Row = {}) {
    db.socialAccounts.push(
      { id: "acct-yt", organizationId: ORG, platform: "youtube", name: "YT", status: "connected", createdAt: new Date() },
      { id: "acct-tt", organizationId: ORG, platform: "tiktok", name: "TT", status: "connected", createdAt: new Date() },
      { id: "acct-page", organizationId: ORG, platform: "meta_page", name: "Page", status: "connected", createdAt: new Date() },
    );
    db.socialPosts.push({
      id: "post-src", organizationId: ORG, socialAccountId: "acct-page", caption: "Hello derived world",
      linkUrl: "https://shop.example/p", mediaRefs: [{ assetId: "v1", kind: "video" }],
      status: "published", createdById: ACTOR, createdAt: new Date(), updatedAt: new Date(),
      firstCommentText: "first!", postGroupId: "group-1",
      youtubeTitle: "YT T", youtubeTags: ["t"], youtubeCategoryId: "22", youtubeIsShort: true,
      coverAssetId: "cov-1", isStory: false, ...sourceOver,
    });
    db.socialPostGroups.push({ id: "group-1", organizationId: ORG, name: "G1", createdById: ACTOR, createdAt: new Date(), updatedAt: new Date() });
  }

  it("reuses the source's group, copies fields, warns for TikTok inbox (not published)", async () => {
    const db = fakeDb();
    seedDerive(db);
    const svc = new SocialService(db as any, auditOf(db) as any);
    const out = await svc.derivePost(ORG, ACTOR, "post-src", ["acct-yt", "acct-tt"]);
    expect(out.created).toHaveLength(2);
    expect(out.created.every((p: any) => p.postGroupId === "group-1")).toBe(true);
    expect(out.created.every((p: any) => p.status === "draft")).toBe(true);
    expect(db.socialPostGroups).toHaveLength(1); // no new group
    expect(out.warnings).toHaveLength(1);
    expect(out.warnings[0].accountId).toBe("acct-tt");
    expect(out.warnings[0].message).toContain("Inbox");
    const ytPost = db.socialPosts.find((p: Row) => p.socialAccountId === "acct-yt" && p.id !== "post-src");
    expect(ytPost.youtubeTitle).toBe("YT T");
    expect(ytPost.youtubeTags).toEqual(["t"]);
    expect(ytPost.coverAssetId).toBe("cov-1");
    expect(ytPost.isStory).toBe(false);
    expect(db.auditRows.some((a: Row) => a.action === "social.post_derived")).toBe(true);
  });

  it("creates a group when the source has none (source joins it) and skips an incompatible target with a warning", async () => {
    const db = fakeDb();
    // Two images: fine for a Page, impossible for YouTube (video-only).
    seedDerive(db, {
      postGroupId: null, isStory: true,
      mediaRefs: [{ assetId: "i1", kind: "image" }, { assetId: "i2", kind: "image" }],
    });
    const svc = new SocialService(db as any, auditOf(db) as any);
    const out = await svc.derivePost(ORG, ACTOR, "post-src", ["acct-yt", "acct-page", "acct-missing"]);
    expect(out.created).toHaveLength(1);
    expect(out.created[0].socialAccountId).toBe("acct-page");
    // isStory is NEVER copied by derive.
    expect(out.created[0].isStory).toBe(false);
    const ytWarn = out.warnings.find((w: any) => w.accountId === "acct-yt");
    expect(ytWarn?.message).toContain("ঠিক একটি Video");
    expect(out.warnings.some((w: any) => w.accountId === "acct-missing")).toBe(true);
    // A new group exists, the source was moved into it, and the
    // created post shares it.
    const group = db.socialPostGroups.find((g: Row) => g.id !== "group-1");
    expect(group).toBeTruthy();
    expect(group.name).toBe("Hello derived world");
    const source = db.socialPosts.find((p: Row) => p.id === "post-src");
    expect(source.postGroupId).toBe(group.id);
    expect(out.created[0].postGroupId).toBe(group.id);
  });
});
