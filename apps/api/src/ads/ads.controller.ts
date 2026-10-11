import { Body, Controller, Get, Param, Patch, Post, Query, UseGuards } from "@nestjs/common";
import { AdsService } from "./ads.service";
import { CreateAdAccountDto, ManualMetricDto, ImportAdCsvDto, MetaConnectDto, MetaSyncDto, GoogleConnectDto, TikTokConnectDto, RangeSyncDto, UpdateSpendWatchDto, MetaDiscoverDto, UpdateAccountSettingsDto } from "./ads.dto";
import { CurrentUser, AuthUser, Roles, PermissionArea } from "../common/decorators";
import { TenantGuard } from "../common/tenant.guard";
import { RolesGuard } from "../common/roles.guard";

const WRITE_ROLES = ["OWNER", "ADMIN", "MARKETING_MANAGER"];

@PermissionArea("ads")
@Controller("organizations/:organizationId")
@UseGuards(TenantGuard, RolesGuard)
export class AdsController {
  constructor(private readonly ads: AdsService) {}

  @Post("ad-accounts") @UseGuards(RolesGuard) @Roles(...WRITE_ROLES)
  createAccount(@CurrentUser() user: AuthUser, @Param("organizationId") orgId: string, @Body() dto: CreateAdAccountDto) {
    return this.ads.createAccount(orgId, user.userId, dto);
  }

  @Get("ad-accounts")
  listAccounts(@Param("organizationId") orgId: string) { return this.ads.listAccounts(orgId); }

  @Post("ad-accounts/:accountId/disconnect") @UseGuards(RolesGuard) @Roles("OWNER", "ADMIN")
  disconnectAccount(@CurrentUser() user: AuthUser, @Param("organizationId") orgId: string, @Param("accountId") id: string) {
    return this.ads.disconnectAccount(orgId, user.userId, id);
  }

  // AD5: per-account settings — the sync switch (publishing is not
  // affected by it; see the service for the exact gate semantics).
  @Patch("ad-accounts/:accountId/sync") @UseGuards(RolesGuard) @Roles(...WRITE_ROLES)
  updateAccountSettings(@CurrentUser() user: AuthUser, @Param("organizationId") orgId: string, @Param("accountId") id: string, @Body() dto: UpdateAccountSettingsDto) {
    return this.ads.updateAccountSettings(orgId, user.userId, id, dto);
  }

  @Post("ad-accounts/:accountId/refresh-status") @UseGuards(RolesGuard) @Roles(...WRITE_ROLES)
  refreshStatus(@CurrentUser() user: AuthUser, @Param("organizationId") orgId: string, @Param("accountId") id: string) {
    return this.ads.refreshAccountStatus(orgId, user.userId, id);
  }

  // AD6: bulk sync-all — sequential per-account campaign-insights
  // syncs; per-account results, audited once with the counts.
  @Post("ad-accounts/sync-all") @UseGuards(RolesGuard) @Roles(...WRITE_ROLES)
  syncAll(@CurrentUser() user: AuthUser, @Param("organizationId") orgId: string) {
    return this.ads.syncAllAccounts(orgId, user.userId);
  }

  // AD4: spend watchdog — the GET returns the SAME computation the
  // watchdog job uses (spend-watch.ts), so UI and alerts never drift.
  @Get("ad-accounts/:accountId/spend-watch")
  getSpendWatch(@Param("organizationId") orgId: string, @Param("accountId") id: string) {
    return this.ads.getSpendWatch(orgId, id);
  }

  @Patch("ad-accounts/:accountId/spend-watch") @UseGuards(RolesGuard) @Roles("OWNER", "ADMIN")
  updateSpendWatch(@CurrentUser() user: AuthUser, @Param("organizationId") orgId: string, @Param("accountId") id: string, @Body() dto: UpdateSpendWatchDto) {
    return this.ads.updateSpendWatch(orgId, user.userId, id, dto);
  }

  @Post("ad-accounts/:accountId/metrics/manual") @UseGuards(RolesGuard) @Roles(...WRITE_ROLES)
  manual(@CurrentUser() user: AuthUser, @Param("organizationId") orgId: string, @Param("accountId") id: string, @Body() dto: ManualMetricDto) {
    return this.ads.manualEntry(orgId, user.userId, id, dto);
  }

  @Post("ad-accounts/:accountId/metrics/import-csv") @UseGuards(RolesGuard) @Roles(...WRITE_ROLES)
  importCsv(@CurrentUser() user: AuthUser, @Param("organizationId") orgId: string, @Param("accountId") id: string, @Body() dto: ImportAdCsvDto) {
    return this.ads.importCsv(orgId, user.userId, id, dto);
  }

