import { ConflictException, Injectable, Logger, NotFoundException, Optional } from "@nestjs/common";
import { PrismaService } from "../prisma/prisma.service";
import { AuditService } from "../audit/audit.service";
import { decryptJson } from "../integrations/crypto";
import { SocialService, videoOnlyViolation } from "./social.service";
import { MetaSocialPublisher, isTokenDeadError } from "./meta-publisher";
import { SocialOAuthService } from "./social-oauth.service";
import { TikTokClient, TikTokPublisher } from "./tiktok.client";
import { YouTubeClient, YouTubePublisher } from "./youtube.client";
import { MediaStore } from "../inbox/media-store";
import { SocialRasterService } from "./social-raster.service";
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
  private readonly raster: SocialRasterService;

  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly social: SocialService,
    @Optional() publisher?: MetaSocialPublisher,
    @Optional() oauth?: SocialOAuthService,
    @Optional() tiktokPublisher?: TikTokPublisher,
    @Optional() youtubePublisher?: YouTubePublisher,
    @Optional() raster?: SocialRasterService,
  ) {
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
  async resolveAccountToken(organizationId: string, socialAccountId: string): Promise<{ account: any; accessToken: string }> {
    const prisma = this.prisma as any;
    const account = await prisma.socialAccount.findFirst({
      where: { id: socialAccountId, organizationId },
    });
    if (!account) {
      throw new PermanentPublishError("পোস্টের Social অ্যাকাউন্টটি পাওয়া যায়নি।");
    }
    if (account.status !== "connected" || !account.integrationId) {
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

    // SP8/SP9: OAuth platforms (TikTok / YouTube) take their own
    // dispatch — different media rule (exactly one video),
    // different token path (refresh-on-expiry), different success
    // semantics. The Meta flow below is untouched.
    if (account.platform === "tiktok" || account.platform === "youtube") {
      return this.publishToOAuthPlatform(post, account);
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

    try {
      if (account.platform === "instagram") {
        return await this.publisher.publishToInstagram(accessToken, account.externalId, {
          caption: post.caption,
          assets,
        });
      }
      return await this.publisher.publishToPage(accessToken, account.externalId, {
        caption: post.caption,
        linkUrl: post.linkUrl ?? null,
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
  private async publishToOAuthPlatform(post: any, account: any): Promise<SocialPublishResult> {
    const prisma = this.prisma as any;
    const violation = videoOnlyViolation(account.platform, post.mediaRefs);
    if (violation) throw new PermanentPublishError(violation);
    const ref = (post.mediaRefs as { assetId: string; kind: string }[])[0];
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
      // (≤100 chars), description = the full caption.
      const firstLine = String(post.caption ?? "").split(/\r?\n/).map((s: string) => s.trim()).find((s: string) => s.length > 0) ?? "";
      const title = (firstLine || String(post.caption ?? "").trim()).slice(0, 100);
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
      });
      return {
        platformPostId: outcome.videoId,
        platformUrl: `https://www.youtube.com/watch?v=${outcome.videoId}`,
        outcome: "published",
        // The upload is REAL (the video is on the channel), but
        // YouTube locks unverified-app uploads to PRIVATE — the
        // note says exactly that, wherever the post is shown.
        publishNote: "YouTube-এ Private হিসেবে আপলোড হয়েছে — app যাচাই সম্পন্ন হলে Public করা যাবে। (Unverified app-এর upload YouTube নিজে Private আটকে রাখে; ভিডিওটি Channel-এ YouTube Studio-তে দেখা যাবে।)",
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
    if (!["draft", "scheduled"].includes(row.status)) {
      throw new ConflictException("এই পোস্টটি এখন প্রকাশ করা যাবে না — এটি ইতিমধ্যে প্রকাশিত/প্রকাশ হচ্ছে/বাতিল অবস্থায় আছে।");
    }
    // SP7 approval gate: while the org requires approval, a post
    // that is not approved (pending / rejected / never submitted)
    // cannot be published by hand either — approval first.
    if ((await this.approvalRequired(organizationId)) && row.approvalStatus !== "approved") {
      throw new ConflictException("পোস্টটি অনুমোদিত নয় — অনুমোদন ব্যবস্থা চালু থাকলে প্রকাশের আগে OWNER/ADMIN-এর অনুমোদন লাগবে। আগে পোস্টটি অনুমোদনের জন্য পাঠান।");
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
    for (const row of Array.isArray(dueRows) ? dueRows : []) {
      counts.due++;
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
