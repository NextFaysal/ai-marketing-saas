import { Body, Controller, Delete, Get, Header, Param, Patch, Post, Put, Query, Redirect, Res, UseGuards } from "@nestjs/common";
import type { Response } from "express";
import { MessagingService } from "./messaging.service";
import { TRANSPARENT_GIF_BASE64 } from "./open-token";
import { CreateTemplateDto, UpdateTemplateDto, CreateBroadcastDto, PreviewBroadcastDto, PreviewAudienceDto, PreviewPersonalisationDto, ScheduleBroadcastDto, UpdateMessagingSettingDto, AddPreferenceDto, ImportPreferencesDto, CreateSavedAudienceDto, UpdateSavedAudienceDto, UpdateTenantEmailDto, UpdateTenantSmsDto, AddSmsGatewayDto, UpdateSenderRatesDto, SendTestEmailDto, TestSendDto, ComposeCheckDto, ComposeCheckV2Dto, ApprovalDecisionDto, CreateSeedRecipientDto, TestSendSeedDto, InstallJourneyPresetDto, CreateJourneyDto, UpdateJourneyDto, AiDraftDto, AiSubjectsDto, AiSegmentDraftDto, AiPlannerDto, AiTranslateDto, AiSubjectScoreDto, AbAutoWinnerDto, ApplySuppressionDto, UpdateBroadcastDto, CreateKeywordRuleDto, UpdateKeywordRuleDto, ApplyKeywordLabelDto, CreateContentBlockDto, UpdateContentBlockDto, CreateOptInFormDto, UpdateOptInFormDto, SubmitOptInFormDto, UpdatePreferenceCenterDto, IssuePreferenceLinkDto, PreviewCsvImportDto } from "./messaging.dto";
import { CurrentUser, AuthUser, Roles, PermissionArea, Public } from "../common/decorators";
import { TenantGuard } from "../common/tenant.guard";
import { RolesGuard } from "../common/roles.guard";

const WRITE_ROLES = ["OWNER", "ADMIN", "MARKETING_MANAGER"];

@PermissionArea("campaigns")
@Controller("organizations/:organizationId/messaging")
@UseGuards(TenantGuard, RolesGuard)
export class MessagingController {
  constructor(private readonly messaging: MessagingService) {}

  @Get("provider-status")
  status(@Param("organizationId") orgId: string) { return this.messaging.providerStatus(orgId); }

  // ---------- MS5: composer support ----------
  @Get("variables")
  variables() { return this.messaging.getTemplateVariables(); }
  @Get("composer/products")
  composerProducts(@Param("organizationId") orgId: string) { return this.messaging.listComposerProducts(orgId); }
  // ---------- MX7: email builder support ----------
  /** Brand kit — read from Org Settings branding (Organization row). */
  @Get("brand-kit")
  brandKit(@Param("organizationId") orgId: string) { return this.messaging.getBrandKit(orgId); }
  /** Real StoreDiscount rows for coupon-slot picking. */
  @Get("composer/discounts")
  composerDiscounts(@Param("organizationId") orgId: string) { return this.messaging.listComposerDiscounts(orgId); }
  /** Render blocks for a live builder preview (nothing is saved). */
  @Post("blocks/preview") @UseGuards(RolesGuard) @Roles(...WRITE_ROLES)
  blocksPreview(@Param("organizationId") orgId: string, @Body() dto: { blocks?: unknown }) {
    return this.messaging.renderBlocksForOrg(orgId, dto.blocks);
  }
  @Get("template-packs")
  templatePacks() { return this.messaging.listFestivalPacks(); }
  @Post("template-packs/:key/install") @UseGuards(RolesGuard) @Roles(...WRITE_ROLES)
  installTemplatePack(@CurrentUser() user: AuthUser, @Param("organizationId") orgId: string, @Param("key") key: string) {
    return this.messaging.installFestivalPack(orgId, user.userId, key);
  }
  // MX7: content library (saved blocks) — literal routes before templates/:id-style segments.
  @Get("content-blocks")
  listContentBlocks(@Param("organizationId") orgId: string, @Query("kind") kind?: string) { return this.messaging.listContentBlocks(orgId, kind); }
  @Post("content-blocks") @UseGuards(RolesGuard) @Roles(...WRITE_ROLES)
  createContentBlock(@CurrentUser() user: AuthUser, @Param("organizationId") orgId: string, @Body() dto: CreateContentBlockDto) {
    return this.messaging.createContentBlock(orgId, user.userId, dto);
  }
  @Patch("content-blocks/:blockId") @UseGuards(RolesGuard) @Roles(...WRITE_ROLES)
  updateContentBlock(@Param("organizationId") orgId: string, @Param("blockId") id: string, @Body() dto: UpdateContentBlockDto) {
    return this.messaging.updateContentBlock(orgId, id, dto);
  }
  @Delete("content-blocks/:blockId") @UseGuards(RolesGuard) @Roles("OWNER", "ADMIN")
  deleteContentBlock(@Param("organizationId") orgId: string, @Param("blockId") id: string) {
    return this.messaging.deleteContentBlock(orgId, id);
  }
  @Post("compose-check") @UseGuards(RolesGuard) @Roles(...WRITE_ROLES)
  composeCheck(@Body() dto: ComposeCheckDto) { return this.messaging.checkCompose(dto); }

