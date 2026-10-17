import { BadRequestException, Inject, Injectable, NotFoundException, Optional } from "@nestjs/common";
import { randomBytes, randomUUID } from "node:crypto";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { formatMinor } from "@repo/contracts";
import { PrismaService } from "../prisma/prisma.service";
import { AuditService } from "../audit/audit.service";
import { MediaStore } from "../inbox/media-store";
import { detectMediaKind } from "../inbox/media-sniff";
import { mediaKeyFromCdnUrl, storedAssetPublicUrl, imageExtForContentType } from "../storage/media-url";
import { SocialImportService } from "../social/social-import.service";
import { SocialService } from "../social/social.service";
import { webBaseUrl } from "../courier/tracking-token";
import {
  FfmpegTemplateVideoProvider, VIDEO_GENERATION_PROVIDER,
  VideoRenderError, type VideoGenerationProvider,
} from "./ffmpeg-video.provider";

export const VIDEO_TEMPLATES = ["showcase", "offer"] as const;
export const VIDEO_LANGUAGES = ["bn", "en"] as const;
/** A project stuck in "rendering" longer than this (crashed
 * worker, killed process) may be rendered again by the sweep. */
export const RENDERING_STALE_MS = 10 * 60_000;
const SWEEP_BATCH = 10;

/**
 * NF2 (FB1) — Short Video Commerce Studio (backend).
 *
 * A VideoProject renders ONE product into a vertical template
 * video through the VideoGenerationProvider port (v1: local
 * ffmpeg — see ffmpeg-video.provider.ts and the Step-0 spike;
 * NO external AI provider, nothing is labelled AI-generated).
 *
 * Image resolution NEVER invents a storage path. A product's
 * images are URLs (Product.imageUrl + ProductImage.url rows);
 * bytes are obtained, in order, from:
 *  1. an org MediaAsset already imported for that exact source
 *     URL (MediaStore.get on ITS storageKey),
 *  2. our own CDN URL → object key (mediaKeyFromCdnUrl, the
 *     RM4 helper) → MediaStore.get,
 *  3. a /public/media/<token> URL → the asset holding that token,
 *  4. the product's primary image via SocialImportService
 *     .importForProduct (the ONE SSRF-guarded import path —
 *     deduped, stored, then read back through MediaStore),
 *  5. any other remote gallery URL via SocialImportService
 *     .fetchGuardedImageBytes — the same guarded fetch, never a
 *     bare fetch() of tenant data.
 * Downloaded bytes are sniffed (detectMediaKind) before ffmpeg
 * ever sees them; a source that is not really an image is a
 * named failure, not a render attempt.
 *
 * Honesty: a failed render sets status=failed + errorLabel with
 * the real reason and creates NO MediaAsset. Success stores the
 * mp4 through MediaStore + a MediaAsset row (kind "video",
 * contentType "video/mp4", origin "video_studio") with a
 * publicToken minted at creation, so the web preview uses the
 * EXISTING asset serving path (storedAssetPublicUrl →
 * /public/media/<token> or the CDN URL) — no new file route.
 */
@Injectable()
export class VideoStudioService {
  private readonly provider: VideoGenerationProvider;
  private readonly importer: SocialImportService;

  constructor(
    private readonly prisma: PrismaService,
    @Optional() private readonly audit?: AuditService,
    @Optional() importer?: SocialImportService,
    @Optional() @Inject(VIDEO_GENERATION_PROVIDER) provider?: VideoGenerationProvider,
    // Item 4: publishing rides SocialService.createPost ONLY
    // (SocialModule exports it). Appended LAST so the Item-3
    // positional constructions keep working unchanged.
    @Optional() private readonly social?: SocialService,
  ) {
    // Same defaulting pattern as SocialImageService's importer:
    // the module provides the real collaborators; positional
    // spec constructions may omit them and get real instances
    // sharing this prisma.
    this.importer = importer ?? new SocialImportService(prisma, audit as AuditService);
    this.provider = provider ?? new FfmpegTemplateVideoProvider();
  }

