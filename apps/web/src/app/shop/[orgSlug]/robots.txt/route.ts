import { sitemapUrlBase } from "@/lib/storefront-sitemap";

/**
 * EC27 — per-shop robots.txt, served at /shop/[orgSlug]/robots.txt.
 *
 * Allows the public shop surface (home + product pages), keeps
 * the transactional/private shop paths (cart, checkout, account,
 * success) out of indexes, and points at this shop's sitemap.
 * The Sitemap line needs an absolute URL: NEXT_PUBLIC_WEB_URL
 * when configured, else the origin of THIS request (a real,
 * observed value — never a fabricated domain).
 */
export async function GET(
  request: Request,
  { params }: { params: Promise<{ orgSlug: string }> },
): Promise<Response> {
  const { orgSlug } = await params;
  const base = sitemapUrlBase() || new URL(request.url).origin;
  const shop = `/shop/${orgSlug}`;
  const body = [
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
  return new Response(body, {
    headers: { "Content-Type": "text/plain; charset=utf-8" },
  });
}
