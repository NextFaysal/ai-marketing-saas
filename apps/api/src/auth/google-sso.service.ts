import { Injectable, Optional, ServiceUnavailableException, UnauthorizedException } from "@nestjs/common";
import { createHash, randomBytes } from "node:crypto";
import { PrismaService } from "../prisma/prisma.service";
import { AuthService } from "./auth.service";
import {
  ensurePlatformConfig, effectiveGoogleOAuthConfig, type GoogleOAuthConfig,
} from "../common/platform-config";
import { serviceUnavailable, unauthorized } from "../i18n";

/**
 * AB8 (AX26) — Google SSO for staff ("Sign in with Google").
 *
 * Flow (no auto-provisioning, ever):
 *  1. start() mints a single-use CSRF `state` (10 min) and
 *     returns Google's authorize URL; the WEB page navigates
 *     the browser there.
 *  2. Google redirects back to GET /auth/google/callback with
 *     code+state. The state row is consumed BEFORE the code
 *     exchange (single-use even when everything after fails).
 *     The code is exchanged server-side and the userinfo email
 *     must be email_verified. The email must match an EXISTING
 *     user — an unknown email is a failure redirect, never a
 *     signup — and the account must be ACTIVE.
 *  3. A matched login does NOT get a session on the callback:
 *     it gets a single-use 5-minute HANDOFF token, delivered
 *     in the URL FRAGMENT of the redirect to the web login
 *     page (`/login/google#handoff=…`) — fragments are never
 *     sent to servers, so the token never lands in access
 *     logs or referrers. The web page POSTs it to
 *     /auth/google/exchange, which completes the login via
 *     AuthService.completeGoogleLogin (TOTP still applies).
 *
 * Token-at-rest discipline mirrors VerificationService: only
 * SHA-256 hashes of state/handoff tokens are stored
 * (SsoLoginState); the raw tokens exist only in the URLs the
 * browser carries. Failure redirects use stable codes:
 * not_configured | state_invalid | exchange_failed |
 * email_unverified | account_not_found | account_inactive.
 * account_not_found / account_inactive also write a FAILED
 * LoginEvent (method "google", attempted email) — mirroring
 * password-login failure recording; state/exchange failures
 * establish no identity and record nothing.
 */

const AUTHORIZE_URL = "https://accounts.google.com/o/oauth2/v2/auth";
const TOKEN_URL = "https://oauth2.googleapis.com/token";
const USERINFO_URL = "https://openidconnect.googleapis.com/v1/userinfo";
const STATE_TTL_MS = 10 * 60 * 1000;
const HANDOFF_TTL_MS = 5 * 60 * 1000;

function sha256Hex(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}
function apiBase(): string {
  return (process.env.API_PUBLIC_URL ?? "http://localhost:4000").replace(/\/+$/, "");
}
function webBase(): string {
  return (process.env.WEB_URL ?? "http://localhost:3000").replace(/\/+$/, "");
}
function redirectUri(): string {
  return `${apiBase()}/auth/google/callback`;
}

@Injectable()
export class GoogleSsoService {
  /** Substitutable fetch seam (specs replace it; production
   * uses the global fetch — the publishing.service shape). */
  fetchFn: (url: string, init?: any) => Promise<any> = (url: string, init?: any) => fetch(url, init);

  constructor(
    private readonly prisma: PrismaService,
    // Optional so older direct constructions keep working; the
    // AuthModule always provides the real AuthService.
    @Optional() private readonly auth?: AuthService,
  ) {}

  private t() { return (this.prisma as any).ssoLoginState; }

  /** The effective SSO config from the ADMIN snapshot (after a
   * bounded refresh). Null = not configured (no env fallback —
   * see effectiveGoogleOAuthConfig). */
  private async loadConfig(): Promise<(GoogleOAuthConfig & { source: "admin" }) | null> {
    await ensurePlatformConfig(this.prisma as any).catch(() => undefined);
    return effectiveGoogleOAuthConfig();
  }

  /** Public view for the login page: is the Google button on? */
  async config(): Promise<{ enabled: boolean }> {
    const cfg = await this.loadConfig();
    return { enabled: Boolean(cfg && cfg.enabled === true) };
  }

  /** Same discipline as AuthService.recordLoginEvent, for the
   * two callback failures where an identity WAS established
   * (the Google-verified email). Failure-isolated. */
  private async recordFailedLogin(userId: string | null, email: string, ip?: string, userAgent?: string) {
    try {
      await (this.prisma as any).loginEvent?.create?.({
        data: {
          userId: userId ?? null,
          email,
          success: false,
          method: "google",
          ip: ip ?? null,
          userAgent: userAgent ? String(userAgent).slice(0, 200) : null,
        },
      });
    } catch { /* a login-event failure never blocks the flow */ }
  }

