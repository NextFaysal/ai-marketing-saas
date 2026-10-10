import { Body, Controller, Get, Param, Patch, Post, UseGuards } from "@nestjs/common";
import { ConversionsService } from "./conversions.service";
import { CurrentUser, AuthUser, Roles } from "../common/decorators";
import { TenantGuard } from "../common/tenant.guard";
import { RolesGuard } from "../common/roles.guard";
import { IsBoolean, IsOptional, IsString } from "class-validator";

class UpdateSettingsDto {
  @IsString() pixelId!: string;
  @IsOptional() @IsString() accessToken?: string;
  @IsOptional() @IsString() testEventCode?: string | null;
  @IsOptional() @IsString() purchaseTrigger?: string;
  @IsOptional() @IsBoolean() enabled?: boolean;
  @IsOptional() @IsBoolean() sendLeadEvents?: boolean;
}

@Controller("organizations/:organizationId/conversions")
@UseGuards(TenantGuard)
export class ConversionsController {
  constructor(private readonly conversions: ConversionsService) {}

  @Get("settings")
  settings(@Param("organizationId") orgId: string) { return this.conversions.getSettings(orgId); }

  @Patch("settings") @UseGuards(RolesGuard) @Roles("OWNER", "ADMIN")
  update(@CurrentUser() user: AuthUser, @Param("organizationId") orgId: string, @Body() dto: UpdateSettingsDto) {
    return this.conversions.updateSettings(orgId, user.userId, dto);
  }

  @Post("test") @UseGuards(RolesGuard) @Roles("OWNER", "ADMIN", "MARKETING_MANAGER")
  test(@CurrentUser() user: AuthUser, @Param("organizationId") orgId: string) {
    return this.conversions.sendTestEvent(orgId, user.userId);
  }

  @Get("events")
  events(@Param("organizationId") orgId: string) { return this.conversions.listEvents(orgId); }
}
