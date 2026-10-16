"use client";
import React, { useEffect, useRef, useState } from "react";
import { API_URL } from "@/lib/api";
import { themeOf, type ShopThemeId } from "@/lib/shop-theme";
import {
  canShowSocialProof,
  parseShownCount,
  socialProofDismissedKey,
  socialProofFeedFromPayload,
  socialProofItemAt,
  socialProofLines,
  socialProofShownKey,
  type SocialProofFeed,
  type SocialProofItem,
} from "@/lib/shop-social-proof";

/**
 * AB7 (AX17) — social-proof popups, mounted in the shop layout.
 *
 * Fetches the org's feed once per page load; renders nothing
 * when disabled or empty. Items rotate one at a time,
 * bottom-left: each shows for `displaySec`, the next follows
 * after `intervalSec`. Rotation pauses while the tab is hidden
 * and stops after `maxPerSession` shows (sessionStorage count
 * per org). The close button dismisses for the session. The
 * impression endpoint is POSTed once per mount, only when
 * items will actually be shown (fire-and-forget).
 */
export function ShopSocialProof({
  orgSlug,
  themeId,
}: {
  orgSlug: string;
  themeId?: ShopThemeId | string;
}) {
  const [item, setItem] = useState<SocialProofItem | null>(null);
  const [visible, setVisible] = useState(false);
  const feedRef = useRef<SocialProofFeed | null>(null);
  const shownRef = useRef(0);
  const stoppedRef = useRef(false);
  const impressionFiredRef = useRef(false);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    let cancelled = false;
    stoppedRef.current = false;

    const clearTimer = () => {
      if (timerRef.current) clearTimeout(timerRef.current);
      timerRef.current = null;
    };

    const readDismissed = (): boolean => {
      try {
        return sessionStorage.getItem(socialProofDismissedKey(orgSlug)) === "1";
      } catch {
        return false;
      }
    };

    const persistShown = () => {
      try {
        sessionStorage.setItem(socialProofShownKey(orgSlug), String(shownRef.current));
      } catch { /* ignore */ }
    };

    const scheduleHide = () => {
      const feed = feedRef.current;
      if (!feed) return;
      clearTimer();
      timerRef.current = setTimeout(() => {
        if (cancelled || stoppedRef.current) return;
        setVisible(false);
        scheduleNext();
      }, Math.max(1, feed.config.displaySec) * 1000);
    };

    const scheduleNext = () => {
      const feed = feedRef.current;
      if (!feed) return;
      clearTimer();
      timerRef.current = setTimeout(() => {
        if (cancelled || stoppedRef.current) return;
        showNext();
      }, Math.max(1, feed.config.intervalSec) * 1000);
    };

    const showNext = () => {
      const feed = feedRef.current;
      if (!feed || cancelled || stoppedRef.current) return;
      if (
        !canShowSocialProof({
          shownCount: shownRef.current,
          maxPerSession: feed.config.maxPerSession,
          dismissed: readDismissed(),
          itemCount: feed.items.length,
        })
      ) {
        stoppedRef.current = true;
        setVisible(false);
        return;
      }
      const next = socialProofItemAt(feed.items, shownRef.current);
      if (!next) return;
      shownRef.current += 1;
      persistShown();
      setItem(next);
      setVisible(true);
      scheduleHide();
    };

    const onVisibility = () => {
      if (cancelled || stoppedRef.current || !feedRef.current) return;
      if (document.hidden) {
        // Pause: no timer runs while the tab is hidden.
        clearTimer();
        return;
      }
      // Resume: a visible popup finishes its display window;
      // a hidden gap restarts the interval.
      if (visible) scheduleHide();
      else scheduleNext();
    };

    (async () => {
      try {
        const res = await fetch(`${API_URL}/public/shop/${encodeURIComponent(orgSlug)}/social-proof`);
        if (!res.ok || cancelled) return;
        const feed = socialProofFeedFromPayload(await res.json().catch(() => null));
        if (!feed || cancelled) return;
        let initialShown = 0;
        try {
          initialShown = parseShownCount(sessionStorage.getItem(socialProofShownKey(orgSlug)));
        } catch { /* storage unavailable — start at 0 */ }
        shownRef.current = initialShown;
        if (
          !canShowSocialProof({
            shownCount: initialShown,
            maxPerSession: feed.config.maxPerSession,
            dismissed: readDismissed(),
            itemCount: feed.items.length,
          })
        ) {
          return;
        }
        feedRef.current = feed;
        if (!impressionFiredRef.current) {
          impressionFiredRef.current = true;
          try {
            void fetch(`${API_URL}/public/shop/${encodeURIComponent(orgSlug)}/social-proof/impression`, {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({}),
              keepalive: true,
            }).catch(() => undefined);
          } catch { /* fire-and-forget */ }
        }
        document.addEventListener("visibilitychange", onVisibility);
        showNext();
      } catch {
        /* render nothing on any failure */
      }
    })();

    return () => {
      cancelled = true;
      clearTimer();
      document.removeEventListener("visibilitychange", onVisibility);
    };
    // `visible` is read inside onVisibility for resume semantics;
    // the scheduler is (re)built once per org mount.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [orgSlug]);

  function dismiss() {
    stoppedRef.current = true;
    if (timerRef.current) clearTimeout(timerRef.current);
    try {
      sessionStorage.setItem(socialProofDismissedKey(orgSlug), "1");
    } catch { /* ignore */ }
    setVisible(false);
  }

  if (!item) return null;
  const lines = socialProofLines(item);
  const dark = themeOf(themeId).headerDark;
  return (
    <div
      role="status"
      className={`fixed bottom-5 left-5 z-40 w-[calc(100vw-2.5rem)] max-w-xs rounded-2xl border p-4 shadow-xl transition-all duration-500 ${
        dark ? "border-slate-700 bg-slate-900 text-white" : "border-slate-200 bg-white text-slate-800"
      } ${visible ? "translate-y-0 opacity-100" : "pointer-events-none translate-y-3 opacity-0"}`}
    >
      <button
        type="button"
        onClick={dismiss}
        aria-label="বন্ধ করুন"
        className={`absolute right-2 top-2 flex h-6 w-6 items-center justify-center rounded-full text-sm font-bold ${
          dark ? "text-slate-300 hover:bg-slate-800" : "text-slate-500 hover:bg-slate-100"
        }`}
      >
        ×
      </button>
      <p className="pr-5 text-sm font-semibold leading-relaxed">{lines.main}</p>
      <p className={`mt-1 text-xs ${dark ? "text-slate-300" : "text-slate-500"}`}>{lines.sub}</p>
    </div>
  );
}
