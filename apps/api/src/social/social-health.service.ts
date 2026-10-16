import { BadRequestException, Injectable, NotFoundException, Optional } from "@nestjs/common";
import { PrismaService } from "../prisma/prisma.service";
import { AuditService } from "../audit/audit.service";
import { MAX_PUBLISH_ATTEMPTS, SocialPublishService } from "./social-publish.service";
import { SocialOAuthService } from "./social-oauth.service";
import { MetaSocialPublisher, isTokenDeadError } from "./meta-publisher";
import { TelegramClient } from "./telegram.client";
import { ThreadsClient } from "./threads.client";

/**
 * SU10 — Account Health + Failure Center (API only).
 *
 * Health check discipline:
 * - Meta (meta_page / instagram): the token comes through the
 *   publish service's ONE sealed-token seam
 *   (resolveAccountToken, with the SU10 allowErrorStatus flag —
 *   re-validating an "error" account's token is the only honest
 *   way it can recover), then the lightest Graph identity call
 *   (GET /{externalId}?fields=id,name) proves it still works.
 * - TikTok / YouTube: SocialOAuthService.ensureAccessToken IS
 *   the verification — it resolves (and refreshes, when due)
 *   the sealed OAuth token; its failure is the result, verbatim.
 * - Telegram (SN6): the sealed bot token via the same publish
 *   seam, then Bot API getMe — the identity-style probe.
 * - healthCheckedAt stamps EVERY attempt, success or failure —
 *   "when was this last checked" is the column's whole meaning.
 * - Success restores an "error" account to "connected" and
 *   clears lastError; an already-connected account stays as-is.
 * - Failure NEVER fabricates success: the response is
 *   { ok: false, ..., error } with a Bengali wrapper around the
 *   platform/resolver's verbatim message. A token-death failure
 *   marks the account "error" with the verbatim message, by the
 *   EXISTING rules — Meta via markAccountTokenDead on an
 *   isTokenDeadError, OAuth via ensureAccessToken's own refresh
 *   -failure marking (this service adds no second marking there,
 *   it only re-reads the account so the reported status is the
 *   stored truth). Any other failure leaves the status untouched.
 *
 * No new notification channel lives here: terminal publish
 * failures already notify OWNER/ADMIN through SP5's
 * AgentNotification ("social_post_failed", in
 * SocialPublishService.notifyFailed) — SU10 only surfaces the
 * failures; it does not re-alert them.
 */

export type SocialAccountHealthLabel = "never_checked" | "error" | "ok";

/** The derived health label (SP/AD3 pattern): never checked
 * beats everything — a check that never ran proves nothing,
 * whatever the stored status says. */
export function deriveSocialAccountHealth(row: any): SocialAccountHealthLabel {
  if (!row?.healthCheckedAt) return "never_checked";
  if (row.status === "error") return "error";
  return "ok";
}

/** The failure-center signature of one post error: the FIRST
 * line only, trimmed, with every whitespace run collapsed to a
 * single space — so the same platform error reworded only by
 * spacing or followed by different detail lines groups together.
 * A missing/blank error lands in one honest bucket instead of
 * being dropped or invented. */
export function normalizeFailureSignature(error: unknown): string {
  const firstLine = typeof error === "string" ? (error.split(/\r?\n/)[0] ?? "") : "";
  const normalized = firstLine.replace(/\s+/g, " ").trim();
  return normalized || "(no error recorded)";
}

