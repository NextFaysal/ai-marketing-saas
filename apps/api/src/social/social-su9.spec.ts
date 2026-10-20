process.env.ENCRYPTION_KEY = Buffer.alloc(32, 9).toString("base64");

import { SocialService } from "./social.service";
import { SocialPublishService } from "./social-publish.service";

/**
 * SU9 — Collaboration v2, proven at the service boundary with
 * the SP7 fake-Prisma pattern:
 * - internal notes: CRUD, chronological list, the delete
 *   permission matrix (own note = any writer; someone else's =
 *   OWNER/ADMIN only, other writers 403), empty body = Bengali
 *   400, and notes never touch the post / publish fields.
 * - versions: createPost (and createPostGroup, which shares
 *   createPostRow) records version 1 kind "create"; a content
 *   change (caption / linkUrl / mediaRefs / firstCommentText)
 *   records the next version kind "edit"; a no-change edit and
 *   a non-content edit record NOTHING; clonePost — a direct
 *   socialPost.create path — records no version (documented
 *   limit); restore applies a snapshot, writes kind "restore",
 *   resets approval (audit approvalReset) and refuses
 *   non-draft posts.
 * - timeline: versions + notes + approval events read from the
 *   AuditLog (social rows carry entityType "SocialPost" +
 *   entityId = post id consistently) + publish state; when no
 *   approval audit row exists, ONE derived entry carries the
 *   post's CURRENT approval state flagged meta.derived.
 * - assign: ACTIVE org member only (else Bengali 400), null
 *   unassigns, listPosts filters only when asked.
 * - two-step approval: OFF = SP7 one-step exactly (including
 *   "manager_approved" not being approvable); ON: pending →
 *   manager_approved (own audit action, author not notified as
 *   approved) → approved; reject works from both steps; submit
 *   from manager_approved refuses; schedule / publishNow /
 *   worker gates accept ONLY "approved"; OWNER-authored posts
 *   still auto-approve FULLY at creation.
 */
const ORG = "org-1";
const OWNER = "owner-1";
const ADMIN = "admin-1";
const MM = "mm-1";
const MM2 = "mm-2";
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
    socialPostGroups: [] as Row[], socialPostNotes: [] as Row[], socialPostVersions: [] as Row[],
    mediaAssets: [] as Row[], memberships: [] as Row[], notifications: [] as Row[], auditRows: [] as Row[],
  };
  db.organization = table(db.organizations);
  db.socialAccount = table(db.socialAccounts);
  db.socialPostGroup = table(db.socialPostGroups);
  db.socialPostNote = table(db.socialPostNotes);
  db.socialPostVersion = table(db.socialPostVersions);
  db.mediaAsset = table(db.mediaAssets);
  db.membership = table(db.memberships);
  // The AuditLog READ model over the same rows the audit mock
  // writes — this is what getPostTimeline queries in production
  // (prisma.auditLog) and what the mock below feeds.
  db.auditLog = table(db.auditRows);
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
        platformUrl: null, publishNote: null, error: null, attempts: 0, mediaRefs: [],
        insights: null, insightsFetchedAt: null,
        approvalStatus: null, submittedById: null, reviewedById: null, reviewNote: null,
        postGroupId: null, firstCommentText: null, firstCommentStatus: null,
        assignedUserId: null,
        ...data,
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

function seedOrg(db: any, over: Row = {}) {
  const row = { id: ORG, timezone: "Asia/Dhaka", socialRequireApproval: false, socialApprovalTwoStep: false, ...over };
  db.organizations.push(row);
  return row;
}

function seedMember(db: any, userId: string, role: string, status = "ACTIVE") {
  const row = { id: `mem-${userId}`, organizationId: ORG, userId, role, status };
  db.memberships.push(row);
  return row;
}

function seedMembers(db: any) {
  seedMember(db, OWNER, "OWNER");
  seedMember(db, ADMIN, "ADMIN");
  seedMember(db, MM, "MARKETING_MANAGER");
  seedMember(db, MM2, "MARKETING_MANAGER");
}

