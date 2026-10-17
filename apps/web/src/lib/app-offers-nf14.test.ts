import { afterEach, describe, expect, it, vi } from "vitest";
import { isStandaloneDisplay, offerLabel, visibleOffers, type PublicShopOffer } from "./app-offers-nf14";

/**
 * NF14 (FB5) — the app-only display rule. Pinned behaviour:
 * app-only offers are hidden in a normal browser tab, shown in
 * the installed app (standalone), and regular offers always
 * show. The flag never blocks a code — that side is proven in
 * the API spec (nf14-app-only.spec.ts); this file pins only
 * what the storefront does with the flag.
 */

const offers: PublicShopOffer[] = [
  { id: "o1", code: "WEB10", kind: "percent", value: 10, minOrderMinor: null, endsAt: null, appOnly: false },
  { id: "o2", code: "APP25", kind: "percent", value: 25, minOrderMinor: null, endsAt: null, appOnly: true },
  { id: "o3", code: "SHIP0", kind: "free_shipping", value: 0, minOrderMinor: null, endsAt: null, appOnly: true },
];

describe("NF14 visibleOffers", () => {
  it("hides app-only offers when NOT standalone", () => {
    expect(visibleOffers(offers, false).map((o) => o.code)).toEqual(["WEB10"]);
  });

  it("shows every offer when standalone (installed app)", () => {
    expect(visibleOffers(offers, true).map((o) => o.code)).toEqual(["WEB10", "APP25", "SHIP0"]);
  });

  it("non-appOnly offers are always shown, in both modes", () => {
    const regular = offers.filter((o) => !o.appOnly);
    expect(visibleOffers(regular, false)).toHaveLength(1);
    expect(visibleOffers(regular, true)).toHaveLength(1);
  });

  it("a missing flag (legacy payload) reads as a regular offer", () => {
    const legacy = [{ code: "OLD10" }, { code: "APP10", appOnly: true }] as Array<{ code: string; appOnly?: boolean }>;
    expect(visibleOffers(legacy, false).map((o) => o.code)).toEqual(["OLD10"]);
    expect(visibleOffers(legacy, true).map((o) => o.code)).toEqual(["OLD10", "APP10"]);
  });

  it("null / undefined / empty input yields an empty list", () => {
    expect(visibleOffers(null, true)).toEqual([]);
    expect(visibleOffers(undefined, false)).toEqual([]);
    expect(visibleOffers([], true)).toEqual([]);
  });
});

describe("NF14 isStandaloneDisplay", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("true via the display-mode media query", () => {
    vi.stubGlobal("window", {
      matchMedia: (q: string) => ({ matches: q === "(display-mode: standalone)" }),
      navigator: {},
    });
    expect(isStandaloneDisplay()).toBe(true);
  });

  it("true via iOS Safari's navigator.standalone when the media query does not match", () => {
    vi.stubGlobal("window", {
      matchMedia: () => ({ matches: false }),
      navigator: { standalone: true },
    });
    expect(isStandaloneDisplay()).toBe(true);
  });

  it("false in a plain browser tab", () => {
    vi.stubGlobal("window", {
      matchMedia: () => ({ matches: false }),
      navigator: { standalone: false },
    });
    expect(isStandaloneDisplay()).toBe(false);
  });

  it("false (never throws) without matchMedia or without a window at all", () => {
    vi.stubGlobal("window", { navigator: {} });
    expect(isStandaloneDisplay()).toBe(false);
    vi.unstubAllGlobals();
    expect(isStandaloneDisplay()).toBe(false);
  });
});

describe("NF14 offerLabel", () => {
  it("labels percent, fixed and free-shipping offers in Bengali", () => {
    expect(offerLabel(offers[0])).toBe("10% ছাড়");
    expect(offerLabel({ ...offers[0], kind: "fixed", value: 15000 })).toBe("৳150 ছাড়");
    expect(offerLabel(offers[2])).toBe("ফ্রি ডেলিভারি");
  });
});
