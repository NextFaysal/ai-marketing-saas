/**
 * AB8 (AX27) — client device hash for checkout fraud signals.
 *
 * HONESTY: this is a WEAK signal. It is built only from coarse,
 * stable-ish browser properties (user agent, screen size,
 * timezone, language, a bucketed core count) — deliberately NO
 * canvas or WebGL fingerprinting. Many distinct devices share a
 * hash and one device can drift between hashes; the server must
 * treat it as one corroborating signal, never as identity.
 */

export interface DeviceSignals {
  userAgent: string;
  screenSize: string;
  timeZone: string;
  language: string;
  hardwareConcurrency?: number | null;
}

/** Coarse buckets so raw core counts never leave the device:
 * 0/unknown → "0", ≤2 → "2", ≤4 → "4", ≤8 → "8", else "16+". */
export function bucketConcurrency(n: number | null | undefined): string {
  const v = typeof n === "number" && Number.isFinite(n) ? Math.floor(n) : 0;
  if (v <= 0) return "0";
  if (v <= 2) return "2";
  if (v <= 4) return "4";
  if (v <= 8) return "8";
  return "16+";
}

/** The exact parts joined into the hash input (pure — tested). */
export function buildDeviceParts(signals: DeviceSignals): string[] {
  return [
    signals.userAgent ?? "",
    signals.screenSize ?? "",
    signals.timeZone ?? "",
    signals.language ?? "",
    bucketConcurrency(signals.hardwareConcurrency),
  ];
}

let cached: Promise<string | null> | null = null;

async function compute(): Promise<string | null> {
  try {
    if (typeof window === "undefined" || typeof navigator === "undefined") return null;
    const subtle = globalThis.crypto?.subtle;
    if (!subtle || typeof TextEncoder === "undefined") return null;
    let timeZone = "";
    try {
      timeZone = Intl.DateTimeFormat().resolvedOptions().timeZone ?? "";
    } catch {
      timeZone = "";
    }
    const signals: DeviceSignals = {
      userAgent: navigator.userAgent ?? "",
      screenSize:
        typeof screen !== "undefined" ? `${screen.width}x${screen.height}` : "",
      timeZone,
      language: navigator.language ?? "",
      hardwareConcurrency: navigator.hardwareConcurrency,
    };
    const data = new TextEncoder().encode(buildDeviceParts(signals).join("|"));
    const digest = await subtle.digest("SHA-256", data);
    return Array.from(new Uint8Array(digest))
      .map((b) => b.toString(16).padStart(2, "0"))
      .join("");
  } catch {
    return null;
  }
}

/** SHA-256 hex of the device parts, or null on any failure.
 * The promise is cached module-level — the parts cannot change
 * within a page session, and checkout submits stay cheap. */
export function computeDeviceHash(): Promise<string | null> {
  if (!cached) cached = compute();
  return cached;
}

/** Checkout call-site alias: the cached hash (or null, in which
 * case callers omit the field entirely). */
export function getDeviceHashForCheckout(): Promise<string | null> {
  return computeDeviceHash();
}
