import { Body, Controller, Delete, Get, Param, Patch, Post, UseGuards } from "@nestjs/common";
import { CampaignsService } from "./campaigns.service";
import { CreatePlanDto, UpdatePlanDto, AddAdSetDto, AddAdDto, RejectDto, GenerateCopyDto, InstantiateBlueprintDto } from "./campaigns.dto";
import { CurrentUser, AuthUser, Roles, PermissionArea } from "../common/decorators";
import { TenantGuard } from "../common/tenant.guard";
import { RolesGuard } from "../common/roles.guard";

const WRITE = ["OWNER", "ADMIN", "MARKETING_MANAGER"] as const;

@PermissionArea("campaigns")
@Controller("organizations/:organizationId/campaign-plans")
@UseGuards(TenantGuard, RolesGuard)
export class CampaignsController {
  constructor(private readonly campaigns: CampaignsService) {}

  @Post() @UseGuards(RolesGuard) @Roles(...WRITE)
  create(@CurrentUser() user: AuthUser, @Param("organizationId") orgId: string, @Body() dto: CreatePlanDto) {
    return this.campaigns.createPlan(orgId, user.userId, dto);
  }

  @Get()
  list(@Param("organizationId") orgId: string) { return this.campaigns.listPlans(orgId); }

  @Get(":planId")
  get(@Param("organizationId") orgId: string, @Param("planId") id: string) { return this.campaigns.getPlan(orgId, id); }

  @Patch(":planId") @UseGuards(RolesGuard) @Roles(...WRITE)
  update(@Param("organizationId") orgId: string, @Param("planId") id: string, @Body() dto: UpdatePlanDto) {
    return this.campaigns.updatePlan(orgId, id, dto);
  }

  @Delete(":planId") @UseGuards(RolesGuard) @Roles("OWNER", "ADMIN")
  remove(@Param("organizationId") orgId: string, @Param("planId") id: string) { return this.campaigns.deletePlan(orgId, id); }

  @Post(":planId/ad-sets") @UseGuards(RolesGuard) @Roles(...WRITE)
  addAdSet(@Param("organizationId") orgId: string, @Param("planId") id: string, @Body() dto: AddAdSetDto) {
    return this.campaigns.addAdSet(orgId, id, dto);
  }

  @Delete(":planId/ad-sets/:adSetId") @UseGuards(RolesGuard) @Roles(...WRITE)
  deleteAdSet(@Param("organizationId") orgId: string, @Param("planId") id: string, @Param("adSetId") adSetId: string) {
    return this.campaigns.deleteAdSet(orgId, id, adSetId);
  }

  @Post(":planId/ad-sets/:adSetId/ads") @UseGuards(RolesGuard) @Roles(...WRITE)
  addAd(@Param("organizationId") orgId: string, @Param("planId") id: string, @Param("adSetId") adSetId: string, @Body() dto: AddAdDto) {
    return this.campaigns.addAd(orgId, id, adSetId, dto);
  }

  @Delete(":planId/ads/:adId") @UseGuards(RolesGuard) @Roles(...WRITE)
  deleteAd(@Param("organizationId") orgId: string, @Param("planId") id: string, @Param("adId") adId: string) {
    return this.campaigns.deleteAd(orgId, id, adId);
  }

  @Post(":planId/submit") @UseGuards(RolesGuard) @Roles(...WRITE)
  submit(@CurrentUser() user: AuthUser, @Param("organizationId") orgId: string, @Param("planId") id: string) {
    return this.campaigns.submitForApproval(orgId, user.userId, id);
  }

  @Post(":planId/approve") @UseGuards(RolesGuard) @Roles("OWNER", "ADMIN")
  approve(@CurrentUser() user: AuthUser, @Param("organizationId") orgId: string, @Param("planId") id: string) {
    return this.campaigns.approve(orgId, user.userId, id);
  }

  @Post(":planId/reject") @UseGuards(RolesGuard) @Roles("OWNER", "ADMIN")
  reject(@CurrentUser() user: AuthUser, @Param("organizationId") orgId: string, @Param("planId") id: string, @Body() dto: RejectDto) {
    return this.campaigns.reject(orgId, user.userId, id, dto.reason);
  }

  @Post(":planId/publish") @UseGuards(RolesGuard) @Roles("OWNER", "ADMIN")
  publish(@CurrentUser() user: AuthUser, @Param("organizationId") orgId: string, @Param("planId") id: string) {
    return this.campaigns.publish(orgId, user.userId, id);
  }

  @Post(":planId/activate") @UseGuards(RolesGuard) @Roles("OWNER", "ADMIN")
  activate(@CurrentUser() user: AuthUser, @Param("organizationId") orgId: string, @Param("planId") id: string) {
    return this.campaigns.setMetaStatus(orgId, user.userId, id, "ACTIVE");
  }

