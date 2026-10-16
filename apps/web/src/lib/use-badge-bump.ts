"use client";
import { useEffect, useRef, useState } from "react";

/**
 * ED11 (EB4) — cart-badge bump predicate + hook.
 *
 * The bump fires ONLY on an increase: the previous count must
 * be known (the first observed count — initial load — never
 * bumps) and the new count must be strictly greater. Cart
 * removals / quantity decreases therefore stay silent, which is
 * the point: the pulse means "your item went in".
 */
export function shouldBumpBadge(
  prev: number | null | undefined,
  next: number,
): boolean {
  return prev != null && Number.isFinite(next) && next > prev;
}

/**
 * Returns a `bumpKey` that increments on every increase of
 * `count`. Rendering the badge with `key={bumpKey}` and the
 * globals `.badge-bump` class (only when bumpKey > 0) replays
 * the CSS animation exactly once per increase — no timers, no
 * animation state to clean up. The hook issues NO fetches; the
 * caller keeps owning the count (the EB2 header cache + the
 * CART_UPDATED_EVENT flow in ShopHeader / ShopBottomNav).
 */
export function useBadgeBump(count: number): number {
  const prevRef = useRef<number | null>(null);
  const [bumpKey, setBumpKey] = useState(0);
  useEffect(() => {
    if (shouldBumpBadge(prevRef.current, count)) {
      setBumpKey((k) => k + 1);
    }
    prevRef.current = count;
  }, [count]);
  return bumpKey;
}
