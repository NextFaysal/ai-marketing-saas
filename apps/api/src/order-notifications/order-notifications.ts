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

/**
 * MB4 (ML11): the platform default templates live in the API
 * catalog (i18n/catalog/notifications.ts, bn+en) and render at
 * SEND time in the recipient's locale. DEFAULT_TEMPLATES keeps
 * its historical shape — the bn rendering of the catalog
 * entries — for existing callers/specs; DEFAULT_TEMPLATES_EN is
 * the en rendering. Merchant overrides stored on
 * OrderNotificationSetting are merchant-authored and are NEVER
 * translated (D-MB4-5): an override wins in every locale.
 */
import { NOTIFICATIONS_CATALOG } from "../i18n/catalog/notifications";
import type { ApiLocale } from "../i18n/catalog/send-locale";

const defaultKey = (event: NotificationEvent) =>
  `orderNotification.default.${event}` as keyof typeof NOTIFICATIONS_CATALOG;

export const DEFAULT_TEMPLATES: Record<NotificationEvent, string> = Object.fromEntries(
  NOTIFICATION_EVENTS.map((e) => [e, NOTIFICATIONS_CATALOG[defaultKey(e)].bn]),
) as Record<NotificationEvent, string>;

export const DEFAULT_TEMPLATES_EN: Record<NotificationEvent, string> = Object.fromEntries(
  NOTIFICATION_EVENTS.map((e) => [e, NOTIFICATIONS_CATALOG[defaultKey(e)].en]),
) as Record<NotificationEvent, string>;

/** The platform default template for an event in a locale. */
export function defaultTemplateFor(event: NotificationEvent, locale: ApiLocale): string {
  return NOTIFICATIONS_CATALOG[defaultKey(event)][locale] ?? DEFAULT_TEMPLATES[event];
}

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

/** Returns a human error string, or null when valid. The text
 * is the bn rendering of the notifications catalog entries
 * (CD-1: service-layer messages render in bn; the request
 * locale is applied by the global filter for coded errors).
 * A partial config is valid — missing events/channels/templates
 * fall back to defaults at merge time. */
export function validateConfig(config: unknown): string | null {
  const t = (key: keyof typeof NOTIFICATIONS_CATALOG, params: Record<string, unknown> = {}) =>
    NOTIFICATIONS_CATALOG[key].bn.replace(/\{\{\s*([A-Za-z0-9_]+)\s*\}\}/g, (_m, n: string) =>
      params[n] === undefined || params[n] === null ? "" : String(params[n]));
  if (config === null || config === undefined) return null;
  if (typeof config !== "object" || Array.isArray(config)) return t("orderNotification.config.notObject");
  for (const [eventKey, raw] of Object.entries(config as Record<string, unknown>)) {
    if (!(NOTIFICATION_EVENTS as readonly string[]).includes(eventKey)) {
      return t("orderNotification.config.unknownEvent", { eventKey, events: NOTIFICATION_EVENTS.join(", ") });
    }
    if (raw === null || raw === undefined) continue;
    if (typeof raw !== "object" || Array.isArray(raw)) return t("orderNotification.config.eventNotObject", { eventKey });
    const ev = raw as Record<string, unknown>;
    if (ev.enabled !== undefined && typeof ev.enabled !== "boolean") {
      return t("orderNotification.config.enabledNotBoolean", { eventKey });
    }
    if (ev.channels !== undefined) {
      if (!Array.isArray(ev.channels)) return t("orderNotification.config.channelsNotArray", { eventKey });
      for (const ch of ev.channels) {
        if (!(NOTIFICATION_CHANNELS as readonly string[]).includes(String(ch))) {
          return t("orderNotification.config.unknownChannel", { eventKey, channel: String(ch), channels: NOTIFICATION_CHANNELS.join(", ") });
        }
      }
    }
    if (ev.templates !== undefined) {
      if (ev.templates === null || typeof ev.templates !== "object" || Array.isArray(ev.templates)) {
        return t("orderNotification.config.templatesNotObject", { eventKey });
      }
      for (const [channel, tpl] of Object.entries(ev.templates as Record<string, unknown>)) {
        if (!(NOTIFICATION_CHANNELS as readonly string[]).includes(channel)) {
          return t("orderNotification.config.templatesUnknownChannel", { eventKey, channel });
        }
        if (tpl !== null && tpl !== undefined && typeof tpl !== "string") {
          return t("orderNotification.config.templateNotString", { eventKey, channel });
        }
        if (typeof tpl === "string") {
          for (const v of extractVariables(tpl)) {
            if (!(TEMPLATE_VARIABLES as readonly string[]).includes(v)) {
              return t("orderNotification.config.unknownVariable", { eventKey, channel, variable: v, variables: TEMPLATE_VARIABLES.join(", ") });
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

/**
 * ML11 send-time variant: a merchant override (merchant-authored,
 * D-MB4-5) is used verbatim in EVERY locale; only the platform
 * default follows the recipient locale.
 */
export function templateForLocale(
  config: NotificationConfig,
  event: NotificationEvent,
  channel: NotificationChannel,
  locale: ApiLocale,
): string {
  const override = config?.[event]?.templates?.[channel];
  if (typeof override === "string" && override.trim()) return override;
  return defaultTemplateFor(event, locale);
}
