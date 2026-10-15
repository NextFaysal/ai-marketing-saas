import { describe, it, expect } from "vitest";
import { registerSchema, createOrganizationSchema, inviteMemberSchema, parseMoneyToMinor, formatMinor, checkSlugLocally, isReservedSlug, shopSubdomainHost } from "./index";

describe("contracts", () => {
  it("rejects short passwords", () => {
    expect(registerSchema.safeParse({ name: "Al", email: "a@b.com", password: "short" }).success).toBe(false);
  });
  it("accepts a valid organization", () => {
    expect(createOrganizationSchema.safeParse({ name: "My Store", slug: "my-store" }).success).toBe(true);
  });
  it("rejects invalid slugs", () => {
    expect(createOrganizationSchema.safeParse({ name: "My Store", slug: "My Store!" }).success).toBe(false);
  });
  it("cannot invite an OWNER via invite schema", () => {
    expect(inviteMemberSchema.safeParse({ email: "x@y.com", role: "OWNER" }).success).toBe(false);
  });
});

describe("TD1 slug rules", () => {
  it("accepts ordinary shop slugs", () => {
    for (const slug of ["my-store", "dhaka-fashion", "shop123", "a-b-c", "mirpur-electronics-2"]) {
      expect(createOrganizationSchema.safeParse({ name: "My Store", slug }).success, slug).toBe(true);
      expect(checkSlugLocally(slug)).toEqual({ ok: true });
    }
  });
  it("rejects hyphen misuse and bad shapes", () => {
    for (const slug of ["-my-store", "my-store-", "my--store", "My-Store", "my_store", "ab", "a".repeat(61), "দোকান"]) {
      expect(createOrganizationSchema.safeParse({ name: "My Store", slug }).success, slug).toBe(false);
      expect(checkSlugLocally(slug)).toEqual({ ok: false, reason: "invalid" });
    }
  });
  it("reserves system names", () => {
    for (const slug of ["app", "dashboard", "api", "media", "www", "login"]) {
      expect(isReservedSlug(slug), slug).toBe(true);
      expect(checkSlugLocally(slug)).toEqual({ ok: false, reason: "reserved" });
    }
  });
  it("reserves misleading names incl. the owner's examples", () => {
    for (const slug of ["fake", "orgnail", "qosprey", "verified", "original"]) {
      expect(isReservedSlug(slug), slug).toBe(true);
    }
  });
  it("reserves future-product names", () => {
    for (const slug of ["pay", "wallet", "ads", "ai", "inbox", "crm"]) {
      expect(isReservedSlug(slug), slug).toBe(true);
    }
  });
  it("substring rule catches admin/support/official-shaped names", () => {
    for (const slug of ["my-admin-shop", "admin1", "supportbd", "officialstore", "dhaka-official-shop"]) {
      expect(isReservedSlug(slug), slug).toBe(true);
      expect(checkSlugLocally(slug)).toEqual({ ok: false, reason: "reserved" });
    }
    // ...but ordinary names that merely rhyme are not caught.
    expect(isReservedSlug("administerial")).toBe(true); // contains "admin" — documented trade-off
    expect(isReservedSlug("fashion-hub")).toBe(false);
    expect(isReservedSlug("said-shop")).toBe(false); // "ai" is exact-only, not a substring rule
  });
  it("honours caller-supplied extra reserved names (SUPER additions)", () => {
    expect(isReservedSlug("brand-xyz", ["Brand-XYZ"])).toBe(true);
    expect(checkSlugLocally("brand-xyz", ["brand-xyz"])).toEqual({ ok: false, reason: "reserved" });
    expect(isReservedSlug("brand-xyz")).toBe(false);
  });
  it("builds the shop subdomain host", () => {
    expect(shopSubdomainHost("dhaka-fashion")).toBe("dhaka-fashion.qosprey.com");
  });
});

describe("money helpers", () => {
  it("parses decimal strings to integer minor units", () => {
    expect(parseMoneyToMinor("1250.50")).toBe(125050n);
    expect(parseMoneyToMinor("100")).toBe(10000n);
    expect(parseMoneyToMinor("0.05")).toBe(5n);
    expect(parseMoneyToMinor("1,250.50")).toBe(125050n);
  });
  it("rejects invalid money values", () => {
    expect(() => parseMoneyToMinor("abc")).toThrow();
    expect(() => parseMoneyToMinor("10.999")).toThrow();
  });
  it("formats minor units back for display", () => {
    expect(formatMinor(125050n, "BDT")).toBe("BDT 1250.50");
    expect(formatMinor(-500n, "USD")).toBe("-USD 5.00");
  });
});
