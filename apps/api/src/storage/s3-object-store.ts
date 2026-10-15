import { createHash, createHmac } from "node:crypto";
import {
  buildCompleteMultipartUploadXml,
  buildDeleteObjectsXml,
  parseDeleteObjectsResult,
  parseInitiateMultipartUpload,
  parseListObjectsV2,
  parseS3Error,
  stripEtagQuotes,
  xmlTag,
  type S3ListedObject,
} from "./s3-xml";

/**
 * RM2 — a single-bucket S3-compatible object store: the full S3
 * surface the media program needs, built by extending the SAME
 * hand-rolled SigV4 approach as the inbox MediaStore (node:crypto
 * only, no SDK). MediaStore itself is untouched; this class exists
 * because MediaStore's surface stops at put/get/stream and its
 * presigning covers GET only.
 *
 * What this adds over MediaStore:
 *  - generalized presigning (GET and PUT, arbitrary query params —
 *    multipart part URLs are presigned PUTs with partNumber+uploadId)
 *  - header-signed requests with query strings (subresources:
 *    ?uploads, ?uploadId, ?delete, list-type=2)
 *  - multipart upload lifecycle (create / complete / abort)
 *  - CopyObject, DeleteObjects (batch), ListObjectsV2, HEAD metadata
 *
 * Addressing mirrors MediaStore: path-style when an endpoint is set
 * (R2: https://<account-id>.r2.cloudflarestorage.com), virtual-hosted
 * AWS style otherwise. Region "auto" for R2.
 *
 * Provenance of proof: signing and XML are unit-proven against
 * fixtures with a stubbed fetch. Nothing here has run against a live
 * R2 bucket yet — see docs/r2-rb2-acceptance.md.
 */

export interface S3ObjectStoreConfig {
  bucket: string;
  endpoint?: string;
  region: string;
  accessKeyId: string;
  secretAccessKey: string;
}

export interface ObjectHead {
  sizeBytes: number | null;
  contentType: string | null;
  etag: string | null;
  lastModified: string | null;
  metadata: Record<string, string>;
}

export interface CompletedPart {
  partNumber: number;
  etag: string;
}

const sha256 = (data: string | Buffer) => createHash("sha256").update(data).digest("hex");
const hmac = (key: Buffer | string, data: string) => createHmac("sha256", key).update(data).digest();

/** RFC 3986 encoding as SigV4 requires (encodeURIComponent leaves
 * !'()* raw, which the canonical form must still escape). */
