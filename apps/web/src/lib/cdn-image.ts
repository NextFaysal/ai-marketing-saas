/**
 * RB5/RM6 — Cloudflare Image Transformations URL builder.
 *
 * Only URLs that live on OUR media CDN host get a transformation
 * URL; every other src (external hotlinks, API-relative paths,
 * blob: URLs from the authenticated media proxy) passes through
 * untouched, because /cdn-cgi/image/ only exists on the media
 * zone. The base mirrors the API's MEDIA_CDN_BASE_URL default
 * (apps/api/src/storage/media-url.ts) and can be overridden at
 * build time with NEXT_PUBLIC_MEDIA_CDN_BASE_URL.
 *
 * Transformation shape (per the RM6 brief):
 *   {base}/cdn-cgi/image/width={w},quality=85,format=auto/{original URL}
 * Only the widths in the shared preset are meant to be used —
 * arbitrary transformation URLs are never built anywhere else.
 */

export const MEDIA_CDN_BASE_URL =
  process.env.NEXT_PUBLIC_MEDIA_CDN_BASE_URL ?? "https://media.qosprey.com";

export const CDN_IMAGE_WIDTHS = [320, 640, 960, 1280] as const;

function cdnHostname(): string {
  try {
    return new URL(MEDIA_CDN_BASE_URL).hostname.toLowerCase();
  } catch {
    return "";
  }
}

/** True only for absolute http(s) URLs hosted on the media CDN. */
export function isCdnImageUrl(src: string | null | undefined): boolean {
  if (!src || typeof src !== "string") return false;
  try {
    const u = new URL(src);
    if (u.protocol !== "https:" && u.protocol !== "http:") return false;
    const host = cdnHostname();
    return host !== "" && u.hostname.toLowerCase() === host;
  } catch {
    return false;
  }
}

/** The transformation URL for one width — or the src itself,
 * unchanged, when the src is not ours to transform. */
export function cdnImageUrl(src: string, width: number): string {
  if (!isCdnImageUrl(src)) return src;
  const base = MEDIA_CDN_BASE_URL.replace(/\/+$/, "");
  const w = Math.max(1, Math.round(width));
  return `${base}/cdn-cgi/image/width=${w},quality=85,format=auto/${src}`;
}

/**
 * ED4 — the preset step for a requested display width: the largest
 * preset width that is <= the request (the smallest preset when the
 * request is smaller than every step, the largest when it exceeds
 * every step). Unknown/invalid requests fall back to 640, the
 * mid preset used for cards and content images.
 */
export function cdnWidthFor(requestedWidth?: number | null): number {
  const fallback = 640;
  if (!requestedWidth || !Number.isFinite(requestedWidth) || requestedWidth <= 0) return fallback;
  let step: number = CDN_IMAGE_WIDTHS[0];
  for (const w of CDN_IMAGE_WIDTHS) {
    if (w <= requestedWidth) step = w;
  }
  return step;
}

/** A srcset over the preset widths for CDN URLs; undefined for
 * anything else (callers then render a plain <img> src). */
export function cdnSrcSet(
  src: string,
  widths: readonly number[] = CDN_IMAGE_WIDTHS,
): string | undefined {
  if (!isCdnImageUrl(src)) return undefined;
  return widths.map((w) => `${cdnImageUrl(src, w)} ${w}w`).join(", ");
}
