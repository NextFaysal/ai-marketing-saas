import { BadRequestException, Injectable, NotFoundException } from "@nestjs/common";
import { randomUUID } from "node:crypto";
import sharp from "sharp";
import { PrismaService } from "../prisma/prisma.service";
import { AuditService } from "../audit/audit.service";
import { MediaStore } from "../inbox/media-store";

/** Converts SVG bytes to PNG bytes (the real implementation is sharp). */
export type SvgToPngConverter = (svgBytes: Buffer) => Promise<Buffer>;

/**
 * PP1 — SVG → PNG rasterizer.
 *
 * SP4's Template Poster is an SVG, but Meta/Instagram publishing
 * needs raster PNG/JPEG (SP6 gated SVG posts for exactly this
 * reason). This service converts an SVG MediaAsset into a PNG
 * MediaAsset ONCE and caches it as a derived asset:
 * MediaAsset.derivedFromId points at the source, origin is
 * PRESERVED (origin describes the content's provenance — a
 * rasterized template poster is still template content; the
 * derivation itself is mechanical and recorded by derivedFromId).
 *
 * Seams (public fields, the lightest replaceable pattern used in
 * this codebase — cf. MetaSocialPublisher's injected fetch):
 * specs substitute `converter` to count calls / force failures
 * and `readBytes`/`writeBytes` to avoid a real MediaStore.
 */
@Injectable()
export class SocialRasterService {
  /** sharp: SVG → PNG at the poster's native 1080 width. */
  converter: SvgToPngConverter = async (svgBytes: Buffer) =>
    sharp(svgBytes).resize({ width: 1080 }).png().toBuffer();

  /** Byte source — defaults to the shared MediaStore. */
  readBytes: (storageKey: string) => Promise<Buffer | null> = (storageKey) =>
    MediaStore.fromEnv().get(storageKey);

  /** Byte sink — defaults to the shared MediaStore. */
  writeBytes: (storageKey: string, bytes: Buffer, contentType: string) => Promise<void> = (storageKey, bytes, contentType) =>
    MediaStore.fromEnv().put(storageKey, bytes, contentType);

  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  /** Convert raw SVG bytes to PNG bytes (through the seam). */
  async convertSvgToPng(svgBytes: Buffer): Promise<Buffer> {
    return this.converter(svgBytes);
  }

  /** SocialService.serializeAsset shape (+ derivedFromId). */
  serializeAsset(row: any) {
    if (!row) return row;
    return {
      id: row.id, kind: row.kind, name: row.name, contentType: row.contentType,
      sizeBytes: row.sizeBytes, createdAt: row.createdAt,
      publicUrl: row.publicToken ? `/public/media/${row.publicToken}` : null,
      origin: row.origin ?? "upload",
      prompt: row.prompt ?? null,
      derivedFromId: row.derivedFromId ?? null,
    };
  }

  /**
   * Return the cached PNG derived from `sourceAsset`, creating it
   * on first use. The cache lookup is organization-scoped — a PNG
   * derived under another tenant is NEVER reused, even when it
   * claims the same derivedFromId. Returns the plain asset row
   * (the shape the publish service consumes).
   */
  async ensurePngAsset(organizationId: string, actorId: string, sourceAsset: any): Promise<any> {
    const prisma = this.prisma as any;
    const cached = await prisma.mediaAsset.findFirst({
      where: { organizationId, derivedFromId: sourceAsset.id, contentType: "image/png" },
    });
    if (cached) return cached;

    const svgBytes = await this.readBytes(sourceAsset.storageKey);
    if (!svgBytes) {
      throw new Error(`SVG ফাইলের ডেটা Storage-এ পাওয়া যায়নি — মিডিয়াটি আবার তৈরি করে চেষ্টা করুন। (asset: ${sourceAsset.id})`);
    }
    const pngBytes = await this.convertSvgToPng(svgBytes);
    const id = randomUUID();
    const storageKey = `${organizationId}/social/${id}.png`;
    await this.writeBytes(storageKey, pngBytes, "image/png");
    return prisma.mediaAsset.create({
      data: {
        id, organizationId, kind: "image",
        name: `${sourceAsset.name} (PNG)`,
        contentType: "image/png", sizeBytes: pngBytes.length,
        storageKey, origin: sourceAsset.origin ?? "upload",
        derivedFromId: sourceAsset.id, createdById: actorId,
      },
    });
  }

  /**
   * Library action (POST media/:id/rasterize): build (or reuse)
   * the PNG version of one SVG asset so the tenant can pick it in
   * the composer directly. Non-SVG → honest 400; cross-org /
   * missing → 404, matching the neighbouring media routes.
   */
  async rasterizeAsset(organizationId: string, actorId: string, assetId: string) {
    const asset = await (this.prisma as any).mediaAsset.findFirst({
      where: { id: assetId, organizationId },
    });
    if (!asset) throw new NotFoundException("Media asset not found in this organization");
    if (!String(asset.contentType ?? "").includes("svg")) {
      throw new BadRequestException("শুধু SVG ছবির PNG সংস্করণ তৈরি করা যায় — এই ফাইলটি SVG নয়।");
    }
    const png = await this.ensurePngAsset(organizationId, actorId, asset);
    await this.audit.log({
      organizationId, userId: actorId, action: "social.media_rasterized",
      entityType: "MediaAsset", entityId: png.id,
      metadata: { sourceAssetId: asset.id, derivedAssetId: png.id },
    });
    return this.serializeAsset(png);
  }
}
