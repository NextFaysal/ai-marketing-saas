import { describe, expect, it } from "vitest";
import { parseRecentlyViewed, recentlyViewedKey, upsertRecentlyViewed, type RecentlyViewedCard } from "./recently-viewed";

const card = (id: string): RecentlyViewedCard => ({ id, slug: `slug-${id}`, name: `P${id}`, imageUrl: null, priceMinor: "1000" });

describe("recentlyViewedKey", () => {
  it("is per-org", () => {
    expect(recentlyViewedKey("shop-a")).toBe("shop-recently-viewed:shop-a");
    expect(recentlyViewedKey("shop-a")).not.toBe(recentlyViewedKey("shop-b"));
  });
});

describe("upsertRecentlyViewed", () => {
  it("prepends, dedupes by id, and caps at 8", () => {
    let list: RecentlyViewedCard[] = [];
    for (let i = 1; i <= 9; i++) list = upsertRecentlyViewed(list, card(String(i)));
    expect(list.map((c) => c.id)).toEqual(["9", "8", "7", "6", "5", "4", "3", "2"]);
    list = upsertRecentlyViewed(list, card("5"));
    expect(list.map((c) => c.id)).toEqual(["5", "9", "8", "7", "6", "4", "3", "2"]);
  });
});

describe("parseRecentlyViewed", () => {
  it("reads back a stored list and tolerates corruption", () => {
    expect(parseRecentlyViewed(JSON.stringify([card("1")]))).toEqual([card("1")]);
    expect(parseRecentlyViewed("not json")).toEqual([]);
    expect(parseRecentlyViewed(null)).toEqual([]);
    expect(parseRecentlyViewed(JSON.stringify([{ id: 5 }]))).toEqual([]);
    expect(parseRecentlyViewed(JSON.stringify({ nope: true }))).toEqual([]);
  });
});
