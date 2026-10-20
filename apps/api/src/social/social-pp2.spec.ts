import { BadRequestException } from "@nestjs/common";
import { mkdtemp, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Readable } from "node:stream";
import { MediaStore } from "../inbox/media-store";
import { SocialService, parseSingleRange, socialVideoMaxBytes } from "./social.service";
import { YOUTUBE_UPLOAD_CHUNK_BYTES, YouTubeClient, YouTubePublisher } from "./youtube.client";

/**
 * PP2 — Large video (TikTok/YouTube usable):
 * - the streamed upload pipes the request body into a temp file
 *   (never a whole-file memory buffer), counts bytes as they
 *   flow, and lets the SNIFFED kind pick the cap: images stay at
 *   the 2.1 MB image cap, videos get SOCIAL_VIDEO_MAX_BYTES
 *   (default 256 MB). An aborted/over-cap upload leaves NO asset
 *   row, NO stored file and NO temp file.
 * - MediaStore gains the streaming surface (putStream / size /
 *   readRange / getStream / delete) on the REAL local store —
 *   YouTube's chunked upload and the file routes read through it.
 * - YouTubePublisher.uploadFromSource moves bytes in 8 MiB
 *   chunks from a range-read source and keeps SP9's discipline:
 *   a mid-upload failure QUERYs the session before resuming from
 *   the offset YouTube reports.
 * - the file-serving reads (getMediaFileStream /
 *   resolvePublicMediaStream) stream the exact requested range.
 */
const ORG = "org-1";
const ACTOR = "owner-1";
type Row = Record<string, any>;

let mediaDir = "";
const prevMediaDir = process.env.MEDIA_LOCAL_DIR;
const prevVideoCap = process.env.SOCIAL_VIDEO_MAX_BYTES;

beforeAll(async () => {
  mediaDir = await mkdtemp(join(tmpdir(), "pp2-media-"));
  process.env.MEDIA_LOCAL_DIR = mediaDir;
});

afterAll(async () => {
  if (prevMediaDir === undefined) delete process.env.MEDIA_LOCAL_DIR;
  else process.env.MEDIA_LOCAL_DIR = prevMediaDir;
  if (prevVideoCap === undefined) delete process.env.SOCIAL_VIDEO_MAX_BYTES;
  else process.env.SOCIAL_VIDEO_MAX_BYTES = prevVideoCap;
  await rm(mediaDir, { recursive: true, force: true });
});

function matches(row: Row, where: any): boolean {
  return Object.entries(where ?? {}).every(([k, v]) => {
    if (v === null) return row[k] === null || row[k] === undefined;
    if (v && typeof v === "object" && !(v instanceof Date)) return true;
    return row[k] === v;
  });
}

function fakeDb() {
  const db: any = { mediaAssets: [] as Row[], auditRows: [] as Row[] };
  db.mediaAsset = {
    findFirst: jest.fn(async (args: any = {}) => {
      const row = db.mediaAssets.find((r: Row) => matches(r, args.where));
      return row ? { ...row } : null;
    }),
    findMany: jest.fn(async (args: any = {}) => db.mediaAssets.filter((r: Row) => matches(r, args.where)).map((r: Row) => ({ ...r }))),
    create: jest.fn(async ({ data }: any) => {
      const row = { createdAt: new Date(), updatedAt: new Date(), publicToken: null, origin: "upload", prompt: null, ...data };
      db.mediaAssets.push(row);
      return { ...row };
    }),
    update: jest.fn(async ({ where, data }: any) => {
      const row = db.mediaAssets.find((r: Row) => matches(r, where));
      if (row) Object.assign(row, data, { updatedAt: new Date() });
      return row ? { ...row } : null;
    }),
  };
  return db;
}

function mkAudit(db: any) {
  return { log: jest.fn(async (row: any) => { db.auditRows.push(row); return row; }) };
}

function service(db: any) {
  return new SocialService(db as any, mkAudit(db) as any);
}

/** MP4 magic: a size box + "ftyp" at offset 4, then filler. */
function mp4Bytes(size: number, fill = 7): Buffer {
  const buf = Buffer.alloc(size, fill);
  buf.writeUInt32BE(24, 0);
  buf.write("ftypisom", 4, "latin1");
  return buf;
}

