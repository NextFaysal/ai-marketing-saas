import { BadRequestException, ConflictException, Injectable, NotFoundException } from "@nestjs/common";
import { execFile } from "node:child_process";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { randomUUID } from "node:crypto";
import sharp from "sharp";
import { PrismaService } from "../prisma/prisma.service";
import { AuditService } from "../audit/audit.service";
import { MediaStore } from "../inbox/media-store";
import { detectMediaKind } from "../inbox/media-sniff";
import { storedAssetPublicUrl } from "../storage/media-url";
import { escapeXml } from "./social-image.service";
import type { BrandOverlayMediaDto, BulkMediaDto, CreateMediaFolderDto, EditMediaAssetDto, UpdateMediaAssetDto, UpdateMediaFolderDto } from "./social.dto";

const execFileAsync = promisify(execFile);

/**
 * SU3: normalize tenant-supplied media tags — pure and exported
 * for tests. Trims, drops empties, dedupes case-insensitively
 * keeping the first form, caps the list at 20 tags and drops any
 * single tag longer than 50 characters (never silently truncates
 * a tag into a different one).
 */
export function normalizeMediaTags(tags: unknown): string[] {
  const list: unknown[] = Array.isArray(tags) ? tags : [];
  const seen = new Set<string>();
  const out: string[] = [];
  for (const raw of list) {
    if (typeof raw !== "string") continue;
    const tag = raw.trim();
    if (!tag) continue;
    if (tag.length > 50) continue;
    const key = tag.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(tag);
    if (out.length >= 20) break;
  }
  return out;
}

function extForContentType(contentType: string): string {
  if (contentType.includes("png")) return "png";
  if (contentType.includes("jpeg") || contentType.includes("jpg")) return "jpg";
  if (contentType.includes("webp")) return "webp";
  if (contentType.includes("gif")) return "gif";
  if (contentType.includes("mp4")) return "mp4";
  if (contentType.includes("webm")) return "webm";
  return "bin";
}

/** Bengali digits for user-facing counts (the codebase's copy
 * convention — cf. formatBytesMb in social.service.ts). */
function toBnDigits(n: number): string {
  return String(n).replace(/\d/g, (d) => "০১২৩৪৫৬৭৮৯"[Number(d)]);
}

const ASPECT_RATIOS: Record<string, number> = {
  "1:1": 1, "4:5": 4 / 5, "9:16": 9 / 16, "16:9": 16 / 9,
};

/**
 * SU3 — Media Library v2: folders, tags, search, per-asset usage,
 * bulk move/delete, a sharp aspect-ratio editor and ffmpeg video
 * covers. Derived assets (edits, covers) are NEW rows pointing at
 * their source via derivedFromId — the source asset is never
 * modified (the PP1 discipline).
 *
 * Seams (public fields, the SocialRasterService pattern): specs
 * substitute readBytes/writeBytes/deleteBytes to avoid a real
 * MediaStore, imageEditor to avoid depending on crop internals,
 * and ffmpegAvailable/frameExtractor so no spec needs a real
 * ffmpeg binary.
 */
@Injectable()
export class SocialMediaLibraryService {
  /** Byte source — defaults to the shared MediaStore. */
  readBytes: (storageKey: string) => Promise<Buffer | null> = (storageKey) =>
    MediaStore.fromEnv().get(storageKey);

  /** Byte sink — defaults to the shared MediaStore. */
  writeBytes: (storageKey: string, bytes: Buffer, contentType: string) => Promise<void> = (storageKey, bytes, contentType) =>
    MediaStore.fromEnv().put(storageKey, bytes, contentType);

  /** Byte removal — defaults to the shared MediaStore. */
  deleteBytes: (storageKey: string) => Promise<void> = (storageKey) =>
    MediaStore.fromEnv().delete(storageKey);

