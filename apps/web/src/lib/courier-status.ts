/**
 * Inbox Next-Gen P2: courier tracking widget status mapping.
 *
 * CourierShipment.status is a free-form string in the courier's
 * own words (no normalized enum exists in the schema). This maps
 * the statuses the three providers are known to emit onto a
 * 5-step progress stepper:
 *
 *   step 0  বুক হয়েছে            created | booked
 *   step 1  রিভিউ / পেন্ডিং        in_review | pending
 *   step 2  পথে আছে               in_transit
 *   step 3  ডেলিভারির পথে          out_for_delivery
 *   step 4  ডেলিভার্ড              delivered | partial_delivered
 *
 * `returned` and `cancelled` are terminal SIDE states — shown as
 * their own banner, never forced onto the happy path. ANY other
 * status is "unknown": the widget shows the courier's own words
 * verbatim with NO stepper guess. Matching is case-insensitive
 * and treats spaces/hyphens as underscores.
 */
export const COURIER_STEP_LABELS = [
  "বুক হয়েছে",
  "রিভিউ / পেন্ডিং",
  "পথে আছে",
  "ডেলিভারির পথে",
  "ডেলিভার্ড",
] as const;

export type CourierStatusView =
  | { kind: "progress"; step: number; partial: boolean }
  | { kind: "returned" }
  | { kind: "cancelled" }
  | { kind: "unknown" };

export function courierStatusView(status: string | null | undefined): CourierStatusView {
  const s = String(status ?? "").trim().toLowerCase().replace(/[\s-]+/g, "_");
  if (s === "returned" || s === "return") return { kind: "returned" };
  if (s === "cancelled" || s === "canceled" || s === "cancel") return { kind: "cancelled" };
  if (s === "delivered") return { kind: "progress", step: 4, partial: false };
  if (s === "partial_delivered" || s === "partially_delivered") return { kind: "progress", step: 4, partial: true };
  if (s === "out_for_delivery") return { kind: "progress", step: 3, partial: false };
  if (s === "in_transit" || s === "transit" || s === "on_the_way") return { kind: "progress", step: 2, partial: false };
  if (s === "in_review" || s === "pending" || s === "review") return { kind: "progress", step: 1, partial: false };
  if (s === "created" || s === "booked" || s === "booking_confirmed") return { kind: "progress", step: 0, partial: false };
  return { kind: "unknown" };
}
