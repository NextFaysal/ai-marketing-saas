import sharp from "sharp";
import { SocialService } from "./social.service";
import { SocialPublishService } from "./social-publish.service";
import { SocialRasterService } from "./social-raster.service";
import { MetaSocialPublisher } from "./meta-publisher";
import { composePosterSvg } from "./social-image.service";
import { encryptJson } from "../integrations/crypto";

/**
 * PP1 — SVG → PNG rasterizer (sharp), proven with:
 * - the REAL sharp conversion of a poster-like SVG (the actual
 *   SP4 composePosterSvg output, Bengali headline included):
 *   PNG magic bytes, 1080×1080 metadata, and the headline band
 *   actually contains rendered (bright) text pixels — not blank;
 * - the derived-asset cache: a counting fake converter proves
 *   the second ensurePngAsset call does NOT re-convert, and a
 *   PNG derived under ANOTHER org is never reused (tenant
 *   isolation on the (organizationId, derivedFromId) cache key);
 * - publish integration (the SP6 harness: fake Prisma + a stub
 *   fetch behind MetaSocialPublisher): a post whose only asset
 *   is an SVG publishes with the PNG asset (contentType
 *   image/png, the derived row's public URL), and the derived
 *   row is created pointing at the SVG via derivedFromId;
 * - conversion failure: post failed permanently, the error
 *   carries the converter's verbatim message, attempts stay 0,
 *   and the platform fetch is NEVER called.
 *
 * Evidence ceiling: no real Meta publish and no Postgres in this
 * sandbox — the migration is unapplied locally; sharp itself is
 * the real library, loaded and exercised for real.
 */
const ORG = "org-1";
const ORG2 = "org-2";
const ACTOR = "owner-1";
const PAGE_TOKEN = "PAGE-TOKEN-1";
type Row = Record<string, any>;

const SAVED_API_PUBLIC_URL = process.env.API_PUBLIC_URL;
beforeAll(() => { delete process.env.API_PUBLIC_URL; });
afterAll(() => {
  if (SAVED_API_PUBLIC_URL === undefined) delete process.env.API_PUBLIC_URL;
  else process.env.API_PUBLIC_URL = SAVED_API_PUBLIC_URL;
});

// A poster-like fixture: the REAL SP4 composer output (photo as a
// 1×1 data-URI PNG, Bengali headline in the bottom band).
const PHOTO_1PX =
  "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8DwHwAFAAH/q842iQAAAABJRU5ErkJggg==";
const FIXTURE_SVG = composePosterSvg({
  photoDataUri: PHOTO_1PX,
  headline: "ঈদ অফার",
  subtext: "সব পণ্যে ছাড়",
  brandName: "Shop One",
  primaryColor: "#111827",
});
const FIXTURE_SVG_BYTES = Buffer.from(FIXTURE_SVG, "utf8");

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

const mkAudit = (db: any) => ({
  log: jest.fn(async (input: any) => { db.auditRows.push({ id: `audit-${db.auditRows.length + 1}`, createdAt: new Date(), ...input }); }),
});

/** A raster service whose byte seams serve the fixture SVG in memory. */
function fixtureRaster(db: any, audit: any) {
  const raster = new SocialRasterService(db as any, audit as any);
  raster.readBytes = async () => FIXTURE_SVG_BYTES;
  raster.writeBytes = async () => undefined;
  return raster;
}

function seedPublishWorld(db: any) {
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
    id: "sacc-1", organizationId: ORG, platform: "meta_page",
    externalId: "page-1", name: "Shop One", username: null, pictureUrl: null,
    status: "connected", lastError: null, integrationId: "int-1", createdById: ACTOR,
    createdAt: new Date(), updatedAt: new Date(),
  });
  const asset = {
    id: "asset-svg-1", organizationId: ORG, kind: "image",
    name: "Template Poster — ঈদ অফার", contentType: "image/svg+xml", sizeBytes: FIXTURE_SVG_BYTES.length,
    storageKey: `${ORG}/social/asset-svg-1.svg`, publicToken: null, origin: "template",
    createdById: ACTOR, createdAt: new Date(), updatedAt: new Date(),
  };
  db.mediaAssets.push(asset);
  const post = {
    id: "post-svg-1", organizationId: ORG, socialAccountId: "sacc-1",
    caption: "ঈদ অফার — নতুন কালেকশন", linkUrl: null,
    mediaRefs: [{ assetId: asset.id, kind: "image" }], status: "draft",
    scheduledAt: null, publishedAt: null, platformPostId: null, platformUrl: null,
    error: null, attempts: 0, createdById: ACTOR,
    createdAt: new Date(), updatedAt: new Date(),
  };
  db.socialPosts.push(post);
  return { asset, post };
}

