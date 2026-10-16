import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Post,
  Query,
  Req,
  Res,
  Sse,
  MessageEvent,
  StreamableFile,
  UseGuards,
} from "@nestjs/common";
import { Observable } from "rxjs";
import type { Response } from "express";
import { SupportService } from "./support.service";
import { TenantGuard } from "../common/tenant.guard";
import { RolesGuard } from "../common/roles.guard";
import { SuperAdminGuard, AdminTier } from "../common/super-admin.guard";
import { CurrentUser, Roles, type AuthUser } from "../common/decorators";
import {
  AdminTicketUpdateDto,
  CannedResponseDto,
  CreateTicketDto,
  CsatDto,
  InternalNoteDto,
  ReplyDto,
  SuggestSolutionsDto,
  TenantStatusDto,
  UploadAttachmentDto,
} from "./support.dto";

@Controller("organizations")
@UseGuards(TenantGuard, RolesGuard)
export class TenantSupportController {
  constructor(private readonly support: SupportService) {}

  @Post(":organizationId/tickets")
  @Roles("OWNER", "ADMIN", "MARKETING_MANAGER", "ADVERTISER", "SUPPORT_AGENT", "ANALYST", "VIEWER")
  create(@CurrentUser() user: AuthUser, @Param("organizationId") id: string, @Body() dto: CreateTicketDto) {
    return this.support.createTicket(id, user.userId, dto);
  }

  @Get(":organizationId/tickets")
  @Roles("OWNER", "ADMIN", "MARKETING_MANAGER", "ADVERTISER", "SUPPORT_AGENT", "ANALYST", "VIEWER")
  list(@Param("organizationId") id: string) {
    return this.support.listTickets(id);
  }

  @Get(":organizationId/tickets/:ticketId")
  @Roles("OWNER", "ADMIN", "MARKETING_MANAGER", "ADVERTISER", "SUPPORT_AGENT", "ANALYST", "VIEWER")
  get(@Param("organizationId") id: string, @Param("ticketId") ticketId: string) {
    return this.support.getTicket(id, ticketId);
  }

  @Post(":organizationId/tickets/:ticketId/messages")
  @Roles("OWNER", "ADMIN", "MARKETING_MANAGER", "ADVERTISER", "SUPPORT_AGENT", "ANALYST", "VIEWER")
  reply(
    @CurrentUser() user: AuthUser,
    @Param("organizationId") id: string,
    @Param("ticketId") ticketId: string,
    @Body() dto: ReplyDto,
  ) {
    return this.support.replyAsTenant(id, user.userId, ticketId, dto);
  }

  @Post(":organizationId/tickets/:ticketId/status")
  @Roles("OWNER", "ADMIN", "MARKETING_MANAGER", "ADVERTISER", "SUPPORT_AGENT", "ANALYST", "VIEWER")
  status(@Param("organizationId") id: string, @Param("ticketId") ticketId: string, @Body() dto: TenantStatusDto) {
    return this.support.setTenantStatus(id, ticketId, dto.status);
  }

  @Post(":organizationId/tickets/:ticketId/csat")
  @Roles("OWNER", "ADMIN", "MARKETING_MANAGER", "ADVERTISER", "SUPPORT_AGENT", "ANALYST", "VIEWER")
  csat(
    @CurrentUser() user: AuthUser,
    @Param("organizationId") id: string,
    @Param("ticketId") ticketId: string,
    @Body() dto: CsatDto,
  ) {
    return this.support.submitCsat(id, user.userId, ticketId, dto);
  }

  @Post(":organizationId/tickets/upload")
  @Roles("OWNER", "ADMIN", "MARKETING_MANAGER", "ADVERTISER", "SUPPORT_AGENT", "ANALYST", "VIEWER")
  upload(
    @CurrentUser() user: AuthUser,
    @Param("organizationId") id: string,
    @Body() dto: UploadAttachmentDto,
  ) {
    return this.support.uploadAttachment(id, user.userId, dto);
  }

  @Get(":organizationId/tickets/attachments/:fileId")
  @Roles("OWNER", "ADMIN", "MARKETING_MANAGER", "ADVERTISER", "SUPPORT_AGENT", "ANALYST", "VIEWER")
  async getAttachment(
    @Param("organizationId") id: string,
    @Param("fileId") fileId: string,
    @Res({ passthrough: true }) res: Response,
  ) {
    const { buffer, contentType } = await this.support.getAttachmentFile(id, fileId);
    res.setHeader("Content-Type", contentType);
    res.setHeader("Content-Disposition", "inline");
    return new StreamableFile(buffer);
  }

