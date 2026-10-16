import { describe, expect, it } from "vitest";
import {
  EMPTY_FRAUD_RULE_DRAFT,
  buildFraudRulePayload,
  captchaSiteKeyFor,
  exceedsMinor,
  fraudAttemptKindLabel,
  normalizeIdentifierValue,
  termsHrefFor,
  identifierKindLabel,
  validateIdentifierInput,
  type CheckoutTrust,
} from "./orders-gb3";

const trust: CheckoutTrust = {
  termsRequired: true,
  termsRef: null,
  termsUrl: null,
  termsPage: true,
  captcha: { checkoutEnabled: true, otpEnabled: false, siteKey: "site-1" },
  cod: { maxOrderMinor: null, advanceAboveMinor: "50000" },
};

describe("buildFraudRulePayload", () => {
  it("converts taka to a minor string and keeps set conditions", () => {
    const { payload, errors } = buildFraudRulePayload({
      ...EMPTY_FRAUD_RULE_DRAFT, name: "বড় COD", minTotalTaka: "5000.50", isCod: true,
    });
    expect(errors).toEqual([]);
    expect(payload).toEqual({
      name: "বড় COD", action: "hold",
      conditions: { minTotalMinor: "500050", isCod: true },
    });
  });

  it("drops empty conditions entirely", () => {
    const { payload } = buildFraudRulePayload({ ...EMPTY_FRAUD_RULE_DRAFT, name: "খালি" });
    expect(payload?.conditions).toEqual({});
  });

  it("splits districts and parses numeric conditions", () => {
    const { payload } = buildFraudRulePayload({
      ...EMPTY_FRAUD_RULE_DRAFT, name: "জেলা", districtsText: " খুলনা, বরিশাল ,",
      phoneOpenOrdersGte: "3", minRiskScore: "70",
    });
    expect(payload?.conditions).toEqual({
      districtIn: ["খুলনা", "বরিশাল"], phoneOpenOrdersGte: 3, minRiskScore: 70,
    });
  });

  it("flags a tag rule without a tagValue and sends it when present", () => {
    const bad = buildFraudRulePayload({ ...EMPTY_FRAUD_RULE_DRAFT, name: "ট্যাগ", action: "tag" });
    expect(bad.payload).toBeNull();
    expect(bad.errors.join(" ")).toContain("tagValue");
    const good = buildFraudRulePayload({ ...EMPTY_FRAUD_RULE_DRAFT, name: "ট্যাগ", action: "tag", tagValue: "সন্দেহজনক" });
    expect(good.payload).toEqual({ name: "ট্যাগ", action: "tag", tagValue: "সন্দেহজনক", conditions: {} });
  });

  it("does not send tagValue for non-tag actions and flags bad numbers", () => {
    const { payload } = buildFraudRulePayload({
      ...EMPTY_FRAUD_RULE_DRAFT, name: "হোল্ড", action: "hold", tagValue: "অপ্রযোজ্য",
    });
    expect(payload).not.toHaveProperty("tagValue");
    const bad = buildFraudRulePayload({ ...EMPTY_FRAUD_RULE_DRAFT, name: "x", minTotalTaka: "abc" });
    expect(bad.payload).toBeNull();
    expect(bad.errors.length).toBeGreaterThan(0);
  });

  it("requires a name", () => {
    expect(buildFraudRulePayload({ ...EMPTY_FRAUD_RULE_DRAFT }).payload).toBeNull();
  });
});

