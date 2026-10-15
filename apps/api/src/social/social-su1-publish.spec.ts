import { SocialService } from "./social.service";
import { SocialPublishService } from "./social-publish.service";
import { MetaSocialPublisher } from "./meta-publisher";
import { encryptJson } from "../integrations/crypto";

/**
 * SU1 (publish path) + SU2 (recurrence chain):
 * - FB publish success → first comment POSTed to /{postId}/comments
 *   through the REAL MetaSocialPublisher (stub fetch), status
 *   "posted" + platform comment id stored.
 * - First comment failure → post STAYS published, status "failed",
 *   Meta's error verbatim.
 * - Instagram → /{mediaId}/comments.
 * - TikTok post → no first-comment call at all.
 * - Recurrence: one next scheduled instance anchored to the
 *   original scheduledAt (no drift); a second finalize is a no-op;
 *   a non-recurring post creates nothing.
 */
const ORG = "org-1";
const ACTOR = "owner-1";
const PAGE_TOKEN = "PAGE-TOKEN-1";
type Row = Record<string, any>;

const SAVED = process.env.API_PUBLIC_URL;
beforeAll(() => { delete process.env.API_PUBLIC_URL; });
afterAll(() => {
  if (SAVED === undefined) delete process.env.API_PUBLIC_URL;
  else process.env.API_PUBLIC_URL = SAVED;
});

function matches(row: Row, where: any): boolean {
  return Object.entries(where ?? {}).every(([k, v]) => {
    if (v === null) return row[k] === null || row[k] === undefined;
    if (v && typeof v === "object" && !(v instanceof Date)) {
      if ("in" in v) return (v as any).in.includes(row[k]);
      if ("lte" in v) return row[k] != null && new Date(row[k]).getTime() <= new Date((v as any).lte).getTime();
      if ("lt" in v) return row[k] != null && new Date(row[k]).getTime() < new Date((v as any).lt).getTime();
      return true;
    }
    if (v instanceof Date) return row[k] != null && new Date(row[k]).getTime() === v.getTime();
    return row[k] === v;
  });
}

function table(store: Row[]) {
  return {
    findMany: jest.fn(async (args: any = {}) => {
      let rows = store.filter((r) => matches(r, args.where));
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
      for (const row of store) if (matches(row, where)) { Object.assign(row, data, { updatedAt: new Date() }); count++; }
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
    organizations: [] as Row[],
  };
  db.socialAccount = table(db.socialAccounts);
  db.mediaAsset = table(db.mediaAssets);
  db.membership = table(db.memberships);
  db.organization = table(db.organizations);
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
        platformUrl: null, error: null, attempts: 0, mediaRefs: [], ...data,
      };
      db.socialPosts.push(row);
      return { ...row };
    }),
  };
  return db;
}

function stubFetch(handler: (url: string, params: URLSearchParams, method: string) => { status?: number; body: any }) {
  const calls: { url: string; method: string; params: URLSearchParams }[] = [];
  const fetchFn = jest.fn(async (url: string, opts: any = {}) => {
    const method: string = opts.method ?? "GET";
    const params: URLSearchParams = opts.body instanceof URLSearchParams ? opts.body : new URL(url).searchParams;
    calls.push({ url, method, params });
    const r = handler(url, params, method);
    const status = r.status ?? 200;
    return { ok: status >= 200 && status < 300, status, json: async () => r.body };
  });
  return { fetchFn: fetchFn as unknown as typeof fetch, calls, fetchMock: fetchFn };
}

function services(db: any, fetchFn: typeof fetch) {
  const audit = { log: jest.fn(async (input: any) => { db.auditRows.push({ id: `audit-${db.auditRows.length + 1}`, ...input }); }) };
  const social = new SocialService(db as any, audit as any);
  const publisher = new MetaSocialPublisher(fetchFn, { pollIntervalMs: 0, maxPolls: 5, sleep: async () => {} });
  const publish = new SocialPublishService(db as any, audit as any, social, publisher);
  return { social, publish, publisher, audit };
}

function seedIntegration(db: any) {
  db.integrations.push({
    id: "int-1", organizationId: ORG, provider: "meta_social", status: "CONNECTED",
    externalAccountId: "page-1", createdAt: new Date(), updatedAt: new Date(),
  });
  db.credentials.push({
    id: "cred-int-1", integrationId: "int-1",
    encryptedData: encryptJson({ accessToken: PAGE_TOKEN, pageId: "page-1" }),
    createdAt: new Date(),
  });
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
    storageKey: "k", publicToken: "tok-1", createdById: ACTOR,
    createdAt: new Date(), updatedAt: new Date(), ...over,
  };
  db.mediaAssets.push(row);
  return row;
}