  @Post(":organizationId/tickets/suggest-solutions")
  @Roles("OWNER", "ADMIN", "MARKETING_MANAGER", "ADVERTISER", "SUPPORT_AGENT", "ANALYST", "VIEWER")
  suggest(@Param("organizationId") id: string, @Body() dto: SuggestSolutionsDto) {
    return this.support.suggestSolutions(id, dto);
  }

  @Sse(":organizationId/tickets/:ticketId/stream")
  @Roles("OWNER", "ADMIN", "MARKETING_MANAGER", "ADVERTISER", "SUPPORT_AGENT", "ANALYST", "VIEWER")
  stream(
    @Param("organizationId") orgId: string,
    @Param("ticketId") ticketId: string,
  ): Promise<Observable<MessageEvent>> {
    return this.support.getTicketStream(orgId, ticketId, false);
  }

  @Post(":organizationId/tickets/:ticketId/typing")
  @Roles("OWNER", "ADMIN", "MARKETING_MANAGER", "ADVERTISER", "SUPPORT_AGENT", "ANALYST", "VIEWER")
  typing(
    @Param("ticketId") ticketId: string,
    @Body("isTyping") isTyping: boolean,
  ) {
    this.support.emitTyping(ticketId, "tenant", Boolean(isTyping));
    return { ok: true };
  }
}

@Controller("admin/tickets")
@UseGuards(SuperAdminGuard)
export class AdminSupportController {
  constructor(private readonly support: SupportService) {}

  @Get()
  list(
    @Query("status") status?: string,
    @Query("organizationId") organizationId?: string,
    @Query("category") category?: string,
    @Query("priority") priority?: string,
    @Query("sla") sla?: string,
  ) {
    return this.support.listTicketsAdmin({
      status,
      organizationId,
      category,
      priority,
      slaBreached: sla === "breached" ? true : undefined,
    });
  }

  @Get("analytics/metrics")
  analytics() {
    return this.support.getSupportAnalytics();
  }

  // Canned Responses
  @Get("canned/all")
  listCanned() {
    return this.support.listCannedResponses();
  }

  @Post("canned")
  @AdminTier("SUPER", "SUPPORT")
  createCanned(@Req() req: any, @Body() dto: CannedResponseDto) {
    return this.support.createCannedResponse(req.adminUser, dto);
  }

  @Patch("canned/:cannedId")
  @AdminTier("SUPER", "SUPPORT")
  updateCanned(@Param("cannedId") cannedId: string, @Body() dto: Partial<CannedResponseDto>) {
    return this.support.updateCannedResponse(cannedId, dto);
  }

  @Delete("canned/:cannedId")
  @AdminTier("SUPER", "SUPPORT")
  deleteCanned(@Param("cannedId") cannedId: string) {
    return this.support.deleteCannedResponse(cannedId);
  }

  @Get(":id")
  get(@Param("id") id: string) {
    return this.support.getTicketAdmin(id);
  }

  @Post(":id/messages")
  @AdminTier("SUPER", "SUPPORT")
  reply(@Req() req: any, @Param("id") id: string, @Body() dto: ReplyDto) {
    return this.support.replyAsAdmin(req.adminUser, id, dto, req.ip);
  }

  @Post(":id/notes")
  @AdminTier("SUPER", "SUPPORT")
  note(@Req() req: any, @Param("id") id: string, @Body() dto: InternalNoteDto) {
    return this.support.addInternalNote(req.adminUser, id, dto, req.ip);
  }

  @Post(":id/status")
  @AdminTier("SUPER", "SUPPORT")
  update(@Req() req: any, @Param("id") id: string, @Body() dto: AdminTicketUpdateDto) {
    return this.support.updateAsAdmin(req.adminUser, id, dto, req.ip);
  }

  @Post(":id/ai-draft")
  @AdminTier("SUPER", "SUPPORT")
  aiDraft(@Param("id") id: string, @Body("tone") tone?: string) {
    return this.support.generateAiDraft(id, tone);
  }

  @Get(":id/summary")
  @AdminTier("SUPER", "SUPPORT")
  summary(@Param("id") id: string) {
    return this.support.summarizeThread(id);
  }

  @Sse(":id/stream")
  @AdminTier("SUPER", "SUPPORT")
  streamAdmin(@Param("id") ticketId: string): Promise<Observable<MessageEvent>> {
    return this.support.getTicketStreamAdmin(ticketId);
  }

  @Post(":id/typing")
  @AdminTier("SUPER", "SUPPORT")
  typingAdmin(@Param("id") ticketId: string, @Body("isTyping") isTyping: boolean) {
    this.support.emitTyping(ticketId, "admin", Boolean(isTyping));
    return { ok: true };
  }
}
