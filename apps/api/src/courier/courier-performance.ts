/**
 * Sales & Data S5 — Courier Performance Report (pure helpers).
 *
 * Definitions (also printed on the Orders page and in
 * docs/sales-s5-acceptance.md):
 *  - The report covers CourierShipment rows BOOKED (createdAt)
 *    in the requested Asia/Dhaka-day window — the caller
 *    (CourierService.performance) fetches exactly those rows;
 *    this builder only aggregates what it is given.
 *  - Shipment status is a free-form string in the provider's
 *    own words. Classification normalizes it (trim, lowercase,
 *    spaces/hyphens -> underscores — the same normalization as
 *    apps/web/src/lib/courier-status.ts) and then:
 *      delivered  = delivered | partial_delivered | partially_delivered
 *      returned   = returned | return
 *      cancelled  = cancelled | canceled | cancel
 *      in_flight  = anything else (including null/empty/unknown)
 *  - decided = delivered + returned + cancelled. A shipment
 *    still in flight has no outcome yet, so it is excluded
 *    from the rate denominators.
 *  - deliveryRate = delivered / decided, returnRate =
 *    returned / decided, each rounded to 4 decimals. A rate
 *    is null when decided = 0 — an undecided provider has no
 *    rate, never a fabricated 0.
 *  - Providers appear ONLY when they have >= 1 shipment in
 *    the window (no zero rows for absent providers), ordered
 *    steadfast, pathao, redx first, then any other provider
 *    strings present in the data, alphabetically.
 *  - avgDeliveryHours is ALWAYS null: CourierShipment stores
 *    no delivered-at timestamp and there is no status-history
 *    table, so average delivery time is genuinely unavailable.
 *    updatedAt is deliberately NOT used as a proxy — status
 *    sync checks overwrite it on every poll, so it does not
 *    mark the delivery moment.
 */

export type ShipmentOutcome = "delivered" | "returned" | "cancelled" | "in_flight";

export function classifyShipmentStatus(status: string | null | undefined): ShipmentOutcome {
  const s = String(status ?? "").trim().toLowerCase().replace(/[\s-]+/g, "_");
  if (s === "delivered" || s === "partial_delivered" || s === "partially_delivered") return "delivered";
  if (s === "returned" || s === "return") return "returned";
  if (s === "cancelled" || s === "canceled" || s === "cancel") return "cancelled";
  return "in_flight";
}

export interface ProviderPerformance {
  provider: string;
  booked: number;
  delivered: number;
  returned: number;
  cancelled: number;
  inFlight: number;
  decided: number;
  deliveryRate: number | null;
  returnRate: number | null;
  avgDeliveryHours: null;
}

const KNOWN_PROVIDERS = ["steadfast", "pathao", "redx"] as const;

interface Bucket {
  provider: string;
  booked: number;
  delivered: number;
  returned: number;
  cancelled: number;
  inFlight: number;
}

function blank(provider: string): Bucket {
  return { provider, booked: 0, delivered: 0, returned: 0, cancelled: 0, inFlight: 0 };
}

function finalize(b: Bucket): ProviderPerformance {
  const decided = b.delivered + b.returned + b.cancelled;
  const round4 = (x: number) => Math.round(x * 10000) / 10000;
  return {
    provider: b.provider,
    booked: b.booked,
    delivered: b.delivered,
    returned: b.returned,
    cancelled: b.cancelled,
    inFlight: b.inFlight,
    decided,
    deliveryRate: decided > 0 ? round4(b.delivered / decided) : null,
    returnRate: decided > 0 ? round4(b.returned / decided) : null,
    avgDeliveryHours: null,
  };
}

export function buildCourierPerformance(
  rows: { provider: string; status: string }[],
  days: number,
  windowStart: Date,
  windowEnd: Date,
) {
  const buckets = new Map<string, Bucket>();
  const totals = blank("total");
  const add = (b: Bucket, row: { provider: string; status: string }) => {
    b.booked++;
    const outcome = classifyShipmentStatus(row.status);
    if (outcome === "delivered") b.delivered++;
    else if (outcome === "returned") b.returned++;
    else if (outcome === "cancelled") b.cancelled++;
    else b.inFlight++;
  };
  for (const row of rows) {
    let b = buckets.get(row.provider);
    if (!b) {
      b = blank(row.provider);
      buckets.set(row.provider, b);
    }
    add(b, row);
    add(totals, row);
  }
  const known = KNOWN_PROVIDERS.map((p) => buckets.get(p)).filter((b): b is Bucket => !!b);
  const extras = [...buckets.values()]
    .filter((b) => !(KNOWN_PROVIDERS as readonly string[]).includes(b.provider))
    .sort((a, b) => a.provider.localeCompare(b.provider));
  return {
    days,
    windowStart: windowStart.toISOString(),
    windowEnd: windowEnd.toISOString(),
    deliveryTimeAvailable: false as const,
    providers: [...known, ...extras].map(finalize),
    totals: finalize(totals),
  };
}
