import { describe, expect, it } from "vitest";
import {
  buildCanonicalShopSitemapEntries,
  buildShopSitemapEntries,
  buildShopSitemapUrls,
  buildSitemapUrl,
  sitemapPagePlan,
  sitemapUrlBase,
} from "./storefront-sitemap";

describe("sitemapUrlBase", () => {
  it("uses NEXT_PUBLIC_WEB_URL (trailing slash trimmed) and nothing fabricated", () => {
    expect(sitemapUrlBase({ NEXT_PUBLIC_WEB_URL: "https://app.example.com/" })).toBe("https://app.example.com");
    expect(sitemapUrlBase({})).toBe("");
    expect(sitemapUrlBase({ NEXT_PUBLIC_WEB_URL: "  " })).toBe("");
  });
});

describe("buildSitemapUrl / buildShopSitemapUrls", () => {
  it("builds absolute URLs when a base is configured", () => {
    expect(buildShopSitemapUrls("https://app.example.com", "my-shop", ["a", "b"])).toEqual([
      "https://app.example.com/shop/my-shop",
      "https://app.example.com/shop/my-shop/products/a",
      "https://app.example.com/shop/my-shop/products/b",
    ]);
  });

  it("falls back to path-only URLs without a configured base", () => {
    expect(buildSitemapUrl("", "/shop/x")).toBe("/shop/x");
    expect(buildShopSitemapUrls("", "my-shop", [])).toEqual(["/shop/my-shop"]);
  });

  it("skips null/empty/duplicate product slugs", () => {
    expect(buildShopSitemapUrls("", "s", [null, "a", undefined, "a", ""])).toEqual([
      "/shop/s",
      "/shop/s/products/a",
    ]);
  });
});

describe("buildShopSitemapEntries (EC27 lastmod)", () => {
  it("carries each product's updatedAt; home gets the newest", () => {
    const entries = buildShopSitemapEntries("https://x.com", "s", [
      { slug: "a", updatedAt: "2026-10-01T00:00:00.000Z" },
      { slug: "b", updatedAt: "2026-10-10T00:00:00.000Z" },
      { slug: "a", updatedAt: "2026-10-05T00:00:00.000Z" }, // duplicate slug skipped
      { slug: null, updatedAt: "2026-10-12T00:00:00.000Z" }, // slugless skipped
    ]);
    expect(entries.map((e) => e.url)).toEqual([
      "https://x.com/shop/s",
      "https://x.com/shop/s/products/a",
      "https://x.com/shop/s/products/b",
    ]);
    expect(entries[0].lastModified?.toISOString()).toBe("2026-10-10T00:00:00.000Z");
    expect(entries[1].lastModified?.toISOString()).toBe("2026-10-01T00:00:00.000Z");
    expect(entries[2].lastModified?.toISOString()).toBe("2026-10-10T00:00:00.000Z");
  });

  it("no products ⇒ home only with null lastmod", () => {
    expect(buildShopSitemapEntries("", "s", [])).toEqual([{ url: "/shop/s", lastModified: null }]);
  });
});

describe("buildCanonicalShopSitemapEntries (TD7)", () => {
  it("puts home at the canonical origin root and products at /products/", () => {
    const entries = buildCanonicalShopSitemapEntries("https://dhaka-fashion.qosprey.com", [
      { slug: "a", updatedAt: "2026-10-01T00:00:00.000Z" },
      { slug: "b", updatedAt: "2026-10-10T00:00:00.000Z" },
      { slug: "a", updatedAt: "2026-10-05T00:00:00.000Z" }, // duplicate skipped
      { slug: null, updatedAt: "2026-10-12T00:00:00.000Z" }, // slugless skipped
    ]);
    expect(entries.map((e) => e.url)).toEqual([
      "https://dhaka-fashion.qosprey.com/",
      "https://dhaka-fashion.qosprey.com/products/a",
      "https://dhaka-fashion.qosprey.com/products/b",
    ]);
    expect(entries[0].lastModified?.toISOString()).toBe("2026-10-10T00:00:00.000Z");
  });

  it("works on a verified custom-domain base too", () => {
    expect(buildCanonicalShopSitemapEntries("https://dhaka-fashion.com/", [])).toEqual([
      { url: "https://dhaka-fashion.com/", lastModified: null },
    ]);
  });
});

describe("sitemapPagePlan", () => {
  it("pages 1..totalPages, bounded at the cap", () => {
    expect(sitemapPagePlan(1)).toEqual([1]);
    expect(sitemapPagePlan(3)).toEqual([1, 2, 3]);
    expect(sitemapPagePlan(500)).toHaveLength(200);
    expect(sitemapPagePlan(0)).toEqual([1]);
  });
});
