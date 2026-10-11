import { BadRequestException, Injectable, NotFoundException, Optional } from "@nestjs/common";
import { PrismaService } from "../prisma/prisma.service";
import { AuditService } from "../audit/audit.service";
import { SocialService } from "./social.service";
import { SocialPublishService } from "./social-publish.service";
import { MetaSocialPublisher, SocialPostInsights, isTokenDeadError } from "./meta-publisher";

/**
 * SP7 — Published-post insights + performance summary.
 *
 * Honesty rules that shape everything here:
 * - Numbers are stored EXACTLY as Graph returns them. A metric the
 *   platform does not return for a post stays ABSENT from the
 *   stored object — never 0, never estimated (see
 *   MetaSocialPublisher.getPagePostInsights /
 *   getInstagramMediaInsights).
 * - Totals in the summary sum ONLY over posts that HAVE the metric
 *   and report how many posts each total is based on — no averages
 *   over missing data.
 * - The best-time suggestion is a labelled heuristic over the org's
 *   OWN posts, shown only once at least BEST_TIME_MIN_POSTS posts
 *   have insights; below that there is no suggestion at all.
 *
 * Token plumbing is NOT duplicated: the account's sealed Page
 * token comes from SocialPublishService.resolveAccountToken (the
 * SP6 publish path's own helper), and token-death marking reuses
 * SocialPublishService.markAccountTokenDead.
 */

/** Bulk refresh ignores posts younger than this — Graph numbers
 * for a brand-new post are still settling and would mislead. */
export const INSIGHTS_MIN_POST_AGE_MS = 60 * 60_000;
/** Bulk refresh window: published within the last 30 days. */
export const INSIGHTS_BULK_WINDOW_MS = 30 * 86_400_000;
/** Hard bound on one bulk refresh (sequential, per-post). */
export const INSIGHTS_BULK_LIMIT = 100;
/** Best-time needs at least this many posts WITH insights. */
export const BEST_TIME_MIN_POSTS = 10;

/** Every metric key an insights object can carry. */
export const INSIGHT_METRIC_KEYS = [
  "reactions", "comments", "shares",
  "likeCount", "commentsCount",
  "impressions", "reach", "saved", "plays",
] as const;

/**
 * Total engagement of one post from its stored insights, using
 * ONLY the fields present: Page posts sum reactions + comments +
 * shares; Instagram sums likeCount + commentsCount. Returns null
 * when the post has no usable engagement fields at all (such a
 * post never feeds the best-time heuristic).
 */
export function engagementScore(insights: unknown): number | null {
  if (!insights || typeof insights !== "object") return null;
  const obj = insights as Record<string, unknown>;
  const keys = obj.platform === "instagram"
    ? ["likeCount", "commentsCount"]
    : ["reactions", "comments", "shares"];
  let total = 0;
  let any = false;
  for (const key of keys) {
    const v = obj[key];
    if (typeof v === "number" && Number.isFinite(v)) {
      total += v;
      any = true;
    }
  }
  return any ? total : null;
}

const WEEKDAY_INDEX: Record<string, number> = {
  Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6,
};

/**
 * Best publishing-time bucket from the org's OWN published posts:
 * group posts (that have an engagement score) by weekday + hour
 * in the ORG's timezone, sum engagement per bucket, and return the
 * strongest bucket. Below BEST_TIME_MIN_POSTS scored posts there
 * is no honest suggestion — null. Ties resolve deterministically
 * to the earliest weekday, then the earliest hour.
 */
