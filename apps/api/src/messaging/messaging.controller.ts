import { Body, Controller, Delete, Get, Header, Param, Patch, Post, Put, Query, Redirect, Res, UseGuards } from "@nestjs/common";
import type { Response } from "express";
import { MessagingService } from "./messaging.service";
import { TRANSPARENT_GIF_BASE64 } from "./open-token";
import { CreateTemplateDto, UpdateTemplateDto, CreateBroadcastDto, PreviewBroadcastDto, PreviewAudienceDto, ScheduleBroadcastDto, UpdateMessagingSettingDto, AddPreferenceDto, ImportPreferencesDto, CreateSavedAudienceDto, UpdateSavedAudienceDto, UpdateTenantEmailDto, UpdateTenantSmsDto, UpdateSenderRatesDto, SendTestEmailDto, TestSendDto, ComposeCheckDto, InstallJourneyPresetDto, AiDraftDto, AiSubjectsDto, UpdateBroadcastDto } from "./messaging.dto";
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
  @Post("compose-check") @UseGuards(RolesGuard) @Roles(...WRITE_ROLES)
  composeCheck(@Body() dto: ComposeCheckDto) { return this.messaging.checkCompose(dto); }

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
  /** MS5: test-send a template directly to one address. */
  @Post("templates/:templateId/test-send") @UseGuards(RolesGuard) @Roles(...WRITE_ROLES)
  testSendTemplate(@CurrentUser() user: AuthUser, @Param("organizationId") orgId: string, @Param("templateId") id: string, @Body() dto: TestSendDto) {
    return this.messaging.testSendTemplate(orgId, user.userId, id, dto.to);
  }

  // ---------- MS2: consent settings + preferences ----------
  // Declared before the broadcasts/:broadcastId routes so the
  // literal segments can never be read as a broadcast id.
  @Get("settings")
  getSettings(@Param("organizationId") orgId: string) { return this.messaging.getMessagingSetting(orgId); }
  @Patch("settings") @UseGuards(RolesGuard) @Roles("OWNER", "ADMIN")
  updateSettings(@CurrentUser() user: AuthUser, @Param("organizationId") orgId: string, @Body() dto: UpdateMessagingSettingDto) {
    return this.messaging.updateMessagingSetting(orgId, user.userId, dto);
  }
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
  journeyPresets() { return this.messaging.listJourneyPresets(); }
  @Post("journey-presets/:key/install") @UseGuards(RolesGuard) @Roles(...WRITE_ROLES)
  installJourneyPreset(@CurrentUser() user: AuthUser, @Param("organizationId") orgId: string, @Param("key") key: string, @Body() dto: InstallJourneyPresetDto) {
    return this.messaging.installJourneyPreset(orgId, user.userId, key, dto);
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
  @Get("ai/send-time")
  aiSendTime(@Param("organizationId") orgId: string) { return this.messaging.sendTimeSuggestion(orgId); }
  @Get("ai/segment-suggestion")
  aiSegmentSuggestion(@Param("organizationId") orgId: string) { return this.messaging.segmentSuggestion(orgId); }

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
