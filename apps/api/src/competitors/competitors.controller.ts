import { Body, Controller, Delete, Get, Param, Patch, Post, UseGuards } from "@nestjs/common";
import { CompetitorsService } from "./competitors.service";
import { CreateCompetitorDto, UpdateCompetitorDto, SyncAdsDto, AddObservationDto, GenerateInsightsDto } from "./competitors.dto";
import { CurrentUser, AuthUser, Roles } from "../common/decorators";
import { TenantGuard } from "../common/tenant.guard";
import { RolesGuard } from "../common/roles.guard";

@Controller("organizations/:organizationId/competitors")
@UseGuards(TenantGuard)
export class CompetitorsController {
  constructor(private readonly competitors: CompetitorsService) {}

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
}
