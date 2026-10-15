import { BadRequestException, ForbiddenException, Injectable, NotFoundException, Optional } from "@nestjs/common";
import { createHash, randomUUID } from "node:crypto";
import { PrismaService } from "../prisma/prisma.service";
import { AuditService } from "../audit/audit.service";
import { graphGet, graphPost, metaTokenForAccount } from "../common/meta-graph";
import { FLAG_DISABLED_MESSAGE, orgFlagEnabled } from "../common/feature-flags";
import { StorageService } from "../storage/storage.service";
import { StorageRegistryService } from "../storage/storage-registry.service";
import { imageExtForContentType, publicMediaUrl } from "../storage/media-url";
import { detectMediaKind } from "../inbox/media-sniff";

/** RB4/RM8: direct creative-upload limits. Images follow the
 * product cap; video gets 50 MB because complete() reads the
 * landed bytes once for the sniff + sha256 (the RB3 pattern) —
 * larger videos belong on the by-URL path, which is unchanged. */
export const CREATIVE_IMAGE_UPLOAD_MAX_BYTES = 10 * 1024 * 1024;
export const CREATIVE_VIDEO_UPLOAD_MAX_BYTES = 50 * 1024 * 1024;
export const CREATIVE_UPLOAD_CONTENT_TYPES: Record<string, readonly string[]> = {
  image: ["image/png", "image/jpeg", "image/webp"],
  video: ["video/mp4", "video/quicktime", "video/webm"],
};

function creativeExtForContentType(contentType: string): string {
  if (contentType === "video/mp4") return "mp4";
  if (contentType === "video/quicktime") return "mov";
  if (contentType === "video/webm") return "webm";
  return imageExtForContentType(contentType);
}

