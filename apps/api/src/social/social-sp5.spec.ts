import { BadRequestException, ConflictException, NotFoundException } from "@nestjs/common";
import { SocialService } from "./social.service";
import {
  BACKOFF_MINUTES, MAX_PUBLISH_ATTEMPTS, PermanentPublishError, SocialPublishService,
} from "./social-publish.service";

/**
 * SP5 — Scheduling + Publish Worker:
 * - schedulePost: draft/scheduled/failed → scheduled (failed resets
 *   attempts, KEEPS the last error); publishing/published → 409;
 *   unparseable date → 400; >5 min in the past → 400; within the
 *   5-minute grace → accepted; foreign org → 404.
 * - cancelSchedule: only from scheduled.
 * - publishNow: one claim (status-conditioned updateMany) + one
 *   publish path; already-published → 409 without touching the
 *   platform; a lost claim race → 409.
 * - retries: plain errors reschedule with backoff (5m, then 30m)
 *   and burn attempts; the 3rd failure fails the post and notifies
 *   ACTIVE OWNER/ADMIN only; PermanentPublishError fails at once
 *   with attempts untouched.
 * - runDuePublishes: due posts claimed in scheduledAt order (a
 *   second scan never re-publishes), stale "publishing" claims
 *   (updatedAt > 15m old) recovered and retried in the same run,
 *   not-yet-due and foreign-org posts untouched.
 */
const ORG = "org-1";
const ORG2 = "org-2";
const ACTOR = "owner-1";
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
      if (args.orderBy?.scheduledAt === "asc") rows = [...rows].sort((a, b) => new Date(a.scheduledAt ?? 0).getTime() - new Date(b.scheduledAt ?? 0).getTime());
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
    memberships: [] as Row[], notifications: [] as Row[], auditRows: [] as Row[],
  };
  db.socialAccount = table(db.socialAccounts);
  db.mediaAsset = table(db.mediaAssets);
  db.membership = table(db.memberships);
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

function services(db: any) {
  const audit = { log: jest.fn(async (input: any) => { db.auditRows.push({ id: `audit-${db.auditRows.length + 1}`, createdAt: new Date(), ...input }); }) };
  const social = new SocialService(db as any, audit as any);
  const publish = new SocialPublishService(db as any, audit as any, social);
  return { social, publish, audit };
}

