/**
 * NF11 (FB4) — HR lite web helpers + payload types. Money is
 * minor-unit STRINGS from the API — display via formatMinor,
 * never floats. The record note below must stay byte-identical
 * to the API's PAYROLL_RECORD_NOTE (apps/api/src/hr/hr.service.ts)
 * — pinned by the vitest suite.
 */

export const PAYROLL_RECORD_NOTE = "এই রানটি পরিশোধের একটি রেকর্ড মাত্র — এর মাধ্যমে সরাসরি কোনো অর্থ স্থানান্তর হয় না। (This is a record of payment only — no money is transferred by it.)";

export const WEEKDAYS = ["রবিবার", "সোমবার", "মঙ্গলবার", "বুধবার", "বৃহস্পতিবার", "শুক্রবার", "শনিবার"] as const;

export function weekdayLabel(v: number | null | undefined): string {
  if (v == null || v < 0 || v > 6) return "—";
  return WEEKDAYS[v];
}

/** Minutes-from-midnight → "HH:MM" (org-local wall time). */
export function minutesLabel(min: number | null | undefined): string {
  if (min == null || !Number.isFinite(min)) return "—";
  const h = Math.floor(min / 60);
  const m = min % 60;
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
}

/** "HH:MM" → minutes-from-midnight, or null when invalid. */
export function parseTimeToMinutes(v: string): number | null {
  const m = /^(\d{1,2}):(\d{2})$/.exec(String(v ?? "").trim());
  if (!m) return null;
  const h = Number(m[1]);
  const min = Number(m[2]);
  if (h > 24 || min > 59 || (h === 24 && min !== 0)) return null;
  return h * 60 + min;
}

export function leaveStatusLabel(v: string | null | undefined): string {
  switch (v) {
    case "pending": return "অপেক্ষমাণ";
    case "approved": return "অনুমোদিত";
    case "rejected": return "প্রত্যাখ্যাত";
    default: return v ?? "—";
  }
}

export function leavePaidLabel(v: string | null | undefined): string {
  switch (v) {
    case "paid": return "বেতনসহ ছুটি";
    case "unpaid": return "বেতনবিহীন ছুটি";
    default: return v ?? "—";
  }
}

export function runStatusLabel(v: string | null | undefined): string {
  switch (v) {
    case "draft": return "খসড়া (Draft)";
    case "paid": return "পরিশোধের রেকর্ড (Paid)";
    default: return v ?? "—";
  }
}

export function attendanceSourceLabel(v: string | null | undefined): string {
  switch (v) {
    case "self": return "নিজে চেক-ইন";
    case "staff_correction": return "সংশোধন (Correction)";
    default: return v ?? "—";
  }
}

export interface HrMember {
  membershipId: string; userId: string; name: string | null; email: string | null;
  role: string; status: string;
}

export interface SalaryProfile {
  id: string; membershipId: string; baseSalaryMinor: string;
  effectiveFrom: string; payoutNote: string | null;
}

export interface StaffRow extends HrMember {
  salaryProfile: SalaryProfile | null;
}

export interface HrSettingView {
  unpaidLeaveRule: string; commissionRule: string;
  unpaidLeaveRuleText: string; commissionRuleText: string;
}

export interface AttendanceRecordView {
  id: string; membershipId: string; date: string;
  checkInAt: string | null; checkOutAt: string | null;
  source: string; correctionNote: string | null;
  member?: HrMember | null;
}

export interface ShiftPatternView {
  id: string; membershipId: string; weekday: number;
  startMinute: number; endMinute: number; active: boolean;
}

export interface LeaveRequestView {
  id: string; membershipId: string; fromDate: string; toDate: string;
  days: number; paid: string; reason: string | null; status: string;
  decidedBy: string | null; decidedAt: string | null; createdAt: string | null;
  member?: HrMember | null;
}

export interface PayrollAdjustment {
  label: string; amountMinor: string; note: string;
}

export interface PayrollLineView {
  id: string; runId: string; membershipId: string;
  baseMinor: string; unpaidLeaveDays: number; deductionMinor: string;
  commissionMinor: string; adjustments: PayrollAdjustment[]; totalMinor: string;
  member?: HrMember | null;
}

export interface PayrollRunView {
  id: string; year: number; month: number; status: string;
  ruleSnapshot: Record<string, unknown> | null;
  totalMinor: string; createdBy: string | null;
  paidBy: string | null; paidAt: string | null; journalEntryId: string | null;
  recordNote: string; createdAt: string | null;
  lines?: PayrollLineView[];
}
