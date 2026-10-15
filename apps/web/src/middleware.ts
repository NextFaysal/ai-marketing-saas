import { NextResponse, type NextRequest } from "next/server";
// Relative import on purpose: the web vitest setup has no "@/"
// alias resolution, and the routing table in middleware.test.ts
// must be able to import this module (every other testable module
// in src/ is likewise imported relatively from its tests).
import {
  canonicalShopRedirectUrl,
  classifyHost,
  isPanelPath,
  normalizeHost,
  panelAppRedirectUrl,
  rewritePathForShop,
  shouldSkipHost,
} from "./lib/custom-domain";

/**
 * EC8 custom-domain + TD4/TD5 tenant-domain middleware.
 *
 * Host classification (TD4, lib/custom-domain classifyHost) decides
 * the route before anything else:
 * - platform hosts (apex + the platform's own service names) and
 *   unknown hosts pass through untouched.
 * - {slug}.qosprey.com is a tenant shop subdomain: the slug comes
 *   from the host alone (TD1 rules), NO database lookup. The shop
 *   lives at the subdomain root via the same /shop/<slug> rewrite
 *   the custom-domain flow uses. If no organization owns the slug,
 *   the middleware still rewrites — the /shop/<slug> page itself
 *   answers with its notFound() 404; the middleware never invents
 *   a shop that is not there.
 * - Any other host is only a custom-domain CANDIDATE: it becomes a
 *   shop host solely when the API's by-domain endpoint confirms it
 *   (VERIFIED merchant domains only). Every lookup failure is
 *   fail-open (NextResponse.next()) — a broken lookup must never
 *   break the main site.
 *
 * TD5 surface separation: on a shop host (tenant subdomain or
 * VERIFIED custom domain) the staff panel paths — /dashboard,
 * /login, /register, /onboarding, /accept-invite and subpaths —
 * never serve. They 308-redirect to the same path + query string
 * on the platform app host (https://app.qosprey.com), so invite
 * links with tokens survive the hop. The redirect is decided
 * BEFORE any shop rewrite. On platform hosts those paths serve
 * exactly as before.
 *
 * TD7 canonical redirect: a /shop/<slug> path arriving on a
 * platform host 301-redirects to the tenant subdomain (the shop's
 * canonical address). Shop hosts never take this branch — their
 * /shop/ paths are the middleware's own rewrite target.
 */

const cache = new Map<string, { slug: string | null; expires: number }>();
const CACHE_TTL_MS = 60_000;

function apiBase(): string {
  if (process.env.API_INTERNAL_URL) return process.env.API_INTERNAL_URL;
  const pub = process.env.NEXT_PUBLIC_API_URL;
  if (pub && /^https?:\/\//i.test(pub)) return pub.replace(/\/+$/, "");
  return "http://localhost:4000";
}

async function lookupSlug(host: string): Promise<string | null> {
  const now = Date.now();
  const hit = cache.get(host);
  if (hit && hit.expires > now) return hit.slug;
  let slug: string | null = null;
  try {
    const signal =
      typeof AbortSignal !== "undefined" && "timeout" in AbortSignal
        ? AbortSignal.timeout(3000)
        : undefined;
    const res = await fetch(`${apiBase()}/public/shop/by-domain/${encodeURIComponent(host)}`, {
      signal,
      headers: { accept: "application/json" },
    });
    if (res.ok) {
      const body = (await res.json().catch(() => null)) as { organizationSlug?: string } | null;
      slug = body?.organizationSlug ? String(body.organizationSlug) : null;
    }
  } catch {
    slug = null; // fail-open
  }
  cache.set(host, { slug, expires: now + CACHE_TTL_MS });
  return slug;
}

export async function middleware(req: NextRequest) {
  const { pathname } = req.nextUrl;

  const host = normalizeHost(req.headers.get("host") ?? req.nextUrl.host);
  if (shouldSkipHost(host)) return NextResponse.next();

  // TD7: the legacy /shop/<slug> path on a PLATFORM host 301s to
  // the shop's canonical tenant subdomain (path after the slug +
  // query preserved). Decided before the internals skip below,
  // which would otherwise swallow every /shop/ path; the helper
  // itself refuses shop hosts, so the middleware's own rewrite
  // target can never loop into this redirect.
  const canonical = canonicalShopRedirectUrl(host, pathname, req.nextUrl.search);
  if (canonical) return NextResponse.redirect(canonical, 301);

  // Never look up (or rewrite) platform internals / assets.
  if (
    pathname.startsWith("/shop/") ||
    pathname === "/shop" ||
    pathname.startsWith("/backend") ||
    pathname.startsWith("/_next") ||
    pathname === "/favicon.ico"
  ) {
    return NextResponse.next();
  }

  const cls = classifyHost(host);
  if (cls.kind === "platform" || cls.kind === "unknown") return NextResponse.next();

  let slug: string | null = null;
  if (cls.kind === "shop-subdomain") {
    slug = cls.slug; // deterministic from the host — no DB lookup
  } else {
    // shop-custom-candidate: only a VERIFIED domain is a shop host.
    slug = await lookupSlug(host);
    if (!slug) return NextResponse.next();
  }

  // TD5: panel paths on a shop host redirect to the platform app
  // host before any shop rewrite; path + query string preserved.
  if (isPanelPath(pathname)) {
    return NextResponse.redirect(panelAppRedirectUrl(pathname, req.nextUrl.search), 308);
  }

  const rewritten = rewritePathForShop(pathname, slug);
  if (!rewritten || rewritten === pathname) return NextResponse.next();

  const url = req.nextUrl.clone();
  url.pathname = rewritten;
  return NextResponse.rewrite(url);
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico|backend).*)"],
};
