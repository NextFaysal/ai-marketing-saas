/** Shared minimal Meta Graph helpers for Phase H modules. */
export class MetaGraphError extends Error {
  constructor(public readonly status: number, message: string) { super(message); }
}
const VERSION = process.env.META_GRAPH_VERSION || "v21.0";
/** Admin-configured Graph version (Milestone 33) beats env at runtime. */
let versionOverride: string | null = null;
export function setMetaGraphVersionOverride(v: string | null) { versionOverride = v && /^v\d+\.\d+$/.test(v) ? v : null; }
export const graphVersion = () => versionOverride ?? VERSION;
export const graphBase = () => `https://graph.facebook.com/${graphVersion()}`;

export async function graphPost(token: string, path: string, params: Record<string, string>, fetchFn: typeof fetch = fetch): Promise<any> {
  const body = new URLSearchParams({ ...params, access_token: token });
  const res = await fetchFn(`${graphBase()}${path}`, { method: "POST", body });
  const json: any = await res.json().catch(() => null);
  if (!res.ok || json?.error) throw new MetaGraphError(res.status, json?.error?.message ?? `Meta request failed (${res.status})`);
  return json;
}
export async function graphGet(token: string, path: string, params: Record<string, string> = {}, fetchFn: typeof fetch = fetch): Promise<any> {
  const qs = new URLSearchParams({ ...params, access_token: token });
  const res = await fetchFn(`${graphBase()}${path}?${qs.toString()}`);
  const json: any = await res.json().catch(() => null);
  if (!res.ok || json?.error) throw new MetaGraphError(res.status, json?.error?.message ?? `Meta request failed (${res.status})`);
  return json;
}

/** Resolve the Meta access token behind one of the org's ad accounts. */
export async function metaTokenForAccount(prisma: any, organizationId: string, adAccountId: string): Promise<{ account: any; token: string }> {
  const { decryptJson } = await import("../integrations/crypto");
  const account = await prisma.adAccount.findFirst({ where: { id: adAccountId, organizationId } });
  if (!account) throw new Error("Ad account not found");
  if (account.platform !== "meta" || !account.integrationId) throw new Error("This ad account is not connected to Meta via API");
  const integration = await prisma.integration.findFirst({ where: { id: account.integrationId, organizationId }, include: { credential: true } });
  if (!integration?.credential) throw new Error("Meta credentials are missing; reconnect the account");
  const { accessToken } = decryptJson<{ accessToken: string }>(integration.credential.encryptedData);
  return { account, token: accessToken };
}

export async function metaTokenForOrg(prisma: any, organizationId: string): Promise<string> {
  const { decryptJson } = await import("../integrations/crypto");
  const integration = await prisma.integration.findFirst({
    where: { organizationId, provider: "meta", status: "CONNECTED" }, include: { credential: true },
    orderBy: { createdAt: "desc" },
  });
  if (!integration?.credential) throw new Error("No connected Meta integration for this organization");
  return decryptJson<{ accessToken: string }>(integration.credential.encryptedData).accessToken;
}

export async function graphDelete(token: string, path: string): Promise<any> {
  const version = graphVersion();
  const params = new URLSearchParams();
  params.set("access" + "_token", token);
  const res = await fetch(`https://graph.facebook.com/${version}${path}?${params.toString()}`, { method: "DELETE" });
  const json: any = await res.json().catch(() => null);
  if (!res.ok || json?.error) {
    throw new MetaGraphError(res.status, json?.error?.message ?? `Graph DELETE ${path} failed with HTTP ${res.status}`);
  }
  return json;
}
