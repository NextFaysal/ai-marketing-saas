import { describe, expect, it } from "vitest";
import { normalizeHost, rewritePathForShop, shouldSkipHost } from "./custom-domain";

describe("normalizeHost", () => {
  it("lowercases and strips the port", () => {
    expect(normalizeHost("Shop.Example.COM:443")).toBe("shop.example.com");
    expect(normalizeHost(" example.com ")).toBe("example.com");
    expect(normalizeHost("[::1]:3000")).toBe("::1");
    expect(normalizeHost(null)).toBe("");
  });
});

describe("shouldSkipHost", () => {
  it("skips local/dev hosts", () => {
    expect(shouldSkipHost("localhost")).toBe(true);
    expect(shouldSkipHost("localhost:3000")).toBe(true);
    expect(shouldSkipHost("127.0.0.1:3000")).toBe(true);
    expect(shouldSkipHost("::1")).toBe(true);
    expect(shouldSkipHost("dev.local")).toBe(true);
    expect(shouldSkipHost("")).toBe(true);
  });
  it("does not skip real merchant domains", () => {
    expect(shouldSkipHost("shop.example.com")).toBe(false);
    expect(shouldSkipHost("example.com:443")).toBe(false);
  });
});

describe("rewritePathForShop", () => {
  const slug = "my-shop";
  it("maps the shop surface onto /shop/<slug>", () => {
    expect(rewritePathForShop("/", slug)).toBe("/shop/my-shop");
    expect(rewritePathForShop("/products/blue-panjabi", slug)).toBe("/shop/my-shop/products/blue-panjabi");
    expect(rewritePathForShop("/cart", slug)).toBe("/shop/my-shop/cart");
    expect(rewritePathForShop("/checkout", slug)).toBe("/shop/my-shop/checkout");
    expect(rewritePathForShop("/success", slug)).toBe("/shop/my-shop/success");
    expect(rewritePathForShop("/some-category", slug)).toBe("/shop/my-shop/some-category");
  });

  it("never rewrites shop, platform, auth or dashboard paths", () => {
    expect(rewritePathForShop("/shop/my-shop", slug)).toBeNull();
    expect(rewritePathForShop("/shop/other", slug)).toBeNull();
    expect(rewritePathForShop("/dashboard", slug)).toBeNull();
    expect(rewritePathForShop("/dashboard/commerce/sync", slug)).toBeNull();
    expect(rewritePathForShop("/login", slug)).toBeNull();
    expect(rewritePathForShop("/register", slug)).toBeNull();
    expect(rewritePathForShop("/admin", slug)).toBeNull();
    expect(rewritePathForShop("/checkout/legacy-slug", slug)).toBeNull();
    expect(rewritePathForShop("/onboarding", slug)).toBeNull();
  });

  it("never rewrites the API proxy, Next internals or static assets", () => {
    expect(rewritePathForShop("/backend/public/shop/x", slug)).toBeNull();
    expect(rewritePathForShop("/_next/static/chunk.js", slug)).toBeNull();
    expect(rewritePathForShop("/favicon.ico", slug)).toBeNull();
    expect(rewritePathForShop("/robots.txt", slug)).toBeNull();
    expect(rewritePathForShop("/sitemap.xml", slug)).toBeNull();
    expect(rewritePathForShop("/images/logo.png", slug)).toBeNull();
    expect(rewritePathForShop("/tracker.js", slug)).toBeNull();
  });

  it("refuses an empty slug", () => {
    expect(rewritePathForShop("/", "")).toBeNull();
  });
});
