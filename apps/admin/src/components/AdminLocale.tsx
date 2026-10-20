"use client";
import React, { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";
import { API_URL, getAdminToken } from "@/lib/api";
import {
  ADMIN_LOCALE_STORAGE_KEY,
  getAdminDict,
  resolveAdminLocale,
  trAdmin,
  type AdminDict,
  type UiLocale,
} from "@/lib/i18n";

/**
 * ML3 (Multi-Language MB1) + ML7 (MB3) — admin locale mechanism.
 *
 * ONE mechanism, unchanged since MB1: the stored preference
 * (`admin_ui_locale` in localStorage) → platform default bn; a
 * change writes localStorage, updates <html lang> + <html
 * data-locale> (which drives the ML2 font block in globals.css),
 * and — when an admin token exists — fire-and-forget PATCHes the
 * SHARED user preference (PATCH /auth/me/preferences, the same
 * User.preferredLocale the dashboard uses) through the admin API
 * base. Every failure is silent: the admin shell must never break
 * over a language preference.
 *
 * ML7 adds the reactive propagation layer on top of that same
 * mechanism: `AdminLocaleProvider` (mounted once in the root
 * layout, so login/TOTP pages are covered too) owns the locale
 * state, and every page/component reads `{ locale, dict, t }`
 * via `useAdminLocale()`. The context DEFAULT is the bn
 * dictionary, so anything rendered outside the provider (tests,
 * isolated embeds) renders exactly as the pre-ML7 bn UI did.
 */

export interface AdminLocaleValue {
  locale: UiLocale;
  dict: AdminDict;
  setLocale: (next: UiLocale) => void;
  t: (path: string, params?: Record<string, string | number>) => string;
}

const AdminLocaleContext = createContext<AdminLocaleValue>({
  locale: "bn",
  dict: getAdminDict("bn"),
  setLocale: () => undefined,
  t: (path, params) => trAdmin("bn", path, params),
});

export function useAdminLocale(): AdminLocaleValue {
  return useContext(AdminLocaleContext);
}

function applyToDocument(locale: UiLocale) {
  try {
    document.documentElement.lang = locale;
    document.documentElement.dataset.locale = locale;
  } catch {
    /* ignore — shell must never break */
  }
}

export function AdminLocaleProvider({ children }: { children: React.ReactNode }) {
  const [locale, setLocaleState] = useState<UiLocale>("bn");

  useEffect(() => {
    const resolved = resolveAdminLocale();
    setLocaleState(resolved);
    applyToDocument(resolved);
  }, []);

  const setLocale = useCallback((next: UiLocale) => {
    setLocaleState(next);
    applyToDocument(next);
    try {
      localStorage.setItem(ADMIN_LOCALE_STORAGE_KEY, next);
    } catch {
      /* ignore */
    }
    const token = getAdminToken();
    if (!token) return;
    try {
      void fetch(`${API_URL}/auth/me/preferences`, {
        method: "PATCH",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({ preferredLocale: next }),
      }).catch(() => undefined);
    } catch {
      /* silent by design */
    }
  }, []);

  const value = useMemo<AdminLocaleValue>(
    () => ({
      locale,
      dict: getAdminDict(locale),
      setLocale,
      t: (path, params) => trAdmin(locale, path, params),
    }),
    [locale, setLocale],
  );

  return <AdminLocaleContext.Provider value={value}>{children}</AdminLocaleContext.Provider>;
}

export function AdminLocaleSwitcher() {
  const { locale, dict, setLocale } = useAdminLocale();

  return (
    <select
      aria-label={dict.shell.language}
      title={dict.shell.language}
      value={locale}
      onChange={(e) => setLocale(e.target.value === "en" ? "en" : "bn")}
      className="abtn-secondary !px-2 !py-1.5 text-xs"
    >
      <option value="bn">{dict.shell.bangla}</option>
      <option value="en">{dict.shell.english}</option>
    </select>
  );
}

export default AdminLocaleSwitcher;
