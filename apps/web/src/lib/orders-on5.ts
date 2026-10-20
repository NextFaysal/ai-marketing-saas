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
import { ordersBn, ordersEn } from "@/lib/i18n/orders";
import { interpolate } from "@/lib/i18n/lookup";

/** ML5 i18n: locale for lib label helpers — defaults to bn so
 * existing callers and tests keep the Bengali copy. */
export type LibLocale = "bn" | "en";
const D = (locale?: string): typeof ordersBn =>
  locale === "en" ? ordersEn : ordersBn;


export const NOTIFICATION_EVENTS = [
  "order_placed", "order_packed", "handed_to_courier", "out_for_delivery",
  "delivered", "delivery_failed", "parcel_stuck", "delivery_rescheduled",
] as const;
export type NotificationEventKey = (typeof NOTIFICATION_EVENTS)[number];

/** Bengali label per notification event key. */
export const NOTIFICATION_EVENT_LABEL: Record<string, string> = {
  order_placed: ordersBn.orderReceived,
  order_packed: ordersBn.orderPacked,
  handed_to_courier: ordersBn.handedToCourier,
  out_for_delivery: ordersBn.outForDelivery,
  delivered: ordersBn.delivered,
  delivery_failed: ordersBn.deliveryFailed,
  parcel_stuck: ordersBn.parcelIsStuck,
  delivery_rescheduled: ordersBn.deliveryRescheduled2,
};
export function notificationEventLabel(key?: string | null, locale: LibLocale = "bn"): string {
  if (!key) return "—";
  const d = D(locale);
  const map: Record<string, string> = {
    order_placed: d.orderReceived, order_packed: d.orderPacked,
    handed_to_courier: d.handedToCourier, out_for_delivery: d.outForDelivery,
    delivered: d.delivered, delivery_failed: d.deliveryFailed,
    parcel_stuck: d.parcelIsStuck, delivery_rescheduled: d.deliveryRescheduled2,
  };
  return map[key] ?? key;
}

/** Canonical channel order — channels are tried in THIS order. */
export const NOTIFICATION_CHANNELS = ["sms", "whatsapp", "email"] as const;
export type NotificationChannelKey = (typeof NOTIFICATION_CHANNELS)[number];

export const NOTIFICATION_CHANNEL_LABEL: Record<string, string> = {
  sms: "SMS",
  whatsapp: "WhatsApp",
  email: ordersBn.email,
  // The log also writes these two pseudo-channels (ON5 service):
  // "none" when the setting was off, "legacy" when a pre-ON5 send
  // already covered the customer.
  none: ordersBn.noChannel,
  legacy: ordersBn.previousSystem,
};
export function notificationChannelLabel(key?: string | null, locale: LibLocale = "bn"): string {
  if (!key) return "—";
  const d = D(locale);
  const map: Record<string, string> = {
    sms: "SMS", whatsapp: "WhatsApp", email: d.email,
    none: d.noChannel, legacy: d.previousSystem,
  };
  return map[key] ?? key;
}

/** Bengali label per notification-log status (OrderNotificationLog.status). */
export const NOTIFICATION_STATUS_LABEL: Record<string, string> = {
  sent: ordersBn.sent,
  failed_no_channel: ordersBn.noChannel2,
  failed_error: ordersBn.failed,
  skipped_setting_off: ordersBn.wasOff,
  covered_existing: ordersBn.happenedInThePreviousMessage,
};
export function notificationStatusLabel(key?: string | null, locale: LibLocale = "bn"): string {
  if (!key) return "—";
  const d = D(locale);
  const map: Record<string, string> = {
    sent: d.sent, failed_no_channel: d.noChannel2, failed_error: d.failed,
    skipped_setting_off: d.wasOff, covered_existing: d.happenedInThePreviousMessage,
  };
  return map[key] ?? key;
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
  { key: "customer_unavailable", label: ordersBn.customerNotFound },
  { key: "refused", label: ordersBn.customerRefusedToReceive },
  { key: "address_issue", label: ordersBn.addressProblem },
  { key: "rescheduled", label: ordersBn.rescheduled },
  { key: "other", label: ordersBn.other },
];
export function deliveryAttemptOutcomes(locale: LibLocale = "bn"): DeliveryAttemptOutcome[] {
  const d = D(locale);
  return [
    { key: "customer_unavailable", label: d.customerNotFound },
    { key: "refused", label: d.customerRefusedToReceive },
    { key: "address_issue", label: d.addressProblem },
    { key: "rescheduled", label: d.rescheduled },
    { key: "other", label: d.other },
  ];
}
export function deliveryAttemptOutcomeLabel(key?: string | null, locale: LibLocale = "bn"): string {
  if (!key) return "—";
  return deliveryAttemptOutcomes(locale).find((o) => o.key === key)?.label ?? key;
}

// ---- ON6: SLA stages (fulfillment board rows) ----

