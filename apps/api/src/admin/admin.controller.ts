import { Body, Controller, Delete, Get, Param, Patch, Post, Query, Req, UseGuards } from "@nestjs/common";
import { AutomationService } from "../automation/automation.service";
import { IntegrationsService } from "../integrations/integrations.service";
import { Public } from "../common/decorators";
import { IsBoolean, IsIn, IsInt, IsNotEmpty, IsObject, IsOptional, IsString, MinLength } from "class-validator";
import { AdminService } from "./admin.service";
import { SuperAdminGuard, AdminTier } from "../common/super-admin.guard";

class StatusDto {
  @IsIn(["ACTIVE", "SUSPENDED", "DELETED"]) status!: string;
  @IsString() @MinLength(3) reason!: string;
}
class GrantDto {
  @IsIn(["SUPER", "SUPPORT", "FINANCE"]) tier!: string;
  @IsString() @MinLength(3) reason!: string;
}
class ReasonDto {
  @IsString() @MinLength(3) reason!: string;
}
class SettingsDto {
  @IsOptional() @IsBoolean() maintenanceMode?: boolean;
  @IsOptional() @IsBoolean() signupOpen?: boolean;
  @IsOptional() @IsString() supportContact?: string;
  @IsOptional() @IsObject() killSwitches?: { aiDisabledOrgIds: string[]; broadcastsPaused: boolean };
  @IsOptional() @IsObject() planPrices?: Record<string, number>;
}
class AnnouncementDto {
  @IsString() @MinLength(1) title!: string;
  @IsString() @MinLength(1) body!: string;
  @IsOptional() @IsString() startsAt?: string;
  @IsOptional() @IsString() endsAt?: string;
}
class FlagDto { @IsString() @MinLength(1) key!: string; enabled!: boolean; }
class LimitsDto {
  @IsOptional() aiDailyLimitOverride?: number | null;
  @IsOptional() broadcastCapOverride?: number | null;
  @IsOptional() seatLimit?: number | null;
}
class RetryDto { @IsIn(["scheduled_job", "sync_job"]) kind!: string; @IsString() id!: string; }
class ContentAccessDto { @IsString() @MinLength(3) reason!: string; }
class LlmConfigDto {
  @IsOptional() @IsString() provider?: string;
  @IsOptional() @IsString() model?: string;
  @IsOptional() @IsString() apiKey?: string;
  @IsOptional() @IsBoolean() clearSecret?: boolean;
  @IsOptional() @IsBoolean() clear?: boolean;
}
class MetaConfigDto {
  @IsOptional() @IsString() appId?: string;
  @IsOptional() @IsString() appSecret?: string;
  @IsOptional() @IsString() adLibraryToken?: string;
  @IsOptional() @IsString() graphVersion?: string;
  @IsOptional() @IsBoolean() clearSecret?: boolean;
  @IsOptional() @IsBoolean() clear?: boolean;
}
class SmtpConfigDto {
  @IsOptional() @IsString() host?: string;
  @IsOptional() @IsInt() port?: number;
  @IsOptional() @IsString() user?: string;
  @IsOptional() @IsString() pass?: string;
  @IsOptional() @IsString() from?: string;
  @IsOptional() @IsBoolean() clearSecret?: boolean;
  @IsOptional() @IsBoolean() clear?: boolean;
}
class SmsConfigDto {
  @IsOptional() @IsString() senderId?: string;
  @IsOptional() @IsString() apiToken?: string;
  @IsOptional() @IsString() apiUrl?: string;
  @IsOptional() @IsBoolean() clearSecret?: boolean;
  @IsOptional() @IsBoolean() clear?: boolean;
}
class SslcommerzConfigDto {
  @IsOptional() @IsString() storeId?: string;
  @IsOptional() @IsString() storePass?: string;
  @IsOptional() @IsBoolean() sandbox?: boolean;
  @IsOptional() @IsBoolean() clearSecret?: boolean;
  @IsOptional() @IsBoolean() clear?: boolean;
}
class TestSendDto { @IsString() @MinLength(3) to!: string; }
class SubscriptionDto {
  @IsOptional() @IsIn(["FREE", "STARTER", "GROWTH", "AGENCY"]) plan?: string;
  @IsOptional() @IsIn(["TRIALING", "ACTIVE", "PAST_DUE", "CANCELLED"]) status?: string;
  @IsOptional() currentPeriodEnd?: string | null;
  @IsString() @MinLength(3) reason!: string;
}
class PaymentDto {
  @IsString() organizationId!: string;
  @IsNotEmpty() amountMinor!: string | number;
  @IsOptional() @IsString() currency?: string;
  @IsIn(["bkash", "bank", "cash", "card", "other"]) method!: string;
  @IsOptional() @IsString() reference?: string;
  @IsOptional() @IsString() periodStart?: string;
  @IsOptional() @IsString() periodEnd?: string;
  @IsOptional() @IsString() note?: string;
}
class NoteDto {
  @IsIn(["user", "organization"]) targetType!: string;
  @IsString() targetId!: string;
  @IsString() @MinLength(1) body!: string;
}

