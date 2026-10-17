import { Body, Controller, Get, Param, Patch, Post, Put, Query, Res, UseGuards } from "@nestjs/common";
import { HrService } from "./hr.service";
import type {
  CorrectAttendanceDto, CreateLeaveDto, DecideLeaveDto, GeneratePayrollDto,
  SetSalaryProfileDto, SetShiftPatternsDto, UpdateHrSettingDto, UpdatePayrollLineDto,
} from "./hr.dto";
import { CurrentUser, AuthUser, Roles, PermissionArea } from "../common/decorators";
import { TenantGuard } from "../common/tenant.guard";
import { RolesGuard } from "../common/roles.guard";

/**
 * NF11 (FB4) — HR lite staff API. @PermissionArea("team")
 * (HR is team management). Admin surface: OWNER/ADMIN write,
 * the four-role staff read set. Self surface ("me/…"): EVERY
 * member role (minimum VIEWER via the role hierarchy) acting
 * ONLY on their own records — the service resolves the caller
 * to their own Membership and never accepts a membershipId
 * from the self caller. Mark-paid is OWNER-only exactly.
 * Mark-paid is a RECORD, not a money movement.
 */
const READ_ROLES = ["OWNER", "ADMIN", "MARKETING_MANAGER", "SUPPORT_AGENT"] as const;
const WRITE_ROLES = ["OWNER", "ADMIN"] as const;
const SELF_ROLES = ["VIEWER"] as const; // hierarchy minimum — every member role passes

@PermissionArea("team")
@Controller("organizations/:organizationId/hr")
@UseGuards(TenantGuard, RolesGuard)
export class HrController {
  constructor(private readonly hr: HrService) {}

  // ---------------- setting ----------------

  @Get("setting") @Roles(...READ_ROLES)
  getSetting(@Param("organizationId") orgId: string) {
    return this.hr.getSetting(orgId);
  }

  @Put("setting") @Roles(...WRITE_ROLES)
  updateSetting(@CurrentUser() user: AuthUser, @Param("organizationId") orgId: string, @Body() dto: UpdateHrSettingDto) {
    return this.hr.updateSetting(orgId, user.userId, dto);
  }

  // ---------------- staff + salary profiles ----------------

  @Get("staff") @Roles(...READ_ROLES)
  listStaff(@Param("organizationId") orgId: string) {
    return this.hr.listStaff(orgId);
  }

  @Put("salary-profiles/:membershipId") @Roles(...WRITE_ROLES)
  setSalaryProfile(@CurrentUser() user: AuthUser, @Param("organizationId") orgId: string, @Param("membershipId") membershipId: string, @Body() dto: SetSalaryProfileDto) {
    return this.hr.setSalaryProfile(orgId, user.userId, membershipId, dto);
  }

  // ---------------- attendance (admin) ----------------

  @Get("attendance") @Roles(...READ_ROLES)
  listAttendance(@Param("organizationId") orgId: string, @Query("date") date?: string) {
    return this.hr.listAttendance(orgId, date || undefined);
  }

  @Post("attendance/correction") @Roles(...WRITE_ROLES)
  correctAttendance(@CurrentUser() user: AuthUser, @Param("organizationId") orgId: string, @Body() dto: CorrectAttendanceDto) {
    return this.hr.correctAttendance(orgId, user.userId, dto);
  }

  // ---------------- shifts (admin) ----------------

  @Get("shifts/:membershipId") @Roles(...READ_ROLES)
  listShifts(@Param("organizationId") orgId: string, @Param("membershipId") membershipId: string) {
    return this.hr.listShiftPatterns(orgId, membershipId);
  }

  @Put("shifts/:membershipId") @Roles(...WRITE_ROLES)
  setShifts(@CurrentUser() user: AuthUser, @Param("organizationId") orgId: string, @Param("membershipId") membershipId: string, @Body() dto: SetShiftPatternsDto) {
    return this.hr.setShiftPatterns(orgId, user.userId, membershipId, dto);
  }

  // ---------------- leave (admin) ----------------

  @Get("leave") @Roles(...READ_ROLES)
  listLeave(@Param("organizationId") orgId: string, @Query("status") status?: string) {
    return this.hr.listLeave(orgId, status || undefined);
  }

  @Post("leave/:leaveId/decide") @Roles(...WRITE_ROLES)
  decideLeave(@CurrentUser() user: AuthUser, @Param("organizationId") orgId: string, @Param("leaveId") leaveId: string, @Body() dto: DecideLeaveDto) {
    return this.hr.decideLeave(orgId, user.userId, leaveId, String(dto?.decision ?? ""));
  }

  // ---------------- payroll (admin) ----------------