  /**
   * sharp aspect editor: center-crop to the target ratio, then
   * shrink to fit a 1920px box (never upscale). Output format is
   * the source format, except SVG which becomes PNG (an SVG has
   * no fixed raster size to crop).
   */
  imageEditor: (bytes: Buffer, aspect: string) => Promise<Buffer> = async (bytes, aspect) => {
    const ratio = ASPECT_RATIOS[aspect];
    if (!ratio) throw new BadRequestException(`অসমর্থিত aspect ratio: ${aspect}`);
    const meta = await sharp(bytes).metadata();
    let pipeline = sharp(bytes);
    if (meta.width && meta.height) {
      let w = meta.width;
      let h = meta.height;
      if (w / h > ratio) w = Math.max(1, Math.round(h * ratio));
      else h = Math.max(1, Math.round(w / ratio));
      pipeline = pipeline
        .extract({
          left: Math.floor((meta.width - w) / 2),
          top: Math.floor((meta.height - h) / 2),
          width: w, height: h,
        })
        .resize({ width: 1920, height: 1920, fit: "inside", withoutEnlargement: true });
    }
    if (meta.format === "svg") return pipeline.png().toBuffer();
    if (meta.format === "jpeg") return pipeline.jpeg().toBuffer();
    if (meta.format === "webp") return pipeline.webp().toBuffer();
    if (meta.format === "gif") return pipeline.gif().toBuffer();
    return pipeline.png().toBuffer();
  };

  /** Is a real ffmpeg binary available on this host? */
  ffmpegAvailable: () => Promise<boolean> = async () => {
    try {
      await execFileAsync("ffmpeg", ["-version"]);
      return true;
    } catch {
      return false;
    }
  };

  /**
   * Extract one PNG frame at `atSeconds` from video bytes: the
   * bytes land in a temp file (ffmpeg needs a seekable input),
   * the frame comes back over stdout, and the temp dir is always
   * cleaned up.
   */
  frameExtractor: (videoBytes: Buffer, atSeconds: number) => Promise<Buffer> = async (videoBytes, atSeconds) => {
    const dir = await mkdtemp(join(tmpdir(), "social-cover-"));
    try {
      const inputPath = join(dir, "input");
      await writeFile(inputPath, videoBytes);
      const { stdout } = await (execFileAsync as any)(
        "ffmpeg",
        ["-ss", String(atSeconds), "-i", inputPath, "-frames:v", "1", "-f", "image2pipe", "-vcodec", "png", "pipe:1"],
        { maxBuffer: 64 * 1024 * 1024, encoding: "buffer" },
      );
      return stdout as Buffer;
    } finally {
      await rm(dir, { recursive: true, force: true }).catch(() => undefined);
    }
  };

