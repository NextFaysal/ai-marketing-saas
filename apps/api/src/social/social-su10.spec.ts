process.env.ENCRYPTION_KEY = Buffer.alloc(32, 9).toString("base64");

import { BadRequestException } from "@nestjs/common";
import { SocialService } from "./social.service";
import { MAX_PUBLISH_ATTEMPTS, SocialPublishService } from "./social-publish.service";
import { SocialOAuthService } from "./social-oauth.service";
import { SocialHealthService, deriveSocialAccountHealth, normalizeFailureSignature } from "./social-health.service";
import { MetaSocialPublisher } from "./meta-publisher";
import { encryptJson } from "../integrations/crypto";

/**
 * SU10 — Account Health + Failure Center, proven at the service
 * boundary (SP6/SU9 fake-Prisma + stubbed-fetch pattern):
 * - Meta check-health: Graph identity success (stamp + status
 *   kept), error → connected recovery, token-death failure
 *   (status "error" + Meta's verbatim as lastError + stamp),
 *   non-token failure (status/lastError untouched, stamp set),
 *   disconnected account refused before any Graph call.
 * - TikTok/YouTube: SocialOAuthService.ensureAccessToken is the
 *   check — success (incl. error recovery), plain resolver
 *   failure (verbatim in the response, status untouched), and
 *   a refresh death the RESOLVER itself marks "error" (the
 *   health service reports that stored truth, adds no marking).
 * - GET accounts/health labels: never_checked / error / ok,
 *   exact field list, no credential/integration material.
 * - GET posts/failures: grouping by normalized first-line
 *   signature (whitespace + later lines collapse), the honest
 *   "(no error recorded)" bucket, count-then-latest ordering.
 * - Retry: not-failed → Bengali 400; exhausted attempts reset
 *   to 0 WITH the reset audit, remaining attempts NOT reset;
 *   delegation to publishNow — its approval gate refusal and
 *   the SU1 pre-flight failure propagate unchanged.
 *
 * Evidence ceiling: no real Meta/TikTok/Google account exists in
 * this sandbox — request shapes and state handling only.
 */
const ORG = "org-1";
const OWNER = "owner-1";
const PAGE_TOKEN = "PAGE-TOKEN-1";
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
    return [...rows].sort((a, b) =>
      (new Date(a[field] ?? 0).getTime() - new Date(b[field] ?? 0).getTime()) * (dir === "desc" ? -1 : 1));
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
    integrations: [] as Row[], credentials: [] as Row[],
    memberships: [] as Row[], notifications: [] as Row[], auditRows: [] as Row[],
  };
  db.organization = table(db.organizations);
  db.socialAccount = table(db.socialAccounts);
  db.socialPost = table(db.socialPosts);
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

function services(db: any, fetchFn: typeof fetch, oauth?: any) {
  const audit = { log: jest.fn(async (input: any) => { db.auditRows.push({ id: `audit-${db.auditRows.length + 1}`, createdAt: new Date(), ...input }); }) };
  const social = new SocialService(db as any, audit as any);
  const publisher = new MetaSocialPublisher(fetchFn, { pollIntervalMs: 0, maxPolls: 5, sleep: async () => {} });
  const publish = new SocialPublishService(db as any, audit as any, social, publisher);
  const oauthService = oauth ?? new SocialOAuthService(db as any, audit as any);
  const health = new SocialHealthService(db as any, audit as any, publish, oauthService as any, publisher);
  return { social, publish, health, audit, publisher };
}

function seedOrg(db: any, over: Row = {}) {
  const row = { id: ORG, timezone: "Asia/Dhaka", socialRequireApproval: false, socialApprovalTwoStep: false, ...over };
  db.organizations.push(row);
  return row;
}

function seedIntegration(db: any, over: Row = {}) {
  const row = {
    id: "int-1", organizationId: ORG, provider: "meta_social", status: "CONNECTED",
    externalAccountId: "page-1", createdAt: new Date(), updatedAt: new Date(), ...over,
  };
  db.integrations.push(row);
  db.credentials.push({
    id: `cred-${row.id}`, integrationId: row.id,
    encryptedData: encryptJson({ accessToken: PAGE_TOKEN, pageId: "page-1" }),
    createdAt: new Date(),
  });
  return row;
}

