/**
 * CC20 — Google pack connect flows (GA4, Merchant Center,
 * Business Profile) for the Connect Center.
 *
 * CC28 (Connect Center Next): BOTH app paths now — the
 * OPERATOR's Google app (the same app YouTube uses —
 * platform-config googleAppConfig) or the TENANT'S OWN Google
 * app (TenantAppConfig platform "google", CC28). The chosen
 * source is bound into the OAuth state (the CC4 TikTok
 * discipline), the callback exchanges with that same client,
 * the Integration row records appSource, and token refresh
 * resolves the client by the row's own appSource. Platform-app
 * accounts behave byte-identically to the CC20 flow.
 *
 * WHY this lives in the connections module, not social/: the
 * results are Integration rows surfaced in the Connect Center,
 * not SocialAccounts — and importing SocialModule from here
 * would cycle (social-oauth imports connections helpers). The
 * OAuth-state DISCIPLINE is the SP9/YouTube one, applied to the
 * same SocialOAuthState table: random state bound to
 * (org, user, provider, purpose), 10-minute expiry, atomic
 * single-use consume; the account-pick step carries a SEALED
 * credential payload so a picked account stores without a
 * second Google round-trip.
 *
 * Honesty rules, pinned by specs:
 * - Google returns ZERO accounts of a kind → the flow ends with
 *   that result and stores NOTHING.
 * - Google grants no refresh token → connection refused,
 *   nothing stored (a silently-expiring token is not a
 *   connection).
 * - Redirect URIs are the DERIVED per-flow callback URLs
 *   (…/social/oauth/google-ga4/callback etc.), never the
 *   configured googleAppConfig.redirectUri — that URI is
 *   registered for the YouTube flow and Google requires an
 *   EXACT match per flow; the operator registers the three
 *   derived URLs on the same app.
 */

import { BadRequestException, Injectable, Logger, Optional } from "@nestjs/common";
import { randomBytes } from "node:crypto";
import { PrismaService } from "../prisma/prisma.service";
import { AuditService } from "../audit/audit.service";
import { decryptJson, encryptJson } from "../integrations/crypto";
import {
  effectiveGoogleAppConfig,
  ensurePlatformConfig,
  socialOAuthRedirectUri,
} from "../common/platform-config";
import { GoogleClient, type GoogleAccountOption, type GoogleConnectKind } from "./google.client";
import { resolveTenantAppConfig } from "./tenant-app-config";

export type GoogleAppSource = "platform" | "own";

export const GOOGLE_OWN_NOT_CONFIGURED_MSG =
  "আপনার নিজের Google App এখনো সেভ করা হয়নি — Connect Center-এর 'নিজের অ্যাপ' অংশে Google Client ID ও Secret সেভ করুন (সেখানে দেওয়া Redirect URI-গুলো আপনার Google Cloud Console-এ register করতে হবে), তারপর আবার কানেক্ট করুন।";

/** Integration.status values (the column is a plain string in
 * this codebase — no shared enum export exists). */
const STATUS_CONNECTED = "CONNECTED";
const STATUS_DISCONNECTED = "DISCONNECTED";

export const GOOGLE_KIND_META: Record<GoogleConnectKind, {
  provider: string;
  label: string;
  scope: string;
  redirectSegment: "google-ga4" | "google-merchant" | "google-business";
  emptyMessage: string;
}> = {
  ga4: {
    provider: "google_analytics",
    label: "Google Analytics (GA4)",
    scope: "https://www.googleapis.com/auth/analytics.readonly",
    redirectSegment: "google-ga4",
    emptyMessage: "এই Google অ্যাকাউন্টে কোনো GA4 property পাওয়া যায়নি — কিছু সেভ করা হয়নি।",
  },
  merchant: {
    provider: "google_merchant",
    label: "Google Merchant Center",
    scope: "https://www.googleapis.com/auth/content",
    redirectSegment: "google-merchant",
    emptyMessage: "এই Google অ্যাকাউন্টে কোনো Merchant Center অ্যাকাউন্ট পাওয়া যায়নি — কিছু সেভ করা হয়নি।",
  },
  business: {
    provider: "google_business",
    label: "Google Business Profile",
    scope: "https://www.googleapis.com/auth/business.manage",
    redirectSegment: "google-business",
    emptyMessage: "এই Google অ্যাকাউন্টে কোনো Business Profile location পাওয়া যায়নি — কিছু সেভ করা হয়নি।",
  },
};

