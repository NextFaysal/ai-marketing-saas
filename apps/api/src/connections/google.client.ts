/**
 * CC20 — Google APIs client for the Connect Center Google pack
 * (GA4 / Merchant Center / Business Profile).
 *
 * The OPERATOR's one Google app (platform-config googleApp, the
 * same app as YouTube's) is used for all three; tenants OAuth
 * their own Google accounts into it and pick ONE property /
 * merchant account / business location. This class only talks
 * HTTP — state, persistence and token refresh live in
 * GoogleConnectService; the Doctor reuses the list methods for
 * its live check.
 *
 * API-surface decisions (documented, not accidental):
 * - GA4 discovery: Analytics Admin API accountSummaries — the
 *   one call that lists every property the user can access.
 * - Merchant discovery: Merchant API v1 accounts list — NOT the
 *   legacy Content API for Shopping, which Google retires
 *   (EC14 spike §3: new programmatic integration must be
 *   Merchant API v1).
 * - Business Profile discovery: account management accounts,
 *   then Business Information locations per account.
 *
 * Error discipline: Google's own error message propagates
 * VERBATIM ({ error: { message } } on API endpoints,
 * { error, error_description } on the token endpoint).
 */

import type { GoogleAppCreds, GoogleTokenSet } from "../social/youtube.client";

export type { GoogleAppCreds, GoogleTokenSet };

export interface GoogleAccountOption {
  /** The id stored as the Integration's externalAccountId:
   * GA4 property numeric id, Merchant account id, or the full
   * Business Profile location resource ("locations/<id>"). */
  id: string;
  name: string;
  detail?: string | null;
}

export type GoogleConnectKind = "ga4" | "merchant" | "business";

const TOKEN_URL = "https://oauth2.googleapis.com/token";
const GA4_SUMMARIES_URL = "https://analyticsadmin.googleapis.com/v1beta/accountSummaries";
const MERCHANT_ACCOUNTS_URL = "https://merchantapi.googleapis.com/accounts/v1/accounts";
const GBP_ACCOUNTS_URL = "https://mybusinessaccountmanagement.googleapis.com/v1/accounts";
const GBP_LOCATIONS_BASE = "https://mybusinessbusinessinformation.googleapis.com/v1";
const MAX_PAGES = 5;
const MAX_GBP_ACCOUNTS = 20;

export class GoogleClient {
  private readonly fetchFn: typeof fetch;

  constructor(fetchFn: typeof fetch = fetch) {
    this.fetchFn = fetchFn;
  }

  /** Throw Google's verbatim error for a failed response. */
  private async fail(res: Response, context: string): Promise<never> {
    const body: any = await res.json().catch(() => null);
    const message = body?.error?.message ?? body?.error_description ?? body?.error ?? `${context} failed (HTTP ${res.status})`;
    const err = new Error(String(message)) as Error & { status?: number };
    err.status = res.status;
    throw err;
  }

  private tokenSet(body: any): GoogleTokenSet {
    return {
      accessToken: String(body.access_token ?? ""),
      refreshToken: body.refresh_token ? String(body.refresh_token) : undefined,
      expiresAt: Date.now() + Number(body.expires_in ?? 0) * 1000,
      scope: body.scope ? String(body.scope) : undefined,
    };
  }

