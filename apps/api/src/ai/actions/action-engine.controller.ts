import { Body, Controller, Get, Param, Post, Put, Query, UseGuards } from "@nestjs/common";
import { ActionEngineService } from "./action-engine.service";
import { CreateActionProposalDto, SetAutonomyDto } from "./action-engine.dto";
import { CurrentUser, AuthUser, Roles, PermissionArea } from "../../common/decorators";
import { TenantGuard } from "../../common/tenant.guard";
import { RolesGuard } from "../../common/roles.guard";

const DECIDE_ROLES = ["OWNER", "ADMIN", "MARKETING_MANAGER"];
const SETTINGS_ROLES = ["OWNER", "ADMIN"];

/**
 * SA-B10 (Smart AI Phase 2, W1) — the Action Engine's tenant API.
 *
 * Guard discipline mirrors the neighbouring AI surfaces
 * (AiController proposals, LearningController): TenantGuard +
 * RolesGuard on the whole controller; reads are member-level,
 * decisions take OWNER/ADMIN/MARKETING_MANAGER (the Milestone-47
 * proposal discipline), autonomy settings take OWNER/ADMIN (the
 * inbox-settings discipline). Proposing executes NOTHING at
 * level 1 — approve is the explicit human decision; at level 2 a
 * low-risk proposal executes through the same verified pipeline
 * and says so in its result (autoExecuted).
 */
@PermissionArea("ai")
@Controller("organizations/:organizationId/ai/actions")
@UseGuards(TenantGuard, RolesGuard)
export class ActionEngineController {
  constructor(private readonly engine: ActionEngineService) {}

  @Get("catalog")
  catalog() {
    return this.engine.getCatalog();
  }

  @Get("autonomy")
  listAutonomy(@Param("organizationId") orgId: string) {
    return this.engine.listAutonomy(orgId);
  }

  @Put("autonomy/:actionId") @UseGuards(RolesGuard) @Roles(...SETTINGS_ROLES)
  setAutonomy(@CurrentUser() user: AuthUser, @Param("organizationId") orgId: string, @Param("actionId") actionId: string, @Body() dto: SetAutonomyDto) {
    return this.engine.setAutonomy(orgId, actionId, dto.level, user.userId);
  }

  @Get("proposals")
  listProposals(@Param("organizationId") orgId: string, @Query("status") status?: string) {
    return this.engine.listProposals(orgId, status);
  }

  @Post("proposals") @UseGuards(RolesGuard) @Roles(...DECIDE_ROLES)
  createProposal(@CurrentUser() user: AuthUser, @Param("organizationId") orgId: string, @Body() dto: CreateActionProposalDto) {
    return this.engine.propose(orgId, dto.actionId, dto.payload, {
      proposedBy: "staff",
      actorUserId: user.userId,
      sourceRef: dto.sourceRef ?? null,
    });
  }

  @Post("proposals/:proposalId/approve") @UseGuards(RolesGuard) @Roles(...DECIDE_ROLES)
  approve(@CurrentUser() user: AuthUser, @Param("organizationId") orgId: string, @Param("proposalId") proposalId: string) {
    return this.engine.approve(orgId, user.userId, proposalId);
  }

  @Post("proposals/:proposalId/reject") @UseGuards(RolesGuard) @Roles(...DECIDE_ROLES)
  reject(@CurrentUser() user: AuthUser, @Param("organizationId") orgId: string, @Param("proposalId") proposalId: string) {
    return this.engine.reject(orgId, user.userId, proposalId);
  }
}
