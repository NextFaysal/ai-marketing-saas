import { Body, Controller, Delete, Get, Header, MessageEvent, Param, Patch, Post, Put, Query, Sse, StreamableFile, UseGuards } from "@nestjs/common";
import { Observable } from "rxjs";
import { InboxService } from "./inbox.service";
import { RealtimeService } from "./realtime.service";
import { TelegramService } from "./channels/telegram.service";
import { EmailChannelService } from "./channels/email.service";
import { TIKTOK_APPLICATION_PACK } from "./channels/channel-adapter";
import { AddNoteDto, AgentScheduleDto, AgentStateDto, CodConfirmationDto, ConnectEmailDto, ConnectMessagingDto, ConnectTelegramDto, RefundRequestDto, CreateChatOrderDto, QuickReplyDto, SendTemplateDto, SendImageDto, SendMediaDto, SendMessageDto, TeamDto, TeamMembersDto, TranslateMessageDto, UpdateConversationDto, UpdateInboxSettingsDto, UpdateTeamDto, SendDraftDto, UpdateSignatureDto, RebalanceDto, WhatsAppTemplateDto, UpdateWhatsAppWabaDto, SubmitWhatsAppTemplateDto } from "./inbox.dto";
import { BlockConversationDto, BulkConversationsDto, BulkReplyDto, CreateMacroDto, CreateSavedViewDto, GhostDto, LinkCustomerDto, MergeCustomerDto, PinMessageDto, ReactMessageDto, RunMacroDto, SendProductDto, SnoozeConversationDto, ToneRewriteDto, UnmergeCustomerDto, UpdateMacroDto, UpdateSavedViewDto } from "./inbox.dto";
import { CurrentUser, AuthUser, Roles, PermissionArea } from "../common/decorators";
import { TenantGuard } from "../common/tenant.guard";
import { RolesGuard } from "../common/roles.guard";

@PermissionArea("inbox")
@Controller("organizations/:organizationId/inbox")
@UseGuards(TenantGuard, RolesGuard)
export class InboxController {
  constructor(
    private readonly inbox: InboxService,
    private readonly realtime: RealtimeService,
    private readonly telegram: TelegramService,
    private readonly emailChannel: EmailChannelService,
  ) {}

  /** Unified Inbox U1: realtime event stream (SSE) for this org's
   * inbox — new messages, conversation updates, thread presence. */
  @Sse("conversations/stream")
  stream(@Param("organizationId") orgId: string): Observable<MessageEvent> {
    return this.realtime.stream(orgId);
  }

  // ---- Unified Inbox U4: Telegram / Email / TikTok ----
  @Post("connect/telegram") @UseGuards(RolesGuard) @Roles("OWNER", "ADMIN")
  connectTelegram(@CurrentUser() user: AuthUser, @Param("organizationId") orgId: string, @Body() dto: ConnectTelegramDto) {
    return this.telegram.connect(orgId, user.userId, dto);
  }
  @Post("connect/email") @UseGuards(RolesGuard) @Roles("OWNER", "ADMIN")
  connectEmail(@CurrentUser() user: AuthUser, @Param("organizationId") orgId: string, @Body() dto: ConnectEmailDto) {
    return this.emailChannel.connect(orgId, user.userId, dto as any);
  }
  @Post("email/sync") @UseGuards(RolesGuard) @Roles("OWNER", "ADMIN", "MARKETING_MANAGER", "SUPPORT_AGENT")
  syncEmail(@Param("organizationId") orgId: string) {
    return this.emailChannel.syncOrganization(orgId);
  }
  // ---- Unified Inbox U5: control center ----
  @Get("pipeline-board")
  pipelineBoard(@Param("organizationId") orgId: string) {
    return this.inbox.getPipelineBoard(orgId);
  }
  @Get("conversations/:conversationId/command-profile")
  commandProfile(@Param("organizationId") orgId: string, @Param("conversationId") conversationId: string) {
    return this.inbox.getCommandProfile(orgId, conversationId);
  }
  @Post("conversations/:conversationId/share-tracking") @UseGuards(RolesGuard) @Roles("OWNER", "ADMIN", "MARKETING_MANAGER", "SUPPORT_AGENT")
  shareTracking(@CurrentUser() user: AuthUser, @Param("organizationId") orgId: string, @Param("conversationId") conversationId: string) {
    return this.inbox.shareTracking(orgId, user.userId, conversationId);
  }
  @Post("conversations/:conversationId/refund-request") @UseGuards(RolesGuard) @Roles("OWNER", "ADMIN", "MARKETING_MANAGER", "SUPPORT_AGENT")
  refundRequest(@CurrentUser() user: AuthUser, @Param("organizationId") orgId: string, @Param("conversationId") conversationId: string, @Body() dto: RefundRequestDto) {
    return this.inbox.requestRefund(orgId, user.userId, conversationId, dto);
  }

