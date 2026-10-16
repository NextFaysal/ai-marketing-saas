/**
 * Normalize a list-endpoint response into an array.
 *
 * Some list endpoints return a bare array; others (e.g.
 * GET /organizations/:id/products since the EC pagination)
 * return an envelope { total, page, pageSize, items }.
 * Consumers that store the raw response and later call
 * .map/.filter on it crash the whole page when the shape
 * drifts ("x.map is not a function" — the 2026-10-15 live
 * campaign-builder crash). Routing every list response
 * through asList makes the consumer immune to the drift:
 * arrays pass through untouched, envelopes unwrap to their
 * items, anything else becomes an honest empty list.
 */
export function asList<T>(r: unknown): T[] {
  if (Array.isArray(r)) return r as T[];
  if (r && typeof r === "object" && Array.isArray((r as { items?: unknown }).items)) {
    return (r as { items: T[] }).items;
  }
  return [];
}
