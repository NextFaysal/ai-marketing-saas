"use client";
import React, { useEffect, useState } from "react";

/**
 * AB8 (AX22) — per-shop install bar.
 *
 * Rides the dashboard PWA plumbing (components/pwa.tsx): the
 * root SwRegister stashes the browser's beforeinstallprompt on
 * window.__pwaInstallPrompt and fires "pwa:installable". This
 * bar offers THAT prompt for the shop (its manifest is the
 * per-shop one from the shop layout metadata, so the installed
 * app carries the shop's name/icon). AX22 registers NO service
 * worker of its own.
 *
 * iOS Safari never fires beforeinstallprompt: there the bar
 * shows the manual Share → "হোম স্ক্রিনে যোগ করুন" instruction
 * instead. Dismissal is remembered per shop in localStorage
 * (`shop-install-dismissed:<orgSlug>`); the bar renders nothing
 * when the shop is already running standalone or was dismissed.
 */

interface BeforeInstallPromptEvent extends Event {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed" }>;
}

function isStandalone(): boolean {
  if (typeof window === "undefined") return false;
  return window.matchMedia?.("(display-mode: standalone)").matches || (window.navigator as any).standalone === true;
}

function isIosSafari(): boolean {
  if (typeof navigator === "undefined") return false;
  const ua = navigator.userAgent ?? "";
  const iosDevice = /iphone|ipad|ipod/i.test(ua)
    || (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);
  if (!iosDevice) return false;
  // Safari only — in-app browsers and iOS Chrome/Firefox cannot
  // add to the home screen the same way.
  return /safari/i.test(ua) && !/crios|fxios|edgios|chrome/i.test(ua);
}

export function shopInstallDismissedKey(orgSlug: string): string {
  return `shop-install-dismissed:${orgSlug}`;
}

export function ShopInstallBar({ orgSlug }: { orgSlug: string }) {
  const [mode, setMode] = useState<"prompt" | "ios" | null>(null);

  useEffect(() => {
    if (isStandalone()) return;
    try { if (localStorage.getItem(shopInstallDismissedKey(orgSlug))) return; } catch { /* private mode */ }
    if (isIosSafari()) {
      setMode("ios");
      return;
    }
    const check = () => {
      if ((window as any).__pwaInstallPrompt) setMode("prompt");
    };
    check();
    const onInstalled = () => setMode(null);
    window.addEventListener("pwa:installable", check);
    window.addEventListener("pwa:installed", onInstalled);
    return () => {
      window.removeEventListener("pwa:installable", check);
      window.removeEventListener("pwa:installed", onInstalled);
    };
  }, [orgSlug]);

  if (!mode) return null;

  function dismiss() {
    try { localStorage.setItem(shopInstallDismissedKey(orgSlug), new Date().toISOString()); } catch { /* ignore */ }
    setMode(null);
  }

  async function install() {
    const prompt = (window as any).__pwaInstallPrompt as BeforeInstallPromptEvent | null;
    if (!prompt) { setMode(null); return; }
    await prompt.prompt();
    const choice = await prompt.userChoice.catch(() => ({ outcome: "dismissed" as const }));
    (window as any).__pwaInstallPrompt = null;
    setMode(null);
    if (choice.outcome !== "accepted") dismiss();
  }

  return (
    <div className="fixed inset-x-0 bottom-0 z-40 border-t border-slate-200 bg-white/95 px-4 py-3 shadow-[0_-4px_16px_rgba(0,0,0,0.08)] backdrop-blur" style={{ paddingBottom: "max(0.75rem, env(safe-area-inset-bottom))" }}>
      <div className="mx-auto flex max-w-3xl items-center gap-3">
        {mode === "prompt" ? (
          <>
            <p className="flex-1 text-sm font-semibold text-slate-800">এই শপটি অ্যাপ হিসেবে ইনস্টল করুন — দ্রুত অর্ডার করুন যেকোনো সময়।</p>
            <button type="button" onClick={() => void install()} className="shrink-0 rounded-full bg-indigo-600 px-4 py-2 text-sm font-bold text-white hover:bg-indigo-700">
              📲 ইনস্টল করুন
            </button>
          </>
        ) : (
          <p className="flex-1 text-sm font-semibold leading-relaxed text-slate-800">
            অ্যাপ হিসেবে যোগ করতে নিচের <span aria-hidden="true">⎙</span> শেয়ার বাটনে ট্যাপ করে <span className="font-bold">“হোম স্ক্রিনে যোগ করুন”</span> সিলেক্ট করুন।
          </p>
        )}
        <button type="button" onClick={dismiss} aria-label="বন্ধ করুন" className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-slate-100 text-xs font-bold text-slate-500">
          ✕
        </button>
      </div>
    </div>
  );
}
