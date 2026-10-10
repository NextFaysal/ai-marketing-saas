import { Body, Controller, Get, Header, Param, Patch, Post, Query, UseGuards } from "@nestjs/common";
import { WebchatService } from "./webchat.service";
import { CurrentUser, AuthUser, Public, Roles } from "../common/decorators";
import { TenantGuard } from "../common/tenant.guard";
import { RolesGuard } from "../common/roles.guard";
import { IsBoolean, IsOptional, IsString, MaxLength } from "class-validator";

class CreateSiteDto {
  @IsString() @MaxLength(120) name!: string;
  @IsOptional() @IsString() @MaxLength(200) domain?: string;
  @IsOptional() @IsString() @MaxLength(300) greeting?: string;
  @IsOptional() @IsString() @MaxLength(30) color?: string;
}
class SetEnabledDto { @IsBoolean() enabled!: boolean }

@Controller("organizations/:organizationId/webchat")
@UseGuards(TenantGuard)
export class WebchatAdminController {
  constructor(private readonly webchat: WebchatService) {}

  @Get("sites")
  list(@Param("organizationId") orgId: string) { return this.webchat.listSites(orgId); }

  @Post("sites") @UseGuards(RolesGuard) @Roles("OWNER", "ADMIN")
  create(@CurrentUser() user: AuthUser, @Param("organizationId") orgId: string, @Body() dto: CreateSiteDto) {
    return this.webchat.createSite(orgId, user.userId, dto);
  }

  @Patch("sites/:siteId") @UseGuards(RolesGuard) @Roles("OWNER", "ADMIN")
  setEnabled(@Param("organizationId") orgId: string, @Param("siteId") siteId: string, @Body() dto: SetEnabledDto) {
    return this.webchat.setSiteEnabled(orgId, siteId, dto.enabled);
  }
}

/** Public widget endpoints: CORS-open by design (the widget runs on
 * the merchant's own storefront). Auth = site key + session token. */
@Controller("public/chat")
@Public()
export class PublicChatController {
  constructor(private readonly webchat: WebchatService) {}

  @Post(":key/start")
  @Header("Access-Control-Allow-Origin", "*")
  start(@Param("key") key: string, @Body() dto: { visitorId: string; name?: string }) {
    return this.webchat.startSession(key, dto);
  }

  @Post(":key/messages")
  @Header("Access-Control-Allow-Origin", "*")
  post(@Param("key") key: string, @Body() dto: { token: string; text: string }) {
    return this.webchat.postMessage(key, dto);
  }

  @Get(":key/messages")
  @Header("Access-Control-Allow-Origin", "*")
  list(@Param("key") key: string, @Query("token") token: string) {
    return this.webchat.listMessages(key, token);
  }
}