@Controller("admin")
@UseGuards(SuperAdminGuard)
export class AdminController {
  constructor(
    private readonly admin: AdminService,
    private readonly automation: AutomationService,
    private readonly integrations: IntegrationsService,
  ) {}

  @Get("health") health() { return this.admin.health(); }
  @Get("overview") overview() { return this.admin.overview(); }

  @Get("users") users(@Query("q") q?: string, @Query("page") page?: string, @Query("take") take?: string) {
    return this.admin.listUsers(q, Number(page ?? 1) || 1, Math.min(100, Number(take ?? 25) || 25));
  }
  @Get("users/:id") user(@Param("id") id: string) { return this.admin.userDetail(id); }
  @Post("users/:id/status") @AdminTier("SUPER", "SUPPORT")
  userStatus(@Req() req: any, @Param("id") id: string, @Body() dto: StatusDto) {
    return this.admin.setUserStatus(req.adminUser, req.adminTier, id, dto.status, dto.reason, req.ip);
  }
  @Post("users/:id/grant") @AdminTier("SUPER")
  grant(@Req() req: any, @Param("id") id: string, @Body() dto: GrantDto) {
    return this.admin.grantAdmin(req.adminUser, id, dto.tier, dto.reason, req.ip);
  }
  @Post("users/:id/revoke") @AdminTier("SUPER")
  revoke(@Req() req: any, @Param("id") id: string, @Body() dto: ReasonDto) {
    return this.admin.revokeAdmin(req.adminUser, id, dto.reason, req.ip);
  }
  @Post("users/:id/force-reset") @AdminTier("SUPER", "SUPPORT")
  forceReset(@Req() req: any, @Param("id") id: string) {
    return this.admin.forceReset(req.adminUser, id, req.ip);
  }

  @Get("orgs") orgs(@Query("q") q?: string, @Query("page") page?: string, @Query("take") take?: string) {
    return this.admin.listOrgs(q, Number(page ?? 1) || 1, Math.min(100, Number(take ?? 25) || 25));
  }
  @Get("orgs/:id") org(@Param("id") id: string) { return this.admin.orgDetail(id); }
  @Post("orgs/:id/status") @AdminTier("SUPER", "SUPPORT")
  orgStatus(@Req() req: any, @Param("id") id: string, @Body() dto: StatusDto) {
    return this.admin.setOrgStatus(req.adminUser, id, dto.status, dto.reason, req.ip);
  }

  @Get("search") search(@Query("q") q?: string) { return this.admin.search(q ?? ""); }

  @Get("notes") notes(@Query("targetType") t: string, @Query("targetId") id: string) { return this.admin.listNotes(t, id); }
  @Post("notes") addNote(@Req() req: any, @Body() dto: NoteDto) { return this.admin.addNote(req.adminUser, dto.targetType, dto.targetId, dto.body); }

  // ---- Phase B: settings, announcements, flags, limits, health, usage, support ----
  @Get("settings") settings() { return this.admin.getSettings(); }

