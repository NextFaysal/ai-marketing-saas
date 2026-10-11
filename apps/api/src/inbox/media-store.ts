import { createHash, createHmac } from "node:crypto";
import { createReadStream, createWriteStream } from "node:fs";
import { mkdir, open, readFile, stat, unlink, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { Readable, Transform, type TransformCallback } from "node:stream";
import { pipeline } from "node:stream/promises";

/**
 * Unified Inbox U6 media pipeline.
 *
 * Inbound platform media (WhatsApp/Messenger ids and urls) expires
 * — so message bytes are persisted at capture time into durable
 * storage:
 *  - S3 mode when MEDIA_S3_BUCKET + MEDIA_S3_ACCESS_KEY_ID +
 *    MEDIA_S3_SECRET_ACCESS_KEY are set (any S3-compatible
 *    endpoint: AWS, R2, MinIO...). Requests are SigV4-signed by
 *    hand (node:crypto only); downloads can be handed out as
 *    short-lived presigned URLs.
 *  - Local mode otherwise: files under MEDIA_LOCAL_DIR (default
 *    <cwd>/../.media-store). Served through the API's
 *    authenticated media proxy — signedUrl returns null and the
 *    caller falls back to the proxy.
 */
export interface MediaStoreConfig {
  bucket?: string; endpoint?: string; region?: string;
  accessKeyId?: string; secretAccessKey?: string; localDir?: string;
}

const sha256 = (data: string | Buffer) => createHash("sha256").update(data).digest("hex");
const hmac = (key: Buffer | string, data: string) => createHmac("sha256", key).update(data).digest();

export class MediaStore {
  readonly mode: "s3" | "local";
  private readonly cfg: Required<Omit<MediaStoreConfig, "endpoint">> & { endpoint?: string };

  constructor(cfg: MediaStoreConfig = {}) {
    this.cfg = {
      bucket: cfg.bucket ?? "", region: cfg.region ?? "auto",
      accessKeyId: cfg.accessKeyId ?? "", secretAccessKey: cfg.secretAccessKey ?? "",
      endpoint: cfg.endpoint,
      localDir: cfg.localDir ?? join(process.cwd(), "..", ".media-store"),
    };
    this.mode = this.cfg.bucket && this.cfg.accessKeyId && this.cfg.secretAccessKey ? "s3" : "local";
  }

  static fromEnv(): MediaStore {
    return new MediaStore({
      bucket: process.env.MEDIA_S3_BUCKET,
      endpoint: process.env.MEDIA_S3_ENDPOINT,
      region: process.env.MEDIA_S3_REGION,
      accessKeyId: process.env.MEDIA_S3_ACCESS_KEY_ID,
      secretAccessKey: process.env.MEDIA_S3_SECRET_ACCESS_KEY,
      localDir: process.env.MEDIA_LOCAL_DIR,
    });
  }

  private host(): string {
    if (this.cfg.endpoint) return this.cfg.endpoint.replace(/^https?:\/\//, "").replace(/\/$/, "");
    return `${this.cfg.bucket}.s3.${this.cfg.region}.amazonaws.com`;
  }

  private signingKey(dateStamp: string): Buffer {
    const kDate = hmac(`AWS4${this.cfg.secretAccessKey}`, dateStamp);
    const kRegion = hmac(kDate, this.cfg.region);
    const kService = hmac(kRegion, "s3");
    return hmac(kService, "aws4_request");
  }

  /** SigV4 presigned GET URL (query auth). */
  signedUrl(key: string, ttlSeconds = 900): string | null {
    if (this.mode !== "s3") return null;
    const now = new Date();
    const amzDate = now.toISOString().replace(/[-:]/g, "").replace(/\.\d{3}/, "");
    const dateStamp = amzDate.slice(0, 8);
    const scope = `${dateStamp}/${this.cfg.region}/s3/aws4_request`;
    const query = new URLSearchParams({
      "X-Amz-Algorithm": "AWS4-HMAC-SHA256",
      "X-Amz-Credential": `${this.cfg.accessKeyId}/${scope}`,
      "X-Amz-Date": amzDate,
      "X-Amz-Expires": String(Math.min(Math.max(ttlSeconds, 60), 3600)),
      "X-Amz-SignedHeaders": "host",
    });
    const encodedKey = key.split("/").map(encodeURIComponent).join("/");
    const canonicalUri = this.cfg.endpoint ? `/${this.cfg.bucket}/${encodedKey}` : `/${encodedKey}`;
    const canonicalRequest = ["GET", canonicalUri, query.toString(), `host:${this.host()}\n`, "host", "UNSIGNED-PAYLOAD"].join("\n");
    const stringToSign = ["AWS4-HMAC-SHA256", amzDate, scope, sha256(canonicalRequest)].join("\n");
    const signature = createHmac("sha256", this.signingKey(dateStamp)).update(stringToSign).digest("hex");
    const scheme = this.cfg.endpoint?.startsWith("http://") ? "http" : "https";
    return `${scheme}://${this.host()}${canonicalUri}?${query.toString()}&X-Amz-Signature=${signature}`;
  }

  private async s3Fetch(method: string, key: string, bytes?: Buffer, contentType?: string, extra?: { headers?: Record<string, string>; streamBody?: Readable; unsignedPayload?: boolean }): Promise<Response> {
    const now = new Date();
    const amzDate = now.toISOString().replace(/[-:]/g, "").replace(/\.\d{3}/, "");
    const dateStamp = amzDate.slice(0, 8);
    const scope = `${dateStamp}/${this.cfg.region}/s3/aws4_request`;
    // Streamed uploads cannot hash the payload up front — SigV4's
    // UNSIGNED-PAYLOAD is the documented escape hatch (S3 and the
    // common S3-compatible stores accept it over HTTPS).
    const payloadHash = extra?.unsignedPayload ? "UNSIGNED-PAYLOAD" : sha256(bytes ?? "");
    const headers: Record<string, string> = {
      host: this.host(), "x-amz-content-sha256": payloadHash, "x-amz-date": amzDate,
      ...(contentType ? { "content-type": contentType } : {}),
      ...(extra?.headers ?? {}),
    };
    const signedHeaders = Object.keys(headers).sort().join(";");
    const canonicalHeaders = Object.keys(headers).sort().map((h) => `${h}:${headers[h]}\n`).join("");
    const pathStyle = Boolean(this.cfg.endpoint);
    const canonicalUri = pathStyle
      ? `/${this.cfg.bucket}/${key.split("/").map(encodeURIComponent).join("/")}`
      : `/${key.split("/").map(encodeURIComponent).join("/")}`;
    const canonicalRequest = [method, canonicalUri, "", canonicalHeaders, signedHeaders, payloadHash].join("\n");
    const stringToSign = ["AWS4-HMAC-SHA256", amzDate, scope, sha256(canonicalRequest)].join("\n");
    const signature = createHmac("sha256", this.signingKey(dateStamp)).update(stringToSign).digest("hex");
    headers.authorization = `AWS4-HMAC-SHA256 Credential=${this.cfg.accessKeyId}/${scope}, SignedHeaders=${signedHeaders}, Signature=${signature}`;
    const scheme = this.cfg.endpoint?.startsWith("http://") ? "http" : "https";
    const url = pathStyle
      ? `${scheme}://${this.host()}/${this.cfg.bucket}/${key}`
      : `${scheme}://${this.host()}/${key}`;
    if (extra?.streamBody) {
      // undici wants a WEB ReadableStream for a streamed body and
      // requires duplex "half" when one is supplied.
      return fetch(url, { method, headers, body: Readable.toWeb(extra.streamBody) as any, duplex: "half" } as any);
    }
    return fetch(url, { method, headers, body: bytes as any });
  }

  async put(key: string, bytes: Buffer, contentType: string): Promise<void> {
    if (this.mode === "s3") {
      const res = await this.s3Fetch("PUT", key, bytes, contentType);
      if (!res.ok) throw new Error(`S3 PUT failed (${res.status})`);
      return;
    }
    const file = join(this.cfg.localDir, key);
    await mkdir(dirname(file), { recursive: true });
    await writeFile(file, bytes);
  }

  async get(key: string): Promise<Buffer | null> {
    if (this.mode === "s3") {
      const res = await this.s3Fetch("GET", key);
      if (res.status === 404) return null;
      if (!res.ok) throw new Error(`S3 GET failed (${res.status})`);
      return Buffer.from(await res.arrayBuffer());
    }
    try {
      return await readFile(join(this.cfg.localDir, key));
    } catch {
      return null;
    }
  }

  // ---------- PP2: streaming surface (large video) ----------
  // The Buffer API above buffers whole files in memory — fine for
  // inbox attachments and images, unusable for real video. These
  // methods move bytes as streams / bounded ranges and never hold
  // a whole object in memory.

  /** Stream a source into storage; resolves with the byte count
   * actually written. On any failure the partial object is the
   * caller's cleanup problem ONLY for S3 — the local path removes
   * its partial file itself. */
  async putStream(key: string, source: Readable, contentType: string): Promise<number> {
    if (this.mode === "s3") {
      let count = 0;
      const counter = new Transform({
        transform(chunk: Buffer, _enc: BufferEncoding, cb: TransformCallback) {
          count += chunk.length;
          cb(null, chunk);
        },
      });
      const counted = source.pipe(counter);
      const res = await this.s3Fetch("PUT", key, undefined, contentType, { streamBody: counted, unsignedPayload: true });
      if (!res.ok) throw new Error(`S3 PUT failed (${res.status})`);
      return count;
    }
    const file = join(this.cfg.localDir, key);
    await mkdir(dirname(file), { recursive: true });
    let count = 0;
    const counter = new Transform({
      transform(chunk: Buffer, _enc: BufferEncoding, cb: TransformCallback) {
        count += chunk.length;
        cb(null, chunk);
      },
    });
    try {
      await pipeline(source, counter, createWriteStream(file));
    } catch (e) {
      await unlink(file).catch(() => undefined);
      throw e;
    }
    return count;
  }

  /** Total size of a stored object, or null when it does not exist. */
  async size(key: string): Promise<number | null> {
    if (this.mode === "s3") {
      const res = await this.s3Fetch("HEAD", key);
      if (res.status === 404) return null;
      if (!res.ok) throw new Error(`S3 HEAD failed (${res.status})`);
      const len = res.headers.get("content-length");
      return len ? Number(len) : null;
    }
    try {
      return (await stat(join(this.cfg.localDir, key))).size;
    } catch {
      return null;
    }
  }

  /** Read a bounded byte range (YouTube's chunked resumable
   * upload reads through this — at most `length` bytes are ever
   * in memory). Null when the object does not exist. */
  async readRange(key: string, offset: number, length: number): Promise<Buffer | null> {
    if (length <= 0) return Buffer.alloc(0);
    if (this.mode === "s3") {
      const res = await this.s3Fetch("GET", key, undefined, undefined, {
        headers: { Range: `bytes=${offset}-${offset + length - 1}` },
      });
      if (res.status === 404) return null;
      if (!res.ok && res.status !== 206) throw new Error(`S3 GET range failed (${res.status})`);
      return Buffer.from(await res.arrayBuffer());
    }
    let fh;
    try {
      fh = await open(join(this.cfg.localDir, key), "r");
    } catch {
      return null;
    }
    try {
      const buf = Buffer.alloc(length);
      const { bytesRead } = await fh.read(buf, 0, length, offset);
      return buf.subarray(0, bytesRead);
    } finally {
      await fh.close().catch(() => undefined);
    }
  }

  /** Open a read stream over a byte range (or the whole object
   * when `range` is omitted). `totalSize` is the FULL object size
   * whenever the storage layer reports it. Null when missing. */
  async getStream(key: string, range?: { start: number; end: number }): Promise<{ stream: Readable; totalSize: number | null } | null> {
    if (this.mode === "s3") {
      const res = await this.s3Fetch("GET", key, undefined, undefined, {
        headers: range ? { Range: `bytes=${range.start}-${range.end}` } : {},
      });
      if (res.status === 404) return null;
      if (!res.ok && res.status !== 206) throw new Error(`S3 GET stream failed (${res.status})`);
      if (!res.body) throw new Error("S3 GET stream returned no body");
      let stream: Readable = Readable.fromWeb(res.body as any);
      const cr = res.headers.get("content-range");
      const crMatch = cr ? /\/(\d+)$/.exec(cr) : null;
      let totalSize: number | null = crMatch ? Number(crMatch[1]) : null;
      if (totalSize == null) {
        const len = res.headers.get("content-length");
        if (len) totalSize = Number(len) + (range?.start ?? 0);
      }
      if (range && res.status === 200) {
        // The store ignored the Range (full body): slice in
        // process so the caller still gets exactly the range —
        // bounded by the range length, never the whole object in
        // memory at once... it streams through a skip/take window.
        let skipped = 0;
        let remaining = range.end - range.start + 1;
        const slicer = new Transform({
          transform(chunk: Buffer, _enc: BufferEncoding, cb: TransformCallback) {
            let buf = chunk;
            if (skipped < range.start) {
              const skip = Math.min(buf.length, range.start - skipped);
              skipped += skip;
              buf = buf.subarray(skip);
            }
            if (buf.length > remaining) buf = buf.subarray(0, Math.max(remaining, 0));
            remaining -= buf.length;
            if (buf.length) this.push(buf);
            cb();
          },
        });
        stream = stream.pipe(slicer);
      }
      return { stream, totalSize };
    }
    const file = join(this.cfg.localDir, key);
    let totalSize: number;
    try {
      totalSize = (await stat(file)).size;
    } catch {
      return null;
    }
    const stream = range ? createReadStream(file, { start: range.start, end: range.end }) : createReadStream(file);
    return { stream, totalSize };
  }

  /** Best-effort delete (cleanup after a failed asset create). */
  async delete(key: string): Promise<void> {
    if (this.mode === "s3") {
      await this.s3Fetch("DELETE", key).catch(() => undefined);
      return;
    }
    await unlink(join(this.cfg.localDir, key)).catch(() => undefined);
  }
}

export function mediaKeyFor(organizationId: string, messageId: string, contentType: string): string {
  const now = new Date();
  const ym = `${now.getUTCFullYear()}-${String(now.getUTCMonth() + 1).padStart(2, "0")}`;
  const ext = contentType.includes("png") ? "png" : contentType.includes("jpeg") || contentType.includes("jpg") ? "jpg"
    : contentType.includes("ogg") ? "ogg" : contentType.includes("mp4") ? "mp4"
    : contentType.includes("pdf") ? "pdf" : contentType.includes("webp") ? "webp" : "bin";
  return `${organizationId}/${ym}/${messageId}.${ext}`;
}
