import { BadRequestException, ConflictException, ForbiddenException, Injectable, Logger, NotFoundException, Optional } from "@nestjs/common";
import { isConnectionDenied, isMemberConnectionDenied } from "../common/permission-catalog";
import { randomBytes, randomUUID } from "node:crypto";
import { createReadStream, createWriteStream } from "node:fs";
import { unlink } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Readable } from "node:stream";
import { PrismaService } from "../prisma/prisma.service";
import { AuditService } from "../audit/audit.service";
import { encryptJson } from "../integrations/crypto";
import { resolveTenantAppConfig } from "../connections/tenant-app-config";

/** CC28: a token-paste connect declared appSource "own" but the
 * org has no Meta app of its own saved (the CC4 refusal shape). */
export const OWN_META_NOT_CONFIGURED_MSG =
  "নিজের Meta অ্যাপ কনফিগার করা নেই — আগে কানেক্ট সেন্টারে (কানেক্ট সেন্টার → নিজের অ্যাপ) আপনার Meta অ্যাপটি যোগ করুন, অথবা প্ল্যাটফর্মের অ্যাপ হিসেবে কানেক্ট করুন।";
import { MetaClient } from "../ads/meta/meta.client";
import { MediaStore } from "../inbox/media-store";
import { detectMediaKind, defaultMediaFileName } from "../inbox/media-sniff";
import { SOCIAL_MEDIA_KINDS, SOCIAL_POST_STATUSES } from "./social.constants";
import {
  CreateHashtagSetDto, CreateSocialPostDto, CreateSocialPostGroupDto, MetaSocialConnectDto, MetaSocialDiscoverDto,
  ScheduleSocialPostDto, UpdateHashtagSetDto, UpdateSocialPostDto, UploadSocialMediaDto,
} from "./social.dto";
import { validateForPlatform, videoOnlyViolation } from "./social-preflight";
import { effectiveTiktokAppConfig } from "../common/platform-config";
import { SocialLinkService } from "./social-link.service";
import { clampSocialPostPageLimit, decodeSocialPostCursor, encodeSocialPostCursor, socialPostCursorWhere } from "./social-post-cursor";
import { parseCsv } from "./social-csv";

