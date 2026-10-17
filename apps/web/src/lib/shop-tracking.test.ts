import { describe, expect, it } from "vitest";
import {
  adsConversionReady,
  attributionFromSessionData,
  attributionFromStoredSession,
  captureFirstTouchAttribution,
  getAttributionForCheckout,
  sessionDataFromSearch,
  shouldFireAdsConversion,
  TRACKING_SESSION_KEY,
  trackingFromSettings,
  type ShopTracking,
} from "./shop-tracking";

/**
 * GB7 (GC18) — tracking helpers. Pinned rules: unset fields are
 * null (never ""), a conversion needs BOTH the Ads id and its
 * label, and the success-page conversion fires at most once for
 * a real, positive-total order.
 */
const FULL: ShopTracking = {
  ga4MeasurementId: "G-AAA",
  gtmContainerId: "GTM-AAA",
  googleAdsId: "AW-123",
  googleAdsConversionLabel: "label-1",
  searchConsoleVerification: "token-1",
  metaPixelId: "123456789",
  tikTokPixelId: "TT-123456",
  clarityId: "clarity-123",
};
const NONE: ShopTracking = {
  ga4MeasurementId: null,
  gtmContainerId: null,
  googleAdsId: null,
  googleAdsConversionLabel: null,
  searchConsoleVerification: null,
  metaPixelId: null,
  tikTokPixelId: null,
  clarityId: null,
};

describe("trackingFromSettings", () => {
  it("reads settings.tracking verbatim", () => {
    expect(trackingFromSettings({ tracking: FULL })).toEqual(FULL);
    expect(trackingFromSettings({ locale: "bn", tracking: FULL })).toEqual(FULL);
  });

  it("returns all nulls when tracking is absent or malformed", () => {
    expect(trackingFromSettings(undefined)).toEqual(NONE);
    expect(trackingFromSettings(null)).toEqual(NONE);
    expect(trackingFromSettings({})).toEqual(NONE);
    expect(trackingFromSettings({ tracking: null })).toEqual(NONE);
    expect(trackingFromSettings({ tracking: "nope" })).toEqual(NONE);
    expect(trackingFromSettings(42)).toEqual(NONE);
  });

  it("trims values and maps empty/blank/non-string fields to null", () => {
    expect(
      trackingFromSettings({
        tracking: {
          ga4MeasurementId: "  G-X  ",
          gtmContainerId: "",
          googleAdsId: "   ",
          googleAdsConversionLabel: 42,
          searchConsoleVerification: undefined,
        },
      }),
    ).toEqual({ ...NONE, ga4MeasurementId: "G-X" });
  });
});

describe("adsConversionReady", () => {
  it("needs BOTH the Ads id and the conversion label", () => {
    expect(adsConversionReady(FULL)).toBe(true);
    expect(adsConversionReady({ ...FULL, googleAdsId: null })).toBe(false);
    expect(adsConversionReady({ ...FULL, googleAdsConversionLabel: null })).toBe(false);
    expect(adsConversionReady(NONE)).toBe(false);
    expect(adsConversionReady(null)).toBe(false);
    expect(adsConversionReady(undefined)).toBe(false);
  });
});

describe("shouldFireAdsConversion truth table", () => {
  const order = { orderNumber: "ORD-1001", totalMinor: "150000" };

  it("fires for a configured, real, positive, not-yet-fired order", () => {
    expect(shouldFireAdsConversion({ tracking: FULL, order, alreadyFired: false })).toBe(true);
    expect(shouldFireAdsConversion({ tracking: FULL, order: { orderNumber: "ORD-2", totalMinor: 500 }, alreadyFired: false })).toBe(true);
  });

  it("never fires when the Ads pair is incomplete", () => {
    expect(shouldFireAdsConversion({ tracking: NONE, order, alreadyFired: false })).toBe(false);
    expect(shouldFireAdsConversion({ tracking: { ...FULL, googleAdsConversionLabel: null }, order, alreadyFired: false })).toBe(false);
    expect(shouldFireAdsConversion({ tracking: null, order, alreadyFired: false })).toBe(false);
  });

  it("never fires twice (alreadyFired)", () => {
    expect(shouldFireAdsConversion({ tracking: FULL, order, alreadyFired: true })).toBe(false);
  });

  it("never fires without an order number (display-only fallback)", () => {
    expect(shouldFireAdsConversion({ tracking: FULL, order: null, alreadyFired: false })).toBe(false);
    expect(shouldFireAdsConversion({ tracking: FULL, order: undefined, alreadyFired: false })).toBe(false);
    expect(shouldFireAdsConversion({ tracking: FULL, order: { orderNumber: "", totalMinor: "100" }, alreadyFired: false })).toBe(false);
    expect(shouldFireAdsConversion({ tracking: FULL, order: { orderNumber: null, totalMinor: "100" }, alreadyFired: false })).toBe(false);
  });

  it("never fires for a zero / negative / unparseable total", () => {
    expect(shouldFireAdsConversion({ tracking: FULL, order: { orderNumber: "O", totalMinor: "0" }, alreadyFired: false })).toBe(false);
    expect(shouldFireAdsConversion({ tracking: FULL, order: { orderNumber: "O", totalMinor: "-100" }, alreadyFired: false })).toBe(false);
    expect(shouldFireAdsConversion({ tracking: FULL, order: { orderNumber: "O", totalMinor: "abc" }, alreadyFired: false })).toBe(false);
    expect(shouldFireAdsConversion({ tracking: FULL, order: { orderNumber: "O", totalMinor: null }, alreadyFired: false })).toBe(false);
  });
});

