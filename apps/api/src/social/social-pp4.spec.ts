import { SocialService } from "./social.service";
import { SocialPublishService } from "./social-publish.service";
import { MetaSocialPublisher } from "./meta-publisher";
import { encryptJson } from "../integrations/crypto";

/**
 * PP4 — Instagram carousel (2–10 media), proven at the client
 * boundary (stub fetch into MetaSocialPublisher, the SP6-spec
 * pattern):
 * - per-item containers (is_carousel_item=true; images image_url,
 *   videos video_url + media_type REELS; NO caption on items),
 *   each polled to FINISHED with the same bounded discipline as
 *   singles, then the CAROUSEL container (media_type=CAROUSEL,
 *   children=<ids>, caption), polled, media_publish, permalink.
 * - mixed image+video carousels follow the same per-item rules.
 * - >10 items: PermanentPublishError decided pre-flight — the
 *   post fails with attempts untouched and ZERO platform calls.
 * - a child container's processing ERROR surfaces Meta's
 *   verbatim text through the NORMAL SP5 retry path (attempts
 *   burn — it is NOT permanent, mirroring SP6's classification
 *   for single containers), and media_publish is never reached,
 *   so nothing is ever partially published.
 * - SVG items take PP1's conversion in the publish service
 *   before the publisher (same as singles) — the items reaching
 *   the publisher here are already raster.
 *
 * Single-item posts keep the exact SP6 path — regression covered
 * by social-sp6.spec.ts (untouched except its superseded
 * two-media refusal case).
 *
 * Evidence ceiling: no real Meta app/IG account exists in this
 * sandbox — these specs prove request shapes and state handling,
 * never a real publish.
 */
const ORG = "org-1";
const ACTOR = "owner-1";
const PAGE_TOKEN = "page-token-pp4";
type Row = Record<string, any>;

const SAVED_API_PUBLIC_URL = process.env.API_PUBLIC_URL;
beforeAll(() => { delete process.env.API_PUBLIC_URL; });
afterAll(() => {
  if (SAVED_API_PUBLIC_URL === undefined) delete process.env.API_PUBLIC_URL;
  else process.env.API_PUBLIC_URL = SAVED_API_PUBLIC_URL;
});

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
    integrations: [] as Row[], credentials: [] as Row[],
    memberships: [] as Row[], notifications: [] as Row[], auditRows: [] as Row[],
  };
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
        platformUrl: null, error: null, attempts: 0, mediaRefs: [], ...data,
      };
      db.socialPosts.push(row);
      return { ...row };
    }),
  };
  return db;
}

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
  return { fetchFn: fetchFn as unknown as typeof fetch, calls, fetchMock: fetchFn };
}

function services(db: any, fetchFn: typeof fetch) {
  const audit = { log: jest.fn(async (input: any) => { db.auditRows.push({ id: `audit-${db.auditRows.length + 1}`, createdAt: new Date(), ...input }); }) };
  const social = new SocialService(db as any, audit as any);
  const publisher = new MetaSocialPublisher(fetchFn, { pollIntervalMs: 0, maxPolls: 5, sleep: async () => {} });
  const publish = new SocialPublishService(db as any, audit as any, social, publisher);
  return { social, publish, publisher, audit };
}

function seedIg(db: any) {
  db.integrations.push({
    id: "int-1", organizationId: ORG, provider: "meta_social", status: "CONNECTED",
    externalAccountId: "page-1", createdAt: new Date(), updatedAt: new Date(),
  });
  db.credentials.push({
    id: "cred-int-1", integrationId: "int-1",
    encryptedData: encryptJson({ accessToken: PAGE_TOKEN, pageId: "page-1" }),
    createdAt: new Date(),
  });
  db.socialAccounts.push({
    id: "sacc-ig", organizationId: ORG, platform: "instagram",
    externalId: "ig-1", name: "Shop One", username: "shopone", pictureUrl: null,
    status: "connected", lastError: null, integrationId: "int-1", createdById: ACTOR,
    createdAt: new Date(), updatedAt: new Date(),
  });
}

function seedAsset(db: any, over: Row = {}) {
  const row = {
    id: `asset-${db.mediaAssets.length + 1}`, organizationId: ORG, kind: "image",
    name: "photo.png", contentType: "image/png", sizeBytes: 100,
    storageKey: `${ORG}/social/seed.png`, publicToken: null, createdById: ACTOR,
    createdAt: new Date(), updatedAt: new Date(), ...over,
  };
  db.mediaAssets.push(row);
  return row;
}

function seedPost(db: any, over: Row = {}) {
  const row = {
    id: `post-seed-${db.socialPosts.length + 1}`, organizationId: ORG, socialAccountId: "sacc-ig",
    caption: "নতুন কালেকশন — সবগুলো দেখুন", linkUrl: null, mediaRefs: [], status: "draft",
    scheduledAt: null, publishedAt: null, platformPostId: null, platformUrl: null,
    error: null, attempts: 0, createdById: ACTOR,
    createdAt: new Date(), updatedAt: new Date(), ...over,
  };
  db.socialPosts.push(row);
  return row;
}

