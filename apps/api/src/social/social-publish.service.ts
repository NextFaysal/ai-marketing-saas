import { BadRequestException, ConflictException, Injectable, Logger, NotFoundException, Optional } from "@nestjs/common";
import { PrismaService } from "../prisma/prisma.service";
import { AuditService } from "../audit/audit.service";
import { decryptJson } from "../integrations/crypto";
import { SocialService, videoOnlyViolation, CLIENT_APPROVAL_PENDING_MSG } from "./social.service";
import { validateForPlatform, TIKTOK_PHOTO_GATE_MSG } from "./social-preflight";
import { addInterval } from "./social-queue-helpers";
import { MetaSocialPublisher, isTokenDeadError } from "./meta-publisher";
import { SocialOAuthService } from "./social-oauth.service";
import { TikTokClient, TikTokPublisher } from "./tiktok.client";
import { YouTubeClient, YouTubePublisher } from "./youtube.client";
import { LinkedInClient } from "./linkedin.client";
import { TelegramClient, TELEGRAM_CAPTION_MAX, TELEGRAM_TEXT_MAX } from "./telegram.client";
import { MediaStore } from "../inbox/media-store";
import { SocialRasterService } from "./social-raster.service";
import { SocialLinkService } from "./social-link.service";
import { effectiveTiktokAppConfig, ensurePlatformConfig } from "../common/platform-config";

/**
 * SP5 — Social publish worker.
 *
 * A publishable error that must NOT burn retry attempts: the
 * content itself can never succeed as-is (e.g. a media format the
 * platform rejects outright). SP6's platform adapters throw this
 * for such content problems; ordinary/transient failures throw a
 * plain Error and go through the retry-with-backoff path.
 */
export class PermanentPublishError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "PermanentPublishError";
  }
}

/** Total publish attempts per scheduled run before a post fails. */
export const MAX_PUBLISH_ATTEMPTS = 3;
/** Backoff after failure #1 → 5 minutes, after #2 → 30 minutes. */
export const BACKOFF_MINUTES = [5, 30];
/** A "publishing" claim older than this is treated as abandoned
 * (the process died mid-publish) and recovered by the due scan. */
export const STALE_CLAIM_MS = 15 * 60_000;
/** Max due posts claimed per organization per scan. */
export const DUE_BATCH = 20;

/**
 * Exactly one publish path: both the manual "publish now" action
 * and the scheduled scan funnel into attemptPublish(). Claiming is
 * a status-conditioned updateMany (draft|scheduled → publishing),
 * so two concurrent attempts can never both publish the same post;
 * a claim that stays "publishing" for over STALE_CLAIM_MS is
 * recovered by the next scan.
 *
 * Honest at-least-once note: a crash AFTER the platform call but
 * BEFORE the result is recorded can re-publish the post on
 * recovery — no platform idempotency key exists for Page posts,
 * so the window is kept small (claim → publish → record, in that
 * order, with nothing else in between) rather than eliminated.
 */
/**
 * SP8: publishToPlatform's widened result. `outcome` defaults to
 * "published"; "sent_to_creator" is TikTok's inbox hand-off —
 * the video reached the creator, who must finish the post in the
 * TikTok app, so publishedAt stays NULL and the status is NOT
 * "published". `publishNote` is the honest platform-state text
 * stored on the post and shown verbatim in the UI.
 */
export interface SocialPublishResult {
  platformPostId: string;
  platformUrl: string | null;
  outcome?: "published" | "sent_to_creator";
  publishNote?: string | null;
}

@Injectable()
export class SocialPublishService {
  private readonly logger = new Logger(SocialPublishService.name);

