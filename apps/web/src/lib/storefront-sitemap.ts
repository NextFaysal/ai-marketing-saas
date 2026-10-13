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
