"use client";
import React, { useEffect, useState } from "react";
import { API_URL, getAdminToken } from "@/lib/api";
import {
  ADMIN_LOCALE_STORAGE_KEY,
  getAdminDict,
  resolveAdminLocale,
  type UiLocale,
} from "@/lib/i18n";

/**
 * ML3 (Multi-Language MB1) — admin locale provider-lite +
 * switcher. There is no admin-wide LocaleProvider in MB1: this
 * component owns the whole flow — on mount it reads the stored
 * preference and applies it to <html lang> + <html data-locale>
 * (which drives the ML2 font block in globals.css), and the
 * select persists a change to localStorage and, when an admin
 * token exists, fire-and-forget PATCHes the SHARED user
 * preference (PATCH /auth/me/preferences — the same
 * User.preferredLocale the dashboard uses) through the admin
 * API base (API_URL from @/lib/api). Every failure is silent:
 * the admin shell must never break over a language preference.
 */
export function AdminLocaleSwitcher() {
  const [locale, setLocale] = useState<UiLocale>("bn");
  const dict = getAdminDict(locale);

  useEffect(() => {
    const resolved = resolveAdminLocale();
    setLocale(resolved);
    try {
      document.documentElement.lang = resolved;
      document.documentElement.dataset.locale = resolved;
    } catch {
      /* ignore — shell must never break */
    }
  }, []);

  function change(next: UiLocale) {
    setLocale(next);
    try {
      document.documentElement.lang = next;
      document.documentElement.dataset.locale = next;
    } catch {
      /* ignore */
    }
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
  }

  return (
    <select
      aria-label={dict.shell.language}
      title={dict.shell.language}
      value={locale}
      onChange={(e) => change(e.target.value === "en" ? "en" : "bn")}
      className="abtn-secondary !px-2 !py-1.5 text-xs"
    >
      <option value="bn">{dict.shell.bangla}</option>
      <option value="en">{dict.shell.english}</option>
    </select>
  );
}

export default AdminLocaleSwitcher;
