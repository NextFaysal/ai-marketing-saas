import { describe, expect, it } from "vitest";
import {
  NOTIFICATION_CATEGORIES,
  NOTIFICATION_CATEGORY_KEYS,
  buildCustomRolePayload,
  buildCustomRoleUpdatePayload,
  canRevokeOwnSession,
  isCategoryEnabled,
  isCurrentSession,
  toggleMutedCategory,
} from "./gb6-team";

describe("notification category catalog (mirror of agent-notify.ts)", () => {
  it("has exactly the API's 8 categories in order", () => {
    expect(NOTIFICATION_CATEGORY_KEYS).toEqual([
      "orders", "inbox", "inventory", "billing", "marketing", "automation", "leads", "general",
    ]);
    expect(NOTIFICATION_CATEGORIES.map((c) => c.labelBn)).toEqual([
      "অর্ডার", "ইনবক্স", "ইনভেন্টরি", "বিলিং", "মার্কেটিং", "অটোমেশন", "লিড", "সাধারণ",
    ]);
  });
});

describe("mutedCategories toggle logic", () => {
  it("a category is enabled unless muted", () => {
    expect(isCategoryEnabled([], "orders")).toBe(true);
    expect(isCategoryEnabled(["orders"], "orders")).toBe(false);
    expect(isCategoryEnabled(["orders"], "inbox")).toBe(true);
  });

  it("toggling off adds the key, toggling on removes it", () => {
    expect(toggleMutedCategory([], "orders")).toEqual(["orders"]);
    expect(toggleMutedCategory(["orders"], "orders")).toEqual([]);
    expect(toggleMutedCategory(toggleMutedCategory([], "billing"), "billing")).toEqual([]);
  });

  it("returns keys deduped in catalog order and ignores unknown keys", () => {
    expect(toggleMutedCategory(["leads", "orders"], "inbox")).toEqual(["orders", "inbox", "leads"]);
    expect(toggleMutedCategory(["bogus", "orders"], "inbox")).toEqual(["orders", "inbox"]);
    // An unknown toggle target leaves the list untouched.
    expect(toggleMutedCategory(["orders"], "bogus")).toEqual(["orders"]);
  });
});

describe("custom role payloads", () => {
  it("preset mode sends presetKey ALONE (server 400s on name/areas alongside)", () => {
    const { payload, errors } = buildCustomRolePayload({ mode: "preset", presetKey: "FINANCE" });
    expect(errors).toEqual([]);
    expect(payload).toEqual({ presetKey: "FINANCE" });
    expect(payload).not.toHaveProperty("name");
    expect(payload).not.toHaveProperty("areas");
    expect(buildCustomRolePayload({ mode: "preset", presetKey: " " }).payload).toBeNull();
  });

  it("scratch mode requires a 1-60 char name and at least one area, deduped", () => {
    const ok = buildCustomRolePayload({ mode: "scratch", name: " স্টোর সহকারী ", areas: ["orders", "orders", "inbox"] });
    expect(ok.payload).toEqual({ name: "স্টোর সহকারী", areas: ["orders", "inbox"] });
    expect(buildCustomRolePayload({ mode: "scratch", name: "", areas: ["orders"] }).payload).toBeNull();
    expect(buildCustomRolePayload({ mode: "scratch", name: "x".repeat(61), areas: ["orders"] }).payload).toBeNull();
    expect(buildCustomRolePayload({ mode: "scratch", name: "ঠিক আছে", areas: [] }).errors.join(" ")).toContain("এলাকা");
  });

  it("update payload has the scratch shape (no presetKey)", () => {
    const ok = buildCustomRoleUpdatePayload("নতুন নাম", ["billing"]);
    expect(ok.payload).toEqual({ name: "নতুন নাম", areas: ["billing"] });
    expect(buildCustomRoleUpdatePayload("নাম", []).payload).toBeNull();
  });
});

describe("session current-flag handling", () => {
  it("only current === true counts as the current session", () => {
    expect(isCurrentSession({ current: true })).toBe(true);
    expect(isCurrentSession({ current: false })).toBe(false);
    expect(isCurrentSession({})).toBe(false);
  });

  it("revoke is offered for other sessions but disabled for the current one", () => {
    expect(canRevokeOwnSession({ current: false })).toBe(true);
    expect(canRevokeOwnSession({})).toBe(true);
    expect(canRevokeOwnSession({ current: true })).toBe(false);
  });
});
