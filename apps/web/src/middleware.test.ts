import { NextRequest } from "next/server";
import { afterEach, describe, expect, it, vi } from "vitest";
import { middleware } from "./middleware";

/**
 * TD4/TD5 routing table at the middleware level:
 * host class × path → redirect (308 to the platform app host) /
 * rewrite (onto /shop/<slug>) / next (untouched). The by-domain
 * lookup fetch is stubbed per host; module cache is keyed by host,
 * so every case uses its own host name.
 */

function req(url: string): NextRequest {
  return new NextRequest(url);
}

function stubByDomain(slugs: Record<string, string | null>) {
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: unknown) => {
      const url = String(input);
      const host = decodeURIComponent(url.split("/public/shop/by-domain/")[1] ?? "");
      const slug = slugs[host] ?? null;
      if (!slug) return { ok: false, json: async () => null };
      return { ok: true, json: async () => ({ organizationSlug: slug }) };
    }),
  );
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("middleware — tenant subdomain (TD4)", () => {
  it("rewrites the shop surface at the subdomain root without any lookup", async () => {
    stubByDomain({}); // any fetch would miss; subdomain must not need one
    const home = await middleware(req("https://dhaka-fashion.qosprey.com/"));
    expect(home.headers.get("x-middleware-rewrite")).toContain("/shop/dhaka-fashion");
    const product = await middleware(req("https://dhaka-fashion.qosprey.com/products/blue-panjabi"));
    expect(product.headers.get("x-middleware-rewrite")).toContain("/shop/dhaka-fashion/products/blue-panjabi");
    const cart = await middleware(req("https://dhaka-fashion.qosprey.com/cart"));
    expect(cart.headers.get("x-middleware-rewrite")).toContain("/shop/dhaka-fashion/cart");
  });

  it("passes platform and unknown hosts through untouched", async () => {
    stubByDomain({});
    for (const url of [
      "https://app.qosprey.com/dashboard",
      "https://app.qosprey.com/",
      "https://qosprey.com/pricing",
      "https://admin.qosprey.com/",
      "https://a.b.qosprey.com/dashboard", // multi-level: unknown, no redirect either
      "https://dashboard.qosprey.com/login", // reserved name = platform namespace
    ]) {
      const res = await middleware(req(url));
      expect(res.status, url).toBe(200);
      expect(res.headers.get("x-middleware-rewrite"), url).toBeNull();
      expect(res.headers.get("location"), url).toBeNull();
    }
  });
});

describe("middleware — panel redirect on shop hosts (TD5)", () => {
  it("308-redirects panel paths on a tenant subdomain, query string preserved", async () => {
    stubByDomain({});
    const dash = await middleware(req("https://dhaka-fashion.qosprey.com/dashboard/orders?tab=open"));
    expect(dash.status).toBe(308);
    expect(dash.headers.get("location")).toBe("https://app.qosprey.com/dashboard/orders?tab=open");

    const invite = await middleware(req("https://mirpur-shop.qosprey.com/accept-invite?token=abc123"));
    expect(invite.status).toBe(308);
    expect(invite.headers.get("location")).toBe("https://app.qosprey.com/accept-invite?token=abc123");

    for (const path of ["/login", "/register", "/onboarding"]) {
      const res = await middleware(req(`https://mirpur-shop.qosprey.com${path}`));
      expect(res.status, path).toBe(308);
      expect(res.headers.get("location"), path).toBe(`https://app.qosprey.com${path}`);
    }
  });

  it("does NOT redirect panel paths on the platform app host", async () => {
    stubByDomain({});
    const res = await middleware(req("https://app.qosprey.com/dashboard"));
    expect(res.status).toBe(200);
    expect(res.headers.get("location")).toBeNull();
  });

  it("308-redirects panel paths on a VERIFIED custom domain", async () => {
    stubByDomain({ "fashionshop.example.com": "fashion-shop" });
    const res = await middleware(req("https://fashionshop.example.com/login?next=%2Fdashboard"));
    expect(res.status).toBe(308);
    expect(res.headers.get("location")).toBe("https://app.qosprey.com/login?next=%2Fdashboard");
  });

  it("does NOT redirect or rewrite on an UNVERIFIED custom domain", async () => {
    stubByDomain({ "unknown.example.com": null });
    for (const path of ["/login", "/dashboard", "/"]) {
      const res = await middleware(req(`https://unknown.example.com${path}`));
      expect(res.status, path).toBe(200);
      expect(res.headers.get("location"), path).toBeNull();
      expect(res.headers.get("x-middleware-rewrite"), path).toBeNull();
    }
  });

  it("still rewrites the shop surface on a VERIFIED custom domain (EC8 regression)", async () => {
    stubByDomain({ "boutique.example.com": "boutique" });
    const res = await middleware(req("https://boutique.example.com/"));
    expect(res.headers.get("x-middleware-rewrite")).toContain("/shop/boutique");
  });
});
