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

// ---------- CX10: per-stage follow-up default intervals ----------

/**
 * CX10 — Per-stage follow-up defaults (org settings).
 *
 * Stored on CrmSetting.followUpDefaultsByStage as JSON keyed by
 * Lead stage, values in HOURS: { "new": 24, "contacted": 72 }.
 * Semantics (enforced in LeadsService.create / .update):
 *  - a lead CREATED without an explicit nextFollowUpAt, or whose
 *    STAGE CHANGES without an explicit nextFollowUpAt in the same
 *    update, is stamped now + the (new) stage's default hours —
 *    only when a default exists for that stage;
 *  - an explicit DTO date ALWAYS wins;
 *  - no default for the stage → nothing changes (create: null;
 *    stage change: the existing value is kept — including on the
 *    terminal stages won/lost, so a stage change never silently
 *    CLEARS a follow-up the user set);
 *  - no setting at all (every pre-CX10 org) → behaviour is
 *    exactly as before CX10.
 *
 * The stage vocabulary mirrors LEAD_STAGES in leads.service.ts
 * (kept as a local literal so this pure module stays cycle-free).
 */
export const FOLLOW_UP_STAGES = ["new", "contacted", "qualified", "proposal", "won", "lost"] as const;

/** Hours bounds for one stage default: 1 hour .. 1 year. */
export const FOLLOW_UP_MIN_HOURS = 1;
export const FOLLOW_UP_MAX_HOURS = 8760;

export type FollowUpDefaults = Partial<Record<(typeof FOLLOW_UP_STAGES)[number], number>>;

function isValidHours(v: unknown): v is number {
  return typeof v === "number" && Number.isInteger(v) && v >= FOLLOW_UP_MIN_HOURS && v <= FOLLOW_UP_MAX_HOURS;
}

/** The raw map inside whatever the caller hands us: a CrmSetting
 * row ({ followUpDefaultsByStage }), the JSON value itself, or
 * anything else (→ null). */
function rawDefaultsMap(setting: unknown): Record<string, unknown> | null {
  if (!setting || typeof setting !== "object" || Array.isArray(setting)) return null;
  const s = setting as Record<string, unknown>;
  const inner = "followUpDefaultsByStage" in s ? s.followUpDefaultsByStage : s;
  if (!inner || typeof inner !== "object" || Array.isArray(inner)) return null;
  return inner as Record<string, unknown>;
}

/**
 * Lenient READ-path normalizer: returns only the valid entries
 * (known stage + integer hours in range), or null when nothing
 * valid remains. Used for display and by followUpDefaultFor, so a
 * hand-corrupted stored value degrades to "no default" instead of
 * ever producing a nonsense date.
 */
export function normalizeFollowUpDefaults(raw: unknown): FollowUpDefaults | null {
  const map = rawDefaultsMap(raw);
  if (!map) return null;
  const out: FollowUpDefaults = {};
  for (const stage of FOLLOW_UP_STAGES) {
    const v = map[stage];
    if (isValidHours(v)) out[stage] = v;
  }
  return Object.keys(out).length ? out : null;
}

/**
 * Strict WRITE-path validator for the settings endpoint. Returns
 * the cleaned map (possibly empty = "no defaults"). A null VALUE
 * for a stage means "no default for this stage" and is dropped.
 * Throws a plain Error with a Bengali message on anything invalid;
 * the service wraps it in BadRequestException (400), matching the
 * CRM settings endpoints' honest-error style.
 */
export function validateFollowUpDefaults(raw: unknown): FollowUpDefaults {
  if (raw === null || raw === undefined) return {};
  if (typeof raw !== "object" || Array.isArray(raw)) {
    throw new Error("followUpDefaultsByStage একটি অবজেক্ট হতে হবে — যেমন { \"new\": 24 } (ঘণ্টায়)।");
  }
  const out: FollowUpDefaults = {};
  for (const [stage, v] of Object.entries(raw as Record<string, unknown>)) {
    if (!(FOLLOW_UP_STAGES as readonly string[]).includes(stage)) {
      throw new Error(`অজানা Lead Stage: "${stage}"। বৈধ Stage: ${FOLLOW_UP_STAGES.join(", ")}।`);
    }
    if (v === null) continue; // explicit "no default for this stage"
    if (!isValidHours(v)) {
      throw new Error(`Stage "${stage}"-এর ফলোআপ সময় পূর্ণসংখ্যা ঘণ্টায় ${FOLLOW_UP_MIN_HOURS}–${FOLLOW_UP_MAX_HOURS} এর মধ্যে হতে হবে (পেয়েছি: ${JSON.stringify(v)})।`);
    }
    out[stage as (typeof FOLLOW_UP_STAGES)[number]] = v;
  }
  return out;
}

/**
 * The default interval (hours) for `stage` from a CrmSetting row
 * (or the raw JSON map), or null when there is none. Pure.
 */
export function followUpDefaultFor(setting: unknown, stage: string): number | null {
  const map = normalizeFollowUpDefaults(setting);
  if (!map) return null;
  const v = (map as Record<string, unknown>)[stage];
  return isValidHours(v) ? v : null;
}

/** now + the stage default, or null when the stage has none. */
export function followUpDateFor(setting: unknown, stage: string, now: Date): Date | null {
  const hours = followUpDefaultFor(setting, stage);
  return hours === null ? null : new Date(now.getTime() + hours * 3600 * 1000);
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
