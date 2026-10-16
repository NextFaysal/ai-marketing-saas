import { SocialInsightsService, buildMonthlyReportCsv, buildMonthlyReportPdf, dayInTimeZone, shiftDay, INSIGHT_METRIC_KEYS, type MonthlyReportRow } from "./social-insights.service";
import { MetaSocialPublisher } from "./meta-publisher";

/**
 * SU7 — Analytics v2, proven at the service boundary with a fake
 * Prisma + stub fetch (SP7 pattern):
 * - timeseries buckets published posts by ORG-tz calendar day,
 *   each metric total carrying its own basis; a data-less day is
 *   a structural zero, never an estimate;
 * - contentTypes classifies by mediaRefs; engagement stays null
 *   when no post of a type has a score;
 * - accountsComparison keeps the summary's basis discipline;
 * - getFollowerCount reads fan_count / followers_count exactly,
 *   absent → null, Graph error → verbatim throw;
 * - snapshotFollowers upserts per (account, day), skips a null
 *   count, isolates failures, marks token-dead accounts;
 * - monthly CSV renders an absent metric as an EMPTY cell (not
 *   0); the PDF is a real %PDF buffer with present-only totals.
 */

const ORG = "org-1";
type Row = Record<string, any>;

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

function table(store: Row[]) {
  return {
    findMany: jest.fn(async (args: any = {}) => {
      let rows = store.filter((r) => matches(r, args.where));
      if (args.orderBy?.day === "asc") rows = [...rows].sort((a, b) => String(a.day).localeCompare(String(b.day)));
      if (args.orderBy?.createdAt === "asc") rows = [...rows].sort((a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime());
      if (args.take) rows = rows.slice(0, args.take);
      return rows.map((r) => ({ ...r }));
    }),
    findFirst: jest.fn(async (args: any = {}) => {
      const row = store.find((r) => matches(r, args.where));
      return row ? { ...row } : null;
    }),
    create: jest.fn(async ({ data }: any) => {
      const row = { id: `row-${store.length + 1}`, createdAt: new Date(), ...data };
      store.push(row);
      return { ...row };
    }),
    count: jest.fn(async (args: any = {}) => store.filter((r) => matches(r, args.where)).length),
  };
}

function fakeDb() {
  const db: any = {
    organizations: [{ id: ORG, timezone: "Asia/Dhaka" }],
    socialAccounts: [] as Row[], socialPosts: [] as Row[],
    followerSnapshots: [] as Row[], linkClicks: [] as Row[], auditRows: [] as Row[],
  };
  db.organization = table(db.organizations);
  db.socialAccount = table(db.socialAccounts);
  db.socialPost = table(db.socialPosts);
  db.socialLinkClick = table(db.linkClicks);
  db.socialAccountFollowerSnapshot = {
    ...table(db.followerSnapshots),
    upsert: jest.fn(async ({ where, create, update }: any) => {
      const key = where.socialAccountId_day;
      const existing = db.followerSnapshots.find((r: Row) => r.socialAccountId === key.socialAccountId && r.day === key.day);
      if (existing) { Object.assign(existing, update); return { ...existing }; }
      const row = { id: `snap-${db.followerSnapshots.length + 1}`, createdAt: new Date(), ...create };
      db.followerSnapshots.push(row);
      return { ...row };
    }),
  };
  return db;
}

function makeInsights(db: any, publishStub?: any, publisherStub?: any) {
  const audit = { log: jest.fn(async (input: any) => { db.auditRows.push(input); }) };
  return new SocialInsightsService(db as any, audit as any, {} as any, publishStub ?? ({} as any), publisherStub as any);
}

/** An instant at 06:00 UTC = 12:00 in Asia/Dhaka — same calendar day. */
function dhakaNoon(day: string): Date {
  return new Date(`${day}T06:00:00.000Z`);
}

describe("SU7 timeseries", () => {
  it("buckets by org-tz day with per-metric basis; empty day is a structural zero", async () => {
    const db = fakeDb();
    const today = dayInTimeZone(new Date(), "Asia/Dhaka");
    const yesterday = shiftDay(today, -1);
    db.socialPosts.push(
      { id: "p1", organizationId: ORG, socialAccountId: "a1", status: "published", publishedAt: dhakaNoon(today), mediaRefs: [], insights: { platform: "meta_page", reactions: 5, comments: 2, shares: 1 } },
      { id: "p2", organizationId: ORG, socialAccountId: "a1", status: "published", publishedAt: dhakaNoon(today), mediaRefs: [], insights: { platform: "meta_page", reactions: 3 } },
      { id: "p3", organizationId: ORG, socialAccountId: "a2", status: "published", publishedAt: dhakaNoon(yesterday), mediaRefs: [], insights: { platform: "instagram", likeCount: 4, commentsCount: 1 } },
      // Published but NO insights object — never counted anywhere.
      { id: "p4", organizationId: ORG, socialAccountId: "a1", status: "published", publishedAt: dhakaNoon(today), mediaRefs: [], insights: null },
    );
    const out = await makeInsights(db).timeseries(ORG, 3);
    expect(out.days).toBe(3);
    expect(out.timeZone).toBe("Asia/Dhaka");
    expect(out.series).toHaveLength(3);
    const [d2, d1, d0] = out.series;
    expect(d0.day).toBe(today);
    expect(d0.metrics).toEqual({
      reactions: { total: 8, posts: 2 },
      comments: { total: 2, posts: 1 },
      shares: { total: 1, posts: 1 },
    });
    expect(d0.engagement).toEqual({ total: 11, posts: 2 });
    expect(d1.day).toBe(yesterday);
    expect(d1.metrics).toEqual({ likeCount: { total: 4, posts: 1 }, commentsCount: { total: 1, posts: 1 } });
    expect(d1.engagement).toEqual({ total: 5, posts: 1 });
    expect(d2.metrics).toEqual({});
    expect(d2.engagement).toEqual({ total: 0, posts: 0 });
  });

  it("clamps days into 1..90", async () => {
    const db = fakeDb();
    const svc = makeInsights(db);
    expect((await svc.timeseries(ORG, 500)).days).toBe(90);
    expect((await svc.timeseries(ORG, 0)).days).toBe(1);
    expect((await svc.timeseries(ORG)).days).toBe(30);
  });
});

describe("SU7 contentTypes", () => {
  it("classifies by mediaRefs and keeps engagement null when unscored", async () => {
    const db = fakeDb();
    db.socialPosts.push(
      { id: "v1", organizationId: ORG, status: "published", mediaRefs: [{ assetId: "x", kind: "video" }], insights: { platform: "meta_page", reactions: 10 } },
      { id: "v2", organizationId: ORG, status: "published", mediaRefs: [{ assetId: "x", kind: "video" }, { assetId: "y", kind: "image" }], insights: {} },
      { id: "c1", organizationId: ORG, status: "published", mediaRefs: [{ assetId: "x", kind: "image" }, { assetId: "y", kind: "image" }], insights: { platform: "meta_page", reactions: 6 } },
      { id: "ph1", organizationId: ORG, status: "published", mediaRefs: [{ assetId: "x", kind: "image" }], insights: {} },
      { id: "t1", organizationId: ORG, status: "published", mediaRefs: [], insights: null },
    );
    const out = await makeInsights(db).contentTypes(ORG);
    const byType = new Map(out.types.map((t: any) => [t.type, t]));
    expect(byType.get("video")).toEqual({ type: "video", posts: 2, withInsights: 2, engagementTotal: 10, engagementAvg: 10 });
    expect(byType.get("carousel")).toEqual({ type: "carousel", posts: 1, withInsights: 1, engagementTotal: 6, engagementAvg: 6 });
    expect(byType.get("photo")).toEqual({ type: "photo", posts: 1, withInsights: 1, engagementTotal: null, engagementAvg: null });
    expect(byType.get("text")).toEqual({ type: "text", posts: 1, withInsights: 0, engagementTotal: null, engagementAvg: null });
  });
});

describe("SU7 accountsComparison", () => {
  it("per-account totals carry basis; an account without insights is honestly empty", async () => {
    const db = fakeDb();
    db.socialAccounts.push(
      { id: "a1", organizationId: ORG, platform: "meta_page", name: "Page One", createdAt: new Date() },
      { id: "a2", organizationId: ORG, platform: "instagram", name: "IG One", createdAt: new Date() },
    );
    db.socialPosts.push(
      { id: "p1", organizationId: ORG, socialAccountId: "a1", status: "published", mediaRefs: [], insights: { platform: "meta_page", reactions: 7, comments: 1 } },
      { id: "p2", organizationId: ORG, socialAccountId: "a1", status: "published", mediaRefs: [], insights: { platform: "meta_page", reactions: 3 } },
    );
    const out = await makeInsights(db).accountsComparison(ORG);
    expect(out.accounts).toHaveLength(2);
    expect(out.accounts[0]).toEqual({
      accountId: "a1", platform: "meta_page", name: "Page One", postsWithInsights: 2,
      totals: { reactions: { total: 10, posts: 2 }, comments: { total: 1, posts: 1 } },
      engagement: { total: 11, posts: 2 },
    });
    expect(out.accounts[1]).toEqual({
      accountId: "a2", platform: "instagram", name: "IG One", postsWithInsights: 0,
      totals: {}, engagement: { total: 0, posts: 0 },
    });
  });
});

describe("SU7 getFollowerCount (MetaSocialPublisher, stub fetch)", () => {
  function publisher(handler: (url: string) => { status?: number; body: any }) {
    const calls: string[] = [];
    const fetchFn = jest.fn(async (url: string) => {
      calls.push(url);
      const r = handler(url);
      const status = r.status ?? 200;
      return { ok: status >= 200 && status < 300, status, json: async () => r.body };
    });
    return { pub: new MetaSocialPublisher(fetchFn as any), calls };
  }

  it("page → fan_count, instagram → followers_count", async () => {
    const page = publisher(() => ({ body: { fan_count: 1234 } }));
    await expect(page.pub.getFollowerCount("tok", "meta_page", "page-1")).resolves.toBe(1234);
    expect(new URL(page.calls[0]).searchParams.get("fields")).toBe("fan_count");
    const ig = publisher(() => ({ body: { followers_count: 555 } }));
    await expect(ig.pub.getFollowerCount("tok", "instagram", "ig-1")).resolves.toBe(555);
    expect(new URL(ig.calls[0]).searchParams.get("fields")).toBe("followers_count");
  });

  it("absent / non-number field → null (never a throw, never 0)", async () => {
    const absent = publisher(() => ({ body: {} }));
    await expect(absent.pub.getFollowerCount("tok", "meta_page", "page-1")).resolves.toBeNull();
    const weird = publisher(() => ({ body: { fan_count: "many" } }));
    await expect(weird.pub.getFollowerCount("tok", "meta_page", "page-1")).resolves.toBeNull();
  });

  it("Graph error propagates verbatim", async () => {
    const failing = publisher(() => ({ status: 400, body: { error: { message: "Invalid OAuth access token - Cannot parse access token" } } }));
    await expect(failing.pub.getFollowerCount("tok", "meta_page", "page-1"))
      .rejects.toThrow("Invalid OAuth access token - Cannot parse access token");
  });
});

describe("SU7 snapshotFollowers", () => {
  function setup() {
    const db = fakeDb();
    db.socialAccounts.push(
      { id: "a-page", organizationId: ORG, platform: "meta_page", externalId: "page-1", name: "Page", status: "connected" },
      { id: "a-ig", organizationId: ORG, platform: "instagram", externalId: "ig-1", name: "IG", status: "connected" },
      { id: "a-null", organizationId: ORG, platform: "meta_page", externalId: "page-2", name: "NoCount", status: "connected" },
      { id: "a-fail", organizationId: ORG, platform: "meta_page", externalId: "page-3", name: "Boom", status: "connected" },
      // Not connected / not Meta — never checked.
      { id: "a-yt", organizationId: ORG, platform: "youtube", externalId: "chan-1", name: "YT", status: "connected" },
    );
    const publishStub = {
      resolveAccountToken: jest.fn(async (_org: string, accountId: string) => ({ account: { id: accountId }, accessToken: "tok" })),
      markAccountTokenDead: jest.fn(async () => undefined),
    };
    const publisherStub = {
      getFollowerCount: jest.fn(async (_tok: string, _platform: string, externalId: string) => {
        if (externalId === "page-1") return 100;
        if (externalId === "ig-1") return 250;
        if (externalId === "page-2") return null;
        throw new Error("Graph boom verbatim");
      }),
    };
    return { db, publishStub, publisherStub };
  }

  it("upserts today's snapshot, skips a null count, isolates a failure, audits once", async () => {
    const { db, publishStub, publisherStub } = setup();
    const svc = makeInsights(db, publishStub, publisherStub);
    const out = await svc.snapshotFollowers(ORG);
    expect(out.checked).toBe(4);
    expect(out.snapshotted).toBe(2);
    expect(out.skipped).toBe(1);
    expect(out.failed).toBe(1);
    const fail = out.results.find((r: any) => r.accountId === "a-fail");
    expect(fail).toEqual({ accountId: "a-fail", status: "failed", error: "Graph boom verbatim" });
    const today = dayInTimeZone(new Date(), "Asia/Dhaka");
    expect(db.followerSnapshots).toHaveLength(2);
    expect(db.followerSnapshots).toContainEqual(expect.objectContaining({ socialAccountId: "a-page", day: today, followers: 100 }));
    expect(db.followerSnapshots).toContainEqual(expect.objectContaining({ socialAccountId: "a-ig", day: today, followers: 250 }));
    expect(publishStub.markAccountTokenDead).not.toHaveBeenCalled();
    expect(db.auditRows).toHaveLength(1);
    expect(db.auditRows[0].action).toBe("social.follower_snapshot");

    // Second run the same day UPSERTS (no duplicate row).
    const again = await svc.snapshotFollowers(ORG);
    expect(again.snapshotted).toBe(2);
    expect(db.followerSnapshots).toHaveLength(2);
  });

  it("a token-dead failure marks the account dead and still completes", async () => {
    const db = fakeDb();
    db.socialAccounts.push(
      { id: "a-dead", organizationId: ORG, platform: "meta_page", externalId: "page-9", name: "Dead", status: "connected" },
    );
    const publishStub = {
      resolveAccountToken: jest.fn(async () => ({ account: { id: "a-dead" }, accessToken: "tok" })),
      markAccountTokenDead: jest.fn(async () => undefined),
    };
    const publisherStub = {
      getFollowerCount: jest.fn(async () => {
        throw new Error("Error validating access token: The session has expired because the user changed their password.");
      }),
    };
    const out = await makeInsights(db, publishStub, publisherStub).snapshotFollowers(ORG);
    expect(out.failed).toBe(1);
    expect(publishStub.markAccountTokenDead).toHaveBeenCalledWith("a-dead", expect.stringContaining("Error validating access token"));
    expect(db.followerSnapshots).toHaveLength(0);
  });

  it("followers() returns stored snapshots day-asc and an empty array when none", async () => {
    const db = fakeDb();
    db.socialAccounts.push(
      { id: "a1", organizationId: ORG, platform: "meta_page", name: "Page", createdAt: new Date() },
      { id: "a2", organizationId: ORG, platform: "instagram", name: "IG", createdAt: new Date() },
    );
    db.followerSnapshots.push(
      { id: "s2", organizationId: ORG, socialAccountId: "a1", day: "2026-10-12", followers: 90 },
      { id: "s1", organizationId: ORG, socialAccountId: "a1", day: "2026-10-11", followers: 80 },
    );
    const out = await makeInsights(db).followers(ORG);
    expect(out.accounts[0].snapshots).toEqual([
      { day: "2026-10-11", followers: 80 },
      { day: "2026-10-12", followers: 90 },
    ]);
    expect(out.accounts[1].snapshots).toEqual([]);
  });
});

describe("SU7 monthly report", () => {
  it("rows: published-in-month or created-in-month, metrics null when absent, real click count", async () => {
    const db = fakeDb();
    db.socialAccounts.push({ id: "a1", organizationId: ORG, platform: "meta_page", name: "Page One", createdAt: new Date() });
    db.socialPosts.push(
      {
        id: "p1", organizationId: ORG, socialAccountId: "a1", status: "published",
        publishedAt: new Date("2026-10-05T06:00:00.000Z"), createdAt: new Date("2026-10-04T06:00:00.000Z"),
        caption: "x".repeat(100), insights: { platform: "meta_page", reactions: 5 },
      },
      {
        id: "p2", organizationId: ORG, socialAccountId: "a1", status: "draft",
        publishedAt: null, createdAt: new Date("2026-10-06T06:00:00.000Z"), caption: "draft one", insights: null,
      },
      {
        id: "p3", organizationId: ORG, socialAccountId: "a1", status: "published",
        publishedAt: new Date("2026-09-05T06:00:00.000Z"), createdAt: new Date("2026-09-04T06:00:00.000Z"),
        caption: "september", insights: { platform: "meta_page", reactions: 99 },
      },
    );
    db.linkClicks.push(
      { id: "c1", organizationId: ORG, socialPostId: "p1" },
      { id: "c2", organizationId: ORG, socialPostId: "p1" },
      { id: "c3", organizationId: ORG, socialPostId: "p1" },
    );
    const svc = makeInsights(db);
    const report = await svc.monthlyReport(ORG, "2026-10");
    expect(report.month).toBe("2026-10");
    expect(report.rows).toHaveLength(2);
    const [r1, r2] = report.rows;
    expect(r1.captionExcerpt).toHaveLength(80);
    expect(r1.metrics.reactions).toBe(5);
    expect(r1.metrics.comments).toBeNull();
    expect(r1.engagement).toBe(5);
    expect(r1.linkClicks).toBe(3);
    expect(r1.platform).toBe("meta_page");
    expect(r1.accountName).toBe("Page One");
    expect(r2.status).toBe("draft");
    expect(r2.engagement).toBeNull();
    expect(r2.linkClicks).toBe(0);
    await expect(svc.monthlyReport(ORG, "2026-13")).rejects.toThrow(/YYYY-MM/);
    await expect(svc.monthlyReport(ORG, "Oct 2026")).rejects.toThrow(/YYYY-MM/);
  });

  it("CSV: BOM + header, an absent metric is an EMPTY cell, never 0", () => {
    const rows: MonthlyReportRow[] = [{
      date: "2026-10-05T06:00:00.000Z", platform: "meta_page", accountName: "Page One",
      captionExcerpt: "hello, world", status: "published",
      metrics: Object.fromEntries(INSIGHT_METRIC_KEYS.map((k) => [k, k === "reactions" ? 5 : null])),
      engagement: 5, linkClicks: 3,
    }];
    const csv = buildMonthlyReportCsv(rows, "2026-10");
    expect(csv.charCodeAt(0)).toBe(0xfeff);
    const lines = csv.replace(/^﻿/, "").split("\r\n").filter(Boolean);
    expect(lines[0]).toContain("reactions");
    expect(lines[0]).toContain("linkClicks");
    // "hello, world" is quoted (it contains a comma); mask it,
    // then split cleanly: 5 lead cells + metrics + engagement
    // + clicks, with every absent metric EMPTY. (SN7 widened
    // INSIGHT_METRIC_KEYS with the Threads-native keys — 14
    // metrics now, so 21 cells; the indices below follow the
    // array, whose first entry is still reactions.)
    expect(lines[1]).toContain('"hello, world"');
    const cells = lines[1].replace('"hello, world"', "CAPTION").split(",");
    expect(cells).toHaveLength(5 + INSIGHT_METRIC_KEYS.length + 2);
    expect(cells[5]).toBe("5"); // reactions
    expect(cells.slice(6, 5 + INSIGHT_METRIC_KEYS.length)).toEqual(INSIGHT_METRIC_KEYS.slice(1).map(() => ""));
    expect(cells[5 + INSIGHT_METRIC_KEYS.length]).toBe("5"); // engagement
    expect(cells[6 + INSIGHT_METRIC_KEYS.length]).toBe("3"); // linkClicks
  });

  it("PDF: real %PDF buffer with a totals row over present values only", () => {
    const rows: MonthlyReportRow[] = [
      {
        date: "2026-10-05T06:00:00.000Z", platform: "meta_page", accountName: "Page One",
        captionExcerpt: "one", status: "published",
        metrics: Object.fromEntries(INSIGHT_METRIC_KEYS.map((k) => [k, null])),
        engagement: 5, linkClicks: 3,
      },
      {
        date: "2026-10-06T06:00:00.000Z", platform: "instagram", accountName: "IG One",
        captionExcerpt: "two", status: "published",
        metrics: Object.fromEntries(INSIGHT_METRIC_KEYS.map((k) => [k, null])),
        engagement: null, linkClicks: 2,
      },
    ];
    const pdf = buildMonthlyReportPdf(rows, "2026-10");
    expect(Buffer.isBuffer(pdf)).toBe(true);
    expect(pdf.subarray(0, 4).toString("latin1")).toBe("%PDF");
    const text = pdf.toString("latin1");
    expect(text).toContain("Monthly Social Report");
    // Totals: engagement 5 (only the scored post), clicks 3+2=5,
    // posts 2. (Parentheses are backslash-escaped in the PDF
    // content stream — PdfCanvas's pdfText discipline.)
    expect(text).toContain("engagement 5 \\(from 1 scored posts\\), link clicks 5, posts 2");
  });
});