function seedPost(db: any, over: Row = {}) {
  const row = {
    id: `post-seed-${db.socialPosts.length + 1}`, organizationId: ORG, socialAccountId: "sacc-1",
    caption: "ঈদ অফার", linkUrl: null, mediaRefs: [], status: "draft",
    scheduledAt: null, publishedAt: null, platformPostId: null, platformUrl: null,
    error: null, attempts: 0, createdById: ACTOR,
    createdAt: new Date(), updatedAt: new Date(), ...over,
  };
  db.socialPosts.push(row);
  return row;
}

const stored = (db: any, id: string) => db.socialPosts.find((p: Row) => p.id === id);

describe("SU1 first comment on publish", () => {
  it("FB publish success → comment POSTed to /{postId}/comments, status posted + id stored", async () => {
    const db = fakeDb(); seedIntegration(db); seedAccount(db);
    const post = seedPost(db, { firstCommentText: "#ঈদঅফার অর্ডার লিংক", firstCommentStatus: "pending" });
    const { fetchFn, calls } = stubFetch((url) => {
      if (url.endsWith("/page-1/feed")) return { body: { id: "page-1_555" } };
      if (url.endsWith("/page-1_555/comments")) return { body: { id: "comment-1" } };
      return { body: {} };
    });
    const { publish } = services(db, fetchFn);
    const res = await publish.publishNow(ORG, ACTOR, post.id);
    expect(res.status).toBe("published");
    expect(res.firstCommentStatus).toBe("posted");
    expect(res.firstCommentId).toBe("comment-1");
    expect(res.firstCommentError).toBeNull();
    const commentCall = calls.find((c) => c.url.endsWith("/page-1_555/comments"));
    expect(commentCall).toBeTruthy();
    expect(commentCall!.method).toBe("POST");
    expect(commentCall!.params.get("message")).toBe("#ঈদঅফার অর্ডার লিংক");
    expect(commentCall!.params.get("access_token")).toBe(PAGE_TOKEN);
    expect(db.auditRows.some((r: Row) => r.action === "social.first_comment_posted")).toBe(true);
  });

  it("first comment fails → post stays published, status failed, error verbatim", async () => {
    const db = fakeDb(); seedIntegration(db); seedAccount(db);
    const post = seedPost(db, { firstCommentText: "প্রথম কমেন্ট", firstCommentStatus: "pending" });
    const { fetchFn } = stubFetch((url) => {
      if (url.endsWith("/page-1/feed")) return { body: { id: "page-1_556" } };
      if (url.endsWith("/comments")) return { status: 400, body: { error: { message: "Comment verbatim boom" } } };
      return { body: {} };
    });
    const { publish } = services(db, fetchFn);
    const res = await publish.publishNow(ORG, ACTOR, post.id);
    expect(res.status).toBe("published");
    expect(res.platformPostId).toBe("page-1_556");
    expect(res.error).toBeNull();
    expect(res.firstCommentStatus).toBe("failed");
    expect(res.firstCommentError).toBe("Comment verbatim boom");
    expect(db.auditRows.some((r: Row) => r.action === "social.first_comment_failed")).toBe(true);
  });

  it("Instagram publish → comment POSTed to /{mediaId}/comments", async () => {
    const db = fakeDb(); seedIntegration(db);
    seedAccount(db, { id: "sacc-ig", platform: "instagram", externalId: "ig-1" });
    const asset = seedAsset(db);
    const post = seedPost(db, {
      socialAccountId: "sacc-ig", mediaRefs: [{ assetId: asset.id, kind: "image" }],
      firstCommentText: "#insta", firstCommentStatus: "pending",
    });
    const { fetchFn, calls } = stubFetch((url, _params, method) => {
      if (method === "POST" && url.endsWith("/media-9/comments")) return { body: { id: "ig-comment-1" } };
      if (url.endsWith("/ig-1/media")) return { body: { id: "creation-1" } };
      if (url.includes("/creation-1")) return { body: { status_code: "FINISHED" } };
      if (url.includes("/ig-1/media_publish")) return { body: { id: "media-9" } };
      if (url.includes("/media-9")) return { body: { permalink: "https://www.instagram.com/p/ABC/" } };
      return { body: {} };
    });
    const { publish } = services(db, fetchFn);
    const res = await publish.publishNow(ORG, ACTOR, post.id);
    expect(res.status).toBe("published");
    expect(res.firstCommentStatus).toBe("posted");
    expect(res.firstCommentId).toBe("ig-comment-1");
    expect(calls.some((c) => c.method === "POST" && c.url.endsWith("/media-9/comments"))).toBe(true);
  });

  it("TikTok post → no first-comment call at all", async () => {
    const db = fakeDb(); seedIntegration(db);
    seedAccount(db, { id: "sacc-tt", platform: "tiktok", externalId: "tt-1" });
    const post = seedPost(db, {
      socialAccountId: "sacc-tt", firstCommentText: "কমেন্ট", firstCommentStatus: "pending",
    });
    const { fetchFn, fetchMock } = stubFetch(() => ({ body: { id: "x" } }));
    const { publish } = services(db, fetchFn);
    // Drive the finalize step through the one publish path with
    // the platform dispatch stubbed (the TikTok dispatch itself
    // is covered by the SP8 specs) — the point here is that the
    // first-comment step makes NO Graph call for tiktok.
    publish.publishToPlatform = jest.fn(async () => ({ platformPostId: "tt-1", platformUrl: null }));
    const res = await publish.publishNow(ORG, ACTOR, post.id);
    expect(res.status).toBe("published");
    expect(fetchMock).not.toHaveBeenCalled();
    expect(stored(db, post.id).firstCommentStatus).toBe("pending");
  });

  it("post without firstCommentText → no comment call, no extra writes beyond the publish", async () => {
    const db = fakeDb(); seedIntegration(db); seedAccount(db);
    const post = seedPost(db);
    const { fetchFn, calls } = stubFetch((url) => {
      if (url.endsWith("/page-1/feed")) return { body: { id: "page-1_557" } };
      return { body: {} };
    });
    const { publish } = services(db, fetchFn);
    const res = await publish.publishNow(ORG, ACTOR, post.id);
    expect(res.status).toBe("published");
    expect(calls).toHaveLength(1);
    expect(calls[0].url.endsWith("/page-1/feed")).toBe(true);
  });
});

