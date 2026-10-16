import type { MetadataRoute } from "next";
import { fetchAllProductSitemapEntries, fetchShopBlog } from "@/lib/storefront-server";
import { buildShopSitemapEntries, sitemapUrlBase } from "@/lib/storefront-sitemap";

/**
 * Shop sitemap: home + every ACTIVE product (paged from the shop
 * API, pageSize 60, bounded 200 pages). Category pages are query
 * parameters on the home route in this shop (no separate category
 * routes exist), so they are not listed as separate URLs.
 *
 * EC27: lastmod is REAL — each product entry carries that
 * product's updatedAt from the API payload; the home entry
 * carries the newest product updatedAt (falling back to "now"
 * only when the shop has no products at all).
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
  const products = await fetchAllProductSitemapEntries(orgSlug).catch(
    () => [] as { slug: string; updatedAt: string | null }[],
  );
  // AB6 (AX12): blog posts (failure-isolated — a blog fetch
  // failure must never break the product sitemap).
  const blog = await fetchShopBlog(orgSlug).catch(() => null);
  const blogPosts = (blog?.posts ?? []).map((p) => ({
    slug: p.slug,
    updatedAt: p.updatedAt ?? p.publishedAt ?? null,
  }));
  const entries = buildShopSitemapEntries(sitemapUrlBase(), orgSlug, products, blogPosts);
  const now = new Date();
  return entries.map((entry, i) => ({
    url: entry.url,
    lastModified: entry.lastModified ?? now,
    changeFrequency: i === 0 ? "daily" : "weekly",
    priority: i === 0 ? 1 : 0.7,
  }));
}
