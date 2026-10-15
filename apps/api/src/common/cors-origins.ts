import { PLATFORM_APEX_DOMAIN, SLUG_FORMAT_REGEX } from "@repo/contracts";
import { customDomainVariants } from "./custom-domain";

/**
 * TD6 — API CORS origin decision (pure matcher + injectable
 * verified-custom-domain lookup).
 *
 * The API used to allow exactly ONE origin (the WEB_URL env). With
 * tenant shop subdomains ({slug}.qosprey.com) and merchant custom
 * domains serving the shop in browsers, the allowlist has to grow —
 * but with `credentials: true` the answer must stay an exact,
 * per-request origin echo, NEVER "*". The rules, in order:
 *
 * 1. No Origin header → allowed (non-browser clients send none;
 *    CORS simply does not apply).
 * 2. Exact configured origins (WEB_URL, ADMIN_URL) → allowed.
 * 3. https platform origins: the apex itself and exactly ONE label
 *    under it whose label is a syntactically valid slug-format
 *    label (app/admin/api AND every tenant subdomain match this
 *    one rule — reserved names are platform services, slugs are
 *    shops; both are our own hosts). Multi-level names
 *    (a.b.qosprey.com) are NOT covered, and the match is strictly
 *    anchored: evilqosprey.com, notqosprey.com and
 *    qosprey.com.evil.com all fail.
 * 4. http only for localhost / 127.0.0.1 dev origins. An http
 *    platform origin (http://app.qosprey.com) is refused.
 * 5. Anything else must be a VERIFIED merchant custom domain:
 *    Organization.customDomain equals the origin's host OR its
 *    www/apex variant (TD9 shared rule) AND the org's
 *    StorefrontSetting.domainVerifiedAt is set — exactly the
 *    EC8 byDomain condition. Results are cached in memory for 60 s.
 *    A lookup ERROR fails closed for that origin only; it never
 *    throws into the CORS callback (boot/request flow survives).
 */

export interface CorsOriginDeps {
  /** Exact origins from env (WEB_URL, ADMIN_URL); trailing slash tolerated. */
  exactOrigins?: Array<string | undefined | null>;
  /** Returns true only for a VERIFIED custom domain host. */
  lookupVerifiedCustomDomain?: (host: string) => Promise<boolean>;
  /** Cache TTL for custom-domain lookups (default 60_000 ms). */
  cacheTtlMs?: number;
  /** Injectable clock for tests. */
  now?: () => number;
}

const LOCAL_HOSTS = new Set(["localhost", "127.0.0.1", "::1"]);

function parseOrigin(origin: string): URL | null {
  try {
    return new URL(origin);
  } catch {
    return null;
  }
}

/** Rule 3+4 without any I/O: platform/apex/subdomain + local dev. */
export function isPlatformOrLocalOrigin(origin: string): boolean {
  const url = parseOrigin(origin);
  if (!url) return false;
  const host = url.hostname.toLowerCase();
  if (LOCAL_HOSTS.has(host)) {
    // Dev only: http (or https) on a local host, any port.
    return url.protocol === "http:" || url.protocol === "https:";
  }
  if (url.protocol !== "https:") return false;
  if (host === PLATFORM_APEX_DOMAIN) return true;
  const suffix = `.${PLATFORM_APEX_DOMAIN}`;
  if (!host.endsWith(suffix)) return false;
  const label = host.slice(0, host.length - suffix.length);
  if (label.includes(".")) return false; // multi-level: not covered
  return SLUG_FORMAT_REGEX.test(label);
}

export type CorsOriginCallback = (err: Error | null, allow?: boolean) => void;

/**
 * Build the origin function for Nest's enableCors. The returned
 * function never throws and never yields "*": a truthy result makes
 * the cors middleware echo the request's own origin back.
 */
export function createCorsOriginChecker(deps: CorsOriginDeps = {}) {
  const exact = new Set(
    (deps.exactOrigins ?? [])
      .map((o) => String(o ?? "").trim().replace(/\/+$/, ""))
      .filter(Boolean),
  );
  const ttl = deps.cacheTtlMs ?? 60_000;
  const now = deps.now ?? (() => Date.now());
  const cache = new Map<string, { verified: boolean; expires: number }>();

  async function isVerifiedCustomDomain(host: string): Promise<boolean> {
    if (!deps.lookupVerifiedCustomDomain) return false;
    const hit = cache.get(host);
    if (hit && hit.expires > now()) return hit.verified;
    let verified = false;
    try {
      verified = (await deps.lookupVerifiedCustomDomain(host)) === true;
    } catch {
      // Fail closed for THIS origin; do not cache an error as a
      // verdict, so a transient DB hiccup heals on the next request.
      return false;
    }
    cache.set(host, { verified, expires: now() + ttl });
    return verified;
  }

  return async function corsOrigin(origin: string | undefined, callback: CorsOriginCallback): Promise<void> {
    try {
      if (!origin) return callback(null, true); // rule 1
      const candidate = String(origin).trim();
      if (exact.has(candidate)) return callback(null, true); // rule 2
      if (isPlatformOrLocalOrigin(candidate)) return callback(null, true); // rules 3+4
      const url = parseOrigin(candidate);
      if (!url || url.protocol !== "https:") return callback(null, false);
      const host = url.hostname.toLowerCase();
      if (!host || LOCAL_HOSTS.has(host)) return callback(null, false);
      return callback(null, await isVerifiedCustomDomain(host)); // rule 5
    } catch {
      return callback(null, false);
    }
  };
}

/**
 * The production lookup against Prisma: same condition as EC8's
 * public byDomain — an Organization whose customDomain equals the
 * host AND whose StorefrontSetting has domainVerifiedAt set.
 * TD9: the match is www/apex variant-aware (the shared rule in
 * custom-domain.ts) — a shop stored as the apex form also allows
 * its www origin and vice versa, exactly as byDomain resolves.
 * Prisma is passed as a structural seam so tests can fake it and
 * main.ts can hand in the app's own PrismaService (no second pool).
 */
export function prismaVerifiedCustomDomainLookup(prisma: {
  organization: { findFirst: (args: any) => Promise<any> };
  storefrontSetting: { findUnique: (args: any) => Promise<any> };
}): (host: string) => Promise<boolean> {
  return async (host: string) => {
    const org = await prisma.organization.findFirst({
      where: { customDomain: { in: customDomainVariants(host) } },
    });
    if (!org) return false;
    const setting = await prisma.storefrontSetting.findUnique({ where: { organizationId: org.id } });
    return !!setting?.domainVerifiedAt;
  };
}
