import { Body, Controller, Post, Param, UseGuards } from "@nestjs/common";
import { IsArray, IsObject, IsOptional, IsString } from "class-validator";
import { OrdersBulkService } from "./orders-bulk.service";
import { CurrentUser, AuthUser, Roles, PermissionArea } from "../common/decorators";
import { TenantGuard } from "../common/tenant.guard";
import { RolesGuard } from "../common/roles.guard";

export class OrdersBulkDto {
  @IsArray() orderIds!: string[];
  @IsString() action!: string;
  @IsOptional() @IsObject() params?: {
    status?: string;
    tag?: string;
    assigneeId?: string | null;
    provider?: string;
  };
}

/**
 * ON1 bulk endpoint. Deliberately its own controller on the
 * orders path (hosted by FulfillmentModule — see the service
 * header for the module-cycle reason). ONLY route: POST bulk.
 */
@PermissionArea("orders")
@Controller("organizations/:organizationId/orders")
@UseGuards(TenantGuard, RolesGuard)
export class OrdersBulkController {
  constructor(private readonly bulkService: OrdersBulkService) {}

  @Post("bulk") @UseGuards(RolesGuard) @Roles("OWNER", "ADMIN", "MARKETING_MANAGER", "SUPPORT_AGENT")
  bulk(@CurrentUser() user: AuthUser, @Param("organizationId") orgId: string, @Body() dto: OrdersBulkDto) {
    return this.bulkService.bulk(orgId, user.userId, dto);
  }
}
