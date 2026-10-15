/**
 * EC2: Shopify Dev Dashboard client-credentials grant.
 * POST https://{shop}/admin/oauth/access_token with
 * grant_type=client_credentials returns a (typically 24h) access
 * token for the app installed on that shop. No refresh token —
 * when it expires we simply exchange again.
 */
type FetchFn = typeof fetch;

export function normalizeShopifyHost(shopHostOrUrl: string): string {
  let host = String(shopHostOrUrl ?? "").trim();
  host = host.replace(/^https?:\/\//i, "");
  host = host.replace(/\/+$/, "");
  // Strip any path after the host.
  const slash = host.indexOf("/");
  if (slash >= 0) host = host.slice(0, slash);
  return host;
}

export async function exchangeShopifyClientCredentials(
  shopHostOrUrl: string,
  clientId: string,
  clientSecret: string,
  fetchFn: FetchFn = fetch,
): Promise<{ accessToken: string; expiresIn: number | null; scope: string | null }> {
  const host = normalizeShopifyHost(shopHostOrUrl);
  if (!host) throw new Error("Shopify shop host is empty");
  const url = `https://${host}/admin/oauth/access_token`;
  const body = new URLSearchParams({
    grant_type: "client_credentials",
    client_id: clientId,
    client_secret: clientSecret,
  });
  const res = await fetchFn(url, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: body.toString(),
  });
  const text = await (res as any).text?.().catch(() => "");
  let parsed: any = null;
  if (text) {
    try { parsed = JSON.parse(text); } catch { parsed = null; }
  }
  // Some fetch stubs only implement .json(); fall back to it when no text.
  if (parsed === null && typeof (res as any).json === "function" && !text) {
    parsed = await (res as any).json().catch(() => null);
  }
  const ok = typeof (res as any).ok === "boolean" ? (res as any).ok : (res as any).status >= 200 && (res as any).status < 300;
  if (!ok) {
    const excerpt = (text || (parsed ? JSON.stringify(parsed) : "")).slice(0, 300);
    throw new Error(`Shopify client credentials exchange failed (${(res as any).status}): ${excerpt}`);
  }
  const accessToken = parsed?.access_token;
  if (!accessToken) {
    const excerpt = (text || (parsed ? JSON.stringify(parsed) : "")).slice(0, 300);
    throw new Error(`Shopify client credentials exchange failed (${(res as any).status}): missing access_token${excerpt ? `: ${excerpt}` : ""}`);
  }
  const expiresRaw = parsed?.expires_in;
  const expiresIn = expiresRaw === undefined || expiresRaw === null || expiresRaw === "" ? null : Number(expiresRaw);
  return {
    accessToken: String(accessToken),
    expiresIn: Number.isFinite(expiresIn as number) ? (expiresIn as number) : null,
    scope: parsed?.scope ? String(parsed.scope) : null,
  };
}
