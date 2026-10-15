import {
  customDomainCandidates,
  customDomainVariants,
  isPlatformHostedDomain,
  normalizeCustomDomainInput,
} from "./custom-domain";

/**
 * TD9 — pure table for the shared custom-domain helpers.
 * No I/O, no Prisma: these functions are the single rulebook the
 * storefront, branding and CORS paths all share.
 */

describe("TD9 custom-domain — normalizeCustomDomainInput", () => {
  it.each([
    ["example.com", "example.com"],
    ["  Example.COM  ", "example.com"],
    ["https://example.com", "example.com"],
    ["http://example.com", "example.com"],
    ["https://Example.com/shop/path?x=1", "example.com"],
    ["example.com/", "example.com"],
    ["www.Example.com", "www.example.com"],
    ["", ""],
    ["   ", ""],
    [null, ""],
    [undefined, ""],
  ])("normalize(%j) === %j", (raw, expected) => {
    expect(normalizeCustomDomainInput(raw as any)).toBe(expected);
  });
});

describe("TD9 custom-domain — customDomainVariants (www toggle)", () => {
  it.each([
    ["example.com", ["example.com", "www.example.com"]],
    ["www.example.com", ["www.example.com", "example.com"]],
    ["shop.example.com", ["shop.example.com", "www.shop.example.com"]],
    ["www.shop.example.com", ["www.shop.example.com", "shop.example.com"]],
    ["qosprey.com", ["qosprey.com", "www.qosprey.com"]],
    ["www.qosprey.com", ["www.qosprey.com", "qosprey.com"]],
    ["", []],
  ])("variants(%j) === %j", (host, expected) => {
    expect(customDomainVariants(host)).toEqual(expected);
  });

  it("normalises before toggling (case / protocol / path do not leak into variants)", () => {
    expect(customDomainVariants("HTTPS://WWW.Example.com/x")).toEqual([
      "www.example.com",
      "example.com",
    ]);
  });
});

describe("TD9 custom-domain — customDomainCandidates (normalize + variants)", () => {
  it.each([
    ["example.com", ["example.com", "www.example.com"]],
    ["https://www.Example.com/path", ["www.example.com", "example.com"]],
    ["  shop.example.com ", ["shop.example.com", "www.shop.example.com"]],
    ["", []],
    [null, []],
    [undefined, []],
  ])("candidates(%j) === %j", (raw, expected) => {
    expect(customDomainCandidates(raw as any)).toEqual(expected);
  });
});

describe("TD9 custom-domain — isPlatformHostedDomain", () => {
  it.each([
    ["qosprey.com", true],
    ["www.qosprey.com", true],
    ["x.qosprey.com", true],
    ["shop.qosprey.com", true],
    ["a.b.qosprey.com", true],
    ["HTTPS://Qosprey.com/path", true],
    ["example.com", false],
    ["www.example.com", false],
    ["evilqosprey.com", false],
    ["notqosprey.com", false],
    ["qosprey.com.evil.com", false],
    ["qosprey.comm", false],
    ["", false],
    [null, false],
  ])("isPlatformHostedDomain(%j) === %j", (raw, expected) => {
    expect(isPlatformHostedDomain(raw as any)).toBe(expected);
  });
});
