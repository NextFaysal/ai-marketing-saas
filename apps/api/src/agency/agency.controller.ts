import { Body, Controller, Get, Param, Post, Req, UseGuards } from "@nestjs/common";
import { Request } from "express";
import { AgencyConsoleService } from "./agency.service";
import { CreateAgencyCommissionDto } from "./agency.dto";
import { CreateOrganizationDto } from "../organizations/organizations.dto";
import { CurrentUser, AuthUser, Roles } from "../common/decorators";
import { TenantGuard } from "../common/tenant.guard";
import { RolesGuard } from "../common/roles.guard";

/**
 * NF15 (FB5) — Agency console, user-level surface. Authenticated
 * user only, NO org param: the console is built from the
 * caller's own ACTIVE memberships (OrganizationsService
 * .listMine) — there is deliberately no way to ask for another
 * user's or another org's view here. The global JwtAuthGuard
 * authenticates; no TenantGuard applies (no :organizationId).
 */
@Controller("agency")
export class AgencyController {
  constructor(private readonly agency: AgencyConsoleService) {}

  @Get("console")
  getConsole(@CurrentUser() user: AuthUser) {
    return this.agency.getConsole(user.userId);
  }

  @Post("client-orgs")
  createClientOrg(@CurrentUser() user: AuthUser, @Body() dto: CreateOrganizationDto, @Req() req: Request) {
    return this.agency.createClientOrg(user.userId, dto, req.ip);
  }
}

/**
 * NF15 — Commission records, org-scoped surface. TenantGuard
 * scopes the caller to :organizationId (ACTIVE membership) and
 * RolesGuard + @Roles("OWNER","ADMIN") gate both verbs, exactly
 * like neighbouring org-scoped modules. Entries list ONLY for
 * the agency org in the path — the org the caller is OWNER/ADMIN
 * of — and creating an entry additionally requires the caller
 * to be a member of the client org (service-enforced).
 * RECORDS ONLY: no money moves on either verb.
 */
@Controller("organizations/:organizationId/agency-commissions")
@UseGuards(TenantGuard, RolesGuard)
export class AgencyCommissionsController {
  constructor(private readonly agency: AgencyConsoleService) {}

  @Get() @Roles("OWNER", "ADMIN")
  list(@CurrentUser() user: AuthUser, @Param("organizationId") orgId: string) {
    return this.agency.listCommissions(orgId, user.userId);
  }

  @Post() @Roles("OWNER", "ADMIN")
  create(
    @CurrentUser() user: AuthUser,
    @Param("organizationId") orgId: string,
    @Body() dto: CreateAgencyCommissionDto,
    @Req() req: Request,
  ) {
    return this.agency.createCommission(orgId, user.userId, dto, req.ip);
  }
}