  /**
   * SN5 brand overlay composer (sharp): draws the brand bar as
   * an SVG layer (the PP1 poster pattern — org name text in the
   * org's brand colour bar) and composites the logo image on
   * top. "bottom"/"top" place the bar; "corner" places ONLY the
   * logo at the bottom-right (the caller guarantees a logo
   * exists for corner). Output keeps the source format (SVG and
   * anything else exotic become PNG, like the aspect editor).
   */
  overlayComposer: (
    baseBytes: Buffer,
    logoBytes: Buffer | null,
    opts: { position: "bottom" | "top" | "corner"; barColor: string; brandName: string },
  ) => Promise<Buffer> = async (baseBytes, logoBytes, opts) => {
    const meta = await sharp(baseBytes).metadata();
    const w = meta.width ?? 0;
    const h = meta.height ?? 0;
    if (!w || !h) throw new BadRequestException("ছবিটির আকার পড়া যাচ্ছে না — overlay করা গেল না।");

    const composites: { input: Buffer; left?: number; top?: number }[] = [];
    if (opts.position === "corner") {
      // Logo-only watermark: ~18% of the width, padded from the
      // bottom-right corner.
      const logoW = Math.max(48, Math.round(w * 0.18));
      const logoBuf = await sharp(logoBytes as Buffer)
        .resize({ width: logoW, withoutEnlargement: true })
        .png()
        .toBuffer();
      const logoMeta = await sharp(logoBuf).metadata();
      const pad = Math.round(w * 0.03);
      composites.push({
        input: logoBuf,
        left: Math.max(0, w - (logoMeta.width ?? logoW) - pad),
        top: Math.max(0, h - (logoMeta.height ?? logoW) - pad),
      });
    } else {
      const barH = Math.min(180, Math.max(56, Math.round(h * 0.1)));
      const barY = opts.position === "top" ? 0 : h - barH;
      const fontSize = Math.round(barH * 0.42);
      const textX = logoBytes ? Math.round(barH * 1.05) : Math.round(w * 0.045);
      const svg = [
        `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}">`,
        `<rect x="0" y="${barY}" width="${w}" height="${barH}" fill="${escapeXml(opts.barColor)}" opacity="0.94"/>`,
        opts.brandName
          ? `<text x="${textX}" y="${barY + Math.round(barH * 0.66)}" font-size="${fontSize}" font-weight="bold" fill="#FFFFFF" font-family="sans-serif">${escapeXml(opts.brandName)}</text>`
          : "",
        `</svg>`,
      ].join("");
      composites.push({ input: Buffer.from(svg, "utf8"), left: 0, top: 0 });
      if (logoBytes) {
        const logoH = Math.round(barH * 0.64);
        const logoBuf = await sharp(logoBytes)
          .resize({ height: logoH, withoutEnlargement: true })
          .png()
          .toBuffer();
        composites.push({
          input: logoBuf,
          left: Math.round(barH * 0.18),
          top: barY + Math.round((barH - logoH) / 2),
        });
      }
    }
    let pipeline = sharp(baseBytes).composite(composites);
    if (meta.format === "jpeg") return pipeline.jpeg().toBuffer();
    if (meta.format === "webp") return pipeline.webp().toBuffer();
    return pipeline.png().toBuffer();
  };

  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  // ---------- serializers ----------

  /** SocialService.serializeAsset shape (the frozen SU3 asset
   * contract: folderId / tags / derivedFromId included). */
  serializeAsset(row: any) {
    if (!row) return row;
    return {
      id: row.id, kind: row.kind, name: row.name, contentType: row.contentType,
      sizeBytes: row.sizeBytes, createdAt: row.createdAt,
      publicUrl: storedAssetPublicUrl(row),
      origin: row.origin ?? "upload",
      prompt: row.prompt ?? null,
      sourceUrl: row.sourceUrl ?? null,
      attribution: row.attribution ?? null,
      folderId: row.folderId ?? null,
      tags: Array.isArray(row.tags) ? row.tags : [],
      derivedFromId: row.derivedFromId ?? null,
    };
  }

  private serializeFolder(row: any, assetCount: number) {
    if (!row) return row;
    return {
      id: row.id, name: row.name, assetCount,
      createdAt: row.createdAt, updatedAt: row.updatedAt,
    };
  }

  // ---------- folders ----------

  private validateFolderName(name: unknown): string {
    const trimmed = typeof name === "string" ? name.trim() : "";
    if (!trimmed) throw new BadRequestException("ফোল্ডারের নাম দিন।");
    return trimmed;
  }

  private async assertFolderNameFree(organizationId: string, name: string, excludeId?: string) {
    const rows = await (this.prisma as any).mediaFolder.findMany({ where: { organizationId } }).catch(() => []);
    const clash = (Array.isArray(rows) ? rows : []).some(
      (r: any) => r.id !== excludeId && typeof r.name === "string" && r.name.toLowerCase() === name.toLowerCase(),
    );
    if (clash) throw new ConflictException("এই নামে একটি ফোল্ডার আগেই আছে।");
  }

  private async getFolderRow(organizationId: string, folderId: string) {
    const row = await (this.prisma as any).mediaFolder.findFirst({ where: { id: folderId, organizationId } });
    if (!row) throw new NotFoundException("Media folder not found in this organization");
    return row;
  }

