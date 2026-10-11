import { Body, Controller, Get, Param, Post, Put, Query, UseGuards } from "@nestjs/common";
import { IsBoolean, IsIn, IsNumber, IsOptional, IsString, MaxLength } from "class-validator";
import { OfflineConversionsService } from "./offline-conversions.service";
import { CurrentUser, AuthUser, Roles, PermissionArea } from "../common/decorators";
import { RolesGuard } from "../common/roles.guard";
import { TenantGuard } from "../common/tenant.guard";

class SaveSettingDto {
  @IsString() adAccountId!: string;
  @IsOptional() @IsString() @MaxLength(100) conversionAction?: string;
  @IsOptional() @IsString() @MaxLength(100) pixelCode?: string;
  @IsOptional() @IsIn(["placed", "cod_confirmed", "delivered"]) trigger?: string;
  @IsOptional() @IsBoolean() enabled?: boolean;
}
class UploadDto {
  @IsString() orderId!: string;
  @IsIn(["google", "tiktok"]) platform!: "google" | "tiktok";
}
class RecentDto {
  @IsIn(["google", "tiktok"]) platform!: "google" | "tiktok";
  @IsOptional() @IsNumber() days?: number;
}

@PermissionArea("ads")
@Controller("organizations/:organizationId/offline-conversions")
@UseGuards(TenantGuard, RolesGuard)
export class OfflineConversionsController {
  constructor(private readonly svc: OfflineConversionsService) {}

  @Get("settings")
  settings(@Param("organizationId") orgId: string) { return this.svc.getSettings(orgId); }

  @Put("settings/:platform") @UseGuards(RolesGuard) @Roles("OWNER", "ADMIN")
  save(@CurrentUser() user: AuthUser, @Param("organizationId") orgId: string, @Param("platform") platform: string, @Body() dto: SaveSettingDto) {
    return this.svc.saveSetting(orgId, user.userId, platform, dto);
  }

  @Get("logs")
  logs(@Param("organizationId") orgId: string, @Query("platform") platform?: string) {
    return this.svc.listLogs(orgId, platform);
  }

  @Post("upload") @UseGuards(RolesGuard) @Roles("OWNER", "ADMIN", "MARKETING_MANAGER")
  upload(@Param("organizationId") orgId: string, @Body() dto: UploadDto) {
    return this.svc.uploadForOrder(orgId, dto.orderId, dto.platform);
  }

  @Post("upload-recent") @UseGuards(RolesGuard) @Roles("OWNER", "ADMIN", "MARKETING_MANAGER")
  recent(@Param("organizationId") orgId: string, @Body() dto: RecentDto) {
    return this.svc.uploadRecent(orgId, dto.platform, dto.days ?? 30);
  }
}
