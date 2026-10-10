import { Body, Controller, Delete, Get, Param, Post, Query, UseGuards } from "@nestjs/common";
import { CourierService } from "./courier.service";
import { BookShipmentDto, ConnectCourierDto } from "./courier.dto";
import { CurrentUser, AuthUser, Roles } from "../common/decorators";
import { TenantGuard } from "../common/tenant.guard";
import { RolesGuard } from "../common/roles.guard";

@Controller("organizations/:organizationId/courier")
@UseGuards(TenantGuard)
export class CourierController {
  constructor(private readonly courier: CourierService) {}

  @Get("connection")
  connection(@Param("organizationId") orgId: string, @Query("provider") provider?: string) {
    return this.courier.getConnection(orgId, provider);
  }

  @Get("connections")
  connections(@Param("organizationId") orgId: string) { return this.courier.getConnections(orgId); }

  @Post("connect") @UseGuards(RolesGuard) @Roles("OWNER", "ADMIN")
  connect(@CurrentUser() user: AuthUser, @Param("organizationId") orgId: string, @Body() dto: ConnectCourierDto) {
    return this.courier.connect(orgId, user.userId, dto);
  }

  @Delete("connection") @UseGuards(RolesGuard) @Roles("OWNER", "ADMIN")
  disconnect(@CurrentUser() user: AuthUser, @Param("organizationId") orgId: string, @Query("provider") provider?: string) {
    return this.courier.disconnect(orgId, user.userId, provider);
  }

  @Get("pathao/stores")
  pathaoStores(@Param("organizationId") orgId: string) { return this.courier.pathaoStores(orgId); }
  @Get("pathao/cities")
  pathaoCities(@Param("organizationId") orgId: string) { return this.courier.pathaoCities(orgId); }
  @Get("pathao/zones/:cityId")
  pathaoZones(@Param("organizationId") orgId: string, @Param("cityId") cityId: string) {
    return this.courier.pathaoZones(orgId, Number(cityId));
  }
  @Get("pathao/areas/:zoneId")
  pathaoAreas(@Param("organizationId") orgId: string, @Param("zoneId") zoneId: string) {
    return this.courier.pathaoAreas(orgId, Number(zoneId));
  }
  @Get("redx/areas")
  redxAreas(@Param("organizationId") orgId: string) { return this.courier.redxAreas(orgId); }
  @Get("redx/stores")
  redxStores(@Param("organizationId") orgId: string) { return this.courier.redxStores(orgId); }

  @Get("shipments")
  list(@Param("organizationId") orgId: string, @Query("orderId") orderId?: string) {
    return this.courier.listShipments(orgId, orderId);
  }

  @Post("shipments") @UseGuards(RolesGuard) @Roles("OWNER", "ADMIN", "MARKETING_MANAGER", "SUPPORT_AGENT")
  book(@CurrentUser() user: AuthUser, @Param("organizationId") orgId: string, @Body() dto: BookShipmentDto) {
    return this.courier.bookShipment(orgId, user.userId, dto);
  }

  @Post("shipments/:shipmentId/sync") @UseGuards(RolesGuard) @Roles("OWNER", "ADMIN", "MARKETING_MANAGER", "SUPPORT_AGENT")
  sync(@Param("organizationId") orgId: string, @Param("shipmentId") id: string) {
    return this.courier.syncShipment(orgId, id);
  }

  @Post("sync-all") @UseGuards(RolesGuard) @Roles("OWNER", "ADMIN", "MARKETING_MANAGER", "SUPPORT_AGENT")
  syncAll(@Param("organizationId") orgId: string) { return this.courier.syncAll(orgId); }
}
