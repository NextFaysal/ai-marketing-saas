/**
 * ON1 (Orders Next): pure helpers for the Orders Command Center.
 * Kept side-effect free so they are unit-testable like the other
 * lib modules. The server stays the authority for every filter —
 * these helpers only translate UI state <-> query params and the
 * saved-view payload shape.
 */

export interface QueueRow { key: string; label: string; count: number }
export interface SavedView {
  id: string; name: string; queue?: string | null;
  filters?: Record<string, string | boolean | null> | null;
}
export interface FeedItem {
  id: string; externalNumber?: string | null; source?: string | null;
  status: string; isCod: boolean; totalMinor: string;
  placedAt?: string | null; createdAt: string; updatedAt: string;
  changeKind: string; customerName?: string | null;
}

/** UI filter state for the command center (single source the page
 * uses to build the list query, the saved-view payload and the
 * reset action, so the three can never drift apart). */
export interface OrderFilters {
  queue: string; status: string; codOnly: boolean; practice: boolean;
  search: string; dateFrom: string; dateTo: string; district: string;
  provider: string; source: string; paymentState: string;
  minTotalTaka: string; maxTotalTaka: string; assigneeId: string;
  tag: string; sort: string;
  // ON4: persisted Fraud Shield band filter ("" = all bands).
  riskBand: string;
}

export const EMPTY_ORDER_FILTERS: OrderFilters = {
  queue: "", status: "", codOnly: false, practice: false, search: "",
  dateFrom: "", dateTo: "", district: "", provider: "", source: "",
  paymentState: "", minTotalTaka: "", maxTotalTaka: "", assigneeId: "",
  tag: "", sort: "placedAt_desc", riskBand: "",
};

/** Exact taka string -> minor-unit string. Returns null for input
 * that is not a plain non-negative amount with <= 2 decimals, so
 * the caller can refuse instead of sending a mangled filter. */
export function takaToMinor(raw: string): string | null {
  const t = raw.trim();
  if (!/^\d+(\.\d{1,2})?$/.test(t)) return null;
  const [whole, frac = ""] = t.split(".");
  return (BigInt(whole) * 100n + BigInt(frac.padEnd(2, "0") || "0")).toString();
}

/** Minor-unit string -> taka input string (saved-view prefill). */
export function minorToTaka(minor: string): string {
  try {
    const v = BigInt(minor);
    const whole = v / 100n; const frac = v % 100n;
    return frac === 0n ? whole.toString() : `${whole.toString()}.${String(frac).padStart(2, "0")}`;
  } catch { return ""; }
}

/** Build the GET /orders query params from filter state.
 * NOTE (ON1 contract): `queue` and the legacy `status` filter are
 * alternatives — when a queue is selected the queue wins and the
 * plain status param is NOT sent. */
export function buildOrderListParams(f: OrderFilters): URLSearchParams {
  const params = new URLSearchParams({ pageSize: "50" });
  if (f.queue) params.set("queue", f.queue);
  else if (f.status) params.set("status", f.status);
  if (f.codOnly) params.set("cod", "true");
  if (f.practice) params.set("practice", "1");
  if (f.search.trim()) params.set("search", f.search.trim());
  if (f.dateFrom) params.set("dateFrom", f.dateFrom);
  if (f.dateTo) params.set("dateTo", f.dateTo);
  if (f.district.trim()) params.set("district", f.district.trim());
  if (f.provider) params.set("provider", f.provider);
  if (f.source) params.set("source", f.source);
  if (f.paymentState) params.set("paymentState", f.paymentState);
  const min = f.minTotalTaka.trim() ? takaToMinor(f.minTotalTaka) : null;
  if (min !== null) params.set("minTotal", min);
  const max = f.maxTotalTaka.trim() ? takaToMinor(f.maxTotalTaka) : null;
  if (max !== null) params.set("maxTotal", max);
  if (f.assigneeId) params.set("assigneeId", f.assigneeId);
  if (f.tag.trim()) params.set("tag", f.tag.trim());
  if (f.riskBand) params.set("riskBand", f.riskBand);
  if (f.sort && f.sort !== "placedAt_desc") params.set("sort", f.sort);
  return params;
}

