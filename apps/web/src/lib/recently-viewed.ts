/**
 * AB6 (AX14) — recently viewed products v2 (WEB-ONLY).
 *
 * localStorage stores product ID strings ONLY (versioned key,
 * capped at 8, newest first, deduped). Cards are always
 * resolved LIVE from the shop API when the strip renders, so
 * prices/stock are never stale. There is NO server state and
 * NO server tracking: this is a navigation aid on the
 * shopper's own device.
 *
 * Migration: the legacy v1 key stored full card snapshots
 * ({ id, slug, name, imageUrl, priceMinor }). When v2 is
 * absent but v1 exists, the ids are derived from the legacy
 * cards and written to v2 once; the legacy cards themselves
 * are never rendered anymore.
 */

export const RECENTLY_VIEWED_CAP = 8;

export function recentlyViewedKey(orgSlug: string): string {
  return `shop-recently-viewed:v2:${orgSlug}`;
}

export function legacyRecentlyViewedKey(orgSlug: string): string {
  return `shop-recently-viewed:${orgSlug}`;
}

interface StorageLike {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

function defaultStorage(): StorageLike | null {
  if (typeof window === "undefined") return null;
  try {
    return window.localStorage;
  } catch {
    return null;
  }
}

/** Parse a stored v2 value defensively (any corruption reads as empty). */
export function parseRecentlyViewedIds(raw: string | null | undefined): string[] {
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    const seen = new Set<string>();
    const ids: string[] = [];
    for (const x of parsed) {
      if (typeof x !== "string" || !x || seen.has(x)) continue;
      seen.add(x);
      ids.push(x);
      if (ids.length >= RECENTLY_VIEWED_CAP) break;
    }
    return ids;
  } catch {
    return [];
  }
}

/** Derive ids from a legacy v1 payload (stored card objects). */
export function parseLegacyRecentlyViewedIds(raw: string | null | undefined): string[] {
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    const seen = new Set<string>();
    const ids: string[] = [];
    for (const x of parsed) {
      const id = x && typeof x === "object" ? (x as { id?: unknown }).id : undefined;
      if (typeof id !== "string" || !id || seen.has(id)) continue;
      seen.add(id);
      ids.push(id);
      if (ids.length >= RECENTLY_VIEWED_CAP) break;
    }
    return ids;
  } catch {
    return [];
  }
}

/** Prepend a view: dedupes by product id, newest first, capped. */
export function upsertRecentlyViewedId(list: string[], productId: string): string[] {
  if (!productId) return [...list].slice(0, RECENTLY_VIEWED_CAP);
  return [productId, ...list.filter((x) => x !== productId)].slice(0, RECENTLY_VIEWED_CAP);
}

export function readRecentlyViewedIds(orgSlug: string, storage: StorageLike | null = defaultStorage()): string[] {
  if (!storage) return [];
  try {
    const v2 = storage.getItem(recentlyViewedKey(orgSlug));
    if (v2 != null) return parseRecentlyViewedIds(v2);
    // One-time legacy migration: derive ids from the stored
    // v1 cards and persist them under the v2 key.
    const legacy = storage.getItem(legacyRecentlyViewedKey(orgSlug));
    if (legacy != null) {
      const ids = parseLegacyRecentlyViewedIds(legacy);
      try {
        storage.setItem(recentlyViewedKey(orgSlug), JSON.stringify(ids));
      } catch { /* storage full/blocked — ids still returned for this view */ }
      return ids;
    }
    return [];
  } catch {
    return [];
  }
}

export function recordRecentlyViewed(orgSlug: string, productId: string, storage: StorageLike | null = defaultStorage()): void {
  if (!storage || !productId) return;
  try {
    const next = upsertRecentlyViewedId(readRecentlyViewedIds(orgSlug, storage), productId);
    storage.setItem(recentlyViewedKey(orgSlug), JSON.stringify(next));
  } catch {
    /* storage full/blocked — the strip is best-effort */
  }
}