  @Post(":planId/pause") @UseGuards(RolesGuard) @Roles("OWNER", "ADMIN")
  pause(@CurrentUser() user: AuthUser, @Param("organizationId") orgId: string, @Param("planId") id: string) {
    return this.campaigns.setMetaStatus(orgId, user.userId, id, "PAUSED");
  }

  @Post(":planId/preflight")
  preflight(@Param("organizationId") orgId: string, @Param("planId") planId: string) {
    return this.campaigns.preflight(orgId, planId);
  }
  @Get("ab-tests/list")
  abTests(@Param("organizationId") orgId: string) {
    return this.campaigns.abTestResults(orgId);
  }
  @Post(":planId/ab-variant") @UseGuards(RolesGuard) @Roles("OWNER", "ADMIN", "MARKETING_MANAGER")
  abVariant(@CurrentUser() user: AuthUser, @Param("organizationId") orgId: string, @Param("planId") planId: string, @Body() body: { variant?: string; metric?: string }) {
    return this.campaigns.createAbVariant(orgId, user.userId, planId, body ?? {});
  }
  @Post(":planId/ad-sets/:adSetId/daypart") @UseGuards(RolesGuard) @Roles("OWNER", "ADMIN", "MARKETING_MANAGER")
  daypart(@CurrentUser() user: AuthUser, @Param("organizationId") orgId: string, @Param("planId") planId: string, @Param("adSetId") adSetId: string, @Body() body: { windows: { day: number; startHour: number; endHour: number }[]; tz?: string }) {
    return this.campaigns.setDaypart(orgId, user.userId, planId, adSetId, body ?? { windows: [] });
  }
  @Post(":planId/status-sync") @UseGuards(RolesGuard) @Roles("OWNER", "ADMIN", "MARKETING_MANAGER")
  statusSync(@CurrentUser() user: AuthUser, @Param("organizationId") orgId: string, @Param("planId") planId: string) {
    return this.campaigns.syncObjectStatuses(orgId, user.userId, planId);
  }
  @Post(":planId/ad-sets/:adSetId/schedule") @UseGuards(RolesGuard) @Roles("OWNER", "ADMIN")
  schedule(@CurrentUser() user: AuthUser, @Param("organizationId") orgId: string, @Param("planId") planId: string, @Param("adSetId") adSetId: string, @Body() body: { startTime?: string; endTime?: string }) {
    return this.campaigns.updateAdSetSchedule(orgId, user.userId, planId, adSetId, body ?? {});
  }
  @Post(":planId/ad-sets/:adSetId/budget") @UseGuards(RolesGuard) @Roles("OWNER", "ADMIN")
  budget(@CurrentUser() user: AuthUser, @Param("organizationId") orgId: string, @Param("planId") planId: string, @Param("adSetId") adSetId: string, @Body() body: { dailyBudget?: string; lifetimeBudget?: string }) {
    return this.campaigns.updateAdSetBudget(orgId, user.userId, planId, adSetId, body ?? {});
  }
  @Post(":planId/advantage-plus") @UseGuards(RolesGuard) @Roles(...WRITE)
  advantagePlus(@CurrentUser() user: AuthUser, @Param("organizationId") orgId: string, @Param("planId") id: string, @Body() body: { enabled: boolean }) {
    return this.campaigns.setAdvantagePlus(orgId, user.userId, id, body?.enabled === true);
  }

  @Post(":planId/duplicate") @UseGuards(RolesGuard) @Roles(...WRITE)
  duplicate(@CurrentUser() user: AuthUser, @Param("organizationId") orgId: string, @Param("planId") id: string, @Body() body: { asTemplate?: boolean; name?: string }) {
    return this.campaigns.duplicatePlan(orgId, user.userId, id, body ?? {});
  }
  @Get("templates/list")
  templates(@Param("organizationId") orgId: string) { return this.campaigns.listTemplates(orgId); }
  @Get("blueprints/list")
  blueprints() { return this.campaigns.listBlueprints(); }
  @Post("blueprints/instantiate") @UseGuards(RolesGuard) @Roles(...WRITE)
  instantiate(@CurrentUser() user: AuthUser, @Param("organizationId") orgId: string, @Body() dto: InstantiateBlueprintDto) {
    return this.campaigns.instantiateBlueprint(orgId, user.userId, dto);
  }
  @Post(":planId/generate-copy") @UseGuards(RolesGuard) @Roles(...WRITE)
  generateCopy(@CurrentUser() user: AuthUser, @Param("organizationId") orgId: string, @Param("planId") id: string, @Body() dto: GenerateCopyDto) {
    return this.campaigns.generateCopy(orgId, user.userId, id, dto);
  }
}
