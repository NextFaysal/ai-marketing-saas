/**
 * ED17 (EB7) — dashboard dark-mode theme resolution.
 *
 * The dashboard root element (`<div class="dashboard-root">` in
 * app/dashboard/layout.tsx) carries the `dark` class; globals.css
 * re-declares the EB1 token variables under `.dashboard-root.dark`
 * and a scoped override layer maps the common literal slate/white
 * classes onto those tokens inside the dashboard subtree only.
 * Shop pages never receive this class (the shop's v2 dark variant
 * is a separate prefers-color-scheme media block in globals.css).
 *
 * Preference model: "light" | "dark" | "system" (default "system"
 * → follows prefers-color-scheme), persisted in localStorage under
 * THEME_STORAGE_KEY. Resolution is a pure function so it is fully
 * unit-testable; the DOM/localStorage touchpoints are thin wrappers.
 */

export type ThemePref = "light" | "dark" | "system";

export const THEME_STORAGE_KEY = "qosprey-theme";
export const DASHBOARD_ROOT_SELECTOR = ".dashboard-root";
export const DARK_CLASS = "dark";

/** Parse a raw stored value; anything unrecognised is "system". */
export function parseThemePref(raw: string | null | undefined): ThemePref {
  return raw === "light" || raw === "dark" || raw === "system" ? raw : "system";
}

export interface ThemeStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

export function readStoredThemePref(storage?: ThemeStorage | null): ThemePref {
  try {
    const store =
      storage ?? (typeof window !== "undefined" ? window.localStorage : null);
    if (!store) return "system";
    return parseThemePref(store.getItem(THEME_STORAGE_KEY));
  } catch {
    // localStorage can throw (private mode / disabled) — system default.
    return "system";
  }
}

export function writeStoredThemePref(
  pref: ThemePref,
  storage?: ThemeStorage | null,
): void {
  try {
    const store =
      storage ?? (typeof window !== "undefined" ? window.localStorage : null);
    store?.setItem(THEME_STORAGE_KEY, pref);
  } catch {
    // Persistence is best-effort; the in-memory class still applies.
  }
}

/** The one resolution rule: explicit prefs win; "system" defers to the OS. */
export function resolveIsDark(pref: ThemePref, systemDark: boolean): boolean {
  if (pref === "dark") return true;
  if (pref === "light") return false;
  return systemDark;
}

export function systemPrefersDark(): boolean {
  if (typeof window === "undefined" || !window.matchMedia) return false;
  return window.matchMedia("(prefers-color-scheme: dark)").matches;
}

/** Apply (or remove) the dark class on the dashboard root element. */
export function applyThemeClass(
  root: Element | null | undefined,
  pref: ThemePref,
  systemDark: boolean = systemPrefersDark(),
): boolean {
  if (!root) return false;
  const dark = resolveIsDark(pref, systemDark);
  root.classList.toggle(DARK_CLASS, dark);
  return dark;
}

export function dashboardRoot(): Element | null {
  if (typeof document === "undefined") return null;
  return document.querySelector(DASHBOARD_ROOT_SELECTOR);
}

/**
 * The pre-paint bootstrap, inlined by the dashboard layout as the
 * first child of the dashboard root. It must be a self-contained
 * string (no imports possible) that replicates resolveIsDark
 * exactly: dark iff stored === "dark", or stored !== "light" and
 * the OS prefers dark (parseThemePref maps every other stored
 * value — null, "system", garbage — to "system").
 *
 * Placement contract: if the script executes while the root is
 * already parsed (the normal in-place case) it applies the class
 * immediately; if a future React/Next version hoists the script
 * ahead of the root, it retries on DOMContentLoaded. The layout's
 * effect re-asserts the same decision after mount, so the worst
 * case is a brief light flash on a cold dashboard load — never a
 * wrong final state.
 */
export const DASHBOARD_THEME_INIT_SCRIPT = `(function(){function go(){try{var v=null;try{v=window.localStorage.getItem("${THEME_STORAGE_KEY}")}catch(e){}var d=v==="dark"||(v!=="light"&&!!(window.matchMedia&&window.matchMedia("(prefers-color-scheme: dark)").matches));var el=document.querySelector("${DASHBOARD_ROOT_SELECTOR}");if(!el)return false;el.classList.toggle("${DARK_CLASS}",d);return true}catch(e){return true}}if(!go()){document.addEventListener("DOMContentLoaded",go)}})();`;

/**
 * Every token the dark blocks in globals.css MUST re-declare —
 * the pin spec (lib/theme.test.tsx) extracts both blocks (the
 * dashboard `.dashboard-root.dark` block and the shop
 * `[data-shop-theme="v2"]` media block) and fails if any of these
 * is missing, so no surface/ink/border/semantic token can be left
 * light-only by accident.
 *
 * Deliberately NOT re-declared (documented in
 * docs/design-eb7-acceptance.md): --brand, --brand-from,
 * --brand-to (the merchant/platform brand seam — dark mode must
 * never restyle branding), --brand-ring (a transparent color-mix,
 * mode-agnostic), --ink-inverse (white text on brand in both
 * modes), the coloured glow shadows --shadow-glow /
 * --shadow-success / --shadow-warning (translucent brand/semantic
 * rgba — they read correctly on dark surfaces unchanged), and the
 * type/spacing/radius/motion scales (mode-neutral).
 */
export const DARK_TOKEN_LIST = [
  "--surface",
  "--surface-muted",
  "--surface-raised",
  "--surface-sunken",
  "--border-soft",
  "--border",
  "--border-strong",
  "--ink-strong",
  "--ink-body",
  "--ink-muted",
  "--ink-faint",
  "--brand-soft",
  "--brand-soft-strong",
  "--success",
  "--success-bright",
  "--success-soft",
  "--warning",
  "--warning-bright",
  "--warning-soft",
  "--danger",
  "--danger-soft",
  "--info",
  "--info-soft",
  "--shadow-card",
  "--shadow-card-hover",
  "--shadow-card-v2",
  "--shadow-pop",
  "--shadow-drawer",
] as const;
