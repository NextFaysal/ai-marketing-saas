import { Body, Controller, Get, Param, Post, UseGuards } from "@nestjs/common";
import { IsArray, IsOptional, IsString, MaxLength } from "class-validator";
import { PublishingService } from "./publishing.service";
import { CurrentUser, AuthUser, Roles } from "../common/decorators";
import { TenantGuard } from "../common/tenant.guard";
import { RolesGuard } from "../common/roles.guard";

class GooglePublishDto {
  @IsString() adAccountId!: string;
  @IsString() @MaxLength(200) name!: string;
  @IsString() dailyBudget!: string;
  @IsArray() countryCodes!: string[];
  @IsArray() headlines!: string[];
  @IsArray() descriptions!: string[];
  @IsString() finalUrl!: string;
  @IsArray() keywords!: { text: string; matchType?: string }[];
  @IsOptional() @IsArray() negativeKeywords?: string[];
  @IsOptional() @IsArray() sitelinks?: { text: string; url: string }[];
  @IsOptional() @IsArray() callouts?: string[];
}
class TikTokPublishDto {
  @IsString() adAccountId!: string;
  @IsString() @MaxLength(200) name!: string;
  @IsString() dailyBudget!: string;
  @IsArray() countryCodes!: string[];
  @IsString() @MaxLength(100) adText!: string;
  @IsString() landingUrl!: string;
  @IsOptional() @IsString() imageUrl?: string;
  @IsOptional() @IsString() videoUrl?: string;
  @IsOptional() @IsString() identityId?: string;
}
class GooglePmaxDto {
  @IsString() adAccountId!: string;
  @IsString() @MaxLength(200) name!: string;
  @IsString() dailyBudget!: string;
  @IsArray() countryCodes!: string[];
  @IsString() finalUrl!: string;
  @IsString() businessName!: string;
  @IsArray() headlines!: string[];
  @IsArray() longHeadlines!: string[];
  @IsArray() descriptions!: string[];
  @IsString() logoUrl!: string;
  @IsArray() imageUrls!: string[];
}

@Controller("organizations/:organizationId/publish")
@UseGuards(TenantGuard)
export class PublishingController {
  constructor(private readonly publishing: PublishingService) {}

  @Get("publications")
  list(@Param("organizationId") orgId: string) { return this.publishing.list(orgId); }

  @Post("google") @UseGuards(RolesGuard) @Roles("OWNER", "ADMIN")
  google(@CurrentUser() user: AuthUser, @Param("organizationId") orgId: string, @Body() dto: GooglePublishDto) {
    return this.publishing.publishGoogle(orgId, user.userId, dto);
  }

  @Post("google-pmax") @UseGuards(RolesGuard) @Roles("OWNER", "ADMIN")
  googlePmax(@CurrentUser() user: AuthUser, @Param("organizationId") orgId: string, @Body() dto: GooglePmaxDto) {
    return this.publishing.publishGooglePmax(orgId, user.userId, dto);
  }

  @Post("tiktok") @UseGuards(RolesGuard) @Roles("OWNER", "ADMIN")
  tiktok(@CurrentUser() user: AuthUser, @Param("organizationId") orgId: string, @Body() dto: TikTokPublishDto) {
    return this.publishing.publishTikTok(orgId, user.userId, dto);
  }
}
