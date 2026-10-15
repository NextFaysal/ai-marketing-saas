import { Body, Controller, Get, Param, Patch, Post, Query, UseGuards } from "@nestjs/common";
import { IsBoolean, IsOptional, IsString, MaxLength, MinLength } from "class-validator";
import { AiInstructionsService } from "./ai-instructions.service";
import { CurrentUser, AuthUser, Roles, PermissionArea } from "../common/decorators";
import { TenantGuard } from "../common/tenant.guard";
import { RolesGuard } from "../common/roles.guard";

export class UpdateInstructionsDraftDto {
  @IsString() @MaxLength(2000) instructions!: string;
}
export class PublishInstructionsDto {
  @IsOptional() @IsString() @MaxLength(200) note?: string;
}
export class RollbackInstructionsDto {
  @IsString() versionId!: string;
}
export class TestInstructionsDto {
  @IsString() @MinLength(1) @MaxLength(500) question!: string;
  @IsBoolean() useDraft!: boolean;
}
export class UpdateUnansweredStatusDto {
  @IsString() status!: string;
}

/**
 * CX2 — AI Instructions Desk API. Same guard/roles machinery as
 * InboxController: TenantGuard + RolesGuard at the class level,
 * @Roles per write. Reads are open to any org member; drafting
 * and triaging unanswered questions extend to MARKETING_MANAGER;
 * publish/rollback (what customers actually see) are OWNER/ADMIN.
 */
@PermissionArea("inbox")
@Controller("organizations/:organizationId/ai-instructions")
@UseGuards(TenantGuard, RolesGuard)
export class AiInstructionsController {
  constructor(private readonly desk: AiInstructionsService) {}

  @Get()
  getState(@Param("organizationId") orgId: string) {
    return this.desk.getState(orgId);
  }

  @Patch("draft") @UseGuards(RolesGuard) @Roles("OWNER", "ADMIN", "MARKETING_MANAGER")
  saveDraft(@Param("organizationId") orgId: string, @Body() dto: UpdateInstructionsDraftDto) {
    return this.desk.saveDraft(orgId, dto.instructions);
  }

  @Post("publish") @UseGuards(RolesGuard) @Roles("OWNER", "ADMIN")
  publish(@CurrentUser() user: AuthUser, @Param("organizationId") orgId: string, @Body() dto: PublishInstructionsDto) {
    return this.desk.publish(orgId, user.userId, dto?.note);
  }

  @Get("versions")
  versions(@Param("organizationId") orgId: string) {
    return this.desk.listVersions(orgId);
  }

  @Post("rollback") @UseGuards(RolesGuard) @Roles("OWNER", "ADMIN")
  rollback(@CurrentUser() user: AuthUser, @Param("organizationId") orgId: string, @Body() dto: RollbackInstructionsDto) {
    return this.desk.rollback(orgId, user.userId, dto.versionId);
  }

  @Post("test") @UseGuards(RolesGuard) @Roles("OWNER", "ADMIN", "MARKETING_MANAGER")
  test(@Param("organizationId") orgId: string, @Body() dto: TestInstructionsDto) {
    return this.desk.test(orgId, dto);
  }

  @Get("unanswered")
  unanswered(@Param("organizationId") orgId: string, @Query("status") status?: string, @Query("take") take?: string) {
    return this.desk.listUnanswered(orgId, { status, take: take ? Number(take) : undefined });
  }

  @Patch("unanswered/:id") @UseGuards(RolesGuard) @Roles("OWNER", "ADMIN", "MARKETING_MANAGER")
  updateUnansweredStatus(@CurrentUser() user: AuthUser, @Param("organizationId") orgId: string, @Param("id") id: string, @Body() dto: UpdateUnansweredStatusDto) {
    return this.desk.updateUnansweredStatus(orgId, user.userId, id, dto.status);
  }

  /** IN7e: AI draft proposal for one unanswered question —
   * display-only; accepting it goes through the existing
   * knowledge-create / Desk-draft paths from the UI. */
  @Post("unanswered/:id/draft-proposal") @UseGuards(RolesGuard) @Roles("OWNER", "ADMIN", "MARKETING_MANAGER")
  draftProposal(@CurrentUser() user: AuthUser, @Param("organizationId") orgId: string, @Param("id") id: string) {
    return this.desk.draftUnansweredProposal(orgId, user.userId, id);
  }
}