  // ---- Unified Inbox U6: media, export ----
  @Get("media")
  mediaSearch(@Param("organizationId") orgId: string, @Query("type") type?: string, @Query("q") q?: string, @Query("days") days?: string) {
    return this.inbox.searchMedia(orgId, { type, q, days: days ? Number(days) : undefined });
  }
  @Get("export")
  async exportInbox(@CurrentUser() user: AuthUser, @Param("organizationId") orgId: string, @Query("from") from?: string, @Query("to") to?: string) {
    return this.inbox.exportInbox(orgId, { from, to }, user.userId);
  }
  @Get("conversations/:conversationId/export")
  async exportConversation(@CurrentUser() user: AuthUser, @Param("organizationId") orgId: string, @Param("conversationId") conversationId: string, @Query("format") format?: string) {
    const out = await this.inbox.exportConversation(orgId, conversationId, format === "csv" ? "csv" : "json", user.userId);
    return new StreamableFile(Buffer.from(out.body, "utf8"), { type: out.contentType, disposition: `attachment; filename="${out.filename}"` });
  }
  @Get("conversations/:conversationId/messages/:messageId/media-url")
  mediaSignedUrl(@Param("organizationId") orgId: string, @Param("conversationId") conversationId: string, @Param("messageId") messageId: string) {
    return this.inbox.getMediaSignedUrl(orgId, conversationId, messageId);
  }

  @Get("tiktok/status")
  tiktokStatus() { return TIKTOK_APPLICATION_PACK; }

  // ---- Unified Inbox U2: teams + agent state ----
  @Get("teams") teams(@Param("organizationId") orgId: string) { return this.inbox.listTeams(orgId); }
  @Post("teams") @UseGuards(RolesGuard) @Roles("OWNER", "ADMIN")
  createTeam(@CurrentUser() user: AuthUser, @Param("organizationId") orgId: string, @Body() dto: TeamDto) {
    return this.inbox.createTeam(orgId, user.userId, dto);
  }
  @Patch("teams/:teamId") @UseGuards(RolesGuard) @Roles("OWNER", "ADMIN")
  updateTeam(@CurrentUser() user: AuthUser, @Param("organizationId") orgId: string, @Param("teamId") teamId: string, @Body() dto: UpdateTeamDto) {
    return this.inbox.updateTeam(orgId, user.userId, teamId, dto);
  }
  @Delete("teams/:teamId") @UseGuards(RolesGuard) @Roles("OWNER", "ADMIN")
  deleteTeam(@CurrentUser() user: AuthUser, @Param("organizationId") orgId: string, @Param("teamId") teamId: string) {
    return this.inbox.deleteTeam(orgId, user.userId, teamId);
  }
  // Milestone 71: agents may reach this route so a team LEAD can
  // manage their own roster — the service enforces lead/manager.
  @Post("teams/:teamId/members") @UseGuards(RolesGuard) @Roles("OWNER", "ADMIN", "MARKETING_MANAGER", "SUPPORT_AGENT")
  teamMembers(@CurrentUser() user: AuthUser, @Param("organizationId") orgId: string, @Param("teamId") teamId: string, @Body() dto: TeamMembersDto) {
    return this.inbox.setTeamMembers(orgId, user.userId, teamId, dto.members);
  }
  @Get("agent-states") agentStates(@Param("organizationId") orgId: string) { return this.inbox.listAgentStates(orgId); }
  @Post("agent-state") @UseGuards(RolesGuard) @Roles("OWNER", "ADMIN", "MARKETING_MANAGER", "SUPPORT_AGENT")
  agentState(@CurrentUser() user: AuthUser, @Param("organizationId") orgId: string, @Body() dto: AgentStateDto) {
    return this.inbox.setAgentState(orgId, user.userId, dto.status);
  }

  // Milestone 69 (Team W1): presence heartbeat + activity board.
  @Post("presence/heartbeat") @UseGuards(RolesGuard) @Roles("OWNER", "ADMIN", "MARKETING_MANAGER", "ADVERTISER", "SUPPORT_AGENT", "ANALYST", "VIEWER")
  heartbeat(@CurrentUser() user: AuthUser, @Param("organizationId") orgId: string) {
    return this.inbox.heartbeat(orgId, user.userId);
  }
  @Get("team-activity")
  teamActivity(@Param("organizationId") orgId: string, @Query("tz") tz?: string) { return this.inbox.teamActivity(orgId, tz); }

  // Milestone 70 (Team W2): performance scorecard + CSV.
  @Get("team-scorecard")
  teamScorecard(@CurrentUser() user: AuthUser, @Param("organizationId") orgId: string, @Query("days") days?: string, @Query("teamId") teamId?: string) {
    return this.inbox.teamScorecard(orgId, Number(days ?? 7) || 7, { actorId: user.userId, teamId });
  }
  // Milestone 74 (Team T5): workload rebalance.
  @Post("rebalance") @UseGuards(RolesGuard) @Roles("OWNER", "ADMIN", "MARKETING_MANAGER")
  rebalance(@CurrentUser() user: AuthUser, @Param("organizationId") orgId: string, @Body() dto: RebalanceDto) {
    return this.inbox.rebalanceWorkload(orgId, user.userId, { dryRun: Boolean(dto?.dryRun) });
  }

  @Get("team-scorecard.csv") @Header("Content-Type", "text/csv; charset=utf-8") @Header("Content-Disposition", "attachment; filename=team-scorecard.csv")
  async teamScorecardCsv(@CurrentUser() user: AuthUser, @Param("organizationId") orgId: string, @Query("days") days?: string, @Query("teamId") teamId?: string) {
    return this.inbox.teamScorecardCsv(orgId, Number(days ?? 7) || 7, { actorId: user.userId, teamId });
  }

