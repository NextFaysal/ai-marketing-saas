import { Body, Controller, Get, Header, Param, Patch, Post, Query, UseGuards } from "@nestjs/common";
import { OrdersService } from "./orders.service";
import { CreateManualOrderDto, UpdateOrderDto } from "./orders.dto";
import { CurrentUser, AuthUser, Roles, PermissionArea } from "../common/decorators";
import { TenantGuard } from "../common/tenant.guard";
import { RolesGuard } from "../common/roles.guard";

@PermissionArea("orders")
@Controller("organizations/:organizationId/orders")
@UseGuards(TenantGuard, RolesGuard)
export class OrdersController {
  constructor(private readonly orders: OrdersService) {}

  /** Milestone 65: record a phone/counter order manually. */
  @Post() @UseGuards(RolesGuard) @Roles("OWNER", "ADMIN", "MARKETING_MANAGER", "SUPPORT_AGENT")
  createManual(@CurrentUser() user: AuthUser, @Param("organizationId") orgId: string, @Body() dto: CreateManualOrderDto) {
    return this.orders.createManual(orgId, user.userId, dto);
  }

  @Get("stats")
  stats(@Param("organizationId") orgId: string) { return this.orders.stats(orgId); }

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
}
