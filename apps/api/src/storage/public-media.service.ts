import { Injectable, Optional } from "@nestjs/common";
import { StorageService } from "./storage.service";
import { StorageRegistryService } from "./storage-registry.service";
import { publicMediaUrl } from "./media-url";

export interface PublicMediaAssetRef {
  organizationId: string;
  storageKey: string;
  contentType: string;
  sizeBytes?: number | null;
  createdById?: string | null;
}

/**
 * RB4/RM5 — the ONE async path that turns an object a surface
 * stored privately (MediaStore's bucket, which is StorageService's
 * "private" bucket in every supported deploy configuration) into
 * a publicly fetchable CDN URL:
 *
 *   1. local mode (no R2/S3 configured) -> null. Callers fall back
 *      to the pre-R2 behaviour (the API-streamed /public/media
 *      token route); a CDN URL is never fabricated.
 *   2. s3 mode -> the bytes are ENSURED in the public bucket
 *      (HEAD first; a cross-bucket copy only when missing), the
 *      object is registered in StoredFile under the caller's
 *      surface, and the CDN URL is returned.
 *   3. any storage failure -> null, never a URL that would 404.
 *
 * Registry bookkeeping is best-effort: a registry outage must not
 * break publishing, and the register call is an idempotent
 * upsert on the key, so a later resolve corrects the row.
 */
@Injectable()
export class PublicMediaService {
  constructor(
    private readonly storage: StorageService,
    @Optional() private readonly registry?: StorageRegistryService,
  ) {}

  /** True when a CDN URL can really be served (object storage). */
  get servingEnabled(): boolean {
    return this.storage.mode === "s3";
  }

  async resolvePublicMediaUrl(asset: PublicMediaAssetRef, surface: string): Promise<string | null> {
    if (!asset?.storageKey || this.storage.mode !== "s3") return null;
    const key = asset.storageKey;
    let head = await this.storage.head("public", key).catch(() => null);
    if (!head) {
      const copied = await this.storage
        .copy({ visibility: "private", key }, { visibility: "public", key })
        .then(() => true)
        .catch(() => false);
      if (!copied) return null;
      head = await this.storage.head("public", key).catch(() => null);
      if (!head) return null;
    }
    if (this.registry) {
      await this.registry
        .register({
          organizationId: asset.organizationId,
          bucket: this.storage.bucketFor("public"),
          key,
          visibility: "public",
          surface,
          contentType: asset.contentType,
          sizeBytes: head.sizeBytes ?? asset.sizeBytes ?? 0,
          status: "active",
          createdById: asset.createdById ?? null,
          sourceRef: null,
        })
        .catch(() => undefined);
    }
    return publicMediaUrl(key);
  }
}
