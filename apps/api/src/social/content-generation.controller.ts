import { Body, Controller, Param, Post, UseGuards } from "@nestjs/common";
import { ContentGenerationService } from "./content-generation.service";
import { GenerateContentDto } from "./content-generation.dto";
import { CurrentUser, AuthUser, PermissionArea, Roles } from "../common/decorators";
import { TenantGuard } from "../common/tenant.guard";
import { RolesGuard } from "../common/roles.guard";

const WRITE_ROLES = ["OWNER", "ADMIN", "MARKETING_MANAGER"];

/**
 * SA-B19 (Smart AI Phase 5, G1): the tenant surface for AI
 * social content generation. One call generates grounded
 * caption variants from a Brain topic source (live product /
 * APPROVED LearnedItem / staff topic) and files every
 * guard-passing variant as a REAL draft post on the chosen
 * social account — draft-only by design: nothing here
 * schedules or publishes, ever. Member-gated tenant route
 * (TenantGuard resolves the org from the path and proves
 * membership), write roles mirror the other Smart AI tenant
 * surfaces (SA-B14/B16/B17).
 */
@PermissionArea("ai")
@Controller("organizations/:organizationId/content")
@UseGuards(TenantGuard, RolesGuard)
export class ContentGenerationController {
  constructor(private readonly content: ContentGenerationService) {}

  @Post("generate") @UseGuards(RolesGuard) @Roles(...WRITE_ROLES)
  generate(
    @CurrentUser() user: AuthUser,
    @Param("organizationId") orgId: string,
    @Body() dto: GenerateContentDto,
  ) {
    return this.content.generate(orgId, user.userId, dto);
  }
}
