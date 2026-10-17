/**
 * NF14 (FB5) — app-only offers: the storefront display rule.
 *
 * Pure helpers (unit-tested in app-offers-nf14.test.ts). The
 * rule is DISPLAY ONLY, end to end: the API's public offers
 * payload carries every active offer with its `appOnly` flag,
 * and the storefront hides app-only offers unless the shop is
 * running as the installed app (standalone display mode). The
 * discount code itself is never blocked — a shared app-only
 * code still redeems normally at checkout (the dashboard form
 * says exactly this next to the toggle).
 */

/** Public-safe offer shape served by GET /public/shop/:slug/offers. */
export interface PublicShopOffer {
  id: string;
  code: string;
  kind: string; // percent | fixed | free_shipping
  value: number;
  minOrderMinor: string | null;
  endsAt: string | null;
  appOnly: boolean;
}

/**
 * True when the page runs as the shop's installed app:
 * the `(display-mode: standalone)` media query (Android/desktop
 * PWA + installed iOS web apps) OR iOS Safari's legacy
 * `navigator.standalone`. Read defensively — anything unusual
 * (no window, no matchMedia, a throwing stub) reads as NOT
 * standalone, i.e. app-only offers stay hidden rather than leak.
 */
export function isStandaloneDisplay(): boolean {
  if (typeof window === "undefined") return false;
  try {
    if (
      typeof window.matchMedia === "function" &&
      window.matchMedia("(display-mode: standalone)").matches
    ) {
      return true;
    }
    return (window.navigator as { standalone?: unknown } | undefined)?.standalone === true;
  } catch {
    return false;
  }
}

/**
 * The display rule itself: non-app-only offers are always
 * visible; app-only offers are visible only in standalone mode.
 * Input order is preserved; null/undefined reads as no offers.
 */
export function visibleOffers<T extends { appOnly?: boolean | null }>(
  offers: readonly T[] | null | undefined,
  standalone: boolean,
): T[] {
  if (!offers) return [];
  return offers.filter((o) => standalone || o.appOnly !== true);
}

/** Bengali one-line label for an offer (percent / fixed / free shipping). */
export function offerLabel(offer: PublicShopOffer): string {
  if (offer.kind === "percent") return `${offer.value}% ছাড়`;
  if (offer.kind === "fixed") {
    return `৳${(offer.value / 100).toLocaleString("en-IN", { maximumFractionDigits: 2 })} ছাড়`;
  }
  if (offer.kind === "free_shipping") return "ফ্রি ডেলিভারি";
  return "বিশেষ অফার";
}