export const GOOGLE_PROVIDER_KIND: Record<string, GoogleConnectKind> = {
  google_analytics: "ga4",
  google_merchant: "merchant",
  google_business: "business",
};

export const GOOGLE_PACK_NOT_CONFIGURED_MSG =
  "প্ল্যাটফর্মের Google App এখনো configure করা হয়নি — platform admin-কে Admin → Platform Config → Google App-এ Client ID ও Client Secret সেভ করতে বলুন। এরপর এখান থেকে কানেক্ট করা যাবে।";

const STATE_TTL_MS = 10 * 60_000;

interface GoogleCredPayload {
  accessToken: string;
  refreshToken?: string;
  expiresAt: number;
  scope?: string;
}

export interface GoogleCallbackResult {
  kind: GoogleConnectKind;
  connected?: boolean;
  pickState?: string;
  error?: string;
}

@Injectable()
export class GoogleConnectService {
  private readonly logger = new Logger(GoogleConnectService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    @Optional() private readonly client?: GoogleClient,
  ) {}

  private google(): GoogleClient {
    return this.client ?? new GoogleClient();
  }

  /**
   * CC28: resolve the OAuth client for a flow by its appSource —
   * own → the tenant's saved Google app (TenantAppConfig),
   * platform → the operator's googleAppConfig (CC20 behavior).
   * Throws the honest Bengali refusal when the chosen source is
   * not configured; nothing falls back silently to the other
   * app (a token minted under one app is meaningless to the
   * other).
   */
  private async clientFor(organizationId: string, appSource: GoogleAppSource): Promise<{ clientId: string; clientSecret: string }> {
    if (appSource === "own") {
      const own = await resolveTenantAppConfig(this.prisma as any, organizationId, "google");
      if (!own) throw new BadRequestException(GOOGLE_OWN_NOT_CONFIGURED_MSG);
      return { clientId: own.appId, clientSecret: own.appSecret };
    }
    await ensurePlatformConfig(this.prisma as any);
    const cfg = effectiveGoogleAppConfig();
    if (!cfg) throw new BadRequestException(GOOGLE_PACK_NOT_CONFIGURED_MSG);
    return { clientId: cfg.clientId, clientSecret: cfg.clientSecret };
  }

  static assertKind(kind: string): GoogleConnectKind {
    if (kind === "ga4" || kind === "merchant" || kind === "business") return kind;
    throw new BadRequestException("অজানা Google কানেকশনের ধরন।");
  }

  private redirectUri(kind: GoogleConnectKind): string {
    return socialOAuthRedirectUri(GOOGLE_KIND_META[kind].redirectSegment);
  }

  private webBase(): string {
    return (process.env.WEB_URL ?? "http://localhost:3000").replace(/\/$/, "");
  }

  /** The URL the browser is redirected to after ANY callback —
   * the Connect Center reads these params and shows the result. */
  webRedirect(result: GoogleCallbackResult): string {
    const qs = new URLSearchParams();
    if (result.connected) qs.set("google_connected", result.kind);
    else if (result.pickState) { qs.set("google_pick", result.pickState); qs.set("google_kind", result.kind); }
    else if (result.error) qs.set("google_error", result.error);
    return `${this.webBase()}/dashboard/connections?${qs.toString()}`;
  }

  // ---- OAuth state (SP9 discipline, same table) ----

