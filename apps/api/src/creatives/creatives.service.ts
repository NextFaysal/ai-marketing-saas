import { BadRequestException, ForbiddenException, HttpException, Injectable, NotFoundException, Optional } from "@nestjs/common";
import { createHash, randomUUID } from "node:crypto";
import sharp from "sharp";
import { PrismaService } from "../prisma/prisma.service";
import { AuditService } from "../audit/audit.service";
import { graphGet, graphPost, metaTokenForAccount } from "../common/meta-graph";
import { FLAG_DISABLED_MESSAGE, orgFlagEnabled } from "../common/feature-flags";
import { StorageService } from "../storage/storage.service";
import { StorageRegistryService } from "../storage/storage-registry.service";
import { imageExtForContentType, mediaKeyFromCdnUrl, publicMediaUrl } from "../storage/media-url";
import { detectMediaKind } from "../inbox/media-sniff";
import { resolveImageProvider } from "../ai/images/image.factory";
import { assembleSlideshowMp4, isFfmpegAvailable, renderSlidePng } from "./video-slides";
import { formatMinor } from "@repo/contracts";

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
    // CA25: duplicate-upload warning — the SAME bytes
    // (sha256) already stored in this org under another
    // file. The upload still completes (a deliberate
    // re-upload is legitimate); the response carries the
    // earlier file's identity so the duplicate is a
    // choice, not an accident. This upload's own registry
    // row is written later in this call, so any match is
    // necessarily an earlier file.
    let duplicateWarning: { sha256: string; firstUploadedAt: any; otherFileId: string } | null = null;
    if ((this.prisma as any).storedFile?.findFirst) {
      const earlier = await (this.prisma as any).storedFile
        .findFirst({ where: { organizationId, sha256, status: "active" }, orderBy: { createdAt: "asc" } })
        .catch(() => null);
      if (earlier) duplicateWarning = { sha256, firstUploadedAt: earlier.createdAt, otherFileId: earlier.id };
    }
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
      // CA5: record image dimensions from the real uploaded
      // bytes (sharp metadata) so creative-health can run
      // aspect/resolution checks. Video bytes are not probed
      // here — their dimensions stay null and health reports
      // those checks as not_checked, never as passed.
      if (detected.kind === "image") {
        const imgMeta = await sharp(bytes).metadata().catch(() => null);
        if (imgMeta?.width && imgMeta?.height) {
          await (this.prisma as any).creativeAsset.update({ where: { id: asset.id }, data: { width: imgMeta.width, height: imgMeta.height } }).catch(() => undefined);
          (asset as any).width = imgMeta.width;
          (asset as any).height = imgMeta.height;
        }
      }
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
      (asset as any).duplicateWarning = duplicateWarning;
      return asset;
    } catch (e) {
      await storage.delete("public", finalKey).catch(() => undefined);
      await dropQuarantine();
      throw e;
    }
  }

  // ---------- CA1: AI image generation for campaign creatives ----------
  //
  // The platform image provider (Admin → Platform Config, the
  // SAME resolver the Social SP4 flow uses) generates the bytes;
  // they are stored through the REAL creative storage path
  // (public R2 bucket + StoredFile registry, the RB4 discipline)
  // and the CreativeAsset row is then created by the EXISTING
  // by-URL upload() — Meta ingests from the CDN URL, so the
  // asset's ready/failed status is Meta's own answer, exactly
  // like a manual upload. Provenance: CreativeAsset has no
  // origin column, so AI assets carry the name prefix "AI ছবি — "
  // plus the audit action and the "ad_image" usage feature —
  // never silently mixed with uploads.
  // Grounding (the Social SP4 rule): a linked product enriches
  // the prompt with its NAME and CATEGORY only — never its
  // price or any claim baked into pixels.

  /** Public seam for tests (mirrors SocialImageService). */
  resolveProvider() {
    return resolveImageProvider();
  }

  private async checkAiImageDailyLimit(organizationId: string) {
    const { killSwitches, effectiveLimits } = await import("../common/platform-settings");
    const ks = await killSwitches(this.prisma as any);
    if (ks.aiDisabledOrgIds.includes(organizationId)) {
      throw new HttpException("AI features are temporarily disabled for this organization by the platform team.", 403);
    }
    const baseline = Number(process.env.AI_DAILY_MESSAGE_LIMIT ?? 200);
    const { aiDaily: limit } = await effectiveLimits(this.prisma as any, organizationId, { aiDaily: baseline, broadcastCap: 1000 });
    const startOfDay = new Date();
    startOfDay.setUTCHours(0, 0, 0, 0);
    const used = await (this.prisma as any).aIUsageRecord.count({
      where: { organizationId, feature: "ad_image", createdAt: { gte: startOfDay } },
    });
    if (used >= limit) {
      throw new HttpException(
        `Daily AI generation limit reached for this organization (${limit}). Try again tomorrow or ask the platform team to raise your plan limit.`,
        429,
      );
    }
  }

  async generateAiImage(
    organizationId: string,
    actorId: string,
    dto: { adAccountId: string; prompt: string; productId?: string },
  ) {
    const prompt = dto.prompt?.trim() ?? "";
    if (!prompt) throw new BadRequestException("ছবির বর্ণনা (Prompt) দিন।");
    await this.creativeFlagOr403(organizationId);
    // Enforcement BEFORE the provider is resolved or called.
    await this.checkAiImageDailyLimit(organizationId);

    const r = this.resolveProvider();
    if (!r) {
      throw new BadRequestException("AI ছবি তৈরির provider configure করা নেই — Admin Panel থেকে সেট করুন");
    }
    // Storage is checked BEFORE generation spends provider
    // quota: without object storage there is no public URL
    // Meta could fetch, so no asset could ever become ready.
    const storage = this.creativeStorageOr400();

    let product: any = null;
    if (dto.productId) {
      product = await (this.prisma as any).product.findFirst({
        where: { id: dto.productId, organizationId },
      });
      if (!product) throw new NotFoundException("Product not found in this organization");
    }
    const finalPrompt = product
      ? `${prompt}\nProduct: ${product.name}${product.category ? `. Category: ${product.category}` : ""}.`
      : prompt;

    let result: any;
    try {
      result = await r.provider.generate(finalPrompt);
    } catch (e: any) {
      // Provider failure: verbatim error, NO asset, NO usage row.
      throw new BadRequestException(e?.message ?? String(e));
    }
    // Magic bytes decide, exactly like uploads: unusable bytes
    // produce nothing — no stored object, no asset, no usage.
    const detected = detectMediaKind(result.bytes, result.contentType);
    if (!detected || detected.kind !== "image") {
      throw new BadRequestException("Provider এমন ডেটা ফেরত দিয়েছে যা ছবি হিসেবে পড়া যাচ্ছে না — Asset তৈরি হয়নি।");
    }

    const sha256 = createHash("sha256").update(result.bytes).digest("hex");
    const key = `${organizationId}/creative/${randomUUID()}.${imageExtForContentType(detected.contentType)}`;
    await storage.put("public", key, result.bytes, detected.contentType);
    let asset: any;
    try {
      // The EXISTING by-URL path creates the row and asks Meta
      // to ingest from the CDN URL — status is Meta's answer.
      asset = await this.upload(organizationId, actorId, dto.adAccountId, {
        kind: "image",
        name: `AI ছবি — ${prompt.slice(0, 40)}`,
        sourceUrl: publicMediaUrl(key),
      });
    } catch (e) {
      await storage.delete("public", key).catch(() => undefined);
      throw e;
    }
    // CA5: dimensions from the generated bytes themselves.
    const imgMeta = await sharp(result.bytes).metadata().catch(() => null);
    if (imgMeta?.width && imgMeta?.height) {
      await (this.prisma as any).creativeAsset.update({ where: { id: asset.id }, data: { width: imgMeta.width, height: imgMeta.height } }).catch(() => undefined);
      asset.width = imgMeta.width;
      asset.height = imgMeta.height;
    }
    // Registry AFTER the row exists (the completeCreativeUpload
    // discipline): bookkeeping failure must not delete the
    // object the row points at.
    if (this.storageRegistry) {
      await this.storageRegistry
        .register({
          organizationId,
          bucket: storage.bucketFor("public"),
          key,
          visibility: "public",
          surface: "creative",
          contentType: detected.contentType,
          sizeBytes: result.bytes.length,
          sha256,
          status: "active",
          createdById: actorId,
          sourceRef: `creative:${asset.id}`,
        })
        .catch(() => undefined);
    }
    // Usage is recorded only AFTER the asset persisted.
    await (this.prisma as any).aIUsageRecord.create({
      data: {
        organizationId, userId: actorId, feature: "ad_image",
        provider: r.providerName, model: result.model,
        inputTokens: result.inputTokens, outputTokens: result.outputTokens,
        estimated: result.tokensEstimated,
      },
    });
    await this.audit.log({
      organizationId, userId: actorId, action: "creative.ai_image_created",
      entityType: "CreativeAsset", entityId: asset.id,
      metadata: { provider: r.providerName, model: result.model, sizeBytes: result.bytes.length, prompt: finalPrompt.slice(0, 200) },
    });
    return { asset, provider: r.providerName, model: result.model };
  }

  // ---------- CA2: AI video ad generation (slideshow) ----------
  //
  // Assembles a REAL slideshow MP4 from the product's OWN
  // photos (read back through object storage — only images
  // served from our CDN are readable as bytes; external URLs
  // are never fetched ad-hoc) with the caller's script lines
  // as Bengali text bands, in 1:1 / 4:5 / 9:16. Each variant
  // is stored through the real creative path and its
  // CreativeAsset is created by the EXISTING by-URL upload()
  // (Meta /advideos ingest; status starts "processing" and
  // refreshVideo() reads Meta's verdict — the platform's
  // answer, not ours). ffmpeg missing on the host = an honest
  // refusal BEFORE anything is produced.

  /** Public seam for tests (mirrors resolveProvider). */
  async videoFfmpegAvailable(): Promise<boolean> {
    return isFfmpegAvailable();
  }

  async generateAiVideo(
    organizationId: string,
    actorId: string,
    dto: {
      adAccountId: string;
      productId: string;
      name: string;
      script: { headline: string; lines: string[] };
    },
  ) {
    await this.creativeFlagOr403(organizationId);
    if (!(await this.videoFfmpegAvailable())) {
      throw new BadRequestException("ভিডিও তৈরির জন্য ffmpeg এই সার্ভারে পাওয়া যাচ্ছে না — AI ভিডিও এখন তৈরি করা যাচ্ছে না।");
    }
    const storage = this.creativeStorageOr400();
    const product = await (this.prisma as any).product.findFirst({
      where: { id: dto.productId, organizationId },
    });
    if (!product) throw new NotFoundException("Product not found in this organization");

    // Photo sources: the product's own image URLs that resolve
    // to OUR CDN keys (bytes readable through StorageService).
    const imageRows = (this.prisma as any).productImage?.findMany
      ? await (this.prisma as any).productImage.findMany({ where: { productId: product.id }, orderBy: { position: "asc" } }).catch(() => [])
      : [];
    const urls = [...new Set([product.imageUrl, ...(imageRows ?? []).map((r: any) => r.url)].filter((u: any) => typeof u === "string" && u))] as string[];
    const photos: Buffer[] = [];
    for (const url of urls) {
      if (photos.length >= 4) break;
      const key = mediaKeyFromCdnUrl(url);
      if (!key) continue;
      const bytes = await storage.get("public", key).catch(() => null);
      if (bytes && detectMediaKind(bytes)?.kind === "image") photos.push(bytes);
    }
    if (!photos.length) {
      throw new BadRequestException("প্রোডাক্টের কোনো ছবি আমাদের মিডিয়া CDN-এ পাওয়া যায়নি — ভিডিও বানাতে আগে প্রোডাক্টে ছবি আপলোড করুন (বাইরের URL থেকে ছবি এনে ভিডিও বানানো হয় না)।");
    }

    const org = await (this.prisma as any).organization?.findUnique?.({ where: { id: organizationId } }).catch(() => null);
    const bandColor = /^#[0-9a-fA-F]{6}$/.test(org?.primaryColor ?? "") ? (org.primaryColor as string) : "#111827";
    const titles = [dto.script.headline, ...(dto.script.lines ?? [])].map((t) => String(t ?? "").trim()).filter(Boolean);
    const priceLine = `দাম ${formatMinor(BigInt(product.priceMinor), product.currency)}`;
    const aspects = [
      { label: "1:1", width: 1080, height: 1080 },
      { label: "4:5", width: 1080, height: 1350 },
      { label: "9:16", width: 1080, height: 1920 },
    ] as const;

    // Assemble ALL variants first: a render/encode failure
    // aborts before a single object or row exists.
    const rendered: { label: string; bytes: Buffer; width: number; height: number }[] = [];
    for (const aspect of aspects) {
      const frames = [];
      for (let i = 0; i < photos.length; i++) {
        const isLast = i === photos.length - 1;
        frames.push({
          png: await renderSlidePng({
            photo: photos[i], width: aspect.width, height: aspect.height,
            title: titles[Math.min(i, titles.length - 1)] ?? "",
            subtitle: isLast ? priceLine : undefined,
            bandColor,
          }),
          seconds: 2.5,
        });
      }
      const mp4 = await assembleSlideshowMp4(frames, { width: aspect.width, height: aspect.height });
      if (mp4.length > CREATIVE_VIDEO_UPLOAD_MAX_BYTES) {
        throw new BadRequestException(`তৈরি ভিডিও (${aspect.label}) সরাসরি আপলোডের সীমা ৫০ MB ছাড়িয়ে গেছে — ভিডিও তৈরি বাতিল করা হয়েছে।`);
      }
      rendered.push({ label: aspect.label, bytes: mp4, width: aspect.width, height: aspect.height });
    }

    const assets: any[] = [];
    let inFlightKey: string | null = null;
    try {
      for (const variant of rendered) {
        const sha256 = createHash("sha256").update(variant.bytes).digest("hex");
        const key = `${organizationId}/creative/${randomUUID()}.mp4`;
        await storage.put("public", key, variant.bytes, "video/mp4");
        inFlightKey = key;
        const asset = await this.upload(organizationId, actorId, dto.adAccountId, {
          kind: "video",
          name: `${dto.name} (${variant.label})`,
          sourceUrl: publicMediaUrl(key),
        });
        inFlightKey = null;
        // CA5: the render size IS the video's exact size.
        await (this.prisma as any).creativeAsset.update({ where: { id: asset.id }, data: { width: variant.width, height: variant.height } }).catch(() => undefined);
        (asset as any).width = variant.width;
        (asset as any).height = variant.height;
        if (this.storageRegistry) {
          await this.storageRegistry
            .register({
              organizationId,
              bucket: storage.bucketFor("public"),
              key,
              visibility: "public",
              surface: "creative",
              contentType: "video/mp4",
              sizeBytes: variant.bytes.length,
              sha256,
              status: "active",
              createdById: actorId,
              sourceRef: `creative:${asset.id}`,
            })
            .catch(() => undefined);
        }
        assets.push(asset);
      }
    } catch (e) {
      // Only the IN-FLIGHT variant's object is removed (its
      // row never existed). Variants already uploaded keep
      // their objects — their rows point at them and each is
      // an honest record of Meta's ingest answer.
      if (inFlightKey) await storage.delete("public", inFlightKey).catch(() => undefined);
      throw e;
    }
    await this.audit.log({
      organizationId, userId: actorId, action: "creative.ai_video_created",
      entityType: "CreativeAsset", entityId: assets[0]?.id ?? "",
      metadata: { productId: product.id, assetIds: assets.map((a) => a.id), aspects: aspects.map((a) => a.label), frames: photos.length },
    });
    return { assets, framesUsed: photos.length };
  }

  /** CA5: read a stored creative's image bytes back through
   * object storage (for the creative-health vision scan).
   * Only URLs served from our own CDN resolve to a storage
   * key — external URLs return null (bytes are never fetched
   * ad-hoc) and the caller reports the check as not_checked. */
  async creativeImageBytes(sourceUrl: string): Promise<{ bytes: Buffer; mimeType: string } | null> {
    if (!this.storage) return null;
    const key = mediaKeyFromCdnUrl(sourceUrl ?? "");
    if (!key) return null;
    const bytes = await this.storage.get("public", key).catch(() => null);
    if (!bytes) return null;
    const detected = detectMediaKind(bytes);
    if (!detected || detected.kind !== "image") return null;
    return { bytes, mimeType: detected.contentType };
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
