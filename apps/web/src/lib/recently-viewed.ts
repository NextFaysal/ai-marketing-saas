/**
 * EC27 — recently viewed products (WEB-ONLY).
 *
 * Stored in localStorage per org slug, capped at 8, most recent
 * first. There is NO server state and NO tracking claim: this is
 * a navigation aid on the shopper's own device. The minimal card
 * data (id, slug, name, image, price) is captured at view time —
 * prices in the strip can therefore be stale; the card links to
 * the live product page, where the real price is shown.
 */

export interface RecentlyViewedCard {
  id: string;
  slug: string | null;
  name: string;
  imageUrl: string | null;
  priceMinor: string;
}

export const RECENTLY_VIEWED_CAP = 8;

export function recentlyViewedKey(orgSlug: string): string {
  return `shop-recently-viewed:${orgSlug}`;
}

/** Parse a stored value defensively (any corruption reads as empty). */
export function parseRecentlyViewed(raw: string | null | undefined): RecentlyViewedCard[] {
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed
      .filter(
        (x): x is RecentlyViewedCard =>
          !!x && typeof x === "object" && typeof x.id === "string" && typeof x.name === "string" && typeof x.priceMinor === "string",
      )
      .slice(0, RECENTLY_VIEWED_CAP);
  } catch {
    return [];
  }
}

/** Prepend a view: dedupes by product id, newest first, capped. */
export function upsertRecentlyViewed(
  list: RecentlyViewedCard[],
  card: RecentlyViewedCard,
): RecentlyViewedCard[] {
  return [card, ...list.filter((x) => x.id !== card.id)].slice(0, RECENTLY_VIEWED_CAP);
}

export function readRecentlyViewed(orgSlug: string): RecentlyViewedCard[] {
  if (typeof window === "undefined") return [];
  try {
    return parseRecentlyViewed(window.localStorage.getItem(recentlyViewedKey(orgSlug)));
  } catch {
    return [];
  }
}

export function recordRecentlyViewed(orgSlug: string, card: RecentlyViewedCard): void {
  if (typeof window === "undefined") return;
  try {
    const next = upsertRecentlyViewed(readRecentlyViewed(orgSlug), card);
    window.localStorage.setItem(recentlyViewedKey(orgSlug), JSON.stringify(next));
  } catch {
    /* storage full/blocked — the strip is best-effort */
  }
}
