import { Body, Controller, Delete, Get, Param, Patch, Post, Query, UseGuards } from "@nestjs/common";
import { MessagingService } from "./messaging.service";
import { CreateTemplateDto, UpdateTemplateDto, CreateBroadcastDto } from "./messaging.dto";
import { CurrentUser, AuthUser, Roles } from "../common/decorators";
import { TenantGuard } from "../common/tenant.guard";
import { RolesGuard } from "../common/roles.guard";

const WRITE_ROLES = ["OWNER", "ADMIN", "MARKETING_MANAGER"];

@Controller("organizations/:organizationId/messaging")
@UseGuards(TenantGuard)
export class MessagingController {
  constructor(private readonly messaging: MessagingService) {}

  @Get("provider-status")
  status() { return this.messaging.providerStatus(); }

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

  @Post("broadcasts") @UseGuards(RolesGuard) @Roles(...WRITE_ROLES)
  createBroadcast(@CurrentUser() user: AuthUser, @Param("organizationId") orgId: string, @Body() dto: CreateBroadcastDto) {
    return this.messaging.createBroadcast(orgId, user.userId, dto);
  }
  @Get("broadcasts")
  listBroadcasts(@Param("organizationId") orgId: string) { return this.messaging.listBroadcasts(orgId); }
  @Get("rfm")
  rfm(@Param("organizationId") orgId: string) { return this.messaging.rfmReport(orgId); }
  @Post("broadcasts/:broadcastId/send") @UseGuards(RolesGuard) @Roles(...WRITE_ROLES)
  send(@CurrentUser() user: AuthUser, @Param("organizationId") orgId: string, @Param("broadcastId") id: string) {
    return this.messaging.sendBroadcast(orgId, user.userId, id);
  }
  @Get("broadcasts/:broadcastId/deliveries")
  deliveries(@Param("organizationId") orgId: string, @Param("broadcastId") id: string) {
    return this.messaging.listDeliveries(orgId, id);
  }
}
