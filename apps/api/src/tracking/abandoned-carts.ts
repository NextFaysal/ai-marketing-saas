/**
 * Sales & Data S4 — abandoned-cart derivation (pure function).
 *
 * An abandoned cart is derived ONLY from tracking events that actually
 * exist; nothing is inferred beyond what the events carry:
 *
 * - Signals: `add_to_cart` and `checkout_started` events, grouped by
 *   sessionKey. (Note: `checkout_started` is whitelisted at ingest but
 *   tracker.js emits it nowhere today — stores may send it via
 *   TP.track("checkout_started"); otherwise add_to_cart is the signal.)
 * - A cart counts only when its LAST signal activity is at least
 *   `minAgeMs` old (default 1 hour) — the shopper has actually stopped.
 * - Lookback: only events within the last `lookbackMs` (default 7 days)
 *   are considered at all.
 * - Conversion exclusion: if ANY purchase event for the same visitorId
 *   occurred at or after this cart's FIRST signal, the cart is not
 *   abandoned. A purchase BEFORE the first signal does not exclude it
 *   (the shopper came back and started a new cart).
 * - Value honesty: valueMinor/currency come only from a signal event
 *   that itself stored a valueMinor (the latest such event). They are
 *   NEVER computed from item prices — tracker add_to_cart carries no
 *   price, so the cart value is usually null ("মূল্য জানা নেই").
 */

export interface AbandonedCartItem {
  productId: string | null;
  name: string | null;
  quantity: number | null;
}

export interface AbandonedCartRow {
  visitorId: string;
  sessionKey: string;
  storeId: string;
  signal: "checkout_started" | "add_to_cart";
  lastActivityAt: string; // ISO
  items: AbandonedCartItem[];
  valueMinor: string | null;
  currency: string | null;
}

const DEFAULT_MIN_AGE_MS = 60 * 60 * 1000; // 1 hour
const DEFAULT_LOOKBACK_MS = 7 * 24 * 60 * 60 * 1000; // 7 days

function timeOf(e: any): number {
  const t = e?.occurredAt instanceof Date ? e.occurredAt.getTime() : Date.parse(e?.occurredAt ?? "");
  return Number.isNaN(t) ? NaN : t;
}

export function deriveAbandonedCarts(
  events: any[],
  now: Date,
  opts?: { minAgeMs?: number; lookbackMs?: number },
): AbandonedCartRow[] {
  const minAgeMs = opts?.minAgeMs ?? DEFAULT_MIN_AGE_MS;
  const lookbackMs = opts?.lookbackMs ?? DEFAULT_LOOKBACK_MS;
  const nowMs = now.getTime();
  const windowStart = nowMs - lookbackMs;

  const considered = (Array.isArray(events) ? events : []).filter((e) => {
    if (!e || !e.sessionKey) return false;
    if (e.type !== "add_to_cart" && e.type !== "checkout_started" && e.type !== "purchase") return false;
    const t = timeOf(e);
    return !Number.isNaN(t) && t >= windowStart && t <= nowMs;
  });

  // Purchases indexed by visitor for the conversion exclusion.
  const purchasesByVisitor = new Map<string, number[]>();
  for (const e of considered) {
    if (e.type !== "purchase" || e.visitorId == null) continue;
    const list = purchasesByVisitor.get(String(e.visitorId)) ?? [];
    list.push(timeOf(e));
    purchasesByVisitor.set(String(e.visitorId), list);
  }

  // Signal events grouped by session.
  const bySession = new Map<string, any[]>();
  for (const e of considered) {
    if (e.type !== "add_to_cart" && e.type !== "checkout_started") continue;
    const key = String(e.sessionKey);
    const list = bySession.get(key) ?? [];
    list.push(e);
    bySession.set(key, list);
  }

  const rows: AbandonedCartRow[] = [];
  for (const [sessionKey, signals] of bySession) {
    const ordered = [...signals].sort((a, b) => timeOf(a) - timeOf(b));
    const firstSignalAt = timeOf(ordered[0]);
    const lastActivityAt = timeOf(ordered[ordered.length - 1]);

    // Too recent — the shopper may still be checking out.
    if (lastActivityAt > nowMs - minAgeMs) continue;

    const visitorId = ordered[0].visitorId != null ? String(ordered[0].visitorId) : null;
    if (!visitorId) continue;

    // Converted: a purchase at/after this cart's first signal.
    const purchases = purchasesByVisitor.get(visitorId) ?? [];
    if (purchases.some((t) => t >= firstSignalAt)) continue;

    const signal: AbandonedCartRow["signal"] = ordered.some((e) => e.type === "checkout_started")
      ? "checkout_started"
      : "add_to_cart";

    // Items from signal-event properties, in occurredAt order, deduped
    // by (productId ?? name). First occurrence wins.
    const items: AbandonedCartItem[] = [];
    const seen = new Set<string>();
    for (const e of ordered) {
      const p = e.properties;
      if (!p || typeof p !== "object") continue;
      const productId = p.productId != null ? String(p.productId) : null;
      const name = typeof p.name === "string" && p.name.trim() !== "" ? p.name : null;
      if (productId === null && name === null) continue;
      const dedupeKey = productId ?? (name as string);
      if (seen.has(dedupeKey)) continue;
      seen.add(dedupeKey);
      const quantity = typeof p.quantity === "number" && Number.isFinite(p.quantity) && p.quantity > 0 ? p.quantity : null;
      items.push({ productId, name, quantity });
    }

    // Value: the LATEST signal event that itself stored a valueMinor.
    let valueMinor: string | null = null;
    let currency: string | null = null;
    for (let i = ordered.length - 1; i >= 0; i--) {
      if (ordered[i].valueMinor != null) {
        valueMinor = String(ordered[i].valueMinor);
        currency = ordered[i].currency ?? null;
        break;
      }
    }

    rows.push({
      visitorId,
      sessionKey,
      storeId: ordered[0].storeId != null ? String(ordered[0].storeId) : "",
      signal,
      lastActivityAt: new Date(lastActivityAt).toISOString(),
      items,
      valueMinor,
      currency,
    });
  }

  rows.sort((a, b) => (a.lastActivityAt < b.lastActivityAt ? 1 : a.lastActivityAt > b.lastActivityAt ? -1 : 0));
  return rows;
}
