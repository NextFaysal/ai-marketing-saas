/**
 * CC20 — LinkedIn client (platform app only).
 *
 * The OPERATOR's one LinkedIn app (platform-config
 * linkedinAppConfig) is used for Page connect + UGC posting.
 * There is NO tenant-own-app path: CC3's TenantAppConfig has no
 * LinkedIn section, and the UI says so.
 *
 * Flow notes (LinkedIn's documented shapes):
 * - Token exchange/refresh: POST /oauth/v2/accessToken,
 *   form-encoded. A refresh token is only issued when the app
 *   has the refresh-token product enabled — the OAuth flow
 *   refuses to persist a connection without one (YouTube SP9
 *   precedent).
 * - Admin'd Pages: GET /v2/organizationAcls?q=roleAssignee&
 *   role=ADMINISTRATOR returns the organization URNs the
 *   signed-in member administrates; each Page's name comes from
 *   GET /v2/organizations/{id}.
 * - Posting: POST /v2/ugcPosts with the organization as author.
 *   Live posting requires the app to hold LinkedIn's Community
 *   Management API approval — that gate is LinkedIn's, and this
 *   client neither detects nor claims it.
 *
 * Errors propagate LinkedIn's own `message` /
 * `error_description` verbatim.
 */

export interface LinkedinAppCreds {
  clientId: string;
  clientSecret: string;
  redirectUri: string;
}

export interface LinkedinTokenSet {
  accessToken: string;
  refreshToken?: string;
  expiresAt: number;
  scope?: string;
}

export interface LinkedinOrganization {
  /** Bare numeric organization id (the URN's tail). */
  id: string;
  name: string;
}

const TOKEN_URL = "https://www.linkedin.com/oauth/v2/accessToken";
const ORG_ACLS_URL = "https://www.linkedin.com/v2/organizationAcls";
const ORGANIZATIONS_URL = "https://www.linkedin.com/v2/organizations";
const UGC_POSTS_URL = "https://www.linkedin.com/v2/ugcPosts";
const MAX_ORGS = 25;

export class LinkedInClient {
  private readonly fetchFn: typeof fetch;

  constructor(fetchFn: typeof fetch = fetch) {
    this.fetchFn = fetchFn;
  }

  private async fail(res: Response, context: string): Promise<never> {
    const body: any = await res.json().catch(() => null);
    const message = body?.message ?? body?.error_description ?? body?.error ?? `${context} failed (HTTP ${res.status})`;
    const err = new Error(String(message)) as Error & { status?: number };
    err.status = res.status;
    throw err;
  }

  private async tokenRequest(form: URLSearchParams, context: string): Promise<LinkedinTokenSet> {
    const res = await this.fetchFn(TOKEN_URL, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: form.toString(),
    });
    if (!res.ok) await this.fail(res, context);
    const body: any = await res.json().catch(() => null);
    if (!body?.access_token) throw new Error(`${context} returned no access token`);
    return {
      accessToken: String(body.access_token),
      refreshToken: body.refresh_token ? String(body.refresh_token) : undefined,
      expiresAt: Date.now() + Number(body.expires_in ?? 0) * 1000,
      scope: body.scope ? String(body.scope) : undefined,
    };
  }

  async exchangeCode(creds: LinkedinAppCreds, code: string): Promise<LinkedinTokenSet> {
    return this.tokenRequest(new URLSearchParams({
      grant_type: "authorization_code",
      code,
      client_id: creds.clientId,
      client_secret: creds.clientSecret,
      redirect_uri: creds.redirectUri,
    }), "LinkedIn token exchange");
  }

  async refreshAccessToken(creds: LinkedinAppCreds, refreshToken: string): Promise<LinkedinTokenSet> {
    return this.tokenRequest(new URLSearchParams({
      grant_type: "refresh_token",
      refresh_token: refreshToken,
      client_id: creds.clientId,
      client_secret: creds.clientSecret,
    }), "LinkedIn token refresh");
  }

  private async getJson(url: string, accessToken: string, context: string): Promise<any> {
    const res = await this.fetchFn(url, {
      headers: { Authorization: `Bearer ${accessToken}`, "X-Restli-Protocol-Version": "2.0.0" },
    });
    if (!res.ok) await this.fail(res, context);
    return res.json().catch(() => null);
  }

  /** The Pages (organizations) this token's member administrates.
   * One row per ACL element; a Page whose detail call fails keeps
   * its id with the URN as the name — never dropped silently. */
  async listAdminOrganizations(accessToken: string): Promise<LinkedinOrganization[]> {
    const qs = new URLSearchParams({ q: "roleAssignee", role: "ADMINISTRATOR", projection: "(elements*(organization))" });
    const body: any = await this.getJson(`${ORG_ACLS_URL}?${qs.toString()}`, accessToken, "LinkedIn organizations");
    const ids: string[] = [];
    for (const el of body?.elements ?? []) {
      const urn = String(el?.organization ?? "");
      const id = urn.split(":").pop() ?? "";
      if (id && !ids.includes(id)) ids.push(id);
    }
    const out: LinkedinOrganization[] = [];
    for (const id of ids.slice(0, MAX_ORGS)) {
      let name = `urn:li:organization:${id}`;
      try {
        const org: any = await this.getJson(`${ORGANIZATIONS_URL}/${encodeURIComponent(id)}`, accessToken, "LinkedIn organization");
        if (org?.localizedName) name = String(org.localizedName);
      } catch { /* keep the URN name — the id is the real fact */ }
      out.push({ id, name });
    }
    return out;
  }

  /**
   * Publish one UGC post authored by the organization.
   * `shareMediaCategory`: "NONE" (text only) or "ARTICLE" (a
   * public link — LinkedIn fetches the link's own preview; this
   * platform never claims to upload media to LinkedIn: there is
   * no asset-upload step in this client).
   * Returns the post URN EXACTLY as LinkedIn returns it (body
   * `id`, or the X-RestLi-Id header when the body omits it).
   */
  async publishUgcPost(accessToken: string, input: { organizationId: string; text: string; linkUrl?: string | null }): Promise<{ platformPostId: string }> {
    const hasLink = Boolean(input.linkUrl);
    const payload: Record<string, unknown> = {
      author: `urn:li:organization:${input.organizationId}`,
      lifecycleState: "PUBLISHED",
      specificContent: {
        "com.linkedin.ugc.ShareContent": {
          shareCommentary: { text: input.text },
          shareMediaCategory: hasLink ? "ARTICLE" : "NONE",
          ...(hasLink ? { media: [{ status: "READY", originalUrl: input.linkUrl }] } : {}),
        },
      },
      visibility: { "com.linkedin.ugc.MemberNetworkVisibility": "PUBLIC" },
    };
    const res = await this.fetchFn(UGC_POSTS_URL, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${accessToken}`,
        "Content-Type": "application/json",
        "X-Restli-Protocol-Version": "2.0.0",
      },
      body: JSON.stringify(payload),
    });
    if (!res.ok) await this.fail(res, "LinkedIn publish");
    const body: any = await res.json().catch(() => null);
    const id = body?.id ? String(body.id) : (res.headers?.get?.("x-restli-id") ?? "");
    if (!id) throw new Error("LinkedIn publish returned no post id");
    return { platformPostId: id };
  }
}