/* ------------------------------------------------------------------ */
/* AB7 (AX19) — first-touch attribution                                */
/* ------------------------------------------------------------------ */

function memoryStorage(initial: Record<string, string> = {}) {
  const map = new Map(Object.entries(initial));
  return {
    map,
    getItem: (k: string) => (map.has(k) ? (map.get(k) as string) : null),
    setItem: (k: string, v: string) => { map.set(k, v); },
  };
}

describe("attributionFromSessionData (AX19)", () => {
  it("maps stored tracker-session data to the checkout shape", () => {
    expect(
      attributionFromSessionData({
        utmSource: "facebook",
        utmMedium: "cpc",
        utmCampaign: "eid-sale",
        utmContent: "banner-1",
        utmTerm: "shoes",
        fbclid: "fb-123",
      }),
    ).toEqual({
      utmSource: "facebook",
      utmMedium: "cpc",
      utmCampaign: "eid-sale",
      utmContent: "banner-1",
      utmTerm: "shoes",
      clickIdType: "fbclid",
      clickId: "fb-123",
    });
  });

  it("reads the .data of a whole tp_sess payload", () => {
    expect(
      attributionFromSessionData({
        key: "sess-1",
        lastActivity: 123,
        data: { utmSource: "google", gclid: "g-9" },
      }),
    ).toEqual({ utmSource: "google", clickIdType: "gclid", clickId: "g-9" });
  });

  it("maps each click id to its type, fbclid first when several exist", () => {
    expect(attributionFromSessionData({ gclid: "g" })).toEqual({ clickIdType: "gclid", clickId: "g" });
    expect(attributionFromSessionData({ ttclid: "t" })).toEqual({ clickIdType: "ttclid", clickId: "t" });
    expect(attributionFromSessionData({ fbclid: "f", gclid: "g", ttclid: "t" })).toEqual({
      clickIdType: "fbclid",
      clickId: "f",
    });
    expect(attributionFromSessionData({ gclid: "g", ttclid: "t" })).toEqual({
      clickIdType: "gclid",
      clickId: "g",
    });
  });

  it("returns undefined for empty / malformed stored data", () => {
    expect(attributionFromSessionData(null)).toBeUndefined();
    expect(attributionFromSessionData(undefined)).toBeUndefined();
    expect(attributionFromSessionData("nope")).toBeUndefined();
    expect(attributionFromSessionData({})).toBeUndefined();
    expect(attributionFromSessionData({ utmSource: "  ", fbclid: "" })).toBeUndefined();
    expect(attributionFromSessionData({ data: {} })).toBeUndefined();
  });

  it("trims values", () => {
    expect(attributionFromSessionData({ utmSource: "  facebook  " })).toEqual({ utmSource: "facebook" });
  });
});

describe("attributionFromStoredSession (AX19)", () => {
  it("parses the raw tp_sess JSON; corruption reads as undefined", () => {
    const raw = JSON.stringify({ key: "k", data: { utmCampaign: "c1", ttclid: "tt-1" } });
    expect(attributionFromStoredSession(raw)).toEqual({
      utmCampaign: "c1",
      clickIdType: "ttclid",
      clickId: "tt-1",
    });
    expect(attributionFromStoredSession("not json")).toBeUndefined();
    expect(attributionFromStoredSession(null)).toBeUndefined();
    expect(attributionFromStoredSession(undefined)).toBeUndefined();
    expect(attributionFromStoredSession("")).toBeUndefined();
  });
});