  // ---------- MX15: governance (health, checklist v2, seeds, approvals) ----------
  // Literal routes, declared before broadcasts/:broadcastId.
  @Get("health")
  health(@Param("organizationId") orgId: string, @Query("days") days?: string) {
    return this.messaging.getDeliveryHealth(orgId, days ? Number(days) : undefined);
  }
  @Post("compose-check-v2") @UseGuards(RolesGuard) @Roles(...WRITE_ROLES)
  composeCheckV2(@Param("organizationId") orgId: string, @Body() dto: ComposeCheckV2Dto) { return this.messaging.checkComposeV2(orgId, dto); }
  @Get("seed-recipients")
  listSeeds(@Param("organizationId") orgId: string) { return this.messaging.listSeedRecipients(orgId); }
  @Post("seed-recipients") @UseGuards(RolesGuard) @Roles(...WRITE_ROLES)
  addSeed(@CurrentUser() user: AuthUser, @Param("organizationId") orgId: string, @Body() dto: CreateSeedRecipientDto) {
    return this.messaging.addSeedRecipient(orgId, user.userId, dto);
  }
  @Delete("seed-recipients/:seedId") @UseGuards(RolesGuard) @Roles(...WRITE_ROLES)
  removeSeed(@CurrentUser() user: AuthUser, @Param("organizationId") orgId: string, @Param("seedId") seedId: string) {
    return this.messaging.removeSeedRecipient(orgId, user.userId, seedId);
  }
  @Get("approvals")
  approvals(@Param("organizationId") orgId: string) { return this.messaging.listApprovalQueue(orgId); }

  // ---------- MS3: saved audiences ----------
  // Literal routes, declared before broadcasts/:broadcastId.
  @Post("audiences") @UseGuards(RolesGuard) @Roles(...WRITE_ROLES)
  createAudience(@CurrentUser() user: AuthUser, @Param("organizationId") orgId: string, @Body() dto: CreateSavedAudienceDto) {
    return this.messaging.createSavedAudience(orgId, user.userId, dto);
  }
  @Get("audiences")
  listAudiences(@Param("organizationId") orgId: string) { return this.messaging.listSavedAudiences(orgId); }
  @Patch("audiences/:audienceId") @UseGuards(RolesGuard) @Roles(...WRITE_ROLES)
  updateAudience(@CurrentUser() user: AuthUser, @Param("organizationId") orgId: string, @Param("audienceId") id: string, @Body() dto: UpdateSavedAudienceDto) {
    return this.messaging.updateSavedAudience(orgId, user.userId, id, dto);
  }
  @Delete("audiences/:audienceId") @UseGuards(RolesGuard) @Roles("OWNER", "ADMIN")
  deleteAudience(@CurrentUser() user: AuthUser, @Param("organizationId") orgId: string, @Param("audienceId") id: string) {
    return this.messaging.deleteSavedAudience(orgId, user.userId, id);
  }

  // ---------- MS4: per-tenant senders ----------
  @Get("senders")
  getSenders(@Param("organizationId") orgId: string) { return this.messaging.getSenderSettings(orgId); }
  @Put("senders/email") @UseGuards(RolesGuard) @Roles("OWNER", "ADMIN")
  updateSenderEmail(@CurrentUser() user: AuthUser, @Param("organizationId") orgId: string, @Body() dto: UpdateTenantEmailDto) {
    return this.messaging.updateTenantEmail(orgId, user.userId, dto);
  }
  @Put("senders/sms") @UseGuards(RolesGuard) @Roles("OWNER", "ADMIN")
  updateSenderSms(@CurrentUser() user: AuthUser, @Param("organizationId") orgId: string, @Body() dto: UpdateTenantSmsDto) {
    return this.messaging.updateTenantSms(orgId, user.userId, dto);
  }
  // MX2: additional SMS gateways (failover set).
  @Post("senders/sms/gateways") @UseGuards(RolesGuard) @Roles("OWNER", "ADMIN")
  addSmsGateway(@CurrentUser() user: AuthUser, @Param("organizationId") orgId: string, @Body() dto: AddSmsGatewayDto) {
    return this.messaging.addSmsGateway(orgId, user.userId, dto);
  }
  @Delete("senders/sms/gateways/:gatewayId") @UseGuards(RolesGuard) @Roles("OWNER", "ADMIN")
  removeSmsGateway(@CurrentUser() user: AuthUser, @Param("organizationId") orgId: string, @Param("gatewayId") gatewayId: string) {
    return this.messaging.removeSmsGateway(orgId, user.userId, gatewayId);
  }
  @Patch("senders/rates") @UseGuards(RolesGuard) @Roles("OWNER", "ADMIN")
  updateSenderRates(@CurrentUser() user: AuthUser, @Param("organizationId") orgId: string, @Body() dto: UpdateSenderRatesDto) {
    return this.messaging.updateSenderRates(orgId, user.userId, dto);
  }
  @Post("senders/email/test") @UseGuards(RolesGuard) @Roles(...WRITE_ROLES)
  sendSenderTest(@CurrentUser() user: AuthUser, @Param("organizationId") orgId: string, @Body() dto: SendTestEmailDto) {
    return this.messaging.sendSenderTestEmail(orgId, user.userId, dto.to);
  }
  @Get("senders/email/domain-health")
  domainHealth(@Param("organizationId") orgId: string) { return this.messaging.getDomainHealth(orgId); }

