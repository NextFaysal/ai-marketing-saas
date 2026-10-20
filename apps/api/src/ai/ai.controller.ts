import { Body, Controller, Delete, Get, HttpException, Param, Patch, Post, Query, Req, Res, UploadedFile, UseGuards, UseInterceptors } from "@nestjs/common";
import { FileInterceptor } from "@nestjs/platform-express";
import { ReportsService, ReportType, ReportLanguage } from "./reports.service";
import { ChatService } from "./chat.service";
import { ToolsService } from "./tools.service";
import { GenerateReportDto, CreateConversationDto, SendMessageDto, UpdateRecommendationDto, UpdateConversationDto, CreateProposalDto, UpdateProactiveSettingsDto, GenerateCreativeDto, CreateCreativeDraftDto, CreateSavedPromptDto, UpdateSavedPromptDto, BulkApproveDto, CreateAssistantApiKeyDto } from "./ai.dto";
import { ProposalsService } from "./proposals.service";
import { AssistantApiService } from "./assistant-api.service";
import { approvalLinkSecret, mintApprovalToken } from "./approval-links";
import { PromptsService } from "./prompts.service";
import { MentionsService } from "./mentions.service";
import { VisionService } from "./vision.service";
import { processChatAttachment, ATTACHMENT_MAX_BYTES } from "./chat-attachments";
import { ProactiveService } from "./proactive.service";
import { CreativeStudioService } from "./creative-studio.service";
import { CurrentUser, AuthUser, Roles, PermissionArea } from "../common/decorators";
import { TenantGuard } from "../common/tenant.guard";
import { RolesGuard } from "../common/roles.guard";

import { GrowthCopilotService } from "./growth-copilot.service";
import { ApiException, badRequest, notFound } from "../i18n/api-exception";