  /** Step 1: mint the state and build the authorize URL.
   * Refuses honestly (503) when SSO is not configured/enabled —
   * the login page hides the button via config(), so reaching
   * here disabled means a stale page or a direct hit. */
  async start(_ip?: string): Promise<{ url: string }> {
    const cfg = await this.loadConfig();
    if (!cfg || cfg.enabled !== true) {
      throw serviceUnavailable("auth.googleSsoNotEnabled");
    }
    const raw = randomBytes(32).toString("base64url");
    await this.t().create({
      data: { kind: "state", tokenHash: sha256Hex(raw), expiresAt: new Date(Date.now() + STATE_TTL_MS) },
    });
    const params = new URLSearchParams({
      client_id: cfg.clientId,
      redirect_uri: redirectUri(),
      response_type: "code",
      scope: "openid email profile",
      state: raw,
      access_type: "online",
      prompt: "select_account",
    });
    return { url: `${AUTHORIZE_URL}?${params.toString()}` };
  }

  /** Step 2: Google's redirect target. ALWAYS resolves to a
   * web URL (the controller issues it as a 302): either the
   * handoff fragment on success or /login?googleError=<code>. */
  async callback(codeRaw: string, stateRaw: string, ip?: string, userAgent?: string): Promise<string> {
    const fail = (code: string) => `${webBase()}/login?googleError=${code}`;
    const cfg = await this.loadConfig();
    if (!cfg || cfg.enabled !== true) return fail("not_configured");

    const state = String(stateRaw ?? "").trim();
    if (!state) return fail("state_invalid");
    const stateRow = await this.t()?.findFirst?.({ where: { tokenHash: sha256Hex(state), kind: "state" } }).catch(() => null);
    if (!stateRow || stateRow.usedAt || new Date(stateRow.expiresAt).getTime() <= Date.now()) {
      return fail("state_invalid");
    }
    // Single-use: the state dies NOW, even if the exchange or
    // the account checks below fail — a callback URL can never
    // be replayed.
    try {
      await this.t().update({ where: { id: stateRow.id }, data: { usedAt: new Date() } });
    } catch {
      return fail("state_invalid");
    }

    const code = String(codeRaw ?? "").trim();
    if (!code) return fail("exchange_failed");
    let accessToken: string | undefined;
    try {
      const res = await this.fetchFn(TOKEN_URL, {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({
          code, client_id: cfg.clientId, client_secret: cfg.clientSecret,
          redirect_uri: redirectUri(), grant_type: "authorization_code",
        }),
      });
      const json: any = await res.json().catch(() => null);
      const status = typeof res?.status === "number" ? res.status : (res?.ok === false ? 0 : 200);
      if (status < 200 || status >= 300 || !json?.access_token) return fail("exchange_failed");
      accessToken = String(json.access_token);
    } catch {
      return fail("exchange_failed");
    }

    let profile: any = null;
    try {
      const res = await this.fetchFn(USERINFO_URL, {
        method: "GET",
        headers: { Authorization: `Bearer ${accessToken}` },
      });
      profile = await res.json().catch(() => null);
      const status = typeof res?.status === "number" ? res.status : (res?.ok === false ? 0 : 200);
      if (status < 200 || status >= 300 || !profile) return fail("exchange_failed");
    } catch {
      return fail("exchange_failed");
    }
    // Only a Google-VERIFIED email may sign in — an unverified
    // (or missing) email proves nothing about ownership.
    const email = typeof profile.email === "string" ? profile.email.toLowerCase().trim() : "";
    if (profile.email_verified !== true || !email) return fail("email_unverified");

    const user = await (this.prisma as any).user.findUnique({ where: { email } }).catch(() => null);
    if (!user) {
      // NO auto-provisioning: SSO signs in existing accounts
      // only. The failed attempt is recorded like a password
      // failure for an unknown email.
      await this.recordFailedLogin(null, email, ip, userAgent);
      return fail("account_not_found");
    }
    if (user.status !== "ACTIVE") {
      await this.recordFailedLogin(user.id, email, ip, userAgent);
      return fail("account_inactive");
    }

    const raw = randomBytes(32).toString("base64url");
    await this.t().create({
      data: {
        kind: "handoff", tokenHash: sha256Hex(raw), userId: user.id,
        expiresAt: new Date(Date.now() + HANDOFF_TTL_MS),
      },
    });
    // Fragment, never a query param: the raw handoff token is
    // not sent to any server and stays out of logs/referrers.
    return `${webBase()}/login/google#handoff=${raw}`;
  }

  /** Step 3: the web page trades the handoff token for the
   * login result (session token, or a TOTP challenge when the
   * account has TOTP — SSO never bypasses it). Single-use. */
  async exchange(handoffToken: string, ip?: string, userAgent?: string) {
    const invalid = () => unauthorized("auth.googleSsoLinkInvalid");
    const token = String(handoffToken ?? "").trim();
    if (!token) throw invalid();
    const row = await this.t()?.findFirst?.({ where: { tokenHash: sha256Hex(token), kind: "handoff" } }).catch(() => null);
    if (!row || row.usedAt || new Date(row.expiresAt).getTime() <= Date.now() || !row.userId) {
      throw invalid();
    }
    try {
      await this.t().update({ where: { id: row.id }, data: { usedAt: new Date() } });
    } catch {
      throw invalid();
    }
    if (!this.auth) throw serviceUnavailable("auth.googleSsoUnavailableNow");
    return this.auth.completeGoogleLogin(row.userId, ip, userAgent);
  }
}
