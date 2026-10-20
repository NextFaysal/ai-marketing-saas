process.env.ENCRYPTION_KEY = Buffer.alloc(32, 7).toString("base64");

import { BadRequestException, ConflictException, GoneException, NotFoundException } from "@nestjs/common";
import { SocialService, CLIENT_APPROVAL_PENDING_MSG } from "./social.service";
import { SocialPublishService } from "./social-publish.service";
import { SocialShareService } from "./social-share.service";

/**
 * SN2 — client approval share links + public review + publish
 * gate, proven at stubbed boundaries (fake Prisma, no live call
 * anywhere):
 * - share create (post + group; default 7-day expiry; absolute
 *   URL with API_PUBLIC_URL, relative path + honest note without);
 * - list (masked token, status derived from expiresAt/revokedAt);
 * - revoke → public GET 410; unknown token 404; expired 410;
 * - public payload WHITELIST (forbidden fields explicitly absent);
 * - review create + validation matrix + supersede (the latest
 *   review is effective in the payload AND at the gate);
 * - gate matrix: ON blocks publishNow / schedulePost / bulk
 *   reschedule / the worker with the verbatim reason until the
 *   latest review is "approved"; OFF is the pre-SN2 behaviour;
 * - the timeline gains REAL client-review entries.
 */

const ORG = "org-1";
const ACTOR = "owner-1";
type Row = Record<string, any>;

const SAVED_API_PUBLIC_URL = process.env.API_PUBLIC_URL;
afterEach(() => {
  if (SAVED_API_PUBLIC_URL === undefined) delete process.env.API_PUBLIC_URL;
  else process.env.API_PUBLIC_URL = SAVED_API_PUBLIC_URL;
});

function cmp(a: any, b: any): number {
  const ta = a instanceof Date ? a.getTime() : new Date(a).getTime();
  const tb = b instanceof Date ? b.getTime() : new Date(b).getTime();
  return ta - tb;
}

