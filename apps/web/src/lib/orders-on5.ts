/**
 * ON5 + ON6 (Orders Next): notification-settings, delivery-attempt
 * and SLA label helpers for the Orders Command Center and the
 * Dispatch board. Pure, side-effect free, unit-testable.
 *
 * The event / channel / variable / outcome vocabularies here are
 * the FIXED API vocabularies of apps/api/src/order-notifications
 * (NOTIFICATION_EVENTS / NOTIFICATION_CHANNELS / TEMPLATE_VARIABLES)
 * and apps/api/src/fulfillment (DELIVERY_ATTEMPT_OUTCOMES, sla.ts
 * stages) — never invent a key the server does not accept.
 */

export const NOTIFICATION_EVENTS = [
  "order_placed", "order_packed", "handed_to_courier", "out_for_delivery",
  "delivered", "delivery_failed", "parcel_stuck", "delivery_rescheduled",
] as const;
export type NotificationEventKey = (typeof NOTIFICATION_EVENTS)[number];

/** Bengali label per notification event key. */
export const NOTIFICATION_EVENT_LABEL: Record<string, string> = {
  order_placed: "অর্ডার গৃহীত",
  order_packed: "অর্ডার প্যাক হয়েছে",
  handed_to_courier: "কুরিয়ারে হস্তান্তর",
  out_for_delivery: "ডেলিভারির পথে",
  delivered: "ডেলিভারি সম্পন্ন",
  delivery_failed: "ডেলিভারি ব্যর্থ",
  parcel_stuck: "পার্সেল আটকে আছে",
  delivery_rescheduled: "ডেলিভারি পুনঃনির্ধারিত",
};
export function notificationEventLabel(key?: string | null): string {
  if (!key) return "—";
  return NOTIFICATION_EVENT_LABEL[key] ?? key;
}

/** Canonical channel order — channels are tried in THIS order. */
export const NOTIFICATION_CHANNELS = ["sms", "whatsapp", "email"] as const;
export type NotificationChannelKey = (typeof NOTIFICATION_CHANNELS)[number];

export const NOTIFICATION_CHANNEL_LABEL: Record<string, string> = {
  sms: "SMS",
  whatsapp: "WhatsApp",
  email: "ইমেইল",
  // The log also writes these two pseudo-channels (ON5 service):
  // "none" when the setting was off, "legacy" when a pre-ON5 send
  // already covered the customer.
  none: "কোনো চ্যানেল নয়",
  legacy: "আগের সিস্টেম",
};
export function notificationChannelLabel(key?: string | null): string {
  if (!key) return "—";
  return NOTIFICATION_CHANNEL_LABEL[key] ?? key;
}

/** Bengali label per notification-log status (OrderNotificationLog.status). */
export const NOTIFICATION_STATUS_LABEL: Record<string, string> = {
  sent: "পাঠানো হয়েছে",
  failed_no_channel: "চ্যানেল নেই",
  failed_error: "ব্যর্থ",
  skipped_setting_off: "বন্ধ ছিল",
  covered_existing: "আগের বার্তায় হয়েছে",
};
export function notificationStatusLabel(key?: string | null): string {
  if (!key) return "—";
  return NOTIFICATION_STATUS_LABEL[key] ?? key;
}

/** The ONLY variables a template may use (server rejects others
 * with a 400 at settings-save time). */
export const TEMPLATE_VARIABLES = [
  "customerName", "orderNumber", "total", "due", "trackingUrl",
  "shopName", "courierName", "trackingCode", "rescheduleDate",
] as const;

/** One-line help for the template editor, e.g. "{{customerName}}, {{orderNumber}}, …". */
export const TEMPLATE_VARIABLE_HELP = TEMPLATE_VARIABLES.map((v) => `{{${v}}}`).join(", ");

// ---- ON6: delivery attempts ----

export interface DeliveryAttemptOutcome { key: string; label: string }

/** The five outcomes staff can record for a delivery attempt
 * (POST /orders/:orderId/delivery-attempts). */
export const DELIVERY_ATTEMPT_OUTCOMES: DeliveryAttemptOutcome[] = [
  { key: "customer_unavailable", label: "গ্রাহক পাওয়া যায়নি" },
  { key: "refused", label: "গ্রাহক নিতে অস্বীকার করেছেন" },
  { key: "address_issue", label: "ঠিকানায় সমস্যা" },
  { key: "rescheduled", label: "পুনঃনির্ধারিত" },
  { key: "other", label: "অন্যান্য" },
];
export function deliveryAttemptOutcomeLabel(key?: string | null): string {
  if (!key) return "—";
  return DELIVERY_ATTEMPT_OUTCOMES.find((o) => o.key === key)?.label ?? key;
}

// ---- ON6: SLA stages (fulfillment board rows) ----

/** Bengali label per SLA stage from sla.ts computeSlaStage. */
export const SLA_STAGE_LABEL: Record<string, string> = {
  awaiting_pack: "প্যাক বাকি",
  awaiting_handover: "হস্তান্তর বাকি",
  shipped: "পাঠানো হয়েছে",
  not_applicable: "প্রযোজ্য নয়",
};
export function slaStageLabel(key?: string | null): string {
  if (!key) return "—";
  return SLA_STAGE_LABEL[key] ?? key;
}

/** Human age for an SLA stage: "১ ঘণ্টার কম", "৫ ঘণ্টা",
 * "২ দিন ৩ ঘণ্টা". Null / invalid renders as "—" — never a
 * fabricated age. */
export function formatAge(ageHours?: number | null): string {
  if (ageHours == null || !Number.isFinite(ageHours) || ageHours < 0) return "—";
  const total = Math.floor(ageHours);
  if (total < 1) return "১ ঘণ্টার কম";
  if (total < 24) return `${total} ঘণ্টা`;
  const days = Math.floor(total / 24);
  const rem = total % 24;
  return rem > 0 ? `${days} দিন ${rem} ঘণ্টা` : `${days} দিন`;
}