  async exchangeCode(creds: GoogleAppCreds, code: string): Promise<GoogleTokenSet> {
    const res = await this.fetchFn(TOKEN_URL, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        code,
        client_id: creds.clientId,
        client_secret: creds.clientSecret,
        redirect_uri: creds.redirectUri,
        grant_type: "authorization_code",
      }).toString(),
    });
    if (!res.ok) await this.fail(res, "Google token exchange");
    const body: any = await res.json().catch(() => null);
    if (!body?.access_token) throw new Error("Google token exchange returned no access token");
    return this.tokenSet(body);
  }

  /** Refresh grant — Google does NOT rotate the refresh token. */
  async refreshAccessToken(creds: GoogleAppCreds, refreshToken: string): Promise<GoogleTokenSet> {
    const res = await this.fetchFn(TOKEN_URL, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        refresh_token: refreshToken,
        client_id: creds.clientId,
        client_secret: creds.clientSecret,
        grant_type: "refresh_token",
      }).toString(),
    });
    if (!res.ok) await this.fail(res, "Google token refresh");
    const body: any = await res.json().catch(() => null);
    if (!body?.access_token) throw new Error("Google token refresh returned no access token");
    return this.tokenSet(body);
  }

  private async getJson(url: string, accessToken: string, context: string): Promise<any> {
    const res = await this.fetchFn(url, { headers: { Authorization: `Bearer ${accessToken}` } });
    if (!res.ok) await this.fail(res, context);
    return res.json().catch(() => null);
  }

  /** GA4: every property under every account summary the token
   * can see. id = the property's numeric id. */
  async listGa4Properties(accessToken: string): Promise<GoogleAccountOption[]> {
    const out: GoogleAccountOption[] = [];
    let pageToken: string | undefined;
    for (let page = 0; page < MAX_PAGES; page++) {
      const qs = new URLSearchParams({ pageSize: "200" });
      if (pageToken) qs.set("pageToken", pageToken);
      const body: any = await this.getJson(`${GA4_SUMMARIES_URL}?${qs.toString()}`, accessToken, "GA4 account summaries");
      for (const summary of body?.accountSummaries ?? []) {
        for (const prop of summary?.propertySummaries ?? []) {
          const resource = String(prop?.property ?? "");
          const id = resource.split("/").pop() ?? "";
          if (!id) continue;
          out.push({
            id,
            name: String(prop?.displayName ?? id),
            detail: summary?.displayName ? String(summary.displayName) : null,
          });
        }
      }
      pageToken = body?.nextPageToken ? String(body.nextPageToken) : undefined;
      if (!pageToken) break;
    }
    return out;
  }

  /** Merchant Center accounts (Merchant API v1). */
  async listMerchantAccounts(accessToken: string): Promise<GoogleAccountOption[]> {
    const out: GoogleAccountOption[] = [];
    let pageToken: string | undefined;
    for (let page = 0; page < MAX_PAGES; page++) {
      const qs = new URLSearchParams({ pageSize: "250" });
      if (pageToken) qs.set("pageToken", pageToken);
      const body: any = await this.getJson(`${MERCHANT_ACCOUNTS_URL}?${qs.toString()}`, accessToken, "Merchant accounts");
      for (const account of body?.accounts ?? []) {
        const resource = String(account?.name ?? "");
        const id = account?.accountId != null ? String(account.accountId) : (resource.split("/").pop() ?? "");
        if (!id) continue;
        out.push({
          id,
          name: String(account?.accountName ?? account?.displayName ?? id),
          detail: resource || null,
        });
      }
      pageToken = body?.nextPageToken ? String(body.nextPageToken) : undefined;
      if (!pageToken) break;
    }
    return out;
  }

  /** Business Profile locations across the user's accounts,
   * flattened to one pick list. id = the location resource
   * ("locations/<id>") — the handle every later GBP call needs. */
  async listBusinessLocations(accessToken: string): Promise<GoogleAccountOption[]> {
    const accountsBody: any = await this.getJson(GBP_ACCOUNTS_URL, accessToken, "Business Profile accounts");
    const accounts: any[] = Array.isArray(accountsBody?.accounts) ? accountsBody.accounts.slice(0, MAX_GBP_ACCOUNTS) : [];
    const out: GoogleAccountOption[] = [];
    for (const account of accounts) {
      const accountName = String(account?.name ?? "");
      if (!accountName) continue;
      let pageToken: string | undefined;
      for (let page = 0; page < 3; page++) {
        const qs = new URLSearchParams({ readMask: "name,title", pageSize: "100" });
        if (pageToken) qs.set("pageToken", pageToken);
        const body: any = await this.getJson(`${GBP_LOCATIONS_BASE}/${accountName}/locations?${qs.toString()}`, accessToken, "Business Profile locations");
        for (const loc of body?.locations ?? []) {
          const resource = String(loc?.name ?? "");
          if (!resource) continue;
          out.push({
            id: resource,
            name: String(loc?.title ?? resource),
            detail: account?.accountName ? String(account.accountName) : accountName,
          });
        }
        pageToken = body?.nextPageToken ? String(body.nextPageToken) : undefined;
        if (!pageToken) break;
      }
    }
    return out;
  }

  listForKind(kind: GoogleConnectKind, accessToken: string): Promise<GoogleAccountOption[]> {
    if (kind === "ga4") return this.listGa4Properties(accessToken);
    if (kind === "merchant") return this.listMerchantAccounts(accessToken);
    return this.listBusinessLocations(accessToken);
  }
}