describe("validateIdentifierInput", () => {
  it("accepts plausible phone / email / ip values", () => {
    expect(validateIdentifierInput("phone", "01712345678", ["phone"])).toBeNull();
    expect(validateIdentifierInput("email", "A@B.com", ["email", "ip"])).toBeNull();
    expect(validateIdentifierInput("ip", "192.168.0.1", ["email", "ip"])).toBeNull();
    expect(validateIdentifierInput("ip", "2001:db8::1", ["ip"])).toBeNull();
  });

  it("rejects empty, malformed and disallowed-kind values", () => {
    expect(validateIdentifierInput("email", "  ", ["email"])).not.toBeNull();
    expect(validateIdentifierInput("email", "not-an-email", ["email"])).not.toBeNull();
    expect(validateIdentifierInput("ip", "999.1", ["ip"])).not.toBeNull();
    expect(validateIdentifierInput("phone", "123", ["phone"])).not.toBeNull();
    expect(validateIdentifierInput("phone", "01712345678", ["email"])).not.toBeNull();
  });

  it("normalizes email to lowercase and trims", () => {
    expect(normalizeIdentifierValue("email", "  A@B.COM ")).toBe("a@b.com");
    expect(normalizeIdentifierValue("phone", " 0171 ")).toBe("0171");
  });

  it("accepts a 64-char hex device hash and normalizes it to lowercase (AB8/AX27)", () => {
    const hash = "ABCDEF0123456789".repeat(4);
    expect(hash).toHaveLength(64);
    expect(validateIdentifierInput("device", hash, ["device"])).toBeNull();
    expect(validateIdentifierInput("device", `  ${hash.toLowerCase()} `, ["phone", "device"])).toBeNull();
    expect(normalizeIdentifierValue("device", ` ${hash} `)).toBe(hash.toLowerCase());
    expect(identifierKindLabel("device")).toBe("ডিভাইস হ্যাশ");
  });

  it("rejects malformed device hashes with a Bengali message", () => {
    // A hash PREFIX (e.g. the 12-char attempt summary) is not an identifier.
    expect(validateIdentifierInput("device", "abcdef012345", ["device"])).toContain("ডিভাইস হ্যাশ");
    expect(validateIdentifierInput("device", "g".repeat(64), ["device"])).not.toBeNull();
    expect(validateIdentifierInput("device", "a".repeat(63), ["device"])).not.toBeNull();
    expect(validateIdentifierInput("device", "a".repeat(65), ["device"])).not.toBeNull();
    expect(validateIdentifierInput("device", "", ["device"])).not.toBeNull();
    expect(validateIdentifierInput("device", "a".repeat(64), ["email"])).not.toBeNull();
  });
});

describe("checkout trust helpers", () => {
  it("returns a captcha site key only for enabled surfaces with a key", () => {
    expect(captchaSiteKeyFor(trust, "checkout")).toBe("site-1");
    expect(captchaSiteKeyFor(trust, "otp")).toBeNull();
    expect(captchaSiteKeyFor({ ...trust, captcha: { ...trust.captcha, siteKey: null } }, "checkout")).toBeNull();
    expect(captchaSiteKeyFor(null, "checkout")).toBeNull();
  });

  it("prefers an explicit terms URL, else the shop terms page", () => {
    expect(termsHrefFor(trust, "my-shop")).toBe("/shop/my-shop/p/terms");
    expect(termsHrefFor({ ...trust, termsUrl: "https://example.com/terms" }, "my-shop")).toBe("https://example.com/terms");
    expect(termsHrefFor({ ...trust, termsPage: false }, "my-shop")).toBeNull();
    expect(termsHrefFor({ ...trust, termsRequired: false }, "my-shop")).toBeNull();
  });

  it("compares minor units exactly for the advance threshold", () => {
    expect(exceedsMinor("60000", "50000")).toBe(true);
    expect(exceedsMinor("50000", "50000")).toBe(false);
    expect(exceedsMinor("100", null)).toBe(false);
    expect(exceedsMinor("bogus", "50000")).toBe(false);
  });

  it("labels every fraud-attempt kind and passes unknown kinds through", () => {
    for (const k of ["blocked_identifier", "open_order_policy", "waiting_period", "daily_limit", "captcha", "fraud_rule"]) {
      expect(fraudAttemptKindLabel(k)).not.toBe(k);
    }
    expect(fraudAttemptKindLabel("something_new")).toBe("something_new");
  });
});
