import { describe, it, expect } from "vitest";
import {
  UI_LOCALES,
  PLATFORM_DEFAULT_LOCALE,
  isUiLocale,
  normalizeUiLocale,
  resolveUiLocale,
  intlLocaleOf,
} from "./i18n";
import {
  fmtNumber,
  fmtMoney,
  fmtMoneyMinor,
  fmtDate,
  fmtTime,
  fmtDateTime,
  fmtRelative,
} from "./i18n-format";
import { GLOSSARY, glossaryTerm } from "./i18n-glossary";

// All exact strings below were pinned against the REAL Intl output of
// this repo's Node runtime (full-icu) before being asserted:
//   bn-BD number 100000 -> "১,০০,০০০"      en-IN number 100000 -> "1,00,000"
//   bn-BD date 2026-10-19 -> "১৯ অক্টোবর, ২০২৬" (Intl keeps the comma)
//   en-IN date 2026-10-19 -> "19 October 2026" (day-first long, as spec'd)
//   bn-BD time 14:30 -> "২:৩০ PM" (bn-BD dayPeriod is Latin AM/PM in ICU)
//   en-IN time 14:30 -> "2:30 pm" (lowercase dayPeriod in en-IN)

describe("ML1 locale core", () => {
  it("ships exactly bn + en, with bn as the platform default", () => {
    expect(UI_LOCALES).toEqual(["bn", "en"]);
    expect(PLATFORM_DEFAULT_LOCALE).toBe("bn");
  });

  it("isUiLocale accepts only the exact strings", () => {
    expect(isUiLocale("bn")).toBe(true);
    expect(isUiLocale("en")).toBe(true);
    for (const v of ["BN", "EN", "bn-BD", "en-IN", "fr", "", null, undefined, 42, {}]) {
      expect(isUiLocale(v), String(v)).toBe(false);
    }
  });

  it("normalizeUiLocale keeps valid locales and falls back otherwise", () => {
    expect(normalizeUiLocale("en")).toBe("en");
    expect(normalizeUiLocale("bn")).toBe("bn");
    expect(normalizeUiLocale("fr")).toBe("bn");
    expect(normalizeUiLocale(undefined)).toBe("bn");
    expect(normalizeUiLocale(null)).toBe("bn");
    expect(normalizeUiLocale("bn-BD")).toBe("bn"); // not exact -> platform fallback (also bn)
    expect(normalizeUiLocale("fr", "en")).toBe("en");
    expect(normalizeUiLocale(undefined, "en")).toBe("en");
  });

  it("resolveUiLocale: staff pref wins, then org default, then platform bn", () => {
    expect(resolveUiLocale({ userPref: "en", orgDefault: "bn" })).toBe("en");
    expect(resolveUiLocale({ userPref: "bn", orgDefault: "en" })).toBe("bn");
    expect(resolveUiLocale({ orgDefault: "en" })).toBe("en");
    expect(resolveUiLocale({ orgDefault: "bn" })).toBe("bn");
    expect(resolveUiLocale({})).toBe("bn");
  });

  it("resolveUiLocale SKIPS invalid values instead of treating them as final", () => {
    expect(resolveUiLocale({ userPref: "fr", orgDefault: "en" })).toBe("en");
    expect(resolveUiLocale({ userPref: null, orgDefault: "en" })).toBe("en");
    expect(resolveUiLocale({ userPref: "fr", orgDefault: "xx" })).toBe("bn");
    expect(resolveUiLocale({ userPref: 42, orgDefault: undefined })).toBe("bn");
  });

  it("intlLocaleOf maps bn -> bn-BD and en -> en-IN", () => {
    expect(intlLocaleOf("bn")).toBe("bn-BD");
    expect(intlLocaleOf("en")).toBe("en-IN");
  });
});

