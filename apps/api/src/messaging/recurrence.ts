/**
 * MS8 — broadcast recurrence: strict validation + next-
 * occurrence math. Pure module (the audience-rules precedent)
 * so the semantics are pinned by unit specs exactly as shipped.
 *
 * Shape: { freq: "daily" | "weekly", interval: int 1..52,
 * weekdays?: int[] (0 = Sunday … 6 = Saturday), endsAt?: ISO }.
 *
 * Semantics:
 *  - daily → anchor + interval days.
 *  - weekly without weekdays → anchor + interval weeks.
 *  - weekly with weekdays → the first listed weekday STRICTLY
 *    AFTER the anchor inside an occurrence week, where
 *    occurrence weeks are every interval-th week starting with
 *    the anchor's own week.
 *  - endsAt bounds the chain: an occurrence landing exactly ON
 *    endsAt still fires; the first occurrence after endsAt
 *    ends the chain (null).
 * Weekdays are Asia/Dhaka calendar days. Dhaka is a fixed
 * UTC+6 offset (no DST), so day arithmetic on instants (adding
 * whole days) preserves the Dhaka time-of-day exactly and the
 * weekday of an instant is its UTC weekday after a +6h shift.
 */

export interface Recurrence {
  freq: "daily" | "weekly";
  interval: number;
  weekdays?: number[];
  endsAt?: string;
}

export class RecurrenceValidationError extends Error {}

const DAY_MS = 24 * 3600 * 1000;
const KNOWN_KEYS = new Set(["freq", "interval", "weekdays", "endsAt"]);

/** Strictly validate + normalize an untrusted recurrence
 * input. Unknown freq/shape/keys are REJECTED (the service
 * turns this into a 400) — a recurrence is never silently
 * reinterpreted. */
export function parseRecurrence(raw: unknown): Recurrence {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    throw new RecurrenceValidationError("recurrence must be an object");
  }
  const r = raw as Record<string, unknown>;
  for (const key of Object.keys(r)) {
    if (!KNOWN_KEYS.has(key)) throw new RecurrenceValidationError(`recurrence has an unknown field: ${key}`);
  }
  if (r.freq !== "daily" && r.freq !== "weekly") {
    throw new RecurrenceValidationError('recurrence.freq must be "daily" or "weekly"');
  }
  const interval = r.interval === undefined ? 1 : r.interval;
  if (!Number.isInteger(interval) || (interval as number) < 1 || (interval as number) > 52) {
    throw new RecurrenceValidationError("recurrence.interval must be an integer between 1 and 52");
  }
  let weekdays: number[] | undefined;
  if (r.weekdays !== undefined && r.weekdays !== null) {
    if (r.freq === "daily") {
      throw new RecurrenceValidationError("recurrence.weekdays only applies to weekly recurrences");
    }
    if (!Array.isArray(r.weekdays) || r.weekdays.length === 0) {
      throw new RecurrenceValidationError("recurrence.weekdays must be a non-empty array of day numbers 0-6");
    }
    for (const w of r.weekdays) {
      if (!Number.isInteger(w) || (w as number) < 0 || (w as number) > 6) {
        throw new RecurrenceValidationError("recurrence.weekdays entries must be integers 0-6 (0 = Sunday)");
      }
    }
    weekdays = [...new Set(r.weekdays as number[])].sort((a, b) => a - b);
  }
  let endsAt: string | undefined;
  if (r.endsAt !== undefined && r.endsAt !== null) {
    const d = new Date(String(r.endsAt));
    if (Number.isNaN(d.getTime())) {
      throw new RecurrenceValidationError("recurrence.endsAt is not a valid date/time");
    }
    endsAt = d.toISOString();
  }
  return {
    freq: r.freq as "daily" | "weekly",
    interval: interval as number,
    ...(weekdays ? { weekdays } : {}),
    ...(endsAt ? { endsAt } : {}),
  };
}

/** The Asia/Dhaka weekday (0 = Sunday) of an instant. */
export function dhakaWeekday(d: Date): number {
  return new Date(d.getTime() + 6 * 3600 * 1000).getUTCDay();
}

/** The next occurrence strictly after `anchor`, or null when
 * the chain has ended (endsAt passed). */
export function nextOccurrence(rec: Recurrence, anchor: Date): Date | null {
  const a = anchor.getTime();
  if (Number.isNaN(a)) return null;
  let candidate: number | null = null;
  if (rec.freq === "daily") {
    candidate = a + rec.interval * DAY_MS;
  } else if (!rec.weekdays?.length) {
    candidate = a + rec.interval * 7 * DAY_MS;
  } else {
    const days = [...rec.weekdays].sort((x, y) => x - y);
    // Instant at the anchor's time-of-day on the Sunday of the
    // anchor's Dhaka week (whole-day steps preserve Dhaka
    // time-of-day under the fixed +6 offset).
    const weekStart = a - dhakaWeekday(anchor) * DAY_MS;
    outer: for (let w = 0; w < 520; w += rec.interval) {
      for (const wd of days) {
        const c = weekStart + (w * 7 + wd) * DAY_MS;
        if (c > a) { candidate = c; break outer; }
      }
    }
  }
  if (candidate === null) return null;
  if (rec.endsAt) {
    const end = new Date(rec.endsAt).getTime();
    if (Number.isNaN(end) || candidate > end) return null;
  }
  return new Date(candidate);
}