  @Post("templates") @UseGuards(RolesGuard) @Roles(...WRITE_ROLES)
  createTemplate(@CurrentUser() user: AuthUser, @Param("organizationId") orgId: string, @Body() dto: CreateTemplateDto) {
    return this.messaging.createTemplate(orgId, user.userId, dto);
  }
  @Get("templates")
  listTemplates(@Param("organizationId") orgId: string, @Query("channel") channel?: string) {
    return this.messaging.listTemplates(orgId, channel);
  }
  @Patch("templates/:templateId") @UseGuards(RolesGuard) @Roles(...WRITE_ROLES)
  updateTemplate(@Param("organizationId") orgId: string, @Param("templateId") id: string, @Body() dto: UpdateTemplateDto) {
    return this.messaging.updateTemplate(orgId, id, dto);
  }
  @Delete("templates/:templateId") @UseGuards(RolesGuard) @Roles("OWNER", "ADMIN")
  deleteTemplate(@Param("organizationId") orgId: string, @Param("templateId") id: string) {
    return this.messaging.deleteTemplate(orgId, id);
  }
  /** MX7: template version history (snapshots, newest first). */
  @Get("templates/:templateId/versions")
  templateVersions(@Param("organizationId") orgId: string, @Param("templateId") id: string) {
    return this.messaging.listTemplateVersions(orgId, id);
  }
  /** MX7: restore a prior version (creates a NEW version). */
  @Post("templates/:templateId/versions/:version/restore") @UseGuards(RolesGuard) @Roles(...WRITE_ROLES)
  restoreTemplateVersion(@CurrentUser() user: AuthUser, @Param("organizationId") orgId: string, @Param("templateId") id: string, @Param("version") version: string) {
    return this.messaging.restoreTemplateVersion(orgId, user.userId, id, Number(version));
  }
  /** MS5: test-send a template directly to one address. */
  @Post("templates/:templateId/test-send") @UseGuards(RolesGuard) @Roles(...WRITE_ROLES)
  testSendTemplate(@CurrentUser() user: AuthUser, @Param("organizationId") orgId: string, @Param("templateId") id: string, @Body() dto: TestSendDto) {
    return this.messaging.testSendTemplate(orgId, user.userId, id, dto.to);
  }

  // ---------- MS2: consent settings + preferences ----------
  // Declared before the broadcasts/:broadcastId routes so the
  // literal segments can never be read as a broadcast id.
  @Get("settings")
  getSettings(@Param("organizationId") orgId: string) { return this.messaging.getMessagingSettingsView(orgId); }
  @Patch("settings") @UseGuards(RolesGuard) @Roles("OWNER", "ADMIN")
  updateSettings(@CurrentUser() user: AuthUser, @Param("organizationId") orgId: string, @Body() dto: UpdateMessagingSettingDto) {
    return this.messaging.updateMessagingSetting(orgId, user.userId, dto);
  }
  /** MX3: unified READ-ONLY transactional view (order
   * notification setting status + recent log). Read roles only
   * — there is deliberately no write route here; order
   * notification settings change in their own place. */
  @Get("transactional-overview")
  transactionalOverview(@Param("organizationId") orgId: string) { return this.messaging.getTransactionalOverview(orgId); }
  @Get("preferences")
  listPreferences(@Param("organizationId") orgId: string, @Query("status") status?: string, @Query("channel") channel?: string) {
    return this.messaging.listPreferences(orgId, { status, channel });
  }
  @Post("preferences") @UseGuards(RolesGuard) @Roles(...WRITE_ROLES)
  addPreference(@CurrentUser() user: AuthUser, @Param("organizationId") orgId: string, @Body() dto: AddPreferenceDto) {
    return this.messaging.addPreference(orgId, user.userId, dto);
  }
  @Post("preferences/import") @UseGuards(RolesGuard) @Roles(...WRITE_ROLES)
  importPreferences(@CurrentUser() user: AuthUser, @Param("organizationId") orgId: string, @Body() dto: ImportPreferencesDto) {
    return this.messaging.importPreferences(orgId, user.userId, dto);
  }
  @Get("preferences/export") @UseGuards(RolesGuard) @Roles("OWNER", "ADMIN")
  @Header("Content-Type", "text/csv; charset=utf-8") @Header("Content-Disposition", "attachment; filename=messaging-optouts.csv")
  exportPreferences(@CurrentUser() user: AuthUser, @Param("organizationId") orgId: string) {
    return this.messaging.exportPreferencesCsv(orgId, user.userId);
  }
  @Delete("preferences/:preferenceId") @UseGuards(RolesGuard) @Roles("OWNER", "ADMIN")
  removePreference(@CurrentUser() user: AuthUser, @Param("organizationId") orgId: string, @Param("preferenceId") id: string) {
    return this.messaging.removePreference(orgId, user.userId, id);
  }

  // ---------- MS8: messaging journey presets ----------
  // Literal routes, declared before broadcasts/:broadcastId.
  @Get("journey-presets")
  journeyPresets() {
    // MX5: the response now wraps the catalogue (v1 + v2, each
    // entry carrying its `version`) plus the `unavailable`
    // list (presets deliberately NOT built, with reasons — the
    // UI greys them instead of hiding them). The service's
    // listJourneyPresets() still returns the bare catalogue
    // array; only this HTTP shape grew.
    return {
      presets: this.messaging.listJourneyPresets(),
      unavailable: this.messaging.listUnavailableJourneyPresets(),
    };
  }
  @Post("journey-presets/:key/install") @UseGuards(RolesGuard) @Roles(...WRITE_ROLES)
  installJourneyPreset(@CurrentUser() user: AuthUser, @Param("organizationId") orgId: string, @Param("key") key: string, @Body() dto: InstallJourneyPresetDto) {
    return this.messaging.installJourneyPreset(orgId, user.userId, key, dto);
  }