/** PNG magic + filler. */
function pngBytes(size: number): Buffer {
  const buf = Buffer.alloc(size, 3);
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]).copy(buf, 0);
  return buf;
}

/** Feed a buffer through a Readable in slices (a streamed body). */
function streamOf(buf: Buffer, slice = 64 * 1024): Readable {
  const parts: Buffer[] = [];
  for (let i = 0; i < buf.length; i += slice) parts.push(buf.subarray(i, Math.min(i + slice, buf.length)));
  if (parts.length === 0) parts.push(Buffer.alloc(0));
  return Readable.from(parts);
}

async function storedFiles(): Promise<string[]> {
  const out: string[] = [];
  const walk = async (dir: string) => {
    const entries = await readdir(dir, { withFileTypes: true }).catch(() => []);
    for (const e of entries) {
      if (e.isDirectory()) await walk(join(dir, e.name));
      else out.push(join(dir, e.name));
    }
  };
  await walk(mediaDir);
  return out;
}

async function tempLeftovers(): Promise<string[]> {
  const entries = await readdir(tmpdir());
  return entries.filter((e) => e.startsWith("social-upload-"));
}

async function collect(stream: Readable): Promise<Buffer> {
  const parts: Buffer[] = [];
  for await (const c of stream) parts.push(Buffer.isBuffer(c) ? c : Buffer.from(c as Uint8Array));
  return Buffer.concat(parts);
}

describe("PP2 streamed upload — caps by sniffed kind", () => {
  it("a >2.1 MB video uploads fine (default video cap) and lands in storage whole", async () => {
    const db = fakeDb();
    const svc = service(db);
    const bytes = mp4Bytes(3_000_000);
    const tempsBefore = await tempLeftovers();
    const asset = await svc.uploadMediaStream(ORG, ACTOR, {
      stream: streamOf(bytes), declaredContentType: "video/mp4", fileName: "clip.mp4",
    });
    expect(asset.kind).toBe("video");
    expect(asset.contentType).toBe("video/mp4");
    expect(asset.sizeBytes).toBe(3_000_000);
    expect(db.mediaAssets).toHaveLength(1);
    const store = MediaStore.fromEnv();
    expect(await store.size(db.mediaAssets[0].storageKey)).toBe(3_000_000);
    expect(await tempLeftovers()).toEqual(tempsBefore);
    expect(db.auditRows.some((r: Row) => r.action === "social.media_uploaded" && r.metadata?.via === "stream")).toBe(true);
  });

  it("an image over the image cap is refused — no row, no stored file, no temp", async () => {
    const db = fakeDb();
    const svc = service(db);
    const filesBefore = await storedFiles();
    const tempsBefore = await tempLeftovers();
    const err = await svc.uploadMediaStream(ORG, ACTOR, {
      stream: streamOf(pngBytes(2_200_000)), declaredContentType: "image/png", fileName: "big.png",
    }).catch((e) => e);
    expect(err).toBeInstanceOf(BadRequestException);
    expect(err.message).toContain("২.১ MB");
    expect(db.mediaAssets).toHaveLength(0);
    expect(await storedFiles()).toEqual(filesBefore);
    expect(await tempLeftovers()).toEqual(tempsBefore);
  });

  it("a video over the (env-set) video cap aborts mid-stream — nothing survives", async () => {
    process.env.SOCIAL_VIDEO_MAX_BYTES = "1000000";
    try {
      expect(socialVideoMaxBytes()).toBe(1_000_000);
      const db = fakeDb();
      const svc = service(db);
      const filesBefore = await storedFiles();
      const tempsBefore = await tempLeftovers();
      const err = await svc.uploadMediaStream(ORG, ACTOR, {
        stream: streamOf(mp4Bytes(1_500_000)), declaredContentType: "video/mp4",
      }).catch((e) => e);
      expect(err).toBeInstanceOf(BadRequestException);
      expect(err.message).toContain("ভিডিওর আকার সর্বোচ্চ ১ MB");
      expect(db.mediaAssets).toHaveLength(0);
      expect(await storedFiles()).toEqual(filesBefore);
      expect(await tempLeftovers()).toEqual(tempsBefore);
    } finally {
      delete process.env.SOCIAL_VIDEO_MAX_BYTES;
    }
  });

  it("magic bytes beat the file name: an .jpg that is really an MP4 uses the video path", async () => {
    const db = fakeDb();
    const svc = service(db);
    const asset = await svc.uploadMediaStream(ORG, ACTOR, {
      stream: streamOf(mp4Bytes(2_500_000)), declaredContentType: "image/jpeg", fileName: "photo.jpg",
    });
    expect(asset.kind).toBe("video");
    expect(asset.contentType).toBe("video/mp4");
    expect(asset.sizeBytes).toBe(2_500_000);
  });

  it("non-media bytes are refused with the same honest message as the base64 path", async () => {
    const db = fakeDb();
    const svc = service(db);
    const err = await svc.uploadMediaStream(ORG, ACTOR, {
      stream: streamOf(Buffer.from("just some text, definitely not media".repeat(10))), declaredContentType: "text/plain",
    }).catch((e) => e);
    expect(err).toMatchObject({ code: "social.onlyImagesOrVideosCanBe" });
    expect(err.message).toContain("শুধু ছবি বা ভিডিও আপলোড করা যাবে");
    expect(db.mediaAssets).toHaveLength(0);
  });

  it("mediaLimits exposes both caps (defaults)", () => {
    const svc = service(fakeDb());
    expect(svc.mediaLimits()).toEqual({ imageMaxBytes: 2_100_000, videoMaxBytes: 268_435_456 });
  });
});

