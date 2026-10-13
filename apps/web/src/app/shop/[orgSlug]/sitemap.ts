import type { MetadataRoute } from "next";
import { fetchAllProductSlugs } from "@/lib/storefront-server";
import { buildShopSitemapUrls, sitemapUrlBase } from "@/lib/storefront-sitemap";

/**
 * Shop sitemap: home + every ACTIVE product (paged from the shop
 * API, pageSize 60, bounded 200 pages).
 *
 * URL base limitation: Next's sitemap signature has no request,
 * and this app has no canonical public-URL setting besides
 * NEXT_PUBLIC_WEB_URL. When it is unset we emit path-only URLs
 * rather than fabricating a production domain.
 */
export default async function sitemap({
  params,
}: {
  params: Promise<{ orgSlug: string }>;
}): Promise<MetadataRoute.Sitemap> {
  const { orgSlug } = await params;
  const slugs = await fetchAllProductSlugs(orgSlug).catch(() => [] as string[]);
  const urls = buildShopSitemapUrls(sitemapUrlBase(), orgSlug, slugs);
  const now = new Date();
  return urls.map((url, i) => ({
    url,
    lastModified: now,
    changeFrequency: i === 0 ? "daily" : "weekly",
    priority: i === 0 ? 1 : 0.7,
  }));
}
