/**
 * CX12d — Channel-wise AI schedule (pure helpers, no I/O).
 *
 * The schedule lives on InboxSetting.aiScheduleByChannel as a
 * map: channel -> { enabled, windows }. A window is
 * { days: number[] (0 = Sunday .. 6 = Saturday), start: "HH:mm",
 * end: "HH:mm" } in the ORGANIZATION's timezone.
 *
 * Semantics (also in docs/cx12d-acceptance.md):
 * - No entry for a channel, or an entry with enabled=false, means
 *   no schedule restriction: AI is active.
 * - enabled=true with ZERO valid windows means AI is OFF for that
 *   channel at all times (explicitly on, no hours = AI off).
 * - A window whose end === start is invalid and is DROPPED by the
 *   parser (it is NOT a 24-hour window).
 * - A window whose end < start is overnight: it starts on each
 *   listed day and runs past midnight into the next day.
 */

export interface AiScheduleWindow {
  days: number[];
  start: string;
  end: string;
}

export interface AiScheduleEntry {
  enabled: boolean;
  windows: AiScheduleWindow[];
}

export type AiScheduleMap = Record<string, AiScheduleEntry>;

const TIME_RE = /^([01]\d|2[0-3]):[0-5]\d$/;

function fail(): never {
  throw new Error("Invalid aiScheduleByChannel");
}

/**
 * Validate + normalize a raw schedule value. null/undefined reads
 * as {} (no schedule). Anything malformed throws
 * Error("Invalid aiScheduleByChannel") — callers decide whether
 * that is a 400 (settings update) or a defensive {} (reads).
 */
export function parseAiSchedule(raw: unknown): AiScheduleMap {
  if (raw === null || raw === undefined) return {};
  if (typeof raw !== "object" || Array.isArray(raw)) fail();
  const out: AiScheduleMap = {};
  for (const [channel, entryRaw] of Object.entries(raw as Record<string, unknown>)) {
    if (!channel || channel.length > 32) fail();
    if (!entryRaw || typeof entryRaw !== "object" || Array.isArray(entryRaw)) fail();
    const entry = entryRaw as Record<string, unknown>;
    if (typeof entry.enabled !== "boolean") fail();
    if (!Array.isArray(entry.windows) || entry.windows.length > 8) fail();
    const windows: AiScheduleWindow[] = [];
    for (const wRaw of entry.windows as unknown[]) {
      if (!wRaw || typeof wRaw !== "object" || Array.isArray(wRaw)) fail();
      const w = wRaw as Record<string, unknown>;
      if (!Array.isArray(w.days) || w.days.length === 0) fail();
      const days: number[] = [];
      for (const d of w.days as unknown[]) {
        if (!Number.isInteger(d) || (d as number) < 0 || (d as number) > 6) fail();
        if (!days.includes(d as number)) days.push(d as number);
      }
      if (typeof w.start !== "string" || !TIME_RE.test(w.start)) fail();
      if (typeof w.end !== "string" || !TIME_RE.test(w.end)) fail();
      // end === start is invalid (not 24h): dropped, not an error.
      if (w.start === w.end) continue;
      windows.push({ days: days.sort((a, b) => a - b), start: w.start as string, end: w.end as string });
    }
    out[channel] = { enabled: entry.enabled as boolean, windows };
  }
  return out;
}

const WEEKDAY_INDEX: Record<string, number> = {
  Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6,
};

function minutesOf(hhmm: string): number {
  return Number(hhmm.slice(0, 2)) * 60 + Number(hhmm.slice(3, 5));
}

/** Local weekday (0=Sun) + minutes-of-day for `at` in `timeZone`. */
function localParts(at: Date, timeZone: string): { day: number; mins: number } {
  const fmt = new Intl.DateTimeFormat("en-US", {
    timeZone, weekday: "short", hour: "2-digit", minute: "2-digit", hourCycle: "h23",
  });
  const parts = Object.fromEntries(fmt.formatToParts(at).map((p) => [p.type, p.value]));
  const day = WEEKDAY_INDEX[parts.weekday ?? "Mon"] ?? 1;
  const hour = Number(parts.hour ?? 0) % 24;
  return { day, mins: hour * 60 + Number(parts.minute ?? 0) };
}

function localPartsSafe(at: Date, timeZone: string): { day: number; mins: number } {
  try {
    return localParts(at, timeZone || "Asia/Dhaka");
  } catch {
    try { return localParts(at, "UTC"); } catch { return { day: at.getUTCDay(), mins: at.getUTCHours() * 60 + at.getUTCMinutes() }; }
  }
}

/** Is AI active for `channel` at instant `at` (in `timeZone`)? */
export function isAiActive(
  scheduleMap: AiScheduleMap | null | undefined,
  channel: string,
  at: Date,
  timeZone: string,
): boolean {
  const entry = scheduleMap?.[channel];
  if (!entry) return true; // no schedule for this channel
  if (!entry.enabled) return true; // schedule switched off = no restriction
  if (!entry.windows.length) return false; // enabled, no hours = AI off
  const { day, mins } = localPartsSafe(at, timeZone);
  const prevDay = (day + 6) % 7;
  for (const w of entry.windows) {
    const start = minutesOf(w.start);
    const end = minutesOf(w.end);
    if (end > start) {
      if (w.days.includes(day) && mins >= start && mins < end) return true;
    } else if (end < start) {
      // Overnight: starts on a listed day, ends the next morning.
      if (w.days.includes(day) && mins >= start) return true;
      if (w.days.includes(prevDay) && mins < end) return true;
    }
    // end === start cannot occur post-parse; ignored defensively.
  }
  return false;
}

/** True only when a schedule exists, is enabled, and `at` is outside it. */
export function aiScheduleBlocks(
  scheduleMap: AiScheduleMap | null | undefined,
  channel: string,
  at: Date,
  timeZone: string,
): boolean {
  const entry = scheduleMap?.[channel];
  if (!entry || !entry.enabled) return false;
  return !isAiActive(scheduleMap, channel, at, timeZone);
}
