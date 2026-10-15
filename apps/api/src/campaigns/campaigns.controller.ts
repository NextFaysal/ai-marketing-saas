import { Body, Controller, Delete, Get, Param, Patch, Post, Query, UseGuards } from "@nestjs/common";
import { CampaignsService } from "./campaigns.service";
import { CampaignFrontierService } from "./frontier.service";
import { CreatePlanDto, UpdatePlanDto, AddAdSetDto, AddAdDto, UpdateAdSetDto, UpdateAdDto, RejectDto, GenerateCopyDto, InstantiateBlueprintDto, SuggestPlanDto, CommentDto, ScheduleLaunchDto, CrossPlatformDto, CreateLeadFormDto, UpdateLeadFormDto, CreateLeadFormOnMetaDto, RetargetingPresetDto, CreateVariantDto, StudioCreateAudienceDto, StudioLookalikeDto, StudioExclusionPresetDto, ApplyRecommendationDto, GuardrailLinkDto, ClonePlanToAccountDto, UpdateCrossPlatformDraftDto, SnapshotVersionDto, RestoreVersionDto, ApprovalChainDto, CreateSavedViewDto, CreateExperimentDto, CreateFunnelPlanDto, CreateSeriesDto, SeriesActionDto, BudgetSimulatorDto, CompetitorResponseDto } from "./campaigns.dto";
import { CurrentUser, AuthUser, Roles, PermissionArea } from "../common/decorators";
import { TenantGuard } from "../common/tenant.guard";
import { RolesGuard } from "../common/roles.guard";

const WRITE = ["OWNER", "ADMIN", "MARKETING_MANAGER"] as const;

@PermissionArea("campaigns")
@Controller("organizations/:organizationId/campaign-plans")
@UseGuards(TenantGuard, RolesGuard)
export class CampaignsController {
  constructor(
    private readonly campaigns: CampaignsService,
    private readonly frontier: CampaignFrontierService,
  ) {}

  @Post() @UseGuards(RolesGuard) @Roles(...WRITE)
  create(@CurrentUser() user: AuthUser, @Param("organizationId") orgId: string, @Body() dto: CreatePlanDto) {
    return this.campaigns.createPlan(orgId, user.userId, dto);
  }

  // CN11 hub: no query params = the legacy bare-array
  // list; any hub param switches to the paged envelope.
  @Get()
  list(@Param("organizationId") orgId: string, @Query("page") page?: string, @Query("pageSize") pageSize?: string, @Query("includePerformance") includePerformance?: string, @Query("status") status?: string, @Query("q") q?: string, @Query("objective") objective?: string) {
    const hasOpts = page !== undefined || pageSize !== undefined || includePerformance !== undefined || status !== undefined || q !== undefined || objective !== undefined;
    if (!hasOpts) return this.campaigns.listPlans(orgId);
    return this.campaigns.listPlans(orgId, {
      page: page ? Number(page) : undefined,
      pageSize: pageSize ? Number(pageSize) : undefined,
      includePerformance: includePerformance === "true",
      status, q, objective,
    });
  }

  // Campaign Builder Next CN11: approval-chain setting
  // (two segments — never captured by the :planId route).
  // GET is open to any org member; PATCH is OWNER/ADMIN.
  @Get("settings/approval-chain")
  approvalChain(@Param("organizationId") orgId: string) { return this.campaigns.getApprovalChainSetting(orgId); }

  @Patch("settings/approval-chain") @UseGuards(RolesGuard) @Roles("OWNER", "ADMIN")
  setApprovalChain(@CurrentUser() user: AuthUser, @Param("organizationId") orgId: string, @Body() dto: ApprovalChainDto) {
    return this.campaigns.setApprovalChainSetting(orgId, user.userId, dto);
  }

  // Campaign Builder Next CN11: the current user's saved
  // hub views (two segments — never captured by :planId).
  @Get("saved-views/list")
  listSavedViews(@CurrentUser() user: AuthUser, @Param("organizationId") orgId: string) {
    return this.campaigns.listSavedViews(orgId, user.userId);
  }

  @Post("saved-views") @UseGuards(RolesGuard) @Roles(...WRITE)
  createSavedView(@CurrentUser() user: AuthUser, @Param("organizationId") orgId: string, @Body() dto: CreateSavedViewDto) {
    return this.campaigns.createSavedView(orgId, user.userId, dto);
  }