describe("PP2 MediaStore streaming surface (real local store)", () => {
  it("putStream → size → readRange → getStream range → delete", async () => {
    const store = MediaStore.fromEnv();
    const key = `${ORG}/social/pp2-store.mp4`;
    const bytes = mp4Bytes(100_000, 11);
    const written = await store.putStream(key, Readable.from([bytes]), "video/mp4");
    expect(written).toBe(100_000);
    expect(await store.size(key)).toBe(100_000);
    const slice = await store.readRange(key, 10, 25);
    expect(slice).toEqual(bytes.subarray(10, 35));
    const ranged = await store.getStream(key, { start: 100, end: 199 });
    expect(ranged?.totalSize).toBe(100_000);
    expect(await collect(ranged!.stream)).toEqual(bytes.subarray(100, 200));
    const whole = await store.getStream(key);
    expect(await collect(whole!.stream)).toEqual(bytes);
    await store.delete(key);
    expect(await store.size(key)).toBeNull();
    expect(await store.getStream(key)).toBeNull();
    expect(await store.readRange(key, 0, 10)).toBeNull();
  });

  it("parseSingleRange: open-ended, suffix, clamped, and the malformed cases", () => {
    expect(parseSingleRange(undefined, 1000)).toBeNull();
    expect(parseSingleRange("bytes=0-99", 1000)).toEqual({ start: 0, end: 99 });
    expect(parseSingleRange("bytes=500-", 1000)).toEqual({ start: 500, end: 999 });
    expect(parseSingleRange("bytes=-100", 1000)).toEqual({ start: 900, end: 999 });
    expect(parseSingleRange("bytes=900-5000", 1000)).toEqual({ start: 900, end: 999 });
    expect(parseSingleRange("bytes=1000-", 1000)).toBeNull();
    expect(parseSingleRange("bytes=0-99,200-299", 1000)).toBeNull();
    expect(parseSingleRange("items=0-99", 1000)).toBeNull();
  });
});

describe("PP2 streamed file serving (service level)", () => {
  it("getMediaFileStream serves the exact range; the public stream resolves by token", async () => {
    const db = fakeDb();
    const svc = service(db);
    const bytes = mp4Bytes(50_000, 5);
    const asset = await svc.uploadMediaStream(ORG, ACTOR, {
      stream: streamOf(bytes), declaredContentType: "video/mp4", fileName: "v.mp4",
    });
    const ranged = await svc.getMediaFileStream(ORG, asset.id, "bytes=1000-1999");
    expect(ranged.partial).toBe(true);
    expect(ranged.totalSize).toBe(50_000);
    expect(await collect(ranged.stream)).toEqual(bytes.subarray(1000, 2000));
    const full = await svc.getMediaFileStream(ORG, asset.id);
    expect(full.partial).toBe(false);
    expect(await collect(full.stream)).toEqual(bytes);
    // Public twin: same asset once it carries a public token.
    const row = db.mediaAssets.find((r: Row) => r.id === asset.id);
    row.publicToken = "tok-pp2";
    const pub = await svc.resolvePublicMediaStream("tok-pp2", "bytes=-100");
    expect(pub?.partial).toBe(true);
    expect(await collect(pub!.stream)).toEqual(bytes.subarray(49_900));
    expect(await svc.resolvePublicMediaStream("nope")).toBeNull();
  });
});

