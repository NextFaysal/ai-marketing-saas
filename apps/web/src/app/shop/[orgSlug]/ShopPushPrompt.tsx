"use client";
import React, { useEffect, useRef, useState } from "react";
import { API_URL } from "@/lib/api";
import {
  isPushDismissedRecently,
  pushConfigFromPayload,
  pushDismissedKey,
  pushSubscribedKey,
  shouldShowPushPrompt,
  urlBase64ToUint8Array,
  type PushConfig,
} from "@/lib/shop-push";
import { fetchMe, getShopSession } from "@/lib/storefront-account";
import { useOverlayGrant } from "@/lib/shop-overlay-queue";
import { useBottomLiftPx } from "@/lib/shop-bottom-chrome";

/**
 * AB7 (AX16) — shop push-notification prompt.
 *
 * Scope constraint: this prompt lives on shop surfaces, and its
 * service worker (served at /shop-push-sw) is registered with
 * scope "/shop/" only. The dashboard PWA worker at root scope
 * "/" owns caching; this worker does push ONLY. Both workers
 * coexist because their scopes differ — neither replaces the
 * other.
 *
 * Behaviour: fetch the org's push-config; when enabled with a
 * VAPID key, the Notification API exists, permission is still
 * "default", and the shopper has neither subscribed nor
 * dismissed within 30 days (localStorage flags per org), show a
 * small prompt card after `promptDelaySec`. Every failure path
 * is silent — a push problem must never break shopping.
 */
export function ShopPushPrompt({ orgSlug }: { orgSlug: string }) {
  const [visible, setVisible] = useState(false);
  // ED9: queue grant + bottom lift (dismissal memory stays in
  // this component, exactly as before — the queue owns none).
  const granted = useOverlayGrant("push", visible);
  const lift = useBottomLiftPx();
  const [busy, setBusy] = useState(false);
  const configRef = useRef<PushConfig | null>(null);

  useEffect(() => {
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | null = null;
    (async () => {
      try {
        const res = await fetch(`${API_URL}/public/shop/${encodeURIComponent(orgSlug)}/push-config`);
        if (!res.ok || cancelled) return;
        const config = pushConfigFromPayload(await res.json().catch(() => null));
        if (!config || cancelled) return;
        let alreadySubscribed = false;
        let dismissedRaw: string | null = null;
        try {
          alreadySubscribed = localStorage.getItem(pushSubscribedKey(orgSlug)) != null;
          dismissedRaw = localStorage.getItem(pushDismissedKey(orgSlug));
        } catch { /* storage unavailable — treat as never asked */ }
        const ok = shouldShowPushPrompt({
          config,
          hasNotificationApi: typeof window !== "undefined" && "Notification" in window,
          hasServiceWorker: typeof navigator !== "undefined" && "serviceWorker" in navigator,
          hasPushManager: typeof window !== "undefined" && "PushManager" in window,
          permission: typeof window !== "undefined" && "Notification" in window ? Notification.permission : null,
          alreadySubscribed,
          dismissedRecently: isPushDismissedRecently(dismissedRaw),
        });
        if (!ok || cancelled) return;
        configRef.current = config;
        timer = setTimeout(() => {
          if (!cancelled) setVisible(true);
        }, Math.max(0, config.promptDelaySec) * 1000);
      } catch {
        /* silent — never break shopping */
      }
    })();
    return () => {
      cancelled = true;
      if (timer) clearTimeout(timer);
    };
  }, [orgSlug]);

  function dismiss() {
    try {
      localStorage.setItem(pushDismissedKey(orgSlug), String(Date.now()));
    } catch { /* ignore */ }
    setVisible(false);
  }

  async function accept() {
    const config = configRef.current;
    if (!config?.publicKey || busy) return;
    setBusy(true);
    try {
      const permission = await Notification.requestPermission();
      if (permission !== "granted") {
        setVisible(false);
        return;
      }
      const registration = await navigator.serviceWorker.register("/shop-push-sw", { scope: "/shop/" });
      const subscription = await registration.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: urlBase64ToUint8Array(config.publicKey),
      });
      const json = subscription.toJSON() as {
        endpoint?: string;
        keys?: { p256dh?: string; auth?: string };
      };
      if (!json.endpoint || !json.keys?.p256dh || !json.keys?.auth) {
        setVisible(false);
        return;
      }
      // A signed-in shopper's customer id rides along when the
      // shop session exposes one (fetchMe via the stored session
      // token); guests subscribe without it.
      let customerId: string | undefined;
      if (getShopSession(orgSlug)) {
        try {
          const me = await fetchMe(orgSlug);
          customerId = me.customer?.id || undefined;
        } catch { /* best-effort only */ }
      }
      const res = await fetch(`${API_URL}/public/shop/${encodeURIComponent(orgSlug)}/push-subscribe`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          endpoint: json.endpoint,
          keys: { p256dh: json.keys.p256dh, auth: json.keys.auth },
          ...(customerId ? { customerId } : {}),
        }),
      });
      if (res.ok) {
        try {
          localStorage.setItem(pushSubscribedKey(orgSlug), String(Date.now()));
        } catch { /* ignore */ }
      }
      // On a hard error no flag is set — a later visit may retry.
      setVisible(false);
    } catch {
      /* silent — never break shopping; no flags are set */
      setVisible(false);
    } finally {
      setBusy(false);
    }
  }

  if (!visible || !granted) return null;
  return (
    <div
      className="fixed bottom-5 left-5 z-50 w-[calc(100vw-2.5rem)] max-w-xs rounded-2xl border border-slate-200 bg-white p-4 shadow-xl"
      style={lift > 0 ? { bottom: `calc(1.25rem + ${lift}px)` } : undefined}
    >
      <p className="text-sm font-semibold leading-relaxed text-slate-800">
        অফার ও অর্ডারের আপডেট পেতে নোটিফিকেশন চালু করবেন?
      </p>
      <div className="mt-3 flex gap-2">
        <button
          type="button"
          onClick={() => void accept()}
          disabled={busy}
          className="flex-1 rounded-xl bg-indigo-600 px-4 py-2 text-sm font-bold text-white disabled:opacity-60"
        >
          চালু করুন
        </button>
        <button
          type="button"
          onClick={dismiss}
          disabled={busy}
          className="flex-1 rounded-xl border border-slate-300 px-4 py-2 text-sm font-bold text-slate-600 disabled:opacity-60"
        >
          না থাক
        </button>
      </div>
    </div>
  );
}