  private async createState(organizationId: string, userId: string, provider: string, purpose: string, payload?: unknown): Promise<string> {
    const id = randomBytes(32).toString("base64url");
    await this.prisma.socialOAuthState.create({
      data: {
        id,
        organizationId,
        userId,
        platform: provider,
        purpose,
        payload: (payload ?? undefined) as any,
        expiresAt: new Date(Date.now() + STATE_TTL_MS),
      },
    });
    return id;
  }

  private async peekState(state: string, provider: string, purpose: string) {
    const row = await this.prisma.socialOAuthState.findUnique({ where: { id: state } });
    if (!row || row.platform !== provider || row.purpose !== purpose || row.consumedAt) return null;
    if (row.expiresAt && row.expiresAt.getTime() < Date.now()) return null;
    return row;
  }

  private async consumeState(state: string, provider: string, purpose: string) {
    const row = await this.peekState(state, provider, purpose);
    if (!row) return null;
    const claimed = await this.prisma.socialOAuthState.updateMany({
      where: { id: state, consumedAt: null },
      data: { consumedAt: new Date() },
    });
    return claimed.count === 1 ? row : null;
  }

  // ---- Connect flow ----

  /** GET …/connections/google/:kind/connect-url?appSource= —
   * CC28: the chosen app source is bound into the OAuth state
   * (CC4 discipline) so the callback exchanges with the SAME
   * app the user picked. */
  async connectUrl(organizationId: string, userId: string, kindRaw: string, appSourceRaw?: string): Promise<{ url: string }> {
    const kind = GoogleConnectService.assertKind(kindRaw);
    const appSource: GoogleAppSource = appSourceRaw === "own" ? "own" : "platform";
    const client = await this.clientFor(organizationId, appSource);
    const meta = GOOGLE_KIND_META[kind];
    const state = await this.createState(organizationId, userId, meta.provider, "connect", { appSource });
    const params = new URLSearchParams({
      client_id: client.clientId,
      redirect_uri: this.redirectUri(kind),
      response_type: "code",
      scope: meta.scope,
      access_type: "offline",
      prompt: "consent",
      include_granted_scopes: "true",
      state,
    });
    return { url: `https://accounts.google.com/o/oauth2/v2/auth?${params.toString()}` };
  }

  /** Public callback — NEVER throws; the result is a web
   * redirect (YouTube precedent), errors travel in the URL. */
  async handleCallback(kindRaw: string, input: { code?: string; state?: string; error?: string }): Promise<GoogleCallbackResult> {
    const kind = kindRaw as GoogleConnectKind;
    const meta = GOOGLE_KIND_META[kind];
    try {
      if (input.error) return { kind, error: input.error };
      if (!input.code || !input.state) return { kind, error: "Google callback-এ code/state পাওয়া যায়নি।" };
      const stateRow = await this.consumeState(input.state, meta.provider, "connect");
      if (!stateRow) return { kind, error: "Google connect-এর state মেয়াদোত্তীর্ণ বা ইতিমধ্যে ব্যবহৃত — আবার চেষ্টা করুন।" };
      // CC28: exchange with the app the state was bound to.
      const appSource: GoogleAppSource = (stateRow.payload as any)?.appSource === "own" ? "own" : "platform";
      let client: { clientId: string; clientSecret: string };
      try {
        client = await this.clientFor(stateRow.organizationId, appSource);
      } catch (e) {
        return { kind, error: e instanceof Error ? e.message : GOOGLE_PACK_NOT_CONFIGURED_MSG };
      }
      const tokens = await this.google().exchangeCode(
        { clientId: client.clientId, clientSecret: client.clientSecret, redirectUri: this.redirectUri(kind) },
        input.code,
      );
      if (!tokens.refreshToken) {
        return { kind, error: "Google কোনো refresh token দেয়নি — কানেকশন সেভ করা হয়নি। Google account-এর অনুমতি প্রত্যাহার করে আবার কানেক্ট করুন।" };
      }
      const options = await this.google().listForKind(kind, tokens.accessToken);
      if (options.length === 0) return { kind, error: meta.emptyMessage };
      const cred: GoogleCredPayload = {
        accessToken: tokens.accessToken,
        refreshToken: tokens.refreshToken,
        expiresAt: tokens.expiresAt,
        scope: tokens.scope,
      };
      if (options.length === 1) {
        await this.persist(stateRow.organizationId, stateRow.userId, kind, cred, options[0]!, appSource);
        return { kind, connected: true };
      }
      const pickState = await this.createState(stateRow.organizationId, stateRow.userId, meta.provider, "account_pick", {
        sealed: encryptJson(cred as unknown as Record<string, unknown>),
        appSource,
        options: options.map((o) => ({ id: o.id, name: o.name, detail: o.detail ?? null })),
      });
      return { kind, pickState };
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      this.logger.warn(`Google ${kind} callback failed: ${msg}`);
      return { kind, error: msg };
    }
  }