const enc = (s: string) =>
  encodeURIComponent(s).replace(/[!'()*]/g, (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`);

/** Canonical query string: entries sorted by key, then value. */
export function canonicalQueryString(entries: [string, string][]): string {
  return [...entries]
    .sort((a, b) => (a[0] === b[0] ? (a[1] < b[1] ? -1 : a[1] > b[1] ? 1 : 0) : a[0] < b[0] ? -1 : 1))
    .map(([k, v]) => `${enc(k)}=${enc(v)}`)
    .join("&");
}

export class S3ObjectStore {
  readonly bucket: string;
  private readonly cfg: S3ObjectStoreConfig;

  constructor(cfg: S3ObjectStoreConfig) {
    this.cfg = cfg;
    this.bucket = cfg.bucket;
  }

  private host(): string {
    if (this.cfg.endpoint) return this.cfg.endpoint.replace(/^https?:\/\//, "").replace(/\/$/, "");
    return `${this.cfg.bucket}.s3.${this.cfg.region}.amazonaws.com`;
  }

  private scheme(): string {
    return this.cfg.endpoint?.startsWith("http://") ? "http" : "https";
  }

  private signingKey(dateStamp: string): Buffer {
    const kDate = hmac(`AWS4${this.cfg.secretAccessKey}`, dateStamp);
    const kRegion = hmac(kDate, this.cfg.region);
    const kService = hmac(kRegion, "s3");
    return hmac(kService, "aws4_request");
  }

  private canonicalUri(key: string): string {
    const encodedKey = key.split("/").map(enc).join("/");
    if (this.cfg.endpoint) return key === "" ? `/${this.cfg.bucket}` : `/${this.cfg.bucket}/${encodedKey}`;
    return key === "" ? "/" : `/${encodedKey}`;
  }

  private static amzDates(now: Date): { amzDate: string; dateStamp: string } {
    const amzDate = now.toISOString().replace(/[-:]/g, "").replace(/\.\d{3}/, "");
    return { amzDate, dateStamp: amzDate.slice(0, 8) };
  }

  /**
   * SigV4 presigned URL (query auth) for GET or PUT with arbitrary
   * extra query params. Only the host header is signed, so a PUT
   * client may set its own Content-Type — the app verifies the real
   * type/size at completion time (plan §1.3 step 3). TTL follows
   * MediaStore's policy: clamped to [60, 3600] seconds.
   */
  presign(
    method: "GET" | "PUT",
    key: string,
    opts: { ttlSeconds?: number; query?: Record<string, string>; now?: Date } = {},
  ): string {
    const now = opts.now ?? new Date();
    const { amzDate, dateStamp } = S3ObjectStore.amzDates(now);
    const scope = `${dateStamp}/${this.cfg.region}/s3/aws4_request`;
    const ttl = Math.min(Math.max(opts.ttlSeconds ?? 900, 60), 3600);
    const entries: [string, string][] = [
      ["X-Amz-Algorithm", "AWS4-HMAC-SHA256"],
      ["X-Amz-Credential", `${this.cfg.accessKeyId}/${scope}`],
      ["X-Amz-Date", amzDate],
      ["X-Amz-Expires", String(ttl)],
      ["X-Amz-SignedHeaders", "host"],
      ...Object.entries(opts.query ?? {}),
    ];
    const qs = canonicalQueryString(entries);
    const uri = this.canonicalUri(key);
    const canonicalRequest = [method, uri, qs, `host:${this.host()}\n`, "host", "UNSIGNED-PAYLOAD"].join("\n");
    const stringToSign = ["AWS4-HMAC-SHA256", amzDate, scope, sha256(canonicalRequest)].join("\n");
    const signature = createHmac("sha256", this.signingKey(dateStamp)).update(stringToSign).digest("hex");
    return `${this.scheme()}://${this.host()}${uri}?${qs}&X-Amz-Signature=${signature}`;
  }

  /** Header-signed request with optional query string and body. */
  async request(
    method: string,
    key: string,
    opts: {
      query?: Record<string, string>;
      body?: string | Buffer;
      contentType?: string;
      headers?: Record<string, string>;
      unsignedPayload?: boolean;
    } = {},
  ): Promise<Response> {
    const now = new Date();
    const { amzDate, dateStamp } = S3ObjectStore.amzDates(now);
    const scope = `${dateStamp}/${this.cfg.region}/s3/aws4_request`;
    const payloadHash = opts.unsignedPayload ? "UNSIGNED-PAYLOAD" : sha256(opts.body ?? "");
    const headers: Record<string, string> = {
      host: this.host(),
      "x-amz-content-sha256": payloadHash,
      "x-amz-date": amzDate,
      ...(opts.contentType ? { "content-type": opts.contentType } : {}),
      ...(opts.headers ?? {}),
    };
    const signedHeaders = Object.keys(headers).sort().join(";");
    const canonicalHeaders = Object.keys(headers).sort().map((h) => `${h}:${headers[h]}\n`).join("");
    const qs = canonicalQueryString(Object.entries(opts.query ?? {}));
    const uri = this.canonicalUri(key);
    const canonicalRequest = [method, uri, qs, canonicalHeaders, signedHeaders, payloadHash].join("\n");
    const stringToSign = ["AWS4-HMAC-SHA256", amzDate, scope, sha256(canonicalRequest)].join("\n");
    const signature = createHmac("sha256", this.signingKey(dateStamp)).update(stringToSign).digest("hex");
    headers.authorization = `AWS4-HMAC-SHA256 Credential=${this.cfg.accessKeyId}/${scope}, SignedHeaders=${signedHeaders}, Signature=${signature}`;
    const url = `${this.scheme()}://${this.host()}${uri}${qs ? `?${qs}` : ""}`;
    return fetch(url, { method, headers, body: opts.body as any });
  }

  private async fail(res: Response, op: string): Promise<never> {
    const text = await res.text().catch(() => "");
    const err = text ? parseS3Error(text) : null;
    throw new Error(err ? `S3 ${op} failed (${res.status}): ${err.code}: ${err.message}` : `S3 ${op} failed (${res.status})`);
  }

  async put(key: string, bytes: Buffer, contentType: string): Promise<void> {
    const res = await this.request("PUT", key, { body: bytes, contentType });
    if (!res.ok) await this.fail(res, "PUT");
  }

  async get(key: string): Promise<Buffer | null> {
    const res = await this.request("GET", key);
    if (res.status === 404) return null;
    if (!res.ok) await this.fail(res, "GET");
    return Buffer.from(await res.arrayBuffer());
  }

  /** HEAD metadata, or null when the object does not exist. */
  async head(key: string): Promise<ObjectHead | null> {
    const res = await this.request("HEAD", key);
    if (res.status === 404) return null;
    if (!res.ok) await this.fail(res, "HEAD");
    const metadata: Record<string, string> = {};
    res.headers.forEach((value, name) => {
      if (name.toLowerCase().startsWith("x-amz-meta-")) metadata[name.toLowerCase().slice("x-amz-meta-".length)] = value;
    });
    const len = res.headers.get("content-length");
    return {
      sizeBytes: len != null ? Number(len) : null,
      contentType: res.headers.get("content-type"),
      etag: stripEtagQuotes(res.headers.get("etag")),
      lastModified: res.headers.get("last-modified"),
      metadata,
    };
  }

  /** Best-effort single delete (mirrors MediaStore.delete). */
  async delete(key: string): Promise<void> {
    await this.request("DELETE", key).catch(() => undefined);
  }

  /**
   * Batch delete (DeleteObjects, Quiet mode). In Quiet mode the
   * service only reports failures, so `deleted` is computed as
   * "requested minus errored" — never taken from a possibly-empty
   * <Deleted> list.
   */
  async deleteMany(keys: string[]): Promise<{ deleted: string[]; errors: { key: string; code: string; message: string }[] }> {
    if (keys.length === 0) return { deleted: [], errors: [] };
    const res = await this.request("POST", "", {
      query: { delete: "" },
      body: buildDeleteObjectsXml(keys),
      contentType: "application/xml",
    });
    if (!res.ok) await this.fail(res, "DeleteObjects");
    const parsed = parseDeleteObjectsResult(await res.text());
    const errored = new Set(parsed.errors.map((e) => e.key));
    return { deleted: keys.filter((k) => !errored.has(k)), errors: parsed.errors };
  }

  /** CopyObject into this bucket (source may be another bucket in
   * the same account). CopyObject can answer HTTP 200 with an
   * embedded <Error> — the body is always inspected. */
  async copyFrom(sourceBucket: string, sourceKey: string, destKey: string): Promise<{ etag: string | null }> {
    const copySource = `/${sourceBucket}/${sourceKey.split("/").map(enc).join("/")}`;
    const res = await this.request("PUT", destKey, { headers: { "x-amz-copy-source": copySource } });
    const text = await res.text().catch(() => "");
    const err = text ? parseS3Error(text) : null;
    if (err) throw new Error(`S3 CopyObject failed (${res.status}): ${err.code}: ${err.message}`);
    if (!res.ok) throw new Error(`S3 CopyObject failed (${res.status})`);
    return { etag: stripEtagQuotes(text ? xmlTag(text, "ETag") : null) };
  }

  async list(prefix: string, opts: { limit?: number; continuationToken?: string } = {}): Promise<{ objects: S3ListedObject[]; isTruncated: boolean; nextContinuationToken: string | null }> {
    const query: Record<string, string> = { "list-type": "2", prefix };
    if (opts.limit) query["max-keys"] = String(Math.min(Math.max(opts.limit, 1), 1000));
    if (opts.continuationToken) query["continuation-token"] = opts.continuationToken;
    const res = await this.request("GET", "", { query });
    if (!res.ok) await this.fail(res, "ListObjectsV2");
    return parseListObjectsV2(await res.text());
  }

  async createMultipartUpload(key: string, contentType: string): Promise<{ uploadId: string; key: string; bucket: string }> {
    const res = await this.request("POST", key, { query: { uploads: "" }, contentType });
    if (!res.ok) await this.fail(res, "CreateMultipartUpload");
    const parsed = parseInitiateMultipartUpload(await res.text());
    return { uploadId: parsed.uploadId, key: parsed.key ?? key, bucket: parsed.bucket ?? this.bucket };
  }

  /** Presigned PUT URL for one multipart part. */
  presignPart(key: string, uploadId: string, partNumber: number, ttlSeconds?: number): string {
    return this.presign("PUT", key, { ttlSeconds, query: { partNumber: String(partNumber), uploadId } });
  }

  async completeMultipartUpload(key: string, uploadId: string, parts: CompletedPart[]): Promise<{ etag: string | null }> {
    const res = await this.request("POST", key, {
      query: { uploadId },
      body: buildCompleteMultipartUploadXml(parts),
      contentType: "application/xml",
    });
    const text = await res.text().catch(() => "");
    // S3 can return HTTP 200 with an embedded <Error> here.
    const err = text ? parseS3Error(text) : null;
    if (err) throw new Error(`S3 CompleteMultipartUpload failed (${res.status}): ${err.code}: ${err.message}`);
    if (!res.ok) throw new Error(`S3 CompleteMultipartUpload failed (${res.status})`);
    return { etag: stripEtagQuotes(text ? xmlTag(text, "ETag") : null) };
  }

  async abortMultipartUpload(key: string, uploadId: string): Promise<void> {
    const res = await this.request("DELETE", key, { query: { uploadId } });
    if (!res.ok && res.status !== 404) await this.fail(res, "AbortMultipartUpload");
  }
}
