/**
 * SP8 — TikTok Content Posting client (operator-app OAuth model).
 *
 * The SaaS operator registers ONE TikTok app; tenants OAuth their
 * own creator accounts into it. This class only talks HTTP — all
 * persistence, state validation and account bookkeeping live in
 * SocialOAuthService, and all publish orchestration decisions
 * (status semantics, retry dignity) live in TikTokPublisher +
 * SocialPublishService.
 *
 * HONEST v1 SHAPE (plan amendment, 2026-10-11): an unaudited
 * TikTok app may only UPLOAD — the video lands in the creator's
 * TikTok inbox/drafts via the inbox flow and the CREATOR finishes
 * the post in the TikTok app. That terminal state is
 * SEND_TO_USER_INBOX and maps to our `sent_to_creator` status —
 * never "published". Direct posting exists here only behind the
 * operator's `audited` config flag, and even then the privacy
 * level is chosen ONLY from what creator_info returns for that
 * creator — never hardcoded.
 *
 * Error discipline: TikTok's own error message propagates
 * VERBATIM (the API returns { error: { code, message } }; code
 * "ok" is success). Nothing here invents a friendlier lie.
 */

export interface TikTokTokenSet {
  accessToken: string;
  refreshToken?: string;
  /** Epoch ms when the access token expires (now + expires_in). */
  expiresAt: number;
  refreshExpiresAt?: number;
  openId?: string;
  scope?: string;
}

export interface TikTokAppCreds {
  clientKey: string;
  clientSecret: string;
  redirectUri: string;
}

const TOKEN_URL = "https://open.tiktokapis.com/v2/oauth/token/";
const USER_INFO_URL = "https://open.tiktokapis.com/v2/user/info/?fields=open_id,display_name,avatar_url";
const CREATOR_INFO_URL = "https://open.tiktokapis.com/v2/post/publish/creator_info/query/";
const INBOX_INIT_URL = "https://open.tiktokapis.com/v2/post/publish/inbox/video/init/";
const DIRECT_INIT_URL = "https://open.tiktokapis.com/v2/post/publish/video/init/";
const CONTENT_INIT_URL = "https://open.tiktokapis.com/v2/post/publish/content/init/";
const STATUS_URL = "https://open.tiktokapis.com/v2/post/publish/status/fetch/";

/** Statuses TikTok documents for the status/fetch endpoint. */
export const TIKTOK_STATUS = {
  PROCESSING_DOWNLOAD: "PROCESSING_DOWNLOAD",
  PROCESSING_UPLOAD: "PROCESSING_UPLOAD",
  SEND_TO_USER_INBOX: "SEND_TO_USER_INBOX",
  PUBLISH_COMPLETE: "PUBLISH_COMPLETE",
  FAILED: "FAILED",
} as const;

export class TikTokClient {
  private readonly fetchFn: typeof fetch;

  constructor(fetchFn: typeof fetch = fetch) {
    this.fetchFn = fetchFn;
  }

  /** Parse a TikTok JSON envelope; a non-"ok" error code throws
   * an Error carrying TikTok's verbatim message. */
  private async envelope(res: Response): Promise<any> {
    const body: any = await res.json().catch(() => null);
    const code = body?.error?.code;
    if (!res.ok || (code !== undefined && code !== "ok")) {
      const message = body?.error?.message ?? `TikTok request failed (HTTP ${res.status})`;
      const err = new Error(message) as Error & { status?: number; tiktokCode?: string };
      err.status = res.status;
      err.tiktokCode = code;
      throw err;
    }
    return body;
  }

  private tokenSet(body: any): TikTokTokenSet {
    const now = Date.now();
    return {
      accessToken: String(body.access_token ?? ""),
      refreshToken: body.refresh_token ? String(body.refresh_token) : undefined,
      expiresAt: now + Number(body.expires_in ?? 0) * 1000,
      refreshExpiresAt: body.refresh_expires_in ? now + Number(body.refresh_expires_in) * 1000 : undefined,
      openId: body.open_id ? String(body.open_id) : undefined,
      scope: body.scope ? String(body.scope) : undefined,
    };
  }

