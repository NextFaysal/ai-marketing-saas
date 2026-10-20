import { Injectable, Optional } from "@nestjs/common";
import { PrismaService } from "../prisma/prisma.service";
import { AuditService } from "../audit/audit.service";
import { AccountingService, toBig } from "../accounting/accounting.service";
import { PdfCanvas, buildPdf, moneyText } from "../courier/pdf";
import { localParts, isValidYmd } from "../booking/slots";
import type {
  CorrectAttendanceDto, CreateLeaveDto, GeneratePayrollDto, SetSalaryProfileDto,
  SetShiftPatternsDto, UpdateHrSettingDto, UpdatePayrollLineDto,
} from "./hr.dto";
import { badRequest, forbidden, notFound } from "../i18n/api-exception";

/**
 * NF11 (FB4) — HR lite: salary profiles, attendance, shift
 * roster, leave and payroll for the org's EXISTING team.
 *
 * STAFF MODEL — AUDIT FINDING: staff ARE Membership rows
 * (Membership → User); NF4 added ServiceStaff only as a
 * bookable-resource view of a membership. HR therefore hangs
 * every row off Membership — NO parallel people table.
 *
 * COMMISSION — AUDIT FINDING (verbatim, see acceptance doc):
 * the Order model DOES carry a real staff-attribution source —
 * Order.agentId (Feature 5 "Team Performance & Staff
 * Attribution": the User id of the staff member who handled /
 * placed / confirmed the order, set by OrdersService.assignAgent
 * / bulkAssignAgent) AND Order.commissionMinor (the commission
 * amount RECORDED on that order at assignment time, BigInt,
 * default 0). There is NO org-level percentage / per-delivery
 * commission CONFIG stored anywhere; the staff scoreboard's
 * ৳50-per-delivery figure is a read-time query-param fallback
 * (defaultCommissionBdt) that is NEVER stored and is therefore
 * NEVER used here. Payroll commission = Σ recorded
 * Order.commissionMinor over SOLD orders (status completed |
 * delivered — the canonical NF7/EC33 sold half) attributed to
 * the member (agentId = membership.userId) whose order date
 * (placedAt ?? createdAt, org timezone) falls in the run month.
 * An attributed order with commissionMinor = 0 contributes 0 —
 * no amount is ever invented. This rule is stored on HrSetting
 * (commissionRule = "recorded_order_commission") and snapshotted
 * verbatim into every PayrollRun.ruleSnapshot.
 *
 * PAYROLL RULES ARE STORED, NOT IMPLIED: HrSetting holds
 * unpaidLeaveRule = "per_calendar_day" (deduction =
 * round-half-up(base × approved-unpaid-leave-days-overlapping-
 * the-month ÷ days-in-month); ONLY approved + unpaid leave
 * counts — pending / rejected / paid leave deducts NOTHING)
 * and the commission rule above. A run snapshots the rules,
 * the month inputs and per-member inputs; the snapshot is
 * shown verbatim on the run.
 *
 * MARK-PAID IS A RECORD, NOT A MONEY MOVEMENT: it stamps
 * paidBy/paidAt (OWNER only) and moves no money anywhere. On
 * mark-paid it posts ONE NF10 journal entry through
 * AccountingService.createJournalEntry (the only journal write
 * door): Dr Expense: Salary (systemKey "expense_salary",
 * code 5210 — already in NF10's DEFAULT_ACCOUNTS, no seeding
 * extension needed) / Cr Cash (systemKey "cash"), total =
 * run total, sourceType = "payroll_run", sourceId = run id
 * (the NF10 unique makes it idempotent). A zero-total run
 * posts nothing. Journal failure is isolated (the Finance
 * hook's pattern): the paid RECORD stands and the result
 * reports journalPosted = false + the error.
 *
 * DATES: attendance / leave / payroll months all run on the
 * ORGANIZATION's timezone (Organization.timezone, default
 * Asia/Dhaka — the codebase has a real per-org timezone, so
 * no fallback was needed), via NF4's Intl-based localParts.
 */

export const UNPAID_LEAVE_RULES = ["per_calendar_day"] as const;
export const COMMISSION_RULES = ["recorded_order_commission"] as const;
export const PAYROLL_RECORD_NOTE = "এই রানটি পরিশোধের একটি রেকর্ড মাত্র — এর মাধ্যমে সরাসরি কোনো অর্থ স্থানান্তর হয় না। (This is a record of payment only — no money is transferred by it.)";
const SOLD_STATUSES = ["completed", "delivered"];

/** per_calendar_day pro-rata, round-half-up, BigInt-exact. */
export function proRataDeduction(baseMinor: bigint, unpaidDays: number, daysInMonth: number): bigint {
  if (baseMinor <= 0n || unpaidDays <= 0 || daysInMonth <= 0) return 0n;
  const capped = Math.min(unpaidDays, daysInMonth);
  const num = baseMinor * BigInt(capped);
  return (num * 2n + BigInt(daysInMonth)) / (BigInt(daysInMonth) * 2n);
}

export function daysInMonthOf(year: number, month: number): number {
  return new Date(Date.UTC(year, month, 0)).getUTCDate();
}

