"use client";
import React, { useEffect, useState } from "react";
import { Monitor, Moon, Sun } from "lucide-react";
import {
  applyThemeClass,
  dashboardRoot,
  readStoredThemePref,
  systemPrefersDark,
  writeStoredThemePref,
  type ThemePref,
} from "@/lib/theme";
import { sharedBn, sharedEn } from "@/lib/i18n/shared";
import { interpolate } from "@/lib/i18n/lookup";
import { useLocale } from "@/lib/i18n/provider";

/**
 * MB2 F3-β: the toggle's labels live in the `shared` dictionary
 * (zzTht* keys). lib/theme.test.tsx renders this component WITHOUT
 * a LocaleProvider, so the locale resolves through the provider
 * when one is mounted (dashboard) and falls back to bn otherwise —
 * the bn fallback keeps that test's expectations byte-identical.
 */
const SD = (locale?: string): typeof sharedBn => (locale === "en" ? sharedEn : sharedBn);
function useThtLocale(): "bn" | "en" {
  try {
    return useLocale().locale === "en" ? "en" : "bn";
  } catch {
    return "bn";
  }
}

/**
 * ED17 (EB7) — dashboard dark-mode toggle (topbar).
 *
 * Cycles সিস্টেম → লাইট → ডার্ক → সিস্টেম. The preference persists
 * in localStorage (lib/theme.ts, key "qosprey-theme"); the class
 * itself is applied to the dashboard root element — the same
 * element the layout's pre-paint bootstrap script targets, so the
 * toggle and the bootstrap can never disagree about the rule.
 * While the preference is "system", an OS theme change re-applies
 * live (the matchMedia listener below).
 */
const NEXT_PREF: Record<ThemePref, ThemePref> = {
  system: "light",
  light: "dark",
  dark: "system",
};

export function ThemeToggle() {
  const sd = SD(useThtLocale());
  const PREF_LABEL: Record<ThemePref, string> = {
    system: sd.zzThtSystem,
    light: sd.zzThtLight,
    dark: sd.zzThtDark,
  };
  const [pref, setPref] = useState<ThemePref>("system");
  const [dark, setDark] = useState(false);

  useEffect(() => {
    const stored = readStoredThemePref();
    setPref(stored);
    setDark(applyThemeClass(dashboardRoot(), stored));
    if (!window.matchMedia) return;
    const mq = window.matchMedia("(prefers-color-scheme: dark)");
    const onChange = () => {
      // Only "system" follows the OS live; explicit prefs are sticky.
      const current = readStoredThemePref();
      if (current === "system") {
        setDark(applyThemeClass(dashboardRoot(), current, mq.matches));
      }
    };
    mq.addEventListener?.("change", onChange);
    return () => mq.removeEventListener?.("change", onChange);
  }, []);

  const cycle = () => {
    const next = NEXT_PREF[pref];
    setPref(next);
    writeStoredThemePref(next);
    setDark(applyThemeClass(dashboardRoot(), next, systemPrefersDark()));
  };

  const Icon = pref === "system" ? Monitor : dark ? Moon : Sun;
  const label = interpolate(sd.zzThtLabel, { pref: PREF_LABEL[pref] });

  return (
    <button
      type="button"
      onClick={cycle}
      className="rounded-full border border-slate-200 bg-white p-2 text-slate-600 shadow-sm transition hover:bg-slate-50 active:scale-95"
      aria-label={label}
      title={label}
    >
      <Icon className="h-[18px] w-[18px]" />
    </button>
  );
}