function seedAccount(db: any, over: Row = {}) {
  const account = {
    id: `acct-${++seq}`, organizationId: ORG, integrationId: null,
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
    caption: "প্রথম ক্যাপশন", linkUrl: null, mediaRefs: [],
    status: "draft", scheduledAt: null, publishedAt: null, platformPostId: null,
    platformUrl: null, publishNote: null, error: null, attempts: 0,
    insights: null, insightsFetchedAt: null,
    approvalStatus: null, submittedById: null, reviewedById: null, reviewNote: null,
    postGroupId: null, firstCommentText: null, firstCommentStatus: null,
    assignedUserId: null,
    createdById: MM, createdAt: new Date(), updatedAt: new Date(), ...over,
  };
  db.socialPosts.push(row);
  return row;
}

function seedAsset(db: any, id: string, kind = "image") {
  const row = { id, organizationId: ORG, kind, name: id, contentType: "image/png", sizeBytes: 10, storageKey: `k-${id}`, createdById: MM, createdAt: new Date(), updatedAt: new Date() };
  db.mediaAssets.push(row);
  return row;
}

const stored = (db: any, id: string) => db.socialPosts.find((p: Row) => p.id === id);
const versionsOf = (db: any, postId: string) =>
  db.socialPostVersions.filter((v: Row) => v.socialPostId === postId).sort((a: Row, b: Row) => a.versionNo - b.versionNo);

// ----------------------------------------------------------------
// Notes
// ----------------------------------------------------------------

describe("SU9 notes", () => {
  it("create + list chronological (oldest first); body trimmed; audit written", async () => {
    const db = fakeDb(); seedOrg(db); seedMembers(db);
    const account = seedAccount(db);
    const post = seedPost(db, account.id);
    const { social } = services(db);
    const n1 = await social.createPostNote(ORG, MM, post.id, { body: "  প্রথম নোট  " });
    expect(n1.body).toBe("প্রথম নোট");
    expect(n1.authorId).toBe(MM);
    const n2 = await social.createPostNote(ORG, OWNER, post.id, { body: "দ্বিতীয় নোট" });
    // Pin the clock so the chronological assertion is exact.
    db.socialPostNotes.find((n: Row) => n.id === n2.id).createdAt = new Date(Date.now() - 60_000);
    const list = await social.listPostNotes(ORG, post.id);
    expect(list.map((n: any) => n.id)).toEqual([n2.id, n1.id]);
    expect(db.auditRows.some((r: Row) => r.action === "social.post_note_created" && r.entityId === post.id)).toBe(true);
  });

  it("empty / whitespace body → Bengali 400, nothing stored", async () => {
    const db = fakeDb(); seedOrg(db); seedMembers(db);
    const account = seedAccount(db);
    const post = seedPost(db, account.id);
    const { social } = services(db);
    await expect(social.createPostNote(ORG, MM, post.id, { body: "   " })).rejects.toThrow("নোট খালি রাখা যাবে না");
    await expect(social.createPostNote(ORG, MM, post.id, { body: "" })).rejects.toThrow("নোট খালি রাখা যাবে না");
    expect(db.socialPostNotes).toHaveLength(0);
  });

  it("delete matrix: own note any writer; other's note MM 403, ADMIN and OWNER allowed", async () => {
    const db = fakeDb(); seedOrg(db); seedMembers(db);
    const account = seedAccount(db);
    const post = seedPost(db, account.id);
    const { social } = services(db);
    const own = await social.createPostNote(ORG, MM, post.id, { body: "নিজের নোট" });
    await expect(social.deletePostNote(ORG, MM2, post.id, own.id)).rejects.toThrow("অন্যের নোট শুধু OWNER/ADMIN");
    expect(db.socialPostNotes).toHaveLength(1);
    const byAdminTarget = await social.createPostNote(ORG, MM, post.id, { body: "অ্যাডমিন মুছবে" });
    expect(await social.deletePostNote(ORG, ADMIN, post.id, byAdminTarget.id)).toEqual({ deleted: true, id: byAdminTarget.id });
    expect(await social.deletePostNote(ORG, MM, post.id, own.id)).toEqual({ deleted: true, id: own.id });
    const byOwnerTarget = await social.createPostNote(ORG, MM2, post.id, { body: "মালিক মুছবে" });
    expect((await social.deletePostNote(ORG, OWNER, post.id, byOwnerTarget.id)).deleted).toBe(true);
    expect(db.socialPostNotes).toHaveLength(0);
  });

  it("note on a missing post → 404; deleting another post's note → 404", async () => {
    const db = fakeDb(); seedOrg(db); seedMembers(db);
    const account = seedAccount(db);
    const post = seedPost(db, account.id);
    const other = seedPost(db, account.id);
    const { social } = services(db);
    const note = await social.createPostNote(ORG, MM, post.id, { body: "নোট" });
    await expect(social.createPostNote(ORG, MM, "no-such-post", { body: "x" })).rejects.toMatchObject({ code: "social.socialPostNotFoundInThis" });
    await expect(social.deletePostNote(ORG, OWNER, other.id, note.id)).rejects.toMatchObject({ code: "social.socialPostNoteNotFoundIn" });
  });

  it("notes never touch the post row / publish fields", async () => {
    const db = fakeDb(); seedOrg(db); seedMembers(db);
    const account = seedAccount(db);
    const post = seedPost(db, account.id, { caption: "অপরিবর্তিত" });
    const { social } = services(db);
    await social.createPostNote(ORG, MM, post.id, { body: "গোপন টিম নোট — দাম নিয়ে কথা বলতে হবে" });
    const after = stored(db, post.id);
    expect(after.caption).toBe("অপরিবর্তিত");
    expect(after.status).toBe("draft");
    expect(after.platformPostId).toBeNull();
    expect(JSON.stringify(after)).not.toContain("গোপন টিম নোট");
  });
});