  private db(): any { return this.prisma as any; }

  private async getProjectOrThrow(organizationId: string, projectId: string) {
    const row = await this.db().videoProject.findFirst({ where: { id: projectId, organizationId } });
    if (!row) throw new NotFoundException("ভিডিও প্রজেক্টটি পাওয়া যায়নি");
    return row;
  }

  private async getProductOrThrow(organizationId: string, productId: string) {
    const row = await this.db().product.findFirst({ where: { id: productId, organizationId } });
    if (!row) throw new NotFoundException("Product not found in this organization");
    return row;
  }

  /** Public project view: BigInt-free; product name and the
   * ready asset's EXISTING public URL ride along when known. */
  private serialize(project: any, product?: any, asset?: any) {
    return {
      id: project.id,
      organizationId: project.organizationId,
      productId: project.productId,
      productName: product?.name ?? null,
      template: project.template,
      language: project.language,
      offerText: project.offerText ?? null,
      status: project.status,
      mediaAssetId: project.mediaAssetId ?? null,
      assetUrl: asset ? storedAssetPublicUrl(asset) : null,
      errorLabel: project.errorLabel ?? null,
      socialPostId: project.socialPostId ?? null,
      createdById: project.createdById,
      createdAt: project.createdAt,
      updatedAt: project.updatedAt,
    };
  }

  private async serializeMany(organizationId: string, rows: any[]) {
    const productIds = [...new Set(rows.map((r) => r.productId).filter(Boolean))];
    const assetIds = [...new Set(rows.map((r) => r.mediaAssetId).filter(Boolean))];
    const products = productIds.length
      ? await this.db().product.findMany({ where: { id: { in: productIds }, organizationId } })
      : [];
    const assets = assetIds.length
      ? await this.db().mediaAsset.findMany({ where: { id: { in: assetIds }, organizationId } })
      : [];
    const pMap = new Map((products as any[]).map((p) => [p.id, p]));
    const aMap = new Map((assets as any[]).map((a) => [a.id, a]));
    return rows.map((r) => this.serialize(r, pMap.get(r.productId), r.mediaAssetId ? aMap.get(r.mediaAssetId) : undefined));
  }

  private async serializeOne(organizationId: string, row: any) {
    const [view] = await this.serializeMany(organizationId, [row]);
    return view;
  }

  // ---------- Projects ----------

  async createProject(
    organizationId: string,
    actorId: string,
    dto: { productId?: string; template?: string; language?: string; offerText?: string },
  ) {
    const productId = String(dto.productId ?? "").trim();
    if (!productId) throw new BadRequestException("productId আবশ্যক");
    const product = await this.getProductOrThrow(organizationId, productId);
    const template = dto.template?.trim() || "showcase";
    if (!(VIDEO_TEMPLATES as readonly string[]).includes(template)) {
      throw new BadRequestException(`template হতে হবে: ${VIDEO_TEMPLATES.join(" | ")}`);
    }
    const language = dto.language?.trim() || "bn";
    if (!(VIDEO_LANGUAGES as readonly string[]).includes(language)) {
      throw new BadRequestException(`language হতে হবে: ${VIDEO_LANGUAGES.join(" | ")}`);
    }
    const offerText = dto.offerText?.trim() ? dto.offerText.trim().slice(0, 200) : null;
    const row = await this.db().videoProject.create({
      data: {
        organizationId, productId: product.id, template, language, offerText,
        status: "queued", createdById: actorId,
      },
    });
    await this.audit?.log({
      organizationId, userId: actorId, action: "video_project.created",
      entityType: "VideoProject", entityId: row.id,
      metadata: { productId: product.id, template, language },
    }).catch(() => undefined);
    return this.serializeOne(organizationId, row);
  }

  async listProjects(organizationId: string) {
    const rows = await this.db().videoProject.findMany({
      where: { organizationId }, orderBy: { createdAt: "desc" }, take: 100,
    });
    return this.serializeMany(organizationId, rows as any[]);
  }