  async listFolders(organizationId: string) {
    const folders = await (this.prisma as any).mediaFolder.findMany({
      where: { organizationId }, orderBy: { createdAt: "asc" },
    });
    const assets = await (this.prisma as any).mediaAsset.findMany({
      where: { organizationId },
    }).catch(() => []);
    const counts = new Map<string, number>();
    for (const a of Array.isArray(assets) ? assets : []) {
      if (a?.folderId) counts.set(a.folderId, (counts.get(a.folderId) ?? 0) + 1);
    }
    return (Array.isArray(folders) ? folders : []).map((f: any) => this.serializeFolder(f, counts.get(f.id) ?? 0));
  }

  async createFolder(organizationId: string, actorId: string, dto: CreateMediaFolderDto) {
    const name = this.validateFolderName(dto.name);
    await this.assertFolderNameFree(organizationId, name);
    const row = await (this.prisma as any).mediaFolder.create({
      data: { organizationId, name, createdById: actorId },
    });
    await this.audit.log({
      organizationId, userId: actorId, action: "social.media_folder_created",
      entityType: "MediaFolder", entityId: row.id, metadata: { name },
    });
    return this.serializeFolder(row, 0);
  }

  async updateFolder(organizationId: string, actorId: string, folderId: string, dto: UpdateMediaFolderDto) {
    const row = await this.getFolderRow(organizationId, folderId);
    const name = this.validateFolderName(dto.name);
    await this.assertFolderNameFree(organizationId, name, row.id);
    const updated = await (this.prisma as any).mediaFolder.update({ where: { id: row.id }, data: { name } });
    await this.audit.log({
      organizationId, userId: actorId, action: "social.media_folder_updated",
      entityType: "MediaFolder", entityId: row.id, metadata: { name },
    });
    const assets = await (this.prisma as any).mediaAsset.findMany({
      where: { organizationId, folderId: row.id },
    }).catch(() => []);
    return this.serializeFolder(updated, Array.isArray(assets) ? assets.length : 0);
  }

  async deleteFolder(organizationId: string, actorId: string, folderId: string) {
    const row = await this.getFolderRow(organizationId, folderId);
    // Only the folder row goes: the DB FK (onDelete SetNull)
    // leaves its assets folderless — assets are never deleted
    // with their folder.
    await (this.prisma as any).mediaFolder.delete({ where: { id: row.id } });
    await this.audit.log({
      organizationId, userId: actorId, action: "social.media_folder_deleted",
      entityType: "MediaFolder", entityId: row.id, metadata: { name: row.name },
    });
    return { deleted: true };
  }

  // ---------- media ----------

  private async getAssetRow(organizationId: string, assetId: string) {
    const asset = await (this.prisma as any).mediaAsset.findFirst({ where: { id: assetId, organizationId } });
    if (!asset) throw new NotFoundException("Media asset not found in this organization");
    return asset;
  }

  async listMedia(organizationId: string, query: { folderId?: string; tag?: string; q?: string } = {}) {
    const where: Record<string, unknown> = { organizationId };
    if (query.folderId === "none") where.folderId = null;
    else if (query.folderId) where.folderId = query.folderId;
    const rows = await (this.prisma as any).mediaAsset.findMany({
      where, orderBy: { createdAt: "desc" }, take: 200,
    });
    let out: any[] = Array.isArray(rows) ? rows : [];
    if (query.tag) {
      const wanted = query.tag.trim().toLowerCase();
      out = out.filter((r) => Array.isArray(r.tags) && r.tags.some((t: unknown) => typeof t === "string" && t.toLowerCase() === wanted));
    }
    if (query.q) {
      const needle = query.q.trim().toLowerCase();
      if (needle) out = out.filter((r) => typeof r.name === "string" && r.name.toLowerCase().includes(needle));
    }
    return out.map((r) => this.serializeAsset(r));
  }

