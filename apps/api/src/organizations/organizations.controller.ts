import { Body, Controller, Get, Param, Patch, Post, Req, UseGuards } from "@nestjs/common";
import { Request } from "express";
import { OrganizationsService } from "./organizations.service";
import { CreateOrganizationDto, InviteMemberDto, UpdateBusinessProfileDto } from "./organizations.dto";
import { CurrentUser, AuthUser, Roles } from "../common/decorators";
import { TenantGuard } from "../common/tenant.guard";
import { RolesGuard } from "../common/roles.guard";

@Controller("organizations")
export class OrganizationsController {
  constructor(private readonly orgs: OrganizationsService) {}

  @Post()
  create(@CurrentUser() user: AuthUser, @Body() dto: CreateOrganizationDto, @Req() req: Request) {
    return this.orgs.create(user.userId, dto, req.ip);
  }

  @Get()
  listMine(@CurrentUser() user: AuthUser) { return this.orgs.listMine(user.userId); }

  @Get(":organizationId")
  @UseGuards(TenantGuard)
  getOne(@Param("organizationId") id: string) { return this.orgs.getOne(id); }

  @Get(":organizationId/members")
  @UseGuards(TenantGuard)
  members(@Param("organizationId") id: string) { return this.orgs.listMembers(id); }

  @Post(":organizationId/members/invite")
  @UseGuards(TenantGuard, RolesGuard)
  @Roles("OWNER", "ADMIN")
  invite(@CurrentUser() user: AuthUser, @Param("organizationId") id: string, @Body() dto: InviteMemberDto, @Req() req: Request) {
    return this.orgs.invite(id, user.userId, dto, req.ip);
  }

  @Get(":organizationId/business-profile")
  @UseGuards(TenantGuard)
  getProfile(@Param("organizationId") id: string) { return this.orgs.getBusinessProfile(id); }

  @Patch(":organizationId/business-profile")
  @UseGuards(TenantGuard, RolesGuard)
  @Roles("OWNER", "ADMIN", "MARKETING_MANAGER")
  updateProfile(@CurrentUser() user: AuthUser, @Param("organizationId") id: string, @Body() dto: UpdateBusinessProfileDto) {
    return this.orgs.updateBusinessProfile(id, user.userId, dto);
  }
}
