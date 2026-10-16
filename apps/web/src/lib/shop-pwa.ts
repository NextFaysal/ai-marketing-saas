/**
 * AB8 (AX22/AX23) — per-shop PWA manifest + generated icon.
 *
 * Pure builders (unit-tested in shop-pwa.test.ts); the route
 * handlers under app/shop/[orgSlug]/ are thin wrappers around
 * them. AX22 adds NO service worker: the dashboard worker owns
 * the root scope and the shop push worker is push-only — this
 * manifest only makes the SHOP installable under its own name,
 * colors and icon.
 *
 * Icon honesty: a shop with its own logo uses it; a white-label
 * shop without a logo gets the neutral generated initial icon
 * (icon.svg route) — NEVER the platform logo; a non-white-label
 * shop without a logo falls back to the platform PNG icons.
 */

/** Loose structural view of the fetchShopHome payload — optional
 * AB8 fields (whiteLabel) are read defensively because fixtures
 * and older API builds may omit them. */
export interface ShopPwaHome {
  settings?: { shopName?: string | null } | null;
  organization?:
    | {
        name?: string | null;
        brandName?: string | null;
        logoUrl?: string | null;
        primaryColor?: string | null;
        whiteLabel?: boolean | null;
      }
    | null;
}

export interface ShopManifestIcon {
  src: string;
  sizes: string;
  purpose: string;
  type?: string;
}

export interface ShopManifest {
  name: string;
  short_name: string;
  start_url: string;
  scope: string;
  display: string;
  background_color: string;
  theme_color: string;
  icons: ShopManifestIcon[];
}

export const SHOP_PWA_FALLBACK_COLOR = "#4f46e5";

export function isWhiteLabel(home: ShopPwaHome | null | undefined): boolean {
  return (home?.organization as { whiteLabel?: unknown } | null | undefined)?.whiteLabel === true;
}

/** Display name resolution shared by the manifest and the icon:
 * brandName ?? organization.name ?? settings.shopName. */
export function shopDisplayName(home: ShopPwaHome | null | undefined): string {
  const org = home?.organization;
  const name = org?.brandName ?? org?.name ?? home?.settings?.shopName ?? "";
  return typeof name === "string" && name.trim() ? name.trim() : "Shop";
}

export function buildShopManifest(home: ShopPwaHome, orgSlug: string): ShopManifest {
  const name = shopDisplayName(home);
  const logoUrl = home?.organization?.logoUrl || null;
  const themeColor = home?.organization?.primaryColor || SHOP_PWA_FALLBACK_COLOR;
  const icons: ShopManifestIcon[] = logoUrl
    ? [{ src: logoUrl, sizes: "any", purpose: "any" }]
    : isWhiteLabel(home)
      ? [{ src: `/shop/${orgSlug}/icon.svg`, sizes: "any", purpose: "any", type: "image/svg+xml" }]
      : [
          { src: "/icons/icon-192.png", sizes: "192x192", purpose: "any", type: "image/png" },
          { src: "/icons/icon-512.png", sizes: "512x512", purpose: "any", type: "image/png" },
        ];
  return {
    name,
    short_name: Array.from(name).slice(0, 12).join(""),
    start_url: `/shop/${orgSlug}`,
    scope: `/shop/${orgSlug}/`,
    display: "standalone",
    background_color: "#ffffff",
    theme_color: themeColor,
    icons,
  };
}

/** A CSS hex color (#rgb or #rrggbb) or the fallback — merchant
 * input must never flow unvalidated into generated SVG/CSS. */
export function validatedHexColor(value: string | null | undefined): string {
  return typeof value === "string" && /^#(?:[0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/.test(value.trim())
    ? value.trim()
    : SHOP_PWA_FALLBACK_COLOR;
}

export function escapeXml(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

/**
 * Neutral generated shop icon: a rounded square in the shop's
 * primary color with its (white, bold) first letter. Used as
 * the white-label fallback so a white-label shop never renders
 * the platform's mark.
 */
export function buildShopIconSvg(home: ShopPwaHome): string {
  const color = validatedHexColor(home?.organization?.primaryColor);
  const letter = escapeXml(Array.from(shopDisplayName(home))[0] ?? "S");
  return [
    `<svg xmlns="http://www.w3.org/2000/svg" width="512" height="512" viewBox="0 0 512 512">`,
    `<rect width="512" height="512" rx="96" fill="${color}"/>`,
    `<text x="256" y="256" dy="0.36em" text-anchor="middle" font-family="Arial, Helvetica, sans-serif" font-size="256" font-weight="700" fill="#ffffff">${letter}</text>`,
    `</svg>`,
  ].join("");
}