  /** GET …/connections/google/pick-info?state= — what the
   * account-picker shows. Bound to the state's own org + user. */
  async getPickInfo(organizationId: string, userId: string, state: string) {
    const found = await this.findPickState(organizationId, userId, state);
    const meta = GOOGLE_KIND_META[found.kind];
    return {
      kind: found.kind,
      label: meta.label,
      options: found.options as GoogleAccountOption[],
    };
  }

  private async findPickState(organizationId: string, userId: string, state: string) {
    for (const kind of Object.keys(GOOGLE_KIND_META) as GoogleConnectKind[]) {
      const meta = GOOGLE_KIND_META[kind];
      const row = await this.peekState(state, meta.provider, "account_pick");
      if (!row) continue;
      if (row.organizationId !== organizationId || row.userId !== userId) {
        throw new BadRequestException("এই account-pick state আপনার নয়।");
      }
      const payload = (row.payload ?? {}) as { options?: GoogleAccountOption[] };
      return { kind, row, options: Array.isArray(payload.options) ? payload.options : [] };
    }
    throw new BadRequestException("Account-pick state মেয়াদোত্তীর্ণ বা ইতিমধ্যে ব্যবহৃত — আবার কানেক্ট করুন।");
  }

  /** POST …/connections/google/:kind/select — store EXACTLY the
   * account the user picked; an id outside the offered list is
   * refused, never trusted from the client. */
  async select(organizationId: string, userId: string, kindRaw: string, state: string, optionId: string) {
    const kind = GoogleConnectService.assertKind(kindRaw);
    const meta = GOOGLE_KIND_META[kind];
    const found = await this.findPickState(organizationId, userId, state);
    if (found.kind !== kind) throw new BadRequestException("Account-pick state এই ধরনের কানেকশনের নয়।");
    const option = found.options.find((o) => o.id === optionId);
    if (!option) throw new BadRequestException("বেছে নেওয়া অ্যাকাউন্টটি তালিকায় নেই — আবার কানেক্ট করুন।");
    const consumed = await this.consumeState(state, meta.provider, "account_pick");
    if (!consumed) throw new BadRequestException("Account-pick state ইতিমধ্যে ব্যবহৃত — আবার কানেক্ট করুন।");
    const payload = (consumed.payload ?? {}) as { sealed?: string; appSource?: string };
    const cred = payload.sealed ? (decryptJson(payload.sealed) as unknown as GoogleCredPayload | null) : null;
    if (!cred?.accessToken || !cred.refreshToken) {
      throw new BadRequestException("সেভ করা Google credential পড়া যায়নি — আবার কানেক্ট করুন।");
    }
    await this.persist(organizationId, userId, kind, cred, option, payload.appSource === "own" ? "own" : "platform");
    return { connected: true, kind, externalAccountId: option.id, name: option.name };
  }