  async updateMedia(organizationId: string, actorId: string, assetId: string, dto: UpdateMediaAssetDto) {
    const asset = await this.getAssetRow(organizationId, assetId);
    const data: Record<string, unknown> = {};
    const fields: string[] = [];
    if (dto.name !== undefined) {
      const name = typeof dto.name === "string" ? dto.name.trim() : "";
      if (!name) throw new BadRequestException("মিডিয়ার নাম খালি রাখা যাবে না।");
      data.name = name;
      fields.push("name");
    }
    if (dto.folderId !== undefined) {
      if (dto.folderId === null) {
        data.folderId = null;
      } else {
        const folder = await (this.prisma as any).mediaFolder.findFirst({
          where: { id: dto.folderId, organizationId },
        });
        if (!folder) throw new BadRequestException("ফোল্ডারটি পাওয়া যায়নি");
        data.folderId = folder.id;
      }
      fields.push("folderId");
    }
    if (dto.tags !== undefined) {
      data.tags = normalizeMediaTags(dto.tags);
      fields.push("tags");
    }
    const updated = await (this.prisma as any).mediaAsset.update({ where: { id: asset.id }, data });
    await this.audit.log({
      organizationId, userId: actorId, action: "social.media_updated",
      entityType: "MediaAsset", entityId: asset.id, metadata: { fields },
    });
    return this.serializeAsset(updated);
  }

  /** Posts (any status) whose mediaRefs point at this asset —
   * the JSON scan is service-level because mediaRefs is a Json
   * column, mirroring the rest of the social module. */
  private async postsUsingAsset(organizationId: string, assetId: string): Promise<any[]> {
    const posts = await (this.prisma as any).socialPost.findMany({
      where: { organizationId }, orderBy: { createdAt: "desc" }, take: 1000,
    }).catch(() => []);
    return (Array.isArray(posts) ? posts : []).filter((p: any) =>
      Array.isArray(p?.mediaRefs) && p.mediaRefs.some((r: any) => r?.assetId === assetId));
  }

  async getUsage(organizationId: string, assetId: string) {
    const asset = await this.getAssetRow(organizationId, assetId);
    const posts = await this.postsUsingAsset(organizationId, asset.id);
    return {
      assetId: asset.id,
      count: posts.length,
      posts: posts.map((p: any) => ({
        id: p.id, status: p.status, caption: p.caption,
        socialAccountId: p.socialAccountId, createdAt: p.createdAt,
      })),
    };
  }

  async bulkMedia(organizationId: string, actorId: string, dto: BulkMediaDto) {
    const ids = Array.isArray(dto.ids) ? dto.ids : [];
    if (ids.length === 0) throw new BadRequestException("কোনো মিডিয়া নির্বাচন করা হয়নি।");
    // A move target is validated ONCE up front (null = make the
    // assets folderless, which is always valid).
    let targetFolderId: string | null = null;
    if (dto.action === "move" && dto.folderId !== undefined && dto.folderId !== null) {
      const folder = await (this.prisma as any).mediaFolder.findFirst({
        where: { id: dto.folderId, organizationId },
      });
      if (!folder) throw new BadRequestException("ফোল্ডারটি পাওয়া যায়নি");
      targetFolderId = folder.id;
    }
    const results: { id: string; ok: boolean; error?: string }[] = [];
    for (const id of ids) {
      try {
        const asset = await (this.prisma as any).mediaAsset.findFirst({ where: { id, organizationId } });
        if (!asset) {
          results.push({ id, ok: false, error: "মিডিয়াটি পাওয়া যায়নি" });
          continue;
        }
        if (dto.action === "move") {
          await (this.prisma as any).mediaAsset.update({ where: { id: asset.id }, data: { folderId: targetFolderId } });
          results.push({ id, ok: true });
        } else {
          const usedBy = await this.postsUsingAsset(organizationId, asset.id);
          if (usedBy.length > 0) {
            results.push({
              id, ok: false,
              error: `এই মিডিয়া ${toBnDigits(usedBy.length)}টি post-এ ব্যবহৃত — আগে post থেকে সরান বা অন্য মিডিয়া বদলান`,
            });
            continue;
          }
          await this.deleteBytes(asset.storageKey).catch(() => undefined);
          await (this.prisma as any).mediaAsset.delete({ where: { id: asset.id } });
          results.push({ id, ok: true });
        }
      } catch (e) {
        // One item's failure never stops the rest of the batch.
        results.push({ id, ok: false, error: e instanceof Error ? e.message : "কাজটি সম্পন্ন করা যায়নি" });
      }
    }
    await this.audit.log({
      organizationId, userId: actorId,
      action: dto.action === "move" ? "social.media_bulk_moved" : "social.media_bulk_deleted",
      entityType: "MediaAsset", entityId: organizationId,
      metadata: {
        total: results.length,
        ok: results.filter((r) => r.ok).length,
        failed: results.filter((r) => !r.ok).length,
        ...(dto.action === "move" ? { folderId: targetFolderId } : {}),
      },
    });
    return { results };
  }

