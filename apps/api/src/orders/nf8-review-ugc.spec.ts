import { BadRequestException, NotFoundException } from "@nestjs/common";
import { ApiException } from "../i18n";
import { ReviewsService, reviewMediaOf } from "./reviews.service";
import { ProductReviewsService } from "./product-reviews.service";
import { normalizeGoogleReviewUrl } from "../organizations/organizations.service";

/**
 * NF8 (FB3) — Review & UGC upgrade.
 * (a) upload guards enforced through the real guard path
 *     (creative-upload type/size constants + magic-byte sniff);
 * (b) an unapproved review and its media are never public;
 *     an approved (received + visible, EC15) review's media can
 *     be public;
 * (c) the Google offer exists ONLY for rating >= 4 AND a
 *     configured org link — and is data, never a redirect;
 * (d) the social draft is created exactly once per review and
 *     lands as a draft through SocialService.createPost;
 * (e) org isolation across tokens, settings and drafts.
 * All sends/uploads are proven ONLY via fakes at the seams.
 */
const ORG = "org-1";
const ORG2 = "org-2";
const GOOGLE = "https://g.page/r/example/review";

const PNG = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.alloc(64, 7)]);
const MP4 = Buffer.concat([Buffer.alloc(4), Buffer.from("ftypisom", "latin1"), Buffer.alloc(64, 9)]);
const TEXT = Buffer.from("this is definitely not a png file at all........", "utf8");

function matches(row: any, where: any): boolean {
  return Object.entries(where ?? {}).every(([k, v]) => {
    if (v === undefined) return true;
    if (v && typeof v === "object" && "in" in (v as any)) return (v as any).in.includes(row[k]);
    if (v && typeof v === "object" && "not" in (v as any)) return row[k] !== (v as any).not;
    return row[k] === v;
  });
}
function table(rows: any[]) {
  return {
    rows,
    findFirst: async ({ where }: any) => rows.find((r) => matches(r, where)) ?? null,
    findMany: async ({ where }: any = {}) => rows.filter((r) => matches(r, where ?? {})),
    create: async ({ data }: any) => { const row = { id: `new-${rows.length + 1}`, ...data }; rows.push(row); return row; },
    update: async ({ where, data }: any) => { const r = rows.find((x) => x.id === where.id)!; Object.assign(r, data); return r; },
  };
}

// ---------------- ReviewsService (media + google offer) ----------------

function makeReviewsSvc(opts: { googleUrl?: string | null } = {}) {
  const reviews: any[] = [
    { id: "rev-open", organizationId: ORG, orderId: "ord-1", customerId: "cus-1", rating: null, comment: null, status: "requested", reviewToken: "tok-open", deliveredAt: new Date(), requestedAt: new Date(), receivedAt: null, media: null, socialDraftPostId: null },
    { id: "rev-done", organizationId: ORG, orderId: "ord-2", customerId: "cus-1", rating: 5, comment: "দারুণ", status: "received", reviewToken: "tok-done", deliveredAt: new Date(), requestedAt: new Date(), receivedAt: new Date(), media: null, socialDraftPostId: null },
    { id: "rev-other-org", organizationId: ORG2, orderId: "ord-9", customerId: "cus-9", rating: null, comment: null, status: "requested", reviewToken: "tok-org2", deliveredAt: new Date(), requestedAt: new Date(), receivedAt: null, media: null, socialDraftPostId: null },
  ];
  const orgs: any[] = [
    { id: ORG, name: "Meghna", brandName: "Meghna Attire", logoUrl: null, primaryColor: null, googleReviewUrl: opts.googleUrl ?? null },
    { id: ORG2, name: "Other", brandName: null, logoUrl: null, primaryColor: null, googleReviewUrl: null },
  ];
  const prisma = {
    orderReview: table(reviews),
    organization: table(orgs),
    order: table([{ id: "ord-1", organizationId: ORG, externalNumber: "1042" }, { id: "ord-2", organizationId: ORG, externalNumber: "1043" }]),
  };
  // Fake object storage: an in-memory private bucket.
  const objects = new Map<string, Buffer>();
  const deleted: string[] = [];
  const storage: any = {
    mode: "s3",
    bucketFor: (v: string) => `${v}-bucket`,
    presignedPutUrl: (v: string, key: string) => `https://put.example/${v}/${key}`,
    signedGetUrl: (v: string, key: string) => `https://signed.example/${v}/${key}`,
    head: async (_v: string, key: string) => (objects.has(key) ? { sizeBytes: objects.get(key)!.length } : null),
    get: async (_v: string, key: string) => objects.get(key) ?? null,
    copy: async (from: any, to: any) => { objects.set(to.key, objects.get(from.key)!); return { etag: null }; },
    delete: async (_v: string, key: string) => { deleted.push(key); objects.delete(key); },
  };
  const registered: any[] = [];
  const registry: any = { register: async (i: any) => { registered.push(i); return i; } };
  const audits: any[] = [];
  const svc = new ReviewsService(
    prisma as any, undefined, undefined, undefined,
    { log: async (i: any) => { audits.push(i); } } as any,
    storage, registry,
  );
  return { svc, reviews, orgs, objects, deleted, registered, audits };
}

