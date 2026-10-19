import { describe, expect, it } from "vitest";
import {
  adminDicts,
  countWithClassifier,
  getAdminDict,
  interpolate,
  placeholdersOf,
  trAdmin,
  type AdminDict,
} from "./i18n";

// ---------------------------------------------------------------------------
// Dictionary parity pins (ML7): bn is the shape source of truth; en is
// typed as typeof bn, and these tests pin the runtime invariants too —
// exact flattened key sets, no empty values, and per-key placeholder-set
// parity — so a future edit cannot silently drift the two locales apart.
// ---------------------------------------------------------------------------

function flatten(dict: AdminDict, prefix = "", out: Record<string, string> = {}): Record<string, string> {
  for (const [key, value] of Object.entries(dict)) {
    const path = prefix ? `${prefix}.${key}` : key;
    if (value && typeof value === "object") flatten(value as AdminDict, path, out);
    else out[path] = value as string;
  }
  return out;
}

const bnFlat = flatten(adminDicts.bn);
const enFlat = flatten(adminDicts.en);

describe("admin dictionary parity", () => {
  it("bn and en have exactly the same flattened key set", () => {
    expect(Object.keys(enFlat).sort()).toEqual(Object.keys(bnFlat).sort());
  });

  it("no value is empty in either locale", () => {
    for (const [path, value] of Object.entries(bnFlat)) {
      expect(value, `bn ${path}`).not.toBe("");
    }
    for (const [path, value] of Object.entries(enFlat)) {
      expect(value, `en ${path}`).not.toBe("");
    }
  });

  it("every key has the same placeholder set in bn and en", () => {
    for (const path of Object.keys(bnFlat)) {
      expect(placeholdersOf(enFlat[path]!), `en ${path}`).toEqual(placeholdersOf(bnFlat[path]!));
    }
  });
});

describe("trAdmin lookup and fallback", () => {
  it("resolves a string in the requested locale", () => {
    expect(trAdmin("bn", "common.save")).toBe(adminDicts.bn.common.save);
    expect(trAdmin("en", "common.save")).toBe(adminDicts.en.common.save);
  });

  it("an unknown locale falls back to the bn dictionary", () => {
    expect(getAdminDict("fr")).toBe(adminDicts.bn);
    expect(getAdminDict(undefined)).toBe(adminDicts.bn);
    expect(getAdminDict("en")).toBe(adminDicts.en);
  });

  it("a missing key returns the key path itself", () => {
    expect(trAdmin("en", "no.such.key")).toBe("no.such.key");
  });

  it("interpolates named params and leaves unknown placeholders literal", () => {
    expect(trAdmin("en", "bell.attentionNeeded", { count: 3 })).toBe("Needs attention: 3 to-dos");
    expect(trAdmin("bn", "bell.attentionNeeded", { count: "৩" })).toBe("মনোযোগ দরকার: ৩টি করণীয়");
    expect(interpolate("Hi {name}, {missing}", { name: "Ada" })).toBe("Hi Ada, {missing}");
  });
});

describe("countWithClassifier", () => {
  it("bn appends the classifier suffix to the formatted count", () => {
    expect(
      countWithClassifier("bn", 12, { bnSuffix: "টি", enOne: "item", enOther: "items", formattedCount: "১২" }),
    ).toBe("১২টি");
  });

  it("en picks singular/plural by count", () => {
    expect(countWithClassifier("en", 1, { bnSuffix: "টি", enOne: "item", enOther: "items" })).toBe("1 item");
    expect(countWithClassifier("en", 5, { bnSuffix: "টি", enOne: "item", enOther: "items" })).toBe("5 items");
  });
});