function seedAccount(db: any, over: Row = {}) {
  const row = {
    id: `acct-${++seq}`, organizationId: ORG, platform: "meta_page",
    externalId: "page-1", name: "Shop One", username: null, pictureUrl: null,
    status: "connected", lastError: null, healthCheckedAt: null,
    integrationId: "int-1", createdById: OWNER,
    createdAt: new Date(), updatedAt: new Date(), ...over,
  };
  db.socialAccounts.push(row);
  return row;
}

function seedPost(db: any, accountId: string, over: Row = {}) {
  const row = {
    id: `post-${++seq}`, organizationId: ORG, socialAccountId: accountId,
    caption: "ক্যাপশন", linkUrl: null, mediaRefs: [],
    status: "failed", scheduledAt: null, publishedAt: null, platformPostId: null,
    platformUrl: null, publishNote: null, error: "আগের ত্রুটি", attempts: 0,
    insights: null, insightsFetchedAt: null,
    approvalStatus: null, submittedById: null, reviewedById: null, reviewNote: null,
    postGroupId: null, firstCommentText: null, firstCommentStatus: null,
    assignedUserId: null,
    createdById: OWNER, createdAt: new Date(), updatedAt: new Date(), ...over,
  };
  db.socialPosts.push(row);
  return row;
}

const storedAccount = (db: any, id: string) => db.socialAccounts.find((a: Row) => a.id === id);
const storedPost = (db: any, id: string) => db.socialPosts.find((p: Row) => p.id === id);
const okFetch = () => stubFetch(() => ({ body: { id: "page-1", name: "Shop One" } }));

// ----------------------------------------------------------------
// Meta check-health
// ----------------------------------------------------------------

describe("SU10 Meta check-health", () => {
  it("success: Graph identity call with the sealed token, stamp set, connected status kept", async () => {
    const db = fakeDb(); seedOrg(db); seedIntegration(db);
    const account = seedAccount(db);
    const { fetchFn, calls } = okFetch();
    const oauth = { ensureAccessToken: jest.fn(async () => "unused") };
    const { health } = services(db, fetchFn, oauth);

    const res = await health.checkAccountHealth(ORG, OWNER, account.id);
    expect(res.ok).toBe(true);
    expect(res.status).toBe("connected");
    expect(res.healthCheckedAt).toBeInstanceOf(Date);
    expect(storedAccount(db, account.id).healthCheckedAt).toEqual(res.healthCheckedAt);
    expect(storedAccount(db, account.id).status).toBe("connected");
    expect(calls).toHaveLength(1);
    expect(calls[0].method).toBe("GET");
    expect(calls[0].url).toContain("/page-1?");
    expect(calls[0].params.get("fields")).toBe("id,name");
    expect(calls[0].params.get("access_token")).toBe(PAGE_TOKEN);
    expect(oauth.ensureAccessToken).not.toHaveBeenCalled();
  });

  it("success on an error account: restored to connected, lastError cleared, stamp set", async () => {
    const db = fakeDb(); seedOrg(db); seedIntegration(db);
    const account = seedAccount(db, { status: "error", lastError: "আগের টোকেন ত্রুটি" });
    const { fetchFn } = okFetch();
    const { health } = services(db, fetchFn);

    const res = await health.checkAccountHealth(ORG, OWNER, account.id);
    expect(res).toMatchObject({ ok: true, status: "connected" });
    const stored = storedAccount(db, account.id);
    expect(stored.status).toBe("connected");
    expect(stored.lastError).toBeNull();
    expect(stored.healthCheckedAt).toBeInstanceOf(Date);
  });

  it("token-death failure: status error + Meta verbatim as lastError + stamp; wrapper + verbatim in the response", async () => {
    const db = fakeDb(); seedOrg(db); seedIntegration(db);
    const account = seedAccount(db);
    const verbatim = "Error validating access token: The session has expired on Sunday.";
    const { fetchFn } = stubFetch(() => ({ status: 401, body: { error: { message: verbatim } } }));
    const { health } = services(db, fetchFn);

    const res = await health.checkAccountHealth(ORG, OWNER, account.id);
    expect(res.ok).toBe(false);
    expect(res.status).toBe("error");
    expect(res.error).toBe(`অ্যাকাউন্টের স্বাস্থ্য যাচাই ব্যর্থ হয়েছে: ${verbatim}`);
    const stored = storedAccount(db, account.id);
    expect(stored.status).toBe("error");
    expect(stored.lastError).toBe(verbatim);
    expect(stored.healthCheckedAt).toBeInstanceOf(Date);
    expect(res.healthCheckedAt).toEqual(stored.healthCheckedAt);
  });

  it("non-token failure: verbatim in the response, status and lastError untouched, stamp still set", async () => {
    const db = fakeDb(); seedOrg(db); seedIntegration(db);
    const account = seedAccount(db);
    const verbatim = "Temporary server problem at Meta — try again later";
    const { fetchFn } = stubFetch(() => ({ status: 500, body: { error: { message: verbatim } } }));
    const { health } = services(db, fetchFn);

    const res = await health.checkAccountHealth(ORG, OWNER, account.id);
    expect(res.ok).toBe(false);
    expect(res.status).toBe("connected");
    expect(res.error).toContain(verbatim);
    const stored = storedAccount(db, account.id);
    expect(stored.status).toBe("connected");
    expect(stored.lastError).toBeNull();
    expect(stored.healthCheckedAt).toBeInstanceOf(Date);
  });

  it("disconnected account: refused by the token seam before any Graph call; status unchanged, stamp set", async () => {
    const db = fakeDb(); seedOrg(db);
    const account = seedAccount(db, { status: "disconnected", integrationId: null });
    const { fetchFn, calls } = okFetch();
    const { health } = services(db, fetchFn);

    const res = await health.checkAccountHealth(ORG, OWNER, account.id);
    expect(res.ok).toBe(false);
    expect(res.status).toBe("disconnected");
    expect(res.error).toContain("এই অ্যাকাউন্টটি এখন সংযুক্ত নেই");
    expect(calls).toHaveLength(0);
    expect(storedAccount(db, account.id).healthCheckedAt).toBeInstanceOf(Date);
  });

  it("missing account → 404", async () => {
    const db = fakeDb(); seedOrg(db);
    const { fetchFn } = okFetch();
    const { health } = services(db, fetchFn);
    await expect(health.checkAccountHealth(ORG, OWNER, "no-such-account")).rejects.toMatchObject({ code: "social.socialAccountNotFoundInThis" });
  });
});

