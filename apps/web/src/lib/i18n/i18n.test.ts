import { afterEach, describe, expect, it, vi } from "vitest";
import { dicts, getDict } from "./dict";
import { lookup } from "./lookup";
import { shopDicts } from "./shop";

// Pure dictionary tests — deliberately imported from ./dict,
// ./lookup and ./shop directly (NOT from ./index, which also
// re-exports the React provider and its @repo/contracts runtime
// import), so this file never needs a built contracts dist.

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

afterEach(() => {
  vi.restoreAllMocks();
});

describe("dashboard i18n dictionary (ML1/ML3)", () => {
  it("exposes exactly the same key set in bn and en, with no empty values", () => {
    const bn = flatten(dicts.bn);
    const en = flatten(dicts.en);
    expect([...en.keys()].sort()).toEqual([...bn.keys()].sort());
    expect(bn.size).toBeGreaterThan(10);
    for (const [locale, flat] of [["bn", bn], ["en", en]] as const) {
      for (const [key, value] of flat) {
        expect(value.trim(), `${locale}.${key}`).not.toBe("");
      }
    }
  });

  it("keeps the shop namespace parity (folded in as ./shop)", () => {
    const bnKeys = [...flatten(shopDicts.bn).keys()].sort();
    const enKeys = [...flatten(shopDicts.en).keys()].sort();
    expect(enKeys).toEqual(bnKeys);
    expect(bnKeys.length).toBeGreaterThan(50);
  });

  it("getDict falls back to bn for unknown locales", () => {
    expect(getDict("en")).toBe(dicts.en);
    expect(getDict("bn")).toBe(dicts.bn);
    expect(getDict("fr")).toBe(dicts.bn);
    expect(getDict(undefined)).toBe(dicts.bn);
  });
});

describe("lookup (ML-L2/L6 fallback + missing-key log)", () => {
  it("returns the en value when present, without warning", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    expect(lookup(dicts, "en", "common.save")).toBe(dicts.en.common.save);
    expect(lookup(dicts, "bn", "common.save")).toBe(dicts.bn.common.save);
    expect(warn).not.toHaveBeenCalled();
  });

  it("falls back to the bn value and warns once when the en key is missing", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    // A cloned/partial dict — the real dicts are never mutated.
    const partial = {
      bn: dicts.bn,
      en: {
        ...dicts.en,
        common: { ...dicts.en.common, save: "" },
        settingsLanguage: { ...dicts.en.settingsLanguage },
      },
    };
    delete (partial.en.settingsLanguage as Partial<typeof dicts.en.settingsLanguage>).orgSave;

    expect(lookup(partial, "en", "common.save")).toBe(dicts.bn.common.save);
    expect(lookup(partial, "en", "settingsLanguage.orgSave")).toBe(
      dicts.bn.settingsLanguage.orgSave,
    );
    // Second lookup of the same missing key does not warn again.
    expect(lookup(partial, "en", "settingsLanguage.orgSave")).toBe(
      dicts.bn.settingsLanguage.orgSave,
    );
    const orgSaveWarnings = warn.mock.calls.filter((c) =>
      String(c[0]).includes("settingsLanguage.orgSave"),
    );
    expect(orgSaveWarnings).toHaveLength(1);
    expect(String(orgSaveWarnings[0][0])).toContain("[i18n] missing key:");
    expect(String(orgSaveWarnings[0][0])).toContain("(en)");
  });

  it("normalizes unknown locale input to bn", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    expect(lookup(dicts, "fr", "common.save")).toBe(dicts.bn.common.save);
    expect(lookup(dicts, undefined, "common.save")).toBe(dicts.bn.common.save);
    expect(lookup(dicts, null, "shell.dashboard")).toBe(dicts.bn.shell.dashboard);
    expect(warn).not.toHaveBeenCalled();
  });

  it("returns undefined for a key missing in bn too", () => {
    vi.spyOn(console, "warn").mockImplementation(() => undefined);
    expect(lookup(dicts, "en", "common.noSuchKey")).toBeUndefined();
    expect(lookup(dicts, "bn", "common.noSuchKey")).toBeUndefined();
  });
});
