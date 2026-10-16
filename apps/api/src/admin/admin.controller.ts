import { Body, Controller, Delete, Get, Header, Optional, Param, Patch, Post, Query, Req, Res, UseGuards } from "@nestjs/common";
import type { Response } from "express";
import { AutomationService } from "../automation/automation.service";
import { IntegrationsService } from "../integrations/integrations.service";
import { PaymentsService } from "../payments/payments.service";
import { Public } from "../common/decorators";
import { IsArray, IsBoolean, IsIn, IsInt, IsNotEmpty, IsNumber, IsObject, IsOptional, IsString, MinLength } from "class-validator";
import { AdminService } from "./admin.service";
import { WalletService, buildStatementCsv, buildStatementPdf, statementRange } from "../connections/wallet.service";
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
/** GC21 (GB9): merchant verification decision. The note is
 * required on reject (enforced in the service, where the
 * merchant-facing wording lives). */
class OrgVerificationDto {
  @IsIn(["approve", "reject"]) decision!: string;
  @IsOptional() @IsString() @MinLength(1) note?: string;
}
class SettingsDto {
  @IsOptional() @IsBoolean() maintenanceMode?: boolean;
  @IsOptional() @IsBoolean() signupOpen?: boolean;
  @IsOptional() @IsString() supportContact?: string;
  @IsOptional() @IsObject() killSwitches?: { aiDisabledOrgIds: string[]; broadcastsPaused: boolean };
  @IsOptional() @IsObject() planPrices?: Record<string, number>;
  @IsOptional() @IsObject() planYearlyPrices?: Record<string, number>;
  @IsOptional() @IsObject() planLimits?: Record<string, { aiDaily?: number; broadcastCap?: number; seats?: number }>;
  @IsOptional() @IsObject() maintenanceWindow?: { startsAt: string; endsAt: string; message?: string; hardLockout?: boolean } | null;
  @IsOptional() @IsInt() auditRetentionDays?: number;
}
class AnnouncementDto {
  @IsString() @MinLength(1) title!: string;
  @IsString() @MinLength(1) body!: string;
  @IsOptional() @IsString() startsAt?: string;
  @IsOptional() @IsString() endsAt?: string;
  @IsOptional() @IsString() audience?: string;
}
class CampaignDto {
  @IsString() @MinLength(1) subject!: string;
  @IsString() @MinLength(1) body!: string;
  @IsString() @MinLength(1) audience!: string;
  @IsOptional() organizationIds?: string[];
}
class ChangelogDto {
  @IsOptional() @IsString() version?: string;
  @IsOptional() @IsString() title?: string;
  @IsOptional() @IsString() body?: string;
  @IsOptional() @IsBoolean() published?: boolean;
}
class ReferralConfigDto {
  @IsBoolean() enabled!: boolean;
  @IsNumber() rewardMinor!: number;
  // Referral Advanced R1: smart reward engine fields.
  @IsOptional() @IsIn(["flat", "percent", "per_plan"]) mode?: string;
  @IsOptional() @IsNumber() percentOfFirstPayment?: number;
  @IsOptional() @IsObject() perPlanMinor?: Record<string, number>;
  @IsOptional() @IsNumber() refereeBonusMinor?: number;
  @IsOptional() @IsNumber() minFirstPaymentMinor?: number;
  @IsOptional() @IsNumber() creditExpiryDays?: number;
  @IsOptional() @IsArray() milestones?: { count: number; bonusMinor: number }[];
}
class FlagDto { @IsString() @MinLength(1) key!: string; @IsBoolean() enabled!: boolean; }
class LimitsDto {
  @IsOptional() aiDailyLimitOverride?: number | null;
  @IsOptional() broadcastCapOverride?: number | null;
  @IsOptional() seatLimit?: number | null;
  // AB8 (AX24): white-label toggle on the same org-update PATCH.
  @IsOptional() @IsBoolean() whiteLabel?: boolean;
}
class RetryDto { @IsIn(["scheduled_job", "sync_job"]) kind!: string; @IsString() id!: string; }
class QueueActionDto {
  @IsString() @MinLength(3) reason!: string;
  @IsOptional() @IsArray() jobIds?: string[];
  @IsOptional() @IsInt() limit?: number;
}
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
class BkashConfigDto {
  @IsOptional() @IsString() appKey?: string;
  @IsOptional() @IsString() appSecret?: string;
  @IsOptional() @IsString() username?: string;
  @IsOptional() @IsString() password?: string;
  @IsOptional() @IsBoolean() sandbox?: boolean;
  @IsOptional() @IsBoolean() clearSecret?: boolean;
  @IsOptional() @IsBoolean() clear?: boolean;
}
class ImageConfigDto {
  @IsOptional() @IsString() provider?: string;
  @IsOptional() @IsString() model?: string;
  @IsOptional() @IsString() apiKey?: string;
  @IsOptional() @IsBoolean() clearSecret?: boolean;
  @IsOptional() @IsBoolean() clear?: boolean;
}
class TiktokAppConfigDto {
  @IsOptional() @IsString() clientKey?: string;
  @IsOptional() @IsString() clientSecret?: string;
  @IsOptional() @IsString() redirectUri?: string;
  @IsOptional() @IsBoolean() audited?: boolean;
  @IsOptional() @IsBoolean() clearSecret?: boolean;
  @IsOptional() @IsBoolean() clear?: boolean;
}
class PayoutDecisionDto {
  @IsOptional() @IsString() note?: string;
}
class PayoutMarkPaidDto {
  @IsString() @MinLength(1) payoutRef!: string;
}
class WalletAdjustDto {
  @IsString() @MinLength(1) amountMinor!: string;
  @IsString() @MinLength(1) note!: string;
}
class WalletConfigDto {
  @IsOptional() @IsInt() feeBps?: number;
  @IsOptional() @IsBoolean() clear?: boolean;
}
class GoogleAppConfigDto {
  @IsOptional() @IsString() clientId?: string;
  @IsOptional() @IsString() clientSecret?: string;
  @IsOptional() @IsString() redirectUri?: string;
  @IsOptional() @IsBoolean() clearSecret?: boolean;
  @IsOptional() @IsBoolean() clear?: boolean;
}
class LinkedinAppConfigDto {
  @IsOptional() @IsString() clientId?: string;
  @IsOptional() @IsString() clientSecret?: string;
  @IsOptional() @IsString() redirectUri?: string;
  @IsOptional() @IsBoolean() clearSecret?: boolean;
  @IsOptional() @IsBoolean() clear?: boolean;
}
/** AB8 (AX26): staff Google SSO app — separate from the
 * YouTube googleApp DTO above. Blank clientSecret = keep. */
