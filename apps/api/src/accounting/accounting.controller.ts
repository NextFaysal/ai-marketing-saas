import { Body, Controller, Delete, Get, Param, Patch, Post, Query, Res, UseGuards } from "@nestjs/common";
import { AccountingService } from "./accounting.service";
import { CreateAccountDto, CreateManualEntryDto, ImportStatementDto, ResolveStatementLineDto, UpdateAccountDto } from "./accounting.dto";
import { CurrentUser, AuthUser, Roles, PermissionArea } from "../common/decorators";
import { TenantGuard } from "../common/tenant.guard";
import { RolesGuard } from "../common/roles.guard";

/**
 * NF10 (FB4) — Accounting staff API. Same area as Finance
 * ("analytics" — the হিসাব area) and the same guard stack.
 * Reads: the four-role staff read set. Writes (accounts, manual
 * entries, sync, statement import/confirm): OWNER/ADMIN.
 * Reports carry the accounting-aid disclaimer verbatim in every
 * payload (service-level), and the PDF routes stream the SAME
 * journal figures through the existing courier/pdf machinery.
 */
const READ_ROLES = ["OWNER", "ADMIN", "MARKETING_MANAGER", "SUPPORT_AGENT"] as const;
const WRITE_ROLES = ["OWNER", "ADMIN"] as const;

@PermissionArea("analytics")
@Controller("organizations/:organizationId/accounting")
@UseGuards(TenantGuard, RolesGuard)
export class AccountingController {
  constructor(private readonly accounting: AccountingService) {}

  // ---------------- chart of accounts ----------------

  @Get("accounts") @Roles(...READ_ROLES)
  listAccounts(@Param("organizationId") orgId: string) {
    return this.accounting.listAccounts(orgId);
  }

  @Post("accounts") @Roles(...WRITE_ROLES)
  createAccount(@CurrentUser() user: AuthUser, @Param("organizationId") orgId: string, @Body() dto: CreateAccountDto) {
    return this.accounting.createAccount(orgId, user.userId, dto);
  }

  @Patch("accounts/:accountId") @Roles(...WRITE_ROLES)
  updateAccount(@CurrentUser() user: AuthUser, @Param("organizationId") orgId: string, @Param("accountId") accountId: string, @Body() dto: UpdateAccountDto) {
    return this.accounting.updateAccount(orgId, user.userId, accountId, dto);
  }

  @Delete("accounts/:accountId") @Roles(...WRITE_ROLES)
  deleteAccount(@CurrentUser() user: AuthUser, @Param("organizationId") orgId: string, @Param("accountId") accountId: string) {
    return this.accounting.deleteAccount(orgId, user.userId, accountId);
  }

  // ---------------- journal ----------------

  @Get("journal") @Roles(...READ_ROLES)
  listEntries(@Param("organizationId") orgId: string, @Query("page") page?: string, @Query("pageSize") pageSize?: string, @Query("sourceType") sourceType?: string) {
    return this.accounting.listEntries(orgId, { page, pageSize, sourceType });
  }

  @Post("journal") @Roles(...WRITE_ROLES)
  createManual(@CurrentUser() user: AuthUser, @Param("organizationId") orgId: string, @Body() dto: CreateManualEntryDto) {
    // DTO carries minor amounts as strings; the service's toBig
    // door converts them (never a float).
    return this.accounting.createManualEntry(orgId, user.userId, dto as any);
  }

  @Post("sync") @Roles(...WRITE_ROLES)
  sync(@CurrentUser() user: AuthUser, @Param("organizationId") orgId: string) {
    return this.accounting.syncAutoEntries(orgId, user.userId);
  }

  // ---------------- reports ----------------

  @Get("reports/pnl") @Roles(...READ_ROLES)
  pnl(@Param("organizationId") orgId: string, @Query("month") month?: string) {
    return this.accounting.profitAndLoss(orgId, month ?? "");
  }

  @Get("reports/vat") @Roles(...READ_ROLES)
  vat(@Param("organizationId") orgId: string, @Query("month") month?: string) {
    return this.accounting.vatSummary(orgId, month ?? "");
  }

  @Get("reports/pnl/pdf") @Roles(...READ_ROLES)
  async pnlPdf(@Param("organizationId") orgId: string, @Res() res: any, @Query("month") month?: string) {
    const m = month ?? "";
    const buf = await this.accounting.buildReportPdf(orgId, "pnl", m);
    res.setHeader("Content-Type", "application/pdf");
    res.setHeader("Content-Disposition", `attachment; filename="pnl-${m}.pdf"`);
    res.send(buf);
  }

  @Get("reports/vat/pdf") @Roles(...READ_ROLES)
  async vatPdf(@Param("organizationId") orgId: string, @Res() res: any, @Query("month") month?: string) {
    const m = month ?? "";
    const buf = await this.accounting.buildReportPdf(orgId, "vat", m);
    res.setHeader("Content-Type", "application/pdf");
    res.setHeader("Content-Disposition", `attachment; filename="vat-${m}.pdf"`);
    res.send(buf);
  }

  // ---------------- bank statement reconciliation ----------------

  @Post("statements/import") @Roles(...WRITE_ROLES)
  importStatement(@CurrentUser() user: AuthUser, @Param("organizationId") orgId: string, @Body() dto: ImportStatementDto) {
    return this.accounting.importStatement(orgId, user.userId, dto);
  }

  @Get("statements") @Roles(...READ_ROLES)
  listStatements(@Param("organizationId") orgId: string) {
    return this.accounting.listStatementImports(orgId);
  }

  @Get("statements/:importId/lines") @Roles(...READ_ROLES)
  listLines(@Param("organizationId") orgId: string, @Param("importId") importId: string, @Query("matchState") matchState?: string) {
    return this.accounting.listStatementLines(orgId, importId, matchState || undefined);
  }

  @Patch("statements/lines/:lineId") @Roles(...WRITE_ROLES)
  resolveLine(@CurrentUser() user: AuthUser, @Param("organizationId") orgId: string, @Param("lineId") lineId: string, @Body() dto: ResolveStatementLineDto) {
    return this.accounting.resolveStatementLine(orgId, user.userId, lineId, dto);
  }
}
