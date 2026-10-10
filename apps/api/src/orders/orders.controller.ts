import { Controller, Get, Param, Query, UseGuards } from "@nestjs/common";
import { OrdersService } from "./orders.service";
import { TenantGuard } from "../common/tenant.guard";

@Controller("organizations/:organizationId/orders")
@UseGuards(TenantGuard)
export class OrdersController {
  constructor(private readonly orders: OrdersService) {}

  @Get("stats")
  stats(@Param("organizationId") orgId: string) { return this.orders.stats(orgId); }

  @Get()
  list(@Param("organizationId") orgId: string, @Query() q: { status?: string; cod?: string; page?: string; pageSize?: string }) {
    return this.orders.list(orgId, {
      status: q.status, isCod: q.cod === undefined ? undefined : q.cod === "true",
      page: q.page ? Number(q.page) : undefined, pageSize: q.pageSize ? Number(q.pageSize) : undefined,
    });
  }

  @Get(":orderId")
  getOne(@Param("organizationId") orgId: string, @Param("orderId") id: string) { return this.orders.getOne(orgId, id); }
}
