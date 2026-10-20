import { BadRequestException } from "@nestjs/common";
import { SocialService } from "./social.service";
import { validateForPlatform, TIKTOK_PHOTO_GATE_MSG } from "./social-preflight";

/**
 * SU1 — Composer v2 (service + pre-flight):
 * - validateForPlatform matrix per platform, verbatim where an
 *   existing publisher rule owns the message.
 * - createPost: first comment starts "pending", recurrence mints
 *   a seriesId; interval without frequency is a 400.
 * - createPostGroup: variants validated up front (one bad variant
 *   → nothing is created), each variant its own post in the group.
 * - clonePost: any status → fresh draft, platform state cleared,
 *   grouped source → NEW group.
 * - schedulePost runs the SU1 pre-flight (not the worker).
 */
const ORG = "org-1";
const ACTOR = "owner-1";
type Row = Record<string, any>;

function matches(row: Row, where: any): boolean {
  return Object.entries(where ?? {}).every(([k, v]) => {
    if (v === null) return row[k] === null || row[k] === undefined;
    if (v && typeof v === "object" && !(v instanceof Date)) {
      if ("in" in v) return (v as any).in.includes(row[k]);
      if ("lte" in v) return row[k] != null && new Date(row[k]).getTime() <= new Date((v as any).lte).getTime();
      if ("lt" in v) return row[k] != null && new Date(row[k]).getTime() < new Date((v as any).lt).getTime();
      return true;
    }
    return row[k] === v;
  });
}

