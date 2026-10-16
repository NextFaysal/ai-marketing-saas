/**
 * ED7 (EB3) — bottom-chrome coordination store for the v2 shop.
 *
 * Exactly one thing owns the phone's bottom edge at a time: the
 * v2 mobile bottom navigation (ShopBottomNav) normally, or a
 * page-level buy bar when a surface claims it (ED8's PDP buy bar
 * will call setBuyBarActive(true) while mounted). This module is
 * the tiny shared store the two sides coordinate through —
 * ShopBottomNav subscribes and yields (renders nothing) while
 * buyBarActive is true. ED9's overlay manager will build on this
 * module later; keep it minimal.
 *
 * The pure store functions (getState / setBuyBarActive /
 * subscribe) are framework-free and unit-tested; useBuyBarActive
 * is the React binding over them.
 */
import { useSyncExternalStore } from "react";

export interface ShopBottomChromeState {
  buyBarActive: boolean;
}

let state: ShopBottomChromeState = { buyBarActive: false };
const listeners = new Set<() => void>();

export function getState(): ShopBottomChromeState {
  return state;
}

export function setBuyBarActive(v: boolean): void {
  if (state.buyBarActive === v) return;
  state = { buyBarActive: v };
  for (const fn of [...listeners]) fn();
}

/** Subscribe to state changes; returns the unsubscribe function. */
export function subscribe(fn: () => void): () => void {
  listeners.add(fn);
  return () => {
    listeners.delete(fn);
  };
}

/** React binding: true while a page-level buy bar owns the bottom. */
export function useBuyBarActive(): boolean {
  return useSyncExternalStore(
    subscribe,
    () => state.buyBarActive,
    () => false,
  );
}
