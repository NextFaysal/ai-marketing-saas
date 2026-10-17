import { Body, Controller, Get, Param, Post, Query, UseGuards } from "@nestjs/common";
import { SubscriptionsService } from "./subscriptions.service";
import { AutoChargeConsentDto, CreateSubscriptionDto } from "./subscriptions.dto";
import { CurrentUser, AuthUser, Roles, PermissionArea } from "../common/decorators";
import { TenantGuard } from "../common/tenant.guard";
import { RolesGuard } from "../common/roles.guard";

const WRITE_ROLES = ["OWNER", "ADMIN", "MARKETING_MANAGER"] as const;

/** EC24c: staff-managed customer subscriptions. Staff-created
 * only in v1 — there is no public/self-serve route by design. */
@PermissionArea("customers")
@Controller("organizations/:organizationId/subscriptions")
@UseGuards(TenantGuard, RolesGuard)
export class SubscriptionsController {
  constructor(private readonly subscriptions: SubscriptionsService) {}

  @Post()
  @Roles(...WRITE_ROLES)
  create(
    @CurrentUser() user: AuthUser,
    @Param("organizationId") orgId: string,
    @Body() dto: CreateSubscriptionDto,
  ) {
    return this.subscriptions.create(orgId, user.userId, dto);
  }

  @Get()
  list(
    @Param("organizationId") orgId: string,
    @Query("status") status?: string,
    @Query("customerId") customerId?: string,
  ) {
    return this.subscriptions.list(orgId, { status, customerId });
  }

  @Get(":subscriptionId")
  getOne(@Param("organizationId") orgId: string, @Param("subscriptionId") id: string) {
    return this.subscriptions.getOne(orgId, id);
  }

  @Post(":subscriptionId/pause")
  @Roles(...WRITE_ROLES)
  pause(@CurrentUser() user: AuthUser, @Param("organizationId") orgId: string, @Param("subscriptionId") id: string) {
    return this.subscriptions.pause(orgId, user.userId, id);
  }

  @Post(":subscriptionId/resume")
  @Roles(...WRITE_ROLES)
  resume(@CurrentUser() user: AuthUser, @Param("organizationId") orgId: string, @Param("subscriptionId") id: string) {
    return this.subscriptions.resume(orgId, user.userId, id);
  }

  /** OU12: record/withdraw the customer's auto-charge consent.
   * Consent ONLY — charging is not active; see the service. */
  @Post(":subscriptionId/auto-charge-consent")
  @Roles(...WRITE_ROLES)
  setAutoChargeConsent(@CurrentUser() user: AuthUser, @Param("organizationId") orgId: string, @Param("subscriptionId") id: string, @Body() dto: AutoChargeConsentDto) {
    return this.subscriptions.setAutoChargeConsent(orgId, user.userId, id, dto);
  }

  @Post(":subscriptionId/cancel")
  @Roles(...WRITE_ROLES)
  cancel(@CurrentUser() user: AuthUser, @Param("organizationId") orgId: string, @Param("subscriptionId") id: string) {
    return this.subscriptions.cancel(orgId, user.userId, id);
  }
}
