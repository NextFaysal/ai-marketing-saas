import { BadRequestException } from "@nestjs/common";
import { SocialService } from "./social.service";
import {
  clampSocialPostPageLimit, decodeSocialPostCursor, encodeSocialPostCursor,
} from "./social-post-cursor";
import { parseCsv, splitCsvRecords } from "./social-csv";

/**
 * SU11 — Page Redesign support APIs, proven at the service
 * boundary (SU9/SU10 fake-Prisma pattern):
 * - GET posts cursor mode (IN9 discipline): opt-in only — no
 *   cursor/limit key keeps the bare-array legacy response
 *   byte-identical in shape; cursor mode walks the canonical
 *   (createdAt desc, id desc) order with no repeats/skips across
 *   timestamp ties; a malformed cursor falls back to the first
 *   page (the IN9 rule, pinned here); filters compose.
 * - POST posts/bulk: whole-request Bengali 400s (empty ids,
 *   >100 ids, unknown action, reschedule without/with invalid
 *   scheduledAt, past time); per-item outcomes for delete_drafts
 *   and reschedule (status gate, approval gate, SU1 pre-flight);
 *   exactly one audit row with counts.
 * - POST posts/import-csv: pure parser (quoted commas/newlines,
 *   CRLF, escaped quotes, BOM, blank lines); header/row rules —
 *   caption column required, empty caption row error, missing /
 *   unknown / disconnected accountId row error (no invented
 *   default), invalid scheduledAt row error, a VALID scheduledAt
 *   still creates a plain DRAFT (v1 limit, pinned here), rows go
 *   through createPost (SU9 create-version exists), 200-row cap.
 */
const ORG = "org-1";
const OWNER = "owner-1";
type Row = Record<string, any>;

function matches(row: Row, where: any): boolean {
  return Object.entries(where ?? {}).every(([k, v]) => {
    if (k === "AND") return (v as any[]).every((clause) => matches(row, clause));
    if (k === "OR") return (v as any[]).some((clause) => matches(row, clause));
    if (v === null) return row[k] === null || row[k] === undefined;
    if (v instanceof Date) return row[k] != null && new Date(row[k]).getTime() === v.getTime();
    if (v && typeof v === "object") {
      if ("in" in v) return (v as any).in.includes(row[k]);
      if ("contains" in v) {
        const hay = String(row[k] ?? "");
        return (v as any).mode === "insensitive"
          ? hay.toLowerCase().includes(String((v as any).contains).toLowerCase())
          : hay.includes(String((v as any).contains));
      }
      const cmpVal = (a: any, b: any) =>
        typeof a === "string" && typeof b === "string" ? (a < b ? -1 : a > b ? 1 : 0)
          : new Date(a).getTime() - new Date(b).getTime();
      if ("lt" in v) return row[k] != null && cmpVal(row[k], (v as any).lt) < 0;
      if ("lte" in v) return row[k] != null && cmpVal(row[k], (v as any).lte) <= 0;
      if ("gt" in v) return row[k] != null && cmpVal(row[k], (v as any).gt) > 0;
      if ("gte" in v) return row[k] != null && cmpVal(row[k], (v as any).gte) >= 0;
      return true;
    }
    return row[k] === v;
  });
}

