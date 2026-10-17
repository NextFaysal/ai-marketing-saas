import { fetchShopHome } from "@/lib/storefront-server";
import { canonicalShopBase } from "@/lib/storefront-seo";
import { sitemapUrlBase } from "@/lib/storefront-sitemap";

/**
 * EC27 — per-shop robots.txt, served at /shop/[orgSlug]/robots.txt.
 *
 * Allows the public shop surface (home + product pages), keeps
 * the transactional/private shop paths (cart, checkout, account,
 * success) out of indexes, and points at this shop's sitemap.
 *
 * TD7: when the shop home payload is available, the rules are
 * written for the shop's canonical HOST (verified custom domain,
 * else the tenant subdomain): on that host the shop lives at the
 * root, so the allowed surface is "/" and the disallowed paths
 * are the root transactional paths. The Sitemap line points at
 * this shop's sitemap route ON the canonical host (that route is
 * served under /shop/<slug>/ on every host). When the payload is
 * unavailable, the EC27 path-form body is emitted unchanged —
 * based on NEXT_PUBLIC_WEB_URL or this request's real origin,
 * never a fabricated domain.
 */
export async function GET(
  request: Request,
  { params }: { params: Promise<{ orgSlug: string }> },
): Promise<Response> {
  const { orgSlug } = await params;
  const home = await fetchShopHome(orgSlug).catch(() => null);

  let body: string;
  if (home) {
    const canonicalBase = canonicalShopBase(home.organization);
    body = [
      "User-Agent: *",
      "Allow: /",
      "Disallow: /cart",
      "Disallow: /checkout",
      "Disallow: /account",
      "Disallow: /success",
      "",
      `Sitemap: ${canonicalBase}/shop/${orgSlug}/sitemap.xml`,
      "",
    ].join("\n");
  } else {
    const base = sitemapUrlBase() || new URL(request.url).origin;
    const shop = `/shop/${orgSlug}`;
    body = [
      "User-Agent: *",
      `Allow: ${shop}/`,
      `Disallow: ${shop}/cart`,
      `Disallow: ${shop}/checkout`,
      `Disallow: ${shop}/account`,
      `Disallow: ${shop}/success`,
      "",
      `Sitemap: ${base}${shop}/sitemap.xml`,
      "",
    ].join("\n");
  }
  return new Response(body, {
    headers: { "Content-Type": "text/plain; charset=utf-8" },
  });
}
