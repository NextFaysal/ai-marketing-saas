import { Body, Controller, Delete, Get, Param, Post, UseGuards } from "@nestjs/common";
import { DarazService } from "./daraz.service";
import { SaveDarazConfigDto } from "./daraz.dto";
import { CurrentUser, AuthUser, Roles, PermissionArea } from "../../common/decorators";
import { TenantGuard } from "../../common/tenant.guard";
import { RolesGuard } from "../../common/roles.guard";

const WRITE_ROLES = ["OWNER", "ADMIN"] as const;

/** OU3 — Daraz channel config (same guard stack as the Feeds
 * controller). Every response carries live:false — this surface
 * configures a DEVELOPMENT adapter, not a live connection. */
@PermissionArea("integrations")
@Controller("organizations/:organizationId/commerce/daraz")
@UseGuards(TenantGuard, RolesGuard)
export class DarazController {
  constructor(private readonly daraz: DarazService) {}

  @Get("config")
  getConfig(@Param("organizationId") orgId: string) {
    return this.daraz.getConfig(orgId);
  }

  @Post("config")
  @Roles(...WRITE_ROLES)
  saveConfig(
    @CurrentUser() user: AuthUser,
    @Param("organizationId") orgId: string,
    @Body() dto: SaveDarazConfigDto,
  ) {
    return this.daraz.saveConfig(orgId, user.userId, dto);
  }

  @Post("verify")
  @Roles(...WRITE_ROLES)
  verify(@Param("organizationId") orgId: string) {
    return this.daraz.verify(orgId);
  }

  @Delete("config")
  @Roles(...WRITE_ROLES)
  removeConfig(@CurrentUser() user: AuthUser, @Param("organizationId") orgId: string) {
    return this.daraz.removeConfig(orgId, user.userId);
  }
}
