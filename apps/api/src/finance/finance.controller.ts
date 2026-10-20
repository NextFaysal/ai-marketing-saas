import {
  BadRequestException, Body, Controller, Delete, Get, HttpException, Param, Patch, Post, Query, Req, Res, UseGuards,
} from "@nestjs/common";
import { notFound } from "../i18n";
import { PermissionArea, Roles } from "../common/decorators";
import { RolesGuard } from "../common/roles.guard";
import { TenantGuard } from "../common/tenant.guard";
import { GC19_REPORT_TYPES, FinanceReportsService } from "./finance-reports.service";
import { FinanceService } from "./finance.service";
import { AccountingLiteService } from "./ou7-accounting.service";
import { BankReconService } from "./ou7-bank-recon.service";
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
    private readonly accounting: AccountingLiteService,
    private readonly bankRecon: BankReconService,
  ) {}

  private actorId(req: any): string | undefined {
    return req?.user?.id ?? req?.user?.sub;
  }

  private async guard<T>(fn: () => Promise<T>): Promise<T> {
    try {
      return await fn();
    } catch (e: any) {
      // MB4: coded ApiExceptions keep their own status/code —
      // the global filter renders the message in the request
      // locale. The legacy BN-substring mapping below only
      // handles uncoded plain Errors from helpers not yet
      // converted.
      if (e instanceof HttpException) throw e;
      const msg = String(e?.message ?? e);
      if (msg.includes("পাওয়া যায়নি")) throw notFound("finance.reportTypeNotFound");
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
    if (!(GC19_REPORT_TYPES as readonly string[]).includes(type)) throw notFound("finance.reportTypeNotFound");
    return this.guard(() => this.reports.getReport(orgId, type, from, to));
  }

  @Get("reports/:type/export")
  async reportExport(@Param("organizationId") orgId: string, @Param("type") type: string, @Res() res: any, @Query("from") from?: string, @Query("to") to?: string, @Query("format") format?: string) {
    if (!(GC19_REPORT_TYPES as readonly string[]).includes(type)) throw notFound("finance.reportTypeNotFound");
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

  // ---------------- OU7 accounting-lite ----------------
  // Reads: any tenant member (same "analytics" area as the rest of
  // finance). Writes (posting run, manual entries, bank import /
  // match confirm): OWNER/ADMIN only, audited in the services.

  @Get("accounting/accounts")
  accounts(@Param("organizationId") orgId: string) {
    return this.guard(() => this.accounting.listAccounts(orgId));
  }

  @Get("accounting/posting-status")
  postingStatus(@Param("organizationId") orgId: string, @Query("from") from?: string, @Query("to") to?: string) {
    return this.guard(() => this.accounting.postingStatus(orgId, from, to));
  }

  @Post("accounting/post")
  @Roles("OWNER", "ADMIN")
  postSources(@Param("organizationId") orgId: string, @Req() req: any, @Query("from") from?: string, @Query("to") to?: string) {
    return this.guard(() => this.accounting.postSources(orgId, this.actorId(req), from, to));
  }

  @Get("accounting/journal")
  journal(@Param("organizationId") orgId: string, @Query("from") from?: string, @Query("to") to?: string, @Query("page") page?: string, @Query("pageSize") pageSize?: string) {
    return this.guard(() => this.accounting.listJournal(orgId, from, to, page, pageSize));
  }

  @Post("accounting/journal/manual")
  @Roles("OWNER", "ADMIN")
  manualEntry(@Param("organizationId") orgId: string, @Req() req: any, @Body() body: any) {
    return this.guard(() => this.accounting.createManualEntry(orgId, this.actorId(req), body));
  }

  @Get("accounting/trial-balance")
  trialBalance(@Param("organizationId") orgId: string, @Query("from") from?: string, @Query("to") to?: string) {
    return this.guard(() => this.accounting.trialBalance(orgId, from, to));
  }

  @Get("accounting/balance-sheet")
  balanceSheet(@Param("organizationId") orgId: string, @Query("to") to?: string) {
    return this.guard(() => this.accounting.balanceSheet(orgId, to));
  }

  @Post("accounting/bank-statement/import")
  @Roles("OWNER", "ADMIN")
  bankImport(@Param("organizationId") orgId: string, @Req() req: any, @Body() body: any) {
    return this.guard(() => this.bankRecon.importStatement(orgId, this.actorId(req), body?.csv));
  }

  @Get("accounting/bank-lines")
  bankLines(@Param("organizationId") orgId: string, @Query("status") status?: string) {
    return this.guard(() => this.bankRecon.listBankLines(orgId, status));
  }

  @Post("accounting/bank-lines/:id/confirm-match")
  @Roles("OWNER", "ADMIN")
  bankConfirm(@Param("organizationId") orgId: string, @Param("id") id: string, @Req() req: any, @Body() body: any) {
    return this.guard(() => this.bankRecon.confirmMatch(orgId, this.actorId(req), id, body));
  }

  @Post("accounting/bank-lines/:id/unmatch")
  @Roles("OWNER", "ADMIN")
  bankUnmatch(@Param("organizationId") orgId: string, @Param("id") id: string, @Req() req: any) {
    return this.guard(() => this.bankRecon.unmatch(orgId, this.actorId(req), id));
  }
}
