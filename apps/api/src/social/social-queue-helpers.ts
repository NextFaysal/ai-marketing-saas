/**
 * SU2 — pure queue / recurrence helpers.
 *
 * Kept dependency-free so both SocialQueueService and
 * SocialPublishService (recurrence chain) can use them without an
 * import cycle (queue → social.service, publish → social.service).
 */

function tzOffsetMs(date: Date, timeZone: string): number {
  const dtf = new Intl.DateTimeFormat("en-US", {
    timeZone, year: "numeric", month: "2-digit", day: "2-digit",
    hour: "2-digit", minute: "2-digit", second: "2-digit", hourCycle: "h23",
  });
  const parts: Record<string, number> = {};
  for (const p of dtf.formatToParts(date)) {
    if (p.type !== "literal") parts[p.type] = Number(p.value);
  }
  const asUtc = Date.UTC(parts.year, (parts.month ?? 1) - 1, parts.day, parts.hour % 24, parts.minute, parts.second);
  return asUtc - Math.floor(date.getTime() / 1000) * 1000;
}

/** The UTC instant whose wall-clock time in `timeZone` is the
 * given local date + HH:MM. */
export function zonedTimeToUtc(
  year: number, month: number, day: number, hour: number, minute: number, timeZone: string,
): Date {
  let utc = Date.UTC(year, month - 1, day, hour, minute, 0);
  utc -= tzOffsetMs(new Date(utc), timeZone);
  const second = tzOffsetMs(new Date(utc), timeZone);
  // Re-check once: the first guess can sit on the other side of a
  // DST/offset boundary.
  const first = Date.UTC(year, month - 1, day, hour, minute, 0) - second;
  if (first !== utc) utc = first;
  return new Date(utc);
}

function localDateParts(date: Date, timeZone: string): { year: number; month: number; day: number } {
  const dtf = new Intl.DateTimeFormat("en-US", {
    timeZone, year: "numeric", month: "2-digit", day: "2-digit",
  });
  const parts: Record<string, number> = {};
  for (const p of dtf.formatToParts(date)) {
    if (p.type !== "literal") parts[p.type] = Number(p.value);
  }
  return { year: parts.year, month: parts.month, day: parts.day };
}

const sameMinute = (a: Date, b: Date) => Math.floor(a.getTime() / 60000) === Math.floor(b.getTime() / 60000);

/**
 * SU2: the next free posting-slot instant for an account, in the
 * org timezone. Scans local days from today up to 370 days ahead;
 * on each day, that weekday's enabled slots in time order; the
 * first candidate strictly after `now` that does not collide (same
 * minute) with an occupied instant wins. Null when none exists.
 */
export function computeNextSlot(
  slots: { weekday: number; time: string; enabled: boolean }[],
  occupied: Date[],
  now: Date,
  timeZone: string,
): Date | null {
  const enabled = (slots ?? []).filter((s) => s?.enabled);
  if (enabled.length === 0) return null;
  const occupiedDates = (occupied ?? []).map((d) => new Date(d)).filter((d) => !Number.isNaN(d.getTime()));
  const start = localDateParts(now, timeZone);
  for (let offset = 0; offset <= 370; offset++) {
    const cal = new Date(Date.UTC(start.year, start.month - 1, start.day + offset));
    const weekday = cal.getUTCDay();
    const daySlots = enabled
      .filter((s) => s.weekday === weekday)
      .sort((a, b) => String(a.time).localeCompare(String(b.time)));
    for (const slot of daySlots) {
      const [hh, mm] = String(slot.time).split(":").map((n) => Number(n));
      if (!Number.isFinite(hh) || !Number.isFinite(mm)) continue;
      const candidate = zonedTimeToUtc(cal.getUTCFullYear(), cal.getUTCMonth() + 1, cal.getUTCDate(), hh, mm, timeZone);
      if (candidate.getTime() <= now.getTime()) continue;
      if (occupiedDates.some((o) => sameMinute(o, candidate))) continue;
      return candidate;
    }
  }
  return null;
}

/** SU2: the next (today included, but strictly after `now`)
 * instant falling on `best.weekday` at `best.hour`:00 local. */
export function computeNextBestTime(best: { weekday: number; hour: number }, now: Date, timeZone: string): Date {
  const start = localDateParts(now, timeZone);
  for (let offset = 0; offset <= 7; offset++) {
    const cal = new Date(Date.UTC(start.year, start.month - 1, start.day + offset));
    if (cal.getUTCDay() !== best.weekday) continue;
    const candidate = zonedTimeToUtc(cal.getUTCFullYear(), cal.getUTCMonth() + 1, cal.getUTCDate(), best.hour, 0, timeZone);
    if (candidate.getTime() > now.getTime()) return candidate;
  }
  // Unreachable in practice (a weekday repeats within 7 days);
  // fall back to exactly one week ahead at the same local time.
  const cal = new Date(Date.UTC(start.year, start.month - 1, start.day + 7));
  return zonedTimeToUtc(cal.getUTCFullYear(), cal.getUTCMonth() + 1, cal.getUTCDate(), best.hour, 0, timeZone);
}

/**
 * SU2: advance a date by a recurrence interval. daily/weekly are
 * plain day arithmetic; monthly is calendar arithmetic with the
 * day clamped to the target month's last day (Jan 31 → Feb 28/29).
 * Computed on UTC components so the wall-clock time is preserved
 * regardless of the server's own timezone.
 */
export function addInterval(date: Date, frequency: string, interval: number): Date {
  const step = Number.isFinite(interval) && interval > 0 ? Math.floor(interval) : 1;
  const out = new Date(date.getTime());
  if (frequency === "daily") {
    out.setUTCDate(out.getUTCDate() + step);
    return out;
  }
  if (frequency === "weekly") {
    out.setUTCDate(out.getUTCDate() + 7 * step);
    return out;
  }
  if (frequency === "monthly") {
    const day = out.getUTCDate();
    const target = new Date(Date.UTC(out.getUTCFullYear(), out.getUTCMonth() + step, 1));
    const lastDay = new Date(Date.UTC(target.getUTCFullYear(), target.getUTCMonth() + 1, 0)).getUTCDate();
    out.setUTCDate(1);
    out.setUTCFullYear(target.getUTCFullYear(), target.getUTCMonth(), Math.min(day, lastDay));
    return out;
  }
  return out;
}
