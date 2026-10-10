import { Body, Controller, Get, Param, Post, UseGuards } from "@nestjs/common";
import { ImportsService } from "./imports.service";
import { ImportProductsCsvDto } from "./imports.dto";
import { CurrentUser, AuthUser, Roles } from "../common/decorators";
import { TenantGuard } from "../common/tenant.guard";
import { RolesGuard } from "../common/roles.guard";

@Controller("organizations/:organizationId/imports")
@UseGuards(TenantGuard)
export class ImportsController {
  constructor(private readonly imports: ImportsService) {}

  @Post("products") @UseGuards(RolesGuard) @Roles("OWNER", "ADMIN", "MARKETING_MANAGER")
  importProducts(@CurrentUser() user: AuthUser, @Param("organizationId") orgId: string, @Body() dto: ImportProductsCsvDto) {
    return this.imports.importProducts(orgId, user.userId, dto);
  }

  @Get()
  list(@Param("organizationId") orgId: string) { return this.imports.listJobs(orgId); }

  @Get(":importId")
  getOne(@Param("organizationId") orgId: string, @Param("importId") id: string) { return this.imports.getJob(orgId, id); }
}
