// @vitest-environment jsdom
// ED17 (EB7) — dark-mode contracts:
//  1. the theme-resolution helper (stored value × system
//     preference → class decision) across the full matrix;
//  2. a CSS pin: BOTH dark blocks in globals.css (the dashboard
//     `.dashboard-root.dark` block and the shop v2 media block)
//     re-declare every token in DARK_TOKEN_LIST — no token may be
//     left light-only by accident — and NEITHER block touches the
//     brand seam (--brand / --brand-from / --brand-to);
//  3. the topbar toggle renders, cycles the preference and drives
//     the class on the dashboard root.
import React from "react";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  DARK_TOKEN_LIST,
  applyThemeClass,
  parseThemePref,
  readStoredThemePref,
  resolveIsDark,
  writeStoredThemePref,
  THEME_STORAGE_KEY,
  type ThemeStorage,
} from "./theme";
import { ThemeToggle } from "@/components/theme-toggle";

afterEach(() => cleanup());
beforeEach(() => {
  window.localStorage.clear();
  document.body.innerHTML = "";
});

function fakeStorage(initial: Record<string, string> = {}): ThemeStorage & {
  data: Record<string, string>;
} {
  const data = { ...initial };
  return {
    data,
    getItem: (k) => (k in data ? data[k] : null),
    setItem: (k, v) => {
      data[k] = v;
    },
  };
}

describe("ED17 theme resolution", () => {
  it("parses stored values, defaulting anything unknown to system", () => {
    expect(parseThemePref("light")).toBe("light");
    expect(parseThemePref("dark")).toBe("dark");
    expect(parseThemePref("system")).toBe("system");
    expect(parseThemePref(null)).toBe("system");
    expect(parseThemePref(undefined)).toBe("system");
    expect(parseThemePref("")).toBe("system");
    expect(parseThemePref("DARK")).toBe("system");
    expect(parseThemePref("garbage")).toBe("system");
  });

  it("resolves the full stored × system matrix", () => {
    // explicit prefs win over the OS
    expect(resolveIsDark("dark", false)).toBe(true);
    expect(resolveIsDark("dark", true)).toBe(true);
    expect(resolveIsDark("light", false)).toBe(false);
    expect(resolveIsDark("light", true)).toBe(false);
    // system defers to the OS
    expect(resolveIsDark("system", true)).toBe(true);
    expect(resolveIsDark("system", false)).toBe(false);
  });

  it("reads/writes the preference through storage", () => {
    const store = fakeStorage();
    expect(readStoredThemePref(store)).toBe("system");
    writeStoredThemePref("dark", store);
    expect(store.data[THEME_STORAGE_KEY]).toBe("dark");
    expect(readStoredThemePref(store)).toBe("dark");
    const corrupt = fakeStorage({ [THEME_STORAGE_KEY]: "neon" });
    expect(readStoredThemePref(corrupt)).toBe("system");
  });

  it("applyThemeClass toggles the dark class and reports the decision", () => {
    const el = document.createElement("div");
    expect(applyThemeClass(el, "dark", false)).toBe(true);
    expect(el.classList.contains("dark")).toBe(true);
    expect(applyThemeClass(el, "system", true)).toBe(true);
    expect(applyThemeClass(el, "system", false)).toBe(false);
    expect(el.classList.contains("dark")).toBe(false);
    expect(applyThemeClass(el, "light", true)).toBe(false);
    expect(applyThemeClass(null, "dark", true)).toBe(false);
  });
});

describe("ED17 globals.css dark blocks — token pin", () => {
  const css = readFileSync(
    resolve(dirname(fileURLToPath(import.meta.url)), "../app/globals.css"),
    "utf8",
  );

  function blockAfter(selector: string): string {
    const start = css.indexOf(selector);
    expect(start, `selector ${selector} exists`).toBeGreaterThanOrEqual(0);
    const open = css.indexOf("{", start);
    const close = css.indexOf("\n}", open);
    expect(open).toBeGreaterThanOrEqual(0);
    expect(close).toBeGreaterThan(open);
    return css.slice(open, close);
  }

  const dashboardBlock = blockAfter(".dashboard-root.dark {");
  const shopBlock = blockAfter('[data-shop-theme="v2"] {');

  it.each([
    ["dashboard", () => dashboardBlock],
    ["shop v2 (prefers-color-scheme)", () => shopBlock],
  ])("%s block re-declares every dark token", (_name, get) => {
    const block = get();
    for (const token of DARK_TOKEN_LIST) {
      expect(block, `${token} re-declared`).toContain(`${token}:`);
    }
  });

  it("neither dark block touches the brand seam", () => {
    for (const block of [dashboardBlock, shopBlock]) {
      expect(block).not.toContain("--brand-from:");
      expect(block).not.toContain("--brand-to:");
      expect(block).not.toMatch(/--brand:/);
    }
  });

  it("the shop block sits inside the dark media query", () => {
    const mediaIdx = css.indexOf("@media (prefers-color-scheme: dark)");
    const shopIdx = css.indexOf('[data-shop-theme="v2"] {');
    expect(mediaIdx).toBeGreaterThanOrEqual(0);
    expect(shopIdx).toBeGreaterThan(mediaIdx);
  });
});

describe("ED17 ThemeToggle", () => {
  it("renders, cycles system → light → dark → system and drives the root class", () => {
    render(
      <div className="dashboard-root">
        <ThemeToggle />
      </div>,
    );
    const root = document.querySelector(".dashboard-root")!;
    const button = screen.getByRole("button", { name: /থিম:/ });
    expect(button.getAttribute("aria-label")).toContain("সিস্টেম");

    fireEvent.click(button); // → light
    expect(window.localStorage.getItem(THEME_STORAGE_KEY)).toBe("light");
    expect(root.classList.contains("dark")).toBe(false);
    expect(button.getAttribute("aria-label")).toContain("লাইট");

    fireEvent.click(button); // → dark
    expect(window.localStorage.getItem(THEME_STORAGE_KEY)).toBe("dark");
    expect(root.classList.contains("dark")).toBe(true);
    expect(button.getAttribute("aria-label")).toContain("ডার্ক");

    fireEvent.click(button); // → system (jsdom has no matchMedia → light)
    expect(window.localStorage.getItem(THEME_STORAGE_KEY)).toBe("system");
    expect(root.classList.contains("dark")).toBe(false);
  });
});
