/**
 * NF11 (FB4) — HR lite DTOs (plain interfaces, the booking.dto
 * pattern): every merchant-readable validation lives in
 * HrService so failures are Bengali 400s. Money crosses the API
 * as minor-unit strings (BigInt boundary, never floats).
 */

export interface UpdateHrSettingDto {
  unpaidLeaveRule?: string;
  commissionRule?: string;
}

export interface SetSalaryProfileDto {
  baseSalaryMinor?: string | number;
  effectiveFrom?: string; // YYYY-MM-DD (org-local)
  payoutNote?: string | null;
}

export interface CorrectAttendanceDto {
  membershipId?: string;
  date?: string; // YYYY-MM-DD (org-local)
  checkInAt?: string | null; // ISO instant
  checkOutAt?: string | null; // ISO instant
  correctionNote?: string;
}

export interface ShiftPatternDto {
  weekday?: number;
  startMinute?: number;
  endMinute?: number;
  active?: boolean;
}

export interface SetShiftPatternsDto {
  patterns?: ShiftPatternDto[];
}

export interface CreateLeaveDto {
  fromDate?: string; // YYYY-MM-DD
  toDate?: string; // YYYY-MM-DD
  paid?: string; // paid | unpaid
  reason?: string | null;
}

export interface DecideLeaveDto {
  decision?: string; // approved | rejected
}

export interface GeneratePayrollDto {
  year?: number;
  month?: number; // 1-12
}

export interface AdjustmentDto {
  label?: string;
  amountMinor?: string | number; // signed minor units
  note?: string;
}

export interface UpdatePayrollLineDto {
  adjustments?: AdjustmentDto[];
}
