import { describe, expect, it } from "vitest";
import {
  canonicalShopRedirectUrl,
  classifyHost,
  isPanelPath,
  normalizeHost,
  panelAppRedirectUrl,
  rewritePathForShop,
  shouldSkipHost,
} from "./custom-domain";

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

describe("classifyHost (TD4)", () => {
  it("classifies the apex and the platform's own service hosts as platform", () => {
    for (const host of [
      "qosprey.com",
      "www.qosprey.com",
      "app.qosprey.com",
      "admin.qosprey.com",
      "api.qosprey.com",
      "media.qosprey.com",
      "mail.qosprey.com",
    ]) {
      expect(classifyHost(host), host).toEqual({ kind: "platform" });
    }
  });

  it("classifies every TD1-reserved single label as platform, never a shop", () => {
    // system class (dashboard is the owner's own example), misleading
    // class (fake, orgnail), future class, and the substring rule.
    for (const host of [
      "dashboard.qosprey.com",
      "support.qosprey.com",
      "shop.qosprey.com",
      "fake.qosprey.com",
      "orgnail.qosprey.com",
      "pay.qosprey.com",
      "wallet.qosprey.com",
      "my-admin-shop.qosprey.com",
    ]) {
      expect(classifyHost(host), host).toEqual({ kind: "platform" });
    }
  });

  it("classifies a valid single label as a tenant shop subdomain", () => {
    expect(classifyHost("dhaka-fashion.qosprey.com")).toEqual({
      kind: "shop-subdomain",
      slug: "dhaka-fashion",
    });
    expect(classifyHost("shop123.qosprey.com")).toEqual({
      kind: "shop-subdomain",
      slug: "shop123",
    });
    expect(classifyHost("said-shop.qosprey.com")).toEqual({
      kind: "shop-subdomain",
      slug: "said-shop",
    });
  });

  it("normalises case, port and trailing dot before classifying", () => {
    expect(classifyHost("DHAKA-Fashion.QOSPREY.COM")).toEqual({
      kind: "shop-subdomain",
      slug: "dhaka-fashion",
    });
    expect(classifyHost("dhaka-fashion.qosprey.com:443")).toEqual({
      kind: "shop-subdomain",
      slug: "dhaka-fashion",
    });
    expect(classifyHost("dhaka-fashion.qosprey.com.")).toEqual({
      kind: "shop-subdomain",
      slug: "dhaka-fashion",
    });
    expect(classifyHost("APP.qosprey.com:3000")).toEqual({ kind: "platform" });
  });

  it("treats multi-level names under the apex as unknown — not shop, not platform", () => {
    expect(classifyHost("a.b.qosprey.com")).toEqual({ kind: "unknown" });
    expect(classifyHost("blog.dhaka-fashion.qosprey.com")).toEqual({ kind: "unknown" });
  });

  it("treats malformed single labels as unknown, not as shops", () => {
    expect(classifyHost("bad--slug.qosprey.com")).toEqual({ kind: "unknown" });
    expect(classifyHost("-bad.qosprey.com")).toEqual({ kind: "unknown" });
    expect(classifyHost("ab.qosprey.com")).toEqual({ kind: "unknown" }); // too short for a slug
    expect(classifyHost("bad_slug.qosprey.com")).toEqual({ kind: "unknown" });
  });

  it("treats empty and local/dev hosts as unknown (middleware still skips them first)", () => {
    expect(classifyHost("")).toEqual({ kind: "unknown" });
    expect(classifyHost(null)).toEqual({ kind: "unknown" });
    expect(classifyHost(undefined)).toEqual({ kind: "unknown" });
    expect(classifyHost("localhost")).toEqual({ kind: "unknown" });
    expect(classifyHost("localhost:3000")).toEqual({ kind: "unknown" });
    expect(classifyHost("dev.local")).toEqual({ kind: "unknown" });
  });

  it("treats hosts outside the platform apex as custom-domain candidates", () => {
    expect(classifyHost("dhaka-fashion.com")).toEqual({ kind: "shop-custom-candidate" });
    expect(classifyHost("www.dhaka-fashion.com")).toEqual({ kind: "shop-custom-candidate" });
    // app.<merchant domain> is not special-cased: only the by-domain
    // lookup (exact VERIFIED domain) can make it a shop host.
    expect(classifyHost("app.dhaka-fashion.com")).toEqual({ kind: "shop-custom-candidate" });
    expect(classifyHost("shop.example.com")).toEqual({ kind: "shop-custom-candidate" });
  });
});

