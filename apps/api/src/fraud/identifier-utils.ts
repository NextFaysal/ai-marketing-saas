import { bdPhoneMatchKey, normalizeBdPhone } from "../orders/phone-utils";

/**
 * GB3 (GC9): identifier normalization + masking for the
 * blocked/trusted identifier lists and the checkout gate.
 * Pure functions — normalization is comparison-time only;
 * stored customer/order data is never rewritten.
 *
 * normalizeIdentifier returns { value, matchKey }:
 *  - phone: value = canonical +8801… form, matchKey = last-10
 *    digits (bdPhoneMatchKey) — the ON4/ON11 convention.
 *  - email: value = matchKey = trimmed + lowercased, gated by
 *    a simple shape regex (this is a list key, not a mailbox
 *    validator).
 *  - ip: value = matchKey = trimmed + lowercased; IPv4 must be
 *    4 octets 0–255, IPv6 is accepted when it contains ":" and
 *    only hex/colon/dot characters.
 */

export type IdentifierKind = "phone" | "email" | "ip" | "device";

export const IDENTIFIER_KINDS: readonly IdentifierKind[] = ["phone", "email", "ip", "device"];

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export function normalizeIdentifier(
  kind: string,
  raw: unknown,
): { value: string; matchKey: string } | null {
  if (kind === "phone") {
    const canonical = normalizeBdPhone(raw ?? "");
    if (!canonical) return null;
    const matchKey = bdPhoneMatchKey(canonical);
    if (!matchKey) return null;
    return { value: canonical, matchKey };
  }
  if (kind === "email") {
    const value = String(raw ?? "").trim().toLowerCase();
    if (!value || value.length > 320 || !EMAIL_RE.test(value)) return null;
    return { value, matchKey: value };
  }
  if (kind === "ip") {
    const value = String(raw ?? "").trim().toLowerCase();
    if (!value || value.length > 64) return null;
    if (value.includes(":")) {
      if (!/^[0-9a-f:.]+$/.test(value)) return null;
      return { value, matchKey: value };
    }
    const parts = value.split(".");
    if (parts.length !== 4) return null;
    for (const part of parts) {
      if (!/^\d{1,3}$/.test(part)) return null;
      const n = Number(part);
      if (n < 0 || n > 255) return null;
    }
    return { value, matchKey: value };
  }
  if (kind === "device") {
    const value = String(raw ?? "").trim().toLowerCase();
    if (!/^[0-9a-f]{64}$/.test(value)) return null;
    return { value, matchKey: value };
  }
  return null;
}

/** AB8 (AX27): normalize a client device fingerprint hash.
 * Returns the canonical 64-char lowercase hex string, or null
 * when absent/invalid (callers treat null as "no signal" —
 * never a checkout failure). */
export function normalizeDeviceHash(raw: unknown): string | null {
  return normalizeIdentifier("device", raw)?.value ?? null;
}

/** AB8 (AX27): the only device-hash fragment that may leave
 * the server in logs / staff payloads — the first 12 chars. */
export function deviceHashPrefix(hash: unknown): string {
  return String(hash ?? "").slice(0, 12);
}

/**
 * Masked summary safe for attempt logs / staff surfaces:
 *  - phone → "•••" + last 4 digits
 *  - email → first char + "***@" + domain
 *  - ip → the full ip (documented choice: an IP is a network
 *    identifier staff legitimately need in the attempt log;
 *    it is NOT used in audit metadata — see
 *    IdentifierListsService's audit mask).
 */
export function maskIdentifier(kind: string, value: unknown): string {
  const v = String(value ?? "");
  if (kind === "phone") {
    const digits = v.replace(/\D/g, "");
    if (digits.length < 4) return "•••";
    return `•••${digits.slice(-4)}`;
  }
  if (kind === "email") {
    const at = v.indexOf("@");
    if (at < 1) return "***";
    return `${v.slice(0, 1)}***@${v.slice(at + 1)}`;
  }
  if (kind === "ip") return v;
  if (kind === "device") return v ? `${deviceHashPrefix(v)}…` : "***";
  return "***";
}

/** Masked phone summary from any raw phone form ("•••3210"). */
export function maskPhoneSummary(rawPhone: unknown): string {
  const key = bdPhoneMatchKey(rawPhone ?? "");
  if (!key) return "অজানা ফোন";
  return `•••${key.slice(-4)}`;
}
