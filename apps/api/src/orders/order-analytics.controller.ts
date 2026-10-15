import { Controller, Get, Param, Post, Query, UseGuards } from "@nestjs/common";
import { OrderAnalyticsService } from "./order-analytics.service";
import { CurrentUser, AuthUser, Roles, PermissionArea } from "../common/decorators";
import { TenantGuard } from "../common/tenant.guard";
import { RolesGuard } from "../common/roles.guard";

const WRITE_ROLES = ["OWNER", "ADMIN", "MARKETING_MANAGER", "SUPPORT_AGENT"] as const;

/**
 * ON9 — Orders Analytics v2 + Owner Digest endpoints. Same
 * prefix as OrdersController; this controller is registered
 * BEFORE OrdersController in OrdersModule so the literal
 * "analytics" / "digest" segments win over its ":orderId" route.
 * Reads ride the class-level TenantGuard + @PermissionArea
 * ("orders") read permission; send-now is a write (audited in
 * the service as the run's AuditLog row).
 */
@PermissionArea("orders")
@Controller("organizations/:organizationId/orders")
@UseGuards(TenantGuard, RolesGuard)
export class OrderAnalyticsController {
  constructor(private readonly analytics: OrderAnalyticsService) {}

  @Get("analytics")
  getAnalytics(@Param("organizationId") orgId: string, @Query("from") from?: string, @Query("to") to?: string) {
    return this.analytics.getAnalytics(orgId, from, to);
  }

  @Get("digest/status")
  digestStatus(@Param("organizationId") orgId: string) {
    return this.analytics.digestStatus(orgId);
  }

  @Post("digest/send-now") @UseGuards(RolesGuard) @Roles(...WRITE_ROLES)
  sendNow(@CurrentUser() user: AuthUser, @Param("organizationId") orgId: string) {
    return this.analytics.sendDigest(orgId, "today", user.userId);
  }
}
