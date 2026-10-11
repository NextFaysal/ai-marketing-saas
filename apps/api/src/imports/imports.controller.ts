import { Body, Controller, Get, Param, Post, UseGuards } from "@nestjs/common";
import { ImportsService } from "./imports.service";
import { ImportProductsCsvDto } from "./imports.dto";
import { CurrentUser, AuthUser, Roles, PermissionArea } from "../common/decorators";
import { TenantGuard } from "../common/tenant.guard";
import { RolesGuard } from "../common/roles.guard";

@PermissionArea("integrations")
@Controller("organizations/:organizationId/imports")
@UseGuards(TenantGuard, RolesGuard)
export class ImportsController {
  constructor(private readonly imports: ImportsService) {}

  @Post("products") @UseGuards(RolesGuard) @Roles("OWNER", "ADMIN", "MARKETING_MANAGER")
  importProducts(@CurrentUser() user: AuthUser, @Param("organizationId") orgId: string, @Body() dto: ImportProductsCsvDto) {
    return this.imports.importProducts(orgId, user.userId, dto);
  }

  /** Milestone 65: bulk order import (one row = one order). */
  @Post("orders") @UseGuards(RolesGuard) @Roles("OWNER", "ADMIN", "MARKETING_MANAGER")
  importOrders(@CurrentUser() user: AuthUser, @Param("organizationId") orgId: string, @Body() dto: ImportProductsCsvDto) {
    return this.imports.importOrders(orgId, user.userId, dto);
  }

  @Get()
  list(@Param("organizationId") orgId: string) { return this.imports.listJobs(orgId); }

  @Get(":importId")
  getOne(@Param("organizationId") orgId: string, @Param("importId") id: string) { return this.imports.getJob(orgId, id); }
}
