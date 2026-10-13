import { Body, Controller, Get, Param, Post, UseGuards } from "@nestjs/common";
import { PracticeService } from "./practice.service";
import { CurrentUser, AuthUser, Roles, PermissionArea } from "../common/decorators";
import { TenantGuard } from "../common/tenant.guard";
import { RolesGuard } from "../common/roles.guard";

/**
 * CX12a — Practice Mode endpoints. Toggle + cleanup are
 * OWNER/ADMIN only (RolesGuard, the repo pattern); reading state
 * is open to any member so the shell banner can render for the
 * whole team while practice is on.
 */
@PermissionArea("inbox")
@Controller("organizations/:organizationId/practice")
@UseGuards(TenantGuard, RolesGuard)
export class PracticeController {
  constructor(private readonly practice: PracticeService) {}

  @Get()
  state(@Param("organizationId") orgId: string) {
    return this.practice.getState(orgId);
  }

  @Post("toggle") @UseGuards(RolesGuard) @Roles("OWNER", "ADMIN")
  toggle(@CurrentUser() user: AuthUser, @Param("organizationId") orgId: string, @Body() dto: { enabled?: boolean }) {
    return this.practice.setPracticeMode(orgId, user.userId, Boolean(dto?.enabled));
  }

  @Post("conversation") @UseGuards(RolesGuard) @Roles("OWNER", "ADMIN", "MARKETING_MANAGER", "SUPPORT_AGENT")
  conversation(@CurrentUser() user: AuthUser, @Param("organizationId") orgId: string) {
    return this.practice.createPracticeConversation(orgId, user.userId);
  }

  @Post("conversations/:conversationId/simulate") @UseGuards(RolesGuard) @Roles("OWNER", "ADMIN", "MARKETING_MANAGER", "SUPPORT_AGENT")
  simulate(@CurrentUser() user: AuthUser, @Param("organizationId") orgId: string, @Param("conversationId") conversationId: string, @Body() dto: { content?: string }) {
    return this.practice.simulateInboundMessage(orgId, user.userId, conversationId, dto?.content);
  }

  @Post("demo-pack") @UseGuards(RolesGuard) @Roles("OWNER", "ADMIN", "MARKETING_MANAGER", "SUPPORT_AGENT")
  demoPack(@CurrentUser() user: AuthUser, @Param("organizationId") orgId: string) {
    return this.practice.loadDemoPack(orgId, user.userId);
  }

  @Post("cleanup") @UseGuards(RolesGuard) @Roles("OWNER", "ADMIN")
  cleanup(@CurrentUser() user: AuthUser, @Param("organizationId") orgId: string) {
    return this.practice.cleanupPractice(orgId, user.userId);
  }
}
