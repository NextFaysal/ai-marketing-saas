import { Body, Controller, Delete, Get, Param, Patch, Post, Req, UseGuards } from "@nestjs/common";
import { Request } from "express";
import { OrganizationsService } from "./organizations.service";
import { CreateOrganizationDto, InviteMemberDto, PlanChangeRequestDto, UpdateBusinessProfileDto } from "./organizations.dto";
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

  @Get(":organizationId/billing")
  @UseGuards(TenantGuard, RolesGuard)
  @Roles("OWNER", "ADMIN")
  billing(@Param("organizationId") id: string) { return this.orgs.getBilling(id); }

  @Post(":organizationId/billing/plan-request")
  @UseGuards(TenantGuard, RolesGuard)
  @Roles("OWNER", "ADMIN")
  planRequest(@CurrentUser() user: AuthUser, @Param("organizationId") id: string, @Body() dto: PlanChangeRequestDto, @Req() req: Request) {
    return this.orgs.requestPlanChange(id, user.userId, dto, req.ip);
  }

  @Post(":organizationId/members/email-invite")
  @UseGuards(TenantGuard, RolesGuard)
  @Roles("OWNER", "ADMIN")
  emailInvite(@CurrentUser() user: AuthUser, @Param("organizationId") id: string, @Body() dto: InviteMemberDto, @Req() req: Request) {
    return this.orgs.createEmailInvitation(id, user.userId, dto, req.ip);
  }

  @Get(":organizationId/members/invitations")
  @UseGuards(TenantGuard, RolesGuard)
  @Roles("OWNER", "ADMIN")
  invitations(@Param("organizationId") id: string) { return this.orgs.listInvitations(id); }

  @Delete(":organizationId/members/invitations/:invitationId")
  @UseGuards(TenantGuard, RolesGuard)
  @Roles("OWNER", "ADMIN")
  revokeInvitation(@CurrentUser() user: AuthUser, @Param("organizationId") id: string, @Param("invitationId") invitationId: string, @Req() req: Request) {
    return this.orgs.revokeInvitation(id, user.userId, invitationId, req.ip);
  }

  @Post(":organizationId/members/invitations/:invitationId/resend")
  @UseGuards(TenantGuard, RolesGuard)
  @Roles("OWNER", "ADMIN")
  resendInvitation(@CurrentUser() user: AuthUser, @Param("organizationId") id: string, @Param("invitationId") invitationId: string, @Req() req: Request) {
    return this.orgs.resendInvitation(id, user.userId, invitationId, req.ip);
  }

  @Get(":organizationId/onboarding")
  @UseGuards(TenantGuard)
  onboarding(@Param("organizationId") id: string) { return this.orgs.getOnboarding(id); }

  @Post(":organizationId/members/:userId/totp-reset")
  @UseGuards(TenantGuard, RolesGuard)
  @Roles("OWNER")
  resetMemberTotp(@CurrentUser() user: AuthUser, @Param("organizationId") id: string, @Param("userId") userId: string, @Req() req: Request) {
    return this.orgs.resetMemberTotp(id, user.userId, userId, req.ip);
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