describe("NF8 (a) review media upload — guards through the real path", () => {
  it("presign rejects a disallowed type, an oversize image and an oversize video", async () => {
    const { svc } = makeReviewsSvc();
    await expect(svc.presignReviewMedia("tok-open", { kind: "image", contentType: "image/gif", sizeBytes: 1000 })).rejects.toBeInstanceOf(ApiException);
    await expect(svc.presignReviewMedia("tok-open", { kind: "image", contentType: "image/png", sizeBytes: 11 * 1024 * 1024 })).rejects.toBeInstanceOf(ApiException);
    await expect(svc.presignReviewMedia("tok-open", { kind: "video", contentType: "video/mp4", sizeBytes: 51 * 1024 * 1024 })).rejects.toBeInstanceOf(ApiException);
    await expect(svc.presignReviewMedia("tok-open", { kind: "video", contentType: "video/avi", sizeBytes: 1000 })).rejects.toBeInstanceOf(ApiException);
    await expect(svc.presignReviewMedia("tok-open", { kind: "file", contentType: "image/png", sizeBytes: 1000 })).rejects.toBeInstanceOf(ApiException);
  });

  it("unknown token 404s on both steps (token is the only credential)", async () => {
    const { svc } = makeReviewsSvc();
    await expect(svc.presignReviewMedia("nope", { kind: "image", contentType: "image/png", sizeBytes: 10 })).rejects.toBeInstanceOf(ApiException);
    await expect(svc.completeReviewMedia("nope", { key: "k", kind: "image", contentType: "image/png", sizeBytes: 10 })).rejects.toBeInstanceOf(ApiException);
  });

  it("happy path: presign -> PUT -> complete attaches the media as a PRIVATE key + registry row; quarantine dropped", async () => {
    const { svc, reviews, objects, registered, deleted } = makeReviewsSvc();
    const pre: any = await svc.presignReviewMedia("tok-open", { kind: "image", contentType: "image/png", sizeBytes: PNG.length });
    expect(pre.uploadUrl).toContain("private");
    expect(pre.key.startsWith(`_quarantine/${ORG}/review/`)).toBe(true);
    objects.set(pre.key, PNG); // the browser's direct PUT
    const out: any = await svc.completeReviewMedia("tok-open", { key: pre.key, kind: "image", contentType: "image/png", sizeBytes: PNG.length });
    expect(out.ok).toBe(true);
    expect(out.media).toHaveLength(1);
    const item = out.media[0];
    expect(item.key.startsWith(`${ORG}/review/`)).toBe(true);
    expect(item.key.endsWith(".png")).toBe(true);
    expect(item.kind).toBe("image");
    expect(reviewMediaOf(reviews[0])).toHaveLength(1);
    expect(registered).toHaveLength(1);
    expect(registered[0]).toMatchObject({ organizationId: ORG, visibility: "private", surface: "review", sourceRef: "orderReview:rev-open" });
    expect(deleted).toContain(pre.key); // quarantine removed
  });

  it("a video (ftyp) completes as video/mp4", async () => {
    const { svc, objects } = makeReviewsSvc();
    const pre: any = await svc.presignReviewMedia("tok-open", { kind: "video", contentType: "video/mp4", sizeBytes: MP4.length });
    objects.set(pre.key, MP4);
    const out: any = await svc.completeReviewMedia("tok-open", { key: pre.key, kind: "video", contentType: "video/mp4", sizeBytes: MP4.length });
    expect(out.media[0].kind).toBe("video");
    expect(out.media[0].key.endsWith(".mp4")).toBe(true);
  });

  it("sniff mismatch is rejected and the object deleted: text bytes declared as PNG never attach", async () => {
    const { svc, reviews, objects, deleted } = makeReviewsSvc();
    const pre: any = await svc.presignReviewMedia("tok-open", { kind: "image", contentType: "image/png", sizeBytes: TEXT.length });
    objects.set(pre.key, TEXT);
    await expect(svc.completeReviewMedia("tok-open", { key: pre.key, kind: "image", contentType: "image/png", sizeBytes: TEXT.length })).rejects.toBeInstanceOf(ApiException);
    expect(reviewMediaOf(reviews[0])).toHaveLength(0);
    expect(deleted).toContain(pre.key);
  });

  it("declared size != landed size is rejected at complete (HEAD check)", async () => {
    const { svc, objects } = makeReviewsSvc();
    const pre: any = await svc.presignReviewMedia("tok-open", { kind: "image", contentType: "image/png", sizeBytes: PNG.length });
    objects.set(pre.key, PNG);
    await expect(svc.completeReviewMedia("tok-open", { key: pre.key, kind: "image", contentType: "image/png", sizeBytes: PNG.length + 5 })).rejects.toBeInstanceOf(ApiException);
  });

  it("a quarantine key from ANOTHER org's prefix is refused (org binding)", async () => {
    const { svc, objects } = makeReviewsSvc();
    const foreignKey = `_quarantine/${ORG2}/review/abc`;
    objects.set(foreignKey, PNG);
    await expect(svc.completeReviewMedia("tok-open", { key: foreignKey, kind: "image", contentType: "image/png", sizeBytes: PNG.length })).rejects.toBeInstanceOf(ApiException);
  });

  it("no uploads after the review is submitted, and the 4-item cap holds", async () => {
    const { svc, reviews } = makeReviewsSvc();
    await expect(svc.presignReviewMedia("tok-done", { kind: "image", contentType: "image/png", sizeBytes: 10 })).rejects.toBeInstanceOf(ApiException);
    reviews[0].media = [1, 2, 3, 4].map((n) => ({ key: `${ORG}/review/k${n}.png`, kind: "image", contentType: "image/png", sizeBytes: 10 }));
    await expect(svc.presignReviewMedia("tok-open", { kind: "image", contentType: "image/png", sizeBytes: 10 })).rejects.toBeInstanceOf(ApiException);
  });
});

