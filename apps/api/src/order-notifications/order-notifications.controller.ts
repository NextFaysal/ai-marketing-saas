import { Body, Controller, Get, Param, Put, UseGuards } from "@nestjs/common";
import { OrderNotificationService } from "./order-notifications.service";
import { CurrentUser, AuthUser, Roles, PermissionArea } from "../common/decorators";
import { TenantGuard } from "../common/tenant.guard";
import { RolesGuard } from "../common/roles.guard";

const WRITE_ROLES = ["OWNER", "ADMIN", "MARKETING_MANAGER", "SUPPORT_AGENT"] as const;

/**
 * ON5 — staff endpoints for the transactional notification
 * engine. Route prefix mirrors OrdersController
 * (organizations/:organizationId/orders) so the settings +
 * per-order log live beside the other orders literals; the PUT
 * is audited inside the service.
 */
@PermissionArea("orders")
@Controller("organizations/:organizationId/orders")
@UseGuards(TenantGuard, RolesGuard)
export class OrderNotificationsController {
  constructor(private readonly notifications: OrderNotificationService) {}

  @Get("notification-settings")
  getSettings(@Param("organizationId") orgId: string) {
    return this.notifications.getSettings(orgId);
  }

  @Put("notification-settings") @UseGuards(RolesGuard) @Roles(...WRITE_ROLES)
  updateSettings(@CurrentUser() user: AuthUser, @Param("organizationId") orgId: string, @Body() body: any) {
    // Accept either the config object itself or { config }.
    const config = body && typeof body === "object" && "config" in body ? body.config : body;
    return this.notifications.updateSettings(orgId, user.userId, config);
  }

  @Get(":orderId/notification-logs")
  listLogs(@Param("organizationId") orgId: string, @Param("orderId") orderId: string) {
    return this.notifications.listLogs(orgId, orderId);
  }
}
