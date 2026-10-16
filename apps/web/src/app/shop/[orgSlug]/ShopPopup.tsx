"use client";
import React, { useEffect, useRef, useState } from "react";
import { usePathname } from "next/navigation";
import { API_URL } from "@/lib/api";
import { shopT, type ShopLocale } from "@/lib/shop-i18n";
import { MediaImage } from "@/components/MediaImage";

interface PopupConfig {
  title: string;
  body: string;
  imageUrl: string | null;
  ctaText: string | null;
  ctaUrl: string | null;
  trigger: "delay_seconds" | "scroll_percent" | "exit_intent" | string;
  delaySeconds: number;
  scrollPercent: number;
  frequencyDays: number;
  showOn: "home" | "all" | string;
}

function cookieKey(orgSlug: string) {
  return `qosprey_popup_${orgSlug}`;
}

function hasFrequencyMarker(orgSlug: string, frequencyDays: number): boolean {
  try {
    if (frequencyDays <= 0) {
      return sessionStorage.getItem(cookieKey(orgSlug)) != null;
    }
    const needle = `${cookieKey(orgSlug)}=`;
    return document.cookie.split(";").some((c) => c.trim().startsWith(needle));
  } catch {
    return false;
  }
}

function setFrequencyMarker(orgSlug: string, frequencyDays: number) {
  try {
    const value = String(Date.now());
    if (frequencyDays <= 0) {
      sessionStorage.setItem(cookieKey(orgSlug), value);
    } else {
      const maxAge = Math.floor(frequencyDays * 24 * 60 * 60);
      document.cookie = `${cookieKey(orgSlug)}=${value}; path=/; max-age=${maxAge}; SameSite=Lax`;
    }
  } catch {
    /* ignore */
  }
}

export function ShopPopup({ orgSlug, locale = "bn" }: { orgSlug: string; locale?: ShopLocale | string }) {
  const t = shopT(locale);
  const pathname = usePathname();
  const [popup, setPopup] = useState<PopupConfig | null>(null);
  const [visible, setVisible] = useState(false);
  const shownRef = useRef(false);
  const popupRef = useRef<PopupConfig | null>(null);

  useEffect(() => {
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | null = null;
    let onScroll: (() => void) | null = null;
    let onLeave: ((e: MouseEvent) => void) | null = null;

    const fire = (kind: "impression" | "click") => {
      try {
        void fetch(`${API_URL}/public/shop/${encodeURIComponent(orgSlug)}/popup-event`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ kind }),
          keepalive: true,
        }).catch(() => undefined);
      } catch {
        /* swallowed */
      }
    };

    const show = () => {
      if (cancelled || shownRef.current || !popupRef.current) return;
      shownRef.current = true;
      try {
        setFrequencyMarker(orgSlug, popupRef.current.frequencyDays ?? 0);
      } catch { /* ignore */ }
      setVisible(true);
      fire("impression");
      cleanupTriggers();
    };

    const cleanupTriggers = () => {
      if (timer) clearTimeout(timer);
      if (onScroll) window.removeEventListener("scroll", onScroll);
      if (onLeave) document.documentElement.removeEventListener("mouseleave", onLeave);
    };

    (async () => {
      try {
        const res = await fetch(`${API_URL}/public/shop/${encodeURIComponent(orgSlug)}/popup`);
        if (!res.ok || cancelled) return;
        const data = (await res.json().catch(() => null)) as { popup?: PopupConfig | null } | null;
        const cfg = data?.popup ?? null;
        if (!cfg || cancelled) return;
        if (cfg.showOn === "home") {
          const p = pathname ?? "";
          if (p !== `/shop/${orgSlug}` && p !== `/shop/${orgSlug}/`) return;
        }
        if (hasFrequencyMarker(orgSlug, cfg.frequencyDays ?? 0)) return;
        popupRef.current = cfg;
        setPopup(cfg);

        if (cfg.trigger === "scroll_percent") {
          onScroll = () => {
            try {
              const height = document.documentElement.scrollHeight || 1;
              const pct = ((window.scrollY + window.innerHeight) / height) * 100;
              if (pct >= (cfg.scrollPercent || 50)) show();
            } catch { /* ignore */ }
          };
          window.addEventListener("scroll", onScroll, { passive: true });
          onScroll();
        } else if (cfg.trigger === "exit_intent") {
          onLeave = (e: MouseEvent) => {
            if (e.clientY <= 0) show();
          };
          document.documentElement.addEventListener("mouseleave", onLeave);
        } else {
          // delay_seconds (default)
          timer = setTimeout(show, Math.max(0, (cfg.delaySeconds || 0) * 1000));
        }
      } catch {
        /* render nothing on any failure */
      }
    })();

    return () => {
      cancelled = true;
      cleanupTriggers();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [orgSlug, pathname]);

  useEffect(() => {
    if (!visible) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") close();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visible, popup]);

  const fireClick = () => {
    try {
      void fetch(`${API_URL}/public/shop/${encodeURIComponent(orgSlug)}/popup-event`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ kind: "click" }),
        keepalive: true,
      }).catch(() => undefined);
    } catch { /* swallowed */ }
  };

  function close() {
    try {
      if (popupRef.current) setFrequencyMarker(orgSlug, popupRef.current.frequencyDays ?? 0);
    } catch { /* ignore */ }
    setVisible(false);
  }

  try {
    if (!visible || !popup) return null;
    return (
      <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4" onClick={close}>
        <div
          role="dialog"
          aria-modal="true"
          aria-label={popup.title}
          className="relative w-full max-w-md overflow-hidden rounded-2xl bg-white shadow-xl"
          onClick={(e) => e.stopPropagation()}
        >
          <button
            type="button"
            onClick={close}
            aria-label={t.popup.close}
            className="absolute right-3 top-3 z-10 flex h-8 w-8 items-center justify-center rounded-full bg-white/90 text-lg font-bold text-slate-700 shadow"
          >
            ×
          </button>
          {popup.imageUrl ? (
            <MediaImage src={popup.imageUrl} alt="" width={960} height={480} aspectRatio="2/1" sizes="(max-width: 640px) 90vw, 448px" className="max-h-56 w-full object-cover" />
          ) : null}
          <div className="space-y-3 p-6 text-center">
            {popup.title ? <h2 className="text-xl font-black text-slate-900">{popup.title}</h2> : null}
            {popup.body ? <p className="whitespace-pre-line text-sm leading-relaxed text-slate-600">{popup.body}</p> : null}
            {popup.ctaUrl && popup.ctaText ? (
              <a
                href={popup.ctaUrl}
                onClick={fireClick}
                className="inline-block rounded-xl bg-indigo-600 px-5 py-2.5 text-sm font-bold text-white"
              >
                {popup.ctaText}
              </a>
            ) : null}
          </div>
        </div>
      </div>
    );
  } catch {
    return null;
  }
}