// SU1: videoOnlyViolation now lives in social-preflight.ts (with
// the rest of the pre-flight rules); re-exported here so existing
// imports from this module keep working.
export { videoOnlyViolation };

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

  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    // SU6: tracked-link tokens are minted at schedule time.
    // LAST param + Optional so existing 2-arg spec constructions
    // keep working; SocialLinkService is a leaf (no cycle).
    @Optional() private readonly links?: SocialLinkService,
  ) {}

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
      // SU3: library organization fields ride along on every
      // asset response (folderId null = folderless).
      folderId: row.folderId ?? null,
      tags: Array.isArray(row.tags) ? row.tags : [],
      derivedFromId: row.derivedFromId ?? null,
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
      // SU1/SU2: group, first comment, recurrence, evergreen.
      postGroupId: row.postGroupId ?? null,
      firstCommentText: row.firstCommentText ?? null,
      firstCommentStatus: row.firstCommentStatus ?? null,
      firstCommentError: row.firstCommentError ?? null,
      firstCommentId: row.firstCommentId ?? null,
      seriesId: row.seriesId ?? null,
      recurrenceFrequency: row.recurrenceFrequency ?? null,
      recurrenceInterval: row.recurrenceInterval ?? null,
      isEvergreen: row.isEvergreen ?? false,
      evergreenMinGapDays: row.evergreenMinGapDays ?? null,
      evergreenMaxCycles: row.evergreenMaxCycles ?? null,
      evergreenCyclesUsed: row.evergreenCyclesUsed ?? 0,
      evergreenLastRecycledAt: row.evergreenLastRecycledAt ?? null,
      // SU5: auto-draft provenance. (SU6's linkToken is a
      // credential-like public token and is deliberately NOT
      // serialized — same discipline as credential material;
      // the UI only learns WHETHER one exists.)
      autoDraftKind: row.autoDraftKind ?? null,
      autoDraftRef: row.autoDraftRef ?? null,
      // SU8: YouTube metadata + cover + story flag.
      youtubeTitle: row.youtubeTitle ?? null,
      youtubeTags: Array.isArray(row.youtubeTags) ? row.youtubeTags : null,
      youtubeCategoryId: row.youtubeCategoryId ?? null,
      youtubeIsShort: row.youtubeIsShort ?? false,
      // SN1: chosen YouTube playlist (null = none).
      youtubePlaylistId: row.youtubePlaylistId ?? null,
      coverAssetId: row.coverAssetId ?? null,
      isStory: row.isStory ?? false,
      hasTrackedLink: !!row.linkToken,
      // SU9: assignee (null = unassigned).
      assignedUserId: row.assignedUserId ?? null,
      createdById: row.createdById, createdAt: row.createdAt, updatedAt: row.updatedAt,
      account: account
        ? { id: account.id, platform: account.platform, name: account.name, username: account.username ?? null }
        : null,
    };
  }

  // SU1: group serializer (posts serialized with their account).
  private serializeGroup(row: any, posts: any[] = []) {
    if (!row) return row;
    return {
      id: row.id, name: row.name, createdById: row.createdById,
      createdAt: row.createdAt, updatedAt: row.updatedAt,
      posts,
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

  /**
   * SU9: is the org's optional two-step approval on? Same
   * defensive read as approvalSettingOn (any problem reads as
   * OFF) so the one-step SP7 flow is untouched while it is off
   * or unknown.
   */
  private async twoStepSettingOn(organizationId: string): Promise<boolean> {
    try {
      const model = (this.prisma as any).organization;
      if (!model?.findFirst) return false;
      const org = await model.findFirst({ where: { id: organizationId } });
      return org?.socialApprovalTwoStep === true;
    } catch {
      return false;
    }
  }

  // ---------- SU9: version snapshots ----------

  /** The version snapshot shape: the post row's CURRENT content
   * values, exactly { caption, linkUrl, mediaRefs,
   * firstCommentText } — nothing else is versioned. */
  private snapshotOfPost(post: any) {
    return {
      caption: post.caption,
      linkUrl: post.linkUrl ?? null,
      mediaRefs: Array.isArray(post.mediaRefs) ? post.mediaRefs.map((r: any) => ({ ...r })) : [],
      firstCommentText: post.firstCommentText ?? null,
    };
  }

  /**
   * Append the next version for a post (versionNo = max + 1).
   * Failure-isolated and model-optional: specs and callers built
   * before SU9 may not carry the SocialPostVersion model, and a
   * version-bookkeeping problem must never fail the content
   * action itself — the same defensive discipline as
   * approvalSettingOn. Returns the created row or null.
   */
  private async recordPostVersion(
    organizationId: string, post: any, kind: "create" | "edit" | "restore", changedById: string,
  ): Promise<any | null> {
    try {
      const model = (this.prisma as any).socialPostVersion;
      if (!model?.create || !model?.findMany) return null;
      const existing = await model.findMany({ where: { organizationId, socialPostId: post.id } });
      const maxNo = (Array.isArray(existing) ? existing : []).reduce(
        (m: number, r: any) => Math.max(m, typeof r?.versionNo === "number" ? r.versionNo : 0), 0,
      );
      return await model.create({
        data: {
          organizationId, socialPostId: post.id, versionNo: maxNo + 1,
          snapshot: this.snapshotOfPost(post), changedById, kind,
        },
      });
    } catch (e) {
      this.logger.warn(`social post version (${kind}) failed for post ${post?.id}: ${e instanceof Error ? e.message : "unknown"}`);
      return null;
    }
  }

  private serializeNote(row: any) {
    if (!row) return row;
    return {
      id: row.id, organizationId: row.organizationId, socialPostId: row.socialPostId,
      authorId: row.authorId, body: row.body,
      createdAt: row.createdAt, updatedAt: row.updatedAt,
    };
  }

  private serializeVersion(row: any) {
    if (!row) return row;
    return {
      id: row.id, organizationId: row.organizationId, socialPostId: row.socialPostId,
      versionNo: row.versionNo, snapshot: row.snapshot ?? null,
      changedById: row.changedById, kind: row.kind, createdAt: row.createdAt,
    };
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
    // CC28: the token-paste connect records WHICH Meta app the
    // token belongs to. "own" is only meaningful when the tenant
    // actually has a Meta app config (the CC4 require-config
    // discipline — the choice is never recorded against nothing).
    const appSource = dto.appSource === "own" ? "own" : "platform";
    if (appSource === "own") {
      const own = await resolveTenantAppConfig(this.prisma as any, organizationId, "meta");
      if (!own) throw new BadRequestException(OWN_META_NOT_CONFIGURED_MSG);
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
        data: { organizationId, provider: "meta_social", status: "CONNECTED", externalAccountId: page.pageId, appSource },
      });
      await (this.prisma as any).integrationCredential.create({
        // The PAGE token is sealed — it is what posting acts with.
        data: { integrationId: integration.id, encryptedData: encryptJson({ accessToken: page.pageAccessToken, pageId: page.pageId }) },
      });
      const pageAccount = await (this.prisma as any).socialAccount.upsert({
        where: { organizationId_platform_externalId: { organizationId, platform: "meta_page", externalId: page.pageId } },
        update: { name: page.name, pictureUrl: page.pictureUrl, integrationId: integration.id, status: "connected", lastError: null, appSource },
        create: {
          organizationId, platform: "meta_page", externalId: page.pageId, name: page.name,
          pictureUrl: page.pictureUrl, integrationId: integration.id, status: "connected", createdById: actorId, appSource,
        },
      });
      accounts.push(pageAccount);
      await this.audit.log({
        organizationId, userId: actorId, action: "social.account_connected",
        entityType: "SocialAccount", entityId: pageAccount.id,
        metadata: { platform: "meta_page", pageId: page.pageId, appSource },
      });
      if (page.instagram) {
        const igAccount = await (this.prisma as any).socialAccount.upsert({
          where: { organizationId_platform_externalId: { organizationId, platform: "instagram", externalId: page.instagram.externalId } },
          update: {
            name: page.name, username: page.instagram.username, pictureUrl: page.instagram.pictureUrl,
            integrationId: integration.id, status: "connected", lastError: null, appSource,
          },
          create: {
            organizationId, platform: "instagram", externalId: page.instagram.externalId, name: page.name,
            username: page.instagram.username, pictureUrl: page.instagram.pictureUrl,
            integrationId: integration.id, status: "connected", createdById: actorId, appSource,
          },
        });
        accounts.push(igAccount);
        await this.audit.log({
          organizationId, userId: actorId, action: "social.account_connected",
          entityType: "SocialAccount", entityId: igAccount.id,
          metadata: { platform: "instagram", pageId: page.pageId, appSource },
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

  /**
   * SN1: the TikTok audit gate as the CURRENT platform-config
   * snapshot sees it (the publish path re-resolves it fresh via
   * ensurePlatformConfig — that read is authoritative). A lookup
   * problem reads as OFF (fail closed: photo posts refuse).
   */
  private tiktokAuditedFlag(): boolean {
    try {
      return effectiveTiktokAppConfig()?.audited === true;
    } catch {
      return false;
    }
  }

  // SU1: validate/normalize the SU1/SU2 create-time fields.
  private normalizeFirstComment(value: string | null | undefined): string | null {
    const trimmed = typeof value === "string" ? value.trim() : "";
    return trimmed ? trimmed : null;
  }

  // SU8: normalize the YouTube/cover/story fields of a create
  // DTO into row data (absent → null/false, the pre-SU8 shape).
  private su8CreateFields(dto: {
    youtubeTitle?: string | null; youtubeTags?: string[] | null; youtubeCategoryId?: string | null;
    youtubeIsShort?: boolean; coverAssetId?: string | null; isStory?: boolean;
    youtubePlaylistId?: string | null;
  }): Record<string, unknown> {
    return {
      youtubeTitle: typeof dto.youtubeTitle === "string" && dto.youtubeTitle.trim() ? dto.youtubeTitle : null,
      youtubeTags: Array.isArray(dto.youtubeTags) ? dto.youtubeTags : null,
      youtubeCategoryId: typeof dto.youtubeCategoryId === "string" && dto.youtubeCategoryId ? dto.youtubeCategoryId : null,
      youtubeIsShort: dto.youtubeIsShort === true,
      // SN1: chosen YouTube playlist (empty/absent = none).
      youtubePlaylistId: typeof dto.youtubePlaylistId === "string" && dto.youtubePlaylistId ? dto.youtubePlaylistId : null,
      coverAssetId: typeof dto.coverAssetId === "string" && dto.coverAssetId ? dto.coverAssetId : null,
      isStory: dto.isStory === true,
    };
  }

  private recurrenceFields(dto: { recurrenceFrequency?: string | null; recurrenceInterval?: number | null }): Record<string, unknown> {
    const frequency = dto.recurrenceFrequency ?? null;
    const interval = dto.recurrenceInterval ?? null;
    if (!frequency && interval !== null) {
      throw new BadRequestException("পুনরাবৃত্তির ব্যবধান দিতে হলে আগে পুনরাবৃত্তির ধরন (প্রতিদিন/সাপ্তাহিক/মাসিক) বেছে দিতে হবে।");
    }
    if (!frequency) return { seriesId: null, recurrenceFrequency: null, recurrenceInterval: null };
    // SU2: a fresh series id binds this post to its future chain.
    return { seriesId: randomUUID(), recurrenceFrequency: frequency, recurrenceInterval: interval };
  }

  /** SP7 auto-approve-at-creation rule, shared by create/clone. */
  private async approvalForCreator(organizationId: string, actorId: string): Promise<Record<string, unknown>> {
    // SP7: with the approval requirement ON, an OWNER/ADMIN's own
    // post is auto-approved at creation (they hold the approve
    // power — making them submit to themselves would be theatre).
    // Everyone else's post carries no approval state until they
    // submit it. With the setting OFF nothing changes at all.
    // SU9 decision: this stays a FULL "approved" even when the
    // two-step setting is also on — the author is themselves of
    // the approver class, so routing their own post through a
    // manager step would be the same theatre SP7 avoided.
    if (await this.approvalSettingOn(organizationId)) {
      if (this.isApproverRole(await this.actorRole(organizationId, actorId))) {
        return { approvalStatus: "approved", submittedById: actorId, reviewedById: actorId };
      }
    }
    return {};
  }

  /**
   * CC17: per-member connection deny-list enforcement for
   * social posting (same M72-family rule as the inbox guard):
   * a member denied a SocialAccount in the Connect Center
   * member-access matrix cannot create, schedule or publish
   * posts for it. OWNER memberships never deny.
   */
  async assertAccountAccess(organizationId: string, actorId: string, socialAccountId: string) {
    if (!socialAccountId || !actorId) return;
    // Defensive read (the codebase's safeFindMany discipline):
    // if the membership lookup itself is unavailable there is
    // no deny-list to enforce — the guard must never take down
    // every post creation with it.
    const membership = await (this.prisma as any).membership?.findFirst({
      where: { organizationId, userId: actorId, status: "ACTIVE" },
    }).catch(() => null);
    if (!membership) return;
    if (isConnectionDenied(membership, socialAccountId)) {
      throw new ForbiddenException("এই সোশ্যাল অ্যাকাউন্টে পোস্ট করার অনুমতি আপনাকে দেওয়া হয়নি — Connect Center-এর অ্যাক্সেস সেটিংস দেখুন বা OWNER/ADMIN-কে বলুন।");
    }
  }

  /**
   * CC27: the non-throwing form of the deny check, for SYSTEM
   * paths that must record a refusal instead of surfacing one —
   * the scheduled publish sweep re-checks the post AUTHOR here
   * at publish time (a post scheduled while allowed, then the
   * account gets denied, must not ride through). Same defensive
   * read + M72 semantics as assertAccountAccess.
   */
  async isAccountDenied(organizationId: string, actorId: string | null | undefined, socialAccountId: string | null | undefined): Promise<boolean> {
    return isMemberConnectionDenied(this.prisma as any, organizationId, actorId, socialAccountId);
  }

  private async validatePostVariant(organizationId: string, actorId: string, dto: CreateSocialPostDto) {
    const account = await this.accountSummary(organizationId, dto.socialAccountId);
    if (!account) throw new NotFoundException("Social account not found in this organization");
    await this.assertAccountAccess(organizationId, actorId, account.id);
    const caption = (dto.caption ?? "").trim();
    if (!caption) throw new BadRequestException("ক্যাপশন খালি রাখা যাবে না।");
    const linkUrl = this.validateLinkUrl(dto.linkUrl);
    const mediaRefs = await this.validateMediaRefs(organizationId, dto.mediaRefs);
    const firstCommentText = this.normalizeFirstComment(dto.firstCommentText);
    const recurrence = this.recurrenceFields(dto);
    const su8 = this.su8CreateFields(dto);
    return { account, caption, linkUrl, mediaRefs, firstCommentText, recurrence, su8 };
  }

  /** SU1: the single row-creation path behind createPost and
   * createPostGroup (and the validation it shares). */
  private async createPostRow(
    organizationId: string, actorId: string, dto: CreateSocialPostDto,
    groupId?: string | null, prepared?: Awaited<ReturnType<SocialService["validatePostVariant"]>>,
  ) {
    const v = prepared ?? (await this.validatePostVariant(organizationId, actorId, dto));
    const approval = await this.approvalForCreator(organizationId, actorId);
    const post = await (this.prisma as any).socialPost.create({
      data: {
        organizationId, socialAccountId: v.account.id, caption: v.caption, linkUrl: v.linkUrl,
        mediaRefs: v.mediaRefs, status: "draft", createdById: actorId, ...approval,
        ...(groupId ? { postGroupId: groupId } : {}),
        firstCommentText: v.firstCommentText,
        firstCommentStatus: v.firstCommentText ? "pending" : null,
        ...v.recurrence,
        ...v.su8,
      },
    });
    // SU9: version 1 (kind "create") for every post born on this
    // main creation path — createPost AND createPostGroup both
    // funnel through createPostRow, so group variants are
    // versioned too. The other creation paths (clonePost,
    // derivePost, commerce auto-drafts, recurrence/evergreen
    // copies) create rows directly and do NOT get a version —
    // a documented SU9 limit.
    await this.recordPostVersion(organizationId, post, "create", actorId);
    await this.audit.log({
      organizationId, userId: actorId, action: "social.post_created",
      entityType: "SocialPost", entityId: post.id,
      metadata: { socialAccountId: v.account.id, platform: v.account.platform },
    });
    return { post, account: v.account };
  }

  async createPost(organizationId: string, actorId: string, dto: CreateSocialPostDto) {
    const { post, account } = await this.createPostRow(organizationId, actorId, dto);
    return this.serializePost(post, account);
  }

  /** SU1: create a group + one draft post per variant. Every
   * variant is validated BEFORE anything is written; if a later
   * write still fails, the posts/group created so far are deleted
   * best-effort and the original error is rethrown. */
  async createPostGroup(organizationId: string, actorId: string, dto: CreateSocialPostGroupDto) {
    const name = (dto.name ?? "").trim();
    if (!name) throw new BadRequestException("Group-এর নাম দিন।");
    const variants = Array.isArray(dto.variants) ? dto.variants : [];
    if (variants.length === 0) throw new BadRequestException("Group-এ অন্তত একটি Variant দিতে হবে।");
    const prepared: Awaited<ReturnType<SocialService["validatePostVariant"]>>[] = [];
    for (const variant of variants) {
      prepared.push(await this.validatePostVariant(organizationId, actorId, variant));
    }
    const group = await (this.prisma as any).socialPostGroup.create({
      data: { organizationId, name, createdById: actorId },
    });
    const created: { post: any; account: any }[] = [];
    try {
      for (let i = 0; i < variants.length; i++) {
        created.push(await this.createPostRow(organizationId, actorId, variants[i], group.id, prepared[i]));
      }
    } catch (e) {
      for (const c of created) {
        await (this.prisma as any).socialPost.delete({ where: { id: c.post.id } }).catch(() => undefined);
      }
      await (this.prisma as any).socialPostGroup.delete({ where: { id: group.id } }).catch(() => undefined);
      throw e;
    }
    await this.audit.log({
      organizationId, userId: actorId, action: "social.post_group_created",
      entityType: "SocialPostGroup", entityId: group.id,
      metadata: { name, variantCount: created.length },
    });
    return this.serializeGroup(group, created.map((c) => this.serializePost(c.post, c.account)));
  }

  async listGroups(organizationId: string) {
    const groups = await (this.prisma as any).socialPostGroup.findMany({
      where: { organizationId }, orderBy: { createdAt: "asc" },
    });
    const out: any[] = [];
    for (const group of Array.isArray(groups) ? groups : []) {
      out.push(await this.groupWithPosts(organizationId, group));
    }
    return out;
  }

  private async groupWithPosts(organizationId: string, group: any) {
    const posts = await (this.prisma as any).socialPost.findMany({
      where: { organizationId, postGroupId: group.id }, orderBy: { createdAt: "asc" },
    }).catch(() => []);
    const serialized: any[] = [];
    for (const p of Array.isArray(posts) ? posts : []) {
      const account = await this.accountSummary(organizationId, p.socialAccountId);
      serialized.push(this.serializePost(p, account));
    }
    return this.serializeGroup(group, serialized);
  }

  async getGroup(organizationId: string, groupId: string) {
    const group = await (this.prisma as any).socialPostGroup.findFirst({ where: { id: groupId, organizationId } });
    if (!group) throw new NotFoundException("Social post group not found in this organization");
    return this.groupWithPosts(organizationId, group);
  }

  /** SU1: clone any post (published included) into a fresh draft.
   * Platform/publish state is never copied; recurrence is not
   * copied (a clone is a new single post); evergreen CONFIG is
   * copied with its cycle counters reset. A grouped source gets a
   * NEW group carrying the clone alone. */
  async clonePost(organizationId: string, actorId: string, postId: string) {
    const source = await this.getPostRow(organizationId, postId);
    let newGroupId: string | null = null;
    if (source.postGroupId) {
      const sourceGroup = await (this.prisma as any).socialPostGroup?.findFirst?.({
        where: { id: source.postGroupId, organizationId },
      }).catch(() => null);
      const group = await (this.prisma as any).socialPostGroup.create({
        data: { organizationId, name: sourceGroup?.name ?? "Copy", createdById: actorId },
      });
      newGroupId = group.id;
    }
    const approval = await this.approvalForCreator(organizationId, actorId);
    const firstCommentText = source.firstCommentText ?? null;
    const post = await (this.prisma as any).socialPost.create({
      data: {
        organizationId, socialAccountId: source.socialAccountId,
        caption: source.caption, linkUrl: source.linkUrl ?? null,
        mediaRefs: Array.isArray(source.mediaRefs) ? source.mediaRefs.map((r: any) => ({ ...r })) : [],
        status: "draft", createdById: actorId, ...approval,
        postGroupId: newGroupId,
        firstCommentText,
        firstCommentStatus: firstCommentText ? "pending" : null,
        firstCommentError: null, firstCommentId: null,
        isEvergreen: source.isEvergreen ?? false,
        evergreenMinGapDays: source.evergreenMinGapDays ?? null,
        evergreenMaxCycles: source.evergreenMaxCycles ?? null,
        evergreenCyclesUsed: 0, evergreenLastRecycledAt: null,
        // SU8: YouTube fields + cover + story flag ride the clone.
        youtubeTitle: source.youtubeTitle ?? null,
        youtubeTags: Array.isArray(source.youtubeTags) ? [...source.youtubeTags] : null,
        youtubeCategoryId: source.youtubeCategoryId ?? null,
        youtubeIsShort: source.youtubeIsShort ?? false,
        youtubePlaylistId: source.youtubePlaylistId ?? null,
        coverAssetId: source.coverAssetId ?? null,
        isStory: source.isStory ?? false,
      },
    });
    await this.audit.log({
      organizationId, userId: actorId, action: "social.post_cloned",
      entityType: "SocialPost", entityId: post.id,
      metadata: { sourcePostId: source.id },
    });
    const account = await this.accountSummary(organizationId, post.socialAccountId);
    return this.serializePost(post, account);
  }

  /**
   * SU8 — cross-post derive: copy one post's content into a fresh
   * DRAFT for each target account. Per-target discipline:
   * - the account must belong to the org and be connected;
   * - the draft content (WITHOUT isStory — a story never derives)
   *   must pass validateForPlatform for the target platform;
   * a failing target is SKIPPED with a warning, never a hard
   * failure of the whole derive. TikTok targets always get an
   * extra warning: the video will land in the creator inbox, not
   * published. Group: the source's group is reused when it has
   * one; otherwise a new group is created and the SOURCE is
   * moved into it too, so the family is visible together.
   */
  async derivePost(organizationId: string, actorId: string, postId: string, accountIds: string[]) {
    const source = await this.getPostRow(organizationId, postId);
    const ids = [...new Set(Array.isArray(accountIds) ? accountIds : [])];
    if (ids.length === 0) throw new BadRequestException("অন্তত একটি Target অ্যাকাউন্ট বেছে দিন।");

    let groupId: string | null = source.postGroupId ?? null;
    if (!groupId) {
      const name = String(source.caption ?? "").trim().slice(0, 60) || "Derived post";
      const group = await (this.prisma as any).socialPostGroup.create({
        data: { organizationId, name, createdById: actorId },
      });
      groupId = group.id;
      await (this.prisma as any).socialPost.update({
        where: { id: source.id }, data: { postGroupId: groupId },
      });
    }

    const mediaRefs = Array.isArray(source.mediaRefs) ? source.mediaRefs.map((r: any) => ({ ...r })) : [];
    const approval = await this.approvalForCreator(organizationId, actorId);
    const firstCommentText = source.firstCommentText ?? null;
    const created: any[] = [];
    const warnings: { accountId: string; message: string }[] = [];

    for (const accountId of ids) {
      const account = await this.accountSummary(organizationId, accountId).catch(() => null);
      if (!account) {
        warnings.push({ accountId, message: "অ্যাকাউন্টটি এই Organization-এ পাওয়া যায়নি।" });
        continue;
      }
      if (account.status !== "connected") {
        warnings.push({ accountId, message: "অ্যাকাউন্টটি এখন সংযুক্ত নেই — আগে কানেক্ট করুন।" });
        continue;
      }
      const violation = validateForPlatform(
        { caption: source.caption, mediaRefs, tiktokAudited: this.tiktokAuditedFlag() },
        account.platform ?? "",
      );
      if (violation) {
        warnings.push({ accountId, message: violation });
        continue;
      }
      const post = await (this.prisma as any).socialPost.create({
        data: {
          organizationId, socialAccountId: account.id,
          caption: source.caption, linkUrl: source.linkUrl ?? null,
          mediaRefs, status: "draft", createdById: actorId, ...approval,
          postGroupId: groupId,
          firstCommentText,
          firstCommentStatus: firstCommentText ? "pending" : null,
          // SU8 fields copied; isStory is deliberately NOT
          // copied (pre-flight above also ran without it).
          youtubeTitle: source.youtubeTitle ?? null,
          youtubeTags: Array.isArray(source.youtubeTags) ? [...source.youtubeTags] : null,
          youtubeCategoryId: source.youtubeCategoryId ?? null,
          youtubeIsShort: source.youtubeIsShort ?? false,
          youtubePlaylistId: source.youtubePlaylistId ?? null,
          coverAssetId: source.coverAssetId ?? null,
          isStory: false,
        },
      });
      created.push(this.serializePost(post, account));
      if (account.platform === "tiktok") {
        warnings.push({
          accountId,
          message: "TikTok-এ ভিডিওটি Creator-এর Inbox-এ যাবে — সেখান থেকে post সম্পূর্ণ করতে হবে, সরাসরি Published হবে না।",
        });
      }
    }

    await this.audit.log({
      organizationId, userId: actorId, action: "social.post_derived",
      entityType: "SocialPost", entityId: source.id,
      metadata: { createdCount: created.length, warningCount: warnings.length, postGroupId: groupId },
    });
    return { created, warnings };
  }

  async listPosts(organizationId: string, query: {
    status?: string; accountId?: string; assignedUserId?: string;
    // SU11: caption search (contains, insensitive) — applies in
    // both modes, only when the caller passes it.
    q?: string;
    // SU11: cursor pagination is OPT-IN (IN9 discipline) — cursor
    // mode is entered only when `cursor` or `limit` is PRESENT in
    // the query object (the controller passes those keys only when
    // the HTTP param was given). `cursor: null` = first page; a
    // malformed cursor string decodes to null and also starts at
    // the first page (never a 400). Cursor mode returns
    // { items, nextCursor }; without it the response stays the
    // exact legacy bare array (take 200, createdAt desc).
    cursor?: string | null; limit?: number;
  }): Promise<any> {
    if (query.status !== undefined && !(SOCIAL_POST_STATUSES as readonly string[]).includes(query.status)) {
      throw new BadRequestException(`অবৈধ পোস্ট status: ${query.status}`);
    }
    const where: Record<string, unknown> = { organizationId };
    if (query.status !== undefined) where.status = query.status;
    if (query.accountId !== undefined) where.socialAccountId = query.accountId;
    // SU9: assignee filter applies ONLY when the caller passes it.
    if (query.assignedUserId !== undefined) where.assignedUserId = query.assignedUserId;
    if (query.q !== undefined && query.q.trim()) where.caption = { contains: query.q.trim(), mode: "insensitive" };
    const paginated = query.cursor !== undefined || query.limit !== undefined;
    const accounts = await (this.prisma as any).socialAccount.findMany({ where: { organizationId } }).catch(() => []);
    const byId = new Map<string, any>((Array.isArray(accounts) ? accounts : []).map((a: any) => [a.id as string, a]));
    if (!paginated) {
      const posts = await (this.prisma as any).socialPost.findMany({
        where, orderBy: { createdAt: "desc" }, take: 200,
      });
      return (posts as any[]).map((p) => this.serializePost(p, byId.get(p.socialAccountId)));
    }
    // SU11 cursor mode: canonical order (createdAt DESC, id DESC)
    // — the same createdAt-desc order the legacy list has always
    // used, with id as the deterministic tie-break. The cursor
    // clause AND-composes with every filter above; fetching
    // limit+1 proves whether another page exists.
    const pageLimit = clampSocialPostPageLimit(query.limit);
    if (query.cursor) {
      const boundary = decodeSocialPostCursor(query.cursor);
      if (boundary) where.AND = [...((where.AND as unknown[]) ?? []), socialPostCursorWhere(boundary)];
    }
    const rows = await (this.prisma as any).socialPost.findMany({
      where, orderBy: [{ createdAt: "desc" }, { id: "desc" }], take: pageLimit + 1,
    });
    const pageRows = (rows as any[]).slice(0, pageLimit);
    const last = pageRows[pageRows.length - 1];
    const nextCursor = (rows as any[]).length > pageLimit && last ? encodeSocialPostCursor(last) : null;
    return {
      items: pageRows.map((p) => this.serializePost(p, byId.get(p.socialAccountId))),
      nextCursor,
    };
  }

  // ---------- SU11: bulk actions + CSV import ----------

  /**
   * Bulk action over a set of posts. Whole-request failures are
   * Bengali 400s (no ids / more than 100 ids / unknown action /
   * reschedule without a valid, non-past scheduledAt); everything
   * per-post is reported per item ({ id, ok, error? }) so one bad
   * post never blocks the rest. Exactly ONE audit row records the
   * action + counts.
   */
  async bulkPosts(organizationId: string, actorId: string, dto: { ids?: unknown; action?: unknown; scheduledAt?: unknown }) {
    const ids = [...new Set((Array.isArray(dto?.ids) ? dto.ids : []).filter((x): x is string => typeof x === "string" && !!x))];
    if (ids.length === 0) {
      throw new BadRequestException("কোনো পোস্ট বেছে নেওয়া হয়নি — অন্তত একটি পোস্ট বেছে দিন।");
    }
    if (ids.length > 100) {
      throw new BadRequestException("একবারে সর্বোচ্চ ১০০টি পোস্টে Bulk কাজ করা যায়।");
    }
    const action = dto?.action;
    if (action !== "delete_drafts" && action !== "reschedule") {
      throw new BadRequestException("অজানা Bulk কাজ — delete_drafts অথবা reschedule পাঠান।");
    }
    let when: Date | null = null;
    if (action === "reschedule") {
      if (typeof dto?.scheduledAt !== "string" || !dto.scheduledAt.trim()) {
        throw new BadRequestException("Reschedule করতে হলে নতুন তারিখ ও সময় (scheduledAt) দিতে হবে।");
      }
      when = new Date(dto.scheduledAt);
      if (Number.isNaN(when.getTime())) {
        throw new BadRequestException("সঠিক তারিখ ও সময় দিন।");
      }
      // Same 5-minute grace window schedulePost allows.
      if (when.getTime() < Date.now() - 5 * 60_000) {
        throw new BadRequestException("শিডিউলের সময় অতীতে হতে পারবে না — ভবিষ্যতের সময় দিন।");
      }
    }
    const approvalOn = action === "reschedule" ? await this.approvalSettingOn(organizationId) : false;
    const results: { id: string; ok: boolean; error?: string }[] = [];
    for (const id of ids) {
      const post = await (this.prisma as any).socialPost.findFirst({ where: { id, organizationId } }).catch(() => null);
      if (!post) {
        results.push({ id, ok: false, error: "পোস্টটি এই Organization-এ পাওয়া যায়নি।" });
        continue;
      }
      if (action === "delete_drafts") {
        if (post.status !== "draft") {
          results.push({ id, ok: false, error: "শুধু Draft পোস্ট মুছে ফেলা যায়।" });
          continue;
        }
        await (this.prisma as any).socialPost.delete({ where: { id: post.id } });
        results.push({ id, ok: true });
        continue;
      }
      // reschedule
      if (post.status !== "draft" && post.status !== "scheduled") {
        results.push({ id, ok: false, error: `এই অবস্থায় পোস্টটি শিডিউল করা যাবে না (বর্তমান অবস্থা: ${post.status})।` });
        continue;
      }
      if (approvalOn && post.approvalStatus !== "approved") {
        results.push({ id, ok: false, error: "পোস্টটি অনুমোদিত নয় — অনুমোদন ব্যবস্থা চালু থাকলে শিডিউলের আগে OWNER/ADMIN-এর অনুমোদন লাগবে। আগে পোস্টটি অনুমোদনের জন্য পাঠান।" });
        continue;
      }
      const account = await this.accountSummary(organizationId, post.socialAccountId);
      const violation = validateForPlatform(
        { caption: post.caption, mediaRefs: post.mediaRefs, isStory: post.isStory ?? null, tiktokAudited: this.tiktokAuditedFlag() },
        account?.platform ?? "",
      );
      if (violation) {
        results.push({ id, ok: false, error: violation });
        continue;
      }
      const updated = await (this.prisma as any).socialPost.update({
        where: { id: post.id }, data: { status: "scheduled", scheduledAt: when },
      });
      // SU6 parity with schedulePost: a scheduled post with a link
      // gets its tracked-link token now (failure-isolated).
      if (post.linkUrl && this.links) {
        await this.links.ensureLinkToken(organizationId, updated).catch((e) => {
          this.logger.warn(`social link token failed for post ${post.id}: ${e instanceof Error ? e.message : "unknown"}`);
        });
      }
      results.push({ id, ok: true });
    }
    const succeeded = results.filter((r) => r.ok).length;
    await this.audit.log({
      organizationId, userId: actorId, action: "social.posts_bulk",
      entityType: "SocialPost", entityId: organizationId,
      metadata: { bulkAction: action, requested: ids.length, succeeded, failed: ids.length - succeeded },
    });
    return { results, succeeded, failed: ids.length - succeeded };
  }

  /**
   * CSV bulk draft import. Header must carry a `caption` column;
   * `linkUrl`, `scheduledAt`, `accountId` are the optional
   * columns. Per-row rules: empty caption → row error; accountId
   * missing, unknown, or not connected → row error (NO default
   * account is ever invented); a present-but-unparseable
   * scheduledAt → row error. A successful row is ALWAYS created
   * as a draft through createPost (so the SU9 version hook runs)
   * — v1 does NOT schedule from the CSV even when scheduledAt is
   * valid; the value is validated only. Cap: 200 data rows.
   */
  async importPostsCsv(organizationId: string, actorId: string, csvText: string) {
    const parsed = parseCsv(typeof csvText === "string" ? csvText : "");
    if (!parsed.headers.includes("caption")) {
      throw new BadRequestException("CSV-তে caption কলাম থাকতে হবে — প্রথম সারিতে caption,accountId,linkUrl,scheduledAt হেডার দিন।");
    }
    if (parsed.rows.length === 0) {
      throw new BadRequestException("CSV-তে কোনো ডেটা সারি নেই — অন্তত একটি পোস্টের সারি দিন।");
    }
    if (parsed.rows.length > 200) {
      throw new BadRequestException("একবারে সর্বোচ্চ ২০০টি সারি Import করা যায়।");
    }
    const results: { row: number; ok: boolean; id?: string; error?: string }[] = [];
    for (const { row, values } of parsed.rows) {
      const caption = (values.caption ?? "").trim();
      if (!caption) {
        results.push({ row, ok: false, error: "caption খালি — এই সারিতে কোনো পোস্ট তৈরি হয়নি।" });
        continue;
      }
      const accountId = (values.accountId ?? "").trim();
      if (!accountId) {
        results.push({ row, ok: false, error: "accountId দেওয়া হয়নি — কোন অ্যাকাউন্টের পোস্ট তা CSV থেকেই জানাতে হবে।" });
        continue;
      }
      const account = await this.accountSummary(organizationId, accountId).catch(() => null);
      if (!account) {
        results.push({ row, ok: false, error: "accountId-এর অ্যাকাউন্টটি এই Organization-এ পাওয়া যায়নি।" });
        continue;
      }
      if (account.status !== "connected") {
        results.push({ row, ok: false, error: "অ্যাকাউন্টটি এখন সংযুক্ত নেই — আগে কানেক্ট করুন।" });
        continue;
      }
      const scheduledRaw = (values.scheduledAt ?? "").trim();
      if (scheduledRaw && Number.isNaN(new Date(scheduledRaw).getTime())) {
        results.push({ row, ok: false, error: "scheduledAt সঠিক তারিখ-সময় নয়।" });
        continue;
      }
      const linkUrl = (values.linkUrl ?? "").trim();
      try {
        const created = await this.createPost(organizationId, actorId, {
          socialAccountId: accountId,
          caption,
          ...(linkUrl ? { linkUrl } : {}),
        } as any);
        results.push({ row, ok: true, id: (created as any).id });
      } catch (e) {
        results.push({ row, ok: false, error: e instanceof Error ? e.message : "পোস্ট তৈরি ব্যর্থ হয়েছে।" });
      }
    }
    const createdCount = results.filter((r) => r.ok).length;
    await this.audit.log({
      organizationId, userId: actorId, action: "social.posts_csv_imported",
      entityType: "SocialPost", entityId: organizationId,
      metadata: { rows: parsed.rows.length, created: createdCount, failed: parsed.rows.length - createdCount },
    });
    return { results, created: createdCount, failed: parsed.rows.length - createdCount };
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
    // SU1: first comment edit — undefined leaves it unchanged,
    // null/"" clears text + status, new text restarts as pending.
    if (dto.firstCommentText !== undefined) {
      const text = this.normalizeFirstComment(dto.firstCommentText);
      data.firstCommentText = text;
      data.firstCommentStatus = text ? "pending" : null;
      if (!text) { data.firstCommentError = null; data.firstCommentId = null; }
    }
    // SU2: recurrence edit — frequency null clears the series.
    if (dto.recurrenceFrequency !== undefined || dto.recurrenceInterval !== undefined) {
      if (dto.recurrenceFrequency === null) {
        data.recurrenceFrequency = null;
        data.recurrenceInterval = null;
        data.seriesId = null;
      } else if (dto.recurrenceFrequency !== undefined) {
        data.recurrenceFrequency = dto.recurrenceFrequency;
        if (dto.recurrenceInterval !== undefined) data.recurrenceInterval = dto.recurrenceInterval;
        if (!post.seriesId) data.seriesId = randomUUID();
      } else if (dto.recurrenceInterval === null) {
        data.recurrenceInterval = null;
      } else {
        if (!post.recurrenceFrequency) {
          throw new BadRequestException("পুনরাবৃত্তির ব্যবধান দিতে হলে আগে পুনরাবৃত্তির ধরন (প্রতিদিন/সাপ্তাহিক/মাসিক) বেছে দিতে হবে।");
        }
        data.recurrenceInterval = dto.recurrenceInterval;
      }
    }
    // SU8: YouTube metadata / cover / story pass-through —
    // undefined leaves a field unchanged, null clears the
    // nullable ones.
    if (dto.youtubeTitle !== undefined) data.youtubeTitle = dto.youtubeTitle ? dto.youtubeTitle : null;
    if (dto.youtubeTags !== undefined) data.youtubeTags = Array.isArray(dto.youtubeTags) ? dto.youtubeTags : null;
    if (dto.youtubeCategoryId !== undefined) data.youtubeCategoryId = dto.youtubeCategoryId ? dto.youtubeCategoryId : null;
    if (dto.youtubeIsShort !== undefined) data.youtubeIsShort = dto.youtubeIsShort === true;
    if (dto.youtubePlaylistId !== undefined) data.youtubePlaylistId = dto.youtubePlaylistId ? dto.youtubePlaylistId : null;
    if (dto.coverAssetId !== undefined) data.coverAssetId = dto.coverAssetId ? dto.coverAssetId : null;
    if (dto.isStory !== undefined) data.isStory = dto.isStory === true;
    // SU9: a version is recorded ONLY when a content field
    // (caption / linkUrl / mediaRefs / firstCommentText) actually
    // changes value — a no-op edit, or an edit touching only
    // recurrence / YouTube / story fields, creates no version.
    const contentChanged =
      (data.caption !== undefined && data.caption !== post.caption) ||
      (data.linkUrl !== undefined && (data.linkUrl ?? null) !== (post.linkUrl ?? null)) ||
      (data.mediaRefs !== undefined
        && JSON.stringify(data.mediaRefs) !== JSON.stringify(Array.isArray(post.mediaRefs) ? post.mediaRefs : [])) ||
      (data.firstCommentText !== undefined && (data.firstCommentText ?? null) !== (post.firstCommentText ?? null));
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
    if (contentChanged) {
      await this.recordPostVersion(organizationId, updated, "edit", actorId);
    }
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
    await this.assertAccountAccess(organizationId, actorId, post.socialAccountId);
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
    // SU1: full platform pre-flight (supersedes the SP8/SP9-only
    // video check, whose message validateForPlatform returns
    // verbatim for TikTok/YouTube).
    const mediaViolation = validateForPlatform(
      { caption: post.caption, mediaRefs: post.mediaRefs, tiktokAudited: this.tiktokAuditedFlag() }, schedAccount?.platform ?? "",
    );
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
    // SU6: a scheduled post with a link gets its tracked-link
    // token now, so the publish path can build the tracked URL.
    // Failure-isolated: a token problem never fails scheduling
    // (publish falls back to the raw linkUrl).
    if (post.linkUrl && this.links) {
      await this.links.ensureLinkToken(organizationId, updated).catch((e) => {
        this.logger.warn(`social link token failed for post ${post.id}: ${e instanceof Error ? e.message : "unknown"}`);
      });
    }
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

  // ---------- SU9: collaboration (notes / versions / timeline / assign) ----------
  //
  // Notes are INTERNAL team discussion: they live only in
  // SocialPostNote rows and are never read by any publish /
  // platform path (the publish services never touch this table).

  async listPostNotes(organizationId: string, postId: string) {
    const post = await this.getPostRow(organizationId, postId);
    const rows = await (this.prisma as any).socialPostNote.findMany({
      where: { organizationId, socialPostId: post.id }, orderBy: { createdAt: "asc" },
    });
    return (Array.isArray(rows) ? rows : []).map((r: any) => this.serializeNote(r));
  }

  async createPostNote(organizationId: string, actorId: string, postId: string, dto: { body?: unknown }) {
    const post = await this.getPostRow(organizationId, postId);
    const body = typeof dto?.body === "string" ? dto.body.trim() : "";
    if (!body) {
      throw new BadRequestException("নোট খালি রাখা যাবে না — কিছু লিখুন।");
    }
    const row = await (this.prisma as any).socialPostNote.create({
      data: { organizationId, socialPostId: post.id, authorId: actorId, body },
    });
    await this.audit.log({
      organizationId, userId: actorId, action: "social.post_note_created",
      entityType: "SocialPost", entityId: post.id, metadata: { noteId: row.id },
    });
    return this.serializeNote(row);
  }

  async deletePostNote(organizationId: string, actorId: string, postId: string, noteId: string) {
    const post = await this.getPostRow(organizationId, postId);
    const note = await (this.prisma as any).socialPostNote.findFirst({
      where: { id: noteId, organizationId, socialPostId: post.id },
    });
    if (!note) throw new NotFoundException("Social post note not found in this organization");
    // Own note: any writer may delete it. Someone else's note:
    // OWNER/ADMIN only — other WRITE roles get a 403.
    if (note.authorId !== actorId && !this.isApproverRole(await this.actorRole(organizationId, actorId))) {
      throw new ForbiddenException("অন্যের নোট শুধু OWNER/ADMIN মুছতে পারেন।");
    }
    await (this.prisma as any).socialPostNote.delete({ where: { id: note.id } });
    await this.audit.log({
      organizationId, userId: actorId, action: "social.post_note_deleted",
      entityType: "SocialPost", entityId: post.id, metadata: { noteId: note.id, authorId: note.authorId },
    });
    return { deleted: true, id: note.id };
  }

  async listPostVersions(organizationId: string, postId: string) {
    const post = await this.getPostRow(organizationId, postId);
    const model = (this.prisma as any).socialPostVersion;
    if (!model?.findMany) return [];
    const rows = await model.findMany({ where: { organizationId, socialPostId: post.id } });
    return (Array.isArray(rows) ? rows : [])
      .slice()
      .sort((a: any, b: any) => (a.versionNo ?? 0) - (b.versionNo ?? 0))
      .map((r: any) => this.serializeVersion(r));
  }

  /**
   * Restore one version's snapshot onto the post. Only a DRAFT
   * can be restored (the same statuses updatePost allows content
   * edits in) — published / scheduled / publishing posts refuse
   * with a Conflict, mirroring updatePost's convention. The
   * restore itself is recorded as a new kind="restore" version,
   * and any approval state the post carries is reset (SP7 rule:
   * the approval was for the reviewed content, not for what the
   * post becomes) with approvalReset marked in the audit row.
   */
  async restorePostVersion(organizationId: string, actorId: string, postId: string, versionId: string) {
    const post = await this.getPostRow(organizationId, postId);
    if (post.status !== "draft") {
      throw new ConflictException("শুধু Draft পোস্টে আগের Version ফিরিয়ে আনা যায়।");
    }
    const model = (this.prisma as any).socialPostVersion;
    const version = model?.findFirst
      ? await model.findFirst({ where: { id: versionId, organizationId, socialPostId: post.id } })
      : null;
    if (!version) throw new NotFoundException("Social post version not found in this organization");
    const snapshot: any = version.snapshot ?? {};
    const firstCommentText = typeof snapshot.firstCommentText === "string" && snapshot.firstCommentText
      ? snapshot.firstCommentText
      : null;
    const data: Record<string, unknown> = {
      caption: typeof snapshot.caption === "string" ? snapshot.caption : post.caption,
      linkUrl: snapshot.linkUrl ?? null,
      mediaRefs: Array.isArray(snapshot.mediaRefs) ? snapshot.mediaRefs : [],
      firstCommentText,
      firstCommentStatus: firstCommentText ? "pending" : null,
    };
    if (!firstCommentText) { data.firstCommentError = null; data.firstCommentId = null; }
    const approvalReset = !!post.approvalStatus;
    if (approvalReset) {
      data.approvalStatus = null;
      data.submittedById = null;
      data.reviewedById = null;
      data.reviewNote = null;
    }
    const updated = await (this.prisma as any).socialPost.update({ where: { id: post.id }, data });
    const restoreVersion = await this.recordPostVersion(organizationId, updated, "restore", actorId);
    await this.audit.log({
      organizationId, userId: actorId, action: "social.post_version_restored",
      entityType: "SocialPost", entityId: post.id,
      metadata: {
        versionId: version.id, restoredVersionNo: version.versionNo,
        ...(restoreVersion ? { newVersionNo: restoreVersion.versionNo } : {}),
        ...(approvalReset ? { approvalReset: true } : {}),
      },
    });
    const account = await this.accountSummary(organizationId, updated.socialAccountId);
    return this.serializePost(updated, account);
  }

  /**
   * SU9 activity timeline — one chronological list merging every
   * REAL source this module has:
   * - versions (SocialPostVersion rows),
   * - notes (SocialPostNote rows),
   * - approval events from the AuditLog: social audit rows are
   *   written with entityType "SocialPost" + entityId = the post
   *   id CONSISTENTLY (see every audit.log call in this service),
   *   so the approval history is read back from those rows, never
   *   invented. ONLY when no approval audit row exists at all do
   *   we fall back to a DERIVED entry from the post row's current
   *   approval fields — that entry is the CURRENT state only, not
   *   a history, and is flagged meta.derived = true.
   * - publish: publishedAt (+ platformPostId) when published;
   *   otherwise, if attempts > 0, one last-attempt summary entry
   *   (attempts count + the verbatim last error, timed at the
   *   post's updatedAt — attempts carry no own timestamp).
   */
  async getPostTimeline(organizationId: string, postId: string) {
    const post = await this.getPostRow(organizationId, postId);
    const entries: { at: any; kind: string; label: string; meta?: Record<string, unknown> }[] = [];

    const versionModel = (this.prisma as any).socialPostVersion;
    if (versionModel?.findMany) {
      const versions = await versionModel.findMany({
        where: { organizationId, socialPostId: post.id },
      }).catch(() => []);
      for (const v of Array.isArray(versions) ? versions : []) {
        entries.push({
          at: v.createdAt, kind: "version",
          label: `version ${v.versionNo} (${v.kind})`,
          meta: { versionId: v.id, versionNo: v.versionNo, kind: v.kind, changedById: v.changedById },
        });
      }
    }

    const noteModel = (this.prisma as any).socialPostNote;
    if (noteModel?.findMany) {
      const notes = await noteModel.findMany({
        where: { organizationId, socialPostId: post.id },
      }).catch(() => []);
      for (const n of Array.isArray(notes) ? notes : []) {
        const excerpt = typeof n.body === "string" ? n.body.slice(0, 80) : "";
        entries.push({
          at: n.createdAt, kind: "note",
          label: `নোট — ${n.authorId}: ${excerpt}`,
          meta: { noteId: n.id, authorId: n.authorId },
        });
      }
    }

    const approvalLabels: Record<string, string> = {
      "social.post_approval_submitted": "অনুমোদনের জন্য পাঠানো হয়েছে",
      "social.post_manager_approved": "Manager ধাপে অনুমোদিত হয়েছে",
      "social.post_approved": "অনুমোদিত হয়েছে",
      "social.post_rejected": "প্রত্যাখ্যাত হয়েছে",
    };
    let approvalFromAudit = false;
    const auditModel = (this.prisma as any).auditLog;
    if (auditModel?.findMany) {
      const rows = await auditModel.findMany({
        where: { organizationId, entityType: "SocialPost", entityId: post.id },
        orderBy: { createdAt: "asc" },
      }).catch(() => []);
      for (const r of Array.isArray(rows) ? rows : []) {
        const label = approvalLabels[r.action as string];
        if (!label) continue;
        approvalFromAudit = true;
        entries.push({
          at: r.createdAt, kind: "approval", label,
          meta: {
            action: r.action, userId: r.userId ?? null,
            ...(r.metadata?.note ? { note: r.metadata.note } : {}),
            ...(r.metadata?.autoApproved ? { autoApproved: true } : {}),
          },
        });
      }
    }
    if (!approvalFromAudit && post.approvalStatus) {
      // Derived fallback: CURRENT approval state only (submitted/
      // reviewed by + note ride in meta) — explicitly NOT a full
      // approval history.
      entries.push({
        at: post.updatedAt ?? post.createdAt, kind: "approval",
        label: `বর্তমান অনুমোদন অবস্থা: ${post.approvalStatus}`,
        meta: {
          derived: true, approvalStatus: post.approvalStatus,
          submittedById: post.submittedById ?? null,
          reviewedById: post.reviewedById ?? null,
          reviewNote: post.reviewNote ?? null,
        },
      });
    }

    if (post.publishedAt) {
      entries.push({
        at: post.publishedAt, kind: "publish",
        label: post.platformPostId ? `Published (${post.platformPostId})` : "Published",
        meta: {
          platformPostId: post.platformPostId ?? null,
          platformUrl: post.platformUrl ?? null,
          attempts: post.attempts ?? 0,
        },
      });
    } else if ((post.attempts ?? 0) > 0) {
      entries.push({
        at: post.updatedAt ?? post.createdAt, kind: "publish",
        label: `প্রকাশের চেষ্টা: ${post.attempts} বার${post.error ? ` — শেষ ত্রুটি: ${post.error}` : ""}`,
        meta: { attempts: post.attempts, error: post.error ?? null },
      });
    }

    // Chronological, oldest first; Array.sort is stable, so
    // same-timestamp entries keep the source order above.
    entries.sort((a, b) => new Date(a.at ?? 0).getTime() - new Date(b.at ?? 0).getTime());
    return entries;
  }

  /**
   * Assign (or, with null, unassign) a post to a team member.
   * A non-null assignee must be an ACTIVE member of THIS org —
   * the membership check follows the actorRole discipline
   * (membership.findFirst on organizationId + userId +
   * status "ACTIVE"); anyone else is a Bengali 400.
   */
  async assignPost(organizationId: string, actorId: string, postId: string, assignedUserIdRaw: unknown) {
    const post = await this.getPostRow(organizationId, postId);
    let assignedUserId: string | null;
    if (assignedUserIdRaw === null || assignedUserIdRaw === undefined) {
      assignedUserId = null;
    } else if (typeof assignedUserIdRaw === "string" && assignedUserIdRaw.trim()) {
      assignedUserId = assignedUserIdRaw.trim();
      if (!(await this.actorRole(organizationId, assignedUserId))) {
        throw new BadRequestException("নির্বাচিত সদস্য এই Organization-এর সক্রিয় সদস্য নন — আগে Team-এ যোগ করুন।");
      }
    } else {
      throw new BadRequestException("সঠিক সদস্য বেছে দিন, অথবা দায়িত্ব সরাতে খালি পাঠান।");
    }
    const updated = await (this.prisma as any).socialPost.update({
      where: { id: post.id }, data: { assignedUserId },
    });
    await this.audit.log({
      organizationId, userId: actorId, action: "social.post_assigned",
      entityType: "SocialPost", entityId: post.id,
      metadata: { assignedUserId, previousAssignedUserId: post.assignedUserId ?? null },
    });
    const account = await this.accountSummary(organizationId, updated.socialAccountId);
    return this.serializePost(updated, account);
  }

  // ---------- SP7: org social settings ----------

  async getSocialSettings(organizationId: string) {
    return {
      socialRequireApproval: await this.approvalSettingOn(organizationId),
      // SU9: the optional second approval step (default false).
      socialApprovalTwoStep: await this.twoStepSettingOn(organizationId),
    };
  }

  /** OWNER/ADMIN only (controller-enforced). Audited. A PATCH
   * touches only the fields it carries — an absent field keeps
   * its current value. */
  async updateSocialSettings(organizationId: string, actorId: string, dto: { socialRequireApproval?: unknown; socialApprovalTwoStep?: unknown }) {
    const data: Record<string, unknown> = {};
    if (dto?.socialRequireApproval !== undefined) data.socialRequireApproval = dto.socialRequireApproval === true;
    if (dto?.socialApprovalTwoStep !== undefined) data.socialApprovalTwoStep = dto.socialApprovalTwoStep === true;
    if (Object.keys(data).length > 0) {
      await (this.prisma as any).organization.update({
        where: { id: organizationId }, data,
      });
    }
    await this.audit.log({
      organizationId, userId: actorId, action: "social.settings_updated",
      entityType: "Organization", entityId: organizationId,
      metadata: { ...data },
    });
    return this.getSocialSettings(organizationId);
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
    if (post.approvalStatus === "manager_approved") {
      // SU9 two-step: a post that already passed step 1 cannot be
      // re-submitted back to "pending" — it waits for the final
      // (step-2) approval instead. An honest refuse, for every
      // actor including approvers.
      throw new ConflictException("পোস্টটি প্রথম ধাপে অনুমোদিত হয়ে চূড়ান্ত অনুমোদনের অপেক্ষায় আছে — আবার পাঠানো যাবে না।");
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
    // SU9 two-step (only while Organization.socialApprovalTwoStep
    // is on): step 1 moves "pending" → "manager_approved" (its
    // own audit action; the author is NOT told the post is
    // approved yet, because it is not), step 2 moves
    // "manager_approved" → "approved" through the normal path
    // below. With two-step OFF, "manager_approved" is not an
    // approvable state at all — exactly the SP7 rule.
    if (await this.twoStepSettingOn(organizationId)) {
      if (post.approvalStatus === "pending") {
        const updated = await (this.prisma as any).socialPost.update({
          where: { id: post.id },
          data: { approvalStatus: "manager_approved", reviewedById: actorId, reviewNote: null },
        });
        await this.audit.log({
          organizationId, userId: actorId, action: "social.post_manager_approved",
          entityType: "SocialPost", entityId: post.id, metadata: { step: 1 },
        });
        const account = await this.accountSummary(organizationId, updated.socialAccountId);
        return this.serializePost(updated, account);
      }
      if (post.approvalStatus !== "manager_approved") {
        throw new ConflictException("পোস্টটি অনুমোদনের অপেক্ষায় নেই।");
      }
    } else if (post.approvalStatus !== "pending") {
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
    // SU9 two-step: rejection is possible from BOTH steps while
    // two-step is on ("pending" and "manager_approved"); with it
    // off only "pending" can be rejected (the SP7 rule).
    const rejectable = (await this.twoStepSettingOn(organizationId))
      ? ["pending", "manager_approved"]
      : ["pending"];
    if (!rejectable.includes(post.approvalStatus ?? "")) {
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
