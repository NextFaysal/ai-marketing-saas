import { Body, Controller, Get, Param, Post, UseGuards } from "@nestjs/common";
import { TenantGuard } from "../common/tenant.guard";
import { RolesGuard } from "../common/roles.guard";
import { CurrentUser, AuthUser, Roles, PermissionArea } from "../common/decorators";
import { PracticeModeService } from "./practice-mode.service";
import { CompletePracticeSessionDto, PracticeMessageDto, StartPracticeSessionDto } from "./practice-mode.dto";

@PermissionArea("inbox")
@Controller("organizations/:organizationId/inbox/practice")
@UseGuards(TenantGuard, RolesGuard)
export class PracticeModeController {
  constructor(private readonly practiceMode: PracticeModeService) {}

  @Get("scenarios")
  @Roles("OWNER", "ADMIN", "MARKETING_MANAGER", "SUPPORT_AGENT")
  async listScenarios() {
    return this.practiceMode.listScenarios();
  }

  @Post("sessions")
  @Roles("OWNER", "ADMIN", "MARKETING_MANAGER", "SUPPORT_AGENT")
  async startSession(
    @Param("organizationId") orgId: string,
    @CurrentUser() user: AuthUser,
    @Body() dto: StartPracticeSessionDto,
  ) {
    return this.practiceMode.startSession(orgId, user.userId, dto);
  }

  @Post("sessions/:sessionId/message")
  @Roles("OWNER", "ADMIN", "MARKETING_MANAGER", "SUPPORT_AGENT")
  async sendMessage(
    @Param("organizationId") orgId: string,
    @CurrentUser() user: AuthUser,
    @Param("sessionId") sessionId: string,
    @Body() dto: PracticeMessageDto,
  ) {
    return this.practiceMode.sendMessage(orgId, user.userId, sessionId, dto);
  }

  @Post("sessions/:sessionId/complete")
  @Roles("OWNER", "ADMIN", "MARKETING_MANAGER", "SUPPORT_AGENT")
  async completeSession(
    @Param("organizationId") orgId: string,
    @CurrentUser() user: AuthUser,
    @Param("sessionId") sessionId: string,
    @Body() dto: CompletePracticeSessionDto,
  ) {
    return this.practiceMode.completeSession(orgId, user.userId, sessionId, dto);
  }

  @Get("sessions")
  @Roles("OWNER", "ADMIN", "MARKETING_MANAGER", "SUPPORT_AGENT")
  async getSessions(
    @Param("organizationId") orgId: string,
    @CurrentUser() user: AuthUser,
  ) {
    return this.practiceMode.getSessions(orgId, user.userId);
  }
}

