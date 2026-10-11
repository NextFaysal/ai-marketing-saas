import { Body, Controller, Delete, Get, Param, Patch, Post, Query, UseGuards } from "@nestjs/common";
import { ReportsService, ReportType, ReportLanguage } from "./reports.service";
import { ChatService } from "./chat.service";
import { ToolsService } from "./tools.service";
import { GenerateReportDto, CreateConversationDto, SendMessageDto, UpdateRecommendationDto, UpdateConversationDto, CreateProposalDto, UpdateProactiveSettingsDto, GenerateCreativeDto, CreateCreativeDraftDto } from "./ai.dto";
import { ProposalsService } from "./proposals.service";
import { ProactiveService } from "./proactive.service";
import { CreativeStudioService } from "./creative-studio.service";
import { CurrentUser, AuthUser, Roles, PermissionArea } from "../common/decorators";
import { TenantGuard } from "../common/tenant.guard";
import { RolesGuard } from "../common/roles.guard";

@PermissionArea("ai")
@Controller("organizations/:organizationId/ai")
@UseGuards(TenantGuard, RolesGuard)
export class AiController {
  constructor(
    private readonly reports: ReportsService,
    private readonly chat: ChatService,
    private readonly tools: ToolsService,
    private readonly proposals: ProposalsService,
    private readonly proactive: ProactiveService,
    private readonly creative: CreativeStudioService,
  ) {}

  // ----- Reports -----
  @Post("reports/generate") @UseGuards(RolesGuard) @Roles("OWNER", "ADMIN", "MARKETING_MANAGER", "ANALYST")
  generate(@CurrentUser() user: AuthUser, @Param("organizationId") orgId: string, @Body() dto: GenerateReportDto) {
    return this.reports.generate(orgId, user.userId, {
      type: dto.type as ReportType | undefined,
      date: dto.date,
      language: dto.language === "en" ? "en" : "bn",
    });
  }

  @Get("reports")
  listReports(@Param("organizationId") orgId: string) { return this.reports.list(orgId); }

  @Get("reports/:reportId")
  getReport(@Param("organizationId") orgId: string, @Param("reportId") id: string) { return this.reports.getOne(orgId, id); }

  @Get("anomalies")
  anomalies(@Param("organizationId") orgId: string, @Query("days") days?: string) {
    return this.tools.getAnomalies(orgId, days ? Number(days) : 14);
  }

  @Get("recommendations")
  recommendations(@Param("organizationId") orgId: string, @Query("status") status?: string) {
    return this.reports.listRecommendations(orgId, status ?? "open");
  }

  @Patch("recommendations/:recommendationId") @UseGuards(RolesGuard) @Roles("OWNER", "ADMIN", "MARKETING_MANAGER")
  updateRecommendation(@Param("organizationId") orgId: string, @Param("recommendationId") id: string, @Body() dto: UpdateRecommendationDto) {
    return this.reports.updateRecommendation(orgId, id, dto.status);
  }

  // ----- Chat -----
  @Post("chat/conversations")
  createConversation(@CurrentUser() user: AuthUser, @Param("organizationId") orgId: string, @Body() dto: CreateConversationDto) {
    return this.chat.createConversation(orgId, user.userId, dto.title);
  }

  @Get("chat/conversations")
  listConversations(@CurrentUser() user: AuthUser, @Param("organizationId") orgId: string, @Query("search") search?: string) {
    return this.chat.listConversations(orgId, user.userId, search);
  }

  @Patch("chat/conversations/:conversationId")
  updateConversation(@CurrentUser() user: AuthUser, @Param("organizationId") orgId: string, @Param("conversationId") id: string, @Body() dto: UpdateConversationDto) {
    return this.chat.updateConversation(orgId, user.userId, id, dto);
  }

  @Delete("chat/conversations/:conversationId")
  deleteConversation(@CurrentUser() user: AuthUser, @Param("organizationId") orgId: string, @Param("conversationId") id: string) {
    return this.chat.deleteConversation(orgId, user.userId, id);
  }