function ymdOf(year: number, month: number, day: number): string {
  return `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

/** Inclusive calendar days of [fromYmd, toYmd] ∩ [startYmd, endYmd]. */
export function overlapDays(fromYmd: string, toYmd: string, startYmd: string, endYmd: string): number {
  const lo = fromYmd > startYmd ? fromYmd : startYmd;
  const hi = toYmd < endYmd ? toYmd : endYmd;
  if (lo > hi) return 0;
  const ms = new Date(`${hi}T12:00:00Z`).getTime() - new Date(`${lo}T12:00:00Z`).getTime();
  return Math.round(ms / 86_400_000) + 1;
}

export interface Adjustment { label: string; amountMinor: bigint; note: string }

export function parseAdjustments(raw: unknown): Adjustment[] {
  if (!Array.isArray(raw)) return [];
  const out: Adjustment[] = [];
  for (const a of raw) {
    if (!a || typeof a !== "object") continue;
    out.push({
      label: String((a as any).label ?? ""),
      amountMinor: toBig((a as any).amountMinor),
      note: String((a as any).note ?? ""),
    });
  }
  return out;
}

/** THE line-total formula — the single computation source for
 * the run line, the run total and the payslip. */
export function lineTotal(base: bigint, deduction: bigint, commission: bigint, adjustments: Adjustment[]): bigint {
  return base - deduction + commission + adjustments.reduce((s, a) => s + a.amountMinor, 0n);
}

@Injectable()
export class HrService {
  constructor(
    private readonly prisma: PrismaService,
    @Optional() private readonly audit?: AuditService,
    @Optional() private readonly accounting?: AccountingService,
  ) {}

  private t(name: string): any {
    return (this.prisma as any)[name];
  }

  private async safeAudit(input: any): Promise<void> {
    try { await this.audit?.log(input); } catch { /* audit never breaks the write */ }
  }

  private async orgTz(orgId: string): Promise<string> {
    const org = await this.t("organization").findFirst({ where: { id: orgId } }).catch(() => null);
    return org?.timezone ? String(org.timezone) : "Asia/Dhaka";
  }

  private async membershipOf(orgId: string, userId: string): Promise<any> {
    const m = await this.t("membership").findFirst({
      where: { organizationId: orgId, userId },
      include: { user: true },
    });
    if (!m) throw forbidden("hr.youAreNotAMemberOf");
    return m;
  }

  private async membershipById(orgId: string, membershipId: string): Promise<any> {
    const m = await this.t("membership").findFirst({
      where: { id: membershipId, organizationId: orgId },
      include: { user: true },
    });
    if (!m) throw notFound("hr.theMemberWasNotFound");
    return m;
  }

  private memberView(m: any) {
    return {
      membershipId: String(m.id), userId: String(m.userId),
      name: m.user?.name ?? null, email: m.user?.email ?? null,
      role: String(m.role), status: String(m.status),
    };
  }

  // ---------------- setting ----------------

  async ensureSetting(orgId: string): Promise<any> {
    const existing = await this.t("hrSetting").findFirst({ where: { organizationId: orgId } });
    if (existing) return existing;
    try {
      return await this.t("hrSetting").create({
        data: { organizationId: orgId, unpaidLeaveRule: "per_calendar_day", commissionRule: "recorded_order_commission" },
      });
    } catch {
      return this.t("hrSetting").findFirst({ where: { organizationId: orgId } });
    }
  }

  async getSetting(orgId: string) {
    const s = await this.ensureSetting(orgId);
    return {
      unpaidLeaveRule: String(s.unpaidLeaveRule), commissionRule: String(s.commissionRule),
      unpaidLeaveRuleText: "per_calendar_day: কর্তন = মূল বেতন × (মাসে অনুমোদিত বেতনবিহীন ছুটির দিন) ÷ (মাসের মোট দিন), নিকটতম পয়সায় রাউন্ড। শুধু অনুমোদিত + বেতনবিহীন ছুটিই গণনা হয়।",
      commissionRuleText: "recorded_order_commission: কমিশন = ওই মাসের বিক্রিত (completed|delivered) অর্ডারগুলোর রেকর্ডকৃত Order.commissionMinor-এর যোগফল, যেখানে Order.agentId = সদস্যের userId। রেকর্ড না থাকলে কমিশন ০ — কোনো হার বা ডিফল্ট পরিমাণ কখনো প্রয়োগ হয় না।",
    };
  }

  async updateSetting(orgId: string, actorId: string, dto: UpdateHrSettingDto) {
    const unpaid = dto?.unpaidLeaveRule !== undefined ? String(dto.unpaidLeaveRule) : undefined;
    const commission = dto?.commissionRule !== undefined ? String(dto.commissionRule) : undefined;
    if (unpaid !== undefined && !(UNPAID_LEAVE_RULES as readonly string[]).includes(unpaid)) {
      throw badRequest("hr.unpaidleaveruleCanOnlyBeOneOf", { p1: UNPAID_LEAVE_RULES.join(", ") });
    }
    if (commission !== undefined && !(COMMISSION_RULES as readonly string[]).includes(commission)) {
      throw badRequest("hr.commissionruleCanOnlyBeOneOf", { p1: COMMISSION_RULES.join(", ") });
    }
    if (unpaid === undefined && commission === undefined) throw badRequest("hr.sendAtLeastOneRule");
    const s = await this.ensureSetting(orgId);
    const data: Record<string, any> = {};
    if (unpaid !== undefined) data.unpaidLeaveRule = unpaid;
    if (commission !== undefined) data.commissionRule = commission;
    await this.t("hrSetting").update({ where: { id: s.id }, data });
    await this.safeAudit({ organizationId: orgId, userId: actorId, action: "hr.setting_updated", entityType: "HrSetting", entityId: String(s.id), metadata: data });
    return this.getSetting(orgId);
  }

  // ---------------- staff + salary profiles ----------------

  private profileView(p: any, tz: string) {
    if (!p) return null;
    return {
      id: String(p.id), membershipId: String(p.membershipId),
      baseSalaryMinor: toBig(p.baseSalaryMinor).toString(),
      effectiveFrom: localParts(tz, new Date(p.effectiveFrom)).ymd,
      payoutNote: p.payoutNote ?? null,
    };
  }

  async listStaff(orgId: string) {
    const tz = await this.orgTz(orgId);
    const [members, profiles] = await Promise.all([
      this.t("membership").findMany({ where: { organizationId: orgId }, include: { user: true } }),
      this.t("staffSalaryProfile").findMany({ where: { organizationId: orgId } }),
    ]);
    const byMember = new Map((profiles ?? []).map((p: any) => [String(p.membershipId), p]));
    const items = (members ?? []).map((m: any) => ({
      ...this.memberView(m),
      salaryProfile: this.profileView(byMember.get(String(m.id)), tz),
    }));
    items.sort((a: any, b: any) => String(a.name ?? "").localeCompare(String(b.name ?? "")));
    return { items, setting: await this.getSetting(orgId) };
  }

  async setSalaryProfile(orgId: string, actorId: string, membershipId: string, dto: SetSalaryProfileDto) {
    const member = await this.membershipById(orgId, membershipId);
    const base = toBig(dto?.baseSalaryMinor as any);
    if (base <= 0n) throw badRequest("hr.giveTheBaseSalaryAsA");
    if (!isValidYmd(dto?.effectiveFrom)) throw badRequest("hr.giveEffectivefromInYyyyMmDd");
    const payoutNote = dto?.payoutNote === undefined ? undefined : (dto.payoutNote === null ? null : String(dto.payoutNote).slice(0, 300));
    const existing = await this.t("staffSalaryProfile").findFirst({ where: { membershipId: member.id } });
    const data: Record<string, any> = {
      baseSalaryMinor: base,
      effectiveFrom: new Date(`${dto.effectiveFrom}T12:00:00+06:00`),
    };
    if (payoutNote !== undefined) data.payoutNote = payoutNote;
    let row: any;
    if (existing) {
      row = await this.t("staffSalaryProfile").update({ where: { id: existing.id }, data });
    } else {
      row = await this.t("staffSalaryProfile").create({
        data: { organizationId: orgId, membershipId: String(member.id), ...data, payoutNote: payoutNote ?? null },
      });
    }
    await this.safeAudit({ organizationId: orgId, userId: actorId, action: "hr.salary_profile_set", entityType: "StaffSalaryProfile", entityId: String(row.id), metadata: { membershipId: String(member.id), baseSalaryMinor: base.toString(), effectiveFrom: dto.effectiveFrom } });
    const tz = await this.orgTz(orgId);
    return { profile: this.profileView(row, tz), member: this.memberView(member) };
  }

  async mySalaryProfile(orgId: string, userId: string) {
    const member = await this.membershipOf(orgId, userId);
    const tz = await this.orgTz(orgId);
    const profile = await this.t("staffSalaryProfile").findFirst({ where: { membershipId: member.id } });
    return { member: this.memberView(member), profile: this.profileView(profile, tz), setting: await this.getSetting(orgId) };
  }

  // ---------------- attendance ----------------

  private attendanceView(r: any) {
    return {
      id: String(r.id), membershipId: String(r.membershipId), date: String(r.date),
      checkInAt: r.checkInAt ?? null, checkOutAt: r.checkOutAt ?? null,
      source: String(r.source), correctionNote: r.correctionNote ?? null,
    };
  }

  async checkIn(orgId: string, userId: string) {
    const member = await this.membershipOf(orgId, userId);
    if (member.status !== "ACTIVE") throw forbidden("hr.onlyActiveMembersCanGiveAttendance");
    const tz = await this.orgTz(orgId);
    const today = localParts(tz, new Date()).ymd;
    const existing = await this.t("attendanceRecord").findFirst({
      where: { organizationId: orgId, membershipId: member.id, date: today },
    });
    if (existing?.checkInAt) throw badRequest("hr.alreadyCheckedInToday");
    const now = new Date();
    const row = existing
      ? await this.t("attendanceRecord").update({ where: { id: existing.id }, data: { checkInAt: now } })
      : await this.t("attendanceRecord").create({
          data: { organizationId: orgId, membershipId: String(member.id), date: today, checkInAt: now, source: "self" },
        });
    return { record: this.attendanceView(row) };
  }

  async checkOut(orgId: string, userId: string) {
    const member = await this.membershipOf(orgId, userId);
    const tz = await this.orgTz(orgId);
    const today = localParts(tz, new Date()).ymd;
    const existing = await this.t("attendanceRecord").findFirst({
      where: { organizationId: orgId, membershipId: member.id, date: today },
    });
    if (!existing?.checkInAt) throw badRequest("hr.notCheckedInYetToday");
    if (existing.checkOutAt) throw badRequest("hr.alreadyCheckedOutToday");
    const row = await this.t("attendanceRecord").update({
      where: { id: existing.id }, data: { checkOutAt: new Date() },
    });
    return { record: this.attendanceView(row) };
  }

  async myAttendance(orgId: string, userId: string, month?: string) {
    const member = await this.membershipOf(orgId, userId);
    const where: any = { organizationId: orgId, membershipId: member.id };
    if (month) {
      if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(month)) throw badRequest("hr.giveTheMonthInYyyyMm");
      where.date = { gte: `${month}-01`, lt: `${month}-99` };
    }
    const rows = await this.t("attendanceRecord").findMany({ where, orderBy: { date: "desc" } });
    return { items: (rows ?? []).map((r: any) => this.attendanceView(r)) };
  }

  async listAttendance(orgId: string, date?: string) {
    const tz = await this.orgTz(orgId);
    const day = date ?? localParts(tz, new Date()).ymd;
    if (!isValidYmd(day)) throw badRequest("hr.giveTheDateInYyyyMm");
    const [rows, members] = await Promise.all([
      this.t("attendanceRecord").findMany({ where: { organizationId: orgId, date: day } }),
      this.t("membership").findMany({ where: { organizationId: orgId }, include: { user: true } }),
    ]);
    const byId = new Map((members ?? []).map((m: any) => [String(m.id), this.memberView(m)]));
    return {
      date: day,
      items: (rows ?? []).map((r: any) => ({ ...this.attendanceView(r), member: byId.get(String(r.membershipId)) ?? null })),
    };
  }

  /** Admin correction — ALWAYS audit-logged (direct AuditService
   * call, not the swallow-wrapper) + correctionNote stored. */
  async correctAttendance(orgId: string, actorId: string, dto: CorrectAttendanceDto) {
    const note = String(dto?.correctionNote ?? "").trim();
    if (!note) throw badRequest("hr.aCorrectionReasonCorrectionnoteIsRequired");
    if (!dto?.membershipId) throw badRequest("hr.membershipidIsRequired");
    if (!isValidYmd(dto?.date)) throw badRequest("hr.giveTheDateInYyyyMm");
    const member = await this.membershipById(orgId, String(dto.membershipId));
    const parseTime = (v: string | null | undefined, label: string): Date | null => {
      if (v === undefined || v === null || v === "") return null;
      const d = new Date(v);
      if (Number.isNaN(d.getTime())) throw badRequest("hr.isNotAValidTime", { label: label });
      return d;
    };
    const checkInAt = parseTime(dto.checkInAt, "checkInAt");
    const checkOutAt = parseTime(dto.checkOutAt, "checkOutAt");
    if (checkInAt && checkOutAt && checkOutAt < checkInAt) throw badRequest("hr.checkOutCannotBeBeforeCheck");
    const existing = await this.t("attendanceRecord").findFirst({
      where: { organizationId: orgId, membershipId: member.id, date: dto.date },
    });
    const data = { checkInAt, checkOutAt, source: "staff_correction", correctionNote: note.slice(0, 500) };
    const row = existing
      ? await this.t("attendanceRecord").update({ where: { id: existing.id }, data })
      : await this.t("attendanceRecord").create({ data: { organizationId: orgId, membershipId: String(member.id), date: dto.date, ...data } });
    await this.audit?.log({
      organizationId: orgId, userId: actorId, action: "hr.attendance_corrected",
      entityType: "AttendanceRecord", entityId: String(row.id),
      metadata: { membershipId: String(member.id), date: dto.date, correctionNote: note.slice(0, 500), checkInAt: checkInAt?.toISOString() ?? null, checkOutAt: checkOutAt?.toISOString() ?? null },
    });
    return { record: this.attendanceView(row), member: this.memberView(member) };
  }

  // ---------------- shift roster ----------------

  private shiftView(r: any) {
    return {
      id: String(r.id), membershipId: String(r.membershipId), weekday: Number(r.weekday),
      startMinute: Number(r.startMinute), endMinute: Number(r.endMinute), active: Boolean(r.active),
    };
  }

  async listShiftPatterns(orgId: string, membershipId: string) {
    await this.membershipById(orgId, membershipId);
    const rows = await this.t("staffShiftPattern").findMany({
      where: { organizationId: orgId, membershipId },
      orderBy: [{ weekday: "asc" }, { startMinute: "asc" }],
    });
    return { items: (rows ?? []).map((r: any) => this.shiftView(r)) };
  }

  async myShiftPatterns(orgId: string, userId: string) {
    const member = await this.membershipOf(orgId, userId);
    return this.listShiftPatterns(orgId, String(member.id));
  }

  /** Replace-all weekly pattern for a member — NF4 availability
   * shape/validation (weekday 0–6, minutes from midnight,
   * end > start). */
  async setShiftPatterns(orgId: string, actorId: string, membershipId: string, dto: SetShiftPatternsDto) {
    const member = await this.membershipById(orgId, membershipId);
    const patterns = dto?.patterns ?? [];
    if (!Array.isArray(patterns) || patterns.length > 21) throw badRequest("hr.thereCanBeAtMost21");
    for (const p of patterns) {
      const wd = Number(p?.weekday), s = Number(p?.startMinute), e = Number(p?.endMinute);
      if (!Number.isInteger(wd) || wd < 0 || wd > 6) throw badRequest("hr.weekdayMustBeBetween0And");
      if (!Number.isInteger(s) || !Number.isInteger(e) || s < 0 || e > 1440 || e <= s) {
        throw badRequest("hr.theShiftTimeIsNotValid");
      }
    }
    await this.t("staffShiftPattern").deleteMany({ where: { organizationId: orgId, membershipId: member.id } });
    const created: any[] = [];
    for (const p of patterns) {
      created.push(await this.t("staffShiftPattern").create({
        data: {
          organizationId: orgId, membershipId: String(member.id),
          weekday: Number(p.weekday), startMinute: Number(p.startMinute), endMinute: Number(p.endMinute),
          active: p.active !== false,
        },
      }));
    }
    await this.safeAudit({ organizationId: orgId, userId: actorId, action: "hr.shift_patterns_set", entityType: "Membership", entityId: String(member.id), metadata: { count: created.length } });
    return { items: created.map((r) => this.shiftView(r)) };
  }

  // ---------------- leave ----------------

  private leaveView(r: any, member?: any) {
    return {
      id: String(r.id), membershipId: String(r.membershipId),
      fromDate: String(r.fromDate), toDate: String(r.toDate), days: Number(r.days),
      paid: String(r.paid), reason: r.reason ?? null, status: String(r.status),
      decidedBy: r.decidedBy ?? null, decidedAt: r.decidedAt ?? null,
      createdAt: r.createdAt ?? null,
      ...(member ? { member } : {}),
    };
  }

  async createLeave(orgId: string, userId: string, dto: CreateLeaveDto) {
    const member = await this.membershipOf(orgId, userId);
    if (!isValidYmd(dto?.fromDate) || !isValidYmd(dto?.toDate)) throw badRequest("hr.giveTheLeaveDatesInYyyy");
    if (String(dto.toDate) < String(dto.fromDate)) throw badRequest("hr.theEndDateCannotBeBefore");
    const days = overlapDays(String(dto.fromDate), String(dto.toDate), String(dto.fromDate), String(dto.toDate));
    if (days < 1 || days > 366) throw badRequest("hr.theLeaveDurationMustBeBetween");
    const paid = String(dto?.paid ?? "");
    if (paid !== "paid" && paid !== "unpaid") throw badRequest("hr.theLeaveTypeMustBePaid");
    const row = await this.t("leaveRequest").create({
      data: {
        organizationId: orgId, membershipId: String(member.id),
        fromDate: dto.fromDate, toDate: dto.toDate, days, paid,
        reason: dto?.reason ? String(dto.reason).slice(0, 500) : null, status: "pending",
      },
    });
    return { leave: this.leaveView(row) };
  }

  async myLeave(orgId: string, userId: string) {
    const member = await this.membershipOf(orgId, userId);
    const rows = await this.t("leaveRequest").findMany({
      where: { organizationId: orgId, membershipId: member.id }, orderBy: { createdAt: "desc" },
    });
    return { items: (rows ?? []).map((r: any) => this.leaveView(r)) };
  }

  async listLeave(orgId: string, status?: string) {
    const where: any = { organizationId: orgId };
    if (status) where.status = status;
    const [rows, members] = await Promise.all([
      this.t("leaveRequest").findMany({ where, orderBy: { createdAt: "desc" } }),
      this.t("membership").findMany({ where: { organizationId: orgId }, include: { user: true } }),
    ]);
    const byId = new Map((members ?? []).map((m: any) => [String(m.id), this.memberView(m)]));
    return { items: (rows ?? []).map((r: any) => this.leaveView(r, byId.get(String(r.membershipId)) ?? null)) };
  }

  /** State machine: pending → approved | rejected ONLY. A
   * decided request can never be re-decided. */
  async decideLeave(orgId: string, actorId: string, leaveId: string, decision: string) {
    if (decision !== "approved" && decision !== "rejected") throw badRequest("hr.theDecisionMustBeApprovedOr");
    const row = await this.t("leaveRequest").findFirst({ where: { id: leaveId, organizationId: orgId } });
    if (!row) throw notFound("hr.theLeaveApplicationWasNotFound");
    if (row.status !== "pending") throw badRequest("hr.aDecisionHasAlreadyBeenTaken");
    const updated = await this.t("leaveRequest").update({
      where: { id: row.id },
      data: { status: decision, decidedBy: actorId, decidedAt: new Date() },
    });
    await this.safeAudit({ organizationId: orgId, userId: actorId, action: `hr.leave_${decision}`, entityType: "LeaveRequest", entityId: String(row.id), metadata: { membershipId: String(row.membershipId), days: Number(row.days), paid: String(row.paid) } });
    return { leave: this.leaveView(updated) };
  }

  // ---------------- payroll ----------------

  private lineView(l: any, member?: any) {
    const adjustments = parseAdjustments(l.adjustments);
    return {
      id: String(l.id), runId: String(l.runId), membershipId: String(l.membershipId),
      baseMinor: toBig(l.baseMinor).toString(),
      unpaidLeaveDays: Number(l.unpaidLeaveDays),
      deductionMinor: toBig(l.deductionMinor).toString(),
      commissionMinor: toBig(l.commissionMinor).toString(),
      adjustments: adjustments.map((a) => ({ label: a.label, amountMinor: a.amountMinor.toString(), note: a.note })),
      totalMinor: toBig(l.totalMinor).toString(),
      ...(member ? { member } : {}),
    };
  }

  private runView(r: any, lines?: any[]) {
    return {
      id: String(r.id), year: Number(r.year), month: Number(r.month), status: String(r.status),
      ruleSnapshot: r.ruleSnapshot ?? null,
      totalMinor: toBig(r.totalMinor).toString(),
      createdBy: r.createdBy ?? null, paidBy: r.paidBy ?? null, paidAt: r.paidAt ?? null,
      journalEntryId: r.journalEntryId ?? null,
      recordNote: PAYROLL_RECORD_NOTE,
      createdAt: r.createdAt ?? null,
      ...(lines ? { lines } : {}),
    };
  }

  async generateRun(orgId: string, actorId: string, dto: GeneratePayrollDto) {
    const year = Number(dto?.year), month = Number(dto?.month);
    if (!Number.isInteger(year) || year < 2020 || year > 2100) throw badRequest("hr.theYearIsNotValid");
    if (!Number.isInteger(month) || month < 1 || month > 12) throw badRequest("hr.theMonthMustBeBetween1");
    const setting = await this.ensureSetting(orgId);
    if (String(setting.unpaidLeaveRule) !== "per_calendar_day") throw badRequest("hr.unknownUnpaidleaveruleTheRunCannotBe");
    if (String(setting.commissionRule) !== "recorded_order_commission") throw badRequest("hr.unknownCommissionruleTheRunCannotBe");
    const tz = await this.orgTz(orgId);
    const dim = daysInMonthOf(year, month);
    const monthStart = ymdOf(year, month, 1);
    const monthEnd = ymdOf(year, month, dim);

    const existing = await this.t("payrollRun").findFirst({ where: { organizationId: orgId, year, month } });
    if (existing && existing.status === "paid") {
      throw badRequest("hr.thisMonthSPayrollRunIs");
    }

    const [members, profiles, leaves, orders] = await Promise.all([
      this.t("membership").findMany({ where: { organizationId: orgId, status: "ACTIVE" }, include: { user: true } }),
      this.t("staffSalaryProfile").findMany({ where: { organizationId: orgId } }),
      this.t("leaveRequest").findMany({ where: { organizationId: orgId, status: "approved", paid: "unpaid" } }),
      this.t("order").findMany({ where: { organizationId: orgId, status: { in: SOLD_STATUSES } } }),
    ]);
    const profileByMember = new Map<string, any>((profiles ?? []).map((p: any) => [String(p.membershipId), p]));

    const inputs: any[] = [];
    const computed: { member: any; base: bigint; unpaidDays: number; deduction: bigint; commission: bigint }[] = [];
    for (const m of members ?? []) {
      const profile = profileByMember.get(String(m.id));
      if (!profile) continue;
      const effectiveYmd = localParts(tz, new Date(profile.effectiveFrom)).ymd;
      if (effectiveYmd > monthEnd) continue;
      const base = toBig(profile.baseSalaryMinor);
      let unpaidDays = 0;
      const leaveIds: string[] = [];
      for (const l of leaves ?? []) {
        if (String(l.membershipId) !== String(m.id)) continue;
        const d = overlapDays(String(l.fromDate), String(l.toDate), monthStart, monthEnd);
        if (d > 0) { unpaidDays += d; leaveIds.push(String(l.id)); }
      }
      const deduction = proRataDeduction(base, unpaidDays, dim);
      let commission = 0n;
      let attributedOrders = 0;
      for (const o of orders ?? []) {
        if (!o.agentId || String(o.agentId) !== String(m.userId)) continue;
        const when = o.placedAt ?? o.createdAt;
        if (!when) continue;
        const ymd = localParts(tz, new Date(when)).ymd;
        if (ymd < monthStart || ymd > monthEnd) continue;
        attributedOrders += 1;
        commission += toBig(o.commissionMinor);
      }
      computed.push({ member: m, base, unpaidDays, deduction, commission });
      inputs.push({
        membershipId: String(m.id), userId: String(m.userId), name: m.user?.name ?? null,
        baseSalaryMinor: base.toString(), effectiveFrom: effectiveYmd,
        unpaidLeaveDays: unpaidDays, unpaidLeaveRequestIds: leaveIds,
        attributedSoldOrders: attributedOrders, recordedCommissionMinor: commission.toString(),
      });
    }

    const ruleSnapshot = {
      unpaidLeaveRule: String(setting.unpaidLeaveRule),
      commissionRule: String(setting.commissionRule),
      daysInMonth: dim, monthStart, monthEnd, timezone: tz,
      soldStatuses: [...SOLD_STATUSES],
      commissionSource: "Order.agentId (= Membership.userId) + recorded Order.commissionMinor; no rate or default is applied",
      generatedAt: new Date().toISOString(),
      inputs,
    };

    let run: any;
    if (existing) {
      run = await this.t("payrollRun").update({
        where: { id: existing.id },
        data: { ruleSnapshot, createdBy: actorId },
      });
      await this.t("payrollLine").deleteMany({ where: { runId: run.id } });
    } else {
      run = await this.t("payrollRun").create({
        data: { organizationId: orgId, year, month, status: "draft", ruleSnapshot, createdBy: actorId, totalMinor: 0n },
      });
    }
    let total = 0n;
    const lineViews: any[] = [];
    for (const c of computed) {
      const lineTotalValue = lineTotal(c.base, c.deduction, c.commission, []);
      total += lineTotalValue;
      const line = await this.t("payrollLine").create({
        data: {
          runId: String(run.id), organizationId: orgId, membershipId: String(c.member.id),
          baseMinor: c.base, unpaidLeaveDays: c.unpaidDays, deductionMinor: c.deduction,
          commissionMinor: c.commission, adjustments: [], totalMinor: lineTotalValue,
        },
      });
      lineViews.push(this.lineView(line, this.memberView(c.member)));
    }
    run = await this.t("payrollRun").update({ where: { id: run.id }, data: { totalMinor: total } });
    await this.safeAudit({ organizationId: orgId, userId: actorId, action: existing ? "hr.payroll_run_regenerated" : "hr.payroll_run_generated", entityType: "PayrollRun", entityId: String(run.id), metadata: { year, month, lines: lineViews.length, totalMinor: total.toString() } });
    return { run: this.runView(run, lineViews) };
  }

  async listRuns(orgId: string) {
    const rows = await this.t("payrollRun").findMany({ where: { organizationId: orgId }, orderBy: [{ year: "desc" }, { month: "desc" }] });
    return { items: (rows ?? []).map((r: any) => this.runView(r)) };
  }

  async getRun(orgId: string, runId: string) {
    const run = await this.t("payrollRun").findFirst({ where: { id: runId, organizationId: orgId } });
    if (!run) throw notFound("hr.thePayrollRunWasNotFound");
    const [lines, members] = await Promise.all([
      this.t("payrollLine").findMany({ where: { runId: run.id } }),
      this.t("membership").findMany({ where: { organizationId: orgId }, include: { user: true } }),
    ]);
    const byId = new Map((members ?? []).map((m: any) => [String(m.id), this.memberView(m)]));
    const views = (lines ?? []).map((l: any) => this.lineView(l, byId.get(String(l.membershipId)) ?? null));
    return { run: this.runView(run, views) };
  }

  /** Draft-only line edit: adjustments are explicit manual
   * lines — প্রতিটিতে label + note আবশ্যক। Audit-logged. */
  async updateLineAdjustments(orgId: string, actorId: string, runId: string, lineId: string, dto: UpdatePayrollLineDto) {
    const run = await this.t("payrollRun").findFirst({ where: { id: runId, organizationId: orgId } });
    if (!run) throw notFound("hr.thePayrollRunWasNotFound");
    if (run.status !== "draft") throw badRequest("hr.aPaidRunCannotBeChanged");
    const line = await this.t("payrollLine").findFirst({ where: { id: lineId, runId: run.id } });
    if (!line) throw notFound("hr.thePayrollLineWasNotFound");
    const raw = dto?.adjustments ?? [];
    if (!Array.isArray(raw) || raw.length > 20) throw badRequest("hr.thereCanBeAtMost20");
    const adjustments: Adjustment[] = [];
    for (const a of raw) {
      const label = String(a?.label ?? "").trim();
      const note = String(a?.note ?? "").trim();
      const amount = toBig(a?.amountMinor as any);
      if (!label) throw badRequest("hr.aLabelIsRequiredInEvery");
      if (!note) throw badRequest("hr.aNoteIsRequiredInEvery");
      if (amount === 0n) throw badRequest("hr.theAdjustmentAmountCannotBe0");
      adjustments.push({ label: label.slice(0, 120), amountMinor: amount, note: note.slice(0, 500) });
    }
    const total = lineTotal(toBig(line.baseMinor), toBig(line.deductionMinor), toBig(line.commissionMinor), adjustments);
    const updated = await this.t("payrollLine").update({
      where: { id: line.id },
      data: {
        adjustments: adjustments.map((a) => ({ label: a.label, amountMinor: a.amountMinor.toString(), note: a.note })),
        totalMinor: total,
      },
    });
    const allLines = await this.t("payrollLine").findMany({ where: { runId: run.id } });
    const runTotal = (allLines ?? []).reduce((s: bigint, l: any) => s + toBig(l.totalMinor), 0n);
    await this.t("payrollRun").update({ where: { id: run.id }, data: { totalMinor: runTotal } });
    await this.safeAudit({ organizationId: orgId, userId: actorId, action: "hr.payroll_line_adjusted", entityType: "PayrollLine", entityId: String(line.id), metadata: { runId: String(run.id), adjustments: adjustments.map((a) => ({ label: a.label, amountMinor: a.amountMinor.toString(), note: a.note })), totalMinor: total.toString() } });
    return { line: this.lineView(updated), runTotalMinor: runTotal.toString() };
  }

  /** OWNER-only in the controller. Draft → paid. A RECORD,
   * not a money movement. Posts ONE NF10 journal entry when
   * the total is positive (failure-isolated, reported). */
  async markPaid(orgId: string, actorId: string, runId: string) {
    const run = await this.t("payrollRun").findFirst({ where: { id: runId, organizationId: orgId } });
    if (!run) throw notFound("hr.thePayrollRunWasNotFound");
    if (run.status !== "draft") throw badRequest("hr.theRunIsAlreadyPaidA");
    const paidAt = new Date();
    let updated = await this.t("payrollRun").update({
      where: { id: run.id }, data: { status: "paid", paidBy: actorId, paidAt },
    });
    const total = toBig(updated.totalMinor);
    let journalPosted = false;
    let journalEntryId: string | null = null;
    let journalError: string | null = null;
    if (total > 0n) {
      if (!this.accounting) {
        journalError = "AccountingService এই ডিপ্লয়মেন্টে সংযুক্ত নেই — জার্নাল এন্ট্রি তৈরি হয়নি";
      } else {
        try {
          const { items } = await this.accounting.listAccounts(orgId);
          const salary = (items ?? []).find((a: any) => a.systemKey === "expense_salary");
          const cash = (items ?? []).find((a: any) => a.systemKey === "cash");
          if (!salary || !cash) throw new Error("Salary Expense / Cash অ্যাকাউন্ট পাওয়া যায়নি");
          const { entry } = await this.accounting.createJournalEntry(orgId, actorId, {
            date: paidAt,
            memo: `Payroll ${run.year}-${String(run.month).padStart(2, "0")} — salary expense (payroll run record; not a bank transfer)`,
            sourceType: "payroll_run", sourceId: String(run.id),
            lines: [
              { accountId: String(salary.id), debitMinor: total, creditMinor: 0n },
              { accountId: String(cash.id), debitMinor: 0n, creditMinor: total },
            ],
          });
          journalPosted = true;
          journalEntryId = String(entry.id);
          updated = await this.t("payrollRun").update({ where: { id: run.id }, data: { journalEntryId } });
        } catch (e) {
          journalError = e instanceof Error ? e.message : String(e);
        }
      }
    }
    await this.safeAudit({ organizationId: orgId, userId: actorId, action: "hr.payroll_run_paid", entityType: "PayrollRun", entityId: String(run.id), metadata: { year: Number(run.year), month: Number(run.month), totalMinor: total.toString(), journalPosted, journalEntryId } });
    return { run: this.runView(updated), journalPosted, journalEntryId, journalError, recordNote: PAYROLL_RECORD_NOTE };
  }

  // ---------------- payslips ----------------

  /** Payslip data comes FROM the stored line — the same
   * numbers the run shows. Never recomputed differently. */
  async payslipData(orgId: string, lineId: string, requester: { userId: string; admin: boolean }) {
    const line = await this.t("payrollLine").findFirst({ where: { id: lineId, organizationId: orgId } });
    if (!line) throw notFound("hr.thePaySlipWasNotFound");
    if (!requester.admin) {
      const member = await this.membershipOf(orgId, requester.userId);
      if (String(line.membershipId) !== String(member.id)) {
        throw forbidden("hr.youCanOnlyViewYourOwn");
      }
    }
    const [run, memberRow, org] = await Promise.all([
      this.t("payrollRun").findFirst({ where: { id: line.runId, organizationId: orgId } }),
      this.t("membership").findFirst({ where: { id: line.membershipId, organizationId: orgId }, include: { user: true } }),
      this.t("organization").findFirst({ where: { id: orgId } }).catch(() => null),
    ]);
    if (!run || !memberRow) throw notFound("hr.thePaySlipInformationWasNot");
    const profile = await this.t("staffSalaryProfile").findFirst({ where: { membershipId: line.membershipId } });
    return {
      organizationName: org?.name ?? null,
      period: { year: Number(run.year), month: Number(run.month) },
      runStatus: String(run.status), paidAt: run.paidAt ?? null,
      member: this.memberView(memberRow),
      payoutNote: profile?.payoutNote ?? null,
      line: this.lineView(line),
      ruleSnapshot: run.ruleSnapshot ?? null,
      recordNote: PAYROLL_RECORD_NOTE,
    };
  }

  async myPayslips(orgId: string, userId: string) {
    const member = await this.membershipOf(orgId, userId);
    const lines = await this.t("payrollLine").findMany({ where: { organizationId: orgId, membershipId: member.id } });
    const runs = await this.t("payrollRun").findMany({ where: { organizationId: orgId } });
    const runById = new Map<string, any>((runs ?? []).map((r: any) => [String(r.id), r]));
    const items = (lines ?? []).map((l: any) => {
      const r = runById.get(String(l.runId));
      return { ...this.lineView(l), period: r ? { year: Number(r.year), month: Number(r.month) } : null, runStatus: r ? String(r.status) : null };
    });
    items.sort((a: any, b: any) => ((b.period?.year ?? 0) * 100 + (b.period?.month ?? 0)) - ((a.period?.year ?? 0) * 100 + (a.period?.month ?? 0)));
    return { items };
  }

  /** Payslip PDF via the existing courier/pdf toolkit. Amounts
   * and labels carry English glosses because the toolkit is
   * WinAnsi-only (Bengali renders as "?" in PDF bytes — the
   * NF10-documented limit); full Bengali lives in web/JSON. */
  async buildPayslipPdf(orgId: string, lineId: string, requester: { userId: string; admin: boolean }): Promise<Buffer> {
    const data = await this.payslipData(orgId, lineId, requester);
    const line = data.line;
    const c = new PdfCanvas();
    const W = 595, H = 842;
    let y = H - 56;
    c.text(48, y, 16, data.organizationName ?? "Organization", true); y -= 22;
    c.text(48, y, 13, "PAYSLIP (Salary slip)", true); y -= 18;
    c.text(48, y, 10, `Period: ${data.period.year}-${String(data.period.month).padStart(2, "0")}   Status: ${data.runStatus}`); y -= 14;
    c.text(48, y, 10, `Staff: ${data.member.name ?? "-"} (${data.member.email ?? "-"})`); y -= 10;
    c.line(48, y, W - 48); y -= 20;
    const row = (label: string, minor: string, bold = false) => {
      c.text(48, y, 10, label, bold);
      c.text(W - 190, y, 10, moneyText(toBig(minor)), bold);
      y -= 15;
    };
    row("Base salary", line.baseMinor);
    row(`Unpaid leave deduction (${line.unpaidLeaveDays} day(s))`, line.deductionMinor);
    row("Commission (recorded)", line.commissionMinor);
    for (const a of line.adjustments) {
      row(`Adjustment: ${a.label}`, a.amountMinor);
      c.text(48, y, 8, `Note: ${a.note}`); y -= 12;
    }
    y -= 4; c.line(48, y, W - 48); y -= 20;
    row("TOTAL PAYABLE", line.totalMinor, true);
    if (data.payoutNote) { y -= 6; c.text(48, y, 9, `Payout note: ${data.payoutNote}`); y -= 13; }
    y -= 10;
    c.text(48, y, 8, "This payslip is generated from the stored payroll line - totals match the payroll run exactly."); y -= 12;
    c.text(48, y, 8, "Payroll mark-paid is a record only - no money is transferred by the system."); y -= 12;
    c.text(48, y, 8, PAYROLL_RECORD_NOTE); y -= 12;
    return buildPdf([{ width: W, height: H, content: c.build() }]);
  }
}
