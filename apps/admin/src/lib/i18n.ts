/**
 * ML1/ML3 (Multi-Language MB1) — admin shell i18n (lean).
 *
 * The admin console gets only the shell-level language wiring
 * in MB1: a tiny bn+en dictionary for the language switcher
 * itself, the localStorage persistence key, and resolution
 * (stored preference → platform default bn). Full admin
 * dictionary conversion is a later batch.
 *
 * `UiLocale` is imported type-only from @repo/contracts (the
 * canonical ML1 union) — no runtime contracts import, so this
 * module stays usable before the contracts dist is built.
 * Both locales live in this single file, so key parity holds
 * by construction (en is typed as the bn shape).
 */
import type { UiLocale } from "@repo/contracts";

export type { UiLocale };

export const ADMIN_LOCALE_STORAGE_KEY = "admin_ui_locale";

const bnDict = {
  shell: {
    language: "ভাষা",
    bangla: "বাংলা",
    english: "English",
  },
};

export type AdminDict = typeof bnDict;

const enDict: AdminDict = {
  shell: {
    language: "Language",
    bangla: "বাংলা",
    english: "English",
  },
};

export const adminDicts: Record<UiLocale, AdminDict> = { bn: bnDict, en: enDict };

/** Dictionary for a locale value; anything unknown falls back to bn. */
export function getAdminDict(locale: unknown): AdminDict {
  return locale === "en" ? adminDicts.en : adminDicts.bn;
}

/**
 * Resolve the admin UI locale: the stored personal preference
 * ("admin_ui_locale") when it is a valid locale, otherwise the
 * platform default bn (ML-L3).
 */
export function resolveAdminLocale(): UiLocale {
  if (typeof window === "undefined") return "bn";
  try {
    return localStorage.getItem(ADMIN_LOCALE_STORAGE_KEY) === "en" ? "en" : "bn";
  } catch {
    return "bn";
  }
}
