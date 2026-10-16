import { Body, Controller, Get, Param, Post, Put, UseGuards } from "@nestjs/common";
import { WebPushService } from "./webpush.service";
import { CurrentUser, AuthUser, Roles, PermissionArea } from "../common/decorators";
import { TenantGuard } from "../common/tenant.guard";
import { RolesGuard } from "../common/roles.guard";
import { CreatePushCampaignDto, PushSendDto, PushSubscribeDto, UpdatePushSettingDto } from "./webpush.dto";

const WRITE_ROLES = ["OWNER", "ADMIN", "MARKETING_MANAGER"] as const;

/** AB7 (AX16): staff web-push surface — setting, test devices,
 * campaigns. TenantGuard + RolesGuard + audit (in the service),
 * the commerce-controller pattern. */
@PermissionArea("integrations")
@Controller("organizations/:organizationId/push")
@UseGuards(TenantGuard, RolesGuard)
export class WebpushController {
  constructor(private readonly webpush: WebPushService) {}

  @Get("setting")
  getSetting(@Param("organizationId") orgId: string) {
    return this.webpush.getSetting(orgId);
  }

  @Put("setting")
  @Roles(...WRITE_ROLES)
  updateSetting(
    @CurrentUser() user: AuthUser,
    @Param("organizationId") orgId: string,
    @Body() dto: UpdatePushSettingDto,
  ) {
    return this.webpush.updateSetting(orgId, user.userId, dto);
  }

  @Post("test-device")
  @Roles(...WRITE_ROLES)
  registerTestDevice(
    @CurrentUser() user: AuthUser,
    @Param("organizationId") orgId: string,
    @Body() dto: PushSubscribeDto,
  ) {
    return this.webpush.registerTestDevice(orgId, user.userId, dto);
  }

  @Post("test-send")
  @Roles(...WRITE_ROLES)
  testSend(
    @CurrentUser() user: AuthUser,
    @Param("organizationId") orgId: string,
    @Body() dto: PushSendDto,
  ) {
    return this.webpush.testSend(orgId, user.userId, dto);
  }

  @Post("campaigns")
  @Roles(...WRITE_ROLES)
  createCampaign(
    @CurrentUser() user: AuthUser,
    @Param("organizationId") orgId: string,
    @Body() dto: CreatePushCampaignDto,
  ) {
    return this.webpush.createCampaign(orgId, user.userId, dto);
  }

  @Get("campaigns")
  listCampaigns(@Param("organizationId") orgId: string) {
    return this.webpush.listCampaigns(orgId);
  }

  @Get("campaigns/:id")
  getCampaign(@Param("organizationId") orgId: string, @Param("id") id: string) {
    return this.webpush.getCampaign(orgId, id);
  }
}
