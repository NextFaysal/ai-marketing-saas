import { Controller, Get, Param, Post, UseGuards } from "@nestjs/common";
import { ReviewInsightsService } from "./review-insights.service";
import { CurrentUser, AuthUser, Public, Roles } from "../common/decorators";
import { TenantGuard } from "../common/tenant.guard";
import { RolesGuard } from "../common/roles.guard";

const INSIGHT_ROLES = ["OWNER", "ADMIN", "MARKETING_MANAGER", "SUPPORT_AGENT"];

/** AX15 — public AI review insight for the PDP summary box. */
@Controller("public/shop")
export class PublicReviewInsightController {
  constructor(private readonly insights: ReviewInsightsService) {}

  @Public()
  @Get(":orgSlug/products/:productSlug/review-insight")
  get(@Param("orgSlug") orgSlug: string, @Param("productSlug") productSlug: string) {
    return this.insights.getPublicBySlug(orgSlug, productSlug);
  }
}

/** AX15 — staff generate + read for one product's AI review insight. */
@Controller("organizations/:organizationId/products/:productId/review-insight")
@UseGuards(TenantGuard, RolesGuard)
export class ReviewInsightsController {
  constructor(private readonly insights: ReviewInsightsService) {}

  @Post("generate")
  @Roles(...INSIGHT_ROLES)
  generate(
    @CurrentUser() user: AuthUser,
    @Param("organizationId") orgId: string,
    @Param("productId") productId: string,
  ) {
    return this.insights.generate(orgId, productId, user?.userId);
  }

  @Get()
  @Roles(...INSIGHT_ROLES)
  get(
    @Param("organizationId") orgId: string,
    @Param("productId") productId: string,
  ) {
    return this.insights.getForStaff(orgId, productId);
  }
}
