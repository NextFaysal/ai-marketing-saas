process.env.ENCRYPTION_KEY = Buffer.alloc(32, 7).toString("base64");

import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { BadRequestException } from "@nestjs/common";
import { SocialService } from "./social.service";
import { SocialPublishService, PermanentPublishError } from "./social-publish.service";
import { validateForPlatform, TIKTOK_PHOTO_GATE_MSG } from "./social-preflight";
import { YouTubeClient } from "./youtube.client";
import { LinkedInClient } from "./linkedin.client";
import { TikTokClient, TikTokPublisher } from "./tiktok.client";
import { MediaStore } from "../inbox/media-store";
import { encryptJson } from "../integrations/crypto";
import { setPlatformConfigSnapshot } from "../common/platform-config";

/**
 * SN1 — publishing-gap closure, proven at stubbed boundaries
 * (SP8/SU8/CC20 patterns — fake Prisma + stub clients/fetch, no
 * live call anywhere):
 * - playlists endpoint: a YouTube account lists its channel's
 *   playlists through the client seam (refresh-aware token); a
 *   non-YouTube account gets the honest Bengali 400;
 * - publish: playlistItems.insert runs AFTER a successful upload;
 *   a failure keeps the post published with the verbatim reason
 *   appended to the note (SU8 cover semantics);
 * - YouTube first comment: commentThreads.insert after upload;
 *   success stores posted + comment id; failure stores failed +
 *   verbatim error and the post stays published;
 * - LinkedIn first comment: publish → socialActions comment with
 *   the SAME fresh token the publish used; failure semantics
 *   identical (published + failed + verbatim);
 * - TikTok photo: gate OFF → pre-flight refuses and NO publish
 *   attempt happens; gate ON → the photo direct-post attempt
 *   runs (creator_info privacy, content/init PHOTO body) and the
 *   post publishes; the video path is untouched;
 * - client request shapes: playlists.list (+pagination),
 *   playlistItems.insert, commentThreads.insert, LinkedIn
 *   socialActions comments, TikTok content/init photo mode.
 */

const ORG = "org-1";
const ACTOR = "owner-1";
type Row = Record<string, any>;

let mediaDir = "";
beforeAll(() => {
  mediaDir = mkdtempSync(join(tmpdir(), "sn1-media-"));
  process.env.MEDIA_LOCAL_DIR = mediaDir;
});
afterAll(() => {
  if (mediaDir) rmSync(mediaDir, { recursive: true, force: true });
});

const SAVED_ENV = { ...process.env };
afterAll(() => { process.env = { ...SAVED_ENV, MEDIA_LOCAL_DIR: mediaDir }; });

function tiktokSnapshot(audited: boolean) {
  setPlatformConfigSnapshot({
    llm: null, metaApp: null, smtp: null, sms: null, loadedAt: Date.now(),
    tiktokApp: { clientKey: "tt-key", clientSecret: "tt-secret", audited }, googleApp: null,
  } as any);
}
afterEach(() => tiktokSnapshot(false));

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

/** Publish service with every SN1 seam stubbed positionally. */
function publishService(db: any, stubs: { oauth?: any; ytPublisher?: any; ytClient?: any; ttPublisher?: any; ttClient?: any; linkedin?: any } = {}) {
  const audit = auditOf(db);
  return new SocialPublishService(
    db as any, audit as any, new SocialService(db as any, audit as any),
    undefined,
    stubs.oauth ?? { ensureAccessToken: jest.fn(async () => "fresh-token") },
    stubs.ttPublisher,
    stubs.ytPublisher,
    undefined,
    stubs.linkedin,
    undefined,
    stubs.ytClient,
    stubs.ttClient,
  );
}

function seedYouTube(db: any) {
  db.integrations.push({ id: "int-yt", organizationId: ORG, provider: "youtube_social", status: "CONNECTED", externalAccountId: "chan-1" });
  db.credentials.push({
    id: "cred-yt", integrationId: "int-yt",
    encryptedData: encryptJson({ accessToken: "gg-access", refreshToken: "gg-refresh", expiresAt: Date.now() + 3600_000, channelId: "chan-1" }),
  });
  db.socialAccounts.push({
    id: "acct-yt", organizationId: ORG, integrationId: "int-yt", platform: "youtube",
    externalId: "chan-1", name: "Channel", status: "connected",
  });
}

