/**
 * Milestone 68 (Team T2): working-hours math.
 *
 * A schedule is { timezone, windows } where windows maps a
 * weekday key ("mon".."sun") to a list of ["HH:MM","HH:MM"]
 * windows in that timezone. A window whose end <= start spans
 * midnight (it belongs to the day it STARTS on; the early
 * hours of the next day are covered by yesterday's window).
 * No schedule row at all means "always available" — handled
 * by the caller, not here.
 */
export type ScheduleWindows = Record<string, [string, string][]>;
export interface ScheduleLike { timezone: string; windows: ScheduleWindows }

const DAY_KEYS = ["sun", "mon", "tue", "wed", "thu", "fri", "sat"] as const;
const TIME_RE = /^([01]\d|2[0-3]):[0-5]\d$/;

export function isValidWindows(windows: unknown): windows is ScheduleWindows {
  if (!windows || typeof windows !== "object" || Array.isArray(windows)) return false;
  for (const [day, list] of Object.entries(windows as Record<string, unknown>)) {
    if (!DAY_KEYS.includes(day as any)) return false;
    if (!Array.isArray(list)) return false;
    for (const w of list) {
      if (!Array.isArray(w) || w.length !== 2) return false;
      if (typeof w[0] !== "string" || typeof w[1] !== "string") return false;
      if (!TIME_RE.test(w[0]) || !TIME_RE.test(w[1])) return false;
      if (w[0] === w[1]) return false; // a zero-length window is a data error, not 24h
    }
  }
  return true;
}

function minutes(hhmm: string): number {
  return Number(hhmm.slice(0, 2)) * 60 + Number(hhmm.slice(3, 5));
}

/** Local weekday key + minutes-into-day for `at` in `tz`. */
function localParts(at: Date, tz: string): { day: string; mins: number } {
  const fmt = new Intl.DateTimeFormat("en-US", {
    timeZone: tz, weekday: "short", hour: "2-digit", minute: "2-digit", hour12: false,
  });
  const parts = Object.fromEntries(fmt.formatToParts(at).map((p) => [p.type, p.value]));
  const day = (parts.weekday ?? "Mon").toLowerCase().slice(0, 3);
  const hour = Number(parts.hour ?? 0) % 24;
  return { day, mins: hour * 60 + Number(parts.minute ?? 0) };
}

/** Is `at` inside the schedule? Pure and clock-injectable. */
export function isWithinSchedule(schedule: ScheduleLike, at: Date): boolean {
  let tz = schedule.timezone || "Asia/Dhaka";
  let here: { day: string; mins: number };
  try {
    here = localParts(at, tz);
  } catch {
    tz = "Asia/Dhaka";
    here = localParts(at, tz);
  }
  const todayIdx = DAY_KEYS.indexOf(here.day as any);
  const yesterday = DAY_KEYS[(todayIdx + 6) % 7];
  // Today's windows.
  for (const [start, end] of schedule.windows[here.day] ?? []) {
    const s = minutes(start); const e = minutes(end);
    if (e > s) { if (here.mins >= s && here.mins < e) return true; }
    else if (here.mins >= s) return true; // overnight: the part before midnight
  }
  // Yesterday's overnight windows cover this morning.
  for (const [start, end] of schedule.windows[yesterday] ?? []) {
    const s = minutes(start); const e = minutes(end);
    if (e <= s && here.mins < e) return true;
  }
  return false;
}

/** Validate an IANA timezone name without a dependency. */
export function isValidTimezone(tz: string): boolean {
  try { new Intl.DateTimeFormat("en-US", { timeZone: tz }); return true; } catch { return false; }
}