  // Milestone 68 (Team T2): working-hours schedules.
  @Get("agent-schedules") agentSchedules(@Param("organizationId") orgId: string) { return this.inbox.listAgentSchedules(orgId); }
  @Put("agent-schedules/:userId") @UseGuards(RolesGuard) @Roles("OWNER", "ADMIN", "MARKETING_MANAGER", "SUPPORT_AGENT")
  setAgentSchedule(@CurrentUser() user: AuthUser, @Param("organizationId") orgId: string, @Param("userId") userId: string, @Body() dto: AgentScheduleDto) {
    return this.inbox.setAgentSchedule(orgId, user.userId, userId, dto);
  }
  @Delete("agent-schedules/:userId") @UseGuards(RolesGuard) @Roles("OWNER", "ADMIN", "MARKETING_MANAGER", "SUPPORT_AGENT")
  deleteAgentSchedule(@CurrentUser() user: AuthUser, @Param("organizationId") orgId: string, @Param("userId") userId: string) {
    return this.inbox.deleteAgentSchedule(orgId, user.userId, userId);
  }

  @Post("connect") @UseGuards(RolesGuard) @Roles("OWNER", "ADMIN")
  connect(@CurrentUser() user: AuthUser, @Param("organizationId") orgId: string, @Body() dto: ConnectMessagingDto) {
    return this.inbox.connectMessaging(orgId, user.userId, dto);
  }

  // MS6: set/clear the WABA id on the connected WhatsApp integration.
  @Patch("whatsapp-waba") @UseGuards(RolesGuard) @Roles("OWNER", "ADMIN")
  updateWhatsAppWaba(@CurrentUser() user: AuthUser, @Param("organizationId") orgId: string, @Body() dto: UpdateWhatsAppWabaDto) {
    return this.inbox.updateWhatsAppWabaId(orgId, user.userId, dto?.wabaId ?? null);
  }

  @Get("settings")
  settings(@Param("organizationId") orgId: string) { return this.inbox.getSettings(orgId); }

  @Patch("settings") @UseGuards(RolesGuard) @Roles("OWNER", "ADMIN")
  updateSettings(@CurrentUser() user: AuthUser, @Param("organizationId") orgId: string, @Body() dto: UpdateInboxSettingsDto) {
    return this.inbox.updateSettings(orgId, user.userId, dto);
  }

  @Get("team-report")
  teamReport(@CurrentUser() user: AuthUser, @Param("organizationId") orgId: string, @Query("days") days?: string, @Query("teamId") teamId?: string) {
    return this.inbox.getTeamReport(orgId, Math.min(90, Math.max(1, Number(days ?? 7) || 7)), user.userId, teamId);
  }

  @Get("integrations")
  integrations(@Param("organizationId") orgId: string) { return this.inbox.listMessagingIntegrations(orgId); }

  @Get("conversations")
  conversations(
    @CurrentUser() user: AuthUser, @Param("organizationId") orgId: string,
    @Query("status") status?: string, @Query("channel") channel?: string,
    @Query("q") q?: string, @Query("unread") unread?: string, @Query("spam") spam?: string,
    @Query("assignee") assignee?: string, @Query("tag") tag?: string, @Query("sort") sort?: string,
    @Query("folder") folder?: string,
    // IN1b: advanced filters (additive; amounts are MINOR units).
    @Query("dateFrom") dateFrom?: string, @Query("dateTo") dateTo?: string,
    @Query("amountMin") amountMin?: string, @Query("amountMax") amountMax?: string,
    @Query("intent") intent?: string, @Query("sentiment") sentiment?: string,
    // IN9a: cursor pagination is opt-in — the param must be PRESENT
    // ("" = first page) for the { items, nextCursor } envelope;
    // absent keeps the legacy bare-array response untouched.
    @Query("cursor") cursor?: string, @Query("limit") limit?: string,
  ) {
    const num = (v?: string) => (v !== undefined && v !== "" && Number.isFinite(Number(v)) ? Number(v) : undefined);
    return this.inbox.listConversations(orgId, {
      status, channel, q, unreadOnly: unread === "1", spamOnly: spam === "1", assignee, tag, sort, folder,
      dateFrom, dateTo, amountMin: num(amountMin), amountMax: num(amountMax), intent, sentiment,
      ...(cursor !== undefined ? { cursor: cursor === "" ? null : cursor, limit: num(limit) } : {}),
    }, user.userId);
  }

  // IN1a: search INSIDE message text + transcriptions (org-scoped).
  @Get("messages/search")
  searchMessages(@Param("organizationId") orgId: string, @Query("q") q?: string, @Query("limit") limit?: string) {
    return this.inbox.searchMessages(orgId, q ?? "", { limit: limit ? Number(limit) : undefined });
  }

  // IN1c: saved views — own + team-shared; writes are creator-only
  // (the service enforces ownership; roles gate who can write at all).
  @Get("saved-views")
  savedViews(@CurrentUser() user: AuthUser, @Param("organizationId") orgId: string) {
    return this.inbox.listSavedViews(orgId, user.userId);
  }

  @Post("saved-views") @UseGuards(RolesGuard) @Roles("OWNER", "ADMIN", "MARKETING_MANAGER", "SUPPORT_AGENT")
  createSavedView(@CurrentUser() user: AuthUser, @Param("organizationId") orgId: string, @Body() dto: CreateSavedViewDto) {
    return this.inbox.createSavedView(orgId, user.userId, dto);
  }