  private async persist(organizationId: string, actorId: string, kind: GoogleConnectKind, cred: GoogleCredPayload, option: GoogleAccountOption, appSource: GoogleAppSource = "platform") {
    const meta = GOOGLE_KIND_META[kind];
    const db = this.prisma as any;
    // Supersede: a live row for the same provider + external id
    // is replaced (its sealed credential goes with it) — the
    // tenant re-connecting the same property never forks rows.
    const predecessors = await db.integration.findMany({
      where: { organizationId, provider: meta.provider, externalAccountId: option.id, status: STATUS_CONNECTED },
      select: { id: true },
    });
    for (const old of predecessors) {
      await db.integrationCredential.deleteMany({ where: { integrationId: old.id } });
      await db.integration.update({ where: { id: old.id }, data: { status: STATUS_DISCONNECTED } });
    }
    const integration = await db.integration.create({
      data: {
        organizationId,
        provider: meta.provider,
        status: STATUS_CONNECTED,
        externalAccountId: option.id,
        // CC28: the app this connection's tokens belong to —
        // refresh resolves its client from exactly this.
        appSource,
      },
    });
    await db.integrationCredential.create({
      data: {
        integrationId: integration.id,
        encryptedData: encryptJson({
          accessToken: cred.accessToken,
          refreshToken: cred.refreshToken,
          expiresAt: cred.expiresAt,
          scope: cred.scope,
          externalId: option.id,
          externalName: option.name,
        } as unknown as Record<string, unknown>),
      },
    });
    await this.audit.log({
      organizationId,
      userId: actorId,
      action: "connection.google_connected",
      entityType: "Integration",
      entityId: integration.id,
      metadata: { provider: meta.provider, kind, externalAccountId: option.id, name: option.name, appSource },
    }).catch(() => undefined);
    return integration;
  }

  // ---- Token lifecycle (Doctor + any future reader) ----

  /** A FRESH access token for a stored Google integration —
   * refreshes inside the last minute of validity and persists
   * the rotated access token. Throws the honest reason when the
   * stored credential cannot produce one. */
  async freshAccessToken(integration: { id: string; organizationId: string; appSource?: string | null }): Promise<string> {
    const db = this.prisma as any;
    const row = await db.integrationCredential.findUnique({ where: { integrationId: integration.id } });
    const cred = row?.encryptedData ? (decryptJson(row.encryptedData) as unknown as GoogleCredPayload | null) : null;
    if (!cred?.accessToken) throw new Error("সেভ করা Google credential পাওয়া যায়নি — আবার কানেক্ট করুন।");
    if (cred.expiresAt && cred.expiresAt > Date.now() + 60_000) return cred.accessToken;
    if (!cred.refreshToken) throw new Error("Google refresh token নেই — আবার কানেক্ট করুন।");
    // CC28: refresh with the client of the app this connection
    // was made under (its own recorded appSource). A deleted
    // own-app config surfaces as the honest refusal below, never
    // a silent fall-back to the platform app.
    let client: { clientId: string; clientSecret: string };
    try {
      client = await this.clientFor(integration.organizationId, integration.appSource === "own" ? "own" : "platform");
    } catch (e) {
      throw new Error(e instanceof Error ? e.message : GOOGLE_PACK_NOT_CONFIGURED_MSG);
    }
    const tokens = await this.google().refreshAccessToken(
      { clientId: client.clientId, clientSecret: client.clientSecret, redirectUri: "" },
      cred.refreshToken,
    );
    await db.integrationCredential.update({
      where: { integrationId: integration.id },
      data: {
        encryptedData: encryptJson({
          ...cred,
          accessToken: tokens.accessToken,
          expiresAt: tokens.expiresAt,
        } as unknown as Record<string, unknown>),
      },
    });
    return tokens.accessToken;
  }

  /** The Doctor's real check: one lightweight authenticated
   * list call with a fresh token — count + first names. */
  async doctorList(kind: GoogleConnectKind, integration: { id: string; organizationId: string }) {
    const token = await this.freshAccessToken(integration);
    const options = await this.google().listForKind(kind, token);
    return { count: options.length, names: options.slice(0, 3).map((o) => o.name) };
  }
}