describe("ML2 fmtNumber / fmtMoney", () => {
  it("fmtNumber uses Bengali digits + lakh grouping for bn, Latin + en-IN grouping for en", () => {
    expect(fmtNumber("bn", 1500)).toBe("১,৫০০");
    expect(fmtNumber("en", 1500)).toBe("1,500");
    expect(fmtNumber("bn", 100000)).toBe("১,০০,০০০");
    expect(fmtNumber("en", 100000)).toBe("1,00,000");
  });

  it("fmtMoney prefixes ৳ with no space in both locales", () => {
    expect(fmtMoney("bn", 1500)).toBe("৳১,৫০০");
    expect(fmtMoney("en", 1500)).toBe("৳1,500");
    expect(fmtMoney("en", 0)).toBe("৳0");
  });

  it("fmtMoney groups lakh correctly in both locales", () => {
    expect(fmtMoney("bn", 100000)).toBe("৳১,০০,০০০");
    expect(fmtMoney("en", 100000)).toBe("৳1,00,000");
  });

  it("fmtMoney shows fraction digits only for non-integer amounts", () => {
    expect(fmtMoney("en", 1500.5)).toBe("৳1,500.5");
    expect(fmtMoney("bn", 1500.5)).toBe("৳১,৫০০.৫");
    expect(fmtMoney("en", 1500.5, { minimumFractionDigits: 2 })).toBe("৳1,500.50");
  });

  it("fmtMoney handles negatives and the showSymbol option", () => {
    expect(fmtMoney("en", -1500)).toBe("-৳1,500");
    expect(fmtMoney("bn", -1500)).toBe("-৳১,৫০০");
    expect(fmtMoney("en", 1500, { showSymbol: false })).toBe("1,500");
  });
});

describe("ML2 fmtMoneyMinor (paisa, bigint-safe)", () => {
  it("converts minor units and keeps 2 fraction digits only when paisa remain", () => {
    expect(fmtMoneyMinor("en", 150050)).toBe("৳1,500.50");
    expect(fmtMoneyMinor("bn", 150050)).toBe("৳১,৫০০.৫০");
    expect(fmtMoneyMinor("en", 150000)).toBe("৳1,500");
    expect(fmtMoneyMinor("bn", 150000)).toBe("৳১,৫০০");
    expect(fmtMoneyMinor("en", 5)).toBe("৳0.05");
    expect(fmtMoneyMinor("bn", 5)).toBe("৳০.০৫");
  });

  it("accepts bigint input identically and stays exact for huge values", () => {
    expect(fmtMoneyMinor("en", 150050n)).toBe("৳1,500.50");
    expect(fmtMoneyMinor("bn", 150050n)).toBe("৳১,৫০০.৫০");
    expect(fmtMoneyMinor("en", 123456789012345n)).toBe("৳12,34,56,78,90,123.45");
    expect(fmtMoneyMinor("bn", 123456789012345n)).toBe("৳১২,৩৪,৫৬,৭৮,৯০,১২৩.৪৫");
  });

  it("handles negative minor units", () => {
    expect(fmtMoneyMinor("en", -150050)).toBe("-৳1,500.50");
    expect(fmtMoneyMinor("bn", -99n)).toBe("-৳০.৯৯");
  });
});

describe("ML2 dates and times", () => {
  const d = new Date(2026, 9, 19); // Monday 19 October 2026 (local)

  it("fmtDate renders long day-first dates per locale", () => {
    const bn = fmtDate("bn", d);
    expect(bn).toContain("অক্টোবর");
    expect(bn).toContain("২০২৬");
    expect(bn).toBe("১৯ অক্টোবর, ২০২৬");
    expect(fmtDate("en", d)).toBe("19 October 2026");
  });

  it("fmtDate accepts string/number input and adds the weekday on request", () => {
    expect(fmtDate("en", d.getTime())).toBe("19 October 2026");
    expect(fmtDate("en", d, { weekday: true })).toBe("Monday, 19 October 2026");
    expect(fmtDate("bn", d, { weekday: true })).toBe("সোমবার, ১৯ অক্টোবর, ২০২৬");
  });

  it("fmtTime renders 12-hour times per locale", () => {
    expect(fmtTime("en", new Date(2026, 9, 19, 14, 30))).toBe("2:30 pm");
    expect(fmtTime("bn", new Date(2026, 9, 19, 14, 30))).toBe("২:৩০ PM");
    expect(fmtTime("bn", new Date(2026, 9, 19, 9, 5))).toBe("৯:০৫ AM");
  });

  it("fmtDateTime combines the long date and the 12-hour time", () => {
    expect(fmtDateTime("en", new Date(2026, 9, 19, 14, 30))).toBe("19 October 2026 at 2:30 pm");
    expect(fmtDateTime("bn", new Date(2026, 9, 19, 14, 30))).toBe("১৯ অক্টোবর, ২০২৬ এ ২:৩০ PM");
  });
});