export function computeBestTime(
  posts: { publishedAt?: Date | string | null; insights?: unknown }[],
  timeZone: string,
): { weekday: number; hour: number; score: number; postsConsidered: number } | null {
  const scored: { at: Date; score: number }[] = [];
  for (const post of posts ?? []) {
    const score = engagementScore(post?.insights);
    if (score === null || !post?.publishedAt) continue;
    const at = new Date(post.publishedAt);
    if (Number.isNaN(at.getTime())) continue;
    scored.push({ at, score });
  }
  if (scored.length < BEST_TIME_MIN_POSTS) return null;

  const fmt = new Intl.DateTimeFormat("en-US", {
    timeZone, weekday: "short", hour: "2-digit", hourCycle: "h23",
  });
  const buckets = new Map<string, { weekday: number; hour: number; score: number }>();
  for (const s of scored) {
    const parts = fmt.formatToParts(s.at);
    const weekday = WEEKDAY_INDEX[parts.find((p) => p.type === "weekday")?.value ?? ""];
    const hourRaw = Number(parts.find((p) => p.type === "hour")?.value ?? NaN);
    if (weekday === undefined || Number.isNaN(hourRaw)) continue;
    const hour = hourRaw % 24;
    const key = `${weekday}-${hour}`;
    const bucket = buckets.get(key) ?? { weekday, hour, score: 0 };
    bucket.score += s.score;
    buckets.set(key, bucket);
  }
  let best: { weekday: number; hour: number; score: number } | null = null;
  for (const bucket of buckets.values()) {
    if (
      !best || bucket.score > best.score ||
      (bucket.score === best.score &&
        (bucket.weekday < best.weekday ||
          (bucket.weekday === best.weekday && bucket.hour < best.hour)))
    ) {
      best = bucket;
    }
  }
  if (!best) return null;
  return { weekday: best.weekday, hour: best.hour, score: best.score, postsConsidered: scored.length };
}