function matches(row: Row, where: any): boolean {
  return Object.entries(where ?? {}).every(([k, v]) => {
    if (v === undefined) return true;
    if (v !== null && typeof v === "object" && !(v instanceof Date)) {
      if ("in" in v) return (v as any).in.includes(row[k]);
      if ("lt" in v) return cmp(row[k], (v as any).lt) < 0;
      if ("lte" in v) return cmp(row[k], (v as any).lte) <= 0;
      if ("gt" in v) return cmp(row[k], (v as any).gt) > 0;
      if ("gte" in v) return cmp(row[k], (v as any).gte) >= 0;
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
      const row = { id: `${prefix}-${++seq}`, createdAt: new Date(), updatedAt: new Date(), ...data };
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
    delete: jest.fn(async ({ where }: any) => {
      const idx = store.findIndex((r) => matches(r, where));
      if (idx >= 0) store.splice(idx, 1);
      return {};
    }),
  };
}

function fakeDb() {
  const db: any = {
    organizations: [{ id: ORG, timezone: "Asia/Dhaka", socialRequireApproval: false, socialApprovalTwoStep: false, socialRequireClientApproval: false }],
    socialAccounts: [] as Row[], socialPosts: [] as Row[], socialPostGroups: [] as Row[],
    mediaAssets: [] as Row[], memberships: [] as Row[],
    shareLinks: [] as Row[], clientReviews: [] as Row[],
    versions: [] as Row[], notes: [] as Row[], auditRows: [] as Row[],
    auditInputs: [] as Row[],
  };
  db.organization = table(db.organizations, "org");
  db.socialAccount = table(db.socialAccounts, "acct");
  db.socialPost = table(db.socialPosts, "post");
  db.socialPostGroup = table(db.socialPostGroups, "group");
  db.mediaAsset = table(db.mediaAssets, "asset");
  db.membership = table(db.memberships, "mem");
  db.socialPostShareLink = table(db.shareLinks, "link");
  db.socialPostClientReview = table(db.clientReviews, "review");
  db.socialPostVersion = table(db.versions, "ver");
  db.socialPostNote = table(db.notes, "note");
  db.auditLog = table(db.auditRows, "audit");
  return db;
}

function services(db: any) {
  const audit = { log: jest.fn(async (input: any) => { db.auditInputs.push(input); }) };
  const social = new SocialService(db as any, audit as any);
  const shares = new SocialShareService(db as any, audit as any, social);
  const publish = new SocialPublishService(db as any, audit as any, social);
  return { audit, social, shares, publish };
}

function seedAccount(db: any, over: Row = {}) {
  db.socialAccounts.push({
    id: "acct-1", organizationId: ORG, platform: "meta_page", externalId: "page-1",
    name: "Qosprey Page", username: "qosprey", status: "connected", integrationId: "int-1",
    ...over,
  });
}

function seedPost(db: any, over: Row = {}) {
  const row: Row = {
    id: "post-1", organizationId: ORG, socialAccountId: "acct-1",
    caption: "ঈদ অফার — সীমিত সময়ের ছাড়", linkUrl: null, mediaRefs: [],
    status: "draft", scheduledAt: null, publishedAt: null,
    platformPostId: null, platformUrl: null, publishNote: null, error: null,
    attempts: 0, approvalStatus: null, firstCommentText: null,
    createdById: ACTOR, createdAt: new Date(), updatedAt: new Date(),
    ...over,
  };
  db.socialPosts.push(row);
  return row;
}

function seedGroup(db: any, over: Row = {}) {
  const row: Row = { id: "group-1", organizationId: ORG, name: "ঈদ ক্যাম্পেইন", createdById: ACTOR, createdAt: new Date(), updatedAt: new Date(), ...over };
  db.socialPostGroups.push(row);
  return row;
}

function futureIso(ms = 3_600_000): string {
  return new Date(Date.now() + ms).toISOString();
}

function stubPlatform(publish: SocialPublishService) {
  const fn = jest.fn(async () => ({ platformPostId: "plat-1", platformUrl: "https://example.com/p/1" }));
  (publish as any).publishToPlatform = fn;
  return fn;
}

async function makeLink(db: any, shares: SocialShareService, scope: { postId?: string; groupId?: string } = { postId: "post-1" }) {
  const out: any = await shares.createShareLink(ORG, ACTOR, scope, {});
  const token = db.shareLinks[db.shareLinks.length - 1].token as string;
  return { out, token };
}

describe("SN2 share link creation", () => {
  it("post link: default 7-day expiry, absolute URL when API_PUBLIC_URL is set, token shown only in url", async () => {
    process.env.API_PUBLIC_URL = "https://api.example.com";
    const db = fakeDb(); seedAccount(db); seedPost(db);
    const { shares } = services(db);
    const before = Date.now();
    const out: any = await shares.createShareLink(ORG, ACTOR, { postId: "post-1" }, {});
    const after = Date.now();
    expect(out.postId).toBe("post-1");
    expect(out.groupId).toBeNull();
    expect(out.status).toBe("active");
    expect(out.token).toBeUndefined();
    const row = db.shareLinks[0];
    expect(typeof row.token).toBe("string");
    expect(row.token.length).toBeGreaterThanOrEqual(40); // randomBytes(32) base64url
    expect(out.url).toBe(`https://api.example.com/share/social/${row.token}`);
    expect(out.urlNote).toBeUndefined();
    const expiryMs = new Date(row.expiresAt).getTime();
    expect(expiryMs).toBeGreaterThanOrEqual(before + 7 * 86_400_000 - 1000);
    expect(expiryMs).toBeLessThanOrEqual(after + 7 * 86_400_000 + 1000);
    expect(new Date(out.expiresAt).getTime()).toBe(expiryMs);
    // Audit carries the creation but NEVER the token.
    const auditRow = db.auditInputs.find((a: Row) => a.action === "social.share_link_created");
    expect(auditRow).toBeTruthy();
    expect(auditRow.entityId).toBe(row.id);
    expect(JSON.stringify(auditRow)).not.toContain(row.token);
  });

  it("no API_PUBLIC_URL → relative path + honest urlNote (SU6 fallback discipline)", async () => {
    delete process.env.API_PUBLIC_URL;
    const db = fakeDb(); seedAccount(db); seedPost(db);
    const { shares } = services(db);
    const out: any = await shares.createShareLink(ORG, ACTOR, { postId: "post-1" }, {});
    const row = db.shareLinks[0];
    expect(out.url).toBe(`/share/social/${row.token}`);
    expect(typeof out.urlNote).toBe("string");
    expect(out.urlNote).toContain("API_PUBLIC_URL");
  });

  it("explicit expiresInDays honoured; out-of-range values are Bengali 400s", async () => {
    const db = fakeDb(); seedAccount(db); seedPost(db);
    const { shares } = services(db);
    const out: any = await shares.createShareLink(ORG, ACTOR, { postId: "post-1" }, { expiresInDays: 3 });
    const diffDays = (new Date(out.expiresAt).getTime() - Date.now()) / 86_400_000;
    expect(diffDays).toBeGreaterThan(2.9);
    expect(diffDays).toBeLessThan(3.1);
    for (const bad of [0, -1, 366, 2.5, "seven"]) {
      const err = await shares.createShareLink(ORG, ACTOR, { postId: "post-1" }, { expiresInDays: bad }).catch((e) => e);
      expect(err).toMatchObject({ code: "social.theExpiryMustBeBetween1" });
    }
    expect(db.shareLinks).toHaveLength(1); // only the valid one was written
  });

  it("group link: groupId set, postId null; unknown post/group → 404", async () => {
    const db = fakeDb(); seedAccount(db); seedGroup(db); seedPost(db, { postGroupId: "group-1" });
    const { shares } = services(db);
    const out: any = await shares.createShareLink(ORG, ACTOR, { groupId: "group-1" }, {});
    expect(out.groupId).toBe("group-1");
    expect(out.postId).toBeNull();
    expect(db.shareLinks[0].groupId).toBe("group-1");
    expect(db.shareLinks[0].postId).toBeNull();
    await expect(shares.createShareLink(ORG, ACTOR, { postId: "nope" }, {})).rejects.toMatchObject({ code: "social.socialPostNotFoundInThis" });
    await expect(shares.createShareLink(ORG, ACTOR, { groupId: "nope" }, {})).rejects.toMatchObject({ code: "social.socialPostGroupNotFoundIn" });
    await expect(shares.createShareLink(ORG, ACTOR, { postId: "post-1", groupId: "group-1" }, {})).rejects.toMatchObject({ code: "social.aShareLinkIsForOne" });
  });
});

describe("SN2 share link list + revoke", () => {
  it("list: masked tokens only, status derived (active / expired / revoked)", async () => {
    const db = fakeDb(); seedAccount(db); seedPost(db);
    const { shares } = services(db);
    await makeLink(db, shares);
    await makeLink(db, shares);
    db.shareLinks.push({
      id: "link-old", organizationId: ORG, postId: "post-1", groupId: null,
      token: "expired-token-value-1234567890", expiresAt: new Date(Date.now() - 1000),
      revokedAt: null, createdById: ACTOR, createdAt: new Date(Date.now() - 90_000_000),
    });
    db.shareLinks.push({
      id: "link-dead", organizationId: ORG, postId: "post-1", groupId: null,
      token: "revoked-token-value-1234567890", expiresAt: new Date(Date.now() + 90_000_000),
      revokedAt: new Date(), createdById: ACTOR, createdAt: new Date(Date.now() - 80_000_000),
    });
    const list: any[] = await shares.listShareLinksForPost(ORG, "post-1");
    expect(list).toHaveLength(4);
    const byId = new Map<string, any>(list.map((l) => [l.id as string, l]));
    expect(byId.get("link-old").status).toBe("expired");
    expect(byId.get("link-dead").status).toBe("revoked");
    for (const item of list) {
      expect(item.status === "active" || item.id === "link-old" || item.id === "link-dead").toBe(true);
      expect(item.token).toBeUndefined();
      expect(item.url).toBeUndefined();
      expect(typeof item.tokenMasked).toBe("string");
    }
    const fullTokens = db.shareLinks.map((r: Row) => r.token);
    const serialized = JSON.stringify(list);
    for (const t of fullTokens) expect(serialized).not.toContain(t);
    expect(byId.get("link-old").tokenMasked).toBe("…7890");
    await expect(shares.listShareLinksForPost(ORG, "missing")).rejects.toMatchObject({ code: "social.socialPostNotFoundInThis" });
  });

  it("revoke: row kept with revokedAt, audited, public GET + review both 410", async () => {
    const db = fakeDb(); seedAccount(db); seedPost(db);
    const { shares } = services(db);
    const { out, token } = await makeLink(db, shares);
    const revoked: any = await shares.revokeShareLink(ORG, ACTOR, out.id);
    expect(revoked.status).toBe("revoked");
    expect(revoked.revokedAt).toBeTruthy();
    expect(db.shareLinks).toHaveLength(1); // row NOT deleted
    expect(db.shareLinks[0].revokedAt).toBeTruthy();
    expect(db.auditInputs.some((a: Row) => a.action === "social.share_link_revoked" && a.entityId === out.id)).toBe(true);
    const getErr = await shares.getPublicShare(token).catch((e) => e);
    expect(getErr).toMatchObject({ code: "social.thisShareLinkHasBeenRevoked" });
    expect(getErr.getStatus()).toBe(410);
    expect(getErr.message).toContain("বাতিল");
    const reviewErr = await shares.submitPublicReview(token, { postId: "post-1", reviewerName: "ক্লায়েন্ট", decision: "approved" }).catch((e) => e);
    expect(reviewErr).toMatchObject({ code: "social.thisShareLinkHasBeenRevoked" });
    expect(reviewErr.getStatus()).toBe(410);
    await expect(shares.revokeShareLink(ORG, ACTOR, "missing")).rejects.toMatchObject({ code: "social.shareLinkNotFoundInThis" });
  });

  it("unknown token → 404 on GET and review; expired link → 410 with the expiry message", async () => {
    const db = fakeDb(); seedAccount(db); seedPost(db);
    const { shares } = services(db);
    const nf = await shares.getPublicShare("no-such-token").catch((e) => e);
    expect(nf).toMatchObject({ code: "social.theShareLinkWasNotFound" });
    expect(nf.getStatus()).toBe(404);
    await expect(shares.submitPublicReview("no-such-token", { postId: "post-1", reviewerName: "x", decision: "approved" }))
      .rejects.toMatchObject({ code: "social.theShareLinkWasNotFound" });
    db.shareLinks.push({
      id: "link-exp", organizationId: ORG, postId: "post-1", groupId: null,
      token: "expired-live-token-abcdef", expiresAt: new Date(Date.now() - 60_000),
      revokedAt: null, createdById: ACTOR, createdAt: new Date(Date.now() - 8 * 86_400_000),
    });
    const gone = await shares.getPublicShare("expired-live-token-abcdef").catch((e) => e);
    expect(gone).toMatchObject({ code: "social.thisShareLinkHasExpiredContact" });
    expect(gone.getStatus()).toBe(410);
    expect(gone.message).toContain("মেয়াদ শেষ");
    await expect(shares.submitPublicReview("expired-live-token-abcdef", { postId: "post-1", reviewerName: "x", decision: "approved" }))
      .rejects.toMatchObject({ code: "social.thisShareLinkHasExpiredContact" });
    expect(db.clientReviews).toHaveLength(0);
  });
});

describe("SN2 public payload whitelist", () => {
  it("only whitelisted fields leave the API — internal data explicitly absent", async () => {
    const db = fakeDb(); seedAccount(db);
    db.mediaAssets.push({
      id: "asset-1", organizationId: ORG, kind: "image", name: "offer.png", contentType: "image/png",
      sizeBytes: 100, storageKey: "k/asset-1", publicToken: "asset-public-token-xyz", createdById: ACTOR,
    });
    seedPost(db, {
      caption: "ক্যাপশন — ক্লায়েন্ট দেখবে",
      mediaRefs: [{ assetId: "asset-1", kind: "image" }],
      firstCommentText: "SECRET-FIRST-COMMENT",
      linkUrl: "https://shop.example.com/secret-landing",
      submittedById: "secret-user", reviewedById: "secret-user", reviewNote: "internal note",
    });
    const { shares } = services(db);
    const { token } = await makeLink(db, shares);
    const payload: any = await shares.getPublicShare(token);
    expect(Object.keys(payload)).toEqual(["posts"]);
    expect(payload.posts).toHaveLength(1);
    const entry = payload.posts[0];
    expect(Object.keys(entry).sort()).toEqual([
      "accountDisplayName", "caption", "clientReview", "media", "platform", "postId", "status",
    ]);
    expect(entry.postId).toBe("post-1");
    expect(entry.caption).toBe("ক্যাপশন — ক্লায়েন্ট দেখবে");
    expect(entry.platform).toBe("meta_page");
    expect(entry.accountDisplayName).toBe("Qosprey Page");
    expect(entry.status).toBe("draft");
    expect(entry.media).toEqual([{ kind: "image", publicUrl: "/public/media/asset-public-token-xyz" }]);
    expect(entry.clientReview).toBeNull();
    const serialized = JSON.stringify(payload);
    for (const forbidden of [
      "SECRET-FIRST-COMMENT", "firstCommentText", "organizationId", ORG, "createdById", ACTOR,
      "socialAccountId", "acct-1", "submittedById", "reviewedById", "reviewNote", "notes", "versions",
      "linkUrl", "secret-landing", token, "shareLinkId", "storageKey",
    ]) {
      expect(serialized).not.toContain(forbidden);
    }
  });

  it("media without a public token gets one minted on the SP1 path (helper reuse)", async () => {
    const db = fakeDb(); seedAccount(db);
    db.mediaAssets.push({
      id: "asset-2", organizationId: ORG, kind: "image", name: "plain.png", contentType: "image/png",
      sizeBytes: 50, storageKey: "k/asset-2", publicToken: null, createdById: ACTOR,
    });
    seedPost(db, { mediaRefs: [{ assetId: "asset-2", kind: "image" }] });
    const { shares } = services(db);
    const { token } = await makeLink(db, shares);
    const payload: any = await shares.getPublicShare(token);
    const asset = db.mediaAssets[0];
    expect(asset.publicToken).toBeTruthy();
    expect(payload.posts[0].media).toEqual([{ kind: "image", publicUrl: `/public/media/${asset.publicToken}` }]);
  });

  it("group link returns every post of the group (and only those)", async () => {
    const db = fakeDb(); seedAccount(db); seedGroup(db);
    seedPost(db, { postGroupId: "group-1", caption: "FB variant" });
    seedPost(db, { id: "post-2", postGroupId: "group-1", caption: "IG variant" });
    seedPost(db, { id: "post-3", caption: "unrelated" });
    const { shares } = services(db);
    const { token } = await makeLink(db, shares, { groupId: "group-1" });
    const payload: any = await shares.getPublicShare(token);
    expect(payload.posts.map((p: Row) => p.postId).sort()).toEqual(["post-1", "post-2"]);
  });
});

describe("SN2 public review", () => {
  it("creates the review + audit (reviewer name in metadata, no userId) and returns the whitelist shape", async () => {
    const db = fakeDb(); seedAccount(db); seedPost(db);
    const { shares } = services(db);
    const { token } = await makeLink(db, shares);
    const out: any = await shares.submitPublicReview(token, {
      postId: "post-1", reviewerName: "  রহিম উদ্দিন  ", decision: "approved", comment: "  চমৎকার হয়েছে  ",
    });
    expect(out).toMatchObject({ postId: "post-1", decision: "approved", reviewerName: "রহিম উদ্দিন", comment: "চমৎকার হয়েছে" });
    expect(db.clientReviews).toHaveLength(1);
    expect(db.clientReviews[0]).toMatchObject({
      organizationId: ORG, postId: "post-1", reviewerName: "রহিম উদ্দিন", decision: "approved", comment: "চমৎকার হয়েছে",
    });
    expect(db.clientReviews[0].shareLinkId).toBe(db.shareLinks[0].id);
    const auditRow = db.auditInputs.find((a: Row) => a.action === "social.post_client_reviewed");
    expect(auditRow).toBeTruthy();
    expect(auditRow.entityType).toBe("SocialPost");
    expect(auditRow.entityId).toBe("post-1");
    expect(auditRow.userId).toBeUndefined();
    expect(auditRow.metadata).toMatchObject({ reviewerName: "রহিম উদ্দিন", decision: "approved", publicReview: true });
    const noComment: any = await shares.submitPublicReview(token, { postId: "post-1", reviewerName: "করিম", decision: "changes_requested" });
    expect(noComment.comment).toBeNull();
  });

  it("validation matrix: blank name 400, bad decision 400, missing postId 400, out-of-scope postId 400", async () => {
    const db = fakeDb(); seedAccount(db); seedPost(db); seedPost(db, { id: "post-2" });
    const { shares } = services(db);
    const { token } = await makeLink(db, shares);
    const cases: [Row, string][] = [
      [{ postId: "post-1", reviewerName: "   ", decision: "approved" }, "social.giveYourNameAReviewCannot"],
      [{ postId: "post-1", decision: "approved" }, "social.giveYourNameAReviewCannot"],
      [{ postId: "post-1", reviewerName: "নাম", decision: "ok" }, "social.asADecisionOnlyApprovedOr"],
      [{ postId: "post-1", reviewerName: "নাম", decision: "" }, "social.asADecisionOnlyApprovedOr"],
      [{ reviewerName: "নাম", decision: "approved" }, "social.sayWhichPostThisReviewIs"],
      [{ postId: "post-2", reviewerName: "নাম", decision: "approved" }, "social.thisPostIsNotCoveredBy"], // outside this link's scope
      [{ postId: "ghost", reviewerName: "নাম", decision: "approved" }, "social.thisPostIsNotCoveredBy"],
    ];
    for (const [body, code] of cases) {
      const err = await shares.submitPublicReview(token, body).catch((e) => e);
      expect(err).toMatchObject({ code });
      expect(err.getStatus()).toBe(400);
    }
    expect(db.clientReviews).toHaveLength(0);
  });

  it("group link scope: a group post accepts a review, an outside post is refused", async () => {
    const db = fakeDb(); seedAccount(db); seedGroup(db);
    seedPost(db, { postGroupId: "group-1" });
    seedPost(db, { id: "post-9" });
    const { shares } = services(db);
    const { token } = await makeLink(db, shares, { groupId: "group-1" });
    const ok: any = await shares.submitPublicReview(token, { postId: "post-1", reviewerName: "ক্লায়েন্ট", decision: "approved" });
    expect(ok.decision).toBe("approved");
    const err = await shares.submitPublicReview(token, { postId: "post-9", reviewerName: "ক্লায়েন্ট", decision: "approved" }).catch((e) => e);
    expect(err).toMatchObject({ code: "social.thisPostIsNotCoveredBy" });
    expect(db.clientReviews).toHaveLength(1);
  });

  it("supersede: the LATEST review is the effective one in the payload", async () => {
    const db = fakeDb(); seedAccount(db); seedPost(db);
    const { shares } = services(db);
    const { token } = await makeLink(db, shares);
    await shares.submitPublicReview(token, { postId: "post-1", reviewerName: "প্রথম", decision: "changes_requested", comment: "দাম বদলান" });
    let payload: any = await shares.getPublicShare(token);
    expect(payload.posts[0].clientReview).toMatchObject({ decision: "changes_requested", reviewerName: "প্রথম", comment: "দাম বদলান" });
    await shares.submitPublicReview(token, { postId: "post-1", reviewerName: "দ্বিতীয়", decision: "approved" });
    payload = await shares.getPublicShare(token);
    expect(payload.posts[0].clientReview).toMatchObject({ decision: "approved", reviewerName: "দ্বিতীয়" });
    expect(db.clientReviews).toHaveLength(2); // history kept, never rewritten
  });
});

describe("SN2 settings (socialRequireClientApproval)", () => {
  it("GET carries it (default false); PATCH flips only it; an absent field preserves it", async () => {
    const db = fakeDb();
    const { social } = services(db);
    const initial: any = await social.getSocialSettings(ORG);
    expect(initial).toEqual({ socialRequireApproval: false, socialApprovalTwoStep: false, socialRequireClientApproval: false });
    const updated: any = await social.updateSocialSettings(ORG, ACTOR, { socialRequireClientApproval: true });
    expect(updated.socialRequireClientApproval).toBe(true);
    expect(updated.socialRequireApproval).toBe(false);
    expect(db.organizations[0].socialRequireClientApproval).toBe(true);
    const preserved: any = await social.updateSocialSettings(ORG, ACTOR, { socialApprovalTwoStep: true });
    expect(preserved.socialRequireClientApproval).toBe(true);
    expect(preserved.socialApprovalTwoStep).toBe(true);
  });
});

describe("SN2 publish gate", () => {
  function gateOn(db: any) { db.organizations[0].socialRequireClientApproval = true; }

  async function approveViaLink(db: any, shares: SocialShareService) {
    const { token } = await makeLink(db, shares);
    await shares.submitPublicReview(token, { postId: "post-1", reviewerName: "ক্লায়েন্ট", decision: "approved" });
  }

  it("schedulePost: ON + no review → blocked with the verbatim reason; ON + approved → schedules; OFF → schedules without any review", async () => {
    const db = fakeDb(); seedAccount(db); seedPost(db);
    const { social, shares } = services(db);
    gateOn(db);
    const err = await social.schedulePost(ORG, ACTOR, "post-1", { scheduledAt: futureIso() } as any).catch((e) => e);
    expect(err).toBeInstanceOf(ConflictException);
    expect(err.message).toBe(CLIENT_APPROVAL_PENDING_MSG);
    expect(err.message).toBe("ক্লায়েন্ট অনুমোদন বাকি");
    expect(db.socialPosts[0].status).toBe("draft");
    await approveViaLink(db, shares);
    const scheduled: any = await social.schedulePost(ORG, ACTOR, "post-1", { scheduledAt: futureIso() } as any);
    expect(scheduled.status).toBe("scheduled");

    const db2 = fakeDb(); seedAccount(db2); seedPost(db2);
    const s2 = services(db2);
    const offResult: any = await s2.social.schedulePost(ORG, ACTOR, "post-1", { scheduledAt: futureIso() } as any);
    expect(offResult.status).toBe("scheduled"); // regression: OFF = pre-SN2 behaviour
  });

  it("schedulePost: ON + changes_requested (and approved-then-changes supersede) → blocked", async () => {
    const db = fakeDb(); seedAccount(db); seedPost(db);
    const { social, shares } = services(db);
    gateOn(db);
    const { token } = await makeLink(db, shares);
    await shares.submitPublicReview(token, { postId: "post-1", reviewerName: "ক", decision: "approved" });
    await shares.submitPublicReview(token, { postId: "post-1", reviewerName: "ক", decision: "changes_requested", comment: "ছবি বদলান" });
    const err = await social.schedulePost(ORG, ACTOR, "post-1", { scheduledAt: futureIso() } as any).catch((e) => e);
    expect(err).toBeInstanceOf(ConflictException);
    expect(err.message).toBe("ক্লায়েন্ট অনুমোদন বাকি");
    expect(db.socialPosts[0].status).toBe("draft");
  });

  it("publishNow: ON blocks (no platform call), ON + approved publishes, OFF publishes without review", async () => {
    const db = fakeDb(); seedAccount(db); seedPost(db);
    const svc = services(db);
    gateOn(db);
    const platform = stubPlatform(svc.publish);
    const err = await svc.publish.publishNow(ORG, ACTOR, "post-1").catch((e) => e);
    expect(err).toBeInstanceOf(ConflictException);
    expect(err.message).toBe("ক্লায়েন্ট অনুমোদন বাকি");
    expect(platform).not.toHaveBeenCalled();
    expect(db.socialPosts[0].status).toBe("draft");
    await approveViaLink(db, svc.shares);
    const done: any = await svc.publish.publishNow(ORG, ACTOR, "post-1");
    expect(done.status).toBe("published");
    expect(platform).toHaveBeenCalledTimes(1);

    const db2 = fakeDb(); seedAccount(db2); seedPost(db2);
    const s2 = services(db2);
    stubPlatform(s2.publish);
    const offDone: any = await s2.publish.publishNow(ORG, ACTOR, "post-1");
    expect(offDone.status).toBe("published"); // regression
  });

  it("worker: ON + no review → blocked back to draft with the verbatim error; ON + approved → published; OFF → published", async () => {
    const db = fakeDb(); seedAccount(db);
    seedPost(db, { status: "scheduled", scheduledAt: new Date(Date.now() - 60_000) });
    const svc = services(db);
    gateOn(db);
    const platform = stubPlatform(svc.publish);
    const counts = await svc.publish.runDuePublishes(ORG);
    expect(counts.blocked).toBe(1);
    expect(counts.published).toBe(0);
    expect(platform).not.toHaveBeenCalled();
    expect(db.socialPosts[0].status).toBe("draft");
    expect(db.socialPosts[0].error).toBe("ক্লায়েন্ট অনুমোদন বাকি");
    expect(db.socialPosts[0].scheduledAt).toBeNull();

    const db2 = fakeDb(); seedAccount(db2);
    seedPost(db2, { status: "scheduled", scheduledAt: new Date(Date.now() - 60_000) });
    const s2 = services(db2);
    gateOn(db2);
    await approveViaLink(db2, s2.shares);
    stubPlatform(s2.publish);
    const counts2 = await s2.publish.runDuePublishes(ORG);
    expect(counts2.published).toBe(1);
    expect(db2.socialPosts[0].status).toBe("published");

    const db3 = fakeDb(); seedAccount(db3);
    seedPost(db3, { status: "scheduled", scheduledAt: new Date(Date.now() - 60_000) });
    const s3 = services(db3);
    stubPlatform(s3.publish);
    const counts3 = await s3.publish.runDuePublishes(ORG);
    expect(counts3.published).toBe(1); // regression: OFF never blocks
    expect(db3.socialPosts[0].status).toBe("published");
  });

  it("bulk reschedule: ON gates per post (approved passes, unapproved gets the verbatim per-item error); OFF passes both", async () => {
    const db = fakeDb(); seedAccount(db); seedPost(db); seedPost(db, { id: "post-2" });
    const svc = services(db);
    gateOn(db);
    const { token } = await makeLink(db, svc.shares);
    await svc.shares.submitPublicReview(token, { postId: "post-1", reviewerName: "ক", decision: "approved" });
    const out: any = await svc.social.bulkPosts(ORG, ACTOR, { ids: ["post-1", "post-2"], action: "reschedule", scheduledAt: futureIso() });
    const byId = new Map<string, Row>(out.results.map((r: Row) => [r.id as string, r]));
    expect(byId.get("post-1")?.ok).toBe(true);
    expect(byId.get("post-2")?.ok).toBe(false);
    expect(byId.get("post-2")?.error).toBe("ক্লায়েন্ট অনুমোদন বাকি");
    expect(db.socialPosts.find((p: Row) => p.id === "post-2").status).toBe("draft");

    const db2 = fakeDb(); seedAccount(db2); seedPost(db2); seedPost(db2, { id: "post-2" });
    const s2 = services(db2);
    const out2: any = await s2.social.bulkPosts(ORG, ACTOR, { ids: ["post-1", "post-2"], action: "reschedule", scheduledAt: futureIso() });
    expect(out2.succeeded).toBe(2); // regression
  });

  it("group posts are gated per post: one variant's approval does not cover the other", async () => {
    const db = fakeDb(); seedAccount(db); seedGroup(db);
    seedPost(db, { postGroupId: "group-1" });
    seedPost(db, { id: "post-2", postGroupId: "group-1" });
    const svc = services(db);
    gateOn(db);
    const { token } = await makeLink(db, svc.shares, { groupId: "group-1" });
    await svc.shares.submitPublicReview(token, { postId: "post-1", reviewerName: "ক", decision: "approved" });
    const ok: any = await svc.social.schedulePost(ORG, ACTOR, "post-1", { scheduledAt: futureIso() } as any);
    expect(ok.status).toBe("scheduled");
    const err = await svc.social.schedulePost(ORG, ACTOR, "post-2", { scheduledAt: futureIso() } as any).catch((e) => e);
    expect(err).toBeInstanceOf(ConflictException);
    expect(err.message).toBe("ক্লায়েন্ট অনুমোদন বাকি");
  });
});

describe("SN2 timeline", () => {
  it("client reviews appear as REAL entries (reviewer / decision / comment / time); share create/revoke do not", async () => {
    const db = fakeDb(); seedAccount(db); seedPost(db);
    const { social, shares } = services(db);
    const { out, token } = await makeLink(db, shares);
    await shares.submitPublicReview(token, { postId: "post-1", reviewerName: "রহিম", decision: "changes_requested", comment: "দাম ঠিক করুন" });
    await shares.submitPublicReview(token, { postId: "post-1", reviewerName: "রহিম", decision: "approved" });
    await shares.revokeShareLink(ORG, ACTOR, out.id);
    const timeline: any[] = await social.getPostTimeline(ORG, "post-1");
    const reviewEntries = timeline.filter((e) => e.kind === "client_review");
    expect(reviewEntries).toHaveLength(2);
    expect(reviewEntries[0].meta).toMatchObject({ reviewerName: "রহিম", decision: "changes_requested", comment: "দাম ঠিক করুন" });
    expect(reviewEntries[0].label).toContain("রহিম");
    expect(reviewEntries[0].at).toBeTruthy();
    expect(reviewEntries[1].meta).toMatchObject({ reviewerName: "রহিম", decision: "approved" });
    // Nothing else sneaks in from share-link lifecycle events.
    expect(timeline.every((e) => e.kind === "client_review")).toBe(true);
  });
});
