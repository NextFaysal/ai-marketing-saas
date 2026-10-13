import { Body, Controller, Get, Param, Post, Query, UseGuards } from "@nestjs/common";
import { IsInt, IsOptional, IsString, Max, MaxLength, Min } from "class-validator";
import { ReviewsService } from "./reviews.service";
import { Public } from "../common/decorators";
import { TenantGuard } from "../common/tenant.guard";

class SubmitReviewDto {
  @IsInt() @Min(1) @Max(5) rating!: number;
  @IsOptional() @IsString() @MaxLength(1000) comment?: string;
}

/** CX12b — tenant review list (org-scoped; the orders page and
 * customer 360 read from here). */
@Controller("organizations/:organizationId/reviews")
@UseGuards(TenantGuard)
export class ReviewsController {
  constructor(private readonly reviews: ReviewsService) {}

  @Get()
  list(@Param("organizationId") orgId: string, @Query("rating") rating?: string, @Query("customerId") customerId?: string) {
    const r = rating ? Number(rating) : undefined;
    return this.reviews.listReviews(orgId, {
      rating: r && Number.isInteger(r) && r >= 1 && r <= 5 ? r : undefined,
      customerId: customerId || undefined,
    });
  }
}

/** CX12b — public review page: the reviewToken is the only
 * credential (CX6/ReportShare pattern). */
@Controller("public/review")
export class PublicReviewController {
  constructor(private readonly reviews: ReviewsService) {}

  @Public()
  @Get(":token")
  view(@Param("token") token: string) { return this.reviews.publicReview(token); }

  @Public()
  @Post(":token")
  submit(@Param("token") token: string, @Body() dto: SubmitReviewDto) {
    return this.reviews.submitPublicReview(token, dto);
  }
}