  // ---------- MX4: messaging journeys (visual builder) ----------
  // Literal "journeys/meta" is declared before
  // "journeys/:workflowId" so it can never be read as an id.
  // A journey IS a Workflow — every write goes through the
  // workflow engine port in the service, never the table.
  @Get("journeys/meta")
  journeyMeta() { return this.messaging.getJourneyMeta(); }
  @Get("journeys")
  listJourneys(@Param("organizationId") orgId: string) { return this.messaging.listJourneys(orgId); }
  @Post("journeys") @UseGuards(RolesGuard) @Roles(...WRITE_ROLES)
  createJourney(@CurrentUser() user: AuthUser, @Param("organizationId") orgId: string, @Body() dto: CreateJourneyDto) {
    return this.messaging.createJourney(orgId, user.userId, dto);
  }
  @Get("journeys/:workflowId")
  getJourney(@Param("organizationId") orgId: string, @Param("workflowId") workflowId: string) {
    return this.messaging.getJourney(orgId, workflowId);
  }
  @Patch("journeys/:workflowId") @UseGuards(RolesGuard) @Roles(...WRITE_ROLES)
  updateJourney(@CurrentUser() user: AuthUser, @Param("organizationId") orgId: string, @Param("workflowId") workflowId: string, @Body() dto: UpdateJourneyDto) {
    return this.messaging.updateJourney(orgId, user.userId, workflowId, dto);
  }

  // ---------- MS9: AI for messaging ----------
  // Literal "ai/..." routes, declared before broadcasts/:broadcastId.
  // Drafts are returned only — no route here can save or send.
  @Post("ai/draft") @UseGuards(RolesGuard) @Roles(...WRITE_ROLES)
  aiDraft(@CurrentUser() user: AuthUser, @Param("organizationId") orgId: string, @Body() dto: AiDraftDto) {
    return this.messaging.draftMessagingCopy(orgId, user.userId, dto);
  }
  @Post("ai/subjects") @UseGuards(RolesGuard) @Roles(...WRITE_ROLES)
  aiSubjects(@CurrentUser() user: AuthUser, @Param("organizationId") orgId: string, @Body() dto: AiSubjectsDto) {
    return this.messaging.draftMessagingSubjects(orgId, user.userId, dto);
  }
  /** MX11: natural-language segment draft — returned only,
   * never saved; creation stays on the saved-audience path. */
  @Post("ai/segment-draft") @UseGuards(RolesGuard) @Roles(...WRITE_ROLES)
  aiSegmentDraft(@CurrentUser() user: AuthUser, @Param("organizationId") orgId: string, @Body() dto: AiSegmentDraftDto) {
    return this.messaging.draftSegmentFromDescription(orgId, user.userId, dto);
  }
  @Get("ai/send-time")
  aiSendTime(@Param("organizationId") orgId: string) { return this.messaging.sendTimeSuggestion(orgId); }
  @Get("ai/segment-suggestion")
  aiSegmentSuggestion(@Param("organizationId") orgId: string) { return this.messaging.segmentSuggestion(orgId); }

  // ---------- MX16: analytics & AI v2 ----------
  // Literal "analytics"/"ai/..." routes, declared before
  // broadcasts/:broadcastId. Analytics figures are real-record
  // aggregates (association-labelled); AI outputs are returned
  // only — no route here can save, create or send.
  @Get("analytics")
  analytics(@Param("organizationId") orgId: string, @Query("from") from?: string, @Query("to") to?: string) {
    return this.messaging.getComparativeAnalytics(orgId, { from, to });
  }
  @Get("analytics/export.csv") @UseGuards(RolesGuard) @Roles("OWNER", "ADMIN")
  @Header("Content-Type", "text/csv; charset=utf-8") @Header("Content-Disposition", "attachment; filename=messaging-analytics.csv")
  analyticsExport(@CurrentUser() user: AuthUser, @Param("organizationId") orgId: string, @Query("from") from?: string, @Query("to") to?: string) {
    return this.messaging.exportComparativeAnalyticsCsv(orgId, user.userId, { from, to });
  }
  /** MX16: AI campaign planner — a PROPOSAL only. */
  @Post("ai/planner") @UseGuards(RolesGuard) @Roles(...WRITE_ROLES)
  aiPlanner(@CurrentUser() user: AuthUser, @Param("organizationId") orgId: string, @Body() dto: AiPlannerDto) {
    return this.messaging.planCampaign(orgId, user.userId, dto);
  }
  /** MX16: Bangla↔English translation draft — returned only. */
  @Post("ai/translate") @UseGuards(RolesGuard) @Roles(...WRITE_ROLES)
  aiTranslate(@CurrentUser() user: AuthUser, @Param("organizationId") orgId: string, @Body() dto: AiTranslateDto) {
    return this.messaging.translateDraft(orgId, user.userId, dto);
  }
  /** MX16: subject-line quality — a deterministic HEURISTIC
   * score with its factors shown (not AI, not a prediction). */
  @Post("ai/subject-score") @UseGuards(RolesGuard) @Roles(...WRITE_ROLES)
  aiSubjectScore(@Body() dto: AiSubjectScoreDto) { return this.messaging.scoreSubjectQuality(dto); }
  /** MX16: per-recipient send-time suggestion — a deterministic
   * statistic from that recipient's own engagement records. */
  @Get("ai/send-time-recipient")
  aiSendTimeRecipient(@Param("organizationId") orgId: string, @Query("type") type?: string, @Query("id") id?: string) {
    return this.messaging.recipientSendTimeSuggestion(orgId, type ?? "", id ?? "");
  }