// ----------------------------------------------------------------
// Versions
// ----------------------------------------------------------------

describe("SU9 versions", () => {
  it("createPost records version 1 (kind create) with the exact snapshot shape", async () => {
    const db = fakeDb(); seedOrg(db); seedMembers(db); seedAsset(db, "a1");
    const account = seedAccount(db);
    const { social } = services(db);
    const post = await social.createPost(ORG, MM, {
      socialAccountId: account.id, caption: "নতুন পোস্ট", linkUrl: "https://example.com/x",
      mediaRefs: [{ assetId: "a1", kind: "image" }], firstCommentText: "প্রথম কমেন্ট",
    });
    const versions = versionsOf(db, post.id);
    expect(versions).toHaveLength(1);
    expect(versions[0].versionNo).toBe(1);
    expect(versions[0].kind).toBe("create");
    expect(versions[0].changedById).toBe(MM);
    expect(versions[0].snapshot).toEqual({
      caption: "নতুন পোস্ট", linkUrl: "https://example.com/x",
      mediaRefs: [{ assetId: "a1", kind: "image" }], firstCommentText: "প্রথম কমেন্ট",
    });
    const listed = await social.listPostVersions(ORG, post.id);
    expect(listed.map((v: any) => v.versionNo)).toEqual([1]);
    expect(listed[0].snapshot).toEqual(versions[0].snapshot);
  });

  it("createPostGroup variants are versioned too (shared createPostRow path)", async () => {
    const db = fakeDb(); seedOrg(db); seedMembers(db);
    const account = seedAccount(db);
    const { social } = services(db);
    const group = await social.createPostGroup(ORG, MM, {
      name: "ঈদ গ্রুপ",
      variants: [
        { socialAccountId: account.id, caption: "ভ্যারিয়েন্ট এক" },
        { socialAccountId: account.id, caption: "ভ্যারিয়েন্ট দুই" },
      ],
    });
    expect(group.posts).toHaveLength(2);
    for (const p of group.posts) {
      const versions = versionsOf(db, p.id);
      expect(versions).toHaveLength(1);
      expect(versions[0].kind).toBe("create");
      expect(versions[0].snapshot.caption).toBe(p.caption);
    }
  });

  it("content edits record the next version; no-change and non-content edits record none", async () => {
    const db = fakeDb(); seedOrg(db); seedMembers(db); seedAsset(db, "a1"); seedAsset(db, "a2");
    const account = seedAccount(db);
    const { social } = services(db);
    const post = await social.createPost(ORG, MM, { socialAccountId: account.id, caption: "আসল" });
    expect(versionsOf(db, post.id)).toHaveLength(1);

    // No-change edit: same caption value.
    await social.updatePost(ORG, MM, post.id, { caption: "আসল" });
    expect(versionsOf(db, post.id)).toHaveLength(1);

    // Non-content edit only (YouTube title): no version.
    await social.updatePost(ORG, MM, post.id, { youtubeTitle: "শিরোনাম" } as any);
    expect(versionsOf(db, post.id)).toHaveLength(1);

    // Caption change → v2 edit.
    await social.updatePost(ORG, MM, post.id, { caption: "বদলানো" });
    let versions = versionsOf(db, post.id);
    expect(versions).toHaveLength(2);
    expect(versions[1]).toMatchObject({ versionNo: 2, kind: "edit", changedById: MM });
    expect(versions[1].snapshot.caption).toBe("বদলানো");

    // linkUrl + mediaRefs + firstComment changes → v3, v4, v5.
    await social.updatePost(ORG, MM, post.id, { linkUrl: "https://example.com/y" });
    await social.updatePost(ORG, MM, post.id, { mediaRefs: [{ assetId: "a1", kind: "image" }] });
    await social.updatePost(ORG, MM, post.id, { firstCommentText: "হ্যাশট্যাগ সেট" });
    versions = versionsOf(db, post.id);
    expect(versions.map((v: Row) => v.versionNo)).toEqual([1, 2, 3, 4, 5]);
    expect(versions[4].snapshot).toEqual({
      caption: "বদলানো", linkUrl: "https://example.com/y",
      mediaRefs: [{ assetId: "a1", kind: "image" }], firstCommentText: "হ্যাশট্যাগ সেট",
    });
    // Re-sending the same mediaRefs is not a change.
    await social.updatePost(ORG, MM, post.id, { mediaRefs: [{ assetId: "a1", kind: "image" }] });
    expect(versionsOf(db, post.id)).toHaveLength(5);
  });

  it("clonePost records NO version for the clone (documented non-hook path)", async () => {
    const db = fakeDb(); seedOrg(db); seedMembers(db);
    const account = seedAccount(db);
    const { social } = services(db);
    const post = await social.createPost(ORG, MM, { socialAccountId: account.id, caption: "মূল" });
    const clone = await social.clonePost(ORG, MM, post.id);
    expect(versionsOf(db, clone.id)).toHaveLength(0);
    expect(versionsOf(db, post.id)).toHaveLength(1);
  });

  it("restore applies the snapshot, writes a kind=restore version, and resets approval", async () => {
    const db = fakeDb(); seedOrg(db, { socialRequireApproval: true }); seedMembers(db);
    const account = seedAccount(db);
    const { social } = services(db);
    const post = await social.createPost(ORG, MM, { socialAccountId: account.id, caption: "v1 ক্যাপশন", firstCommentText: "v1 কমেন্ট" });
    await social.updatePost(ORG, MM, post.id, { caption: "v2 ক্যাপশন", firstCommentText: "v2 কমেন্ট" });
    // Give the edited post an approval state to be reset.
    Object.assign(stored(db, post.id), { approvalStatus: "approved", submittedById: MM, reviewedById: OWNER, reviewNote: null });
    const v1 = versionsOf(db, post.id)[0];
    const restored = await social.restorePostVersion(ORG, MM, post.id, v1.id);
    expect(restored.caption).toBe("v1 ক্যাপশন");
    expect(restored.firstCommentText).toBe("v1 কমেন্ট");
    expect(restored.approvalStatus).toBeNull();
    expect(restored.reviewedById).toBeNull();
    const versions = versionsOf(db, post.id);
    expect(versions.map((v: Row) => [v.versionNo, v.kind])).toEqual([[1, "create"], [2, "edit"], [3, "restore"]]);
    expect(versions[2].snapshot.caption).toBe("v1 ক্যাপশন");
    const audit = db.auditRows.find((r: Row) => r.action === "social.post_version_restored");
    expect(audit?.metadata?.approvalReset).toBe(true);
    expect(audit?.metadata?.restoredVersionNo).toBe(1);
    expect(audit?.metadata?.newVersionNo).toBe(3);
  });

  it("restore refuses non-draft posts and unknown versions", async () => {
    const db = fakeDb(); seedOrg(db); seedMembers(db);
    const account = seedAccount(db);
    const { social } = services(db);
    const post = await social.createPost(ORG, MM, { socialAccountId: account.id, caption: "খসড়া" });
    const v1 = versionsOf(db, post.id)[0];
    await expect(social.restorePostVersion(ORG, MM, post.id, "no-such-version")).rejects.toMatchObject({ code: "social.socialPostVersionNotFoundIn" });
    for (const status of ["published", "scheduled", "publishing"]) {
      stored(db, post.id).status = status;
      await expect(social.restorePostVersion(ORG, MM, post.id, v1.id)).rejects.toThrow("শুধু Draft পোস্টে");
    }
    expect(versionsOf(db, post.id)).toHaveLength(1); // refusals wrote nothing
  });
});

