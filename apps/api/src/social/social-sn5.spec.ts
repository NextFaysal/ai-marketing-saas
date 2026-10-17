process.env.ENCRYPTION_KEY = Buffer.alloc(32, 9).toString("base64");

import sharp from "sharp";
import { SocialStockService } from "./social-stock.service";
import { SocialImportService } from "./social-import.service";
import { SocialMediaLibraryService } from "./social-media-library.service";
import { decryptJson } from "../integrations/crypto";
import { MediaStore } from "../inbox/media-store";

/**
 * SN5 — stock media + brand overlay (Batch N3). Proven with:
 *   - verify-before-save: a stubbed Pexels probe decides whether
 *     the sealed row is written — success saves (decryptable,
 *     never plaintext), failure throws Pexels' verbatim error
 *     and saves NOTHING; the key never appears in any returned
 *     shape (status exposes last-4 only).
 *   - search mapping for photos AND videos, and the honest 400
 *     when no key is configured.
 *   - import: the service re-reads the item from Pexels and the
 *     file goes through the REAL SocialImportService (SSRF
 *     seams stubbed) — attribution + page URL land on the
 *     asset and a second import dedupes to the same asset.
 *   - brand overlay: a real small PNG in, derived asset out —
 *     source row/bytes untouched; corner without a logo and
 *     video assets refuse honestly.
 */

const ORG = "org-1";
const USER = "user-1";
const KEY = "pexels-secret-key-ABCD";

function matches(row: any, where: any): boolean {
  return Object.entries(where ?? {}).every(([k, v]) => {
    if (v && typeof v === "object") {
      if (Array.isArray((v as any).in)) return (v as any).in.includes(row[k]);
      return true;
    }
    return row[k] === v;
  });
}

function makeTable(idPrefix: string) {
  const rows: any[] = [];
  let seq = 0;
  return {
    rows,
    async create({ data }: any) {
      const row = { id: data.id ?? `${idPrefix}-${++seq}`, ...data };
      rows.push(row);
      return row;
    },
    async findFirst({ where }: any) { return rows.find((r) => matches(r, where)) ?? null; },
    async findUnique({ where }: any) {
      if (where?.organizationId) return rows.find((r) => r.organizationId === where.organizationId) ?? null;
      return rows.find((r) => r.id === where.id) ?? null;
    },
    async findMany({ where, orderBy, take }: any = {}) {
      let out = rows.filter((r) => matches(r, where ?? {}));
      if (orderBy?.createdAt === "desc") out = [...out].reverse();
      if (take) out = out.slice(0, take);
      return out;
    },
    async update({ where, data }: any) {
      const row = rows.find((r) => r.id === where.id);
      if (row) Object.assign(row, data);
      return row;
    },
    async delete({ where }: any) {
      const i = rows.findIndex((r) => r.id === where.id);
      if (i >= 0) rows.splice(i, 1);
      return null;
    },
    async count({ where }: any = {}) { return rows.filter((r) => matches(r, where ?? {})).length; },
  };
}

function stubResponse(status: number, body: any) {
  return { status, ok: status >= 200 && status < 300, json: async () => body };
}

const PHOTO = {
  id: 2014422,
  width: 5472, height: 3648,
  url: "https://www.pexels.com/photo/2014422/",
  photographer: "Jane Doe", alt: "A red kite over the sea",
  src: {
    original: "https://images.pexels.com/photos/2014422/original.jpg",
    large2x: "https://images.pexels.com/photos/2014422/large2x.jpg",
    large: "https://images.pexels.com/photos/2014422/large.jpg",
    medium: "https://images.pexels.com/photos/2014422/medium.jpg",
    small: "https://images.pexels.com/photos/2014422/small.jpg",
  },
};

const VIDEO = {
  id: 2795750,
  width: 1920, height: 1080, duration: 12,
  url: "https://www.pexels.com/video/2795750/",
  user: { name: "John Roe" },
  image: "https://images.pexels.com/videos/2795750/pictures/preview.jpg",
  video_pictures: [{ picture: "https://images.pexels.com/videos/2795750/pictures/0.jpg" }],
  video_files: [
    { id: 1, quality: "hd", file_type: "video/mp4", width: 640, height: 360, size: 500_000, link: "https://videos.pexels.com/video-files/2795750/small.mp4" },
    { id: 2, quality: "hd", file_type: "video/mp4", width: 1920, height: 1080, size: 9_000_000, link: "https://videos.pexels.com/video-files/2795750/big.mp4" },
  ],
};