  @Patch("saved-views/:viewId") @UseGuards(RolesGuard) @Roles("OWNER", "ADMIN", "MARKETING_MANAGER", "SUPPORT_AGENT")
  updateSavedView(@CurrentUser() user: AuthUser, @Param("organizationId") orgId: string, @Param("viewId") viewId: string, @Body() dto: UpdateSavedViewDto) {
    return this.inbox.updateSavedView(orgId, user.userId, viewId, dto);
  }

  @Delete("saved-views/:viewId") @UseGuards(RolesGuard) @Roles("OWNER", "ADMIN", "MARKETING_MANAGER", "SUPPORT_AGENT")
  deleteSavedView(@CurrentUser() user: AuthUser, @Param("organizationId") orgId: string, @Param("viewId") viewId: string) {
    return this.inbox.deleteSavedView(orgId, user.userId, viewId);
  }

  // IN3: macros — own + team-shared; writes are creator-only
  // (the service enforces ownership). Run executes the steps on
  // one conversation through the real action paths and reports
  // per-step results (a failed step stops the run, honestly).
  @Get("macros")
  macros(@CurrentUser() user: AuthUser, @Param("organizationId") orgId: string) {
    return this.inbox.listMacros(orgId, user.userId);
  }

  @Post("macros") @UseGuards(RolesGuard) @Roles("OWNER", "ADMIN", "MARKETING_MANAGER", "SUPPORT_AGENT")
  createMacro(@CurrentUser() user: AuthUser, @Param("organizationId") orgId: string, @Body() dto: CreateMacroDto) {
    return this.inbox.createMacro(orgId, user.userId, dto);
  }

  @Patch("macros/:macroId") @UseGuards(RolesGuard) @Roles("OWNER", "ADMIN", "MARKETING_MANAGER", "SUPPORT_AGENT")
  updateMacro(@CurrentUser() user: AuthUser, @Param("organizationId") orgId: string, @Param("macroId") macroId: string, @Body() dto: UpdateMacroDto) {
    return this.inbox.updateMacro(orgId, user.userId, macroId, dto);
  }

  @Delete("macros/:macroId") @UseGuards(RolesGuard) @Roles("OWNER", "ADMIN", "MARKETING_MANAGER", "SUPPORT_AGENT")
  deleteMacro(@CurrentUser() user: AuthUser, @Param("organizationId") orgId: string, @Param("macroId") macroId: string) {
    return this.inbox.deleteMacro(orgId, user.userId, macroId);
  }

  @Post("macros/:macroId/run") @UseGuards(RolesGuard) @Roles("OWNER", "ADMIN", "MARKETING_MANAGER", "SUPPORT_AGENT")
  runMacro(@CurrentUser() user: AuthUser, @Param("organizationId") orgId: string, @Param("macroId") macroId: string, @Body() dto: RunMacroDto) {
    return this.inbox.runMacro(orgId, user.userId, macroId, dto.conversationId);
  }

  // IN3c: bulk reply — one quick reply / template to many
  // conversations, per-item honest results.
  @Post("conversations/bulk-reply") @UseGuards(RolesGuard) @Roles("OWNER", "ADMIN", "MARKETING_MANAGER", "SUPPORT_AGENT")
  bulkReply(@CurrentUser() user: AuthUser, @Param("organizationId") orgId: string, @Body() dto: BulkReplyDto) {
    return this.inbox.bulkReplyConversations(orgId, user.userId, dto);
  }

  // Inbox Next-Gen P2: smart-folder counts (server-side; the list
  // itself is capped at 100 rows). Declared BEFORE
  // conversations/:conversationId so "counts" is not read as an id.
  @Get("conversations/counts")
  conversationCounts(@CurrentUser() user: AuthUser, @Param("organizationId") orgId: string) {
    return this.inbox.conversationFolderCounts(orgId, user.userId);
  }

  // Inbox Next-Gen P2: one bulk endpoint (close / assign / tag-add
  // / mark-read) with per-item results — no client-side PATCH loop.
  @Post("conversations/bulk") @UseGuards(RolesGuard) @Roles("OWNER", "ADMIN", "MARKETING_MANAGER", "SUPPORT_AGENT")
  bulkConversations(@CurrentUser() user: AuthUser, @Param("organizationId") orgId: string, @Body() dto: BulkConversationsDto) {
    return this.inbox.bulkUpdateConversations(orgId, user.userId, dto);
  }

  // ----- Quick replies -----
  @Get("quick-replies")
  quickReplies(@Param("organizationId") orgId: string) { return this.inbox.listQuickReplies(orgId); }

  @Post("quick-replies") @UseGuards(RolesGuard) @Roles("OWNER", "ADMIN", "MARKETING_MANAGER")
  createQuickReply(@CurrentUser() user: AuthUser, @Param("organizationId") orgId: string, @Body() dto: QuickReplyDto) {
    return this.inbox.createQuickReply(orgId, user.userId, dto);
  }

  @Delete("quick-replies/:quickReplyId") @UseGuards(RolesGuard) @Roles("OWNER", "ADMIN")
  deleteQuickReply(@Param("organizationId") orgId: string, @Param("quickReplyId") id: string) {
    return this.inbox.deleteQuickReply(orgId, id);
  }