  // ---------- MX6: keyword campaigns (two-way & interactive) ----------
  // Literal "keyword-rules"/"keyword-hits" segments — declared
  // with the other literal sections, before broadcasts/:broadcastId.
  @Get("keyword-rules")
  listKeywordRules(@Param("organizationId") orgId: string) { return this.messaging.listKeywordRules(orgId); }
  @Post("keyword-rules") @UseGuards(RolesGuard) @Roles(...WRITE_ROLES)
  createKeywordRule(@CurrentUser() user: AuthUser, @Param("organizationId") orgId: string, @Body() dto: CreateKeywordRuleDto) {
    return this.messaging.createKeywordRule(orgId, user.userId, dto);
  }
  @Patch("keyword-rules/:ruleId") @UseGuards(RolesGuard) @Roles(...WRITE_ROLES)
  updateKeywordRule(@CurrentUser() user: AuthUser, @Param("organizationId") orgId: string, @Param("ruleId") id: string, @Body() dto: UpdateKeywordRuleDto) {
    return this.messaging.updateKeywordRule(orgId, user.userId, id, dto);
  }
  @Delete("keyword-rules/:ruleId") @UseGuards(RolesGuard) @Roles("OWNER", "ADMIN")
  deleteKeywordRule(@CurrentUser() user: AuthUser, @Param("organizationId") orgId: string, @Param("ruleId") id: string) {
    return this.messaging.deleteKeywordRule(orgId, user.userId, id);
  }
  /** MX6: poll tally — distinct conversations per option, latest vote wins. */
  @Get("keyword-rules/:ruleId/tally")
  keywordPollTally(@Param("organizationId") orgId: string, @Param("ruleId") id: string) {
    return this.messaging.getKeywordPollTally(orgId, id);
  }
  @Get("keyword-hits")
  listKeywordHits(@Param("organizationId") orgId: string, @Query("ruleId") ruleId?: string) {
    return this.messaging.listKeywordHits(orgId, { ruleId });
  }
  /** MX6: AI classification — a suggestion only, nothing applied. */
  @Post("keyword-hits/:hitId/classify") @UseGuards(RolesGuard) @Roles(...WRITE_ROLES)
  classifyKeywordHit(@CurrentUser() user: AuthUser, @Param("organizationId") orgId: string, @Param("hitId") id: string) {
    return this.messaging.classifyKeywordHit(orgId, user.userId, id);
  }
  /** MX6: human confirm/dismiss of a classification suggestion. */
  @Post("keyword-hits/:hitId/apply-label") @UseGuards(RolesGuard) @Roles(...WRITE_ROLES)
  applyKeywordHitLabel(@CurrentUser() user: AuthUser, @Param("organizationId") orgId: string, @Param("hitId") id: string, @Body() dto: ApplyKeywordLabelDto) {
    return this.messaging.applyKeywordHitLabel(orgId, user.userId, id, dto.decision);
  }

  @Post("broadcasts") @UseGuards(RolesGuard) @Roles(...WRITE_ROLES)
  createBroadcast(@CurrentUser() user: AuthUser, @Param("organizationId") orgId: string, @Body() dto: CreateBroadcastDto) {
    return this.messaging.createBroadcast(orgId, user.userId, dto);
  }
  /** CX10: audience preview (counts + masked sample) for the
   * create form — same WRITE_ROLES as create, declared as a
   * literal route so it can never be read as a broadcast id. */
  @Post("broadcasts/preview") @UseGuards(RolesGuard) @Roles(...WRITE_ROLES)
  previewBroadcast(@Param("organizationId") orgId: string, @Body() dto: PreviewBroadcastDto) {
    return this.messaging.previewBroadcast(orgId, dto);
  }

