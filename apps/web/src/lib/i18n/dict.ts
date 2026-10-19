/**
 * ML1/ML3 (Multi-Language MB1) — dashboard UI dictionary.
 *
 * bn is the source-of-truth shape; en MUST mirror it exactly
 * (same key set, no empty values — pinned by i18n.test.ts).
 * Scope for MB1 is deliberately SMALL: shared `common` strings,
 * dashboard `shell` chrome, and the Organization Settings
 * language section (`settingsLanguage`). Module-by-module
 * conversion of the dashboard is a later batch — do not grow
 * this file page by page ahead of that plan.
 *
 * This file intentionally does NOT import @repo/contracts
 * (not even at runtime): the dictionary must stay a pure,
 * dependency-free module so its tests never need a built
 * contracts dist. `UiLocale` below mirrors the canonical
 * `UiLocale` union exported by @repo/contracts (ML1) — the two
 * are the same "bn" | "en" union, so values flow between them
 * without conversion.
 *
 * House rules: Bengali strings live ONLY in dictionary files
 * (this file, ./shop.ts, and the admin dictionary); components
 * read strings through the LocaleProvider's `dict`, never by
 * hardcoding copy. bn copy uses the আপনি tone and the fixed
 * project glossary (Settings = সেটিংস, Dashboard = ড্যাশবোর্ড,
 * Organization = প্রতিষ্ঠান); en copy is plain sentence case.
 */

export type UiLocale = "bn" | "en";

const bnDict = {
  common: {
    save: "সংরক্ষণ করুন",
    cancel: "বাতিল",
    loading: "লোড হচ্ছে…",
    language: "ভাষা",
    languageBn: "বাংলা",
    languageEn: "English",
    followOrg: "প্রতিষ্ঠানের ডিফল্ট",
  },
  shell: {
    languageSwitcherLabel: "ভাষা বেছে নিন",
    settings: "সেটিংস",
    dashboard: "ড্যাশবোর্ড",
  },
  settingsLanguage: {
    title: "ভাষা",
    description:
      "ড্যাশবোর্ড কোন ভাষায় দেখবেন তা এখান থেকে বেছে নিন। আপনার নিজের পছন্দ সবার আগে প্রযোজ্য হবে; নিজের পছন্দ না থাকলে প্রতিষ্ঠানের ডিফল্ট ভাষা দেখাবে।",
    personalTitle: "আপনার নিজের ভাষা",
    personalHelp:
      "এই পছন্দটি শুধু আপনার অ্যাকাউন্টের জন্য — বেছে নিলেই সঙ্গে সঙ্গে চালু হয়ে যাবে এবং সংরক্ষিত থাকবে।",
    orgTitle: "প্রতিষ্ঠানের ডিফল্ট ভাষা",
    orgHelp:
      "যেসব সদস্যের নিজের কোনো ভাষা-পছন্দ নেই, তাঁদের ড্যাশবোর্ড এই ভাষায় দেখাবে।",
    orgSave: "প্রতিষ্ঠানের ভাষা সংরক্ষণ করুন",
    saved: "সংরক্ষিত হয়েছে।",
    saveError: "সংরক্ষণ করা যায়নি — আবার চেষ্টা করুন।",
    readOnlyNote:
      "শুধু প্রতিষ্ঠানের মালিক (OWNER) বা অ্যাডমিন (ADMIN) প্রতিষ্ঠানের ডিফল্ট ভাষা বদলাতে পারেন।",
    currentEffective: "বর্তমানে কার্যকর ভাষা",
    noOrg: "কোনো প্রতিষ্ঠান নির্বাচিত নেই।",
  },
};

export type Dict = typeof bnDict;

const enDict: Dict = {
  common: {
    save: "Save",
    cancel: "Cancel",
    loading: "Loading…",
    language: "Language",
    languageBn: "বাংলা",
    languageEn: "English",
    followOrg: "Organization default",
  },
  shell: {
    languageSwitcherLabel: "Choose language",
    settings: "Settings",
    dashboard: "Dashboard",
  },
  settingsLanguage: {
    title: "Language",
    description:
      "Choose the language the dashboard uses. Your personal preference comes first; if you have none, the organization default applies.",
    personalTitle: "Your language",
    personalHelp:
      "This preference applies only to your account — choosing an option applies and saves it right away.",
    orgTitle: "Organization default language",
    orgHelp:
      "Members who have not set a personal language preference will see the dashboard in this language.",
    orgSave: "Save organization language",
    saved: "Saved.",
    saveError: "Could not save — please try again.",
    readOnlyNote:
      "Only an organization OWNER or ADMIN can change the organization default language.",
    currentEffective: "Currently active language",
    noOrg: "No organization is selected.",
  },
};

export const dicts: Record<UiLocale, Dict> = { bn: bnDict, en: enDict };

/** Dictionary for a locale value; anything unknown falls back to bn. */
export function getDict(locale: unknown): Dict {
  return locale === "en" ? dicts.en : dicts.bn;
}

/** Normalize an unknown locale value to a UiLocale (default bn). */
export function localeOf(locale: unknown): UiLocale {
  return locale === "en" ? "en" : "bn";
}