@Injectable()
export class SocialInsightsService {
  private readonly publisher: MetaSocialPublisher;

  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly social: SocialService,
    private readonly publish: SocialPublishService,
    @Optional() publisher?: MetaSocialPublisher,
  ) {
    // Same injection pattern as SocialPublishService: the module
    // does not provide MetaSocialPublisher, so it defaults to a
    // real instance; specs inject one built on a stub fetch.
    this.publisher = publisher ?? new MetaSocialPublisher();
  }

  /**
   * Fetch one published post's insights from the platform and
   * return them WITHOUT persisting (callers persist + audit, so
   * the single and bulk paths share exactly one fetch). Token
   * death marks the account (SP6 discipline) before rethrowing;
   * every platform error propagates with its verbatim message.
   */
  private async fetchInsightsForPost(post: any): Promise<SocialPostInsights> {
    const { account, accessToken } = await this.publish.resolveAccountToken(post.organizationId, post.socialAccountId);
    // Instagram's insights metrics differ for video (Reels) — the
    // post's own media refs say which shape it was published as.
    const isVideo = (Array.isArray(post.mediaRefs) ? post.mediaRefs : [])
      .some((r: any) => r?.kind === "video");
    try {
      if (account.platform === "instagram") {
        return await this.publisher.getInstagramMediaInsights(accessToken, String(post.platformPostId), isVideo);
      }
      return await this.publisher.getPagePostInsights(accessToken, String(post.platformPostId));
    } catch (e) {
      if (isTokenDeadError(e)) {
        await this.publish.markAccountTokenDead(account.id, e instanceof Error ? e.message : String(e));
      }
      throw e;
    }
  }

  private assertInsightsFetchable(post: any): void {
    if (post.status !== "published" || !post.platformPostId) {
      throw new BadRequestException("শুধু Published পোস্টের Data আনা যায় — এই পোস্টটি এখনো প্রকাশিত হয়নি।");
    }
  }

  /**
   * Refresh ONE published post's insights now. Platform errors are
   * Bengali-400 surfaces carrying the platform's verbatim message;
   * local precondition failures (unpublished, disconnected,
   * missing credential) are equally honest 400s.
   */
  async refreshPostInsights(organizationId: string, actorId: string, postId: string) {
    const post = await (this.prisma as any).socialPost.findFirst({ where: { id: postId, organizationId } });
    if (!post) throw new NotFoundException("Social post not found in this organization");
    this.assertInsightsFetchable(post);
    let insights: SocialPostInsights;
    try {
      insights = await this.fetchInsightsForPost(post);
    } catch (e) {
      throw new BadRequestException(e instanceof Error ? e.message : "Insights আনা যায়নি — আবার চেষ্টা করুন।");
    }
    await (this.prisma as any).socialPost.update({
      where: { id: post.id },
      data: { insights, insightsFetchedAt: new Date() },
    });
    await this.audit.log({
      organizationId, userId: actorId, action: "social.post_insights_refreshed",
      entityType: "SocialPost", entityId: post.id,
      metadata: { platform: insights.platform },
    });
    return this.social.getPost(organizationId, postId);
  }

  /**
   * Bulk refresh: the org's published posts from the last 30 days,
   * newest first, bounded and SEQUENTIAL (platform politeness, the
   * AD6 sync-all discipline). Per-post results: refreshed /
   * failed (verbatim error) / skipped_too_new (published < 1h
   * ago). One post's failure never fails the batch; exactly one
   * audit row records the counts.
   */
  async refreshAllInsights(organizationId: string, actorId: string) {
    const rows = await (this.prisma as any).socialPost.findMany({
      where: { organizationId, status: "published" },
      orderBy: { publishedAt: "desc" }, take: INSIGHTS_BULK_LIMIT,
    }).catch(() => []);
    const now = Date.now();
    const inWindow = (Array.isArray(rows) ? rows : []).filter((p: any) =>
      p.platformPostId && p.publishedAt &&
      now - new Date(p.publishedAt).getTime() <= INSIGHTS_BULK_WINDOW_MS);
    const results: { postId: string; status: "refreshed" | "failed" | "skipped_too_new"; error?: string }[] = [];
    let refreshed = 0;
    let failed = 0;
    let skippedTooNew = 0;
    for (const post of inWindow) {
      if (now - new Date(post.publishedAt).getTime() < INSIGHTS_MIN_POST_AGE_MS) {
        skippedTooNew++;
        results.push({ postId: post.id, status: "skipped_too_new" });
        continue;
      }
      try {
        const insights = await this.fetchInsightsForPost(post);
        await (this.prisma as any).socialPost.update({
          where: { id: post.id },
          data: { insights, insightsFetchedAt: new Date() },
        });
        refreshed++;
        results.push({ postId: post.id, status: "refreshed" });
      } catch (e) {
        failed++;
        results.push({
          postId: post.id, status: "failed",
          error: e instanceof Error ? e.message : "Insights আনা যায়নি",
        });
      }
    }
    await this.audit.log({
      organizationId, userId: actorId, action: "social.insights_bulk_refreshed",
      entityType: "Organization", entityId: organizationId,
      metadata: { total: inWindow.length, refreshed, failed, skippedTooNew },
    });
    return { total: inWindow.length, refreshed, failed, skippedTooNew, results };
  }

  /**
   * Performance summary for the Social Posts page strip: per-
   * metric totals computed ONLY over the posts that HAVE that
   * metric (each total carries its own basis count), plus the
   * best-time heuristic over the org's own posts (null below the
   * evidence threshold — the UI then shows why, not a guess).
   */
  async getInsightsSummary(organizationId: string) {
    const org = await (this.prisma as any).organization?.findFirst?.({
      where: { id: organizationId },
    }).catch(() => null);
    const timeZone: string = org?.timezone || "Asia/Dhaka";
    const rows = await (this.prisma as any).socialPost.findMany({
      where: { organizationId, status: "published" }, take: 500,
    }).catch(() => []);
    const posts = (Array.isArray(rows) ? rows : [])
      .filter((p: any) => p.insights && typeof p.insights === "object");
    const totals: Record<string, { total: number; posts: number }> = {};
    for (const key of INSIGHT_METRIC_KEYS) {
      let total = 0;
      let basis = 0;
      for (const post of posts) {
        const v = (post.insights as Record<string, unknown>)[key];
        if (typeof v === "number" && Number.isFinite(v)) {
          total += v;
          basis++;
        }
      }
      if (basis > 0) totals[key] = { total, posts: basis };
    }
    const bestTime = computeBestTime(
      posts.map((p: any) => ({ publishedAt: p.publishedAt, insights: p.insights })),
      timeZone,
    );
    return { postsWithInsights: posts.length, totals, bestTime };
  }
}
