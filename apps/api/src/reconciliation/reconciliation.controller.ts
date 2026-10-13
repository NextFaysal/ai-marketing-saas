import {
  Body, Controller, Get, Param, Patch, Post, Put, Query, UseGuards,
} from "@nestjs/common";
import { ReconciliationService } from "./reconciliation.service";
import {
  ImportSheetDto, ReadHeadersDto, ResolveLineDto, SaveProfileDto,
} from "./reconciliation.dto";
import { CurrentUser, AuthUser, Roles, PermissionArea } from "../common/decorators";
import { TenantGuard } from "../common/tenant.guard";
import { RolesGuard } from "../common/roles.guard";

const WRITE_ROLES = ["OWNER", "ADMIN", "MARKETING_MANAGER"] as const;

/** EC26 — Courier COD Reconciliation staff API. Same guard stack
 * as the purchasing controller: TenantGuard + RolesGuard,
 * @PermissionArea("orders"), writes restricted to WRITE_ROLES. */
@PermissionArea("orders")
@Controller("organizations/:organizationId/commerce/reconciliation")
@UseGuards(TenantGuard, RolesGuard)
export class ReconciliationController {
  constructor(private readonly reconciliation: ReconciliationService) {}

  /** Parse only the header row so the UI can offer column mapping. */
  @Post("headers")
  readHeaders(@Body() dto: ReadHeadersDto) {
    return this.reconciliation.readHeaders(dto.csvText);
  }

  @Post("import") @Roles(...WRITE_ROLES)
  importSheet(
    @CurrentUser() user: AuthUser,
    @Param("organizationId") orgId: string,
    @Body() dto: ImportSheetDto,
  ) {
    return this.reconciliation.importSheet(orgId, user.userId, dto);
  }

  @Get("imports")
  listImports(@Param("organizationId") orgId: string, @Query("courierIntegrationId") courierIntegrationId?: string) {
    return this.reconciliation.listImports(orgId, courierIntegrationId || undefined);
  }

  @Get("imports/:importId")
  getImport(@Param("organizationId") orgId: string, @Param("importId") importId: string) {
    return this.reconciliation.getImport(orgId, importId);
  }

  @Get("imports/:importId/lines")
  listLines(
    @Param("organizationId") orgId: string,
    @Param("importId") importId: string,
    @Query("outcome") outcome?: string,
  ) {
    return this.reconciliation.listLines(orgId, importId, outcome || undefined);
  }

  @Patch("lines/:lineId") @Roles(...WRITE_ROLES)
  resolveLine(
    @CurrentUser() user: AuthUser,
    @Param("organizationId") orgId: string,
    @Param("lineId") lineId: string,
    @Body() dto: ResolveLineDto,
  ) {
    return this.reconciliation.resolveLine(orgId, user.userId, lineId, dto);
  }

  @Get("profile")
  getProfile(@Param("organizationId") orgId: string, @Query("courierIntegrationId") courierIntegrationId?: string) {
    return this.reconciliation.getProfile(orgId, courierIntegrationId ?? "");
  }

  @Put("profile") @Roles(...WRITE_ROLES)
  saveProfile(@Param("organizationId") orgId: string, @Body() dto: SaveProfileDto) {
    return this.reconciliation.saveProfile(orgId, dto);
  }
}