  // ----- WhatsApp template registry -----
  @Get("whatsapp-templates")
  templates(@Param("organizationId") orgId: string) { return this.inbox.listWhatsAppTemplates(orgId); }

  @Post("whatsapp-templates") @UseGuards(RolesGuard) @Roles("OWNER", "ADMIN")
  createTemplate(@Param("organizationId") orgId: string, @Body() dto: WhatsAppTemplateDto) {
    return this.inbox.createWhatsAppTemplate(orgId, dto);
  }

  // MS6: literal routes declared before the :templateId delete so
  // "sync"/"submit" are never read as template ids.
  @Post("whatsapp-templates/sync") @UseGuards(RolesGuard) @Roles("OWNER", "ADMIN")
  syncTemplates(@CurrentUser() user: AuthUser, @Param("organizationId") orgId: string) {
    return this.inbox.syncWhatsAppTemplates(orgId, user.userId);
  }

  @Post("whatsapp-templates/submit") @UseGuards(RolesGuard) @Roles("OWNER", "ADMIN")
  submitTemplate(@CurrentUser() user: AuthUser, @Param("organizationId") orgId: string, @Body() dto: SubmitWhatsAppTemplateDto) {
    return this.inbox.submitWhatsAppTemplate(orgId, user.userId, dto);
  }

  @Delete("whatsapp-templates/:templateId") @UseGuards(RolesGuard) @Roles("OWNER", "ADMIN")
  deleteTemplate(@Param("organizationId") orgId: string, @Param("templateId") id: string) {
    return this.inbox.deleteWhatsAppTemplate(orgId, id);
  }

  @Get("conversations/:conversationId")
  conversation(@CurrentUser() user: AuthUser, @Param("organizationId") orgId: string, @Param("conversationId") id: string) {
    return this.inbox.getConversation(orgId, id, user.userId);
  }

  /** IN10c: Inbox Analytics v2 — compute-on-read over real rows
   * (heatmap / channel conversion / response trend / intents). */
  @Get("analytics")
  analytics(@Param("organizationId") orgId: string, @Query("days") days?: string) {
    return this.inbox.getInboxAnalytics(orgId, Math.min(90, Math.max(1, Number(days ?? 7) || 7)));
  }

  /** IN10b: this conversation's audit trail (who viewed/exported/
   * acted) — leads and managers only, it is an oversight view. */
  @Get("conversations/:conversationId/audit") @UseGuards(RolesGuard) @Roles("OWNER", "ADMIN", "MARKETING_MANAGER")
  conversationAudit(@Param("organizationId") orgId: string, @Param("conversationId") id: string) {
    return this.inbox.listConversationAudit(orgId, id);
  }

  /** IN2: merge two customer records from this conversation
   * (agent-confirmed, reversible — CustomersService does the
   * work; the service ties one side to this thread). */
  @Post("conversations/:conversationId/merge-customer") @UseGuards(RolesGuard) @Roles("OWNER", "ADMIN", "MARKETING_MANAGER", "SUPPORT_AGENT")
  mergeCustomer(@CurrentUser() user: AuthUser, @Param("organizationId") orgId: string, @Param("conversationId") id: string, @Body() dto: MergeCustomerDto) {
    return this.inbox.mergeCustomerFromConversation(orgId, user.userId, id, dto);
  }

  /** IN2: undo a merge from the survivor's conversation. */
  @Post("conversations/:conversationId/unmerge-customer") @UseGuards(RolesGuard) @Roles("OWNER", "ADMIN", "MARKETING_MANAGER", "SUPPORT_AGENT")
  unmergeCustomer(@CurrentUser() user: AuthUser, @Param("organizationId") orgId: string, @Param("conversationId") id: string, @Body() dto: UnmergeCustomerDto) {
    return this.inbox.unmergeCustomerFromConversation(orgId, user.userId, id, dto);
  }

  /** IN2: link an unlinked conversation to an existing customer. */
  @Post("conversations/:conversationId/link-customer") @UseGuards(RolesGuard) @Roles("OWNER", "ADMIN", "MARKETING_MANAGER", "SUPPORT_AGENT")
  linkCustomer(@CurrentUser() user: AuthUser, @Param("organizationId") orgId: string, @Param("conversationId") id: string, @Body() dto: LinkCustomerDto) {
    return this.inbox.linkConversationCustomer(orgId, user.userId, id, dto);
  }

  /** IN10a: block/unblock this conversation's customer — OUR
   * system-level block only; the platform is never involved. */
  @Post("conversations/:conversationId/block") @UseGuards(RolesGuard) @Roles("OWNER", "ADMIN", "MARKETING_MANAGER", "SUPPORT_AGENT")
  blockConversation(@CurrentUser() user: AuthUser, @Param("organizationId") orgId: string, @Param("conversationId") id: string, @Body() dto: BlockConversationDto) {
    return this.inbox.setConversationBlocked(orgId, user.userId, id, dto);
  }

  @Post("conversations/:conversationId/orders") @UseGuards(RolesGuard) @Roles("OWNER", "ADMIN", "MARKETING_MANAGER", "SUPPORT_AGENT")
  createOrder(@CurrentUser() user: AuthUser, @Param("organizationId") orgId: string, @Param("conversationId") id: string, @Body() dto: CreateChatOrderDto) {
    return this.inbox.createChatOrder(orgId, user.userId, id, dto);
  }

