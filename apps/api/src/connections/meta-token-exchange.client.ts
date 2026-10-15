import { graphVersion } from "../common/meta-graph";

/**
 * CC21a (Connect Center Next, B10.5) — Meta long-lived-token
 * exchange client.
 *
 * Meta's documented way to extend a long-lived user/page token
 * before it expires: GET /oauth/access_token with
 * grant_type=fb_exchange_token, the app's own credentials, and
 * the CURRENT token. Meta answers with a fresh long-lived token
 * (typically ~60 days) — or refuses, e.g. when the presented
 * token is already dead/revoked, in which case there is nothing
 * to heal and the refusal is the honest outcome.
 *
 * Same shape as the tree's other provider clients (MetaAppClient
 * / MetaMessagingClient): injectable fetch so specs stub the
 * boundary, the provider's own error message propagates
 * VERBATIM, and a response without an access_token is a failure
 * — never a fabricated token. The Graph version is the tree's
 * shared graphVersion() (env/admin override), never a new one
 * invented here.
 */
export interface MetaTokenExchangeResult {
  accessToken: string;
  /** Seconds until the new token expires, exactly as Meta
   * reported it; null when Meta returned no expires_in (callers
   * record "no expiry reported", they do not invent one). */
  expiresIn: number | null;
}

export class MetaTokenExchangeClient {
  constructor(private readonly fetchFn: typeof fetch = fetch) {}

  async exchangeToken(args: { appId: string; appSecret: string; currentToken: string }): Promise<MetaTokenExchangeResult> {
    const qs = new URLSearchParams({
      grant_type: "fb_exchange_token",
      client_id: args.appId,
      client_secret: args.appSecret,
      fb_exchange_token: args.currentToken,
    });
    const url = `https://graph.facebook.com/${graphVersion()}/oauth/access_token?${qs.toString()}`;
    const res = await this.fetchFn(url);
    const body: any = await res.json().catch(() => ({}));
    if (!res.ok || body?.error) {
      throw new Error(body?.error?.message ?? `Meta token exchange failed (${res.status})`);
    }
    if (!body?.access_token || typeof body.access_token !== "string") {
      throw new Error("Meta token exchange returned no access_token");
    }
    const expiresIn = typeof body.expires_in === "number" && Number.isFinite(body.expires_in) && body.expires_in > 0
      ? Math.floor(body.expires_in)
      : null;
    return { accessToken: body.access_token, expiresIn };
  }
}
