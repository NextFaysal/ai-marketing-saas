/**
 * NF4 (FB2) — pure slot engine + timezone helpers for Service &
 * Appointment bookings. No Nest, no Prisma, no new dependencies:
 * all zone math runs on Intl. Times of day are minutes from
 * midnight in the ORGANIZATION's timezone; a "date" input is the
 * org-local calendar date "YYYY-MM-DD".
 */

export interface AvailabilityRowLike {
  weekday: number; // 0 = Sunday … 6 = Saturday (JS convention)
  startMinute: number;
  endMinute: number;
}

export interface BookingIntervalLike {
  startAt: Date | string;
  endAt: Date | string;
  status?: string | null;
}

/** Offset (ms) of `tz` at an instant: local wall time = UTC + offset. */
export function tzOffsetMs(tz: string, utcMs: number): number {
  const dtf = new Intl.DateTimeFormat("en-US", {
    timeZone: tz, hourCycle: "h23",
    year: "numeric", month: "2-digit", day: "2-digit",
    hour: "2-digit", minute: "2-digit", second: "2-digit",
  });
  const parts: Record<string, number> = {};
  for (const p of dtf.formatToParts(new Date(utcMs))) {
    if (p.type !== "literal") parts[p.type] = Number(p.value);
  }
  const asUtc = Date.UTC(parts.year, (parts.month ?? 1) - 1, parts.day, parts.hour % 24, parts.minute, parts.second);
  return asUtc - Math.floor(utcMs / 1000) * 1000;
}

/** The UTC instant of `minutes` past midnight on org-local date `ymd`. */
export function zonedTimeToUtc(tz: string, ymd: string, minutes: number): Date {
  const [y, mo, d] = ymd.split("-").map(Number);
  const guess = Date.UTC(y, (mo ?? 1) - 1, d ?? 1) + minutes * 60_000;
  // Two passes: the offset at the guess, then at the corrected
  // instant (matters only across a DST transition).
  const once = guess - tzOffsetMs(tz, guess);
  return new Date(guess - tzOffsetMs(tz, once));
}

/** Org-local calendar date + minutes-from-midnight of an instant. */
export function localParts(tz: string, date: Date): { ymd: string; minutes: number } {
  const dtf = new Intl.DateTimeFormat("en-US", {
    timeZone: tz, hourCycle: "h23",
    year: "numeric", month: "2-digit", day: "2-digit",
    hour: "2-digit", minute: "2-digit",
  });
  const parts: Record<string, string> = {};
  for (const p of dtf.formatToParts(date)) {
    if (p.type !== "literal") parts[p.type] = p.value;
  }
  const ymd = `${parts.year}-${parts.month}-${parts.day}`;
  const minutes = (Number(parts.hour) % 24) * 60 + Number(parts.minute);
  return { ymd, minutes };
}

/** Weekday (0 = Sunday … 6 = Saturday) of a "YYYY-MM-DD" calendar date. */
export function weekdayOfYmd(ymd: string): number {
  const [y, mo, d] = ymd.split("-").map(Number);
  return new Date(Date.UTC(y, (mo ?? 1) - 1, d ?? 1)).getUTCDay();
}

export function isValidYmd(ymd: unknown): ymd is string {
  if (typeof ymd !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(ymd)) return false;
  const [y, mo, d] = ymd.split("-").map(Number);
  if (mo < 1 || mo > 12 || d < 1 || d > 31) return false;
  const dt = new Date(Date.UTC(y, mo - 1, d));
  return dt.getUTCFullYear() === y && dt.getUTCMonth() === mo - 1 && dt.getUTCDate() === d;
}

/**
 * Free start times (ISO strings, ascending) for one org-local
 * date: the staff member's working windows for that weekday,
 * minus every non-cancelled booking expanded by the service's
 * buffer on BOTH sides. A slot is offered only when the whole
 * [start, start+duration) fits inside one window. Steps advance
 * by stepMinutes (default = the service duration).
 */
export function computeSlots(input: {
  date: string;
  timezone: string;
  availabilityRows: AvailabilityRowLike[];
  bookings: BookingIntervalLike[];
  durationMinutes: number;
  bufferMinutes: number;
  stepMinutes?: number;
}): string[] {
  const tz = input.timezone || "Asia/Dhaka";
  const duration = input.durationMinutes;
  const buffer = Math.max(0, input.bufferMinutes || 0);
  const step = input.stepMinutes && input.stepMinutes > 0 ? input.stepMinutes : duration;
  if (!isValidYmd(input.date) || !(duration > 0) || !(step > 0)) return [];
  const weekday = weekdayOfYmd(input.date);
  const windows = (input.availabilityRows ?? [])
    .filter((r) => r.weekday === weekday && r.endMinute > r.startMinute)
    .sort((a, b) => a.startMinute - b.startMinute);
  if (!windows.length) return [];

  const blocked: Array<[number, number]> = [];
  for (const b of input.bookings ?? []) {
    if ((b.status ?? "") === "cancelled") continue;
    const start = b.startAt instanceof Date ? b.startAt : new Date(b.startAt);
    const end = b.endAt instanceof Date ? b.endAt : new Date(b.endAt);
    if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) continue;
    const sp = localParts(tz, start);
    const ep = localParts(tz, end);
    if (ep.ymd < input.date || sp.ymd > input.date) continue; // touches another day only
    const sMin = sp.ymd === input.date ? sp.minutes : 0;
    const eMin = ep.ymd === input.date ? ep.minutes : 1440;
    blocked.push([sMin - buffer, eMin + buffer]);
  }

  const out: string[] = [];
  const seen = new Set<string>();
  for (const w of windows) {
    for (let t = w.startMinute; t + duration <= w.endMinute; t += step) {
      const clash = blocked.some(([bs, be]) => t < be && t + duration > bs);
      if (clash) continue;
      const iso = zonedTimeToUtc(tz, input.date, t).toISOString();
      if (!seen.has(iso)) { seen.add(iso); out.push(iso); }
    }
  }
  return out.sort();
}