  @Delete("saved-views/:viewId") @UseGuards(RolesGuard) @Roles(...WRITE)
  deleteSavedView(@CurrentUser() user: AuthUser, @Param("organizationId") orgId: string, @Param("viewId") viewId: string) {
    return this.campaigns.deleteSavedView(orgId, user.userId, viewId);
  }

  // Campaign Builder Next CN1: Meta targeting discovery
  // (two segments — never captured by the :planId route).
  @Get("targeting/search")
  targetingSearch(@Param("organizationId") orgId: string, @Query("adAccountId") adAccountId: string, @Query("kind") kind: string, @Query("q") q: string) {
    return this.campaigns.searchTargeting(orgId, { adAccountId: adAccountId ?? "", kind: kind ?? "", query: q ?? "" });
  }

  // Campaign Builder Next CN4: Lead Forms (two segments —
  // never captured by the :planId route).
  @Get("lead-forms/list")
  listLeadForms(@Param("organizationId") orgId: string) { return this.campaigns.listLeadForms(orgId); }

  @Post("lead-forms") @UseGuards(RolesGuard) @Roles(...WRITE)
  createLeadForm(@CurrentUser() user: AuthUser, @Param("organizationId") orgId: string, @Body() dto: CreateLeadFormDto) {
    return this.campaigns.createLeadForm(orgId, user.userId, dto as any);
  }

  @Get("lead-forms/:formId")
  getLeadForm(@Param("organizationId") orgId: string, @Param("formId") formId: string) { return this.campaigns.getLeadForm(orgId, formId); }

  @Patch("lead-forms/:formId") @UseGuards(RolesGuard) @Roles(...WRITE)
  updateLeadForm(@CurrentUser() user: AuthUser, @Param("organizationId") orgId: string, @Param("formId") formId: string, @Body() dto: UpdateLeadFormDto) {
    return this.campaigns.updateLeadForm(orgId, formId, user.userId, dto as any);
  }

  @Post("lead-forms/:formId/create-on-meta") @UseGuards(RolesGuard) @Roles(...WRITE)
  createLeadFormOnMeta(@CurrentUser() user: AuthUser, @Param("organizationId") orgId: string, @Param("formId") formId: string, @Body() dto: CreateLeadFormOnMetaDto) {
    return this.campaigns.createLeadFormOnMetaAction(orgId, user.userId, formId, dto.adAccountId);
  }

  // Frontier CN13 (NB6): the org's WhatsApp connections
  // the builder destination picker offers (declared
  // before ":planId" so it is not swallowed as a plan id).
  @Get("whatsapp-destinations")
  whatsappDestinations(@Param("organizationId") orgId: string) { return this.campaigns.whatsappDestinations(orgId); }

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

  // Campaign Builder CB1: in-place edits + duplicates.
  @Patch(":planId/ad-sets/:adSetId") @UseGuards(RolesGuard) @Roles(...WRITE)
  updateAdSet(@CurrentUser() user: AuthUser, @Param("organizationId") orgId: string, @Param("planId") id: string, @Param("adSetId") adSetId: string, @Body() dto: UpdateAdSetDto) {
    return this.campaigns.updateAdSet(orgId, id, adSetId, user.userId, dto);
  }

  @Post(":planId/ad-sets/:adSetId/duplicate") @UseGuards(RolesGuard) @Roles(...WRITE)
  duplicateAdSet(@CurrentUser() user: AuthUser, @Param("organizationId") orgId: string, @Param("planId") id: string, @Param("adSetId") adSetId: string) {
    return this.campaigns.duplicateAdSet(orgId, id, adSetId, user.userId);
  }

  @Patch(":planId/ads/:adId") @UseGuards(RolesGuard) @Roles(...WRITE)
  updateAd(@CurrentUser() user: AuthUser, @Param("organizationId") orgId: string, @Param("planId") id: string, @Param("adId") adId: string, @Body() dto: UpdateAdDto) {
    return this.campaigns.updateAd(orgId, id, adId, user.userId, dto);
  }

  @Post(":planId/ads/:adId/duplicate") @UseGuards(RolesGuard) @Roles(...WRITE)
  duplicateAd(@CurrentUser() user: AuthUser, @Param("organizationId") orgId: string, @Param("planId") id: string, @Param("adId") adId: string) {
    return this.campaigns.duplicateAd(orgId, id, adId, user.userId);
  }

