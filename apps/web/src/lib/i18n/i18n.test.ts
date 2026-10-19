import { afterEach, describe, expect, it, vi } from "vitest";
import { dicts, getDict } from "./dict";
import { countWithClassifier, interpolate, lookup, placeholdersOf, tr } from "./lookup";
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

describe("tr (MB2 STEP-0 parameterised lookup + count pattern)", () => {
  // A parameterised fixture in the exact dashboard shape: bn keeps
  // the classifier suffix on the count, en pluralises the noun.
  const paramDicts = {
    bn: { orders: { countLabel: "{count}টি অর্ডার", people: "{count}জন গ্রাহক" } },
    en: { orders: { countLabel: "{count} orders", people: "{count} customers" } },
  };

  it("interpolates named params after resolving the locale string", () => {
    expect(tr(paramDicts, "bn", "orders.countLabel", { count: "৩" })).toBe("৩টি অর্ডার");
    expect(tr(paramDicts, "en", "orders.countLabel", { count: 3 })).toBe("3 orders");
    expect(tr(paramDicts, "en", "orders.people", { count: 5 })).toBe("5 customers");
  });

  it("falls back to the whole bn string (params still filled) when en is missing", () => {
    const partial = { bn: paramDicts.bn, en: { orders: { countLabel: "", people: "{count} customers" } } };
    vi.spyOn(console, "warn").mockImplementation(() => undefined);
    expect(tr(partial, "en", "orders.countLabel", { count: 7 })).toBe("7টি অর্ডার");
  });

  it("leaves an unsupplied placeholder visible instead of blanking it", () => {
    expect(interpolate("{count} orders", {})).toBe("{count} orders");
    expect(interpolate("{count} orders")).toBe("{count} orders");
    expect(tr(paramDicts, "en", "orders.countLabel")).toBe("{count} orders");
  });

  it("pins equal placeholder sets for bn/en on every real dictionary key", () => {
    const bn = flatten(dicts.bn);
    const en = flatten(dicts.en);
    for (const [key, bnValue] of bn) {
      expect(placeholdersOf(en.get(key) ?? ""), key).toEqual(placeholdersOf(bnValue));
    }
  });

  it("countWithClassifier: bn suffix on the count, en plural on the noun", () => {
    const forms = { bnSuffix: "টি", enOne: "order", enOther: "orders" };
    expect(countWithClassifier("bn", 3, { ...forms, formattedCount: "৩" })).toBe("৩টি");
    expect(countWithClassifier("bn", 1, { ...forms, formattedCount: "১" })).toBe("১টি");
    expect(countWithClassifier("en", 3, forms)).toBe("3 orders");
    expect(countWithClassifier("en", 1, forms)).toBe("1 order");
    expect(countWithClassifier("bn", 5, { enOne: "customer", enOther: "customers", bnSuffix: "জন", formattedCount: "৫" })).toBe("৫জন");
    // Unknown locale normalises to bn (localeOf), suffix still applies.
    expect(countWithClassifier("fr", 2, forms)).toBe("2টি");
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