  @Post("broadcasts/preview-audience")
  previewAudience(@Param("organizationId") orgId: string, @Body() dto: PreviewAudienceDto) {
    return this.messaging.previewAudience(orgId, dto);
  }
  /** SA-B20 (G2): personalisation preview — sample variants
   * rendered by the exact functions a send will use; literal
   * route, declared before the :broadcastId routes. */
  @Post("broadcasts/personalisation/preview") @UseGuards(RolesGuard) @Roles(...WRITE_ROLES)
  previewPersonalisation(@CurrentUser() user: AuthUser, @Param("organizationId") orgId: string, @Body() dto: PreviewPersonalisationDto) {
    return this.messaging.previewBroadcastPersonalisation(orgId, user.userId, dto);
  }
  @Get("broadcasts")
  listBroadcasts(@Param("organizationId") orgId: string,
    @Query("cursor") cursor?: string, @Query("q") q?: string, @Query("status") status?: string, @Query("archived") archived?: string) {
    // MS10: no paging/filter params → the legacy bare-array
    // response, byte-unchanged (archived still excluded — that
    // is the archive semantic itself); any param → paged shape
    // with server-side q/status filters.
    if (cursor === undefined && q === undefined && status === undefined && archived === undefined) {
      return this.messaging.listBroadcasts(orgId);
    }
    return this.messaging.listBroadcasts(orgId, { cursor, q, status, archived: archived === "1" });
  }
  // ---------- MS10: broadcast management ----------
  @Patch("broadcasts/:broadcastId") @UseGuards(RolesGuard) @Roles(...WRITE_ROLES)
  updateBroadcast(@CurrentUser() user: AuthUser, @Param("organizationId") orgId: string, @Param("broadcastId") id: string, @Body() dto: UpdateBroadcastDto) {
    return this.messaging.updateBroadcast(orgId, user.userId, id, dto);
  }
  @Post("broadcasts/:broadcastId/clone") @UseGuards(RolesGuard) @Roles(...WRITE_ROLES)
  cloneBroadcast(@CurrentUser() user: AuthUser, @Param("organizationId") orgId: string, @Param("broadcastId") id: string) {
    return this.messaging.cloneBroadcast(orgId, user.userId, id);
  }
  @Delete("broadcasts/:broadcastId") @UseGuards(RolesGuard) @Roles("OWNER", "ADMIN")
  deleteBroadcast(@CurrentUser() user: AuthUser, @Param("organizationId") orgId: string, @Param("broadcastId") id: string) {
    return this.messaging.deleteBroadcast(orgId, user.userId, id);
  }
  @Post("broadcasts/:broadcastId/archive") @UseGuards(RolesGuard) @Roles(...WRITE_ROLES)
  archiveBroadcast(@CurrentUser() user: AuthUser, @Param("organizationId") orgId: string, @Param("broadcastId") id: string) {
    return this.messaging.setBroadcastArchived(orgId, user.userId, id, true);
  }
  @Post("broadcasts/:broadcastId/unarchive") @UseGuards(RolesGuard) @Roles(...WRITE_ROLES)
  unarchiveBroadcast(@CurrentUser() user: AuthUser, @Param("organizationId") orgId: string, @Param("broadcastId") id: string) {
    return this.messaging.setBroadcastArchived(orgId, user.userId, id, false);
  }
  @Get("rfm")
  rfm(@Param("organizationId") orgId: string) { return this.messaging.rfmReport(orgId); }
  // ---------- MX11: audience intelligence ----------
  /** Engagement scores + rule-based predictive segments
   * (computed on read from real records; formula included). */
  @Get("engagement")
  engagement(@Param("organizationId") orgId: string) { return this.messaging.getEngagementReport(orgId); }
  /** Unengaged suppression SUGGESTIONS — a read-only list;
   * viewing it writes nothing. */
  @Get("suppression-suggestions")
  suppressionSuggestions(@Param("organizationId") orgId: string) { return this.messaging.listSuppressionSuggestions(orgId); }
  /** The ONLY suppression write: an explicit human confirm,
   * through the real preference store (+ consent event). */
  @Post("suppression-suggestions/apply") @UseGuards(RolesGuard) @Roles(...WRITE_ROLES)
  applySuppression(@CurrentUser() user: AuthUser, @Param("organizationId") orgId: string, @Body() dto: ApplySuppressionDto) {
    return this.messaging.applySuppressionSuggestions(orgId, user.userId, dto);
  }
  // MX15: approval workflow actions (service enforces approver
  // role + four-eyes; the role guard here is the first gate).
  @Post("broadcasts/:broadcastId/approve") @UseGuards(RolesGuard) @Roles("OWNER", "ADMIN")
  approve(@CurrentUser() user: AuthUser, @Param("organizationId") orgId: string, @Param("broadcastId") id: string, @Body() dto: ApprovalDecisionDto) {
    return this.messaging.approveBroadcast(orgId, user.userId, id, dto?.note);
  }
  @Post("broadcasts/:broadcastId/reject") @UseGuards(RolesGuard) @Roles("OWNER", "ADMIN")
  reject(@CurrentUser() user: AuthUser, @Param("organizationId") orgId: string, @Param("broadcastId") id: string, @Body() dto: ApprovalDecisionDto) {
    return this.messaging.rejectBroadcast(orgId, user.userId, id, dto?.note);
  }
  @Post("broadcasts/:broadcastId/submit-approval") @UseGuards(RolesGuard) @Roles(...WRITE_ROLES)
  submitApproval(@CurrentUser() user: AuthUser, @Param("organizationId") orgId: string, @Param("broadcastId") id: string) {
    return this.messaging.submitBroadcastForApproval(orgId, user.userId, id);
  }
  /** MX15: one-click test send to a seed recipient (existing
   * MS5 test-send path underneath). */
  @Post("broadcasts/:broadcastId/test-send-seed") @UseGuards(RolesGuard) @Roles(...WRITE_ROLES)
  testSendSeed(@CurrentUser() user: AuthUser, @Param("organizationId") orgId: string, @Param("broadcastId") id: string, @Body() dto: TestSendSeedDto) {
    return this.messaging.testSendBroadcastToSeed(orgId, user.userId, id, dto.seedId);
  }
  /** MX16: per-pair A/B auto-winner toggle — the human
   * mid-flight switch (works on a "sending" broadcast, unlike
   * the edit path; takes effect at the next chunk). */
  @Post("broadcasts/:broadcastId/ab-auto-winner") @UseGuards(RolesGuard) @Roles(...WRITE_ROLES)
  abAutoWinner(@CurrentUser() user: AuthUser, @Param("organizationId") orgId: string, @Param("broadcastId") id: string, @Body() dto: AbAutoWinnerDto) {
    return this.messaging.setBroadcastAbAutoWinner(orgId, user.userId, id, dto?.enabled === undefined ? null : dto.enabled);
  }

