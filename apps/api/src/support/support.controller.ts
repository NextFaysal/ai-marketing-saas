import { Body, Controller, Get, Param, Post, Query, Req, UseGuards } from "@nestjs/common";
import { IsIn, IsOptional, IsString, MinLength } from "class-validator";
import { SupportService } from "./support.service";
import { TenantGuard } from "../common/tenant.guard";
import { RolesGuard } from "../common/roles.guard";
import { SuperAdminGuard, AdminTier } from "../common/super-admin.guard";
import { CurrentUser, Roles, type AuthUser } from "../common/decorators";

class CreateTicketDto {
  @IsString() @MinLength(3) subject!: string;
  @IsString() @MinLength(1) body!: string;
  @IsOptional() @IsIn(["normal", "high"]) priority?: string;
}
class ReplyDto { @IsString() @MinLength(1) body!: string; }
class TenantStatusDto { @IsIn(["closed", "open"]) status!: string; }
class AdminTicketUpdateDto {
  @IsOptional() @IsIn(["open", "pending", "resolved", "closed"]) status?: string;
  @IsOptional() @IsString() assignedToId?: string | null;
  @IsOptional() @IsIn(["normal", "high"]) priority?: string;
}

@Controller("organizations")
@UseGuards(TenantGuard, RolesGuard)
export class TenantSupportController {
  constructor(private readonly support: SupportService) {}

  @Post(":organizationId/tickets")
  @Roles("OWNER", "ADMIN", "MARKETING_MANAGER", "ADVERTISER", "SUPPORT_AGENT", "ANALYST", "VIEWER")
  create(@CurrentUser() user: AuthUser, @Param("organizationId") id: string, @Body() dto: CreateTicketDto) {
    return this.support.createTicket(id, user.userId, dto);
  }

  @Get(":organizationId/tickets")
  @Roles("OWNER", "ADMIN", "MARKETING_MANAGER", "ADVERTISER", "SUPPORT_AGENT", "ANALYST", "VIEWER")
  list(@Param("organizationId") id: string) { return this.support.listTickets(id); }

  @Get(":organizationId/tickets/:ticketId")
  @Roles("OWNER", "ADMIN", "MARKETING_MANAGER", "ADVERTISER", "SUPPORT_AGENT", "ANALYST", "VIEWER")
  get(@Param("organizationId") id: string, @Param("ticketId") ticketId: string) {
    return this.support.getTicket(id, ticketId);
  }

  @Post(":organizationId/tickets/:ticketId/messages")
  @Roles("OWNER", "ADMIN", "MARKETING_MANAGER", "ADVERTISER", "SUPPORT_AGENT", "ANALYST", "VIEWER")
  reply(@CurrentUser() user: AuthUser, @Param("organizationId") id: string, @Param("ticketId") ticketId: string, @Body() dto: ReplyDto) {
    return this.support.replyAsTenant(id, user.userId, ticketId, dto.body);
  }

  @Post(":organizationId/tickets/:ticketId/status")
  @Roles("OWNER", "ADMIN", "MARKETING_MANAGER", "ADVERTISER", "SUPPORT_AGENT", "ANALYST", "VIEWER")
  status(@Param("organizationId") id: string, @Param("ticketId") ticketId: string, @Body() dto: TenantStatusDto) {
    return this.support.setTenantStatus(id, ticketId, dto.status);
  }
}

@Controller("admin/tickets")
@UseGuards(SuperAdminGuard)
export class AdminSupportController {
  constructor(private readonly support: SupportService) {}

  @Get() list(@Query("status") status?: string, @Query("organizationId") organizationId?: string) {
    return this.support.listTicketsAdmin({ status, organizationId });
  }
  @Get(":id") get(@Param("id") id: string) { return this.support.getTicketAdmin(id); }

  @Post(":id/messages") @AdminTier("SUPER", "SUPPORT")
  reply(@Req() req: any, @Param("id") id: string, @Body() dto: ReplyDto) {
    return this.support.replyAsAdmin(req.adminUser, id, dto.body, req.ip);
  }

  @Post(":id/status") @AdminTier("SUPER", "SUPPORT")
  update(@Req() req: any, @Param("id") id: string, @Body() dto: AdminTicketUpdateDto) {
    return this.support.updateAsAdmin(req.adminUser, id, dto, req.ip);
  }
}