function makeStock(opts: { importer?: any } = {}) {
  const db: any = {
    orgStockConfig: makeTable("stockcfg"),
    mediaAsset: makeTable("asset"),
    organization: makeTable("org"),
  };
  const audit: any = { log: async () => undefined, entries: [] as any[] };
  audit.log = async (e: any) => { audit.entries.push(e); };
  const imported: any[] = [];
  const importer = opts.importer ?? {
    importExternalMedia: async (_org: string, _actor: string, input: any) => {
      imported.push(input);
      return {
        id: "asset-imported-1", kind: input.fileUrl.endsWith(".mp4") ? "video" : "image",
        name: input.name, contentType: "image/jpeg", sizeBytes: 123, origin: "pexels",
        prompt: null, sourceUrl: input.sourceUrl, attribution: input.attribution,
        storageAvailable: true, createdAt: new Date(),
      };
    },
  };
  const svc = new SocialStockService(db, audit as any, importer);
  return { db, audit, svc, imported };
}

async function saveKeyOk(svc: SocialStockService) {
  svc.fetchFn = async () => stubResponse(200, { photos: [] });
  return svc.saveStockKey(ORG, USER, { apiKey: KEY });
}

describe("SN5 — Pexels key (verify-before-save, sealed)", () => {
  it("a successful probe saves the key SEALED; status exposes last-4 only", async () => {
    const { db, svc } = makeStock();
    const status = await saveKeyOk(svc);
    expect(status.configured).toBe(true);
    expect(status.status).toBe("verified");
    expect(status.keyLast4).toBe("ABCD");
    const row = db.orgStockConfig.rows[0];
    expect(row).toBeTruthy();
    expect(row.encryptedData).not.toContain(KEY);
    expect(decryptJson(row.encryptedData)).toEqual({ apiKey: KEY });
    // Leak scan: nothing returned carries the key.
    expect(JSON.stringify(status)).not.toContain(KEY);
    expect(JSON.stringify(await svc.getStockStatus(ORG))).not.toContain(KEY);
  });

  it("a failed probe throws Pexels' verbatim error and saves NOTHING", async () => {
    const { db, svc } = makeStock();
    svc.fetchFn = async () => stubResponse(401, { error: "Invalid API key" });
    await expect(svc.saveStockKey(ORG, USER, { apiKey: "bad-key" }))
      .rejects.toThrow(/Invalid API key/);
    expect(db.orgStockConfig.rows).toHaveLength(0);
  });

  it("a failed probe leaves an existing saved key untouched", async () => {
    const { db, svc } = makeStock();
    await saveKeyOk(svc);
    const before = db.orgStockConfig.rows[0].encryptedData;
    svc.fetchFn = async () => stubResponse(403, { error: "Forbidden" });
    await expect(svc.saveStockKey(ORG, USER, { apiKey: "other-key-9999" })).rejects.toThrow(/Forbidden/);
    expect(db.orgStockConfig.rows).toHaveLength(1);
    expect(db.orgStockConfig.rows[0].encryptedData).toBe(before);
  });

  it("delete removes the config and status flips to unconfigured", async () => {
    const { db, svc } = makeStock();
    await saveKeyOk(svc);
    const status = await svc.deleteStockKey(ORG, USER);
    expect(status.configured).toBe(false);
    expect(db.orgStockConfig.rows).toHaveLength(0);
  });
});

describe("SN5 — stock search", () => {
  it("refuses honestly when no key is configured", async () => {
    const { svc } = makeStock();
    await expect(svc.searchStock(ORG, { q: "kite" })).rejects.toThrow(/Pexels API key/);
  });

  it("maps photos with the provider payload shape", async () => {
    const { svc } = makeStock();
    await saveKeyOk(svc);
    let seenAuth = "";
    svc.fetchFn = async (url: string, init: any) => {
      seenAuth = init.headers.Authorization;
      expect(url).toContain("/v1/search?query=kite");
      return stubResponse(200, { photos: [PHOTO], total_results: 42 });
    };
    const out = await svc.searchStock(ORG, { q: "kite", kind: "photo" });
    expect(seenAuth).toBe(KEY);
    expect(out.totalResults).toBe(42);
    expect(out.items[0]).toMatchObject({
      stockId: "2014422", kind: "photo",
      thumbUrl: PHOTO.src.medium, width: 5472, height: 3648,
      photographer: "Jane Doe", pageUrl: PHOTO.url, alt: "A red kite over the sea",
    });
  });

  it("maps videos (duration, poster, creator)", async () => {
    const { svc } = makeStock();
    await saveKeyOk(svc);
    svc.fetchFn = async (url: string) => {
      expect(url).toContain("/videos/search");
      return stubResponse(200, { videos: [VIDEO], total_results: 1 });
    };
    const out = await svc.searchStock(ORG, { q: "sea", kind: "video" });
    expect(out.items[0]).toMatchObject({
      stockId: "2795750", kind: "video", duration: 12,
      thumbUrl: VIDEO.video_pictures[0].picture, photographer: "John Roe",
    });
  });

  it("an empty query browses curated photos / popular videos", async () => {
    const { svc } = makeStock();
    await saveKeyOk(svc);
    const urls: string[] = [];
    svc.fetchFn = async (url: string) => { urls.push(url); return stubResponse(200, { photos: [], videos: [] }); };
    await svc.searchStock(ORG, {});
    await svc.searchStock(ORG, { kind: "video" });
    expect(urls[0]).toContain("/v1/curated");
    expect(urls[1]).toContain("/videos/popular");
  });
});