  @Get("creative-leaderboard")
  leaderboard(@Param("organizationId") orgId: string, @Query("days") days?: string) {
    return this.ads.creativeLeaderboard(orgId, Math.min(90, Math.max(1, Number(days ?? 14) || 14)));
  }
  @Get("pacing")
  pacing(@Param("organizationId") orgId: string, @Query("budget") budget?: string) {
    return this.ads.pacing(orgId, budget ? Number(budget) : undefined);
  }
  @Get("ctwa-report")
  ctwa(@Param("organizationId") orgId: string, @Query("days") days?: string) {
    return this.ads.ctwaReport(orgId, Math.min(90, Math.max(1, Number(days) || 30)));
  }
  // AD5 picker step 1: verify the token + list its accounts.
  // Stores nothing; the token is never persisted or echoed back.
  @Post("integrations/meta/discover") @UseGuards(RolesGuard) @Roles("OWNER", "ADMIN")
  discoverMeta(@Param("organizationId") orgId: string, @Body() dto: MetaDiscoverDto) {
    return this.ads.discoverMetaAccounts(orgId, dto);
  }

  @Post("integrations/meta/connect") @UseGuards(RolesGuard) @Roles("OWNER", "ADMIN")
  connectMeta(@CurrentUser() user: AuthUser, @Param("organizationId") orgId: string, @Body() dto: MetaConnectDto) {
    return this.ads.connectMeta(orgId, user.userId, dto);
  }

  @Post("ad-accounts/:accountId/sync/meta-ad-insights") @UseGuards(RolesGuard) @Roles(...WRITE_ROLES)
  syncMetaAds(@CurrentUser() user: AuthUser, @Param("organizationId") orgId: string, @Param("accountId") id: string, @Body() dto: MetaSyncDto) {
    return this.ads.syncMetaAdInsights(orgId, user.userId, id, dto);
  }
  @Post("ad-accounts/:accountId/sync/meta-breakdowns") @UseGuards(RolesGuard) @Roles(...WRITE_ROLES)
  syncMetaBreakdowns(@CurrentUser() user: AuthUser, @Param("organizationId") orgId: string, @Param("accountId") id: string, @Body() dto: MetaSyncDto) {
    return this.ads.syncMetaBreakdowns(orgId, user.userId, id, dto);
  }
  @Get("ad-accounts/:accountId/ad-metrics")
  adMetrics(@Param("organizationId") orgId: string, @Param("accountId") id: string, @Query("days") days?: string) {
    return this.ads.getAdMetrics(orgId, id, Math.min(90, Math.max(1, Number(days) || 30)));
  }
  @Get("ad-accounts/:accountId/breakdowns")
  breakdowns(@Param("organizationId") orgId: string, @Param("accountId") id: string, @Query("dimension") dimension?: string, @Query("days") days?: string) {
    return this.ads.getBreakdowns(orgId, id, dimension ?? "age_gender", Math.min(90, Math.max(1, Number(days) || 30)));
  }
  @Post("ad-accounts/:accountId/sync/meta-insights") @UseGuards(RolesGuard) @Roles(...WRITE_ROLES)
  syncMeta(@CurrentUser() user: AuthUser, @Param("organizationId") orgId: string, @Param("accountId") id: string, @Body() dto: MetaSyncDto) {
    return this.ads.syncMetaInsights(orgId, user.userId, id, dto);
  }

  @Post("integrations/google/connect") @UseGuards(RolesGuard) @Roles("OWNER", "ADMIN")
  connectGoogle(@CurrentUser() user: AuthUser, @Param("organizationId") orgId: string, @Body() dto: GoogleConnectDto) {
    return this.ads.connectGoogle(orgId, user.userId, dto);
  }

  @Post("ad-accounts/:accountId/sync/google-insights") @UseGuards(RolesGuard) @Roles(...WRITE_ROLES)
  syncGoogle(@CurrentUser() user: AuthUser, @Param("organizationId") orgId: string, @Param("accountId") id: string, @Body() dto: RangeSyncDto) {
    return this.ads.syncGoogleInsights(orgId, user.userId, id, dto);
  }

  @Post("integrations/tiktok/connect") @UseGuards(RolesGuard) @Roles("OWNER", "ADMIN")
  connectTikTok(@CurrentUser() user: AuthUser, @Param("organizationId") orgId: string, @Body() dto: TikTokConnectDto) {
    return this.ads.connectTikTok(orgId, user.userId, dto);
  }

  @Post("ad-accounts/:accountId/sync/tiktok-insights") @UseGuards(RolesGuard) @Roles(...WRITE_ROLES)
  syncTikTok(@CurrentUser() user: AuthUser, @Param("organizationId") orgId: string, @Param("accountId") id: string, @Body() dto: RangeSyncDto) {
    return this.ads.syncTikTokInsights(orgId, user.userId, id, dto);
  }
}
