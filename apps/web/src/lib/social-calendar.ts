/**
 * SP5 — pure date/time helpers for the Social Posts calendar,
 * queue and schedule controls.
 *
 * All instants are UTC ISO strings; all "wall clock" reasoning is
 * done in the organization's IANA timezone via Intl — never the
 * browser's local timezone, so a post scheduled for 9am in Dhaka
 * means 9am in Dhaka whoever is looking at the page.
 */

function pad2(n: number): string {
  return String(n).padStart(2, "0");
}

interface TzParts {
  year: number;
  month: number; // 1-12
  day: number;
  hour: number; // 0-23
  minute: number;
  second: number;
}

/** Wall-clock parts of an instant as seen in `timeZone`. */
function tzParts(instantMs: number, timeZone: string): TzParts {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hourCycle: "h23",
  }).formatToParts(new Date(instantMs));
  const get = (type: string) => Number(parts.find((p) => p.type === type)?.value ?? 0);
  return {
    year: get("year"),
    month: get("month"),
    day: get("day"),
    hour: get("hour") % 24,
    minute: get("minute"),
    second: get("second"),
  };
}

/**
 * Offset of `timeZone` at the given instant, in ms: the tz wall
 * clock read as if it were UTC, minus the instant itself.
 * (Asia/Dhaka → +6h; America/New_York winter → −5h.)
 */
function tzOffsetMs(instantMs: number, timeZone: string): number {
  const p = tzParts(instantMs, timeZone);
  const wallAsUtc = Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second);
  return wallAsUtc - Math.floor(instantMs / 1000) * 1000;
}

/** "yyyy-mm-dd" of the instant in `timeZone`. */
export function orgDayKey(iso: string, timeZone: string): string {
  const p = tzParts(new Date(iso).getTime(), timeZone);
  return `${p.year}-${pad2(p.month)}-${pad2(p.day)}`;
}

export interface MonthCell {
  key: string; // "yyyy-mm-dd" (calendar date, tz-free)
  day: number;
  inMonth: boolean;
}

/**
 * Sunday-start calendar grid covering `month` (1-12) of `year`:
 * a fixed 6-week (42-cell) grid, padded with leading/trailing days
 * from the adjacent months (inMonth=false). Pure calendar
 * arithmetic on UTC date keys — no timezone is involved.
 */
export function monthCells(year: number, month: number): MonthCell[] {
  const firstOfMonth = Date.UTC(year, month - 1, 1);
  const leading = new Date(firstOfMonth).getUTCDay(); // 0 = Sunday
  const start = firstOfMonth - leading * 86_400_000;
  const cells: MonthCell[] = [];
  for (let i = 0; i < 42; i += 1) {
    const d = new Date(start + i * 86_400_000);
    const y = d.getUTCFullYear();
    const m = d.getUTCMonth() + 1;
    const day = d.getUTCDate();
    cells.push({ key: `${y}-${pad2(m)}-${pad2(day)}`, day, inMonth: y === year && m === month });
  }
  return cells;
}

/**
 * Convert a `datetime-local` value ("yyyy-mm-ddThh:mm") that means
 * wall time IN `timeZone` to the UTC ISO instant.
 *
 * Algorithm: guess the wall time as UTC, measure the tz offset at
 * the guess, subtract it, then re-measure the offset at the result
 * and adjust once more (the second pass is what makes it land
 * correctly across a DST transition).
 */
export function localInputToUtcIso(value: string, timeZone: string): string {
  const match = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})(?::(\d{2}))?$/.exec(value.trim());
  if (!match) throw new Error(`Invalid datetime-local value: ${value}`);
  const [, y, mo, d, h, mi, s] = match;
  const guess = Date.UTC(Number(y), Number(mo) - 1, Number(d), Number(h), Number(mi), Number(s ?? 0));
  let utc = guess - tzOffsetMs(guess, timeZone);
  const refinedOffset = tzOffsetMs(utc, timeZone);
  if (refinedOffset !== tzOffsetMs(guess, timeZone)) {
    utc = guess - refinedOffset;
  }
  return new Date(utc).toISOString();
}

/** Inverse of localInputToUtcIso — prefill for a datetime-local input. */
export function utcToLocalInput(iso: string, timeZone: string): string {
  const p = tzParts(new Date(iso).getTime(), timeZone);
  return `${p.year}-${pad2(p.month)}-${pad2(p.day)}T${pad2(p.hour)}:${pad2(p.minute)}`;
}

/**
 * Group posts by their day in `timeZone`: scheduled posts by
 * `scheduledAt`, published ones by `publishedAt` (scheduledAt wins
 * when both exist). Posts with neither instant are skipped.
 */
export function bucketPostsByDay<T extends { scheduledAt?: string | null; publishedAt?: string | null; status: string }>(
  posts: T[],
  timeZone: string,
): Map<string, T[]> {
  const buckets = new Map<string, T[]>();
  for (const post of posts) {
    const instant = post.scheduledAt ?? post.publishedAt;
    if (!instant) continue;
    const key = orgDayKey(instant, timeZone);
    const list = buckets.get(key);
    if (list) list.push(post);
    else buckets.set(key, [post]);
  }
  return buckets;
}
