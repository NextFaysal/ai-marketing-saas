import { describe, expect, it } from "vitest";
import {
  legacyRecentlyViewedKey,
  parseLegacyRecentlyViewedIds,
  parseRecentlyViewedIds,
  readRecentlyViewedIds,
  recentlyViewedKey,
  recordRecentlyViewed,
  upsertRecentlyViewedId,
} from "./recently-viewed";

function memoryStorage(initial: Record<string, string> = {}) {
  const map = new Map(Object.entries(initial));
  return {
    map,
    getItem: (k: string) => (map.has(k) ? (map.get(k) as string) : null),
    setItem: (k: string, v: string) => { map.set(k, v); },
  };
}

describe("recentlyViewedKey (v2)", () => {
  it("is versioned and per-org; the legacy key is the unversioned one", () => {
    expect(recentlyViewedKey("shop-a")).toBe("shop-recently-viewed:v2:shop-a");
    expect(recentlyViewedKey("shop-a")).not.toBe(recentlyViewedKey("shop-b"));
    expect(legacyRecentlyViewedKey("shop-a")).toBe("shop-recently-viewed:shop-a");
  });
});

describe("parseRecentlyViewedIds", () => {
  it("reads id strings back and tolerates corruption", () => {
    expect(parseRecentlyViewedIds(JSON.stringify(["1", "2"]))).toEqual(["1", "2"]);
    expect(parseRecentlyViewedIds("not json")).toEqual([]);
    expect(parseRecentlyViewedIds(null)).toEqual([]);
    expect(parseRecentlyViewedIds(undefined)).toEqual([]);
    expect(parseRecentlyViewedIds(JSON.stringify({ nope: true }))).toEqual([]);
    expect(parseRecentlyViewedIds(JSON.stringify([{ id: "1" }, 5, null, ""]))).toEqual([]);
  });

  it("dedupes and caps at 8", () => {
    expect(parseRecentlyViewedIds(JSON.stringify(["a", "b", "a", "c"]))).toEqual(["a", "b", "c"]);
    const many = Array.from({ length: 12 }, (_, i) => String(i + 1));
    expect(parseRecentlyViewedIds(JSON.stringify(many))).toEqual(many.slice(0, 8));
  });
});

describe("upsertRecentlyViewedId", () => {
  it("prepends, dedupes by id, and caps at 8", () => {
    let list: string[] = [];
    for (let i = 1; i <= 9; i++) list = upsertRecentlyViewedId(list, String(i));
    expect(list).toEqual(["9", "8", "7", "6", "5", "4", "3", "2"]);
    list = upsertRecentlyViewedId(list, "5");
    expect(list).toEqual(["5", "9", "8", "7", "6", "4", "3", "2"]);
  });
});

describe("legacy migration", () => {
  it("derives ids from legacy stored cards", () => {
    const legacy = JSON.stringify([
      { id: "p1", slug: "a", name: "A", imageUrl: null, priceMinor: "100" },
      { id: "p2", slug: "b", name: "B", imageUrl: null, priceMinor: "200" },
      { id: "p1", slug: "a", name: "A", imageUrl: null, priceMinor: "100" },
      { name: "no id" },
    ]);
    expect(parseLegacyRecentlyViewedIds(legacy)).toEqual(["p1", "p2"]);
    expect(parseLegacyRecentlyViewedIds("junk")).toEqual([]);
  });

  it("read migrates legacy ids into the v2 key once, and v2 wins afterwards", () => {
    const storage = memoryStorage({
      [legacyRecentlyViewedKey("shop")]: JSON.stringify([
        { id: "p1", slug: "a", name: "A", imageUrl: null, priceMinor: "100" },
        { id: "p2", slug: "b", name: "B", imageUrl: null, priceMinor: "200" },
      ]),
    });
    expect(readRecentlyViewedIds("shop", storage)).toEqual(["p1", "p2"]);
    expect(storage.map.get(recentlyViewedKey("shop"))).toBe(JSON.stringify(["p1", "p2"]));
    // A later v2 write is authoritative — legacy is not re-read.
    storage.map.set(recentlyViewedKey("shop"), JSON.stringify(["p9"]));
    expect(readRecentlyViewedIds("shop", storage)).toEqual(["p9"]);
  });

  it("no storage / nothing stored reads as empty", () => {
    expect(readRecentlyViewedIds("shop", memoryStorage())).toEqual([]);
    expect(readRecentlyViewedIds("shop", null)).toEqual([]);
  });
});

describe("recordRecentlyViewed", () => {
  it("writes ids-only JSON under the v2 key, newest first", () => {
    const storage = memoryStorage();
    recordRecentlyViewed("shop", "p1", storage);
    recordRecentlyViewed("shop", "p2", storage);
    recordRecentlyViewed("shop", "p1", storage);
    expect(storage.map.get(recentlyViewedKey("shop"))).toBe(JSON.stringify(["p1", "p2"]));
    expect(readRecentlyViewedIds("shop", storage)).toEqual(["p1", "p2"]);
  });
});
