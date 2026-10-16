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

const PREF_LABEL: Record<ThemePref, string> = {
  system: "সিস্টেম",
  light: "লাইট",
  dark: "ডার্ক",
};

export function ThemeToggle() {
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
  const label = `থিম: ${PREF_LABEL[pref]} — বদলাতে ক্লিক করুন`;

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