@Injectable()
export class CreativesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    // RB4/RM8: direct-to-R2 creative uploads. Optional + last so
    // positional spec constructions keep working; absent (or
    // local storage mode) the presign endpoints refuse honestly
    // and the by-URL path is untouched.
    @Optional() private readonly storage?: StorageService,
    @Optional() private readonly storageRegistry?: StorageRegistryService,
  ) {}

  async listAssets(organizationId: string, adAccountId?: string) {
    return (this.prisma as any).creativeAsset.findMany({
      where: { organizationId, ...(adAccountId ? { adAccountId } : {}) },
      orderBy: { createdAt: "desc" }, take: 200,
    });
  }

  /** Upload media to Meta by URL. Images return a hash (ready at
   * once); videos are ingested asynchronously (processing). A failed
   * upload is recorded as a failed asset with Meta's own error —
   * never presented as uploaded. */
  async upload(organizationId: string, actorId: string, adAccountId: string, dto: { kind: string; name: string; sourceUrl: string }) {
    // Milestone 40: platform feature flag (creative_library).
    if (!(await orgFlagEnabled(this.prisma as any, organizationId, "creative_library"))) {
      throw new ForbiddenException(FLAG_DISABLED_MESSAGE("Creative Library"));
    }
    if (!["image", "video"].includes(dto.kind)) throw new BadRequestException("kind must be image or video");
    if (!/^https:\/\//i.test(dto.sourceUrl)) throw new BadRequestException("sourceUrl must be an https URL Meta can fetch");
    const { account, token } = await metaTokenForAccount(this.prisma, organizationId, adAccountId).catch((e) => {
      throw new BadRequestException(e instanceof Error ? e.message : "Meta account resolution failed");
    });
    const asset = await (this.prisma as any).creativeAsset.create({
      data: { organizationId, adAccountId, kind: dto.kind, name: dto.name, sourceUrl: dto.sourceUrl, status: "pending", createdById: actorId },
    });
    try {
      if (dto.kind === "image") {
        const res = await graphPost(token, `/${account.externalId}/adimages`, { urls: JSON.stringify([dto.sourceUrl]) });
        const entry = res?.images ? Object.values(res.images)[0] as any : null;
        if (!entry?.hash) throw new Error("Meta returned no image hash; upload is NOT confirmed");
        await (this.prisma as any).creativeAsset.update({ where: { id: asset.id }, data: { status: "ready", externalHash: entry.hash } });
      } else {
        const res = await graphPost(token, `/${account.externalId}/advideos`, { file_url: dto.sourceUrl, title: dto.name });
        if (!res?.id) throw new Error("Meta returned no video id; upload is NOT confirmed");
        await (this.prisma as any).creativeAsset.update({ where: { id: asset.id }, data: { status: "processing", externalVideoId: String(res.id) } });
      }
    } catch (e) {
      await (this.prisma as any).creativeAsset.update({
        where: { id: asset.id },
        data: { status: "failed", error: e instanceof Error ? e.message : "Upload failed" },
      });
    }
    await this.audit.log({ organizationId, userId: actorId, action: "creative.upload", entityType: "CreativeAsset", entityId: asset.id, metadata: { kind: dto.kind } });
    return (this.prisma as any).creativeAsset.findUnique({ where: { id: asset.id } });
  }

  // ---------- RB4/RM8: direct-to-R2 creative upload ----------
  //
  // The RB3 pattern, creative surface: presign (flag + type/size
  // validation, quarantine PUT URL) -> the browser PUTs the bytes
  // straight to R2 -> complete (HEAD size check, magic-byte
  // sniff, copy to the final public key, then the EXISTING by-URL
  // upload() creates the CreativeAsset with sourceUrl = the CDN
  // URL, so Meta ingests from the CDN and every downstream
  // behaviour — flag, audit, status transitions — is the old
  // path's). A failure before the asset row exists removes the
  // objects it created; never a partial state.

  private creativeStorageOr400(): StorageService {
    if (!this.storage || this.storage.mode !== "s3") {
      throw new BadRequestException(
        "সরাসরি ফাইল আপলোড এখন চালু নেই — সার্ভারে object storage (Cloudflare R2) সেটআপ হয়নি। আপাতত URL দিয়ে ক্রিয়েটিভ যোগ করুন।",
      );
    }
    return this.storage;
  }

  private async creativeFlagOr403(organizationId: string): Promise<void> {
    if (!(await orgFlagEnabled(this.prisma as any, organizationId, "creative_library"))) {
      throw new ForbiddenException(FLAG_DISABLED_MESSAGE("Creative Library"));
    }
  }

  private normalizeCreativeUpload(kind: unknown, contentType: unknown, sizeBytes: unknown) {
    const k = String(kind ?? "");
    const allowed = CREATIVE_UPLOAD_CONTENT_TYPES[k];
    if (!allowed) throw new BadRequestException("kind must be image or video");
    const ct = String(contentType ?? "").split(";")[0].trim().toLowerCase();
    if (!allowed.includes(ct)) {
      throw new BadRequestException(
        k === "image"
          ? "শুধু PNG, JPEG অথবা WebP ছবি আপলোড করা যাবে।"
          : "শুধু MP4, MOV অথবা WebM ভিডিও আপলোড করা যাবে।",
      );
    }
    const size = Number(sizeBytes);
    if (!Number.isInteger(size) || size < 1) {
      throw new BadRequestException("ফাইলের আকার (sizeBytes) সঠিক নয়।");
    }
    const cap = k === "image" ? CREATIVE_IMAGE_UPLOAD_MAX_BYTES : CREATIVE_VIDEO_UPLOAD_MAX_BYTES;
    if (size > cap) {
      throw new BadRequestException(
        k === "image"
          ? "ছবিটি অনেক বড় — সর্বোচ্চ ১০ MB পর্যন্ত আপলোড করা যাবে।"
          : "ভিডিওটি অনেক বড় — সরাসরি আপলোডে সর্বোচ্চ ৫০ MB; বড় ভিডিও URL দিয়ে যোগ করুন।",
      );
    }
    return { kind: k, contentType: ct, sizeBytes: size };
  }

  async presignCreativeUpload(
    organizationId: string,
    actorId: string,
    dto: { kind: string; contentType: string; sizeBytes: number; fileName?: string },
  ) {
    await this.creativeFlagOr403(organizationId);
    const { contentType, sizeBytes } = this.normalizeCreativeUpload(dto?.kind, dto?.contentType, dto?.sizeBytes);
    const storage = this.creativeStorageOr400();
    const key = `_quarantine/${organizationId}/creative/${randomUUID()}`;
    const uploadUrl = storage.presignedPutUrl("public", key);
    if (!uploadUrl) {
      throw new BadRequestException("আপলোডের URL তৈরি করা যায়নি — object storage সেটআপ যাচাই করুন।");
    }
    void actorId;
    return { uploadUrl, key, contentType, sizeBytes, expiresInSeconds: 600 };
  }

  async completeCreativeUpload(
    organizationId: string,
    actorId: string,
    dto: { key: string; kind: string; contentType: string; sizeBytes: number; adAccountId: string; name: string },
  ) {
    await this.creativeFlagOr403(organizationId);
    const { kind, contentType, sizeBytes } = this.normalizeCreativeUpload(dto?.kind, dto?.contentType, dto?.sizeBytes);
    const storage = this.creativeStorageOr400();
    const key = String(dto?.key ?? "");
    const quarantinePrefix = `_quarantine/${organizationId}/creative/`;
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
    // Magic bytes decide, never the declaration. For container
    // formats the declared type breaks the tie inside the sniff,
    // so the detected type must come back equal to the declared
    // one for the upload to be what it claims.
    const detected = detectMediaKind(bytes, contentType);
    if (!detected || detected.kind !== kind || detected.contentType !== contentType) {
      await dropQuarantine();
      const what = detected ? detected.contentType : "অচেনা ফরম্যাটের ডেটা";
      throw new BadRequestException(`আপলোড করা ফাইলের আসল ফরম্যাট ঘোষিত টাইপের সঙ্গে মিলছে না (পাওয়া গেছে ${what}) — ফাইলটি মোছা হয়েছে।`);
    }

    const sha256 = createHash("sha256").update(bytes).digest("hex");
    const finalKey = `${organizationId}/creative/${randomUUID()}.${creativeExtForContentType(detected.contentType)}`;
    try {
      await storage.copy({ visibility: "public", key }, { visibility: "public", key: finalKey });
      // The asset row is created by the existing by-URL path with
      // the CDN URL as its source — Meta fetches from the CDN.
      const asset = await this.upload(organizationId, actorId, dto.adAccountId, {
        kind,
        name: dto.name,
        sourceUrl: publicMediaUrl(finalKey),
      });
      // Registry AFTER the row exists: the CreativeAsset row is
      // the durable record, so a registry failure must not delete
      // the object the row points at (best-effort bookkeeping,
      // the PublicMediaService discipline).
      if (this.storageRegistry) {
        await this.storageRegistry
          .register({
            organizationId,
            bucket: storage.bucketFor("public"),
            key: finalKey,
            visibility: "public",
            surface: "creative",
            contentType: detected.contentType,
            sizeBytes: bytes.length,
            sha256,
            status: "active",
            createdById: actorId,
            sourceRef: `creative:${asset.id}`,
          })
          .catch(() => undefined);
      }
      await dropQuarantine();
      return asset;
    } catch (e) {
      await storage.delete("public", finalKey).catch(() => undefined);
      await dropQuarantine();
      throw e;
    }
  }

  async refreshVideo(organizationId: string, assetId: string) {
    const asset = await (this.prisma as any).creativeAsset.findFirst({ where: { id: assetId, organizationId } });
    if (!asset) throw new NotFoundException("Asset not found");
    if (asset.kind !== "video" || !asset.externalVideoId) throw new BadRequestException("Only uploaded videos can be refreshed");
    const { token } = await metaTokenForAccount(this.prisma, organizationId, asset.adAccountId);
    const res = await graphGet(token, `/${asset.externalVideoId}`, { fields: "status" });
    const vs = res?.status?.video_status as string | undefined;
    const status = vs === "ready" ? "ready" : vs === "error" ? "failed" : "processing";
    await (this.prisma as any).creativeAsset.update({
      where: { id: asset.id },
      data: { status, ...(status === "failed" ? { error: "Meta reported a video processing error" } : { error: null }) },
    });
    return (this.prisma as any).creativeAsset.findUnique({ where: { id: asset.id } });
  }

  async remove(organizationId: string, assetId: string) {
    const asset = await (this.prisma as any).creativeAsset.findFirst({ where: { id: assetId, organizationId } });
    if (!asset) throw new NotFoundException("Asset not found");
    await (this.prisma as any).creativeAsset.delete({ where: { id: asset.id } });
    return { deleted: true };
  }
}
