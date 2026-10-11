import { Body, Controller, Get, Param, Post, Query, UseGuards } from "@nestjs/common";
import { OrdersService } from "./orders.service";
import { CreateManualOrderDto } from "./orders.dto";
import { CurrentUser, AuthUser, Roles } from "../common/decorators";
import { TenantGuard } from "../common/tenant.guard";
import { RolesGuard } from "../common/roles.guard";

@Controller("organizations/:organizationId/orders")
@UseGuards(TenantGuard)
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

  @Get(":orderId/risk")
  risk(@Param("organizationId") orgId: string, @Param("orderId") id: string) { return this.orders.riskForOrder(orgId, id); }

  @Get(":orderId")
  getOne(@Param("organizationId") orgId: string, @Param("orderId") id: string) { return this.orders.getOne(orgId, id); }
}
