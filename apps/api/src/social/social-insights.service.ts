import { BadRequestException, Injectable, NotFoundException, Optional } from "@nestjs/common";
import { PrismaService } from "../prisma/prisma.service";
import { AuditService } from "../audit/audit.service";
import { SocialService } from "./social.service";
import { SocialPublishService } from "./social-publish.service";
import { SocialOAuthService } from "./social-oauth.service";
import { ThreadsClient } from "./threads.client";
import { MetaSocialPublisher, SocialPostInsights, isTokenDeadError } from "./meta-publisher";
import { PdfCanvas, buildPdf } from "../courier/pdf";

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

/** Every metric key an insights object can carry. SN7 adds the
 * Threads-native keys (views/likes/replies/reposts/quotes —
 * "shares" was already shared with the Page vocabulary). */
export const INSIGHT_METRIC_KEYS = [
  "reactions", "comments", "shares",
  "likeCount", "commentsCount",
  "impressions", "reach", "saved", "plays",
  "views", "likes", "replies", "reposts", "quotes",
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
    : obj.platform === "threads"
      // SN7: Threads' engagement = its documented interaction
      // metrics (views is reach, not engagement — excluded).
      ? ["likes", "replies", "reposts", "quotes"]
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

/**
 * SU4: hashtags in one caption — Unicode-aware (# followed by
 * letters/numbers/underscore, so Bengali hashtags count too),
 * lowercased and deduped PER POST: the same tag twice in one
 * caption is still one post using that tag.
 */
export function extractHashtags(caption: unknown): string[] {
  if (typeof caption !== "string" || !caption) return [];
  const seen = new Set<string>();
  const out: string[] = [];
  for (const m of caption.matchAll(/#([\p{L}\p{N}_]+)/gu)) {
    const tag = m[1].toLowerCase();
    if (seen.has(tag)) continue;
    seen.add(tag);
    out.push(tag);
  }
  return out;
}

/**
 * SU4: the org's OWN hashtag performance — for each hashtag, how
 * many of the org's published posts used it and how those posts
 * scored (engagementScore, the SP7 discipline). Posts whose
 * insights carry no usable engagement fields are excluded
 * entirely; nothing here comes from outside data, so with no
 * scored posts the honest answer is an empty list.
 */
export function aggregateHashtagPerformance(
  posts: { caption?: unknown; insights?: unknown }[],
): { tag: string; posts: number; totalEngagement: number; avgEngagement: number }[] {
  const byTag = new Map<string, { posts: number; totalEngagement: number }>();
  for (const post of posts ?? []) {
    const score = engagementScore(post?.insights);
    if (score === null) continue;
    for (const tag of extractHashtags(post?.caption)) {
      const entry = byTag.get(tag) ?? { posts: 0, totalEngagement: 0 };
      entry.posts++;
      entry.totalEngagement += score;
      byTag.set(tag, entry);
    }
  }
  return [...byTag.entries()]
    .map(([tag, e]) => ({
      tag: `#${tag}`,
      posts: e.posts,
      totalEngagement: e.totalEngagement,
      avgEngagement: Math.round((e.totalEngagement / e.posts) * 100) / 100,
    }))
    .sort((a, b) => b.totalEngagement - a.totalEngagement)
    .slice(0, 50);
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

/** SU7: calendar day ("YYYY-MM-DD") of an instant in a timezone,
 * via Intl parts (no date library in this codebase). */
export function dayInTimeZone(at: Date, timeZone: string): string {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone, year: "numeric", month: "2-digit", day: "2-digit",
  }).formatToParts(at);
  const get = (t: string) => parts.find((p) => p.type === t)?.value ?? "";
  return `${get("year")}-${get("month")}-${get("day")}`;
}

/** SU7: step a "YYYY-MM-DD" day string by whole days (UTC math
 * on the parsed parts — the string itself is tz-free). */
export function shiftDay(day: string, delta: number): string {
  const [y, m, d] = day.split("-").map(Number);
  const at = new Date(Date.UTC(y, (m ?? 1) - 1, d ?? 1) + delta * 86_400_000);
  const mm = String(at.getUTCMonth() + 1).padStart(2, "0");
  const dd = String(at.getUTCDate()).padStart(2, "0");
  return `${at.getUTCFullYear()}-${mm}-${dd}`;
}

/** SU7: one monthly-report row (see monthlyReport). Metrics carry
 * null for a metric the platform never returned — exports render
 * that as an EMPTY cell, never 0. */
export interface MonthlyReportRow {
  date: string;
  platform: string;
  accountName: string;
  captionExcerpt: string;
  status: string;
  metrics: Record<string, number | null>;
  engagement: number | null;
  linkClicks: number;
}

function csvCell(value: unknown): string {
  const s = value === null || value === undefined ? "" : String(value);
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

/**
 * SU7 — monthly report CSV (pure): BOM (Excel reads Bengali
 * captions correctly), a header naming every metric, then one
 * line per row. An absent metric is an EMPTY cell — a 0 here
 * would claim the platform reported zero, which it did not.
 */
export function buildMonthlyReportCsv(rows: MonthlyReportRow[], month: string): string {
  const header = ["date", "platform", "account", "caption", "status", ...INSIGHT_METRIC_KEYS, "engagement", "linkClicks"];
  const lines = [header.join(",")];
  for (const row of rows ?? []) {
    lines.push([
      row.date, row.platform, row.accountName, row.captionExcerpt, row.status,
      ...INSIGHT_METRIC_KEYS.map((k) => row.metrics?.[k] ?? null),
      row.engagement, row.linkClicks,
    ].map(csvCell).join(","));
  }
  return `﻿${lines.join("\r\n")}\r\n`;
}

/**
 * SU7 — monthly report PDF (pure): a real PDF via the courier
 * module's PdfCanvas/buildPdf (no new dependency). English
 * header; the table carries date / platform / account / status /
 * engagement / clicks plus a totals row summed ONLY over present
 * values.
 *
 * The caption is deliberately NOT in the PDF: PdfCanvas uses
 * WinAnsi Type1 fonts, so a Bengali caption would render as "?"
 * characters — a broken-looking report is worse than a narrower
 * one. The CSV carries the full caption text.
 */
export function buildMonthlyReportPdf(rows: MonthlyReportRow[], month: string): Buffer {
  const list = rows ?? [];
  const pageRows = list.slice(0, 45);
  const c = new PdfCanvas();
  const W = 595, H = 842;
  c.text(48, H - 56, 16, `Monthly Social Report — ${month}`, true);
  c.text(48, H - 74, 9, "Numbers are exactly as the platforms returned them; a missing metric stays blank, never zero.");
  c.line(48, H - 84, W - 48);
  let y = H - 104;
  c.text(48, y, 9, "Date", true);
  c.text(140, y, 9, "Platform", true);
  c.text(220, y, 9, "Account", true);
  c.text(360, y, 9, "Status", true);
  c.text(440, y, 9, "Engagement", true);
  c.text(510, y, 9, "Clicks", true);
  y -= 6; c.line(48, y, W - 48); y -= 16;
  for (const row of pageRows) {
    c.text(48, y, 9, String(row.date ?? "").slice(0, 10));
    c.text(140, y, 9, row.platform ?? "");
    c.text(220, y, 9, String(row.accountName ?? "").slice(0, 24));
    c.text(360, y, 9, row.status ?? "");
    c.text(440, y, 9, row.engagement === null || row.engagement === undefined ? "" : String(row.engagement));
    c.text(510, y, 9, String(row.linkClicks ?? 0));
    y -= 14;
  }
  if (list.length > pageRows.length) {
    y -= 4;
    c.text(48, y, 9, `... and ${list.length - pageRows.length} more posts (see the CSV export for the full list)`);
    y -= 14;
  }
  y -= 6; c.line(48, y, W - 48); y -= 18;
  const totalEngagement = list.reduce((sum, r) => sum + (typeof r.engagement === "number" ? r.engagement : 0), 0);
  const engagementBasis = list.filter((r) => typeof r.engagement === "number").length;
  const totalClicks = list.reduce((sum, r) => sum + (r.linkClicks ?? 0), 0);
  c.text(48, y, 10, `Totals: engagement ${totalEngagement} (from ${engagementBasis} scored posts), link clicks ${totalClicks}, posts ${list.length}`, true);
  return buildPdf([{ width: W, height: H, content: c.build() }]);
}

@Injectable()
export class SocialInsightsService {
  private readonly publisher: MetaSocialPublisher;
  private readonly oauth: SocialOAuthService;
  private readonly threads: ThreadsClient;

  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly social: SocialService,
    private readonly publish: SocialPublishService,
    @Optional() publisher?: MetaSocialPublisher,
    // SN7: Threads insights need the refresh-aware token path +
    // the Threads client. Appended LAST (positional compat);
    // production defaults mirror SocialPublishService's own
    // default OAuth instance construction.
    @Optional() oauth?: SocialOAuthService,
    @Optional() threadsClient?: ThreadsClient,
  ) {
    this.oauth = oauth ?? new SocialOAuthService(prisma, audit);
    this.threads = threadsClient ?? new ThreadsClient();
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
    // SN6: the Telegram Bot API exposes NO per-post views or
    // engagement to bots (spike doc §৩) — so a Telegram post's
    // insights are honestly UNAVAILABLE: this throws before any
    // token resolution, the refresh surface shows the message,
    // and nothing (certainly not a fabricated 0) is stored.
    {
      const account = await (this.prisma as any).socialAccount.findFirst({
        where: { id: post.socialAccountId, organizationId: post.organizationId },
      }).catch(() => null);
      if (account?.platform === "telegram") {
        throw new Error("Telegram Bot API পোস্টের Views/Engagement দেয় না — এই Platform-এর পোস্টের Insights পাওয়া যায় না।");
      }
    }
    const { account, accessToken } = await this.publish.resolveAccountToken(post.organizationId, post.socialAccountId);
    // SN7: Threads media insights — the documented metric set
    // only, through the refresh-aware token (a 60-day token can
    // be inside the skew window). A metric Threads omits stays
    // absent from the stored object (the SP7 rule above). A
    // missing threads_manage_insights scope on an older connect
    // surfaces Meta's permission error verbatim.
    if (account.platform === "threads") {
      const freshToken = await this.oauth.ensureAccessToken(post.organizationId, account);
      const metrics = await this.threads.getMediaInsights(freshToken, String(post.platformPostId));
      return { platform: "threads", ...metrics } as unknown as SocialPostInsights;
    }
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

  /**
   * SU4: hashtag advice grounded in the org's own published
   * posts only (SU7's aggregation, surfaced early for SU4).
   * postsConsidered counts only posts that HAVE an engagement
   * score — the basis the tag numbers stand on.
   */
  async hashtagPerformance(organizationId: string) {
    const rows = await (this.prisma as any).socialPost.findMany({
      where: { organizationId, status: "published" }, take: 500,
    }).catch(() => []);
    const posts = Array.isArray(rows) ? rows : [];
    const tags = aggregateHashtagPerformance(
      posts.map((p: any) => ({ caption: p.caption, insights: p.insights })),
    );
    const postsConsidered = posts.filter((p: any) => engagementScore(p.insights) !== null).length;
    return { tags, postsConsidered };
  }

  /**
   * SN10 — Caption Test comparison: every post carrying a
   * captionTestId, grouped by that id. Numbers are the stored
   * insights verbatim (engagementScore over present fields only);
   * metricsPresent lists ONLY the metric keys actually present as
   * numbers — when engagementScore is null, no engagement-family
   * key can appear there, because none was present. Link clicks
   * are the real SocialLinkClick rows for the post. There is
   * deliberately NO winner field anywhere: both numbers are shown
   * and the reader decides. closeCall is tri-state — true/false
   * only when BOTH posts are published AND both have an
   * engagement score; otherwise null (not decidable yet).
   */
  async listCaptionTests(organizationId: string) {
    const rows = await (this.prisma as any).socialPost.findMany({
      where: { organizationId, captionTestId: { not: null } },
      orderBy: { createdAt: "asc" },
    }).catch(() => []);
    const posts = Array.isArray(rows) ? rows : [];
    const accountIds = [...new Set(posts.map((p: any) => p.socialAccountId).filter(Boolean))];
    const accounts = accountIds.length
      ? await (this.prisma as any).socialAccount.findMany({
          where: { organizationId, id: { in: accountIds } },
        }).catch(() => [])
      : [];
    const accountById = new Map<string, any>(
      (Array.isArray(accounts) ? accounts : []).map((a: any) => [a.id as string, a]),
    );
    const byTest = new Map<string, any[]>();
    for (const post of posts) {
      const list = byTest.get(post.captionTestId) ?? [];
      list.push(post);
      byTest.set(post.captionTestId, list);
    }
    const tests: any[] = [];
    for (const [captionTestId, groupPosts] of byTest.entries()) {
      const serialized: any[] = [];
      for (const post of groupPosts) {
        const account = accountById.get(post.socialAccountId);
        const insights = post.insights && typeof post.insights === "object"
          ? (post.insights as Record<string, unknown>) : null;
        const metricsPresent = insights
          ? INSIGHT_METRIC_KEYS.filter((k) => typeof insights[k] === "number" && Number.isFinite(insights[k] as number))
          : [];
        const linkClicksRaw = await (this.prisma as any).socialLinkClick?.count?.({
          where: { socialPostId: post.id },
        }).catch(() => 0) ?? 0;
        serialized.push({
          id: post.id,
          caption: post.caption ?? "",
          status: post.status,
          scheduledAt: post.scheduledAt ?? null,
          publishedAt: post.publishedAt ?? null,
          platformUrl: post.platformUrl ?? null,
          platform: account?.platform ?? null,
          accountName: account?.name ?? null,
          engagement: engagementScore(post.insights),
          metricsPresent,
          insightsFetchedAt: post.insightsFetchedAt ?? null,
          linkClicks: typeof linkClicksRaw === "number" ? linkClicksRaw : 0,
        });
      }
      const bothPublished = serialized.length >= 2 && serialized.every((p: any) => p.status === "published");
      let closeCall: boolean | null = null;
      if (bothPublished && serialized.length >= 2) {
        const a = serialized[0].engagement;
        const b = serialized[1].engagement;
        if (typeof a === "number" && typeof b === "number") {
          const max = Math.max(a, b);
          closeCall = max > 0 ? Math.abs(a - b) / max < 0.10 : a === b;
        }
      }
      tests.push({ captionTestId, posts: serialized, bothPublished, closeCall });
    }
    // Newest test first (by its newest post's creation time).
    const createdById = new Map<string, number>();
    for (const post of posts) {
      const t = post.createdAt ? new Date(post.createdAt).getTime() : 0;
      createdById.set(post.captionTestId, Math.max(createdById.get(post.captionTestId) ?? 0, t));
    }
    tests.sort((x, y) => (createdById.get(y.captionTestId) ?? 0) - (createdById.get(x.captionTestId) ?? 0));
    return { tests };
  }

  // ---------- SU7: analytics v2 ----------

  /** The org's timezone (getInsightsSummary's pattern). */
  private async orgTimeZone(organizationId: string): Promise<string> {
    const org = await (this.prisma as any).organization?.findFirst?.({
      where: { id: organizationId },
    }).catch(() => null);
    return org?.timezone || "Asia/Dhaka";
  }

  private async publishedPostsWithInsights(organizationId: string): Promise<any[]> {
    const rows = await (this.prisma as any).socialPost.findMany({
      where: { organizationId, status: "published" }, take: 500,
    }).catch(() => []);
    return (Array.isArray(rows) ? rows : [])
      .filter((p: any) => p.insights && typeof p.insights === "object");
  }

  /** Metric totals over a post set — the summary's basis
   * discipline, shared by summary / timeseries / accounts. */
  private metricTotals(posts: any[]): Record<string, { total: number; posts: number }> {
    const totals: Record<string, { total: number; posts: number }> = {};
    for (const key of INSIGHT_METRIC_KEYS) {
      let total = 0;
      let basis = 0;
      for (const post of posts) {
        const v = (post.insights as Record<string, unknown>)?.[key];
        if (typeof v === "number" && Number.isFinite(v)) {
          total += v;
          basis++;
        }
      }
      if (basis > 0) totals[key] = { total, posts: basis };
    }
    return totals;
  }

  /**
   * SU7 — daily time series over the last `days` calendar days
   * (org timezone, today included): per day, metric totals over
   * the posts PUBLISHED that day which carry each metric (each
   * metric carries its own basis), plus the engagement total and
   * how many posts were scored. A day with no scored posts is a
   * structural zero (metrics {}, engagement 0/0) — no post
   * existed, which is a fact, not an estimate.
   */
  async timeseries(organizationId: string, daysInput?: number) {
    const daysRaw = daysInput === undefined || daysInput === null || Number.isNaN(Number(daysInput))
      ? 30 : Math.floor(Number(daysInput));
    const days = Math.min(90, Math.max(1, daysRaw));
    const timeZone = await this.orgTimeZone(organizationId);
    const posts = await this.publishedPostsWithInsights(organizationId);
    const today = dayInTimeZone(new Date(), timeZone);
    const byDay = new Map<string, any[]>();
    for (const post of posts) {
      if (!post.publishedAt) continue;
      const day = dayInTimeZone(new Date(post.publishedAt), timeZone);
      const list = byDay.get(day) ?? [];
      list.push(post);
      byDay.set(day, list);
    }
    const series: { day: string; metrics: Record<string, { total: number; posts: number }>; engagement: { total: number; posts: number } }[] = [];
    for (let i = days - 1; i >= 0; i--) {
      const day = shiftDay(today, -i);
      const dayPosts = byDay.get(day) ?? [];
      let engTotal = 0;
      let engPosts = 0;
      for (const post of dayPosts) {
        const score = engagementScore(post.insights);
        if (score !== null) { engTotal += score; engPosts++; }
      }
      series.push({
        day,
        metrics: this.metricTotals(dayPosts),
        engagement: { total: engTotal, posts: engPosts },
      });
    }
    return { days, timeZone, series };
  }

  /**
   * SU7 — content-type analysis from the org's OWN published
   * posts' mediaRefs: video (any video ref) / carousel (>1 ref)
   * / photo (exactly 1 image) / text (none). engagementTotal and
   * engagementAvg are null when NO post of that type has a
   * score — an average over missing data is never invented.
   */
  async contentTypes(organizationId: string) {
    const rows = await (this.prisma as any).socialPost.findMany({
      where: { organizationId, status: "published" }, take: 500,
    }).catch(() => []);
    const posts = Array.isArray(rows) ? rows : [];
    const buckets = new Map<string, { posts: number; withInsights: number; scored: number; engagementTotal: number }>();
    for (const type of ["video", "carousel", "photo", "text"]) {
      buckets.set(type, { posts: 0, withInsights: 0, scored: 0, engagementTotal: 0 });
    }
    for (const post of posts) {
      const refs = Array.isArray(post.mediaRefs) ? post.mediaRefs : [];
      const type = refs.some((r: any) => r?.kind === "video")
        ? "video"
        : refs.length > 1 ? "carousel"
        : refs.length === 1 ? "photo"
        : "text";
      const bucket = buckets.get(type)!;
      bucket.posts++;
      if (post.insights && typeof post.insights === "object") bucket.withInsights++;
      const score = engagementScore(post.insights);
      if (score !== null) { bucket.scored++; bucket.engagementTotal += score; }
    }
    return {
      types: [...buckets.entries()].map(([type, b]) => ({
        type,
        posts: b.posts,
        withInsights: b.withInsights,
        engagementTotal: b.scored > 0 ? b.engagementTotal : null,
        engagementAvg: b.scored > 0 ? Math.round((b.engagementTotal / b.scored) * 100) / 100 : null,
      })),
    };
  }

  /**
   * SU7 — per-account comparison: for every account of the org,
   * its published-with-insights posts, per-metric totals (with
   * basis, the summary discipline) and engagement total/basis.
   */
  async accountsComparison(organizationId: string) {
    const accounts = await (this.prisma as any).socialAccount.findMany({
      where: { organizationId }, orderBy: { createdAt: "asc" },
    }).catch(() => []);
    const posts = await this.publishedPostsWithInsights(organizationId);
    const byAccount = new Map<string, any[]>();
    for (const post of posts) {
      const list = byAccount.get(post.socialAccountId) ?? [];
      list.push(post);
      byAccount.set(post.socialAccountId, list);
    }
    return {
      accounts: (Array.isArray(accounts) ? accounts : []).map((account: any) => {
        const own = byAccount.get(account.id) ?? [];
        let engTotal = 0;
        let engPosts = 0;
        for (const post of own) {
          const score = engagementScore(post.insights);
          if (score !== null) { engTotal += score; engPosts++; }
        }
        return {
          accountId: account.id,
          platform: account.platform,
          name: account.name,
          postsWithInsights: own.length,
          totals: this.metricTotals(own),
          engagement: { total: engTotal, posts: engPosts },
        };
      }),
    };
  }

  /**
   * SU7 — daily follower snapshot for the org's connected
   * Meta Page / Instagram accounts. The token comes through the
   * publish service's seam (resolveAccountToken — the same
   * sealed-credential path as publishing); the count comes from
   * Graph exactly (publisher.getFollowerCount). A null count
   * (Graph omitted the field) SKIPS that account — no row, no
   * invented number. Failure-isolated per account; a dead token
   * marks the account like the publish path does. One audit row
   * records the counts (system actor for the automation job).
   * SN7 extends the same discipline to Threads accounts
   * (followers_count via user insights, refresh-aware token).
   */
  async snapshotFollowers(organizationId: string, actorId = "system") {
    const timeZone = await this.orgTimeZone(organizationId);
    const day = dayInTimeZone(new Date(), timeZone);
    const accounts = await (this.prisma as any).socialAccount.findMany({
      where: { organizationId, status: "connected", platform: { in: ["meta_page", "instagram", "threads"] } },
    }).catch(() => []);
    const list = Array.isArray(accounts) ? accounts : [];
    const results: { accountId: string; status: "snapshotted" | "skipped" | "failed"; followers?: number; error?: string }[] = [];
    let snapshotted = 0;
    let skipped = 0;
    let failed = 0;
    for (const account of list) {
      try {
        // SN7: a Threads account's count comes from USER insights
        // (followers_count) with the refresh-aware token — the
        // profile itself carries no follower field. A null count
        // SKIPS the account below, exactly like a Meta null.
        let followers: number | null;
        if (account.platform === "threads") {
          const freshToken = await this.oauth.ensureAccessToken(organizationId, account);
          followers = await this.threads.getFollowerCount(freshToken, account.externalId);
        } else {
          const { accessToken } = await this.publish.resolveAccountToken(organizationId, account.id);
          followers = await this.publisher.getFollowerCount(accessToken, account.platform, account.externalId);
        }
        if (followers === null) {
          skipped++;
          results.push({ accountId: account.id, status: "skipped" });
          continue;
        }
        await (this.prisma as any).socialAccountFollowerSnapshot.upsert({
          where: { socialAccountId_day: { socialAccountId: account.id, day } },
          create: { organizationId, socialAccountId: account.id, day, followers },
          update: { followers },
        });
        snapshotted++;
        results.push({ accountId: account.id, status: "snapshotted", followers });
      } catch (e) {
        failed++;
        const message = e instanceof Error ? e.message : String(e);
        if (isTokenDeadError(e)) {
          await this.publish.markAccountTokenDead(account.id, message).catch(() => undefined);
        }
        results.push({ accountId: account.id, status: "failed", error: message });
      }
    }
    await this.audit.log({
      organizationId, userId: actorId, action: "social.follower_snapshot",
      entityType: "Organization", entityId: organizationId,
      metadata: { day, checked: list.length, snapshotted, skipped, failed },
    }).catch(() => undefined);
    return { checked: list.length, snapshotted, skipped, failed, results };
  }

  /**
   * SU7 — follower history per account: stored snapshots only,
   * day ascending. An account with no snapshot yet returns an
   * EMPTY array — the chart shows a gap, not a fabricated line.
   */
  async followers(organizationId: string) {
    const accounts = await (this.prisma as any).socialAccount.findMany({
      where: { organizationId }, orderBy: { createdAt: "asc" },
    }).catch(() => []);
    const snapshots = await (this.prisma as any).socialAccountFollowerSnapshot?.findMany?.({
      where: { organizationId }, orderBy: { day: "asc" },
    }).catch(() => []) ?? [];
    const byAccount = new Map<string, { day: string; followers: number }[]>();
    for (const snap of Array.isArray(snapshots) ? snapshots : []) {
      const list = byAccount.get(snap.socialAccountId) ?? [];
      list.push({ day: snap.day, followers: snap.followers });
      byAccount.set(snap.socialAccountId, list);
    }
    return {
      accounts: (Array.isArray(accounts) ? accounts : []).map((account: any) => ({
        accountId: account.id,
        platform: account.platform,
        name: account.name,
        snapshots: byAccount.get(account.id) ?? [],
      })),
    };
  }

  /**
   * SU7 — monthly report rows: posts whose publishedAt falls in
   * the month (org tz), plus posts never published whose
   * createdAt does. Month defaults to the current org-tz month;
   * a malformed month is a Bengali 400. Metrics are the stored
   * insights verbatim (absent → null); linkClicks is the real
   * SocialLinkClick count for the post.
   */
  async monthlyReport(organizationId: string, monthInput?: string): Promise<{ month: string; timeZone: string; rows: MonthlyReportRow[] }> {
    const timeZone = await this.orgTimeZone(organizationId);
    let month = typeof monthInput === "string" ? monthInput.trim() : "";
    if (!month) month = dayInTimeZone(new Date(), timeZone).slice(0, 7);
    if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(month)) {
      throw new BadRequestException("মাসের ফরম্যাট সঠিক নয় — YYYY-MM আকারে দিন (যেমন 2026-10)।");
    }
    const all = await (this.prisma as any).socialPost.findMany({
      where: { organizationId }, take: 1000,
    }).catch(() => []);
    const rows: MonthlyReportRow[] = [];
    const accounts = await (this.prisma as any).socialAccount.findMany({
      where: { organizationId },
    }).catch(() => []);
    const accountById = new Map<string, any>((Array.isArray(accounts) ? accounts : []).map((a: any) => [a.id as string, a]));
    for (const post of Array.isArray(all) ? all : []) {
      // Inclusion: publishedAt in the month, or (never
      // published) createdAt in the month.
      const stamp = post.publishedAt ?? post.createdAt;
      if (!stamp) continue;
      if (dayInTimeZone(new Date(stamp), timeZone).slice(0, 7) !== month) continue;
      const account = accountById.get(post.socialAccountId);
      const metrics: Record<string, number | null> = {};
      for (const key of INSIGHT_METRIC_KEYS) {
        const v = post.insights && typeof post.insights === "object"
          ? (post.insights as Record<string, unknown>)[key] : undefined;
        metrics[key] = typeof v === "number" && Number.isFinite(v) ? v : null;
      }
      const linkClicks = await (this.prisma as any).socialLinkClick?.count?.({
        where: { socialPostId: post.id },
      }).catch(() => 0) ?? 0;
      const caption = String(post.caption ?? "");
      rows.push({
        date: new Date(stamp).toISOString(),
        platform: account?.platform ?? "",
        accountName: account?.name ?? "",
        captionExcerpt: caption.length > 80 ? caption.slice(0, 80) : caption,
        status: post.status,
        metrics,
        engagement: engagementScore(post.insights),
        linkClicks: typeof linkClicks === "number" ? linkClicks : 0,
      });
    }
    rows.sort((a, b) => a.date.localeCompare(b.date));
    return { month, timeZone, rows };
  }
}
