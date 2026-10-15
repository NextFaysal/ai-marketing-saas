import { Controller, Get, Header, Param, Query, UseGuards } from "@nestjs/common";
import { OrderProfitService } from "./order-profit.service";
import { PermissionArea } from "../common/decorators";
import { TenantGuard } from "../common/tenant.guard";
import { RolesGuard } from "../common/roles.guard";

/**
 * ON7 — profit + COD board reads. Same prefix as OrdersController
 * (organizations/:organizationId/orders); the coordinator wires
 * this controller into OrdersModule at integration.
 *
 * Route safety: the literal "reports/*" routes are declared
 * BEFORE ":orderId/profit" inside this controller so
 * "reports/profit" can never be read as orderId="reports".
 * Against OrdersController, every route here has a segment shape
 * no OrdersController pattern matches (":orderId" alone is one
 * segment; there is no ":orderId/profit" there).
 * Reads are staff reads: class-level TenantGuard + RolesGuard,
 * exactly like OrdersController.
 */
@PermissionArea("orders")
@Controller("organizations/:organizationId/orders")
@UseGuards(TenantGuard, RolesGuard)
export class OrderProfitController {
  constructor(private readonly profit: OrderProfitService) {}

  @Get("reports/profit")
  profitReport(
    @Param("organizationId") orgId: string,
    @Query("from") from?: string,
    @Query("to") to?: string,
  ) {
    return this.profit.getProfitReport(orgId, { from, to });
  }

  @Get("reports/profit.csv")
  @Header("Content-Type", "text/csv; charset=utf-8")
  @Header("Content-Disposition", "attachment; filename=profit-report.csv")
  profitReportCsv(
    @Param("organizationId") orgId: string,
    @Query("from") from?: string,
    @Query("to") to?: string,
  ) {
    return this.profit.getProfitReportCsv(orgId, { from, to });
  }

  @Get("reports/cod-board")
  codBoard(@Param("organizationId") orgId: string) {
    return this.profit.getCodBoard(orgId);
  }

  @Get(":orderId/profit")
  orderProfit(@Param("organizationId") orgId: string, @Param("orderId") orderId: string) {
    return this.profit.getOrderProfit(orgId, orderId);
  }
}
