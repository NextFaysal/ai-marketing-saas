/**
 * AB3 (AX4) — multi-warehouse stock helpers for the Warehouse
 * page, the order detail and the PickWave board. Pure,
 * side-effect free, unit-testable.
 *
 * The vocabularies here are the FIXED API vocabularies of
 * apps/api/src/warehouse (StockTransfer.status) and the AB3
 * allocation rows (StockAllocation.status active|settled) —
 * never invent a key the server does not emit.
 */

/** One row of GET commerce/stock-balances / an order's
 * allocations[] / a PickWave order's allocations[] — the label
 * fields the three AB3 read payloads share. */
export interface AllocationLike {
  warehouseName?: string | null;
  binCode?: string | null;
  qty: number;
}

/** A StockAllocation row from the order detail payload
 * (orders getOne → allocations[]). */
export interface OrderAllocation extends AllocationLike {
  id: string;
  orderItemId?: string | null;
  productId: string;
  variantId?: string | null;
  warehouseId: string;
  binId: string;
  status: string;
}

// ---------- stock transfers ----------

export const TRANSFER_STATUSES = [
  "draft", "in_transit", "received", "received_with_variance", "cancelled",
] as const;

export const TRANSFER_STATUS_LABEL: Record<string, string> = {
  draft: "খসড়া",
  in_transit: "পথে আছে",
  received: "গ্রহণ সম্পন্ন",
  received_with_variance: "পার্থক্যসহ গ্রহণ",
  cancelled: "বাতিল",
};
export function transferStatusLabel(status?: string | null): string {
  if (!status) return "—";
  return TRANSFER_STATUS_LABEL[status] ?? status;
}

export function transferStatusCls(status?: string | null): string {
  switch (status) {
    case "draft": return "bg-slate-200 text-slate-700";
    case "in_transit": return "bg-amber-100 text-amber-700";
    case "received": return "bg-green-100 text-green-700";
    case "received_with_variance": return "bg-orange-100 text-orange-700";
    case "cancelled": return "bg-red-100 text-red-700";
    default: return "bg-slate-200 text-slate-600";
  }
}

/** Variance of one transfer line: units sent but never received.
 * An unreceived line (qtyReceived null, transfer still open)
 * has NO variance yet — the units are in transit, not lost. */
export function transferLineVariance(line: { qtySent: number; qtyReceived?: number | null }): number {
  if (line.qtyReceived == null) return 0;
  return Math.max(0, (Number(line.qtySent) || 0) - (Number(line.qtyReceived) || 0));
}

/** Build the POST .../receive body from the per-line inputs:
 * a blank input means "received in full" (the API defaults
 * unlisted lines to qtySent, so blank lines are simply omitted);
 * a typed value is sent for that line. */
export function buildReceiveLines<T extends { id: string; qtySent: number }>(
  lines: T[],
  inputs: Record<string, string>,
): { lineId: string; qtyReceived: number }[] {
  const out: { lineId: string; qtyReceived: number }[] = [];
  for (const line of lines) {
    const raw = (inputs[line.id] ?? "").trim();
    if (raw === "") continue;
    const n = Number(raw);
    if (!Number.isInteger(n) || n < 0) continue;
    out.push({ lineId: line.id, qtyReceived: n });
  }
  return out;
}

// ---------- warehouse form ----------

/** Parse the serviceDistricts editor text (comma-separated, the
 * list-ish input pattern the dashboard already uses) into the
 * string array the warehouse API expects. The API validates +
 * canonicalizes against the BD district vocabulary and its
 * Bengali error is surfaced as-is — no client-side vocabulary. */
export function parseDistrictInput(text: string): string[] {
  const out: string[] = [];
  for (const part of (text ?? "").split(",")) {
    const name = part.trim();
    if (name && !out.includes(name)) out.push(name);
  }
  return out;
}

// ---------- stock counts ----------

/** Label a stock-count session's scope (the detail payload's
 * `scope` field; the list payload carries binLocationId, from
 * which the same label derives). */
export function countScopeLabel(scope?: string | null, binLocationId?: string | null): string {
  const s = scope ?? (binLocationId ? "bin" : "warehouse");
  return s === "bin" ? "বিন অনুযায়ী গণনা" : "গুদাম অনুযায়ী গণনা";
}

// ---------- allocations (order detail + pick waves) ----------

export function allocationStatusLabel(status?: string | null): string {
  if (status === "settled") return "নিষ্পত্তি";
  if (status === "active") return "সক্রিয়";
  return status ?? "—";
}

/** "Warehouse — BIN ×qty" chip text for one allocation label. */
export function allocationChipLabel(a: AllocationLike): string {
  const wh = a.warehouseName ?? "গুদাম অজানা";
  const bin = a.binCode ?? "বিন অজানা";
  return `${wh} — ${bin} ×${a.qty}`;
}

/** Collapse allocation labels into one chip per
 * (warehouse, bin), summing quantities — the PickWave order
 * summary. Order is first-seen, matching the API's oldest-first
 * allocation order. */
export function summarizeAllocations<T extends AllocationLike>(allocations: T[] | null | undefined): { key: string; label: string; qty: number }[] {
  const map = new Map<string, { key: string; label: string; qty: number }>();
  for (const a of allocations ?? []) {
    const key = `${a.warehouseName ?? ""}::${a.binCode ?? ""}`;
    const existing = map.get(key);
    if (existing) existing.qty += Number(a.qty) || 0;
    else map.set(key, { key, label: `${a.warehouseName ?? "গুদাম অজানা"} — ${a.binCode ?? "বিন অজানা"}`, qty: Number(a.qty) || 0 });
  }
  return [...map.values()];
}

export interface AllocationGroup {
  /** orderItemId, or a synthetic key for component rows. */
  key: string;
  orderItemId: string | null;
  productId: string;
  variantId: string | null;
  allocations: OrderAllocation[];
  totalQty: number;
  hasActive: boolean;
}

/** Group an order's allocations per item: rows with an
 * orderItemId group under that item; bundle-component rows
 * (orderItemId null) group per (product, variant). */
export function groupAllocationsByItem(allocations: OrderAllocation[] | null | undefined): AllocationGroup[] {
  const map = new Map<string, AllocationGroup>();
  for (const a of allocations ?? []) {
    const key = a.orderItemId ?? `component:${a.productId}::${a.variantId ?? ""}`;
    let g = map.get(key);
    if (!g) {
      g = {
        key, orderItemId: a.orderItemId ?? null,
        productId: a.productId, variantId: a.variantId ?? null,
        allocations: [], totalQty: 0, hasActive: false,
      };
      map.set(key, g);
    }
    g.allocations.push(a);
    g.totalQty += Number(a.qty) || 0;
    if (a.status === "active") g.hasActive = true;
  }
  return [...map.values()];
}

/** True when the order still holds at least one active
 * allocation — the only state re-allocation can act on. */
export function hasActiveAllocations(allocations: OrderAllocation[] | null | undefined): boolean {
  return (allocations ?? []).some((a) => a.status === "active");
}