// ----------------------------------------------------------------
// TikTok / YouTube check-health (OAuth resolver)
// ----------------------------------------------------------------

describe("SU10 OAuth check-health", () => {
  it("TikTok success: ensureAccessToken is the check (org + account passed through)", async () => {
    const db = fakeDb(); seedOrg(db);
    const account = seedAccount(db, { platform: "tiktok", externalId: "tt-open-1" });
    const { fetchFn } = okFetch();
    const oauth = { ensureAccessToken: jest.fn(async (..._args: any[]) => "tt-fresh-token") };
    const { health } = services(db, fetchFn, oauth);

    const res = await health.checkAccountHealth(ORG, OWNER, account.id);
    expect(res).toMatchObject({ ok: true, status: "connected" });
    expect(oauth.ensureAccessToken).toHaveBeenCalledTimes(1);
    expect(oauth.ensureAccessToken.mock.calls[0]?.[0]).toBe(ORG);
    expect(oauth.ensureAccessToken.mock.calls[0]?.[1]?.id).toBe(account.id);
    expect(storedAccount(db, account.id).healthCheckedAt).toBeInstanceOf(Date);
  });

  it("YouTube success on an error account: restored to connected, lastError cleared", async () => {
    const db = fakeDb(); seedOrg(db);
    const account = seedAccount(db, { platform: "youtube", externalId: "chan-1", status: "error", lastError: "পুরনো ত্রুটি" });
    const { fetchFn } = okFetch();
    const oauth = { ensureAccessToken: jest.fn(async () => "yt-fresh-token") };
    const { health } = services(db, fetchFn, oauth);

    const res = await health.checkAccountHealth(ORG, OWNER, account.id);
    expect(res).toMatchObject({ ok: true, status: "connected" });
    const stored = storedAccount(db, account.id);
    expect(stored.status).toBe("connected");
    expect(stored.lastError).toBeNull();
    expect(stored.healthCheckedAt).toBeInstanceOf(Date);
  });

  it("TikTok resolver failure: its verbatim error is the result; status untouched; stamp set", async () => {
    const db = fakeDb(); seedOrg(db);
    const account = seedAccount(db, { platform: "tiktok", externalId: "tt-open-1" });
    const { fetchFn } = okFetch();
    const oauth = { ensureAccessToken: jest.fn(async () => { throw new Error("TikTok refresh endpoint unreachable verbatim"); }) };
    const { health } = services(db, fetchFn, oauth);

    const res = await health.checkAccountHealth(ORG, OWNER, account.id);
    expect(res.ok).toBe(false);
    expect(res.status).toBe("connected");
    expect(res.error).toBe("অ্যাকাউন্টের স্বাস্থ্য যাচাই ব্যর্থ হয়েছে: TikTok refresh endpoint unreachable verbatim");
    expect(storedAccount(db, account.id).status).toBe("connected");
    expect(storedAccount(db, account.id).healthCheckedAt).toBeInstanceOf(Date);
  });

  it("YouTube refresh death: the resolver's own marking stands (status error, its lastError kept), thrown error verbatim in the response", async () => {
    const db = fakeDb(); seedOrg(db);
    const account = seedAccount(db, { platform: "youtube", externalId: "chan-1" });
    const { fetchFn } = okFetch();
    const platformVerbatim = "Google refresh token revoked verbatim";
    const thrown = `Token refresh ব্যর্থ হয়েছে: ${platformVerbatim} — অ্যাকাউন্টটি আবার কানেক্ট করুন।`;
    // Mimics the REAL ensureAccessToken refresh-failure path: it
    // marks the account error with the platform's message, THEN
    // throws its wrapped PermanentPublishError.
    const oauth = {
      ensureAccessToken: jest.fn(async (_org: string, acct: any) => {
        const stored = storedAccount(db, acct.id);
        stored.status = "error";
        stored.lastError = platformVerbatim;
        throw new Error(thrown);
      }),
    };
    const { health } = services(db, fetchFn, oauth);

    const res = await health.checkAccountHealth(ORG, OWNER, account.id);
    expect(res.ok).toBe(false);
    expect(res.status).toBe("error");
    expect(res.error).toBe(`অ্যাকাউন্টের স্বাস্থ্য যাচাই ব্যর্থ হয়েছে: ${thrown}`);
    const stored = storedAccount(db, account.id);
    expect(stored.status).toBe("error");
    expect(stored.lastError).toBe(platformVerbatim); // the resolver's marking, not overwritten
    expect(stored.healthCheckedAt).toBeInstanceOf(Date);
  });
});

