process.env.ENCRYPTION_KEY = Buffer.alloc(32, 9).toString("base64");

import { SocialService } from "./social.service";
import { SocialPublishService } from "./social-publish.service";
import { SocialInsightsService, computeBestTime, engagementScore, BEST_TIME_MIN_POSTS } from "./social-insights.service";
import { MetaSocialPublisher } from "./meta-publisher";
import { encryptJson } from "../integrations/crypto";

/**
 * SP7 — Post Insights + Approval Flow, proven at the service and
 * Graph-client boundaries (stub fetch into MetaSocialPublisher —
 * the SP6-spec pattern):
 * - Insights are stored EXACTLY as Graph returns them: a Page
 *   post's reactions/comments/shares; an omitted metric (shares)
 *   stays ABSENT from the stored object — never 0. IG: media
 *   object counts + /insights metrics per media type (video →
 *   plays, not impressions); an insights-edge refusal keeps the
 *   object counts. Platform errors surface verbatim as 400s;
 *   token death marks the account "error" with Meta's message.
 * - Bulk refresh: last-30-days window, <1h-old posts skipped,
 *   per-post results, one failure never fails the batch,
 *   sequential in publishedAt-desc order.
 * - Best-time: a pure function over the org's OWN posts — null
 *   below 10 scored posts, tz-correct weekday/hour bucketing,
 *   engagement uses only fields present.
 * - Approval: setting OFF = pre-SP7 behaviour exactly (approval
 *   state stays null). Setting ON: OWNER/ADMIN posts auto-approved
 *   (create + approver-submit), MM submits → pending + approvers
 *   notified; approve/reject are OWNER/ADMIN-only (403 for MM),
 *   reject REQUIRES a note; pending/rejected posts cannot be
 *   scheduled (409), published by hand (409), or published by the
 *   worker (claim-time re-check returns them to draft with the
 *   reason written on the post). Editing an approved/pending post
 *   voids its approval state.
 *
 * Evidence ceiling: no real Meta app/Page token exists in this
 * sandbox — these specs prove request shapes and state handling,
 * never a real Graph insights call.
 */