function seedAccount(db: any, over: Row = {}) {
  const row = {
    id: `sacc-${db.socialAccounts.length + 1}`, organizationId: ORG, platform: "meta_page",
    externalId: "page-1", name: "Shop One", username: null, pictureUrl: null,
    status: "connected", lastError: null, integrationId: "int-1", createdById: ACTOR,
    createdAt: new Date(), updatedAt: new Date(), ...over,
  };
  db.socialAccounts.push(row);
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

function seedMemberships(db: any) {
  db.memberships.push(
    { id: "m-owner", organizationId: ORG, userId: "owner-1", role: "OWNER", status: "ACTIVE" },
    { id: "m-admin", organizationId: ORG, userId: "admin-1", role: "ADMIN", status: "ACTIVE" },
    { id: "m-mm", organizationId: ORG, userId: "mm-1", role: "MARKETING_MANAGER", status: "ACTIVE" },
    { id: "m-inactive-owner", organizationId: ORG, userId: "ghost-1", role: "OWNER", status: "SUSPENDED" },
    { id: "m-foreign", organizationId: ORG2, userId: "foreign-1", role: "OWNER", status: "ACTIVE" },
  );
}

const FUTURE = () => new Date(Date.now() + 60 * 60_000).toISOString();
const stored = (db: any, id: string) => db.socialPosts.find((p: Row) => p.id === id);

afterEach(() => jest.restoreAllMocks());

describe("SP5 schedulePost", () => {
  it("draft → scheduled, with the audit row carrying scheduledAt + fromStatus", async () => {
    const db = fakeDb(); seedAccount(db);
    const post = seedPost(db);
    const { social } = services(db);
    const at = FUTURE();
    const res = await social.schedulePost(ORG, ACTOR, post.id, { scheduledAt: at });
    expect(res.status).toBe("scheduled");
    expect(new Date(res.scheduledAt).toISOString()).toBe(new Date(at).toISOString());
    const auditRow = db.auditRows.find((r: Row) => r.action === "social.post_scheduled");
    expect(auditRow).toBeTruthy();
    expect(auditRow.metadata).toEqual({ scheduledAt: new Date(at).toISOString(), fromStatus: "draft" });
  });

  it("scheduled → scheduled reschedule is allowed", async () => {
    const db = fakeDb(); seedAccount(db);
    const post = seedPost(db, { status: "scheduled", scheduledAt: new Date(Date.now() + 30 * 60_000) });
    const { social } = services(db);
    const at = FUTURE();
    const res = await social.schedulePost(ORG, ACTOR, post.id, { scheduledAt: at });
    expect(res.status).toBe("scheduled");
    expect(new Date(res.scheduledAt).toISOString()).toBe(new Date(at).toISOString());
    expect(db.auditRows.find((r: Row) => r.action === "social.post_scheduled")?.metadata.fromStatus).toBe("scheduled");
  });

  it("failed → scheduled resets attempts to 0 and KEEPS the old error visible", async () => {
    const db = fakeDb(); seedAccount(db);
    const post = seedPost(db, { status: "failed", attempts: 3, error: "Meta token expired" });
    const { social } = services(db);
    const res = await social.schedulePost(ORG, ACTOR, post.id, { scheduledAt: FUTURE() });
    expect(res.status).toBe("scheduled");
    expect(res.attempts).toBe(0);
    expect(res.error).toBe("Meta token expired");
    expect(stored(db, post.id).attempts).toBe(0);
    expect(stored(db, post.id).error).toBe("Meta token expired");
  });

  it("published → 409 and publishing → 409", async () => {
    const db = fakeDb(); seedAccount(db);
    const published = seedPost(db, { status: "published", publishedAt: new Date() });
    const publishing = seedPost(db, { status: "publishing" });
    const { social } = services(db);
    const e1 = await social.schedulePost(ORG, ACTOR, published.id, { scheduledAt: FUTURE() }).catch((e) => e);
    expect(e1).toBeInstanceOf(ConflictException);
    expect(e1.message).toContain("শিডিউল করা যাবে না");
    const e2 = await social.schedulePost(ORG, ACTOR, publishing.id, { scheduledAt: FUTURE() }).catch((e) => e);
    expect(e2).toBeInstanceOf(ConflictException);
    expect(db.auditRows.filter((r: Row) => r.action === "social.post_scheduled")).toHaveLength(0);
  });

  it("invalid date string → 400; >5 min past → 400; 2 min past → accepted (grace)", async () => {
    const db = fakeDb(); seedAccount(db);
    const post = seedPost(db);
    const { social } = services(db);
    const bad = await social.schedulePost(ORG, ACTOR, post.id, { scheduledAt: "not-a-date" }).catch((e) => e);
    expect(bad).toBeInstanceOf(BadRequestException);
    expect(bad.message).toContain("সঠিক তারিখ ও সময় দিন");
    const past = await social.schedulePost(ORG, ACTOR, post.id, { scheduledAt: new Date(Date.now() - 10 * 60_000).toISOString() }).catch((e) => e);
    expect(past).toBeInstanceOf(BadRequestException);
    expect(past.message).toContain("অতীতে হতে পারবে না");
    const grace = await social.schedulePost(ORG, ACTOR, post.id, { scheduledAt: new Date(Date.now() - 2 * 60_000).toISOString() });
    expect(grace.status).toBe("scheduled");
  });

  it("cross-org post → 404", async () => {
    const db = fakeDb(); seedAccount(db);
    const post = seedPost(db);
    const { social } = services(db);
    const err = await social.schedulePost(ORG2, ACTOR, post.id, { scheduledAt: FUTURE() }).catch((e) => e);
    expect(err).toBeInstanceOf(NotFoundException);
  });
});

describe("SP5 cancelSchedule", () => {
  it("scheduled → draft with scheduledAt null + audit", async () => {
    const db = fakeDb(); seedAccount(db);
    const post = seedPost(db, { status: "scheduled", scheduledAt: new Date(Date.now() + 60_000) });
    const { social } = services(db);
    const res = await social.cancelSchedule(ORG, ACTOR, post.id);
    expect(res.status).toBe("draft");
    expect(res.scheduledAt).toBeNull();
    expect(db.auditRows.some((r: Row) => r.action === "social.post_schedule_cancelled")).toBe(true);
  });

  it("draft → 409", async () => {
    const db = fakeDb(); seedAccount(db);
    const post = seedPost(db);
    const { social } = services(db);
    const err = await social.cancelSchedule(ORG, ACTOR, post.id).catch((e) => e);
    expect(err).toBeInstanceOf(ConflictException);
    expect(err.message).toContain("শুধু শিডিউল করা পোস্টের শিডিউল বাতিল করা যায়");
  });
});

describe("SP5 publishNow", () => {
  it("draft + platform success → published with platform ids, publishedAt set, error cleared", async () => {
    const db = fakeDb(); seedAccount(db);
    const post = seedPost(db, { error: "stale error" });
    const { publish } = services(db);
    publish.publishToPlatform = jest.fn(async () => ({ platformPostId: "fb-123", platformUrl: "https://facebook.com/fb-123" }));
    const res = await publish.publishNow(ORG, ACTOR, post.id);
    expect(res.status).toBe("published");
    expect(res.platformPostId).toBe("fb-123");
    expect(res.platformUrl).toBe("https://facebook.com/fb-123");
    expect(res.publishedAt).toBeTruthy();
    expect(res.error).toBeNull();
    expect(db.auditRows.some((r: Row) => r.action === "social.post_publish_requested" && r.metadata?.fromStatus === "draft")).toBe(true);
  });

  it("scheduled + platform success → published", async () => {
    const db = fakeDb(); seedAccount(db);
    const post = seedPost(db, { status: "scheduled", scheduledAt: new Date(Date.now() + 60_000) });
    const { publish } = services(db);
    publish.publishToPlatform = jest.fn(async () => ({ platformPostId: "ig-9", platformUrl: null }));
    const res = await publish.publishNow(ORG, ACTOR, post.id);
    expect(res.status).toBe("published");
    expect(res.platformPostId).toBe("ig-9");
    expect(res.platformUrl).toBeNull();
  });

  it("already-published post → 409 and the platform fn is NOT called", async () => {
    const db = fakeDb(); seedAccount(db);
    const post = seedPost(db, { status: "published", publishedAt: new Date(), platformPostId: "fb-1" });
    const { publish } = services(db);
    const fn = jest.fn(async () => ({ platformPostId: "x", platformUrl: null }));
    publish.publishToPlatform = fn;
    const err = await publish.publishNow(ORG, ACTOR, post.id).catch((e) => e);
    expect(err).toBeInstanceOf(ConflictException);
    expect(fn).not.toHaveBeenCalled();
  });

  it("lost claim race (updateMany count 0) → 409 and the platform fn is NOT called", async () => {
    const db = fakeDb(); seedAccount(db);
    const post = seedPost(db);
    const { publish } = services(db);
    db.socialPost.updateMany = jest.fn(async () => ({ count: 0 }));
    const fn = jest.fn(async () => ({ platformPostId: "x", platformUrl: null }));
    publish.publishToPlatform = fn;
    const err = await publish.publishNow(ORG, ACTOR, post.id).catch((e) => e);
    expect(err).toBeInstanceOf(ConflictException);
    expect(err.message).toContain("অন্য একটি প্রক্রিয়ায় প্রকাশ হচ্ছে");
    expect(fn).not.toHaveBeenCalled();
  });

  it("foreign-org post → 404", async () => {
    const db = fakeDb(); seedAccount(db);
    const post = seedPost(db);
    const { publish } = services(db);
    const err = await publish.publishNow(ORG2, ACTOR, post.id).catch((e) => e);
    expect(err).toBeInstanceOf(NotFoundException);
  });
});

describe("SP5 retry / backoff / failure", () => {
  it("plain error → back to scheduled, attempts=1, scheduledAt ≈ now+5m, error verbatim; no notification yet", async () => {
    const db = fakeDb(); seedAccount(db); seedMemberships(db);
    const post = seedPost(db);
    const { publish } = services(db);
    publish.publishToPlatform = jest.fn(async () => { throw new Error("Meta API timeout"); });
    const before = Date.now();
    const res = await publish.publishNow(ORG, ACTOR, post.id);
    expect(res.status).toBe("scheduled");
    expect(res.attempts).toBe(1);
    expect(res.error).toBe("Meta API timeout");
    const deltaMin = (new Date(res.scheduledAt).getTime() - before) / 60_000;
    expect(deltaMin).toBeGreaterThan(BACKOFF_MINUTES[0] - 1);
    expect(deltaMin).toBeLessThan(BACKOFF_MINUTES[0] + 1);
    expect(db.notifications).toHaveLength(0);
  });

  it("second failure → attempts=2, +30m; third failure → failed + OWNER/ADMIN notifications only", async () => {
    const db = fakeDb(); seedAccount(db); seedMemberships(db);
    const post = seedPost(db, { status: "scheduled", scheduledAt: new Date(Date.now() - 1000), attempts: 0 });
    const { publish } = services(db);
    publish.publishToPlatform = jest.fn(async () => { throw new Error("rate limited"); });

    // failure #1 via the scan
    let counts = await publish.runDuePublishes(ORG);
    expect(counts).toMatchObject({ published: 0, rescheduled: 1, failed: 0 });
    expect(stored(db, post.id)).toMatchObject({ status: "scheduled", attempts: 1, error: "rate limited" });

    // failure #2 (force due again)
    stored(db, post.id).scheduledAt = new Date(Date.now() - 1000);
    const before2 = Date.now();
    counts = await publish.runDuePublishes(ORG);
    expect(counts.rescheduled).toBe(1);
    expect(stored(db, post.id).attempts).toBe(2);
    const deltaMin = (new Date(stored(db, post.id).scheduledAt).getTime() - before2) / 60_000;
    expect(deltaMin).toBeGreaterThan(BACKOFF_MINUTES[1] - 1);
    expect(deltaMin).toBeLessThan(BACKOFF_MINUTES[1] + 1);
    expect(db.notifications).toHaveLength(0);

    // failure #3 → terminal
    stored(db, post.id).scheduledAt = new Date(Date.now() - 1000);
    counts = await publish.runDuePublishes(ORG);
    expect(counts.failed).toBe(1);
    expect(stored(db, post.id)).toMatchObject({ status: "failed", attempts: MAX_PUBLISH_ATTEMPTS, error: "rate limited" });

    // notifications: ACTIVE OWNER + ADMIN only — not the
    // MARKETING_MANAGER, not the suspended OWNER, not the foreign org.
    const recipients = db.notifications.map((n: Row) => n.userId).sort();
    expect(recipients).toEqual(["admin-1", "owner-1"]);
    const notif = db.notifications[0];
    expect(notif.type).toBe("social_post_failed");
    expect(notif.title).toContain("Shop One");
    expect(notif.body).toContain("rate limited");
    expect(notif.body).toContain("ঈদ অফার");
    expect(notif.conversationId).toBeNull();
  });

  it("PermanentPublishError → failed immediately, attempts UNCHANGED (0), notification sent", async () => {
    const db = fakeDb(); seedAccount(db); seedMemberships(db);
    const post = seedPost(db);
    const { publish } = services(db);
    publish.publishToPlatform = jest.fn(async () => { throw new PermanentPublishError("ভিডিওর ফরম্যাট সমর্থিত নয়"); });
    const res = await publish.publishNow(ORG, ACTOR, post.id);
    expect(res.status).toBe("failed");
    expect(res.attempts).toBe(0);
    expect(res.error).toBe("ভিডিওর ফরম্যাট সমর্থিত নয়");
    expect(db.notifications.map((n: Row) => n.userId).sort()).toEqual(["admin-1", "owner-1"]);
  });

  it("an ordinary platform error is a failed attempt with backoff (never a fake publish)", async () => {
    const db = fakeDb(); seedAccount(db);
    const post = seedPost(db);
    const { publish } = services(db);
    // SP6 replaced the SP5 stub with the real Meta dispatch; this
    // SP5 state-machine test keeps its original intent — a plain
    // (transient) platform error follows the retry path and the
    // post is never marked published — by driving the platform
    // boundary with a plain Error, like its sibling tests do.
    // (The real dispatch itself is covered by social-sp6.spec.ts.)
    publish.publishToPlatform = jest.fn(async () => { throw new Error("Meta service temporarily unavailable"); });
    const res = await publish.publishNow(ORG, ACTOR, post.id);
    expect(res.status).toBe("scheduled");
    expect(res.attempts).toBe(1);
    expect(res.error).toBe("Meta service temporarily unavailable");
    expect(res.platformPostId).toBeNull();
  });
});

describe("SP5 runDuePublishes", () => {
  it("double-scan: two sequential scans publish a due post exactly once", async () => {
    const db = fakeDb(); seedAccount(db);
    const post = seedPost(db, { status: "scheduled", scheduledAt: new Date(Date.now() - 60_000) });
    const { publish } = services(db);
    const fn = jest.fn(async () => ({ platformPostId: "fb-1", platformUrl: null }));
    publish.publishToPlatform = fn;
    const first = await publish.runDuePublishes(ORG);
    expect(first).toMatchObject({ due: 1, published: 1 });
    const second = await publish.runDuePublishes(ORG);
    expect(second).toMatchObject({ due: 0, published: 0 });
    expect(fn).toHaveBeenCalledTimes(1);
    expect(stored(db, post.id).status).toBe("published");
  });

  it("stale claim (publishing, updatedAt 20m ago) is recovered and published in the same run; attempts unchanged by recovery", async () => {
    const db = fakeDb(); seedAccount(db);
    const post = seedPost(db, {
      status: "publishing", attempts: 1,
      scheduledAt: new Date(Date.now() - 30 * 60_000), updatedAt: new Date(Date.now() - 20 * 60_000),
    });
    const { publish } = services(db);
    publish.publishToPlatform = jest.fn(async () => ({ platformPostId: "fb-stale", platformUrl: null }));
    const counts = await publish.runDuePublishes(ORG);
    expect(counts.recovered).toBe(1);
    expect(counts.published).toBe(1);
    expect(stored(db, post.id)).toMatchObject({ status: "published", platformPostId: "fb-stale", attempts: 1, error: null });
  });

  it("a FRESH publishing claim (updatedAt just now) is not recovered and not touched", async () => {
    const db = fakeDb(); seedAccount(db);
    const post = seedPost(db, { status: "publishing", updatedAt: new Date() });
    const { publish } = services(db);
    const fn = jest.fn(async () => ({ platformPostId: "x", platformUrl: null }));
    publish.publishToPlatform = fn;
    const counts = await publish.runDuePublishes(ORG);
    expect(counts).toEqual({ recovered: 0, due: 0, published: 0, rescheduled: 0, failed: 0, blocked: 0 }); // SP7: result gained `blocked` (approval-held posts)
    expect(fn).not.toHaveBeenCalled();
    expect(stored(db, post.id).status).toBe("publishing");
  });

  it("not-yet-due scheduled posts and other orgs' due posts are untouched", async () => {
    const db = fakeDb(); seedAccount(db);
    const future = seedPost(db, { status: "scheduled", scheduledAt: new Date(Date.now() + 60 * 60_000) });
    const foreign = seedPost(db, { organizationId: ORG2, status: "scheduled", scheduledAt: new Date(Date.now() - 60_000) });
    const { publish } = services(db);
    const fn = jest.fn(async () => ({ platformPostId: "x", platformUrl: null }));
    publish.publishToPlatform = fn;
    const counts = await publish.runDuePublishes(ORG);
    expect(counts).toEqual({ recovered: 0, due: 0, published: 0, rescheduled: 0, failed: 0, blocked: 0 }); // SP7: result gained `blocked` (approval-held posts)
    expect(fn).not.toHaveBeenCalled();
    expect(stored(db, future.id).status).toBe("scheduled");
    expect(stored(db, foreign.id).status).toBe("scheduled");
  });

  it("due posts are published in scheduledAt order", async () => {
    const db = fakeDb(); seedAccount(db);
    const later = seedPost(db, { status: "scheduled", scheduledAt: new Date(Date.now() - 10 * 60_000) });
    const earlier = seedPost(db, { status: "scheduled", scheduledAt: new Date(Date.now() - 50 * 60_000) });
    const { publish } = services(db);
    const order: string[] = [];
    publish.publishToPlatform = jest.fn(async (p: any) => { order.push(p.id); return { platformPostId: `id-${p.id}`, platformUrl: null }; });
    const counts = await publish.runDuePublishes(ORG);
    expect(counts.published).toBe(2);
    expect(order).toEqual([earlier.id, later.id]);
  });
});

describe("SP5 serializePost", () => {
  it("includes attempts (and defaults to 0 for pre-SP5 rows)", async () => {
    const db = fakeDb(); seedAccount(db);
    const withAttempts = seedPost(db, { attempts: 2 });
    const legacy = seedPost(db, { attempts: undefined });
    const { social } = services(db);
    expect((await social.getPost(ORG, withAttempts.id)).attempts).toBe(2);
    expect((await social.getPost(ORG, legacy.id)).attempts).toBe(0);
  });
});
