import { Body, Controller, Get, Param, Post, Query, UseGuards } from "@nestjs/common";
import { InventoryService } from "./inventory.service";
import { StockAdjustmentDto } from "./inventory.dto";
import { CurrentUser, AuthUser, Roles } from "../common/decorators";
import { TenantGuard } from "../common/tenant.guard";
import { RolesGuard } from "../common/roles.guard";

// Same route prefix + guard shape as ProductsController:
// TenantGuard at class level, RolesGuard per write route.
@Controller("organizations/:organizationId/products")
@UseGuards(TenantGuard)
export class InventoryController {
  constructor(private readonly inventory: InventoryService) {}

  @Get(":productId/movements")
  listMovements(
    @Param("organizationId") orgId: string,
    @Param("productId") productId: string,
    @Query() q: { page?: string; pageSize?: string },
  ) {
    return this.inventory.listMovements(orgId, productId, {
      page: q.page ? Number(q.page) : undefined,
      pageSize: q.pageSize ? Number(q.pageSize) : undefined,
    });
  }

  @Post(":productId/stock-adjustment") @UseGuards(RolesGuard) @Roles("OWNER", "ADMIN", "MARKETING_MANAGER")
  adjust(
    @CurrentUser() user: AuthUser,
    @Param("organizationId") orgId: string,
    @Param("productId") productId: string,
    @Body() dto: StockAdjustmentDto,
  ) {
    return this.inventory.adjust(orgId, user.userId, productId, dto);
  }
}

@Controller("organizations/:organizationId/inventory")
@UseGuards(TenantGuard)
export class InventoryIntelligenceController {
  constructor(private readonly inventory: InventoryService) {}

  @Get("forecast")
  forecast(
    @Param("organizationId") orgId: string,
    @Query() q: { lookbackDays?: string; targetCoverDays?: string },
  ) {
    return this.inventory.getInventoryForecast(orgId, {
      lookbackDays: q.lookbackDays ? Number(q.lookbackDays) : undefined,
      targetCoverDays: q.targetCoverDays ? Number(q.targetCoverDays) : undefined,
    });
  }
}
