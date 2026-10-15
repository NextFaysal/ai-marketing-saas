/**
 * ON11 — Bangladeshi phone normalization (comparison-time only).
 *
 * Existing stored phones are NEVER rewritten; normalization
 * happens when comparing / looking up, so a number stored as
 * "01…" still matches one blocked as "+8801…".
 */

const BN_DIGITS = "০১২৩৪৫৬৭৮৯";

export function bnToLatinDigits(raw: unknown): string {
  return String(raw ?? "").replace(/[০-৯]/g, (d) => String(BN_DIGITS.indexOf(d)));
}

/** Digits only (Bengali digits converted first). */
export function phoneDigits(raw: unknown): string {
  return bnToLatinDigits(raw).replace(/\D/g, "");
}

/**
 * Canonical "+8801XXXXXXXXX" or null.
 * Accepts 01XXXXXXXXX (11), 8801XXXXXXXXX (13),
 * +8801XXXXXXXXX, and 1XXXXXXXXX (10). The subscriber part
 * must match /^1[3-9]\d{8}$/ (a real BD mobile prefix).
 */
export function normalizeBdPhone(raw: unknown): string | null {
  if (raw === null || raw === undefined) return null;
  const digits = phoneDigits(raw);
  if (!digits) return null;
  let subscriber: string | null = null;
  if (digits.length === 11 && digits.startsWith("01")) subscriber = digits.slice(1);
  else if (digits.length === 13 && digits.startsWith("8801")) subscriber = digits.slice(3);
  else if (digits.length === 10 && digits.startsWith("1")) subscriber = digits;
  if (!subscriber || !/^1[3-9]\d{8}$/.test(subscriber)) return null;
  return `+880${subscriber}`;
}

/**
 * Comparison key: the last 10 digits of the digit string when
 * at least 10 digits exist, else null (same convention as
 * risk-score's phoneKey, but with the stricter 10-digit floor
 * this package's lookups need).
 */
export function bdPhoneMatchKey(raw: unknown): string | null {
  if (raw === null || raw === undefined) return null;
  const digits = phoneDigits(raw);
  if (digits.length < 10) return null;
  return digits.slice(-10);
}