describe("isPanelPath / panelAppRedirectUrl (TD5)", () => {
  it("matches the panel surfaces and their subpaths by first segment", () => {
    for (const path of [
      "/dashboard",
      "/dashboard/orders",
      "/dashboard/portfolio",
      "/login",
      "/register",
      "/onboarding",
      "/accept-invite",
    ]) {
      expect(isPanelPath(path), path).toBe(true);
    }
  });

  it("does not match shop or public paths, nor look-alike segments", () => {
    for (const path of ["/", "/products/blue-panjabi", "/cart", "/checkout", "/dashboardx", "/login-history", "/shop/my-shop"]) {
      expect(isPanelPath(path), path).toBe(false);
    }
  });

  it("builds the app-host redirect target with path and query preserved", () => {
    expect(panelAppRedirectUrl("/dashboard", "")).toBe("https://app.qosprey.com/dashboard");
    expect(panelAppRedirectUrl("/dashboard/orders", "?tab=open")).toBe(
      "https://app.qosprey.com/dashboard/orders?tab=open",
    );
    expect(panelAppRedirectUrl("/accept-invite", "?token=abc123")).toBe(
      "https://app.qosprey.com/accept-invite?token=abc123",
    );
    expect(panelAppRedirectUrl("/login", "next=%2Fdashboard")).toBe(
      "https://app.qosprey.com/login?next=%2Fdashboard",
    );
    expect(panelAppRedirectUrl("/register")).toBe("https://app.qosprey.com/register");
  });
});

describe("canonicalShopRedirectUrl (TD7)", () => {
  it("redirects platform-host /shop/<slug> paths to the tenant subdomain, rest + query preserved", () => {
    expect(canonicalShopRedirectUrl("app.qosprey.com", "/shop/dhaka-fashion")).toBe(
      "https://dhaka-fashion.qosprey.com/",
    );
    expect(canonicalShopRedirectUrl("qosprey.com", "/shop/dhaka-fashion/products/blue-panjabi", "?x=1")).toBe(
      "https://dhaka-fashion.qosprey.com/products/blue-panjabi?x=1",
    );
    expect(canonicalShopRedirectUrl("www.qosprey.com", "/shop/mirpur-shop/cart")).toBe(
      "https://mirpur-shop.qosprey.com/cart",
    );
    expect(canonicalShopRedirectUrl("APP.Qosprey.com:443", "/shop/dhaka-fashion/checkout")).toBe(
      "https://dhaka-fashion.qosprey.com/checkout",
    );
  });

  it("never fires on a shop host — the rewrite target cannot loop", () => {
    // Tenant subdomain host: a direct /shop/ path serves as-is.
    expect(canonicalShopRedirectUrl("dhaka-fashion.qosprey.com", "/shop/dhaka-fashion")).toBeNull();
    expect(canonicalShopRedirectUrl("dhaka-fashion.qosprey.com", "/shop/dhaka-fashion/products/a")).toBeNull();
    // Custom-domain candidate host: not the platform's call either.
    expect(canonicalShopRedirectUrl("dhaka-fashion.com", "/shop/dhaka-fashion")).toBeNull();
    // Unknown (multi-level under the apex): untouched.
    expect(canonicalShopRedirectUrl("a.b.qosprey.com", "/shop/dhaka-fashion")).toBeNull();
  });

  it("refuses reserved/malformed slugs and non-shop paths", () => {
    expect(canonicalShopRedirectUrl("app.qosprey.com", "/shop/app")).toBeNull(); // reserved: platform itself
    expect(canonicalShopRedirectUrl("app.qosprey.com", "/shop/fake")).toBeNull(); // reserved misleading
    expect(canonicalShopRedirectUrl("app.qosprey.com", "/shop/bad--slug")).toBeNull(); // malformed
    expect(canonicalShopRedirectUrl("app.qosprey.com", "/shop")).toBeNull();
    expect(canonicalShopRedirectUrl("app.qosprey.com", "/shop/")).toBeNull();
    expect(canonicalShopRedirectUrl("app.qosprey.com", "/dashboard")).toBeNull();
    expect(canonicalShopRedirectUrl("app.qosprey.com", "/")).toBeNull();
    expect(canonicalShopRedirectUrl("", "/shop/dhaka-fashion")).toBeNull();
    expect(canonicalShopRedirectUrl(null, "/shop/dhaka-fashion")).toBeNull();
  });
});