  /** Authorization-code exchange (callback step). */
  async exchangeCode(creds: TikTokAppCreds, code: string): Promise<TikTokTokenSet> {
    const res = await this.fetchFn(TOKEN_URL, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        client_key: creds.clientKey,
        client_secret: creds.clientSecret,
        code,
        grant_type: "authorization_code",
        redirect_uri: creds.redirectUri,
      }).toString(),
    });
    const body = await this.envelope(res);
    if (!body?.access_token) throw new Error("TikTok token exchange returned no access token");
    return this.tokenSet(body);
  }

  /** Refresh-token grant. TikTok rotates the refresh token: the
   * response carries a NEW refresh_token, which the caller must
   * persist (SocialOAuthService does). */
  async refreshAccessToken(creds: TikTokAppCreds, refreshToken: string): Promise<TikTokTokenSet> {
    const res = await this.fetchFn(TOKEN_URL, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        client_key: creds.clientKey,
        client_secret: creds.clientSecret,
        grant_type: "refresh_token",
        refresh_token: refreshToken,
      }).toString(),
    });
    const body = await this.envelope(res);
    if (!body?.access_token) throw new Error("TikTok token refresh returned no access token");
    return this.tokenSet(body);
  }

  /** The creator identity behind a fresh access token. */
  async getUserInfo(accessToken: string): Promise<{ openId: string; displayName: string; avatarUrl: string | null }> {
    const res = await this.fetchFn(USER_INFO_URL, {
      headers: { Authorization: `Bearer ${accessToken}` },
    });
    const body = await this.envelope(res);
    const user = body?.data?.user;
    if (!user?.open_id) throw new Error("TikTok user info returned no open_id");
    return {
      openId: String(user.open_id),
      displayName: String(user.display_name ?? user.open_id),
      avatarUrl: user.avatar_url ? String(user.avatar_url) : null,
    };
  }

  /** Direct-post preflight: what THIS creator may do. The privacy
   * options returned here are the ONLY levels a direct post may
   * use — they depend on the creator's own account settings. */
  async queryCreatorInfo(accessToken: string): Promise<{ privacyLevelOptions: string[]; maxVideoPostDurationSec?: number }> {
    const res = await this.fetchFn(CREATOR_INFO_URL, {
      method: "POST",
      headers: { Authorization: `Bearer ${accessToken}`, "Content-Type": "application/json; charset=UTF-8" },
      body: JSON.stringify({}),
    });
    const body = await this.envelope(res);
    const info = body?.data?.creator_info ?? {};
    return {
      privacyLevelOptions: Array.isArray(info.privacy_level_options) ? info.privacy_level_options.map(String) : [],
      maxVideoPostDurationSec: info.max_video_post_duration_sec ? Number(info.max_video_post_duration_sec) : undefined,
    };
  }

  /** Inbox upload init: TikTok PULLS the video from our public
   * URL (the SP1 public media link — the same mechanism Instagram
   * publishing uses). Returns the publish_id to poll. */
  async inboxInit(accessToken: string, videoUrl: string): Promise<string> {
    const res = await this.fetchFn(INBOX_INIT_URL, {
      method: "POST",
      headers: { Authorization: `Bearer ${accessToken}`, "Content-Type": "application/json; charset=UTF-8" },
      body: JSON.stringify({ source_info: { source: "PULL_FROM_URL", video_url: videoUrl } }),
    });
    const body = await this.envelope(res);
    const publishId = body?.data?.publish_id;
    if (!publishId) throw new Error("TikTok inbox upload returned no publish_id");
    return String(publishId);
  }

  /** Direct-post init (audited apps only). privacyLevel MUST come
   * from queryCreatorInfo's options — the caller enforces that. */
  async directInit(accessToken: string, args: { title: string; privacyLevel: string; videoUrl: string }): Promise<string> {
    const res = await this.fetchFn(DIRECT_INIT_URL, {
      method: "POST",
      headers: { Authorization: `Bearer ${accessToken}`, "Content-Type": "application/json; charset=UTF-8" },
      body: JSON.stringify({
        post_info: { title: args.title, privacy_level: args.privacyLevel },
        source_info: { source: "PULL_FROM_URL", video_url: args.videoUrl },
      }),
    });
    const body = await this.envelope(res);
    const publishId = body?.data?.publish_id;
    if (!publishId) throw new Error("TikTok direct post returned no publish_id");
    return String(publishId);
  }

  /**
   * SN1 — photo direct-post init (Content Posting API, photo
   * mode): POST /post/publish/content/init/ with post_mode
   * DIRECT_POST and media_type PHOTO; TikTok PULLS each image
   * from its public URL (the SP1 mechanism, same as video).
   * photo_cover_index 0 = the first image is the cover (the
   * documented default posture). privacyLevel MUST come from
   * queryCreatorInfo's options — the caller enforces that.
   */
  async directPhotoInit(accessToken: string, args: { title: string; description?: string; privacyLevel: string; photoUrls: string[]; disableComment?: boolean }): Promise<string> {
    const res = await this.fetchFn(CONTENT_INIT_URL, {
      method: "POST",
      headers: { Authorization: `Bearer ${accessToken}`, "Content-Type": "application/json; charset=UTF-8" },
      body: JSON.stringify({
        post_info: {
          title: args.title,
          ...(args.description ? { description: args.description } : {}),
          privacy_level: args.privacyLevel,
          disable_comment: args.disableComment === true,
        },
        source_info: {
          source: "PULL_FROM_URL",
          photo_cover_index: 0,
          photo_images: args.photoUrls,
        },
        post_mode: "DIRECT_POST",
        media_type: "PHOTO",
      }),
    });
    const body = await this.envelope(res);
    const publishId = body?.data?.publish_id;
    if (!publishId) throw new Error("TikTok photo post returned no publish_id");
    return String(publishId);
  }

  async fetchStatus(accessToken: string, publishId: string): Promise<{ status: string; failReason?: string }> {
    const res = await this.fetchFn(STATUS_URL, {
      method: "POST",
      headers: { Authorization: `Bearer ${accessToken}`, "Content-Type": "application/json; charset=UTF-8" },
      body: JSON.stringify({ publish_id: publishId }),
    });
    const body = await this.envelope(res);
    const data = body?.data ?? {};
    return {
      status: String(data.status ?? ""),
      failReason: data.fail_reason ? String(data.fail_reason) : undefined,
    };
  }
}