// ----------------------------------------------------------------
// Timeline
// ----------------------------------------------------------------

describe("SU9 timeline", () => {
  it("merges version + note + audit approval + publish chronologically", async () => {
    const db = fakeDb(); seedOrg(db, { socialRequireApproval: true }); seedMembers(db);
    const account = seedAccount(db);
    const { social } = services(db);
    const base = new Date("2026-10-01T00:00:00Z").getTime();
    const post = await social.createPost(ORG, MM, { socialAccountId: account.id, caption: "টাইমলাইন পোস্ট" });
    const note = await social.createPostNote(ORG, MM, post.id, { body: "টিম নোট এখানে" });
    await social.submitForApproval(ORG, MM, post.id);
    await social.approvePost(ORG, OWNER, post.id);
    // Pin every source's clock so the merged order is exact.
    db.socialPostVersions[0].createdAt = new Date(base + 1_000);
    db.socialPostNotes.find((n: Row) => n.id === note.id).createdAt = new Date(base + 2_000);
    const audits = db.auditRows.filter((r: Row) => r.entityId === post.id && r.action.startsWith("social.post_a"));
    audits.find((r: Row) => r.action === "social.post_approval_submitted").createdAt = new Date(base + 3_000);
    audits.find((r: Row) => r.action === "social.post_approved").createdAt = new Date(base + 4_000);
    Object.assign(stored(db, post.id), {
      status: "published", publishedAt: new Date(base + 5_000), platformPostId: "page-1_42", attempts: 1,
    });

    const timeline = await social.getPostTimeline(ORG, post.id);
    expect(timeline.map((e: any) => e.kind)).toEqual(["version", "note", "approval", "approval", "publish"]);
    expect(timeline[0].label).toBe("version 1 (create)");
    expect(timeline[1].label).toContain(MM);
    expect(timeline[1].label).toContain("টিম নোট এখানে");
    expect(timeline[2].meta?.action).toBe("social.post_approval_submitted");
    expect(timeline[3].meta?.action).toBe("social.post_approved");
    expect(timeline[4].meta?.platformPostId).toBe("page-1_42");
    // No derived fallback entry when audit events exist.
    expect(timeline.some((e: any) => e.meta?.derived)).toBe(false);
  });

  it("no approval audit rows → ONE derived entry with the CURRENT state, flagged derived", async () => {
    const db = fakeDb(); seedOrg(db); seedMembers(db);
    const account = seedAccount(db);
    const post = seedPost(db, account.id, {
      approvalStatus: "pending", submittedById: MM, reviewedById: null, reviewNote: null,
    });
    const { social } = services(db);
    const timeline = await social.getPostTimeline(ORG, post.id);
    const approvals = timeline.filter((e: any) => e.kind === "approval");
    expect(approvals).toHaveLength(1);
    expect(approvals[0].meta).toEqual({
      derived: true, approvalStatus: "pending", submittedById: MM, reviewedById: null, reviewNote: null,
    });
    expect(approvals[0].label).toContain("pending");
  });

  it("unpublished post with attempts → one last-attempt publish summary (verbatim error)", async () => {
    const db = fakeDb(); seedOrg(db); seedMembers(db);
    const account = seedAccount(db);
    const post = seedPost(db, account.id, { status: "failed", attempts: 2, error: "Meta বলেছে: token expired" });
    const { social } = services(db);
    const timeline = await social.getPostTimeline(ORG, post.id);
    const publish = timeline.filter((e: any) => e.kind === "publish");
    expect(publish).toHaveLength(1);
    expect(publish[0].meta).toEqual({ attempts: 2, error: "Meta বলেছে: token expired" });
    expect(publish[0].label).toContain("Meta বলেছে: token expired");
  });
});

