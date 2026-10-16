/**
 * AB7 (AX16) — shop web-push prompt helpers (pure, testable).
 *
 * The prompt component (ShopPushPrompt) owns the browser APIs;
 * everything decidable without them lives here: the VAPID key
 * conversion, the per-org localStorage flag keys, and the
 * show / don't-show truth table.
 *
 * Flags (localStorage, per org):
 *   `shop-push-subscribed:<orgSlug>` — set ONLY after the API
 *     accepted the subscription; failures never set it.
 *   `shop-push-dismissed:<orgSlug>`  — epoch-ms of the last
 *     dismissal; the prompt stays away for 30 days.
 */

export const PUSH_DISMISS_DAYS = 30;
const DAY_MS = 24 * 3600 * 1000;

export function pushSubscribedKey(orgSlug: string): string {
  return `shop-push-subscribed:${orgSlug}`;
}

export function pushDismissedKey(orgSlug: string): string {
  return `shop-push-dismissed:${orgSlug}`;
}

/**
 * Convert a base64url VAPID public key into the Uint8Array that
 * PushManager.subscribe expects as `applicationServerKey`.
 * The array is backed by a fresh ArrayBuffer (typed
 * Uint8Array<ArrayBuffer>) so the TS DOM lib accepts it as a
 * BufferSource — a plain Uint8Array<ArrayBufferLike> is not.
 */
export function urlBase64ToUint8Array(base64String: string): Uint8Array<ArrayBuffer> {
  const padding = "=".repeat((4 - (base64String.length % 4)) % 4);
  const base64 = (base64String + padding).replace(/-/g, "+").replace(/_/g, "/");
  const rawData = atob(base64);
  const outputArray = new Uint8Array(new ArrayBuffer(rawData.length));
  for (let i = 0; i < rawData.length; i++) {
    outputArray[i] = rawData.charCodeAt(i);
  }
  return outputArray;
}

/** True when a stored dismissal timestamp is still inside the quiet window. */
export function isPushDismissedRecently(
  raw: string | null | undefined,
  now: number = Date.now(),
  days: number = PUSH_DISMISS_DAYS,
): boolean {
  if (!raw) return false;
  const at = Number(raw);
  if (!Number.isFinite(at) || at <= 0) return false;
  return now - at < days * DAY_MS;
}

export interface PushConfig {
  enabled: boolean;
  publicKey: string | null;
  promptDelaySec: number;
}

/** Normalize the GET push-config payload; null when malformed/disabled. */
export function pushConfigFromPayload(payload: unknown): PushConfig | null {
  if (!payload || typeof payload !== "object") return null;
  const p = payload as Record<string, unknown>;
  if (p.enabled !== true) return null;
  const publicKey = typeof p.publicKey === "string" && p.publicKey.trim() ? p.publicKey.trim() : null;
  if (!publicKey) return null;
  const delay = typeof p.promptDelaySec === "number" && Number.isFinite(p.promptDelaySec) ? p.promptDelaySec : 0;
  return { enabled: true, publicKey, promptDelaySec: Math.max(0, delay) };
}

/**
 * The prompt may appear ONLY when every gate passes: config
 * enabled with a key, the Notification + ServiceWorker +
 * PushManager APIs exist, permission was never decided
 * ("default"), and the shopper has neither subscribed nor
 * dismissed within the quiet window.
 */
export function shouldShowPushPrompt(args: {
  config: PushConfig | null;
  hasNotificationApi: boolean;
  hasServiceWorker: boolean;
  hasPushManager: boolean;
  permission: string | null | undefined;
  alreadySubscribed: boolean;
  dismissedRecently: boolean;
}): boolean {
  if (!args.config?.enabled || !args.config.publicKey) return false;
  if (!args.hasNotificationApi || !args.hasServiceWorker || !args.hasPushManager) return false;
  if (args.permission !== "default") return false;
  if (args.alreadySubscribed) return false;
  if (args.dismissedRecently) return false;
  return true;
}
