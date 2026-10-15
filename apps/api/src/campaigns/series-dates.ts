/**
 * Campaign Builder Frontier CN16 (NB7) — recurring series
 * date math: strict validation + anchor-based occurrence
 * computation. Pure module (the messaging/recurrence.ts
 * precedent) so the semantics are pinned by unit specs
 * exactly as shipped.
 *
 * Cadences: "weekly" | "monthly" | "dates".
 *
 * Semantics:
 *  - Occurrence k is ALWAYS computed from the ORIGINAL
 *    anchor (weekly/monthly) or from the explicit list
 *    (dates) — never from the previous occurrence — so a
 *    clamped month or a late generation can never drift
 *    the chain.
 *  - weekly → anchor + k × interval × 7 days (instant
 *    arithmetic; the anchor's time-of-day is preserved).
 *  - monthly → the anchor's day-of-month in the month
 *    (anchor month + k × interval), clamped to that
 *    month's length, at the anchor's UTC time-of-day.
 *    Clamping is recomputed from the anchor every time:
 *    a Jan-31 anchor yields Feb-28/29 then Mar-31 again,
 *    never Mar-28.
 *  - dates → the k-th entry of the stored list; past the
 *    end of the list the chain is exhausted (null).
 */

export interface SeriesRule {
  cadence: "weekly" | "monthly" | "dates";
  interval: number;
  anchorDate?: string;
  dates?: string[];
  leadDays: number;
}

export class SeriesValidationError extends Error {}

const CADENCES = ["weekly", "monthly", "dates"] as const;
const DAY_MS = 24 * 3600 * 1000;

function validDate(value: unknown): Date | null {
  if (value == null) return null;
  // A Date instance keeps its milliseconds; routing it
  // through String() would truncate to whole seconds
  // (Date#toString carries no ms) and quietly move the
  // anchor — the chain must never drift, not even by ms.
  if (value instanceof Date) return Number.isNaN(value.getTime()) ? null : value;
  const d = new Date(String(value));
  return Number.isNaN(d.getTime()) ? null : d;
}

/** Strictly validate + normalize an untrusted series
 * input. Unknown cadence/shape is REJECTED (the service
 * turns this into a 400) — a series rule is never silently
 * reinterpreted. */
export function parseSeriesRule(raw: {
  cadence?: unknown; interval?: unknown; anchorDate?: unknown; dates?: unknown; leadDays?: unknown;
}): SeriesRule {
  if (!(CADENCES as readonly unknown[]).includes(raw.cadence)) {
    throw new SeriesValidationError('cadence must be "weekly", "monthly" or "dates"');
  }
  const cadence = raw.cadence as SeriesRule["cadence"];
  const interval = raw.interval === undefined || raw.interval === null ? 1 : raw.interval;
  if (!Number.isInteger(interval) || (interval as number) < 1 || (interval as number) > 12) {
    throw new SeriesValidationError("interval must be an integer between 1 and 12");
  }
  const leadDays = raw.leadDays === undefined || raw.leadDays === null ? 3 : raw.leadDays;
  if (!Number.isInteger(leadDays) || (leadDays as number) < 0 || (leadDays as number) > 30) {
    throw new SeriesValidationError("leadDays must be an integer between 0 and 30");
  }
  if (cadence === "dates") {
    if (!Array.isArray(raw.dates) || raw.dates.length === 0) {
      throw new SeriesValidationError("dates cadence needs a non-empty dates list");
    }
    const parsed: string[] = [];
    for (const entry of raw.dates) {
      const d = validDate(entry);
      if (!d) throw new SeriesValidationError(`dates entry is not a valid date: ${String(entry)}`);
      parsed.push(d.toISOString());
    }
    const dates = [...new Set(parsed)].sort();
    return { cadence, interval: 1, dates, leadDays: leadDays as number };
  }
  const anchor = validDate(raw.anchorDate);
  if (!anchor) {
    throw new SeriesValidationError(`cadence "${cadence}" needs a valid anchorDate (the first instance date)`);
  }
  return { cadence, interval: interval as number, anchorDate: anchor.toISOString(), leadDays: leadDays as number };
}

/** The date of occurrence `index` for a series-shaped row
 * ({ cadence, interval, anchorDate, dates }), or null when
 * the chain is exhausted / the rule is unusable. */
export function seriesOccurrenceDate(
  s: { cadence: string; interval?: number | null; anchorDate?: Date | string | null; dates?: unknown },
  index: number,
): Date | null {
  if (!Number.isInteger(index) || index < 0) return null;
  if (s.cadence === "dates") {
    const list = Array.isArray(s.dates) ? s.dates : [];
    const raw = list[index];
    if (raw == null) return null;
    return validDate(raw);
  }
  const anchor = validDate(s.anchorDate ?? null);
  if (!anchor) return null;
  const interval = Math.max(1, Math.floor(Number(s.interval ?? 1)) || 1);
  if (s.cadence === "weekly") {
    return new Date(anchor.getTime() + index * interval * 7 * DAY_MS);
  }
  if (s.cadence === "monthly") {
    const totalMonths = anchor.getUTCFullYear() * 12 + anchor.getUTCMonth() + index * interval;
    const year = Math.floor(totalMonths / 12);
    const month = ((totalMonths % 12) + 12) % 12;
    const daysInMonth = new Date(Date.UTC(year, month + 1, 0)).getUTCDate();
    const day = Math.min(anchor.getUTCDate(), daysInMonth);
    return new Date(Date.UTC(
      year, month, day,
      anchor.getUTCHours(), anchor.getUTCMinutes(), anchor.getUTCSeconds(), anchor.getUTCMilliseconds(),
    ));
  }
  return null;
}
