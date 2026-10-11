import { Controller, Get, Param, Post, UseGuards } from "@nestjs/common";
import { AbandonedCartsService } from "./abandoned-carts.service";
import { TenantGuard } from "../common/tenant.guard";
import { RolesGuard } from "../common/roles.guard";
import { AuthUser, CurrentUser, PermissionArea, Roles } from "../common/decorators";

@PermissionArea("analytics")
@Controller("organizations/:organizationId/tracking")
@UseGuards(TenantGuard, RolesGuard)
export class AbandonedCartsController {
  constructor(private readonly carts: AbandonedCartsService) {}

  @Get("abandoned-carts")
  list(@Param("organizationId") organizationId: string) {
    return this.carts.list(organizationId);
  }

  @Post("abandoned-carts/:visitorId/recover")
  @UseGuards(RolesGuard)
  @Roles("OWNER", "ADMIN", "MARKETING_MANAGER")
  recover(
    @Param("organizationId") organizationId: string,
    @Param("visitorId") visitorId: string,
    @CurrentUser() user: AuthUser,
  ) {
    return this.carts.sendRecovery(organizationId, user.userId, visitorId);
  }
}
