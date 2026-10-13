/**
 * EC32 — affiliate ref capture (shopper browser side).
 *
 * A partner's share link is `/shop/<slug>?ref=<code>`. When a
 * shopper lands with `?ref=`, the code is stored in localStorage
 * under `aff-ref:<orgKey>` with its capture time; the checkout
 * later attaches it as `affiliateCode` while it is still inside
 * the attribution window.
 *
 * The window is a CLIENT convenience only: the stored expiry
 * uses the shop/landing payload's attribution-days when the
 * caller passes it, else a 30-day default (the schema default
 * for StorefrontSetting.affiliateAttributionDays). The SERVER
 * re-validates everything at checkout (program enabled, partner
 * active, not self-dealing) — a stale or forged local code
 * grants nothing by itself.
 */

const DEFAULT_WINDOW_DAYS = 30;
const DAY_MS = 24 * 3600 * 1000;

interface StoredRef {
  code: string;
  at: number;
}

function storageKey(orgKey: string): string {
  return `aff-ref:${orgKey}`;
}

function validShape(code: string | null | undefined): string | null {
  const c = String(code ?? "").trim();
  if (!c || c.length > 40) return null;
  return c;
}

/** Read `?ref=` from the current location and store it for
 * `orgKey` when it has a valid shape. No-op off the browser, on
 * a missing/invalid param, or when storage is unavailable. */
export function captureAffiliateRef(orgKey: string, windowDays?: number | null): void {
  if (typeof window === "undefined" || !orgKey) return;
  try {
    const raw = new URLSearchParams(window.location.search).get("ref");
    const code = validShape(raw);
    if (!code) return;
    const days =
      typeof windowDays === "number" && windowDays > 0 ? windowDays : DEFAULT_WINDOW_DAYS;
    const stored: StoredRef & { expiresAt: number } = {
      code,
      at: Date.now(),
      expiresAt: Date.now() + days * DAY_MS,
    };
    window.localStorage.setItem(storageKey(orgKey), JSON.stringify(stored));
  } catch {
    /* storage unavailable — the ref simply does not persist */
  }
}

/** The stored affiliate code for `orgKey` when still inside the
 * attribution window, else null. `daysFallback` is accepted for
 * call-site symmetry with captureAffiliateRef; the expiry stored
 * at capture time governs. */
export function currentAffiliateCode(orgKey: string, daysFallback?: number | null): string | null {
  if (typeof window === "undefined" || !orgKey) return null;
  void daysFallback;
  try {
    const raw = window.localStorage.getItem(storageKey(orgKey));
    if (!raw) return null;
    const stored = JSON.parse(raw) as StoredRef & { expiresAt?: number };
    const code = validShape(stored.code);
    if (!code || typeof stored.at !== "number") return null;
    const expiresAt =
      typeof stored.expiresAt === "number"
        ? stored.expiresAt
        : stored.at + DEFAULT_WINDOW_DAYS * DAY_MS;
    if (Date.now() > expiresAt) {
      window.localStorage.removeItem(storageKey(orgKey));
      return null;
    }
    return code;
  } catch {
    return null;
  }
}
