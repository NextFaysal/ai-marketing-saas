import { Injectable, HttpStatus,} from "@nestjs/common";
import { randomBytes } from "node:crypto";
import { PrismaService } from "../prisma/prisma.service";
import { AuditService } from "../audit/audit.service";
import { SocialService } from "./social.service";
import { apiPublicBase } from "./social-link.service";
import { ApiException, badRequest, notFound } from "../i18n/api-exception";

/**
 * SN2 — Client approval share links + public review.
 *
 * A share link is an unguessable token (SP1 public-media-token
 * discipline: randomBytes(32) base64url, shown ONCE at creation
 * in the returned url, never logged, never in audit metadata,
 * never returned again by the list endpoint — masked only) that
 * lets a client preview ONE post (postId) or ONE variant group
 * (groupId) without a login and record an approve /
 * request-changes decision (SocialPostClientReview, append-only;
 * the latest review is the client's current word).
 *
 * Public-path honesty: an unknown token is a 404; a REVOKED or
 * EXPIRED link is a 410 with a message that says which — the
 * client is never left guessing, and a dead link accepts no
 * review. The public payload is a strict WHITELIST (see
 * publicPostEntry): caption, media, platform, account display
 * name, status and the latest client review — no org/user ids,
 * no first comment, no notes/versions, no internal ids beyond
 * the postId the review POST needs.
 */

export const SHARE_LINK_DEFAULT_EXPIRY_DAYS = 7;
export const SHARE_LINK_MAX_EXPIRY_DAYS = 365;

/** The web app's public share page path for a token. */
export function sharePagePath(token: string): string {
  return `/share/social/${token}`;
}

/** Masked token for list responses: only the last 4 characters
 * survive — enough for the team to recognise a link, never
 * enough to use it. */
export function maskShareToken(token: string): string {
  const t = typeof token === "string" ? token : "";
  return t.length > 4 ? `…${t.slice(-4)}` : "…";
}

/** A link's lifecycle status, derived from its own fields —
 * revoked wins over expired (a revoked link was killed on
 * purpose; that is the fact the team acted on). */
export function shareLinkStatus(link: any, now: Date = new Date()): "active" | "expired" | "revoked" {
  if (link?.revokedAt) return "revoked";
  if (link?.expiresAt && new Date(link.expiresAt).getTime() <= now.getTime()) return "expired";
  return "active";
}

