import { Body, Controller, Get, Param, Patch, Post, Query, UseGuards } from "@nestjs/common";
import { SocialCommentsService } from "./social-comments.service";
import { 
  ListCommentsQueryDto, 
  ReplyCommentDto, 
  GenerateAiReplyDto, 
  UpdateReplySettingsDto, 
  IngestExternalCommentDto,
  BulkActionDto,
} from "./social-comments.dto";
import { CurrentUser, AuthUser, Roles } from "../common/decorators";
import { TenantGuard } from "../common/tenant.guard";
import { RolesGuard } from "../common/roles.guard";

@Controller("organizations/:organizationId/social-comments")
@UseGuards(TenantGuard)
export class SocialCommentsController {
  constructor(private readonly service: SocialCommentsService) {}

  @Get("settings")
  getSettings(@Param("organizationId") orgId: string) {
    return this.service.getSettings(orgId);
  }

  @Patch("settings")
  @UseGuards(RolesGuard)
  @Roles("OWNER", "ADMIN", "MARKETING_MANAGER")
  updateSettings(
    @CurrentUser() user: AuthUser,
    @Param("organizationId") orgId: string,
    @Body() dto: UpdateReplySettingsDto,
  ) {
    return this.service.updateSettings(orgId, user.userId, dto);
  }

  @Get()
  list(@Param("organizationId") orgId: string, @Query() query: ListCommentsQueryDto) {
    return this.service.listComments(orgId, query);
  }

  @Post("seed-demo")
  seedDemo(@Param("organizationId") orgId: string) {
    return this.service.seedDemoFeedIfEmpty(orgId);
  }

  @Post("ingest")
  @UseGuards(RolesGuard)
  @Roles("OWNER", "ADMIN", "MARKETING_MANAGER", "SUPPORT_AGENT")
  ingest(
    @Param("organizationId") orgId: string,
    @Body() dto: IngestExternalCommentDto,
  ) {
    return this.service.ingestComment(orgId, dto);
  }

  @Post(":commentId/suggest-ai")
  suggestAi(
    @Param("organizationId") orgId: string,
    @Param("commentId") commentId: string,
    @Body() dto: GenerateAiReplyDto,
  ) {
    return this.service.generateAiSuggestion(orgId, commentId, dto);
  }

  @Post(":commentId/reply")
  @UseGuards(RolesGuard)
  @Roles("OWNER", "ADMIN", "MARKETING_MANAGER", "SUPPORT_AGENT")
  reply(
    @CurrentUser() user: AuthUser,
    @Param("organizationId") orgId: string,
    @Param("commentId") commentId: string,
    @Body() dto: ReplyCommentDto,
  ) {
    return this.service.sendReply(orgId, user.userId, commentId, dto);
  }

  @Patch(":commentId/status")
  @UseGuards(RolesGuard)
  @Roles("OWNER", "ADMIN", "MARKETING_MANAGER", "SUPPORT_AGENT")
  updateStatus(
    @Param("organizationId") orgId: string,
    @Param("commentId") commentId: string,
    @Body("status") status: "PENDING" | "HIDDEN" | "ESCALATED",
  ) {
    return this.service.updateCommentStatus(orgId, commentId, status);
  }

  @Post("bulk-action")
  @UseGuards(RolesGuard)
  @Roles("OWNER", "ADMIN", "MARKETING_MANAGER", "SUPPORT_AGENT")
  bulkAction(
    @CurrentUser() user: AuthUser,
    @Param("organizationId") orgId: string,
    @Body() dto: BulkActionDto,
  ) {
    return this.service.executeBulkAction(orgId, user.userId, dto.commentIds, dto.action);
  }
}
