import { BadRequestException, Injectable, NotFoundException, Optional } from "@nestjs/common";
import { createHash, randomUUID } from "node:crypto";
import { PrismaService } from "../prisma/prisma.service";
import { AuditService } from "../audit/audit.service";
import { StorageService, type StorageVisibility } from "./storage.service";
import { StorageRegistryService } from "./storage-registry.service";
import { imageExtForContentType, publicMediaUrl } from "./media-url";
import { detectMediaKind } from "../inbox/media-sniff";

/**
 * RM7 — the unified media library: ONE read model over the RM3
 * StoredFile registry, so every surface's files (product, social,
 * branding, creative, inbox, library uploads…) show up in a single
 * dashboard grid. This service reads the registry; it never reaches
 * into the owning surfaces' own tables, and it never invents a URL:
 *
 *  - public rows  -> the CDN URL (publicMediaUrl) — but only when
 *    object storage is actually configured; in local mode there is
 *    no public URL to hand out, so url is null, honestly.
 *  - private rows -> a short-lived presigned GET from StorageService
 *    (null in local mode for the same reason).
 *  - trashed rows are never listed (status must be "active").
 *
 * Uploads follow the RB3/RM4 pattern exactly: presign a quarantine
 * PUT -> the browser uploads straight to R2 -> complete verifies
 * (HEAD size, magic-byte sniff) -> copy to the immutable final key
 * -> register -> drop the quarantine object. Any failure removes
 * what it created; there is no partial state.
 *
 * Trash is a registry status flip only (StorageRegistryService.
 * markTrashed). The object itself is deleted later by RM11's
 * lifecycle job — never here.
 */

export const MEDIA_LIBRARY_UPLOAD_MAX_BYTES = 10 * 1024 * 1024;
export const MEDIA_LIBRARY_UPLOAD_CONTENT_TYPES = ["image/png", "image/jpeg", "image/webp"] as const;

const MEDIA_LIBRARY_KINDS = ["image", "video", "file"] as const;
export type MediaLibraryKind = (typeof MEDIA_LIBRARY_KINDS)[number];

export interface MediaLibraryListQuery {
  surface?: string;
  kind?: string;
  q?: string;
  page?: number;
  pageSize?: number;
}

