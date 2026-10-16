/**
 * AB7 (AX17) — social-proof popup helpers (pure, testable).
 *
 * The component (ShopSocialProof) owns fetching + timers; the
 * decidable rules live here: payload normalization, the
 * per-session show cap (sessionStorage count per org), the
 * dismissed-for-session flag, and the Bengali line format.
 *
 * Storage (sessionStorage, per org):
 *   `shop-social-proof-shown:<orgSlug>`    — number of popups
 *     already shown this session.
 *   `shop-social-proof-dismissed:<orgSlug>` — "1" once the
 *     shopper closes a popup; nothing shows again this session.
 */

export interface SocialProofItem {
  buyerFirstName: string;
  district: string | null;
  productName: string;
  hoursAgo: number;
}

export interface SocialProofConfig {
  intervalSec: number;
  displaySec: number;
  maxPerSession: number;
}

export interface SocialProofFeed {
  config: SocialProofConfig;
  items: SocialProofItem[];
}

export function socialProofShownKey(orgSlug: string): string {
  return `shop-social-proof-shown:${orgSlug}`;
}

export function socialProofDismissedKey(orgSlug: string): string {
  return `shop-social-proof-dismissed:${orgSlug}`;
}

function cleanText(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function positiveInt(value: unknown, fallback: number): number {
  return typeof value === "number" && Number.isFinite(value) && value > 0
    ? Math.floor(value)
    : fallback;
}

/**
 * Normalize the GET social-proof payload. Returns null when the
 * feed is disabled, malformed, or has no usable items — the
 * component renders nothing in every one of those cases.
 */
export function socialProofFeedFromPayload(payload: unknown): SocialProofFeed | null {
  if (!payload || typeof payload !== "object") return null;
  const p = payload as Record<string, unknown>;
  if (p.enabled !== true) return null;
  const cfgRaw = p.config && typeof p.config === "object" ? (p.config as Record<string, unknown>) : {};
  const config: SocialProofConfig = {
    intervalSec: positiveInt(cfgRaw.intervalSec, 12),
    displaySec: positiveInt(cfgRaw.displaySec, 5),
    maxPerSession: positiveInt(cfgRaw.maxPerSession, 3),
  };
  const rawItems = Array.isArray(p.items) ? p.items : [];
  const items: SocialProofItem[] = [];
  for (const raw of rawItems) {
    if (!raw || typeof raw !== "object") continue;
    const r = raw as Record<string, unknown>;
    const buyerFirstName = cleanText(r.buyerFirstName);
    const productName = cleanText(r.productName);
    if (!buyerFirstName || !productName) continue;
    const hoursAgo =
      typeof r.hoursAgo === "number" && Number.isFinite(r.hoursAgo) && r.hoursAgo >= 0
        ? Math.floor(r.hoursAgo)
        : 0;
    items.push({
      buyerFirstName,
      district: cleanText(r.district),
      productName,
      hoursAgo,
    });
  }
  if (items.length === 0) return null;
  return { config, items };
}

/** Parse the sessionStorage shown-count; corruption reads as 0. */
export function parseShownCount(raw: string | null | undefined): number {
  if (!raw) return 0;
  const n = Number(raw);
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : 0;
}

/**
 * May another popup show? No when dismissed for the session,
 * no when the session cap is reached, no without items.
 */
export function canShowSocialProof(args: {
  shownCount: number;
  maxPerSession: number;
  dismissed: boolean;
  itemCount: number;
}): boolean {
  if (args.dismissed) return false;
  if (args.itemCount <= 0) return false;
  if (args.maxPerSession <= 0) return false;
  return args.shownCount < args.maxPerSession;
}

/** The item to display for the Nth (0-based) show — wraps the list. */
export function socialProofItemAt(items: SocialProofItem[], showIndex: number): SocialProofItem | null {
  if (items.length === 0) return null;
  const idx = ((showIndex % items.length) + items.length) % items.length;
  return items[idx];
}

function bnDigits(n: number): string {
  return n.toLocaleString("bn-BD");
}

/**
 * The popup's two text lines:
 *   "{buyerFirstName} কিনেছেন — {productName}"
 *   "{district} থেকে · {hoursAgo} ঘণ্টা আগে"  (district optional;
 *    hoursAgo 0 reads "কিছুক্ষণ আগে")
 */
export function socialProofLines(item: SocialProofItem): { main: string; sub: string } {
  const main = `${item.buyerFirstName} কিনেছেন — ${item.productName}`;
  const when = item.hoursAgo <= 0 ? "কিছুক্ষণ আগে" : `${bnDigits(item.hoursAgo)} ঘণ্টা আগে`;
  const sub = item.district ? `${item.district} থেকে · ${when}` : when;
  return { main, sub };
}