// ----------------------------------------------------------------
// Assign
// ----------------------------------------------------------------

describe("SU9 assign", () => {
  it("valid ACTIVE member assigns; serializer + list filter expose it; audit written", async () => {
    const db = fakeDb(); seedOrg(db); seedMembers(db);
    const account = seedAccount(db);
    const p1 = seedPost(db, account.id);
    const p2 = seedPost(db, account.id);
    const { social } = services(db);
    const assigned = await social.assignPost(ORG, OWNER, p1.id, MM);
    expect(assigned.assignedUserId).toBe(MM);
    expect(stored(db, p1.id).assignedUserId).toBe(MM);
    expect(db.auditRows.some((r: Row) => r.action === "social.post_assigned" && r.metadata.assignedUserId === MM)).toBe(true);

    const all = await social.listPosts(ORG, {});
    expect(all).toHaveLength(2);
    expect(all.find((p: any) => p.id === p1.id)?.assignedUserId).toBe(MM);
    expect(all.find((p: any) => p.id === p2.id)?.assignedUserId).toBeNull();
    const filtered = await social.listPosts(ORG, { assignedUserId: MM });
    expect(filtered.map((p: any) => p.id)).toEqual([p1.id]);
    const noneFiltered = await social.listPosts(ORG, { assignedUserId: ADMIN });
    expect(noneFiltered).toHaveLength(0);
  });

  it("non-member and INACTIVE member → Bengali 400; null unassigns", async () => {
    const db = fakeDb(); seedOrg(db); seedMembers(db);
    seedMember(db, "gone-1", "MARKETING_MANAGER", "SUSPENDED");
    const account = seedAccount(db);
    const post = seedPost(db, account.id, { assignedUserId: MM });
    const { social } = services(db);
    await expect(social.assignPost(ORG, OWNER, post.id, "stranger-1")).rejects.toThrow("সক্রিয় সদস্য নন");
    await expect(social.assignPost(ORG, OWNER, post.id, "gone-1")).rejects.toThrow("সক্রিয় সদস্য নন");
    expect(stored(db, post.id).assignedUserId).toBe(MM); // failures changed nothing
    const unassigned = await social.assignPost(ORG, OWNER, post.id, null);
    expect(unassigned.assignedUserId).toBeNull();
  });
});

