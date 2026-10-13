/**
 * EC8 custom-domain routing — pure decision logic (unit-tested).
 *
 * A verified merchant custom domain should serve that merchant's
 * shop at the domain root. The middleware looks the host up via
 * the API's by-domain endpoint (which only returns VERIFIED
 * domains) and rewrites shop-shaped paths onto /shop/<slug>.
 * Everything else — dashboard, auth, platform pages, static
 * assets, the API proxy — must never be rewritten.
 */

/** Top-level app routes that are NOT part of a shop. */
export const NON_SHOP_TOP_SEGMENTS = new Set([
  "dashboard",
  "login",
  "register",
  "admin",
  "accept-invite",
  "onboarding",
  "pricing",
  "offline",
  "reset-password",
  "checkout", // legacy single-product checkout lives at the platform root
  "returns",
  "review",
  "r",
  "t",
  "view-as",
  "shop",
  "api",
  "backend",
  "_next",
  "icons",
  "manifest.webmanifest",
]);

export function normalizeHost(host: string | null | undefined): string {
  let h = String(host ?? "").trim().toLowerCase();
  if (!h) return "";
  if (h.startsWith("[")) {
    // IPv6 literal, e.g. [::1]:3000
    const end = h.indexOf("]");
    return end >= 0 ? h.slice(1, end) : h;
  }
  // Strip the port only for name/IPv4 hosts (a single colon);
  // a bare IPv6 literal like "::1" has several and stays intact.
  if ((h.match(/:/g) ?? []).length === 1) h = h.replace(/:\d+$/, "");
  h = h.replace(/\.$/, ""); // trailing root dot
  return h;
}

export function shouldSkipHost(host: string | null | undefined): boolean {
  const h = normalizeHost(host);
  if (!h) return true;
  if (h === "localhost" || h === "127.0.0.1" || h === "::1") return true;
  if (h.endsWith(".local")) return true;
  return false;
}

/**
 * Map a request path on a merchant domain to the shop path, or
 * null when the path must be left alone.
 */
export function rewritePathForShop(pathname: string, orgSlug: string): string | null {
  const slug = String(orgSlug ?? "").trim();
  if (!slug) return null;
  let path = String(pathname ?? "");
  if (!path.startsWith("/")) path = `/${path}`;

  if (path === "/shop" || path.startsWith("/shop/")) return null;
  if (path.startsWith("/backend") || path.startsWith("/_next")) return null;
  if (path === "/favicon.ico" || path === "/robots.txt" || path === "/sitemap.xml") return null;

  const segments = path.split("/").filter(Boolean);
  const last = segments[segments.length - 1] ?? "";
  if (/\.[a-z0-9]{2,8}$/i.test(last)) return null; // static asset / file

  const first = segments[0] ?? "";
  // Shop surface at the domain root: /cart, /checkout and /success
  // (single-segment) belong to the shop. Longer paths under those
  // names are platform routes (the legacy single-product checkout
  // is /checkout/<slug>) and stay untouched via NON_SHOP below.
  const isShopSurface =
    segments.length === 1 && (first === "cart" || first === "checkout" || first === "success");
  if (!isShopSurface && first && NON_SHOP_TOP_SEGMENTS.has(first)) return null;

  if (path === "/") return `/shop/${slug}`;
  return `/shop/${slug}${path}`;
}
