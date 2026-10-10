import { Body, Controller, Delete, Get, Param, Patch, Post, Query, UseGuards } from "@nestjs/common";
import { LeadsService } from "./leads.service";
import { CreateLeadDto, UpdateLeadDto, AddNoteDto, MergeLeadDto } from "./leads.dto";
import { CurrentUser, AuthUser, Roles } from "../common/decorators";
import { TenantGuard } from "../common/tenant.guard";
import { RolesGuard } from "../common/roles.guard";

@Controller("organizations/:organizationId/leads")
@UseGuards(TenantGuard)
export class LeadsController {
  constructor(private readonly leads: LeadsService) {}

  @Post() @UseGuards(RolesGuard) @Roles("OWNER", "ADMIN", "MARKETING_MANAGER", "SUPPORT_AGENT")
  create(@CurrentUser() user: AuthUser, @Param("organizationId") orgId: string, @Body() dto: CreateLeadDto) {
    return this.leads.create(orgId, user.userId, dto);
  }

  @Get()
  list(@Param("organizationId") orgId: string, @Query("stage") stage?: string, @Query("source") source?: string, @Query("search") search?: string) {
    return this.leads.list(orgId, { stage, source, search });
  }

  @Get("pipeline")
  pipeline(@Param("organizationId") orgId: string) { return this.leads.pipeline(orgId); }

  @Get("duplicates")
  duplicates(@Param("organizationId") orgId: string) { return this.leads.duplicates(orgId); }

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
