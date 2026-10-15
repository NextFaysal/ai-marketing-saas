import { Body, Controller, Delete, Get, Param, Post, Query, UseGuards } from "@nestjs/common";
import { IsInt, IsOptional, IsString, MaxLength, Min } from "class-validator";
import { CreativesService } from "./creatives.service";
import { CurrentUser, AuthUser, Roles, PermissionArea } from "../common/decorators";
import { TenantGuard } from "../common/tenant.guard";
import { RolesGuard } from "../common/roles.guard";

class UploadDto {
  @IsString() adAccountId!: string;
  @IsString() kind!: string;
  @IsString() @MaxLength(200) name!: string;
  @IsString() @MaxLength(2000) sourceUrl!: string;
}

/** RB4/RM8: direct-upload step 1 — declare the file, get a
 * presigned PUT URL for the quarantine key. */
class PresignCreativeUploadDto {
  @IsString() kind!: string;
  @IsString() @MaxLength(100) contentType!: string;
  @IsInt() @Min(1) sizeBytes!: number;
  @IsOptional() @IsString() @MaxLength(255) fileName?: string;
}

/** RB4/RM8: direct-upload step 2 — the bytes have landed; the
 * service verifies them and creates the CreativeAsset through
 * the by-URL path with the CDN URL as its source. */
class CompleteCreativeUploadDto {
  @IsString() @MaxLength(500) key!: string;
  @IsString() kind!: string;
  @IsString() @MaxLength(100) contentType!: string;
  @IsInt() @Min(1) sizeBytes!: number;
  @IsString() adAccountId!: string;
  @IsString() @MaxLength(200) name!: string;
}

@PermissionArea("ads")
@Controller("organizations/:organizationId/creatives")
@UseGuards(TenantGuard, RolesGuard)
export class CreativesController {
  constructor(private readonly creatives: CreativesService) {}

  @Get()
  list(@Param("organizationId") orgId: string, @Query("adAccountId") accountId?: string) {
    return this.creatives.listAssets(orgId, accountId);
  }

  @Post("upload") @UseGuards(RolesGuard) @Roles("OWNER", "ADMIN", "MARKETING_MANAGER")
  upload(@CurrentUser() user: AuthUser, @Param("organizationId") orgId: string, @Body() dto: UploadDto) {
    return this.creatives.upload(orgId, user.userId, dto.adAccountId, dto);
  }

  @Post("upload/presign") @UseGuards(RolesGuard) @Roles("OWNER", "ADMIN", "MARKETING_MANAGER")
  presignUpload(@CurrentUser() user: AuthUser, @Param("organizationId") orgId: string, @Body() dto: PresignCreativeUploadDto) {
    return this.creatives.presignCreativeUpload(orgId, user.userId, dto);
  }

  @Post("upload/complete") @UseGuards(RolesGuard) @Roles("OWNER", "ADMIN", "MARKETING_MANAGER")
  completeUpload(@CurrentUser() user: AuthUser, @Param("organizationId") orgId: string, @Body() dto: CompleteCreativeUploadDto) {
    return this.creatives.completeCreativeUpload(orgId, user.userId, dto);
  }

  @Post(":assetId/refresh-video") @UseGuards(RolesGuard) @Roles("OWNER", "ADMIN", "MARKETING_MANAGER")
  refresh(@Param("organizationId") orgId: string, @Param("assetId") id: string) {
    return this.creatives.refreshVideo(orgId, id);
  }

  @Delete(":assetId") @UseGuards(RolesGuard) @Roles("OWNER", "ADMIN")
  remove(@Param("organizationId") orgId: string, @Param("assetId") id: string) {
    return this.creatives.remove(orgId, id);
  }
}
