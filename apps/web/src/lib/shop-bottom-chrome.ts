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

/**
 * ED9: bottom lift for floating overlays. Two independent owners
 * publish their height while they own the phone's bottom edge —
 * the v2 bottom nav (navLiftPx) and a page-level buy / sticky
 * bar (buyBarLiftPx, published by ED8's PDP buy bar and ED9's
 * checkout sticky bar). Floating overlays (social proof, push
 * prompt, install bar, contact buttons) sit above whichever is
 * taller: the effective lift is the MAX of the two. Kept out of
 * `state`/`getState()` above so that store's shape (pinned by
 * its ED7 spec) is unchanged; both stores share `subscribe`.
 */
let navLiftPx = 0;
let buyBarLiftPx = 0;

/** Pure max-lift computation (unit-tested). */
export function computeBottomLiftPx(navPx: number, buyBarPx: number): number {
  const nav = Number.isFinite(navPx) && navPx > 0 ? navPx : 0;
  const buy = Number.isFinite(buyBarPx) && buyBarPx > 0 ? buyBarPx : 0;
  return Math.max(nav, buy);
}

export function getBottomLiftPx(): number {
  return computeBottomLiftPx(navLiftPx, buyBarLiftPx);
}

export function getNavLiftPx(): number {
  return navLiftPx;
}

export function getBuyBarLiftPx(): number {
  return buyBarLiftPx;
}

export function setNavLiftPx(px: number): void {
  const next = Number.isFinite(px) && px > 0 ? Math.round(px) : 0;
  if (next === navLiftPx) return;
  navLiftPx = next;
  for (const fn of [...listeners]) fn();
}

export function setBuyBarLiftPx(px: number): void {
  const next = Number.isFinite(px) && px > 0 ? Math.round(px) : 0;
  if (next === buyBarLiftPx) return;
  buyBarLiftPx = next;
  for (const fn of [...listeners]) fn();
}

/** React binding: effective bottom lift in px (0 = no chrome). */
export function useBottomLiftPx(): number {
  return useSyncExternalStore(
    subscribe,
    () => computeBottomLiftPx(navLiftPx, buyBarLiftPx),
    () => 0,
  );
}
