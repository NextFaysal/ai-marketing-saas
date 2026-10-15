/**
 * EC8 sitemap helpers — pure URL building (unit-tested).
 *
 * Absolute public URL base: NEXT_PUBLIC_WEB_URL when configured.
 * The app has no other canonical public-URL setting (pages build
 * links with relative paths and publicApiBase() falls back to the
 * runtime origin), so without it we emit path-only URLs rather
 * than fabricating a production domain.
 */
export function sitemapUrlBase(env: Record<string, string | undefined> = process.env): string {
  const raw = (env.NEXT_PUBLIC_WEB_URL ?? "").trim().replace(/\/+$/, "");
  return raw;
}

export function buildSitemapUrl(base: string, path: string): string {
  const p = path.startsWith("/") ? path : `/${path}`;
  return base ? `${base}${p}` : p;
}

/** Home + one entry per product slug (null/duplicate slugs skipped), order preserved. */
export function buildShopSitemapUrls(
  base: string,
  orgSlug: string,
  productSlugs: Array<string | null | undefined>,
): string[] {
  const urls: string[] = [buildSitemapUrl(base, `/shop/${orgSlug}`)];
  const seen = new Set<string>();
  for (const slug of productSlugs) {
    if (!slug || seen.has(slug)) continue;
    seen.add(slug);
    urls.push(buildSitemapUrl(base, `/shop/${orgSlug}/products/${encodeURIComponent(slug)}`));
  }
  return urls;
}

/** Pages to fetch when paging the shop API for the sitemap (bounded). */
export function sitemapPagePlan(totalPages: number, cap = 200): number[] {
  const n = Math.min(Math.max(1, Math.floor(totalPages) || 1), cap);
  return Array.from({ length: n }, (_, i) => i + 1);
}

export interface ShopSitemapEntry {
  url: string;
  lastModified: Date | null;
}

/**
 * EC27: sitemap entries with REAL lastmod — each product entry
 * carries that product's updatedAt; the home entry carries the
 * newest product updatedAt (null when the shop has no products —
 * the caller then falls back to "now", which is honest for a
 * just-created shop home). Inactive products never reach this
 * helper: the shop API only lists ACTIVE products.
 */
function sitemapEntriesWith(
  products: Array<{ slug?: string | null; updatedAt?: string | Date | null }>,
  homeUrl: string,
  productUrl: (slug: string) => string,
): ShopSitemapEntry[] {
  const seen = new Set<string>();
  const productEntries: ShopSitemapEntry[] = [];
  let newest: Date | null = null;
  for (const p of products) {
    if (!p.slug || seen.has(p.slug)) continue;
    seen.add(p.slug);
    const d = p.updatedAt ? new Date(p.updatedAt) : null;
    const valid = d && !Number.isNaN(d.getTime()) ? d : null;
    if (valid && (!newest || valid.getTime() > newest.getTime())) newest = valid;
    productEntries.push({ url: productUrl(p.slug), lastModified: valid });
  }
  return [{ url: homeUrl, lastModified: newest }, ...productEntries];
}

export function buildShopSitemapEntries(
  base: string,
  orgSlug: string,
  products: Array<{ slug?: string | null; updatedAt?: string | Date | null }>,
): ShopSitemapEntry[] {
  return sitemapEntriesWith(
    products,
    buildSitemapUrl(base, `/shop/${orgSlug}`),
    (slug) => buildSitemapUrl(base, `/shop/${orgSlug}/products/${encodeURIComponent(slug)}`),
  );
}

/**
 * TD7: the same entries on the shop's canonical HOST base
 * (canonicalShopBase): the shop lives at that host's root, so the
 * home entry is the bare origin and products sit at /products/.
 */
export function buildCanonicalShopSitemapEntries(
  canonicalBase: string,
  products: Array<{ slug?: string | null; updatedAt?: string | Date | null }>,
): ShopSitemapEntry[] {
  const base = String(canonicalBase ?? "").replace(/\/+$/, "");
  return sitemapEntriesWith(
    products,
    `${base}/`,
    (slug) => `${base}/products/${encodeURIComponent(slug)}`,
  );
}