  // ---- Milestone 33: dynamic platform config ----
  @Get("platform-config") platformConfig() { return this.admin.getPlatformConfig(); }
  @Patch("platform-config/llm") @AdminTier("SUPER")
  updateLlmConfig(@Req() req: any, @Body() dto: LlmConfigDto) { return this.admin.updatePlatformConfig(req.adminUser, "llm", dto as unknown as Record<string, unknown>, req.ip); }
  @Patch("platform-config/meta") @AdminTier("SUPER")
  updateMetaConfig(@Req() req: any, @Body() dto: MetaConfigDto) { return this.admin.updatePlatformConfig(req.adminUser, "meta", dto as unknown as Record<string, unknown>, req.ip); }
  @Patch("platform-config/smtp") @AdminTier("SUPER")
  updateSmtpConfig(@Req() req: any, @Body() dto: SmtpConfigDto) { return this.admin.updatePlatformConfig(req.adminUser, "smtp", dto as unknown as Record<string, unknown>, req.ip); }
  @Patch("platform-config/sms") @AdminTier("SUPER")
  updateSmsConfig(@Req() req: any, @Body() dto: SmsConfigDto) { return this.admin.updatePlatformConfig(req.adminUser, "sms", dto as unknown as Record<string, unknown>, req.ip); }
  @Patch("platform-config/sslcommerz") @AdminTier("SUPER")
  updateSslcommerzConfig(@Req() req: any, @Body() dto: SslcommerzConfigDto) { return this.admin.updatePlatformConfig(req.adminUser, "sslcommerz", dto as unknown as Record<string, unknown>, req.ip); }
  @Post("platform-config/test-llm") @AdminTier("SUPER")
  testLlm() { return this.admin.testLlm(); }
  @Post("platform-config/test-email") @AdminTier("SUPER")
  testEmail(@Body() dto: TestSendDto) { return this.admin.testEmail(dto.to); }
  @Post("platform-config/test-sms") @AdminTier("SUPER")
  testSms(@Body() dto: TestSendDto) { return this.admin.testSms(dto.to); }
  @Patch("settings") @AdminTier("SUPER")
  updateSettings(@Req() req: any, @Body() dto: SettingsDto) { return this.admin.updateSettings(req.adminUser, dto as unknown as Record<string, unknown>, req.ip); }

  @Get("announcements") announcements() { return this.admin.listAnnouncements(); }
  @Post("announcements") @AdminTier("SUPER", "SUPPORT")
  createAnnouncement(@Req() req: any, @Body() dto: AnnouncementDto) { return this.admin.createAnnouncement(req.adminUser, dto, req.ip); }
  @Post("announcements/:id/active") @AdminTier("SUPER", "SUPPORT")
  announcementActive(@Req() req: any, @Param("id") id: string, @Body() body: { active: boolean }) { return this.admin.setAnnouncementActive(req.adminUser, id, body.active === true, req.ip); }
  @Delete("announcements/:id") @AdminTier("SUPER")
  deleteAnnouncement(@Req() req: any, @Param("id") id: string) { return this.admin.deleteAnnouncement(req.adminUser, id, req.ip); }

  @Get("orgs/:id/flags") orgFlags(@Param("id") id: string) { return this.admin.getOrgFlags(id); }
  @Post("orgs/:id/flags") @AdminTier("SUPER", "SUPPORT")
  setOrgFlag(@Req() req: any, @Param("id") id: string, @Body() dto: FlagDto) { return this.admin.setOrgFlag(req.adminUser, id, dto.key, dto.enabled === true, req.ip); }
  @Patch("orgs/:id/limits") @AdminTier("SUPER")
  orgLimits(@Req() req: any, @Param("id") id: string, @Body() dto: LimitsDto) { return this.admin.updateOrgLimits(req.adminUser, id, dto, req.ip); }