describe("PP2 YouTube chunked upload from a byte source", () => {
  function ytFetch(handler: (url: string, opts: any, call: number) => any) {
    let call = 0;
    return jest.fn(async (url: string, opts: any = {}) => handler(url, opts, ++call)) as unknown as typeof fetch;
  }

  it("moves a >16 MiB video in chunk-sized PUTs with exact Content-Ranges", async () => {
    const total = YOUTUBE_UPLOAD_CHUNK_BYTES * 2 + 123;
    const backing = mp4Bytes(total, 2);
    const readLengths: number[] = [];
    const source = {
      size: total, contentType: "video/mp4",
      readRange: async (offset: number, length: number) => {
        readLengths.push(length);
        return backing.subarray(offset, offset + length);
      },
    };
    const putRanges: string[] = [];
    const fetchFn = ytFetch(async (url, opts) => {
      if (String(url).includes("uploadType=resumable")) {
        expect(opts.headers["X-Upload-Content-Length"]).toBe(String(total));
        return { ok: true, status: 200, headers: { location: "https://upload.session/pp2" }, json: async () => ({}) };
      }
      putRanges.push(opts.headers["Content-Range"]);
      const m = /bytes (\d+)-(\d+)\//.exec(opts.headers["Content-Range"]);
      const end = Number(m![2]);
      if (end < total - 1) {
        return { ok: true, status: 308, headers: { range: `bytes=0-${end}` }, json: async () => ({}) };
      }
      return { ok: true, status: 201, headers: {}, json: async () => ({ id: "vid-pp2" }) };
    });
    const publisher = new YouTubePublisher(new YouTubeClient(fetchFn));
    const out = await publisher.uploadFromSource({ accessToken: "t", source, title: "t", description: "d" });
    expect(out.videoId).toBe("vid-pp2");
    expect(readLengths.every((l) => l <= YOUTUBE_UPLOAD_CHUNK_BYTES)).toBe(true);
    expect(putRanges).toEqual([
      `bytes 0-${YOUTUBE_UPLOAD_CHUNK_BYTES - 1}/${total}`,
      `bytes ${YOUTUBE_UPLOAD_CHUNK_BYTES}-${2 * YOUTUBE_UPLOAD_CHUNK_BYTES - 1}/${total}`,
      `bytes ${2 * YOUTUBE_UPLOAD_CHUNK_BYTES}-${total - 1}/${total}`,
    ]);
  });

  it("a mid-upload failure queries the session, then resumes from YouTube's offset", async () => {
    const total = 5000;
    const backing = mp4Bytes(total, 4);
    const source = {
      size: total, contentType: "video/mp4",
      readRange: async (offset: number, length: number) => backing.subarray(offset, offset + length),
    };
    const seen: string[] = [];
    let dataPuts = 0;
    const fetchFn = ytFetch(async (url, opts) => {
      if (String(url).includes("uploadType=resumable")) {
        return { ok: true, status: 200, headers: { location: "https://upload.session/pp2b" }, json: async () => ({}) };
      }
      const range = opts.headers["Content-Range"];
      seen.push(range);
      if (range === `bytes */${total}`) {
        return { ok: true, status: 308, headers: { range: "bytes=0-999" }, json: async () => ({}) };
      }
      dataPuts += 1;
      if (dataPuts === 1) throw new Error("socket hang up");
      return { ok: true, status: 201, headers: {}, json: async () => ({ id: "vid-resumed" }) };
    });
    const publisher = new YouTubePublisher(new YouTubeClient(fetchFn));
    const out = await publisher.uploadFromSource({ accessToken: "t", source, title: "t", description: "d" });
    expect(out.videoId).toBe("vid-resumed");
    // first PUT (all bytes), the status query, then the resume PUT
    // starting exactly at the offset the session reported (1000).
    expect(seen[0]).toBe(`bytes 0-${total - 1}/${total}`);
    expect(seen[1]).toBe(`bytes */${total}`);
    expect(seen[2]).toBe(`bytes 1000-${total - 1}/${total}`);
  });
});