// ----------------------------------------------------------------
// GET accounts/health
// ----------------------------------------------------------------

describe("SU10 accounts/health list", () => {
  it("labels never_checked / error / ok with the exact field list and no secret material", async () => {
    const db = fakeDb(); seedOrg(db); seedIntegration(db);
    const checkedAt = new Date("2026-10-12T10:00:00Z");
    const a1 = seedAccount(db, { name: "Never Checked", healthCheckedAt: null });
    const a2 = seedAccount(db, { name: "Broken", status: "error", lastError: "token dead", healthCheckedAt: checkedAt });
    const a3 = seedAccount(db, { name: "Healthy", healthCheckedAt: checkedAt });
    const { fetchFn } = okFetch();
    const { health } = services(db, fetchFn);

    expect(deriveSocialAccountHealth({ healthCheckedAt: null, status: "error" })).toBe("never_checked");
    const list = await health.listAccountHealth(ORG);
    expect(list).toEqual([
      { id: a1.id, platform: "meta_page", name: "Never Checked", status: "connected", lastError: null, healthCheckedAt: null, health: "never_checked" },
      { id: a2.id, platform: "meta_page", name: "Broken", status: "error", lastError: "token dead", healthCheckedAt: checkedAt, health: "error" },
      { id: a3.id, platform: "meta_page", name: "Healthy", status: "connected", lastError: null, healthCheckedAt: checkedAt, health: "ok" },
    ]);
    const json = JSON.stringify(list);
    expect(json).not.toContain("integrationId");
    expect(json).not.toContain("externalId");
    expect(json).not.toContain("encrypted");
    expect(json).not.toContain(PAGE_TOKEN);
  });
});

// ----------------------------------------------------------------
// GET posts/failures
// ----------------------------------------------------------------

