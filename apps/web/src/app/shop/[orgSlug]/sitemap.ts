import type { MetadataRoute } from "next";
import { shopSubdomainHost } from "@repo/contracts";
import { fetchAllProductSitemapEntries, fetchShopHome } from "@/lib/storefront-server";
import { canonicalShopBase } from "@/lib/storefront-seo";
import { buildCanonicalShopSitemapEntries } from "@/lib/storefront-sitemap";

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
 * TD7: URLs live on the shop's canonical HOST — the verified
 * custom domain when the shop home payload says there is one,
 * otherwise the tenant subdomain {slug}.qosprey.com (a rule, not
 * a fabricated guess: the TD1 contracts host for this slug). The
 * home payload is the same fetch the sitemap paging already makes.
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
  const home = await fetchShopHome(orgSlug).catch(() => null);
  const base = home ? canonicalShopBase(home.organization) : `https://${shopSubdomainHost(orgSlug)}`;
  const entries = buildCanonicalShopSitemapEntries(base, products);
  const now = new Date();
  return entries.map((entry, i) => ({
    url: entry.url,
    lastModified: entry.lastModified ?? now,
    changeFrequency: i === 0 ? "daily" : "weekly",
    priority: i === 0 ? 1 : 0.7,
  }));
}
