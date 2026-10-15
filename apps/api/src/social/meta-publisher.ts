import { graphGet, graphPost } from "../common/meta-graph";
import { PermanentPublishError } from "./social-publish.service";

/**
 * SP6 — Meta Page + Instagram publishing adapters.
 *
 * Pure Graph-API dispatch: given a PAGE access token (the sealed
 * credential from SP1 — one Page token drives the Page AND its
 * linked Instagram account), an external id, a caption and
 * already-public media URLs, perform the real publish and return
 * the platform's own ids. All persistence, retry and account-state
 * decisions live in SocialPublishService; this class only talks
 * to Meta.
 *
 * Error discipline: Meta's errors propagate VERBATIM — graphPost /
 * graphGet already throw MetaGraphError carrying Meta's own error
 * message, and nothing here wraps them. Content that can never
 * succeed as-is (a video mixed with other media on a Page, an
 * Instagram post with zero media, or a carousel over Instagram's
 * 10-item limit) throws PermanentPublishError so the SP5 worker
 * fails the post immediately without burning retry attempts.
 * Everything Meta itself decides — container creation refusals,
 * container processing ERRORs — stays a plain verbatim Error on
 * the normal retry path (PP4 keeps SP6's classification: a
 * processing error can be transient). A missing id in a Meta
 * response is an honest plain Error — a publish that returned no
 * id is never claimed as published.
 *
 * Circular-import note: this module imports PermanentPublishError
 * from social-publish.service, which imports this class back.
 * Both bindings are referenced only inside method bodies (never
 * at module-evaluation time), so the CommonJS cycle is safe.
 */

export interface SocialPublishAssetInput {
  publicUrl: string;
  kind: string;
  contentType: string;
}

/**
 * SP7 — a published post's numbers, EXACTLY as Graph returns them.
 * Every field is optional on purpose: a metric the platform does
 * not return for this post stays ABSENT (undefined) — it is never
 * stored as 0 and never estimated.
 */
export interface SocialPostInsights {
  platform: "meta_page" | "instagram";
  /** Page post object: reactions.summary(total_count). */
  reactions?: number;
  /** Page post object: comments.summary(total_count). */
  comments?: number;
  /** Page post object: shares.count (absent when Meta omits it). */
  shares?: number;
  /** IG media object fields. */
  likeCount?: number;
  commentsCount?: number;
  /** IG media /insights metrics (availability varies by type). */
  impressions?: number;
  reach?: number;
  saved?: number;
  plays?: number;
}

/**
 * True when Meta's error says the access token itself is dead
 * (invalidated / expired / unauthorised) — the account then needs
 * a human reconnect, which SocialPublishService records on the
 * account row. Matching is on Meta's verbatim message shapes plus
 * an HTTP 401 from the Graph layer.
 */
export function isTokenDeadError(e: unknown): boolean {
  if (!(e instanceof Error)) return false;
  if (/(error validating access token|invalid oauth|oauthException|session has expired)/i.test(e.message)) {
    return true;
  }
  return (e as { status?: unknown }).status === 401;
}

export class MetaSocialPublisher {
  private readonly fetchFn: typeof fetch;
  private readonly pollIntervalMs: number;
  private readonly maxPolls: number;
  private readonly sleep: (ms: number) => Promise<void>;

