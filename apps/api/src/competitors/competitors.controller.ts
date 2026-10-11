import { Body, Controller, Delete, Get, Param, Patch, Post, UseGuards } from "@nestjs/common";
import { CompetitorsService } from "./competitors.service";
import { CreateCompetitorDto, UpdateCompetitorDto, SyncAdsDto, AddObservationDto, GenerateInsightsDto, GenerateCounterAdDto, SyncMultiPlatformDto, GenerateSeoGapDto, DeconstructVideoScriptDto, ConfigureAlertSettingsDto, TestAlertChannelDto } from "./competitors.dto";
import { CurrentUser, AuthUser, Roles } from "../common/decorators";



import { TenantGuard } from "../common/tenant.guard";
import { RolesGuard } from "../common/roles.guard";

@Controller("organizations/:organizationId/competitors")
@UseGuards(TenantGuard)
export class CompetitorsController {
  constructor(private readonly competitors: CompetitorsService) {}

  @Post("counter-ad") @UseGuards(RolesGuard) @Roles("OWNER", "ADMIN", "MARKETING_MANAGER", "ADVERTISER")
  generateCounterAd(@CurrentUser() user: AuthUser, @Param("organizationId") orgId: string, @Body() dto: GenerateCounterAdDto) {
    return this.competitors.generateCounterAd(orgId, user.userId, dto);
  }


  @Post() @UseGuards(RolesGuard) @Roles("OWNER", "ADMIN", "MARKETING_MANAGER")
  create(@CurrentUser() user: AuthUser, @Param("organizationId") orgId: string, @Body() dto: CreateCompetitorDto) {
    return this.competitors.create(orgId, user.userId, dto);
  }

  @Get()
  list(@Param("organizationId") orgId: string) { return this.competitors.list(orgId); }

  @Get("price-comparison")
  comparison(@Param("organizationId") orgId: string) { return this.competitors.priceComparison(orgId); }

  @Get("insights")
  insights(@Param("organizationId") orgId: string) { return this.competitors.listInsights(orgId); }

  @Get("alerts")
  alerts(@Param("organizationId") orgId: string) { return this.competitors.getAlertsFeed(orgId); }

  @Get("dossier")
  dossier(@Param("organizationId") orgId: string) { return this.competitors.exportDossier(orgId); }



  @Post("insights/generate") @UseGuards(RolesGuard) @Roles("OWNER", "ADMIN", "MARKETING_MANAGER", "ANALYST")
  generateInsights(@CurrentUser() user: AuthUser, @Param("organizationId") orgId: string, @Body() dto: GenerateInsightsDto) {
    return this.competitors.generateInsights(orgId, user.userId, dto.competitorId);
  }

  @Patch(":competitorId") @UseGuards(RolesGuard) @Roles("OWNER", "ADMIN", "MARKETING_MANAGER")
  update(@Param("organizationId") orgId: string, @Param("competitorId") id: string, @Body() dto: UpdateCompetitorDto) {
    return this.competitors.update(orgId, id, dto as Record<string, unknown>);
  }

  @Delete(":competitorId") @UseGuards(RolesGuard) @Roles("OWNER", "ADMIN")
  remove(@Param("organizationId") orgId: string, @Param("competitorId") id: string) { return this.competitors.remove(orgId, id); }

  @Post(":competitorId/sync-ads") @UseGuards(RolesGuard) @Roles("OWNER", "ADMIN", "MARKETING_MANAGER")
  syncAds(@CurrentUser() user: AuthUser, @Param("organizationId") orgId: string, @Param("competitorId") id: string, @Body() dto: SyncAdsDto) {
    return this.competitors.syncAds(orgId, user.userId, id, dto);
  }

  @Post(":competitorId/sync-multi-platform") @UseGuards(RolesGuard) @Roles("OWNER", "ADMIN", "MARKETING_MANAGER")
  syncMultiPlatform(@CurrentUser() user: AuthUser, @Param("organizationId") orgId: string, @Param("competitorId") id: string, @Body() dto: SyncMultiPlatformDto) {
    return this.competitors.syncMultiPlatform(orgId, user.userId, id, dto);
  }