describe("SN1 playlists endpoint (SocialPublishService.listYouTubePlaylists)", () => {
  it("youtube account → the channel's playlists via the client seam with the fresh token", async () => {
    const db = fakeDb();
    seedYouTube(db);
    const ytClient: any = {
      listPlaylists: jest.fn(async () => [{ id: "PL1", title: "অফারসমূহ" }, { id: "PL2", title: "Reviews" }]),
    };
    const oauth: any = { ensureAccessToken: jest.fn(async () => "fresh-gg") };
    const svc = publishService(db, { ytClient, oauth });
    const out = await svc.listYouTubePlaylists(ORG, "acct-yt");
    expect(out).toEqual({ playlists: [{ id: "PL1", title: "অফারসমূহ" }, { id: "PL2", title: "Reviews" }] });
    expect(oauth.ensureAccessToken).toHaveBeenCalled();
    expect(ytClient.listPlaylists).toHaveBeenCalledWith("fresh-gg");
  });

  it("non-youtube account → honest Bengali 400, no token or client call", async () => {
    const db = fakeDb();
    db.socialAccounts.push({ id: "acct-page", organizationId: ORG, platform: "meta_page", externalId: "p1", name: "Page", status: "connected" });
    const ytClient: any = { listPlaylists: jest.fn(async () => []) };
    const oauth: any = { ensureAccessToken: jest.fn(async () => "x") };
    const svc = publishService(db, { ytClient, oauth });
    const err = await svc.listYouTubePlaylists(ORG, "acct-page").catch((e) => e);
    expect(err).toBeInstanceOf(BadRequestException);
    expect(err.message).toContain("শুধু YouTube অ্যাকাউন্টের জন্য");
    expect(oauth.ensureAccessToken).not.toHaveBeenCalled();
    expect(ytClient.listPlaylists).not.toHaveBeenCalled();
  });
});

