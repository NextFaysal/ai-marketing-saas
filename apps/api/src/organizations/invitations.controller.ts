import { Body, Controller, Get, Param, Post, Req } from "@nestjs/common";
import { Request } from "express";
import { OrganizationsService } from "./organizations.service";
import { AcceptInviteDto } from "./organizations.dto";
import { CurrentUser, AuthUser } from "../common/decorators";

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
}