  @Post("conversations/:conversationId/messages/:messageId/translate") @UseGuards(RolesGuard) @Roles("OWNER", "ADMIN", "MARKETING_MANAGER", "SUPPORT_AGENT")
  translate(@Param("organizationId") orgId: string, @Param("conversationId") id: string, @Param("messageId") messageId: string, @Body() dto: TranslateMessageDto) {
    return this.inbox.translateMessage(orgId, id, messageId, dto.target);
  }

  @Post("conversations/:conversationId/summary") @UseGuards(RolesGuard) @Roles("OWNER", "ADMIN", "MARKETING_MANAGER", "SUPPORT_AGENT")
  summarize(@CurrentUser() user: AuthUser, @Param("organizationId") orgId: string, @Param("conversationId") id: string) {
    return this.inbox.summarizeConversation(orgId, user.userId, id);
  }

  /** IN7b/c: AI suggested next action + tag/stage proposals.
   * Suggestion-only — this endpoint sends nothing and writes
   * nothing; accepting a proposal goes through the normal
   * PATCH conversation path. */
  @Post("conversations/:conversationId/next-action") @UseGuards(RolesGuard) @Roles("OWNER", "ADMIN", "MARKETING_MANAGER", "SUPPORT_AGENT")
  nextAction(@CurrentUser() user: AuthUser, @Param("organizationId") orgId: string, @Param("conversationId") id: string) {
    return this.inbox.suggestNextAction(orgId, user.userId, id);
  }

  @Post("conversations/:conversationId/messages/:messageId/verify-payment") @UseGuards(RolesGuard) @Roles("OWNER", "ADMIN", "MARKETING_MANAGER", "SUPPORT_AGENT")
  verifyPayment(@CurrentUser() user: AuthUser, @Param("organizationId") orgId: string, @Param("conversationId") id: string, @Param("messageId") messageId: string) {
    return this.inbox.verifyPaymentScreenshot(orgId, user.userId, id, messageId);
  }

  @Get("conversations/:conversationId/payment-verifications")
  paymentVerifications(@Param("organizationId") orgId: string, @Param("conversationId") id: string) {
    return this.inbox.listPaymentVerifications(orgId, id);
  }

  @Post("conversations/:conversationId/messages/:messageId/transcribe") @UseGuards(RolesGuard) @Roles("OWNER", "ADMIN", "MARKETING_MANAGER", "SUPPORT_AGENT")
  transcribe(@Param("organizationId") orgId: string, @Param("conversationId") id: string, @Param("messageId") messageId: string) {
    return this.inbox.transcribeMessage(orgId, id, messageId);
  }

  @Post("conversations/:conversationId/presence") @UseGuards(RolesGuard) @Roles("OWNER", "ADMIN", "MARKETING_MANAGER", "SUPPORT_AGENT")
  presence(@CurrentUser() user: AuthUser, @Param("organizationId") orgId: string, @Param("conversationId") id: string, @Body() body: { typing?: boolean }) {
    return this.inbox.heartbeatPresence(orgId, user.userId, id, Boolean(body?.typing));
  }

  @Get("notifications")
  notifications(@CurrentUser() user: AuthUser, @Param("organizationId") orgId: string) {
    return this.inbox.listNotifications(orgId, user.userId);
  }

  @Get("notifications/unread-count")
  unreadCount(@CurrentUser() user: AuthUser, @Param("organizationId") orgId: string) {
    return this.inbox.unreadNotificationCount(orgId, user.userId);
  }

  @Post("notifications/:notificationId/read") @UseGuards(RolesGuard) @Roles("OWNER", "ADMIN", "MARKETING_MANAGER", "SUPPORT_AGENT")
  markRead(@CurrentUser() user: AuthUser, @Param("organizationId") orgId: string, @Param("notificationId") nid: string) {
    return this.inbox.markNotificationRead(orgId, user.userId, nid);
  }

  @Post("conversations/:conversationId/bot/stop") @UseGuards(RolesGuard) @Roles("OWNER", "ADMIN", "MARKETING_MANAGER", "SUPPORT_AGENT")
  stopBot(@CurrentUser() user: AuthUser, @Param("organizationId") orgId: string, @Param("conversationId") id: string) {
    return this.inbox.stopBot(orgId, user.userId, id);
  }

  @Post("conversations/:conversationId/cod-confirmation") @UseGuards(RolesGuard) @Roles("OWNER", "ADMIN", "MARKETING_MANAGER", "SUPPORT_AGENT")
  codConfirmation(@CurrentUser() user: AuthUser, @Param("organizationId") orgId: string, @Param("conversationId") id: string, @Body() dto: CodConfirmationDto) {
    return this.inbox.requestCodConfirmation(orgId, user.userId, id, dto.orderId);
  }

  @Get("conversations/:conversationId/notes")
  notes(@Param("organizationId") orgId: string, @Param("conversationId") id: string) {
    return this.inbox.listNotes(orgId, id);
  }

  @Post("conversations/:conversationId/notes") @UseGuards(RolesGuard) @Roles("OWNER", "ADMIN", "MARKETING_MANAGER", "SUPPORT_AGENT")
  addNote(@CurrentUser() user: AuthUser, @Param("organizationId") orgId: string, @Param("conversationId") id: string, @Body() dto: AddNoteDto) {
    return this.inbox.addNote(orgId, user.userId, id, dto.content, { maskSensitive: Boolean(dto.maskSensitive) });
  }

