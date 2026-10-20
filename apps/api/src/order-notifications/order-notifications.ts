/**
 * ON5 — Transactional Notification Engine: pure helpers.
 *
 * Config shape (stored as Json on OrderNotificationSetting):
 *   { [eventKey]: { enabled: boolean,
 *                   channels: Array<"sms"|"whatsapp"|"email">,
 *                   templates: { sms: TemplateOverride, whatsapp: TemplateOverride, email: TemplateOverride } } }
 *
 * MB5 (ML14, CD-2): a TemplateOverride is either a plain string
 * (a GENERIC merchant override — used verbatim in every locale,
 * exactly the pre-ML14 meaning, so every existing stored config
 * behaves byte-identically) or an object
 * `{ bn?: string|null, en?: string|null }` holding the merchant's
 * OWN per-locale overrides. Nothing here ever machine-translates
 * merchant text (D-MB4-5 stands) — the object form is simply two
 * slots the merchant fills in themselves.
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

/** MB5 (ML14): the merchant's own per-locale template overrides. */
export interface TemplateLocaleVariants {
  bn?: string | null;
  en?: string | null;
}
export type TemplateOverride = string | TemplateLocaleVariants | null;

export interface EventConfig {
  enabled: boolean;
  channels: NotificationChannel[];
  templates: { sms: TemplateOverride; whatsapp: TemplateOverride; email: TemplateOverride };
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

const BENGALI_DIGITS = ["০", "১", "২", "৩", "৪", "৫", "৬", "৭", "৮", "৯"];
const toBengaliDigits = (s: string): string => s.replace(/[0-9]/g, (d) => BENGALI_DIGITS[Number(d)]);

/**
 * Minor (paisa) BigInt → "৳1,250" / "৳1,250.50" (en-IN grouping).
 *
 * MB5 (ML14, CD-2): with locale "bn" the amount renders the way
 * packages/contracts fmtMoneyMinor pins for bn-BD — Bengali
 * digits with bn-BD (lakh) grouping: "৳১,২৫০" / "৳১,২৫০.৫০"
 * (the decimal separator stays "." — that is what Intl bn-BD
 * produces and what the contracts tests pin). No locale (or
 * "en") keeps the historical Latin/en-IN rendering EXACTLY, so
 * existing callers (e.g. order-automation) are unchanged.
 */
export function formatTakaMinor(
  minor: bigint | number | string | null | undefined,
  locale?: ApiLocale,
): string {
  let v: bigint;
  try { v = BigInt(minor as any); } catch { v = 0n; }
  const negative = v < 0n;
  const abs = negative ? -v : v;
  const whole = abs / 100n;
  const rem = abs % 100n;
  if (locale === "bn") {
    const wholeStr = new Intl.NumberFormat("bn-BD").format(whole);
    const body = rem === 0n ? wholeStr : `${wholeStr}.${toBengaliDigits(String(rem).padStart(2, "0"))}`;
    return `${negative ? "-" : ""}৳${body}`;
  }
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
        // MB5 (ML14): a template slot is a string (generic
        // override), null, or a per-locale object
        // { bn?, en? } whose entries are string|null. Variables
        // are validated in EVERY locale entry, not just the
        // generic string.
        const unknownVariable = (text: string) => {
          for (const v of extractVariables(text)) {
            if (!(TEMPLATE_VARIABLES as readonly string[]).includes(v)) return v;
          }
          return null;
        };
        if (tpl !== null && tpl !== undefined && typeof tpl !== "string") {
          if (typeof tpl !== "object" || Array.isArray(tpl)) {
            return t("orderNotification.config.templateNotString", { eventKey, channel });
          }
          for (const [loc, variant] of Object.entries(tpl as Record<string, unknown>)) {
            if (loc !== "bn" && loc !== "en") {
              return t("orderNotification.config.templateUnknownLocale", { eventKey, channel, locale: loc });
            }
            if (variant !== null && variant !== undefined && typeof variant !== "string") {
              return t("orderNotification.config.templateVariantNotString", { eventKey, channel, locale: loc });
            }
            if (typeof variant === "string") {
              const bad = unknownVariable(variant);
              if (bad) {
                return t("orderNotification.config.unknownVariable", { eventKey, channel, variable: bad, variables: TEMPLATE_VARIABLES.join(", ") });
              }
            }
          }
          continue;
        }
        if (typeof tpl === "string") {
          const bad = unknownVariable(tpl);
          if (bad) {
            return t("orderNotification.config.unknownVariable", { eventKey, channel, variable: bad, variables: TEMPLATE_VARIABLES.join(", ") });
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
        if (typeof tpl === "string" || tpl === null) {
          target.templates[ch] = tpl;
        } else if (tpl && typeof tpl === "object" && !Array.isArray(tpl)) {
          // MB5 (ML14): keep a per-locale object only when it is
          // well-formed (bn/en keys, string|null entries) — a
          // malformed variant fragment degrades to the default
          // (null), the same rule as every other fragment here.
          const clean: TemplateLocaleVariants = {};
          let ok = true;
          for (const [loc, variant] of Object.entries(tpl as Record<string, unknown>)) {
            if (loc !== "bn" && loc !== "en") { ok = false; break; }
            if (variant !== null && variant !== undefined && typeof variant !== "string") { ok = false; break; }
            clean[loc as "bn" | "en"] = (variant ?? null) as string | null;
          }
          if (ok) target.templates[ch] = clean;
        }
      }
    }
  }
  return out;
}

/** The template actually sent for an event+channel: the org's
 * override when set (non-empty), else the built-in default.
 * (Locale-less legacy helper — the bn view: a per-locale object
 * contributes its bn entry here.) */
export function templateFor(config: NotificationConfig, event: NotificationEvent, channel: NotificationChannel): string {
  const override = config?.[event]?.templates?.[channel];
  if (typeof override === "string" && override.trim()) return override;
  if (override && typeof override === "object") {
    const bn = override.bn;
    if (typeof bn === "string" && bn.trim()) return bn;
  }
  return DEFAULT_TEMPLATES[event];
}

/**
 * ML11 send-time resolution, extended by ML14 (CD-2) into ONE
 * mechanism with three rungs:
 *   1. a per-locale variant object: the entry for the RECIPIENT
 *      locale, when present and non-empty;
 *   2. a generic string override (merchant-authored, D-MB4-5) —
 *      used verbatim in EVERY locale, unchanged from ML11;
 *   3. the platform catalog default IN the recipient locale.
 * Deliberate (CD-2): a variant object holding ONLY the other
 * locale falls to rung 3 — the merchant scoped that text to the
 * other language, so serving it here would recreate exactly the
 * language-mixing problem ML14 exists to fix.
 */
export function templateForLocale(
  config: NotificationConfig,
  event: NotificationEvent,
  channel: NotificationChannel,
  locale: ApiLocale,
): string {
  const override = config?.[event]?.templates?.[channel];
  if (typeof override === "string" && override.trim()) return override;
  if (override && typeof override === "object") {
    const variant = override[locale];
    if (typeof variant === "string" && variant.trim()) return variant;
  }
  return defaultTemplateFor(event, locale);
}
