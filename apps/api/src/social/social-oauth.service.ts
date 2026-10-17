import { BadRequestException, Injectable, Logger, Optional } from "@nestjs/common";
import { randomBytes } from "node:crypto";
import { PrismaService } from "../prisma/prisma.service";
import { AuditService } from "../audit/audit.service";
import { decryptJson, encryptJson } from "../integrations/crypto";
import {
  effectiveGbpApiAccessApproved, effectiveGoogleAppConfig, effectiveLinkedinAppConfig, effectiveThreadsAppConfig, effectiveTiktokAppConfig, ensurePlatformConfig, socialOAuthRedirectUri,
} from "../common/platform-config";
import { GoogleBusinessClient, type GbpLocation } from "./google-business.client";
import { GBP_API_ACCESS_GATE_MSG, GBP_PLATFORM, GBP_PROVIDER, GBP_SCOPE } from "./social.constants";
import { TikTokClient, type TikTokTokenSet, type TikTokAppCreds } from "./tiktok.client";
import { resolveTenantAppConfig } from "../connections/tenant-app-config";
import { YouTubeClient, type GoogleTokenSet, type YouTubeChannel, type GoogleAppCreds } from "./youtube.client";
import { LinkedInClient, type LinkedinTokenSet, type LinkedinAppCreds } from "./linkedin.client";
import { TelegramClient } from "./telegram.client";
import { ThreadsClient, type ThreadsTokenSet, type ThreadsAppCreds } from "./threads.client";
import { PermanentPublishError } from "./social-publish.service";

/**
 * SP8/SP9 — OAuth connect plumbing for the OPERATOR-APP social
 * platforms (TikTok, YouTube). Unlike Meta (SP1: the tenant
 * pastes a token), here the OPERATOR registers one app in the
 * Admin Panel (platform-config `tiktokApp` / `googleApp`) and
 * tenants authorize their own accounts on the platform's site.
 *
 * CC4 (Connect Center) adds the second TikTok path: a tenant may
 * connect through their OWN TikTok app (CC3 TenantAppConfig)
 * instead. The choice is bound into the OAuth state's payload,
 * the callback exchanges with the same app, the account and its
 * Integration carry appSource "own", and token refresh resolves
 * the tenant app's credentials. YouTube/Google stays
 * platform-only — CC3 built no Google own-app config, so no
 * own-app path is claimed for it.
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
/** CC4: appSource "own" was chosen but this org has no TikTok
 * app of its own saved in the Connect Center (CC3). */
export const OWN_TIKTOK_NOT_CONFIGURED_MSG =
  "নিজের TikTok অ্যাপ কনফিগার করা নেই — আগে কানেক্ট সেন্টারে (কানেক্ট সেন্টার → নিজের অ্যাপ) আপনার TikTok অ্যাপটি যোগ করুন, অথবা প্ল্যাটফর্মের অ্যাপ দিয়ে কানেক্ট করুন।";
export const GOOGLE_NOT_CONFIGURED_MSG =
  "Google app এখনো configure করা হয়নি — Platform Operator-এর সাথে যোগাযোগ করুন (Admin Panel → Platform Config → Google App)।";
/** CC28: appSource "own" was chosen but this org has no Google
 * app of its own saved in the Connect Center (CC28). */
export const OWN_GOOGLE_NOT_CONFIGURED_MSG =
  "নিজের Google অ্যাপ কনফিগার করা নেই — আগে কানেক্ট সেন্টারে (কানেক্ট সেন্টার → নিজের অ্যাপ) আপনার Google অ্যাপটি যোগ করুন (সেখানে দেওয়া Redirect URI-গুলো Google Cloud Console-এ register করতে হবে), অথবা প্ল্যাটফর্মের অ্যাপ দিয়ে কানেক্ট করুন।";
/** CC20 shipped LinkedIn platform-app only; CC28 adds the
 * tenant-own-LinkedIn-app path beside it. */
export const LINKEDIN_NOT_CONFIGURED_MSG =
  "LinkedIn app এখনো configure করা হয়নি — Platform Operator-এর সাথে যোগাযোগ করুন (Admin Panel → Platform Config → LinkedIn App)।";
/** CC28: appSource "own" was chosen but this org has no
 * LinkedIn app of its own saved in the Connect Center. */
export const OWN_LINKEDIN_NOT_CONFIGURED_MSG =
  "নিজের LinkedIn অ্যাপ কনফিগার করা নেই — আগে কানেক্ট সেন্টারে (কানেক্ট সেন্টার → নিজের অ্যাপ) আপনার LinkedIn অ্যাপটি যোগ করুন (সেখানে দেওয়া Callback URL-টি LinkedIn অ্যাপে register করতে হবে), অথবা প্ল্যাটফর্মের অ্যাপ দিয়ে কানেক্ট করুন।";
export const LINKEDIN_SCOPES = "r_liteprofile r_organization_admin w_organization_social";
/** SN7: Threads app not configured (platform app path). */
export const THREADS_NOT_CONFIGURED_MSG =
  "Threads app এখনো configure করা হয়নি — Platform Operator-এর সাথে যোগাযোগ করুন (Admin Panel → Platform Config → Threads App)।";
/** SN7: appSource "own" was chosen but this org has no Threads
 * app of its own saved in the Connect Center. */
export const OWN_THREADS_NOT_CONFIGURED_MSG =
  "নিজের Threads অ্যাপ কনফিগার করা নেই — আগে কানেক্ট সেন্টারে (কানেক্ট সেন্টার → নিজের অ্যাপ) আপনার Threads অ্যাপটি যোগ করুন (সেখানে দেওয়া Callback URL-টি Threads অ্যাপে register করতে হবে), অথবা প্ল্যাটফর্মের অ্যাপ দিয়ে কানেক্ট করুন।";
/** SN7: the documented Threads scopes — basic profile, content
 * publishing, and insights (follower counts + post metrics). */
export const THREADS_SCOPES = "threads_basic,threads_content_publish,threads_manage_insights";

