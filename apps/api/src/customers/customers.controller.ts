import { Body, Controller, Get, Header, Param, Patch, Post, Query, UseGuards } from "@nestjs/common";
import { CustomersService } from "./customers.service";
import { CustomerPushService } from "../commerce/customer-push.service";
import { CurrentUser, AuthUser, Roles, PermissionArea } from "../common/decorators";
import { TenantGuard } from "../common/tenant.guard";
import { RolesGuard } from "../common/roles.guard";
import { IsBoolean, IsObject, IsOptional, IsString } from "class-validator";

class MergeDto { @IsString() sourceId!: string; @IsString() targetId!: string; }

class UnmergeDto { @IsString() sourceId!: string; }

/** CRM C4: contact basics + custom fields (validated in the service). */
class UpdateCustomerDto {
  @IsOptional() @IsString() firstName?: string | null;
  @IsOptional() @IsString() lastName?: string | null;
  @IsOptional() @IsString() email?: string | null;
  @IsOptional() @IsString() phone?: string | null;
  @IsOptional() @IsObject() customFields?: Record<string, unknown> | null;
  /** EC24d: staff-set wholesale flag (tier pricing at shop checkout). */
  @IsOptional() @IsBoolean() isWholesale?: boolean;
  /** ON7: credit limit in minor units (string), or null to clear. */
  @IsOptional() @IsString() creditLimitMinor?: string | null;
}

@PermissionArea("customers")
@Controller("organizations/:organizationId/customers")
@UseGuards(TenantGuard, RolesGuard)
export class CustomersController {
  constructor(private readonly customers: CustomersService, private readonly customerPush: CustomerPushService) {}

  @Get()
  list(@Param("organizationId") orgId: string, @Query("q") q?: string, @Query("hasDue") hasDue?: string) {
    return this.customers.list(orgId, q, { hasDue: hasDue === "true" || hasDue === "1" });
  }

  /** CRM C3: CSV export of this org's customers only. Declared
   * before ":customerId" so the literal wins over the parameter. */
  @Get("export") @Header("Content-Type", "text/csv; charset=utf-8") @Header("Content-Disposition", "attachment; filename=customers-export.csv")
  exportCsv(@Param("organizationId") orgId: string) {
    return this.customers.exportCsv(orgId);
  }

  /** ON7: customer খাতা (ledger). Declared before ":customerId"
   * so the two-segment route is never shadowed. */
  @Get(":customerId/khata")
  khata(@Param("organizationId") orgId: string, @Param("customerId") id: string) {
    return this.customers.getKhata(orgId, id);
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

  /** EC6: push this customer to a store (co-manage/full-manage only). */
  @Post(":customerId/push-to-store/:storeId") @UseGuards(RolesGuard) @Roles("OWNER", "ADMIN", "SUPPORT_AGENT")
  pushToStore(@CurrentUser() user: AuthUser, @Param("organizationId") orgId: string, @Param("customerId") customerId: string, @Param("storeId") storeId: string) {
    return this.customerPush.pushToStore(orgId, user.userId, customerId, storeId);
  }

  /** CP6: GDPR deep erasure — PII is removed; order financial
   *  records are kept. OWNER/ADMIN only. Returns the counts. */
  @Post(":customerId/erase") @UseGuards(RolesGuard) @Roles("OWNER", "ADMIN")
  erase(@CurrentUser() user: AuthUser, @Param("organizationId") orgId: string, @Param("customerId") id: string) {
    return this.customers.eraseCustomer(orgId, user.userId, id);
  }

  /** IN2: undo a merge (the IN2 merge record makes it exact). */
  @Post("unmerge") @UseGuards(RolesGuard) @Roles("OWNER", "ADMIN")
  unmerge(@CurrentUser() user: AuthUser, @Param("organizationId") orgId: string, @Body() dto: UnmergeDto) {
    return this.customers.unmerge(orgId, user.userId, dto);
  }
}
