import { Body, Controller, Get, Param, Post, Req } from "@nestjs/common";
import { Request } from "express";
import { OrganizationsService } from "./organizations.service";
import { AcceptInviteDto, RequestToJoinDto } from "./organizations.dto";
import { CurrentUser, AuthUser, Public } from "../common/decorators";

/**
 * Invitation acceptance surface (Milestone 34). Authenticated by
 * the global JWT guard — deliberately NO TenantGuard: the invitee
 * is not a member yet. The service binds acceptance to the
 * signed-in account's email matching the invitation.
 */
@Controller("invitations")
export class InvitationsController {
  constructor(private readonly orgs: OrganizationsService) {}

  @Get(":token")
  view(@CurrentUser() user: AuthUser, @Param("token") token: string) {
    return this.orgs.getInvitationForUser(user, token);
  }

  @Post("accept")
  accept(@CurrentUser() user: AuthUser, @Body() dto: AcceptInviteDto, @Req() req: Request) {
    return this.orgs.acceptInvitation(user, dto.token, req.ip);
  }

  // ORG9 (Organization Next OB3): public information about a
  // shareable invite LINK — genuinely signed-out (@Public). The
  // service answers uniformly (same 404) for unknown, revoked,
  // expired and exhausted links, so nothing can be probed.
  @Public()
  @Get("link/:token")
  linkInfo(@Param("token") token: string) {
    return this.orgs.getInviteLinkPublic(token);
  }

  // ORG10: following a link files a join REQUEST (JWT required,
  // no TenantGuard — the requester is not a member yet). Only an
  // OWNER/ADMIN approval turns it into a membership.
  @Post("link/:token/request")
  requestToJoin(@CurrentUser() user: AuthUser, @Param("token") token: string, @Body() dto: RequestToJoinDto, @Req() req: Request) {
    return this.orgs.requestToJoin(user, token, dto, req.ip);
  }

  // ORG10: the caller's OWN latest request behind this link
  // (the /join page revisits). Never anyone else's.
  @Get("link/:token/my-request")
  myJoinRequest(@CurrentUser() user: AuthUser, @Param("token") token: string) {
    return this.orgs.getMyJoinRequest(user, token);
  }
}