describe("SN1 YouTube publish — playlist + first comment", () => {
  const VIDEO_BYTES = Buffer.alloc(64, 9);

  async function setup(stubs: { ytPublisher?: any; ytClient?: any } = {}, postOver: Row = {}) {
    const db = fakeDb();
    seedYouTube(db);
    const store = MediaStore.fromEnv();
    await store.put(`${ORG}/social/vid.mp4`, VIDEO_BYTES, "video/mp4");
    db.mediaAssets.push({
      id: "asset-vid", organizationId: ORG, kind: "video", name: "v.mp4", contentType: "video/mp4",
      sizeBytes: VIDEO_BYTES.length, storageKey: `${ORG}/social/vid.mp4`, publicToken: null, createdById: ACTOR,
    });
    db.socialPosts.push({
      id: "post-yt", organizationId: ORG, socialAccountId: "acct-yt",
      caption: "Caption first line\nfull description", linkUrl: null,
      mediaRefs: [{ assetId: "asset-vid", kind: "video" }], status: "draft",
      attempts: 0, createdById: ACTOR, createdAt: new Date(), updatedAt: new Date(), ...postOver,
    });
    const ytPublisher: any = stubs.ytPublisher ?? {
      uploadFromSource: jest.fn(async () => ({ videoId: "vid-1" })),
      setThumbnail: jest.fn(async () => undefined),
    };
    const ytClient: any = stubs.ytClient ?? {
      addToPlaylist: jest.fn(async () => undefined),
      postComment: jest.fn(async () => ({ commentId: "cmt-1" })),
    };
    const publish = publishService(db, { ytPublisher, ytClient });
    const post = db.socialPosts[0];
    return { db, publish, post, ytPublisher, ytClient };
  }

  it("playlist insert runs after the upload; success leaves the base note clean", async () => {
    const { publish, post, ytClient } = await setup({}, { youtubePlaylistId: "PL9" });
    const out = await publish.publishToPlatform(post);
    expect(out.outcome).toBe("published");
    expect(ytClient.addToPlaylist).toHaveBeenCalledWith("fresh-token", "PL9", "vid-1");
    expect(out.publishNote).not.toContain("Playlist-এ যোগ করা যায়নি");
  });

  it("playlist failure → post stays published, verbatim reason appended to the note", async () => {
    const ytClient: any = {
      addToPlaylist: jest.fn(async () => { throw new Error("playlistNotFound verbatim"); }),
      postComment: jest.fn(async () => ({ commentId: "cmt-1" })),
    };
    const { publish, post } = await setup({ ytClient }, { youtubePlaylistId: "PL9" });
    const out = await publish.publishToPlatform(post);
    expect(out.outcome).toBe("published");
    expect(out.platformPostId).toBe("vid-1");
    expect(out.publishNote).toContain("Private হিসেবে আপলোড হয়েছে");
    expect(out.publishNote).toContain("Playlist-এ যোগ করা যায়নি: playlistNotFound verbatim");
  });

  it("no playlist chosen → no playlist call at all", async () => {
    const { publish, post, ytClient } = await setup();
    await publish.publishToPlatform(post);
    expect(ytClient.addToPlaylist).not.toHaveBeenCalled();
  });

  it("first comment success → posted + comment id stored (publishNow path)", async () => {
    const { db, publish, ytClient } = await setup({}, { firstCommentText: "প্রথম মন্তব্য!", firstCommentStatus: "pending" });
    const out = await publish.publishNow(ORG, ACTOR, "post-yt");
    expect(out.status).toBe("published");
    expect(ytClient.postComment).toHaveBeenCalledWith("fresh-token", "vid-1", "প্রথম মন্তব্য!");
    const row = db.socialPosts.find((p: Row) => p.id === "post-yt");
    expect(row.firstCommentStatus).toBe("posted");
    expect(row.firstCommentId).toBe("cmt-1");
    expect(row.firstCommentError).toBeNull();
    expect(db.auditRows.some((a: Row) => a.action === "social.first_comment_posted")).toBe(true);
  });

  it("first comment failure → post stays published, failed + verbatim error stored", async () => {
    const ytClient: any = {
      addToPlaylist: jest.fn(async () => undefined),
      postComment: jest.fn(async () => { throw new Error("commentsDisabled verbatim"); }),
    };
    const { db, publish } = await setup({ ytClient }, { firstCommentText: "hi", firstCommentStatus: "pending" });
    const out = await publish.publishNow(ORG, ACTOR, "post-yt");
    expect(out.status).toBe("published");
    const row = db.socialPosts.find((p: Row) => p.id === "post-yt");
    expect(row.firstCommentStatus).toBe("failed");
    expect(row.firstCommentError).toBe("commentsDisabled verbatim");
    expect(db.auditRows.some((a: Row) => a.action === "social.first_comment_failed")).toBe(true);
  });
});