afterEach(() => jest.restoreAllMocks());

describe("PP1 real sharp conversion", () => {
  it("converts the poster fixture SVG → real PNG: magic bytes, 1080×1080, Bengali headline band is rendered (non-blank)", async () => {
    const db = fakeDb();
    const raster = new SocialRasterService(db as any, mkAudit(db) as any);
    const png = await raster.convertSvgToPng(FIXTURE_SVG_BYTES);

    // Real PNG magic (89 50 4E 47 0D 0A 1A 0A).
    expect(png.subarray(0, 8).toString("hex")).toBe("89504e470d0a1a0a");
    const meta = await sharp(png).metadata();
    expect(meta.format).toBe("png");
    expect(meta.width).toBe(1080);
    expect(meta.height).toBe(1080);

    // The headline band (bottom band starts at y=820; headline
    // text sits ~y 860–930 in the dark #111827 band) must contain
    // rendered bright text pixels — a blank/failed text render
    // would leave the band uniformly dark.
    const { data, info } = await sharp(png).raw().toBuffer({ resolveWithObject: true });
    let bright = 0;
    for (let y = 850; y < 960; y++) {
      for (let x = 40; x < 700; x++) {
        const i = (y * info.width + x) * info.channels;
        const lum = (data[i] + data[i + 1] + data[i + 2]) / 3;
        if (lum > 180) bright++;
      }
    }
    expect(bright).toBeGreaterThan(500);
  });
});

describe("PP1 derived-asset cache", () => {
  function countingRaster(db: any) {
    const raster = new SocialRasterService(db as any, mkAudit(db) as any);
    const converter = jest.fn(async (_svg: Buffer) => Buffer.from("fake-png-bytes"));
    raster.converter = converter;
    raster.readBytes = async () => FIXTURE_SVG_BYTES;
    raster.writeBytes = async () => undefined;
    return { raster, converter };
  }

  const sourceAsset = {
    id: "asset-svg-1", organizationId: ORG, kind: "image", name: "Poster",
    contentType: "image/svg+xml", sizeBytes: 10, storageKey: `${ORG}/social/asset-svg-1.svg`,
    publicToken: null, origin: "template", createdById: ACTOR,
  };

  it("two ensurePngAsset calls → converter invoked ONCE, same asset id returned, origin preserved + derivedFromId set", async () => {
    const db = fakeDb();
    const { raster, converter } = countingRaster(db);
    const first = await raster.ensurePngAsset(ORG, ACTOR, sourceAsset);
    const second = await raster.ensurePngAsset(ORG, ACTOR, sourceAsset);
    expect(converter).toHaveBeenCalledTimes(1);
    expect(second.id).toBe(first.id);
    expect(first.contentType).toBe("image/png");
    expect(first.derivedFromId).toBe("asset-svg-1");
    expect(first.origin).toBe("template"); // provenance preserved
    expect(first.name).toBe("Poster (PNG)");
    expect(first.storageKey).toBe(`${ORG}/social/${first.id}.png`);
    expect(db.mediaAssets).toHaveLength(1);
  });

  it("tenant isolation: a derived PNG seeded under org-2 with the same derivedFromId is NOT reused for org-1", async () => {
    const db = fakeDb();
    db.mediaAssets.push({
      id: "foreign-png", organizationId: ORG2, kind: "image", name: "Poster (PNG)",
      contentType: "image/png", sizeBytes: 5, storageKey: `${ORG2}/social/foreign.png`,
      publicToken: null, origin: "template", derivedFromId: "asset-svg-1",
      createdById: ACTOR, createdAt: new Date(), updatedAt: new Date(),
    });
    const { raster, converter } = countingRaster(db);
    const mine = await raster.ensurePngAsset(ORG, ACTOR, sourceAsset);
    expect(converter).toHaveBeenCalledTimes(1); // converted fresh — no cross-org reuse
    expect(mine.id).not.toBe("foreign-png");
    expect(mine.organizationId).toBe(ORG);
  });
});

