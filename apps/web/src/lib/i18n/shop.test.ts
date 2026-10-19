import { describe, expect, it } from "vitest";
import { shopDicts, shopT } from "./shop";

function flatten(value: unknown, prefix = ""): Map<string, string> {
  const out = new Map<string, string>();
  if (typeof value === "string") {
    out.set(prefix, value);
    return out;
  }
  if (value && typeof value === "object") {
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      for (const [fk, fv] of flatten(v, prefix ? `${prefix}.${k}` : k)) out.set(fk, fv);
    }
  }
  return out;
}

describe("shop i18n dictionary", () => {
  it("exposes exactly the same key set in both locales", () => {
    const bnKeys = [...flatten(shopDicts.bn).keys()].sort();
    const enKeys = [...flatten(shopDicts.en).keys()].sort();
    expect(enKeys).toEqual(bnKeys);
    expect(bnKeys.length).toBeGreaterThan(50);
  });

  it("has no empty string values in either locale", () => {
    for (const locale of ["bn", "en"] as const) {
      for (const [key, value] of flatten(shopDicts[locale])) {
        expect(value.trim(), `${locale}.${key}`).not.toBe("");
      }
    }
  });

  it("shopT falls back to bn for unknown input", () => {
    expect(shopT("en")).toBe(shopDicts.en);
    expect(shopT("bn")).toBe(shopDicts.bn);
    expect(shopT("fr")).toBe(shopDicts.bn);
    expect(shopT(undefined)).toBe(shopDicts.bn);
    expect(shopT(null)).toBe(shopDicts.bn);
    expect(shopT(42)).toBe(shopDicts.bn);
  });
});
