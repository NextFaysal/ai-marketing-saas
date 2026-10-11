import { BadRequestException, Injectable, Logger, Optional } from "@nestjs/common";
import { randomBytes } from "node:crypto";
import { PrismaService } from "../prisma/prisma.service";
import { AuditService } from "../audit/audit.service";
import { decryptJson, encryptJson } from "../integrations/crypto";
import {
  effectiveGoogleAppConfig, effectiveTiktokAppConfig, ensurePlatformConfig, socialOAuthRedirectUri,
} from "../common/platform-config";
import { TikTokClient, type TikTokTokenSet } from "./tiktok.client";
import { YouTubeClient, type GoogleTokenSet, type YouTubeChannel } from "./youtube.client";
import { PermanentPublishError } from "./social-publish.service";

/**
 * SP8/SP9 — OAuth connect plumbing for the OPERATOR-APP social
 * platforms (TikTok, YouTube). Unlike Meta (SP1: the tenant
 * pastes a token), here the OPERATOR registers one app in the
 * Admin Panel (platform-config `tiktokApp` / `googleApp`) and
 * tenants authorize their own accounts on the platform's site.
 *
 * State discipline (SocialOAuthState table): the `state` value is
 * the row id — 32 random bytes, base64url. It binds org + user +
 * platform, lives 10 minutes, and is SINGLE-USE (consumed via a
 * conditioned updateMany, SP5 claim style). Callbacks are public
 * routes but validate the state strictly; an unknown / expired /
 * replayed state gets a plain error redirect to the web app —
 * never a stack, never a half-created account.
 *
 * Credential discipline (SP1 precedent): Integration (provider
 * "tiktok_social" / "youtube_social") + IntegrationCredential
 * sealed with the shared AES-256-GCM encryptJson, holding
 * { accessToken, refreshToken, expiresAt, scope }. Secrets never
 * appear in responses, audit metadata or logs.
 *
 * Circular-import note (meta-publisher precedent): this module
 * imports PermanentPublishError from social-publish.service,
 * which imports this service back; both bindings are used only
 * inside method bodies, and there is no DI cycle (this service
 * never injects SocialPublishService).
 */

export const OAUTH_STATE_TTL_MS = 10 * 60_000;
/** Refresh the access token when it expires within this window. */
export const TOKEN_REFRESH_SKEW_MS = 60_000;

export const TIKTOK_NOT_CONFIGURED_MSG =
  "TikTok app এখনো configure করা হয়নি — Platform Operator-এর সাথে যোগাযোগ করুন (Admin Panel → Platform Config → TikTok App)।";
export const GOOGLE_NOT_CONFIGURED_MSG =
  "Google app এখনো configure করা হয়নি — Platform Operator-এর সাথে যোগাযোগ করুন (Admin Panel → Platform Config → Google App)।";

