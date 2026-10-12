import { Body, Controller, Get, Param, Post, UseGuards } from "@nestjs/common";
import { AuthGuard } from "../common/auth.guard";
import { RolesGuard } from "../common/roles.guard";
import { Roles } from "../common/decorators";
import { CurrentOrg, CurrentUser } from "../common/decorators";
import { PracticeModeService } from "./practice-mode.service";
import { CompletePracticeSessionDto, PracticeMessageDto, StartPracticeSessionDto } from "./practice-mode.dto";

@Controller("inbox/practice")
@UseGuards(AuthGuard, RolesGuard)
export class PracticeModeController {
  constructor(private readonly practiceMode: PracticeModeService) {}

  @Get("scenarios")
  @Roles("owner", "admin", "agent")
  async listScenarios() {
    return this.practiceMode.listScenarios();
  }

  @Post("sessions")
  @Roles("owner", "admin", "agent")
  async startSession(
    @CurrentOrg() orgId: string,
    @CurrentUser() user: { id: string },
    @Body() dto: StartPracticeSessionDto,
  ) {
    return this.practiceMode.startSession(orgId, user.id, dto);
  }

  @Post("sessions/:sessionId/message")
  @Roles("owner", "admin", "agent")
  async sendMessage(
    @CurrentOrg() orgId: string,
    @CurrentUser() user: { id: string },
    @Param("sessionId") sessionId: string,
    @Body() dto: PracticeMessageDto,
  ) {
    return this.practiceMode.sendMessage(orgId, user.id, sessionId, dto);
  }

  @Post("sessions/:sessionId/complete")
  @Roles("owner", "admin", "agent")
  async completeSession(
    @CurrentOrg() orgId: string,
    @CurrentUser() user: { id: string },
    @Param("sessionId") sessionId: string,
    @Body() dto: CompletePracticeSessionDto,
  ) {
    return this.practiceMode.completeSession(orgId, user.id, sessionId, dto);
  }

  @Get("sessions")
  @Roles("owner", "admin", "agent")
  async getSessions(
    @CurrentOrg() orgId: string,
    @CurrentUser() user: { id: string },
  ) {
    return this.practiceMode.getSessions(orgId, user.id);
  }
}
