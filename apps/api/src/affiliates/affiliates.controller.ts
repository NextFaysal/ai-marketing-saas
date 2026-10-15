import { Body, Controller, Get, Param, Patch, Post, Query, UseGuards } from "@nestjs/common";
import { AffiliatesService } from "./affiliates.service";
import {
  CreateAffiliatePartnerDto,
  RecordAffiliatePayoutDto,
  UpdateAffiliatePartnerDto,
} from "./affiliates.dto";
import { CurrentUser, AuthUser, Roles, PermissionArea } from "../common/decorators";
import { TenantGuard } from "../common/tenant.guard";
import { RolesGuard } from "../common/roles.guard";

const WRITE_ROLES = ["OWNER", "ADMIN", "MARKETING_MANAGER", "SUPPORT_AGENT"] as const;

/**
 * EC32: staff affiliate program management — partners, balances,
 * payout records and the commission entry ledger. A payout here
 * is a record of money the merchant paid the partner OUTSIDE the
 * system; nothing on this surface sends money.
 */
@PermissionArea("orders")
@Controller("organizations/:organizationId")
@UseGuards(TenantGuard, RolesGuard)
export class AffiliatesController {
  constructor(private readonly affiliates: AffiliatesService) {}

  @Get("affiliates/partners")
  listPartners(@Param("organizationId") orgId: string) {
    return this.affiliates.listPartners(orgId);
  }

  @Post("affiliates/partners") @UseGuards(RolesGuard) @Roles(...WRITE_ROLES)
  createPartner(
    @CurrentUser() user: AuthUser,
    @Param("organizationId") orgId: string,
    @Body() dto: CreateAffiliatePartnerDto,
  ) {
    return this.affiliates.createPartner(orgId, user.userId, dto);
  }

  @Get("affiliates/partners/:partnerId")
  getPartner(@Param("organizationId") orgId: string, @Param("partnerId") partnerId: string) {
    return this.affiliates.getPartner(orgId, partnerId);
  }

  @Patch("affiliates/partners/:partnerId") @UseGuards(RolesGuard) @Roles(...WRITE_ROLES)
  updatePartner(
    @CurrentUser() user: AuthUser,
    @Param("organizationId") orgId: string,
    @Param("partnerId") partnerId: string,
    @Body() dto: UpdateAffiliatePartnerDto,
  ) {
    return this.affiliates.updatePartner(orgId, user.userId, partnerId, dto);
  }

  /** Detail incl. balances + payout history + the
   * paid-on-refunded-orders flag count. */
  @Get("affiliates/partners/:partnerId/balance")
  getPartnerBalance(@Param("organizationId") orgId: string, @Param("partnerId") partnerId: string) {
    return this.affiliates.getPartnerDetail(orgId, partnerId);
  }

  @Post("affiliates/partners/:partnerId/payouts") @UseGuards(RolesGuard) @Roles(...WRITE_ROLES)
  recordPayout(
    @CurrentUser() user: AuthUser,
    @Param("organizationId") orgId: string,
    @Param("partnerId") partnerId: string,
    @Body() dto: RecordAffiliatePayoutDto,
  ) {
    return this.affiliates.recordPayout(orgId, user.userId, partnerId, dto);
  }

  @Get("affiliates/entries")
  listEntries(
    @Param("organizationId") orgId: string,
    @Query() q: { partnerId?: string; status?: string; page?: string; pageSize?: string },
  ) {
    return this.affiliates.listEntries(orgId, {
      partnerId: q.partnerId,
      status: q.status,
      page: q.page ? Number(q.page) : undefined,
      pageSize: q.pageSize ? Number(q.pageSize) : undefined,
    });
  }

  @Post("affiliates/entries/:entryId/approve") @UseGuards(RolesGuard) @Roles(...WRITE_ROLES)
  approveEntry(
    @CurrentUser() user: AuthUser,
    @Param("organizationId") orgId: string,
    @Param("entryId") entryId: string,
  ) {
    return this.affiliates.approveEntry(orgId, user.userId, entryId);
  }
}