describe("SN5 — stock import (through the SSRF-guarded importer)", () => {
  it("re-reads the item from Pexels and imports the canonical file with attribution", async () => {
    const { svc, imported } = makeStock();
    await saveKeyOk(svc);
    svc.fetchFn = async (url: string) => {
      expect(url).toContain("/v1/photos/2014422");
      return stubResponse(200, PHOTO);
    };
    const asset = await svc.importStock(ORG, USER, { stockId: "2014422", kind: "photo" });
    expect(imported).toHaveLength(1);
    expect(imported[0]).toMatchObject({
      fileUrl: PHOTO.src.large2x, origin: "pexels",
      sourceUrl: PHOTO.url, attribution: "Photo by Jane Doe on Pexels",
    });
    expect(asset.attribution).toBe("Photo by Jane Doe on Pexels");
    expect(asset.sourceUrl).toBe(PHOTO.url);
  });

  it("picks the largest fitting MP4 for a video import", async () => {
    const { svc, imported } = makeStock();
    await saveKeyOk(svc);
    svc.fetchFn = async () => stubResponse(200, VIDEO);
    await svc.importStock(ORG, USER, { stockId: "2795750", kind: "video" });
    expect(imported[0].fileUrl).toBe(VIDEO.video_files[1].link);
    expect(imported[0].attribution).toBe("Video by John Roe on Pexels");
  });

  it("rejects a non-numeric stockId before any provider call", async () => {
    const { svc } = makeStock();
    await saveKeyOk(svc);
    let called = false;
    svc.fetchFn = async () => { called = true; return stubResponse(200, {}); };
    await expect(svc.importStock(ORG, USER, { stockId: "https://evil.example/x" }))
      .rejects.toThrow(/Stock item/);
    expect(called).toBe(false);
  });

  it("the REAL importer stores the asset with attribution and dedupes a repeat import", async () => {
    const blobs = new Map<string, Buffer>();
    jest.spyOn(MediaStore.prototype, "put").mockImplementation(async (key: string, bytes: Buffer) => { blobs.set(key, bytes); });
    jest.spyOn(MediaStore.prototype, "get").mockImplementation(async (key: string) => blobs.get(key) ?? null);
    const db: any = {
      orgStockConfig: makeTable("stockcfg"),
      mediaAsset: makeTable("asset"),
      organization: makeTable("org"),
    };
    const audit = { log: async () => undefined };
    const importer = new SocialImportService(db, audit as any);
    importer.resolveHost = async () => ["93.184.216.34"];
    const png = await sharp({ create: { width: 4, height: 4, channels: 3, background: { r: 10, g: 20, b: 30 } } }).png().toBuffer();
    let fetches = 0;
    importer.fetchFn = async () => {
      fetches += 1;
      return {
        status: 200, ok: true, headers: { get: () => null },
        body: (async function* () { yield png; })(),
        arrayBuffer: async () => png.buffer.slice(png.byteOffset, png.byteOffset + png.byteLength),
      };
    };
    const svc = new SocialStockService(db, audit as any, importer);
    await saveKeyOk(svc);
    svc.fetchFn = async () => stubResponse(200, PHOTO);
    const first = await svc.importStock(ORG, USER, { stockId: "2014422", kind: "photo" });
    expect(first.attribution).toBe("Photo by Jane Doe on Pexels");
    expect(db.mediaAsset.rows).toHaveLength(1);
    expect(db.mediaAsset.rows[0].origin).toBe("pexels");
    expect(db.mediaAsset.rows[0].sourceUrl).toBe(PHOTO.url);
    // Second import of the same item: the existing asset comes
    // back and NO second download happens.
    const second = await svc.importStock(ORG, USER, { stockId: "2014422", kind: "photo" });
    expect(second.id).toBe(first.id);
    expect(db.mediaAsset.rows).toHaveLength(1);
    expect(fetches).toBe(1);
    jest.restoreAllMocks();
  });
});

