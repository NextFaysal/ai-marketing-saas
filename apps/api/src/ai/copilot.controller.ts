import { Body, Controller, Param, Post, UseGuards } from "@nestjs/common";
import { CopilotService } from "./copilot.service";
import { CopilotAskDto } from "./copilot.dto";
import { CurrentUser, AuthUser, PermissionArea, Roles } from "../common/decorators";
import { TenantGuard } from "../common/tenant.guard";
import { RolesGuard } from "../common/roles.guard";

/** OWNER/ADMIN only — a deliberate narrowing vs the other Smart
 *  AI write surfaces (OWNER/ADMIN/MARKETING_MANAGER): the
 *  copilot speaks from the Brain's INTERNAL class (goals,
 *  budget, ads/competitor figures) and files Action Engine
 *  proposals in the owner's name. The plan casts G3 as the
 *  owner's own instrument ("Dashboard Assistant"), so the
 *  manager role is excluded here and the choice is recorded. */
const COPILOT_ROLES = ["OWNER", "ADMIN"];

/**
 * SA-B21 (Smart AI Phase 5, G3): the tenant surface for the
 * Owner Copilot. One stateless ask: business questions are
 * answered from the org's deterministic digests + Brain under
 * the shared number guard; action asks become Action Engine
 * PROPOSALS (never executions) through the deterministic intent
 * layer. Member-gated tenant route (TenantGuard resolves the
 * org from the path and proves membership).
 */
@PermissionArea("ai")
@Controller("organizations/:organizationId/copilot")
@UseGuards(TenantGuard, RolesGuard)
export class CopilotController {
  constructor(private readonly copilot: CopilotService) {}

  @Post("ask") @UseGuards(RolesGuard) @Roles(...COPILOT_ROLES)
  ask(
    @CurrentUser() user: AuthUser,
    @Param("organizationId") orgId: string,
    @Body() dto: CopilotAskDto,
  ) {
    return this.copilot.ask(orgId, user.userId, dto);
  }
}
