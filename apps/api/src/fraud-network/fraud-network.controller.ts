import { Body, Controller, Get, Param, Patch, Query, UseGuards } from "@nestjs/common";
import { FraudNetworkService } from "./fraud-network.service";
import { CurrentUser, AuthUser, Roles, PermissionArea } from "../common/decorators";
import { TenantGuard } from "../common/tenant.guard";
import { RolesGuard } from "../common/roles.guard";

export interface UpdateFraudNetworkSettingsDto {
  enabled?: boolean;
}

/**
 * NF13 (FB5) — Platform Fraud Network staff API.
 * @PermissionArea("orders") (fraud is an orders surface, like
 * the Fraud Shield routes). Reads are open to ANY staff member
 * (no @Roles gate — TenantGuard still requires an ACTIVE
 * membership); the toggle is OWNER-only exactly, matching the
 * promise the web card makes before enabling. The lookup route
 * takes a phone ONLY as a query value to hash server-side —
 * the raw value is never stored or returned.
 */
@PermissionArea("orders")
@Controller("organizations/:organizationId/fraud-network")
@UseGuards(TenantGuard, RolesGuard)
export class FraudNetworkController {
  constructor(private readonly fraudNetwork: FraudNetworkService) {}

  @Get()
  getSettings(@Param("organizationId") orgId: string) {
    return this.fraudNetwork.getSettings(orgId);
  }

  @Patch() @Roles("OWNER")
  updateSettings(
    @CurrentUser() user: AuthUser,
    @Param("organizationId") orgId: string,
    @Body() dto: UpdateFraudNetworkSettingsDto,
  ) {
    return this.fraudNetwork.updateSettings(orgId, user.userId, dto ?? {});
  }

  @Get("lookup")
  lookup(@Param("organizationId") orgId: string, @Query("phone") phone?: string) {
    return this.fraudNetwork.lookup(orgId, phone ?? "");
  }
}
