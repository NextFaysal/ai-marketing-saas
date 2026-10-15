import { Body, Controller, Get, Param, Post, Query, UseGuards } from "@nestjs/common";
import { PosService } from "./pos.service";
import { CreatePosSaleDto } from "./pos.dto";
import { CurrentUser, AuthUser, Roles, PermissionArea } from "../common/decorators";
import { TenantGuard } from "../common/tenant.guard";
import { RolesGuard } from "../common/roles.guard";

const WRITE_ROLES = ["OWNER", "ADMIN", "MARKETING_MANAGER", "SUPPORT_AGENT"] as const;

/**
 * EC34 — POS / কাউন্টার বিক্রি staff surface. Search + today's
 * sales are staff reads (any role that can see the orders area);
 * completing a sale is a WRITE role action.
 */
@PermissionArea("orders")
@Controller("organizations/:organizationId")
@UseGuards(TenantGuard, RolesGuard)
export class PosController {
  constructor(private readonly pos: PosService) {}

  @Get("pos/search")
  search(@Param("organizationId") orgId: string, @Query("q") q?: string) {
    return this.pos.search(orgId, q);
  }

  @Get("pos/today")
  today(@Param("organizationId") orgId: string) {
    return this.pos.today(orgId);
  }

  @Post("pos/sale") @UseGuards(RolesGuard) @Roles(...WRITE_ROLES)
  createSale(
    @CurrentUser() user: AuthUser,
    @Param("organizationId") orgId: string,
    @Body() dto: CreatePosSaleDto,
  ) {
    return this.pos.createSale(orgId, user.userId, dto);
  }
}
