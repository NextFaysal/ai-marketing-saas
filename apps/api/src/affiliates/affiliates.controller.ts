import { Body, Controller, Get, Param, Patch, Post, Query, UseGuards } from "@nestjs/common";
import { AffiliatesService } from "./affiliates.service";
import {
  ConfirmAffiliatePayoutExecutionDto,
  CreateAffiliatePartnerDto,
  CreateAffiliatePayoutExecutionDto,
  FailAffiliatePayoutExecutionDto,
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

  // OU11 — affiliate payout executions on the legal-gated
  // bank-instruction rail (issue → execute at bank → confirm
  // with the bank reference / fail with a reason). The EC32
  // recordPayout route above stays the ungated manual
  // bookkeeping path, unchanged.
  @Post("affiliates/partners/:partnerId/payout-executions") @UseGuards(RolesGuard) @Roles(...WRITE_ROLES)
  createPayoutExecution(
    @CurrentUser() user: AuthUser,
    @Param("organizationId") orgId: string,
    @Param("partnerId") partnerId: string,
    @Body() dto: CreateAffiliatePayoutExecutionDto,
  ) {
    return this.affiliates.createAffiliatePayoutExecution(orgId, user.userId, partnerId, dto);
  }

  @Get("affiliates/partners/:partnerId/payout-executions")
  listPayoutExecutions(@Param("organizationId") orgId: string, @Param("partnerId") partnerId: string) {
    return this.affiliates.listAffiliatePayoutExecutions(orgId, partnerId);
  }

  @Post("affiliates/payout-executions/:executionId/confirm") @UseGuards(RolesGuard) @Roles(...WRITE_ROLES)
  confirmPayoutExecution(
    @CurrentUser() user: AuthUser,
    @Param("organizationId") orgId: string,
    @Param("executionId") executionId: string,
    @Body() dto: ConfirmAffiliatePayoutExecutionDto,
  ) {
    return this.affiliates.confirmAffiliatePayoutExecution(orgId, user.userId, executionId, dto);
  }

  @Post("affiliates/payout-executions/:executionId/fail") @UseGuards(RolesGuard) @Roles(...WRITE_ROLES)
  failPayoutExecution(
    @CurrentUser() user: AuthUser,
    @Param("organizationId") orgId: string,
    @Param("executionId") executionId: string,
    @Body() dto: FailAffiliatePayoutExecutionDto,
  ) {
    return this.affiliates.failAffiliatePayoutExecution(orgId, user.userId, executionId, dto);
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
