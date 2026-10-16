/**
 * ED5 (EB2) — tiny shared client cache for the shop header badges.
 *
 * Why: ShopHeader mounts on EVERY shop page and used to fetch the
 * cart and the (account) wishlist on every mount, including every
 * soft navigation between shop pages. This module keeps the two
 * counts the header needs — cart item count and wishlist size, per
 * org slug — in module-level entries with a ~30s TTL, so soft
 * navigations inside that window render the badge instantly with
 * no network round-trip.
 *
 * Semantics (honest limits):
 *  - Values are the SAME counts the header always showed
 *    (cartItemCount(cart) / wishlist items length / guest list
 *    length); only their freshness changes: across soft navigations
 *    a badge may be up to TTL stale. A mount after the TTL expired
 *    (and every hard navigation, which resets module state) refetches.
 *  - Invalidation is event-driven where an event exists:
 *      cart     → CART_UPDATED_EVENT (lib/storefront-cart.ts) —
 *                 the header invalidates its cart entry, then refetches.
 *      wishlist → GUEST_WISHLIST_EVENT + SHOP_SESSION_EVENT
 *                 (lib/storefront-account.ts) — the header invalidates
 *                 its wishlist entry, then recomputes/refetches.
 *      cross-tab "storage" → the header invalidates both entries.
 *  - Account-wishlist mutations (addWishlist / removeWishlist in
 *    lib/storefront-account.ts) dispatch NO event, so there is
 *    nothing to hook: for those, the wishlist badge is TTL-only.
 *    (This is not a regression — the header never live-updated on
 *    account-wishlist toggles before ED5 either; the guest path,
 *    which did live-update via GUEST_WISHLIST_EVENT, still does.)
 */

export const SHOP_HEADER_CACHE_TTL_MS = 30_000;

interface CacheEntry {
  value: number;
  at: number;
}

const cartCounts = new Map<string, CacheEntry>();
const wishlistCounts = new Map<string, CacheEntry>();

function read(map: Map<string, CacheEntry>, orgSlug: string, now: number): number | null {
  const entry = map.get(orgSlug);
  if (!entry) return null;
  if (now - entry.at >= SHOP_HEADER_CACHE_TTL_MS) {
    map.delete(orgSlug);
    return null;
  }
  return entry.value;
}

function write(map: Map<string, CacheEntry>, orgSlug: string, value: number, now: number): void {
  map.set(orgSlug, { value, at: now });
}

export function getCachedCartCount(orgSlug: string, now: number = Date.now()): number | null {
  return read(cartCounts, orgSlug, now);
}

export function setCachedCartCount(orgSlug: string, value: number, now: number = Date.now()): void {
  write(cartCounts, orgSlug, value, now);
}

export function invalidateCartCount(orgSlug: string): void {
  cartCounts.delete(orgSlug);
}

export function getCachedWishlistCount(orgSlug: string, now: number = Date.now()): number | null {
  return read(wishlistCounts, orgSlug, now);
}

export function setCachedWishlistCount(orgSlug: string, value: number, now: number = Date.now()): void {
  write(wishlistCounts, orgSlug, value, now);
}

export function invalidateWishlistCount(orgSlug: string): void {
  wishlistCounts.delete(orgSlug);
}

/** Test / session-reset helper: drop every cached badge. */
export function clearShopHeaderCache(): void {
  cartCounts.clear();
  wishlistCounts.clear();
}