describe("SU10 posts/failures grouping", () => {
  it("pure signature: first line only, whitespace collapsed; blank/null → the honest bucket", () => {
    expect(normalizeFailureSignature("  Token   expired \nবিস্তারিত অন্য কিছু")).toBe("Token expired");
    expect(normalizeFailureSignature("Token expired")).toBe("Token expired");
    expect(normalizeFailureSignature(null)).toBe("(no error recorded)");
    expect(normalizeFailureSignature("   \n  ")).toBe("(no error recorded)");
    expect(normalizeFailureSignature("")).toBe("(no error recorded)");
  });

  it("groups by signature, sorts count desc then latestAt desc, dedupes accountIds, ignores non-failed", async () => {
    const db = fakeDb(); seedOrg(db);
    const t = (h: number) => new Date(`2026-10-10T${String(h).padStart(2, "0")}:00:00Z`);
    // "Token expired" ×3 — variants differ only in whitespace
    // and in the lines after the first.
    const p1 = seedPost(db, "acct-a", { error: "Token  expired\nsecond line details", updatedAt: t(3) });
    const p2 = seedPost(db, "acct-b", { error: "  Token   expired  \n other detail", updatedAt: t(2) });
    const p3 = seedPost(db, "acct-a", { error: "Token expired", updatedAt: t(4) });
    // "Network timeout" ×2 — newest overall, but fewer than 3.
    const p4 = seedPost(db, "acct-a", { error: "Network timeout", updatedAt: t(6) });
    const p5 = seedPost(db, "acct-a", { error: "Network timeout\nretry later", updatedAt: t(5) });
    // No-error bucket ×2 (null and blank), oldest latestAt.
    const p6 = seedPost(db, "acct-b", { error: null, updatedAt: t(1) });
    const p7 = seedPost(db, "acct-b", { error: "   ", updatedAt: t(0) });
    // A published post carrying an error string is NOT a failure.
    seedPost(db, "acct-a", { status: "published", error: "Token expired", updatedAt: t(7) });

    const { fetchFn } = okFetch();
    const { health } = services(db, fetchFn);
    const groups = await health.listPostFailures(ORG);
    expect(groups.map((g: any) => g.signature)).toEqual(["Token expired", "Network timeout", "(no error recorded)"]);
    expect(groups[0]).toEqual({
      signature: "Token expired", count: 3, latestAt: t(4),
      postIds: [p3.id, p1.id, p2.id], accountIds: ["acct-a", "acct-b"],
    });
    expect(groups[1]).toEqual({
      signature: "Network timeout", count: 2, latestAt: t(6),
      postIds: [p4.id, p5.id], accountIds: ["acct-a"],
    });
    expect(groups[2]).toEqual({
      signature: "(no error recorded)", count: 2, latestAt: t(1),
      postIds: [p6.id, p7.id], accountIds: ["acct-b"],
    });
  });
});

// ----------------------------------------------------------------
// POST posts/:id/retry
// ----------------------------------------------------------------

