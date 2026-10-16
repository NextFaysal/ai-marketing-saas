/**
 * RB4/RM5 — resolve an API-returned media path to an <img> src.
 *
 * Older API rows store RELATIVE paths ("/public/branding/…/logo")
 * that must be prefixed with the API base; R2-era rows store
 * ABSOLUTE CDN URLs ("https://media.qosprey.com/…") that must be
 * used as-is — prefixing them would produce a broken double URL.
 * null/empty stays null so callers keep their no-logo fallback.
 */
export function mediaSrc(apiBase: string, url: string | null | undefined): string | null {
  if (!url) return null;
  if (/^https?:\/\//i.test(url)) return url;
  return `${apiBase}${url}`;
}
