"use client";
import React, { useEffect, useState } from "react";
import { useLocale } from "@/lib/i18n/provider";

/**
 * Milestone 60 — PWA plumbing.
 *
 * SwRegister (mounted once in the root layout) registers the
 * hand-rolled /sw.js in production builds only — a dev server must
 * never fight a stale service worker — and stashes the browser's
 * beforeinstallprompt event so the in-app install button can offer
 * it later, at a moment the USER chooses.
 *
 * InstallButton renders nothing until the browser actually offers
 * installation; if the user dismisses the in-app offer once, it is
 * remembered in localStorage and never shown again (no nagging).
 */

interface BeforeInstallPromptEvent extends Event {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed" }>;
}

const DISMISS_KEY = "pwa-install-dismissed";

function isStandalone(): boolean {
  if (typeof window === "undefined") return false;
  return window.matchMedia?.("(display-mode: standalone)").matches || (window.navigator as any).standalone === true;
}

export function SwRegister() {
  useEffect(() => {
    if (process.env.NODE_ENV !== "production") return;
    if ("serviceWorker" in navigator) {
      navigator.serviceWorker.register("/sw.js", { scope: "/" }).catch(() => undefined);
    }
    const onPrompt = (e: Event) => {
      e.preventDefault();
      (window as any).__pwaInstallPrompt = e as BeforeInstallPromptEvent;
      window.dispatchEvent(new Event("pwa:installable"));
    };
    const onInstalled = () => {
      (window as any).__pwaInstallPrompt = null;
      window.dispatchEvent(new Event("pwa:installed"));
    };
    window.addEventListener("beforeinstallprompt", onPrompt);
    window.addEventListener("appinstalled", onInstalled);
    return () => {
      window.removeEventListener("beforeinstallprompt", onPrompt);
      window.removeEventListener("appinstalled", onInstalled);
    };
  }, []);
  return null;
}

export function InstallButton({ className }: { className?: string }) {
  const { dict } = useLocale();
  const S = dict.shared;
  const [available, setAvailable] = useState(false);

  useEffect(() => {
    if (isStandalone()) return;
    try { if (localStorage.getItem(DISMISS_KEY)) return; } catch { /* private mode */ }
    const check = () => setAvailable(Boolean((window as any).__pwaInstallPrompt));
    check();
    window.addEventListener("pwa:installable", check);
    window.addEventListener("pwa:installed", () => setAvailable(false));
    return () => window.removeEventListener("pwa:installable", check);
  }, []);

  if (!available) return null;

  async function install() {
    const prompt = (window as any).__pwaInstallPrompt as BeforeInstallPromptEvent | null;
    if (!prompt) { setAvailable(false); return; }
    await prompt.prompt();
    const choice = await prompt.userChoice.catch(() => ({ outcome: "dismissed" as const }));
    (window as any).__pwaInstallPrompt = null;
    setAvailable(false);
    if (choice.outcome !== "accepted") {
      try { localStorage.setItem(DISMISS_KEY, new Date().toISOString()); } catch { /* ignore */ }
    }
  }

  function dismiss() {
    try { localStorage.setItem(DISMISS_KEY, new Date().toISOString()); } catch { /* ignore */ }
    setAvailable(false);
  }

  return (
    <span className={`relative inline-flex ${className ?? ""}`}>
      <button onClick={install} className="rounded-full border border-indigo-200 bg-indigo-50 px-3 py-1.5 text-xs font-semibold text-indigo-700 shadow-sm transition hover:bg-indigo-100" aria-label={S.zzPwaInstallAria}>
        {S.zzPwaInstall}
      </button>
      <button onClick={dismiss} aria-label={S.zzPwaClose}
        className="absolute -right-1.5 -top-1.5 flex h-4 w-4 items-center justify-center rounded-full bg-slate-500 text-[9px] font-bold text-white">✕</button>
    </span>
  );
}