  // Campaign Builder Next CN5: variant of an ad carrying a
  // chosen creative-library / social-library asset.
  @Post(":planId/ads/:adId/variant") @UseGuards(RolesGuard) @Roles(...WRITE)
  createVariant(@CurrentUser() user: AuthUser, @Param("organizationId") orgId: string, @Param("planId") id: string, @Param("adId") adId: string, @Body() dto: CreateVariantDto) {
    return this.campaigns.createAdVariant(orgId, id, adId, user.userId, dto);
  }

  // Campaign Builder Next CN6: Audience Studio (inside an
  // ad set; every action rides the AudiencesService).
  @Get(":planId/audience-studio")
  audienceStudio(@Param("organizationId") orgId: string, @Param("planId") id: string) {
    return this.campaigns.audienceStudio(orgId, id);
  }

  @Post(":planId/ad-sets/:adSetId/audiences/create") @UseGuards(RolesGuard) @Roles(...WRITE)
  studioCreateAudience(@CurrentUser() user: AuthUser, @Param("organizationId") orgId: string, @Param("planId") id: string, @Param("adSetId") adSetId: string, @Body() dto: StudioCreateAudienceDto) {
    return this.campaigns.studioCreateAudience(orgId, id, adSetId, user.userId, dto);
  }

  @Post(":planId/ad-sets/:adSetId/audiences/lookalike") @UseGuards(RolesGuard) @Roles(...WRITE)
  studioLookalike(@CurrentUser() user: AuthUser, @Param("organizationId") orgId: string, @Param("planId") id: string, @Param("adSetId") adSetId: string, @Body() dto: StudioLookalikeDto) {
    return this.campaigns.studioCreateLookalike(orgId, id, adSetId, user.userId, dto);
  }

  @Post(":planId/ad-sets/:adSetId/audiences/exclusion-preset") @UseGuards(RolesGuard) @Roles(...WRITE)
  studioExclusionPreset(@CurrentUser() user: AuthUser, @Param("organizationId") orgId: string, @Param("planId") id: string, @Param("adSetId") adSetId: string, @Body() dto: StudioExclusionPresetDto) {
    return this.campaigns.studioApplyExclusionPreset(orgId, id, adSetId, user.userId, dto);
  }