// ----------------------------------------------------------------
// Two-step approval
// ----------------------------------------------------------------

describe("SU9 two-step approval", () => {
  function setup(db: any, twoStep: boolean) {
    seedOrg(db, { socialRequireApproval: true, socialApprovalTwoStep: twoStep });
    seedMembers(db);
    const account = seedAccount(db);
    return account;
  }

  it("settings: get returns both switches; PATCH of one preserves the other + audit", async () => {
    const db = fakeDb(); seedOrg(db);
    const { social } = services(db);
    // SN2: the settings response also carries
    // socialRequireClientApproval (default false).
    expect(await social.getSocialSettings(ORG)).toEqual({ socialRequireApproval: false, socialApprovalTwoStep: false, socialRequireClientApproval: false });
    expect(await social.updateSocialSettings(ORG, OWNER, { socialApprovalTwoStep: true }))
      .toEqual({ socialRequireApproval: false, socialApprovalTwoStep: true, socialRequireClientApproval: false });
    expect(await social.updateSocialSettings(ORG, OWNER, { socialRequireApproval: true }))
      .toEqual({ socialRequireApproval: true, socialApprovalTwoStep: true, socialRequireClientApproval: false });
    expect(db.organizations[0].socialApprovalTwoStep).toBe(true);
    const audit = db.auditRows.find((r: Row) => r.action === "social.settings_updated" && r.metadata.socialApprovalTwoStep === true);
    expect(audit).toBeTruthy();
  });

  it("OFF regression: pending approves in ONE step; manager_approved is not approvable", async () => {
    const db = fakeDb(); const account = setup(db, false);
    const { social } = services(db);
    const post = await social.createPost(ORG, MM, { socialAccountId: account.id, caption: "এক ধাপ" });
    await social.submitForApproval(ORG, MM, post.id);
    const approved = await social.approvePost(ORG, ADMIN, post.id);
    expect(approved.approvalStatus).toBe("approved");
    const stuck = seedPost(db, account.id, { approvalStatus: "manager_approved", submittedById: MM });
    await expect(social.approvePost(ORG, OWNER, stuck.id)).rejects.toThrow("অনুমোদনের অপেক্ষায় নেই");
  });

  it("ON: pending → manager_approved (step-1 audit, no author 'approved' notice) → approved", async () => {
    const db = fakeDb(); const account = setup(db, true);
    const { social } = services(db);
    const post = await social.createPost(ORG, MM, { socialAccountId: account.id, caption: "দুই ধাপ" });
    await social.submitForApproval(ORG, MM, post.id);

    const step1 = await social.approvePost(ORG, ADMIN, post.id);
    expect(step1.approvalStatus).toBe("manager_approved");
    expect(step1.reviewedById).toBe(ADMIN);
    expect(db.auditRows.some((r: Row) => r.action === "social.post_manager_approved" && r.entityId === post.id && r.userId === ADMIN)).toBe(true);
    // The author must NOT be told the post is approved yet.
    expect(db.notifications.filter((n: Row) => n.type === "social_post_approved")).toHaveLength(0);

    const step2 = await social.approvePost(ORG, OWNER, post.id);
    expect(step2.approvalStatus).toBe("approved");
    expect(step2.reviewedById).toBe(OWNER);
    expect(db.auditRows.some((r: Row) => r.action === "social.post_approved" && r.entityId === post.id && r.userId === OWNER)).toBe(true);
    expect(db.notifications.filter((n: Row) => n.type === "social_post_approved" && n.userId === MM)).toHaveLength(1);
    await expect(social.approvePost(ORG, OWNER, post.id)).rejects.toThrow("অনুমোদনের অপেক্ষায় নেই");
  });

  it("ON: reject works from pending AND from manager_approved (note required)", async () => {
    const db = fakeDb(); const account = setup(db, true);
    const { social } = services(db);
    const p1 = await social.createPost(ORG, MM, { socialAccountId: account.id, caption: "এক" });
    await social.submitForApproval(ORG, MM, p1.id);
    const r1 = await social.rejectPost(ORG, OWNER, p1.id, { note: "ছবি বদলান" });
    expect(r1.approvalStatus).toBe("rejected");

    const p2 = await social.createPost(ORG, MM, { socialAccountId: account.id, caption: "দুই" });
    await social.submitForApproval(ORG, MM, p2.id);
    await social.approvePost(ORG, ADMIN, p2.id); // → manager_approved
    await expect(social.rejectPost(ORG, OWNER, p2.id, { note: "  " })).rejects.toThrow("কারণ (note) লিখতে হবে");
    const r2 = await social.rejectPost(ORG, OWNER, p2.id, { note: "দাম মিলছে না" });
    expect(r2.approvalStatus).toBe("rejected");
    expect(r2.reviewNote).toBe("দাম মিলছে না");
  });

  it("ON: submit from manager_approved refuses (no return to pending) for MM and OWNER alike", async () => {
    const db = fakeDb(); const account = setup(db, true);
    const { social } = services(db);
    const post = await social.createPost(ORG, MM, { socialAccountId: account.id, caption: "ধাপে আটকে" });
    await social.submitForApproval(ORG, MM, post.id);
    await social.approvePost(ORG, ADMIN, post.id);
    await expect(social.submitForApproval(ORG, MM, post.id)).rejects.toThrow("চূড়ান্ত অনুমোদনের অপেক্ষায়");
    await expect(social.submitForApproval(ORG, OWNER, post.id)).rejects.toThrow("চূড়ান্ত অনুমোদনের অপেক্ষায়");
    expect(stored(db, post.id).approvalStatus).toBe("manager_approved");
  });

  it("ON: schedule + publishNow + worker gates accept ONLY approved — manager_approved blocks everywhere", async () => {
    const db = fakeDb(); const account = setup(db, true);
    const { social, publish } = services(db);
    const at = new Date(Date.now() + 3600_000).toISOString();
    const post = seedPost(db, account.id, { approvalStatus: "manager_approved", submittedById: MM, reviewedById: ADMIN });
    await expect(social.schedulePost(ORG, MM, post.id, { scheduledAt: at })).rejects.toThrow("অনুমোদিত নয়");

    const fn = jest.fn(async () => ({ platformPostId: "x", platformUrl: null }));
    publish.publishToPlatform = fn as any;
    await expect(publish.publishNow(ORG, MM, post.id)).rejects.toThrow("অনুমোদিত নয়");
    expect(fn).not.toHaveBeenCalled();

    stored(db, post.id).status = "scheduled";
    stored(db, post.id).scheduledAt = new Date(Date.now() - 60_000);
    const counts = await publish.runDuePublishes(ORG);
    expect(counts.blocked).toBe(1);
    expect(counts.published).toBe(0);
    expect(fn).not.toHaveBeenCalled();
    expect(stored(db, post.id).status).toBe("draft");
  });

  it("ON: OWNER-authored post still auto-approves FULLY at creation; approver submit also fully approves", async () => {
    const db = fakeDb(); const account = setup(db, true);
    const { social } = services(db);
    const own = await social.createPost(ORG, OWNER, { socialAccountId: account.id, caption: "মালিকের নিজের" });
    expect(own.approvalStatus).toBe("approved");
    const mmPost = await social.createPost(ORG, MM, { socialAccountId: account.id, caption: "এমএম-এর" });
    const submitted = await social.submitForApproval(ORG, ADMIN, mmPost.id);
    expect(submitted.approvalStatus).toBe("approved");
  });

  it("ON: MM still cannot approve at either step (403)", async () => {
    const db = fakeDb(); const account = setup(db, true);
    const { social } = services(db);
    const post = await social.createPost(ORG, MM, { socialAccountId: account.id, caption: "অনুমোদন চাই" });
    await social.submitForApproval(ORG, MM, post.id);
    await expect(social.approvePost(ORG, MM2, post.id)).rejects.toThrow("শুধু OWNER/ADMIN");
    await social.approvePost(ORG, ADMIN, post.id);
    await expect(social.approvePost(ORG, MM, post.id)).rejects.toThrow("শুধু OWNER/ADMIN");
    expect(stored(db, post.id).approvalStatus).toBe("manager_approved");
  });
});
