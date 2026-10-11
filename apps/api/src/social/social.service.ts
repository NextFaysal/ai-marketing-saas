import { BadRequestException, ConflictException, ForbiddenException, Injectable, Logger, NotFoundException } from "@nestjs/common";
import { randomBytes, randomUUID } from "node:crypto";
import { createReadStream, createWriteStream } from "node:fs";
import { unlink } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Readable } from "node:stream";
import { PrismaService } from "../prisma/prisma.service";
import { AuditService } from "../audit/audit.service";
import { encryptJson } from "../integrations/crypto";
import { MetaClient } from "../ads/meta/meta.client";
import { MediaStore } from "../inbox/media-store";
import { detectMediaKind, defaultMediaFileName } from "../inbox/media-sniff";
import { SOCIAL_MEDIA_KINDS, SOCIAL_POST_STATUSES } from "./social.constants";
import {
  CreateHashtagSetDto, CreateSocialPostDto, MetaSocialConnectDto, MetaSocialDiscoverDto,
  ScheduleSocialPostDto, UpdateHashtagSetDto, UpdateSocialPostDto, UploadSocialMediaDto,
} from "./social.dto";

/**
 * SP3: normalize tenant-supplied hashtag tags — pure and exported
 * for tests. Trims, strips leading '#', drops empties, dedupes
 * case-insensitively keeping the first form, caps a set at 30 tags
 * and each tag at 100 characters.
 */
