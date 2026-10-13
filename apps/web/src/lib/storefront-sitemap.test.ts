import { describe, expect, it } from "vitest";
import { buildShopSitemapUrls, buildSitemapUrl, sitemapPagePlan, sitemapUrlBase } from "./storefront-sitemap";

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

describe("sitemapPagePlan", () => {
  it("pages 1..totalPages, bounded at the cap", () => {
    expect(sitemapPagePlan(1)).toEqual([1]);
    expect(sitemapPagePlan(3)).toEqual([1, 2, 3]);
    expect(sitemapPagePlan(500)).toHaveLength(200);
    expect(sitemapPagePlan(0)).toEqual([1]);
  });
});
