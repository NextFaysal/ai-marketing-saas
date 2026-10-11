import { createHash, createHmac } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";

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

  private async s3Fetch(method: string, key: string, bytes?: Buffer, contentType?: string): Promise<Response> {
    const now = new Date();
    const amzDate = now.toISOString().replace(/[-:]/g, "").replace(/\.\d{3}/, "");
    const dateStamp = amzDate.slice(0, 8);
    const scope = `${dateStamp}/${this.cfg.region}/s3/aws4_request`;
    const payloadHash = sha256(bytes ?? "");
    const headers: Record<string, string> = {
      host: this.host(), "x-amz-content-sha256": payloadHash, "x-amz-date": amzDate,
      ...(contentType ? { "content-type": contentType } : {}),
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
}

export function mediaKeyFor(organizationId: string, messageId: string, contentType: string): string {
  const now = new Date();
  const ym = `${now.getUTCFullYear()}-${String(now.getUTCMonth() + 1).padStart(2, "0")}`;
  const ext = contentType.includes("png") ? "png" : contentType.includes("jpeg") || contentType.includes("jpg") ? "jpg"
    : contentType.includes("ogg") ? "ogg" : contentType.includes("mp4") ? "mp4"
    : contentType.includes("pdf") ? "pdf" : contentType.includes("webp") ? "webp" : "bin";
  return `${organizationId}/${ym}/${messageId}.${ext}`;
}