  @Get("payroll/runs") @Roles(...READ_ROLES)
  listRuns(@Param("organizationId") orgId: string) {
    return this.hr.listRuns(orgId);
  }

  @Post("payroll/runs") @Roles(...WRITE_ROLES)
  generateRun(@CurrentUser() user: AuthUser, @Param("organizationId") orgId: string, @Body() dto: GeneratePayrollDto) {
    return this.hr.generateRun(orgId, user.userId, dto);
  }

  @Get("payroll/runs/:runId") @Roles(...READ_ROLES)
  getRun(@Param("organizationId") orgId: string, @Param("runId") runId: string) {
    return this.hr.getRun(orgId, runId);
  }

  @Patch("payroll/runs/:runId/lines/:lineId") @Roles(...WRITE_ROLES)
  updateLine(@CurrentUser() user: AuthUser, @Param("organizationId") orgId: string, @Param("runId") runId: string, @Param("lineId") lineId: string, @Body() dto: UpdatePayrollLineDto) {
    return this.hr.updateLineAdjustments(orgId, user.userId, runId, lineId, dto);
  }

  @Post("payroll/runs/:runId/mark-paid") @Roles("OWNER")
  markPaid(@CurrentUser() user: AuthUser, @Param("organizationId") orgId: string, @Param("runId") runId: string) {
    return this.hr.markPaid(orgId, user.userId, runId);
  }

  @Get("payroll/runs/:runId/lines/:lineId/payslip") @Roles(...READ_ROLES)
  async payslip(@Param("organizationId") orgId: string, @Param("lineId") lineId: string) {
    return this.hr.payslipData(orgId, lineId, { userId: "", admin: true });
  }

  @Get("payroll/runs/:runId/lines/:lineId/payslip/pdf") @Roles(...READ_ROLES)
  async payslipPdf(@Param("organizationId") orgId: string, @Param("runId") runId: string, @Param("lineId") lineId: string, @Res() res: any) {
    const buf = await this.hr.buildPayslipPdf(orgId, lineId, { userId: "", admin: true });
    res.setHeader("Content-Type", "application/pdf");
    res.setHeader("Content-Disposition", `attachment; filename="payslip-${runId}-${lineId}.pdf"`);
    res.send(buf);
  }

  // ---------------- self surface ----------------

  @Get("me/salary-profile") @Roles(...SELF_ROLES)
  mySalaryProfile(@CurrentUser() user: AuthUser, @Param("organizationId") orgId: string) {
    return this.hr.mySalaryProfile(orgId, user.userId);
  }

  @Post("me/attendance/check-in") @Roles(...SELF_ROLES)
  checkIn(@CurrentUser() user: AuthUser, @Param("organizationId") orgId: string) {
    return this.hr.checkIn(orgId, user.userId);
  }

  @Post("me/attendance/check-out") @Roles(...SELF_ROLES)
  checkOut(@CurrentUser() user: AuthUser, @Param("organizationId") orgId: string) {
    return this.hr.checkOut(orgId, user.userId);
  }

  @Get("me/attendance") @Roles(...SELF_ROLES)
  myAttendance(@CurrentUser() user: AuthUser, @Param("organizationId") orgId: string, @Query("month") month?: string) {
    return this.hr.myAttendance(orgId, user.userId, month || undefined);
  }

  @Get("me/shifts") @Roles(...SELF_ROLES)
  myShifts(@CurrentUser() user: AuthUser, @Param("organizationId") orgId: string) {
    return this.hr.myShiftPatterns(orgId, user.userId);
  }

  @Post("me/leave") @Roles(...SELF_ROLES)
  createLeave(@CurrentUser() user: AuthUser, @Param("organizationId") orgId: string, @Body() dto: CreateLeaveDto) {
    return this.hr.createLeave(orgId, user.userId, dto);
  }

  @Get("me/leave") @Roles(...SELF_ROLES)
  myLeave(@CurrentUser() user: AuthUser, @Param("organizationId") orgId: string) {
    return this.hr.myLeave(orgId, user.userId);
  }

  @Get("me/payslips") @Roles(...SELF_ROLES)
  myPayslips(@CurrentUser() user: AuthUser, @Param("organizationId") orgId: string) {
    return this.hr.myPayslips(orgId, user.userId);
  }

  @Get("me/payslips/:lineId/pdf") @Roles(...SELF_ROLES)
  async myPayslipPdf(@CurrentUser() user: AuthUser, @Param("organizationId") orgId: string, @Param("lineId") lineId: string, @Res() res: any) {
    const buf = await this.hr.buildPayslipPdf(orgId, lineId, { userId: user.userId, admin: false });
    res.setHeader("Content-Type", "application/pdf");
    res.setHeader("Content-Disposition", `attachment; filename="payslip-${lineId}.pdf"`);
    res.send(buf);
  }
}
