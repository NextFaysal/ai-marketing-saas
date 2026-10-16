import { NextResponse, type NextRequest } from "next/server";
import { normalizeHost, rewritePathForShop, shouldSkipHost } from "@/lib/custom-domain";

/**
 * EC8 custom-domain middleware.
 *
 * When a request arrives on a merchant's VERIFIED custom domain,
 * shop-shaped paths are rewritten onto /shop/<orgSlug> so the
 * shop lives at the domain root. The platform's own normal host
 * is unaffected in practice: /public/shop/by-domain only returns
 * verified merchant domains, so a normal host simply misses the
 * lookup and the request continues untouched. Every failure is
 * fail-open (NextResponse.next()) — a broken lookup must never
 * break the main site.
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

  // Never look up (or rewrite) platform internals / assets.
  if (
    pathname.startsWith("/shop/") ||
    pathname === "/shop" ||
    pathname.startsWith("/backend") ||
    pathname.startsWith("/_next") ||
    pathname === "/favicon.ico"
  ) {
    // ED7: view-only theme preview. ?themePreview=v2 on a shop URL
    // is forwarded as a request header the shop layout reads to
    // render the v2 theme for THIS request only — the stored
    // setting never changes, and anyone with the link can view it
    // (the storefront is public; there is nothing secret to gate).
    if (req.nextUrl.searchParams.get("themePreview") === "v2") {
      const headers = new Headers(req.headers);
      headers.set("x-shop-theme-preview", "v2");
      return NextResponse.next({ request: { headers } });
    }
    return NextResponse.next();
  }

  const host = normalizeHost(req.headers.get("host") ?? req.nextUrl.host);
  if (shouldSkipHost(host)) return NextResponse.next();

  const slug = await lookupSlug(host);
  if (!slug) return NextResponse.next();

  const rewritten = rewritePathForShop(pathname, slug);
  if (!rewritten || rewritten === pathname) return NextResponse.next();

  const url = req.nextUrl.clone();
  url.pathname = rewritten;
  return NextResponse.rewrite(url);
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico|backend).*)"],
};