/** Bengali label per SLA stage from sla.ts computeSlaStage. */
export const SLA_STAGE_LABEL: Record<string, string> = {
  awaiting_pack: ordersBn.packingPending,
  awaiting_handover: ordersBn.handoverPending,
  shipped: ordersBn.sent,
  not_applicable: ordersBn.notApplicable,
};
export function slaStageLabel(key?: string | null, locale: LibLocale = "bn"): string {
  if (!key) return "—";
  const d = D(locale);
  const map: Record<string, string> = {
    awaiting_pack: d.packingPending, awaiting_handover: d.handoverPending,
    shipped: d.sent, not_applicable: d.notApplicable,
  };
  return map[key] ?? key;
}

/** Human age for an SLA stage: "১ ঘণ্টার কম", "৫ ঘণ্টা",
 * "২ দিন ৩ ঘণ্টা". Null / invalid renders as "—" — never a
 * fabricated age. */
export function formatAge(ageHours?: number | null, locale: LibLocale = "bn"): string {
  if (ageHours == null || !Number.isFinite(ageHours) || ageHours < 0) return "—";
  const d = D(locale);
  const total = Math.floor(ageHours);
  if (total < 1) return d.lessThan1Hour;
  if (total < 24) return interpolate(d.hours2, { total: total });
  const days = Math.floor(total / 24);
  const rem = total % 24;
  return rem > 0 ? interpolate(d.daysHours, { days: days, rem: rem }) : interpolate(d.days2, { days: days });
}

/** Built-in Bengali default templates per notification event. */
export const DEFAULT_TEMPLATES: Record<NotificationEventKey, string> = {
  order_placed:
    ordersBn.assalamuAlaikumYourOrderFrom,
  order_packed:
    ordersBn.assalamuAlaikumYourOrderHas,
  handed_to_courier:
    ordersBn.assalamuAlaikumYourOrderHas2,
  out_for_delivery:
    ordersBn.assalamuAlaikumYourOrderIs,
  delivered:
    ordersBn.assalamuAlaikumYourOrderHas3,
  delivery_failed:
    ordersBn.assalamuAlaikumSorryYourOrder,
  parcel_stuck:
    ordersBn.assalamuAlaikumYourOrderS,
  delivery_rescheduled:
    ordersBn.assalamuAlaikumYourOrderS2,
};

/** Render template with token replacements, missing variables produce empty string. */
export function renderNotificationTemplate(
  template: string,
  vars: Record<string, string | number | null | undefined>
): string {
  if (!template) return "";
  const tokenRegex = /\{\{\s*([A-Za-z0-9_]+)\s*\}\}|\{\s*([A-Za-z0-9_]+)\s*\}/g;
  return template.replace(tokenRegex, (_match, a, b) => {
    const key = a || b;
    const val = vars[key];
    return val === undefined || val === null ? "" : String(val);
  });
}

/**
 * Calculate characters and standard Bangladeshi SMS segments.
 * GSM-7 (standard English): 160 chars for 1 segment, 153 chars/segment for multi-part.
 * Unicode (Bengali script): 70 chars for 1 segment, 67 chars/segment for multi-part.
 */
export function calculateSmsSegments(text: string): {
  chars: number;
  segments: number;
  isUnicode: boolean;
  maxPerSegment: number;
} {
  const chars = text ? Array.from(text).length : 0;
  if (chars === 0) {
    return { chars: 0, segments: 0, isUnicode: false, maxPerSegment: 160 };
  }

  // Detect non-ASCII/Unicode (e.g. Bengali characters)
  const isUnicode = /[^\u0000-\u007F]/.test(text);

  if (isUnicode) {
    if (chars <= 70) {
      return { chars, segments: 1, isUnicode: true, maxPerSegment: 70 };
    }
    const segments = Math.ceil(chars / 67);
    return { chars, segments, isUnicode: true, maxPerSegment: 67 };
  } else {
    if (chars <= 160) {
      return { chars, segments: 1, isUnicode: false, maxPerSegment: 160 };
    }
    const segments = Math.ceil(chars / 153);
    return { chars, segments, isUnicode: false, maxPerSegment: 153 };
  }
}

/** Generate wa.me WhatsApp Click-to-Chat URL for BD customer phone */
export function generateWhatsAppTrackingShareUrl(phone: string, text: string): string {
  const digits = (phone || "").replace(/\D/g, "");
  let bdPhone = digits;
  if (digits.startsWith("01") && digits.length === 11) {
    bdPhone = `88${digits}`;
  } else if (digits.startsWith("+8801")) {
    bdPhone = digits.replace("+", "");
  }
  const encoded = encodeURIComponent(text);
  return `https://wa.me/${bdPhone}?text=${encoded}`;
}


/** ML5 i18n: locale-aware default message templates. */
export function defaultTemplates(locale: LibLocale = "bn"): Record<NotificationEventKey, string> {
  if (locale !== "en") return DEFAULT_TEMPLATES;
  const d = ordersEn;
  return {
    order_placed: d.assalamuAlaikumYourOrderFrom,
    order_packed: d.assalamuAlaikumYourOrderHas,
    handed_to_courier: d.assalamuAlaikumYourOrderHas2,
    out_for_delivery: d.assalamuAlaikumYourOrderIs,
    delivered: d.assalamuAlaikumYourOrderHas3,
    delivery_failed: d.assalamuAlaikumSorryYourOrder,
    parcel_stuck: d.assalamuAlaikumYourOrderS,
    delivery_rescheduled: d.assalamuAlaikumYourOrderS2,
  };
}