describe("PP1 publish integration", () => {
  it("a post whose only asset is an SVG publishes via the derived PNG (public URL + image/png), derived row created", async () => {
    const db = fakeDb();
    const { post } = seedPublishWorld(db);
    const audit = mkAudit(db);
    const social = new SocialService(db as any, audit as any);
    const { fetchFn, calls } = stubFetch((url) => {
      if (url.endsWith("/page-1/photos")) return { body: { id: "photo-1", post_id: "page-1_999" } };
      return { body: {} };
    });
    const publisher = new MetaSocialPublisher(fetchFn, { pollIntervalMs: 0, maxPolls: 5, sleep: async () => {} });
    const publishToPageSpy = jest.spyOn(publisher, "publishToPage");
    const publish = new SocialPublishService(
      db as any, audit as any, social, publisher, undefined, undefined, undefined,
      fixtureRaster(db, audit),
    );
    const res = await publish.publishNow(ORG, ACTOR, post.id);
    expect(res.status).toBe("published");
    expect(res.platformPostId).toBe("page-1_999");

    // The derived PNG row exists, pointing at the SVG.
    const derived = db.mediaAssets.find((a: Row) => a.derivedFromId === "asset-svg-1");
    expect(derived).toBeTruthy();
    expect(derived.contentType).toBe("image/png");
    expect(derived.organizationId).toBe(ORG);
    expect(derived.origin).toBe("template");

    // The publisher received the PNG asset (not the SVG), via the
    // derived row's own public URL.
    expect(publishToPageSpy).toHaveBeenCalledTimes(1);
    const passedAssets = (publishToPageSpy.mock.calls[0][2] as any).assets;
    expect(passedAssets).toHaveLength(1);
    expect(passedAssets[0].contentType).toBe("image/png");
    expect(derived.publicToken).toBeTruthy();
    expect(passedAssets[0].publicUrl).toBe(`http://localhost:4000/public/media/${derived.publicToken}`);
    const photoCall = calls.find((c) => c.url.endsWith("/page-1/photos"));
    expect(photoCall?.params.get("url")).toBe(passedAssets[0].publicUrl);
    // The source SVG row itself never got a public token.
    const svgRow = db.mediaAssets.find((a: Row) => a.id === "asset-svg-1");
    expect(svgRow.publicToken).toBeNull();
  });

  it("conversion failure → post failed, error carries the verbatim converter message, attempts stay 0, platform fetch NEVER called", async () => {
    const db = fakeDb();
    const { post } = seedPublishWorld(db);
    const audit = mkAudit(db);
    const social = new SocialService(db as any, audit as any);
    const { fetchFn, fetchMock } = stubFetch(() => ({ body: { id: "should-not-happen" } }));
    const publisher = new MetaSocialPublisher(fetchFn, { pollIntervalMs: 0, maxPolls: 5, sleep: async () => {} });
    const raster = fixtureRaster(db, audit);
    raster.converter = async () => { throw new Error("boom-fixture"); };
    const publish = new SocialPublishService(
      db as any, audit as any, social, publisher, undefined, undefined, undefined, raster,
    );
    const res = await publish.publishNow(ORG, ACTOR, post.id);
    expect(res.status).toBe("failed");
    expect(res.attempts).toBe(0);
    expect(res.error).toBe("SVG থেকে PNG তৈরি করা যায়নি: boom-fixture");
    expect(fetchMock).not.toHaveBeenCalled();
    expect(db.mediaAssets.filter((a: Row) => a.derivedFromId === "asset-svg-1")).toHaveLength(0);
  });
});