  @Post("conversations/:conversationId/send-template") @UseGuards(RolesGuard) @Roles("OWNER", "ADMIN", "MARKETING_MANAGER", "SUPPORT_AGENT")
  sendTemplate(@CurrentUser() user: AuthUser, @Param("organizationId") orgId: string, @Param("conversationId") id: string, @Body() dto: SendTemplateDto) {
    return this.inbox.sendTemplate(orgId, user.userId, id, dto.templateId, dto.variables ?? []);
  }

  @Post("conversations/:conversationId/messages/image") @UseGuards(RolesGuard) @Roles("OWNER", "ADMIN", "MARKETING_MANAGER", "SUPPORT_AGENT")
  sendImage(@CurrentUser() user: AuthUser, @Param("organizationId") orgId: string, @Param("conversationId") id: string, @Body() dto: SendImageDto) {
    return this.inbox.sendImageReply(orgId, user.userId, id, dto.imageUrl, dto.caption);
  }

  /** Inbox Next-Gen P1: uploaded media (drag-drop / paste / voice). */
  @Post("conversations/:conversationId/messages/media") @UseGuards(RolesGuard) @Roles("OWNER", "ADMIN", "MARKETING_MANAGER", "SUPPORT_AGENT")
  sendMedia(@CurrentUser() user: AuthUser, @Param("organizationId") orgId: string, @Param("conversationId") id: string, @Body() dto: SendMediaDto) {
    return this.inbox.sendMediaReply(orgId, user.userId, id, dto);
  }

  /** Inbox Next-Gen P2: product showcase card (image + composed
   * caption via the P1 media path; honest text fallback). */
  @Post("conversations/:conversationId/messages/product") @UseGuards(RolesGuard) @Roles("OWNER", "ADMIN", "MARKETING_MANAGER", "SUPPORT_AGENT")
  sendProduct(@CurrentUser() user: AuthUser, @Param("organizationId") orgId: string, @Param("conversationId") id: string, @Body() dto: SendProductDto) {
    return this.inbox.sendProductCard(orgId, user.userId, id, dto);
  }

  @Get("conversations/:conversationId/messages/:messageId/media")
  async media(@Param("organizationId") orgId: string, @Param("conversationId") convId: string, @Param("messageId") messageId: string) {
    const { bytes, contentType } = await this.inbox.getMessageMedia(orgId, convId, messageId);
    return new StreamableFile(bytes, { type: contentType, disposition: "inline" });
  }

  @Post("conversations/:conversationId/read") @UseGuards(RolesGuard) @Roles("OWNER", "ADMIN", "MARKETING_MANAGER", "SUPPORT_AGENT")
  read(@Param("organizationId") orgId: string, @Param("conversationId") id: string) { return this.inbox.markRead(orgId, id); }

  @Patch("conversations/:conversationId") @UseGuards(RolesGuard) @Roles("OWNER", "ADMIN", "MARKETING_MANAGER", "SUPPORT_AGENT")
  update(@CurrentUser() user: AuthUser, @Param("organizationId") orgId: string, @Param("conversationId") id: string, @Body() dto: UpdateConversationDto) {
    return this.inbox.updateConversation(orgId, user.userId, id, dto);
  }

  // CX5: one-row action bar actions — snooze / wake, manual
  // take-over, hand back to the AI.
  @Post("conversations/:conversationId/snooze") @UseGuards(RolesGuard) @Roles("OWNER", "ADMIN", "MARKETING_MANAGER", "SUPPORT_AGENT")
  snooze(@CurrentUser() user: AuthUser, @Param("organizationId") orgId: string, @Param("conversationId") id: string, @Body() dto: SnoozeConversationDto) {
    return this.inbox.snoozeConversation(orgId, user.userId, id, dto);
  }

  @Post("conversations/:conversationId/unsnooze") @UseGuards(RolesGuard) @Roles("OWNER", "ADMIN", "MARKETING_MANAGER", "SUPPORT_AGENT")
  unsnooze(@CurrentUser() user: AuthUser, @Param("organizationId") orgId: string, @Param("conversationId") id: string) {
    return this.inbox.unsnoozeConversation(orgId, user.userId, id);
  }

  @Post("conversations/:conversationId/take-over") @UseGuards(RolesGuard) @Roles("OWNER", "ADMIN", "MARKETING_MANAGER", "SUPPORT_AGENT")
  takeOver(@CurrentUser() user: AuthUser, @Param("organizationId") orgId: string, @Param("conversationId") id: string) {
    return this.inbox.takeOverConversation(orgId, user.userId, id);
  }

  @Post("conversations/:conversationId/back-to-ai") @UseGuards(RolesGuard) @Roles("OWNER", "ADMIN", "MARKETING_MANAGER", "SUPPORT_AGENT")
  backToAi(@CurrentUser() user: AuthUser, @Param("organizationId") orgId: string, @Param("conversationId") id: string) {
    return this.inbox.backToAiConversation(orgId, user.userId, id);
  }