export function normalizeHashtagTags(tags: unknown): string[] {
  const list: unknown[] = Array.isArray(tags) ? tags : [];
  const seen = new Set<string>();
  const out: string[] = [];
  for (const raw of list) {
    if (typeof raw !== "string") continue;
    const tag = raw.trim().replace(/^#+/, "").trim();
    if (!tag) continue;
    if (tag.length > 100) {
      throw new BadRequestException("একটি Hashtag সর্বোচ্চ ১০০ অক্ষরের হতে পারবে।");
    }
    const key = tag.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(tag);
  }
  if (out.length > 30) {
    throw new BadRequestException("একটি Set-এ সর্বোচ্চ ৩০টি Hashtag রাখা যায়।");
  }
  return out;
}

/** Raw-byte cap for IMAGE uploads (the base64 DTO cap matches it;
 * PP3's URL import enforces the same cap — images stay small). */
export const SOCIAL_MEDIA_MAX_BYTES = 2_100_000;

/**
 * PP2: videos get their own, much larger cap — a real TikTok /
 * YouTube clip can never fit in the image cap. Config-driven via
 * SOCIAL_VIDEO_MAX_BYTES (bytes), default 256 MB. Read at call
 * time so ops can change it without a code change.
 */
export const SOCIAL_VIDEO_MAX_BYTES_DEFAULT = 268_435_456;
export function socialVideoMaxBytes(): number {
  const raw = Number(process.env.SOCIAL_VIDEO_MAX_BYTES);
  return Number.isFinite(raw) && raw > 0 ? Math.floor(raw) : SOCIAL_VIDEO_MAX_BYTES_DEFAULT;
}

/** "২৫৬ MB" / "২.১ MB" — the human form errors use (Bengali
 * digits, the codebase's copy convention). */
export function formatBytesMb(bytes: number): string {
  const mb = bytes / 1_000_000;
  const num = Number.isInteger(mb) ? String(mb) : mb.toFixed(1);
  return `${num.replace(/\d/g, (d) => "০১২৩৪৫৬৭৮৯"[Number(d)])} MB`;
}

/** One served media file: a byte stream over a (possibly partial)
 * range of the stored object — PP2 replaced the whole-Buffer
 * reads so a 256 MB video never lands in memory to be served. */
export interface MediaFileStream {
  stream: Readable;
  contentType: string;
  /** Full object size in bytes. */
  totalSize: number;
  start: number;
  end: number;
  partial: boolean;
}

/**
 * Parse a single-range `Range: bytes=...` header against the
 * object size. Returns null for "serve the whole object" (no
 * header, a multi-range, or a malformed value — a documented
 * simplification: platforms and browsers re-ask correctly).
 */
export function parseSingleRange(header: string | undefined, totalSize: number): { start: number; end: number } | null {
  if (!header || totalSize <= 0) return null;
  const m = /^bytes=(\d*)-(\d*)$/.exec(header.trim());
  if (!m || (m[1] === "" && m[2] === "")) return null;
  if (m[1] === "") {
    const suffix = Number(m[2]);
    if (!Number.isFinite(suffix) || suffix <= 0) return null;
    return { start: Math.max(0, totalSize - suffix), end: totalSize - 1 };
  }
  const start = Number(m[1]);
  if (!Number.isFinite(start) || start >= totalSize) return null;
  const end = m[2] === "" ? totalSize - 1 : Math.min(Number(m[2]), totalSize - 1);
  if (!Number.isFinite(end) || end < start) return null;
  return { start, end };
}

/**
 * SP8/SP9: TikTok and YouTube are VIDEO-ONLY destinations in v1
 * and take exactly one video — anything else can never succeed
 * there, so the schedule endpoint refuses it up front (Bengali
 * 400) and the publish path fails it permanently with the same
 * text. Returns the Bengali violation message, or null when the
 * media set is acceptable for the platform (Meta platforms accept
 * anything the SP6 adapters accept, so they return null here).
 */
export function videoOnlyViolation(platform: string, mediaRefs: { assetId: string; kind: string }[] | null | undefined): string | null {
  if (platform !== "tiktok" && platform !== "youtube") return null;
  const label = platform === "tiktok" ? "TikTok" : "YouTube";
  const refs = Array.isArray(mediaRefs) ? mediaRefs : [];
  if (refs.length !== 1 || refs[0]?.kind !== "video") {
    return `${label}-এর পোস্টে ঠিক একটি Video লাগবে — ছবি বা একাধিক মিডিয়া দিয়ে ${label}-এ প্রকাশ করা যায় না। একটি Video বেছে নিন।`;
  }
  return null;
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

/**
 * Social Media Post Scheduler — SP1 Foundation service.
 *
 * Credential design (reused, not reinvented): each connected Meta
 * Page gets an Integration (provider "meta_social") + an
 * IntegrationCredential sealed with the shared AES-256-GCM
 * encryptJson — exactly the Inbox/AdAccount machinery. What is
 * sealed is the PAGE access token from /me/accounts (posting acts
 * as the Page), never the user token, which lives only inside the
 * discover/connect call. A Page and its linked Instagram account
 * SHARE one integration (one Page token drives both), so the AD2
 * reference-count discipline applies on disconnect/supersede.
 */
@Injectable()
export class SocialService {
  private readonly logger = new Logger(SocialService.name);

  constructor(private readonly prisma: PrismaService, private readonly audit: AuditService) {}

  // ---------- serializers (explicit fields only — no credential
  // material can ever ride along, because no relation is included) ----------

  private serializeAccount(row: any) {
    if (!row) return row;
    return {
      id: row.id, platform: row.platform, externalId: row.externalId,
      name: row.name, username: row.username ?? null, pictureUrl: row.pictureUrl ?? null,
      status: row.status, lastError: row.lastError ?? null,
      createdAt: row.createdAt, updatedAt: row.updatedAt,
    };
  }

  private serializeAsset(row: any) {
    if (!row) return row;
    return {
      id: row.id, kind: row.kind, name: row.name, contentType: row.contentType,
      sizeBytes: row.sizeBytes, createdAt: row.createdAt,
      publicUrl: row.publicToken ? `/public/media/${row.publicToken}` : null,
      origin: row.origin ?? "upload",
      prompt: row.prompt ?? null,
    };
  }

  private serializePost(row: any, account?: any) {
    if (!row) return row;
    return {
      id: row.id, socialAccountId: row.socialAccountId,
      caption: row.caption, linkUrl: row.linkUrl ?? null,
      mediaRefs: Array.isArray(row.mediaRefs) ? row.mediaRefs : [],
      status: row.status, scheduledAt: row.scheduledAt ?? null,
      publishedAt: row.publishedAt ?? null, platformPostId: row.platformPostId ?? null,
      platformUrl: row.platformUrl ?? null, publishNote: row.publishNote ?? null, error: row.error ?? null,
      attempts: row.attempts ?? 0,
      // SP7: insights snapshot (exactly as the platform returned
      // it) + approval state. Both null until they exist.
      insights: row.insights ?? null,
      insightsFetchedAt: row.insightsFetchedAt ?? null,
      approvalStatus: row.approvalStatus ?? null,
      submittedById: row.submittedById ?? null,
      reviewedById: row.reviewedById ?? null,
      reviewNote: row.reviewNote ?? null,
      createdById: row.createdById, createdAt: row.createdAt, updatedAt: row.updatedAt,
      account: account
        ? { id: account.id, platform: account.platform, name: account.name, username: account.username ?? null }
        : null,
    };
  }

  // ---------- SP7: approval-flow helpers ----------

  /**
   * Is the org's social approval requirement on? Defensive read
   * (any lookup problem reads as OFF) so every pre-SP7 behaviour is
   * preserved byte-for-byte while the setting is off or unknown.
   */
  private async approvalSettingOn(organizationId: string): Promise<boolean> {
    try {
      const model = (this.prisma as any).organization;
      if (!model?.findFirst) return false;
      const org = await model.findFirst({ where: { id: organizationId } });
      return org?.socialRequireApproval === true;
    } catch {
      return false;
    }
  }

  /** The actor's ACTIVE membership role in this org, or null. */
  private async actorRole(organizationId: string, userId: string): Promise<string | null> {
    try {
      const member = await (this.prisma as any).membership?.findFirst?.({
        where: { organizationId, userId, status: "ACTIVE" },
      });
      return member?.role ?? null;
    } catch {
      return null;
    }
  }

  /** Approvers in v1 are exactly OWNER/ADMIN (M72: the `social`
   * area's minRole governs who can write posts, not who may
   * approve them — a MARKETING_MANAGER cannot approve, not even
   * their own posts). */
  private isApproverRole(role: string | null): boolean {
    return role === "OWNER" || role === "ADMIN";
  }

  /** Failure-isolated AgentNotification fan-out (SP5 publish
   * service pattern). A notification problem never changes the
   * outcome of the action that triggered it. Never throws. */
  private async notifyUsers(
    organizationId: string, userIds: string[], type: string, title: string, body: string,
  ): Promise<void> {
    try {
      for (const userId of [...new Set(userIds)]) {
        await (this.prisma as any).agentNotification.create({
          data: { organizationId, userId, type, title, body, conversationId: null },
        }).catch(() => undefined);
      }
    } catch (e) {
      this.logger.warn(`social notification (${type}) failed: ${e instanceof Error ? e.message : "unknown"}`);
    }
  }

  private async approverUserIds(organizationId: string): Promise<string[]> {
    const memberships = await (this.prisma as any).membership.findMany({
      where: { organizationId, status: "ACTIVE" }, take: 200,
    }).catch(() => []);
    return [...new Set((Array.isArray(memberships) ? memberships : [])
      .filter((m: any) => this.isApproverRole(m.role))
      .map((m: any) => m.userId as string))];
  }

  // ---------- Meta discover → picker (side-effect-free) ----------

  private async verifyAndListPages(accessToken: string) {
    const client = new MetaClient(accessToken);
    try {
      await client.verifyToken();
    } catch (e) {
      throw new BadRequestException(`Meta token verification failed: ${e instanceof Error ? e.message : "unknown error"}`);
    }
    return client.listPages().catch((e) => {
      throw new BadRequestException(`Could not list Meta pages: ${e instanceof Error ? e.message : "unknown error"}`);
    });
  }

  /**
   * Picker step 1: verify the token + list its Pages. STRICTLY
   * side-effect-free: no writes, no audit, and neither the user
   * token nor any Page token appears in the response.
   * alreadyConnected = a SocialAccount row (org+platform+externalId)
   * exists in ANY status — a disconnected row counts, because
   * reconnecting revives the same row (AD5 semantics).
   */
  async discoverMetaPages(organizationId: string, dto: MetaSocialDiscoverDto) {
    const pages = await this.verifyAndListPages(dto.accessToken);
    const existing = await (this.prisma as any).socialAccount.findMany({ where: { organizationId } }).catch(() => []);
    const rows: any[] = Array.isArray(existing) ? existing : [];
    const has = (platform: string, externalId: string) =>
      rows.some((r) => r.platform === platform && r.externalId === externalId);
    return {
      pages: pages.map((p) => ({
        pageId: p.pageId,
        name: p.name,
        pictureUrl: p.pictureUrl,
        instagram: p.instagram
          ? { externalId: p.instagram.externalId, username: p.instagram.username, pictureUrl: p.instagram.pictureUrl }
          : null,
        alreadyConnectedPage: has("meta_page", p.pageId),
        alreadyConnectedInstagram: p.instagram ? has("instagram", p.instagram.externalId) : false,
      })),
    };
  }

  // ---------- Meta connect ----------

  async connectMetaPages(organizationId: string, actorId: string, dto: MetaSocialConnectDto) {
    if (!Array.isArray(dto.pageIds) || dto.pageIds.length === 0) {
      throw new BadRequestException("কোনো Page নির্বাচন করা হয়নি — অন্তত একটি Page বেছে নিন।");
    }
    const pages = await this.verifyAndListPages(dto.accessToken);
    const byId = new Map(pages.map((p) => [p.pageId, p]));
    const missing = [...new Set(dto.pageIds)].filter((id) => !byId.has(id));
    if (missing.length > 0) {
      // Nothing has been stored yet — fail before any write.
      throw new BadRequestException(`নির্বাচিত Page এই Token-এর অধীনে পাওয়া যায়নি: ${missing.join(", ")} — Tokenটি ওই Pageগুলোতে Access পায় কিনা যাচাই করুন।`);
    }
    const wanted = new Set(dto.pageIds);
    const selected = pages.filter((p) => wanted.has(p.pageId)); // discovery order
    const accounts: any[] = [];
    for (const page of selected) {
      const integration = await (this.prisma as any).integration.create({
        data: { organizationId, provider: "meta_social", status: "CONNECTED", externalAccountId: page.pageId },
      });
      await (this.prisma as any).integrationCredential.create({
        // The PAGE token is sealed — it is what posting acts with.
        data: { integrationId: integration.id, encryptedData: encryptJson({ accessToken: page.pageAccessToken, pageId: page.pageId }) },
      });
      const pageAccount = await (this.prisma as any).socialAccount.upsert({
        where: { organizationId_platform_externalId: { organizationId, platform: "meta_page", externalId: page.pageId } },
        update: { name: page.name, pictureUrl: page.pictureUrl, integrationId: integration.id, status: "connected", lastError: null },
        create: {
          organizationId, platform: "meta_page", externalId: page.pageId, name: page.name,
          pictureUrl: page.pictureUrl, integrationId: integration.id, status: "connected", createdById: actorId,
        },
      });
      accounts.push(pageAccount);
      await this.audit.log({
        organizationId, userId: actorId, action: "social.account_connected",
        entityType: "SocialAccount", entityId: pageAccount.id,
        metadata: { platform: "meta_page", pageId: page.pageId },
      });
      if (page.instagram) {
        const igAccount = await (this.prisma as any).socialAccount.upsert({
          where: { organizationId_platform_externalId: { organizationId, platform: "instagram", externalId: page.instagram.externalId } },
          update: {
            name: page.name, username: page.instagram.username, pictureUrl: page.instagram.pictureUrl,
            integrationId: integration.id, status: "connected", lastError: null,
          },
          create: {
            organizationId, platform: "instagram", externalId: page.instagram.externalId, name: page.name,
            username: page.instagram.username, pictureUrl: page.instagram.pictureUrl,
            integrationId: integration.id, status: "connected", createdById: actorId,
          },
        });
        accounts.push(igAccount);
        await this.audit.log({
          organizationId, userId: actorId, action: "social.account_connected",
          entityType: "SocialAccount", entityId: igAccount.id,
          metadata: { platform: "instagram", pageId: page.pageId },
        });
      }
      // AD2-style hygiene for THIS page identity only; pages and
      // accounts that were not selected are never touched.
      await this.supersedePreviousIntegrations(organizationId, actorId, page.pageId, integration.id);
    }
    return { accounts: accounts.map((a) => this.serializeAccount(a)) };
  }

  /**
   * Supersede a Page's previous CONNECTED "meta_social"
   * integrations ONLY when zero SocialAccounts still reference them
   * after the connect upserts (credential rows deleted, status
   * DISCONNECTED, audit "social.integration_superseded"). A still-
   * referenced old integration keeps its credential fully alive.
   */
  private async supersedePreviousIntegrations(
    organizationId: string, actorId: string, pageId: string, newIntegrationId: string,
  ): Promise<void> {
    let olds: any[] = [];
    try {
      olds = await (this.prisma as any).integration.findMany({
        where: { organizationId, provider: "meta_social", externalAccountId: pageId, status: "CONNECTED" },
      });
    } catch { return; }
    if (!Array.isArray(olds)) return;
    for (const old of olds) {
      if (!old?.id || old.id === newIntegrationId) continue;
      const remaining = await (this.prisma as any).socialAccount.findMany({
        where: { organizationId, integrationId: old.id },
      }).catch(() => null);
      if (!Array.isArray(remaining) || remaining.length > 0) continue;
      await (this.prisma as any).integrationCredential.deleteMany({ where: { integrationId: old.id } });
      await (this.prisma as any).integration.update({ where: { id: old.id }, data: { status: "DISCONNECTED" } });
      await this.audit.log({
        organizationId, userId: actorId, action: "social.integration_superseded",
        entityType: "Integration", entityId: old.id,
        metadata: { byIntegrationId: newIntegrationId, provider: "meta_social", pageId },
      });
    }
  }

  // ---------- accounts ----------

  async listAccounts(organizationId: string) {
    const rows = await (this.prisma as any).socialAccount.findMany({
      where: { organizationId }, orderBy: { createdAt: "asc" },
    });
    return (rows as any[]).map((r) => this.serializeAccount(r));
  }

  /**
   * Detach ONE social account (AD2 discipline). The account row and
   * ALL its posts stay — only the connection is severed. When the
   * account's integration is shared (Page + Instagram on one Page
   * token) the integration and credential stay alive for the other
   * account; only the LAST referencer's disconnect deletes the
   * credential rows and marks the integration DISCONNECTED.
   * Idempotent for an account with no integration.
   */
  async disconnectAccount(organizationId: string, actorId: string, accountId: string) {
    const account = await (this.prisma as any).socialAccount.findFirst({ where: { id: accountId, organizationId } });
    if (!account) throw new NotFoundException("Social account not found in this organization");
    let shared = false;
    if (account.integrationId) {
      const integrationId: string = account.integrationId;
      const refs = await (this.prisma as any).socialAccount.findMany({ where: { organizationId, integrationId } });
      shared = Array.isArray(refs) && refs.length > 1;
      const updated = await (this.prisma as any).socialAccount.update({
        where: { id: account.id }, data: { integrationId: null, status: "disconnected" },
      });
      if (!shared) {
        await (this.prisma as any).integrationCredential.deleteMany({ where: { integrationId } });
        await (this.prisma as any).integration.update({
          where: { id: integrationId }, data: { status: "DISCONNECTED" },
        }).catch(() => undefined); // a dangling integrationId still detaches cleanly
      }
      await this.audit.log({
        organizationId, userId: actorId, action: "social.account_disconnected",
        entityType: "SocialAccount", entityId: account.id, metadata: { shared },
      });
      return this.serializeAccount(updated);
    }
    const updated = await (this.prisma as any).socialAccount.update({
      where: { id: account.id }, data: { status: "disconnected" },
    });
    await this.audit.log({
      organizationId, userId: actorId, action: "social.account_disconnected",
      entityType: "SocialAccount", entityId: account.id, metadata: { shared: false },
    });
    return this.serializeAccount(updated);
  }

  // ---------- media ----------

  async uploadMedia(organizationId: string, actorId: string, dto: UploadSocialMediaDto) {
    const raw = (dto.dataBase64 ?? "").replace(/^data:[^;]+;base64,/, "").replace(/\s/g, "");
    if (!raw || !/^[A-Za-z0-9+/]*={0,2}$/.test(raw) || raw.length % 4 !== 0) {
      throw new BadRequestException("ছবি/ভিডিওর ডেটা সঠিক base64 নয় — আবার আপলোড করে চেষ্টা করুন।");
    }
    const bytes = Buffer.from(raw, "base64");
    if (bytes.length === 0) {
      throw new BadRequestException("ছবি/ভিডিওর ডেটা সঠিক base64 নয় — আবার আপলোড করে চেষ্টা করুন।");
    }
    if (bytes.length > SOCIAL_MEDIA_MAX_BYTES) {
      // PP2: this base64 path stays the small-file path (the JSON
      // body limit sits just above this cap anyway). Larger files
      // — real videos — go through the streamed file upload.
      throw new BadRequestException(`এই পথে ফাইলের আকার সর্বোচ্চ ${formatBytesMb(SOCIAL_MEDIA_MAX_BYTES)} হতে পারবে — বড় ভিডিওর জন্য ফাইল আপলোড ব্যবহার করুন।`);
    }
    // Magic bytes decide — the declared type is never trusted.
    const detected = detectMediaKind(bytes, dto.contentType);
    if (!detected || !(SOCIAL_MEDIA_KINDS as readonly string[]).includes(detected.kind)) {
      throw new BadRequestException("শুধু ছবি বা ভিডিও আপলোড করা যাবে।");
    }
    const assetId = randomUUID();
    const storageKey = `${organizationId}/social/${assetId}.${extForContentType(detected.contentType)}`;
    await MediaStore.fromEnv().put(storageKey, bytes, detected.contentType);
    const name = dto.fileName?.trim() || defaultMediaFileName(detected.kind, detected.contentType);
    const asset = await (this.prisma as any).mediaAsset.create({
      data: {
        id: assetId, organizationId, kind: detected.kind, name,
        contentType: detected.contentType, sizeBytes: bytes.length,
        storageKey, createdById: actorId,
      },
    });
    await this.audit.log({
      organizationId, userId: actorId, action: "social.media_uploaded",
      entityType: "MediaAsset", entityId: asset.id,
      metadata: { kind: detected.kind, contentType: detected.contentType, sizeBytes: bytes.length },
    });
    return this.serializeAsset(asset);
  }

  /** The upload caps the UI shows (GET media/limits). */
  mediaLimits() {
    return { imageMaxBytes: SOCIAL_MEDIA_MAX_BYTES, videoMaxBytes: socialVideoMaxBytes() };
  }

  /**
   * PP2 — streamed file upload (the composer's file picker posts
   * the raw file as the request body; no multipart parser, no
   * base64, and above all NO whole-file buffer in memory).
   *
   * The request stream is piped into a temp file while bytes are
   * counted; the first bytes are sniffed (magic bytes decide the
   * kind — the declared Content-Type only breaks container ties,
   * exactly like detectMediaKind) and the SNIFFED kind picks the
   * cap: images the image cap, videos the video cap. Crossing the
   * applicable cap ABORTS the stream mid-flight. Only after the
   * temp file is complete is it streamed into MediaStore and the
   * asset row created — so an aborted or invalid upload leaves
   * NO asset row and NO stored file (a failed row-create deletes
   * the just-stored object). The temp file is removed on every
   * path.
   */
  async uploadMediaStream(organizationId: string, actorId: string, input: {
    stream: Readable; declaredContentType?: string; fileName?: string;
  }) {
    const imageCap = SOCIAL_MEDIA_MAX_BYTES;
    const videoCap = socialVideoMaxBytes();
    const tempPath = join(tmpdir(), `social-upload-${randomUUID()}`);
    let total = 0;
    let head = Buffer.alloc(0);
    let sniffed: ReturnType<typeof detectMediaKind> = null;
    let sniffDone = false;
    let cap = videoCap; // until the head says otherwise: images tighten it below
    let capKind: "image" | "video" | null = null;
    const ws = createWriteStream(tempPath);
    const wsError = new Promise<never>((_resolve, reject) => ws.once("error", reject));
    void wsError.catch(() => undefined); // raced where needed; never an unhandled rejection
    try {
      for await (const chunk of input.stream as AsyncIterable<Buffer | Uint8Array>) {
        const buf = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
        total += buf.length;
        if (head.length < 512) {
          head = Buffer.concat([head, buf.subarray(0, 512 - head.length)]);
          if (!sniffDone && head.length >= 16) {
            sniffDone = true;
            sniffed = detectMediaKind(head, input.declaredContentType);
            if (sniffed?.kind === "video") { capKind = "video"; }
            else {
              // Images — and, conservatively, anything the magic
              // bytes do not recognise — get the small cap; the
              // post-stream check refuses unknown kinds anyway.
              cap = imageCap; capKind = "image";
            }
          }
        }
        if (total > cap) {
          (input.stream as Readable).destroy?.();
          throw new BadRequestException(capKind === "video"
            ? `ভিডিওর আকার সর্বোচ্চ ${formatBytesMb(videoCap)} হতে পারবে।`
            : `ফাইলের আকার সর্বোচ্চ ${formatBytesMb(imageCap)} হতে পারবে।`);
        }
        if (!ws.write(buf)) await Promise.race([new Promise<void>((r) => ws.once("drain", r)), wsError]);
      }
      await Promise.race([new Promise<void>((resolve) => ws.end(() => resolve())), wsError]);
    } catch (e) {
      ws.destroy();
      await unlink(tempPath).catch(() => undefined);
      throw e;
    }

    try {
      // Definitive sniff on the captured head (a short file may
      // never have reached the mid-stream sniff threshold).
      const detected = sniffed ?? detectMediaKind(head, input.declaredContentType);
      if (!detected || !(SOCIAL_MEDIA_KINDS as readonly string[]).includes(detected.kind)) {
        throw new BadRequestException("শুধু ছবি বা ভিডিও আপলোড করা যাবে।");
      }
      // The sniffed kind owns the cap — an image that slipped in
      // under the (larger) early cap is still refused here.
      if (detected.kind === "image" && total > imageCap) {
        throw new BadRequestException(`ছবির আকার সর্বোচ্চ ${formatBytesMb(imageCap)} হতে পারবে।`);
      }
      if (detected.kind === "video" && total > videoCap) {
        throw new BadRequestException(`ভিডিওর আকার সর্বোচ্চ ${formatBytesMb(videoCap)} হতে পারবে।`);
      }
      if (total === 0) {
        throw new BadRequestException("ফাঁকা ফাইল আপলোড করা যাবে না।");
      }
      const assetId = randomUUID();
      const storageKey = `${organizationId}/social/${assetId}.${extForContentType(detected.contentType)}`;
      const store = MediaStore.fromEnv();
      const written = await store.putStream(storageKey, createReadStream(tempPath), detected.contentType);
      if (written !== total) {
        await store.delete(storageKey).catch(() => undefined);
        throw new BadRequestException("ফাইল সংরক্ষণ অসম্পূর্ণ হয়েছে — আবার আপলোড করে চেষ্টা করুন।");
      }
      let asset: any;
      try {
        asset = await (this.prisma as any).mediaAsset.create({
          data: {
            id: assetId, organizationId, kind: detected.kind,
            name: input.fileName?.trim() || defaultMediaFileName(detected.kind, detected.contentType),
            contentType: detected.contentType, sizeBytes: total,
            storageKey, createdById: actorId,
          },
        });
      } catch (e) {
        // No orphan objects: the row is the only handle to the file.
        await store.delete(storageKey).catch(() => undefined);
        throw e;
      }
      await this.audit.log({
        organizationId, userId: actorId, action: "social.media_uploaded",
        entityType: "MediaAsset", entityId: asset.id,
        metadata: { kind: detected.kind, contentType: detected.contentType, sizeBytes: total, via: "stream" },
      });
      return this.serializeAsset(asset);
    } finally {
      await unlink(tempPath).catch(() => undefined);
    }
  }

  async listMedia(organizationId: string) {
    const rows = await (this.prisma as any).mediaAsset.findMany({
      where: { organizationId }, orderBy: { createdAt: "desc" }, take: 200,
    });
    return (rows as any[]).map((r) => this.serializeAsset(r));
  }

  private async getAsset(organizationId: string, assetId: string) {
    const asset = await (this.prisma as any).mediaAsset.findFirst({ where: { id: assetId, organizationId } });
    if (!asset) throw new NotFoundException("Media asset not found in this organization");
    return asset;
  }

  async getMediaFile(organizationId: string, assetId: string): Promise<{ bytes: Buffer; contentType: string }> {
    const asset = await this.getAsset(organizationId, assetId);
    const bytes = await MediaStore.fromEnv().get(asset.storageKey);
    if (!bytes) throw new NotFoundException("Media bytes not found in storage");
    return { bytes, contentType: asset.contentType };
  }

  /**
   * Opt-in public link: tenant media is private by default; only
   * an explicit action mints the unguessable token (Instagram
   * publishing needs a public media URL). Idempotent — an existing
   * token is returned unchanged. The token itself is NEVER put in
   * audit metadata.
   */
  async createPublicLink(organizationId: string, actorId: string, assetId: string) {
    const asset = await this.getAsset(organizationId, assetId);
    if (asset.publicToken) return this.serializeAsset(asset);
    const updated = await (this.prisma as any).mediaAsset.update({
      where: { id: asset.id }, data: { publicToken: randomBytes(32).toString("base64url") },
    });
    await this.audit.log({
      organizationId, userId: actorId, action: "social.media_public_link_created",
      entityType: "MediaAsset", entityId: asset.id, metadata: { assetId: asset.id },
    });
    return this.serializeAsset(updated);
  }

  async removePublicLink(organizationId: string, actorId: string, assetId: string) {
    const asset = await this.getAsset(organizationId, assetId);
    const updated = await (this.prisma as any).mediaAsset.update({
      where: { id: asset.id }, data: { publicToken: null },
    });
    await this.audit.log({
      organizationId, userId: actorId, action: "social.media_public_link_removed",
      entityType: "MediaAsset", entityId: asset.id, metadata: { assetId: asset.id },
    });
    return this.serializeAsset(updated);
  }

  /** Public route resolution: token → bytes, or null (→ 404). */
  async resolvePublicMedia(token: string): Promise<{ bytes: Buffer; contentType: string } | null> {
    if (!token) return null;
    const asset = await (this.prisma as any).mediaAsset.findFirst({ where: { publicToken: token } });
    if (!asset) return null;
    const bytes = await MediaStore.fromEnv().get(asset.storageKey);
    if (!bytes) return null;
    return { bytes, contentType: asset.contentType };
  }

  /**
   * PP2 — the streamed twin of getMediaFile: same org scoping and
   * 404s, but the bytes move as a range stream. The file routes
   * serve through this so a large video is never buffered whole.
   */
  async getMediaFileStream(organizationId: string, assetId: string, rangeHeader?: string): Promise<MediaFileStream> {
    const asset = await this.getAsset(organizationId, assetId);
    const file = await this.streamStoredAsset(asset, rangeHeader);
    if (!file) throw new NotFoundException("Media bytes not found in storage");
    return file;
  }

  /** PP2 — streamed twin of resolvePublicMedia (token → stream). */
  async resolvePublicMediaStream(token: string, rangeHeader?: string): Promise<MediaFileStream | null> {
    if (!token) return null;
    const asset = await (this.prisma as any).mediaAsset.findFirst({ where: { publicToken: token } });
    if (!asset) return null;
    return this.streamStoredAsset(asset, rangeHeader);
  }

  private async streamStoredAsset(asset: any, rangeHeader?: string): Promise<MediaFileStream | null> {
    const store = MediaStore.fromEnv();
    const totalSize = typeof asset.sizeBytes === "number" && asset.sizeBytes > 0
      ? asset.sizeBytes
      : await store.size(asset.storageKey);
    if (!totalSize) return null;
    const range = parseSingleRange(rangeHeader, totalSize);
    const opened = await store.getStream(asset.storageKey, range ?? undefined);
    if (!opened) return null;
    const start = range?.start ?? 0;
    const end = range?.end ?? totalSize - 1;
    return {
      stream: opened.stream, contentType: asset.contentType,
      totalSize, start, end, partial: range !== null,
    };
  }

  // ---------- hashtag sets (SP3) ----------

  private serializeHashtagSet(row: any) {
    if (!row) return row;
    return {
      id: row.id, name: row.name,
      tags: Array.isArray(row.tags) ? row.tags : [],
      createdAt: row.createdAt, updatedAt: row.updatedAt,
    };
  }

  private validateHashtagSetName(name: unknown): string {
    const trimmed = typeof name === "string" ? name.trim() : "";
    if (!trimmed) throw new BadRequestException("Set-এর নাম দিন।");
    if (trimmed.length > 80) {
      throw new BadRequestException("Set-এর নাম সর্বোচ্চ ৮০ অক্ষরের হতে পারবে।");
    }
    return trimmed;
  }

  private async assertHashtagSetNameFree(organizationId: string, name: string, excludeId?: string) {
    const rows = await (this.prisma as any).socialHashtagSet.findMany({ where: { organizationId } }).catch(() => []);
    const clash = (Array.isArray(rows) ? rows : []).some(
      (r: any) => r.id !== excludeId && typeof r.name === "string" && r.name.toLowerCase() === name.toLowerCase(),
    );
    if (clash) throw new ConflictException("এই নামে একটি Hashtag Set আগেই আছে।");
  }

  private async getHashtagSetRow(organizationId: string, setId: string) {
    const row = await (this.prisma as any).socialHashtagSet.findFirst({ where: { id: setId, organizationId } });
    if (!row) throw new NotFoundException("Hashtag set not found in this organization");
    return row;
  }

  async listHashtagSets(organizationId: string) {
    const rows = await (this.prisma as any).socialHashtagSet.findMany({
      where: { organizationId }, orderBy: { createdAt: "asc" },
    });
    return (rows as any[]).map((r) => this.serializeHashtagSet(r));
  }

  async createHashtagSet(organizationId: string, actorId: string, dto: CreateHashtagSetDto) {
    const name = this.validateHashtagSetName(dto.name);
    const tags = normalizeHashtagTags(dto.tags);
    await this.assertHashtagSetNameFree(organizationId, name);
    const row = await (this.prisma as any).socialHashtagSet.create({
      data: { organizationId, name, tags, createdById: actorId },
    });
    await this.audit.log({
      organizationId, userId: actorId, action: "social.hashtag_set_created",
      entityType: "SocialHashtagSet", entityId: row.id,
      metadata: { name, tagCount: tags.length },
    });
    return this.serializeHashtagSet(row);
  }

  async updateHashtagSet(organizationId: string, actorId: string, setId: string, dto: UpdateHashtagSetDto) {
    const row = await this.getHashtagSetRow(organizationId, setId);
    const data: Record<string, unknown> = {};
    const fields: string[] = [];
    if (dto.name !== undefined) {
      const name = this.validateHashtagSetName(dto.name);
      await this.assertHashtagSetNameFree(organizationId, name, row.id);
      data.name = name;
      fields.push("name");
    }
    if (dto.tags !== undefined) {
      data.tags = normalizeHashtagTags(dto.tags);
      fields.push("tags");
    }
    const updated = await (this.prisma as any).socialHashtagSet.update({ where: { id: row.id }, data });
    await this.audit.log({
      organizationId, userId: actorId, action: "social.hashtag_set_updated",
      entityType: "SocialHashtagSet", entityId: row.id,
      metadata: { fields },
    });
    return this.serializeHashtagSet(updated);
  }

  async deleteHashtagSet(organizationId: string, actorId: string, setId: string) {
    const row = await this.getHashtagSetRow(organizationId, setId);
    await (this.prisma as any).socialHashtagSet.delete({ where: { id: row.id } });
    await this.audit.log({
      organizationId, userId: actorId, action: "social.hashtag_set_deleted",
      entityType: "SocialHashtagSet", entityId: row.id,
      metadata: { name: row.name },
    });
    return { deleted: true, id: row.id };
  }

  // ---------- posts ----------

  private validateLinkUrl(linkUrl?: string | null): string | null {
    if (linkUrl === undefined || linkUrl === null || linkUrl === "") return null;
    let parsed: URL;
    try { parsed = new URL(linkUrl); } catch {
      throw new BadRequestException("linkUrl সঠিক http(s) URL হতে হবে।");
    }
    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
      throw new BadRequestException("linkUrl সঠিক http(s) URL হতে হবে।");
    }
    return linkUrl;
  }

  private async validateMediaRefs(organizationId: string, mediaRefs?: { assetId: string; kind: string }[]) {
    const refs = mediaRefs ?? [];
    for (const ref of refs) {
      const asset = await (this.prisma as any).mediaAsset.findFirst({ where: { id: ref.assetId, organizationId } });
      if (!asset) throw new BadRequestException(`মিডিয়া asset পাওয়া যায়নি: ${ref.assetId}`);
      if (asset.kind !== ref.kind) {
        throw new BadRequestException(`মিডিয়া asset-এর ধরন মেলে না: ${ref.assetId} (asset-টি ${asset.kind}, দেওয়া হয়েছে ${ref.kind})`);
      }
    }
    return refs.map((r) => ({ assetId: r.assetId, kind: r.kind }));
  }

  private async accountSummary(organizationId: string, accountId: string) {
    return (this.prisma as any).socialAccount.findFirst({ where: { id: accountId, organizationId } });
  }

  async createPost(organizationId: string, actorId: string, dto: CreateSocialPostDto) {
    const account = await this.accountSummary(organizationId, dto.socialAccountId);
    if (!account) throw new NotFoundException("Social account not found in this organization");
    const caption = (dto.caption ?? "").trim();
    if (!caption) throw new BadRequestException("ক্যাপশন খালি রাখা যাবে না।");
    const linkUrl = this.validateLinkUrl(dto.linkUrl);
    const mediaRefs = await this.validateMediaRefs(organizationId, dto.mediaRefs);
    // SP7: with the approval requirement ON, an OWNER/ADMIN's own
    // post is auto-approved at creation (they hold the approve
    // power — making them submit to themselves would be theatre).
    // Everyone else's post carries no approval state until they
    // submit it. With the setting OFF nothing changes at all.
    let approval: Record<string, unknown> = {};
    if (await this.approvalSettingOn(organizationId)) {
      if (this.isApproverRole(await this.actorRole(organizationId, actorId))) {
        approval = { approvalStatus: "approved", submittedById: actorId, reviewedById: actorId };
      }
    }
    const post = await (this.prisma as any).socialPost.create({
      data: {
        organizationId, socialAccountId: account.id, caption, linkUrl,
        mediaRefs, status: "draft", createdById: actorId, ...approval,
      },
    });
    await this.audit.log({
      organizationId, userId: actorId, action: "social.post_created",
      entityType: "SocialPost", entityId: post.id,
      metadata: { socialAccountId: account.id, platform: account.platform },
    });
    return this.serializePost(post, account);
  }

  async listPosts(organizationId: string, query: { status?: string; accountId?: string }) {
    if (query.status !== undefined && !(SOCIAL_POST_STATUSES as readonly string[]).includes(query.status)) {
      throw new BadRequestException(`অবৈধ পোস্ট status: ${query.status}`);
    }
    const where: Record<string, unknown> = { organizationId };
    if (query.status !== undefined) where.status = query.status;
    if (query.accountId !== undefined) where.socialAccountId = query.accountId;
    const posts = await (this.prisma as any).socialPost.findMany({
      where, orderBy: { createdAt: "desc" }, take: 200,
    });
    const accounts = await (this.prisma as any).socialAccount.findMany({ where: { organizationId } }).catch(() => []);
    const byId = new Map<string, any>((Array.isArray(accounts) ? accounts : []).map((a: any) => [a.id as string, a]));
    return (posts as any[]).map((p) => this.serializePost(p, byId.get(p.socialAccountId)));
  }

  private async getPostRow(organizationId: string, postId: string) {
    const post = await (this.prisma as any).socialPost.findFirst({ where: { id: postId, organizationId } });
    if (!post) throw new NotFoundException("Social post not found in this organization");
    return post;
  }

  async getPost(organizationId: string, postId: string) {
    const post = await this.getPostRow(organizationId, postId);
    const account = await this.accountSummary(organizationId, post.socialAccountId);
    return this.serializePost(post, account);
  }

  async updatePost(organizationId: string, actorId: string, postId: string, dto: UpdateSocialPostDto) {
    const post = await this.getPostRow(organizationId, postId);
    if (post.status !== "draft") {
      throw new ConflictException("শুধু Draft পোস্ট সম্পাদনা করা যায়।");
    }
    const data: Record<string, unknown> = {};
    if (dto.caption !== undefined) {
      const caption = dto.caption.trim();
      if (!caption) throw new BadRequestException("ক্যাপশন খালি রাখা যাবে না।");
      data.caption = caption;
    }
    if (dto.linkUrl !== undefined) data.linkUrl = this.validateLinkUrl(dto.linkUrl);
    if (dto.mediaRefs !== undefined) data.mediaRefs = await this.validateMediaRefs(organizationId, dto.mediaRefs);
    // SP7: editing the CONTENT of a post that carries an approval
    // state voids that state — the approval was for the text as
    // reviewed, not for whatever it later becomes. The post must
    // be submitted (and approved) again before it can go out.
    let approvalReset = false;
    if (
      Object.keys(data).length > 0 &&
      ["pending", "approved", "rejected"].includes(post.approvalStatus ?? "") &&
      (await this.approvalSettingOn(organizationId))
    ) {
      data.approvalStatus = null;
      data.submittedById = null;
      data.reviewedById = null;
      data.reviewNote = null;
      approvalReset = true;
    }
    const updated = await (this.prisma as any).socialPost.update({ where: { id: post.id }, data });
    await this.audit.log({
      organizationId, userId: actorId, action: "social.post_updated",
      entityType: "SocialPost", entityId: post.id,
      metadata: { fields: Object.keys(data), ...(approvalReset ? { approvalReset: true } : {}) },
    });
    const account = await this.accountSummary(organizationId, updated.socialAccountId);
    return this.serializePost(updated, account);
  }

  // ---------- SP5: scheduling ----------

  /**
   * Schedule (or re-schedule) a post. Allowed from draft,
   * scheduled and failed; anything else (publishing / published /
   * cancelled / sent_to_creator) is a 409 — those posts are either
   * mid-flight or already terminal. A small 5-minute grace window
   * absorbs client clock skew: a time up to 5 minutes in the past
   * is accepted (the publish worker will simply find it due), a
   * time further back is a Bengali 400.
   *
   * From failed: attempts reset to 0 (a fresh retry budget for the
   * new schedule), but the error is KEPT unchanged — it stays
   * visible as the last error until the next publish attempt
   * replaces it, so the tenant can still see why it failed while
   * deciding when to retry.
   */
  async schedulePost(organizationId: string, actorId: string, postId: string, dto: ScheduleSocialPostDto) {
    const post = await this.getPostRow(organizationId, postId);
    const fromStatus: string = post.status;
    if (!["draft", "scheduled", "failed"].includes(fromStatus)) {
      throw new ConflictException(`এই অবস্থায় পোস্টটি শিডিউল করা যাবে না (বর্তমান অবস্থা: ${fromStatus})।`);
    }
    // SP7 approval gate: while the org requires approval, only an
    // approved post may be scheduled (pending / rejected / never
    // submitted all block, with the reason in the message).
    if ((await this.approvalSettingOn(organizationId)) && post.approvalStatus !== "approved") {
      throw new ConflictException("পোস্টটি অনুমোদিত নয় — অনুমোদন ব্যবস্থা চালু থাকলে শিডিউলের আগে OWNER/ADMIN-এর অনুমোদন লাগবে। আগে পোস্টটি অনুমোদনের জন্য পাঠান।");
    }
    // SP8/SP9: a TikTok/YouTube post without exactly one video
    // can NEVER publish — refuse at schedule time with the reason,
    // instead of letting the tenant discover it at publish time.
    // (The publish path re-checks permanently, for posts scheduled
    // before this rule or edited around it.)
    const schedAccount = await this.accountSummary(organizationId, post.socialAccountId);
    const mediaViolation = videoOnlyViolation(schedAccount?.platform ?? "", post.mediaRefs);
    if (mediaViolation) throw new BadRequestException(mediaViolation);
    const when = new Date(dto.scheduledAt);
    if (Number.isNaN(when.getTime())) {
      throw new BadRequestException("সঠিক তারিখ ও সময় দিন।");
    }
    if (when.getTime() < Date.now() - 5 * 60_000) {
      throw new BadRequestException("শিডিউলের সময় অতীতে হতে পারবে না — ভবিষ্যতের সময় দিন।");
    }
    const fromFailed = fromStatus === "failed";
    const updated = await (this.prisma as any).socialPost.update({
      where: { id: post.id },
      data: { status: "scheduled", scheduledAt: when, ...(fromFailed ? { attempts: 0 } : {}) },
    });
    await this.audit.log({
      organizationId, userId: actorId, action: "social.post_scheduled",
      entityType: "SocialPost", entityId: post.id,
      metadata: { scheduledAt: when.toISOString(), fromStatus },
    });
    const account = await this.accountSummary(organizationId, updated.socialAccountId);
    return this.serializePost(updated, account);
  }

  /** Cancel a schedule: only a scheduled post can go back to draft. */
  async cancelSchedule(organizationId: string, actorId: string, postId: string) {
    const post = await this.getPostRow(organizationId, postId);
    if (post.status !== "scheduled") {
      throw new ConflictException("শুধু শিডিউল করা পোস্টের শিডিউল বাতিল করা যায়।");
    }
    const updated = await (this.prisma as any).socialPost.update({
      where: { id: post.id }, data: { status: "draft", scheduledAt: null },
    });
    await this.audit.log({
      organizationId, userId: actorId, action: "social.post_schedule_cancelled",
      entityType: "SocialPost", entityId: post.id, metadata: {},
    });
    const account = await this.accountSummary(organizationId, updated.socialAccountId);
    return this.serializePost(updated, account);
  }

  async deletePost(organizationId: string, actorId: string, postId: string) {
    const post = await this.getPostRow(organizationId, postId);
    if (post.status !== "draft") {
      throw new ConflictException("শুধু Draft পোস্ট মুছে ফেলা যায়।");
    }
    await (this.prisma as any).socialPost.delete({ where: { id: post.id } });
    await this.audit.log({
      organizationId, userId: actorId, action: "social.post_deleted",
      entityType: "SocialPost", entityId: post.id, metadata: { socialAccountId: post.socialAccountId },
    });
    return { deleted: true, id: post.id };
  }

  // ---------- SP7: org social settings ----------

  async getSocialSettings(organizationId: string) {
    return { socialRequireApproval: await this.approvalSettingOn(organizationId) };
  }

  /** OWNER/ADMIN only (controller-enforced). Audited. */
  async updateSocialSettings(organizationId: string, actorId: string, dto: { socialRequireApproval?: unknown }) {
    const value = dto?.socialRequireApproval === true;
    await (this.prisma as any).organization.update({
      where: { id: organizationId }, data: { socialRequireApproval: value },
    });
    await this.audit.log({
      organizationId, userId: actorId, action: "social.settings_updated",
      entityType: "Organization", entityId: organizationId,
      metadata: { socialRequireApproval: value },
    });
    return { socialRequireApproval: value };
  }

  // ---------- SP7: approval flow ----------
  //
  // The rule set (v1, deliberately simple and stated in the UI):
  // - The flow exists ONLY while Organization.socialRequireApproval
  //   is on. Off → approvalStatus stays null everywhere and every
  //   behaviour is exactly the pre-SP7 one.
  // - Approvers are OWNER/ADMIN only. A MARKETING_MANAGER can
  //   write and submit posts but can never approve — not even
  //   their own.
  // - OWNER/ADMIN-authored posts are auto-approved (at creation,
  //   and a submit by an approver approves immediately).
  // - A pending or rejected post cannot be scheduled or published
  //   (schedulePost / publishNow 409; the publish worker re-checks
  //   at claim time and returns a blocked post to draft).
  // - Rejection REQUIRES a note, which the author sees.

  async submitForApproval(organizationId: string, actorId: string, postId: string) {
    const post = await this.getPostRow(organizationId, postId);
    if (!(await this.approvalSettingOn(organizationId))) {
      throw new BadRequestException("এই Organization-এ পোস্ট অনুমোদন ব্যবস্থা চালু নেই — চালু করতে Social Posts পেজের সেটিংসে যান।");
    }
    if (post.status !== "draft") {
      throw new ConflictException("শুধু Draft পোস্ট অনুমোদনের জন্য পাঠানো যায়।");
    }
    if (post.approvalStatus === "pending") {
      throw new ConflictException("পোস্টটি ইতিমধ্যে অনুমোদনের অপেক্ষায় আছে।");
    }
    if (post.approvalStatus === "approved") {
      throw new ConflictException("পোস্টটি ইতিমধ্যে অনুমোদিত — শিডিউল বা প্রকাশ করতে পারেন।");
    }
    if (this.isApproverRole(await this.actorRole(organizationId, actorId))) {
      const updated = await (this.prisma as any).socialPost.update({
        where: { id: post.id },
        data: { approvalStatus: "approved", submittedById: actorId, reviewedById: actorId, reviewNote: null },
      });
      await this.audit.log({
        organizationId, userId: actorId, action: "social.post_approved",
        entityType: "SocialPost", entityId: post.id, metadata: { autoApproved: true, via: "submit" },
      });
      const account = await this.accountSummary(organizationId, updated.socialAccountId);
      return this.serializePost(updated, account);
    }
    const updated = await (this.prisma as any).socialPost.update({
      where: { id: post.id },
      data: { approvalStatus: "pending", submittedById: actorId, reviewedById: null, reviewNote: null },
    });
    await this.audit.log({
      organizationId, userId: actorId, action: "social.post_approval_submitted",
      entityType: "SocialPost", entityId: post.id, metadata: {},
    });
    const account = await this.accountSummary(organizationId, post.socialAccountId);
    const excerpt = post.caption.length > 120 ? post.caption.slice(0, 120) : post.caption;
    await this.notifyUsers(
      organizationId, await this.approverUserIds(organizationId),
      "social_post_pending_approval",
      `নতুন পোস্ট অনুমোদনের অপেক্ষায়: ${account?.name ?? "Social অ্যাকাউন্ট"}`,
      `${excerpt}\nSocial Posts পেজের অনুমোদনের তালিকা থেকে পোস্টটি দেখে অনুমোদন বা প্রত্যাখ্যান করুন।`,
    );
    return this.serializePost(updated, account);
  }

  async approvePost(organizationId: string, actorId: string, postId: string) {
    const post = await this.getPostRow(organizationId, postId);
    if (!this.isApproverRole(await this.actorRole(organizationId, actorId))) {
      throw new ForbiddenException("শুধু OWNER/ADMIN পোস্ট অনুমোদন করতে পারেন।");
    }
    if (post.approvalStatus !== "pending") {
      throw new ConflictException("পোস্টটি অনুমোদনের অপেক্ষায় নেই।");
    }
    const updated = await (this.prisma as any).socialPost.update({
      where: { id: post.id },
      data: { approvalStatus: "approved", reviewedById: actorId, reviewNote: null },
    });
    await this.audit.log({
      organizationId, userId: actorId, action: "social.post_approved",
      entityType: "SocialPost", entityId: post.id, metadata: {},
    });
    if (post.createdById && post.createdById !== actorId) {
      const account = await this.accountSummary(organizationId, post.socialAccountId);
      await this.notifyUsers(
        organizationId, [post.createdById],
        "social_post_approved",
        `আপনার পোস্ট অনুমোদিত হয়েছে: ${account?.name ?? "Social অ্যাকাউন্ট"}`,
        "পোস্টটি এখন শিডিউল বা প্রকাশ করা যাবে।",
      );
    }
    const account = await this.accountSummary(organizationId, updated.socialAccountId);
    return this.serializePost(updated, account);
  }

  async rejectPost(organizationId: string, actorId: string, postId: string, dto: { note?: unknown }) {
    const post = await this.getPostRow(organizationId, postId);
    if (!this.isApproverRole(await this.actorRole(organizationId, actorId))) {
      throw new ForbiddenException("শুধু OWNER/ADMIN পোস্ট প্রত্যাখ্যান করতে পারেন।");
    }
    const note = typeof dto?.note === "string" ? dto.note.trim() : "";
    if (!note) {
      throw new BadRequestException("প্রত্যাখ্যানের কারণ (note) লিখতে হবে — লেখক যেন বুঝতে পারেন কী ঠিক করতে হবে।");
    }
    if (post.approvalStatus !== "pending") {
      throw new ConflictException("পোস্টটি অনুমোদনের অপেক্ষায় নেই।");
    }
    const updated = await (this.prisma as any).socialPost.update({
      where: { id: post.id },
      data: { approvalStatus: "rejected", reviewedById: actorId, reviewNote: note },
    });
    await this.audit.log({
      organizationId, userId: actorId, action: "social.post_rejected",
      entityType: "SocialPost", entityId: post.id, metadata: { note },
    });
    if (post.createdById && post.createdById !== actorId) {
      const account = await this.accountSummary(organizationId, post.socialAccountId);
      await this.notifyUsers(
        organizationId, [post.createdById],
        "social_post_rejected",
        `আপনার পোস্ট প্রত্যাখ্যাত হয়েছে: ${account?.name ?? "Social অ্যাকাউন্ট"}`,
        `কারণ: ${note}\nপোস্টটি ঠিক করে আবার অনুমোদনের জন্য পাঠান।`,
      );
    }
    const account = await this.accountSummary(organizationId, updated.socialAccountId);
    return this.serializePost(updated, account);
  }
}