@Injectable()
export class SocialOAuthService {
  private readonly logger = new Logger(SocialOAuthService.name);
  private readonly tiktok: TikTokClient;
  private readonly youtube: YouTubeClient;

  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    @Optional() tiktokClient?: TikTokClient,
    @Optional() youtubeClient?: YouTubeClient,
  ) {
    this.tiktok = tiktokClient ?? new TikTokClient();
    this.youtube = youtubeClient ?? new YouTubeClient();
  }

  private webBase(): string {
    return (process.env.WEB_URL ?? "http://localhost:3000").replace(/\/$/, "");
  }

  /** Where the browser lands after a callback, success or not.
   * Messages ride as query params (URL-encoded by URLSearchParams;
   * they are operator/tenant-facing explanations — never secrets,
   * never tokens, never platform raw payloads beyond an error
   * message the tenant needs to see). */
  private webRedirect(params: Record<string, string>): string {
    const qs = new URLSearchParams(params).toString();
    return `${this.webBase()}/dashboard/social-posts?${qs}`;
  }

  // ---------- OAuth state ----------

  private async createState(
    organizationId: string, userId: string, platform: string, purpose: string, payload?: unknown,
  ): Promise<string> {
    const id = randomBytes(32).toString("base64url");
    await (this.prisma as any).socialOAuthState.create({
      data: {
        id, organizationId, userId, platform, purpose,
        payload: (payload ?? null) as any,
        expiresAt: new Date(Date.now() + OAUTH_STATE_TTL_MS),
      },
    });
    return id;
  }

  /** Validate WITHOUT consuming (SP9 picker reads its state
   * twice: once to show the channels, once to select). Returns
   * the row or null — every mismatch reads the same null. */
  private async peekState(stateId: string, platform: string, purpose: string): Promise<any | null> {
    if (!stateId || typeof stateId !== "string") return null;
    const row = await (this.prisma as any).socialOAuthState.findFirst({ where: { id: stateId } }).catch(() => null);
    if (!row) return null;
    if (row.platform !== platform || row.purpose !== purpose) return null;
    if (row.consumedAt) return null;
    if (new Date(row.expiresAt).getTime() <= Date.now()) return null;
    return row;
  }

  /** Validate AND consume atomically: the conditioned updateMany
   * flips consumedAt only for a still-live row, so a replayed
   * callback can never consume the same state twice. */
  private async consumeState(stateId: string, platform: string, purpose: string): Promise<any | null> {
    const row = await this.peekState(stateId, platform, purpose);
    if (!row) return null;
    const flipped = await (this.prisma as any).socialOAuthState.updateMany({
      where: { id: row.id, consumedAt: null, expiresAt: { gt: new Date() } },
      data: { consumedAt: new Date() },
    }).catch(() => null);
    if (!flipped?.count) return null;
    return row;
  }

  // ---------- platform modes (booleans only — for the UI) ----------

  /** What the tenant UI may honestly claim: whether each OAuth
   * platform is operator-configured at all, and TikTok's posting
   * mode. Secrets are never part of this — only effective-config
   * presence and the operator's audited declaration. */
  async getPlatformModes() {
    await ensurePlatformConfig(this.prisma as any).catch(() => undefined);
    const tt = effectiveTiktokAppConfig();
    const gg = effectiveGoogleAppConfig();
    return {
      tiktok: { configured: Boolean(tt), audited: tt?.audited === true },
      youtube: { configured: Boolean(gg) },
    };
  }

  // ---------- account persistence (SP1/AD2 discipline) ----------

  private serializeAccount(row: any) {
    if (!row) return row;
    return {
      id: row.id, platform: row.platform, externalId: row.externalId,
      name: row.name, username: row.username ?? null, pictureUrl: row.pictureUrl ?? null,
      status: row.status, lastError: row.lastError ?? null,
      createdAt: row.createdAt, updatedAt: row.updatedAt,
    };
  }

  /**
   * Create/refresh an OAuth-backed SocialAccount: a NEW
   * Integration + sealed credential, the account row upserted
   * onto it (connected, error cleared), then the SP1 supersede
   * hygiene for THIS platform identity only — previous CONNECTED
   * integrations of the same provider + external id are torn
   * down ONLY when zero accounts still reference them.
   */
  private async persistOAuthAccount(args: {
    organizationId: string; actorId: string;
    platform: string; provider: string; externalId: string;
    name: string; username?: string | null; pictureUrl?: string | null;
    credential: Record<string, unknown>;
  }) {
    const prisma = this.prisma as any;
    const integration = await prisma.integration.create({
      data: { organizationId: args.organizationId, provider: args.provider, status: "CONNECTED", externalAccountId: args.externalId },
    });
    await prisma.integrationCredential.create({
      data: { integrationId: integration.id, encryptedData: encryptJson(args.credential) },
    });
    const account = await prisma.socialAccount.upsert({
      where: { organizationId_platform_externalId: { organizationId: args.organizationId, platform: args.platform, externalId: args.externalId } },
      update: {
        name: args.name, username: args.username ?? undefined, pictureUrl: args.pictureUrl ?? undefined,
        integrationId: integration.id, status: "connected", lastError: null,
      },
      create: {
        organizationId: args.organizationId, platform: args.platform, externalId: args.externalId,
        name: args.name, username: args.username ?? null, pictureUrl: args.pictureUrl ?? null,
        integrationId: integration.id, status: "connected", createdById: args.actorId,
      },
    });
    await this.audit.log({
      organizationId: args.organizationId, userId: args.actorId, action: "social.account_connected",
      entityType: "SocialAccount", entityId: account.id,
      metadata: { platform: args.platform, via: "oauth" },
    });
    await this.supersedePreviousOAuthIntegrations(args.organizationId, args.actorId, args.provider, args.externalId, integration.id);
    return account;
  }

  private async supersedePreviousOAuthIntegrations(
    organizationId: string, actorId: string, provider: string, externalId: string, newIntegrationId: string,
  ): Promise<void> {
    const prisma = this.prisma as any;
    let olds: any[] = [];
    try {
      olds = await prisma.integration.findMany({
        where: { organizationId, provider, externalAccountId: externalId, status: "CONNECTED" },
      });
    } catch { return; }
    if (!Array.isArray(olds)) return;
    for (const old of olds) {
      if (!old?.id || old.id === newIntegrationId) continue;
      const remaining = await prisma.socialAccount.findMany({
        where: { organizationId, integrationId: old.id },
      }).catch(() => null);
      if (!Array.isArray(remaining) || remaining.length > 0) continue;
      await prisma.integrationCredential.deleteMany({ where: { integrationId: old.id } });
      await prisma.integration.update({ where: { id: old.id }, data: { status: "DISCONNECTED" } });
      await this.audit.log({
        organizationId, userId: actorId, action: "social.integration_superseded",
        entityType: "Integration", entityId: old.id,
        metadata: { byIntegrationId: newIntegrationId, provider },
      });
    }
  }

  // ---------- shared token resolution + refresh ----------

  /**
   * THE shared OAuth token path (SP8/SP9 publish + any future
   * reader): resolve the account's sealed credential, refresh the
   * access token when it is inside the skew window, persist the
   * rotated tokens, and return a fresh access token.
   *
   * A failed refresh is terminal for this connection: the account
   * is marked "error" with the platform's verbatim message (the
   * AD1/SP6 honesty pattern) and a PermanentPublishError carries
   * the explanation — retrying a dead refresh token can never
   * succeed, so no publish attempts are burned on it.
   */
  async ensureAccessToken(organizationId: string, account: any): Promise<string> {
    const prisma = this.prisma as any;
    if (!account?.integrationId) {
      throw new PermanentPublishError("এই অ্যাকাউন্টটি এখন সংযুক্ত নেই — Social Posts পেজ থেকে অ্যাকাউন্টটি আবার কানেক্ট করে তারপর প্রকাশ করুন।");
    }
    const integration = await prisma.integration.findFirst({
      where: { id: account.integrationId, organizationId }, include: { credential: true },
    });
    if (!integration?.credential) {
      throw new PermanentPublishError("অ্যাকাউন্টের Credentials পাওয়া যাচ্ছে না — অ্যাকাউন্টটি আবার কানেক্ট করুন।");
    }
    let cred: Record<string, any>;
    try {
      cred = decryptJson<Record<string, any>>(integration.credential.encryptedData);
    } catch {
      throw new PermanentPublishError("অ্যাকাউন্টের Token পড়া যাচ্ছে না — অ্যাকাউন্টটি আবার কানেক্ট করুন।");
    }
    const accessToken = typeof cred.accessToken === "string" ? cred.accessToken : "";
    if (!accessToken) {
      throw new PermanentPublishError("অ্যাকাউন্টের Token পড়া যাচ্ছে না — অ্যাকাউন্টটি আবার কানেক্ট করুন।");
    }
    const expiresAt = typeof cred.expiresAt === "number" ? cred.expiresAt : 0;
    if (!expiresAt || expiresAt - Date.now() > TOKEN_REFRESH_SKEW_MS) return accessToken;
    if (!cred.refreshToken) {
      await this.markAccountError(account.id, "Access token-এর মেয়াদ শেষ, কিন্তু refresh token নেই — অ্যাকাউন্টটি আবার কানেক্ট করুন।");
      throw new PermanentPublishError("Access token-এর মেয়াদ শেষ হয়ে গেছে — অ্যাকাউন্টটি আবার কানেক্ট করুন।");
    }
    // Refresh per platform. A config that has been REMOVED since
    // connect is as terminal as a dead refresh token.
    try {
      await ensurePlatformConfig(this.prisma as any).catch(() => undefined);
      let fresh: TikTokTokenSet | GoogleTokenSet;
      if (account.platform === "tiktok") {
        const cfg = effectiveTiktokAppConfig();
        if (!cfg) throw new Error(TIKTOK_NOT_CONFIGURED_MSG);
        fresh = await this.tiktok.refreshAccessToken(
          { clientKey: cfg.clientKey, clientSecret: cfg.clientSecret, redirectUri: socialOAuthRedirectUri("tiktok", cfg.redirectUri) },
          String(cred.refreshToken),
        );
      } else if (account.platform === "youtube") {
        const cfg = effectiveGoogleAppConfig();
        if (!cfg) throw new Error(GOOGLE_NOT_CONFIGURED_MSG);
        fresh = await this.youtube.refreshAccessToken(
          { clientId: cfg.clientId, clientSecret: cfg.clientSecret, redirectUri: socialOAuthRedirectUri("youtube", cfg.redirectUri) },
          String(cred.refreshToken),
        );
      } else {
        throw new Error(`OAuth refresh is not supported for platform: ${account.platform}`);
      }
      const next: Record<string, unknown> = {
        ...cred,
        accessToken: fresh.accessToken,
        // TikTok rotates the refresh token; Google does not
        // return a new one — keep whichever the platform gave.
        refreshToken: fresh.refreshToken ?? cred.refreshToken,
        expiresAt: fresh.expiresAt,
        ...((fresh as TikTokTokenSet).refreshExpiresAt ? { refreshExpiresAt: (fresh as TikTokTokenSet).refreshExpiresAt } : {}),
        ...(fresh.scope ? { scope: fresh.scope } : {}),
      };
      await prisma.integrationCredential.update({
        where: { integrationId: integration.id },
        data: { encryptedData: encryptJson(next) },
      });
      return fresh.accessToken;
    } catch (e) {
      const message = e instanceof Error ? e.message : "Token refresh failed";
      await this.markAccountError(account.id, message);
      throw new PermanentPublishError(`Token refresh ব্যর্থ হয়েছে: ${message} — অ্যাকাউন্টটি আবার কানেক্ট করুন।`);
    }
  }

  /** Failure-isolated account error marking (SP6 pattern): the
   * account honestly shows the platform's verbatim message; a
   * fresh connect revives it. Never throws. */
  private async markAccountError(accountId: string, message: string): Promise<void> {
    await (this.prisma as any).socialAccount.update({
      where: { id: accountId }, data: { status: "error", lastError: message },
    }).catch(() => undefined);
  }

  // ---------- SP8: TikTok connect ----------

  /**
   * Step 1 (authenticated): mint state + return TikTok's
   * authorize URL. Not configured → an honest Bengali 400, never
   * a broken redirect. Scopes: user.info.basic + video.upload;
   * video.publish joins ONLY when the operator declared the app
   * audited (config-driven, default upload-only).
   */
  async tiktokConnectUrl(organizationId: string, userId: string): Promise<{ url: string }> {
    await ensurePlatformConfig(this.prisma as any).catch(() => undefined);
    const cfg = effectiveTiktokAppConfig();
    if (!cfg) throw new BadRequestException(TIKTOK_NOT_CONFIGURED_MSG);
    const state = await this.createState(organizationId, userId, "tiktok", "connect");
    const scopes = cfg.audited
      ? "user.info.basic,video.upload,video.publish"
      : "user.info.basic,video.upload";
    const params = new URLSearchParams({
      client_key: cfg.clientKey,
      scope: scopes,
      response_type: "code",
      redirect_uri: socialOAuthRedirectUri("tiktok", cfg.redirectUri),
      state,
    });
    return { url: `https://www.tiktok.com/v2/auth/authorize/?${params.toString()}` };
  }

  /**
   * Step 2 (PUBLIC callback): exchange the code and create the
   * account. NEVER throws — every outcome is a redirect back to
   * the web app with either social_connected=tiktok or a
   * social_error explanation the tenant can act on.
   */
  async handleTikTokCallback(query: { code?: string; state?: string; error?: string; errorDescription?: string }): Promise<string> {
    try {
      if (query.error) {
        return this.webRedirect({
          social_error: `TikTok Connect বাতিল/ব্যর্থ হয়েছে: ${query.errorDescription ?? query.error}`,
        });
      }
      if (!query.code || !query.state) {
        return this.webRedirect({ social_error: "TikTok callback-এ code/state পাওয়া যায়নি — আবার Connect করার চেষ্টা করুন।" });
      }
      const stateRow = await this.consumeState(query.state, "tiktok", "connect");
      if (!stateRow) {
        return this.webRedirect({ social_error: "Connect লিংকটি মেয়াদোত্তীর্ণ বা ইতিমধ্যে ব্যবহৃত — Social Posts পেজ থেকে আবার Connect করুন।" });
      }
      await ensurePlatformConfig(this.prisma as any).catch(() => undefined);
      const cfg = effectiveTiktokAppConfig();
      if (!cfg) return this.webRedirect({ social_error: TIKTOK_NOT_CONFIGURED_MSG });
      const creds = {
        clientKey: cfg.clientKey, clientSecret: cfg.clientSecret,
        redirectUri: socialOAuthRedirectUri("tiktok", cfg.redirectUri),
      };
      let tokens: TikTokTokenSet;
      try {
        tokens = await this.tiktok.exchangeCode(creds, query.code);
      } catch (e) {
        return this.webRedirect({ social_error: `TikTok Token বিনিময় ব্যর্থ হয়েছে: ${e instanceof Error ? e.message : "unknown error"}` });
      }
      let user: { openId: string; displayName: string; avatarUrl: string | null };
      try {
        user = await this.tiktok.getUserInfo(tokens.accessToken);
      } catch (e) {
        return this.webRedirect({ social_error: `TikTok অ্যাকাউন্টের তথ্য আনা যায়নি: ${e instanceof Error ? e.message : "unknown error"}` });
      }
      await this.persistOAuthAccount({
        organizationId: stateRow.organizationId, actorId: stateRow.userId,
        platform: "tiktok", provider: "tiktok_social",
        externalId: user.openId, name: user.displayName, pictureUrl: user.avatarUrl,
        credential: {
          accessToken: tokens.accessToken,
          refreshToken: tokens.refreshToken ?? null,
          expiresAt: tokens.expiresAt,
          refreshExpiresAt: tokens.refreshExpiresAt ?? null,
          scope: tokens.scope ?? null,
          openId: user.openId,
        },
      });
      return this.webRedirect({ social_connected: "tiktok" });
    } catch (e) {
      this.logger.warn(`tiktok callback failed: ${e instanceof Error ? e.message : "unknown"}`);
      return this.webRedirect({ social_error: "TikTok Connect সম্পন্ন করা যায়নি — আবার চেষ্টা করুন।" });
    }
  }

  // ---------- SP9: YouTube connect ----------

  /**
   * Step 1 (authenticated): mint state + return Google's
   * authorize URL. Scopes: youtube.upload (publish) +
   * youtube.readonly (the channel list). access_type=offline +
   * prompt=consent so Google issues a refresh token — including
   * on a RE-connect, where it would otherwise withhold it.
   */
  async youtubeConnectUrl(organizationId: string, userId: string): Promise<{ url: string }> {
    await ensurePlatformConfig(this.prisma as any).catch(() => undefined);
    const cfg = effectiveGoogleAppConfig();
    if (!cfg) throw new BadRequestException(GOOGLE_NOT_CONFIGURED_MSG);
    const state = await this.createState(organizationId, userId, "youtube", "connect");
    const params = new URLSearchParams({
      client_id: cfg.clientId,
      redirect_uri: socialOAuthRedirectUri("youtube", cfg.redirectUri),
      response_type: "code",
      scope: "https://www.googleapis.com/auth/youtube.upload https://www.googleapis.com/auth/youtube.readonly",
      access_type: "offline",
      prompt: "consent",
      state,
    });
    return { url: `https://accounts.google.com/o/oauth2/v2/auth?${params.toString()}` };
  }

  /** The sealed credential a YouTube SocialAccount carries. */
  private youtubeCredential(tokens: GoogleTokenSet, channelId: string): Record<string, unknown> {
    return {
      accessToken: tokens.accessToken,
      refreshToken: tokens.refreshToken ?? null,
      expiresAt: tokens.expiresAt,
      scope: tokens.scope ?? null,
      channelId,
    };
  }

  /**
   * Step 2 (PUBLIC callback): exchange + list the user's
   * channels. Exactly one channel → the account is created
   * immediately. MORE than one → NOTHING is created yet: the
   * sealed token bundle + channel list move into a second,
   * short-lived state (purpose "channel_pick") and the browser
   * lands back on the web app with ?youtube_pick=<state>, where
   * an AUTHENTICATED picker step finishes the connect. Zero
   * channels → an honest error (a Google account with no channel
   * cannot upload). Never throws — every outcome is a redirect.
   */
  async handleYouTubeCallback(query: { code?: string; state?: string; error?: string }): Promise<string> {
    try {
      if (query.error) {
        return this.webRedirect({ social_error: `YouTube Connect বাতিল/ব্যর্থ হয়েছে: ${query.error}` });
      }
      if (!query.code || !query.state) {
        return this.webRedirect({ social_error: "YouTube callback-এ code/state পাওয়া যায়নি — আবার Connect করার চেষ্টা করুন।" });
      }
      const stateRow = await this.consumeState(query.state, "youtube", "connect");
      if (!stateRow) {
        return this.webRedirect({ social_error: "Connect লিংকটি মেয়াদোত্তীর্ণ বা ইতিমধ্যে ব্যবহৃত — Social Posts পেজ থেকে আবার Connect করুন।" });
      }
      await ensurePlatformConfig(this.prisma as any).catch(() => undefined);
      const cfg = effectiveGoogleAppConfig();
      if (!cfg) return this.webRedirect({ social_error: GOOGLE_NOT_CONFIGURED_MSG });
      const creds = {
        clientId: cfg.clientId, clientSecret: cfg.clientSecret,
        redirectUri: socialOAuthRedirectUri("youtube", cfg.redirectUri),
      };
      let tokens: GoogleTokenSet;
      try {
        tokens = await this.youtube.exchangeCode(creds, query.code);
      } catch (e) {
        return this.webRedirect({ social_error: `Google Token বিনিময় ব্যর্থ হয়েছে: ${e instanceof Error ? e.message : "unknown error"}` });
      }
      if (!tokens.refreshToken) {
        // Without a refresh token the connection would die with
        // the access token (~1 hour) and could never be refreshed
        // — say so honestly instead of connecting a time bomb.
        return this.webRedirect({ social_error: "Google refresh token দেয়নি — Connect আবার চেষ্টা করুন (সম্মতি স্ক্রিনে সব অনুমতি দিন)।" });
      }
      let channels: YouTubeChannel[];
      try {
        channels = await this.youtube.listChannels(tokens.accessToken);
      } catch (e) {
        return this.webRedirect({ social_error: `YouTube Channel তালিকা আনা যায়নি: ${e instanceof Error ? e.message : "unknown error"}` });
      }
      if (channels.length === 0) {
        return this.webRedirect({ social_error: "এই Google অ্যাকাউন্টে কোনো YouTube Channel পাওয়া যায়নি — যেই অ্যাকাউন্টে Channel আছে সেটি দিয়ে Connect করুন।" });
      }
      if (channels.length === 1) {
        const ch = channels[0];
        await this.persistOAuthAccount({
          organizationId: stateRow.organizationId, actorId: stateRow.userId,
          platform: "youtube", provider: "youtube_social",
          externalId: ch.id, name: ch.title, pictureUrl: ch.pictureUrl,
          credential: this.youtubeCredential(tokens, ch.id),
        });
        return this.webRedirect({ social_connected: "youtube" });
      }
      const pickState = await this.createState(stateRow.organizationId, stateRow.userId, "youtube", "channel_pick", {
        sealed: encryptJson(this.youtubeCredential(tokens, "")),
        channels: channels.map((c) => ({ id: c.id, title: c.title, pictureUrl: c.pictureUrl })),
      });
      return this.webRedirect({ youtube_pick: pickState });
    } catch (e) {
      this.logger.warn(`youtube callback failed: ${e instanceof Error ? e.message : "unknown"}`);
      return this.webRedirect({ social_error: "YouTube Connect সম্পন্ন করা যায়নি — আবার চেষ্টা করুন।" });
    }
  }

  /** The picker's state, validated for THIS org+user (peeked, not
   * consumed — the selection consumes it). Anything off → null. */
  private async peekPickState(organizationId: string, userId: string, stateId: string): Promise<any | null> {
    const row = await this.peekState(stateId, "youtube", "channel_pick");
    if (!row) return null;
    if (row.organizationId !== organizationId || row.userId !== userId) return null;
    return row;
  }

  /** Picker step A (authenticated): the channels on offer. The
   * response carries channel ids/titles/thumbnails only — the
   * sealed tokens never leave the server. */
  async getYouTubePickInfo(organizationId: string, userId: string, stateId: string) {
    const row = await this.peekPickState(organizationId, userId, stateId);
    if (!row) {
      throw new BadRequestException("Channel বেছে নেওয়ার লিংকটি মেয়াদোত্তীর্ণ বা অবৈধ — YouTube Connect আবার শুরু করুন।");
    }
    const channels = Array.isArray(row.payload?.channels) ? row.payload.channels : [];
    return { channels };
  }

  /** Picker step B (authenticated): consume the pick state and
   * create the account for the CHOSEN channel only. A channelId
   * outside the offered list is refused — the state is the
   * authority on what this authorization actually granted. */
  async selectYouTubeChannel(organizationId: string, userId: string, dto: { state?: string; channelId?: string }) {
    const stateId = typeof dto?.state === "string" ? dto.state : "";
    const row = await this.peekPickState(organizationId, userId, stateId);
    if (!row) {
      throw new BadRequestException("Channel বেছে নেওয়ার লিংকটি মেয়াদোত্তীর্ণ বা অবৈধ — YouTube Connect আবার শুরু করুন।");
    }
    const channels: YouTubeChannel[] = Array.isArray(row.payload?.channels) ? row.payload.channels : [];
    const chosen = channels.find((c) => c.id === dto?.channelId);
    if (!chosen) {
      throw new BadRequestException("নির্বাচিত Channelটি এই Connect-এর তালিকায় নেই — তালিকা থেকে একটি Channel বেছে নিন।");
    }
    const consumed = await this.consumeState(stateId, "youtube", "channel_pick");
    if (!consumed) {
      throw new BadRequestException("Channel বেছে নেওয়ার লিংকটি ইতিমধ্যে ব্যবহৃত হয়েছে — Social Posts পেজে অ্যাকাউন্টটি যুক্ত হয়েছে কিনা দেখুন, না হলে আবার Connect করুন।");
    }
    let cred: Record<string, any>;
    try {
      cred = decryptJson<Record<string, any>>(String(row.payload?.sealed ?? ""));
    } catch {
      throw new BadRequestException("Connect-এর তথ্য পড়া যাচ্ছে না — YouTube Connect আবার শুরু করুন।");
    }
    const account = await this.persistOAuthAccount({
      organizationId, actorId: userId,
      platform: "youtube", provider: "youtube_social",
      externalId: chosen.id, name: chosen.title, pictureUrl: chosen.pictureUrl ?? null,
      credential: { ...cred, channelId: chosen.id },
    });
    return this.serializeAccount(account);
  }
}
