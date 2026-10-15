/**
 * ON5 — Transactional Notification Engine: pure helpers.
 *
 * Config shape (stored as Json on OrderNotificationSetting):
 *   { [eventKey]: { enabled: boolean,
 *                   channels: Array<"sms"|"whatsapp"|"email">,
 *                   templates: { sms: string|null, whatsapp: string|null, email: string|null } } }
 *
 * Template variables (the ONLY allowed set): customerName,
 * orderNumber, total, due, trackingUrl, shopName, courierName,
 * trackingCode, rescheduleDate (ON6 — the YYYY-MM-DD date a
 * delivery was rescheduled to; "" when the notify call carries
 * none. The built-in delivery_rescheduled default deliberately
 * does NOT use it — a plain template cannot include it only
 * when non-empty — but merchant overrides may). Token syntax follows the codebase convention
 * (messaging/render.ts): {{variable}} — a single-brace {variable}
 * is also accepted for robustness. Unknown variables are a
 * validation error at settings-write time; at render time a
 * known variable with no value renders as "" (never invented).
 *
 * Money: total/due arrive as minor-unit BigInt (paisa) and are
 * rendered as ৳ amounts — whole taka with en-IN grouping when
 * divisible by 100, else 2 decimals. (The existing helpers did
 * not match this: fraud-score's takaFromMinor truncates paisa,
 * composer-blocks' formatPriceMinor always prints 2 decimals —
 * so this formatter is local to ON5, per the batch spec.)
 */

export const NOTIFICATION_EVENTS = [
  "order_placed",
  "order_packed",
  "handed_to_courier",
  "out_for_delivery",
  "delivered",
  "delivery_failed",
  "parcel_stuck",
  "delivery_rescheduled",
] as const;
export type NotificationEvent = (typeof NOTIFICATION_EVENTS)[number];

export const NOTIFICATION_CHANNELS = ["sms", "whatsapp", "email"] as const;
export type NotificationChannel = (typeof NOTIFICATION_CHANNELS)[number];

export const TEMPLATE_VARIABLES = [
  "customerName",
  "orderNumber",
  "total",
  "due",
  "trackingUrl",
  "shopName",
  "courierName",
  "trackingCode",
  "rescheduleDate",
] as const;

export interface EventConfig {
  enabled: boolean;
  channels: NotificationChannel[];
  templates: { sms: string | null; whatsapp: string | null; email: string | null };
}
export type NotificationConfig = Record<NotificationEvent, EventConfig>;

/** Built-in Bengali default templates per event (used when the
 * org has no override for that event+channel). */
export const DEFAULT_TEMPLATES: Record<NotificationEvent, string> = {
  order_placed:
    "আসসালামু আলাইকুম {{customerName}}, {{shopName}} থেকে আপনার অর্ডার {{orderNumber}} গ্রহণ করা হয়েছে। মোট: {{total}}। ধন্যবাদ!",
  order_packed:
    "আসসালামু আলাইকুম {{customerName}}, আপনার অর্ডার {{orderNumber}} প্যাক করা হয়েছে — শীঘ্রই কুরিয়ারে দেওয়া হবে। — {{shopName}}",
  handed_to_courier:
    "আসসালামু আলাইকুম {{customerName}}, আপনার অর্ডার {{orderNumber}} {{courierName}} কুরিয়ারে দেওয়া হয়েছে। ট্র্যাকিং কোড: {{trackingCode}}। ট্র্যাক করুন: {{trackingUrl}} — {{shopName}}",
  out_for_delivery:
    "আসসালামু আলাইকুম {{customerName}}, আপনার অর্ডার {{orderNumber}} আজ ডেলিভারির জন্য বের হয়েছে ({{courierName}})। বকেয়া: {{due}}। — {{shopName}}",
  delivered:
    "আসসালামু আলাইকুম {{customerName}}, আপনার অর্ডার {{orderNumber}} ডেলিভারি সম্পন্ন হয়েছে। {{shopName}} থেকে কেনাকাটা করার জন্য ধন্যবাদ!",
  delivery_failed:
    "আসসালামু আলাইকুম {{customerName}}, দুঃখিত — আপনার অর্ডার {{orderNumber}} ডেলিভারি করা যায়নি। বিস্তারিত জানতে {{shopName}}-এ যোগাযোগ করুন।",
  parcel_stuck:
    "আসসালামু আলাইকুম {{customerName}}, আপনার অর্ডার {{orderNumber}}-এর পার্সেলটি ({{courierName}}, ট্র্যাকিং: {{trackingCode}}) আটকে আছে বলে মনে হচ্ছে — আমরা খোঁজ নিচ্ছি। — {{shopName}}",
  delivery_rescheduled:
    "আসসালামু আলাইকুম {{customerName}}, আপনার অর্ডার {{orderNumber}}-এর ডেলিভারি পুনঃনির্ধারণ করা হয়েছে। ট্র্যাক করুন: {{trackingUrl}} — {{shopName}}",
};

function defaultEventConfig(event: NotificationEvent): EventConfig {
  return {
    // Only order_placed + delivered are ON by default; every
    // other lifecycle event is opt-in per org.
    enabled: event === "order_placed" || event === "delivered",
    channels: [...NOTIFICATION_CHANNELS],
    templates: { sms: null, whatsapp: null, email: null },
  };
}

export const DEFAULT_CONFIG: NotificationConfig = Object.fromEntries(
  NOTIFICATION_EVENTS.map((e) => [e, defaultEventConfig(e)]),
) as NotificationConfig;

