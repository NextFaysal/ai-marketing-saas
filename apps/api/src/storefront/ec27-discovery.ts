/**
 * EC27 — pure discovery helpers (unit-tested, no I/O).
 *
 * bought-together ranking works on the SOLD-order lines of the
 * last 180 days. "Sold" is exactly EC33's definition
 * (inventory-intelligence.service.ts isSoldOrder): the order is
 * not in a dead state (cancelled / refunded / failed) AND it is
 * delivered-proven — status "completed" / "delivered", OR one of
 * its CourierShipments is delivered / partial_delivered.
 */

export const DEAD_ORDER_STATUSES = ["cancelled", "refunded", "failed"];
export const DELIVERED_SHIPMENT_STATUSES = ["delivered", "partial_delivered"];

export function isSoldOrder(order: any, shipmentStatuses: string[]): boolean {
  const status = String(order?.status ?? "");
  if (DEAD_ORDER_STATUSES.includes(status)) return false;
  if (status === "completed" || status === "delivered") return true;
  return shipmentStatuses.some((s) => DELIVERED_SHIPMENT_STATUSES.includes(String(s)));
}

export interface BoughtTogetherLine {
  orderId: string;
  productId?: string | null;
  isGift?: boolean | null;
}

/**
 * Rank products co-occurring with `targetProductId` in the same
 * sold orders.
 *
 * Rules (spec-pinned):
 *  - gift lines (isGift) never count — a free gift in the basket
 *    is not purchase intent;
 *  - the target product itself is excluded;
 *  - a co-product needs >= 2 co-occurrences to appear (below that
 *    the section is omitted — no filler recommendations);
 *  - only products in `activeProductIds` are returned;
 *  - order: co-occurrence count desc, ties by productId asc
 *    (deterministic), at most `limit` entries.
 *
 * A product counts ONCE per order even if it appears on several
 * lines of that order (co-occurrence is per order, not per line).
 */
export function rankBoughtTogether(
  lines: BoughtTogetherLine[],
  targetProductId: string,
  activeProductIds: Set<string>,
  limit = 4,
): Array<{ productId: string; count: number }> {
  const targetOrders = new Set<string>();
  for (const line of lines) {
    if (line.isGift) continue;
    if (line.productId && String(line.productId) === targetProductId) {
      targetOrders.add(String(line.orderId));
    }
  }
  if (targetOrders.size === 0) return [];

  const perOrder = new Map<string, Set<string>>();
  for (const line of lines) {
    if (line.isGift) continue;
    if (!line.productId) continue;
    const pid = String(line.productId);
    if (pid === targetProductId) continue;
    if (!targetOrders.has(String(line.orderId))) continue;
    if (!activeProductIds.has(pid)) continue;
    const set = perOrder.get(pid) ?? new Set<string>();
    set.add(String(line.orderId));
    perOrder.set(pid, set);
  }

  return [...perOrder.entries()]
    .map(([productId, orders]) => ({ productId, count: orders.size }))
    .filter((e) => e.count >= 2)
    .sort((a, b) => (b.count - a.count) || (a.productId < b.productId ? -1 : a.productId > b.productId ? 1 : 0))
    .slice(0, limit);
}

/**
 * AB6 (AX14) — multi-seed variant of rankBoughtTogether for the
 * cart cross-sell: rank products co-occurring with ANY of the
 * seed products (the cart's contents) in the same sold orders.
 *
 * Rules mirror rankBoughtTogether exactly: gift lines never
 * count; a candidate counts ONCE per order even on several
 * lines; the seeds themselves are excluded; a candidate needs
 * >= 2 co-occurring orders; only `activeProductIds` are
 * returned; order is count desc, ties by productId asc, at most
 * `limit` entries.
 */
export function rankBoughtTogetherForSeeds(
  lines: BoughtTogetherLine[],
  seedProductIds: string[],
  activeProductIds: Set<string>,
  limit = 8,
): Array<{ productId: string; count: number }> {
  const seeds = new Set(seedProductIds.map((id) => String(id)));
  if (seeds.size === 0) return [];

  const seedOrders = new Set<string>();
  for (const line of lines) {
    if (line.isGift) continue;
    if (line.productId && seeds.has(String(line.productId))) {
      seedOrders.add(String(line.orderId));
    }
  }
  if (seedOrders.size === 0) return [];

  const perOrder = new Map<string, Set<string>>();
  for (const line of lines) {
    if (line.isGift) continue;
    if (!line.productId) continue;
    const pid = String(line.productId);
    if (seeds.has(pid)) continue;
    if (!seedOrders.has(String(line.orderId))) continue;
    if (!activeProductIds.has(pid)) continue;
    const set = perOrder.get(pid) ?? new Set<string>();
    set.add(String(line.orderId));
    perOrder.set(pid, set);
  }

  return [...perOrder.entries()]
    .map(([productId, orders]) => ({ productId, count: orders.size }))
    .filter((e) => e.count >= 2)
    .sort((a, b) => (b.count - a.count) || (a.productId < b.productId ? -1 : a.productId > b.productId ? 1 : 0))
    .slice(0, limit);
}