describe("SU10 retry", () => {
  it("not-failed post → Bengali 400 (BadRequest), nothing published, row untouched", async () => {
    const db = fakeDb(); seedOrg(db); seedIntegration(db);
    const account = seedAccount(db);
    const draft = seedPost(db, account.id, { status: "draft", attempts: 0 });
    const published = seedPost(db, account.id, { status: "published", attempts: 0 });
    const { fetchFn } = okFetch();
    const { health, publish } = services(db, fetchFn);
    const fn = jest.fn(async () => ({ platformPostId: "x", platformUrl: null }));
    publish.publishToPlatform = fn as any;

    for (const post of [draft, published]) {
      let caught: any = null;
      try { await health.retryPost(ORG, OWNER, post.id); } catch (e) { caught = e; }
      expect(caught).toMatchObject({ code: "social.onlyFailedPostsCanBeRetried" });
      expect(caught.getStatus()).toBe(400);
      expect(caught.message).toContain("শুধু Failed পোস্টই");
      expect(storedPost(db, post.id).status).toBe(post.status);
    }
    expect(fn).not.toHaveBeenCalled();
    await expect(health.retryPost(ORG, OWNER, "no-such-post")).rejects.toMatchObject({ code: "social.socialPostNotFoundInThis" });
  });

  it("exhausted attempts (≥ MAX): reset to 0 WITH audit, then publishNow publishes", async () => {
    const db = fakeDb(); seedOrg(db); seedIntegration(db);
    const account = seedAccount(db);
    const post = seedPost(db, account.id, { attempts: MAX_PUBLISH_ATTEMPTS, error: "cap reached" });
    const { fetchFn } = okFetch();
    const { health, publish } = services(db, fetchFn);
    publish.publishToPlatform = jest.fn(async () => ({ platformPostId: "fb-retry-1", platformUrl: "https://www.facebook.com/fb-retry-1" })) as any;

    const res = await health.retryPost(ORG, OWNER, post.id);
    expect(res.status).toBe("published");
    expect(res.platformPostId).toBe("fb-retry-1");
    const stored = storedPost(db, post.id);
    expect(stored.status).toBe("published");
    expect(stored.attempts).toBe(0);
    const reset = db.auditRows.find((r: Row) => r.action === "social.post_retry_attempts_reset");
    expect(reset).toBeTruthy();
    expect(reset.entityId).toBe(post.id);
    expect(reset.userId).toBe(OWNER);
    expect(reset.metadata).toEqual({ previousAttempts: MAX_PUBLISH_ATTEMPTS, attempts: 0 });
    // publishNow's own audit followed the reset.
    const actions = db.auditRows.map((r: Row) => r.action);
    expect(actions.indexOf("social.post_retry_attempts_reset"))
      .toBeLessThan(actions.indexOf("social.post_publish_requested"));
  });

  it("attempts remaining: NO reset, NO reset audit — the retry spends the existing budget", async () => {
    const db = fakeDb(); seedOrg(db); seedIntegration(db);
    const account = seedAccount(db);
    const post = seedPost(db, account.id, { attempts: 1 });
    const { fetchFn } = okFetch();
    const { health, publish } = services(db, fetchFn);
    publish.publishToPlatform = jest.fn(async () => ({ platformPostId: "fb-retry-2", platformUrl: null })) as any;

    const res = await health.retryPost(ORG, OWNER, post.id);
    expect(res.status).toBe("published");
    expect(storedPost(db, post.id).attempts).toBe(1);
    expect(db.auditRows.some((r: Row) => r.action === "social.post_retry_attempts_reset")).toBe(false);
  });

  it("publishNow approval gate refusal propagates verbatim; platform never called; no reset audit", async () => {
    const db = fakeDb(); seedOrg(db, { socialRequireApproval: true }); seedIntegration(db);
    const account = seedAccount(db);
    const post = seedPost(db, account.id, { attempts: 1, approvalStatus: "pending", submittedById: OWNER });
    const { fetchFn } = okFetch();
    const { health, publish } = services(db, fetchFn);
    const fn = jest.fn(async () => ({ platformPostId: "x", platformUrl: null }));
    publish.publishToPlatform = fn as any;

    await expect(health.retryPost(ORG, OWNER, post.id)).rejects.toThrow("অনুমোদিত নয়");
    expect(fn).not.toHaveBeenCalled();
    expect(db.auditRows.some((r: Row) => r.action === "social.post_retry_attempts_reset")).toBe(false);
    // Documented prep transition: the failed post was returned
    // to draft for the publishNow delegate, so a gate refusal
    // leaves it as a draft the owner can approve and publish.
    expect(storedPost(db, post.id).status).toBe("draft");
  });

  it("SU1 pre-flight failure propagates through publishNow: post fails again with the verbatim pre-flight error, attempts unburned, no platform call", async () => {
    const db = fakeDb(); seedOrg(db); seedIntegration(db);
    // Instagram post with NO media can never publish (SU1 rule).
    const account = seedAccount(db, { platform: "instagram", externalId: "ig-1" });
    const post = seedPost(db, account.id, { attempts: 1, mediaRefs: [], error: "আগের ব্যর্থতা" });
    const { fetchFn, calls } = okFetch();
    const { health } = services(db, fetchFn);

    const res = await health.retryPost(ORG, OWNER, post.id);
    expect(res.status).toBe("failed");
    expect(res.error).toBe("Instagram-এ প্রকাশের জন্য একটি ছবি বা ভিডিও লাগবে — শুধু লেখার পোস্ট Instagram-এ করা যায় না।");
    expect(storedPost(db, post.id).attempts).toBe(1); // permanent error burns no attempts
    expect(calls).toHaveLength(0);
  });
});
