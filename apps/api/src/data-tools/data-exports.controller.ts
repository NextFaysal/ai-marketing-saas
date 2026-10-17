import { Body, Controller, Get, Param, Post, Put, Query, StreamableFile, UseGuards } from "@nestjs/common";
import { IsBoolean, IsOptional, IsString, MaxLength } from "class-validator";
import { DataExportsService } from "./data-exports.service";
import { DataImportsService } from "./data-imports.service";
import { BUNDLE_JSON_MAX_LENGTH } from "./org-data-import";
import { TenantGuard } from "../common/tenant.guard";
import { RolesGuard } from "../common/roles.guard";
import { CurrentUser, Roles, type AuthUser } from "../common/decorators";

class BackupPreferenceDto {
  @IsBoolean() enabled!: boolean;
}

/** OU12: backup verification requires typing the org slug —
 * the same confirm discipline a restore would have required. */
class VerifyBackupDto {
  @IsString() @MaxLength(200) confirmSlug!: string;
}

/**
 * ORG16: the bundle file travels as a JSON string in the body —
 * the same door as the CSV/XLSX imports (the API's JSON body
 * limit is 3 MB; the cap mirrors the XLSX DTO's precedent).
 */
class DataImportDto {
  @IsOptional() @IsString() @MaxLength(200) fileName?: string;
  @IsString() @MaxLength(BUNDLE_JSON_MAX_LENGTH) bundleJson!: string;
}

const STAFF_ROLES = ["OWNER", "ADMIN"] as const;

/**
 * AB8 (AX25) — Merchant Data Tools (org-scoped, OWNER/ADMIN).
 *
 * Includes the AX25a audit viewer at GET .../audit-logs: it lists
 * AuditLog rows stamped with THIS org's id only, and the payload
 * carries scopeNote "org_stamped_only" for the UI to render —
 * rows without org context exist (platform-level auth events
 * etc.) and are deliberately not shown here.
 *
 * It lives in this controller (rather than the organizations
 * controller) because it is one of the merchant data tools and
 * shares this controller's guard/role setup; there is a single
 * route registration for the path either way.
 */
@Controller("organizations/:organizationId")
@UseGuards(TenantGuard, RolesGuard)
export class DataExportsController {
  constructor(
    private readonly dataExports: DataExportsService,
    private readonly dataImports: DataImportsService,
  ) {}

  @Get("audit-logs")
  @Roles(...STAFF_ROLES)
  auditLogs(
    @Param("organizationId") id: string,
    @Query("entity") entity?: string,
    @Query("actorId") actorId?: string,
    @Query("from") from?: string,
    @Query("to") to?: string,
    @Query("page") page?: string,
    @Query("pageSize") pageSize?: string,
  ) {
    return this.dataExports.listAuditLogs(id, {
      entity, actorId, from, to,
      page: page ? Number(page) : undefined,
      pageSize: pageSize ? Number(pageSize) : undefined,
    });
  }

  @Post("data-exports")
  @Roles(...STAFF_ROLES)
  create(@CurrentUser() user: AuthUser, @Param("organizationId") id: string) {
    return this.dataExports.createExport(id, user.userId, "manual");
  }

  @Get("data-exports")
  @Roles(...STAFF_ROLES)
  list(@Param("organizationId") id: string) {
    return this.dataExports.listExports(id);
  }

  @Get("data-exports/:exportId/download")
  @Roles(...STAFF_ROLES)
  async download(@Param("organizationId") id: string, @Param("exportId") exportId: string) {
    const out = await this.dataExports.download(id, exportId);
    return new StreamableFile(out.bytes, {
      type: "application/json",
      disposition: `attachment; filename="${out.filename}"`,
    });
  }

  /**
   * OU12: backup VERIFICATION (restore-readiness check) —
   * OWNER-only, slug-confirmed, read-only. This is deliberately
   * NOT a restore endpoint: the export bundle does not
   * round-trip (see the service + docs/one-umbrella-ou12-section.md).
   */
  @Post("data-exports/:exportId/verify-backup")
  @Roles("OWNER")
  verifyBackup(
    @CurrentUser() user: AuthUser,
    @Param("organizationId") id: string,
    @Param("exportId") exportId: string,
    @Body() dto: VerifyBackupDto,
  ) {
    return this.dataExports.verifyBackup(id, user.userId, exportId, dto.confirmSlug);
  }

  @Put("data-exports/backup-preference")
  @Roles(...STAFF_ROLES)
  setBackupPreference(
    @CurrentUser() user: AuthUser,
    @Param("organizationId") id: string,
    @Body() dto: BackupPreferenceDto,
  ) {
    return this.dataExports.setBackupPreference(id, user.userId, dto.enabled);
  }

  // ---------- ORG16: bundle import/restore (OWNER only) ----------
  // Restore rewrites an org's whole dataset, so unlike exports
  // (OWNER/ADMIN) these three routes are the org OWNER's alone.
  // The validate route writes NOTHING — it only reports what an
  // import of this bundle into this org would do.

  @Post("data-imports/validate")
  @Roles("OWNER")
  validateImport(@Param("organizationId") id: string, @Body() dto: DataImportDto) {
    return this.dataImports.validateImport(id, dto.bundleJson);
  }

  @Post("data-imports")
  @Roles("OWNER")
  createImport(
    @CurrentUser() user: AuthUser,
    @Param("organizationId") id: string,
    @Body() dto: DataImportDto,
  ) {
    return this.dataImports.createImport(id, user.userId, dto.fileName, dto.bundleJson);
  }

  @Get("data-imports/:importId")
  @Roles("OWNER")
  getImport(@Param("organizationId") id: string, @Param("importId") importId: string) {
    return this.dataImports.getImport(id, importId);
  }
}
