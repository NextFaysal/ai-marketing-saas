import { Controller, Get, Param, Query, UseGuards } from "@nestjs/common";
import { OrderTeamPerformanceService } from "./order-team-performance.service";
import { PermissionArea } from "../common/decorators";
import { TenantGuard } from "../common/tenant.guard";
import { RolesGuard } from "../common/roles.guard";

/**
 * ON12 — Team Performance endpoint. Same prefix as
 * OrdersController; this controller is registered BEFORE
 * OrdersController in OrdersModule so the literal
 * "team-performance" segment wins over its ":orderId" route
 * (the ON9/ON10 pattern). Read-only: reads ride the class-level
 * TenantGuard + @PermissionArea("orders") read permission via
 * RolesGuard — the same permission system (OB1–OB3) that gates
 * every other orders surface; ON12 adds no permission layer.
 */
@PermissionArea("orders")
@Controller("organizations/:organizationId/orders")
@UseGuards(TenantGuard, RolesGuard)
export class OrderTeamPerformanceController {
  constructor(private readonly team: OrderTeamPerformanceService) {}

  @Get("team-performance")
  getTeamPerformance(@Param("organizationId") orgId: string, @Query("from") from?: string, @Query("to") to?: string) {
    return this.team.getTeamPerformance(orgId, from, to);
  }
}
