/**
 * AB8 (AX23) — merchant custom CSS/JS host rule.
 *
 * RATIONALE: the cookie audit found NO auth cookies exist —
 * staff auth is a JWT in localStorage on the APP origin only.
 * Shop hosts are separate origins and can never read it, so
 * merchant JS there cannot reach staff credentials. The one
 * dangerous case is a shop rendered ON the app origin itself
 * (same host — e.g. app.qosprey.com/shop/<slug>), where injected
 * JS WOULD share the origin with the dashboard's localStorage.
 * Hence: custom JS is refused on the primary app host(s) and
 * allowed on tenant subdomains + verified custom domains.
 * Custom CSS carries no script risk and is not host-gated.
 */

export const DEFAULT_PRIMARY_HOSTS: string[] = ["app.qosprey.com", "admin.qosprey.com"];

/** Lowercase + strip any port (and brackets for IPv6 literals). */
export function normalizeHost(host: string): string {
  let h = host.trim().toLowerCase();
  if (h.startsWith("[")) {
    const end = h.indexOf("]");
    return end >= 0 ? h.slice(1, end) : h;
  }
  const colon = h.indexOf(":");
  if (colon >= 0) h = h.slice(0, colon);
  return h.replace(/\.$/, "");
}

/**
 * True when merchant custom JS may run on `host`: the host must
 * be known (null/empty refused) and must not be — or sit under —
 * any primary app host. The endsWith check uses a dot boundary
 * so a tenant subdomain like "myapp.qosprey.com" is NOT mistaken
 * for the primary host "app.qosprey.com".
 */
export function customJsAllowedOnHost(host: string | null, primaryHosts: string[]): boolean {
  if (!host || !host.trim()) return false;
  const h = normalizeHost(host);
  if (!h) return false;
  for (const primary of primaryHosts) {
    if (!primary || !primary.trim()) continue;
    const p = normalizeHost(primary);
    if (!p) continue;
    if (h === p || h.endsWith(`.${p}`)) return false;
  }
  return true;
}

/** Host (no port) out of a bare host, host:port, or full URL. */
function hostOf(value: string): string | null {
  const v = value.trim();
  if (!v) return null;
  try {
    if (v.includes("://")) return normalizeHost(new URL(v).hostname) || null;
  } catch {
    return null;
  }
  return normalizeHost(v) || null;
}

/**
 * The primary app hosts for THIS deployment: the built-in
 * defaults, plus NEXT_PUBLIC_APP_HOST when set, plus the host
 * of NEXT_PUBLIC_WEB_URL when set (the env the web app actually
 * uses for its own public origin — see lib/storefront-sitemap).
 * NEXT_PUBLIC_APP_HOST alone is not reliable across deploys, so
 * the defaults are always included.
 */
export function primaryHostsFromEnv(
  env: Record<string, string | undefined> = process.env,
): string[] {
  const hosts = new Set<string>(DEFAULT_PRIMARY_HOSTS);
  const appHost = env.NEXT_PUBLIC_APP_HOST ? hostOf(env.NEXT_PUBLIC_APP_HOST) : null;
  if (appHost) hosts.add(appHost);
  const webUrl = env.NEXT_PUBLIC_WEB_URL ? hostOf(env.NEXT_PUBLIC_WEB_URL) : null;
  if (webUrl) hosts.add(webUrl);
  return [...hosts];
}