afterEach(() => jest.restoreAllMocks());

/** A happy-path Graph for a carousel: item creates hand out
 * item-1..item-N in order, every poll says FINISHED, the
 * CAROUSEL create returns car-1, publish returns media-99. */
function happyCarouselFetch(overrides?: (url: string, params: URLSearchParams) => { status?: number; body: any } | null) {
  let items = 0;
  return stubFetch((url, params) => {
    const over = overrides?.(url, params);
    if (over) return over;
    if (url.endsWith("/ig-1/media") && params.get("media_type") === "CAROUSEL") return { body: { id: "car-1" } };
    if (url.endsWith("/ig-1/media")) { items += 1; return { body: { id: `item-${items}` } }; }
    if (url.includes("/item-") || url.includes("/car-1")) return { body: { status_code: "FINISHED" } };
    if (url.includes("/ig-1/media_publish")) return { body: { id: "media-99" } };
    if (url.includes("/media-99")) return { body: { permalink: "https://www.instagram.com/p/CAR99/" } };
    return { body: {} };
  });
}

describe("PP4 Instagram carousel", () => {
  it("two images: items (no caption) → polls → CAROUSEL(children, caption) → publish → permalink", async () => {
    const db = fakeDb(); seedIg(db);
    const a1 = seedAsset(db, { publicToken: "tok-a" });
    const a2 = seedAsset(db, { publicToken: "tok-b" });
    const post = seedPost(db, { mediaRefs: [{ assetId: a1.id, kind: "image" }, { assetId: a2.id, kind: "image" }] });
    const { fetchFn, calls } = happyCarouselFetch();
    const { publish } = services(db, fetchFn);
    const res = await publish.publishNow(ORG, ACTOR, post.id);
    expect(res.status).toBe("published");
    expect(res.platformPostId).toBe("media-99");
    expect(res.platformUrl).toBe("https://www.instagram.com/p/CAR99/");

    const itemCreates = calls.filter((c) => c.url.endsWith("/ig-1/media") && c.params.get("is_carousel_item") === "true");
    expect(itemCreates).toHaveLength(2);
    expect(itemCreates[0].params.get("image_url")).toBe("http://localhost:4000/public/media/tok-a");
    expect(itemCreates[1].params.get("image_url")).toBe("http://localhost:4000/public/media/tok-b");
    // Items carry no caption and no media_type (images).
    expect(itemCreates[0].params.get("caption")).toBeNull();
    expect(itemCreates[0].params.get("media_type")).toBeNull();

    const carousel = calls.find((c) => c.params.get("media_type") === "CAROUSEL");
    expect(carousel?.params.get("children")).toBe("item-1,item-2");
    expect(carousel?.params.get("caption")).toBe("নতুন কালেকশন — সবগুলো দেখুন");

    const publishCall = calls.find((c) => c.url.includes("/ig-1/media_publish"));
    expect(publishCall?.params.get("creation_id")).toBe("car-1");

    // Order: both item creates AND the carousel create precede
    // media_publish; the carousel create comes after item polls.
    const idx = (pred: (c: (typeof calls)[number]) => boolean) => calls.findIndex(pred);
    const carouselIdx = idx((c) => c.params.get("media_type") === "CAROUSEL");
    const publishIdx = idx((c) => c.url.includes("/ig-1/media_publish"));
    expect(carouselIdx).toBeGreaterThan(-1);
    expect(publishIdx).toBeGreaterThan(carouselIdx);
    expect(idx((c) => c.params.get("is_carousel_item") === "true")).toBeLessThan(carouselIdx);
  });

  it("mixed image + video: the video item is a REELS carousel item", async () => {
    const db = fakeDb(); seedIg(db);
    const img = seedAsset(db, { publicToken: "tok-img" });
    const vid = seedAsset(db, { kind: "video", contentType: "video/mp4", publicToken: "tok-vid" });
    const post = seedPost(db, { mediaRefs: [{ assetId: img.id, kind: "image" }, { assetId: vid.id, kind: "video" }] });
    const { fetchFn, calls } = happyCarouselFetch();
    const { publish } = services(db, fetchFn);
    const res = await publish.publishNow(ORG, ACTOR, post.id);
    expect(res.status).toBe("published");
    const itemCreates = calls.filter((c) => c.params.get("is_carousel_item") === "true");
    expect(itemCreates[0].params.get("image_url")).toBe("http://localhost:4000/public/media/tok-img");
    expect(itemCreates[1].params.get("video_url")).toBe("http://localhost:4000/public/media/tok-vid");
    expect(itemCreates[1].params.get("media_type")).toBe("REELS");
    expect(itemCreates[1].params.get("image_url")).toBeNull();
  });

  it("an item still IN_PROGRESS is polled again until FINISHED (same bounded discipline)", async () => {
    const db = fakeDb(); seedIg(db);
    const a1 = seedAsset(db, { publicToken: "tok-a" });
    const a2 = seedAsset(db, { publicToken: "tok-b" });
    const post = seedPost(db, { mediaRefs: [{ assetId: a1.id, kind: "image" }, { assetId: a2.id, kind: "image" }] });
    let item1Polls = 0;
    const { fetchFn } = happyCarouselFetch((url) => {
      if (url.includes("/item-1") && url.includes("fields=status_code")) {
        item1Polls += 1;
        return { body: { status_code: item1Polls < 2 ? "IN_PROGRESS" : "FINISHED" } };
      }
      return null;
    });
    const { publish } = services(db, fetchFn);
    const res = await publish.publishNow(ORG, ACTOR, post.id);
    expect(res.status).toBe("published");
    expect(item1Polls).toBe(2);
  });

  it("a child container ERROR → verbatim failure through the RETRY path (attempts burn), media_publish never called", async () => {
    const db = fakeDb(); seedIg(db);
    const a1 = seedAsset(db, { publicToken: "tok-a" });
    const a2 = seedAsset(db, { publicToken: "tok-b" });
    // attempts=2: one more ORDINARY failure is terminal under
    // SP5's cap — a permanent error would keep attempts at 2.
    const post = seedPost(db, { attempts: 2, mediaRefs: [{ assetId: a1.id, kind: "image" }, { assetId: a2.id, kind: "image" }] });
    const { fetchFn, calls } = happyCarouselFetch((url) => {
      if (url.includes("/item-2") && url.includes("fields=status_code")) {
        return { body: { status_code: "ERROR", status: "Media processing failed: unsupported aspect ratio" } };
      }
      return null;
    });
    const { publish } = services(db, fetchFn);
    const res = await publish.publishNow(ORG, ACTOR, post.id);
    expect(res.status).toBe("failed");
    expect(res.attempts).toBe(3);
    expect(res.error).toContain("Media processing failed: unsupported aspect ratio");
    // Nothing partially published: the carousel container and
    // media_publish were never reached.
    expect(calls.some((c) => c.params.get("media_type") === "CAROUSEL")).toBe(false);
    expect(calls.some((c) => c.url.includes("/media_publish"))).toBe(false);
  });

  it("a container-CREATION refusal from Graph propagates verbatim (not permanent, not swallowed)", async () => {
    const db = fakeDb(); seedIg(db);
    const a1 = seedAsset(db, { publicToken: "tok-a" });
    const a2 = seedAsset(db, { publicToken: "tok-b" });
    const post = seedPost(db, { attempts: 2, mediaRefs: [{ assetId: a1.id, kind: "image" }, { assetId: a2.id, kind: "image" }] });
    const { fetchFn } = stubFetch((url, params) => {
      if (url.endsWith("/ig-1/media") && params.get("is_carousel_item") === "true") {
        return { status: 400, body: { error: { message: "Invalid parameter: media url is not accessible" } } };
      }
      return { body: {} };
    });
    const { publish } = services(db, fetchFn);
    const res = await publish.publishNow(ORG, ACTOR, post.id);
    expect(res.status).toBe("failed");
    expect(res.attempts).toBe(3); // retry-path classification
    expect(res.error).toContain("media url is not accessible");
  });

  it("11 items → permanent refusal BEFORE any platform call (attempts untouched, fetch never called)", async () => {
    const db = fakeDb(); seedIg(db);
    const refs = [];
    for (let i = 0; i < 11; i++) {
      const a = seedAsset(db, { publicToken: `tok-${i}` });
      refs.push({ assetId: a.id, kind: "image" });
    }
    const post = seedPost(db, { mediaRefs: refs });
    const { fetchFn, fetchMock } = stubFetch(() => ({ body: { id: "x" } }));
    const { publish } = services(db, fetchFn);
    const res = await publish.publishNow(ORG, ACTOR, post.id);
    expect(res.status).toBe("failed");
    expect(res.attempts).toBe(0);
    expect(res.error).toContain("সর্বোচ্চ ১০টি মিডিয়া");
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("exactly 10 items publish (the documented upper bound is inclusive)", async () => {
    const db = fakeDb(); seedIg(db);
    const refs = [];
    for (let i = 0; i < 10; i++) {
      const a = seedAsset(db, { publicToken: `tok-${i}` });
      refs.push({ assetId: a.id, kind: "image" });
    }
    const post = seedPost(db, { mediaRefs: refs });
    const { fetchFn, calls } = happyCarouselFetch();
    const { publish } = services(db, fetchFn);
    const res = await publish.publishNow(ORG, ACTOR, post.id);
    expect(res.status).toBe("published");
    const carousel = calls.find((c) => c.params.get("media_type") === "CAROUSEL");
    expect(carousel?.params.get("children")?.split(",")).toHaveLength(10);
  });
});