describe("SN1 LinkedIn first comment", () => {
  function setup(linkedin: any, postOver: Row = {}) {
    const db = fakeDb();
    db.integrations.push({ id: "int-li", organizationId: ORG, provider: "linkedin_social", status: "CONNECTED", externalAccountId: "555" });
    db.credentials.push({
      id: "cred-li", integrationId: "int-li",
      encryptedData: encryptJson({ accessToken: "li-at", refreshToken: "li-rt", expiresAt: Date.now() + 3600_000, organizationId: "555" }),
    });
    db.socialAccounts.push({ id: "acct-li", organizationId: ORG, platform: "linkedin_page", externalId: "555", name: "Page", status: "connected", integrationId: "int-li" });
    db.socialPosts.push({
      id: "post-li", organizationId: ORG, socialAccountId: "acct-li",
      caption: "নতুন কালেকশন!", linkUrl: null, mediaRefs: [], status: "draft",
      attempts: 0, createdById: ACTOR, createdAt: new Date(), updatedAt: new Date(), ...postOver,
    });
    const oauth: any = { ensureAccessToken: jest.fn(async () => "fresh-li-token") };
    const publish = publishService(db, { oauth, linkedin });
    return { db, publish, oauth };
  }
  const liStub = (over: Row = {}): any => ({
    publishUgcPost: jest.fn(async () => ({ platformPostId: "urn:li:share:777" })),
    createComment: jest.fn(async () => ({ commentId: "urn:li:comment:55" })),
    ...over,
  });

  it("comment runs after publish with the publish's fresh token; posted + id stored", async () => {
    const linkedin = liStub();
    const { db, publish } = setup(linkedin, { firstCommentText: "ধন্যবাদ!", firstCommentStatus: "pending" });
    const out = await publish.publishNow(ORG, ACTOR, "post-li");
    expect(out.status).toBe("published");
    expect(linkedin.publishUgcPost).toHaveBeenCalledWith("fresh-li-token", expect.objectContaining({ organizationId: "555" }));
    expect(linkedin.createComment).toHaveBeenCalledWith("fresh-li-token", {
      organizationId: "555", postUrn: "urn:li:share:777", text: "ধন্যবাদ!",
    });
    const row = db.socialPosts.find((p: Row) => p.id === "post-li");
    expect(row.firstCommentStatus).toBe("posted");
    expect(row.firstCommentId).toBe("urn:li:comment:55");
  });

  it("comment failure → post stays published, failed + verbatim error stored", async () => {
    const linkedin = liStub({
      createComment: jest.fn(async () => { throw new Error("Not enough permissions to comment"); }),
    });
    const { db, publish } = setup(linkedin, { firstCommentText: "hi", firstCommentStatus: "pending" });
    const out = await publish.publishNow(ORG, ACTOR, "post-li");
    expect(out.status).toBe("published");
    const row = db.socialPosts.find((p: Row) => p.id === "post-li");
    expect(row.firstCommentStatus).toBe("failed");
    expect(row.firstCommentError).toBe("Not enough permissions to comment");
  });

  it("no firstCommentText → no comment call", async () => {
    const linkedin = liStub();
    const { publish } = setup(linkedin);
    await publish.publishNow(ORG, ACTOR, "post-li");
    expect(linkedin.createComment).not.toHaveBeenCalled();
  });
});

