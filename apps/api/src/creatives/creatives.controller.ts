import { Body, Controller, Delete, Get, Param, Post, Query, UseGuards } from "@nestjs/common";
import { IsString, MaxLength } from "class-validator";
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

  @Post(":assetId/refresh-video") @UseGuards(RolesGuard) @Roles("OWNER", "ADMIN", "MARKETING_MANAGER")
  refresh(@Param("organizationId") orgId: string, @Param("assetId") id: string) {
    return this.creatives.refreshVideo(orgId, id);
  }

  @Delete(":assetId") @UseGuards(RolesGuard) @Roles("OWNER", "ADMIN")
  remove(@Param("organizationId") orgId: string, @Param("assetId") id: string) {
    return this.creatives.remove(orgId, id);
  }
}