function table(store: Row[]) {
  return {
    findMany: jest.fn(async (args: any = {}) => {
      let rows = store.filter((r) => matches(r, args.where));
      const ob = args.orderBy ?? {};
      const key = Object.keys(ob)[0];
      if (key) {
        const dir = ob[key] === "desc" ? -1 : 1;
        rows = [...rows].sort((a, b) => dir * (new Date(a[key] ?? 0).getTime() - new Date(b[key] ?? 0).getTime()));
      }
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
    groups: [] as Row[], memberships: [] as Row[], auditRows: [] as Row[],
    organizations: [{ id: ORG, timezone: "Asia/Dhaka" }] as Row[],
  };
  db.socialAccount = table(db.socialAccounts);
  db.mediaAsset = table(db.mediaAssets);
  db.membership = table(db.memberships);
  db.organization = table(db.organizations);
  db.socialPostGroup = table(db.groups);
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
  const audit = { log: jest.fn(async (input: any) => { db.auditRows.push({ id: `audit-${db.auditRows.length + 1}`, ...input }); }) };
  return { social: new SocialService(db as any, audit as any), audit };
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

function seedAsset(db: any, over: Row = {}) {
  const row = {
    id: `asset-${db.mediaAssets.length + 1}`, organizationId: ORG, kind: "image",
    name: "photo.png", contentType: "image/png", sizeBytes: 100,
    storageKey: "k", publicToken: null, createdById: ACTOR,
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

const img = { assetId: "a", kind: "image" };
const vid = { assetId: "v", kind: "video" };

describe("SU1 validateForPlatform", () => {
  it("instagram: 0 media → SP6 verbatim; 11 media → PP4 verbatim; caption >2200 → Bengali 400 text; valid passes", () => {
    expect(validateForPlatform({ caption: "hi", mediaRefs: [] }, "instagram"))
      .toBe("Instagram-এ প্রকাশের জন্য একটি ছবি বা ভিডিও লাগবে — শুধু লেখার পোস্ট Instagram-এ করা যায় না।");
    const eleven = Array.from({ length: 11 }, (_, i) => ({ assetId: `a${i}`, kind: "image" }));
    expect(validateForPlatform({ caption: "hi", mediaRefs: eleven }, "instagram"))
      .toBe("Instagram Carousel-এ সর্বোচ্চ ১০টি মিডিয়া রাখা যায় — মিডিয়ার সংখ্যা কমিয়ে আবার চেষ্টা করুন।");
    expect(validateForPlatform({ caption: "x".repeat(2201), mediaRefs: [img] }, "instagram")).toContain("২২০০");
    expect(validateForPlatform({ caption: "ok", mediaRefs: [img] }, "instagram")).toBeNull();
  });

  it("youtube: title (first line) >100 → Bengali; caption >5000 → Bengali; video-only rule first", () => {
    expect(validateForPlatform({ caption: `${"t".repeat(101)}\nbody`, mediaRefs: [vid] }, "youtube")).toContain("১০০");
    expect(validateForPlatform({ caption: `short\n${"b".repeat(5000)}`, mediaRefs: [vid] }, "youtube")).toContain("৫০০০");
    expect(validateForPlatform({ caption: "ok title", mediaRefs: [vid] }, "youtube")).toBeNull();
  });

  it("tiktok: two videos hit the video-only verbatim message; an image is the SN1 photo gate", () => {
    const expected = "TikTok-এর পোস্টে ঠিক একটি Video লাগবে — ছবি বা একাধিক মিডিয়া দিয়ে TikTok-এ প্রকাশ করা যায় না। একটি Video বেছে নিন।";
    expect(validateForPlatform({ caption: "c", mediaRefs: [vid, vid] }, "tiktok")).toBe(expected);
    // SN1 supersedes the SU1-era wording for image posts: an
    // image is now a PHOTO post behind the audit gate — gate off
    // (no flag) refuses with the gate message, gate on accepts.
    expect(validateForPlatform({ caption: "c", mediaRefs: [img] }, "tiktok")).toBe(TIKTOK_PHOTO_GATE_MSG);
    expect(validateForPlatform({ caption: "c", mediaRefs: [img], tiktokAudited: true }, "tiktok")).toBeNull();
    expect(validateForPlatform({ caption: "c", mediaRefs: [vid] }, "tiktok")).toBeNull();
  });

  it("meta_page: mixed video → SP6 verbatim; text-only and images-only pass", () => {
    expect(validateForPlatform({ caption: "c", mediaRefs: [vid, img] }, "meta_page"))
      .toBe("একাধিক মিডিয়ার মধ্যে ভিডিও থাকলে Facebook Page-এ একসাথে প্রকাশ করা যায় না — শুধু ছবিগুলো একসাথে, অথবা শুধু একটি ভিডিও রাখুন।");
    expect(validateForPlatform({ caption: "c", mediaRefs: [] }, "meta_page")).toBeNull();
    expect(validateForPlatform({ caption: "c", mediaRefs: [img, img] }, "meta_page")).toBeNull();
    expect(validateForPlatform({ caption: "c", mediaRefs: [vid] }, "meta_page")).toBeNull();
  });
});

describe("SU1 createPost", () => {
  it("firstCommentText is trimmed and starts pending; blank becomes null", async () => {
    const db = fakeDb(); seedAccount(db);
    const { social } = services(db);
    const withComment = await social.createPost(ORG, ACTOR, {
      socialAccountId: "sacc-1", caption: "ক্যাপশন", firstCommentText: "  #offer লিংক  ",
    } as any);
    expect(withComment.firstCommentText).toBe("#offer লিংক");
    expect(withComment.firstCommentStatus).toBe("pending");
    const without = await social.createPost(ORG, ACTOR, {
      socialAccountId: "sacc-1", caption: "ক্যাপশন ২", firstCommentText: "   ",
    } as any);
    expect(without.firstCommentText).toBeNull();
    expect(without.firstCommentStatus).toBeNull();
  });

  it("recurrence mints a seriesId; interval alone → 400 and nothing created", async () => {
    const db = fakeDb(); seedAccount(db);
    const { social } = services(db);
    const recurring = await social.createPost(ORG, ACTOR, {
      socialAccountId: "sacc-1", caption: "শুক্রবারের অফার",
      recurrenceFrequency: "weekly", recurrenceInterval: 1,
    } as any);
    expect(recurring.recurrenceFrequency).toBe("weekly");
    expect(typeof recurring.seriesId).toBe("string");
    expect(recurring.seriesId.length).toBeGreaterThan(10);
    const err = await social.createPost(ORG, ACTOR, {
      socialAccountId: "sacc-1", caption: "ভুল", recurrenceInterval: 2,
    } as any).catch((e) => e);
    expect(err).toMatchObject({ code: "social.toGiveARepeatIntervalFirst" });
    expect(db.socialPosts).toHaveLength(1);
  });
});

describe("SU1 createPostGroup", () => {
  it("two variants with different captions land in one group", async () => {
    const db = fakeDb();
    seedAccount(db);
    seedAccount(db, { id: "sacc-ig", platform: "instagram", externalId: "ig-1" });
    const asset = seedAsset(db);
    const { social } = services(db);
    const group = await social.createPostGroup(ORG, ACTOR, {
      name: "ঈদ ক্যাম্পেইন",
      variants: [
        { socialAccountId: "sacc-1", caption: "Facebook ক্যাপশন" },
        { socialAccountId: "sacc-ig", caption: "Instagram ক্যাপশন", mediaRefs: [{ assetId: asset.id, kind: "image" }] },
      ],
    } as any);
    expect(group.name).toBe("ঈদ ক্যাম্পেইন");
    expect(group.posts).toHaveLength(2);
    expect(group.posts.map((p: any) => p.caption).sort()).toEqual(["Facebook ক্যাপশন", "Instagram ক্যাপশন"].sort());
    expect(group.posts.every((p: any) => p.postGroupId === group.id)).toBe(true);
    expect(db.socialPosts).toHaveLength(2);
    const fetched = await social.getGroup(ORG, group.id);
    expect(fetched.posts).toHaveLength(2);
    const listed = await social.listGroups(ORG);
    expect(listed).toHaveLength(1);
  });

  it("one invalid variant → nothing is created (no group, no posts)", async () => {
    const db = fakeDb(); seedAccount(db);
    const { social } = services(db);
    const err = await social.createPostGroup(ORG, ACTOR, {
      name: "ভাঙা গ্রুপ",
      variants: [
        { socialAccountId: "sacc-1", caption: "ঠিক আছে" },
        { socialAccountId: "sacc-1", caption: "   " },
      ],
    } as any).catch((e) => e);
    expect(err).toMatchObject({ code: "social.theCaptionCannotBeLeftEmpty" });
    expect(db.groups).toHaveLength(0);
    expect(db.socialPosts).toHaveLength(0);
  });
});

describe("SU1 clonePost", () => {
  it("published grouped post → new draft in a NEW group, platform fields cleared, evergreen config copied with counters reset", async () => {
    const db = fakeDb(); seedAccount(db);
    const groupRow = { id: "group-1", organizationId: ORG, name: "আসল গ্রুপ", createdById: ACTOR, createdAt: new Date(), updatedAt: new Date() };
    db.groups.push(groupRow);
    const source = seedPost(db, {
      status: "published", publishedAt: new Date(), platformPostId: "fb-1", platformUrl: "https://facebook.com/fb-1",
      postGroupId: "group-1", caption: "আসল ক্যাপশন", linkUrl: "https://shop.example.com",
      firstCommentText: "#tag", firstCommentStatus: "posted", firstCommentId: "c-1",
      isEvergreen: true, evergreenMinGapDays: 7, evergreenMaxCycles: 3,
      evergreenCyclesUsed: 2, evergreenLastRecycledAt: new Date(),
      seriesId: "series-1", recurrenceFrequency: "weekly",
    });
    const { social } = services(db);
    const clone = await social.clonePost(ORG, ACTOR, source.id);
    expect(clone.status).toBe("draft");
    expect(clone.caption).toBe("আসল ক্যাপশন");
    expect(clone.linkUrl).toBe("https://shop.example.com");
    expect(clone.platformPostId).toBeNull();
    expect(clone.platformUrl).toBeNull();
    expect(clone.publishedAt).toBeNull();
    expect(clone.firstCommentText).toBe("#tag");
    expect(clone.firstCommentStatus).toBe("pending");
    expect(clone.isEvergreen).toBe(true);
    expect(clone.evergreenMinGapDays).toBe(7);
    expect(clone.evergreenMaxCycles).toBe(3);
    expect(clone.evergreenCyclesUsed).toBe(0);
    expect(clone.evergreenLastRecycledAt).toBeNull();
    // Recurrence is NOT copied.
    expect(clone.seriesId).toBeNull();
    expect(clone.recurrenceFrequency).toBeNull();
    // A new group, named after the source group.
    expect(clone.postGroupId).toBeTruthy();
    expect(clone.postGroupId).not.toBe("group-1");
    const newGroup = db.groups.find((g: Row) => g.id === clone.postGroupId);
    expect(newGroup.name).toBe("আসল গ্রুপ");
    expect(db.auditRows.some((r: Row) => r.action === "social.post_cloned" && r.metadata?.sourcePostId === source.id)).toBe(true);
  });

  it("ungrouped post → clone has postGroupId null and no group is created", async () => {
    const db = fakeDb(); seedAccount(db);
    const source = seedPost(db, { status: "published", publishedAt: new Date(), platformPostId: "fb-9" });
    const { social } = services(db);
    const clone = await social.clonePost(ORG, ACTOR, source.id);
    expect(clone.status).toBe("draft");
    expect(clone.postGroupId).toBeNull();
    expect(db.groups).toHaveLength(0);
  });
});

describe("SU1 schedulePost pre-flight", () => {
  it("instagram post with zero media → 400 at schedule time, still draft", async () => {
    const db = fakeDb();
    seedAccount(db, { id: "sacc-ig", platform: "instagram", externalId: "ig-1" });
    const post = seedPost(db, { socialAccountId: "sacc-ig", mediaRefs: [] });
    const { social } = services(db);
    const err = await social.schedulePost(ORG, ACTOR, post.id, {
      scheduledAt: new Date(Date.now() + 3600_000).toISOString(),
    }).catch((e) => e);
    expect(err).toBeInstanceOf(BadRequestException);
    expect(err.message).toContain("শুধু লেখার পোস্ট Instagram-এ করা যায় না");
    expect(db.socialPosts.find((p: Row) => p.id === post.id).status).toBe("draft");
  });

  it("updatePost: first comment + recurrence edits (clearing frequency clears the series)", async () => {
    const db = fakeDb(); seedAccount(db);
    const post = seedPost(db, { seriesId: "s-1", recurrenceFrequency: "daily", recurrenceInterval: 1 });
    const { social } = services(db);
    const updated = await social.updatePost(ORG, ACTOR, post.id, {
      firstCommentText: "নতুন কমেন্ট", recurrenceFrequency: null,
    } as any);
    expect(updated.firstCommentText).toBe("নতুন কমেন্ট");
    expect(updated.firstCommentStatus).toBe("pending");
    expect(updated.recurrenceFrequency).toBeNull();
    expect(updated.seriesId).toBeNull();
    const cleared = await social.updatePost(ORG, ACTOR, post.id, { firstCommentText: null } as any);
    expect(cleared.firstCommentText).toBeNull();
    expect(cleared.firstCommentStatus).toBeNull();
  });
});
