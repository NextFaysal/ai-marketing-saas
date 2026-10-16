import { BadRequestException, Injectable, Optional } from "@nestjs/common";
import { createHash } from "node:crypto";
import { PrismaService } from "../prisma/prisma.service";
import { MediaStore } from "../inbox/media-store";
import { StorageService, defaultVisibilityForSurface, type StorageVisibility } from "./storage.service";
import { StorageRegistryService } from "./storage-registry.service";
import { mediaKeyFromCdnUrl } from "./media-url";

/**
 * RM10 — the legacy local-media migration tool (platform admin
 * only; the controller carries the SuperAdminGuard).
 *
 * The situation it fixes: before the R2 env was set, MediaStore
 * ran in LOCAL mode and media bytes accumulated in a folder on
 * the API host, while the DATABASE rows (MediaAsset,
 * ChannelMessage, Organization logos, local-mode StoredFile
 * rows) recorded the keys. Flipping the env switches READS to
 * the bucket — but the bytes are not there yet.
 *
 * Why copying under the SAME key is enough: local and S3 modes
 * of MediaStore address objects by the identical key, and every
 * reader (inbox proxy/signed URL, social public links, branding
 * route, StorageService surfaces) resolves through that key.
 * So migration = for each DB-known key: read the local bytes,
 * PUT them to the visibility's bucket under the same key,
 * read back and compare sha256, then register the StoredFile
 * row (idempotent upsert — re-running is safe and already-
 * migrated keys are skipped by a HEAD check).
 *
 * Nothing local is deleted here: the plan keeps the local copy
 * for at least one release cycle after verification. Product
 * EXTERNAL urls are NOT this tool's job — RM4's mirror endpoint
 * (products/images/mirror-external) already owns those.
 */

export interface MediaMigrationItem {
  key: string;
  organizationId: string | null;
  surface: string;
  visibility: StorageVisibility;
  contentType: string | null;
  sizeBytes: number | null;
  sourceRef: string | null;
}

export const MEDIA_MIGRATION_DEFAULT_BATCH = 100;
export const MEDIA_MIGRATION_MAX_BATCH = 500;

@Injectable()
export class MediaMigrationService {
  private _localReader: MediaStore | null = null;

  constructor(
    private readonly prisma: PrismaService,
    private readonly storage: StorageService,
    private readonly registry: StorageRegistryService,
    // Same seam style as InboxService/ProductRecognitionService:
    // specs inject a fake; production lazily builds a LOCAL-only
    // reader (no bucket in the config => local mode by
    // construction, whatever the deployment's read mode is).
    @Optional() private readonly localReaderOverride?: MediaStore,
  ) {}

  private localReader(): MediaStore {
    if (this.localReaderOverride) return this.localReaderOverride;
    if (!this._localReader) {
      this._localReader = new MediaStore({ localDir: process.env.MEDIA_LOCAL_DIR });
    }
    return this._localReader;
  }

  private t(name: string): any {
    return (this.prisma as any)[name];
  }

