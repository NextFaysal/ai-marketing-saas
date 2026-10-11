import { Body, Controller, Delete, Get, NotFoundException, Param, Patch, Post, Query, Req, StreamableFile, UseGuards } from "@nestjs/common";
import { Request } from "express";
import { OrganizationsService } from "./organizations.service";
import { CreateOrganizationDto, InviteMemberDto, PlanChangeRequestDto, UpdateBrandingDto, UpdateBusinessProfileDto, UpdateMemberAccessDto, UpdateMemberRoleDto, UpdateMemberStatusDto, UploadLogoDto } from "./organizations.dto";
import { CurrentUser, AuthUser, PermissionArea, Public, Roles } from "../common/decorators";
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

  @PermissionArea("team")
  @Get(":organizationId/members")
  @UseGuards(TenantGuard, RolesGuard)
  members(@Param("organizationId") id: string) { return this.orgs.listMembers(id); }

  @PermissionArea("team")
  @Post(":organizationId/members/invite")
  @UseGuards(TenantGuard, RolesGuard)
  @Roles("OWNER", "ADMIN")
  invite(@CurrentUser() user: AuthUser, @Param("organizationId") id: string, @Body() dto: InviteMemberDto, @Req() req: Request) {
    return this.orgs.invite(id, user.userId, dto, req.ip);
  }

  @PermissionArea("billing")
  @Get(":organizationId/billing")
  @UseGuards(TenantGuard, RolesGuard)
  @Roles("OWNER", "ADMIN")
  billing(@Param("organizationId") id: string) { return this.orgs.getBilling(id); }

  @PermissionArea("billing")
  @Post(":organizationId/billing/plan-request")
  @UseGuards(TenantGuard, RolesGuard)
  @Roles("OWNER", "ADMIN")
  planRequest(@CurrentUser() user: AuthUser, @Param("organizationId") id: string, @Body() dto: PlanChangeRequestDto, @Req() req: Request) {
    return this.orgs.requestPlanChange(id, user.userId, dto, req.ip);
  }

  @PermissionArea("team")
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

  // Milestone 67 (Team T1): member lifecycle + seat picture.
  @Get(":organizationId/members/usage")
  @UseGuards(TenantGuard)
  memberUsage(@Param("organizationId") id: string) { return this.orgs.seatUsage(id); }

  // Milestone 72 (Team W3): custom access.
  @Get(":organizationId/access-catalog")
  @UseGuards(TenantGuard)
  accessCatalog() { return this.orgs.accessCatalog(); }

  @Get(":organizationId/members/:userId/access")
  @UseGuards(TenantGuard)
  memberAccess(@CurrentUser() user: AuthUser, @Param("organizationId") id: string, @Param("userId") userId: string) {
    return this.orgs.getMemberAccess(id, user.userId, userId);
  }

  @Patch(":organizationId/members/:userId/access")
  @UseGuards(TenantGuard, RolesGuard)
  @Roles("OWNER", "ADMIN")
  updateMemberAccess(@CurrentUser() user: AuthUser, @Param("organizationId") id: string, @Param("userId") userId: string, @Body() dto: UpdateMemberAccessDto, @Req() req: Request) {
    return this.orgs.updateMemberAccess(id, user.userId, userId, dto, req.ip);
  }

  // Milestone 69 (Team W1): member activity feed.
  @Get(":organizationId/members/activity-feed")
  @UseGuards(TenantGuard)
  memberActivityFeed(@CurrentUser() user: AuthUser, @Param("organizationId") id: string, @Query("take") take?: string, @Query("userId") userId?: string) {
    return this.orgs.memberActivityFeed(id, user.userId, { take: take ? Number(take) : undefined, userId });
  }

  @PermissionArea("team")
  @Patch(":organizationId/members/:userId/role")
  @UseGuards(TenantGuard, RolesGuard)
  @Roles("OWNER", "ADMIN")
  updateMemberRole(@CurrentUser() user: AuthUser, @Param("organizationId") id: string, @Param("userId") userId: string, @Body() dto: UpdateMemberRoleDto, @Req() req: Request) {
    return this.orgs.updateMemberRole(id, user.userId, userId, dto.role, req.ip);
  }

  @PermissionArea("team")
  @Patch(":organizationId/members/:userId/status")
  @UseGuards(TenantGuard, RolesGuard)
  @Roles("OWNER", "ADMIN")
  setMemberStatus(@CurrentUser() user: AuthUser, @Param("organizationId") id: string, @Param("userId") userId: string, @Body() dto: UpdateMemberStatusDto, @Req() req: Request) {
    return this.orgs.setMemberStatus(id, user.userId, userId, dto.status, req.ip);
  }

  @PermissionArea("team")
  @Delete(":organizationId/members/:userId")
  @UseGuards(TenantGuard, RolesGuard)
  @Roles("OWNER")
  removeMember(@CurrentUser() user: AuthUser, @Param("organizationId") id: string, @Param("userId") userId: string, @Req() req: Request) {
    return this.orgs.removeMember(id, user.userId, userId, req.ip);
  }

  @PermissionArea("settings")
  @Get(":organizationId/business-profile")
  @UseGuards(TenantGuard, RolesGuard)
  getProfile(@Param("organizationId") id: string) { return this.orgs.getBusinessProfile(id); }

  // Milestone 75: Business Brain completeness + AI readiness.
  @Get(":organizationId/business-profile/completeness")
  @UseGuards(TenantGuard, RolesGuard)
  profileCompleteness(@Param("organizationId") id: string) { return this.orgs.getProfileCompleteness(id); }

  @PermissionArea("settings")
  @Patch(":organizationId/business-profile")
  @UseGuards(TenantGuard, RolesGuard)
  @Roles("OWNER", "ADMIN", "MARKETING_MANAGER")
  updateProfile(@CurrentUser() user: AuthUser, @Param("organizationId") id: string, @Body() dto: UpdateBusinessProfileDto) {
    return this.orgs.updateBusinessProfile(id, user.userId, dto);
  }

  // ---- Milestone 59: white-label branding ----
  @PermissionArea("settings")
  @Patch(":organizationId/branding")
  @UseGuards(TenantGuard, RolesGuard)
  @Roles("OWNER", "ADMIN")
  updateBranding(@CurrentUser() user: AuthUser, @Param("organizationId") id: string, @Body() dto: UpdateBrandingDto, @Req() req: Request) {
    return this.orgs.updateBranding(id, user.userId, dto, req.ip);
  }

  @Post(":organizationId/branding/logo")
  @UseGuards(TenantGuard, RolesGuard)
  @Roles("OWNER", "ADMIN")
  uploadLogo(@CurrentUser() user: AuthUser, @Param("organizationId") id: string, @Body() dto: UploadLogoDto, @Req() req: Request) {
    return this.orgs.uploadLogo(id, user.userId, dto, req.ip);
  }

  @Delete(":organizationId/branding/logo")
  @UseGuards(TenantGuard, RolesGuard)
  @Roles("OWNER", "ADMIN")
  removeLogo(@CurrentUser() user: AuthUser, @Param("organizationId") id: string, @Req() req: Request) {
    return this.orgs.removeLogo(id, user.userId, req.ip);
  }
}

/** Public, unauthenticated logo bytes — the shared client report
 * page (no login) must be able to render the org's logo. Only the
 * logo is exposed here; nothing else about the org is public. */
@Controller("public/branding")
export class PublicBrandingController {
  constructor(private readonly orgs: OrganizationsService) {}

  @Public()
  @Get(":organizationId/logo")
  async logo(@Param("organizationId") id: string) {
    const logo = await this.orgs.publicLogo(id);
    if (!logo) throw new NotFoundException("No logo for this organization");
    return new StreamableFile(logo.bytes, { type: logo.contentType, disposition: "inline" });
  }
}
