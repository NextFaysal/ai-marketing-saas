import { Body, Controller, Get, Header, Param, Patch, Post, Query, UseGuards } from "@nestjs/common";
import { OrdersService } from "./orders.service";
import { CreateManualOrderDto, UpdateOrderDto, MergeOrdersDto, AssignAgentDto, BulkAssignAgentDto, StaffScoreboardQueryDto } from "./orders.dto";
import { CurrentUser, AuthUser, Roles, PermissionArea } from "../common/decorators";
import { TenantGuard } from "../common/tenant.guard";
import { RolesGuard } from "../common/roles.guard";

@PermissionArea("orders")
@Controller("organizations/:organizationId/orders")
@UseGuards(TenantGuard, RolesGuard)
export class OrdersController {
  constructor(private readonly orders: OrdersService) {}

  /** Feature 5: Staff Performance & Sales Attribution Scoreboard */
  @Get("scoreboard")
  scoreboard(
    @Param("organizationId") orgId: string,
    @Query("from") from?: string,
    @Query("to") to?: string,
    @Query("commission") commission?: string,
  ) {
    const commissionNum = commission ? parseFloat(commission) : undefined;
    return this.orders.getStaffScoreboard(orgId, {
      from,
      to,
      commissionPerDeliveryBdt: isNaN(commissionNum!) ? undefined : commissionNum,
    });
  }

  /** Feature 5: Bulk assign orders to a staff agent */
  @Post("bulk-assign")
  @UseGuards(RolesGuard)
  @Roles("OWNER", "ADMIN", "MARKETING_MANAGER")
  bulkAssign(
    @Param("organizationId") orgId: string,
    @Body() dto: BulkAssignAgentDto,
  ) {
    return this.orders.bulkAssignAgent(orgId, dto.orderIds, dto.agentId);
  }

  /** Milestone 65: record a phone/counter order manually. */
  @Post() @UseGuards(RolesGuard) @Roles("OWNER", "ADMIN", "MARKETING_MANAGER", "SUPPORT_AGENT")
  createManual(@CurrentUser() user: AuthUser, @Param("organizationId") orgId: string, @Body() dto: CreateManualOrderDto) {
    return this.orders.createManual(orgId, user.userId, dto);
  }

  @Get("stats")
  stats(@Param("organizationId") orgId: string) { return this.orders.stats(orgId); }

  /** Feature 2: find duplicate orders placed by the same customer/phone. */
  @Get("duplicates")
  duplicates(@Param("organizationId") orgId: string) {
    return this.orders.findDuplicates(orgId);
  }

  /** Feature 2: merge multiple duplicate orders into one primary order. */
  @Post("merge")
  @UseGuards(RolesGuard)
  @Roles("OWNER", "ADMIN", "MARKETING_MANAGER", "SUPPORT_AGENT")
  merge(
    @CurrentUser() user: AuthUser,
    @Param("organizationId") orgId: string,
    @Body() dto: MergeOrdersDto,
  ) {
    return this.orders.mergeOrders(orgId, user.userId, dto);
  }

  @Get()
  list(@Param("organizationId") orgId: string, @Query() q: { status?: string; cod?: string; page?: string; pageSize?: string }) {
    return this.orders.list(orgId, {
      status: q.status, isCod: q.cod === undefined ? undefined : q.cod === "true",
      page: q.page ? Number(q.page) : undefined, pageSize: q.pageSize ? Number(q.pageSize) : undefined,
    });
  }

  /** Sales & Data S3: CSV export of this org's orders only.
   * Declared before ":orderId/risk" / ":orderId" so the literal
   * "export" wins over the parameter routes. */
  @Get("export") @Header("Content-Type", "text/csv; charset=utf-8") @Header("Content-Disposition", "attachment; filename=orders-export.csv")
  exportCsv(@Param("organizationId") orgId: string, @Query() q: { status?: string; cod?: string; from?: string; to?: string }) {
    return this.orders.exportCsv(orgId, {
      status: q.status, isCod: q.cod === undefined ? undefined : q.cod === "true",
      from: q.from, to: q.to,
    });
  }

  @Get(":orderId/risk")
  risk(@Param("organizationId") orgId: string, @Param("orderId") id: string) { return this.orders.riskForOrder(orgId, id); }

  @Get(":orderId")
  getOne(@Param("organizationId") orgId: string, @Param("orderId") id: string) { return this.orders.getOne(orgId, id); }

  /** Sales & Data S2: order actions — status change, refund
   * recording, internal note (each independently optional). */
  @Patch(":orderId") @UseGuards(RolesGuard) @Roles("OWNER", "ADMIN", "MARKETING_MANAGER", "SUPPORT_AGENT")
  update(@CurrentUser() user: AuthUser, @Param("organizationId") orgId: string, @Param("orderId") id: string, @Body() dto: UpdateOrderDto) {
    return this.orders.updateOrder(orgId, user.userId, id, dto);
  }

  /** Feature 5: Assign specific agent to an order */
  @Patch(":orderId/assign")
  @UseGuards(RolesGuard)
  @Roles("OWNER", "ADMIN", "MARKETING_MANAGER", "SUPPORT_AGENT")
  assign(
    @Param("organizationId") orgId: string,
    @Param("orderId") id: string,
    @Body() dto: AssignAgentDto,
  ) {
    return this.orders.assignAgent(orgId, id, dto.agentId, dto.commissionMinor);
  }
}
