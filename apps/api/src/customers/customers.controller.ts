import { Body, Controller, Get, Header, Param, Patch, Post, Query, UseGuards } from "@nestjs/common";
import { CustomersService } from "./customers.service";
import { CurrentUser, AuthUser, Roles, PermissionArea } from "../common/decorators";
import { TenantGuard } from "../common/tenant.guard";
import { RolesGuard } from "../common/roles.guard";
import { IsObject, IsOptional, IsString } from "class-validator";

class MergeDto { @IsString() sourceId!: string; @IsString() targetId!: string; }

/** CRM C4: contact basics + custom fields (validated in the service). */
class UpdateCustomerDto {
  @IsOptional() @IsString() firstName?: string | null;
  @IsOptional() @IsString() lastName?: string | null;
  @IsOptional() @IsString() email?: string | null;
  @IsOptional() @IsString() phone?: string | null;
  @IsOptional() @IsObject() customFields?: Record<string, unknown> | null;
}

@PermissionArea("customers")
@Controller("organizations/:organizationId/customers")
@UseGuards(TenantGuard, RolesGuard)
export class CustomersController {
  constructor(private readonly customers: CustomersService) {}

  @Get()
  list(@Param("organizationId") orgId: string, @Query("q") q?: string) {
    return this.customers.list(orgId, q);
  }

  /** CRM C3: CSV export of this org's customers only. Declared
   * before ":customerId" so the literal wins over the parameter. */
  @Get("export") @Header("Content-Type", "text/csv; charset=utf-8") @Header("Content-Disposition", "attachment; filename=customers-export.csv")
  exportCsv(@Param("organizationId") orgId: string) {
    return this.customers.exportCsv(orgId);
  }

  @Get(":customerId")
  detail(@Param("organizationId") orgId: string, @Param("customerId") id: string) {
    return this.customers.detail(orgId, id);
  }

  /** CRM C4: first customer PATCH — contact basics + custom fields. */
  @Patch(":customerId") @UseGuards(RolesGuard) @Roles("OWNER", "ADMIN", "SUPPORT_AGENT")
  update(@CurrentUser() user: AuthUser, @Param("organizationId") orgId: string, @Param("customerId") id: string, @Body() dto: UpdateCustomerDto) {
    return this.customers.update(orgId, user.userId, id, dto);
  }

  @Post("merge") @UseGuards(RolesGuard) @Roles("OWNER", "ADMIN")
  merge(@CurrentUser() user: AuthUser, @Param("organizationId") orgId: string, @Body() dto: MergeDto) {
    return this.customers.merge(orgId, user.userId, dto);
  }
}