  @Post(":competitorId/schedule-sync") @UseGuards(RolesGuard) @Roles("OWNER", "ADMIN", "MARKETING_MANAGER")
  scheduleSync(@CurrentUser() user: AuthUser, @Param("organizationId") orgId: string, @Param("competitorId") id: string) {
    return this.competitors.scheduleAutoSync(orgId, user.userId, id);
  }



  @Get(":competitorId/ads")
  ads(@Param("organizationId") orgId: string, @Param("competitorId") id: string) { return this.competitors.listAds(orgId, id); }

  @Post(":competitorId/scan-website") @UseGuards(RolesGuard) @Roles("OWNER", "ADMIN", "MARKETING_MANAGER")
  scan(@CurrentUser() user: AuthUser, @Param("organizationId") orgId: string, @Param("competitorId") id: string) {
    return this.competitors.scanWebsite(orgId, user.userId, id);
  }

  @Post(":competitorId/observations") @UseGuards(RolesGuard) @Roles("OWNER", "ADMIN", "MARKETING_MANAGER", "ANALYST")
  addObservation(@Param("organizationId") orgId: string, @Param("competitorId") id: string, @Body() dto: AddObservationDto) {
    return this.competitors.addObservation(orgId, id, dto);
  }

  @Get(":competitorId/observations")
  observations(@Param("organizationId") orgId: string, @Param("competitorId") id: string) {
    return this.competitors.listObservations(orgId, id);
  }

  @Get(":competitorId/seo-traffic")
  seoTraffic(@Param("organizationId") orgId: string, @Param("competitorId") id: string) {
    return this.competitors.getSeoTrafficReport(orgId, id);
  }

  @Post(":competitorId/seo-gap") @UseGuards(RolesGuard) @Roles("OWNER", "ADMIN", "MARKETING_MANAGER", "ADVERTISER")
  seoGap(
    @CurrentUser() user: AuthUser,
    @Param("organizationId") orgId: string,
    @Param("competitorId") id: string,
    @Body() dto: GenerateSeoGapDto,
  ) {
    return this.competitors.generateSeoGapStrategy(orgId, user.userId, id, dto?.ownProductId);
  }

  @Post(":competitorId/video-script") @UseGuards(RolesGuard) @Roles("OWNER", "ADMIN", "MARKETING_MANAGER", "ADVERTISER")
  deconstructVideoScript(
    @CurrentUser() user: AuthUser,
    @Param("organizationId") orgId: string,
    @Param("competitorId") id: string,
    @Body() dto: DeconstructVideoScriptDto,
  ) {
    return this.competitors.deconstructVideoScript(orgId, user.userId, id, dto);
  }

  @Get(":competitorId/reviews-mine")
  reviewsMine(@Param("organizationId") orgId: string, @Param("competitorId") id: string) {
    return this.competitors.mineCustomerComplaints(orgId, id);
  }

  @Get("alert-settings")
  getAlertSettings(@Param("organizationId") orgId: string) {
    return this.competitors.getAlertSettings(orgId);
  }

  @Post("alert-settings") @UseGuards(RolesGuard) @Roles("OWNER", "ADMIN", "MARKETING_MANAGER")
  saveAlertSettings(
    @CurrentUser() user: AuthUser,
    @Param("organizationId") orgId: string,
    @Body() dto: ConfigureAlertSettingsDto,
  ) {
    return this.competitors.saveAlertSettings(orgId, user.userId, dto);
  }

  @Post("alert-settings/test") @UseGuards(RolesGuard) @Roles("OWNER", "ADMIN", "MARKETING_MANAGER")
  testAlertChannel(
    @Param("organizationId") orgId: string,
    @Body() dto: TestAlertChannelDto,
  ) {
    return this.competitors.testSendAlert(orgId, dto);
  }
}




