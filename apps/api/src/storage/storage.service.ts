import { Injectable } from "@nestjs/common";
import { copyFile, mkdir, readFile, readdir, stat, unlink, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { randomBytes } from "node:crypto";
import { S3ObjectStore, type CompletedPart, type ObjectHead } from "./s3-object-store";

/**
 * RM2 — StorageService: the two-bucket storage layer for the R2
 * media program, sitting NEXT TO (not replacing) the inbox
 * MediaStore. Existing call sites keep using MediaStore untouched;
 * new surfaces (RM4+) build on this service.
 *
 * Buckets (env):
 *  - MEDIA_R2_PRIVATE_BUCKET — private bucket (inbox, digital, docs)
 *  - MEDIA_R2_PUBLIC_BUCKET  — public bucket (product, social, …)
 *  - MEDIA_S3_BUCKET         — legacy single bucket from RB1; when
 *    the R2 pair is absent it IS the private/default bucket, and the
 *    public visibility falls back to it too, so an RB1 deployment
 *    behaves exactly as before until the owner sets the pair.
 * Endpoint/credentials stay the MEDIA_S3_* set from RB1 — one R2
 * account serves both buckets.
 *
 * Modes: "s3" when a bucket and both credentials are configured,
 * "local" otherwise (dev fallback, same spirit as MediaStore).
 * In local mode both visibilities share ONE local folder and the
 * visibility is only recorded metadata (registry rows) — there is
 * no on-disk separation, and presigned URLs return null exactly as
 * MediaStore.signedUrl does today; callers fall back to the API
 * proxy. Multipart is the one hard exception: it does not exist in
 * local mode and throws a clear error instead of pretending.
 */

export type StorageVisibility = "public" | "private";

export interface StorageConfig {
  endpoint?: string;
  region?: string;
  accessKeyId?: string;
  secretAccessKey?: string;
  publicBucket?: string;
  privateBucket?: string;
  /** RB6/RM11: optional third bucket receiving registry
   * snapshots + copies of fresh private objects from the
   * lifecycle sweep (R2 has no versioning — a separate bucket
   * is the only accidental-delete protection). */
  backupBucket?: string;
  localDir?: string;
}

export interface StorageListResult {
  objects: { key: string; sizeBytes: number | null; etag: string | null; lastModified: string | null }[];
  truncated: boolean;
  nextCursor: string | null;
}

export interface StorageHealth {
  mode: "s3" | "local";
  /** True only when the probe ran against real object storage. */
  objectStorage: boolean;
  visibility: StorageVisibility;
  bucket: string | null;
  ok: boolean;
  steps: { put: boolean; head: boolean; delete: boolean };
  error: string | null;
  checkedAt: string;
  note: string;
}

/** The per-surface default visibility table (plan RM2). Anything
 * customer-private by nature is private; anything the public web
 * must fetch directly is public. Unknown surfaces default private. */
export const SURFACE_VISIBILITY: Record<string, StorageVisibility> = {
  product: "public",
  social: "public",
  branding: "public",
  creative: "public",
  review: "public",
  inbox: "private",
  digital: "private",
  document: "private",
  other: "private",
};

export function defaultVisibilityForSurface(surface: string): StorageVisibility {
  return SURFACE_VISIBILITY[surface] ?? "private";
}

const MULTIPART_LOCAL_ERROR =
  "Multipart upload requires S3-compatible object storage; local-disk mode does not support it. Set MEDIA_R2_PRIVATE_BUCKET / MEDIA_R2_PUBLIC_BUCKET (or MEDIA_S3_BUCKET) with the MEDIA_S3_* credentials to enable it.";

interface ResolvedStorage {
  mode: "s3" | "local";
  endpoint?: string;
  region: string;
  publicBucket: string;
  privateBucket: string;
  backupBucket: string;
  localDir: string;
  stores: Record<StorageVisibility, S3ObjectStore | null>;
  backupStore: S3ObjectStore | null;
}

function resolveStorage(cfg: StorageConfig): ResolvedStorage {
  const endpoint = cfg.endpoint;
  const region = cfg.region ?? "auto";
  const accessKeyId = cfg.accessKeyId ?? "";
  const secretAccessKey = cfg.secretAccessKey ?? "";
  const privateBucket = cfg.privateBucket ?? "";
  // Single-bucket deployments (RB1) keep working: public-intent
  // objects land in the one configured bucket until the owner
  // sets the dedicated public bucket.
  const publicBucket = cfg.publicBucket ?? privateBucket;
  const localDir = cfg.localDir ?? join(process.cwd(), "..", ".media-store");
  const mode: "s3" | "local" =
    (privateBucket || publicBucket) && accessKeyId && secretAccessKey ? "s3" : "local";
  const backupBucket = cfg.backupBucket ?? "";
  const mk = (bucket: string): S3ObjectStore | null =>
    mode === "s3" && bucket
      ? new S3ObjectStore({ bucket, endpoint, region, accessKeyId, secretAccessKey })
      : null;
  return {
    mode,
    endpoint,
    region,
    publicBucket,
    privateBucket,
    backupBucket,
    localDir,
    stores: { private: mk(privateBucket), public: mk(publicBucket) },
    backupStore: mk(backupBucket),
  };
}

@Injectable()
export class StorageService {
  readonly mode: "s3" | "local";
  private readonly publicBucket: string;
  private readonly privateBucket: string;
  private readonly backupBucketName: string;
  private readonly localDir: string;
  private readonly stores: Record<StorageVisibility, S3ObjectStore | null>;
  private readonly backupStore: S3ObjectStore | null;

  constructor() {
    const r = resolveStorage(StorageService.envConfig());
    this.mode = r.mode;
    this.publicBucket = r.publicBucket;
    this.privateBucket = r.privateBucket;
    this.backupBucketName = r.backupBucket;
    this.localDir = r.localDir;
    this.stores = r.stores;
    this.backupStore = r.backupStore;
  }

  static envConfig(): StorageConfig {
    return {
      endpoint: process.env.MEDIA_S3_ENDPOINT,
      region: process.env.MEDIA_S3_REGION,
      accessKeyId: process.env.MEDIA_S3_ACCESS_KEY_ID,
      secretAccessKey: process.env.MEDIA_S3_SECRET_ACCESS_KEY,
      publicBucket: process.env.MEDIA_R2_PUBLIC_BUCKET,
      privateBucket: process.env.MEDIA_R2_PRIVATE_BUCKET ?? process.env.MEDIA_S3_BUCKET,
      backupBucket: process.env.MEDIA_R2_BACKUP_BUCKET,
      localDir: process.env.MEDIA_LOCAL_DIR,
    };
  }

  /** Test/embedding factory with an explicit config (no env). */
  static withConfig(cfg: StorageConfig): StorageService {
    const svc = Object.create(StorageService.prototype) as StorageService;
    const r = resolveStorage(cfg);
    Object.assign(svc, {
      mode: r.mode,
      publicBucket: r.publicBucket,
      privateBucket: r.privateBucket,
      backupBucketName: r.backupBucket,
      localDir: r.localDir,
      stores: r.stores,
      backupStore: r.backupStore,
    });
    return svc;
  }

  // ---------- RM11 backup bucket (optional third bucket) ------

  /** The configured backup bucket name, or null when backups are
   * not configured (env unset OR local mode — a local folder is
   * not a backup target and is never dressed up as one). */
  backupBucket(): string | null {
    return this.backupStore ? this.backupBucketName : null;
  }

  /** PUT an object into the backup bucket. False when backups
   * are not configured — the caller reports "not-configured",
   * never a fake success. */
  async putBackupObject(key: string, bytes: Buffer, contentType: string): Promise<boolean> {
    if (!this.backupStore) return false;
    await this.backupStore.put(key, bytes, contentType);
    return true;
  }

  /** Copy an object from a visibility bucket into the backup
   * bucket under `toKey`. False when backups are not configured. */
  async copyToBackupObject(from: { visibility: StorageVisibility; key: string }, toKey: string): Promise<boolean> {
    if (!this.backupStore) return false;
    await this.backupStore.copyFrom(this.bucketFor(from.visibility), from.key, toKey);
    return true;
  }

  /** The bucket an operation for this visibility will hit ("local"
   * in local-disk mode, where the registry records the same label). */
  bucketFor(visibility: StorageVisibility): string {
    if (this.mode !== "s3") return "local";
    return visibility === "public" ? this.publicBucket : this.privateBucket;
  }

  private store(visibility: StorageVisibility): S3ObjectStore {
    const s = this.stores[visibility];
    if (!s) throw new Error(`No object store configured for visibility "${visibility}" (mode=${this.mode})`);
    return s;
  }

  private localPath(key: string): string {
    return join(this.localDir, key);
  }

  // ---------- basic object operations ----------

  async put(visibility: StorageVisibility, key: string, bytes: Buffer, contentType: string): Promise<void> {
    if (this.mode === "s3") return this.store(visibility).put(key, bytes, contentType);
    const file = this.localPath(key);
    await mkdir(dirname(file), { recursive: true });
    await writeFile(file, bytes);
  }

  async get(visibility: StorageVisibility, key: string): Promise<Buffer | null> {
    if (this.mode === "s3") return this.store(visibility).get(key);
    try {
      return await readFile(this.localPath(key));
    } catch {
      return null;
    }
  }

  async delete(visibility: StorageVisibility, key: string): Promise<void> {
    if (this.mode === "s3") return this.store(visibility).delete(key);
    await unlink(this.localPath(key)).catch(() => undefined);
  }

  /** HEAD metadata. In local mode contentType/etag are null — the
   * local folder never recorded them; size and mtime are real. */
  async head(visibility: StorageVisibility, key: string): Promise<ObjectHead | null> {
    if (this.mode === "s3") return this.store(visibility).head(key);
    try {
      const st = await stat(this.localPath(key));
      return { sizeBytes: st.size, contentType: null, etag: null, lastModified: st.mtime.toISOString(), metadata: {} };
    } catch {
      return null;
    }
  }

  async deleteMany(visibility: StorageVisibility, keys: string[]): Promise<{ deleted: string[]; errors: { key: string; code: string; message: string }[] }> {
    if (this.mode === "s3") return this.store(visibility).deleteMany(keys);
    const deleted: string[] = [];
    const errors: { key: string; code: string; message: string }[] = [];
    for (const key of keys) {
      try {
        await unlink(this.localPath(key));
        deleted.push(key);
      } catch (e: any) {
        if (e?.code === "ENOENT") deleted.push(key); // already gone = deleted
        else errors.push({ key, code: e?.code ?? "Error", message: e?.message ?? String(e) });
      }
    }
    return { deleted, errors };
  }

  /** Copy an object (possibly across buckets/visibilities in s3
   * mode; a plain file copy in local mode, where both visibilities
   * share the folder — copying public->private locally therefore
   * changes only the registry's recorded visibility, not the bytes'
   * location; the service reports exactly that by succeeding). */
  async copy(
    from: { visibility: StorageVisibility; key: string },
    to: { visibility: StorageVisibility; key: string },
  ): Promise<{ etag: string | null }> {
    if (this.mode === "s3") {
      return this.store(to.visibility).copyFrom(this.bucketFor(from.visibility), from.key, to.key);
    }
    const dest = this.localPath(to.key);
    await mkdir(dirname(dest), { recursive: true });
    await copyFile(this.localPath(from.key), dest);
    return { etag: null };
  }

  async list(visibility: StorageVisibility, prefix: string, opts: { limit?: number; cursor?: string } = {}): Promise<StorageListResult> {
    if (this.mode === "s3") {
      const res = await this.store(visibility).list(prefix, { limit: opts.limit, continuationToken: opts.cursor });
      return { objects: res.objects, truncated: res.isTruncated, nextCursor: res.nextContinuationToken };
    }
    const limit = opts.limit ?? 1000;
    const all: StorageListResult["objects"] = [];
    const walk = async (dir: string, rel: string): Promise<void> => {
      const entries = await readdir(dir, { withFileTypes: true }).catch(() => null);
      if (!entries) return;
      for (const entry of entries) {
        const childRel = rel ? `${rel}/${entry.name}` : entry.name;
        if (entry.isDirectory()) await walk(join(dir, entry.name), childRel);
        else if (childRel.startsWith(prefix)) {
          const st = await stat(join(dir, entry.name)).catch(() => null);
          if (st) all.push({ key: childRel, sizeBytes: st.size, etag: null, lastModified: st.mtime.toISOString() });
        }
      }
    };
    await walk(this.localDir, "");
    all.sort((a, b) => (a.key < b.key ? -1 : a.key > b.key ? 1 : 0));
    return { objects: all.slice(0, limit), truncated: all.length > limit, nextCursor: null };
  }

  // ---------- presigned URLs (null in local mode) ----------

  /** Presigned GET URL, or null in local mode (callers fall back to
   * the authenticated API proxy, exactly as with MediaStore). */
  signedGetUrl(visibility: StorageVisibility, key: string, ttlSeconds = 900): string | null {
    if (this.mode !== "s3") return null;
    return this.store(visibility).presign("GET", key, { ttlSeconds });
  }

  /** Presigned PUT URL for a direct browser→R2 upload (the plan
   * §1.3 quarantine flow starts here), or null in local mode. */
  presignedPutUrl(visibility: StorageVisibility, key: string, opts: { ttlSeconds?: number } = {}): string | null {
    if (this.mode !== "s3") return null;
    return this.store(visibility).presign("PUT", key, { ttlSeconds: opts.ttlSeconds ?? 600 });
  }

  // ---------- multipart (s3 mode only) ----------

  async createMultipartUpload(visibility: StorageVisibility, key: string, contentType: string): Promise<{ uploadId: string; key: string; bucket: string }> {
    if (this.mode !== "s3") throw new Error(MULTIPART_LOCAL_ERROR);
    return this.store(visibility).createMultipartUpload(key, contentType);
  }

  /** Presigned PUT URL for one part. Multipart cannot start in
   * local mode (create throws), so asking for a part URL there is a
   * programming error and throws the same clear message. */
  presignPartUrl(visibility: StorageVisibility, key: string, uploadId: string, partNumber: number, ttlSeconds?: number): string {
    if (this.mode !== "s3") throw new Error(MULTIPART_LOCAL_ERROR);
    return this.store(visibility).presignPart(key, uploadId, partNumber, ttlSeconds);
  }

  async completeMultipartUpload(visibility: StorageVisibility, key: string, uploadId: string, parts: CompletedPart[]): Promise<{ etag: string | null }> {
    if (this.mode !== "s3") throw new Error(MULTIPART_LOCAL_ERROR);
    return this.store(visibility).completeMultipartUpload(key, uploadId, parts);
  }

  async abortMultipartUpload(visibility: StorageVisibility, key: string, uploadId: string): Promise<void> {
    if (this.mode !== "s3") throw new Error(MULTIPART_LOCAL_ERROR);
    return this.store(visibility).abortMultipartUpload(key, uploadId);
  }

  // ---------- health probe ----------

  /**
   * A REAL probe, never a fabricated "connected": writes a tiny
   * probe object, HEADs it back and checks the size, then deletes
   * it. In local mode the same probe runs against the local folder
   * and the result says so plainly (objectStorage=false) — a green
   * local probe must never be read as "R2 is working".
   */
  async health(visibility: StorageVisibility = "private"): Promise<StorageHealth> {
    const checkedAt = new Date().toISOString();
    const key = `_probe/health-${Date.now()}-${randomBytes(4).toString("hex")}.txt`;
    const payload = Buffer.from("qosprey storage health probe");
    const steps = { put: false, head: false, delete: false };
    let error: string | null = null;
    try {
      await this.put(visibility, key, payload, "text/plain");
      steps.put = true;
      const head = await this.head(visibility, key);
      steps.head = Boolean(head && head.sizeBytes === payload.length);
      if (!steps.head) throw new Error(`HEAD after PUT did not return the probe size (${head?.sizeBytes ?? "null"} != ${payload.length})`);
    } catch (e) {
      error = e instanceof Error ? e.message : String(e);
    } finally {
      await this.delete(visibility, key).catch(() => undefined);
      const stillThere = await this.head(visibility, key).catch(() => null);
      steps.delete = stillThere === null;
      if (!steps.delete && !error) error = "Probe object still present after delete";
    }
    const ok = steps.put && steps.head && steps.delete;
    return {
      mode: this.mode,
      objectStorage: this.mode === "s3",
      visibility,
      bucket: this.mode === "s3" ? this.bucketFor(visibility) : null,
      ok,
      steps,
      error: ok ? null : error,
      checkedAt,
      note:
        this.mode === "s3"
          ? "Real PUT -> HEAD -> DELETE probe against the configured bucket."
          : "LOCAL DISK MODE: the probe ran against the local media folder only. This is NOT durable object storage - set the MEDIA bucket env (R2) before trusting it.",
    };
  }
}
