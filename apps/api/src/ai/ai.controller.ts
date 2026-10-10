import { Body, Controller, Get, Param, Patch, Post, Query, UseGuards } from "@nestjs/common";
import { ReportsService, ReportType, ReportLanguage } from "./reports.service";
import { ChatService } from "./chat.service";
import { ToolsService } from "./tools.service";
import { GenerateReportDto, CreateConversationDto, SendMessageDto, UpdateRecommendationDto } from "./ai.dto";
import { CurrentUser, AuthUser, Roles } from "../common/decorators";
import { TenantGuard } from "../common/tenant.guard";
import { RolesGuard } from "../common/roles.guard";

@Controller("organizations/:organizationId/ai")
@UseGuards(TenantGuard)
export class AiController {
  constructor(
    private readonly reports: ReportsService,
    private readonly chat: ChatService,
    private readonly tools: ToolsService,
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
  listConversations(@CurrentUser() user: AuthUser, @Param("organizationId") orgId: string) {
    return this.chat.listConversations(orgId, user.userId);
  }

  @Get("chat/conversations/:conversationId/messages")
  listMessages(@CurrentUser() user: AuthUser, @Param("organizationId") orgId: string, @Param("conversationId") id: string) {
    return this.chat.listMessages(orgId, user.userId, id);
  }

  @Post("chat/conversations/:conversationId/messages")
  sendMessage(@CurrentUser() user: AuthUser, @Param("organizationId") orgId: string, @Param("conversationId") id: string, @Body() dto: SendMessageDto) {
    return this.chat.sendMessage(orgId, user.userId, id, dto.content);
  }
}
