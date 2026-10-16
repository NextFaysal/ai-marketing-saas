import { describe, expect, it } from "vitest";
import {
  DEFAULT_PRIMARY_HOSTS,
  customJsAllowedOnHost,
  normalizeHost,
  primaryHostsFromEnv,
} from "./shop-custom-code";

describe("AB8 customJsAllowedOnHost", () => {
  const primaries = ["app.qosprey.com", "admin.qosprey.com"];

  it("refuses the primary app hosts — with port and with case variations", () => {
    expect(customJsAllowedOnHost("app.qosprey.com", primaries)).toBe(false);
    expect(customJsAllowedOnHost("app.qosprey.com:3000", primaries)).toBe(false);
    expect(customJsAllowedOnHost("APP.QOSPREY.COM", primaries)).toBe(false);
    expect(customJsAllowedOnHost("Admin.Qosprey.com:443", primaries)).toBe(false);
    // a subdomain OF a primary host is still the app origin family
    expect(customJsAllowedOnHost("evil.app.qosprey.com", primaries)).toBe(false);
  });

  it("allows tenant subdomains — including one ending in 'app'", () => {
    expect(customJsAllowedOnHost("myshop.qosprey.com", primaries)).toBe(true);
    expect(customJsAllowedOnHost("myapp.qosprey.com", primaries)).toBe(true);
    expect(customJsAllowedOnHost("myshop.qosprey.com:3000", primaries)).toBe(true);
  });

  it("allows verified custom domains", () => {
    expect(customJsAllowedOnHost("shop.example.com", primaries)).toBe(true);
    expect(customJsAllowedOnHost("www.merchant-store.com.bd", primaries)).toBe(true);
  });

  it("refuses null / empty / blank hosts", () => {
    expect(customJsAllowedOnHost(null, primaries)).toBe(false);
    expect(customJsAllowedOnHost("", primaries)).toBe(false);
    expect(customJsAllowedOnHost("   ", primaries)).toBe(false);
  });

  it("normalizeHost lowercases and strips the port", () => {
    expect(normalizeHost("ExAmPle.com:8080")).toBe("example.com");
    expect(normalizeHost("example.com")).toBe("example.com");
  });
});

describe("AB8 primaryHostsFromEnv", () => {
  it("always includes the defaults", () => {
    expect(primaryHostsFromEnv({})).toEqual(DEFAULT_PRIMARY_HOSTS);
  });

  it("adds NEXT_PUBLIC_APP_HOST (bare host, host:port, or URL)", () => {
    expect(primaryHostsFromEnv({ NEXT_PUBLIC_APP_HOST: "app.example.com" })).toContain("app.example.com");
    expect(primaryHostsFromEnv({ NEXT_PUBLIC_APP_HOST: "app.example.com:3000" })).toContain("app.example.com");
    expect(primaryHostsFromEnv({ NEXT_PUBLIC_APP_HOST: "https://app.example.com/x" })).toContain("app.example.com");
  });

  it("adds the host of NEXT_PUBLIC_WEB_URL", () => {
    const hosts = primaryHostsFromEnv({ NEXT_PUBLIC_WEB_URL: "https://app.qosprey.com/" });
    expect(hosts).toContain("app.qosprey.com");
    const staging = primaryHostsFromEnv({ NEXT_PUBLIC_WEB_URL: "https://staging.example.com" });
    expect(staging).toContain("staging.example.com");
    expect(staging).toContain("app.qosprey.com");
  });

  it("a host learned from env is then refused by the rule", () => {
    const primaries = primaryHostsFromEnv({ NEXT_PUBLIC_WEB_URL: "https://staging.example.com" });
    expect(customJsAllowedOnHost("staging.example.com", primaries)).toBe(false);
    expect(customJsAllowedOnHost("tenant.qosprey.com", primaries)).toBe(true);
  });
});
