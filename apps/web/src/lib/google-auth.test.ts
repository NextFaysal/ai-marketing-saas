import { describe, expect, it } from "vitest";
import { googleErrorMessage, parseHandoffFromHash } from "./google-auth";

describe("AB8 AX26 googleErrorMessage", () => {
  it("maps the specific codes to their Bengali messages", () => {
    expect(googleErrorMessage("account_not_found")).toBe(
      "এই Google অ্যাকাউন্টের ইমেইলে কোনো অ্যাকাউন্ট নেই — আগে পাসওয়ার্ড দিয়ে নিবন্ধন করুন",
    );
    expect(googleErrorMessage("account_inactive")).toBe("অ্যাকাউন্টটি সক্রিয় নয়");
    expect(googleErrorMessage("email_unverified")).toBe("Google অ্যাকাউন্টের ইমেইল যাচাই করা নয়");
  });

  it("falls back to the generic message for the remaining known codes", () => {
    for (const code of ["not_configured", "state_invalid", "exchange_failed"]) {
      expect(googleErrorMessage(code)).toBe("Google লগইন ব্যর্থ হয়েছে — আবার চেষ্টা করুন");
    }
  });

  it("falls back to the generic message for unknown codes (never renders the raw code)", () => {
    expect(googleErrorMessage("something_else")).toBe("Google লগইন ব্যর্থ হয়েছে — আবার চেষ্টা করুন");
  });

  it("returns null when there is no code", () => {
    expect(googleErrorMessage(null)).toBeNull();
    expect(googleErrorMessage(undefined)).toBeNull();
    expect(googleErrorMessage("")).toBeNull();
  });
});

describe("AB8 AX26 parseHandoffFromHash", () => {
  it("reads the handoff token from the fragment", () => {
    expect(parseHandoffFromHash("#handoff=tok123")).toBe("tok123");
  });

  it("ignores extra fragment params and decodes escapes", () => {
    expect(parseHandoffFromHash("#handoff=a%2Fb%3Dc&other=1")).toBe("a/b=c");
  });

  it("returns null for missing/empty fragments and empty tokens", () => {
    expect(parseHandoffFromHash("")).toBeNull();
    expect(parseHandoffFromHash("#")).toBeNull();
    expect(parseHandoffFromHash(null)).toBeNull();
    expect(parseHandoffFromHash(undefined)).toBeNull();
    expect(parseHandoffFromHash("#other=1")).toBeNull();
    expect(parseHandoffFromHash("#handoff=")).toBeNull();
    expect(parseHandoffFromHash("#handoff=%20")).toBeNull();
  });
});
