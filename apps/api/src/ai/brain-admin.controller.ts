import { Body, Controller, Delete, Get, Param, Patch, Query, UseGuards } from "@nestjs/common";
import { BrainAdminService } from "./brain-admin.service";
import { SetStoredAnswerStatusDto } from "./brain-admin.dto";
import { CurrentUser, AuthUser, Roles, PermissionArea } from "../common/decorators";
import { TenantGuard } from "../common/tenant.guard";
import { RolesGuard } from "../common/roles.guard";

const WRITE_ROLES = ["OWNER", "ADMIN", "MARKETING_MANAGER"];
const DELETE_ROLES = ["OWNER", "ADMIN"];

/**
 * SA-B6 (Smart AI Phase 0, P9): the management surface behind
 * the tenant Learn Dashboard (Organization Settings → "🧠 AI
 * শিখন") — brain overview, Answer Store management and Customer
 * Memory read/forget. Same guard discipline as LearningController
 * and KnowledgeController: reads open to org members; content
 * writes OWNER/ADMIN/MARKETING_MANAGER; hard deletes OWNER/ADMIN
 * only (the KnowledgeController delete precedent). Org scoping
 * itself lives in BrainAdminService's SQL (another org's id is a
 * 404 there), with TenantGuard keeping non-members out entirely.
 */
@PermissionArea("ai")
@Controller("organizations/:organizationId")
@UseGuards(TenantGuard, RolesGuard)
export class BrainAdminController {
  constructor(private readonly brain: BrainAdminService) {}

  @Get("brain-overview")
  overview(@Param("organizationId") orgId: string) {
    return this.brain.getOverview(orgId);
  }

  @Get("answer-store")
  listAnswers(
    @Param("organizationId") orgId: string,
    @Query("status") status?: string,
    @Query("search") search?: string,
    @Query("limit") limit?: string,
    @Query("offset") offset?: string,
  ) {
    return this.brain.listStoredAnswers(orgId, {
      status,
      search,
      limit: limit ? Number(limit) : undefined,
      offset: offset ? Number(offset) : undefined,
    });
  }

  @Patch("answer-store/:answerId") @UseGuards(RolesGuard) @Roles(...WRITE_ROLES)
  setAnswerStatus(
    @CurrentUser() user: AuthUser,
    @Param("organizationId") orgId: string,
    @Param("answerId") answerId: string,
    @Body() dto: SetStoredAnswerStatusDto,
  ) {
    return this.brain.setStoredAnswerStatus(orgId, user.userId, answerId, dto?.status);
  }

  @Delete("answer-store/:answerId") @UseGuards(RolesGuard) @Roles(...DELETE_ROLES)
  deleteAnswer(
    @CurrentUser() user: AuthUser,
    @Param("organizationId") orgId: string,
    @Param("answerId") answerId: string,
  ) {
    return this.brain.deleteStoredAnswer(orgId, user.userId, answerId);
  }

  @Get("customer-memories")
  listMemories(
    @Param("organizationId") orgId: string,
    @Query("limit") limit?: string,
    @Query("offset") offset?: string,
  ) {
    return this.brain.listCustomerMemories(orgId, {
      limit: limit ? Number(limit) : undefined,
      offset: offset ? Number(offset) : undefined,
    });
  }

  @Delete("customer-memories/:memoryId") @UseGuards(RolesGuard) @Roles(...DELETE_ROLES)
  forgetMemory(
    @CurrentUser() user: AuthUser,
    @Param("organizationId") orgId: string,
    @Param("memoryId") memoryId: string,
  ) {
    return this.brain.deleteCustomerMemory(orgId, user.userId, memoryId);
  }
}