describe("sessionDataFromSearch (AX19)", () => {
  it("reads utm_* + click params into tracker-session data", () => {
    expect(
      sessionDataFromSearch("?utm_source=facebook&utm_medium=cpc&utm_campaign=eid&fbclid=fb-1"),
    ).toEqual({ utmSource: "facebook", utmMedium: "cpc", utmCampaign: "eid", fbclid: "fb-1" });
    expect(sessionDataFromSearch(new URLSearchParams("gclid=g-2"))).toEqual({ gclid: "g-2" });
  });

  it("returns undefined when the URL carries no attribution params", () => {
    expect(sessionDataFromSearch("")).toBeUndefined();
    expect(sessionDataFromSearch("?ref=partner-1&page=2")).toBeUndefined();
    expect(sessionDataFromSearch("?utm_source=")).toBeUndefined();
  });
});

describe("captureFirstTouchAttribution + getAttributionForCheckout (AX19)", () => {
  it("captures from the URL into tp_sess (tracker shape) when no session exists", () => {
    const storage = memoryStorage();
    const written = captureFirstTouchAttribution({
      storage,
      search: "?utm_source=facebook&utm_campaign=eid&fbclid=fb-7",
      now: 1000,
    });
    expect(written).toBe(true);
    const raw = storage.map.get(TRACKING_SESSION_KEY);
    expect(raw).toBeTruthy();
    const payload = JSON.parse(raw as string);
    expect(payload.lastActivity).toBe(1000);
    expect(typeof payload.key).toBe("string");
    expect(payload.data).toEqual({ utmSource: "facebook", utmCampaign: "eid", fbclid: "fb-7" });
    expect(getAttributionForCheckout(storage)).toEqual({
      utmSource: "facebook",
      utmCampaign: "eid",
      clickIdType: "fbclid",
      clickId: "fb-7",
    });
  });

  it("first-touch wins: an existing tp_sess payload is never overwritten", () => {
    const existing = JSON.stringify({
      key: "orig",
      lastActivity: 5,
      data: { utmSource: "google", gclid: "g-orig" },
    });
    const storage = memoryStorage({ [TRACKING_SESSION_KEY]: existing });
    const written = captureFirstTouchAttribution({
      storage,
      search: "?utm_source=facebook&fbclid=fb-new",
      now: 2000,
    });
    expect(written).toBe(false);
    expect(storage.map.get(TRACKING_SESSION_KEY)).toBe(existing);
    expect(getAttributionForCheckout(storage)).toEqual({
      utmSource: "google",
      clickIdType: "gclid",
      clickId: "g-orig",
    });
  });

  it("writes nothing when the URL has no attribution params", () => {
    const storage = memoryStorage();
    expect(captureFirstTouchAttribution({ storage, search: "?page=2" })).toBe(false);
    expect(storage.map.size).toBe(0);
    expect(getAttributionForCheckout(storage)).toBeUndefined();
  });

  it("empty storage yields undefined attribution (checkout omits the key)", () => {
    expect(getAttributionForCheckout(memoryStorage())).toBeUndefined();
    expect(getAttributionForCheckout(null)).toBeUndefined();
  });
});

describe("parseTrackingIds multi-account parser", () => {
  it("splits comma and whitespace separated IDs into clean array", () => {
    const { parseTrackingIds } = require("./shop-tracking");
    expect(parseTrackingIds("123456789, 987654321")).toEqual(["123456789", "987654321"]);
    expect(parseTrackingIds("G-111  G-222,  G-333\n G-444")).toEqual(["G-111", "G-222", "G-333", "G-444"]);
    expect(parseTrackingIds(null)).toEqual([]);
    expect(parseTrackingIds("")).toEqual([]);
    expect(parseTrackingIds("   ")).toEqual([]);
  });
});

describe("trackShopEvent broadcast dispatcher", () => {
  it("safely ignores calls when window is not defined or functions absent", () => {
    const { trackShopEvent } = require("./shop-tracking");
    expect(() => trackShopEvent("PageView")).not.toThrow();
    expect(() => trackShopEvent("ViewContent", { content_name: "T-Shirt", value: 500 })).not.toThrow();
  });
});