  private readonly publisher: MetaSocialPublisher;
  private readonly oauth: SocialOAuthService;
  private readonly tiktokPublisher: TikTokPublisher;
  private readonly youtubePublisher: YouTubePublisher;
  private readonly linkedinClient: LinkedInClient;
  private readonly raster: SocialRasterService;
  private readonly links?: SocialLinkService;
  // SN1: raw clients for the steps the orchestrating publishers
  // do not own (YouTube playlists/comments, TikTok photo init).
  private readonly youtubeClient: YouTubeClient;
  private readonly tiktokClient: TikTokClient;
  // SN6: Telegram Bot API client (bot-token platform — the token
  // comes from resolveAccountToken like Meta's, no OAuth seam).
  private readonly telegramClient: TelegramClient;

  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly social: SocialService,
    @Optional() publisher?: MetaSocialPublisher,
    @Optional() oauth?: SocialOAuthService,
    @Optional() tiktokPublisher?: TikTokPublisher,
    @Optional() youtubePublisher?: YouTubePublisher,
    @Optional() raster?: SocialRasterService,
    // CC20: LinkedIn client — kept at positional slot 9 because
    // the CC20 spec constructs this service positionally with the
    // LinkedIn stub there (integration-4 union decision).
    @Optional() linkedinClient?: LinkedInClient,
    // SU6: tracked-link builder. LAST param + Optional so every
    // existing positional spec construction keeps working.
    @Optional() links?: SocialLinkService,
    // SN1: raw YouTube/TikTok clients — appended AFTER links for
    // the same positional-compat reason; specs inject stub-fetch
    // clients here, production defaults to real instances.
    @Optional() youtubeClient?: YouTubeClient,
    @Optional() tiktokClient?: TikTokClient,
    // SN6: appended after the SN1 clients for the same reason.
    @Optional() telegramClient?: TelegramClient,
  ) {
    this.links = links;
    this.youtubeClient = youtubeClient ?? new YouTubeClient();
    this.tiktokClient = tiktokClient ?? new TikTokClient();
    this.telegramClient = telegramClient ?? new TelegramClient();
    // SocialModule does not provide MetaSocialPublisher (it needs
    // no DI of its own), so it is optional here and defaults to a
    // real instance; specs inject one built on a stub fetch.
    this.publisher = publisher ?? new MetaSocialPublisher();
    // SP8: the OAuth token path (refresh-on-expiry lives there).
    // SocialModule provides the real service; specs may inject a
    // stub. The default instance shares this service's prisma +
    // audit, exactly like the module wiring.
    this.oauth = oauth ?? new SocialOAuthService(prisma, audit);
    this.tiktokPublisher = tiktokPublisher ?? new TikTokPublisher(new TikTokClient());
    this.youtubePublisher = youtubePublisher ?? new YouTubePublisher(new YouTubeClient());
    // PP1: SVG → PNG rasterizer (SocialModule provides the real
    // service; specs may inject one with stubbed seams). Defaults
    // to a real instance sharing this service's prisma + audit.
    this.raster = raster ?? new SocialRasterService(prisma, audit);
    // CC20: LinkedIn UGC posting (specs inject a stub-fetch
    // client at this seam).
    this.linkedinClient = linkedinClient ?? new LinkedInClient();
  }

  /**
   * SN1 — the playlists of a YouTube account's own channel, for
   * the composer's playlist picker. A non-YouTube account is an
   * honest Bengali 400 (the picker only asks for YouTube rows,
   * but the route must not pretend otherwise). The token comes
   * from the OAuth service's refresh-aware path, like publish.
   */
  async listYouTubePlaylists(organizationId: string, accountId: string): Promise<{ playlists: { id: string; title: string }[] }> {
    const account = await (this.prisma as any).socialAccount.findFirst({
      where: { id: accountId, organizationId },
    });
    if (!account) throw new NotFoundException("Social account not found in this organization");
    if (account.platform !== "youtube") {
      throw new BadRequestException("Playlist শুধু YouTube অ্যাকাউন্টের জন্য — এই অ্যাকাউন্টটি YouTube চ্যানেল নয়।");
    }
    const accessToken = await this.oauth.ensureAccessToken(organizationId, account);
    const playlists = await this.youtubeClient.listPlaylists(accessToken);
    return { playlists };
  }

  /** Public base URL of this API (payments.service convention). */
  private apiBase(): string {
    return (process.env.API_PUBLIC_URL ?? "http://localhost:4000").replace(/\/$/, "");
  }

  /**
   * SP7-shared account + sealed-token resolution (extracted from
   * publishToPlatform so the SP7 insights service uses the SAME
   * plumbing — no second decrypt path can drift from this one).
   * Every failure here is a PermanentPublishError: a missing or
   * disconnected account/credential cannot fix itself on retry.
   */
  async resolveAccountToken(
    organizationId: string, socialAccountId: string,
    opts?: { allowErrorStatus?: boolean },
  ): Promise<{ account: any; accessToken: string }> {
    const prisma = this.prisma as any;
    const account = await prisma.socialAccount.findFirst({
      where: { id: socialAccountId, organizationId },
    });
    if (!account) {
      throw new PermanentPublishError("পোস্টের Social অ্যাকাউন্টটি পাওয়া যায়নি।");
    }
    // SU10: the health check is the ONE caller allowed to resolve
    // the token of an "error"-status account — re-validating that
    // token is exactly how an error account can honestly recover
    // to "connected". Every other caller (publish, insights)
    // keeps the original rule: only "connected" resolves.
    const statusOk = account.status === "connected"
      || (opts?.allowErrorStatus === true && account.status === "error");
    if (!statusOk || !account.integrationId) {
      throw new PermanentPublishError("এই অ্যাকাউন্টটি এখন সংযুক্ত নেই — Social Posts পেজ থেকে অ্যাকাউন্টটি আবার কানেক্ট করে তারপর প্রকাশ করুন।");
    }
    const integration = await prisma.integration.findFirst({
      where: { id: account.integrationId, organizationId },
      include: { credential: true },
    });
    if (!integration?.credential) {
      throw new PermanentPublishError("অ্যাকাউন্টের Credentials পাওয়া যাচ্ছে না — অ্যাকাউন্টটি আবার কানেক্ট করুন।");
    }
    let accessToken: string;
    try {
      accessToken = decryptJson<{ accessToken: string }>(integration.credential.encryptedData).accessToken;
    } catch {
      // Never log the token or the decrypt error's internals.
      throw new PermanentPublishError("অ্যাকাউন্টের Token পড়া যাচ্ছে না — অ্যাকাউন্টটি আবার কানেক্ট করুন।");
    }
    if (!accessToken) {
      throw new PermanentPublishError("অ্যাকাউন্টের Token পড়া যাচ্ছে না — অ্যাকাউন্টটি আবার কানেক্ট করুন।");
    }
    return { account, accessToken };
  }

  /**
   * SP6/SP7-shared token-death marking: the account honestly shows
   * "error" with Meta's verbatim message (the state SP1's list
   * surfaces); a fresh connect revives it to "connected". Never
   * throws — marking must not mask the original platform error.
   */
  async markAccountTokenDead(accountId: string, message: string): Promise<void> {
    await (this.prisma as any).socialAccount.update({
      where: { id: accountId },
      data: { status: "error", lastError: message },
    }).catch(() => undefined);
  }

  /**
   * SP7: is this org's social approval requirement switched on?
   * Read defensively (a lookup problem reads as OFF) so the
   * publish path keeps its pre-SP7 behaviour whenever the setting
   * cannot be confirmed.
   */
  async approvalRequired(organizationId: string): Promise<boolean> {
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
   * SN2: is this org's CLIENT approval requirement switched on?
   * The publish-path twin of approvalRequired above (same
   * defensive read — a lookup problem reads as OFF, so the
   * publish path keeps its pre-SN2 behaviour whenever the
   * setting cannot be confirmed).
   */
  async clientApprovalRequired(organizationId: string): Promise<boolean> {
    try {
      const model = (this.prisma as any).organization;
      if (!model?.findFirst) return false;
      const org = await model.findFirst({ where: { id: organizationId } });
      return org?.socialRequireClientApproval === true;
    } catch {
      return false;
    }
  }

  /**
   * SN2: the post's latest client review, or null. Reviews are
   * append-only; the latest one is the client's current word
   * (a newer review supersedes an older one). Failure-isolated:
   * any read problem reads as "no review" — which, while the
   * requirement is ON, blocks rather than waves through.
   */
  async latestClientReview(organizationId: string, postId: string): Promise<any | null> {
    try {
      const model = (this.prisma as any).socialPostClientReview;
      if (!model?.findMany) return null;
      const rows = await model.findMany({ where: { organizationId, postId } });
      let latest: any | null = null;
      for (const r of Array.isArray(rows) ? rows : []) {
        if (!latest || new Date(r.createdAt ?? 0).getTime() >= new Date(latest.createdAt ?? 0).getTime()) {
          latest = r;
        }
      }
      return latest;
    } catch {
      return null;
    }
  }

  /**
   * Platform dispatch — SP6: the real Meta Page / Instagram
   * publish via MetaSocialPublisher.
   *
   * Resolution order (all org-scoped; the tenant's own rows only):
   * account → must be "connected" with an integration → sealed
   * PAGE token decrypted from the integration credential → media
   * assets resolved from post.mediaRefs → PP1 SVG→PNG conversion
   * (cached derived asset) → public URLs → publisher dispatch.
   * Content/connection problems that a retry can never fix throw
   * PermanentPublishError (SP5 fails the post at once, attempts
   * untouched); Meta's own errors propagate verbatim through the
   * publisher into the SP5 retry path.
   *
   * Public so specs can replace it per-instance.
   */
  async publishToPlatform(post: any): Promise<SocialPublishResult> {
    const prisma = this.prisma as any;

    const { account, accessToken } = await this.resolveAccountToken(post.organizationId, post.socialAccountId);

    // SN1: a TikTok post's pre-flight needs the audit gate (photo
    // posts ride it) — resolved fresh here, the same read the
    // TikTok dispatch below makes. Other platforms skip the read.
    let tiktokAudited: boolean | undefined;
    if (account.platform === "tiktok") {
      await ensurePlatformConfig(prisma as any).catch(() => undefined);
      tiktokAudited = effectiveTiktokAppConfig()?.audited === true;
    }

    // SU1: full platform pre-flight, right after account
    // resolution and BEFORE any platform dispatch — content that
    // can never succeed fails permanently with the pre-flight
    // message (for OAuth platforms that is the same video-only
    // text the OAuth path itself used).
    const preflightViolation = validateForPlatform(
      { caption: post.caption, mediaRefs: post.mediaRefs, isStory: post.isStory === true, tiktokAudited }, account.platform ?? "",
    );
    if (preflightViolation) throw new PermanentPublishError(preflightViolation);

    // SP8/SP9: OAuth platforms (TikTok / YouTube) take their own
    // dispatch — different media rule (exactly one video),
    // different token path (refresh-on-expiry), different success
    // semantics. The Meta flow below is untouched.
    if (account.platform === "tiktok" || account.platform === "youtube") {
      return this.publishToOAuthPlatform(post, account);
    }

    // CC20: LinkedIn Page takes its own dispatch BEFORE the Meta
    // flow — its media rule is the inverse of TikTok/YouTube's
    // (publishToOAuthPlatform would dereference mediaRefs[0] on
    // a text post and crash; LinkedIn's honest v1 is text + an
    // optional public link, no media upload step at all).
    if (account.platform === "linkedin_page") {
      return this.publishToLinkedIn(post, account);
    }

    // SN6: Telegram takes its own dispatch too — also BEFORE the
    // Meta flow, reusing the token resolveAccountToken already
    // decrypted above (the sealed bot token; bot tokens do not
    // expire, so there is no refresh seam to call).
    if (account.platform === "telegram") {
      return this.publishToTelegram(post, account, accessToken);
    }

    const assetRows: any[] = [];
    for (const ref of (post.mediaRefs ?? []) as { assetId: string; kind: string }[]) {
      const asset = await prisma.mediaAsset.findFirst({
        where: { id: ref.assetId, organizationId: post.organizationId },
      });
      if (!asset) {
        throw new PermanentPublishError("পোস্টের একটি মিডিয়া পাওয়া যাচ্ছে না — মিডিয়াটি আবার বেছে নিয়ে প্রকাশ করুন।");
      }
      assetRows.push(asset);
    }

    // PP1: Meta/Instagram publishing needs raster PNG/JPEG, so
    // each SVG asset (e.g. an SP4 Template Poster) is converted
    // to PNG first — the raster service returns the org's cached
    // derived PNG when one exists, so each SVG is rasterized at
    // most once. Conversion happens BEFORE any platform call and
    // BEFORE any public link is minted; a conversion failure is a
    // content problem a retry cannot fix, so it fails permanently
    // with the converter's verbatim message attached. Non-SVG
    // assets pass through unchanged (the SP6 flow is identical).
    const resolvedRows: any[] = [];
    for (const asset of assetRows) {
      if (!String(asset.contentType ?? "").includes("svg")) {
        resolvedRows.push(asset);
        continue;
      }
      try {
        resolvedRows.push(await this.raster.ensurePngAsset(post.organizationId, post.createdById, asset));
      } catch (e) {
        throw new PermanentPublishError(`SVG থেকে PNG তৈরি করা যায়নি: ${e instanceof Error ? e.message : String(e)}`);
      }
    }

    // Public URLs: Meta fetches media by URL, so each asset needs
    // its SP1 public link. Minting one here is deliberate — the
    // tenant chose to publish this exact asset, and the public
    // link is the SP1 mechanism built for exactly this; it stays
    // revocable from the media library afterwards.
    const assets: { publicUrl: string; kind: string; contentType: string }[] = [];
    for (const asset of resolvedRows) {
      assets.push({
        publicUrl: await this.publicUrlForAsset(post, asset),
        kind: asset.kind,
        contentType: asset.contentType,
      });
    }

    // SU8: FB Page photo story — its own documented flow
    // (unpublished photo → photo_stories), NOT a feed post. The
    // pre-flight above already guaranteed exactly one image.
    // Token-death discipline matches the feed path below.
    if (account.platform === "meta_page" && post.isStory === true) {
      try {
        const story = await this.publisher.publishPhotoStory(accessToken, account.externalId, {
          imageUrl: assets[0].publicUrl,
        });
        return {
          platformPostId: story.platformPostId,
          platformUrl: `https://www.facebook.com/stories/${story.platformPostId}`,
        };
      } catch (e) {
        if (isTokenDeadError(e)) {
          const message = e instanceof Error ? e.message : String(e);
          await this.markAccountTokenDead(account.id, message);
        }
        throw e;
      }
    }

    // SU6: a Meta Page post with a link publishes the TRACKED
    // URL (clicks land on /public/social/r/:token and redirect
    // with UTM). When no tracked URL can be built (API_PUBLIC_URL
    // unconfigured, or the link service is not wired) the raw
    // linkUrl goes out exactly as before. Other platforms are
    // untouched (Instagram's publisher takes no link at all).
    let publishLinkUrl: string | null = post.linkUrl ?? null;
    if (account.platform === "meta_page" && post.linkUrl && this.links) {
      const tracked = await this.links.buildTrackedUrl(post, account).catch(() => null);
      if (tracked) publishLinkUrl = tracked;
    }

    let published: SocialPublishResult;
    try {
      if (account.platform === "instagram") {
        return await this.publisher.publishToInstagram(accessToken, account.externalId, {
          caption: post.caption,
          assets,
        });
      }
      published = await this.publisher.publishToPage(accessToken, account.externalId, {
        caption: post.caption,
        linkUrl: publishLinkUrl,
        assets,
      });
    } catch (e) {
      // Token-dead: Meta says the token itself is invalid/expired.
      // Mark the account honestly ("error" + Meta's verbatim
      // message, the state SP1's list already surfaces; a fresh
      // connect revives it to "connected"), then RETHROW the
      // original error — the post keeps its normal SP5 retry
      // dignity rather than failing permanently on the spot, and
      // its recorded error stays Meta's verbatim text.
      if (isTokenDeadError(e)) {
        const message = e instanceof Error ? e.message : String(e);
        await this.markAccountTokenDead(account.id, message);
      }
      throw e;
    }

    // SN1: FB Page video cover — post-publish thumbnails step,
    // the spike's BUILD path (docs/social-sn1-fb-cover-spike.md
    // §৫.৩), copying SU8's YouTube cover semantics exactly:
    // only a meta_page post with exactly ONE video asset and a
    // coverAssetId reaches here; every other Meta/IG post
    // returns byte-identical to before (no extra read/call).
    // The cover asset must be an IMAGE (SU3 stills are images);
    // a non-image cover, a missing cover, a missing file, or a
    // cover over Meta's documented 10 MB thumbnail limit is
    // NOT attempted — the honest reason goes into the note.
    // A thumbnail failure NEVER unpublishes the video and
    // NEVER marks the token dead: the post stays published
    // with `Cover (thumbnail) সেট করা যায়নি: {verbatim}` in
    // its publishNote. Success leaves the note null, as the
    // Meta path has always had no note. Both outcomes are
    // audited (the YouTube-cover step's record-keeping intent:
    // success and failure both leave a trace alongside the
    // note).
    if (
      account.platform !== "meta_page"
      || !post.coverAssetId
      || !(assets.length === 1 && assets[0].kind === "video")
    ) {
      return published;
    }
    try {
      const cover = await prisma.mediaAsset.findFirst({
        where: { id: post.coverAssetId, organizationId: post.organizationId },
      });
      if (!cover) throw new Error("Cover asset পাওয়া যায়নি");
      if (cover.kind !== "image") {
        throw new Error(`Cover assetটি ছবি নয় (kind: ${cover.kind ?? "unknown"}) — Facebook video cover শুধু ছবি (image) asset দিয়ে সেট করা যায়।`);
      }
      const store = MediaStore.fromEnv();
      const coverSize = await store.size(cover.storageKey).catch(() => null)
        ?? (typeof cover.sizeBytes === "number" && cover.sizeBytes > 0 ? cover.sizeBytes : null);
      if (!coverSize) throw new Error("Cover ফাইল Storage-এ পাওয়া যায়নি");
      if (coverSize > MetaSocialPublisher.VIDEO_THUMBNAIL_MAX_BYTES) {
        throw new Error(`Cover ছবিটি 10 MB সীমার বেশি (${coverSize} bytes) — Facebook Page video thumbnail সর্বোচ্চ 10 MB হতে পারে।`);
      }
      const bytes = await store.readRange(cover.storageKey, 0, coverSize);
      if (!bytes) throw new Error("Cover-এর bytes পড়া যাচ্ছে না");
      if (typeof (this.publisher as any).setVideoThumbnail !== "function") {
        throw new Error("Meta video thumbnail সেট করার publisher method পাওয়া যায়নি");
      }
      await this.publisher.setVideoThumbnail(
        accessToken, published.platformPostId, bytes, cover.contentType, cover.name ?? "cover.jpg",
      );
      await this.audit.log({
        organizationId: post.organizationId, userId: post.createdById, action: "social.fb_video_cover_set",
        entityType: "SocialPost", entityId: post.id,
        metadata: { platformPostId: published.platformPostId, coverAssetId: post.coverAssetId },
      }).catch(() => undefined);
      return published;
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      await this.audit.log({
        organizationId: post.organizationId, userId: post.createdById, action: "social.fb_video_cover_failed",
        entityType: "SocialPost", entityId: post.id,
        metadata: { platformPostId: published.platformPostId, coverAssetId: post.coverAssetId, error: msg },
      }).catch(() => undefined);
      return { ...published, publishNote: `Cover (thumbnail) সেট করা যায়নি: ${msg}` };
    }
  }

  /**
   * SP1 public link for one asset (shared by the Meta flow and
   * SP8's TikTok PULL_FROM_URL): reuse the asset's existing token,
   * mint one when absent (deliberate — the tenant chose to
   * publish this exact asset; the link stays revocable from the
   * media library afterwards).
   */
  private async publicUrlForAsset(post: any, asset: any): Promise<string> {
    const prisma = this.prisma as any;
    let token: string | null = asset.publicToken ?? null;
    if (!token) {
      const linked = await this.social.createPublicLink(post.organizationId, post.createdById, asset.id);
      token = linked?.publicUrl?.split("/public/media/")[1] ?? null;
      if (!token) {
        const fresh = await prisma.mediaAsset.findFirst({
          where: { id: asset.id, organizationId: post.organizationId },
        });
        token = fresh?.publicToken ?? null;
      }
    }
    if (!token) {
      throw new PermanentPublishError("মিডিয়ার Public লিংক তৈরি করা যায়নি — মিডিয়াটি আবার বেছে নিয়ে প্রকাশ করুন।");
    }
    return `${this.apiBase()}/public/media/${token}`;
  }

  /**
   * SP8/SP9 dispatch for the OAuth platforms. Shared gate: the
   * post must carry EXACTLY ONE video (a content problem a retry
   * can never fix → PermanentPublishError, attempts untouched —
   * schedulePost refuses the same posts up front with a 400).
   * The token comes from the OAuth service's refresh-aware path,
   * never from the possibly-stale snapshot resolveAccountToken
   * decrypted on the way in.
   */
  /** Split a long Telegram text at the documented 4096-char
   * message ceiling, preferring a newline boundary. */
  private chunkTelegramText(text: string): string[] {
    const chunks: string[] = [];
    let rest = text;
    while (rest.length > TELEGRAM_TEXT_MAX) {
      let cut = rest.lastIndexOf("\n", TELEGRAM_TEXT_MAX);
      if (cut < TELEGRAM_TEXT_MAX / 2) cut = TELEGRAM_TEXT_MAX;
      chunks.push(rest.slice(0, cut));
      rest = rest.slice(cut).replace(/^\n+/, "");
    }
    if (rest) chunks.push(rest);
    return chunks.length > 0 ? chunks : [""];
  }

  /**
   * SN6 — Telegram channel publish (Bot API; spike doc §৩).
   * Media goes by PUBLIC URL (Telegram fetches it — the SP1
   * public-link path, same as Meta); there is no byte upload in
   * this flow, so a media URL Telegram cannot fetch surfaces
   * Telegram's own verbatim error through the SP5 retry path.
   * Shapes:
   * - no media → sendMessage (text over the 4096 ceiling is
   *   chunked at newline boundaries — Telegram's own rule);
   * - one image/video → sendPhoto/sendVideo with the caption;
   * - 2–10 media → sendMediaGroup, caption on the first item.
   * A caption over the 1024 media-caption ceiling is NOT
   * truncated: the media goes without it and the FULL caption
   * follows as its own message(s) — nothing the tenant wrote is
   * silently dropped. The post's linkUrl (Telegram has no link
   * field) is appended to the text/caption when not already in
   * it. Success = Telegram returned a message: the platform id
   * is "chatId:messageId" and the URL is the public t.me link,
   * present ONLY when the channel has a public username (a
   * private channel's posts have no public URL — null, never
   * fabricated). Telegram client errors propagate verbatim.
   */
  private async publishToTelegram(post: any, account: any, botToken: string): Promise<SocialPublishResult> {
    const prisma = this.prisma as any;
    const chatId = String(account.externalId);
    const caption = String(post.caption ?? "");
    const linkUrl = typeof post.linkUrl === "string" && post.linkUrl ? post.linkUrl : null;
    const fullText = linkUrl && !caption.includes(linkUrl)
      ? (caption ? `${caption}\n\n${linkUrl}` : linkUrl)
      : caption;
    const refs = (Array.isArray(post.mediaRefs) ? post.mediaRefs : []) as { assetId: string; kind: string }[];

    const toResult = (sent: { messageId: number; chatId: number; chatUsername: string | null }): SocialPublishResult => ({
      platformPostId: `${sent.chatId}:${sent.messageId}`,
      platformUrl: sent.chatUsername ? `https://t.me/${sent.chatUsername}/${sent.messageId}` : null,
      outcome: "published",
    });

    if (refs.length === 0) {
      if (!fullText.trim()) {
        throw new PermanentPublishError("Telegram পোস্টে লেখা (Caption) অথবা মিডিয়া — অন্তত একটি প্রয়োজন।");
      }
      let first: { messageId: number; chatId: number; chatUsername: string | null } | null = null;
      for (const chunk of this.chunkTelegramText(fullText)) {
        const sent = await this.telegramClient.sendMessage(botToken, chatId, chunk);
        if (!first) first = sent;
      }
      return toResult(first!);
    }

    // Resolve assets exactly like the Meta flow (missing asset =
    // the same permanent error; SVG images rasterized to PNG
    // first, because Telegram renders linked media itself and an
    // SVG URL is not a photo it can display).
    const media: { type: "photo" | "video"; url: string }[] = [];
    for (const ref of refs) {
      const asset = await prisma.mediaAsset.findFirst({
        where: { id: ref.assetId, organizationId: post.organizationId },
      });
      if (!asset) {
        throw new PermanentPublishError("পোস্টের একটি মিডিয়া পাওয়া যাচ্ছে না — মিডিয়াটি আবার বেছে নিয়ে প্রকাশ করুন।");
      }
      let resolved = asset;
      if (ref.kind === "image" && String(asset.contentType ?? "").includes("svg")) {
        try {
          resolved = await this.raster.ensurePngAsset(post.organizationId, post.createdById, asset);
        } catch (e) {
          throw new PermanentPublishError(`SVG থেকে PNG তৈরি করা যায়নি: ${e instanceof Error ? e.message : String(e)}`);
        }
      }
      media.push({
        type: ref.kind === "video" ? "video" : "photo",
        url: await this.publicUrlForAsset(post, resolved),
      });
    }

    let mediaCaption: string | undefined;
    let spill: string | null = null;
    if (fullText) {
      if (fullText.length <= TELEGRAM_CAPTION_MAX) mediaCaption = fullText;
      else spill = fullText;
    }
    const sendSpill = async () => {
      if (!spill) return;
      for (const chunk of this.chunkTelegramText(spill)) {
        await this.telegramClient.sendMessage(botToken, chatId, chunk);
      }
    };

    if (media.length === 1) {
      const only = media[0]!;
      const sent = only.type === "video"
        ? await this.telegramClient.sendVideo(botToken, chatId, only.url, mediaCaption)
        : await this.telegramClient.sendPhoto(botToken, chatId, only.url, mediaCaption);
      await sendSpill();
      return toResult(sent);
    }

    const group = await this.telegramClient.sendMediaGroup(
      botToken, chatId,
      media.map((m, i) => (i === 0 && mediaCaption ? { ...m, caption: mediaCaption } : m)),
    );
    const firstSent = group[0];
    if (!firstSent) throw new Error("Telegram Media Group-এর কোনো Message ফেরত দেয়নি।");
    await sendSpill();
    return toResult(firstSent);
  }

  /**
   * CC20 — LinkedIn UGC publish. Media rule (ours, honest):
   * text-only posts and link posts (the post's linkUrl rides as
   * an ARTICLE share — LinkedIn builds the preview from the
   * public URL itself). Any mediaRefs → PermanentPublishError:
   * LinkedIn native media needs an asset-upload step this
   * version deliberately does not fake. The result stores the
   * post URN EXACTLY as LinkedIn returns it and NO url —
   * LinkedIn returns none, so none is stored. Failures
   * propagate LinkedIn's own message verbatim.
   *
   * Live use additionally requires the operator's LinkedIn app
   * to hold Community Management API approval — LinkedIn's
   * gate, surfaced verbatim when it refuses.
   */
  private async publishToLinkedIn(post: any, account: any): Promise<SocialPublishResult & { accessToken?: string }> {
    const refs = Array.isArray(post.mediaRefs) ? post.mediaRefs : [];
    if (refs.length > 0) {
      throw new PermanentPublishError("LinkedIn-এ এই সংস্করণে শুধু টেক্সট ও লিংক পোস্ট হয় — ছবি/ভিডিও আপলোডের ধাপ তৈরি হয়নি। মিডিয়া ছাড়া পোস্টটি আবার প্রকাশ করুন।");
    }
    const accessToken = await this.oauth.ensureAccessToken(post.organizationId, account);
    const { platformPostId } = await this.linkedinClient.publishUgcPost(accessToken, {
      organizationId: String(account.externalId),
      text: String(post.caption ?? ""),
      linkUrl: post.linkUrl ?? null,
    });
    // SN1: the fresh token rides along (internal only — never
    // serialized or stored) so the first-comment step reuses THIS
    // token instead of resolving a second one: for LinkedIn the
    // sealed snapshot resolveAccountToken returns can be stale,
    // while ensureAccessToken's is refresh-aware.
    return { platformPostId, platformUrl: null, outcome: "published", accessToken };
  }

  private async publishToOAuthPlatform(post: any, account: any): Promise<SocialPublishResult> {
    const prisma = this.prisma as any;
    const violation = videoOnlyViolation(account.platform, post.mediaRefs);
    if (violation) throw new PermanentPublishError(violation);
    const refs = (post.mediaRefs ?? []) as { assetId: string; kind: string }[];

    // SN1: TikTok PHOTO post — image-only refs take the photo
    // flow (every referenced asset, not just the first). The
    // audit gate was already enforced by publishToPlatform's
    // pre-flight before dispatch; it is re-read here for the
    // publisher call, exactly like the video path reads it.
    if (account.platform === "tiktok" && refs.length > 0 && refs.every((r) => r.kind === "image")) {
      const photoAssets: any[] = [];
      for (const ref of refs) {
        const asset = await prisma.mediaAsset.findFirst({
          where: { id: ref.assetId, organizationId: post.organizationId },
        });
        if (!asset) {
          throw new PermanentPublishError("পোস্টের একটি মিডিয়া পাওয়া যাচ্ছে না — মিডিয়াটি আবার বেছে নিয়ে প্রকাশ করুন।");
        }
        photoAssets.push(asset);
      }
      const accessToken = await this.oauth.ensureAccessToken(post.organizationId, account);
      const photoUrls: string[] = [];
      for (const asset of photoAssets) {
        photoUrls.push(await this.publicUrlForAsset(post, asset));
      }
      await ensurePlatformConfig(prisma as any).catch(() => undefined);
      const audited = effectiveTiktokAppConfig()?.audited === true;
      if (!audited) {
        // Unreachable through publishToPlatform (its pre-flight
        // refuses first with the same message) — kept so a direct
        // caller of this dispatch can never photo-post ungated.
        throw new PermanentPublishError(TIKTOK_PHOTO_GATE_MSG);
      }
      const outcome = await this.tiktokPublisher.publishPhoto({
        accessToken, photoUrls, caption: post.caption,
      });
      return {
        platformPostId: outcome.publishId,
        platformUrl: null,
        outcome: "published",
        publishNote: `TikTok-এ সরাসরি ছবির post হয়েছে (Privacy: ${outcome.privacyLevel} — TikTok Creator Info অনুযায়ী নির্ধারিত)।`,
      };
    }

    const ref = refs[0];
    const asset = await prisma.mediaAsset.findFirst({
      where: { id: ref.assetId, organizationId: post.organizationId },
    });
    if (!asset) {
      throw new PermanentPublishError("পোস্টের একটি মিডিয়া পাওয়া যাচ্ছে না — মিডিয়াটি আবার বেছে নিয়ে প্রকাশ করুন।");
    }

    if (account.platform === "tiktok") {
      const accessToken = await this.oauth.ensureAccessToken(post.organizationId, account);
      const videoUrl = await this.publicUrlForAsset(post, asset);
      await ensurePlatformConfig(prisma as any).catch(() => undefined);
      const audited = effectiveTiktokAppConfig()?.audited === true;
      const outcome = await this.tiktokPublisher.publish({
        accessToken, videoUrl, caption: post.caption, audited,
      });
      if (outcome.mode === "inbox") {
        // NOT published: the video sits in the creator's TikTok
        // inbox/drafts and only the creator can finish the post.
        return {
          platformPostId: outcome.publishId,
          platformUrl: null,
          outcome: "sent_to_creator",
          publishNote: "ভিডিওটি TikTok Creator-এর Inbox-এ পাঠানো হয়েছে — TikTok app-এ গিয়ে post সম্পূর্ণ করুন। এটি এখনো প্রকাশিত (published) নয়।",
        };
      }
      return {
        platformPostId: outcome.publishId,
        platformUrl: null,
        outcome: "published",
        publishNote: `TikTok-এ সরাসরি post হয়েছে (Privacy: ${outcome.privacyLevel} — TikTok Creator Info অনুযায়ী নির্ধারিত)।`,
      };
    }

    if (account.platform === "youtube") {
      const accessToken = await this.oauth.ensureAccessToken(post.organizationId, account);
      // The resumable protocol uploads the BYTES themselves —
      // read them straight from MediaStore storage server-side,
      // never via the public URL (that mechanism exists for
      // platforms that pull; YouTube takes a push). PP2: the
      // bytes move as bounded range reads (one upload chunk in
      // memory at a time) — since PP2's streamed upload admits
      // videos up to the video cap, the publish path must not
      // buffer a whole video either.
      const store = MediaStore.fromEnv();
      const total = await store.size(asset.storageKey).catch(() => null)
        ?? (typeof asset.sizeBytes === "number" && asset.sizeBytes > 0 ? asset.sizeBytes : null);
      if (!total) {
        throw new PermanentPublishError("ভিডিওর ফাইল Storage-এ পাওয়া যাচ্ছে না — মিডিয়াটি আবার আপলোড করে প্রকাশ করুন।");
      }
      // Metadata per the plan: title = the caption's first line
      // (≤100 chars), description = the full caption. SU8: an
      // explicit youtubeTitle wins over the caption-derived one;
      // a Short gets "#Shorts" appended unless already present
      // (the base is trimmed so the total stays ≤100 chars).
      const firstLine = String(post.caption ?? "").split(/\r?\n/).map((s: string) => s.trim()).find((s: string) => s.length > 0) ?? "";
      let title = (typeof post.youtubeTitle === "string" && post.youtubeTitle.trim()
        ? post.youtubeTitle.trim()
        : (firstLine || String(post.caption ?? "").trim())).slice(0, 100);
      if (post.youtubeIsShort === true && !/#shorts/i.test(title)) {
        const suffix = " #Shorts";
        title = `${title.slice(0, 100 - suffix.length).trimEnd()}${suffix}`;
      }
      const youtubeTags = Array.isArray(post.youtubeTags)
        ? post.youtubeTags.filter((t: unknown) => typeof t === "string") as string[]
        : undefined;
      const youtubeCategoryId = typeof post.youtubeCategoryId === "string" && post.youtubeCategoryId
        ? post.youtubeCategoryId : undefined;
      const outcome = await this.youtubePublisher.uploadFromSource({
        accessToken,
        source: {
          size: total,
          contentType: asset.contentType,
          readRange: async (offset: number, length: number) => {
            const buf = await store.readRange(asset.storageKey, offset, length);
            if (!buf) throw new Error("YouTube upload ব্যর্থ — Storage থেকে ভিডিওর bytes পড়া যাচ্ছে না।");
            return buf;
          },
        },
        title, description: String(post.caption ?? ""),
        ...(youtubeTags !== undefined ? { tags: youtubeTags } : {}),
        ...(youtubeCategoryId !== undefined ? { categoryId: youtubeCategoryId } : {}),
      });
      const baseNote = "YouTube-এ Private হিসেবে আপলোড হয়েছে — app যাচাই সম্পন্ন হলে Public করা যাবে। (Unverified app-এর upload YouTube নিজে Private আটকে রাখে; ভিডিওটি Channel-এ YouTube Studio-তে দেখা যাবে।)";
      // SU8: cover (custom thumbnail) — set AFTER a successful
      // upload, from the cover asset's stored bytes (readRange,
      // the video path's pattern). A thumbnail failure NEVER
      // unpublishes the video: the post stays published and the
      // verbatim reason is appended to the publish note.
      let publishNote = baseNote;
      if (post.coverAssetId) {
        try {
          const cover = await prisma.mediaAsset.findFirst({
            where: { id: post.coverAssetId, organizationId: post.organizationId },
          });
          if (!cover) throw new Error("Cover asset পাওয়া যায়নি");
          const coverSize = await store.size(cover.storageKey).catch(() => null)
            ?? (typeof cover.sizeBytes === "number" && cover.sizeBytes > 0 ? cover.sizeBytes : null);
          if (!coverSize) throw new Error("Cover ফাইল Storage-এ পাওয়া যায়নি");
          const bytes = await store.readRange(cover.storageKey, 0, coverSize);
          if (!bytes) throw new Error("Cover-এর bytes পড়া যাচ্ছে না");
          await this.youtubePublisher.setThumbnail(accessToken, outcome.videoId, bytes, cover.contentType);
        } catch (e) {
          const msg = e instanceof Error ? e.message : String(e);
          publishNote = `${baseNote} Cover (thumbnail) সেট করা যায়নি: ${msg}`;
        }
      }
      // SN1: playlist — add the uploaded video to the chosen
      // playlist (playlistItems.insert) AFTER the successful
      // upload. The cover semantics apply verbatim: a failure
      // NEVER unpublishes the video — the post stays published
      // and the verbatim reason is appended to the publish note.
      if (typeof post.youtubePlaylistId === "string" && post.youtubePlaylistId) {
        try {
          await this.youtubeClient.addToPlaylist(accessToken, post.youtubePlaylistId, outcome.videoId);
        } catch (e) {
          const msg = e instanceof Error ? e.message : String(e);
          publishNote = `${publishNote} Playlist-এ যোগ করা যায়নি: ${msg}`;
        }
      }
      return {
        platformPostId: outcome.videoId,
        platformUrl: `https://www.youtube.com/watch?v=${outcome.videoId}`,
        outcome: "published",
        // The upload is REAL (the video is on the channel), but
        // YouTube locks unverified-app uploads to PRIVATE — the
        // note says exactly that, wherever the post is shown.
        publishNote,
      };
    }

    throw new PermanentPublishError(`এই Platform-এ প্রকাশ এখনো চালু হয়নি: ${account.platform}`);
  }

  /**
   * Manual publish: claim a draft/scheduled post and run the one
   * publish path synchronously, then return the fresh serialized
   * post (whatever state the attempt left it in).
   */
  async publishNow(organizationId: string, actorId: string, postId: string) {
    const row = await (this.prisma as any).socialPost.findFirst({ where: { id: postId, organizationId } });
    if (!row) throw new NotFoundException("Social post not found in this organization");
    // CC17: the manual publish path enforces the member deny-list
    // for the post's account. CC27: the scheduled sweep now
    // re-checks the AUTHOR's deny-list at publish time too (see
    // runDuePublishes) — this manual path keeps its own check on
    // the ACTING member, who may differ from the author.
    await this.social.assertAccountAccess(organizationId, actorId, row.socialAccountId);
    if (!["draft", "scheduled"].includes(row.status)) {
      throw new ConflictException("এই পোস্টটি এখন প্রকাশ করা যাবে না — এটি ইতিমধ্যে প্রকাশিত/প্রকাশ হচ্ছে/বাতিল অবস্থায় আছে।");
    }
    // SP7 approval gate: while the org requires approval, a post
    // that is not approved (pending / rejected / never submitted)
    // cannot be published by hand either — approval first.
    if ((await this.approvalRequired(organizationId)) && row.approvalStatus !== "approved") {
      throw new ConflictException("পোস্টটি অনুমোদিত নয় — অনুমোদন ব্যবস্থা চালু থাকলে প্রকাশের আগে OWNER/ADMIN-এর অনুমোদন লাগবে। আগে পোস্টটি অনুমোদনের জন্য পাঠান।");
    }
    // SN2 client-approval gate: beside the internal gate above —
    // while socialRequireClientApproval is on, the post also
    // needs the client's latest review to be "approved" (never
    // reviewed and changes_requested both block, with the one
    // verbatim reason).
    if (await this.clientApprovalRequired(organizationId)) {
      const latest = await this.latestClientReview(organizationId, postId);
      if (latest?.decision !== "approved") {
        throw new ConflictException(CLIENT_APPROVAL_PENDING_MSG);
      }
    }
    const claim = await (this.prisma as any).socialPost.updateMany({
      where: { id: postId, organizationId, status: { in: ["draft", "scheduled"] } },
      data: { status: "publishing" },
    });
    if (!claim?.count) {
      throw new ConflictException("পোস্টটি অন্য একটি প্রক্রিয়ায় প্রকাশ হচ্ছে — কিছুক্ষণ পর আবার চেষ্টা করুন।");
    }
    await this.audit.log({
      organizationId, userId: actorId, action: "social.post_publish_requested",
      entityType: "SocialPost", entityId: postId, metadata: { fromStatus: row.status },
    });
    await this.attemptPublish({ ...row, status: "publishing" });
    return this.social.getPost(organizationId, postId);
  }

  /**
   * Scheduled scan (driven by the "social_publish_due" automation
   * job, every 5 minutes): first recover abandoned claims, then
   * claim and publish every due post in scheduledAt order.
   */
  async runDuePublishes(organizationId: string): Promise<{ recovered: number; due: number; published: number; rescheduled: number; failed: number; blocked: number }> {
    const counts = { recovered: 0, due: 0, published: 0, rescheduled: 0, failed: 0, blocked: 0 };

    // (a) Stale-claim recovery: a post stuck in "publishing" past
    // the stale window means the previous attempt died mid-flight
    // (attempts untouched — that attempt never completed). It goes
    // back to scheduled for immediate retry, with an honest note.
    const stale = await (this.prisma as any).socialPost.findMany({
      where: { organizationId, status: "publishing", updatedAt: { lt: new Date(Date.now() - STALE_CLAIM_MS) } },
    }).catch(() => []);
    for (const post of Array.isArray(stale) ? stale : []) {
      await (this.prisma as any).socialPost.update({
        where: { id: post.id },
        data: {
          status: "scheduled", scheduledAt: new Date(),
          error: "আগের Publish প্রচেষ্টা মাঝপথে থেমে গিয়েছিল — পোস্টটি আবার শিডিউল করা হয়েছে।",
        },
      }).catch(() => undefined);
      counts.recovered++;
    }

    // (b) Due posts: claim each in scheduledAt order; a claim that
    // lands 0 rows means another process took it — skip silently.
    const dueRows = await (this.prisma as any).socialPost.findMany({
      where: { organizationId, status: "scheduled", scheduledAt: { lte: new Date() } },
      orderBy: { scheduledAt: "asc" }, take: DUE_BATCH,
    }).catch(() => []);
    // SP7: the approval requirement is read ONCE per scan, but each
    // post's approval is re-checked against a FRESH row at claim
    // time — an approval revoked (or never given) after scheduling
    // must stop the publish, not ride through on a stale read.
    const approvalOn = await this.approvalRequired(organizationId);
    // SN2: the client-approval requirement is read ONCE per scan
    // too; each post's latest client review is re-checked fresh
    // at claim time, exactly like the internal approval above.
    const clientApprovalOn = await this.clientApprovalRequired(organizationId);
    for (const row of Array.isArray(dueRows) ? dueRows : []) {
      counts.due++;
      // CC27: the deny-list is re-checked at PUBLISH time against
      // the post's AUTHOR — a post scheduled while its author was
      // allowed, whose account has since been denied to them in
      // the Connect Center matrix, must NOT go out. Not a silent
      // skip: the post returns to draft with the reason written
      // on it (the SP7 blocked pattern) and the refusal is
      // audited, so the team sees exactly what happened.
      if (await this.social.isAccountDenied(organizationId, row.createdById, row.socialAccountId).catch(() => false)) {
        await (this.prisma as any).socialPost.update({
          where: { id: row.id },
          data: {
            status: "draft", scheduledAt: null,
            error: "পোস্টটি প্রকাশ হয়নি — পোস্টের লেখকের এই সোশ্যাল অ্যাকাউন্ট ব্যবহারের অনুমতি Connect Center-এর অ্যাক্সেস সেটিংসে প্রত্যাহার করা হয়েছে। পোস্টটি Draft-এ ফিরিয়ে দেওয়া হয়েছে; অনুমতি ফিরিয়ে দিয়ে আবার শিডিউল করুন, অথবা অন্য সদস্য প্রকাশ করুন।",
          },
        }).catch(() => undefined);
        await this.audit.log({
          organizationId, userId: row.createdById ?? "system", action: "social.post_publish_denied",
          entityType: "SocialPost", entityId: row.id,
          metadata: { socialAccountId: row.socialAccountId, reason: "author_connection_denied" },
        }).catch(() => undefined);
        counts.blocked++;
        continue;
      }
      if (approvalOn) {
        const fresh = await (this.prisma as any).socialPost.findFirst({
          where: { id: row.id, organizationId },
        }).catch(() => null);
        if (!fresh || fresh.approvalStatus !== "approved") {
          // Not a silent skip: the post goes back to draft with the
          // reason written on it, so the tenant sees exactly why
          // it did not go out and what to do next.
          await (this.prisma as any).socialPost.update({
            where: { id: row.id },
            data: {
              status: "draft", scheduledAt: null,
              error: "অনুমোদন না থাকায় পোস্টটি প্রকাশ হয়নি — অনুমোদন ব্যবস্থা চালু থাকলে প্রকাশের আগে অনুমোদন লাগে। পোস্টটি Draft-এ ফিরিয়ে দেওয়া হয়েছে; অনুমোদন নিয়ে আবার শিডিউল করুন।",
            },
          }).catch(() => undefined);
          counts.blocked++;
          continue;
        }
      }
      if (clientApprovalOn) {
        const latest = await this.latestClientReview(organizationId, row.id);
        if (latest?.decision !== "approved") {
          // Same non-silent pattern as the internal-approval
          // block above: back to draft with the verbatim reason
          // on the post, so the team sees why it did not go out.
          await (this.prisma as any).socialPost.update({
            where: { id: row.id },
            data: {
              status: "draft", scheduledAt: null,
              error: CLIENT_APPROVAL_PENDING_MSG,
            },
          }).catch(() => undefined);
          counts.blocked++;
          continue;
        }
      }
      const claim = await (this.prisma as any).socialPost.updateMany({
        where: { id: row.id, status: "scheduled" }, data: { status: "publishing" },
      }).catch(() => null);
      if (!claim?.count) continue;
      const outcome = await this.attemptPublish({ ...row, status: "publishing" });
      counts[outcome]++;
    }
    return counts;
  }

  /**
   * The one publish path. Success → published (+ platform ids,
   * error cleared). PermanentPublishError → failed immediately,
   * attempts untouched. Any other error → attempts + 1: below the
   * cap the post goes back to scheduled with backoff and the error
   * kept visible; at the cap it fails and notifies OWNER/ADMIN.
   */
  private async attemptPublish(post: any): Promise<"published" | "rescheduled" | "failed"> {
    try {
      const r = await this.publishToPlatform(post);
      // SP8: "sent_to_creator" (TikTok inbox) is a completed
      // hand-off, NOT a publish — status reflects exactly that,
      // publishedAt stays NULL, and the honest note is stored.
      // The scan counter still counts it with the successes: the
      // post's lifecycle for this run is complete.
      const sentToCreator = r.outcome === "sent_to_creator";
      await (this.prisma as any).socialPost.update({
        where: { id: post.id },
        data: {
          status: sentToCreator ? "sent_to_creator" : "published",
          ...(sentToCreator ? {} : { publishedAt: new Date() }),
          platformPostId: r.platformPostId, platformUrl: r.platformUrl ?? null,
          publishNote: r.publishNote ?? null, error: null,
        },
      });
      // SU1/SU2 finalize (published only — a TikTok inbox
      // hand-off is not a publish): first comment, then the
      // recurrence chain. Each step is failure-isolated: neither
      // can turn a published post into a failure. The guards keep
      // posts without these fields on the exact pre-SU path (no
      // extra reads/writes).
      if (!sentToCreator) {
        if (post.firstCommentText) {
          // SN1: LinkedIn's publish result carries its fresh
          // token for the comment step (see publishToLinkedIn).
          const publishToken = (r as { accessToken?: string }).accessToken;
          await this.tryPostFirstComment(post, r.platformPostId, publishToken).catch(() => undefined);
        }
        if (post.recurrenceFrequency && post.seriesId && post.scheduledAt) {
          await this.finalizeRecurrence(post).catch(() => undefined);
        }
      }
      return "published";
    } catch (e) {
      const msg = e instanceof Error ? e.message : "Publish failed";
      if (e instanceof PermanentPublishError) {
        await (this.prisma as any).socialPost.update({
          where: { id: post.id }, data: { status: "failed", error: msg },
        });
        await this.notifyFailed(post, msg);
        return "failed";
      }
      const attempts = (post.attempts ?? 0) + 1;
      if (attempts >= MAX_PUBLISH_ATTEMPTS) {
        await (this.prisma as any).socialPost.update({
          where: { id: post.id }, data: { status: "failed", attempts, error: msg },
        });
        await this.notifyFailed(post, msg);
        return "failed";
      }
      const backoff = BACKOFF_MINUTES[Math.min(attempts - 1, BACKOFF_MINUTES.length - 1)];
      await (this.prisma as any).socialPost.update({
        where: { id: post.id },
        data: { status: "scheduled", attempts, error: msg, scheduledAt: new Date(Date.now() + backoff * 60_000) },
      });
      return "rescheduled";
    }
  }

  /**
   * SU1 — post the first comment after a successful publish.
   * Meta Page / Instagram go through MetaSocialPublisher; SN1
   * extends the same step to YouTube (commentThreads.insert on
   * the uploaded video) and LinkedIn (socialActions comments on
   * the post URN). Failure is recorded verbatim on the post
   * (firstCommentStatus "failed") and NEVER rethrown — the post
   * stays published. TikTok has no comment step here.
   *
   * Token discipline per platform: Meta uses the sealed Page/IG
   * token (resolveAccountToken, as SU1 always did); YouTube uses
   * the OAuth service's refresh-aware token (its sealed snapshot
   * can be stale — the publish path does the same); LinkedIn
   * reuses the token its publish just refreshed (passed in by
   * attemptPublish), falling back to the refresh-aware path when
   * called without one.
   */
  async tryPostFirstComment(post: any, platformPostId: string, publishAccessToken?: string): Promise<void> {
    const prisma = this.prisma as any;
    try {
      const { account, accessToken } = await this.resolveAccountToken(post.organizationId, post.socialAccountId);
      if (account.platform === "youtube") {
        const freshToken = await this.oauth.ensureAccessToken(post.organizationId, account);
        const { commentId } = await this.youtubeClient.postComment(
          freshToken, platformPostId, String(post.firstCommentText),
        );
        await prisma.socialPost.update({
          where: { id: post.id },
          data: { firstCommentStatus: "posted", firstCommentId: commentId, firstCommentError: null },
        }).catch(() => undefined);
        await this.audit.log({
          organizationId: post.organizationId, userId: post.createdById, action: "social.first_comment_posted",
          entityType: "SocialPost", entityId: post.id, metadata: { firstCommentId: commentId },
        }).catch(() => undefined);
        return;
      }
      if (account.platform === "linkedin_page") {
        const token = publishAccessToken ?? (await this.oauth.ensureAccessToken(post.organizationId, account));
        const { commentId } = await this.linkedinClient.createComment(token, {
          organizationId: String(account.externalId),
          postUrn: platformPostId,
          text: String(post.firstCommentText),
        });
        await prisma.socialPost.update({
          where: { id: post.id },
          data: { firstCommentStatus: "posted", firstCommentId: commentId, firstCommentError: null },
        }).catch(() => undefined);
        await this.audit.log({
          organizationId: post.organizationId, userId: post.createdById, action: "social.first_comment_posted",
          entityType: "SocialPost", entityId: post.id, metadata: { firstCommentId: commentId },
        }).catch(() => undefined);
        return;
      }
      if (account.platform !== "meta_page" && account.platform !== "instagram") return;
      const { commentId } = await this.publisher.postFirstComment(
        accessToken, account.platform, platformPostId, String(post.firstCommentText),
      );
      await prisma.socialPost.update({
        where: { id: post.id },
        data: { firstCommentStatus: "posted", firstCommentId: commentId, firstCommentError: null },
      }).catch(() => undefined);
      await this.audit.log({
        organizationId: post.organizationId, userId: post.createdById, action: "social.first_comment_posted",
        entityType: "SocialPost", entityId: post.id, metadata: { firstCommentId: commentId },
      }).catch(() => undefined);
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      await prisma.socialPost.update({
        where: { id: post.id },
        data: { firstCommentStatus: "failed", firstCommentError: msg },
      }).catch(() => undefined);
      await this.audit.log({
        organizationId: post.organizationId, userId: post.createdById, action: "social.first_comment_failed",
        entityType: "SocialPost", entityId: post.id, metadata: { error: msg },
      }).catch(() => undefined);
    }
  }

  /**
   * SU2 — recurrence chain: after a recurring post publishes,
   * create exactly one next instance scheduled at
   * scheduledAt + interval (anchored to the SCHEDULED time, so
   * the series never drifts). Idempotent on (seriesId, nextAt);
   * a fresh read of the source decides — if it is no longer
   * published/sent or its recurrence was removed, no chain.
   * Never throws.
   */
  async finalizeRecurrence(post: any): Promise<void> {
    try {
      if (!post?.recurrenceFrequency || !post?.seriesId || !post?.scheduledAt) return;
      const prisma = this.prisma as any;
      const source = await prisma.socialPost.findFirst({
        where: { id: post.id, organizationId: post.organizationId },
      }).catch(() => null);
      if (!source) return;
      if (!["published", "sent_to_creator"].includes(source.status)) return;
      if (!source.recurrenceFrequency || !source.seriesId || !source.scheduledAt) return;
      const nextAt = addInterval(new Date(source.scheduledAt), source.recurrenceFrequency, source.recurrenceInterval ?? 1);
      const existing = await prisma.socialPost.findFirst({
        where: { organizationId: post.organizationId, seriesId: source.seriesId, scheduledAt: nextAt },
      }).catch(() => null);
      if (existing) return;
      const firstCommentText = source.firstCommentText ?? null;
      const approval = source.approvalStatus === "approved"
        ? { approvalStatus: "approved", submittedById: source.submittedById ?? null, reviewedById: source.reviewedById ?? null }
        : {};
      const created = await prisma.socialPost.create({
        data: {
          organizationId: post.organizationId, socialAccountId: source.socialAccountId,
          caption: source.caption, linkUrl: source.linkUrl ?? null,
          mediaRefs: Array.isArray(source.mediaRefs) ? source.mediaRefs : [],
          status: "scheduled", scheduledAt: nextAt,
          firstCommentText, firstCommentStatus: firstCommentText ? "pending" : null,
          // SN1: the series keeps its chosen YouTube playlist.
          youtubePlaylistId: source.youtubePlaylistId ?? null,
          seriesId: source.seriesId,
          recurrenceFrequency: source.recurrenceFrequency,
          recurrenceInterval: source.recurrenceInterval ?? null,
          attempts: 0, createdById: source.createdById, ...approval,
        },
      });
      await this.audit.log({
        organizationId: post.organizationId, userId: source.createdById, action: "social.post_recurrence_chained",
        entityType: "SocialPost", entityId: created.id,
        metadata: { sourcePostId: source.id, seriesId: source.seriesId, scheduledAt: nextAt.toISOString() },
      }).catch(() => undefined);
    } catch (e) {
      this.logger.warn(`social recurrence chain failed for post ${post?.id}: ${e instanceof Error ? e.message : "unknown"}`);
    }
  }

  /**
   * Terminal-failure notification (ads pattern): ACTIVE
   * OWNER/ADMIN members get an AgentNotification of type
   * "social_post_failed". Fully failure-isolated — a notification
   * problem never affects the publish outcome. Never throws.
   */
  private async notifyFailed(post: any, errorMessage: string): Promise<void> {
    try {
      const account = await (this.prisma as any).socialAccount.findFirst({
        where: { id: post.socialAccountId, organizationId: post.organizationId },
      }).catch(() => null);
      const accountName: string = account?.name ?? "Social অ্যাকাউন্ট";
      const memberships = await (this.prisma as any).membership.findMany({
        where: { organizationId: post.organizationId, status: "ACTIVE" }, take: 200,
      }).catch(() => []);
      const recipients = [...new Set((memberships as any[])
        .filter((m) => ["OWNER", "ADMIN"].includes(m.role))
        .map((m) => m.userId as string))];
      if (recipients.length === 0) return;
      const caption = String(post.caption ?? "");
      const excerpt = caption.length > 120 ? caption.slice(0, 120) : caption;
      const title = `Social পোস্ট প্রকাশ ব্যর্থ হয়েছে: ${accountName}`;
      const body = `${excerpt}\nত্রুটি: ${errorMessage}\nSocial Posts পেজে পোস্টটি Failed অবস্থায় আছে — সমস্যা ঠিক করে আবার শিডিউল বা প্রকাশ করুন। Token-এর মেয়াদ শেষ হলে অ্যাকাউন্টটি আবার কানেক্ট করুন।`;
      for (const userId of recipients) {
        await (this.prisma as any).agentNotification.create({
          data: { organizationId: post.organizationId, userId, type: "social_post_failed", title, body, conversationId: null },
        }).catch(() => undefined);
      }
    } catch (e) {
      this.logger.warn(`social post failure notification failed for post ${post?.id}: ${e instanceof Error ? e.message : "unknown"}`);
    }
  }
}