describe("SU2 recurrence chain", () => {
  it("recurring post publishes → exactly one next instance at scheduledAt + interval (no drift)", async () => {
    const db = fakeDb(); seedIntegration(db); seedAccount(db);
    const scheduledAt = new Date("2026-10-02T04:00:00.000Z"); // a Friday
    const post = seedPost(db, {
      status: "scheduled", scheduledAt,
      seriesId: "series-1", recurrenceFrequency: "weekly", recurrenceInterval: 2,
      caption: "শুক্রবারের অফার", firstCommentText: "#friday", firstCommentStatus: "pending",
    });
    const { fetchFn } = stubFetch((url) => {
      if (url.endsWith("/page-1/feed")) return { body: { id: "page-1_600" } };
      if (url.endsWith("/comments")) return { body: { id: "c-9" } };
      return { body: {} };
    });
    const { publish } = services(db, fetchFn);
    const res = await publish.publishNow(ORG, ACTOR, post.id);
    expect(res.status).toBe("published");
    expect(db.socialPosts).toHaveLength(2);
    const next = db.socialPosts.find((p: Row) => p.id !== post.id);
    expect(next.status).toBe("scheduled");
    expect(new Date(next.scheduledAt).toISOString()).toBe("2026-10-16T04:00:00.000Z");
    expect(next.seriesId).toBe("series-1");
    expect(next.recurrenceFrequency).toBe("weekly");
    expect(next.recurrenceInterval).toBe(2);
    expect(next.caption).toBe("শুক্রবারের অফার");
    expect(next.firstCommentText).toBe("#friday");
    expect(next.firstCommentStatus).toBe("pending");
    expect(next.attempts).toBe(0);
    expect(db.auditRows.some((r: Row) => r.action === "social.post_recurrence_chained")).toBe(true);

    // Second finalize → idempotent, still exactly one next instance.
    await (publish as any).finalizeRecurrence(stored(db, post.id));
    expect(db.socialPosts).toHaveLength(2);
  });

  it("monthly recurrence clamps the day (Jan 31 → Feb 28)", async () => {
    const db = fakeDb(); seedIntegration(db); seedAccount(db);
    const post = seedPost(db, {
      status: "scheduled", scheduledAt: new Date("2026-01-31T06:00:00.000Z"),
      seriesId: "series-m", recurrenceFrequency: "monthly", recurrenceInterval: 1,
    });
    const { fetchFn } = stubFetch((url) => {
      if (url.endsWith("/page-1/feed")) return { body: { id: "page-1_601" } };
      return { body: {} };
    });
    const { publish } = services(db, fetchFn);
    await publish.publishNow(ORG, ACTOR, post.id);
    const next = db.socialPosts.find((p: Row) => p.id !== post.id);
    expect(new Date(next.scheduledAt).toISOString()).toBe("2026-02-28T06:00:00.000Z");
  });

  it("non-recurring post → no chain instance is created", async () => {
    const db = fakeDb(); seedIntegration(db); seedAccount(db);
    const post = seedPost(db, { status: "scheduled", scheduledAt: new Date(Date.now() - 1000) });
    const { fetchFn } = stubFetch((url) => {
      if (url.endsWith("/page-1/feed")) return { body: { id: "page-1_602" } };
      return { body: {} };
    });
    const { publish } = services(db, fetchFn);
    await publish.publishNow(ORG, ACTOR, post.id);
    expect(db.socialPosts).toHaveLength(1);
  });
});
