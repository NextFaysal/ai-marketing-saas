"use client";
/**
 * GB3 (GC9): Cloudflare Turnstile widget + idempotency-key hook.
 *
 * The Turnstile script is loaded ONCE (module-level promise) from
 * Cloudflare's explicit-render API. The widget renders into a div;
 * success / expiry / error all report through onToken (null when
 * there is no usable token). The widget is removed on unmount.
 * No new npm dependency — the global `turnstile` object is typed
 * locally.
 */
import React, { useCallback, useEffect, useRef, useState } from "react";

interface TurnstileGlobal {
  render: (
    container: HTMLElement,
    options: {
      sitekey: string;
      callback?: (token: string) => void;
      "expired-callback"?: () => void;
      "error-callback"?: () => void;
    },
  ) => string;
  remove: (widgetId: string) => void;
}

declare global {
  interface Window {
    turnstile?: TurnstileGlobal;
  }
}

const SCRIPT_SRC = "https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit";

let scriptPromise: Promise<TurnstileGlobal> | null = null;

function loadTurnstile(): Promise<TurnstileGlobal> {
  if (typeof window === "undefined") return Promise.reject(new Error("no window"));
  if (window.turnstile) return Promise.resolve(window.turnstile);
  if (scriptPromise) return scriptPromise;
  scriptPromise = new Promise<TurnstileGlobal>((resolve, reject) => {
    const existing = document.querySelector<HTMLScriptElement>(`script[src="${SCRIPT_SRC}"]`);
    const script = existing ?? document.createElement("script");
    const onLoad = () => {
      if (window.turnstile) resolve(window.turnstile);
      else reject(new Error("turnstile unavailable"));
    };
    script.addEventListener("load", onLoad);
    script.addEventListener("error", () => reject(new Error("turnstile load failed")));
    if (!existing) {
      script.src = SCRIPT_SRC;
      script.async = true;
      script.defer = true;
      document.head.appendChild(script);
    } else if (window.turnstile) {
      onLoad();
    }
  });
  // A failed load must not poison later mounts.
  scriptPromise.catch(() => { scriptPromise = null; });
  return scriptPromise;
}

export function TurnstileWidget({
  siteKey,
  onToken,
}: {
  siteKey: string;
  onToken: (token: string | null) => void;
}) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const widgetIdRef = useRef<string | null>(null);
  const onTokenRef = useRef(onToken);
  onTokenRef.current = onToken;
  const [loadFailed, setLoadFailed] = useState(false);

  useEffect(() => {
    let cancelled = false;
    setLoadFailed(false);
    loadTurnstile()
      .then((turnstile) => {
        if (cancelled || !containerRef.current) return;
        widgetIdRef.current = turnstile.render(containerRef.current, {
          sitekey: siteKey,
          callback: (token) => onTokenRef.current(token),
          "expired-callback": () => onTokenRef.current(null),
          "error-callback": () => onTokenRef.current(null),
        });
      })
      .catch(() => {
        if (cancelled) return;
        setLoadFailed(true);
        onTokenRef.current(null);
      });
    return () => {
      cancelled = true;
      const id = widgetIdRef.current;
      widgetIdRef.current = null;
      if (id && typeof window !== "undefined" && window.turnstile) {
        try { window.turnstile.remove(id); } catch { /* already gone */ }
      }
    };
  }, [siteKey]);

  return (
    <div>
      <div ref={containerRef} />
      {loadFailed ? (
        <p className="mt-1 text-xs font-medium text-rose-600">CAPTCHA লোড করা যায়নি — পেজটি আবার লোড করে চেষ্টা করুন।</p>
      ) : null}
    </div>
  );
}

function generateIdempotencyKey(): string {
  try {
    if (typeof crypto !== "undefined" && "randomUUID" in crypto) return crypto.randomUUID();
  } catch { /* fall through to the timestamp fallback */ }
  return `idem-${Date.now()}-${Math.random().toString(36).slice(2)}${Math.random().toString(36).slice(2)}`;
}

/**
 * One idempotency key per mount, stable across re-renders.
 * `reset()` regenerates it — call after a SUCCESSFUL order so a
 * later, genuinely new order is not deduplicated against it,
 * while a double-submit / retry of the same attempt reuses it.
 */
export function useIdempotencyKey(): { key: string; reset: () => void } {
  const [key, setKey] = useState<string>(() => generateIdempotencyKey());
  const reset = useCallback(() => setKey(generateIdempotencyKey()), []);
  return { key, reset };
}