  /**
   * Every storage key the database knows about, assembled from
   * the surfaces' own rows — counted honestly from real rows,
   * never estimated. Deduped by key (first surface wins).
   */
  async collectInventory(): Promise<MediaMigrationItem[]> {
    const items: MediaMigrationItem[] = [];
    const seen = new Set<string>();
    const push = (item: MediaMigrationItem) => {
      if (!item.key || seen.has(item.key)) return;
      seen.add(item.key);
      items.push(item);
    };

    // Social library assets (MediaStore keys, public surface).
    const assets: any[] = (await this.t("mediaAsset")?.findMany({}).catch(() => [])) ?? [];
    for (const a of assets) {
      if (!a?.storageKey) continue;
      push({
        key: String(a.storageKey),
        organizationId: a.organizationId ?? null,
        surface: "social",
        visibility: "public",
        contentType: a.contentType ?? null,
        sizeBytes: a.sizeBytes != null ? Number(a.sizeBytes) : null,
        sourceRef: `mediaAsset:${a.id}`,
      });
    }

    // Inbox attachments (private). ChannelMessage carries no
    // organizationId — it resolves through its conversation.
    const messages: any[] =
      (await this.t("channelMessage")?.findMany({ where: { mediaStorageKey: { not: null } } }).catch(() => [])) ?? [];
    const convIds = [...new Set(messages.map((m: any) => m?.conversationId).filter(Boolean))];
    const convOrg = new Map<string, string>();
    if (convIds.length) {
      const convs: any[] =
        (await this.t("channelConversation")?.findMany({ where: { id: { in: convIds } } }).catch(() => [])) ?? [];
      for (const c of convs) if (c?.id && c?.organizationId) convOrg.set(String(c.id), String(c.organizationId));
    }
    for (const m of messages) {
      if (!m?.mediaStorageKey) continue;
      push({
        key: String(m.mediaStorageKey),
        organizationId: convOrg.get(String(m.conversationId)) ?? null,
        surface: "inbox",
        visibility: "private",
        contentType: m.mediaContentType ?? null,
        sizeBytes: m.mediaSizeBytes != null ? Number(m.mediaSizeBytes) : null,
        sourceRef: `channelMessage:${m.id}`,
      });
    }

    // Org logos: the row stores a URL/path, not a key — derive
    // the key the same two ways the branding code writes it
    // (CDN URL from a hash-versioned key, or the legacy fixed
    // key behind /public/branding/:orgId/logo).
    const orgs: any[] =
      (await this.t("organization")?.findMany({ where: { logoUrl: { not: null } } }).catch(() => [])) ?? [];
    for (const o of orgs) {
      const logoUrl = String(o?.logoUrl ?? "");
      if (!logoUrl) continue;
      const key = mediaKeyFromCdnUrl(logoUrl) ?? (logoUrl === `/public/branding/${o.id}/logo` ? `branding/${o.id}/logo` : null);
      if (!key) continue;
      push({
        key,
        organizationId: o.id ?? null,
        surface: "branding",
        visibility: "public",
        contentType: null,
        sizeBytes: null,
        sourceRef: `organization:${o.id}`,
      });
    }

    // Registry rows written while storage was in local mode:
    // their objects sit in the local folder under the final key;
    // migration moves the bytes and re-points the row's bucket.
    const localRows: any[] =
      (await this.t("storedFile")?.findMany({ where: { bucket: "local", status: { not: "trashed" } } }).catch(() => [])) ?? [];
    for (const r of localRows) {
      if (!r?.key) continue;
      push({
        key: String(r.key),
        organizationId: r.organizationId ?? null,
        surface: String(r.surface ?? "other"),
        visibility: (r.visibility === "public" ? "public" : "private") as StorageVisibility,
        contentType: r.contentType ?? null,
        sizeBytes: r.sizeBytes != null ? Number(r.sizeBytes) : null,
        sourceRef: r.sourceRef ?? `storedFile:${r.id}`,
      });
    }

    return items;
  }

  /** Read-only inventory: what the DB knows, grouped by surface.
   * Does no per-key storage probing — run() reports the real
   * per-key outcomes. Sizes the source rows never recorded are
   * counted as unknown, never guessed. */
  async scan() {
    const items = await this.collectInventory();
    const bySurface: Record<string, { keys: number; knownBytes: string; unknownSizeCount: number }> = {};
    let knownBytes = 0n;
    let unknownSizeCount = 0;
    for (const item of items) {
      const s = (bySurface[item.surface] ??= { keys: 0, knownBytes: "0", unknownSizeCount: 0 });
      s.keys += 1;
      if (item.sizeBytes != null) {
        knownBytes += BigInt(item.sizeBytes);
        s.knownBytes = (BigInt(s.knownBytes) + BigInt(item.sizeBytes)).toString();
      } else {
        unknownSizeCount += 1;
        s.unknownSizeCount += 1;
      }
    }
    return {
      storageMode: this.storage?.mode ?? "local",
      totalKeys: items.length,
      knownBytes: knownBytes.toString(),
      unknownSizeCount,
      bySurface,
      note:
        "Inventory is assembled from database rows (MediaAsset, ChannelMessage, Organization logos, local-mode StoredFile). " +
        "Product images that exist only as external URLs are not storage keys — mirror them via the RM4 products/images/mirror-external endpoint.",
    };
  }