const ORG = "org-1";
const OWNER = "owner-1";
const ADMIN = "admin-1";
const MM = "mm-1";
const PAGE_TOKEN = "page-token-sp7";
const TOKEN_DEAD_MSG = "Error validating access token: The session has expired because the user changed their password.";
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
  const sortBy = (rows: Row[], orderBy: any) => {
    if (!orderBy) return rows;
    const [field, dir] = Object.entries(orderBy)[0] as [string, string];
    const sorted = [...rows].sort((a, b) =>
      (new Date(a[field] ?? 0).getTime() - new Date(b[field] ?? 0).getTime()) * (dir === "desc" ? -1 : 1));
    return sorted;
  };
  return {
    findMany: jest.fn(async (args: any = {}) => {
      let rows = store.filter((r) => matches(r, args.where));
      rows = sortBy(rows, args.orderBy);
      if (args.take) rows = rows.slice(0, args.take);
      return rows.map((r) => ({ ...r }));
    }),
    findFirst: jest.fn(async (args: any = {}) => {
      const rows = sortBy(store.filter((r) => matches(r, args.where)), args.orderBy);
      const row = rows[0];
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
    organizations: [] as Row[], socialAccounts: [] as Row[], socialPosts: [] as Row[],
    mediaAssets: [] as Row[], integrations: [] as Row[], credentials: [] as Row[],
    memberships: [] as Row[], notifications: [] as Row[], auditRows: [] as Row[],
  };
  db.organization = table(db.organizations);
  db.socialAccount = table(db.socialAccounts);
  db.mediaAsset = table(db.mediaAssets);
  db.membership = table(db.memberships);
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
        platformUrl: null, error: null, attempts: 0, mediaRefs: [],
        insights: null, insightsFetchedAt: null,
        approvalStatus: null, submittedById: null, reviewedById: null, reviewNote: null,
        ...data,
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
  return { fetchFn: fetchFn as unknown as typeof fetch, calls };
}

function services(db: any, fetchFn?: typeof fetch) {
  const audit = { log: jest.fn(async (input: any) => { db.auditRows.push({ id: `audit-${db.auditRows.length + 1}`, createdAt: new Date(), ...input }); }) };
  const social = new SocialService(db as any, audit as any);
  const publisher = new MetaSocialPublisher(fetchFn ?? (async () => { throw new Error("no fetch expected"); }) as any, { pollIntervalMs: 0, maxPolls: 5, sleep: async () => {} });
  const publish = new SocialPublishService(db as any, audit as any, social, publisher);
  const insights = new SocialInsightsService(db as any, audit as any, social, publish, publisher);
  return { social, publish, insights, publisher, audit };
}

function seedOrg(db: any, over: Row = {}) {
  const row = { id: ORG, timezone: "Asia/Dhaka", socialRequireApproval: false, ...over };
  db.organizations.push(row);
  return row;
}

function seedMember(db: any, userId: string, role: string) {
  const row = { id: `mem-${userId}`, organizationId: ORG, userId, role, status: "ACTIVE" };
  db.memberships.push(row);
  return row;
}

function seedAccount(db: any, over: Row = {}) {
  const integration = {
    id: `int-${++seq}`, organizationId: ORG, provider: "meta_social", status: "CONNECTED",
    externalAccountId: "page-1",
  };
  db.integrations.push(integration);
  db.credentials.push({
    id: `cred-${++seq}`, integrationId: integration.id,
    encryptedData: encryptJson({ accessToken: PAGE_TOKEN, pageId: "page-1" }),
  });
  const account = {
    id: `acct-${++seq}`, organizationId: ORG, integrationId: integration.id,
    platform: "meta_page", externalId: "page-1", name: "Shop One", username: null,
    pictureUrl: null, status: "connected", lastError: null, createdById: OWNER,
    createdAt: new Date(), updatedAt: new Date(), ...over,
  };
  db.socialAccounts.push(account);
  return account;
}

function seedPost(db: any, accountId: string, over: Row = {}) {
  const row = {
    id: `post-${++seq}`, organizationId: ORG, socialAccountId: accountId,
    caption: "ঈদের নতুন কালেকশন এসেছে!", linkUrl: null, mediaRefs: [],
    status: "draft", scheduledAt: null, publishedAt: null, platformPostId: null,
    platformUrl: null, error: null, attempts: 0,
    insights: null, insightsFetchedAt: null,
    approvalStatus: null, submittedById: null, reviewedById: null, reviewNote: null,
    createdById: MM, createdAt: new Date(), updatedAt: new Date(), ...over,
  };
  db.socialPosts.push(row);
  return row;
}

const stored = (db: any, id: string) => db.socialPosts.find((p: Row) => p.id === id);

// ----------------------------------------------------------------
// Insights — stored exactly as returned
// ----------------------------------------------------------------

describe("SP7 insights refresh (single)", () => {
  it("Page post: reactions/comments/shares stored exactly; fetchedAt + audit set", async () => {
    const db = fakeDb(); seedOrg(db);
    const account = seedAccount(db);
    const post = seedPost(db, account.id, {
      status: "published", platformPostId: "page-1_9001", publishedAt: new Date(Date.now() - 3 * 3600_000),
    });
    const { fetchFn, calls } = stubFetch((url) => {
      if (new URL(url).pathname.endsWith("/page-1_9001")) {
        return { body: { reactions: { summary: { total_count: 12 } }, comments: { summary: { total_count: 3 } }, shares: { count: 2 } } };
      }
      throw new Error(`unexpected ${url}`);
    });
    const { insights } = services(db, fetchFn);
    const out = await insights.refreshPostInsights(ORG, OWNER, post.id);
    expect(stored(db, post.id).insights).toEqual({ platform: "meta_page", reactions: 12, comments: 3, shares: 2 });
    expect(stored(db, post.id).insightsFetchedAt).toBeInstanceOf(Date);
    expect(out.insights).toEqual({ platform: "meta_page", reactions: 12, comments: 3, shares: 2 });
    expect(calls[0].params.get("fields")).toContain("reactions.summary");
    expect(db.auditRows.some((r: Row) => r.action === "social.post_insights_refreshed" && r.entityId === post.id)).toBe(true);
  });

  it("Page post: Graph omits shares → the stored object has NO shares key (never 0)", async () => {
    const db = fakeDb(); seedOrg(db);
    const account = seedAccount(db);
    const post = seedPost(db, account.id, {
      status: "published", platformPostId: "page-1_9002", publishedAt: new Date(Date.now() - 3 * 3600_000),
    });
    const { fetchFn } = stubFetch(() => ({
      body: { reactions: { summary: { total_count: 0 } }, comments: { summary: { total_count: 0 } } },
    }));
    const { insights } = services(db, fetchFn);
    await insights.refreshPostInsights(ORG, OWNER, post.id);
    const storedInsights = stored(db, post.id).insights;
    expect(storedInsights).toEqual({ platform: "meta_page", reactions: 0, comments: 0 });
    expect("shares" in storedInsights).toBe(false);
  });

  it("Instagram image: object counts + insights metrics stored; metric list asks impressions", async () => {
    const db = fakeDb(); seedOrg(db);
    const account = seedAccount(db, { platform: "instagram", externalId: "ig-1" });
    const post = seedPost(db, account.id, {
      status: "published", platformPostId: "igmedia-1", publishedAt: new Date(Date.now() - 5 * 3600_000),
      mediaRefs: [{ assetId: "a1", kind: "image" }],
    });
    const { fetchFn, calls } = stubFetch((url) => {
      const path = new URL(url).pathname;
      if (path.endsWith("/igmedia-1/insights")) {
        return { body: { data: [
          { name: "impressions", values: [{ value: 900 }] },
          { name: "reach", values: [{ value: 700 }] },
          { name: "saved", values: [{ value: 11 }] },
        ] } };
      }
      if (path.endsWith("/igmedia-1")) return { body: { like_count: 40, comments_count: 5 } };
      throw new Error(`unexpected ${url}`);
    });
    const { insights } = services(db, fetchFn);
    await insights.refreshPostInsights(ORG, OWNER, post.id);
    expect(stored(db, post.id).insights).toEqual({
      platform: "instagram", likeCount: 40, commentsCount: 5, impressions: 900, reach: 700, saved: 11,
    });
    const insightsCall = calls.find((c) => c.url.includes("/insights"));
    expect(insightsCall?.params.get("metric")).toBe("impressions,reach,saved");
  });

  it("Instagram video (Reels): metric list asks plays, NOT impressions", async () => {
    const db = fakeDb(); seedOrg(db);
    const account = seedAccount(db, { platform: "instagram", externalId: "ig-1" });
    const post = seedPost(db, account.id, {
      status: "published", platformPostId: "igmedia-2", publishedAt: new Date(Date.now() - 5 * 3600_000),
      mediaRefs: [{ assetId: "a2", kind: "video" }],
    });
    const { fetchFn, calls } = stubFetch((url) => {
      const path = new URL(url).pathname;
      if (path.endsWith("/igmedia-2/insights")) {
        return { body: { data: [
          { name: "reach", values: [{ value: 300 }] },
          { name: "plays", values: [{ value: 450 }] },
          { name: "saved", values: [{ value: 2 }] },
        ] } };
      }
      if (path.endsWith("/igmedia-2")) return { body: { like_count: 9, comments_count: 1 } };
      throw new Error(`unexpected ${url}`);
    });
    const { insights } = services(db, fetchFn);
    await insights.refreshPostInsights(ORG, OWNER, post.id);
    expect(stored(db, post.id).insights).toEqual({
      platform: "instagram", likeCount: 9, commentsCount: 1, reach: 300, plays: 450, saved: 2,
    });
    const insightsCall = calls.find((c) => c.url.includes("/insights"));
    expect(insightsCall?.params.get("metric")).toBe("reach,plays,saved");
  });

  it("Instagram: insights-edge refusal keeps the object counts (metrics stay absent)", async () => {
    const db = fakeDb(); seedOrg(db);
    const account = seedAccount(db, { platform: "instagram", externalId: "ig-1" });
    const post = seedPost(db, account.id, {
      status: "published", platformPostId: "igmedia-3", publishedAt: new Date(Date.now() - 5 * 3600_000),
      mediaRefs: [{ assetId: "a3", kind: "image" }],
    });
    const { fetchFn } = stubFetch((url) => {
      const path = new URL(url).pathname;
      if (path.endsWith("/insights")) {
        return { status: 400, body: { error: { message: "(#100) The Media Insights API is not available for this media" } } };
      }
      return { body: { like_count: 3, comments_count: 0 } };
    });
    const { insights } = services(db, fetchFn);
    await insights.refreshPostInsights(ORG, OWNER, post.id);
    expect(stored(db, post.id).insights).toEqual({ platform: "instagram", likeCount: 3, commentsCount: 0 });
  });

  it("unpublished post → Bengali 400; published without platform id → 400; fetch never called", async () => {
    const db = fakeDb(); seedOrg(db);
    const account = seedAccount(db);
    const draft = seedPost(db, account.id, { status: "draft" });
    const noId = seedPost(db, account.id, { status: "published", platformPostId: null, publishedAt: new Date() });
    const { fetchFn, calls } = stubFetch(() => ({ body: {} }));
    const { insights } = services(db, fetchFn);
    await expect(insights.refreshPostInsights(ORG, OWNER, draft.id)).rejects.toThrow("শুধু Published পোস্টের Data আনা যায়");
    await expect(insights.refreshPostInsights(ORG, OWNER, noId.id)).rejects.toThrow("শুধু Published পোস্টের Data আনা যায়");
    expect(calls).toHaveLength(0);
  });

  it("platform error surfaces VERBATIM as the 400 and stores nothing", async () => {
    const db = fakeDb(); seedOrg(db);
    const account = seedAccount(db);
    const post = seedPost(db, account.id, {
      status: "published", platformPostId: "page-1_9003", publishedAt: new Date(Date.now() - 3 * 3600_000),
    });
    const { fetchFn } = stubFetch(() => ({
      status: 400, body: { error: { message: "(#200) Requires pages_read_engagement permission" } },
    }));
    const { insights } = services(db, fetchFn);
    await expect(insights.refreshPostInsights(ORG, OWNER, post.id))
      .rejects.toThrow("(#200) Requires pages_read_engagement permission");
    expect(stored(db, post.id).insights).toBeNull();
    expect(stored(db, post.id).insightsFetchedAt).toBeNull();
    // A permission error is NOT token death — the account stays connected.
    expect(db.socialAccounts.find((a: Row) => a.id === account.id).status).toBe("connected");
  });

  it("token death: account marked error with Meta's verbatim message; error surfaces", async () => {
    const db = fakeDb(); seedOrg(db);
    const account = seedAccount(db);
    const post = seedPost(db, account.id, {
      status: "published", platformPostId: "page-1_9004", publishedAt: new Date(Date.now() - 3 * 3600_000),
    });
    const { fetchFn } = stubFetch(() => ({
      status: 401, body: { error: { message: TOKEN_DEAD_MSG } },
    }));
    const { insights } = services(db, fetchFn);
    await expect(insights.refreshPostInsights(ORG, OWNER, post.id)).rejects.toThrow(TOKEN_DEAD_MSG);
    const acc = db.socialAccounts.find((a: Row) => a.id === account.id);
    expect(acc.status).toBe("error");
    expect(acc.lastError).toBe(TOKEN_DEAD_MSG);
    expect(stored(db, post.id).insights).toBeNull();
  });

  it("cross-org post id → 404", async () => {
    const db = fakeDb(); seedOrg(db);
    const account = seedAccount(db);
    const post = seedPost(db, account.id, { status: "published", platformPostId: "x1", publishedAt: new Date() });
    const { insights } = services(db);
    await expect(insights.refreshPostInsights("org-2", OWNER, post.id)).rejects.toMatchObject({ code: "social.socialPostNotFoundInThis" });
  });
});

describe("SP7 insights bulk refresh", () => {
  it("window + <1h skip + failure isolation + sequential newest-first + one audit", async () => {
    const db = fakeDb(); seedOrg(db);
    const account = seedAccount(db);
    const fresh = seedPost(db, account.id, {
      status: "published", platformPostId: "page-1_new", publishedAt: new Date(Date.now() - 30 * 60_000),
    });
    const okPost = seedPost(db, account.id, {
      status: "published", platformPostId: "page-1_ok", publishedAt: new Date(Date.now() - 2 * 3600_000),
    });
    const failPost = seedPost(db, account.id, {
      status: "published", platformPostId: "page-1_fail", publishedAt: new Date(Date.now() - 4 * 3600_000),
    });
    seedPost(db, account.id, {
      status: "published", platformPostId: "page-1_old", publishedAt: new Date(Date.now() - 40 * 86_400_000),
    });
    const { fetchFn, calls } = stubFetch((url) => {
      const path = new URL(url).pathname;
      if (path.endsWith("/page-1_ok")) {
        return { body: { reactions: { summary: { total_count: 7 } }, comments: { summary: { total_count: 1 } }, shares: { count: 0 } } };
      }
      if (path.endsWith("/page-1_fail")) {
        return { status: 400, body: { error: { message: "(#10) Application does not have permission" } } };
      }
      throw new Error(`unexpected ${url}`);
    });
    const { insights } = services(db, fetchFn);
    const res = await insights.refreshAllInsights(ORG, OWNER);
    expect(res.total).toBe(3); // the 40-day-old post is outside the window
    expect(res.refreshed).toBe(1);
    expect(res.failed).toBe(1);
    expect(res.skippedTooNew).toBe(1);
    const byId = new Map(res.results.map((r: any) => [r.postId, r]));
    expect(byId.get(okPost.id)?.status).toBe("refreshed");
    expect(byId.get(failPost.id)).toEqual({ postId: failPost.id, status: "failed", error: "(#10) Application does not have permission" });
    expect(byId.get(fresh.id)?.status).toBe("skipped_too_new");
    // Sequential, newest first: ok (2h old) is fetched before fail (4h old); fresh/old never fetched.
    expect(calls.map((c) => c.url)).toEqual([
      expect.stringContaining("/page-1_ok"),
      expect.stringContaining("/page-1_fail"),
    ]);
    expect(stored(db, okPost.id).insights).toEqual({ platform: "meta_page", reactions: 7, comments: 1, shares: 0 });
    const audits = db.auditRows.filter((r: Row) => r.action === "social.insights_bulk_refreshed");
    expect(audits).toHaveLength(1);
    expect(audits[0].metadata).toEqual({ total: 3, refreshed: 1, failed: 1, skippedTooNew: 1 });
  });
});

describe("SP7 insights summary", () => {
  it("totals sum ONLY over posts that have each metric, each with its own basis count", async () => {
    const db = fakeDb(); seedOrg(db);
    const account = seedAccount(db);
    seedPost(db, account.id, {
      status: "published", platformPostId: "p1", publishedAt: new Date(),
      insights: { platform: "meta_page", reactions: 10, comments: 2, shares: 1 },
    });
    seedPost(db, account.id, {
      status: "published", platformPostId: "p2", publishedAt: new Date(),
      insights: { platform: "meta_page", reactions: 5, comments: 1 }, // no shares key
    });
    seedPost(db, account.id, { status: "published", platformPostId: "p3", publishedAt: new Date(), insights: null });
    const { insights } = services(db);
    const summary = await insights.getInsightsSummary(ORG);
    expect(summary.postsWithInsights).toBe(2);
    expect(summary.totals.reactions).toEqual({ total: 15, posts: 2 });
    expect(summary.totals.comments).toEqual({ total: 3, posts: 2 });
    expect(summary.totals.shares).toEqual({ total: 1, posts: 1 }); // basis = only the post that HAS shares
    expect(summary.totals.likeCount).toBeUndefined();
    expect(summary.bestTime).toBeNull(); // only 2 scored posts < 10
  });
});

// ----------------------------------------------------------------
// Best-time pure function
// ----------------------------------------------------------------

describe("SP7 best-time heuristic (pure)", () => {
  it("engagementScore uses only present fields; IG ignores reach", () => {
    expect(engagementScore({ platform: "meta_page", reactions: 2, comments: 3 })).toBe(5);
    expect(engagementScore({ platform: "meta_page", reactions: 2, comments: 3, shares: 4 })).toBe(9);
    expect(engagementScore({ platform: "instagram", likeCount: 4, commentsCount: 1, reach: 999 })).toBe(5);
    expect(engagementScore({ platform: "meta_page" })).toBeNull();
    expect(engagementScore({})).toBeNull();
    expect(engagementScore(null)).toBeNull();
    expect(engagementScore(undefined)).toBeNull();
  });

  it(`below ${BEST_TIME_MIN_POSTS} scored posts → null even with data`, () => {
    const posts = Array.from({ length: BEST_TIME_MIN_POSTS - 1 }, (_, i) => ({
      publishedAt: new Date(Date.UTC(2026, 9, 5, 3, 0, 0) + i * 60_000),
      insights: { platform: "meta_page", reactions: 10, comments: 0, shares: 0 },
    }));
    // Posts with insights but NO engagement fields never count.
    posts.push({ publishedAt: new Date(), insights: { platform: "meta_page" } } as any);
    expect(computeBestTime(posts, "Asia/Dhaka")).toBeNull();
  });

  it("strongest bucket wins: Monday 09:00 Dhaka", () => {
    const posts: { publishedAt: Date; insights: any }[] = [];
    // 6 posts, Monday 2026-10-05 03:00Z = 09:00 Dhaka, score 10 each → 60
    for (let i = 0; i < 6; i++) {
      posts.push({ publishedAt: new Date(Date.UTC(2026, 9, 5, 3, 0, 0)), insights: { platform: "meta_page", reactions: 10 } });
    }
    // 5 posts, Wednesday 2026-10-07 10:00Z = 16:00 Dhaka, score 5 each → 25
    for (let i = 0; i < 5; i++) {
      posts.push({ publishedAt: new Date(Date.UTC(2026, 9, 7, 10, 0, 0)), insights: { platform: "meta_page", reactions: 5 } });
    }
    const best = computeBestTime(posts, "Asia/Dhaka");
    expect(best).toEqual({ weekday: 1, hour: 9, score: 60, postsConsidered: 11 });
  });

  it("bucketing follows the ORG timezone, not UTC", () => {
    // 2026-10-04T20:30Z is Sunday 20:30 UTC but Monday 02:30 in Dhaka.
    const posts = Array.from({ length: 10 }, () => ({
      publishedAt: new Date(Date.UTC(2026, 9, 4, 20, 30, 0)),
      insights: { platform: "instagram", likeCount: 2, commentsCount: 0 },
    }));
    expect(computeBestTime(posts, "Asia/Dhaka")).toEqual({ weekday: 1, hour: 2, score: 20, postsConsidered: 10 });
    expect(computeBestTime(posts, "UTC")).toEqual({ weekday: 0, hour: 20, score: 20, postsConsidered: 10 });
  });
});

// ----------------------------------------------------------------
// Approval flow
// ----------------------------------------------------------------

describe("SP7 approval flow", () => {
  function setupApprovalDb(settingOn: boolean) {
    const db = fakeDb();
    seedOrg(db, { socialRequireApproval: settingOn });
    seedMember(db, OWNER, "OWNER");
    seedMember(db, ADMIN, "ADMIN");
    seedMember(db, MM, "MARKETING_MANAGER");
    const account = seedAccount(db);
    return { db, account };
  }

  it("settings: get/update round-trip + audit (default off)", async () => {
    const db = fakeDb(); seedOrg(db);
    const { social } = services(db);
    // SU9: the settings response also carries socialApprovalTwoStep
    // (default false — the SP7 one-step behaviour below is unchanged).
    // SN2: it also carries socialRequireClientApproval (default
    // false — the client-approval gate is off unless switched on).
    expect(await social.getSocialSettings(ORG)).toEqual({ socialRequireApproval: false, socialApprovalTwoStep: false, socialRequireClientApproval: false });
    expect(await social.updateSocialSettings(ORG, OWNER, { socialRequireApproval: true }))
      .toEqual({ socialRequireApproval: true, socialApprovalTwoStep: false, socialRequireClientApproval: false });
    expect(db.organizations[0].socialRequireApproval).toBe(true);
    expect(db.auditRows.some((r: Row) => r.action === "social.settings_updated" && r.metadata.socialRequireApproval === true)).toBe(true);
    expect(await social.getSocialSettings(ORG)).toEqual({ socialRequireApproval: true, socialApprovalTwoStep: false, socialRequireClientApproval: false });
  });

  it("setting OFF: behaviour exactly as before — MM post has null approval state and schedules fine", async () => {
    const { db, account } = setupApprovalDb(false);
    const { social } = services(db);
    const post = await social.createPost(ORG, MM, { socialAccountId: account.id, caption: "সাধারণ পোস্ট" });
    expect(post.approvalStatus).toBeNull();
    const at = new Date(Date.now() + 3600_000).toISOString();
    const scheduled = await social.schedulePost(ORG, MM, post.id, { scheduledAt: at });
    expect(scheduled.status).toBe("scheduled");
  });

  it("setting ON: OWNER-authored post auto-approved at creation; MM post has no approval state", async () => {
    const { db, account } = setupApprovalDb(true);
    const { social } = services(db);
    const ownerPost = await social.createPost(ORG, OWNER, { socialAccountId: account.id, caption: "মালিকের পোস্ট" });
    expect(ownerPost.approvalStatus).toBe("approved");
    expect(ownerPost.reviewedById).toBe(OWNER);
    const mmPost = await social.createPost(ORG, MM, { socialAccountId: account.id, caption: "এমএম-এর পোস্ট" });
    expect(mmPost.approvalStatus).toBeNull();
    expect(mmPost.reviewedById).toBeNull();
  });

  it("submit: MM → pending + approvers notified (author not); approver submit → immediate approval", async () => {
    const { db, account } = setupApprovalDb(true);
    const { social } = services(db);
    const post = await social.createPost(ORG, MM, { socialAccountId: account.id, caption: "অনুমোদন চাই" });
    const submitted = await social.submitForApproval(ORG, MM, post.id);
    expect(submitted.approvalStatus).toBe("pending");
    expect(submitted.submittedById).toBe(MM);
    const pending = db.notifications.filter((n: Row) => n.type === "social_post_pending_approval");
    expect(pending.map((n: Row) => n.userId).sort()).toEqual([ADMIN, OWNER].sort());
    expect(db.auditRows.some((r: Row) => r.action === "social.post_approval_submitted" && r.entityId === post.id)).toBe(true);
    // Double submit → 409.
    await expect(social.submitForApproval(ORG, MM, post.id)).rejects.toThrow("ইতিমধ্যে অনুমোদনের অপেক্ষায়");
    // An approver submitting someone else's fresh draft approves it at once.
    const post2 = await social.createPost(ORG, MM, { socialAccountId: account.id, caption: "দ্বিতীয় পোস্ট" });
    const byOwner = await social.submitForApproval(ORG, OWNER, post2.id);
    expect(byOwner.approvalStatus).toBe("approved");
    expect(byOwner.reviewedById).toBe(OWNER);
  });

  it("submit while the setting is OFF → honest 400", async () => {
    const { db, account } = setupApprovalDb(false);
    const { social } = services(db);
    const post = await social.createPost(ORG, MM, { socialAccountId: account.id, caption: "পোস্ট" });
    await expect(social.submitForApproval(ORG, MM, post.id)).rejects.toThrow("অনুমোদন ব্যবস্থা চালু নেই");
  });

  it("approve: MM gets 403; ADMIN approves; author notified; non-pending → 409", async () => {
    const { db, account } = setupApprovalDb(true);
    const { social } = services(db);
    const post = await social.createPost(ORG, MM, { socialAccountId: account.id, caption: "পোস্ট" });
    await social.submitForApproval(ORG, MM, post.id);
    await expect(social.approvePost(ORG, MM, post.id)).rejects.toThrow("শুধু OWNER/ADMIN");
    const approved = await social.approvePost(ORG, ADMIN, post.id);
    expect(approved.approvalStatus).toBe("approved");
    expect(approved.reviewedById).toBe(ADMIN);
    const notes = db.notifications.filter((n: Row) => n.type === "social_post_approved");
    expect(notes).toHaveLength(1);
    expect(notes[0].userId).toBe(MM);
    await expect(social.approvePost(ORG, OWNER, post.id)).rejects.toThrow("অনুমোদনের অপেক্ষায় নেই");
  });

  it("reject: note is REQUIRED; rejection stores the note and notifies the author with it", async () => {
    const { db, account } = setupApprovalDb(true);
    const { social } = services(db);
    const post = await social.createPost(ORG, MM, { socialAccountId: account.id, caption: "পোস্ট" });
    await social.submitForApproval(ORG, MM, post.id);
    await expect(social.rejectPost(ORG, OWNER, post.id, { note: "   " })).rejects.toThrow("কারণ (note) লিখতে হবে");
    await expect(social.rejectPost(ORG, MM, post.id, { note: "দাম ভুল আছে" })).rejects.toThrow("শুধু OWNER/ADMIN");
    const rejected = await social.rejectPost(ORG, OWNER, post.id, { note: "দাম ভুল আছে — ঠিক করুন" });
    expect(rejected.approvalStatus).toBe("rejected");
    expect(rejected.reviewNote).toBe("দাম ভুল আছে — ঠিক করুন");
    expect(rejected.reviewedById).toBe(OWNER);
    const notes = db.notifications.filter((n: Row) => n.type === "social_post_rejected");
    expect(notes).toHaveLength(1);
    expect(notes[0].userId).toBe(MM);
    expect(notes[0].body).toContain("দাম ভুল আছে — ঠিক করুন");
    const audit = db.auditRows.find((r: Row) => r.action === "social.post_rejected");
    expect(audit?.metadata).toEqual({ note: "দাম ভুল আছে — ঠিক করুন" });
  });

  it("schedule gate: pending and rejected posts 409; approved schedules fine", async () => {
    const { db, account } = setupApprovalDb(true);
    const { social } = services(db);
    const at = new Date(Date.now() + 3600_000).toISOString();
    const pending = seedPost(db, account.id, { approvalStatus: "pending", submittedById: MM });
    await expect(social.schedulePost(ORG, MM, pending.id, { scheduledAt: at })).rejects.toThrow("অনুমোদিত নয়");
    const rejected = seedPost(db, account.id, { approvalStatus: "rejected", reviewNote: "x" });
    await expect(social.schedulePost(ORG, MM, rejected.id, { scheduledAt: at })).rejects.toThrow("অনুমোদিত নয়");
    const unsubmitted = seedPost(db, account.id, {});
    await expect(social.schedulePost(ORG, MM, unsubmitted.id, { scheduledAt: at })).rejects.toThrow("অনুমোদিত নয়");
    const approved = seedPost(db, account.id, { approvalStatus: "approved", reviewedById: OWNER });
    const ok = await social.schedulePost(ORG, MM, approved.id, { scheduledAt: at });
    expect(ok.status).toBe("scheduled");
  });

  it("publish-now gate: unapproved post → 409 before any claim", async () => {
    const { db, account } = setupApprovalDb(true);
    const { publish } = services(db);
    const fn = jest.fn(async () => ({ platformPostId: "x", platformUrl: null }));
    publish.publishToPlatform = fn as any;
    const pending = seedPost(db, account.id, { approvalStatus: "pending", submittedById: MM });
    await expect(publish.publishNow(ORG, MM, pending.id)).rejects.toThrow("অনুমোদিত নয়");
    expect(fn).not.toHaveBeenCalled();
    expect(stored(db, pending.id).status).toBe("draft");
  });

  it("worker re-check: approval revoked after scheduling → back to draft with the reason on the post; publish never runs", async () => {
    const { db, account } = setupApprovalDb(true);
    const { publish } = services(db);
    const fn = jest.fn(async () => ({ platformPostId: "x", platformUrl: null }));
    publish.publishToPlatform = fn as any;
    const post = seedPost(db, account.id, {
      status: "scheduled", scheduledAt: new Date(Date.now() - 60_000),
      approvalStatus: "rejected", reviewNote: "পরে বাতিল হয়েছে",
    });
    const counts = await publish.runDuePublishes(ORG);
    expect(counts.blocked).toBe(1);
    expect(counts.published).toBe(0);
    expect(fn).not.toHaveBeenCalled();
    const after = stored(db, post.id);
    expect(after.status).toBe("draft");
    expect(after.scheduledAt).toBeNull();
    expect(after.error).toContain("অনুমোদন না থাকায় পোস্টটি প্রকাশ হয়নি");
  });

  it("worker: approved due post publishes normally while the setting is on", async () => {
    const { db, account } = setupApprovalDb(true);
    const { publish } = services(db);
    const fn = jest.fn(async () => ({ platformPostId: "page-1_777", platformUrl: "https://www.facebook.com/777" }));
    publish.publishToPlatform = fn as any;
    const post = seedPost(db, account.id, {
      status: "scheduled", scheduledAt: new Date(Date.now() - 60_000),
      approvalStatus: "approved", reviewedById: OWNER,
    });
    const counts = await publish.runDuePublishes(ORG);
    expect(counts.published).toBe(1);
    expect(counts.blocked).toBe(0);
    expect(stored(db, post.id).status).toBe("published");
    expect(stored(db, post.id).platformPostId).toBe("page-1_777");
  });

  it("editing an approved post voids its approval (must be re-submitted); editing with the setting OFF changes nothing", async () => {
    const { db, account } = setupApprovalDb(true);
    const { social } = services(db);
    const post = seedPost(db, account.id, {
      approvalStatus: "approved", submittedById: MM, reviewedById: OWNER,
    });
    const edited = await social.updatePost(ORG, MM, post.id, { caption: "সম্পাদিত ক্যাপশন" });
    expect(edited.caption).toBe("সম্পাদিত ক্যাপশন");
    expect(edited.approvalStatus).toBeNull();
    expect(edited.reviewedById).toBeNull();
    const audit = db.auditRows.find((r: Row) => r.action === "social.post_updated");
    expect(audit?.metadata?.approvalReset).toBe(true);
  });
});