  @Post("broadcasts/:broadcastId/send") @UseGuards(RolesGuard) @Roles(...WRITE_ROLES)
  send(@CurrentUser() user: AuthUser, @Param("organizationId") orgId: string, @Param("broadcastId") id: string) {
    return this.messaging.sendBroadcast(orgId, user.userId, id);
  }
  // MS1: engine controls (schedule / pause / resume / cancel / retry).
  @Post("broadcasts/:broadcastId/schedule") @UseGuards(RolesGuard) @Roles(...WRITE_ROLES)
  schedule(@CurrentUser() user: AuthUser, @Param("organizationId") orgId: string, @Param("broadcastId") id: string, @Body() dto: ScheduleBroadcastDto) {
    return this.messaging.scheduleBroadcast(orgId, user.userId, id, dto.scheduledAt ?? null, dto.recurrence);
  }
  @Post("broadcasts/:broadcastId/pause") @UseGuards(RolesGuard) @Roles(...WRITE_ROLES)
  pause(@CurrentUser() user: AuthUser, @Param("organizationId") orgId: string, @Param("broadcastId") id: string) {
    return this.messaging.pauseBroadcast(orgId, user.userId, id);
  }
  @Post("broadcasts/:broadcastId/resume") @UseGuards(RolesGuard) @Roles(...WRITE_ROLES)
  resume(@CurrentUser() user: AuthUser, @Param("organizationId") orgId: string, @Param("broadcastId") id: string) {
    return this.messaging.resumeBroadcast(orgId, user.userId, id);
  }
  @Post("broadcasts/:broadcastId/cancel") @UseGuards(RolesGuard) @Roles(...WRITE_ROLES)
  cancel(@CurrentUser() user: AuthUser, @Param("organizationId") orgId: string, @Param("broadcastId") id: string) {
    return this.messaging.cancelBroadcast(orgId, user.userId, id);
  }
  @Post("broadcasts/:broadcastId/retry-failed") @UseGuards(RolesGuard) @Roles(...WRITE_ROLES)
  retryFailed(@CurrentUser() user: AuthUser, @Param("organizationId") orgId: string, @Param("broadcastId") id: string) {
    return this.messaging.retryFailedBroadcast(orgId, user.userId, id);
  }
  /** MS5: test-send a broadcast's current content to one address
   * (never touches the broadcast row / snapshot / counters). */
  @Post("broadcasts/:broadcastId/test-send") @UseGuards(RolesGuard) @Roles(...WRITE_ROLES)
  testSendBroadcast(@CurrentUser() user: AuthUser, @Param("organizationId") orgId: string, @Param("broadcastId") id: string, @Body() dto: TestSendDto) {
    return this.messaging.testSendBroadcast(orgId, user.userId, id, dto.to);
  }
  @Get("broadcasts/:broadcastId/deliveries")
  deliveries(@Param("organizationId") orgId: string, @Param("broadcastId") id: string,
    @Query("status") status?: string, @Query("q") q?: string, @Query("cursor") cursor?: string) {
    // MS7: no filter params → the legacy bare-array response,
    // byte-unchanged; any filter param → the paged shape.
    if (status === undefined && q === undefined && cursor === undefined) {
      return this.messaging.listDeliveries(orgId, id);
    }
    return this.messaging.listDeliveries(orgId, id, { status, q, cursor });
  }
  /** MS7: the per-broadcast report (funnel, failure reasons,
   * A/B suggestion, labelled revenue + replies). */
  @Get("broadcasts/:broadcastId/report")
  report(@Param("organizationId") orgId: string, @Param("broadcastId") id: string) {
    return this.messaging.getBroadcastReport(orgId, id);
  }
  // ---------- MX10: growth tools ----------
  @Get("optin-forms")
  listOptInForms(@Param("organizationId") orgId: string) { return this.messaging.listOptInForms(orgId); }
  @Post("optin-forms") @UseGuards(RolesGuard) @Roles(...WRITE_ROLES)
  createOptInForm(@CurrentUser() user: AuthUser, @Param("organizationId") orgId: string, @Body() dto: CreateOptInFormDto) {
    return this.messaging.createOptInForm(orgId, user.userId, dto);
  }
  @Patch("optin-forms/:formId") @UseGuards(RolesGuard) @Roles(...WRITE_ROLES)
  updateOptInForm(@CurrentUser() user: AuthUser, @Param("organizationId") orgId: string, @Param("formId") id: string, @Body() dto: UpdateOptInFormDto) {
    return this.messaging.updateOptInForm(orgId, user.userId, id, dto);
  }
  @Delete("optin-forms/:formId") @UseGuards(RolesGuard) @Roles("OWNER", "ADMIN")
  deleteOptInForm(@CurrentUser() user: AuthUser, @Param("organizationId") orgId: string, @Param("formId") id: string) {
    return this.messaging.deleteOptInForm(orgId, user.userId, id);
  }
  @Get("optin-forms/:formId/qr")
  optInFormQr(@Param("organizationId") orgId: string, @Param("formId") id: string) { return this.messaging.getOptInFormQr(orgId, id); }
  @Post("preferences/link") @UseGuards(RolesGuard) @Roles(...WRITE_ROLES)
  issuePreferenceLink(@CurrentUser() user: AuthUser, @Param("organizationId") orgId: string, @Body() dto: IssuePreferenceLinkDto) {
    return this.messaging.issuePreferenceCenterLink(orgId, user.userId, dto);
  }
  // MX10: CSV import wizard (preview → persisted hygiene report → commit).
  @Post("csv-import/preview") @UseGuards(RolesGuard) @Roles(...WRITE_ROLES)
  previewCsvImport(@CurrentUser() user: AuthUser, @Param("organizationId") orgId: string, @Body() dto: PreviewCsvImportDto) {
    return this.messaging.previewCsvImport(orgId, user.userId, dto);
  }
  @Post("csv-import/:importId/commit") @UseGuards(RolesGuard) @Roles(...WRITE_ROLES)
  commitCsvImport(@CurrentUser() user: AuthUser, @Param("organizationId") orgId: string, @Param("importId") id: string) {
    return this.messaging.commitCsvImport(orgId, user.userId, id);
  }
  @Get("csv-import/:importId")
  getCsvImport(@Param("organizationId") orgId: string, @Param("importId") id: string) { return this.messaging.getCsvImport(orgId, id); }
  @Get("csv-import/:importId/report.csv") @UseGuards(RolesGuard) @Roles("OWNER", "ADMIN")
  @Header("Content-Type", "text/csv; charset=utf-8") @Header("Content-Disposition", "attachment; filename=csv-import-hygiene.csv")
  csvImportReport(@Param("organizationId") orgId: string, @Param("importId") id: string) {
    return this.messaging.csvImportReportCsv(orgId, id);
  }
  // MX10: consent history (begins at MX10) + audited export.
  @Get("consent-events")
  consentEvents(@Param("organizationId") orgId: string) { return this.messaging.listConsentEvents(orgId); }
  @Get("consent-events/export") @UseGuards(RolesGuard) @Roles("OWNER", "ADMIN")
  @Header("Content-Type", "text/csv; charset=utf-8") @Header("Content-Disposition", "attachment; filename=consent-events.csv")
  exportConsentEvents(@CurrentUser() user: AuthUser, @Param("organizationId") orgId: string) {
    return this.messaging.exportConsentEventsCsv(orgId, user.userId);
  }

