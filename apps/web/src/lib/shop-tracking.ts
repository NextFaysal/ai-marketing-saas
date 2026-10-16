/**
 * GB7 (GC18) — shop tracking-tag settings (pure helpers).
 *
 * The merchant's own GA4 / GTM / Google Ads / Search Console IDs
 * live in the storefront settings and arrive on the shop payload
 * as `settings.tracking`. Every field is null when unset — the
 * shop renders NO tag for a null field, and no platform ID is
 * ever hardcoded anywhere.
 */

export interface ShopTracking {
  ga4MeasurementId: string | null;
  gtmContainerId: string | null;
  googleAdsId: string | null;
  googleAdsConversionLabel: string | null;
  searchConsoleVerification: string | null;
}

export const EMPTY_TRACKING: ShopTracking = {
  ga4MeasurementId: null,
  gtmContainerId: null,
  googleAdsId: null,
  googleAdsConversionLabel: null,
  searchConsoleVerification: null,
};

function clean(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

/** Read `settings.tracking` off a shop payload; all null when absent. */
export function trackingFromSettings(settings: unknown): ShopTracking {
  const tracking =
    settings && typeof settings === "object"
      ? (settings as Record<string, unknown>).tracking
      : undefined;
  if (!tracking || typeof tracking !== "object") return { ...EMPTY_TRACKING };
  const t = tracking as Record<string, unknown>;
  return {
    ga4MeasurementId: clean(t.ga4MeasurementId),
    gtmContainerId: clean(t.gtmContainerId),
    googleAdsId: clean(t.googleAdsId),
    googleAdsConversionLabel: clean(t.googleAdsConversionLabel),
    searchConsoleVerification: clean(t.searchConsoleVerification),
  };
}

/* ------------------------------------------------------------------ */
/* AB7 (AX19) — first-touch order attribution capture.                 */
/*                                                                     */
/* Where attribution actually lives (verified 2026-10-16): the         */
/* first-party tracker (apps/web/public/tracker.js, installed on       */
/* merchant sites) builds a TrackingSession payload and stores it in   */
/* sessionStorage under `tp_sess`:                                     */
/*   { key, lastActivity, data: { utmSource, utmMedium, utmCampaign,   */
/*     utmContent, utmTerm, fbclid, gclid, ttclid, landingPage,        */
/*     referrer } }                                                    */
/* and posts it to the API, where it becomes TrackingSession rows.     */
/* The native shop does NOT load tracker.js, so inside the shop that   */
/* payload normally never exists. The helpers below therefore:         */
/*   1. read `tp_sess` when it is present (same key, same shape —      */
/*      the tracker client's own storage), and                         */
/*   2. capture utm/click params from window.location.search on shop   */
/*      landing into that SAME storage when no session exists yet.     */
/* First-touch wins: an existing `tp_sess` payload is NEVER            */
/* overwritten. Being sessionStorage, "first touch" is per browser     */
/* session — no durable cross-session first-touch store exists in      */
/* this codebase, and none is invented here.                           */
/* ------------------------------------------------------------------ */

export const TRACKING_SESSION_KEY = "tp_sess";

export type ClickIdType = "fbclid" | "gclid" | "ttclid";

/** The `attribution` object the checkout endpoints accept (AX19). */
export interface CheckoutAttribution {
  utmSource?: string;
  utmMedium?: string;
  utmCampaign?: string;
  utmContent?: string;
  utmTerm?: string;
  clickIdType?: ClickIdType;
  clickId?: string;
}

/** Raw tracker-session `data` shape (camelCase utm + raw click ids). */
export interface TrackingSessionData {
  utmSource?: string;
  utmMedium?: string;
  utmCampaign?: string;
  utmContent?: string;
  utmTerm?: string;
  fbclid?: string;
  gclid?: string;
  ttclid?: string;
}

interface AttributionStorageLike {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

function cleanAttributionValue(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  const v = value.trim();
  return v ? v.slice(0, 500) : undefined;
}

/**
 * Convert stored tracker-session data into the checkout attribution
 * shape. Accepts either the session `data` object itself or the
 * whole `tp_sess` payload (its `.data` is read). Click-id mapping:
 * the first present click id wins, in fbclid → gclid → ttclid
 * order, and `clickIdType` names which param it came from.
 * Returns undefined when nothing usable is stored.
 */
export function attributionFromSessionData(input: unknown): CheckoutAttribution | undefined {
  if (!input || typeof input !== "object") return undefined;
  const obj = input as Record<string, unknown>;
  const data =
    obj.data && typeof obj.data === "object" ? (obj.data as Record<string, unknown>) : obj;
  const out: CheckoutAttribution = {};
  const utmSource = cleanAttributionValue(data.utmSource);
  const utmMedium = cleanAttributionValue(data.utmMedium);
  const utmCampaign = cleanAttributionValue(data.utmCampaign);
  const utmContent = cleanAttributionValue(data.utmContent);
  const utmTerm = cleanAttributionValue(data.utmTerm);
  if (utmSource) out.utmSource = utmSource;
  if (utmMedium) out.utmMedium = utmMedium;
  if (utmCampaign) out.utmCampaign = utmCampaign;
  if (utmContent) out.utmContent = utmContent;
  if (utmTerm) out.utmTerm = utmTerm;
  const clickCandidates: Array<[ClickIdType, unknown]> = [
    ["fbclid", data.fbclid],
    ["gclid", data.gclid],
    ["ttclid", data.ttclid],
  ];
  for (const [type, raw] of clickCandidates) {
    const id = cleanAttributionValue(raw);
    if (id) {
      out.clickIdType = type;
      out.clickId = id;
      break;
    }
  }
  return Object.keys(out).length > 0 ? out : undefined;
}

/** Parse a raw `tp_sess` sessionStorage value into attribution. */
export function attributionFromStoredSession(raw: string | null | undefined): CheckoutAttribution | undefined {
  if (!raw) return undefined;
  try {
    return attributionFromSessionData(JSON.parse(raw));
  } catch {
    return undefined;
  }
}

/** Read utm/click params from a query string into tracker-session data. */
export function sessionDataFromSearch(search: string | URLSearchParams): TrackingSessionData | undefined {
  const params = typeof search === "string" ? new URLSearchParams(search) : search;
  const data: TrackingSessionData = {};
  const utmMap: Array<[string, keyof TrackingSessionData]> = [
    ["utm_source", "utmSource"],
    ["utm_medium", "utmMedium"],
    ["utm_campaign", "utmCampaign"],
    ["utm_content", "utmContent"],
    ["utm_term", "utmTerm"],
    ["fbclid", "fbclid"],
    ["gclid", "gclid"],
    ["ttclid", "ttclid"],
  ];
  for (const [param, key] of utmMap) {
    const v = cleanAttributionValue(params.get(param));
    if (v) data[key] = v;
  }
  return Object.keys(data).length > 0 ? data : undefined;
}

function defaultSessionStorage(): AttributionStorageLike | null {
  if (typeof window === "undefined") return null;
  try {
    return window.sessionStorage;
  } catch {
    return null;
  }
}

function newSessionKey(): string {
  try {
    if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
      return crypto.randomUUID();
    }
  } catch { /* fall through */ }
  return `id-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 12)}`;
}

/**
 * Capture utm/click params from the current URL into the tracking
 * client's own storage (`tp_sess` in sessionStorage, tracker.js
 * shape) — ONLY when no session payload exists yet. First-touch
 * wins: an existing payload (with or without attribution) is
 * never overwritten. Returns true when a payload was written.
 */
export function captureFirstTouchAttribution(args?: {
  storage?: AttributionStorageLike | null;
  search?: string | URLSearchParams;
  now?: number;
}): boolean {
  const storage = args?.storage !== undefined ? args.storage : defaultSessionStorage();
  if (!storage) return false;
  const search =
    args?.search ??
    (typeof window !== "undefined" ? window.location.search : "");
  const data = sessionDataFromSearch(search);
  if (!data) return false;
  try {
    if (storage.getItem(TRACKING_SESSION_KEY)) return false;
    const payload = {
      key: newSessionKey(),
      lastActivity: args?.now ?? Date.now(),
      data,
    };
    storage.setItem(TRACKING_SESSION_KEY, JSON.stringify(payload));
    return true;
  } catch {
    return false;
  }
}

/**
 * The attribution to attach to a checkout request, read from the
 * first-party tracking storage (`tp_sess`). Undefined when the
 * visit carried no utm/click params — callers then OMIT the
 * `attribution` key entirely.
 */
export function getAttributionForCheckout(
  storage?: AttributionStorageLike | null,
): CheckoutAttribution | undefined {
  const store = storage !== undefined ? storage : defaultSessionStorage();
  if (!store) return undefined;
  try {
    return attributionFromStoredSession(store.getItem(TRACKING_SESSION_KEY));
  } catch {
    return undefined;
  }
}

/** A conversion can only be addressed when BOTH id and label exist. */
export function adsConversionReady(t: ShopTracking | null | undefined): boolean {
  return !!(t?.googleAdsId && t?.googleAdsConversionLabel);
}

/**
 * Fire the Google Ads conversion on the success page ONLY when:
 * the tracking pair is configured, the order is the genuinely
 * placed one from THIS browser (caller passes sessionStorage
 * state — never the ?order= display fallback), its total is
 * positive, and it has not already fired for this session.
 */
export function shouldFireAdsConversion(args: {
  tracking: ShopTracking | null | undefined;
  order: { orderNumber?: string | null; totalMinor?: string | number | null } | null | undefined;
  alreadyFired: boolean;
}): boolean {
  if (!adsConversionReady(args.tracking)) return false;
  if (args.alreadyFired) return false;
  const order = args.order;
  if (!order?.orderNumber) return false;
  const total = Number(order.totalMinor);
  return Number.isFinite(total) && total > 0;
}
