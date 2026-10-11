/**
 * CRM C1 — Lead Follow-up Reminders (pure helpers).
 *
 * Day semantics: a "day" is the Asia/Dhaka calendar day (the
 * product's home timezone; orgs store timezone Asia/Dhaka by
 * default). Bounds are computed with the same two-pass Intl solver
 * the inbox team-activity board uses (InboxService.dayStartUtc),
 * so "today" here matches what the team sees elsewhere: Dhaka
 * midnight to Dhaka midnight, expressed as UTC instants.
 *
 * A lead is DUE when its nextFollowUpAt falls before the start of
 * tomorrow (Dhaka) — i.e. due today or any earlier day. The bucket
 * splits at today's Dhaka start: >= start -> "today", older ->
 * "overdue" with a whole-Dhaka-day count.
 */

const DHAKA_TZ = "Asia/Dhaka";
const DAY_MS = 24 * 3600 * 1000;

/** Start (00:00 local) of the Dhaka calendar day containing `now`,
 * as a UTC instant. Two-pass Intl offset solver (Dhaka has no DST,
 * but the solver keeps this correct for any fixed date). */
export function dhakaDayStartUtc(now: Date): Date {
  const parts = new Intl.DateTimeFormat("en-CA", { timeZone: DHAKA_TZ, year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(now);
  const get = (t: string) => Number(parts.find((x) => x.type === t)?.value ?? 0);
  const y = get("year"); const m = get("month"); const d = get("day");
  let guess = Date.UTC(y, m - 1, d, 0, 0, 0);
  for (let i = 0; i < 2; i++) {
    const local = new Intl.DateTimeFormat("en-US", { timeZone: DHAKA_TZ, hour12: false, year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit" }).formatToParts(new Date(guess));
    const g = (t: string) => Number(local.find((x) => x.type === t)?.value ?? 0);
    const asUtc = Date.UTC(g("year"), g("month") - 1, g("day"), g("hour") % 24, g("minute"), g("second"));
    guess -= asUtc - Date.UTC(y, m - 1, d, 0, 0, 0);
  }
  return new Date(guess);
}

/** "2026-10-11" style key of the Dhaka calendar day containing `d`. */
export function dhakaDayKey(d: Date): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: DHAKA_TZ, year: "numeric", month: "2-digit", day: "2-digit" }).format(d);
}

export interface DueState {
  bucket: "today" | "overdue";
  /** Whole Dhaka days the follow-up is late (0 when due today). */
  daysOverdue: number;
  /** Bengali label for boards/notifications: "আজ" | "৩ দিন পেরিয়ে গেছে". */
  label: string;
}

/**
 * Classify a follow-up instant against `now` (Dhaka days).
 * Returns null when the follow-up is in the future (or unset) —
 * i.e. NOT due yet.
 */
export function classifyDue(nextFollowUpAt: Date | string | null | undefined, now: Date): DueState | null {
  if (!nextFollowUpAt) return null;
  const due = new Date(nextFollowUpAt);
  if (Number.isNaN(due.getTime())) return null;
  const startToday = dhakaDayStartUtc(now);
  const startTomorrow = new Date(startToday.getTime() + DAY_MS);
  if (due.getTime() >= startTomorrow.getTime()) return null;
  if (due.getTime() >= startToday.getTime()) return { bucket: "today", daysOverdue: 0, label: "আজ" };
  const dueDayStart = dhakaDayStartUtc(due);
  const daysOverdue = Math.max(1, Math.round((startToday.getTime() - dueDayStart.getTime()) / DAY_MS));
  return { bucket: "overdue", daysOverdue, label: `${daysOverdue} দিন পেরিয়ে গেছে` };
}

/** Verbatim notification copy for one due lead (Bengali). */
export function followUpNotificationText(lead: { name: string; phone?: string | null; stage: string }, due: DueState): { title: string; body: string } {
  const phonePart = lead.phone ? `, ফোন: ${lead.phone}` : "";
  const when = due.bucket === "today"
    ? "আজ এই Lead-এর ফলোআপের নির্ধারিত তারিখ।"
    : `এই Lead-এর ফলোআপের তারিখ ${due.daysOverdue} দিন পেরিয়ে গেছে।`;
  return {
    title: `ফলোআপ বাকি: ${lead.name}`,
    body: `${when} নাম: ${lead.name}${phonePart}, Stage: ${lead.stage}। Leads পেজের “আজকের ফলোআপ” বোর্ড থেকে যোগাযোগ, পুনঃনির্ধারণ বা সম্পন্ন চিহ্নিত করুন।`,
  };
}
