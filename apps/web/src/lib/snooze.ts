/**
 * CX5: snooze helpers for the inbox action bar.
 *
 * Snoozing a conversation is pure visibility: the API hides it
 * from every list/count except the snoozed folder until the wake
 * time, and the handover sweep wakes it. The API accepts exactly
 * one of { minutes } / { until } — these helpers build those
 * bodies and mirror the API's validation so the UI can refuse a
 * bad custom time before sending (the API stays the authority).
 */

export interface SnoozePreset {
  label: string;
  minutes: number;
}

export const SNOOZE_PRESETS: SnoozePreset[] = [
  { label: "১ ঘণ্টা", minutes: 60 },
  { label: "৪ ঘণ্টা", minutes: 240 },
  { label: "২৪ ঘণ্টা", minutes: 1440 },
];

/** API range for the minutes form of a snooze. */
export const SNOOZE_MIN_MINUTES = 5;
export const SNOOZE_MAX_MINUTES = 10080;

export type SnoozeBody = { minutes: number } | { until: string };

/** Body for a preset snooze; null when minutes is out of range. */
export function snoozeBodyForMinutes(minutes: number): SnoozeBody | null {
  if (!Number.isInteger(minutes) || minutes < SNOOZE_MIN_MINUTES || minutes > SNOOZE_MAX_MINUTES) return null;
  return { minutes };
}

/**
 * Body for the custom datetime-local input. The value is a local
 * wall-clock string ("2026-10-12T15:30"); the API wants an
 * absolute future time (> now + 60s), so anything unparseable or
 * not far enough ahead returns null.
 */
export function snoozeBodyForCustom(value: string, now: Date = new Date()): SnoozeBody | null {
  if (!value) return null;
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return null;
  if (parsed.getTime() <= now.getTime() + 60000) return null;
  return { until: parsed.toISOString() };
}

/** True while the wake time is still in the future. */
export function isActivelySnoozed(snoozedUntil?: string | null, now: Date = new Date()): boolean {
  if (!snoozedUntil) return false;
  const t = new Date(snoozedUntil).getTime();
  return !Number.isNaN(t) && t > now.getTime();
}