/** Minor (paisa) BigInt → "৳1,250" / "৳1,250.50" (en-IN grouping). */
export function formatTakaMinor(minor: bigint | number | string | null | undefined): string {
  let v: bigint;
  try { v = BigInt(minor as any); } catch { v = 0n; }
  const negative = v < 0n;
  const abs = negative ? -v : v;
  const whole = abs / 100n;
  const rem = abs % 100n;
  const wholeStr = Number(whole).toLocaleString("en-IN");
  const body = rem === 0n ? wholeStr : `${wholeStr}.${String(rem).padStart(2, "0")}`;
  return `${negative ? "-" : ""}৳${body}`;
}

const TOKEN_RE = /\{\{\s*([A-Za-z0-9_]+)\s*\}\}|\{\s*([A-Za-z0-9_]+)\s*\}/g;

export function extractVariables(text: string): string[] {
  if (typeof text !== "string") return [];
  const out: string[] = [];
  for (const m of text.matchAll(TOKEN_RE)) {
    const name = m[1] ?? m[2];
    if (name && !out.includes(name)) out.push(name);
  }
  return out;
}

/** Replace known tokens; missing/unknown values → "" . */
export function renderTemplate(text: string, vars: Record<string, unknown>): string {
  if (typeof text !== "string") return "";
  return text.replace(TOKEN_RE, (_m, a, b) => {
    const key = a ?? b;
    const value = (vars as any)?.[key];
    return value === undefined || value === null ? "" : String(value);
  });
}

/** Returns a human (Bengali) error string, or null when valid.
 * A partial config is valid — missing events/channels/templates
 * fall back to defaults at merge time. */
export function validateConfig(config: unknown): string | null {
  if (config === null || config === undefined) return null;
  if (typeof config !== "object" || Array.isArray(config)) return "notification config একটি object হতে হবে";
  for (const [eventKey, raw] of Object.entries(config as Record<string, unknown>)) {
    if (!(NOTIFICATION_EVENTS as readonly string[]).includes(eventKey)) {
      return `অজানা notification event: "${eventKey}" — সঠিক event: ${NOTIFICATION_EVENTS.join(", ")}`;
    }
    if (raw === null || raw === undefined) continue;
    if (typeof raw !== "object" || Array.isArray(raw)) return `"${eventKey}" event-এর config একটি object হতে হবে`;
    const ev = raw as Record<string, unknown>;
    if (ev.enabled !== undefined && typeof ev.enabled !== "boolean") {
      return `"${eventKey}" event-এর enabled boolean হতে হবে`;
    }
    if (ev.channels !== undefined) {
      if (!Array.isArray(ev.channels)) return `"${eventKey}" event-এর channels একটি array হতে হবে`;
      for (const ch of ev.channels) {
        if (!(NOTIFICATION_CHANNELS as readonly string[]).includes(String(ch))) {
          return `"${eventKey}" event-এ অজানা channel: "${String(ch)}" — সঠিক channel: ${NOTIFICATION_CHANNELS.join(", ")}`;
        }
      }
    }
    if (ev.templates !== undefined) {
      if (ev.templates === null || typeof ev.templates !== "object" || Array.isArray(ev.templates)) {
        return `"${eventKey}" event-এর templates একটি object হতে হবে`;
      }
      for (const [channel, tpl] of Object.entries(ev.templates as Record<string, unknown>)) {
        if (!(NOTIFICATION_CHANNELS as readonly string[]).includes(channel)) {
          return `"${eventKey}" event-এর templates-এ অজানা channel: "${channel}"`;
        }
        if (tpl !== null && tpl !== undefined && typeof tpl !== "string") {
          return `"${eventKey}" event-এর ${channel} template string অথবা null হতে হবে`;
        }
        if (typeof tpl === "string") {
          for (const v of extractVariables(tpl)) {
            if (!(TEMPLATE_VARIABLES as readonly string[]).includes(v)) {
              return `"${eventKey}" event-এর ${channel} template-এ অজানা variable: "{{${v}}}" — সঠিক variable: ${TEMPLATE_VARIABLES.join(", ")}`;
            }
          }
        }
      }
    }
  }
  return null;
}

/** Deep-merge a stored (possibly partial/invalid) config over
 * DEFAULT_CONFIG. Invalid fragments degrade to defaults rather
 * than breaking a send — validation is enforced at write time. */
export function mergeConfig(stored: unknown): NotificationConfig {
  const out = JSON.parse(JSON.stringify(DEFAULT_CONFIG)) as NotificationConfig;
  if (!stored || typeof stored !== "object" || Array.isArray(stored)) return out;
  for (const event of NOTIFICATION_EVENTS) {
    const raw = (stored as Record<string, any>)[event];
    if (!raw || typeof raw !== "object") continue;
    const target = out[event];
    if (typeof raw.enabled === "boolean") target.enabled = raw.enabled;
    if (Array.isArray(raw.channels)) {
      target.channels = raw.channels.filter((c: unknown) =>
        (NOTIFICATION_CHANNELS as readonly string[]).includes(String(c)),
      ) as NotificationChannel[];
    }
    if (raw.templates && typeof raw.templates === "object") {
      for (const ch of NOTIFICATION_CHANNELS) {
        const tpl = raw.templates[ch];
        if (typeof tpl === "string" || tpl === null) target.templates[ch] = tpl;
      }
    }
  }
  return out;
}

/** The template actually sent for an event+channel: the org's
 * override when set (non-empty), else the built-in default. */
export function templateFor(config: NotificationConfig, event: NotificationEvent, channel: NotificationChannel): string {
  const override = config?.[event]?.templates?.[channel];
  if (typeof override === "string" && override.trim()) return override;
  return DEFAULT_TEMPLATES[event];
}
