import { Controller, Get, Param, Query, UseGuards } from "@nestjs/common";
import { LeadsService } from "./leads.service";
import { PermissionArea } from "../common/decorators";
import { TenantGuard } from "../common/tenant.guard";
import { RolesGuard } from "../common/roles.guard";

/**
 * CRM C6: read-only CRM reporting under the `crm` path family
 * (the same prefix CustomFieldsController uses). The funnel is
 * computed from real Lead rows only — see LeadsService.funnel
 * and docs/crm-c6-acceptance.md for the definitions.
 */
@PermissionArea("customers")
@Controller("organizations/:organizationId/crm")
@UseGuards(TenantGuard, RolesGuard)
export class CrmReportController {
  constructor(private readonly leads: LeadsService) {}

  /** Lead funnel per source over the last `days` Dhaka calendar
   * days (1..365, default 30). */
  @Get("funnel")
  funnel(@Param("organizationId") orgId: string, @Query("days") days?: string) {
    return this.leads.funnel(orgId, days);
  }
}
