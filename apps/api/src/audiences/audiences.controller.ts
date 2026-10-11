import { Body, Controller, Delete, Get, Param, Post, UseGuards } from "@nestjs/common";
import { IsNumber, IsOptional, IsString, MaxLength } from "class-validator";
import { AudiencesService } from "./audiences.service";
import { CurrentUser, AuthUser, Roles, PermissionArea } from "../common/decorators";
import { TenantGuard } from "../common/tenant.guard";
import { RolesGuard } from "../common/roles.guard";

class CreateCustomDto {
  @IsString() adAccountId!: string;
  @IsString() @MaxLength(200) name!: string;
  @IsString() source!: string;
  @IsOptional() @IsString() segment?: string;
}
class CreateLookalikeDto {
  @IsString() adAccountId!: string;
  @IsString() @MaxLength(200) name!: string;
  @IsString() sourceAudienceRecordId!: string;
  @IsString() country!: string;
  @IsOptional() @IsNumber() ratio?: number;
}
class CreateSavedDto {
  @IsString() @MaxLength(200) name!: string;
  targeting!: Record<string, unknown>;
}

@PermissionArea("ads")
@Controller("organizations/:organizationId/audiences")
@UseGuards(TenantGuard, RolesGuard)
export class AudiencesController {
  constructor(private readonly audiences: AudiencesService) {}
  private write = ["OWNER", "ADMIN", "MARKETING_MANAGER"] as const;

  @Get()
  list(@Param("organizationId") orgId: string) { return this.audiences.list(orgId); }

  @Post("custom") @UseGuards(RolesGuard) @Roles("OWNER", "ADMIN", "MARKETING_MANAGER")
  custom(@CurrentUser() user: AuthUser, @Param("organizationId") orgId: string, @Body() dto: CreateCustomDto) {
    return this.audiences.createCustom(orgId, user.userId, dto);
  }

  @Post("lookalike") @UseGuards(RolesGuard) @Roles("OWNER", "ADMIN", "MARKETING_MANAGER")
  lookalike(@CurrentUser() user: AuthUser, @Param("organizationId") orgId: string, @Body() dto: CreateLookalikeDto) {
    return this.audiences.createLookalike(orgId, user.userId, dto);
  }

  @Post(":recordId/refresh-members") @UseGuards(RolesGuard) @Roles("OWNER", "ADMIN", "MARKETING_MANAGER")
  refreshMembers(@CurrentUser() user: AuthUser, @Param("organizationId") orgId: string, @Param("recordId") id: string) {
    return this.audiences.refreshMembership(orgId, user.userId, id);
  }
  @Post(":recordId/refresh") @UseGuards(RolesGuard) @Roles("OWNER", "ADMIN", "MARKETING_MANAGER")
  refresh(@Param("organizationId") orgId: string, @Param("recordId") id: string) {
    return this.audiences.refresh(orgId, id);
  }

  @Get("saved/list")
  saved(@Param("organizationId") orgId: string) { return this.audiences.listSaved(orgId); }

  @Post("saved") @UseGuards(RolesGuard) @Roles("OWNER", "ADMIN", "MARKETING_MANAGER")
  createSaved(@CurrentUser() user: AuthUser, @Param("organizationId") orgId: string, @Body() dto: CreateSavedDto) {
    return this.audiences.createSaved(orgId, user.userId, dto);
  }

  @Delete("saved/:savedId") @UseGuards(RolesGuard) @Roles("OWNER", "ADMIN")
  deleteSaved(@Param("organizationId") orgId: string, @Param("savedId") id: string) {
    return this.audiences.deleteSaved(orgId, id);
  }
}
