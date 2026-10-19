import { Body, Controller, Delete, Get, NotFoundException, Param, Patch, Post, Query, Req, Res, StreamableFile, UseGuards } from "@nestjs/common";
import { Request, Response } from "express";
import { OrganizationsService } from "./organizations.service";
import { ApproveJoinRequestDto, AssignCustomRoleDto, CreateCustomRoleDto, CreateInviteLinkDto, CreateOrganizationDto, InviteMemberDto, PlanChangeRequestDto, RejectJoinRequestDto, TransferOwnershipDto, UpdateBrandingDto, UpdateBusinessProfileDto, UpdateCustomRoleDto, UpdateMemberAccessDto, UpdateMemberRoleDto, UpdateMemberStatusDto, UpdateNotificationPreferencesDto, UpdateOrgIdentityDto, UpdateOrgLocaleDto, UpdateSecurityPolicyDto, UploadLogoDto } from "./organizations.dto";
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

  // TD2: live slug check for the onboarding subdomain picker.
  // Declared BEFORE ":organizationId" so the literal segment is
  // never captured as an organization id.
  @Get("slug-available")
  slugAvailable(@Query("slug") slug?: string) { return this.orgs.checkSlugAvailability(slug ?? ""); }

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

  // GC22 (GB9): subscription pause/resume — OWNER only.
  @PermissionArea("billing")
  @Post(":organizationId/billing/pause")
  @UseGuards(TenantGuard, RolesGuard)
  @Roles("OWNER")
  pauseSubscription(@CurrentUser() user: AuthUser, @Param("organizationId") id: string, @Req() req: Request) {
    return this.orgs.pauseSubscription(id, user.userId, req.ip);
  }

  @PermissionArea("billing")
  @Post(":organizationId/billing/resume")
  @UseGuards(TenantGuard, RolesGuard)
  @Roles("OWNER")
  resumeSubscription(@CurrentUser() user: AuthUser, @Param("organizationId") id: string, @Req() req: Request) {
    return this.orgs.resumeSubscription(id, user.userId, req.ip);
  }

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

  // ORG9 (Organization Next OB3): shareable invite links. A link
  // is role-bound, capped and revocable — and it never creates a
  // membership by itself (see the ORG10 queue below).
  @PermissionArea("team")
  @Post(":organizationId/invite-links")
  @UseGuards(TenantGuard, RolesGuard)
  @Roles("OWNER", "ADMIN")
  createInviteLink(@CurrentUser() user: AuthUser, @Param("organizationId") id: string, @Body() dto: CreateInviteLinkDto, @Req() req: Request) {
    return this.orgs.createInviteLink(id, user.userId, dto, req.ip);
  }

  @PermissionArea("team")
  @Get(":organizationId/invite-links")
  @UseGuards(TenantGuard, RolesGuard)
  @Roles("OWNER", "ADMIN")
  inviteLinks(@CurrentUser() user: AuthUser, @Param("organizationId") id: string) {
    return this.orgs.listInviteLinks(id, user.userId);
  }

  @PermissionArea("team")
  @Delete(":organizationId/invite-links/:linkId")
  @UseGuards(TenantGuard, RolesGuard)
  @Roles("OWNER", "ADMIN")
  revokeInviteLink(@CurrentUser() user: AuthUser, @Param("organizationId") id: string, @Param("linkId") linkId: string, @Req() req: Request) {
    return this.orgs.revokeInviteLink(id, user.userId, linkId, req.ip);
  }

  // ORG10 (Organization Next OB3): join-request approval queue.
  // Approval is the ONLY path from a request to an ACTIVE
  // membership, and the seat guard runs at that moment.
  @PermissionArea("team")
  @Get(":organizationId/join-requests")
  @UseGuards(TenantGuard, RolesGuard)
  @Roles("OWNER", "ADMIN")
  joinRequests(@CurrentUser() user: AuthUser, @Param("organizationId") id: string) {
    return this.orgs.listJoinRequests(id, user.userId);
  }

  @PermissionArea("team")
  @Post(":organizationId/join-requests/:requestId/approve")
  @UseGuards(TenantGuard, RolesGuard)
  @Roles("OWNER", "ADMIN")
  approveJoinRequest(@CurrentUser() user: AuthUser, @Param("organizationId") id: string, @Param("requestId") requestId: string, @Body() dto: ApproveJoinRequestDto, @Req() req: Request) {
    return this.orgs.approveJoinRequest(id, user.userId, requestId, dto, req.ip);
  }

  @PermissionArea("team")
  @Post(":organizationId/join-requests/:requestId/reject")
  @UseGuards(TenantGuard, RolesGuard)
  @Roles("OWNER", "ADMIN")
  rejectJoinRequest(@CurrentUser() user: AuthUser, @Param("organizationId") id: string, @Param("requestId") requestId: string, @Body() dto: RejectJoinRequestDto, @Req() req: Request) {
    return this.orgs.rejectJoinRequest(id, user.userId, requestId, dto, req.ip);
  }

  @Get(":organizationId/onboarding")
  @UseGuards(TenantGuard)
  onboarding(@Param("organizationId") id: string) { return this.orgs.getOnboarding(id); }

  /** CX12a: Setup Guide — the guided setup steps, every one
   * computed from real rows (see OrganizationsService.getSetupGuide). */
  @Get(":organizationId/setup-guide")
  @UseGuards(TenantGuard)
  setupGuide(@Param("organizationId") id: string) { return this.orgs.getSetupGuide(id); }

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

  // GB6 (GC16): custom roles — named permission-area bundles,
  // optionally materialized from a preset profile.
  @Get(":organizationId/custom-roles")
  @UseGuards(TenantGuard)
  customRoles(@Param("organizationId") id: string) { return this.orgs.listCustomRoles(id); }

  @PermissionArea("team")
  @Post(":organizationId/custom-roles")
  @UseGuards(TenantGuard, RolesGuard)
  @Roles("OWNER", "ADMIN")
  createCustomRole(@CurrentUser() user: AuthUser, @Param("organizationId") id: string, @Body() dto: CreateCustomRoleDto, @Req() req: Request) {
    return this.orgs.createCustomRole(id, user.userId, dto, req.ip);
  }

  @PermissionArea("team")
  @Patch(":organizationId/custom-roles/:roleId")
  @UseGuards(TenantGuard, RolesGuard)
  @Roles("OWNER", "ADMIN")
  updateCustomRole(@CurrentUser() user: AuthUser, @Param("organizationId") id: string, @Param("roleId") roleId: string, @Body() dto: UpdateCustomRoleDto, @Req() req: Request) {
    return this.orgs.updateCustomRole(id, user.userId, roleId, dto, req.ip);
  }

  @PermissionArea("team")
  @Delete(":organizationId/custom-roles/:roleId")
  @UseGuards(TenantGuard, RolesGuard)
  @Roles("OWNER", "ADMIN")
  deleteCustomRole(@CurrentUser() user: AuthUser, @Param("organizationId") id: string, @Param("roleId") roleId: string, @Req() req: Request) {
    return this.orgs.deleteCustomRole(id, user.userId, roleId, req.ip);
  }

  @PermissionArea("team")
  @Patch(":organizationId/members/:userId/custom-role")
  @UseGuards(TenantGuard, RolesGuard)
  @Roles("OWNER", "ADMIN")
  assignMemberCustomRole(@CurrentUser() user: AuthUser, @Param("organizationId") id: string, @Param("userId") userId: string, @Body() dto: AssignCustomRoleDto, @Req() req: Request) {
    return this.orgs.assignMemberCustomRole(id, user.userId, userId, dto, req.ip);
  }

  // GB6 (GC16): member login history + sessions (managers only).
  @PermissionArea("team")
  @Get(":organizationId/members/:userId/login-history")
  @UseGuards(TenantGuard, RolesGuard)
  @Roles("OWNER", "ADMIN")
  memberLoginHistory(@Param("organizationId") id: string, @Param("userId") userId: string) {
    return this.orgs.getMemberLoginHistory(id, userId);
  }

  @PermissionArea("team")
  @Get(":organizationId/members/:userId/sessions")
  @UseGuards(TenantGuard, RolesGuard)
  @Roles("OWNER", "ADMIN")
  memberSessions(@Param("organizationId") id: string, @Param("userId") userId: string) {
    return this.orgs.getMemberSessions(id, userId);
  }

  @PermissionArea("team")
  @Delete(":organizationId/members/:userId/sessions/:sessionId")
  @UseGuards(TenantGuard, RolesGuard)
  @Roles("OWNER", "ADMIN")
  revokeMemberSession(@CurrentUser() user: AuthUser, @Param("organizationId") id: string, @Param("userId") userId: string, @Param("sessionId") sessionId: string, @Req() req: Request) {
    return this.orgs.revokeMemberSession(id, user.userId, userId, sessionId, req.ip);
  }

  @PermissionArea("team")
  @Post(":organizationId/members/:userId/sessions/revoke-all")
  @UseGuards(TenantGuard, RolesGuard)
  @Roles("OWNER", "ADMIN")
  revokeAllMemberSessions(@CurrentUser() user: AuthUser, @Param("organizationId") id: string, @Param("userId") userId: string, @Req() req: Request) {
    return this.orgs.revokeAllMemberSessions(id, user.userId, userId, req.ip);
  }

  // GB6 (GC16): the caller's own notification preferences.
  @Get(":organizationId/my-notification-preferences")
  @UseGuards(TenantGuard)
  myNotificationPreferences(@CurrentUser() user: AuthUser, @Param("organizationId") id: string) {
    return this.orgs.getMyNotificationPreferences(id, user.userId);
  }

  @Patch(":organizationId/my-notification-preferences")
  @UseGuards(TenantGuard)
  updateMyNotificationPreferences(@CurrentUser() user: AuthUser, @Param("organizationId") id: string, @Body() dto: UpdateNotificationPreferencesDto, @Req() req: Request) {
    return this.orgs.updateMyNotificationPreferences(id, user.userId, dto, req.ip);
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

  // ORG1 (Organization Next OB1): ownership transfer — only the
  // current OWNER; the role swap itself is transactional in the
  // service. Deliberately NOT the role endpoint: OWNER stays
  // unassignable there.
  @PermissionArea("team")
  @Post(":organizationId/transfer-ownership")
  @UseGuards(TenantGuard, RolesGuard)
  @Roles("OWNER")
  transferOwnership(@CurrentUser() user: AuthUser, @Param("organizationId") id: string, @Body() dto: TransferOwnershipDto, @Req() req: Request) {
    return this.orgs.transferOwnership(id, user.userId, dto.targetUserId, req.ip);
  }

  // ORG2: self-leave — any member may call it for THEMSELVES
  // (the service binds the leave to the caller's own membership
  // and refuses the OWNER, who must transfer first).
  @Post(":organizationId/leave")
  @UseGuards(TenantGuard)
  leave(@CurrentUser() user: AuthUser, @Param("organizationId") id: string, @Req() req: Request) {
    return this.orgs.leaveOrganization(id, user.userId, req.ip);
  }

  // ORG3: tenant-side archive / restore — OWNER only. While
  // archived, TenantGuard lets only the owner's lifecycle and
  // export paths through.
  @PermissionArea("settings")
  @Post(":organizationId/archive")
  @UseGuards(TenantGuard, RolesGuard)
  @Roles("OWNER")
  archive(@CurrentUser() user: AuthUser, @Param("organizationId") id: string, @Req() req: Request) {
    return this.orgs.archiveOrganization(id, user.userId, req.ip);
  }

  @PermissionArea("settings")
  @Post(":organizationId/restore")
  @UseGuards(TenantGuard, RolesGuard)
  @Roles("OWNER")
  restore(@CurrentUser() user: AuthUser, @Param("organizationId") id: string, @Req() req: Request) {
    return this.orgs.restoreOrganization(id, user.userId, req.ip);
  }

  // ORG5 (Organization Next OB2): the organization's legal name
  // + regional defaults (currency / timezone / country) — the
  // fields create() accepted but nothing could edit afterwards.
  // Slug is never editable here (TD decision: slugs immutable).
  @PermissionArea("settings")
  @Patch(":organizationId/identity")
  @UseGuards(TenantGuard, RolesGuard)
  @Roles("OWNER", "ADMIN")
  updateIdentity(@CurrentUser() user: AuthUser, @Param("organizationId") id: string, @Body() dto: UpdateOrgIdentityDto, @Req() req: Request) {
    return this.orgs.updateIdentity(id, user.userId, dto, req.ip);
  }

  // ML1 (Multi-Language MB1): the organization's dashboard
  // default UI language (bn | en) — mirrors the identity
  // endpoint's guards/roles exactly.
  @PermissionArea("settings")
  @Patch(":organizationId/locale")
  @UseGuards(TenantGuard, RolesGuard)
  @Roles("OWNER", "ADMIN")
  updateLocale(@CurrentUser() user: AuthUser, @Param("organizationId") id: string, @Body() dto: UpdateOrgLocaleDto, @Req() req: Request) {
    return this.orgs.updateDashboardLocale(id, user.userId, dto, req.ip);
  }

  // ORG11 (Organization Next OB4): org security policy — MFA
  // requirement + session-age cap. GET is any ACTIVE member (the
  // dashboard's OrgStateGate probes it while TenantGuard blocks
  // the org's other APIs, so it sits in the guard's allowlist);
  // PATCH is OWNER-only (RolesGuard + a service-level re-check).
  @Get(":organizationId/security-policy")
  @UseGuards(TenantGuard)
  getSecurityPolicy(@CurrentUser() user: AuthUser, @Param("organizationId") id: string, @Req() req: Request) {
    return this.orgs.getSecurityPolicy(id, user.userId, (req as any).user?.sid);
  }

  @PermissionArea("settings")
  @Patch(":organizationId/security-policy")
  @UseGuards(TenantGuard, RolesGuard)
  @Roles("OWNER")
  updateSecurityPolicy(@CurrentUser() user: AuthUser, @Param("organizationId") id: string, @Body() dto: UpdateSecurityPolicyDto, @Req() req: Request) {
    return this.orgs.updateSecurityPolicy(id, user.userId, dto, req.ip, (req as any).user?.sid);
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

  // GC21 (GB9): merchant verification submit (OWNER/ADMIN) +
  // recorded storage usage (any org staff member).
  @Post(":organizationId/verification/submit")
  @UseGuards(TenantGuard, RolesGuard)
  @Roles("OWNER", "ADMIN")
  submitVerification(@CurrentUser() user: AuthUser, @Param("organizationId") id: string, @Req() req: Request) {
    return this.orgs.submitVerification(id, user.userId, req.ip);
  }

  @Get(":organizationId/storage-usage")
  @UseGuards(TenantGuard)
  storageUsage(@Param("organizationId") id: string) { return this.orgs.storageUsage(id); }

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
  async logo(@Param("organizationId") id: string, @Res({ passthrough: true }) res: Response) {
    // RB4/RM5: CDN-era rows redirect to the stored absolute URL
    // (one release of grace for anything still linking here);
    // legacy rows stream bytes exactly as before.
    const redirect = await this.orgs.logoRedirectUrl(id);
    if (redirect) {
      res.redirect(302, redirect);
      return undefined;
    }
    const logo = await this.orgs.publicLogo(id);
    if (!logo) throw new NotFoundException("No logo for this organization");
    return new StreamableFile(logo.bytes, { type: logo.contentType, disposition: "inline" });
  }
}
