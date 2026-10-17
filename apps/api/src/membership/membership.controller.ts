import { Body, Controller, Delete, Get, Param, Patch, Post, UseGuards } from "@nestjs/common";
import { MembershipService } from "./membership.service";
import { StoreCreditService } from "./store-credit.service";
import {
  CreateTierDto, GrantStoreCreditDto, RefundToCreditDto, UpdateTierDto,
} from "./membership.dto";
import { CurrentUser, AuthUser, Roles, PermissionArea } from "../common/decorators";
import { TenantGuard } from "../common/tenant.guard";
import { RolesGuard } from "../common/roles.guard";

/**
 * NF7 (FB3) — staff surface for membership tiers + store
 * credit. @PermissionArea("customers") — tiers and credit live
 * where staff already manage customers. Tier-definition writes
 * and credit money movements are OWNER/ADMIN; reads use the
 * booking / live-commerce four-role read set. The tier
 * PRICE-LIST routes live on CommerceController beside the
 * group price lists (same PriceListsService machinery), and
 * the refund-to-credit SETTING toggle lives beside EC5's
 * refund-push toggle there too.
 */
const READ_ROLES = ["OWNER", "ADMIN", "MARKETING_MANAGER", "SUPPORT_AGENT"] as const;
const WRITE_ROLES = ["OWNER", "ADMIN"] as const;

@PermissionArea("customers")
@Controller("organizations/:organizationId")
@UseGuards(TenantGuard, RolesGuard)
export class MembershipController {
  constructor(
    private readonly membership: MembershipService,
    private readonly credit: StoreCreditService,
  ) {}

  // ---------- tier definitions ----------

  @Get("membership/tiers") @Roles(...READ_ROLES)
  listTiers(@Param("organizationId") orgId: string) {
    return this.membership.listTiers(orgId);
  }

  @Post("membership/tiers") @Roles(...WRITE_ROLES)
  createTier(
    @CurrentUser() user: AuthUser,
    @Param("organizationId") orgId: string,
    @Body() dto: CreateTierDto,
  ) {
    return this.membership.createTier(orgId, user.userId, dto);
  }

  @Patch("membership/tiers/:tierId") @Roles(...WRITE_ROLES)
  updateTier(
    @CurrentUser() user: AuthUser,
    @Param("organizationId") orgId: string,
    @Param("tierId") tierId: string,
    @Body() dto: UpdateTierDto,
  ) {
    return this.membership.updateTier(orgId, user.userId, tierId, dto);
  }

  @Delete("membership/tiers/:tierId") @Roles(...WRITE_ROLES)
  deleteTier(
    @CurrentUser() user: AuthUser,
    @Param("organizationId") orgId: string,
    @Param("tierId") tierId: string,
  ) {
    return this.membership.deleteTier(orgId, user.userId, tierId);
  }

  @Post("membership/recompute") @Roles(...WRITE_ROLES)
  recomputeAll(@Param("organizationId") orgId: string) {
    return this.membership.recomputeAll(orgId);
  }

  // ---------- per-customer tier + credit ----------

  @Get("customers/:customerId/membership") @Roles(...READ_ROLES)
  getCustomerMembership(
    @Param("organizationId") orgId: string,
    @Param("customerId") customerId: string,
  ) {
    return this.membership.getCustomerTier(orgId, customerId);
  }

  @Post("customers/:customerId/membership/recompute") @Roles(...WRITE_ROLES)
  recomputeCustomer(
    @Param("organizationId") orgId: string,
    @Param("customerId") customerId: string,
  ) {
    return this.membership.recomputeCustomer(orgId, customerId).then((tier) => ({ tier }));
  }

  @Get("customers/:customerId/store-credit") @Roles(...READ_ROLES)
  getCustomerCredit(
    @Param("organizationId") orgId: string,
    @Param("customerId") customerId: string,
  ) {
    return this.credit.getCustomerCredit(orgId, customerId);
  }

  @Post("customers/:customerId/store-credit/grant") @Roles(...WRITE_ROLES)
  grantCredit(
    @CurrentUser() user: AuthUser,
    @Param("organizationId") orgId: string,
    @Param("customerId") customerId: string,
    @Body() dto: GrantStoreCreditDto,
  ) {
    return this.credit.grantManual(orgId, user.userId, customerId, dto);
  }

  /** Refund an order INTO the customer's store credit. Refused
   * (403) while the per-store refund-to-credit setting is OFF —
   * see StoreCreditService for the gate + exactly-once rules. */
  @Post("orders/:orderId/refund-to-credit") @Roles(...WRITE_ROLES)
  refundToCredit(
    @CurrentUser() user: AuthUser,
    @Param("organizationId") orgId: string,
    @Param("orderId") orderId: string,
    @Body() dto: RefundToCreditDto,
  ) {
    return this.credit.refundToCredit(orgId, user.userId, orderId, dto);
  }
}
