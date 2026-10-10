import { describe, it, expect } from "vitest";
import { registerSchema, createOrganizationSchema, inviteMemberSchema, parseMoneyToMinor, formatMinor } from "./index";

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
