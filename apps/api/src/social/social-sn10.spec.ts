import { BadRequestException, NotFoundException } from "@nestjs/common";
import { SocialService } from "./social.service";
import { SocialInsightsService } from "./social-insights.service";

/**
 * SN10 — Caption Test:
 * - createCaptionTest: a DRAFT pairs with a fresh clone draft
 *   under one captionTestId (source stamped too); an optional
 *   non-blank caption overrides ONLY the partner; a non-draft
 *   source is refused; a pair is capped at two posts (a third
 *   creation is refused); a half pair reuses the existing id;
 *   the creation is audited.
 * - listCaptionTests: posts group by captionTestId (newest test
 *   first), engagement comes from engagementScore over present
 *   fields only, metricsPresent lists ONLY metric keys actually
 *   present as numbers, link clicks are the real SocialLinkClick
 *   rows, bothPublished / closeCall are honest (closeCall is
 *   true/false only when both are published AND both scored,
 *   otherwise null) — and NO "winner" appears anywhere.
 */
const ORG = "org-1";
const ACTOR = "owner-1";
type Row = Record<string, any>;

function matches(row: Row, where: any): boolean {
  return Object.entries(where ?? {}).every(([k, v]) => {
    if (v === undefined) return true;
    if (v !== null && typeof v === "object" && !(v instanceof Date)) {
      const o = v as any;
      if ("not" in o) return o.not === null ? row[k] !== null && row[k] !== undefined : row[k] !== o.not;
      if ("in" in o) return o.in.includes(row[k]);
      return true;
    }
    if (v instanceof Date) return new Date(row[k]).getTime() === v.getTime();
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
    count: jest.fn(async (args: any = {}) => store.filter((r) => matches(r, args.where)).length),
  };
}

let seq = 0;
function fakeDb() {
  const db: any = {
    socialAccounts: [] as Row[], socialPosts: [] as Row[], groups: [] as Row[],
    linkClicks: [] as Row[], auditRows: [] as Row[],
    organizations: [{ id: ORG, timezone: "Asia/Dhaka" }] as Row[],
  };
  db.socialAccount = table(db.socialAccounts);
  db.organization = table(db.organizations);
  db.socialPostGroup = table(db.groups);
  db.socialLinkClick = table(db.linkClicks);
  db.socialPost = {
    ...table(db.socialPosts),
    create: jest.fn(async ({ data }: any) => {
      const row = {
        id: `post-${++seq}`, createdAt: new Date(), updatedAt: new Date(),
        linkUrl: null, scheduledAt: null, publishedAt: null, platformPostId: null,
        platformUrl: null, error: null, attempts: 0, mediaRefs: [], captionTestId: null, ...data,
      };
      db.socialPosts.push(row);
      return { ...row };
    }),
  };
  return db;
}

function services(db: any) {
  const audit = { log: jest.fn(async (input: any) => { db.auditRows.push({ id: `audit-${db.auditRows.length + 1}`, ...input }); }) };
  return {
    social: new SocialService(db as any, audit as any),
    insights: new SocialInsightsService(db as any, audit as any, {} as any, {} as any),
    audit,
  };
}

function seedAccount(db: any, over: Row = {}) {
  const row = {
    id: "sacc-1", organizationId: ORG, platform: "meta_page",
    externalId: "page-1", name: "Shop One", username: null, pictureUrl: null,
    status: "connected", lastError: null, createdAt: new Date(), updatedAt: new Date(), ...over,
  };
  db.socialAccounts.push(row);
  return row;
}

function seedPost(db: any, over: Row = {}) {
  const row = {
    id: `post-seed-${db.socialPosts.length + 1}`, organizationId: ORG, socialAccountId: "sacc-1",
    caption: "আসল ক্যাপশন", linkUrl: null, mediaRefs: [{ assetId: "a1", kind: "image" }], status: "draft",
    scheduledAt: null, publishedAt: null, platformPostId: null, platformUrl: null,
    error: null, attempts: 0, createdById: ACTOR, captionTestId: null,
    insights: null, insightsFetchedAt: null,
    createdAt: new Date(), updatedAt: new Date(), ...over,
  };
  db.socialPosts.push(row);
  return row;
}

describe("SN10 createCaptionTest", () => {
  it("pairs a draft with a clone under one captionTestId; a non-blank caption overrides only the partner; audited", async () => {
    const db = fakeDb(); seedAccount(db);
    const source = seedPost(db);
    const { social } = services(db);
    const out = await social.createCaptionTest(ORG, ACTOR, source.id, { caption: "  নতুন ক্যাপশন  " });
    expect(typeof out.captionTestId).toBe("string");
    expect(out.captionTestId.length).toBeGreaterThan(10);
    // Source: stamped with the test id, caption untouched.
    expect(out.source.id).toBe(source.id);
    expect(out.source.captionTestId).toBe(out.captionTestId);
    expect(out.source.caption).toBe("আসল ক্যাপশন");
    // Partner: fresh draft clone — same account/media, override caption.
    expect(out.partner.id).not.toBe(source.id);
    expect(out.partner.captionTestId).toBe(out.captionTestId);
    expect(out.partner.status).toBe("draft");
    expect(out.partner.socialAccountId).toBe("sacc-1");
    expect(out.partner.mediaRefs).toEqual([{ assetId: "a1", kind: "image" }]);
    expect(out.partner.caption).toBe("নতুন ক্যাপশন");
    // Rows in the store agree.
    expect(db.socialPosts).toHaveLength(2);
    expect(db.socialPosts.find((p: Row) => p.id === source.id).captionTestId).toBe(out.captionTestId);
    expect(db.socialPosts.find((p: Row) => p.id === out.partner.id).captionTestId).toBe(out.captionTestId);
    // Audit: the caption-test action on the partner, with the pair metadata.
    const hit = db.auditRows.find((r: Row) => r.action === "social.caption_test_created");
    expect(hit).toBeTruthy();
    expect(hit.entityType).toBe("SocialPost");
    expect(hit.entityId).toBe(out.partner.id);
    expect(hit.metadata).toEqual({ sourcePostId: source.id, captionTestId: out.captionTestId });
  });

  it("no caption (or a blank one) keeps the source caption on the partner — no override", async () => {
    const db = fakeDb(); seedAccount(db);
    const source = seedPost(db);
    const { social } = services(db);
    const out = await social.createCaptionTest(ORG, ACTOR, source.id, { caption: "   " });
    expect(out.partner.caption).toBe("আসল ক্যাপশন");

    const db2 = fakeDb(); seedAccount(db2);
    const source2 = seedPost(db2);
    const out2 = await services(db2).social.createCaptionTest(ORG, ACTOR, source2.id);
    expect(out2.partner.caption).toBe("আসল ক্যাপশন");
    expect(out2.partner.captionTestId).toBe(out2.captionTestId);
  });

  it("a non-draft source is refused with the Bengali error and nothing is created", async () => {
    const db = fakeDb(); seedAccount(db);
    const source = seedPost(db, { status: "published", publishedAt: new Date() });
    const { social } = services(db);
    const err = await social.createCaptionTest(ORG, ACTOR, source.id).catch((e) => e);
    expect(err).toMatchObject({ code: "social.aCaptionTestCanOnlyBe" });
    expect(err.message).toBe("Caption Test শুধু Draft পোস্ট থেকে তৈরি করা যায়।");
    expect(db.socialPosts).toHaveLength(1);
    expect(db.socialPosts[0].captionTestId).toBeNull();
  });

  it("a full pair refuses a third post — from the source AND from the partner", async () => {
    const db = fakeDb(); seedAccount(db);
    const source = seedPost(db);
    const { social } = services(db);
    const out = await social.createCaptionTest(ORG, ACTOR, source.id);
    expect(db.socialPosts).toHaveLength(2);
    const errSource = await social.createCaptionTest(ORG, ACTOR, source.id).catch((e) => e);
    expect(errSource).toMatchObject({ code: "social.theCaptionTestPairIsAlready" });
    expect(errSource.message).toContain("জোড়া");
    const errPartner = await social.createCaptionTest(ORG, ACTOR, out.partner.id).catch((e) => e);
    expect(errPartner).toMatchObject({ code: "social.theCaptionTestPairIsAlready" });
    expect(errPartner.message).toContain("জোড়া");
    expect(db.socialPosts).toHaveLength(2);
  });

  it("a source already in a half pair reuses its existing captionTestId", async () => {
    const db = fakeDb(); seedAccount(db);
    const source = seedPost(db, { captionTestId: "test-existing" });
    const { social } = services(db);
    const out = await social.createCaptionTest(ORG, ACTOR, source.id, { caption: "দ্বিতীয় ক্যাপশন" });
    expect(out.captionTestId).toBe("test-existing");
    expect(out.source.captionTestId).toBe("test-existing");
    expect(out.partner.captionTestId).toBe("test-existing");
    expect(out.partner.caption).toBe("দ্বিতীয় ক্যাপশন");
    expect(db.socialPosts.filter((p: Row) => p.captionTestId === "test-existing")).toHaveLength(2);
  });

  it("a post outside the org surfaces getPostRow's NotFound", async () => {
    const db = fakeDb(); seedAccount(db);
    seedPost(db, { organizationId: "org-other" });
    const { social } = services(db);
    await expect(social.createCaptionTest(ORG, ACTOR, db.socialPosts[0].id)).rejects.toMatchObject({ code: "social.socialPostNotFoundInThis" });
  });
});

describe("SN10 listCaptionTests", () => {
  function seededDb() {
    const db = fakeDb();
    seedAccount(db);
    seedAccount(db, { id: "sacc-2", platform: "instagram", externalId: "ig-1", name: "IG One" });
    // test-a (oldest): both published, close scores → closeCall true.
    seedPost(db, {
      id: "p-a1", captionTestId: "test-a", status: "published", publishedAt: new Date("2026-10-01T06:00:00Z"),
      createdAt: new Date("2026-10-01T00:00:00Z"),
      insights: { platform: "meta_page", reactions: 90, comments: 10 }, insightsFetchedAt: new Date("2026-10-02T00:00:00Z"),
      platformUrl: "https://facebook.com/a1",
    });
    seedPost(db, {
      id: "p-a2", captionTestId: "test-a", status: "published", publishedAt: new Date("2026-10-02T06:00:00Z"),
      createdAt: new Date("2026-10-02T00:00:00Z"), socialAccountId: "sacc-2",
      insights: { platform: "instagram", likeCount: 100, commentsCount: 5 },
    });
    // test-c: one published + one draft with no insights → bothPublished false, closeCall null, honest empty metrics.
    seedPost(db, {
      id: "p-c1", captionTestId: "test-c", status: "published", publishedAt: new Date("2026-10-03T06:00:00Z"),
      createdAt: new Date("2026-10-03T00:00:00Z"),
      insights: { platform: "meta_page", reactions: 40 },
    });
    seedPost(db, {
      id: "p-c2", captionTestId: "test-c", status: "draft",
      createdAt: new Date("2026-10-04T00:00:00Z"), insights: null,
    });
    // test-b: both published, far-apart scores → closeCall false.
    seedPost(db, {
      id: "p-b1", captionTestId: "test-b", status: "published", publishedAt: new Date("2026-10-05T06:00:00Z"),
      createdAt: new Date("2026-10-05T00:00:00Z"),
      insights: { platform: "meta_page", reactions: 100 },
    });
    seedPost(db, {
      id: "p-b2", captionTestId: "test-b", status: "published", publishedAt: new Date("2026-10-06T06:00:00Z"),
      createdAt: new Date("2026-10-06T00:00:00Z"),
      insights: { platform: "meta_page", reactions: 50 },
    });
    // test-d (newest): both published, but one has NO engagement
    // fields (impressions only) → closeCall null; metricsPresent
    // shows impressions and NO engagement-family key.
    seedPost(db, {
      id: "p-d1", captionTestId: "test-d", status: "published", publishedAt: new Date("2026-10-07T06:00:00Z"),
      createdAt: new Date("2026-10-07T00:00:00Z"),
      insights: { platform: "meta_page", impressions: 500 },
    });
    seedPost(db, {
      id: "p-d2", captionTestId: "test-d", status: "published", publishedAt: new Date("2026-10-08T06:00:00Z"),
      createdAt: new Date("2026-10-08T00:00:00Z"),
      insights: { platform: "meta_page", reactions: 10, shares: 2 },
    });
    // An untagged post never appears.
    seedPost(db, { id: "p-plain", captionTestId: null, status: "published", createdAt: new Date("2026-10-09T00:00:00Z") });
    db.linkClicks.push(
      { id: "c1", socialPostId: "p-a1" }, { id: "c2", socialPostId: "p-a1" }, { id: "c3", socialPostId: "p-a1" },
      { id: "c4", socialPostId: "p-b2" },
    );
    return db;
  }

  it("groups by captionTestId, newest test first, with account identity and real link clicks", async () => {
    const db = seededDb();
    const out = await services(db).insights.listCaptionTests(ORG);
    expect(out.tests.map((t: any) => t.captionTestId)).toEqual(["test-d", "test-b", "test-c", "test-a"]);
    for (const t of out.tests) expect(t.posts).toHaveLength(2);
    const a = out.tests.find((t: any) => t.captionTestId === "test-a");
    expect(a.posts[0]).toMatchObject({
      id: "p-a1", platform: "meta_page", accountName: "Shop One",
      engagement: 100, linkClicks: 3, platformUrl: "https://facebook.com/a1",
    });
    expect(a.posts[0].metricsPresent).toEqual(["reactions", "comments"]);
    expect(a.posts[1]).toMatchObject({ id: "p-a2", platform: "instagram", accountName: "IG One", engagement: 105, linkClicks: 0 });
    expect(a.posts[1].metricsPresent).toEqual(["likeCount", "commentsCount"]);
  });

  it("bothPublished and closeCall: true / false / null cases", async () => {
    const db = seededDb();
    const out = await services(db).insights.listCaptionTests(ORG);
    const byId = new Map(out.tests.map((t: any) => [t.captionTestId, t]));
    expect(byId.get("test-a").bothPublished).toBe(true);
    expect(byId.get("test-a").closeCall).toBe(true); // 100 vs 105 → 4.8% apart
    expect(byId.get("test-b").bothPublished).toBe(true);
    expect(byId.get("test-b").closeCall).toBe(false); // 100 vs 50 → 50% apart
    expect(byId.get("test-c").bothPublished).toBe(false);
    expect(byId.get("test-c").closeCall).toBeNull(); // not both published
    expect(byId.get("test-d").bothPublished).toBe(true);
    expect(byId.get("test-d").closeCall).toBeNull(); // one post unscored
  });

  it("engagement null is honest: metricsPresent shows only what the platform returned", async () => {
    const db = seededDb();
    const out = await services(db).insights.listCaptionTests(ORG);
    const d = out.tests.find((t: any) => t.captionTestId === "test-d");
    expect(d.posts[0].engagement).toBeNull();
    expect(d.posts[0].metricsPresent).toEqual(["impressions"]);
    const c = out.tests.find((t: any) => t.captionTestId === "test-c");
    expect(c.posts[1].engagement).toBeNull();
    expect(c.posts[1].metricsPresent).toEqual([]);
    expect(c.posts[1].linkClicks).toBe(0);
  });

  it("no winner anywhere in the response", async () => {
    const db = seededDb();
    const out = await services(db).insights.listCaptionTests(ORG);
    expect(JSON.stringify(out)).not.toContain("winner");
    for (const t of out.tests) {
      expect(Object.keys(t).sort()).toEqual(["bothPublished", "captionTestId", "closeCall", "posts"]);
    }
  });

  it("an org with no caption tests returns an empty list", async () => {
    const db = fakeDb(); seedAccount(db);
    seedPost(db, { captionTestId: null });
    const out = await services(db).insights.listCaptionTests(ORG);
    expect(out).toEqual({ tests: [] });
  });
});
