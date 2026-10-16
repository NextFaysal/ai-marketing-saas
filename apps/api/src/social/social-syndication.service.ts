import { Injectable, Optional } from "@nestjs/common";
import { PrismaService } from "../prisma/prisma.service";
import { AuditService } from "../audit/audit.service";
import { dhakaDayStartUtc } from "../crm/lead-followups";
import { SocialImportService } from "./social-import.service";
import { SocialOAuthService } from "./social-oauth.service";
import { YouTubeClient, type YouTubeUpload } from "./youtube.client";
import { parseFeed } from "./social-feed";

export interface SyndicationError {
  source: "rss" | "youtube";
  error: string;
}

export interface SyndicationResult {
  skipped?: string;
  rssCreated: number;
  youtubeCreated: number;
  errors: SyndicationError[];
}

const verbatim = (e: unknown): string => (e instanceof Error ? e.message : String(e));

/**
 * SN8 — Syndication auto-drafts.
 *
 * The `social_syndication_sweep` automation job polls two
 * sources the org opted into in the SU5 auto-draft settings —
 * an RSS/Atom feed and the org's OWN connected YouTube
 * channel(s) — and turns each NEW item into a DRAFT SocialPost
 * (autoDraftKind "rss_feed" / "youtube_new"). It NEVER
 * publishes or schedules anything, and it holds no reference to
 * any publish path.
 *
 * Discipline shared with the SU5 engine:
 * - no SocialAutoDraftConfig row (or both toggles off) → the
 *   sweep is disabled and creates nothing;
 * - the target account is the SU5 rule exactly: the config's
 *   pinned account when it is this org's + connected, else the
 *   org's first connected meta_page account;
 * - the daily cap is the SU5 count exactly: SocialPosts with
 *   autoDraftKind != null created inside the current Asia/Dhaka
 *   day, across ALL auto-draft kinds. Items skipped BY THE CAP
 *   stay unseen and are retried on a later run.
 *
 * Dedupe is two-layered:
 * - SocialSyndicationSeen (org + source + externalId, unique):
 *   written only AFTER its draft exists. A seen row therefore
 *   suppresses an item forever — even if the draft is later
 *   deleted, the item is never re-drafted.
 * - the post's own autoDraftRef (`rss:<externalId>` /
 *   `yt:<videoId>`): if a post with that ref already exists
 *   (e.g. the seen row was lost), no second draft is made —
 *   the seen row is re-written and the item is skipped.
 *
 * Failure isolation: a feed fetch/parse failure is recorded
 * verbatim in the result's errors and the YouTube branch still
 * runs (and vice versa — one YouTube account's failure is
 * recorded and the next account is tried). The sweep itself
 * only throws on failures outside those branches (e.g. the
 * config read itself), mirroring the job-runner contract.
 */
@Injectable()
export class SocialSyndicationService {
  /**
   * Feed-fetch seam (the SU5 importImage pattern): specs
   * substitute this field; the default goes through
   * SocialImportService's guarded text fetch — the codebase's
   * one SSRF-guarded URL path. No importer wired → throws,
   * which the sweep records as the RSS branch's error.
   */
  fetchFeedText: (url: string) => Promise<string> = async (url: string) => {
    if (!this.importer) throw new Error("SocialImportService is not wired");
    return this.importer.fetchGuardedText(url);
  };

  /**
   * YouTube-uploads seam: specs substitute this field; the
   * default resolves the account's fresh access token through
   * SocialOAuthService.ensureAccessToken and reads the
   * channel's uploads playlist through YouTubeClient.
   */
  listYouTubeUploads: (organizationId: string, account: any) => Promise<YouTubeUpload[]> = async (
    organizationId: string,
    account: any,
  ) => {
    if (!this.oauth) throw new Error("SocialOAuthService is not wired");
    const accessToken = await this.oauth.ensureAccessToken(organizationId, account);
    const client = this.youtube ?? new YouTubeClient();
    return client.listRecentUploads(accessToken);
  };

  constructor(
    private readonly prisma: PrismaService,
    @Optional() private readonly audit?: AuditService,
    @Optional() private readonly importer?: SocialImportService,
    @Optional() private readonly oauth?: SocialOAuthService,
    @Optional() private readonly youtube?: YouTubeClient,
  ) {}

  private p(): any {
    return this.prisma as any;
  }

  private async markSeen(organizationId: string, source: string, externalId: string): Promise<void> {
    await this.p().socialSyndicationSeen
      ?.create({ data: { organizationId, source, externalId } })
      .catch(() => undefined);
  }

  private async isSeen(organizationId: string, source: string, externalId: string): Promise<boolean> {
    const row = await this.p().socialSyndicationSeen
      ?.findFirst({ where: { organizationId, source, externalId } })
      .catch(() => null);
    return Boolean(row);
  }