  async getProject(organizationId: string, projectId: string) {
    const row = await this.getProjectOrThrow(organizationId, projectId);
    return this.serializeOne(organizationId, row);
  }

  // ---------- Rendering ----------

  /** Bytes for ONE product image URL, via the existing storage
   * machinery only (see the class doc for the resolution order).
   * Returns null when no path yields bytes; throws the guarded
   * import/fetch error (already an honest Bengali HttpException)
   * when a remote fetch was attempted and refused. */
  private async bytesForImageUrl(
    organizationId: string,
    actorId: string,
    product: any,
    url: string,
  ): Promise<Buffer | null> {
    const store = MediaStore.fromEnv();
    const imported = await this.db().mediaAsset.findFirst({
      where: { organizationId, sourceUrl: url, kind: "image" },
    }).catch(() => null);
    if (imported?.storageKey) {
      const bytes = await store.get(imported.storageKey);
      if (bytes) return bytes;
    }
    const cdnKey = mediaKeyFromCdnUrl(url);
    if (cdnKey) {
      const bytes = await store.get(cdnKey);
      if (bytes) return bytes;
    }
    const tokenMatch = /\/public\/media\/([^/?#]+)/.exec(url);
    if (tokenMatch) {
      const byToken = await this.db().mediaAsset.findFirst({
        where: { publicToken: tokenMatch[1], organizationId },
      }).catch(() => null);
      if (byToken?.storageKey) {
        const bytes = await store.get(byToken.storageKey);
        if (bytes) return bytes;
      }
    }
    if (product.imageUrl && url === product.imageUrl) {
      const asset = await this.importer.importForProduct(organizationId, actorId, product.id);
      const row = await this.db().mediaAsset.findFirst({
        where: { id: asset.id, organizationId },
      }).catch(() => null);
      if (row?.storageKey) return store.get(row.storageKey);
      return null;
    }
    if (/^https:\/\//i.test(url)) {
      return this.importer.fetchGuardedImageBytes(url);
    }
    return null;
  }

  /** Resolve the product's images to local temp files (cover
   * first, then gallery rows in position order, deduped, capped
   * at the provider's slide cap). Throws VideoRenderError with
   * the FIRST real reason when not one usable image exists. */
  private async resolveImageFiles(
    organizationId: string,
    actorId: string,
    product: any,
    workDir: string,
  ): Promise<string[]> {
    const gallery = await this.db().productImage.findMany({
      where: { productId: product.id }, orderBy: { position: "asc" },
    }).catch(() => []);
    const urls = [...new Set(
      [product.imageUrl, ...(gallery as any[]).map((g) => g.url)]
        .map((u) => (typeof u === "string" ? u.trim() : ""))
        .filter(Boolean),
    )].slice(0, 5);
    if (urls.length === 0) {
      throw new VideoRenderError("এই Product-এর কোনো ছবি নেই — আগে Product-এ ছবি যোগ করুন");
    }
    const files: string[] = [];
    const failures: string[] = [];
    for (const url of urls) {
      try {
        const bytes = await this.bytesForImageUrl(organizationId, actorId, product, url);
        if (!bytes) { failures.push("ছবির বাইট পাওয়া যায়নি"); continue; }
        const detected = detectMediaKind(bytes);
        if (!detected || detected.kind !== "image") {
          failures.push(`ছবি হিসেবে পড়া যায়নি (পাওয়া গেছে ${detected?.contentType ?? "অচেনা ডেটা"})`);
          continue;
        }
        const file = join(workDir, `src-${files.length}.${imageExtForContentType(detected.contentType)}`);
        await writeFile(file, bytes);
        files.push(file);
      } catch (e: any) {
        failures.push(e?.message ?? String(e));
      }
    }
    if (files.length === 0) {
      throw new VideoRenderError(failures[0] ?? "পণ্যের কোনো ব্যবহারযোগ্য ছবি পাওয়া যায়নি");
    }
    return files;
  }

  /**
   * Render ONE project (queued → rendering → ready | failed).
   * Idempotent: a ready project is a no-op (never a second
   * asset); a fresh "rendering" project is left to its in-flight
   * run; a STALE rendering project (older than
   * RENDERING_STALE_MS) is retried. Failures are RECORDED on the
   * project (status + errorLabel) and returned, not thrown — the
   * sweep and the create-trigger both consume the outcome here.
   */
  async renderProject(organizationId: string, projectId: string) {
    const project = await this.getProjectOrThrow(organizationId, projectId);
    if (project.status === "ready") return this.serializeOne(organizationId, project);
    if (project.status === "rendering") {
      const age = Date.now() - new Date(project.updatedAt).getTime();
      if (Number.isFinite(age) && age < RENDERING_STALE_MS) {
        return this.serializeOne(organizationId, project);
      }
    }
    const rendering = await this.db().videoProject.update({
      where: { id: project.id }, data: { status: "rendering", errorLabel: null },
    });

    const product = await this.db().product.findFirst({
      where: { id: project.productId, organizationId },
    }).catch(() => null);

    const workDir = await mkdtemp(join(tmpdir(), "nf2-video-"));
    try {
      if (!product) throw new VideoRenderError("পণ্যটি পাওয়া যায়নি — প্রজেক্টটি তৈরি হওয়ার পর পণ্যটি মুছে ফেলা হয়েছে");
      const imagePaths = await this.resolveImageFiles(organizationId, rendering.createdById, product, workDir);
      const result = await this.provider.render({
        imagePaths,
        productName: String(product.name ?? ""),
        priceText: formatMinor(BigInt(product.priceMinor ?? 0), product.currency ?? "BDT"),
        offerText: rendering.offerText ?? null,
        language: rendering.language === "en" ? "en" : "bn",
        template: rendering.template,
        workDir,
      });
      const bytes = await readFile(result.filePath);
      if (!bytes || bytes.length === 0) {
        throw new VideoRenderError("রেন্ডার করা ভিডিও ফাইলটি খালি — Asset তৈরি হয়নি");
      }
      const assetId = randomUUID();
      const storageKey = `${organizationId}/video-studio/${assetId}.mp4`;
      await MediaStore.fromEnv().put(storageKey, bytes, "video/mp4");
      const asset = await this.db().mediaAsset.create({
        data: {
          id: assetId, organizationId, kind: "video",
          name: `ভিডিও — ${String(product.name ?? "").slice(0, 60)}`,
          contentType: "video/mp4", sizeBytes: bytes.length,
          storageKey, publicToken: randomBytes(32).toString("base64url"),
          origin: "video_studio", createdById: rendering.createdById,
        },
      });
      const ready = await this.db().videoProject.update({
        where: { id: project.id },
        data: { status: "ready", mediaAssetId: asset.id, errorLabel: null },
      });
      await this.audit?.log({
        organizationId, userId: rendering.createdById, action: "video_project.rendered",
        entityType: "VideoProject", entityId: project.id,
        metadata: { mediaAssetId: asset.id, sizeBytes: bytes.length, durationSec: result.durationSec },
      }).catch(() => undefined);
      return this.serialize(ready, product, asset);
    } catch (e: any) {
      const label = (e instanceof VideoRenderError ? e.label : (e?.message ?? "ভিডিও রেন্ডার ব্যর্থ হয়েছে")).slice(0, 500);
      const failed = await this.db().videoProject.update({
        where: { id: project.id }, data: { status: "failed", errorLabel: label },
      }).catch(() => rendering);
      await this.audit?.log({
        organizationId, userId: rendering.createdById, action: "video_project.render_failed",
        entityType: "VideoProject", entityId: project.id,
        metadata: { errorLabel: label },
      }).catch(() => undefined);
      return this.serializeOne(organizationId, failed);
    } finally {
      await rm(workDir, { recursive: true, force: true }).catch(() => undefined);
    }
  }

  // ---------- Publishing ----------

  /**
   * Turn a READY project into a SocialPost through the EXISTING
   * SocialService.createPost path ONLY — the post is born a
   * draft in the Social engine, whose own flow schedules /
   * publishes it; this method never calls publishNow. The video
   * MediaAsset rides as mediaRefs [{assetId, kind: "video"}].
   *
   * Account: the caller's socialAccountId when given (createPost
   * itself validates it belongs to this org); otherwise the
   * org's first connected account (the SocialCommerceDraft
   * fallback pattern). No connected account → honest 400.
   *
   * Caption: the caller's caption when given; otherwise product
   * name + REAL formatted price. The product link follows the
   * MS5 rule exactly: `${webBaseUrl()}/checkout/${slug}` ONLY
   * when the product has a slug — slug-less products publish
   * with linkUrl null; no URL is ever fabricated.
   *
   * Idempotent: a project with socialPostId already set returns
   * its view WITHOUT calling createPost again.
   */
  async publishProject(
    organizationId: string,
    actorId: string,
    projectId: string,
    dto: { socialAccountId?: string; caption?: string } = {},
  ) {
    const project = await this.getProjectOrThrow(organizationId, projectId);
    if (project.socialPostId) return this.serializeOne(organizationId, project);
    if (project.status !== "ready" || !project.mediaAssetId) {
      throw new BadRequestException("শুধু ready অবস্থার ভিডিও Publish করা যাবে — আগে Render শেষ হতে দিন");
    }
    if (!this.social) {
      throw new BadRequestException("Social service এই deployment-এ পাওয়া যাচ্ছে না");
    }
    let socialAccountId = dto.socialAccountId?.trim() || "";
    if (!socialAccountId) {
      const account = await this.db().socialAccount.findFirst({
        where: { organizationId, status: "connected" }, orderBy: { createdAt: "asc" },
      }).catch(() => null);
      if (!account) {
        throw new BadRequestException("কোনো connected Social অ্যাকাউন্ট পাওয়া যায়নি — আগে Connect Center থেকে একটি অ্যাকাউন্ট যুক্ত করুন");
      }
      socialAccountId = account.id;
    }
    const product = await this.getProductOrThrow(organizationId, project.productId);
    const priceText = formatMinor(BigInt(product.priceMinor ?? 0), product.currency ?? "BDT");
    const caption = dto.caption?.trim()
      || `${product.name} — ${priceText}`;
    const linkUrl = product.slug ? `${webBaseUrl()}/checkout/${product.slug}` : undefined;
    const post = await this.social.createPost(organizationId, actorId, {
      socialAccountId,
      caption,
      ...(linkUrl ? { linkUrl } : {}),
      mediaRefs: [{ assetId: project.mediaAssetId, kind: "video" }],
    });
    const updated = await this.db().videoProject.update({
      where: { id: project.id }, data: { socialPostId: post.id },
    });
    await this.audit?.log({
      organizationId, userId: actorId, action: "video_project.published",
      entityType: "VideoProject", entityId: project.id,
      metadata: { socialPostId: post.id, socialAccountId },
    }).catch(() => undefined);
    return this.serializeOne(organizationId, updated);
  }

  /** The video_render_sweep job body: render this org's queued
   * projects (plus stale "rendering" retries), bounded per run.
   * One project's failure never stops the batch — it is already
   * recorded on that project's own row. */
  async runRenderSweep(organizationId: string) {
    const rows = await this.db().videoProject.findMany({
      where: { organizationId, status: { in: ["queued", "rendering"] } },
      orderBy: { createdAt: "asc" }, take: 50,
    });
    const due = (rows as any[]).filter((r) =>
      r.status === "queued"
      || Date.now() - new Date(r.updatedAt).getTime() >= RENDERING_STALE_MS,
    ).slice(0, SWEEP_BATCH);
    let ready = 0;
    let failed = 0;
    for (const row of due) {
      const out = await this.renderProject(organizationId, row.id);
      if (out.status === "ready") ready += 1;
      else if (out.status === "failed") failed += 1;
    }
    return { processed: due.length, ready, failed };
  }
}