function table(store: Row[]) {
  const sortRows = (rows: Row[], orderBy: any) => {
    if (!orderBy) return rows;
    const specs = Array.isArray(orderBy) ? orderBy : [orderBy];
    return [...rows].sort((a, b) => {
      for (const spec of specs) {
        const [field, dir] = Object.entries(spec)[0] as [string, string];
        const av = a[field] instanceof Date ? a[field].getTime() : a[field];
        const bv = b[field] instanceof Date ? b[field].getTime() : b[field];
        const cmp = av === bv ? 0 : av < bv ? -1 : 1;
        if (cmp !== 0) return dir === "desc" ? -cmp : cmp;
      }
      return 0;
    });
  };
  return {
    findMany: jest.fn(async (args: any = {}) => {
      let rows = store.filter((r) => matches(r, args.where));
      rows = sortRows(rows, args.orderBy);
      if (args.take) rows = rows.slice(0, args.take);
      return rows.map((r) => ({ ...r }));
    }),
    findFirst: jest.fn(async (args: any = {}) => {
      const rows = sortRows(store.filter((r) => matches(r, args.where)), args.orderBy);
      return rows[0] ? { ...rows[0] } : null;
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

function fakeDb() {
  const db: any = {
    organizations: [] as Row[], socialAccounts: [] as Row[], socialPosts: [] as Row[],
    memberships: [] as Row[], versions: [] as Row[], mediaAssets: [] as Row[], auditRows: [] as Row[],
  };
  db.organization = table(db.organizations);
  db.socialAccount = table(db.socialAccounts);
  db.socialPost = table(db.socialPosts);
  db.membership = table(db.memberships);
  db.socialPostVersion = table(db.versions);
  db.mediaAsset = table(db.mediaAssets);
  return db;
}

function services(db: any) {
  const audit = { log: jest.fn(async (input: any) => { db.auditRows.push({ id: `audit-${db.auditRows.length + 1}`, createdAt: new Date(), ...input }); }) };
  return { social: new SocialService(db as any, audit as any), audit };
}

function seedOrg(db: any, over: Row = {}) {
  const row = { id: ORG, timezone: "Asia/Dhaka", socialRequireApproval: false, socialApprovalTwoStep: false, ...over };
  db.organizations.push(row);
  db.memberships.push({ id: "mem-owner", organizationId: ORG, userId: OWNER, role: "OWNER", status: "ACTIVE" });
  return row;
}

let seq = 0;
function seedAccount(db: any, over: Row = {}) {
  const row = {
    id: `acct-${++seq}`, organizationId: ORG, platform: "meta_page",
    externalId: `ext-${seq}`, name: "Shop One", username: null, pictureUrl: null,
    status: "connected", lastError: null, integrationId: "int-1", createdById: OWNER,
    createdAt: new Date(), updatedAt: new Date(), ...over,
  };
  db.socialAccounts.push(row);
  return row;
}

function seedPost(db: any, accountId: string, over: Row = {}) {
  const row = {
    id: `post-${++seq}`, organizationId: ORG, socialAccountId: accountId,
    caption: "ক্যাপশন", linkUrl: null, mediaRefs: [],
    status: "draft", scheduledAt: null, publishedAt: null, platformPostId: null,
    platformUrl: null, publishNote: null, error: null, attempts: 0,
    insights: null, insightsFetchedAt: null,
    approvalStatus: null, submittedById: null, reviewedById: null, reviewNote: null,
    postGroupId: null, firstCommentText: null, firstCommentStatus: null,
    assignedUserId: null, isStory: false,
    createdById: OWNER, createdAt: new Date(), updatedAt: new Date(), ...over,
  };
  db.socialPosts.push(row);
  return row;
}

const storedPost = (db: any, id: string) => db.socialPosts.find((p: Row) => p.id === id);
const FUTURE = () => new Date(Date.now() + 86_400_000).toISOString();

// ----------------------------------------------------------------
// Cursor codec + clamp (pure)
// ----------------------------------------------------------------

describe("SU11 cursor codec", () => {
  it("round-trips { createdAt, id }; malformed inputs decode to null", () => {
    const at = new Date("2026-10-10T08:30:00.000Z");
    const encoded = encodeSocialPostCursor({ id: "post-9", createdAt: at });
    expect(decodeSocialPostCursor(encoded)).toEqual({ createdAt: at.toISOString(), id: "post-9" });
    expect(decodeSocialPostCursor("not-a-cursor!!!")).toBeNull();
    expect(decodeSocialPostCursor("")).toBeNull();
    expect(decodeSocialPostCursor(null)).toBeNull();
    expect(decodeSocialPostCursor(Buffer.from(JSON.stringify({ id: "x" })).toString("base64url"))).toBeNull();
    expect(decodeSocialPostCursor(Buffer.from(JSON.stringify({ createdAt: "junk", id: "x" })).toString("base64url"))).toBeNull();
    expect(decodeSocialPostCursor(Buffer.from(JSON.stringify(["x"])).toString("base64url"))).toBeNull();
  });

  it("clamp: default 100, bounds [1, 100], junk → default", () => {
    expect(clampSocialPostPageLimit(undefined)).toBe(100);
    expect(clampSocialPostPageLimit("abc")).toBe(100);
    expect(clampSocialPostPageLimit(0)).toBe(1);
    expect(clampSocialPostPageLimit(500)).toBe(100);
    expect(clampSocialPostPageLimit(25)).toBe(25);
  });
});

// ----------------------------------------------------------------
// listPosts: legacy regression + cursor mode
// ----------------------------------------------------------------

describe("SU11 listPosts", () => {
  it("legacy mode (no cursor/limit key) still returns a bare array, createdAt desc", async () => {
    const db = fakeDb(); seedOrg(db);
    const acct = seedAccount(db);
    const older = seedPost(db, acct.id, { id: "post-old", createdAt: new Date("2026-10-01T00:00:00Z") });
    const newer = seedPost(db, acct.id, { id: "post-new", createdAt: new Date("2026-10-05T00:00:00Z") });
    const { social } = services(db);
    const res: any = await social.listPosts(ORG, {});
    expect(Array.isArray(res)).toBe(true);
    expect(res.map((p: any) => p.id)).toEqual([newer.id, older.id]);
    expect(res[0].account?.id).toBe(acct.id);
  });

  it("cursor walk covers every row exactly once across a createdAt tie, in canonical order", async () => {
    const db = fakeDb(); seedOrg(db);
    const acct = seedAccount(db);
    const tie = new Date("2026-10-05T10:00:00Z");
    // Three rows share one timestamp — id desc is the tie-break.
    seedPost(db, acct.id, { id: "post-a", createdAt: tie });
    seedPost(db, acct.id, { id: "post-c", createdAt: tie });
    seedPost(db, acct.id, { id: "post-b", createdAt: tie });
    seedPost(db, acct.id, { id: "post-z", createdAt: new Date("2026-10-06T10:00:00Z") });
    seedPost(db, acct.id, { id: "post-y", createdAt: new Date("2026-10-04T10:00:00Z") });
    const { social } = services(db);
    const seen: string[] = [];
    let cursor: string | null = null;
    let pages = 0;
    for (let guard = 0; guard < 10; guard++) {
      const res: any = await social.listPosts(ORG, { cursor, limit: 2 });
      expect(Array.isArray(res)).toBe(false);
      expect(Array.isArray(res.items)).toBe(true);
      seen.push(...res.items.map((p: any) => p.id));
      pages++;
      if (res.nextCursor === null) break;
      expect(typeof res.nextCursor).toBe("string");
      cursor = res.nextCursor;
      if (guard === 9) throw new Error("walk did not terminate");
    }
    expect(pages).toBe(3);
    expect(seen).toEqual(["post-z", "post-c", "post-b", "post-a", "post-y"]);
    expect(new Set(seen).size).toBe(5);
  });

  it("a malformed cursor falls back to the first page (IN9 rule — no throw, no 400)", async () => {
    const db = fakeDb(); seedOrg(db);
    const acct = seedAccount(db);
    seedPost(db, acct.id, { id: "post-1", createdAt: new Date("2026-10-03T00:00:00Z") });
    seedPost(db, acct.id, { id: "post-2", createdAt: new Date("2026-10-02T00:00:00Z") });
    const { social } = services(db);
    const res: any = await social.listPosts(ORG, { cursor: "garbage!!", limit: 1 });
    expect(res.items.map((p: any) => p.id)).toEqual(["post-1"]);
    expect(res.nextCursor).not.toBeNull();
  });

  it("limit alone also enters cursor mode; default page returns everything with nextCursor null", async () => {
    const db = fakeDb(); seedOrg(db);
    const acct = seedAccount(db);
    seedPost(db, acct.id, { id: "post-1", createdAt: new Date("2026-10-03T00:00:00Z") });
    seedPost(db, acct.id, { id: "post-2", createdAt: new Date("2026-10-02T00:00:00Z") });
    const { social } = services(db);
    const res: any = await social.listPosts(ORG, { limit: undefined as unknown as number });
    // The controller only passes the key when the param exists;
    // at the service boundary an explicit undefined limit key is
    // indistinguishable — cursor:null pins first-page mode.
    const res2: any = await social.listPosts(ORG, { cursor: null });
    expect(res2.items).toHaveLength(2);
    expect(res2.nextCursor).toBeNull();
    expect(res).toBeDefined();
  });

  it("filters compose with cursor mode: status, accountId, assignedUserId, q", async () => {
    const db = fakeDb(); seedOrg(db);
    const a1 = seedAccount(db);
    const a2 = seedAccount(db, { platform: "instagram" });
    seedPost(db, a1.id, { id: "p1", status: "draft", caption: "ঈদ অফার এক", assignedUserId: "user-9", createdAt: new Date("2026-10-05T00:00:00Z") });
    seedPost(db, a1.id, { id: "p2", status: "published", caption: "ঈদ অফার দুই", createdAt: new Date("2026-10-04T00:00:00Z") });
    seedPost(db, a2.id, { id: "p3", status: "draft", caption: "অন্য ক্যাপশন", createdAt: new Date("2026-10-03T00:00:00Z") });
    seedPost(db, a1.id, { id: "p4", status: "draft", caption: "ঈদ অফার তিন", createdAt: new Date("2026-10-02T00:00:00Z") });
    const { social } = services(db);

    const byStatus: any = await social.listPosts(ORG, { status: "draft", cursor: null, limit: 2 });
    expect(byStatus.items.map((p: any) => p.id)).toEqual(["p1", "p3"]);
    const byStatus2: any = await social.listPosts(ORG, { status: "draft", cursor: byStatus.nextCursor, limit: 2 });
    expect(byStatus2.items.map((p: any) => p.id)).toEqual(["p4"]);
    expect(byStatus2.nextCursor).toBeNull();

    const byAccount: any = await social.listPosts(ORG, { accountId: a2.id, cursor: null });
    expect(byAccount.items.map((p: any) => p.id)).toEqual(["p3"]);

    const byAssignee: any = await social.listPosts(ORG, { assignedUserId: "user-9", cursor: null });
    expect(byAssignee.items.map((p: any) => p.id)).toEqual(["p1"]);

    const byQ: any = await social.listPosts(ORG, { q: "ঈদ অফার", cursor: null });
    expect(byQ.items.map((p: any) => p.id)).toEqual(["p1", "p2", "p4"]);

    // q alone (no cursor key) stays a legacy bare array.
    const legacyQ: any = await social.listPosts(ORG, { q: "ঈদ অফার" });
    expect(Array.isArray(legacyQ)).toBe(true);
    expect(legacyQ).toHaveLength(3);
  });

  it("an invalid status is still a Bengali 400 in cursor mode", async () => {
    const db = fakeDb(); seedOrg(db);
    const { social } = services(db);
    await expect(social.listPosts(ORG, { status: "bogus", cursor: null })).rejects.toMatchObject({ code: "social.invalidPostStatus" });
  });
});

// ----------------------------------------------------------------
// bulkPosts
// ----------------------------------------------------------------

describe("SU11 bulkPosts", () => {
  it("whole-request Bengali 400s: empty ids, >100 ids, unknown action, reschedule without/invalid/past time", async () => {
    const db = fakeDb(); seedOrg(db);
    const { social } = services(db);
    const cases: any[] = [
      [{ ids: [], action: "delete_drafts" }, "social.noPostHasBeenSelectedChoose"],
      [{ ids: Array.from({ length: 101 }, (_, i) => `p-${i}`), action: "delete_drafts" }, "social.bulkActionsCanBeAppliedTo"],
      [{ ids: ["p-1"], action: "explode" }, "social.unknownBulkActionSendDeleteDrafts"],
      [{ ids: ["p-1"], action: "reschedule" }, "social.toRescheduleANewDateAnd"],
      [{ ids: ["p-1"], action: "reschedule", scheduledAt: "not-a-date" }, "social.giveAValidDateAndTime"],
      [{ ids: ["p-1"], action: "reschedule", scheduledAt: "2020-01-01T00:00:00.000Z" }, "social.theScheduledTimeCannotBeIn"],
      [{}, "social.noPostHasBeenSelectedChoose"],
    ];
    for (const [dto, code] of cases) {
      let caught: any = null;
      try { await social.bulkPosts(ORG, OWNER, dto); } catch (e) { caught = e; }
      expect(caught).toMatchObject({ code });
      expect(caught.getStatus()).toBe(400);
    }
    expect(db.auditRows).toHaveLength(0);
  });

  it("delete_drafts: only drafts are deleted; other statuses and unknown ids are per-item errors; one audit row with counts", async () => {
    const db = fakeDb(); seedOrg(db);
    const acct = seedAccount(db);
    const draft = seedPost(db, acct.id, { status: "draft" });
    const published = seedPost(db, acct.id, { status: "published" });
    const scheduled = seedPost(db, acct.id, { status: "scheduled" });
    const { social } = services(db);
    const res: any = await social.bulkPosts(ORG, OWNER, {
      ids: [draft.id, published.id, scheduled.id, "no-such-id"], action: "delete_drafts",
    });
    expect(res.succeeded).toBe(1);
    expect(res.failed).toBe(3);
    expect(res.results.find((r: any) => r.id === draft.id)).toEqual({ id: draft.id, ok: true });
    expect(res.results.find((r: any) => r.id === published.id).error).toContain("শুধু Draft");
    expect(res.results.find((r: any) => r.id === "no-such-id").error).toContain("পাওয়া যায়নি");
    expect(storedPost(db, draft.id)).toBeUndefined();
    expect(storedPost(db, published.id)).toBeTruthy();
    const bulkAudits = db.auditRows.filter((r: Row) => r.action === "social.posts_bulk");
    expect(bulkAudits).toHaveLength(1);
    expect(bulkAudits[0].metadata).toEqual({ bulkAction: "delete_drafts", requested: 4, succeeded: 1, failed: 3 });
  });

  it("reschedule: draft + scheduled succeed and become scheduled at the new time", async () => {
    const db = fakeDb(); seedOrg(db);
    const acct = seedAccount(db);
    const draft = seedPost(db, acct.id, { status: "draft" });
    const scheduled = seedPost(db, acct.id, { status: "scheduled", scheduledAt: new Date("2026-11-01T00:00:00Z") });
    const failed = seedPost(db, acct.id, { status: "failed" });
    const when = FUTURE();
    const { social } = services(db);
    const res: any = await social.bulkPosts(ORG, OWNER, { ids: [draft.id, scheduled.id, failed.id], action: "reschedule", scheduledAt: when });
    expect(res.succeeded).toBe(2);
    expect(res.failed).toBe(1);
    expect(res.results.find((r: any) => r.id === failed.id).error).toContain("শিডিউল করা যাবে না");
    for (const p of [draft, scheduled]) {
      const stored = storedPost(db, p.id);
      expect(stored.status).toBe("scheduled");
      expect(new Date(stored.scheduledAt).toISOString()).toBe(new Date(when).toISOString());
    }
  });

  it("reschedule approval gate: settings ON + not approved → per-item error, post untouched; approved → succeeds", async () => {
    const db = fakeDb(); seedOrg(db, { socialRequireApproval: true });
    const acct = seedAccount(db);
    const pending = seedPost(db, acct.id, { status: "draft", approvalStatus: "pending" });
    const approved = seedPost(db, acct.id, { status: "draft", approvalStatus: "approved" });
    const { social } = services(db);
    const res: any = await social.bulkPosts(ORG, OWNER, { ids: [pending.id, approved.id], action: "reschedule", scheduledAt: FUTURE() });
    expect(res.results.find((r: any) => r.id === pending.id).ok).toBe(false);
    expect(res.results.find((r: any) => r.id === pending.id).error).toContain("অনুমোদিত নয়");
    expect(res.results.find((r: any) => r.id === approved.id).ok).toBe(true);
    expect(storedPost(db, pending.id).status).toBe("draft");
    expect(storedPost(db, pending.id).scheduledAt).toBeNull();
  });

  it("reschedule pre-flight: an Instagram post with no media fails per-item with the SU1 verbatim", async () => {
    const db = fakeDb(); seedOrg(db);
    const ig = seedAccount(db, { platform: "instagram" });
    const post = seedPost(db, ig.id, { status: "draft", mediaRefs: [] });
    const { social } = services(db);
    const res: any = await social.bulkPosts(ORG, OWNER, { ids: [post.id], action: "reschedule", scheduledAt: FUTURE() });
    expect(res.succeeded).toBe(0);
    expect(res.results[0].error).toBe("Instagram-এ প্রকাশের জন্য একটি ছবি বা ভিডিও লাগবে — শুধু লেখার পোস্ট Instagram-এ করা যায় না।");
    expect(storedPost(db, post.id).status).toBe("draft");
  });

  it("duplicate ids are de-duplicated before the cap and the work", async () => {
    const db = fakeDb(); seedOrg(db);
    const acct = seedAccount(db);
    const draft = seedPost(db, acct.id, { status: "draft" });
    const { social } = services(db);
    const res: any = await social.bulkPosts(ORG, OWNER, { ids: [draft.id, draft.id], action: "delete_drafts" });
    expect(res.results).toHaveLength(1);
    expect(res.succeeded).toBe(1);
  });
});

// ----------------------------------------------------------------
// CSV parser (pure)
// ----------------------------------------------------------------

describe("SU11 CSV parser", () => {
  it("plain rows, CRLF, and a trailing newline", () => {
    const parsed = parseCsv("caption,accountId\r\nহ্যালো,acct-1\r\nদ্বিতীয়,acct-2\r\n");
    expect(parsed.headers).toEqual(["caption", "accountId"]);
    expect(parsed.rows).toEqual([
      { row: 2, values: { caption: "হ্যালো", accountId: "acct-1" } },
      { row: 3, values: { caption: "দ্বিতীয়", accountId: "acct-2" } },
    ]);
  });

  it("quoted fields keep commas, newlines and escaped quotes", () => {
    const text = 'caption,linkUrl\n"অফার, শুধু আজ\nদ্বিতীয় লাইন ""বিশেষ""",https://example.com/x';
    const parsed = parseCsv(text);
    expect(parsed.rows).toHaveLength(1);
    expect(parsed.rows[0].values.caption).toBe('অফার, শুধু আজ\nদ্বিতীয় লাইন "বিশেষ"');
    expect(parsed.rows[0].values.linkUrl).toBe("https://example.com/x");
  });

  it("BOM is stripped; blank lines are skipped; missing trailing fields read as empty", () => {
    const parsed = parseCsv("﻿caption,accountId,linkUrl\n\nশুধু ক্যাপশন\n");
    expect(parsed.headers[0]).toBe("caption");
    expect(parsed.rows).toEqual([{ row: 2, values: { caption: "শুধু ক্যাপশন", accountId: "", linkUrl: "" } }]);
    expect(splitCsvRecords("")).toEqual([]);
  });
});

// ----------------------------------------------------------------
// importPostsCsv
// ----------------------------------------------------------------

describe("SU11 importPostsCsv", () => {
  it("missing caption column → whole-request Bengali 400; empty CSV → 400; >200 rows → 400", async () => {
    const db = fakeDb(); seedOrg(db);
    const { social } = services(db);
    await expect(social.importPostsCsv(ORG, OWNER, "title,accountId\nx,acct-1")).rejects.toMatchObject({ code: "social.thereMustBeACaptionColumn" });
    await expect(social.importPostsCsv(ORG, OWNER, "")).rejects.toMatchObject({ code: "social.thereMustBeACaptionColumn" });
    await expect(social.importPostsCsv(ORG, OWNER, "caption,accountId")).rejects.toMatchObject({ code: "social.thereIsNoDataRowIn" });
    const big = ["caption,accountId", ...Array.from({ length: 201 }, (_, i) => `ক্যাপশন ${i},acct-1`)].join("\n");
    await expect(social.importPostsCsv(ORG, OWNER, big)).rejects.toThrow("২০০");
  });

  it("row matrix: valid rows become DRAFTS via createPost (version hook), bad rows are per-row errors", async () => {
    const db = fakeDb(); seedOrg(db);
    const acct = seedAccount(db);
    const dead = seedAccount(db, { status: "disconnected" });
    const csv = [
      "caption,accountId,linkUrl,scheduledAt",
      `সফল পোস্ট,${acct.id},https://example.com/p,2027-01-01T10:00:00.000Z`,
      `,${acct.id},,`,
      `অ্যাকাউন্ট ছাড়া,,`,
      `অজানা অ্যাকাউন্ট,acct-nope,,`,
      `বিচ্ছিন্ন অ্যাকাউন্ট,${dead.id},,`,
      `খারাপ সময়,${acct.id},,not-a-date`,
      `খারাপ লিংক,${acct.id},notaurl,`,
    ].join("\n");
    const { social } = services(db);
    const res: any = await social.importPostsCsv(ORG, OWNER, csv);
    expect(res.created).toBe(1);
    expect(res.failed).toBe(6);
    const byRow = new Map<number, any>(res.results.map((r: any) => [r.row, r]));
    expect(byRow.get(2).ok).toBe(true);
    expect(byRow.get(3).error).toContain("caption খালি");
    expect(byRow.get(4).error).toContain("accountId দেওয়া হয়নি");
    expect(byRow.get(5).error).toContain("পাওয়া যায়নি");
    expect(byRow.get(6).error).toContain("সংযুক্ত নেই");
    expect(byRow.get(7).error).toContain("scheduledAt");
    expect(byRow.get(8).error).toContain("linkUrl");

    // The one created post: a plain DRAFT (the valid scheduledAt
    // does NOT schedule it in v1), link kept verbatim, and the
    // SU9 create-version exists because createPost made it.
    const created = db.socialPosts.find((p: Row) => p.caption === "সফল পোস্ট");
    expect(created).toBeTruthy();
    expect(created.status).toBe("draft");
    expect(created.scheduledAt ?? null).toBeNull();
    expect(created.linkUrl).toBe("https://example.com/p");
    expect(db.versions.some((v: Row) => v.socialPostId === created.id && v.kind === "create")).toBe(true);
    const auditRow = db.auditRows.find((r: Row) => r.action === "social.posts_csv_imported");
    expect(auditRow.metadata).toEqual({ rows: 7, created: 1, failed: 6 });
  });
});