describe("SN5 — brand overlay (derived asset, source untouched)", () => {
  async function makeLibrary() {
    const db: any = {
      mediaAsset: makeTable("asset"),
      mediaFolder: makeTable("folder"),
      organization: makeTable("org"),
      socialPost: makeTable("post"),
    };
    db.organization.rows.push({ id: ORG, name: "Qosprey", brandName: "Qosprey", primaryColor: "#0B7285", timezone: "Asia/Dhaka" });
    const audit: any = { log: async () => undefined, entries: [] as any[] };
    audit.log = async (e: any) => { audit.entries.push(e); };
    const lib = new SocialMediaLibraryService(db, audit as any);
    const store = new Map<string, Buffer>();
    lib.writeBytes = async (k, b) => { store.set(k, b); };
    lib.readBytes = async (k) => store.get(k) ?? null;
    lib.deleteBytes = async (k) => { store.delete(k); };
    return { db, lib, store, audit };
  }

  it("bottom bar: derived asset created, source row and bytes untouched, credit copied", async () => {
    const { db, lib, store } = await makeLibrary();
    const base = await sharp({ create: { width: 200, height: 120, channels: 3, background: { r: 200, g: 60, b: 40 } } }).png().toBuffer();
    store.set("k-base", base);
    db.mediaAsset.rows.push({
      id: "a1", organizationId: ORG, kind: "image", name: "kite.png", contentType: "image/png",
      sizeBytes: base.length, storageKey: "k-base", origin: "pexels",
      sourceUrl: PHOTO.url, attribution: "Photo by Jane Doe on Pexels",
      folderId: null, tags: ["kite"], createdAt: new Date(),
    });
    const out = await lib.brandOverlay(ORG, USER, "a1", {});
    expect(out.derivedFromId).toBe("a1");
    expect(out.name).toBe("kite.png (Brand)");
    expect(out.attribution).toBe("Photo by Jane Doe on Pexels");
    expect(db.mediaAsset.rows).toHaveLength(2);
    const source = db.mediaAsset.rows.find((r: any) => r.id === "a1");
    expect(source.sizeBytes).toBe(base.length);
    expect(store.get("k-base")!.equals(base)).toBe(true);
    expect(out.sizeBytes).toBeGreaterThan(0);
  });

  it("corner without any logo refuses honestly (no silent no-op)", async () => {
    const { db, lib, store } = await makeLibrary();
    const base = await sharp({ create: { width: 100, height: 80, channels: 3, background: { r: 1, g: 2, b: 3 } } }).png().toBuffer();
    store.set("k-b", base);
    db.mediaAsset.rows.push({
      id: "a2", organizationId: ORG, kind: "image", name: "x.png", contentType: "image/png",
      sizeBytes: base.length, storageKey: "k-b", origin: "upload", folderId: null, tags: [], createdAt: new Date(),
    });
    await expect(lib.brandOverlay(ORG, USER, "a2", { position: "corner" })).rejects.toThrow(/Logo/);
    expect(db.mediaAsset.rows).toHaveLength(1);
  });

  it("corner WITH a logo asset composes the watermark", async () => {
    const { db, lib, store } = await makeLibrary();
    const base = await sharp({ create: { width: 200, height: 120, channels: 3, background: { r: 9, g: 9, b: 9 } } }).png().toBuffer();
    const logo = await sharp({ create: { width: 60, height: 30, channels: 4, background: { r: 255, g: 255, b: 255, alpha: 1 } } }).png().toBuffer();
    store.set("k-base", base); store.set("k-logo", logo);
    db.mediaAsset.rows.push(
      { id: "a3", organizationId: ORG, kind: "image", name: "base.png", contentType: "image/png", sizeBytes: base.length, storageKey: "k-base", origin: "upload", folderId: null, tags: [], createdAt: new Date() },
      { id: "lg", organizationId: ORG, kind: "image", name: "logo.png", contentType: "image/png", sizeBytes: logo.length, storageKey: "k-logo", origin: "upload", folderId: null, tags: [], createdAt: new Date() },
    );
    const out = await lib.brandOverlay(ORG, USER, "a3", { position: "corner", logoAssetId: "lg" });
    expect(out.derivedFromId).toBe("a3");
    expect(db.mediaAsset.rows).toHaveLength(3);
  });

  it("video assets refuse (image only, stated honestly)", async () => {
    const { db, lib } = await makeLibrary();
    db.mediaAsset.rows.push({
      id: "v1", organizationId: ORG, kind: "video", name: "clip.mp4", contentType: "video/mp4",
      sizeBytes: 10, storageKey: "k-v", origin: "upload", folderId: null, tags: [], createdAt: new Date(),
    });
    await expect(lib.brandOverlay(ORG, USER, "v1", {})).rejects.toThrow(/শুধু ছবিতে/);
  });
});
