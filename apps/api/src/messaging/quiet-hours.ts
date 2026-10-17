/**
 * MX3 — Marketing quiet hours: the PURE core. No Prisma, no
 * providers, no I/O — plain data in, plain data out, so the
 * window rules are pinned by unit specs exactly as shipped
 * (cascade.ts precedent).
 *
 * The window is a pair of "HH:mm" strings evaluated in the
 * ORGANIZATION's timezone (Organization.timezone — the field
 * exists on the Organization model with default "Asia/Dhaka";
 * MX3 deliberately adds no second timezone field). Start is
 * inclusive, end is exclusive. A window whose start is AFTER
 * its end is an overnight window (e.g. 22:00–08:00 covers
 * 22:00–23:59 and 00:00–07:59). Start == end is an EMPTY
 * window (never active) — the settings write rejects it, and
 * the helper stays safe if a hand-edited row carries one.
 *
 * Quiet hours gate MARKETING broadcast sends only. Nothing in
 * this file is imported by any transactional path
 * (OrderNotificationService, Shop OTP) — those never pass
 * through the broadcast engine at all.
 */

export interface QuietHoursSetting {
  enabled: boolean;
  /** "HH:mm" (24h) or null. */
  start: string | null;
  /** "HH:mm" (24h) or null. */
  end: string | null;
  /** IANA timezone the window is evaluated in. */
  timezone: string;
}

const HHMM_RE = /^([01]\d|2[0-3]):[0-5]\d$/;

/** Strict "HH:mm" (24h, zero-padded) validation. */
export function isValidHhMm(value: unknown): value is string {
  return typeof value === "string" && HHMM_RE.test(value);
}

/** "HH:mm" → minutes since local midnight, or null when invalid. */
export function hhMmToMinutes(value: string | null | undefined): number | null {
  if (!isValidHhMm(value)) return null;
  const [h, m] = value.split(":");
  return Number(h) * 60 + Number(m);
}

/** True when `tz` is a timezone Intl can actually evaluate. */
export function isValidTimeZone(tz: unknown): tz is string {
  if (typeof tz !== "string" || !tz) return false;
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: tz });
    return true;
  } catch {
    return false;
  }
}

/**
 * Minutes since midnight of `now` in `timeZone`, or null when
 * the timezone cannot be evaluated. Uses hourCycle h23 so
 * midnight reads 00 (never 24).
 */
export function localMinutesOfDay(now: Date, timeZone: string): number | null {
  try {
    const parts = new Intl.DateTimeFormat("en-GB", {
      timeZone, hour: "2-digit", minute: "2-digit", hourCycle: "h23",
    }).formatToParts(now);
    const hour = Number(parts.find((p) => p.type === "hour")?.value);
    const minute = Number(parts.find((p) => p.type === "minute")?.value);
    if (!Number.isInteger(hour) || !Number.isInteger(minute)) return null;
    return (hour % 24) * 60 + minute;
  } catch {
    return null;
  }
}

/**
 * Is the marketing quiet window active at `now`?
 * - disabled, missing/invalid bounds, an empty window
 *   (start == end), or an unevaluable timezone ⇒ false
 *   (quiet hours can never silently block sends on bad data —
 *   the settings WRITE is where invalid values are rejected).
 * - normal window (start < end): start <= t < end.
 * - overnight window (start > end): t >= start OR t < end.
 */
export function isQuietHoursActive(setting: QuietHoursSetting, now: Date): boolean {
  if (!setting || setting.enabled !== true) return false;
  const start = hhMmToMinutes(setting.start);
  const end = hhMmToMinutes(setting.end);
  if (start === null || end === null || start === end) return false;
  const t = localMinutesOfDay(now, setting.timezone);
  if (t === null) return false;
  if (start < end) return t >= start && t < end;
  return t >= start || t < end;
}
