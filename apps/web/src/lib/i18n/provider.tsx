"use client";
import React, { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";
import { resolveUiLocale, type UiLocale } from "@repo/contracts";
import { apiFetch } from "@/lib/api";
import { getOrganizationId } from "@/lib/org";
import { getDict, dicts, type Dict } from "./dict";
import { countWithClassifier, tr, type CountClassifierForms, type TrParams } from "./lookup";

/**
 * ML1/ML3 (Multi-Language MB1) — dashboard locale provider.
 *
 * Resolution order (ML-L3): the signed-in user's own preference
 * (User.preferredLocale, via GET /auth/me) → the organization's
 * default (Organization.dashboardLocale, riding the org view from
 * GET /organizations/:id) → the platform default (bn). The
 * contracts `resolveUiLocale` is the single implementation of
 * that order; this provider only feeds it the two inputs.
 *
 * A localStorage cache ("uiLocale") holds the last RESOLVED
 * locale so the first paint after a reload already uses the
 * right language/fonts while the fetches are in flight; the
 * server values always win once they land.
 */

export const UI_LOCALE_CACHE_KEY = "uiLocale";

export interface LocaleContextValue {
  /** Effective (resolved) locale for this session. */
  locale: UiLocale;
  /** Dictionary for the effective locale. */
  dict: Dict;
  /** The user's own preference, or null = follow the org default. */
  userPref: UiLocale | null;
  /** The current organization's default, or null until loaded. */
  orgDefault: UiLocale | null;
  /**
   * Set (or clear, with null) the user's own preference.
   * Persists via PATCH /auth/me/preferences { preferredLocale },
   * then updates state + the localStorage cache. Rejects when
   * the PATCH fails so callers can surface the dict saveError.
   */
  setUserPref: (loc: UiLocale | null) => Promise<void>;
  /** Re-fetch /auth/me + the current org and re-resolve. */
  refresh: () => Promise<void>;
  /**
   * Parameterised dictionary lookup bound to the effective locale
   * (MB2 STEP-0): t("orders.countLabel", { count: fmtNumber(locale, n) }).
   * Falls back to the key itself when the key exists in neither
   * locale (lookup already logged the gap).
   */
  t: (path: string, params?: TrParams) => string;
  /** Bengali count-classifier / English plural helper (MB2 STEP-0). */
  count: (countValue: number, forms: CountClassifierForms) => string;
}

const LocaleContext = createContext<LocaleContextValue | null>(null);

function asUiLocale(value: unknown): UiLocale | null {
  return value === "bn" || value === "en" ? value : null;
}

function readCache(): UiLocale | null {
  if (typeof window === "undefined") return null;
  try {
    return asUiLocale(localStorage.getItem(UI_LOCALE_CACHE_KEY));
  } catch {
    return null;
  }
}

function writeCache(locale: UiLocale) {
  try {
    localStorage.setItem(UI_LOCALE_CACHE_KEY, locale);
  } catch {
    /* storage blocked — the in-memory state still applies */
  }
}

interface MeLocaleView {
  preferredLocale?: string | null;
}

interface OrgLocaleView {
  dashboardLocale?: string | null;
}

export function LocaleProvider({ children }: { children: React.ReactNode }) {
  const [locale, setLocale] = useState<UiLocale>(() => readCache() ?? "bn");
  const [userPref, setUserPrefState] = useState<UiLocale | null>(null);
  const [orgDefault, setOrgDefault] = useState<UiLocale | null>(null);

  const refresh = useCallback(async () => {
    const [me, org] = await Promise.all([
      apiFetch<MeLocaleView>("/auth/me").catch(() => null),
      (async () => {
        const orgId = getOrganizationId();
        if (!orgId) return null;
        return apiFetch<OrgLocaleView>(`/organizations/${orgId}`).catch(() => null);
      })(),
    ]);
    const pref = asUiLocale(me?.preferredLocale);
    const orgLoc = asUiLocale(org?.dashboardLocale);
    setUserPrefState(pref);
    setOrgDefault(orgLoc);
    const resolved = resolveUiLocale({ userPref: pref, orgDefault: orgLoc });
    setLocale(resolved);
    writeCache(resolved);
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  // ML2: the document locale drives the font CSS in globals.css
  // ([data-locale="bn"] → Hind Siliguri stack, line-height 1.7).
  useEffect(() => {
    document.documentElement.lang = locale;
    document.documentElement.dataset.locale = locale;
  }, [locale]);

  const setUserPref = useCallback(
    async (loc: UiLocale | null) => {
      await apiFetch("/auth/me/preferences", {
        method: "PATCH",
        body: JSON.stringify({ preferredLocale: loc }),
      });
      setUserPrefState(loc);
      const resolved = resolveUiLocale({ userPref: loc, orgDefault });
      setLocale(resolved);
      // Cache the new pref when there is one; otherwise the
      // resolved org default (which is what will paint first
      // on the next load).
      writeCache(loc ?? resolved);
    },
    [orgDefault],
  );

  const t = useCallback(
    (path: string, params?: TrParams) => tr(dicts, locale, path, params) ?? path,
    [locale],
  );
  const count = useCallback(
    (countValue: number, forms: CountClassifierForms) =>
      countWithClassifier(locale, countValue, forms),
    [locale],
  );

  const value = useMemo<LocaleContextValue>(
    () => ({ locale, dict: getDict(locale), userPref, orgDefault, setUserPref, refresh, t, count }),
    [locale, userPref, orgDefault, setUserPref, refresh, t, count],
  );

  return <LocaleContext.Provider value={value}>{children}</LocaleContext.Provider>;
}

export function useLocale(): LocaleContextValue {
  const ctx = useContext(LocaleContext);
  if (!ctx) throw new Error("useLocale must be used inside <LocaleProvider>");
  return ctx;
}

/**
 * Compact dashboard language switcher (বাংলা / English).
 * Changing it sets the user's personal preference — the org
 * default flow lives in Organization Settings → Language.
 */
export function LanguageSwitcher() {
  const { locale, dict, setUserPref } = useLocale();
  return (
    <select
      aria-label={dict.shell.languageSwitcherLabel}
      title={dict.shell.languageSwitcherLabel}
      value={locale}
      onChange={(e) => {
        const next: UiLocale = e.target.value === "en" ? "en" : "bn";
        // The header must never break on a failed save; the
        // Settings language section is the surface that
        // surfaces saveError.
        void setUserPref(next).catch(() => undefined);
      }}
      className="rounded-xl border border-slate-200/90 bg-white px-2 py-2 text-xs font-semibold text-slate-700 shadow-sm transition hover:bg-slate-50"
    >
      <option value="bn">{dict.common.languageBn}</option>
      <option value="en">{dict.common.languageEn}</option>
    </select>
  );
}
