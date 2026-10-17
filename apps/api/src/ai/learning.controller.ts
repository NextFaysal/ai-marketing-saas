import { Body, Controller, Get, Param, Post, Query, UseGuards } from "@nestjs/common";
import { LearningService } from "./learning.service";
import { VoiceLearningService } from "./voice-learning.service";
import { ApproveLearnedItemDto } from "./learning.dto";
import { CurrentUser, AuthUser, Roles, PermissionArea } from "../common/decorators";
import { TenantGuard } from "../common/tenant.guard";
import { RolesGuard } from "../common/roles.guard";

const WRITE_ROLES = ["OWNER", "ADMIN", "MARKETING_MANAGER"];

/**
 * SA-B4 (Smart AI Phase 0, P5/P6): the tenant surface for mined
 * knowledge — list suggestions, approve (applies the item via
 * LearningService), reject. The P9 Learn Dashboard builds its UI
 * on these routes; the learning toggles themselves ride the
 * existing business-profile GET/PATCH (BusinessProfile carries
 * conversationLearningEnabled / websiteLearningEnabled).
 * Same guard discipline as KnowledgeController.
 */
@PermissionArea("ai")
@Controller("organizations/:organizationId/learning-items")
@UseGuards(TenantGuard, RolesGuard)
export class LearningController {
  constructor(private readonly learning: LearningService) {}

  @Get()
  listItems(
    @Param("organizationId") orgId: string,
    @Query("status") status?: string,
    @Query("sourceType") sourceType?: string,
    @Query("limit") limit?: string,
    @Query("offset") offset?: string,
  ) {
    return this.learning.listItems(orgId, {
      status,
      sourceType,
      limit: limit ? Number(limit) : undefined,
      offset: offset ? Number(offset) : undefined,
    });
  }

  @Post(":itemId/approve") @UseGuards(RolesGuard) @Roles(...WRITE_ROLES)
  approve(@CurrentUser() user: AuthUser, @Param("organizationId") orgId: string, @Param("itemId") itemId: string, @Body() dto: ApproveLearnedItemDto) {
    return this.learning.approve(orgId, user.userId, itemId, { visibility: dto?.visibility });
  }

  @Post(":itemId/reject") @UseGuards(RolesGuard) @Roles(...WRITE_ROLES)
  reject(@CurrentUser() user: AuthUser, @Param("organizationId") orgId: string, @Param("itemId") itemId: string) {
    return this.learning.reject(orgId, user.userId, itemId);
  }
}

/**
 * SA-B5 (P8a): the tenant surface for the learned brand voice —
 * read the profile (with its suggested/pending state) and make
 * the human decisions: activate a suggestion (or promote a
 * pending re-learn) and dismiss one. Same guard discipline as
 * the learning-items routes above; the P9 Learn Dashboard
 * builds its UI on these.
 */
@PermissionArea("ai")
@Controller("organizations/:organizationId/brand-voice")
@UseGuards(TenantGuard, RolesGuard)
export class BrandVoiceController {
  constructor(private readonly voice: VoiceLearningService) {}

  @Get()
  getProfile(@Param("organizationId") orgId: string) {
    return this.voice.getProfile(orgId);
  }

  @Post("activate") @UseGuards(RolesGuard) @Roles(...WRITE_ROLES)
  activate(@CurrentUser() user: AuthUser, @Param("organizationId") orgId: string) {
    return this.voice.activate(orgId, user.userId);
  }

  @Post("dismiss") @UseGuards(RolesGuard) @Roles(...WRITE_ROLES)
  dismiss(@CurrentUser() user: AuthUser, @Param("organizationId") orgId: string) {
    return this.voice.dismissSuggestion(orgId, user.userId);
  }
}