describe("NF8 (c) Google offer — only rating >= 4 AND configured link; offer, never redirect", () => {
  it("the full matrix via googleReviewOffer", async () => {
    const withLink = makeReviewsSvc({ googleUrl: GOOGLE });
    expect(await withLink.svc.googleReviewOffer(ORG, 5)).toEqual({ url: GOOGLE });
    expect(await withLink.svc.googleReviewOffer(ORG, 4)).toEqual({ url: GOOGLE });
    expect(await withLink.svc.googleReviewOffer(ORG, 3)).toBeNull();
    expect(await withLink.svc.googleReviewOffer(ORG, 1)).toBeNull();
    expect(await withLink.svc.googleReviewOffer(ORG, null)).toBeNull();
    const noLink = makeReviewsSvc({ googleUrl: null });
    expect(await noLink.svc.googleReviewOffer(ORG, 5)).toBeNull();
    expect(await noLink.svc.googleReviewOffer(ORG, 4)).toBeNull();
    // org isolation: org-2 has no link even for a 5-star rating
    expect(await withLink.svc.googleReviewOffer(ORG2, 5)).toBeNull();
  });

  it("publicReview carries the offer only on the qualifying review; nothing redirect-shaped exists in the payload", async () => {
    const { svc, reviews } = makeReviewsSvc({ googleUrl: GOOGLE });
    const done: any = await svc.publicReview("tok-done"); // rating 5, link set
    expect(done.googleReviewOffer).toEqual({ url: GOOGLE });
    const open: any = await svc.publicReview("tok-open"); // no rating yet
    expect(open.googleReviewOffer).toBeNull();
    expect(open.mediaCount).toBe(0);
    reviews[1].rating = 3; // a happy link must never appear for <4
    const low: any = await svc.publicReview("tok-done");
    expect(low.googleReviewOffer).toBeNull();
    expect(JSON.stringify(done)).not.toContain("redirect");
  });

  it("normalizeGoogleReviewUrl: http(s) only, empty clears, garbage 400s", () => {
    expect(normalizeGoogleReviewUrl(GOOGLE)).toBe(GOOGLE);
    expect(normalizeGoogleReviewUrl("  https://maps.google.com/x  ")).toBe("https://maps.google.com/x");
    expect(normalizeGoogleReviewUrl("")).toBeNull();
    expect(normalizeGoogleReviewUrl(null)).toBeNull();
    expect(() => normalizeGoogleReviewUrl("not a url")).toThrow(ApiException);
    expect(() => normalizeGoogleReviewUrl("javascript:alert(1)")).toThrow(ApiException);
    expect(() => normalizeGoogleReviewUrl("ftp://example.com")).toThrow(ApiException);
  });
});