@Injectable()
export class SocialOAuthService {
  private readonly logger = new Logger(SocialOAuthService.name);
  private readonly tiktok: TikTokClient;
  private readonly youtube: YouTubeClient;
  private readonly linkedin: LinkedInClient;
  private readonly telegram: TelegramClient;
  private readonly threads: ThreadsClient;
  private readonly gbp: GoogleBusinessClient;

  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    @Optional() tiktokClient?: TikTokClient,
    @Optional() youtubeClient?: YouTubeClient,
    @Optional() linkedinClient?: LinkedInClient,
    // SN6: Telegram is not OAuth, but its connect lives here so
    // it can reuse persistOAuthAccount's one persistence path.
    // Appended LAST — existing positional spec constructions
    // (prisma, audit, tiktok, youtube, linkedin) are untouched.
    @Optional() telegramClient?: TelegramClient,
    // SN7: appended after the SN6 client for the same reason.
    @Optional() threadsClient?: ThreadsClient,
    // OU9: appended after the SN7 client for the same reason.
    @Optional() gbpClient?: GoogleBusinessClient,
  ) {
    this.tiktok = tiktokClient ?? new TikTokClient();
    this.youtube = youtubeClient ?? new YouTubeClient();
    this.linkedin = linkedinClient ?? new LinkedInClient();
    this.telegram = telegramClient ?? new TelegramClient();
    this.threads = threadsClient ?? new ThreadsClient();
    this.gbp = gbpClient ?? new GoogleBusinessClient();
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

  /** CC20: LinkedIn connects are STARTED from the Connect Center
   * (SocialAccount surfaced there), so LinkedIn callbacks land
   * back on the connections page — not social-posts. */
  private connectionsRedirect(params: Record<string, string>): string {
    const qs = new URLSearchParams(params).toString();
    return `${this.webBase()}/dashboard/connections?${qs}`;
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
      linkedin: { configured: Boolean(effectiveLinkedinAppConfig()) },
      threads: { configured: Boolean(effectiveThreadsAppConfig()) },
      // OU9: GBP rides the same Google app as YouTube; the UI
      // additionally needs the API-access approval state so the
      // gate message can be shown BEFORE a doomed connect/publish
      // (booleans only, like every sibling entry).
      googleBusinessProfile: { configured: Boolean(gg), apiAccessApproved: effectiveGbpApiAccessApproved() },
    };
  }

  // ---------- account persistence (SP1/AD2 discipline) ----------

  private serializeAccount(row: any) {
    if (!row) return row;
    return {
      id: row.id, platform: row.platform, externalId: row.externalId,
      name: row.name, username: row.username ?? null, pictureUrl: row.pictureUrl ?? null,
      status: row.status, lastError: row.lastError ?? null,
      appSource: row.appSource ?? "platform",
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
    /** CC4: "own" when the OAuth ran under the tenant's own app
     * (CC3 TenantAppConfig); defaults to "platform". Recorded on
     * BOTH the Integration and the SocialAccount so the token
     * refresh path and the Connect Center read the same truth. */
    appSource?: string;
  }) {
    const prisma = this.prisma as any;
    const appSource = args.appSource === "own" ? "own" : "platform";
    const integration = await prisma.integration.create({
      data: { organizationId: args.organizationId, provider: args.provider, status: "CONNECTED", externalAccountId: args.externalId, appSource },
    });
    await prisma.integrationCredential.create({
      data: { integrationId: integration.id, encryptedData: encryptJson(args.credential) },
    });
    const account = await prisma.socialAccount.upsert({
      where: { organizationId_platform_externalId: { organizationId: args.organizationId, platform: args.platform, externalId: args.externalId } },
      update: {
        name: args.name, username: args.username ?? undefined, pictureUrl: args.pictureUrl ?? undefined,
        integrationId: integration.id, status: "connected", lastError: null, appSource,
      },
      create: {
        organizationId: args.organizationId, platform: args.platform, externalId: args.externalId,
        name: args.name, username: args.username ?? null, pictureUrl: args.pictureUrl ?? null,
        integrationId: integration.id, status: "connected", createdById: args.actorId, appSource,
      },
    });
    await this.audit.log({
      organizationId: args.organizationId, userId: args.actorId, action: "social.account_connected",
      entityType: "SocialAccount", entityId: account.id,
      metadata: { platform: args.platform, via: "oauth", appSource },
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
    // SN7: Threads long-lived tokens carry NO separate refresh
    // token — the refresh grant consumes the access token
    // itself (th_refresh_token), so the missing-refresh-token
    // terminal check does not apply to that platform.
    if (!cred.refreshToken && account.platform !== "threads") {
      await this.markAccountError(account.id, "Access token-এর মেয়াদ শেষ, কিন্তু refresh token নেই — অ্যাকাউন্টটি আবার কানেক্ট করুন।");
      throw new PermanentPublishError("Access token-এর মেয়াদ শেষ হয়ে গেছে — অ্যাকাউন্টটি আবার কানেক্ট করুন।");
    }
    // Refresh per platform. A config that has been REMOVED since
    // connect is as terminal as a dead refresh token.
    try {
      await ensurePlatformConfig(this.prisma as any).catch(() => undefined);
      let fresh: TikTokTokenSet | GoogleTokenSet | LinkedinTokenSet | ThreadsTokenSet;
      if (account.platform === "tiktok") {
        // CC4: an account connected under the tenant's OWN app
        // refreshes against THAT app — the platform app's secret
        // would be rejected by TikTok for this grant. A deleted
        // own config is terminal, like a removed platform config.
        if ((account as any).appSource === "own") {
          const own = await resolveTenantAppConfig(this.prisma, organizationId, "tiktok");
          if (!own) throw new Error("নিজের TikTok অ্যাপের কনফিগ পাওয়া যাচ্ছে না — কানেক্ট সেন্টারে নিজের TikTok অ্যাপটি আবার কনফিগার করুন, তারপর অ্যাকাউন্টটি রি-কানেক্ট করুন।");
          fresh = await this.tiktok.refreshAccessToken(
            { clientKey: own.appId, clientSecret: own.appSecret, redirectUri: socialOAuthRedirectUri("tiktok") },
            String(cred.refreshToken),
          );
        } else {
          const cfg = effectiveTiktokAppConfig();
          if (!cfg) throw new Error(TIKTOK_NOT_CONFIGURED_MSG);
          fresh = await this.tiktok.refreshAccessToken(
            { clientKey: cfg.clientKey, clientSecret: cfg.clientSecret, redirectUri: socialOAuthRedirectUri("tiktok", cfg.redirectUri) },
            String(cred.refreshToken),
          );
        }
      } else if (account.platform === "youtube") {
        // CC28: an account connected under the tenant's OWN
        // Google app refreshes against THAT app (same rule as
        // TikTok CC4); platform accounts refresh exactly as
        // before. A deleted own config is terminal.
        if ((account as any).appSource === "own") {
          const own = await resolveTenantAppConfig(this.prisma, organizationId, "google");
          if (!own) throw new Error("নিজের Google অ্যাপের কনফিগ পাওয়া যাচ্ছে না — কানেক্ট সেন্টারে নিজের Google অ্যাপটি আবার কনফিগার করুন, তারপর অ্যাকাউন্টটি রি-কানেক্ট করুন।");
          fresh = await this.youtube.refreshAccessToken(
            { clientId: own.appId, clientSecret: own.appSecret, redirectUri: socialOAuthRedirectUri("youtube") },
            String(cred.refreshToken),
          );
        } else {
          const cfg = effectiveGoogleAppConfig();
          if (!cfg) throw new Error(GOOGLE_NOT_CONFIGURED_MSG);
          fresh = await this.youtube.refreshAccessToken(
            { clientId: cfg.clientId, clientSecret: cfg.clientSecret, redirectUri: socialOAuthRedirectUri("youtube", cfg.redirectUri) },
            String(cred.refreshToken),
          );
        }
      } else if (account.platform === "linkedin_page") {
        // CC28: same own-app rule for LinkedIn (CC20 shipped
        // platform-only; the account's recorded appSource now
        // decides, and platform accounts refresh as before).
        if ((account as any).appSource === "own") {
          const own = await resolveTenantAppConfig(this.prisma, organizationId, "linkedin");
          if (!own) throw new Error("নিজের LinkedIn অ্যাপের কনফিগ পাওয়া যাচ্ছে না — কানেক্ট সেন্টারে নিজের LinkedIn অ্যাপটি আবার কনফিগার করুন, তারপর অ্যাকাউন্টটি রি-কানেক্ট করুন।");
          fresh = await this.linkedin.refreshAccessToken(
            { clientId: own.appId, clientSecret: own.appSecret, redirectUri: socialOAuthRedirectUri("linkedin") },
            String(cred.refreshToken),
          );
        } else {
          const cfg = effectiveLinkedinAppConfig();
          if (!cfg) throw new Error(LINKEDIN_NOT_CONFIGURED_MSG);
          fresh = await this.linkedin.refreshAccessToken(
            { clientId: cfg.clientId, clientSecret: cfg.clientSecret, redirectUri: socialOAuthRedirectUri("linkedin", cfg.redirectUri) },
            String(cred.refreshToken),
          );
        }
      } else if (account.platform === GBP_PLATFORM) {
        // OU9: GBP tokens are Google tokens — the refresh grant
        // is the YouTube client's (Google does not rotate the
        // refresh token), resolved against the app the account
        // was connected under (googleCredsFor: platform app, or
        // the tenant's OWN Google app for appSource "own" —
        // CC28 discipline, identical to YouTube above).
        const creds = await this.googleCredsFor(organizationId, (account as any).appSource === "own" ? "own" : "platform");
        if (!creds) throw new Error((account as any).appSource === "own" ? OWN_GOOGLE_NOT_CONFIGURED_MSG : GOOGLE_NOT_CONFIGURED_MSG);
        fresh = await this.youtube.refreshAccessToken(creds, String(cred.refreshToken));
      } else if (account.platform === "threads") {
        // SN7: th_refresh_token needs NO app secret and no app
        // config at all — the current long-lived token is the
        // whole grant (documented; the token reaching this
        // branch is ≥24h old by construction, as Threads
        // requires). Works for own-app and platform-app
        // accounts alike.
        fresh = await this.threads.refreshLongLived(accessToken);
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
  async tiktokConnectUrl(organizationId: string, userId: string, appSource?: string): Promise<{ url: string }> {
    if (appSource != null && !["platform", "own"].includes(appSource)) {
      throw new BadRequestException("appSource must be platform or own");
    }
    // CC4: the tenant's OWN TikTok app (CC3 TenantAppConfig). The
    // choice is bound into the OAuth state's payload, so the
    // public callback — which receives no appSource parameter —
    // exchanges the code with the SAME app. The redirect URI is
    // the platform callback route: the tenant must register that
    // exact URL in their own TikTok app console.
    if (appSource === "own") {
      const own = await resolveTenantAppConfig(this.prisma, organizationId, "tiktok");
      if (!own) throw new BadRequestException(OWN_TIKTOK_NOT_CONFIGURED_MSG);
      const state = await this.createState(organizationId, userId, "tiktok", "connect", { appSource: "own" });
      const params = new URLSearchParams({
        client_key: own.appId,
        // The tenant app's audit state is not ours to declare:
        // request only the scopes an unaudited app may use.
        // video.publish (direct post) stays platform-app-only
        // until the tenant app carries its own audited flag.
        scope: "user.info.basic,video.upload",
        response_type: "code",
        redirect_uri: socialOAuthRedirectUri("tiktok"),
        state,
      });
      return { url: `https://www.tiktok.com/v2/auth/authorize/?${params.toString()}` };
    }
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

  /** CC4: the TikTok app credentials a connect/callback must use
   * for one app source: the tenant's own config for "own" (null
   * when it has been deleted since the flow started), the
   * operator's platform config otherwise (null when unset). */
  private async tiktokCredsFor(organizationId: string, appSource: string): Promise<TikTokAppCreds | null> {
    if (appSource === "own") {
      const own = await resolveTenantAppConfig(this.prisma, organizationId, "tiktok");
      if (!own) return null;
      return { clientKey: own.appId, clientSecret: own.appSecret, redirectUri: socialOAuthRedirectUri("tiktok") };
    }
    await ensurePlatformConfig(this.prisma as any).catch(() => undefined);
    const cfg = effectiveTiktokAppConfig();
    if (!cfg) return null;
    return {
      clientKey: cfg.clientKey, clientSecret: cfg.clientSecret,
      redirectUri: socialOAuthRedirectUri("tiktok", cfg.redirectUri),
    };
  }

  /** CC28: the Google app credentials for one app source (the
   * YouTube flow's client — the Google pack has its own resolver
   * in google-connect.service). For "own" the redirect URI is
   * the DERIVED YouTube callback with NO configured override:
   * the tenant registers exactly that URL in their own Google
   * Cloud console (the Connect Center shows it before saving). */
  private async googleCredsFor(organizationId: string, appSource: string): Promise<GoogleAppCreds | null> {
    if (appSource === "own") {
      const own = await resolveTenantAppConfig(this.prisma, organizationId, "google");
      if (!own) return null;
      return { clientId: own.appId, clientSecret: own.appSecret, redirectUri: socialOAuthRedirectUri("youtube") };
    }
    await ensurePlatformConfig(this.prisma as any).catch(() => undefined);
    const cfg = effectiveGoogleAppConfig();
    if (!cfg) return null;
    return {
      clientId: cfg.clientId, clientSecret: cfg.clientSecret,
      redirectUri: socialOAuthRedirectUri("youtube", cfg.redirectUri),
    };
  }

  /** CC28: the LinkedIn app credentials for one app source —
   * same discipline as googleCredsFor (derived callback, no
   * override, for the tenant's own app). */
  private async linkedinCredsFor(organizationId: string, appSource: string): Promise<LinkedinAppCreds | null> {
    if (appSource === "own") {
      const own = await resolveTenantAppConfig(this.prisma, organizationId, "linkedin");
      if (!own) return null;
      return { clientId: own.appId, clientSecret: own.appSecret, redirectUri: socialOAuthRedirectUri("linkedin") };
    }
    await ensurePlatformConfig(this.prisma as any).catch(() => undefined);
    const cfg = effectiveLinkedinAppConfig();
    if (!cfg) return null;
    return this.linkedinCreds(cfg);
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
      // CC4: the app source rides in the state's sealed payload —
      // the callback exchanges with the SAME app that minted the
      // authorize URL. A since-deleted own config fails honestly.
      const appSource = (stateRow as any).payload?.appSource === "own" ? "own" : "platform";
      const creds = await this.tiktokCredsFor(stateRow.organizationId, appSource);
      if (!creds) {
        return this.webRedirect({
          social_error: appSource === "own"
            ? "নিজের TikTok অ্যাপের কনফিগ পাওয়া যাচ্ছে না — কানেক্ট সেন্টারে আবার কনফিগার করে তারপর Connect করুন।"
            : TIKTOK_NOT_CONFIGURED_MSG,
        });
      }
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
        appSource,
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
  async youtubeConnectUrl(organizationId: string, userId: string, appSource?: string): Promise<{ url: string }> {
    if (appSource != null && !["platform", "own"].includes(appSource)) {
      throw new BadRequestException("appSource must be platform or own");
    }
    // CC28: the tenant's OWN Google app (TenantAppConfig
    // "google"). The choice is bound into the OAuth state's
    // payload exactly like TikTok CC4, so the public callback
    // exchanges with the SAME app. The platform path below is
    // byte-identical to the SP9 flow.
    const creds = await this.googleCredsFor(organizationId, appSource ?? "platform");
    if (!creds) {
      throw new BadRequestException(appSource === "own" ? OWN_GOOGLE_NOT_CONFIGURED_MSG : GOOGLE_NOT_CONFIGURED_MSG);
    }
    const state = appSource === "own"
      ? await this.createState(organizationId, userId, "youtube", "connect", { appSource: "own" })
      : await this.createState(organizationId, userId, "youtube", "connect");
    const params = new URLSearchParams({
      client_id: creds.clientId,
      redirect_uri: creds.redirectUri,
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
      // CC28: exchange with the app the state was bound to.
      const appSource = (stateRow as any).payload?.appSource === "own" ? "own" : "platform";
      const creds = await this.googleCredsFor(stateRow.organizationId, appSource);
      if (!creds) return this.webRedirect({ social_error: appSource === "own" ? OWN_GOOGLE_NOT_CONFIGURED_MSG : GOOGLE_NOT_CONFIGURED_MSG });
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
          appSource,
        });
        return this.webRedirect({ social_connected: "youtube" });
      }
      const pickState = await this.createState(stateRow.organizationId, stateRow.userId, "youtube", "channel_pick", {
        sealed: encryptJson(this.youtubeCredential(tokens, "")),
        appSource,
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
      // CC28: the pick state carries the connect's app source.
      appSource: (row.payload as any)?.appSource === "own" ? "own" : "platform",
    });
    return this.serializeAccount(account);
  }

  // ---------- CC20: LinkedIn Page connect (CC28: + own app) ----------

  /** The sealed credential a LinkedIn SocialAccount carries.
   * refreshToken may be null: LinkedIn only issues one when the
   * operator's app holds the refresh-token product — the
   * connection still works until the access token expires, and
   * ensureAccessToken then marks the account with the honest
   * reconnect message instead of silently dying. */
  private linkedinCredential(tokens: LinkedinTokenSet, organizationId: string): Record<string, unknown> {
    return {
      accessToken: tokens.accessToken,
      refreshToken: tokens.refreshToken ?? null,
      expiresAt: tokens.expiresAt,
      scope: tokens.scope ?? null,
      organizationId,
    };
  }

  private linkedinCreds(cfg: { clientId: string; clientSecret: string; redirectUri?: string }) {
    return {
      clientId: cfg.clientId, clientSecret: cfg.clientSecret,
      redirectUri: socialOAuthRedirectUri("linkedin", cfg.redirectUri),
    };
  }

  /** Step 1 (authenticated): state + LinkedIn's authorize URL.
   * CC28: ?appSource=own runs under the tenant's OWN LinkedIn
   * app with the choice bound into the state (CC4 discipline);
   * the platform path is byte-identical to CC20. */
  async linkedinConnectUrl(organizationId: string, userId: string, appSource?: string): Promise<{ url: string }> {
    if (appSource != null && !["platform", "own"].includes(appSource)) {
      throw new BadRequestException("appSource must be platform or own");
    }
    const creds = await this.linkedinCredsFor(organizationId, appSource ?? "platform");
    if (!creds) {
      throw new BadRequestException(appSource === "own" ? OWN_LINKEDIN_NOT_CONFIGURED_MSG : LINKEDIN_NOT_CONFIGURED_MSG);
    }
    const state = appSource === "own"
      ? await this.createState(organizationId, userId, "linkedin", "connect", { appSource: "own" })
      : await this.createState(organizationId, userId, "linkedin", "connect");
    const params = new URLSearchParams({
      response_type: "code",
      client_id: creds.clientId,
      redirect_uri: creds.redirectUri,
      scope: LINKEDIN_SCOPES,
      state,
    });
    return { url: `https://www.linkedin.com/oauth/v2/authorization?${params.toString()}` };
  }

  /**
   * Step 2 (PUBLIC callback): exchange + list the organizations
   * the member administrates. Exactly one → account created.
   * MORE than one → pick state (purpose "org_pick"), browser
   * lands on the Connect Center with ?linkedin_pick=<state>.
   * ZERO → honest error, NOTHING stored. Never throws.
   */
  async handleLinkedInCallback(query: { code?: string; state?: string; error?: string }): Promise<string> {
    try {
      if (query.error) {
        return this.connectionsRedirect({ linkedin_error: `LinkedIn Connect বাতিল/ব্যর্থ হয়েছে: ${query.error}` });
      }
      if (!query.code || !query.state) {
        return this.connectionsRedirect({ linkedin_error: "LinkedIn callback-এ code/state পাওয়া যায়নি — আবার Connect করার চেষ্টা করুন।" });
      }
      const stateRow = await this.consumeState(query.state, "linkedin", "connect");
      if (!stateRow) {
        return this.connectionsRedirect({ linkedin_error: "Connect লিংকটি মেয়াদোত্তীর্ণ বা ইতিমধ্যে ব্যবহৃত — কানেক্ট সেন্টার থেকে আবার Connect করুন।" });
      }
      // CC28: exchange with the app the state was bound to.
      const appSource = (stateRow as any).payload?.appSource === "own" ? "own" : "platform";
      const creds = await this.linkedinCredsFor(stateRow.organizationId, appSource);
      if (!creds) return this.connectionsRedirect({ linkedin_error: appSource === "own" ? OWN_LINKEDIN_NOT_CONFIGURED_MSG : LINKEDIN_NOT_CONFIGURED_MSG });
      let tokens: LinkedinTokenSet;
      try {
        tokens = await this.linkedin.exchangeCode(creds, query.code);
      } catch (e) {
        return this.connectionsRedirect({ linkedin_error: `LinkedIn Token বিনিময় ব্যর্থ হয়েছে: ${e instanceof Error ? e.message : "unknown error"}` });
      }
      let orgs: { id: string; name: string }[];
      try {
        orgs = await this.linkedin.listAdminOrganizations(tokens.accessToken);
      } catch (e) {
        return this.connectionsRedirect({ linkedin_error: `LinkedIn Page তালিকা আনা যায়নি: ${e instanceof Error ? e.message : "unknown error"}` });
      }
      if (orgs.length === 0) {
        return this.connectionsRedirect({ linkedin_error: "এই LinkedIn অ্যাকাউন্ট কোনো Page-এর admin নয় — কোনো Page পাওয়া যায়নি, তাই কিছু সেভ করা হয়নি। যেই অ্যাকাউন্ট Page-এর admin, সেটি দিয়ে Connect করুন।" });
      }
      if (orgs.length === 1) {
        const org = orgs[0]!;
        await this.persistOAuthAccount({
          organizationId: stateRow.organizationId, actorId: stateRow.userId,
          platform: "linkedin_page", provider: "linkedin_social",
          externalId: org.id, name: org.name,
          credential: this.linkedinCredential(tokens, org.id),
          appSource,
        });
        return this.connectionsRedirect({ linkedin_connected: "linkedin_page" });
      }
      const pickState = await this.createState(stateRow.organizationId, stateRow.userId, "linkedin", "org_pick", {
        sealed: encryptJson(this.linkedinCredential(tokens, "")),
        appSource,
        organizations: orgs.map((o) => ({ id: o.id, name: o.name })),
      });
      return this.connectionsRedirect({ linkedin_pick: pickState });
    } catch (e) {
      this.logger.warn(`linkedin callback failed: ${e instanceof Error ? e.message : "unknown"}`);
      return this.connectionsRedirect({ linkedin_error: "LinkedIn Connect সম্পন্ন করা যায়নি — আবার চেষ্টা করুন।" });
    }
  }

  private async peekLinkedinPickState(organizationId: string, userId: string, stateId: string): Promise<any | null> {
    const row = await this.peekState(stateId, "linkedin", "org_pick");
    if (!row) return null;
    if (row.organizationId !== organizationId || row.userId !== userId) return null;
    return row;
  }

  /** Picker step A (authenticated): the Pages on offer. */
  async getLinkedInPickInfo(organizationId: string, userId: string, stateId: string) {
    const row = await this.peekLinkedinPickState(organizationId, userId, stateId);
    if (!row) {
      throw new BadRequestException("Page বেছে নেওয়ার লিংকটি মেয়াদোত্তীর্ণ বা অবৈধ — LinkedIn Connect আবার শুরু করুন।");
    }
    const organizations = Array.isArray(row.payload?.organizations) ? row.payload.organizations : [];
    return { organizations };
  }

  /** Picker step B (authenticated): store EXACTLY the picked
   * Page; an id outside the offered list is refused. */
  async selectLinkedInOrganization(organizationId: string, userId: string, dto: { state?: string; organizationId?: string }) {
    const stateId = typeof dto?.state === "string" ? dto.state : "";
    const row = await this.peekLinkedinPickState(organizationId, userId, stateId);
    if (!row) {
      throw new BadRequestException("Page বেছে নেওয়ার লিংকটি মেয়াদোত্তীর্ণ বা অবৈধ — LinkedIn Connect আবার শুরু করুন।");
    }
    const orgs: { id: string; name: string }[] = Array.isArray(row.payload?.organizations) ? row.payload.organizations : [];
    const chosen = orgs.find((o) => o.id === dto?.organizationId);
    if (!chosen) {
      throw new BadRequestException("নির্বাচিত Pageটি এই Connect-এর তালিকায় নেই — তালিকা থেকে একটি Page বেছে নিন।");
    }
    const consumed = await this.consumeState(stateId, "linkedin", "org_pick");
    if (!consumed) {
      throw new BadRequestException("Page বেছে নেওয়ার লিংকটি ইতিমধ্যে ব্যবহৃত হয়েছে — কানেক্ট সেন্টারে অ্যাকাউন্টটি যুক্ত হয়েছে কিনা দেখুন, না হলে আবার Connect করুন।");
    }
    let cred: Record<string, any>;
    try {
      cred = decryptJson<Record<string, any>>(String(row.payload?.sealed ?? ""));
    } catch {
      throw new BadRequestException("Connect-এর তথ্য পড়া যাচ্ছে না — LinkedIn Connect আবার শুরু করুন।");
    }
    const account = await this.persistOAuthAccount({
      organizationId, actorId: userId,
      platform: "linkedin_page", provider: "linkedin_social",
      externalId: chosen.id, name: chosen.name,
      credential: { ...cred, organizationId: chosen.id },
      // CC28: the pick state carries the connect's app source.
      appSource: (row.payload as any)?.appSource === "own" ? "own" : "platform",
    });
    return this.serializeAccount(account);
  }

  // ---------- SN6: Telegram channel connect (bot token, NOT OAuth) ----------

  /**
   * Verify-before-save, in order — ANY failure throws a Bengali
   * 400 carrying Telegram's verbatim message and NOTHING is
   * stored (no Integration, no credential, no account row):
   * 1. getMe — the pasted token really is a bot token;
   * 2. getChat — the channel exists for this bot, and really is
   *    a channel (a group/supergroup target is refused honestly:
   *    SN6 publishes to channels);
   * 3. getChatMember — the bot is that channel's administrator
   *    (or creator) AND may post messages; a bot that cannot
   *    post would only fail later, inside the worker.
   * On success the account persists through the ONE OAuth
   * persistence path (provider "telegram_social") with the bot
   * token sealed exactly like every other social credential
   * ({ accessToken, expiresAt: 0 } — bot tokens do not expire,
   * so ensureAccessToken's skew check always returns the stored
   * token and no refresh branch exists for telegram).
   * externalId is the channel's numeric chat id (the stable id
   * publishing addresses); the channel username rides along for
   * display + public t.me URLs.
   */
  async connectTelegramChannel(
    organizationId: string, userId: string,
    dto: { botToken?: string; channel?: string },
  ) {
    const botToken = String(dto?.botToken ?? "").trim();
    const channelInput = String(dto?.channel ?? "").trim();
    if (!botToken) {
      throw new BadRequestException("Bot Token প্রয়োজন — Telegram-এ @BotFather দিয়ে একটি Bot বানিয়ে তার Token-টি দিন।");
    }
    if (!channelInput) {
      throw new BadRequestException("Channel-এর Username (যেমন @mychannel) অথবা numeric Chat ID প্রয়োজন।");
    }
    let bot: { id: number; username: string | null };
    try {
      bot = await this.telegram.getMe(botToken);
    } catch (e) {
      throw new BadRequestException(`Bot যাচাই ব্যর্থ হয়েছে — Token-টি সঠিক কিনা দেখুন। Telegram-এর বার্তা: ${e instanceof Error ? e.message : "unknown error"}`);
    }
    let chat: { id: number; type: string; title: string | null; username: string | null };
    try {
      chat = await this.telegram.getChat(botToken, channelInput);
    } catch (e) {
      throw new BadRequestException(`Channel পাওয়া যায়নি — Username/ID সঠিক কিনা এবং Bot-টি Channel-এ যোগ করা হয়েছে কিনা দেখুন। Telegram-এর বার্তা: ${e instanceof Error ? e.message : "unknown error"}`);
    }
    if (chat.type !== "channel") {
      throw new BadRequestException(`এটি একটি Channel নয় (ধরন: ${chat.type || "unknown"}) — Telegram পোস্টিং এই সংস্করণে শুধু Channel-এ হয়। Channel-এর Username/ID দিন।`);
    }
    let member: { status: string; canPostMessages: boolean | null };
    try {
      member = await this.telegram.getChatMember(botToken, String(chat.id), bot.id);
    } catch (e) {
      throw new BadRequestException(`Bot-এর Channel-সদস্যতা যাচাই করা যায়নি। Telegram-এর বার্তা: ${e instanceof Error ? e.message : "unknown error"}`);
    }
    const isAdmin = member.status === "administrator" || member.status === "creator";
    if (!isAdmin) {
      throw new BadRequestException(`Bot-টি এই Channel-এর Admin নয় (বর্তমান অবস্থা: ${member.status || "member নয়"}) — Channel Settings → Administrators-এ Bot-টিকে Admin করুন, তারপর আবার চেষ্টা করুন।`);
    }
    if (member.canPostMessages === false) {
      throw new BadRequestException("Bot-টি Admin হলেও Channel-এ পোস্ট করার অনুমতি (Post Messages) বন্ধ আছে — Channel-এর Admin সেটিংসে Bot-এর 'Post Messages' অনুমতি চালু করুন, তারপর আবার চেষ্টা করুন।");
    }
    const account = await this.persistOAuthAccount({
      organizationId, actorId: userId,
      platform: "telegram", provider: "telegram_social",
      externalId: String(chat.id),
      name: chat.title || (chat.username ? `@${chat.username}` : `Channel ${chat.id}`),
      username: chat.username ?? null,
      credential: { accessToken: botToken, expiresAt: 0, botUsername: bot.username ?? null },
    });
    return this.serializeAccount(account);
  }

  // ---------- SN7: Threads connect (Meta-family OAuth) ----------

  private async threadsCredsFor(organizationId: string, appSource: string): Promise<ThreadsAppCreds | null> {
    if (appSource === "own") {
      const own = await resolveTenantAppConfig(this.prisma, organizationId, "threads");
      if (!own) return null;
      return { clientId: own.appId, clientSecret: own.appSecret, redirectUri: socialOAuthRedirectUri("threads") };
    }
    await ensurePlatformConfig(this.prisma as any).catch(() => undefined);
    const cfg = effectiveThreadsAppConfig();
    if (!cfg) return null;
    return {
      clientId: cfg.clientId, clientSecret: cfg.clientSecret,
      redirectUri: socialOAuthRedirectUri("threads", cfg.redirectUri),
    };
  }

  /** Step 1 (authenticated): state + threads.net authorize URL.
   * One authorization yields exactly ONE Threads profile, so
   * (unlike YouTube/LinkedIn) there is no picker — the callback
   * stores the account directly. ?appSource=own runs under the
   * tenant's OWN Threads app (CC28 discipline). */
  async threadsConnectUrl(organizationId: string, userId: string, appSource?: string): Promise<{ url: string }> {
    if (appSource != null && !["platform", "own"].includes(appSource)) {
      throw new BadRequestException("appSource must be platform or own");
    }
    const creds = await this.threadsCredsFor(organizationId, appSource ?? "platform");
    if (!creds) {
      throw new BadRequestException(appSource === "own" ? OWN_THREADS_NOT_CONFIGURED_MSG : THREADS_NOT_CONFIGURED_MSG);
    }
    const state = appSource === "own"
      ? await this.createState(organizationId, userId, "threads", "connect", { appSource: "own" })
      : await this.createState(organizationId, userId, "threads", "connect");
    const params = new URLSearchParams({
      client_id: creds.clientId,
      redirect_uri: creds.redirectUri,
      scope: THREADS_SCOPES,
      response_type: "code",
      state,
    });
    return { url: `https://www.threads.net/oauth/authorize?${params.toString()}` };
  }

  /**
   * Step 2 (PUBLIC callback): code → short-lived token →
   * long-lived token (th_exchange_token) → profile → account.
   * The stored credential is the LONG-lived token only, with
   * its real expiry — the 1-hour token never touches storage.
   * NEVER throws — every outcome is a redirect to the Social
   * Posts page (where the connect started) with
   * social_connected=threads or a social_error explanation.
   */
  async handleThreadsCallback(query: { code?: string; state?: string; error?: string }): Promise<string> {
    try {
      if (query.error) {
        return this.webRedirect({ social_error: `Threads Connect বাতিল/ব্যর্থ হয়েছে: ${query.error}` });
      }
      if (!query.code || !query.state) {
        return this.webRedirect({ social_error: "Threads callback-এ code/state পাওয়া যায়নি — আবার Connect করার চেষ্টা করুন।" });
      }
      const stateRow = await this.consumeState(query.state, "threads", "connect");
      if (!stateRow) {
        return this.webRedirect({ social_error: "Connect লিংকটি মেয়াদোত্তীর্ণ বা ইতিমধ্যে ব্যবহৃত — আবার Connect করুন।" });
      }
      const appSource = (stateRow as any).payload?.appSource === "own" ? "own" : "platform";
      const creds = await this.threadsCredsFor(stateRow.organizationId, appSource);
      if (!creds) {
        return this.webRedirect({ social_error: appSource === "own" ? OWN_THREADS_NOT_CONFIGURED_MSG : THREADS_NOT_CONFIGURED_MSG });
      }
      let longLived: ThreadsTokenSet;
      let exchangedUserId: string | null;
      try {
        const exchanged = await this.threads.exchangeCode(creds, query.code);
        exchangedUserId = exchanged.userId;
        longLived = await this.threads.exchangeLongLived(creds, exchanged.shortLivedToken);
      } catch (e) {
        return this.webRedirect({ social_error: `Threads Token বিনিময় ব্যর্থ হয়েছে: ${e instanceof Error ? e.message : "unknown error"}` });
      }
      let profile: { id: string; username: string | null; name: string | null; pictureUrl: string | null };
      try {
        profile = await this.threads.getProfile(longLived.accessToken);
      } catch (e) {
        return this.webRedirect({ social_error: `Threads Profile আনা যায়নি: ${e instanceof Error ? e.message : "unknown error"}` });
      }
      const externalId = profile.id || exchangedUserId;
      if (!externalId) {
        return this.webRedirect({ social_error: "Threads Profile থেকে কোনো User ID পাওয়া যায়নি — কিছু সেভ করা হয়নি, আবার Connect করুন।" });
      }
      await this.persistOAuthAccount({
        organizationId: stateRow.organizationId, actorId: stateRow.userId,
        platform: "threads", provider: "threads_social",
        externalId,
        name: profile.name || (profile.username ? `@${profile.username}` : "Threads"),
        username: profile.username ?? null,
        pictureUrl: profile.pictureUrl ?? null,
        credential: { accessToken: longLived.accessToken, expiresAt: longLived.expiresAt, scope: THREADS_SCOPES },
        appSource,
      });
      return this.webRedirect({ social_connected: "threads" });
    } catch (e) {
      this.logger.warn(`threads callback failed: ${e instanceof Error ? e.message : "unknown"}`);
      return this.webRedirect({ social_error: "Threads Connect সম্পন্ন করা যায়নি — আবার চেষ্টা করুন।" });
    }
  }

  // ---------- OU9: Google Business Profile connect ----------

  /** OU9: the Google app credentials for the GBP flow — the
   * platform googleApp (YouTube's app) or the tenant's OWN
   * Google app (CC28 TenantAppConfig "google"), but with the
   * GBP flow's OWN derived redirect URI: Google requires an
   * EXACT redirect match per flow, and the GBP callback is a
   * different route from YouTube's, so neither the configured
   * googleApp.redirectUri (registered for YouTube) nor the
   * derived YouTube URI may be reused here. The operator /
   * tenant registers …/social/oauth/google-business-profile
   * /callback on the app they connect with. */
  private async gbpCredsFor(organizationId: string, appSource: string): Promise<GoogleAppCreds | null> {
    const redirectUri = socialOAuthRedirectUri("google-business-profile");
    if (appSource === "own") {
      const own = await resolveTenantAppConfig(this.prisma, organizationId, "google");
      if (!own) return null;
      return { clientId: own.appId, clientSecret: own.appSecret, redirectUri };
    }
    await ensurePlatformConfig(this.prisma as any).catch(() => undefined);
    const cfg = effectiveGoogleAppConfig();
    if (!cfg) return null;
    return { clientId: cfg.clientId, clientSecret: cfg.clientSecret, redirectUri };
  }

  /** The sealed credential a GBP SocialAccount carries (the
   * YouTube credential shape + the location's account resource,
   * kept for display/diagnostics; the publish parent is the
   * account's externalId itself). */
  private gbpCredential(tokens: GoogleTokenSet, location: GbpLocation): Record<string, unknown> {
    return {
      accessToken: tokens.accessToken,
      refreshToken: tokens.refreshToken ?? null,
      expiresAt: tokens.expiresAt,
      scope: tokens.scope ?? null,
      accountName: location.accountName,
      locationName: location.locationName,
    };
  }

  /**
   * Step 1 (authenticated): mint state + return Google's
   * authorize URL for the business.manage scope (SP9 YouTube
   * discipline: access_type=offline + prompt=consent so a
   * refresh token is issued, including on re-connect).
   *
   * The connect is NOT blocked by the API-access gate: OAuth
   * itself is not a Business Profile API call, and blocking
   * connect would hide the location list's real answer. The
   * gate is surfaced in platform-modes (the UI states it before
   * the tenant starts), the location fetch surfaces Google's
   * own refusal verbatim when the gate blocks it, and
   * PUBLISHING refuses outright while unapproved.
   * ?appSource=own runs under the tenant's OWN Google app
   * (CC28), bound into the state like every sibling flow.
   */
  async googleBusinessConnectUrl(organizationId: string, userId: string, appSource?: string): Promise<{ url: string }> {
    if (appSource != null && !["platform", "own"].includes(appSource)) {
      throw new BadRequestException("appSource must be platform or own");
    }
    const creds = await this.gbpCredsFor(organizationId, appSource ?? "platform");
    if (!creds) {
      throw new BadRequestException(appSource === "own" ? OWN_GOOGLE_NOT_CONFIGURED_MSG : GOOGLE_NOT_CONFIGURED_MSG);
    }
    const state = appSource === "own"
      ? await this.createState(organizationId, userId, GBP_PLATFORM, "connect", { appSource: "own" })
      : await this.createState(organizationId, userId, GBP_PLATFORM, "connect");
    const params = new URLSearchParams({
      client_id: creds.clientId,
      redirect_uri: creds.redirectUri,
      response_type: "code",
      scope: GBP_SCOPE,
      access_type: "offline",
      prompt: "consent",
      state,
    });
    return { url: `https://accounts.google.com/o/oauth2/v2/auth?${params.toString()}` };
  }

  /**
   * Step 2 (PUBLIC callback): exchange + list the user's GBP
   * locations through the documented v1 APIs. Exactly one
   * location → the account is created immediately. MORE than
   * one → NOTHING is created yet: the sealed token bundle +
   * location list move into a pick state (purpose
   * "location_pick") and the browser lands back with
   * ?gbp_pick=<state> for the authenticated picker. ZERO →
   * honest error, nothing stored. A Google refusal while
   * listing (the API-access gate's real face) surfaces
   * VERBATIM in the redirect error. Never throws.
   */
  async handleGoogleBusinessCallback(query: { code?: string; state?: string; error?: string }): Promise<string> {
    try {
      if (query.error) {
        return this.webRedirect({ social_error: `Google Business Profile Connect বাতিল/ব্যর্থ হয়েছে: ${query.error}` });
      }
      if (!query.code || !query.state) {
        return this.webRedirect({ social_error: "Google Business Profile callback-এ code/state পাওয়া যায়নি — আবার Connect করার চেষ্টা করুন।" });
      }
      const stateRow = await this.consumeState(query.state, GBP_PLATFORM, "connect");
      if (!stateRow) {
        return this.webRedirect({ social_error: "Connect লিংকটি মেয়াদোত্তীর্ণ বা ইতিমধ্যে ব্যবহৃত — Social Posts পেজ থেকে আবার Connect করুন।" });
      }
      const appSource = (stateRow as any).payload?.appSource === "own" ? "own" : "platform";
      const creds = await this.gbpCredsFor(stateRow.organizationId, appSource);
      if (!creds) return this.webRedirect({ social_error: appSource === "own" ? OWN_GOOGLE_NOT_CONFIGURED_MSG : GOOGLE_NOT_CONFIGURED_MSG });
      let tokens: GoogleTokenSet;
      try {
        tokens = await this.youtube.exchangeCode(creds, query.code);
      } catch (e) {
        return this.webRedirect({ social_error: `Google Token বিনিময় ব্যর্থ হয়েছে: ${e instanceof Error ? e.message : "unknown error"}` });
      }
      if (!tokens.refreshToken) {
        return this.webRedirect({ social_error: "Google refresh token দেয়নি — Connect আবার চেষ্টা করুন (সম্মতি স্ক্রিনে সব অনুমতি দিন)।" });
      }
      let locations: GbpLocation[];
      try {
        locations = await this.gbp.listLocations(tokens.accessToken);
      } catch (e) {
        // The API-access gate, when it blocks, blocks HERE:
        // Google's own message is the explanation — never
        // replaced with a generic failure, never hidden.
        return this.webRedirect({ social_error: `Google Business Profile Location তালিকা আনা যায়নি: ${e instanceof Error ? e.message : "unknown error"}` });
      }
      if (locations.length === 0) {
        return this.webRedirect({ social_error: "এই Google অ্যাকাউন্টে কোনো Business Profile location পাওয়া যায়নি — কিছু সেভ করা হয়নি। যেই অ্যাকাউন্টে location আছে সেটি দিয়ে Connect করুন।" });
      }
      if (locations.length === 1) {
        const loc = locations[0]!;
        await this.persistOAuthAccount({
          organizationId: stateRow.organizationId, actorId: stateRow.userId,
          platform: GBP_PLATFORM, provider: GBP_PROVIDER,
          externalId: loc.parent, name: loc.title,
          credential: this.gbpCredential(tokens, loc),
          appSource,
        });
        return this.webRedirect({ social_connected: GBP_PLATFORM });
      }
      const pickState = await this.createState(stateRow.organizationId, stateRow.userId, GBP_PLATFORM, "location_pick", {
        sealed: encryptJson(this.gbpCredential(tokens, locations[0]!)),
        appSource,
        locations: locations.map((l) => ({ parent: l.parent, title: l.title, accountLabel: l.accountLabel, accountName: l.accountName, locationName: l.locationName })),
      });
      return this.webRedirect({ gbp_pick: pickState });
    } catch (e) {
      this.logger.warn(`google business callback failed: ${e instanceof Error ? e.message : "unknown"}`);
      return this.webRedirect({ social_error: "Google Business Profile Connect সম্পন্ন করা যায়নি — আবার চেষ্টা করুন।" });
    }
  }

  /** The GBP picker's state, validated for THIS org+user
   * (peeked, not consumed — the selection consumes it). */
  private async peekGbpPickState(organizationId: string, userId: string, stateId: string): Promise<any | null> {
    const row = await this.peekState(stateId, GBP_PLATFORM, "location_pick");
    if (!row) return null;
    if (row.organizationId !== organizationId || row.userId !== userId) return null;
    return row;
  }

  /** Picker step A (authenticated): the locations on offer —
   * ids/titles only; the sealed tokens never leave the server. */
  async getGoogleBusinessPickInfo(organizationId: string, userId: string, stateId: string) {
    const row = await this.peekGbpPickState(organizationId, userId, stateId);
    if (!row) {
      throw new BadRequestException("Location বেছে নেওয়ার লিংকটি মেয়াদোত্তীর্ণ বা অবৈধ — Google Business Profile Connect আবার শুরু করুন।");
    }
    const locations = (Array.isArray(row.payload?.locations) ? row.payload.locations : [])
      .map((l: any) => ({ id: l.parent, title: l.title, accountLabel: l.accountLabel ?? null }));
    return { locations };
  }

  /** Picker step B (authenticated): consume the pick state and
   * create the account for the CHOSEN location only. A parent
   * outside the offered list is refused — the state is the
   * authority on what this authorization actually granted. */
  async selectGoogleBusinessLocation(organizationId: string, userId: string, dto: { state?: string; locationId?: string }) {
    const stateId = typeof dto?.state === "string" ? dto.state : "";
    const row = await this.peekGbpPickState(organizationId, userId, stateId);
    if (!row) {
      throw new BadRequestException("Location বেছে নেওয়ার লিংকটি মেয়াদোত্তীর্ণ বা অবৈধ — Google Business Profile Connect আবার শুরু করুন।");
    }
    const locations: GbpLocation[] = (Array.isArray(row.payload?.locations) ? row.payload.locations : [])
      .map((l: any) => ({ parent: l.parent, locationName: l.locationName, accountName: l.accountName, title: l.title, accountLabel: l.accountLabel ?? null }));
    const chosen = locations.find((l) => l.parent === dto?.locationId);
    if (!chosen) {
      throw new BadRequestException("নির্বাচিত Locationটি এই Connect-এর তালিকায় নেই — তালিকা থেকে একটি Location বেছে নিন।");
    }
    const consumed = await this.consumeState(stateId, GBP_PLATFORM, "location_pick");
    if (!consumed) {
      throw new BadRequestException("Location বেছে নেওয়ার লিংকটি ইতিমধ্যে ব্যবহৃত হয়েছে — Social Posts পেজে অ্যাকাউন্টটি যুক্ত হয়েছে কিনা দেখুন, না হলে আবার Connect করুন।");
    }
    let cred: Record<string, any>;
    try {
      cred = decryptJson<Record<string, any>>(String(row.payload?.sealed ?? ""));
    } catch {
      throw new BadRequestException("Connect-এর তথ্য পড়া যাচ্ছে না — Google Business Profile Connect আবার শুরু করুন।");
    }
    const account = await this.persistOAuthAccount({
      organizationId, actorId: userId,
      platform: GBP_PLATFORM, provider: GBP_PROVIDER,
      externalId: chosen.parent, name: chosen.title,
      credential: { ...cred, accountName: chosen.accountName, locationName: chosen.locationName },
      appSource: (row.payload as any)?.appSource === "own" ? "own" : "platform",
    });
    return this.serializeAccount(account);
  }
}