class GoogleOAuthConfigDto {
  @IsOptional() @IsString() clientId?: string;
  @IsOptional() @IsString() clientSecret?: string;
  @IsOptional() @IsBoolean() enabled?: boolean;
  @IsOptional() @IsBoolean() clearSecret?: boolean;
  @IsOptional() @IsBoolean() clear?: boolean;
}
class CouponDto {
  @IsString() @MinLength(3) code!: string;
  @IsIn(["percent", "fixed"]) kind!: string;
  @IsInt() value!: number;
  @IsOptional() @IsString() planScope?: string;
  @IsOptional() @IsString() expiresAt?: string;
  @IsOptional() @IsInt() maxRedemptions?: number;
}
class CouponStatusDto {
  @IsBoolean() active!: boolean;
  @IsString() @MinLength(3) reason!: string;
}
class RefundDto {
  @IsOptional() @IsString() amountMinor?: string;
  @IsString() @MinLength(3) reason!: string;
  @IsOptional() @IsBoolean() revokeAccess?: boolean;
}
class AiRatesDto { @IsObject() rates!: Record<string, number>; }
class ApiKeyDto { @IsString() @MinLength(3) name!: string; @IsOptional() @IsArray() scopes?: string[]; }
class IpAllowlistDto { @IsArray() entries!: string[]; }
class BulkStatusDto {
  @IsArray() organizationIds!: string[];
  @IsIn(["ACTIVE", "SUSPENDED", "DELETED"]) status!: string;
  @IsString() @MinLength(3) reason!: string;
}
class DeletePermanentDto {
  @IsString() @MinLength(1) confirmName!: string;
  @IsString() @MinLength(3) reason!: string;
}
class SlugTombstoneReleaseDto {
  // TD11: the release reason ("note") — mandatory, audited.
  @IsString() @MinLength(3) note!: string;
}
class BackupInfoDto {
  @IsOptional() @IsString() lastBackupAt?: string;
  @IsOptional() @IsString() location?: string;
  @IsOptional() @IsString() note?: string;
}
class ViewAsDto {
  @IsOptional() @IsIn(["read", "write"]) mode?: string;
  @IsString() @MinLength(3) reason!: string;
}
class NudgeDto {
  @IsString() organizationId!: string;
  @IsIn(["onboarding", "trial_expiring", "past_due", "sync_failing", "integration_error"]) kind!: string;
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
    private readonly paymentsSvc: PaymentsService,
    // Optional in the signature so older spec constructions with
    // four arguments keep compiling; Nest always injects it via
    // the ConnectionsModule import in AdminModule.
    @Optional() private readonly wallet?: WalletService,
  ) {}

  private walletSvc(): WalletService {
    if (!this.wallet) throw new Error("WalletService is not wired into AdminController");
    return this.wallet;
  }

  @Get("health") health() { return this.admin.health(); }
  @Get("overview") overview() { return this.admin.overview(); }
  // ADX3: sidebar badge / Attention Bell counts — read-only, every
  // field honestly sourced or omitted (see AdminService.navCounts).
  @Get("nav-counts") navCounts() { return this.admin.navCounts(); }

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
  // GC21 (GB9): merchant verification review (approve/reject
  // with a merchant-visible note on reject).
  @Post("organizations/:id/verification") @AdminTier("SUPER", "SUPPORT")
  orgVerification(@Req() req: any, @Param("id") id: string, @Body() dto: OrgVerificationDto) {
    return this.admin.reviewOrgVerification(req.adminUser, id, dto.decision, dto.note, req.ip);
  }
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
  @Patch("platform-config/bkash") @AdminTier("SUPER")
  updateBkashConfig(@Req() req: any, @Body() dto: BkashConfigDto) { return this.admin.updatePlatformConfig(req.adminUser, "bkash", dto as unknown as Record<string, unknown>, req.ip); }
  @Patch("platform-config/image") @AdminTier("SUPER")
  updateImageConfig(@Req() req: any, @Body() dto: ImageConfigDto) { return this.admin.updatePlatformConfig(req.adminUser, "image", dto as unknown as Record<string, unknown>, req.ip); }
  @Patch("platform-config/tiktok") @AdminTier("SUPER")
  updateTiktokConfig(@Req() req: any, @Body() dto: TiktokAppConfigDto) { return this.admin.updatePlatformConfig(req.adminUser, "tiktok", dto as unknown as Record<string, unknown>, req.ip); }
  @Patch("platform-config/google") @AdminTier("SUPER")
  updateGoogleConfig(@Req() req: any, @Body() dto: GoogleAppConfigDto) { return this.admin.updatePlatformConfig(req.adminUser, "google", dto as unknown as Record<string, unknown>, req.ip); }
  @Patch("platform-config/linkedin") @AdminTier("SUPER")
  updateLinkedinConfig(@Req() req: any, @Body() dto: LinkedinAppConfigDto) { return this.admin.updatePlatformConfig(req.adminUser, "linkedin", dto as unknown as Record<string, unknown>, req.ip); }
  @Patch("platform-config/google-oauth") @AdminTier("SUPER")
  updateGoogleOAuthConfig(@Req() req: any, @Body() dto: GoogleOAuthConfigDto) { return this.admin.updatePlatformConfig(req.adminUser, "googleOAuth", dto as unknown as Record<string, unknown>, req.ip); }
  @Patch("platform-config/wallet") @AdminTier("SUPER")
  updateWalletConfig(@Req() req: any, @Body() dto: WalletConfigDto) { return this.admin.updatePlatformConfig(req.adminUser, "wallet", dto as unknown as Record<string, unknown>, req.ip); }

  // ---- CC10: tenant wallet payouts (platform payment) ----
  // Money-moving admin surface: SUPER or FINANCE tier. Every
  // action is validated inside WalletService transactions and
  // audited there with the acting admin's id.
  @Get("payout-requests") @AdminTier("SUPER", "FINANCE")
  payoutRequests(@Query("status") status?: string) { return this.walletSvc().adminListPayoutRequests(status); }
  @Post("payout-requests/:id/approve") @AdminTier("SUPER", "FINANCE")
  approvePayout(@Req() req: any, @Param("id") id: string, @Body() dto: PayoutDecisionDto) { return this.walletSvc().adminDecidePayout(req.adminUser, id, "approve", dto.note); }
  @Post("payout-requests/:id/reject") @AdminTier("SUPER", "FINANCE")
  rejectPayout(@Req() req: any, @Param("id") id: string, @Body() dto: PayoutDecisionDto) { return this.walletSvc().adminDecidePayout(req.adminUser, id, "reject", dto.note); }
  @Post("payout-requests/:id/mark-paid") @AdminTier("SUPER", "FINANCE")
  markPayoutPaid(@Req() req: any, @Param("id") id: string, @Body() dto: PayoutMarkPaidDto) { return this.walletSvc().adminMarkPaid(req.adminUser, id, dto.payoutRef); }
  @Post("wallets/:organizationId/adjust") @AdminTier("SUPER", "FINANCE")
  adjustWallet(@Req() req: any, @Param("organizationId") organizationId: string, @Body() dto: WalletAdjustDto) { return this.walletSvc().adminAdjustWallet(req.adminUser, organizationId, dto); }
  // CC19: per-org wallet statement export from the real ledger
  // (same builder as the tenant export; read-only, no credits).
  @Get("wallets/:organizationId/statement.csv") @AdminTier("SUPER", "FINANCE") @Header("Content-Type", "text/csv; charset=utf-8") @Header("Content-Disposition", "attachment; filename=wallet-statement.csv")
  async walletStatementCsv(@Param("organizationId") organizationId: string, @Query("from") from?: string, @Query("to") to?: string) {
    const statement = await this.walletSvc().getStatement(organizationId, statementRange(from, to));
    return buildStatementCsv(statement);
  }
  @Get("wallets/:organizationId/statement.pdf") @AdminTier("SUPER", "FINANCE")
  async walletStatementPdf(@Param("organizationId") organizationId: string, @Res() res: any, @Query("from") from?: string, @Query("to") to?: string) {
    const statement = await this.walletSvc().getStatement(organizationId, statementRange(from, to));
    res.setHeader("Content-Type", "application/pdf");
    res.setHeader("Content-Disposition", "attachment; filename=\"wallet-statement.pdf\"");
    return res.send(buildStatementPdf(statement));
  }
  @Post("platform-config/test-llm") @AdminTier("SUPER")
  testLlm() { return this.admin.testLlm(); }
  @Post("platform-config/test-image") @AdminTier("SUPER")
  testImage() { return this.admin.testImage(); }
  @Post("platform-config/test-email") @AdminTier("SUPER")
  testEmail(@Body() dto: TestSendDto) { return this.admin.testEmail(dto.to); }
  @Post("platform-config/test-sms") @AdminTier("SUPER")
  testSms(@Body() dto: TestSendDto) { return this.admin.testSms(dto.to); }
  // AA3: verify the five formerly blind-save config blocks.
  @Post("platform-config/test-meta") @AdminTier("SUPER")
  testMeta() { return this.admin.testMeta(); }
  @Post("platform-config/test-sslcommerz") @AdminTier("SUPER")
  testSslcommerz() { return this.admin.testSslcommerz(); }
  @Post("platform-config/test-bkash") @AdminTier("SUPER")
  testBkash() { return this.admin.testBkash(); }
  @Post("platform-config/test-tiktok") @AdminTier("SUPER")
  testTiktok() { return this.admin.testTiktok(); }
  @Post("platform-config/test-linkedin") @AdminTier("SUPER")
  testLinkedin() { return this.admin.testLinkedin(); }
  @Post("platform-config/test-google") @AdminTier("SUPER")
  testGoogle() { return this.admin.testGoogle(); }
  @Patch("settings") @AdminTier("SUPER")
  updateSettings(@Req() req: any, @Body() dto: SettingsDto) { return this.admin.updateSettings(req.adminUser, dto as unknown as Record<string, unknown>, req.ip); }

  @Patch("settings/plan-limits") @AdminTier("SUPER")
  updatePlanLimits(@Req() req: any, @Body() body: Record<string, { aiDaily?: number; broadcastCap?: number; seats?: number }>) {
    return this.admin.updateSettings(req.adminUser, { planLimits: body }, req.ip);
  }

  // AB3 / AN14(a): remove ONE tier's stored plan-limits entry so
  // that tier falls back to the pure code defaults.
  @Post("settings/plan-limits/:tier/clear") @AdminTier("SUPER")
  clearPlanLimits(@Req() req: any, @Param("tier") tier: string, @Body() dto: ReasonDto) {
    return this.admin.clearPlanLimits(req.adminUser, tier, dto.reason, req.ip);
  }

  // AA7: plan-scoped feature-flag defaults (sparse flag -> tier -> boolean).
  @Patch("settings/plan-flag-defaults") @AdminTier("SUPER")
  updatePlanFlagDefaults(@Req() req: any, @Body() body: Record<string, Record<string, boolean>>) {
    return this.admin.updateSettings(req.adminUser, { planFlagDefaults: body }, req.ip);
  }

  @Get("announcements") announcements() { return this.admin.listAnnouncements(); }
  @Post("announcements") @AdminTier("SUPER", "SUPPORT")
  createAnnouncement(@Req() req: any, @Body() dto: AnnouncementDto) { return this.admin.createAnnouncement(req.adminUser, dto, req.ip); }
  @Post("announcements/:id/active") @AdminTier("SUPER", "SUPPORT")
  announcementActive(@Req() req: any, @Param("id") id: string, @Body() body: { active: boolean }) { return this.admin.setAnnouncementActive(req.adminUser, id, body.active === true, req.ip); }
  @Delete("announcements/:id") @AdminTier("SUPER")
  deleteAnnouncement(@Req() req: any, @Param("id") id: string) { return this.admin.deleteAnnouncement(req.adminUser, id, req.ip); }

  // ---- Milestone 41 (Phase A5): campaigns, changelog, referrals, feedback ----
  @Get("campaigns") campaigns() { return this.admin.listCampaigns(); }
  @Post("campaigns") @AdminTier("SUPER")
  sendCampaign(@Req() req: any, @Body() dto: CampaignDto) { return this.admin.sendCampaign(req.adminUser, dto, req.ip); }
  @Get("changelog") changelogAdmin() { return this.admin.listChangelogAdmin(); }
  @Post("changelog") @AdminTier("SUPER", "SUPPORT")
  createChangelog(@Req() req: any, @Body() dto: ChangelogDto) {
    return this.admin.createChangelog(req.adminUser, { version: dto.version, title: dto.title ?? "", body: dto.body ?? "", published: dto.published }, req.ip);
  }
  @Patch("changelog/:id") @AdminTier("SUPER", "SUPPORT")
  updateChangelog(@Req() req: any, @Param("id") id: string, @Body() dto: ChangelogDto) { return this.admin.updateChangelog(req.adminUser, id, dto, req.ip); }
  @Delete("changelog/:id") @AdminTier("SUPER")
  deleteChangelog(@Req() req: any, @Param("id") id: string) { return this.admin.deleteChangelog(req.adminUser, id, req.ip); }
  @Get("referrals") referrals() { return this.admin.referralsBoard(); }
  @Get("referrals/campaigns") referralCampaigns() { return this.admin.listReferralCampaigns(); }
  @Post("referrals/campaigns") @AdminTier("SUPER")
  createReferralCampaign(@Req() req: any, @Body() dto: any) { return this.admin.createReferralCampaign(req.adminUser, dto, req.ip); }
  @Patch("referrals/campaigns/:id") @AdminTier("SUPER")
  updateReferralCampaign(@Req() req: any, @Param("id") id: string, @Body() dto: any) { return this.admin.updateReferralCampaign(req.adminUser, id, dto, req.ip); }
  @Patch("referrals/config") @AdminTier("SUPER")
  referralConfig(@Req() req: any, @Body() dto: ReferralConfigDto) { return this.admin.updateReferralConfig(req.adminUser, dto, req.ip); }
  @Get("feedback") feedback() { return this.admin.feedbackBoard(); }

  @Get("orgs/:id/flags") orgFlags(@Param("id") id: string) { return this.admin.getOrgFlags(id); }
  @Post("orgs/:id/flags") @AdminTier("SUPER", "SUPPORT")
  setOrgFlag(@Req() req: any, @Param("id") id: string, @Body() dto: FlagDto) { return this.admin.setOrgFlag(req.adminUser, id, dto.key, dto.enabled === true, req.ip); }
  @Patch("orgs/:id/limits") @AdminTier("SUPER")
  orgLimits(@Req() req: any, @Param("id") id: string, @Body() dto: LimitsDto) { return this.admin.updateOrgLimits(req.adminUser, id, dto, req.ip); }

  @Get("health/integrations") healthIntegrations() { return this.admin.healthIntegrations(); }
  @Get("health/jobs") healthJobs() { return this.admin.healthJobs(); }
  // AN15: cross-org connection-health board (CC22 definitions;
  // read-only, tier pattern matches the other health GET routes).
  @Get("health/connections") healthConnections() { return this.admin.healthConnections(); }
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

  // RB6/RM12: platform storage overview (StoredFile registry).
  @Get("storage-overview") storageOverview() { return this.admin.storageOverview(); }

  // AA7: AI usage drill-down — per org x feature (tokens/calls only).
  @Get("usage/ai-detail") usageAiDetail(@Query("days") days?: string, @Query("organizationId") organizationId?: string) {
    return this.admin.aiUsageDetail(days ? Number(days) : undefined, organizationId || undefined);
  }
  @Get("usage/ai-detail/export.csv") @Header("Content-Type", "text/csv; charset=utf-8") @Header("Content-Disposition", "attachment; filename=ai-usage-by-feature.csv")
  exportAiUsageCsv(@Query("days") days?: string, @Query("organizationId") organizationId?: string) {
    return this.admin.exportAiUsageCsv(days ? Number(days) : undefined, organizationId || undefined);
  }

  // ---- Phase A1 (Milestone 37): Operator Visibility++ ----
  @Get("analytics/series") analyticsSeries(@Query("months") months?: string) { return this.admin.analyticsSeries(months ? Number(months) : undefined); }
  @Get("analytics/top-tenants") analyticsTopTenants(@Query("limit") limit?: string) { return this.admin.analyticsTopTenants(limit ? Number(limit) : undefined); }
  @Get("analytics/health-scores") analyticsHealthScores() { return this.admin.analyticsHealthScores(); }
  @Get("analytics/ai-cost") analyticsAiCost() { return this.admin.analyticsAiCost(); }
  @Patch("analytics/ai-rates") @AdminTier("SUPER")
  updateAiRates(@Req() req: any, @Body() dto: AiRatesDto) { return this.admin.updateAiCostRates(req.adminUser, dto.rates as Record<string, unknown>, req.ip); }
  @Get("orgs/:id/history") orgHistory(@Param("id") id: string) { return this.admin.orgHistory(id); }

  // Milestone 38 (Phase A2): Support++.
  @Post("orgs/:id/view-as") @AdminTier("SUPER", "SUPPORT")
  viewAs(@Req() req: any, @Param("id") id: string, @Body() dto: ViewAsDto) {
    return this.admin.startViewAs(req.adminUser, req.adminTier, id, dto, req.ip);
  }

  // Admin Polish AP2: view-as session registry + revocation.
  @Get("view-as/sessions") @AdminTier("SUPER", "SUPPORT", "ANALYST")
  viewAsSessions(@Req() req: any) { return this.admin.listViewAsSessions({ ...req.adminUser, adminTier: req.adminTier }); }

  @Post("view-as/sessions/:sessionId/revoke") @AdminTier("SUPER", "SUPPORT")
  viewAsRevoke(@Req() req: any, @Param("sessionId") sessionId: string) {
    return this.admin.revokeViewAsSession({ ...req.adminUser, adminTier: req.adminTier }, sessionId, req.ip);
  }

  @Get("orgs/:id/timeline360")
  timeline360(@Param("id") id: string) { return this.admin.orgTimeline360(id); }

  @Get("alerts")
  alerts() { return this.admin.alertsBoard(); }

  @Post("alerts/nudge") @AdminTier("SUPER", "SUPPORT")
  nudge(@Req() req: any, @Body() dto: NudgeDto) {
    return this.admin.nudgeOrg(req.adminUser, dto.organizationId, dto.kind, req.ip);
  }

  @Get("onboarding-board")
  onboardingBoard() { return this.admin.onboardingBoard(); }

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
  // AA7: dedicated admins roster (read-only; grant/revoke stays on the user page).
  @Get("security/admins") adminsRoster() { return this.admin.adminsRoster(); }
  @Post("security/revoke-my-sessions")
  revokeMine(@Req() req: any, @Body() dto: ReasonDto) { return this.admin.revokeSessions(req.adminUser, req.adminUser.id, dto.reason, req.ip); }
  @Post("users/:id/revoke-sessions") @AdminTier("SUPER", "SUPPORT")
  revokeUserSessions(@Req() req: any, @Param("id") id: string, @Body() dto: ReasonDto) { return this.admin.revokeSessions(req.adminUser, id, dto.reason, req.ip); }

  // ---- Milestone 40 (Phase A4): control & safety ----
  @Get("security/api-keys") apiKeys() { return this.admin.listApiKeys(); }
  @Post("security/api-keys") @AdminTier("SUPER")
  createApiKey(@Req() req: any, @Body() dto: ApiKeyDto) { return this.admin.createApiKey(req.adminUser, dto.name, req.ip, dto.scopes); }
  @Post("security/api-keys/:id/revoke") @AdminTier("SUPER")
  revokeApiKey(@Req() req: any, @Param("id") id: string, @Body() dto: ReasonDto) { return this.admin.revokeApiKey(req.adminUser, id, dto.reason, req.ip); }
  @Get("security/ip-allowlist") ipAllowlist() { return this.admin.getIpAllowlist(); }
  @Patch("security/ip-allowlist") @AdminTier("SUPER")
  setIpAllowlist(@Req() req: any, @Body() dto: IpAllowlistDto) { return this.admin.setIpAllowlist(req.adminUser, dto.entries, req.ip); }
  @Get("security/login-anomalies") loginAnomalies(@Query("hours") hours?: string) { return this.admin.loginAnomalies(hours ? Number(hours) : 24); }
  @Post("orgs/bulk-status") @AdminTier("SUPER")
  bulkStatus(@Req() req: any, @Body() dto: BulkStatusDto) { return this.admin.bulkOrgStatus(req.adminUser, dto.organizationIds, dto.status, dto.reason, req.ip); }
  @Get("orgs/:id/export") @Header("Content-Disposition", "attachment; filename=org-export.json")
  exportOrg(@Req() req: any, @Param("id") id: string) { return this.admin.exportOrgData(req.adminUser, id, req.ip); }
  @Post("orgs/:id/delete-permanent") @AdminTier("SUPER")
  deletePermanent(@Req() req: any, @Param("id") id: string, @Body() dto: DeletePermanentDto) {
    return this.admin.deleteOrgPermanent(req.adminUser, id, dto.confirmName, dto.reason, req.ip);
  }

  // ---- TD11: slug tombstones (180-day slug cooldown) ----
  @Get("slug-tombstones") slugTombstones() { return this.admin.listSlugTombstones(); }
  @Post("slug-tombstones/:slug/release") @AdminTier("SUPER")
  releaseSlugTombstone(@Req() req: any, @Param("slug") slug: string, @Body() dto: SlugTombstoneReleaseDto) {
    return this.admin.releaseSlugTombstone(req.adminUser, slug, dto.note, req.ip);
  }

  // ---- Milestone 42 (Phase A6): reliability panel ----
  @Get("system/version") systemVersion() { return this.admin.systemVersion(); }
  @Get("system/env-check") systemEnvCheck() { return this.admin.systemEnvCheck(); }
  @Get("system/queues") systemQueues() { return this.admin.systemQueues(); }
  // AB3 / AN12: queue operator actions (pause/resume/capped
  // failed-retry). No drain/obliterate/delete by design.
  @Post("system/queues/:queue/pause") @AdminTier("SUPER")
  queuePause(@Req() req: any, @Param("queue") queue: string, @Body() dto: QueueActionDto) {
    return this.admin.queuePause(req.adminUser, queue, dto.reason, req.ip);
  }
  @Post("system/queues/:queue/resume") @AdminTier("SUPER")
  queueResume(@Req() req: any, @Param("queue") queue: string, @Body() dto: QueueActionDto) {
    return this.admin.queueResume(req.adminUser, queue, dto.reason, req.ip);
  }
  @Post("system/queues/:queue/retry-failed") @AdminTier("SUPER")
  queueRetryFailed(@Req() req: any, @Param("queue") queue: string, @Body() dto: QueueActionDto) {
    return this.admin.queueRetryFailed(req.adminUser, queue, { jobIds: dto.jobIds, limit: dto.limit, reason: dto.reason }, req.ip);
  }
  @Get("system/webhooks") systemWebhooks(@Query("provider") provider?: string, @Query("organizationId") organizationId?: string, @Query("hasError") hasError?: string, @Query("take") take?: string) {
    return this.admin.systemWebhooks({ provider, organizationId, hasError: hasError === "true" || hasError === "1" ? true : undefined, take: take ? Number(take) : undefined });
  }
  @Get("system/webhooks/:id") systemWebhookEvent(@Param("id") id: string) { return this.admin.systemWebhookEvent(id); }
  @Get("system/social-board") socialBoard() { return this.admin.socialBoard(); }
  @Get("system/ads-board") adsBoard() { return this.admin.adsBoard(); }
  // AB3 / AN13: operator retry from the boards — every action
  // delegates to the tenant side's own service method (see
  // AdminService AN13 notes). Tier matches health/retry.
  @Post("system/social-board/posts/:postId/retry") @AdminTier("SUPER", "SUPPORT")
  socialOpsRetryPost(@Req() req: any, @Param("postId") postId: string, @Body() dto: ReasonDto) {
    return this.admin.socialOpsRetryPost(req.adminUser, postId, dto.reason, req.ip);
  }
  @Post("system/social-board/posts/:postId/recover-stuck") @AdminTier("SUPER", "SUPPORT")
  socialOpsRecoverStuck(@Req() req: any, @Param("postId") postId: string, @Body() dto: ReasonDto) {
    return this.admin.socialOpsRecoverStuck(req.adminUser, postId, dto.reason, req.ip);
  }
  @Post("system/social-board/accounts/:accountId/recheck") @AdminTier("SUPER", "SUPPORT")
  socialOpsRecheckAccount(@Req() req: any, @Param("accountId") accountId: string, @Body() dto: ReasonDto) {
    return this.admin.socialOpsRecheckAccount(req.adminUser, accountId, dto.reason, req.ip);
  }
  @Post("system/ads-board/accounts/:accountId/retry-sync") @AdminTier("SUPER", "SUPPORT")
  socialOpsRetryAdSync(@Req() req: any, @Param("accountId") accountId: string, @Body() dto: ReasonDto) {
    return this.admin.socialOpsRetryAdSync(req.adminUser, accountId, dto.reason, req.ip);
  }
  @Get("system/inbox-health") systemInboxHealth() { return this.admin.inboxHealth(); }
  @Get("system/dlq") systemDlq() { return this.admin.listDlq(); }
  @Post("system/dlq/:dlqId/replay") @AdminTier("SUPER", "SUPPORT")
  systemDlqReplay(@Req() req: any, @Param("dlqId") dlqId: string) { return this.automation.replayDlq(dlqId, req.adminUser.id); }
  @Get("system/errors") systemErrors(@Query("hours") hours?: string) { return this.admin.systemErrors(hours ? Number(hours) : 24); }
  @Get("system/logs") systemLogs(@Query("take") take?: string, @Query("q") q?: string, @Query("organizationId") organizationId?: string) {
    return this.admin.systemLogs(take ? Number(take) : 100, q, organizationId);
  }
  @Get("system/db-growth") systemDbGrowth() { return this.admin.systemDbGrowth(); }
  @Get("system/backup") systemBackup() { return this.admin.getBackupPanel(); }
  @Post("system/backup-verify") @AdminTier("SUPER", "SUPPORT")
  backupVerify(@Req() req: any) { return this.admin.verifyBackupManifest(req.adminUser, req.ip); }
  @Patch("system/backup-info") @AdminTier("SUPER")
  backupInfo(@Req() req: any, @Body() dto: BackupInfoDto) { return this.admin.setBackupInfo(req.adminUser, dto, req.ip); }

  // ---- Phase C: SaaS billing ----
  @Patch("orgs/:id/subscription") @AdminTier("SUPER", "FINANCE")
  updateSubscription(@Req() req: any, @Param("id") id: string, @Body() dto: SubscriptionDto) {
    return this.admin.updateSubscription(req.adminUser, id, dto, dto.reason, req.ip);
  }
  // GC22 (GB9): admin subscription pause/resume (reason required).
  @Post("orgs/:id/subscription/pause") @AdminTier("SUPER", "FINANCE")
  pauseSubscription(@Req() req: any, @Param("id") id: string, @Body() dto: ReasonDto) {
    return this.admin.pauseOrgSubscription(req.adminUser, id, dto.reason, req.ip);
  }
  @Post("orgs/:id/subscription/resume") @AdminTier("SUPER", "FINANCE")
  resumeSubscription(@Req() req: any, @Param("id") id: string, @Body() dto: ReasonDto) {
    return this.admin.resumeOrgSubscription(req.adminUser, id, dto.reason, req.ip);
  }
  @Get("billing/summary") billingSummary() { return this.admin.billingSummary(); }
  @Get("payments") payments(@Query("organizationId") orgId?: string, @Query("take") take?: string) {
    return this.admin.listPayments(orgId, Number(take ?? 50) || 50);
  }
  @Post("payments") @AdminTier("SUPER", "FINANCE")
  recordPayment(@Req() req: any, @Body() dto: PaymentDto) { return this.admin.recordPayment(req.adminUser, dto, req.ip); }
  @Delete("payments/:id") @AdminTier("SUPER")
  deletePayment(@Req() req: any, @Param("id") id: string, @Body() dto: ReasonDto) { return this.admin.deletePayment(req.adminUser, id, dto.reason, req.ip); }

  // ---- Phase A3 (Milestone 39): Billing & Money++ ----
  @Post("payments/:id/refund") @AdminTier("SUPER", "FINANCE")
  refundPayment(@Req() req: any, @Param("id") id: string, @Body() dto: RefundDto) {
    return this.admin.refundPayment(req.adminUser, id, dto, req.ip);
  }
  @Get("payments/:id/invoice") @Header("Content-Type", "text/html; charset=utf-8")
  paymentInvoice(@Param("id") id: string) { return this.admin.paymentInvoiceHtml(id); }
  /** GC22 (GB9): the admin invoice as a PDF download. */
  @Get("payments/:id/invoice.pdf")
  async paymentInvoicePdf(@Param("id") id: string, @Res() res: Response) {
    const buf = await this.admin.paymentInvoicePdf(id);
    res.setHeader("Content-Type", "application/pdf");
    res.setHeader("Content-Disposition", `attachment; filename="invoice-${id}.pdf"`);
    res.setHeader("Content-Length", String(buf.length));
    res.end(buf);
  }
  @Post("payments/:id/invoice-email") @AdminTier("SUPER", "FINANCE")
  invoiceEmail(@Req() req: any, @Param("id") id: string) { return this.admin.sendInvoiceEmail(req.adminUser, id, req.ip); }
  @Get("billing/checkouts")
  checkouts(@Query("status") status?: string, @Query("organizationId") organizationId?: string, @Query("take") take?: string) {
    return this.paymentsSvc.listCheckouts({ status, organizationId, take: take ? Number(take) : undefined });
  }
  @Post("billing/checkouts/:id/reconcile") @AdminTier("SUPER", "FINANCE")
  reconcile(@Param("id") id: string) { return this.paymentsSvc.reconcileCheckout(id); }
  @Get("billing/dunning") dunning() { return this.admin.dunningBoard(); }
  @Get("billing/export.csv") @Header("Content-Type", "text/csv; charset=utf-8") @Header("Content-Disposition", "attachment; filename=payments-export.csv")
  exportCsv() { return this.admin.exportPaymentsCsv(); }
  @Get("coupons") coupons() { return this.paymentsSvc.listCoupons(); }
  @Post("coupons") @AdminTier("SUPER", "FINANCE")
  createCoupon(@Req() req: any, @Body() dto: CouponDto) { return this.paymentsSvc.createCoupon(req.adminUser, dto, req.ip); }
  @Post("coupons/:id/status") @AdminTier("SUPER", "FINANCE")
  couponStatus(@Req() req: any, @Param("id") id: string, @Body() dto: CouponStatusDto) {
    return this.paymentsSvc.setCouponActive(req.adminUser, id, dto.active, dto.reason, req.ip);
  }

  @Get("audit") audit(@Query("action") action?: string, @Query("userId") userId?: string, @Query("take") take?: string, @Query("organizationId") organizationId?: string, @Query("entityType") entityType?: string, @Query("dateFrom") dateFrom?: string, @Query("dateTo") dateTo?: string) {
    return this.admin.auditTrail({ action, userId, organizationId, entityType, dateFrom, dateTo, take: Number(take ?? 50) || 50 });
  }
  @Get("audit/export.csv") @Header("Content-Type", "text/csv; charset=utf-8") @Header("Content-Disposition", "attachment; filename=audit-export.csv")
  exportAuditCsv(@Query("action") action?: string, @Query("userId") userId?: string, @Query("organizationId") organizationId?: string, @Query("entityType") entityType?: string, @Query("dateFrom") dateFrom?: string, @Query("dateTo") dateTo?: string) {
    return this.admin.exportAuditCsv({ action, userId, organizationId, entityType, dateFrom, dateTo });
  }
}

/** Public, unauthenticated platform status for the tenant app shell
 * (announcement banner, maintenance notice, signup gate). Contains
 * no tenant data — only operator-published notices. */
@Controller("public")
export class PublicStatusController {
  constructor(private readonly admin: AdminService) {}
  @Public() @Get("system-status") status(@Query("organizationId") organizationId?: string) { return this.admin.publicStatus(organizationId); }
  @Public() @Get("changelog") changelog() { return this.admin.publicChangelog(); }
  @Public() @Get("pricing") pricing() { return this.admin.publicPricing(); }
}