// ---------------- ProductReviewsService (visibility + social draft) ----------------

const MEDIA_IMG = { key: `${ORG}/review/img-1.png`, kind: "image", contentType: "image/png", sizeBytes: 100 };
const MEDIA_VID = { key: `${ORG}/review/vid-1.mp4`, kind: "video", contentType: "video/mp4", sizeBytes: 200 };
const MEDIA_HIDDEN = { key: `${ORG}/review/hidden-1.png`, kind: "image", contentType: "image/png", sizeBytes: 100 };
const MEDIA_PENDING = { key: `${ORG}/review/pending-1.png`, kind: "image", contentType: "image/png", sizeBytes: 100 };

function makeProductReviewsSvc(opts: { accounts?: any[] } = {}) {
  const reviews: any[] = [
    { id: "rev-vis", organizationId: ORG, orderId: "ord-1", customerId: "cus-1", rating: 5, comment: "দারুণ পণ্য, আবার কিনব", source: "link", status: "received", deliveredAt: new Date("2026-10-01"), receivedAt: new Date("2026-10-10"), isVisible: true, replyText: null, repliedAt: null, media: [MEDIA_IMG, MEDIA_VID], socialDraftPostId: null },
    { id: "rev-hidden", organizationId: ORG, orderId: "ord-1", customerId: "cus-1", rating: 4, comment: "লুকানো রিভিউ", source: "link", status: "received", deliveredAt: new Date("2026-10-01"), receivedAt: new Date("2026-10-11"), isVisible: false, replyText: null, repliedAt: null, media: [MEDIA_HIDDEN], socialDraftPostId: null },
    { id: "rev-pending", organizationId: ORG, orderId: "ord-1", customerId: "cus-1", rating: null, comment: null, source: null, status: "requested", deliveredAt: new Date("2026-10-02"), receivedAt: null, isVisible: true, replyText: null, repliedAt: null, media: [MEDIA_PENDING], socialDraftPostId: null },
    { id: "rev-foreign", organizationId: ORG2, orderId: "ord-9", customerId: "cus-9", rating: 5, comment: "অন্য দোকান", source: "link", status: "received", deliveredAt: new Date("2026-10-01"), receivedAt: new Date("2026-10-09"), isVisible: true, replyText: null, repliedAt: null, media: null, socialDraftPostId: null },
  ];
  const posts: any[] = [];
  const accounts = opts.accounts ?? [{ id: "acc-1", organizationId: ORG, platform: "meta_page", status: "connected", createdAt: new Date("2026-01-01") }];
  const prisma = {
    organization: table([{ id: ORG, slug: "meghna", name: "Meghna" }, { id: ORG2, slug: "other", name: "Other" }]),
    product: table([
      { id: "prod-1", organizationId: ORG, slug: "cotton-shirt", name: "Cotton Shirt", status: "ACTIVE" },
      { id: "prod-2", organizationId: ORG, slug: null, name: "Slugless", status: "ACTIVE" },
    ]),
    store: table([]),
    order: table([{ id: "ord-1", organizationId: ORG, customerId: "cus-1", status: "completed" }]),
    orderItem: table([{ id: "oi-1", orderId: "ord-1", productId: "prod-1" }]),
    customer: table([{ id: "cus-1", organizationId: ORG, firstName: "Rahim", lastName: "Uddin" }]),
    orderReview: table(reviews),
    externalReview: table([]),
    socialPost: table(posts),
    socialAccount: table(accounts),
  };
  const signedFor: string[] = [];
  const storage: any = {
    mode: "s3",
    signedGetUrl: (_v: string, key: string) => { signedFor.push(key); return `https://signed.example/${key}`; },
  };
  const createPostCalls: any[] = [];
  const social: any = {
    createPost: async (orgId: string, actorId: string, dto: any) => {
      createPostCalls.push({ orgId, actorId, dto });
      const post = { id: `post-${posts.length + 1}`, organizationId: orgId, status: "draft", ...dto };
      posts.push(post);
      return { id: post.id, status: "draft", caption: dto.caption, linkUrl: dto.linkUrl ?? null };
    },
  };
  const audits: any[] = [];
  const svc = new ProductReviewsService(prisma as any, { log: async (i: any) => { audits.push(i); } } as any, social, storage);
  return { svc, reviews, posts, createPostCalls, signedFor, audits };
}