@PermissionArea("ai")
@Controller("organizations/:organizationId/ai")
@UseGuards(TenantGuard, RolesGuard)
export class AiController {
  constructor(
    private readonly reports: ReportsService,
    private readonly chat: ChatService,
    private readonly tools: ToolsService,
    private readonly proposals: ProposalsService,
    private readonly prompts: PromptsService,
    private readonly mentions: MentionsService,
    private readonly proactive: ProactiveService,
    private readonly creative: CreativeStudioService,
    private readonly vision: VisionService,
    private readonly apiKeys: AssistantApiService,
    private readonly growthCopilot: GrowthCopilotService,
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
    return this.chat.createConversation(orgId, user.userId, dto.title, dto.persona);
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
  sendMessage(@CurrentUser() user: AuthUser, @Param("organizationId") orgId: string, @Param("conversationId") id: string, @Body() dto: SendMessageDto, @Req() req: any) {
    return this.chat.sendMessage(orgId, user.userId, id, dto.content, dto.pageContext, dto.entity, dto.attachment, req?.membership?.role);
  }

  /**
   * AP1 streaming twin of the messages POST (same guards/roles/DTO).
   * SSE frames are `event: <type>\ndata: <json>\n\n`. Exceptions raised
   * before the first stream event (conversation lookup, kill switch,
   * daily cap) are answered as ordinary HTTP errors with their status
   * preserved; once streaming has started, failures arrive as a
   * terminal `error` event. A client disconnect stops the generator
   * (generator.return()), which persists any non-empty partial answer
   * with the stopped marker.
   */
  @Post("chat/conversations/:conversationId/messages/stream")
  async sendMessageStream(@CurrentUser() user: AuthUser, @Param("organizationId") orgId: string, @Param("conversationId") id: string, @Body() dto: SendMessageDto, @Req() req: any, @Res() res: any) {
    const gen = this.chat.sendMessageStream(orgId, user.userId, id, dto.content, dto.pageContext, dto.entity, dto.attachment, (req as any)?.membership?.role);
    let current: IteratorResult<any>;
    try {
      current = await gen.next();
    } catch (e) {
      const status = e instanceof HttpException ? e.getStatus() : (e as any)?.status ?? 500;
      const message = e instanceof Error ? e.message : "Internal server error";
      res.status(status).json({ statusCode: status, message });
      return;
    }
    res.status(200);
    res.setHeader("Content-Type", "text/event-stream");
    res.setHeader("Cache-Control", "no-cache");
    res.setHeader("Connection", "keep-alive");
    if (typeof res.flushHeaders === "function") res.flushHeaders();
    let closed = false;
    req?.on?.("close", () => { closed = true; });
    try {
      while (!current.done) {
        const event = current.value;
        res.write(`event: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`);
        if (closed) { await gen.return(undefined); break; }
        try {
          current = await gen.next();
        } catch (e) {
          const message = e instanceof Error ? e.message : "Internal server error";
          res.write(`event: error\ndata: ${JSON.stringify({ type: "error", message })}\n\n`);
          break;
        }
        if (closed) { await gen.return(undefined); break; }
      }
    } finally {
      res.end();
    }
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

  // AP7: mint a signed one-time approval link for a proposal
  // (e.g. to paste into Telegram). Disabled honestly when the
  // server has no link secret configured.
  @Post("proposals/:proposalId/approval-link") @UseGuards(RolesGuard) @Roles("OWNER", "ADMIN", "MARKETING_MANAGER")
  async approvalLink(@Param("organizationId") orgId: string, @Param("proposalId") proposalId: string, @Req() req: any) {
    const secret = approvalLinkSecret();
    if (!secret) throw badRequest("ai.theApprovalLinkIsNotEnabled");
    const row = await this.proposals.list(orgId);
    if (!(row as any[]).some((r) => r.id === proposalId)) throw notFound("ai.proposalNotFound");
    const { token, expiresAt } = mintApprovalToken(secret, proposalId);
    const proto = (req?.headers?.["x-forwarded-proto"] as string) || req?.protocol || "https";
    const host = req?.headers?.host as string;
    const base = (process.env.APP_PUBLIC_API_URL || `${proto}://${host}`).replace(/\/$/, "");
    return { url: `${base}/assistant-approve/${proposalId}?token=${token}`, expiresAt: new Date(expiresAt).toISOString() };
  }

  @Post("proposals/bulk-approve") @UseGuards(RolesGuard) @Roles("OWNER", "ADMIN", "MARKETING_MANAGER")
  bulkApproveProposals(@CurrentUser() user: AuthUser, @Param("organizationId") orgId: string, @Body() dto: BulkApproveDto, @Req() req: any) {
    return this.proposals.approveMany(orgId, user.userId, dto.ids, (req as any)?.membership?.role);
  }

  @Post("proposals/:proposalId/approve") @UseGuards(RolesGuard) @Roles("OWNER", "ADMIN", "MARKETING_MANAGER")
  approveProposal(@CurrentUser() user: AuthUser, @Param("organizationId") orgId: string, @Param("proposalId") id: string, @Req() req: any) {
    return this.proposals.approve(orgId, user.userId, id, (req as any)?.membership?.role);
  }

  @Post("proposals/:proposalId/reject") @UseGuards(RolesGuard) @Roles("OWNER", "ADMIN", "MARKETING_MANAGER")
  rejectProposal(@CurrentUser() user: AuthUser, @Param("organizationId") orgId: string, @Param("proposalId") id: string) {
    return this.proposals.reject(orgId, user.userId, id);
  }

  // ----- AP2: chat attachment processing (extract / describe) -----
  @Post("chat/attachments")
  @UseInterceptors(FileInterceptor("file", { limits: { fileSize: ATTACHMENT_MAX_BYTES } }))
  async chatAttachment(@CurrentUser() user: AuthUser, @Param("organizationId") orgId: string, @UploadedFile() file: Express.Multer.File) {
    if (!file) throw new ApiException("ai.noFileWasFound", undefined, 400);
    return processChatAttachment(orgId, user.userId, file, this.vision);
  }

  // ----- G6: @-mention entity search -----
  @Get("mentions")
  searchMentions(@CurrentUser() user: AuthUser, @Param("organizationId") orgId: string, @Query("q") q?: string, @Query("type") type?: string) {
    return this.mentions.search(orgId, q ?? "", type);
  }

  // ----- Saved prompts (GV3 / Global Assistant v2 G4) -----
  // Per-user "/" picker library; the service scopes every call to
  // organizationId + userId.
  @Get("prompts")
  listPrompts(@CurrentUser() user: AuthUser, @Param("organizationId") orgId: string) {
    return this.prompts.list(orgId, user.userId);
  }

  @Post("prompts")
  createPrompt(@CurrentUser() user: AuthUser, @Param("organizationId") orgId: string, @Body() dto: CreateSavedPromptDto) {
    return this.prompts.create(orgId, user.userId, dto);
  }

  @Patch("prompts/:promptId")
  updatePrompt(@CurrentUser() user: AuthUser, @Param("organizationId") orgId: string, @Param("promptId") id: string, @Body() dto: UpdateSavedPromptDto) {
    return this.prompts.update(orgId, user.userId, id, dto);
  }

  @Delete("prompts/:promptId")
  deletePrompt(@CurrentUser() user: AuthUser, @Param("organizationId") orgId: string, @Param("promptId") id: string) {
    return this.prompts.remove(orgId, user.userId, id);
  }

  // ----- AP7: Assistant API key management (OWNER/ADMIN) -----
  @Post("api-keys") @UseGuards(RolesGuard) @Roles("OWNER", "ADMIN")
  createApiKey(@CurrentUser() user: AuthUser, @Param("organizationId") orgId: string, @Body() dto: CreateAssistantApiKeyDto) {
    return this.apiKeys.createKey(orgId, user.userId, dto.name);
  }

  @Get("api-keys") @UseGuards(RolesGuard) @Roles("OWNER", "ADMIN")
  listApiKeys(@Param("organizationId") orgId: string) {
    return this.apiKeys.listKeys(orgId);
  }

  @Delete("api-keys/:keyId") @UseGuards(RolesGuard) @Roles("OWNER", "ADMIN")
  revokeApiKey(@Param("organizationId") orgId: string, @Param("keyId") keyId: string) {
    return this.apiKeys.revokeKey(orgId, keyId);
  }

  // ----- AP6: opportunity radar + assistant task inbox -----
  @Get("opportunities")
  opportunities(@Param("organizationId") orgId: string) {
    return this.proactive.computeOpportunityRadar(orgId).then((lines) => ({ lines }));
  }

  @Get("task-inbox")
  taskInbox(@Param("organizationId") orgId: string) {
    return this.proactive.taskInbox(orgId);
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

  // ----- AI Growth Copilot & Ad Optimizer -----
  @Get("growth-copilot")
  @UseGuards(RolesGuard)
  @Roles("OWNER", "ADMIN", "MARKETING_MANAGER", "ANALYST")
  getGrowthCopilotAudit(@Param("organizationId") orgId: string) {
    return this.growthCopilot.runAudit(orgId);
  }

  @Post("growth-copilot/apply-action")
  @UseGuards(RolesGuard)
  @Roles("OWNER", "ADMIN", "MARKETING_MANAGER")
  applyGrowthAction(
    @CurrentUser() user: AuthUser,
    @Param("organizationId") orgId: string,
    @Body() body: { opportunityId: string; actionType: string; payload?: Record<string, any> },
  ) {
    return this.growthCopilot.applyAction(
      orgId,
      user.userId,
      body.opportunityId,
      body.actionType,
      body.payload || {},
    );
  }
}