  async run(dto: { batchSize?: number } = {}) {
    if (!this.storage || this.storage.mode !== "s3") {
      throw new BadRequestException(
        "মাইগ্রেশন চালানো যাচ্ছে না — object storage (Cloudflare R2) সেটআপ হয়নি, কপি করার গন্তব্যই নেই। আগে MEDIA_S3_*/MEDIA_R2_* env বসান।",
      );
    }
    const batchSize = Math.min(
      MEDIA_MIGRATION_MAX_BATCH,
      Math.max(1, Math.floor(Number(dto?.batchSize ?? MEDIA_MIGRATION_DEFAULT_BATCH)) || MEDIA_MIGRATION_DEFAULT_BATCH),
    );
    const items = await this.collectInventory();
    const batch = items.slice(0, batchSize);
    let copied = 0;
    let skipped = 0;
    const failed: { key: string; reason: string }[] = [];

    for (const item of batch) {
      try {
        if (!item.organizationId) {
          failed.push({ key: item.key, reason: "organization জানা যায়নি — registry-তে নথিভুক্ত করা যাবে না" });
          continue;
        }
        const visibility = item.visibility ?? defaultVisibilityForSurface(item.surface);
        const head = await this.storage.head(visibility, item.key).catch(() => null);
        if (head) {
          // Already in the bucket: just make sure the registry
          // knows it (idempotent) and count it as skipped.
          await this.registry.register({
            organizationId: item.organizationId,
            bucket: this.storage.bucketFor(visibility),
            key: item.key,
            visibility,
            surface: item.surface,
            contentType: item.contentType ?? head.contentType ?? "application/octet-stream",
            sizeBytes: head.sizeBytes ?? item.sizeBytes ?? 0,
            status: "active",
            sourceRef: item.sourceRef,
          });
          skipped += 1;
          continue;
        }
        const bytes = await this.localReader().get(item.key).catch(() => null);
        if (!bytes) {
          failed.push({ key: item.key, reason: "লোকাল ফাইল পাওয়া যায়নি" });
          continue;
        }
        const contentType = item.contentType ?? "application/octet-stream";
        const sha256 = createHash("sha256").update(bytes).digest("hex");
        await this.storage.put(visibility, item.key, bytes, contentType);
        const back = await this.storage.get(visibility, item.key).catch(() => null);
        const backSha = back ? createHash("sha256").update(back).digest("hex") : null;
        if (backSha !== sha256) {
          await this.storage.delete(visibility, item.key).catch(() => undefined);
          failed.push({ key: item.key, reason: "কপির পর sha256 মেলেনি — কপি মোছা হয়েছে" });
          continue;
        }
        await this.registry.register({
          organizationId: item.organizationId,
          bucket: this.storage.bucketFor(visibility),
          key: item.key,
          visibility,
          surface: item.surface,
          contentType,
          sizeBytes: bytes.length,
          sha256,
          status: "active",
          sourceRef: item.sourceRef,
        });
        copied += 1;
      } catch (e) {
        failed.push({ key: item.key, reason: e instanceof Error ? e.message : String(e) });
      }
    }

    return {
      copied,
      skipped,
      failed,
      processed: batch.length,
      remaining: Math.max(0, items.length - batch.length),
      totalKnown: items.length,
    };
  }
}
