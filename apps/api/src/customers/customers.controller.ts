import { Body, Controller, Get, Param, Post, Query, UseGuards } from "@nestjs/common";
import { CustomersService } from "./customers.service";
import { CurrentUser, AuthUser, Roles } from "../common/decorators";
import { TenantGuard } from "../common/tenant.guard";
import { RolesGuard } from "../common/roles.guard";
import { IsString } from "class-validator";

class MergeDto { @IsString() sourceId!: string; @IsString() targetId!: string; }

@Controller("organizations/:organizationId/customers")
@UseGuards(TenantGuard)
export class CustomersController {
  constructor(private readonly customers: CustomersService) {}

  @Get()
  list(@Param("organizationId") orgId: string, @Query("q") q?: string) {
    return this.customers.list(orgId, q);
  }

  @Get(":customerId")
  detail(@Param("organizationId") orgId: string, @Param("customerId") id: string) {
    return this.customers.detail(orgId, id);
  }

  @Post("merge") @UseGuards(RolesGuard) @Roles("OWNER", "ADMIN")
  merge(@CurrentUser() user: AuthUser, @Param("organizationId") orgId: string, @Body() dto: MergeDto) {
    return this.customers.merge(orgId, user.userId, dto);
  }
}