export interface TikTokPublishOutcome {
  publishId: string;
  /** "inbox" = sent to the creator's TikTok inbox (NOT published);
   * "direct" = TikTok confirmed PUBLISH_COMPLETE. */
  mode: "inbox" | "direct";
  /** Direct mode only: the privacy level actually used, taken
   * from creator_info's returned options. */
  privacyLevel?: string;
}

/**
 * Publish orchestration for TikTok: init → bounded status polling
 * → terminal state. FAILED surfaces TikTok's fail_reason verbatim
 * as an ordinary (retryable, SP5-semantics) Error. Poll exhaustion
 * is also an ordinary Error: a retry starts a NEW upload (a
 * duplicate may land in the creator's inbox — the same documented
 * at-least-once class as SP5's Page posts, and benign there: the
 * creator simply deletes the extra draft).
 */
export class TikTokPublisher {
  private readonly client: TikTokClient;
  private readonly pollIntervalMs: number;
  private readonly maxPolls: number;
  private readonly sleep: (ms: number) => Promise<void>;

  constructor(
    client: TikTokClient = new TikTokClient(),
    opts: { pollIntervalMs?: number; maxPolls?: number; sleep?: (ms: number) => Promise<void> } = {},
  ) {
    this.client = client;
    this.pollIntervalMs = opts.pollIntervalMs ?? 5_000;
    this.maxPolls = opts.maxPolls ?? 24; // ~2 minutes at the default interval
    this.sleep = opts.sleep ?? ((ms) => new Promise((r) => setTimeout(r, ms)));
  }