  @Post("conversations/:conversationId/messages") @UseGuards(RolesGuard) @Roles("OWNER", "ADMIN", "MARKETING_MANAGER", "SUPPORT_AGENT")
  send(@CurrentUser() user: AuthUser, @Param("organizationId") orgId: string, @Param("conversationId") id: string, @Body() dto: SendMessageDto) {
    return this.inbox.sendReply(orgId, user.userId, id, dto.content, { signature: true, aiAssisted: dto.aiAssisted, quickReplyId: dto.quickReplyId, replyToMessageId: dto.replyToMessageId });
  }

  /** IN6d: pin/unpin — DB feature, org-scoped + audited in service. */
  @Post("conversations/:conversationId/messages/:messageId/pin") @UseGuards(RolesGuard) @Roles("OWNER", "ADMIN", "MARKETING_MANAGER", "SUPPORT_AGENT")
  pinMessage(@CurrentUser() user: AuthUser, @Param("organizationId") orgId: string, @Param("conversationId") conversationId: string, @Param("messageId") messageId: string, @Body() dto: PinMessageDto) {
    return this.inbox.setMessagePinned(orgId, user.userId, conversationId, messageId, Boolean(dto.pinned));
  }

  /** IN6c: agent reaction — real Meta send on Messenger/IG only;
   * the service refuses other channels honestly. */
  @Post("conversations/:conversationId/messages/:messageId/react") @UseGuards(RolesGuard) @Roles("OWNER", "ADMIN", "MARKETING_MANAGER", "SUPPORT_AGENT")
  reactMessage(@CurrentUser() user: AuthUser, @Param("organizationId") orgId: string, @Param("conversationId") conversationId: string, @Param("messageId") messageId: string, @Body() dto: ReactMessageDto) {
    return this.inbox.reactToMessage(orgId, user.userId, conversationId, messageId, dto.emoji ?? null);
  }

  // Milestone 73 (Team T4): agent self-service.
  @Get("my-performance")
  myPerformance(@CurrentUser() user: AuthUser, @Param("organizationId") orgId: string, @Query("days") days?: string) {
    return this.inbox.myPerformance(orgId, user.userId, Math.min(90, Math.max(1, Number(days ?? 7) || 7)));
  }

  @Get("my-signature")
  mySignature(@CurrentUser() user: AuthUser, @Param("organizationId") orgId: string) {
    return this.inbox.getMySignature(orgId, user.userId);
  }

  @Put("my-signature")
  updateMySignature(@CurrentUser() user: AuthUser, @Param("organizationId") orgId: string, @Body() dto: UpdateSignatureDto) {
    return this.inbox.updateMySignature(orgId, user.userId, dto);
  }

  @Post("conversations/:conversationId/drafts/suggest") @UseGuards(RolesGuard) @Roles("OWNER", "ADMIN", "MARKETING_MANAGER", "SUPPORT_AGENT")
  suggestDraft(@CurrentUser() user: AuthUser, @Param("organizationId") orgId: string, @Param("conversationId") id: string) {
    return this.inbox.suggestDraft(orgId, user.userId, id);
  }

  /** Inbox Next-Gen P3: ghost completion (inline autocomplete for
   * the composer; empty completion = nothing to suggest). */
  @Post("conversations/:conversationId/ghost") @UseGuards(RolesGuard) @Roles("OWNER", "ADMIN", "MARKETING_MANAGER", "SUPPORT_AGENT")
  ghost(@CurrentUser() user: AuthUser, @Param("organizationId") orgId: string, @Param("conversationId") id: string, @Body() dto: GhostDto) {
    return this.inbox.ghostComplete(orgId, user.userId, id, dto.partial);
  }

  /** Inbox Next-Gen P3: tone rewrite of the agent's own draft. */
  @Post("conversations/:conversationId/tone-rewrite") @UseGuards(RolesGuard) @Roles("OWNER", "ADMIN", "MARKETING_MANAGER", "SUPPORT_AGENT")
  toneRewrite(@CurrentUser() user: AuthUser, @Param("organizationId") orgId: string, @Param("conversationId") id: string, @Body() dto: ToneRewriteDto) {
    return this.inbox.toneRewrite(orgId, user.userId, id, dto.text, dto.tone);
  }

  @Post("conversations/:conversationId/drafts/:draftId/send") @UseGuards(RolesGuard) @Roles("OWNER", "ADMIN", "MARKETING_MANAGER", "SUPPORT_AGENT")
  sendDraft(@CurrentUser() user: AuthUser, @Param("organizationId") orgId: string, @Param("conversationId") id: string, @Param("draftId") draftId: string, @Body() dto: SendDraftDto) {
    return this.inbox.sendDraft(orgId, user.userId, id, draftId, dto.content);
  }

  @Post("conversations/:conversationId/drafts/:draftId/dismiss") @UseGuards(RolesGuard) @Roles("OWNER", "ADMIN", "MARKETING_MANAGER", "SUPPORT_AGENT")
  dismissDraft(@Param("organizationId") orgId: string, @Param("conversationId") id: string, @Param("draftId") draftId: string) {
    return this.inbox.dismissDraft(orgId, id, draftId);
  }

  // CX7: To Chase sweep endpoint
  @Post("chase/sweep") @UseGuards(RolesGuard) @Roles("OWNER", "ADMIN")
  chaseSweep(@Param("organizationId") orgId: string) {
    return this.inbox.runChaseSweep(orgId);
  }
}

