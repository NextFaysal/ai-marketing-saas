/**
 * EC8 custom-domain routing + TD4/TD5 tenant-domain routing —
 * pure decision logic (unit-tested).
 *
 * A verified merchant custom domain should serve that merchant's
 * shop at the domain root. The middleware looks the host up via
 * the API's by-domain endpoint (which only returns VERIFIED
 * domains) and rewrites shop-shaped paths onto /shop/<slug>.
 * Everything else — dashboard, auth, platform pages, static
 * assets, the API proxy — must never be rewritten.
 *
 * TD4 adds the platform's own tenant subdomains on top of that:
 * {slug}.qosprey.com serves the same shop at its root, decided
 * DETERMINISTICALLY from the host alone (no database lookup) —
 * the TD1 slug rules in @repo/contracts are the single source of
 * truth for what may be a slug and which names are reserved.
 * TD5 adds the surface separation: on a shop host the staff panel
 * paths never serve — they redirect to the platform app host.
 */
import {
  PLATFORM_APEX_DOMAIN,
  checkSlugLocally,
  isReservedSlug,
} from "@repo/contracts";

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

// ---------- TD4: host classification ----------

export type HostClassification =
  | { kind: "platform" }
  | { kind: "shop-subdomain"; slug: string }
  | { kind: "shop-custom-candidate" }
  | { kind: "unknown" };

/**
 * Classify a request host into exactly one routing class.
 *
 * - The platform apex itself and every single label under it that
 *   can never be an organization slug because TD1 reserves it —
 *   the system names (app, admin, api, media, www, dashboard, …)
 *   AND the misleading/future classes (fake, orgnail, pay, …) —
 *   are the platform's own namespace: `platform`.
 * - A single label under the apex that passes the TD1 local slug
 *   check (valid format, not reserved) IS a tenant subdomain:
 *   `shop-subdomain` with that label as the slug. Whether an
 *   organization with that slug exists is NOT decided here — the
 *   middleware rewrites onto /shop/<slug> and the shop page itself
 *   answers for a missing/disabled shop (see td-tb2 acceptance).
 * - Multi-level names under the apex (a.b.qosprey.com) are an
 *   explicit `unknown`: v1 has no sub-subdomains (TD plan §৫).
 *   Deliberately NOT platform, NOT a shop, and NOT eligible for
 *   the custom-domain lookup either.
 * - A single label that is neither a valid slug nor a reserved
 *   name (malformed: bad characters, too short/long) is `unknown`.
 * - Anything not under the platform apex may be a merchant's own
 *   domain: `shop-custom-candidate` — the middleware still has to
 *   confirm it via the by-domain lookup (VERIFIED domains only)
 *   before treating it as a shop host.
 * - Local/dev hosts and empty hosts are `unknown` here; the
 *   middleware keeps skipping them via shouldSkipHost first.
 */
export function classifyHost(host: string | null | undefined): HostClassification {
  const h = normalizeHost(host);
  if (!h) return { kind: "unknown" };
  if (h === "localhost" || h === "127.0.0.1" || h === "::1" || h.endsWith(".local")) {
    return { kind: "unknown" };
  }
  const apex = PLATFORM_APEX_DOMAIN;
  if (h === apex) return { kind: "platform" };
  if (h.endsWith(`.${apex}`)) {
    const label = h.slice(0, h.length - apex.length - 1);
    if (label.includes(".")) return { kind: "unknown" };
    if (checkSlugLocally(label).ok) return { kind: "shop-subdomain", slug: label };
    if (isReservedSlug(label)) return { kind: "platform" };
    return { kind: "unknown" };
  }
  return { kind: "shop-custom-candidate" };
}

// ---------- TD5: panel paths never serve on a shop host ----------

/** Staff/panel surfaces that live ONLY on the platform app host
 * (owner decision, TD plan §TD5). Exact first-segment match;
 * subpaths are included via the segment check. */
export const PANEL_PATH_SEGMENTS: ReadonlySet<string> = new Set([
  "dashboard",
  "login",
  "register",
  "onboarding",
  "accept-invite",
]);

export function isPanelPath(pathname: string): boolean {
  const first = String(pathname ?? "").split("/").filter(Boolean)[0] ?? "";
  return PANEL_PATH_SEGMENTS.has(first);
}

/** Absolute redirect target for a panel path on a shop host:
 * same path + same query string, on https://app.<apex>. The app
 * host name comes from the contracts apex constant — no env var. */
export function panelAppRedirectUrl(pathname: string, search?: string | null): string {
  let path = String(pathname ?? "/");
  if (!path.startsWith("/")) path = `/${path}`;
  const rawSearch = String(search ?? "");
  const qs = rawSearch ? (rawSearch.startsWith("?") ? rawSearch : `?${rawSearch}`) : "";
  return `https://app.${PLATFORM_APEX_DOMAIN}${path}${qs}`;
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