describe("SN1 TikTok photo — audit gate matrix", () => {
  function seedTikTok(db: any, refs: { assetId: string; kind: string }[]) {
    db.integrations.push({ id: "int-tt", organizationId: ORG, provider: "tiktok_social", status: "CONNECTED", externalAccountId: "open-1" });
    db.credentials.push({
      id: "cred-tt", integrationId: "int-tt",
      encryptedData: encryptJson({ accessToken: "tt-access", refreshToken: "tt-refresh", expiresAt: Date.now() + 3600_000, openId: "open-1" }),
    });
    db.socialAccounts.push({
      id: "acct-tt", organizationId: ORG, integrationId: "int-tt", platform: "tiktok",
      externalId: "open-1", name: "Creator", status: "connected",
    });
    db.mediaAssets.push(
      { id: "asset-img-1", organizationId: ORG, kind: "image", name: "a.jpg", contentType: "image/jpeg", sizeBytes: 10, storageKey: "k1", publicToken: "tok-img-1", createdById: ACTOR },
      { id: "asset-img-2", organizationId: ORG, kind: "image", name: "b.jpg", contentType: "image/jpeg", sizeBytes: 10, storageKey: "k2", publicToken: "tok-img-2", createdById: ACTOR },
      { id: "asset-vid-1", organizationId: ORG, kind: "video", name: "v.mp4", contentType: "video/mp4", sizeBytes: 10, storageKey: "k3", publicToken: "tok-vid-1", createdById: ACTOR },
    );
    db.socialPosts.push({
      id: "post-tt", organizationId: ORG, socialAccountId: "acct-tt",
      caption: "ছবির পোস্ট", linkUrl: null, mediaRefs: refs, status: "draft",
      attempts: 0, createdById: ACTOR, createdAt: new Date(), updatedAt: new Date(),
    });
  }
  const photoRefs = [{ assetId: "asset-img-1", kind: "image" }, { assetId: "asset-img-2", kind: "image" }];

  it("pre-flight: gate OFF refuses a photo post; gate ON accepts it; video unaffected", () => {
    expect(validateForPlatform({ caption: "c", mediaRefs: photoRefs, tiktokAudited: false }, "tiktok")).toBe(TIKTOK_PHOTO_GATE_MSG);
    expect(validateForPlatform({ caption: "c", mediaRefs: photoRefs }, "tiktok")).toBe(TIKTOK_PHOTO_GATE_MSG);
    expect(validateForPlatform({ caption: "c", mediaRefs: photoRefs, tiktokAudited: true }, "tiktok")).toBeNull();
    expect(validateForPlatform({ caption: "c", mediaRefs: [{ assetId: "v", kind: "video" }], tiktokAudited: false }, "tiktok")).toBeNull();
  });

  it("gate OFF → publish refuses permanently and NO publish attempt happens", async () => {
    tiktokSnapshot(false);
    const db = fakeDb();
    seedTikTok(db, photoRefs);
    const ttPublisher: any = {
      publish: jest.fn(async () => { throw new Error("video path must not run"); }),
      publishPhoto: jest.fn(async () => { throw new Error("photo path must not run"); }),
    };
    const publish = publishService(db, { ttPublisher });
    const post = db.socialPosts[0];
    await expect(publish.publishToPlatform(post)).rejects.toBeInstanceOf(PermanentPublishError);
    await expect(publish.publishToPlatform(post)).rejects.toThrow(TIKTOK_PHOTO_GATE_MSG);
    expect(ttPublisher.publish).not.toHaveBeenCalled();
    expect(ttPublisher.publishPhoto).not.toHaveBeenCalled();
  });

  it("gate ON → photo attempt runs with both public URLs; post publishes with the privacy note", async () => {
    tiktokSnapshot(true);
    const db = fakeDb();
    seedTikTok(db, photoRefs);
    const ttPublisher: any = {
      publish: jest.fn(async () => { throw new Error("video path must not run for photos"); }),
      publishPhoto: jest.fn(async () => ({ publishId: "pub-photo-1", mode: "direct", privacyLevel: "PUBLIC_TO_EVERYONE" })),
    };
    const publish = publishService(db, { ttPublisher });
    const out = await publish.publishToPlatform(db.socialPosts[0]);
    expect(out.outcome).toBe("published");
    expect(out.platformPostId).toBe("pub-photo-1");
    expect(out.publishNote).toContain("ছবির post হয়েছে");
    expect(out.publishNote).toContain("PUBLIC_TO_EVERYONE");
    const args = ttPublisher.publishPhoto.mock.calls[0][0];
    expect(args.photoUrls).toEqual([
      expect.stringContaining("/public/media/tok-img-1"),
      expect.stringContaining("/public/media/tok-img-2"),
    ]);
    expect(ttPublisher.publish).not.toHaveBeenCalled();
  });

  it("video post with gate OFF still takes the untouched inbox path", async () => {
    tiktokSnapshot(false);
    const db = fakeDb();
    seedTikTok(db, [{ assetId: "asset-vid-1", kind: "video" }]);
    const ttPublisher: any = {
      publish: jest.fn(async () => ({ publishId: "pub-vid-1", mode: "inbox" })),
      publishPhoto: jest.fn(async () => { throw new Error("photo path must not run for video"); }),
    };
    const publish = publishService(db, { ttPublisher });
    const out = await publish.publishToPlatform(db.socialPosts[0]);
    expect(out.outcome).toBe("sent_to_creator");
    expect(ttPublisher.publish).toHaveBeenCalledWith(expect.objectContaining({ audited: false }));
    expect(ttPublisher.publishPhoto).not.toHaveBeenCalled();
  });
});