  constructor(
    fetchFn: typeof fetch = fetch,
    opts: {
      pollIntervalMs?: number;
      maxPolls?: number;
      sleep?: (ms: number) => Promise<void>;
    } = {},
  ) {
    this.fetchFn = fetchFn;
    this.pollIntervalMs = opts.pollIntervalMs ?? 3000;
    this.maxPolls = opts.maxPolls ?? 10;
    this.sleep = opts.sleep ?? ((ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms)));
  }

  /**
   * Publish to a Facebook Page.
   * - 0 assets → /feed post (message + optional link)
   * - 1 image → /photos with the caption
   * - 2+ images → each photo uploaded unpublished, then one /feed
   *   post with attached_media pointing at the photo ids
   * - exactly 1 video (and nothing else) → /videos
   * - a video mixed with anything else → PermanentPublishError
   */
  async publishToPage(
    token: string,
    pageId: string,
    input: { caption: string; linkUrl?: string | null; assets: SocialPublishAssetInput[] },
  ): Promise<{ platformPostId: string; platformUrl: string }> {
    const videos = input.assets.filter((a) => a.kind === "video");
    const images = input.assets.filter((a) => a.kind === "image");

    if (videos.length > 0 && input.assets.length > 1) {
      throw new PermanentPublishError("একাধিক মিডিয়ার মধ্যে ভিডিও থাকলে Facebook Page-এ একসাথে প্রকাশ করা যায় না — শুধু ছবিগুলো একসাথে, অথবা শুধু একটি ভিডিও রাখুন।");
    }

    if (videos.length === 1 && input.assets.length === 1) {
      const res = await graphPost(token, `/${pageId}/videos`, {
        file_url: videos[0].publicUrl,
        description: input.caption,
      }, this.fetchFn);
      const id = res?.id;
      if (!id) throw new Error("Meta ভিডিও প্রকাশে কোনো id ফেরত দেয়নি");
      return { platformPostId: String(id), platformUrl: `https://www.facebook.com/${id}` };
    }

    if (input.assets.length === 0) {
      const params: Record<string, string> = { message: input.caption };
      if (input.linkUrl) params.link = input.linkUrl;
      const res = await graphPost(token, `/${pageId}/feed`, params, this.fetchFn);
      const id = res?.id;
      if (!id) throw new Error("Meta পোস্ট প্রকাশে কোনো id ফেরত দেয়নি");
      return { platformPostId: String(id), platformUrl: `https://www.facebook.com/${id}` };
    }

    if (images.length === 1 && input.assets.length === 1) {
      const res = await graphPost(token, `/${pageId}/photos`, {
        url: images[0].publicUrl,
        caption: input.caption,
      }, this.fetchFn);
      // When Meta returns post_id it is the composite page_post id
      // of the feed post the photo created — that is the id the
      // facebook.com URL and later lookups want; fall back to the
      // photo's own id only when post_id is absent.
      const postId = res?.post_id ?? res?.id;
      if (!postId) throw new Error("Meta ছবি প্রকাশে কোনো id ফেরত দেয়নি");
      return { platformPostId: String(postId), platformUrl: `https://www.facebook.com/${postId}` };
    }

    // 2+ images: upload each unpublished, then attach them all to
    // a single feed post carrying the caption.
    const params: Record<string, string> = { message: input.caption };
    for (let i = 0; i < images.length; i++) {
      const res = await graphPost(token, `/${pageId}/photos`, {
        url: images[i].publicUrl,
        published: "false",
      }, this.fetchFn);
      const photoId = res?.id;
      if (!photoId) throw new Error("Meta ছবি আপলোডে কোনো id ফেরত দেয়নি");
      params[`attached_media[${i}]`] = JSON.stringify({ media_fbid: photoId });
    }
    const res = await graphPost(token, `/${pageId}/feed`, params, this.fetchFn);
    const id = res?.id;
    if (!id) throw new Error("Meta পোস্ট প্রকাশে কোনো id ফেরত দেয়নি");
    return { platformPostId: String(id), platformUrl: `https://www.facebook.com/${id}` };
  }

  /** Instagram's documented carousel size window (PP4). */
  static readonly CAROUSEL_MIN_ITEMS = 2;
  static readonly CAROUSEL_MAX_ITEMS = 10;

  /**
   * Poll one container's status_code until FINISHED (bounded:
   * maxPolls × pollIntervalMs) — the single discipline SP6 shipped
   * for single posts, shared by carousel items and the carousel
   * container itself. ERROR surfaces Meta's verbatim status text;
   * a timeout is a plain (transient) Error on purpose: processing
   * may simply be slow, so the SP5 retry path handles it.
   */
  private async awaitContainerFinished(token: string, creationId: string): Promise<void> {
    let finished = false;
    for (let i = 0; i < this.maxPolls; i++) {
      const st = await graphGet(token, `/${creationId}`, { fields: "status_code" }, this.fetchFn);
      const code = st?.status_code;
      if (code === "FINISHED") { finished = true; break; }
      if (code === "ERROR") {
        throw new Error(st?.status ?? "Instagram মিডিয়া প্রসেসিং ব্যর্থ হয়েছে (container ERROR)");
      }
      if (code === "EXPIRED") {
        throw new Error("Instagram মিডিয়া container-এর মেয়াদ শেষ হয়ে গেছে — আবার চেষ্টা করুন");
      }
      if (i < this.maxPolls - 1) await this.sleep(this.pollIntervalMs);
    }
    if (!finished) {
      throw new Error("Instagram মিডিয়া প্রসেসিং সময়মতো শেষ হয়নি — পরে আবার চেষ্টা করুন");
    }
  }

  /**
   * Publish to Instagram (container flow):
   * - ONE media item → the SP6 path, unchanged: create a media
   *   container (videos as REELS), poll until FINISHED, then
   *   media_publish.
   * - 2–10 items → PP4 carousel: one container per item
   *   (is_carousel_item; videos as REELS items), each polled to
   *   FINISHED, then a CAROUSEL container carrying the caption
   *   and the children ids, polled, then media_publish.
   * - Zero media, or more than Instagram's 10-item carousel
   *   limit, are PermanentPublishErrors decided BEFORE any
   *   platform call. Container-creation refusals and processing
   *   ERRORs propagate verbatim as plain Errors — SP6's
   *   classification, unchanged (a retry may succeed).
   * The permalink is fetched best-effort AFTER a successful
   * publish — its failure never fails the publish; the URL is
   * then honestly null rather than fabricated.
   */
  async publishToInstagram(
    token: string,
    igId: string,
    input: { caption: string; assets: SocialPublishAssetInput[] },
  ): Promise<{ platformPostId: string; platformUrl: string | null }> {
    if (input.assets.length === 0) {
      throw new PermanentPublishError("Instagram-এ প্রকাশের জন্য একটি ছবি বা ভিডিও লাগবে — শুধু লেখার পোস্ট Instagram-এ করা যায় না।");
    }
    if (input.assets.length > MetaSocialPublisher.CAROUSEL_MAX_ITEMS) {
      throw new PermanentPublishError("Instagram Carousel-এ সর্বোচ্চ ১০টি মিডিয়া রাখা যায় — মিডিয়ার সংখ্যা কমিয়ে আবার চেষ্টা করুন।");
    }
    if (input.assets.length > 1) {
      return this.publishCarouselToInstagram(token, igId, input);
    }
    const asset = input.assets[0];
    const params: Record<string, string> = asset.kind === "video"
      ? { video_url: asset.publicUrl, caption: input.caption, media_type: "REELS" }
      : { image_url: asset.publicUrl, caption: input.caption };

    const container = await graphPost(token, `/${igId}/media`, params, this.fetchFn);
    const creationId = container?.id;
    if (!creationId) throw new Error("Instagram মিডিয়া container তৈরিতে কোনো id ফেরত দেয়নি");

    await this.awaitContainerFinished(token, String(creationId));

    const pub = await graphPost(token, `/${igId}/media_publish`, { creation_id: String(creationId) }, this.fetchFn);
    const mediaId = pub?.id;
    if (!mediaId) throw new Error("Instagram প্রকাশে কোনো media id ফেরত দেয়নি");

    let permalink: string | null = null;
    try {
      const p = await graphGet(token, `/${mediaId}`, { fields: "permalink" }, this.fetchFn);
      permalink = p?.permalink ?? null;
    } catch {
      permalink = null; // a permalink failure is NOT a publish failure
    }
    return { platformPostId: String(mediaId), platformUrl: permalink };
  }

  /**
   * PP4 — the carousel branch of publishToInstagram. Item
   * containers carry NO caption (Instagram takes the caption on
   * the carousel container only). Items are created and polled
   * strictly in order; the first failure stops the flow with
   * Meta's verbatim error — nothing is published partially,
   * because media_publish only ever runs on the finished
   * carousel container.
   */
  private async publishCarouselToInstagram(
    token: string,
    igId: string,
    input: { caption: string; assets: SocialPublishAssetInput[] },
  ): Promise<{ platformPostId: string; platformUrl: string | null }> {
    const childIds: string[] = [];
    for (const asset of input.assets) {
      const params: Record<string, string> = asset.kind === "video"
        ? { video_url: asset.publicUrl, media_type: "REELS", is_carousel_item: "true" }
        : { image_url: asset.publicUrl, is_carousel_item: "true" };
      const item = await graphPost(token, `/${igId}/media`, params, this.fetchFn);
      const itemId = item?.id;
      if (!itemId) throw new Error("Instagram Carousel-এর একটি মিডিয়া container তৈরিতে কোনো id ফেরত দেয়নি");
      await this.awaitContainerFinished(token, String(itemId));
      childIds.push(String(itemId));
    }

    const carousel = await graphPost(token, `/${igId}/media`, {
      media_type: "CAROUSEL",
      caption: input.caption,
      children: childIds.join(","),
    }, this.fetchFn);
    const carouselId = carousel?.id;
    if (!carouselId) throw new Error("Instagram Carousel container তৈরিতে কোনো id ফেরত দেয়নি");
    await this.awaitContainerFinished(token, String(carouselId));

    const pub = await graphPost(token, `/${igId}/media_publish`, { creation_id: String(carouselId) }, this.fetchFn);
    const mediaId = pub?.id;
    if (!mediaId) throw new Error("Instagram প্রকাশে কোনো media id ফেরত দেয়নি");

    let permalink: string | null = null;
    try {
      const p = await graphGet(token, `/${mediaId}`, { fields: "permalink" }, this.fetchFn);
      permalink = p?.permalink ?? null;
    } catch {
      permalink = null; // a permalink failure is NOT a publish failure
    }
    return { platformPostId: String(mediaId), platformUrl: permalink };
  }

  /**
   * SU1 — post the first comment on an already-published post.
   * Meta Page: POST /{postId}/comments; Instagram: POST
   * /{mediaId}/comments. Meta's errors propagate verbatim; a
   * response without an id is an honest plain Error (the comment
   * is never claimed posted without the platform's id).
   */
  async postFirstComment(
    token: string, platform: string, platformPostId: string, message: string,
  ): Promise<{ commentId: string }> {
    const res = await graphPost(token, `/${platformPostId}/comments`, { message }, this.fetchFn);
    const id = res?.id;
    if (!id) throw new Error("Meta প্রথম কমেন্টে কোনো id ফেরত দেয়নি");
    return { commentId: String(id) };
  }

  /**
   * SU7 — follower count exactly as Graph reports it: Page →
   * fan_count, Instagram → followers_count. A field Graph omits
   * (or returns non-numeric) is null — the caller SKIPS the
   * snapshot for that day rather than storing an invented number.
   * Graph errors propagate verbatim (graphGet discipline).
   */
  async getFollowerCount(token: string, platform: string, externalId: string): Promise<number | null> {
    if (platform === "instagram") {
      const res = await graphGet(token, `/${externalId}`, { fields: "followers_count" }, this.fetchFn);
      return typeof res?.followers_count === "number" ? res.followers_count : null;
    }
    const res = await graphGet(token, `/${externalId}`, { fields: "fan_count" }, this.fetchFn);
    return typeof res?.fan_count === "number" ? res.fan_count : null;
  }

  /**
   * SU8 — Facebook Page PHOTO STORY, Meta's documented flow:
   * upload the photo unpublished (the same step publishToPage's
   * carousel path uses), then POST /{page-id}/photo_stories with
   * that photo_id. Meta answers { success, post_id }; anything
   * short of success === true WITH a post_id is an honest plain
   * Error — a story is never claimed without the platform's id.
   */
  async publishPhotoStory(
    token: string,
    pageId: string,
    input: { imageUrl: string },
  ): Promise<{ platformPostId: string }> {
    const up = await graphPost(token, `/${pageId}/photos`, {
      url: input.imageUrl,
      published: "false",
    }, this.fetchFn);
    const photoId = up?.id;
    if (!photoId) throw new Error("Meta Story-র ছবি আপলোডে কোনো id ফেরত দেয়নি");
    const res = await graphPost(token, `/${pageId}/photo_stories`, {
      photo_id: String(photoId),
    }, this.fetchFn);
    if (res?.success !== true || !res?.post_id) {
      throw new Error("Meta Story প্রকাশে success/post_id ফেরত দেয়নি");
    }
    return { platformPostId: String(res.post_id) };
  }

  /**
   * SU10 — account identity check: GET /{externalId}?fields=id,name
   * — the lightest Graph call that proves the token still works
   * for THIS account. Graph's errors propagate verbatim (graphGet
   * discipline); a response without an id is an honest plain
   * Error — a health check is never claimed passed on an empty
   * answer.
   */
  async getAccountIdentity(token: string, externalId: string): Promise<{ id: string; name: string | null }> {
    const res = await graphGet(token, `/${externalId}`, { fields: "id,name" }, this.fetchFn);
    if (!res?.id) throw new Error("Meta অ্যাকাউন্টের তথ্য যাচাইয়ে কোনো id ফেরত দেয়নি");
    return { id: String(res.id), name: typeof res.name === "string" ? res.name : null };
  }

  /**
   * SP7 — read a published Page post's engagement off the post
   * OBJECT (reactions/comments summary counts + shares count),
   * exactly the fields Graph offers there. A field Graph omits
   * (shares is the classic one) stays absent in the result.
   * Meta's errors propagate verbatim (graphGet discipline).
   */
  async getPagePostInsights(token: string, postId: string): Promise<SocialPostInsights> {
    const res = await graphGet(token, `/${postId}`, {
      fields: "reactions.summary(total_count).limit(0),comments.summary(total_count).limit(0),shares",
    }, this.fetchFn);
    const out: SocialPostInsights = { platform: "meta_page" };
    const reactions = res?.reactions?.summary?.total_count;
    if (typeof reactions === "number") out.reactions = reactions;
    const comments = res?.comments?.summary?.total_count;
    if (typeof comments === "number") out.comments = comments;
    const shares = res?.shares?.count;
    if (typeof shares === "number") out.shares = shares;
    return out;
  }

  /**
   * SP7 — read a published Instagram media's numbers: the media
   * object's like_count / comments_count, plus the /insights
   * metrics Graph returns for this media type (images:
   * impressions/reach/saved; reels: reach/plays/saved).
   *
   * The /insights edge REFUSES metrics it does not support for a
   * media type, and that refusal must not throw away the object
   * counts that WERE returned — so a non-token error from the
   * insights edge is swallowed here and those metrics simply stay
   * absent. A dead token still propagates (the object call above
   * normally catches it first; this is belt-and-braces) so the
   * caller can mark the account for reconnect.
   */
  async getInstagramMediaInsights(token: string, mediaId: string, isVideo: boolean): Promise<SocialPostInsights> {
    const media = await graphGet(token, `/${mediaId}`, { fields: "like_count,comments_count" }, this.fetchFn);
    const out: SocialPostInsights = { platform: "instagram" };
    if (typeof media?.like_count === "number") out.likeCount = media.like_count;
    if (typeof media?.comments_count === "number") out.commentsCount = media.comments_count;
    try {
      const metric = isVideo ? "reach,plays,saved" : "impressions,reach,saved";
      const res = await graphGet(token, `/${mediaId}/insights`, { metric }, this.fetchFn);
      for (const row of (Array.isArray(res?.data) ? res.data : []) as any[]) {
        const value = row?.values?.[0]?.value;
        if (typeof value !== "number") continue;
        if (row.name === "impressions") out.impressions = value;
        else if (row.name === "reach") out.reach = value;
        else if (row.name === "saved") out.saved = value;
        else if (row.name === "plays") out.plays = value;
      }
    } catch (e) {
      if (isTokenDeadError(e)) throw e;
      // Metrics unavailable for this media — counts stay as returned.
    }
    return out;
  }
}
