import { Body, Controller, Get, Param, Patch, Post, UseGuards } from "@nestjs/common";
import { GamifiedPromotionsService } from "./gamified-promotions.service";
import type {
  CreatePromoCampaignDto, PublicGroupBuyJoinDto, PublicPlayDto, PublicQuizCompleteDto,
  SetPromoActiveDto, UpdatePromoCampaignDto,
} from "./gamified-promotions.dto";
import { CurrentUser, AuthUser, Roles, PermissionArea, Public } from "../common/decorators";
import { TenantGuard } from "../common/tenant.guard";
import { RolesGuard } from "../common/roles.guard";

/**
 * NF6 (FB3) — staff surface for gamified promotions.
 * @PermissionArea("marketing") — promotions are a marketing
 * surface (same area family as campaigns). Config CRUD:
 * OWNER/ADMIN. Reads (campaigns, plays, joins, stats):
 * OWNER/ADMIN/MARKETING_MANAGER/SUPPORT_AGENT, the booking /
 * live-commerce read set.
 */
const READ_ROLES = ["OWNER", "ADMIN", "MARKETING_MANAGER", "SUPPORT_AGENT"] as const;
const WRITE_ROLES = ["OWNER", "ADMIN"] as const;

@PermissionArea("marketing")
@Controller("organizations/:organizationId")
@UseGuards(TenantGuard, RolesGuard)
export class GamifiedPromotionsController {
  constructor(private readonly promotions: GamifiedPromotionsService) {}

  @Post("promotions/campaigns") @Roles(...WRITE_ROLES)
  createCampaign(
    @CurrentUser() user: AuthUser,
    @Param("organizationId") orgId: string,
    @Body() dto: CreatePromoCampaignDto,
  ) {
    return this.promotions.createCampaign(orgId, user.userId, dto);
  }

  @Get("promotions/campaigns") @Roles(...READ_ROLES)
  listCampaigns(@Param("organizationId") orgId: string) {
    return this.promotions.listCampaigns(orgId);
  }

  @Get("promotions/campaigns/:id") @Roles(...READ_ROLES)
  getCampaign(@Param("organizationId") orgId: string, @Param("id") id: string) {
    return this.promotions.getCampaign(orgId, id);
  }

  @Patch("promotions/campaigns/:id") @Roles(...WRITE_ROLES)
  updateCampaign(
    @CurrentUser() user: AuthUser,
    @Param("organizationId") orgId: string,
    @Param("id") id: string,
    @Body() dto: UpdatePromoCampaignDto,
  ) {
    return this.promotions.updateCampaign(orgId, user.userId, id, dto);
  }

  @Post("promotions/campaigns/:id/active") @Roles(...WRITE_ROLES)
  setActive(
    @CurrentUser() user: AuthUser,
    @Param("organizationId") orgId: string,
    @Param("id") id: string,
    @Body() dto: SetPromoActiveDto,
  ) {
    return this.promotions.setActive(orgId, user.userId, id, dto?.active === true);
  }

  @Get("promotions/campaigns/:id/plays") @Roles(...READ_ROLES)
  listPlays(@Param("organizationId") orgId: string, @Param("id") id: string) {
    return this.promotions.listPlays(orgId, id);
  }

  @Get("promotions/campaigns/:id/joins") @Roles(...READ_ROLES)
  listJoins(@Param("organizationId") orgId: string, @Param("id") id: string) {
    return this.promotions.listJoins(orgId, id);
  }
}

/**
 * NF6 — public storefront surface on "public/promotions"
 * (the "public/shop" prefix belongs to the storefront
 * controller; "public/booking" is NF4's). The org is resolved
 * by shop slug + shopEnabled, unknown/disabled shop → 404.
 * Responses never carry segment weights, other orgs' data, or
 * internal config — see the service's public shapes.
 */
@Controller("public/promotions")
export class GamifiedPromotionsPublicController {
  constructor(private readonly promotions: GamifiedPromotionsService) {}

  @Public()
  @Get(":orgSlug/active")
  active(@Param("orgSlug") orgSlug: string) {
    return this.promotions.publicActive(orgSlug);
  }

  @Public()
  @Post(":orgSlug/spin/:campaignId/play")
  spinPlay(
    @Param("orgSlug") orgSlug: string,
    @Param("campaignId") campaignId: string,
    @Body() dto: PublicPlayDto,
  ) {
    return this.promotions.publicSpinPlay(orgSlug, campaignId, dto);
  }

  @Public()
  @Post(":orgSlug/quiz/:campaignId/complete")
  quizComplete(
    @Param("orgSlug") orgSlug: string,
    @Param("campaignId") campaignId: string,
    @Body() dto: PublicQuizCompleteDto,
  ) {
    return this.promotions.publicQuizComplete(orgSlug, campaignId, dto);
  }

  @Public()
  @Post(":orgSlug/group-buy/:campaignId/join")
  groupBuyJoin(
    @Param("orgSlug") orgSlug: string,
    @Param("campaignId") campaignId: string,
    @Body() dto: PublicGroupBuyJoinDto,
  ) {
    return this.promotions.publicGroupBuyJoin(orgSlug, campaignId, dto);
  }

  @Public()
  @Get(":orgSlug/group-buy/:campaignId")
  groupBuyStatus(@Param("orgSlug") orgSlug: string, @Param("campaignId") campaignId: string) {
    return this.promotions.publicGroupBuyStatus(orgSlug, campaignId);
  }
}
