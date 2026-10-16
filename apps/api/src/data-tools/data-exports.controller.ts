import { Body, Controller, Get, Param, Post, Put, Query, StreamableFile, UseGuards } from "@nestjs/common";
import { IsBoolean } from "class-validator";
import { DataExportsService } from "./data-exports.service";
import { TenantGuard } from "../common/tenant.guard";
import { RolesGuard } from "../common/roles.guard";
import { CurrentUser, Roles, type AuthUser } from "../common/decorators";

class BackupPreferenceDto {
  @IsBoolean() enabled!: boolean;
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
  constructor(private readonly dataExports: DataExportsService) {}

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

  @Put("data-exports/backup-preference")
  @Roles(...STAFF_ROLES)
  setBackupPreference(
    @CurrentUser() user: AuthUser,
    @Param("organizationId") id: string,
    @Body() dto: BackupPreferenceDto,
  ) {
    return this.dataExports.setBackupPreference(id, user.userId, dto.enabled);
  }
}