  /** Create ONE syndication draft + its audit row. Callers have
   * already done the seen / ref / cap checks. */
  private async createDraft(args: {
    organizationId: string;
    socialAccountId: string;
    caption: string;
    linkUrl: string;
    kind: "rss_feed" | "youtube_new";
    ref: string;
  }): Promise<any> {
    const post = await this.p().socialPost.create({
      data: {
        organizationId: args.organizationId,
        socialAccountId: args.socialAccountId,
        caption: args.caption,
        linkUrl: args.linkUrl,
        mediaRefs: [],
        status: "draft",
        autoDraftKind: args.kind,
        autoDraftRef: args.ref,
        createdById: "system",
      },
    });
    await this.audit
      ?.log({
        organizationId: args.organizationId, userId: "system", action: "social.auto_draft_created",
        entityType: "SocialPost", entityId: post.id,
        metadata: { kind: args.kind, ref: args.ref, source: "syndication" },
      })
      .catch(() => undefined);
    return post;
  }

  async runSyndicationSweep(organizationId: string): Promise<SyndicationResult> {
    const result: SyndicationResult = { rssCreated: 0, youtubeCreated: 0, errors: [] };

    const config = await this.p().socialAutoDraftConfig
      ?.findUnique({ where: { organizationId } })
      .catch(() => null);
    if (!config || (config.rssEnabled !== true && config.youtubeEnabled !== true)) {
      return { ...result, skipped: "disabled" };
    }

    // Target account — the SU5 rule, verbatim.
    let account: any = null;
    if (config.socialAccountId) {
      account = await this.p().socialAccount
        .findFirst({ where: { id: config.socialAccountId, organizationId, status: "connected" } })
        .catch(() => null);
    }
    if (!account) {
      account = await this.p().socialAccount.findFirst({
        where: { organizationId, platform: "meta_page", status: "connected" },
        orderBy: { createdAt: "asc" },
      });
    }
    if (!account) return { ...result, skipped: "no_account" };

    // Daily cap — the SU5 count, kept locally and incremented
    // after every successful draft in this run.
    const cap =
      Number.isInteger(config.maxDraftsPerDay) && config.maxDraftsPerDay > 0 ? config.maxDraftsPerDay : 3;
    const dayStart = dhakaDayStartUtc(new Date());
    const dayEnd = new Date(dayStart.getTime() + 86_400_000);
    let todayCount = Number(
      await this.p().socialPost.count({
        where: {
          organizationId,
          autoDraftKind: { not: null },
          createdAt: { gte: dayStart, lt: dayEnd },
        },
      }),
    ) || 0;
    const capReached = () => todayCount >= cap;

    // ---------- RSS / Atom ----------
    if (config.rssEnabled === true && typeof config.rssFeedUrl === "string" && config.rssFeedUrl.trim()) {
      let items: ReturnType<typeof parseFeed> = [];
      try {
        const xml = await this.fetchFeedText(config.rssFeedUrl);
        items = parseFeed(xml);
      } catch (e) {
        result.errors.push({ source: "rss", error: verbatim(e) });
        items = [];
      }
      for (const item of items) {
        if (capReached()) break;
        if (await this.isSeen(organizationId, "rss", item.externalId)) continue;
        const ref = `rss:${item.externalId}`;
        const duplicate = await this.p().socialPost.findFirst({
          where: { organizationId, autoDraftRef: ref },
        });
        if (duplicate) {
          await this.markSeen(organizationId, "rss", item.externalId);
          continue;
        }
        await this.createDraft({
          organizationId,
          socialAccountId: account.id,
          caption: item.title,
          linkUrl: item.link,
          kind: "rss_feed",
          ref,
        });
        await this.markSeen(organizationId, "rss", item.externalId);
        result.rssCreated += 1;
        todayCount += 1;
      }
    }

    // ---------- YouTube (the org's own connected channels) ----------
    if (config.youtubeEnabled === true) {
      const ytAccounts = await this.p().socialAccount
        .findMany({
          where: { organizationId, platform: "youtube", status: "connected" },
          orderBy: { createdAt: "asc" },
        })
        .catch(() => []);
      for (const ytAccount of Array.isArray(ytAccounts) ? ytAccounts : []) {
        if (capReached()) break;
        let uploads: YouTubeUpload[] = [];
        try {
          uploads = await this.listYouTubeUploads(organizationId, ytAccount);
        } catch (e) {
          result.errors.push({ source: "youtube", error: verbatim(e) });
          continue;
        }
        for (const video of Array.isArray(uploads) ? uploads : []) {
          if (capReached()) break;
          const videoId = typeof video?.videoId === "string" ? video.videoId : "";
          const title = typeof video?.title === "string" ? video.title.trim() : "";
          if (!videoId || !title) continue;
          if (await this.isSeen(organizationId, "youtube", videoId)) continue;
          const ref = `yt:${videoId}`;
          const duplicate = await this.p().socialPost.findFirst({
            where: { organizationId, autoDraftRef: ref },
          });
          if (duplicate) {
            await this.markSeen(organizationId, "youtube", videoId);
            continue;
          }
          await this.createDraft({
            organizationId,
            socialAccountId: account.id,
            caption: title,
            linkUrl: `https://www.youtube.com/watch?v=${videoId}`,
            kind: "youtube_new",
            ref,
          });
          await this.markSeen(organizationId, "youtube", videoId);
          result.youtubeCreated += 1;
          todayCount += 1;
        }
      }
    }

    return result;
  }
}
