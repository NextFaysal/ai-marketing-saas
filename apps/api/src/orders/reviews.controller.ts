import { Body, Controller, Get, Param, Post, Query, UseGuards } from "@nestjs/common";
import { IsIn, IsInt, IsOptional, IsString, Max, MaxLength, Min } from "class-validator";
import { ReviewsService } from "./reviews.service";
import { Public } from "../common/decorators";
import { TenantGuard } from "../common/tenant.guard";

class SubmitReviewDto {
  @IsInt() @Min(1) @Max(5) rating!: number;
  @IsOptional() @IsString() @MaxLength(1000) comment?: string;
}

/** NF8: step 1 of the review-media upload (declare the file, get
 * the quarantine PUT URL). Type/size guards run in the service
 * against the shared creative-upload guard constants. */
class ReviewMediaPresignDto {
  @IsIn(["image", "video"]) kind!: string;
  @IsString() @MaxLength(100) contentType!: string;
  @IsInt() @Min(1) sizeBytes!: number;
}

/** NF8: step 2 — the bytes have landed in quarantine; the service
 * verifies them (HEAD size + magic-byte sniff) and attaches. */
class ReviewMediaCompleteDto {
  @IsString() @MaxLength(500) key!: string;
  @IsIn(["image", "video"]) kind!: string;
  @IsString() @MaxLength(100) contentType!: string;
  @IsInt() @Min(1) sizeBytes!: number;
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

  /** NF8 — optional photo/video for the review, through the
   * existing RB3 storage machinery (the token is the credential,
   * exactly as for the review itself). */
  @Public()
  @Post(":token/media/presign")
  presignMedia(@Param("token") token: string, @Body() dto: ReviewMediaPresignDto) {
    return this.reviews.presignReviewMedia(token, dto);
  }

  @Public()
  @Post(":token/media/complete")
  completeMedia(@Param("token") token: string, @Body() dto: ReviewMediaCompleteDto) {
    return this.reviews.completeReviewMedia(token, dto);
  }
}
