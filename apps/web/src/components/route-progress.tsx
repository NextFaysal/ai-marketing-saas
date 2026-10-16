"use client";
import React, { useCallback, useEffect, useRef, useState } from "react";
import { usePathname } from "next/navigation";

/**
 * ED11 (EB4) — route progress bar (hand-rolled, no dependency).
 *
 * App Router exposes no router events, so the mechanism is
 * deliberately mechanical and honest about its edges:
 *  - START: a capture-phase click listener on the document. A
 *    click on a same-origin <a> whose href differs from the
 *    current location (not a hash-only change, not
 *    target=_blank / download, no modifier keys) starts the
 *    bar. The bar trickles toward 85% and waits there.
 *  - FINISH: the pathname actually changes (usePathname
 *    effect) — or a `popstate` fires — the bar completes to
 *    100%, fades, and resets.
 *  - SAFETY: if no location change lands within 6s (a
 *    query-only soft navigation changes neither pathname nor
 *    history state in a way this component can observe), the
 *    bar completes anyway rather than hanging forever. This is
 *    the documented blind spot of the pathname-based finish.
 * Full-page navigations (plain <a> without client routing)
 * unload the document, so the bar simply dies with the page —
 * the brief window before unload still shows progress.
 *
 * Presentation: fixed 3px bar at the very top, brand gradient
 * (--brand-from → --brand-to; inside the shop root the org's
 * --brand wins via .btn-brand-style var usage below), pointer-
 * events-none, z-[45] — above sticky headers (z-20/30) and the
 * dashboard topbar (z-40), below every modal/drawer (shop
 * dialogs z-50, @repo/ui z-[80], toasts z-[90]).
 * Reduced motion: the JS trickle is skipped entirely under
 * prefers-reduced-motion (the bar jumps to its waiting width),
 * and the globals kill-switch collapses its CSS transitions.
 */

const TRICKLE_MS = 180;
const MAX_WAITING = 85;
const SAFETY_MS = 6000;

function prefersReducedMotion(): boolean {
  try {
    return window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  } catch {
    return false;
  }
}

export function RouteProgress() {
  const pathname = usePathname();
  const [width, setWidth] = useState(0);
  const [visible, setVisible] = useState(false);
  const activeRef = useRef(false);
  const widthRef = useRef(0);
  const trickleRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const safetyRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const hideRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const firstPathRef = useRef(true);

  const clearTimers = useCallback(() => {
    if (trickleRef.current) clearInterval(trickleRef.current);
    if (safetyRef.current) clearTimeout(safetyRef.current);
    trickleRef.current = null;
    safetyRef.current = null;
  }, []);

  const finish = useCallback(() => {
    if (!activeRef.current) return;
    activeRef.current = false;
    clearTimers();
    widthRef.current = 100;
    setWidth(100);
    hideRef.current = setTimeout(() => {
      setVisible(false);
      widthRef.current = 0;
      setWidth(0);
    }, 220);
  }, [clearTimers]);

  const start = useCallback(() => {
    if (activeRef.current) return;
    activeRef.current = true;
    if (hideRef.current) clearTimeout(hideRef.current);
    setVisible(true);
    const reduced = prefersReducedMotion();
    widthRef.current = reduced ? MAX_WAITING : 12;
    setWidth(widthRef.current);
    if (!reduced) {
      trickleRef.current = setInterval(() => {
        // Ease toward the waiting ceiling; never past it — only
        // a real location change completes the bar (or the
        // safety timeout below, for unobservable changes).
        widthRef.current = Math.min(
          MAX_WAITING,
          widthRef.current + Math.max(1, (MAX_WAITING - widthRef.current) * 0.12),
        );
        setWidth(widthRef.current);
      }, TRICKLE_MS);
    }
    safetyRef.current = setTimeout(finish, SAFETY_MS);
  }, [finish]);

  // START: intercept qualifying anchor clicks (capture phase so
  // the bar appears even when the click also triggers a drawer
  // close or similar handler).
  useEffect(() => {
    const onClick = (e: MouseEvent) => {
      if (e.defaultPrevented || e.button !== 0) return;
      if (e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
      const target = e.target as HTMLElement | null;
      const anchor = target?.closest?.("a");
      if (!anchor) return;
      if (anchor.target && anchor.target !== "_self") return;
      if (anchor.hasAttribute("download")) return;
      const href = anchor.getAttribute("href");
      if (!href || href.startsWith("#")) return;
      let dest: URL;
      try {
        dest = new URL(anchor.href, window.location.href);
      } catch {
        return;
      }
      if (dest.origin !== window.location.origin) return;
      // Same page (incl. hash-only or query-identical): no nav.
      if (dest.pathname === window.location.pathname && dest.search === window.location.search) return;
      start();
    };
    document.addEventListener("click", onClick, true);
    return () => document.removeEventListener("click", onClick, true);
  }, [start]);

  // FINISH: the location actually changed.
  useEffect(() => {
    if (firstPathRef.current) {
      firstPathRef.current = false;
      return;
    }
    finish();
  }, [pathname, finish]);

  useEffect(() => {
    window.addEventListener("popstate", finish);
    return () => {
      window.removeEventListener("popstate", finish);
      clearTimers();
      if (hideRef.current) clearTimeout(hideRef.current);
    };
  }, [finish, clearTimers]);

  if (!visible) return null;
  return (
    <div
      aria-hidden="true"
      className="pointer-events-none fixed inset-x-0 top-0 z-[45] h-[3px]"
    >
      <div
        className="h-full transition-[width,opacity] duration-200 ease-out"
        style={{
          width: `${width}%`,
          opacity: width >= 100 ? 0 : 1,
          backgroundImage:
            "linear-gradient(90deg, var(--brand, var(--brand-from)), var(--brand-to))",
          boxShadow: "0 0 8px var(--brand-ring)",
        }}
      />
    </div>
  );
}