describe("SN1 client request shapes (stub fetch)", () => {
  function stubFetch(handler: (url: string, opts: any) => { status?: number; headers?: any; body?: any }) {
    const calls: { url: string; opts: any }[] = [];
    const fetchFn = jest.fn(async (url: string, opts: any = {}) => {
      calls.push({ url, opts });
      const r = handler(url, opts);
      const status = r.status ?? 200;
      return {
        ok: status >= 200 && status < 300, status, headers: r.headers ?? {},
        json: async () => r.body ?? {},
      };
    });
    return { fetchFn: fetchFn as unknown as typeof fetch, calls };
  }
  const headersOf = (h: any) => ({ get: (k: string) => h?.[k.toLowerCase()] ?? null });

  it("YouTube listPlaylists maps id/title and follows nextPageToken", async () => {
    const { fetchFn, calls } = stubFetch((url) => {
      if (url.includes("pageToken=tok2")) {
        return { body: { items: [{ id: "PL2", snippet: { title: "Second" } }] } };
      }
      return { body: { items: [{ id: "PL1", snippet: { title: "First" } }], nextPageToken: "tok2" } };
    });
    const client = new YouTubeClient(fetchFn);
    const out = await client.listPlaylists("tok");
    expect(out).toEqual([{ id: "PL1", title: "First" }, { id: "PL2", title: "Second" }]);
    expect(calls).toHaveLength(2);
    expect(calls[0].url).toContain("youtube/v3/playlists?");
    expect(calls[0].url).toContain("mine=true");
    expect(calls[0].opts.headers.Authorization).toBe("Bearer tok");
  });

  it("YouTube addToPlaylist posts the documented playlistItems resource; errors verbatim", async () => {
    const { fetchFn, calls } = stubFetch(() => ({ body: { id: "item-1" } }));
    const client = new YouTubeClient(fetchFn);
    await client.addToPlaylist("tok", "PL9", "vid-1");
    expect(calls[0].url).toBe("https://www.googleapis.com/youtube/v3/playlistItems?part=snippet");
    expect(JSON.parse(calls[0].opts.body)).toEqual({
      snippet: { playlistId: "PL9", resourceId: { kind: "youtube#video", videoId: "vid-1" } },
    });
    const failing = stubFetch(() => ({ status: 404, body: { error: { message: "playlistNotFound" } } }));
    await expect(new YouTubeClient(failing.fetchFn).addToPlaylist("tok", "PLx", "vid-1")).rejects.toThrow("playlistNotFound");
  });

  it("YouTube postComment posts commentThreads with textOriginal and returns the comment id", async () => {
    const { fetchFn, calls } = stubFetch(() => ({ body: { id: "cmt-9", snippet: { topLevelComment: { id: "cmt-9" } } } }));
    const client = new YouTubeClient(fetchFn);
    const out = await client.postComment("tok", "vid-1", "দারুণ!");
    expect(out).toEqual({ commentId: "cmt-9" });
    expect(calls[0].url).toBe("https://www.googleapis.com/youtube/v3/commentThreads?part=snippet");
    expect(JSON.parse(calls[0].opts.body)).toEqual({
      snippet: { videoId: "vid-1", topLevelComment: { snippet: { textOriginal: "দারুণ!" } } },
    });
    const failing = stubFetch(() => ({ status: 403, body: { error: { message: "commentsDisabled" } } }));
    await expect(new YouTubeClient(failing.fetchFn).postComment("tok", "vid-1", "x")).rejects.toThrow("commentsDisabled");
  });

  it("LinkedIn createComment posts to socialActions/{urn}/comments with the org actor", async () => {
    const calls: { url: string; init: any }[] = [];
    const fn = (async (url: string, init: any) => {
      calls.push({ url, init });
      return {
        ok: true, status: 201,
        json: async () => ({ id: "urn:li:comment:88" }),
        headers: headersOf({}),
      };
    }) as any;
    const client = new LinkedInClient(fn);
    const out = await client.createComment("tok", { organizationId: "555", postUrn: "urn:li:share:777", text: "ধন্যবাদ!" });
    expect(out).toEqual({ commentId: "urn:li:comment:88" });
    expect(calls[0].url).toBe("https://www.linkedin.com/v2/socialActions/urn%3Ali%3Ashare%3A777/comments");
    const payload = JSON.parse(calls[0].init.body);
    expect(payload.actor).toBe("urn:li:organization:555");
    expect(payload.message).toEqual({ text: "ধন্যবাদ!" });
    expect(calls[0].init.headers["X-Restli-Protocol-Version"]).toBe("2.0.0");

    const failingFn = (async () => ({
      ok: false, status: 403, json: async () => ({ message: "Member has no permission" }), headers: headersOf({}),
    })) as any;
    await expect(new LinkedInClient(failingFn).createComment("tok", { organizationId: "555", postUrn: "urn:li:share:1", text: "x" }))
      .rejects.toThrow("Member has no permission");
  });

  it("TikTok photo flow: creator_info privacy → content/init PHOTO body → PUBLISH_COMPLETE", async () => {
    const calls: { url: string; opts: any }[] = [];
    const fetchFn = jest.fn(async (url: string, opts: any = {}) => {
      calls.push({ url, opts });
      if (url.includes("creator_info")) {
        return { ok: true, status: 200, json: async () => ({ error: { code: "ok" }, data: { creator_info: { privacy_level_options: ["SELF_ONLY", "PUBLIC_TO_EVERYONE"] } } }) };
      }
      if (url.includes("content/init")) {
        return { ok: true, status: 200, json: async () => ({ error: { code: "ok" }, data: { publish_id: "pub-ph-1" } }) };
      }
      if (url.includes("status/fetch")) {
        return { ok: true, status: 200, json: async () => ({ error: { code: "ok" }, data: { status: "PUBLISH_COMPLETE" } }) };
      }
      throw new Error(`unexpected ${url}`);
    });
    const publisher = new TikTokPublisher(new TikTokClient(fetchFn as any), { pollIntervalMs: 0, maxPolls: 3, sleep: async () => {} });
    const out = await publisher.publishPhoto({
      accessToken: "tok", photoUrls: ["https://api.example/public/media/a", "https://api.example/public/media/b"], caption: "ছবি",
    });
    expect(out).toEqual({ publishId: "pub-ph-1", mode: "direct", privacyLevel: "PUBLIC_TO_EVERYONE" });
    const init = calls.find((c) => c.url.includes("content/init"))!;
    expect(init.url).toBe("https://open.tiktokapis.com/v2/post/publish/content/init/");
    const body = JSON.parse(init.opts.body);
    expect(body.post_mode).toBe("DIRECT_POST");
    expect(body.media_type).toBe("PHOTO");
    expect(body.post_info.privacy_level).toBe("PUBLIC_TO_EVERYONE");
    expect(body.source_info).toEqual({
      source: "PULL_FROM_URL", photo_cover_index: 0,
      photo_images: ["https://api.example/public/media/a", "https://api.example/public/media/b"],
    });
  });
});

describe("SN1 SocialService — youtubePlaylistId pass-through", () => {
  it("create stores it, serializer exposes it, update patches/clears it, clone copies it", async () => {
    const db = fakeDb();
    db.socialAccounts.push({ id: "acct-1", organizationId: ORG, platform: "youtube", name: "Ch", status: "connected", createdAt: new Date() });
    const svc = new SocialService(db as any, auditOf(db) as any);
    const created = await svc.createPost(ORG, ACTOR, {
      socialAccountId: "acct-1", caption: "hello", youtubePlaylistId: "PL7",
    } as any);
    expect(created.youtubePlaylistId).toBe("PL7");

    const updated = await svc.updatePost(ORG, ACTOR, created.id, { youtubePlaylistId: "PL8" } as any);
    expect(updated.youtubePlaylistId).toBe("PL8");
    const cleared = await svc.updatePost(ORG, ACTOR, created.id, { youtubePlaylistId: null } as any);
    expect(cleared.youtubePlaylistId).toBeNull();

    await svc.updatePost(ORG, ACTOR, created.id, { youtubePlaylistId: "PL9" } as any);
    const clone = await svc.clonePost(ORG, ACTOR, created.id);
    expect(clone.youtubePlaylistId).toBe("PL9");
  });
});