  // ---------- derived assets: aspect edit + video cover ----------

  private async createDerivedAsset(
    organizationId: string, actorId: string, source: any,
    input: { name: string; bytes: Buffer },
  ) {
    const detected = detectMediaKind(input.bytes);
    const contentType = detected && detected.kind === "image"
      ? detected.contentType
      : (String(source.contentType ?? "").includes("svg") ? "image/png" : source.contentType);
    const id = randomUUID();
    const storageKey = `${organizationId}/social/${id}.${extForContentType(contentType)}`;
    await this.writeBytes(storageKey, input.bytes, contentType);
    const row = await (this.prisma as any).mediaAsset.create({
      data: {
        id, organizationId, kind: "image", name: input.name,
        contentType, sizeBytes: input.bytes.length, storageKey,
        origin: source.origin ?? "upload",
        // SN5: a stock photo's credit follows its derived
        // assets — an edit must never silently drop attribution.
        attribution: source.attribution ?? null,
        derivedFromId: source.id,
        folderId: source.folderId ?? null,
        tags: Array.isArray(source.tags) ? [...source.tags] : [],
        createdById: actorId,
      },
    });
    return row;
  }

  async editAsset(organizationId: string, actorId: string, assetId: string, dto: EditMediaAssetDto) {
    const asset = await this.getAssetRow(organizationId, assetId);
    if (asset.kind !== "image") {
      throw new BadRequestException("শুধু ছবির aspect ratio বদলানো যায় — এটি একটি ভিডিও ফাইল।");
    }
    const bytes = await this.readBytes(asset.storageKey);
    if (!bytes) throw new NotFoundException("Media bytes not found in storage");
    const edited = await this.imageEditor(bytes, dto.aspect);
    const derived = await this.createDerivedAsset(organizationId, actorId, asset, {
      name: `${asset.name} (${dto.aspect})`, bytes: edited,
    });
    await this.audit.log({
      organizationId, userId: actorId, action: "social.media_edited",
      entityType: "MediaAsset", entityId: derived.id,
      metadata: { sourceAssetId: asset.id, aspect: dto.aspect },
    });
    return this.serializeAsset(derived);
  }

  async coverFromVideo(organizationId: string, actorId: string, assetId: string, atSeconds?: number) {
    const asset = await this.getAssetRow(organizationId, assetId);
    if (asset.kind !== "video") {
      throw new BadRequestException("শুধু ভিডিও থেকেই cover তোলা যায় — এটি একটি ছবি ফাইল।");
    }
    if (!(await this.ffmpegAvailable())) {
      // Honest unavailability: no row is created, nothing is
      // faked — the feature simply is not there on this host.
      throw new BadRequestException("এই সার্ভারে ffmpeg পাওয়া যায়নি — ভিডিও থেকে cover তোলা এখন সম্ভব নয়। Server-এ ffmpeg install থাকলে এই feature কাজ করবে।");
    }
    const bytes = await this.readBytes(asset.storageKey);
    if (!bytes) throw new NotFoundException("Media bytes not found in storage");
    let frame: Buffer;
    try {
      frame = await this.frameExtractor(bytes, atSeconds ?? 1);
    } catch (e) {
      throw new BadRequestException(e instanceof Error ? e.message : String(e));
    }
    const derived = await this.createDerivedAsset(organizationId, actorId, asset, {
      name: `${asset.name} (Cover)`, bytes: frame,
    });
    await this.audit.log({
      organizationId, userId: actorId, action: "social.media_cover_created",
      entityType: "MediaAsset", entityId: derived.id,
      metadata: { sourceAssetId: asset.id, atSeconds: atSeconds ?? 1 },
    });
    return this.serializeAsset(derived);
  }

