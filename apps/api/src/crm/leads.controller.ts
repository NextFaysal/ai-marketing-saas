import { Body, Controller, Delete, Get, Header, Param, Patch, Post, Query, UseGuards } from "@nestjs/common";
import { LeadsService } from "./leads.service";
import { CreateLeadDto, UpdateLeadDto, AddNoteDto, MergeLeadDto, ImportLeadsCsvDto, UpdateAssignmentSettingDto } from "./leads.dto";
import { CurrentUser, AuthUser, Roles, PermissionArea } from "../common/decorators";
import { TenantGuard } from "../common/tenant.guard";
import { RolesGuard } from "../common/roles.guard";

@PermissionArea("customers")
@Controller("organizations/:organizationId/leads")
@UseGuards(TenantGuard, RolesGuard)
export class LeadsController {
  constructor(private readonly leads: LeadsService) {}

  @Post() @UseGuards(RolesGuard) @Roles("OWNER", "ADMIN", "MARKETING_MANAGER", "SUPPORT_AGENT")
  create(@CurrentUser() user: AuthUser, @Param("organizationId") orgId: string, @Body() dto: CreateLeadDto) {
    return this.leads.create(orgId, user.userId, dto);
  }

  @Get()
  list(@Param("organizationId") orgId: string, @Query("stage") stage?: string, @Query("source") source?: string, @Query("search") search?: string, @Query("sort") sort?: string) {
    return this.leads.list(orgId, { stage, source, search, sort });
  }

  @Get("pipeline")
  pipeline(@Param("organizationId") orgId: string) { return this.leads.pipeline(orgId); }

  @Get("duplicates")
  duplicates(@Param("organizationId") orgId: string) { return this.leads.duplicates(orgId); }

  @Get("follow-ups")
  followUps(@Param("organizationId") orgId: string) { return this.leads.followUps(orgId); }

  /** CRM C5: lead auto-assignment setting. Reads follow the
   * controller's PermissionArea; changing the strategy is
   * OWNER/ADMIN only (declared before ":leadId" so the literal
   * route wins, like the routes above). */
  @Get("assignment-setting")
  assignmentSetting(@Param("organizationId") orgId: string) { return this.leads.getAssignmentSetting(orgId); }

  @Patch("assignment-setting") @UseGuards(RolesGuard) @Roles("OWNER", "ADMIN")
  updateAssignmentSetting(@Param("organizationId") orgId: string, @Body() dto: UpdateAssignmentSettingDto) {
    return this.leads.updateAssignmentSetting(orgId, dto.strategy);
  }

  /** CRM C3: bulk CSV import (same dialect as the orders importer). */
  @Post("import") @UseGuards(RolesGuard) @Roles("OWNER", "ADMIN", "MARKETING_MANAGER")
  importCsv(@CurrentUser() user: AuthUser, @Param("organizationId") orgId: string, @Body() dto: ImportLeadsCsvDto) {
    return this.leads.importLeadsCsv(orgId, user.userId, dto);
  }

  /** CRM C3: CSV export of this org's leads only. Declared before
   * ":leadId" so the literal wins over the parameter route. */
  @Get("export") @Header("Content-Type", "text/csv; charset=utf-8") @Header("Content-Disposition", "attachment; filename=leads-export.csv")
  exportCsv(@Param("organizationId") orgId: string) { return this.leads.exportCsv(orgId); }

  @Get(":leadId")
  getOne(@Param("organizationId") orgId: string, @Param("leadId") id: string) { return this.leads.getOne(orgId, id); }

  @Patch(":leadId") @UseGuards(RolesGuard) @Roles("OWNER", "ADMIN", "MARKETING_MANAGER", "SUPPORT_AGENT")
  update(@CurrentUser() user: AuthUser, @Param("organizationId") orgId: string, @Param("leadId") id: string, @Body() dto: UpdateLeadDto) {
    return this.leads.update(orgId, user.userId, id, dto);
  }

  @Post(":leadId/notes") @UseGuards(RolesGuard) @Roles("OWNER", "ADMIN", "MARKETING_MANAGER", "SUPPORT_AGENT")
  addNote(@CurrentUser() user: AuthUser, @Param("organizationId") orgId: string, @Param("leadId") id: string, @Body() dto: AddNoteDto) {
    return this.leads.addNote(orgId, user.userId, id, dto.content);
  }

  @Post(":leadId/merge") @UseGuards(RolesGuard) @Roles("OWNER", "ADMIN", "MARKETING_MANAGER")
  merge(@CurrentUser() user: AuthUser, @Param("organizationId") orgId: string, @Param("leadId") leadId: string, @Body() dto: MergeLeadDto) {
    return this.leads.merge(orgId, user.userId, leadId, dto.sourceLeadId);
  }

  @Post(":leadId/convert") @UseGuards(RolesGuard) @Roles("OWNER", "ADMIN", "MARKETING_MANAGER")
  convert(@CurrentUser() user: AuthUser, @Param("organizationId") orgId: string, @Param("leadId") id: string) {
    return this.leads.convertToCustomer(orgId, user.userId, id);
  }

  @Delete(":leadId") @UseGuards(RolesGuard) @Roles("OWNER", "ADMIN")
  remove(@Param("organizationId") orgId: string, @Param("leadId") id: string) { return this.leads.delete(orgId, id); }
}
