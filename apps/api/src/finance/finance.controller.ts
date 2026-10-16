import {
  BadRequestException, Body, Controller, Delete, Get, NotFoundException, Param, Patch, Post, Query, Req, Res, UseGuards,
} from "@nestjs/common";
import { PermissionArea, Roles } from "../common/decorators";
import { RolesGuard } from "../common/roles.guard";
import { TenantGuard } from "../common/tenant.guard";
import { GC19_REPORT_TYPES, FinanceReportsService } from "./finance-reports.service";
import { FinanceService } from "./finance.service";
import { ScheduledReportsService } from "./scheduled-reports.service";
import { type BuiltFile } from "./finance-common";

/**
 * GB8 (GC19 + GC20) — reports & finance API.
 * Reads: any tenant member (area "analytics" — the catalog's
 * হিসাব area; the GB6 FINANCE preset profile carries it).
 * Money-adjacent writes (expenses, scheduled reports):
 * OWNER/ADMIN only, audited in the services. Errors surface as
 * 400 with the service's Bengali message; a scoped lookup miss
 * (foreign id) surfaces as 404.
 */
@PermissionArea("analytics")
@Controller("organizations/:organizationId/finance")
@UseGuards(TenantGuard, RolesGuard)
export class FinanceController {
  constructor(
    private readonly reports: FinanceReportsService,
    private readonly finance: FinanceService,
    private readonly scheduled: ScheduledReportsService,
  ) {}

  private actorId(req: any): string | undefined {
    return req?.user?.id ?? req?.user?.sub;
  }

  private async guard<T>(fn: () => Promise<T>): Promise<T> {
    try {
      return await fn();
    } catch (e: any) {
      const msg = String(e?.message ?? e);
      if (msg.includes("পাওয়া যায়নি")) throw new NotFoundException(msg);
      throw new BadRequestException(msg);
    }
  }

  private sendFile(res: any, file: BuiltFile) {
    res.setHeader("Content-Type", file.contentType);
    res.setHeader("Content-Disposition", `attachment; filename="${file.filename}"`);
    res.send(file.body);
  }

  private formatOf(raw?: string): "csv" | "xlsx" {
    return raw === "xlsx" ? "xlsx" : "csv";
  }

  // ---------------- GC19 reports ----------------

  @Get("reports/:type")
  report(@Param("organizationId") orgId: string, @Param("type") type: string, @Query("from") from?: string, @Query("to") to?: string) {
    if (!(GC19_REPORT_TYPES as readonly string[]).includes(type)) throw new NotFoundException("রিপোর্টের ধরনটি পাওয়া যায়নি");
    return this.guard(() => this.reports.getReport(orgId, type, from, to));
  }

  @Get("reports/:type/export")
  async reportExport(@Param("organizationId") orgId: string, @Param("type") type: string, @Res() res: any, @Query("from") from?: string, @Query("to") to?: string, @Query("format") format?: string) {
    if (!(GC19_REPORT_TYPES as readonly string[]).includes(type)) throw new NotFoundException("রিপোর্টের ধরনটি পাওয়া যায়নি");
    const file = await this.guard(() => this.reports.buildReportFile(orgId, type, from, to, this.formatOf(format)));
    this.sendFile(res, file);
  }

  // ---------------- GC20.5 GL export ----------------

  @Get("gl-export")
  async glExport(@Param("organizationId") orgId: string, @Res() res: any, @Query("from") from?: string, @Query("to") to?: string, @Query("format") format?: string) {
    const file = await this.guard(() => this.finance.glExportFile(orgId, from, to, this.formatOf(format)));
    this.sendFile(res, file);
  }

  // ---------------- GC20 expenses ----------------

  @Get("expenses/summary")
  expenseSummary(@Param("organizationId") orgId: string, @Query("month") month?: string) {
    return this.guard(() => this.finance.expenseSummary(orgId, month));
  }

  @Get("expenses")
  expenses(@Param("organizationId") orgId: string, @Query("from") from?: string, @Query("to") to?: string, @Query("page") page?: string, @Query("pageSize") pageSize?: string) {
    return this.guard(() => this.finance.listExpenses(orgId, { from, to, page, pageSize }));
  }

  @Post("expenses")
  @Roles("OWNER", "ADMIN")
  createExpense(@Param("organizationId") orgId: string, @Req() req: any, @Body() body: any) {
    return this.guard(() => this.finance.createExpense(orgId, this.actorId(req), body));
  }

  @Patch("expenses/:id")
  @Roles("OWNER", "ADMIN")
  updateExpense(@Param("organizationId") orgId: string, @Param("id") id: string, @Req() req: any, @Body() body: any) {
    return this.guard(() => this.finance.updateExpense(orgId, this.actorId(req), id, body));
  }

  @Delete("expenses/:id")
  @Roles("OWNER", "ADMIN")
  deleteExpense(@Param("organizationId") orgId: string, @Param("id") id: string, @Req() req: any) {
    return this.guard(() => this.finance.deleteExpense(orgId, this.actorId(req), id));
  }

  // ---------------- GC20 ledgers ----------------

  @Get("ledgers/:kind")
  ledger(@Param("organizationId") orgId: string, @Param("kind") kind: string, @Query("from") from?: string, @Query("to") to?: string, @Query("page") page?: string, @Query("pageSize") pageSize?: string) {
    return this.guard(() => this.finance.ledger(orgId, kind, from, to, { page, pageSize }));
  }

  // ---------------- GC19 scheduled reports ----------------

  @Get("scheduled-reports")
  scheduledList(@Param("organizationId") orgId: string) {
    return this.guard(() => this.scheduled.listConfigs(orgId));
  }

  @Post("scheduled-reports")
  @Roles("OWNER", "ADMIN")
  scheduledCreate(@Param("organizationId") orgId: string, @Req() req: any, @Body() body: any) {
    return this.guard(() => this.scheduled.createConfig(orgId, this.actorId(req), body));
  }

  @Patch("scheduled-reports/:id")
  @Roles("OWNER", "ADMIN")
  scheduledUpdate(@Param("organizationId") orgId: string, @Param("id") id: string, @Req() req: any, @Body() body: any) {
    return this.guard(() => this.scheduled.updateConfig(orgId, this.actorId(req), id, body));
  }

  @Delete("scheduled-reports/:id")
  @Roles("OWNER", "ADMIN")
  scheduledDelete(@Param("organizationId") orgId: string, @Param("id") id: string, @Req() req: any) {
    return this.guard(() => this.scheduled.deleteConfig(orgId, this.actorId(req), id));
  }

  @Post("scheduled-reports/:id/send-now")
  @Roles("OWNER", "ADMIN")
  scheduledSendNow(@Param("organizationId") orgId: string, @Param("id") id: string) {
    return this.guard(() => this.scheduled.sendNow(orgId, id));
  }

  @Get("scheduled-reports/:id/runs")
  scheduledRuns(@Param("organizationId") orgId: string, @Param("id") id: string) {
    return this.guard(() => this.scheduled.listRuns(orgId, id));
  }
}