  /**
   * SN5 — brand overlay: a NEW derived image asset carrying the
   * org's logo + brand bar (or a corner logo watermark). The
   * source asset is never modified (the SU3 discipline). Image
   * assets only — video overlay is not part of this batch and
   * the UI says so.
   *
   * Defaults come from the org's own branding (the SP4 poster
   * pattern): bar colour = dto.barColor → org.primaryColor →
   * #111827; brand name = org.brandName → org.name; logo =
   * dto.logoAssetId (an image asset of this org) → the uploaded
   * branding logo (branding/<orgId>/logo when org.logoContentType
   * is set). Corner position with NO logo anywhere is an honest
   * Bengali 400 — a bar-less, logo-less "overlay" would be a
   * silent no-op dressed as a feature.
   */
  async brandOverlay(organizationId: string, actorId: string, assetId: string, dto: BrandOverlayMediaDto) {
    const asset = await this.getAssetRow(organizationId, assetId);
    if (asset.kind !== "image") {
      throw new BadRequestException("Brand overlay শুধু ছবিতে বসানো যায় — ভিডিওতে overlay এই মুহূর্তে নেই।");
    }
    const position = dto.position === "top" || dto.position === "corner" ? dto.position : "bottom";

    const org = await (this.prisma as any).organization?.findFirst?.({
      where: { id: organizationId },
    }).catch(() => null);
    const hex = (v: unknown) => (typeof v === "string" && /^#[0-9a-fA-F]{6}$/.test(v) ? v.toUpperCase() : null);
    const barColor = hex(dto.barColor) ?? hex(org?.primaryColor) ?? "#111827";
    const brandName = org?.brandName || org?.name || "";

    let logoBytes: Buffer | null = null;
    if (dto.logoAssetId) {
      const logoAsset = await this.getAssetRow(organizationId, dto.logoAssetId);
      if (logoAsset.kind !== "image") {
        throw new BadRequestException("Logo হিসেবে একটি ছবি (image) asset বেছে নিন।");
      }
      logoBytes = await this.readBytes(logoAsset.storageKey);
      if (!logoBytes) throw new NotFoundException("Logo ছবির bytes storage-এ পাওয়া যায়নি");
    } else if (org?.logoContentType) {
      logoBytes = await this.readBytes(`branding/${organizationId}/logo`).catch(() => null);
    }
    if (position === "corner" && !logoBytes) {
      throw new BadRequestException("Corner overlay-এর জন্য একটি Logo লাগবে — Branding-এ logo আপলোড করুন অথবা Library থেকে একটি logo ছবি বেছে দিন, না হলে উপরে/নিচে bar বেছে নিন।");
    }

    const bytes = await this.readBytes(asset.storageKey);
    if (!bytes) throw new NotFoundException("Media bytes not found in storage");
    let composed: Buffer;
    try {
      composed = await this.overlayComposer(bytes, logoBytes, { position, barColor, brandName });
    } catch (e) {
      if (e instanceof BadRequestException) throw e;
      throw new BadRequestException(e instanceof Error ? e.message : String(e));
    }
    const derived = await this.createDerivedAsset(organizationId, actorId, asset, {
      name: `${asset.name} (Brand)`, bytes: composed,
    });
    await this.audit.log({
      organizationId, userId: actorId, action: "social.media_brand_overlay",
      entityType: "MediaAsset", entityId: derived.id,
      metadata: { sourceAssetId: asset.id, position, withLogo: Boolean(logoBytes), barColor },
    });
    return this.serializeAsset(derived);
  }
}
