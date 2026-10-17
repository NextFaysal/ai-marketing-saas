import { Body, Controller, Get, Param, Patch, Post, Query, UseGuards } from "@nestjs/common";
import { IsBoolean, IsOptional, IsString, MaxLength } from "class-validator";
import { ProductReviewsService } from "./product-reviews.service";
import { CurrentUser, AuthUser, Public, Roles } from "../common/decorators";
import { TenantGuard } from "../common/tenant.guard";
import { RolesGuard } from "../common/roles.guard";

const MODERATION_ROLES = ["OWNER", "ADMIN", "MARKETING_MANAGER", "SUPPORT_AGENT"];
const SOCIAL_DRAFT_ROLES = ["OWNER", "ADMIN", "MARKETING_MANAGER"];

class ModerateReviewDto {
  @IsOptional() @IsBoolean() isVisible?: boolean;
  @IsOptional() @IsString() @MaxLength(2000) replyText?: string;
}

/** NF8: optional explicit target account; absent = the org's
 * first connected account (the service validates either way). */
class CreateReviewSocialDraftDto {
  @IsOptional() @IsString() @MaxLength(100) socialAccountId?: string;
}

/** EC15 — public unified product reviews (own + pulled). */
@Controller("public/shop")
export class PublicProductReviewsController {
  constructor(private readonly reviews: ProductReviewsService) {}

  @Public()
  @Get(":orgSlug/products/:productSlug/reviews")
  list(@Param("orgSlug") orgSlug: string, @Param("productSlug") productSlug: string) {
    return this.reviews.getPublicBySlug(orgSlug, productSlug);
  }
}

/** EC15 — staff moderation over the same unified set. */
@Controller("organizations/:organizationId/product-reviews")
@UseGuards(TenantGuard, RolesGuard)
export class ProductReviewsController {
  constructor(private readonly reviews: ProductReviewsService) {}

  @Get()
  @Roles(...MODERATION_ROLES)
  list(
    @Param("organizationId") orgId: string,
    @Query("productId") productId?: string,
    @Query("source") source?: string,
    @Query("rating") rating?: string,
    @Query("hidden") hidden?: string,
  ) {
    const r = rating ? Number(rating) : undefined;
    return this.reviews.listStaffReviews(orgId, {
      productId: productId || undefined,
      source: source || undefined,
      rating: r && Number.isInteger(r) && r >= 1 && r <= 5 ? r : undefined,
      hidden: hidden === "true" ? true : hidden === "false" ? false : undefined,
    });
  }

  /** NF8 — share an APPROVED own review as a DRAFT social post
   * (existing Social Posts engine; exactly-once per review). */
  @Post("store/:id/social-draft")
  @Roles(...SOCIAL_DRAFT_ROLES)
  createSocialDraft(
    @CurrentUser() user: AuthUser,
    @Param("organizationId") orgId: string,
    @Param("id") id: string,
    @Body() dto: CreateReviewSocialDraftDto,
  ) {
    return this.reviews.createSocialDraft(orgId, id, user?.userId, dto ?? {});
  }

  @Patch(":source/:id")
  @Roles(...MODERATION_ROLES)
  moderate(
    @CurrentUser() user: AuthUser,
    @Param("organizationId") orgId: string,
    @Param("source") source: string,
    @Param("id") id: string,
    @Body() dto: ModerateReviewDto,
  ) {
    return this.reviews.moderate(orgId, source, id, dto ?? {}, user?.userId);
  }
}