  async publish(args: {
    accessToken: string;
    videoUrl: string;
    caption: string;
    audited: boolean;
  }): Promise<TikTokPublishOutcome> {
    if (!args.audited) {
      const publishId = await this.client.inboxInit(args.accessToken, args.videoUrl);
      await this.pollUntil(args.accessToken, publishId, TIKTOK_STATUS.SEND_TO_USER_INBOX);
      return { publishId, mode: "inbox" };
    }
    // Audited app: direct post. The privacy level comes ONLY from
    // creator_info — PUBLIC_TO_EVERYONE when the creator's own
    // settings offer it, otherwise the first option TikTok
    // returned (e.g. a private account can only post to itself).
    const info = await this.client.queryCreatorInfo(args.accessToken);
    if (info.privacyLevelOptions.length === 0) {
      throw new Error("TikTok creator_info কোনো privacy level ফেরত দেয়নি — direct post করা যাচ্ছে না।");
    }
    const privacyLevel = info.privacyLevelOptions.includes("PUBLIC_TO_EVERYONE")
      ? "PUBLIC_TO_EVERYONE"
      : info.privacyLevelOptions[0];
    const publishId = await this.client.directInit(args.accessToken, {
      title: args.caption, privacyLevel, videoUrl: args.videoUrl,
    });
    await this.pollUntil(args.accessToken, publishId, TIKTOK_STATUS.PUBLISH_COMPLETE);
    return { publishId, mode: "direct", privacyLevel };
  }

  /**
   * SN1 — photo post. DIRECT ONLY, behind the SAME audit gate as
   * video direct posting (the caller refuses before reaching here
   * when the app is not audited — there is NO photo inbox flow in
   * the Content Posting API, so an unaudited app cannot accept
   * photos at all). Privacy comes ONLY from creator_info, exactly
   * like the video path. Terminal semantics match direct video:
   * poll to PUBLISH_COMPLETE; FAILED surfaces TikTok's verbatim
   * fail_reason.
   */
  async publishPhoto(args: {
    accessToken: string;
    photoUrls: string[];
    caption: string;
  }): Promise<TikTokPublishOutcome> {
    const info = await this.client.queryCreatorInfo(args.accessToken);
    if (info.privacyLevelOptions.length === 0) {
      throw new Error("TikTok creator_info কোনো privacy level ফেরত দেয়নি — direct post করা যাচ্ছে না।");
    }
    const privacyLevel = info.privacyLevelOptions.includes("PUBLIC_TO_EVERYONE")
      ? "PUBLIC_TO_EVERYONE"
      : info.privacyLevelOptions[0];
    const publishId = await this.client.directPhotoInit(args.accessToken, {
      title: args.caption, privacyLevel, photoUrls: args.photoUrls,
    });
    await this.pollUntil(args.accessToken, publishId, TIKTOK_STATUS.PUBLISH_COMPLETE);
    return { publishId, mode: "direct", privacyLevel };
  }

  private async pollUntil(accessToken: string, publishId: string, terminal: string): Promise<void> {
    for (let i = 0; i < this.maxPolls; i++) {
      if (i > 0) await this.sleep(this.pollIntervalMs);
      const { status, failReason } = await this.client.fetchStatus(accessToken, publishId);
      if (status === terminal) return;
      if (status === TIKTOK_STATUS.FAILED) {
        throw new Error(`TikTok publish failed: ${failReason ?? "unknown reason"}`);
      }
      // PROCESSING_* (or the other mode's terminal, which for this
      // publish cannot occur) — keep polling within the bound.
    }
    throw new Error(`TikTok publish-এর অবস্থা নির্ধারিত সময়ে নিশ্চিত হয়নি (publish_id: ${publishId}) — কিছুক্ষণ পরে আবার চেষ্টা হবে।`);
  }
}