  @Get("health/integrations") healthIntegrations() { return this.admin.healthIntegrations(); }
  @Get("health/jobs") healthJobs() { return this.admin.healthJobs(); }
  @Post("health/retry") @AdminTier("SUPER", "SUPPORT")
  async retry(@Req() req: any, @Body() dto: RetryDto) {
    if (dto.kind === "scheduled_job") {
      const job = await this.admin.findScheduledJob(dto.id);
      if (!job) return { retried: false, message: "Scheduled job not found" };
      const result = await this.automation.runJobNow(job.organizationId, req.adminUser.id, dto.id);
      return { retried: true, kind: dto.kind, result };
    }
    const sync = await this.admin.findSyncJob(dto.id);
    if (!sync) return { retried: false, message: "Sync job not found" };
    const result = sync.kind === "products"
      ? await this.integrations.syncProducts(sync.organizationId, req.adminUser.id, sync.integrationId)
      : await this.integrations.syncOrders(sync.organizationId, req.adminUser.id, sync.integrationId);
    return { retried: true, kind: dto.kind, result };
  }

  @Get("usage") usage() { return this.admin.usageBoard(); }

  @Get("orgs/:id/support-view") supportView(@Param("id") id: string) { return this.admin.supportView(id); }
  @Post("orgs/:id/support-view/conversations/:cid/messages") @AdminTier("SUPER", "SUPPORT")
  supportMessages(@Req() req: any, @Param("id") id: string, @Param("cid") cid: string, @Body() dto: ContentAccessDto) {
    return this.admin.supportConversationMessages(req.adminUser, id, cid, dto.reason, req.ip);
  }

  // ---- Phase D: security & TOTP ----
  @Post("totp/enroll") totpEnroll(@Req() req: any) { return this.admin.totpEnroll(req.adminUser, req.ip); }
  @Post("totp/confirm") totpConfirm(@Req() req: any, @Body() body: { code: string }) { return this.admin.totpConfirm(req.adminUser, body?.code ?? "", req.ip); }
  @Post("totp/disable") totpDisable(@Req() req: any, @Body() body: { code: string }) { return this.admin.totpDisable(req.adminUser, body?.code ?? "", req.ip); }
  @Get("security") security(@Req() req: any) { return this.admin.securityOverview(req.adminUser); }
  @Post("security/revoke-my-sessions")
  revokeMine(@Req() req: any, @Body() dto: ReasonDto) { return this.admin.revokeSessions(req.adminUser, req.adminUser.id, dto.reason, req.ip); }
  @Post("users/:id/revoke-sessions") @AdminTier("SUPER", "SUPPORT")
  revokeUserSessions(@Req() req: any, @Param("id") id: string, @Body() dto: ReasonDto) { return this.admin.revokeSessions(req.adminUser, id, dto.reason, req.ip); }

  // ---- Phase C: SaaS billing ----
  @Patch("orgs/:id/subscription") @AdminTier("SUPER", "FINANCE")
  updateSubscription(@Req() req: any, @Param("id") id: string, @Body() dto: SubscriptionDto) {
    return this.admin.updateSubscription(req.adminUser, id, dto, dto.reason, req.ip);
  }
  @Get("billing/summary") billingSummary() { return this.admin.billingSummary(); }
  @Get("payments") payments(@Query("organizationId") orgId?: string, @Query("take") take?: string) {
    return this.admin.listPayments(orgId, Number(take ?? 50) || 50);
  }
  @Post("payments") @AdminTier("SUPER", "FINANCE")
  recordPayment(@Req() req: any, @Body() dto: PaymentDto) { return this.admin.recordPayment(req.adminUser, dto, req.ip); }
  @Delete("payments/:id") @AdminTier("SUPER")
  deletePayment(@Req() req: any, @Param("id") id: string, @Body() dto: ReasonDto) { return this.admin.deletePayment(req.adminUser, id, dto.reason, req.ip); }

  @Get("audit") audit(@Query("action") action?: string, @Query("userId") userId?: string, @Query("take") take?: string) {
    return this.admin.auditTrail({ action, userId, take: Number(take ?? 50) || 50 });
  }
}

/** Public, unauthenticated platform status for the tenant app shell
 * (announcement banner, maintenance notice, signup gate). Contains
 * no tenant data — only operator-published notices. */
@Controller("public")
export class PublicStatusController {
  constructor(private readonly admin: AdminService) {}
  @Public() @Get("system-status") status() { return this.admin.publicStatus(); }
}