describe("NF8 (b) media visibility follows EC15 exactly", () => {
  it("public: the visible received review's media IS public (signed URLs); hidden + pending reviews and their media never appear, and no signed URL is minted for them", async () => {
    const { svc, signedFor } = makeProductReviewsSvc();
    const out = await svc.getPublicProductReviews(ORG, "prod-1");
    expect(out.items).toHaveLength(1);
    const item = out.items[0];
    expect(item.id).toBe("rev-vis");
    expect(item.imageUrls).toEqual([`https://signed.example/${MEDIA_IMG.key}`]);
    expect(item.media).toHaveLength(2);
    expect(item.media[1]).toMatchObject({ kind: "video", url: `https://signed.example/${MEDIA_VID.key}` });
    const json = JSON.stringify(out);
    expect(json).not.toContain(MEDIA_HIDDEN.key);
    expect(json).not.toContain(MEDIA_PENDING.key);
    expect(json).not.toContain("লুকানো রিভিউ");
    expect(signedFor).not.toContain(MEDIA_HIDDEN.key);
    expect(signedFor).not.toContain(MEDIA_PENDING.key);
    expect(out.summary.count).toBe(1);
  });

  it("staff list: hidden review's media IS visible to staff (moderation surface), pending rows stay excluded as before", async () => {
    const { svc } = makeProductReviewsSvc();
    const all = await svc.listStaffReviews(ORG);
    const hidden = all.find((i: any) => i.id === "rev-hidden");
    expect(hidden).toBeDefined();
    expect(hidden.media).toHaveLength(1);
    expect(hidden.media[0].url).toBe(`https://signed.example/${MEDIA_HIDDEN.key}`);
    expect(all.find((i: any) => i.id === "rev-pending")).toBeUndefined();
  });
});

describe("NF8 (d)+(e) social proof draft — exactly once, draft only, org-isolated", () => {
  it("creates ONE draft via SocialService.createPost with the review text + product link; a repeat reuses it", async () => {
    const { svc, reviews, createPostCalls } = makeProductReviewsSvc();
    const first: any = await svc.createSocialDraft(ORG, "rev-vis", "user-1");
    expect(first).toEqual({ created: true, reused: false, postId: "post-1", status: "draft" });
    expect(createPostCalls).toHaveLength(1);
    const dto = createPostCalls[0].dto;
    expect(dto.socialAccountId).toBe("acc-1");
    expect(dto.caption).toContain("★★★★★");
    expect(dto.caption).toContain("দারুণ পণ্য, আবার কিনব");
    expect(dto.caption).toContain("Cotton Shirt");
    expect(dto.linkUrl).toMatch(/\/checkout\/cotton-shirt$/);
    expect(reviews[0].socialDraftPostId).toBe("post-1");
    const second: any = await svc.createSocialDraft(ORG, "rev-vis", "user-1");
    expect(second).toEqual({ created: false, reused: true, postId: "post-1", status: "draft" });
    expect(createPostCalls).toHaveLength(1); // the engine was NOT called again
  });

  it("hidden and unreceived reviews are refused; a foreign-org review 404s", async () => {
    const { svc, createPostCalls } = makeProductReviewsSvc();
    await expect(svc.createSocialDraft(ORG, "rev-hidden", "user-1")).rejects.toBeInstanceOf(ApiException);
    await expect(svc.createSocialDraft(ORG, "rev-pending", "user-1")).rejects.toBeInstanceOf(ApiException);
    await expect(svc.createSocialDraft(ORG, "rev-foreign", "user-1")).rejects.toBeInstanceOf(ApiException);
    await expect(svc.createSocialDraft(ORG2, "rev-vis", "user-1")).rejects.toBeInstanceOf(ApiException);
    expect(createPostCalls).toHaveLength(0);
  });

  it("no connected account -> honest refusal, nothing created, no claim written", async () => {
    const { svc, reviews, createPostCalls } = makeProductReviewsSvc({ accounts: [] });
    await expect(svc.createSocialDraft(ORG, "rev-vis", "user-1")).rejects.toBeInstanceOf(ApiException);
    expect(createPostCalls).toHaveLength(0);
    expect(reviews[0].socialDraftPostId).toBeNull();
  });

  it("an explicit foreign/disconnected account id is refused", async () => {
    const { svc } = makeProductReviewsSvc({ accounts: [{ id: "acc-x", organizationId: ORG2, platform: "meta_page", status: "connected", createdAt: new Date() }] });
    await expect(svc.createSocialDraft(ORG, "rev-vis", "user-1", { socialAccountId: "acc-x" })).rejects.toBeInstanceOf(ApiException);
  });
});
