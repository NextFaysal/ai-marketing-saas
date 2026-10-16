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

describe("middleware — canonical shop redirect (TD7)", () => {
  it("301-redirects legacy /shop/<slug> paths on platform hosts to the tenant subdomain", async () => {
    stubByDomain({});
    const home = await middleware(req("https://app.qosprey.com/shop/dhaka-fashion"));
    expect(home.status).toBe(301);
    expect(home.headers.get("location")).toBe("https://dhaka-fashion.qosprey.com/");

    const product = await middleware(
      req("https://qosprey.com/shop/dhaka-fashion/products/blue-panjabi?utm=fb"),
    );
    expect(product.status).toBe(301);
    expect(product.headers.get("location")).toBe(
      "https://dhaka-fashion.qosprey.com/products/blue-panjabi?utm=fb",
    );
  });

  it("cannot loop: the redirect target rewrites, and a shop host never redirects its own /shop/ path", async () => {
    stubByDomain({});
    // Follow the 301 by hand: same path tail on the subdomain host.
    const followed = await middleware(req("https://dhaka-fashion.qosprey.com/products/blue-panjabi?utm=fb"));
    expect(followed.status).toBe(200);
    expect(followed.headers.get("location")).toBeNull();
    expect(followed.headers.get("x-middleware-rewrite")).toContain(
      "/shop/dhaka-fashion/products/blue-panjabi",
    );
    // A /shop/ path arriving directly ON the shop host serves, no redirect.
    const direct = await middleware(req("https://dhaka-fashion.qosprey.com/shop/dhaka-fashion"));
    expect(direct.status).toBe(200);
    expect(direct.headers.get("location")).toBeNull();
  });

  it("does not redirect reserved slugs or non-shop platform paths", async () => {
    stubByDomain({});
    for (const url of [
      "https://app.qosprey.com/shop/app", // reserved — platform namespace
      "https://app.qosprey.com/shop/fake", // reserved misleading name
      "https://app.qosprey.com/shop", // no slug segment
      "https://app.qosprey.com/dashboard",
    ]) {
      const res = await middleware(req(url));
      expect(res.status, url).toBe(200);
      expect(res.headers.get("location"), url).toBeNull();
    }
  });
});