@Injectable()
export class SocialHealthService {
  private readonly publisher: MetaSocialPublisher;
  private readonly telegram: TelegramClient;
  private readonly threads: ThreadsClient;

  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly publish: SocialPublishService,
    private readonly oauth: SocialOAuthService,
    // Insights-service pattern: the module does not provide
    // MetaSocialPublisher, so it defaults to a real instance;
    // specs inject one built on a stub fetch.
    @Optional() publisher?: MetaSocialPublisher,
    // SN6: Telegram identity probe (getMe). Appended LAST for
    // the same positional-compat reason.
    @Optional() telegramClient?: TelegramClient,
    // SN7: Threads identity probe (profile GET).
    @Optional() threadsClient?: ThreadsClient,
  ) {
    this.publisher = publisher ?? new MetaSocialPublisher();
    this.telegram = telegramClient ?? new TelegramClient();
    this.threads = threadsClient ?? new ThreadsClient();
  }

  // ---------- account health ----------

  async checkAccountHealth(organizationId: string, actorId: string, accountId: string) {
    void actorId; // the route's OWNER/ADMIN role gate is the authorization; no audit action was specified for a check
    const prisma = this.prisma as any;
    const account = await prisma.socialAccount.findFirst({
      where: { id: accountId, organizationId },
    });
    if (!account) throw new NotFoundException("Social account not found in this organization");

    const healthCheckedAt = new Date();
    // Stamp FIRST: every attempt counts as a check, including
    // one that goes on to fail below.
    await prisma.socialAccount.update({
      where: { id: account.id }, data: { healthCheckedAt },
    });

    const isMeta = account.platform === "meta_page" || account.platform === "instagram";
    const isOAuth = account.platform === "tiktok" || account.platform === "youtube";
    try {
      if (isMeta) {
        const { accessToken } = await this.publish.resolveAccountToken(
          organizationId, account.id, { allowErrorStatus: true },
        );
        await this.publisher.getAccountIdentity(accessToken, account.externalId);
      } else if (account.platform === "telegram") {
        // SN6: the identity-style probe for a bot-token account —
        // the sealed token via the publish seam (error-status
        // accounts included, same recovery rule as Meta), then
        // getMe proves the bot token still works. Telegram's
        // verbatim error flows through the shared catch below.
        const { accessToken } = await this.publish.resolveAccountToken(
          organizationId, account.id, { allowErrorStatus: true },
        );
        await this.telegram.getMe(accessToken);
      } else if (account.platform === "threads") {
        // SN7: identity-style probe — the refresh-aware token
        // (ensureAccessToken, like the other OAuth platforms),
        // then the profile GET proves it still identifies the
        // account. Meta's verbatim error flows through the
        // shared catch below.
        const accessToken = await this.oauth.ensureAccessToken(organizationId, account);
        if (!accessToken) throw new Error("অ্যাকাউন্টের Token পাওয়া যায়নি — অ্যাকাউন্টটি আবার কানেক্ট করুন।");
        await this.threads.getProfile(accessToken);
      } else if (isOAuth) {
        const accessToken = await this.oauth.ensureAccessToken(organizationId, account);
        if (!accessToken) throw new Error("অ্যাকাউন্টের Token পাওয়া যায়নি — অ্যাকাউন্টটি আবার কানেক্ট করুন।");
      } else {
        throw new Error(`এই Platform-এর স্বাস্থ্য যাচাই এখনো চালু হয়নি: ${account.platform}`);
      }
    } catch (e) {
      const verbatim = e instanceof Error ? e.message : String(e);
      let status: string = account.status;
      if (isMeta && isTokenDeadError(e)) {
        // The publish path's own marking rule, verbatim message.
        await this.publish.markAccountTokenDead(account.id, verbatim);
        status = "error";
      } else {
        // The OAuth resolver marks the account itself when a
        // refresh dies; re-read so the reported status is the
        // stored truth, not a guess. Other failures leave the
        // row's status exactly as it was.
        const fresh = await prisma.socialAccount.findFirst({
          where: { id: account.id, organizationId },
        }).catch(() => null);
        if (fresh) status = fresh.status;
      }
      // Re-stamp defensively (the marking helpers write only
      // status/lastError, so the stamp survives — this keeps the
      // invariant even if a future helper grows wider writes).
      await prisma.socialAccount.update({
        where: { id: account.id }, data: { healthCheckedAt },
      }).catch(() => undefined);
      return {
        ok: false, healthCheckedAt, status,
        error: `অ্যাকাউন্টের স্বাস্থ্য যাচাই ব্যর্থ হয়েছে: ${verbatim}`,
      };
    }

    let status: string = account.status;
    if (status === "error") {
      await prisma.socialAccount.update({
        where: { id: account.id },
        data: { status: "connected", lastError: null, healthCheckedAt },
      });
      status = "connected";
    }
    return { ok: true, healthCheckedAt, status };
  }

  /**
   * GET accounts/health — one row per account with ONLY the
   * health fields. The serializer is an explicit field list:
   * no integration id, no external id, and never any credential
   * material can ride along.
   */
  async listAccountHealth(organizationId: string) {
    const rows = await (this.prisma as any).socialAccount.findMany({
      where: { organizationId }, orderBy: { createdAt: "asc" },
    });
    return (Array.isArray(rows) ? rows : []).map((row: any) => ({
      id: row.id,
      platform: row.platform,
      name: row.name,
      status: row.status,
      lastError: row.lastError ?? null,
      healthCheckedAt: row.healthCheckedAt ?? null,
      health: deriveSocialAccountHealth(row),
    }));
  }

  // ---------- failure center ----------

  /**
   * GET posts/failures — every failed post of the org, grouped
   * by normalized error signature (see normalizeFailureSignature).
   * Groups sort by count (most failures first), then by their
   * latest failure (newest first). Deliberately NOT paginated
   * and NOT take-capped: the endpoint returns ALL failed posts
   * of the org (a tenant's failed set is expected to stay small
   * precisely because this center exists to clear it); the
   * bound is the org's own failed-post count.
   */
  async listPostFailures(organizationId: string) {
    const rows = await (this.prisma as any).socialPost.findMany({
      where: { organizationId, status: "failed" },
    });
    const posts = (Array.isArray(rows) ? rows : []).map((row: any) => ({
      row,
      at: new Date(row.updatedAt ?? row.createdAt ?? 0),
    }));
    // Newest failure first inside each group, deterministically.
    posts.sort((a, b) => b.at.getTime() - a.at.getTime());
    const groups = new Map<string, {
      signature: string; count: number; latestAt: Date;
      postIds: string[]; accountIds: string[];
    }>();
    for (const { row, at } of posts) {
      const signature = normalizeFailureSignature(row.error);
      let group = groups.get(signature);
      if (!group) {
        group = { signature, count: 0, latestAt: at, postIds: [], accountIds: [] };
        groups.set(signature, group);
      }
      group.count++;
      if (at.getTime() > group.latestAt.getTime()) group.latestAt = at;
      group.postIds.push(row.id);
      if (row.socialAccountId && !group.accountIds.includes(row.socialAccountId)) {
        group.accountIds.push(row.socialAccountId);
      }
    }
    return [...groups.values()].sort((a, b) =>
      b.count - a.count
      || b.latestAt.getTime() - a.latestAt.getTime()
      || a.signature.localeCompare(b.signature));
  }

  // ---------- retry ----------

  /**
   * POST posts/:id/retry — one explicit human retry of a FAILED
   * post through the ONE publish path (publishNow; its approval
   * gate and the SU1 pre-flight inside the publish path apply
   * unchanged — no publish logic is duplicated here).
   *
   * Attempts discipline: publishNow only accepts draft/scheduled
   * posts, so the failed post is first returned to "draft" (the
   * state a gate refusal also leaves it in, ready to fix and
   * publish — the worker's blocked-post precedent). Attempts are
   * reset to 0 ONLY when the cap is already exhausted
   * (attempts >= MAX_PUBLISH_ATTEMPTS) — that reset is the human
   * override of the cap, and it is audited with the previous
   * count. Attempts still remaining are NOT reset: the retry
   * continues the post's existing attempt budget.
   * publishNow's result and its errors propagate verbatim.
   */
  async retryPost(organizationId: string, actorId: string, postId: string) {
    const prisma = this.prisma as any;
    const post = await prisma.socialPost.findFirst({ where: { id: postId, organizationId } });
    if (!post) throw new NotFoundException("Social post not found in this organization");
    if (post.status !== "failed") {
      throw new BadRequestException(
        `শুধু Failed পোস্টই আবার চেষ্টা (retry) করা যায় — এই পোস্টটি এখন "${post.status}" অবস্থায় আছে।`,
      );
    }
    const previousAttempts = typeof post.attempts === "number" ? post.attempts : 0;
    const exhausted = previousAttempts >= MAX_PUBLISH_ATTEMPTS;
    await prisma.socialPost.update({
      where: { id: post.id },
      data: { status: "draft", ...(exhausted ? { attempts: 0 } : {}) },
    });
    if (exhausted) {
      await this.audit.log({
        organizationId, userId: actorId, action: "social.post_retry_attempts_reset",
        entityType: "SocialPost", entityId: post.id,
        metadata: { previousAttempts, attempts: 0 },
      });
    }
    return this.publish.publishNow(organizationId, actorId, postId);
  }
}