/** Serialize filter state into a saved-view payload. min/max are
 * stored as minor-unit strings, exactly as the list API takes
 * them, so a view round-trips without float error.
 * CONTRACT NOTE (verified against the API service's
 * LIST_V2_FILTER_KEYS whitelist): the COD flag is persisted as
 * `isCod` — a `cod` key is rejected by the server — and
 * `practice` is NOT in the whitelist at all, so the practice
 * toggle is deliberately not persisted (saving it would make
 * the whole view save fail with the server's verbatim error). */
export function filtersToViewPayload(f: OrderFilters): { queue?: string; filters: Record<string, string | boolean> } {
  const filters: Record<string, string | boolean> = {};
  if (f.status) filters.status = f.status;
  if (f.codOnly) filters.isCod = true;
  if (f.search.trim()) filters.search = f.search.trim();
  if (f.dateFrom) filters.dateFrom = f.dateFrom;
  if (f.dateTo) filters.dateTo = f.dateTo;
  if (f.district.trim()) filters.district = f.district.trim();
  if (f.provider) filters.provider = f.provider;
  if (f.source) filters.source = f.source;
  if (f.paymentState) filters.paymentState = f.paymentState;
  const min = f.minTotalTaka.trim() ? takaToMinor(f.minTotalTaka) : null;
  if (min !== null) filters.minTotal = min;
  const max = f.maxTotalTaka.trim() ? takaToMinor(f.maxTotalTaka) : null;
  if (max !== null) filters.maxTotal = max;
  if (f.assigneeId) filters.assigneeId = f.assigneeId;
  if (f.tag.trim()) filters.tag = f.tag.trim();
  if (f.riskBand) filters.riskBand = f.riskBand;
  if (f.sort) filters.sort = f.sort;
  return { ...(f.queue ? { queue: f.queue } : {}), filters };
}

/** Rebuild full filter state from a saved view (unknown keys are
 * ignored; missing keys fall back to the empty defaults). */
export function viewToFilters(view: SavedView): OrderFilters {
  const v = view.filters ?? {};
  const s = (k: string) => (typeof v[k] === "string" ? (v[k] as string) : "");
  return {
    ...EMPTY_ORDER_FILTERS,
    queue: view.queue ?? s("queue"),
    // `isCod` is the persisted key; `cod` is read too so a view
    // written by an older client still restores. `practice` is
    // never persisted (see filtersToViewPayload) — always false.
    status: s("status"), codOnly: v.isCod === true || v.cod === true, practice: false,
    search: s("search"), dateFrom: s("dateFrom"), dateTo: s("dateTo"),
    district: s("district"), provider: s("provider"), source: s("source"),
    paymentState: s("paymentState"),
    minTotalTaka: s("minTotal") ? minorToTaka(s("minTotal")) : "",
    maxTotalTaka: s("maxTotal") ? minorToTaka(s("maxTotal")) : "",
    assigneeId: s("assigneeId"), tag: s("tag"),
    sort: s("sort") || "placedAt_desc",
    riskBand: s("riskBand"),
  };
}

/** Feed poll bookkeeping: given the items returned for
 * `since = previous watermark`, count genuinely NEW orders
 * (changeKind "created" created after the initial page load) and
 * compute the next watermark. Updates to existing orders advance
 * the watermark but never raise the "new orders" pill. */
export function feedAdvance(
  items: FeedItem[], watermarkIso: string, initialLoadIso: string,
): { newCreated: number; nextWatermark: string } {
  let next = watermarkIso;
  let newCreated = 0;
  for (const it of items) {
    const stamp = it.updatedAt || it.createdAt;
    if (stamp && stamp > next) next = stamp;
    if (it.changeKind === "created" && it.createdAt > initialLoadIso) newCreated += 1;
  }
  return { newCreated, nextWatermark: next };
}
