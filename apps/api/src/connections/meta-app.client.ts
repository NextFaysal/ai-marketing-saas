import { graphVersion } from "../common/meta-graph";

/**
 * CC3 — Meta app credential verification for a tenant's OWN Meta
 * app. This is the verify-before-save check: Meta itself confirms
 * the (appId, appSecret) pair before anything is stored.
 *
 * The check is the standard app-access-token lookup: the app
 * access token is literally `appId|appSecret`, and
 * GET /{appId} with it returns the app's own node only when BOTH
 * halves are correct. A wrong secret yields Meta's OAuthException;
 * that message propagates VERBATIM (MetaMessagingClient pattern) —
 * nothing here softens or invents an outcome.
 *
 * Injectable fetch (the MetaMessagingClient / TikTokClient
 * pattern) so specs stub the boundary; the production path is the
 * real Graph API call.
 */
export class MetaAppClient {
  constructor(private readonly fetchFn: typeof fetch = fetch) {}

  async verifyApp(appId: string, appSecret: string): Promise<{ id: string; name?: string }> {
    const appAccessToken = `${appId}|${appSecret}`;
    const url = `https://graph.facebook.com/${graphVersion()}/${encodeURIComponent(appId)}?access_token=${encodeURIComponent(appAccessToken)}`;
    const res = await this.fetchFn(url);
    const body: any = await res.json().catch(() => ({}));
    if (!res.ok || body?.error) {
      throw new Error(body?.error?.message ?? `Meta app verification failed (${res.status})`);
    }
    if (!body?.id || String(body.id) !== String(appId)) {
      throw new Error("Meta এই App ID-টি নিশ্চিত করেনি — App ID ও App Secret আবার যাচাই করে চেষ্টা করুন।");
    }
    return { id: String(body.id), name: body.name ? String(body.name) : undefined };
  }
}
