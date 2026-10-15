import { Body, Controller, Delete, Get, Param, Patch, Post, Query, UseGuards } from "@nestjs/common";
import { OrderAutomationService } from "./order-automation.service";
import { CurrentUser, AuthUser, Roles, PermissionArea } from "../common/decorators";
import { TenantGuard } from "../common/tenant.guard";
import { RolesGuard } from "../common/roles.guard";

const WRITE_ROLES = ["OWNER", "ADMIN", "MARKETING_MANAGER", "SUPPORT_AGENT"] as const;

/**
 * ON8 — Orders Automation Studio endpoints. Route prefix
 * mirrors OrdersController
 * (organizations/:organizationId/orders → here
 * organizations/:organizationId/order-automation) so the
 * studio lives beside the other orders surfaces. All rule
 * payloads are validated in the service against the ON8
 * vocabulary (unknown trigger/condition/action → 400 in
 * Bengali naming the bad key); all writes are audited in
 * the service. Literal "presets" routes are declared
 * BEFORE "rules/:id" so they win routing.
 */
@PermissionArea("orders")
@Controller("organizations/:organizationId/order-automation")
@UseGuards(TenantGuard, RolesGuard)
export class OrderAutomationController {
  constructor(private readonly automation: OrderAutomationService) {}

  @Get("presets")
  presets(@Param("organizationId") orgId: string) {
    return this.automation.listPresets(orgId);
  }

  @Post("presets/:key/install") @UseGuards(RolesGuard) @Roles(...WRITE_ROLES)
  installPreset(@CurrentUser() user: AuthUser, @Param("organizationId") orgId: string, @Param("key") key: string) {
    return this.automation.installPreset(orgId, user.userId, key);
  }

  @Get("rules")
  listRules(@Param("organizationId") orgId: string) {
    return this.automation.listRules(orgId);
  }

  @Post("rules") @UseGuards(RolesGuard) @Roles(...WRITE_ROLES)
  createRule(@CurrentUser() user: AuthUser, @Param("organizationId") orgId: string, @Body() body: any) {
    return this.automation.createRule(orgId, user.userId, body);
  }

  @Get("rules/:id")
  getRule(@Param("organizationId") orgId: string, @Param("id") id: string) {
    return this.automation.getRule(orgId, id);
  }

  @Patch("rules/:id") @UseGuards(RolesGuard) @Roles(...WRITE_ROLES)
  updateRule(@CurrentUser() user: AuthUser, @Param("organizationId") orgId: string, @Param("id") id: string, @Body() body: any) {
    return this.automation.updateRule(orgId, user.userId, id, body);
  }

  @Delete("rules/:id") @UseGuards(RolesGuard) @Roles(...WRITE_ROLES)
  deleteRule(@CurrentUser() user: AuthUser, @Param("organizationId") orgId: string, @Param("id") id: string) {
    return this.automation.deleteRule(orgId, user.userId, id);
  }

  @Get("rules/:id/logs")
  listRuleLogs(@Param("organizationId") orgId: string, @Param("id") id: string, @Query("page") page?: string, @Query("pageSize") pageSize?: string) {
    return this.automation.listRuleLogs(orgId, id, {
      page: page ? Number(page) : undefined,
      pageSize: pageSize ? Number(pageSize) : undefined,
    });
  }

  @Get("orders/:orderId/automation-logs")
  listOrderLogs(@Param("organizationId") orgId: string, @Param("orderId") orderId: string) {
    return this.automation.listOrderLogs(orgId, orderId);
  }
}
