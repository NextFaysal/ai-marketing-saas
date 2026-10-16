/**
 * ON1 — Orders Command Center v2: smart queue definitions.
 *
 * Pure constants + labels only; the predicates live in
 * OrdersService.resolveQueueOrderIds, which is the SINGLE code
 * path shared by the counts endpoint and the queue-filtered
 * list (so a count can never drift from its list).
 *
 * All queues exclude practice orders (isPractice = false).
 */

/** A parcel counts as "stuck in transit" when a shipment in an
 * in-flight status has not moved (no updatedAt bump) for this
 * many days. */
export const STUCK_DAYS = 4;

/** CourierShipment statuses that mean "booked, still moving".
 * Derived from the courier vocabulary in courier.service.ts:
 * the default booking status is "in_review" (booked, not yet
 * picked up — stuck there counts), steadfast/pathao/redx syncs
 * produce "picked_up" / "in_transit" / "out_for_delivery".
 * Terminal statuses (courier TERMINAL list) are deliberately
 * NOT here: delivered / partial_delivered / cancelled / returned. */
export const TRANSIT_STATUSES = ["in_review", "picked_up", "in_transit", "out_for_delivery"] as const;

/** CourierShipment terminal statuses (mirrors courier.service.ts). */
export const SHIPMENT_TERMINAL_STATUSES = ["delivered", "partial_delivered", "cancelled", "returned"] as const;

/** Order statuses that are DONE (terminal) — an order in one of
 * these is no longer "open". This is the ONE set the orders area
 * already uses: OrdersService's sla_breach open query excludes
 * exactly these (status notIn [...]), OrderAnalyticsService's
 * TERMINAL_ORDER_STATUSES is the same list, and fulfillment/sla.ts
 * DONE_STATUSES matches it. ON12 (team performance) reuses it for
 * its assignedOpen snapshot instead of inventing a parallel list.
 * Note it differs from the all_open QUEUE, which deliberately
 * keeps "delivered" out of its notIn list — the queue is a work
 * list, this set is the lifecycle-done definition. */
export const ORDER_TERMINAL_STATUSES = ["cancelled", "refunded", "failed", "returned", "delivered", "completed"] as const;

/** ReturnRequest statuses that mean a return is still open
 * (ReturnRequest vocabulary: requested | approved | rejected |
 * return_shipped | received | completed). */
export const OPEN_RETURN_STATUSES = ["requested", "approved", "return_shipped", "received"] as const;

export const QUEUE_KEYS = [
  "needs_confirmation",
  "ready_to_pack",
  "in_transit_stuck",
  "deliveries_today",
  "due_collection",
  "returns_open",
  "rto_attention",
  "review_hold",
  "incomplete_intake",
  "sla_breach",
  "all_open",
  "all",
] as const;

export type QueueKey = (typeof QUEUE_KEYS)[number];

export const QUEUE_LABELS: Record<QueueKey, string> = {
  needs_confirmation: "নিশ্চিত করা বাকি",
  ready_to_pack: "প্যাক করার জন্য তৈরি",
  in_transit_stuck: "কুরিয়ারে আটকে আছে",
  deliveries_today: "আজকের ডেলিভারি",
  due_collection: "বকেয়া আদায় বাকি",
  returns_open: "রিটার্ন চলমান",
  rto_attention: "RTO — ফেরত পার্সেল দেখা বাকি",
  review_hold: "পর্যালোচনার জন্য আটকানো",
  incomplete_intake: "তথ্য অসম্পূর্ণ অর্ডার",
  sla_breach: "SLA ভঙ্গ হয়েছে",
  all_open: "সব খোলা অর্ডার",
  all: "সব অর্ডার",
};

export function isQueueKey(value: unknown): value is QueueKey {
  return typeof value === "string" && (QUEUE_KEYS as readonly string[]).includes(value);
}

/** "YYYY-MM-DD" calendar day in Asia/Dhaka for `now`
 * (en-CA formats as YYYY-MM-DD). deliveryDate is stored in
 * exactly this string shape, so equality is the match. */
export function dhakaTodayString(now: Date = new Date()): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Dhaka" }).format(now);
}