  @Get(":planId/ad-sets/:adSetId/audience-insights")
  audienceInsights(@Param("organizationId") orgId: string, @Param("planId") id: string, @Param("adSetId") adSetId: string) {
    return this.campaigns.audienceInsights(orgId, id, adSetId);
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

  // Campaign Builder CB3: AI draft suggestion + creative health.
  @Post("suggest") @UseGuards(RolesGuard) @Roles(...WRITE)
  suggest(@CurrentUser() user: AuthUser, @Param("organizationId") orgId: string, @Body() dto: SuggestPlanDto) {
    return this.campaigns.suggestPlan(orgId, user.userId, dto);
  }

  @Post(":planId/creative-health")
  creativeHealth(@Param("organizationId") orgId: string, @Param("planId") id: string) {
    return this.campaigns.creativeHealth(orgId, id);
  }

  // Campaign Builder CB4: comments, timeline, snapshot.
  @Get(":planId/comments")
  listComments(@Param("organizationId") orgId: string, @Param("planId") id: string) {
    return this.campaigns.listComments(orgId, id);
  }

  @Post(":planId/comments") @UseGuards(RolesGuard) @Roles(...WRITE)
  addComment(@CurrentUser() user: AuthUser, @Param("organizationId") orgId: string, @Param("planId") id: string, @Body() dto: CommentDto) {
    return this.campaigns.addComment(orgId, id, user.userId, dto.body);
  }

  @Get(":planId/timeline")
  timeline(@Param("organizationId") orgId: string, @Param("planId") id: string) {
    return this.campaigns.planTimeline(orgId, id);
  }

  @Get(":planId/submission-diff")
  submissionDiff(@Param("organizationId") orgId: string, @Param("planId") id: string) {
    return this.campaigns.submissionDiff(orgId, id);
  }

  // Campaign Builder Next CN11: plan versions — manual
  // snapshots, history, structural diff, restore-as-draft.
  @Post(":planId/versions") @UseGuards(RolesGuard) @Roles(...WRITE)
  createVersion(@CurrentUser() user: AuthUser, @Param("organizationId") orgId: string, @Param("planId") id: string, @Body() _dto: SnapshotVersionDto) {
    return this.campaigns.createVersionSnapshot(orgId, user.userId, id);
  }

  @Get(":planId/versions")
  listVersions(@Param("organizationId") orgId: string, @Param("planId") id: string) {
    return this.campaigns.listVersions(orgId, id);
  }

  @Get(":planId/versions/:versionId/diff")
  diffVersion(@Param("organizationId") orgId: string, @Param("planId") id: string, @Param("versionId") versionId: string) {
    return this.campaigns.diffVersion(orgId, id, versionId);
  }

  @Post(":planId/versions/:versionId/restore") @UseGuards(RolesGuard) @Roles(...WRITE)
  restoreVersion(@CurrentUser() user: AuthUser, @Param("organizationId") orgId: string, @Param("planId") id: string, @Param("versionId") versionId: string, @Body() _dto: RestoreVersionDto) {
    return this.campaigns.restoreVersion(orgId, user.userId, id, versionId);
  }

  // Campaign Builder Next CN11: last recorded activity
  // (audit trail — NOT realtime presence).
  @Get(":planId/last-activity")
  lastActivity(@Param("organizationId") orgId: string, @Param("planId") id: string) {
    return this.campaigns.planLastActivity(orgId, id);
  }

  // Campaign Builder CB5: performance, winner, launch.
  @Get(":planId/performance")
  performance(@Param("organizationId") orgId: string, @Param("planId") id: string) {
    return this.campaigns.planPerformance(orgId, id);
  }

  // Frontier CN13 (NB6): conversations started per ad,
  // matched by the inbox's first-message CTWA referral.
  @Get(":planId/whatsapp-conversations")
  whatsappConversations(@Param("organizationId") orgId: string, @Param("planId") id: string) {
    return this.campaigns.planWhatsAppConversations(orgId, id);
  }

  // Campaign Builder Next CN2: pacing read-model.
  @Get(":planId/pacing")
  pacing(@Param("organizationId") orgId: string, @Param("planId") id: string) {
    return this.campaigns.planPacing(orgId, id);
  }

  // Campaign Builder Next CN8: portfolio + account health
  // (two segments — never captured by the :planId route).
  @Get("portfolio/totals")
  portfolio(@Param("organizationId") orgId: string) {
    return this.campaigns.portfolioTotals(orgId);
  }

  @Get("accounts/health")
  accountsHealth(@Param("organizationId") orgId: string) {
    return this.campaigns.accountsHealth(orgId);
  }

  // Campaign Builder Next CN7: breakdowns, creative
  // insights, recommendations, guardrails.
  @Get(":planId/performance-breakdowns")
  performanceBreakdowns(@Param("organizationId") orgId: string, @Param("planId") id: string) {
    return this.campaigns.planBreakdowns(orgId, id);
  }

  @Get(":planId/creative-insights")
  creativeInsights(@Param("organizationId") orgId: string, @Param("planId") id: string) {
    return this.campaigns.planCreativeInsights(orgId, id);
  }

  @Get(":planId/recommendations")
  recommendations(@Param("organizationId") orgId: string, @Param("planId") id: string) {
    return this.campaigns.planRecommendations(orgId, id);
  }

  @Post(":planId/recommendations/apply") @UseGuards(RolesGuard) @Roles(...WRITE)
  applyRecommendation(@CurrentUser() user: AuthUser, @Param("organizationId") orgId: string, @Param("planId") id: string, @Body() dto: ApplyRecommendationDto) {
    return this.campaigns.applyRecommendation(orgId, user.userId, id, dto);
  }

  @Get(":planId/guardrails")
  guardrails(@Param("organizationId") orgId: string, @Param("planId") id: string) {
    return this.campaigns.planGuardrails(orgId, id);
  }

  @Post(":planId/guardrails/attach") @UseGuards(RolesGuard) @Roles(...WRITE)
  attachGuardrail(@CurrentUser() user: AuthUser, @Param("organizationId") orgId: string, @Param("planId") id: string, @Body() dto: GuardrailLinkDto) {
    return this.campaigns.attachGuardrail(orgId, user.userId, id, dto.ruleId);
  }

  @Post(":planId/guardrails/detach") @UseGuards(RolesGuard) @Roles(...WRITE)
  detachGuardrail(@CurrentUser() user: AuthUser, @Param("organizationId") orgId: string, @Param("planId") id: string, @Body() dto: GuardrailLinkDto) {
    return this.campaigns.detachGuardrail(orgId, user.userId, id, dto.ruleId);
  }

  // Campaign Builder Next CN8: cross-account clone.
  @Post(":planId/clone-to-account") @UseGuards(RolesGuard) @Roles(...WRITE)
  cloneToAccount(@CurrentUser() user: AuthUser, @Param("organizationId") orgId: string, @Param("planId") id: string, @Body() dto: ClonePlanToAccountDto) {
    return this.campaigns.clonePlanToAccount(orgId, user.userId, id, dto as any);
  }

  // Campaign Builder Next CN9: manageable cross-platform drafts.
  @Get(":planId/xdrafts")
  listXDrafts(@Param("organizationId") orgId: string, @Param("planId") id: string) {
    return this.campaigns.listCrossPlatformDrafts(orgId, id);
  }

  @Patch(":planId/xdrafts/:draftId") @UseGuards(RolesGuard) @Roles(...WRITE)
  updateXDraft(@CurrentUser() user: AuthUser, @Param("organizationId") orgId: string, @Param("planId") id: string, @Param("draftId") draftId: string, @Body() dto: UpdateCrossPlatformDraftDto) {
    return this.campaigns.updateCrossPlatformDraft(orgId, user.userId, id, draftId, dto.fields);
  }

  @Post(":planId/xdrafts/:draftId/readiness")
  xDraftReadiness(@Param("organizationId") orgId: string, @Param("planId") id: string, @Param("draftId") draftId: string) {
    return this.campaigns.crossPlatformDraftReadiness(orgId, id, draftId);
  }

  @Get(":planId/xdrafts/:draftId/preview")
  xDraftPreview(@Param("organizationId") orgId: string, @Param("planId") id: string, @Param("draftId") draftId: string) {
    return this.campaigns.previewCrossPlatformDraft(orgId, id, draftId);
  }

  @Post(":planId/xdrafts/:draftId/publish") @UseGuards(RolesGuard) @Roles(...WRITE)
  publishXDraft(@CurrentUser() user: AuthUser, @Param("organizationId") orgId: string, @Param("planId") id: string, @Param("draftId") draftId: string) {
    return this.campaigns.publishCrossPlatformDraft(orgId, user.userId, id, draftId);
  }

  @Post(":planId/xdrafts/:draftId/sync-status") @UseGuards(RolesGuard) @Roles(...WRITE)
  syncXDraftStatus(@Param("organizationId") orgId: string, @Param("planId") id: string, @Param("draftId") draftId: string) {
    return this.campaigns.syncCrossPlatformDraftStatus(orgId, id, draftId);
  }

  @Post(":planId/promote-winner") @UseGuards(RolesGuard) @Roles(...WRITE)
  promoteWinner(@CurrentUser() user: AuthUser, @Param("organizationId") orgId: string, @Param("planId") id: string) {
    return this.campaigns.promoteWinner(orgId, id, user.userId);
  }

  @Post(":planId/schedule-launch") @UseGuards(RolesGuard) @Roles(...WRITE)
  scheduleLaunch(@CurrentUser() user: AuthUser, @Param("organizationId") orgId: string, @Param("planId") id: string, @Body() dto: ScheduleLaunchDto) {
    return this.campaigns.scheduleLaunch(orgId, id, user.userId, dto.publishAt ?? null);
  }

  // Campaign Builder CB6: cross-platform draft.
  @Post(":planId/cross-platform") @UseGuards(RolesGuard) @Roles(...WRITE)
  crossPlatform(@CurrentUser() user: AuthUser, @Param("organizationId") orgId: string, @Param("planId") id: string, @Body() dto: CrossPlatformDto) {
    return this.campaigns.crossPlatformDraft(orgId, id, user.userId, dto);
  }

  // Campaign Builder Next CN3: dynamic-retargeting preset
  // (consumes existing AudienceRecords; honest
  // missing / needs_choice answers).
  @Post(":planId/retargeting-preset") @UseGuards(RolesGuard) @Roles(...WRITE)
  retargetingPreset(@CurrentUser() user: AuthUser, @Param("organizationId") orgId: string, @Param("planId") id: string, @Body() dto: RetargetingPresetDto) {
    return this.campaigns.applyRetargetingPreset(orgId, id, user.userId, dto);
  }

  // Campaign Builder CB2: unified readiness (read-only).
  @Post(":planId/readiness")
  readiness(@Param("organizationId") orgId: string, @Param("planId") id: string) {
    return this.campaigns.readiness(orgId, id);
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
  // NB4/CN7: exposes the EXISTING per-ad-set status path
  // (Meta-first, used internally by status sync) so the
  // dead-ad-set recommendation's pause is an explicit click
  // through a real route — no new engine.
  @Post(":planId/ad-sets/:adSetId/status") @UseGuards(RolesGuard) @Roles("OWNER", "ADMIN")
  adSetStatus(@CurrentUser() user: AuthUser, @Param("organizationId") orgId: string, @Param("planId") planId: string, @Param("adSetId") adSetId: string, @Body() body: { target?: string }) {
    return this.campaigns.setAdSetStatus(orgId, user.userId, planId, adSetId, body?.target === "ACTIVE" ? "ACTIVE" : "PAUSED");
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

  // ---------- Frontier NB7: CN15 experiments + CN16 funnel/series ----------
  // CN15: create a Meta Ad Study over two published variant
  // plans (the study is Meta-side; plans are never touched).
  @Post("experiments") @UseGuards(RolesGuard) @Roles(...WRITE)
  createExperiment(@CurrentUser() user: AuthUser, @Param("organizationId") orgId: string, @Body() dto: CreateExperimentDto) {
    return this.frontier.createExperiment(orgId, user.userId, dto);
  }
  @Get("experiments/list")
  experiments(@Param("organizationId") orgId: string) {
    return this.frontier.listExperiments(orgId);
  }
  @Get("experiments/:experimentId")
  experiment(@Param("organizationId") orgId: string, @Param("experimentId") experimentId: string) {
    return this.frontier.getExperiment(orgId, experimentId);
  }
  @Post("experiments/:experimentId/refresh") @UseGuards(RolesGuard) @Roles(...WRITE)
  refreshExperiment(@CurrentUser() user: AuthUser, @Param("organizationId") orgId: string, @Param("experimentId") experimentId: string) {
    return this.frontier.refreshExperiment(orgId, user.userId, experimentId);
  }
  @Get(":planId/experiments")
  planExperiments(@Param("organizationId") orgId: string, @Param("planId") planId: string) {
    return this.frontier.listExperimentsForPlan(orgId, planId);
  }
  // ---------- Frontier NB8: CN18 insights & sharing ----------
  // The budget simulator: deterministic, own-data only —
  // below its sample floors it refuses (available:false).
  @Post("budget-simulator")
  budgetSimulator(@Param("organizationId") orgId: string, @Body() dto: BudgetSimulatorDto) {
    return this.campaigns.budgetSimulator(orgId, dto);
  }
  // A competitor-response DRAFT plan: the competitor gives
  // only the angle (a note); copy comes from the org's own
  // product through the grounded copy path.
  @Post("competitor-response") @UseGuards(RolesGuard) @Roles(...WRITE)
  competitorResponse(@CurrentUser() user: AuthUser, @Param("organizationId") orgId: string, @Body() dto: CompetitorResponseDto) {
    return this.campaigns.competitorResponseDraft(orgId, user.userId, dto);
  }

  // CN16: the full-funnel wizard (one plan, labelled layers).
  @Post("funnel-plans") @UseGuards(RolesGuard) @Roles(...WRITE)
  funnelPlan(@CurrentUser() user: AuthUser, @Param("organizationId") orgId: string, @Body() dto: CreateFunnelPlanDto) {
    return this.frontier.createFunnelPlan(orgId, user.userId, dto);
  }
  // CN16: recurring series over a template plan.
  @Post(":planId/series") @UseGuards(RolesGuard) @Roles(...WRITE)
  createSeries(@CurrentUser() user: AuthUser, @Param("organizationId") orgId: string, @Param("planId") planId: string, @Body() dto: CreateSeriesDto) {
    return this.frontier.createSeries(orgId, user.userId, planId, dto);
  }
  @Get("series/list")
  seriesList(@Param("organizationId") orgId: string) {
    return this.frontier.listSeries(orgId);
  }
  @Get(":planId/series")
  planSeries(@Param("organizationId") orgId: string, @Param("planId") planId: string) {
    return this.frontier.listSeriesForPlan(orgId, planId);
  }
  @Patch("series/:seriesId") @UseGuards(RolesGuard) @Roles(...WRITE)
  seriesAction(@CurrentUser() user: AuthUser, @Param("organizationId") orgId: string, @Param("seriesId") seriesId: string, @Body() dto: SeriesActionDto) {
    return this.frontier.seriesAction(orgId, user.userId, seriesId, dto?.action ?? "");
  }
}