@Injectable()
export class MediaLibraryService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly storage: StorageService,
    private readonly registry: StorageRegistryService,
    @Optional() private readonly audit?: AuditService,
  ) {}

  private table(): any {
    return (this.prisma as any).storedFile;
  }

  /** The DTO the dashboard grid consumes. sizeBytes is a decimal
   * string (BigInt-safe); url follows the rules in the header. */
  private toDto(row: any): any {
    let url: string | null = null;
    if (row && this.storage && this.storage.mode === "s3") {
      if (row.visibility === "public") {
        url = publicMediaUrl(row.key);
      } else {
        url = this.storage.signedGetUrl((row.visibility as StorageVisibility) ?? "private", row.key, 900);
      }
    }
    return {
      id: row.id,
      key: row.key,
      surface: row.surface,
      visibility: row.visibility,
      contentType: row.contentType,
      sizeBytes: row.sizeBytes != null ? BigInt(row.sizeBytes).toString() : "0",
      width: row.width ?? null,
      height: row.height ?? null,
      createdAt: row.createdAt,
      url,
    };
  }

  async list(organizationId: string, query: MediaLibraryListQuery = {}) {
    const page = Math.max(1, Math.floor(query.page ?? 1) || 1);
    const pageSize = Math.min(100, Math.max(1, Math.floor(query.pageSize ?? 20) || 20));
    const where: any = { organizationId, status: "active" };
    if (query.surface) where.surface = String(query.surface);
    if (query.kind) {
      const kind = String(query.kind);
      if (!(MEDIA_LIBRARY_KINDS as readonly string[]).includes(kind)) {
        throw new BadRequestException("kind হতে হবে image, video অথবা file।");
      }
      if (kind === "image") where.contentType = { startsWith: "image/" };
      else if (kind === "video") where.contentType = { startsWith: "video/" };
      else {
        // "file" = anything that is neither an image nor a video.
        where.AND = [
          { contentType: { not: { startsWith: "image/" } } },
          { contentType: { not: { startsWith: "video/" } } },
        ];
      }
    }
    const q = String(query.q ?? "").trim();
    if (q) where.key = { contains: q, mode: "insensitive" };

    const [total, rows] = await Promise.all([
      this.table().count({ where }),
      this.table().findMany({
        where,
        orderBy: { createdAt: "desc" },
        skip: (page - 1) * pageSize,
        take: pageSize,
      }),
    ]);
    return { total, page, pageSize, items: (rows ?? []).map((r: any) => this.toDto(r)) };
  }

  // ---------- general upload (RB3 pattern, library surface) ----

  private storageOr400(): StorageService {
    if (!this.storage || this.storage.mode !== "s3") {
      throw new BadRequestException(
        "সরাসরি ফাইল আপলোড এখন চালু নেই — সার্ভারে object storage (Cloudflare R2) সেটআপ হয়নি।",
      );
    }
    return this.storage;
  }

  private normalizeUploadType(contentType: unknown): string {
    const ct = String(contentType ?? "").split(";")[0].trim().toLowerCase();
    if (!(MEDIA_LIBRARY_UPLOAD_CONTENT_TYPES as readonly string[]).includes(ct)) {
      throw new BadRequestException("শুধু PNG, JPEG অথবা WebP ছবি আপলোড করা যাবে।");
    }
    return ct;
  }

  private normalizeUploadSize(sizeBytes: unknown): number {
    const size = Number(sizeBytes);
    if (!Number.isInteger(size) || size < 1) {
      throw new BadRequestException("ফাইলের আকার (sizeBytes) সঠিক নয়।");
    }
    if (size > MEDIA_LIBRARY_UPLOAD_MAX_BYTES) {
      throw new BadRequestException("ফাইলটি অনেক বড় — সর্বোচ্চ ১০ MB পর্যন্ত আপলোড করা যাবে।");
    }
    return size;
  }

  async presignUpload(
    organizationId: string,
    actorId: string,
    dto: { fileName?: string; contentType: string; sizeBytes: number },
  ) {
    const contentType = this.normalizeUploadType(dto?.contentType);
    const sizeBytes = this.normalizeUploadSize(dto?.sizeBytes);
    const storage = this.storageOr400();
    const key = `_quarantine/${organizationId}/library/${randomUUID()}`;
    const uploadUrl = storage.presignedPutUrl("public", key);
    if (!uploadUrl) {
      throw new BadRequestException("আপলোডের URL তৈরি করা যায়নি — object storage সেটআপ যাচাই করুন।");
    }
    void actorId;
    return { uploadUrl, key, contentType, sizeBytes, expiresInSeconds: 600 };
  }

  async completeUpload(
    organizationId: string,
    actorId: string,
    dto: { key: string; contentType: string; sizeBytes: number },
  ) {
    const contentType = this.normalizeUploadType(dto?.contentType);
    const sizeBytes = this.normalizeUploadSize(dto?.sizeBytes);
    const storage = this.storageOr400();
    const key = String(dto?.key ?? "");
    const quarantinePrefix = `_quarantine/${organizationId}/library/`;
    if (!key.startsWith(quarantinePrefix) || key.includes("..") || key.includes("\\")) {
      throw new BadRequestException("আপলোডের key সঠিক নয় — presign থেকে পাওয়া key-ই পাঠাতে হবে।");
    }
    const dropQuarantine = () => storage.delete("public", key).catch(() => undefined);

    const head = await storage.head("public", key).catch(() => null);
    if (!head) {
      throw new BadRequestException("আপলোড করা ফাইলটি পাওয়া যায়নি — আবার আপলোড করুন।");
    }
    if (head.sizeBytes !== sizeBytes) {
      await dropQuarantine();
      throw new BadRequestException("আপলোড করা ফাইলের আকার ঘোষিত আকারের সঙ্গে মিলছে না — ফাইলটি মোছা হয়েছে।");
    }
    const bytes = await storage.get("public", key).catch(() => null);
    if (!bytes || bytes.length !== sizeBytes) {
      await dropQuarantine();
      throw new BadRequestException("আপলোড করা ফাইলটি পড়া যায়নি — ফাইলটি মোছা হয়েছে, আবার চেষ্টা করুন।");
    }
    // Magic bytes decide, never the declaration (same discipline
    // as RM4 product uploads and the inbox).
    const detected = detectMediaKind(bytes);
    if (!detected || detected.kind !== "image" || detected.contentType !== contentType) {
      await dropQuarantine();
      const what = detected ? detected.contentType : "অচেনা ফরম্যাটের ডেটা";
      throw new BadRequestException(`আপলোড করা ফাইলের আসল ফরম্যাট ঘোষিত টাইপের সঙ্গে মিলছে না (পাওয়া গেছে ${what}) — ফাইলটি মোছা হয়েছে।`);
    }

    const sha256 = createHash("sha256").update(bytes).digest("hex");
    const finalKey = `${organizationId}/library/${randomUUID()}.${imageExtForContentType(detected.contentType)}`;
    let registered = false;
    try {
      await storage.copy({ visibility: "public", key }, { visibility: "public", key: finalKey });
      const row = await this.registry.register({
        organizationId,
        bucket: storage.bucketFor("public"),
        key: finalKey,
        visibility: "public",
        surface: "library",
        contentType: detected.contentType,
        sizeBytes: bytes.length,
        sha256,
        status: "active",
        createdById: actorId,
        sourceRef: "mediaLibrary",
      });
      registered = true;
      await dropQuarantine();
      return this.toDto(row);
    } catch (e) {
      await storage.delete("public", finalKey).catch(() => undefined);
      if (registered) {
        await this.registry.markTrashed(organizationId, finalKey).catch(() => undefined);
      }
      await dropQuarantine();
      throw e;
    }
  }

  // ---------- trash (registry flip only; object delete = RM11) -

  async trash(organizationId: string, actorId: string, id: string) {
    const row = await this.table().findFirst({ where: { id, organizationId } });
    if (!row) {
      // Wrong org and unknown id are the same answer — the library
      // never confirms another org's files exist.
      throw new NotFoundException("ফাইলটি পাওয়া যায়নি।");
    }
    if (row.status !== "trashed") {
      const res = await this.registry.markTrashed(organizationId, row.key);
      if (!res.trashed) throw new NotFoundException("ফাইলটি পাওয়া যায়নি।");
      await this.audit?.log({
        organizationId,
        userId: actorId,
        action: "media_library.trash",
        entityType: "StoredFile",
        entityId: row.id,
        metadata: { key: row.key, surface: row.surface },
      }).catch(() => undefined);
    }
    return { id: row.id, key: row.key, trashed: true };
  }
}