@Injectable()
export class SocialShareService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly social: SocialService,
  ) {}

  private p(): any {
    return this.prisma as any;
  }

  private serializeShareLink(row: any, opts?: { url?: string | null; urlNote?: string | null }) {
    return {
      id: row.id,
      postId: row.postId ?? null,
      groupId: row.groupId ?? null,
      tokenMasked: maskShareToken(row.token),
      status: shareLinkStatus(row),
      expiresAt: row.expiresAt,
      revokedAt: row.revokedAt ?? null,
      createdById: row.createdById,
      createdAt: row.createdAt,
      ...(opts?.url !== undefined ? { url: opts.url } : {}),
      ...(opts?.urlNote ? { urlNote: opts.urlNote } : {}),
    };
  }

  private validateExpiryDays(raw: unknown): number {
    if (raw === undefined || raw === null) return SHARE_LINK_DEFAULT_EXPIRY_DAYS;
    const days = typeof raw === "number" ? raw : Number(raw);
    if (!Number.isInteger(days) || days < 1 || days > SHARE_LINK_MAX_EXPIRY_DAYS) {
      throw badRequest("social.theExpiryMustBeBetween1", { SHARE_LINK_MAX_EXPIRY_DAYS: SHARE_LINK_MAX_EXPIRY_DAYS });
    }
    return days;
  }

  /**
   * The creation-time URL handoff (the ONLY moment the full
   * token leaves the API): absolute when API_PUBLIC_URL is
   * configured (the SU6 tracked-link discipline — apiPublicBase
   * from SocialLinkService), otherwise the relative web path
   * plus an honest note saying the base is unconfigured, rather
   * than a fabricated absolute URL on a wrong host.
   */
  private shareUrl(token: string): { url: string; urlNote: string | null } {
    const base = apiPublicBase();
    if (base) return { url: `${base}${sharePagePath(token)}`, urlNote: null };
    return {
      url: sharePagePath(token),
      urlNote: "API_PUBLIC_URL সেট করা নেই — সম্পূর্ণ (absolute) লিংক তৈরি করা যায়নি, আপেক্ষিক পথ দেওয়া হলো।",
    };
  }

  /**
   * Create a share link for ONE post or ONE group (exactly one
   * scope — the caller picks the route, so postId/groupId can
   * never both be set). The target must exist in THIS org.
   * Audited WITHOUT the token (SP1 discipline).
   */
  async createShareLink(
    organizationId: string, actorId: string,
    scope: { postId?: string; groupId?: string },
    dto?: { expiresInDays?: unknown },
  ) {
    const postId = typeof scope?.postId === "string" && scope.postId ? scope.postId : null;
    const groupId = typeof scope?.groupId === "string" && scope.groupId ? scope.groupId : null;
    if ((postId === null) === (groupId === null)) {
      throw badRequest("social.aShareLinkIsForOne");
    }
    if (postId) {
      const post = await this.p().socialPost.findFirst({ where: { id: postId, organizationId } });
      if (!post) throw notFound("social.socialPostNotFoundInThis");
    } else {
      const group = await this.p().socialPostGroup.findFirst({ where: { id: groupId, organizationId } });
      if (!group) throw notFound("social.socialPostGroupNotFoundIn");
    }
    const days = this.validateExpiryDays(dto?.expiresInDays);
    const expiresAt = new Date(Date.now() + days * 86_400_000);
    let row: any = null;
    for (let attempt = 0; attempt < 3 && !row; attempt++) {
      const token = randomBytes(32).toString("base64url");
      try {
        row = await this.p().socialPostShareLink.create({
          data: { organizationId, postId, groupId, token, expiresAt, createdById: actorId },
        });
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        const code = (e as any)?.code;
        if (code === "P2002" || /unique/i.test(msg)) continue;
        throw e;
      }
    }
    if (!row) throw badRequest("social.theShareLinkCouldNotBe");
    await this.audit.log({
      organizationId, userId: actorId, action: "social.share_link_created",
      entityType: "SocialPostShareLink", entityId: row.id,
      metadata: { postId, groupId, expiresAt: expiresAt.toISOString() },
    });
    const { url, urlNote } = this.shareUrl(row.token);
    return this.serializeShareLink(row, { url, urlNote });
  }

  /** A post's share links (newest first), masked tokens only —
   * the full token is never returned again after creation. */
  async listShareLinksForPost(organizationId: string, postId: string) {
    const post = await this.p().socialPost.findFirst({ where: { id: postId, organizationId } });
    if (!post) throw notFound("social.socialPostNotFoundInThis");
    const rows = await this.p().socialPostShareLink.findMany({ where: { organizationId, postId } });
    return (Array.isArray(rows) ? rows : [])
      .slice()
      .sort((a: any, b: any) => new Date(b.createdAt ?? 0).getTime() - new Date(a.createdAt ?? 0).getTime())
      .map((r: any) => this.serializeShareLink(r));
  }

  /** Revoke: revokedAt is stamped, the row is KEPT (the public
   * path must be able to answer an honest 410 for it, and the
   * reviews recorded through it keep their history). Revoking
   * an already-revoked link is idempotent. Audited. */
  async revokeShareLink(organizationId: string, actorId: string, linkId: string) {
    const row = await this.p().socialPostShareLink.findFirst({ where: { id: linkId, organizationId } });
    if (!row) throw notFound("social.shareLinkNotFoundInThis");
    const updated = row.revokedAt
      ? row
      : await this.p().socialPostShareLink.update({
          where: { id: row.id }, data: { revokedAt: new Date() },
        });
    await this.audit.log({
      organizationId, userId: actorId, action: "social.share_link_revoked",
      entityType: "SocialPostShareLink", entityId: row.id,
      metadata: { postId: row.postId ?? null, groupId: row.groupId ?? null },
    });
    return this.serializeShareLink(updated);
  }

  // ---------- public path (no auth — the token is the credential) ----------

  /**
   * Resolve a token to a LIVE link: unknown → 404, revoked →
   * 410, expired → 410 (each with its own honest message).
   * Shared by the public read and the review POST, so a dead
   * link behaves identically on both.
   */
  private async resolveLiveLink(token: string) {
    if (!token || typeof token !== "string") throw notFound("social.theShareLinkWasNotFound");
    const link = await this.p().socialPostShareLink.findFirst({ where: { token } });
    if (!link) throw notFound("social.theShareLinkWasNotFound");
    if (link.revokedAt) {
      throw new ApiException("social.thisShareLinkHasBeenRevoked", undefined, HttpStatus.GONE);
    }
    if (link.expiresAt && new Date(link.expiresAt).getTime() <= Date.now()) {
      throw new ApiException("social.thisShareLinkHasExpiredContact", undefined, HttpStatus.GONE);
    }
    return link;
  }

  /** The posts a link covers: its one post, or every post of
   * its group (org-scoped either way — a link can never reach
   * outside its own organization). */
  private async postsForLink(link: any): Promise<any[]> {
    if (link.postId) {
      const post = await this.p().socialPost.findFirst({
        where: { id: link.postId, organizationId: link.organizationId },
      });
      return post ? [post] : [];
    }
    const rows = await this.p().socialPost.findMany({
      where: { organizationId: link.organizationId, postGroupId: link.groupId },
    });
    return Array.isArray(rows) ? rows : [];
  }

  /**
   * The WHITELIST entry for one post. Media public URLs ride
   * the SP1 public-media path through the existing helper
   * (SocialService.createPublicLink — reuses an asset's token,
   * mints one when absent; the link's creator is the audit
   * actor, as the tenant deliberately chose to share this post).
   * A media ref whose asset is gone is skipped — a URL is never
   * fabricated for it.
   */
  private async publicPostEntry(link: any, post: any) {
    const account = await this.p().socialAccount.findFirst({
      where: { id: post.socialAccountId, organizationId: link.organizationId },
    }).catch(() => null);
    const media: { kind: string; publicUrl: string | null }[] = [];
    for (const ref of Array.isArray(post.mediaRefs) ? post.mediaRefs : []) {
      const asset = await this.p().mediaAsset.findFirst({
        where: { id: ref.assetId, organizationId: link.organizationId },
      }).catch(() => null);
      if (!asset) continue;
      let publicUrl: string | null = asset.publicToken ? `/public/media/${asset.publicToken}` : null;
      if (!publicUrl) {
        const linked = await this.social.createPublicLink(link.organizationId, link.createdById, asset.id)
          .catch(() => null);
        publicUrl = (linked as any)?.publicUrl ?? null;
      }
      media.push({ kind: ref.kind ?? asset.kind, publicUrl });
    }
    const latest = await this.social.latestClientReview(link.organizationId, post.id);
    return {
      postId: post.id,
      caption: post.caption,
      media,
      platform: account?.platform ?? null,
      accountDisplayName: account ? (account.name ?? account.username ?? null) : null,
      status: post.status,
      clientReview: latest
        ? {
            decision: latest.decision,
            reviewerName: latest.reviewerName,
            comment: latest.comment ?? null,
            createdAt: latest.createdAt,
          }
        : null,
    };
  }

  /** Public preview payload: ONLY the whitelisted post entries. */
  async getPublicShare(token: string) {
    const link = await this.resolveLiveLink(token);
    const posts = await this.postsForLink(link);
    const entries = [];
    for (const post of posts) {
      entries.push(await this.publicPostEntry(link, post));
    }
    return { posts: entries };
  }

  /**
   * Record one client decision through a live link. Validation
   * (all honest Bengali 400s): the post must be inside THIS
   * link's scope, the reviewer name must be non-empty, and the
   * decision must be exactly "approved" or "changes_requested".
   * The review is appended (history is never rewritten — a
   * newer review supersedes by being latest) and audited with
   * the reviewer as a PUBLIC actor: no userId (there is no
   * account), the typed name rides in the audit metadata.
   */
  async submitPublicReview(token: string, dto: { postId?: unknown; reviewerName?: unknown; decision?: unknown; comment?: unknown }) {
    const link = await this.resolveLiveLink(token);
    const postId = typeof dto?.postId === "string" ? dto.postId.trim() : "";
    if (!postId) {
      throw badRequest("social.sayWhichPostThisReviewIs");
    }
    const reviewerName = typeof dto?.reviewerName === "string" ? dto.reviewerName.trim() : "";
    if (!reviewerName) {
      throw badRequest("social.giveYourNameAReviewCannot");
    }
    const decision = typeof dto?.decision === "string" ? dto.decision.trim() : "";
    if (decision !== "approved" && decision !== "changes_requested") {
      throw badRequest("social.asADecisionOnlyApprovedOr");
    }
    const commentRaw = typeof dto?.comment === "string" ? dto.comment.trim() : "";
    const comment = commentRaw ? commentRaw : null;

    const inScope = link.postId
      ? link.postId === postId
      : !!(await this.p().socialPost.findFirst({
          where: { id: postId, organizationId: link.organizationId, postGroupId: link.groupId },
        }));
    if (!inScope) {
      throw badRequest("social.thisPostIsNotCoveredBy");
    }

    const row = await this.p().socialPostClientReview.create({
      data: {
        organizationId: link.organizationId, postId, shareLinkId: link.id,
        reviewerName, decision, comment,
      },
    });
    await this.audit.log({
      organizationId: link.organizationId, action: "social.post_client_reviewed",
      entityType: "SocialPost", entityId: postId,
      metadata: { reviewerName, decision, shareLinkId: link.id, publicReview: true },
    });
    return {
      id: row.id, postId: row.postId, decision: row.decision,
      reviewerName: row.reviewerName, comment: row.comment ?? null,
      createdAt: row.createdAt,
    };
  }
}
