import { computeCredits, filterTouchpointsInWindow, classifyTouchpoint, EngineTouchpoint } from "./engine";

const tp = (id: string, dayOffset: number, isDirect = false, source = "facebook"): EngineTouchpoint => ({
  id, occurredAt: new Date(Date.UTC(2026, 9, 1) + dayOffset * 86400000), isDirect, source,
});

describe("computeCredits", () => {
  const tps = [tp("a", 0), tp("b", 2, true, "direct"), tp("c", 4)];
  it("first touch gives everything to the earliest", () => {
    expect(computeCredits(tps, 10000n, "FIRST_TOUCH")).toEqual([{ touchpointId: "a", revenueMinor: 10000n }]);
  });
  it("last touch gives everything to the latest", () => {
    expect(computeCredits(tps, 10000n, "LAST_TOUCH")).toEqual([{ touchpointId: "c", revenueMinor: 10000n }]);
  });
  it("last non-direct skips a trailing direct visit", () => {
    const withDirectLast = [tp("a", 0), tp("c", 4), tp("d", 6, true, "direct")];
    expect(computeCredits(withDirectLast, 5000n, "LAST_NON_DIRECT")).toEqual([{ touchpointId: "c", revenueMinor: 5000n }]);
  });
  it("last non-direct with only direct visits is honestly unattributed", () => {
    const directOnly = [tp("x", 0, true, "direct")];
    expect(computeCredits(directOnly, 5000n, "LAST_NON_DIRECT")).toEqual([{ touchpointId: null, revenueMinor: 5000n }]);
  });
  it("no touchpoints at all is unattributed, never guessed", () => {
    expect(computeCredits([], 5000n, "LAST_TOUCH")).toEqual([{ touchpointId: null, revenueMinor: 5000n }]);
  });
  it("linear split sums EXACTLY to the revenue (integer remainder handled)", () => {
    const credits = computeCredits(tps, 10000n, "LINEAR"); // 10000 / 3 = 3333 r1
    expect(credits.map((c) => c.revenueMinor)).toEqual([3334n, 3333n, 3333n]);
    expect(credits.reduce((s, c) => s + c.revenueMinor, 0n)).toBe(10000n);
  });
});

describe("filterTouchpointsInWindow", () => {
  it("excludes touchpoints after the conversion and outside the window", () => {
    const conversion = new Date(Date.UTC(2026, 9, 20)); // Oct 20
    const explicit: EngineTouchpoint[] = [
      { id: "too-old", occurredAt: new Date(Date.UTC(2026, 8, 1)), isDirect: false, source: "facebook" }, // Sep 1, 49 days before
      { id: "in-window", occurredAt: new Date(Date.UTC(2026, 9, 10)), isDirect: false, source: "google" },
      { id: "after", occurredAt: new Date(Date.UTC(2026, 9, 21)), isDirect: false, source: "google" },
    ];
    const out = filterTouchpointsInWindow(explicit, conversion, 30);
    expect(out.map((t) => t.id)).toEqual(["in-window"]);
  });
});

describe("classifyTouchpoint", () => {
  it("uses utm_source when present", () => {
    expect(classifyTouchpoint({ utmSource: "Facebook" }).source).toBe("facebook");
  });
  it("infers the platform from click ids when utm is missing", () => {
    expect(classifyTouchpoint({ fbclid: "abc" })).toMatchObject({ source: "facebook", clickIdType: "fbclid", isDirect: false });
    expect(classifyTouchpoint({ gclid: "abc" }).source).toBe("google");
    expect(classifyTouchpoint({ ttclid: "abc" }).source).toBe("tiktok");
  });
  it("a visit with no utm and no click id is direct", () => {
    expect(classifyTouchpoint({ referrer: "" })).toMatchObject({ source: "direct", isDirect: true });
  });
});