describe("ML2 fmtRelative", () => {
  const now = new Date(2026, 9, 19, 12, 0, 0);
  const ago = (ms: number) => new Date(now.getTime() - ms);

  it("uses numeric:auto wording for whole days", () => {
    expect(fmtRelative("en", ago(24 * 3600 * 1000), now)).toBe("yesterday");
    expect(fmtRelative("bn", ago(24 * 3600 * 1000), now)).toBe("গতকাল");
    expect(fmtRelative("en", new Date(now.getTime() + 24 * 3600 * 1000), now)).toBe("tomorrow");
    expect(fmtRelative("bn", new Date(now.getTime() + 24 * 3600 * 1000), now)).toBe("আগামীকাল");
  });

  it("picks the largest sensible unit", () => {
    expect(fmtRelative("en", ago(3 * 24 * 3600 * 1000), now)).toBe("3 days ago");
    expect(fmtRelative("bn", ago(3 * 24 * 3600 * 1000), now)).toBe("৩ দিন আগে");
    expect(fmtRelative("en", ago(5 * 3600 * 1000), now)).toBe("5 hours ago");
    expect(fmtRelative("bn", ago(5 * 3600 * 1000), now)).toBe("৫ ঘণ্টা আগে");
    expect(fmtRelative("en", ago(30 * 60 * 1000), now)).toBe("30 minutes ago");
    expect(fmtRelative("bn", ago(30 * 60 * 1000), now)).toBe("৩০ মিনিট আগে");
    expect(fmtRelative("en", ago(45 * 1000), now)).toBe("45 seconds ago");
    expect(fmtRelative("bn", ago(45 * 1000), now)).toBe("৪৫ সেকেন্ড পূর্বে");
  });
});

describe("ML3 glossary", () => {
  it("has 45+ entries, unique keys, and non-empty terms in both languages", () => {
    expect(GLOSSARY.length).toBeGreaterThanOrEqual(45);
    const keys = GLOSSARY.map((e) => e.key);
    expect(new Set(keys).size).toBe(keys.length);
    for (const entry of GLOSSARY) {
      expect(entry.en.trim().length, entry.key).toBeGreaterThan(0);
      expect(entry.bn.trim().length, entry.key).toBeGreaterThan(0);
      // every Bangla term is actually in Bengali script
      expect(entry.bn, entry.key).toMatch(/[\u0980-\u09FF]/);
    }
  });

  it("contains the core keys with the approved terms", () => {
    expect(glossaryTerm("dashboard", "bn")).toBe("ড্যাশবোর্ড");
    expect(glossaryTerm("dashboard", "en")).toBe("Dashboard");
    expect(glossaryTerm("settings", "bn")).toBe("সেটিংস");
    expect(glossaryTerm("order", "bn")).toBe("অর্ডার");
    expect(glossaryTerm("language", "bn")).toBe("ভাষা");
    expect(glossaryTerm("customer", "bn")).toBe("গ্রাহক");
    expect(glossaryTerm("save", "bn")).toBe("সংরক্ষণ করুন");
  });

  it("returns undefined for unknown keys", () => {
    expect(glossaryTerm("no-such-key", "bn")).toBeUndefined();
    expect(glossaryTerm("no-such-key", "en")).toBeUndefined();
  });
});