  @Get("chat/conversations/:conversationId/export")
  exportConversation(@CurrentUser() user: AuthUser, @Param("organizationId") orgId: string, @Param("conversationId") id: string, @Query("format") format?: string) {
    return this.chat.exportConversation(orgId, user.userId, id, format === "markdown" ? "markdown" : "json");
  }

  @Get("chat/conversations/:conversationId/messages")
  listMessages(@CurrentUser() user: AuthUser, @Param("organizationId") orgId: string, @Param("conversationId") id: string) {
    return this.chat.listMessages(orgId, user.userId, id);
  }

  @Post("chat/conversations/:conversationId/messages")
  sendMessage(@CurrentUser() user: AuthUser, @Param("organizationId") orgId: string, @Param("conversationId") id: string, @Body() dto: SendMessageDto) {
    return this.chat.sendMessage(orgId, user.userId, id, dto.content);
  }

  // ----- Write-action proposals (Milestone 47) -----
  // Proposing executes nothing; approve is the explicit human decision.
  @Get("proposals/targets")
  proposalTargets(@Param("organizationId") orgId: string) { return this.proposals.targets(orgId); }

  @Get("proposals")
  listProposals(@Param("organizationId") orgId: string, @Query("status") status?: string) {
    return this.proposals.list(orgId, status);
  }

  @Post("proposals")
  createProposal(@CurrentUser() user: AuthUser, @Param("organizationId") orgId: string, @Body() dto: CreateProposalDto) {
    return this.proposals.propose(orgId, user.userId, dto);
  }

  @Post("proposals/:proposalId/approve") @UseGuards(RolesGuard) @Roles("OWNER", "ADMIN", "MARKETING_MANAGER")
  approveProposal(@CurrentUser() user: AuthUser, @Param("organizationId") orgId: string, @Param("proposalId") id: string) {
    return this.proposals.approve(orgId, user.userId, id);
  }

  @Post("proposals/:proposalId/reject") @UseGuards(RolesGuard) @Roles("OWNER", "ADMIN", "MARKETING_MANAGER")
  rejectProposal(@CurrentUser() user: AuthUser, @Param("organizationId") orgId: string, @Param("proposalId") id: string) {
    return this.proposals.reject(orgId, user.userId, id);
  }

  // ----- Proactive assistant (Milestone 48) -----
  @Get("proactive/settings")
  proactiveSettings(@Param("organizationId") orgId: string) { return this.proactive.getSettings(orgId); }

  @Patch("proactive/settings") @UseGuards(RolesGuard) @Roles("OWNER", "ADMIN")
  updateProactiveSettings(@CurrentUser() user: AuthUser, @Param("organizationId") orgId: string, @Body() dto: UpdateProactiveSettingsDto) {
    return this.proactive.updateSettings(orgId, user.userId, dto);
  }

  @Post("proactive/run-now") @UseGuards(RolesGuard) @Roles("OWNER", "ADMIN")
  runBriefingNow(@CurrentUser() user: AuthUser, @Param("organizationId") orgId: string) {
    return this.proactive.runDailyBriefing(orgId, user.userId);
  }

  // ----- Creative Studio (Milestone 55) -----
  @Post("creative-studio/generate") @UseGuards(RolesGuard) @Roles("OWNER", "ADMIN", "MARKETING_MANAGER")
  generateCreative(@CurrentUser() user: AuthUser, @Param("organizationId") orgId: string, @Body() dto: GenerateCreativeDto) {
    return this.creative.generate(orgId, user.userId, dto as any);
  }

  @Post("creative-studio/draft") @UseGuards(RolesGuard) @Roles("OWNER", "ADMIN", "MARKETING_MANAGER")
  createCreativeDraft(@CurrentUser() user: AuthUser, @Param("organizationId") orgId: string, @Body() dto: CreateCreativeDraftDto) {
    return this.creative.createDraft(orgId, user.userId, dto);
  }
}