  /** MS7: audited CSV export of a broadcast's deliveries. */
  @Get("broadcasts/:broadcastId/deliveries/export") @UseGuards(RolesGuard) @Roles("OWNER", "ADMIN")
  @Header("Content-Type", "text/csv; charset=utf-8") @Header("Content-Disposition", "attachment; filename=broadcast-deliveries.csv")
  exportDeliveries(@CurrentUser() user: AuthUser, @Param("organizationId") orgId: string, @Param("broadcastId") id: string) {
    return this.messaging.exportDeliveriesCsv(orgId, user.userId, id);
  }
}

/** MS2 — public unsubscribe: the signed token is the only
 * credential (the CX6/Review public-page pattern). GET validates
 * and shows nothing sensitive; POST performs the opt-out. */
@Controller("public/messaging")
export class PublicMessagingController {
  constructor(private readonly messaging: MessagingService) {}

  @Public()
  @Get("unsubscribe/:token")
  inspect(@Param("token") token: string) { return this.messaging.inspectUnsubscribeToken(token); }

  @Public()
  @Post("unsubscribe/:token")
  perform(@Param("token") token: string) { return this.messaging.performUnsubscribe(token); }

  /** MX10 — public preference center: the signed token (same
   * HMAC discipline as unsubscribe) is the only credential. */
  @Public()
  @Get("preferences/:token")
  preferenceCenter(@Param("token") token: string) { return this.messaging.getPreferenceCenter(token); }

  @Public()
  @Post("preferences/:token")
  updatePreferenceCenter(@Param("token") token: string, @Body() dto: UpdatePreferenceCenterDto) {
    return this.messaging.updatePreferenceCenter(token, dto);
  }

  @Public()
  @Post("preferences/:token/unsubscribe-all")
  unsubscribeAll(@Param("token") token: string) { return this.messaging.unsubscribeAllFromCenter(token); }

  /** MX10 — double opt-in confirmation (signed token). */
  @Public()
  @Get("optin/:token")
  inspectOptIn(@Param("token") token: string) { return this.messaging.inspectOptInToken(token); }

  @Public()
  @Post("optin/:token")
  confirmOptIn(@Param("token") token: string) { return this.messaging.confirmOptIn(token); }

  /** MX10 — public opt-in form: config read + signup submit. */
  @Public()
  @Get("forms/:organizationId/:slug")
  publicForm(@Param("organizationId") orgId: string, @Param("slug") slug: string) { return this.messaging.getPublicOptInForm(orgId, slug); }

  @Public()
  @Post("forms/:organizationId/:slug/submit")
  submitForm(@Param("organizationId") orgId: string, @Param("slug") slug: string, @Body() dto: SubmitOptInFormDto) {
    return this.messaging.submitOptInForm(orgId, slug, dto);
  }

  /** MS5 — tracked broadcast link: the signed token is the only
   * credential. Verification records the click and the handler
   * 302-redirects to the original URL; a tampered token throws
   * 400 in the service (nothing recorded, no redirect). */
  @Public()
  @Get("redirect/:token")
  @Redirect()
  async redirect(@Param("token") token: string) {
    const { url } = await this.messaging.performLinkRedirect(token);
    return { url, statusCode: 302 };
  }

  /** MS7 — email open pixel: the signed token is the only
   * credential. A verified token stamps openedAt (first hit
   * only) and the handler serves the transparent 1×1 GIF with
   * no-cache headers; a bad token is a plain 400 — no write and
   * NO image, so a mail client never renders a broken pixel as
   * an "open". */
  @Public()
  @Get("open/:token")
  async open(@Param("token") token: string, @Res() res: Response) {
    try {
      await this.messaging.performOpenTracking(token);
    } catch {
      res.status(400).send("Invalid tracking pixel");
      return;
    }
    res.setHeader("Content-Type", "image/gif");
    res.setHeader("Cache-Control", "no-store, no-cache, must-revalidate");
    res.status(200).send(Buffer.from(TRANSPARENT_GIF_BASE64, "base64"));
  }
}
