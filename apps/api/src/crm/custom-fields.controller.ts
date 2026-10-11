import { Body, Controller, Get, Param, Patch, Post, Query, UseGuards } from "@nestjs/common";
import { CustomFieldsService } from "./custom-fields.service";
import { CreateCustomFieldDto, UpdateCustomFieldDto } from "./custom-fields.dto";
import { CurrentUser, AuthUser, Roles, PermissionArea } from "../common/decorators";
import { TenantGuard } from "../common/tenant.guard";
import { RolesGuard } from "../common/roles.guard";

/**
 * CRM C4: custom field definitions for leads + customers.
 * Definition management is OWNER/ADMIN only; reads follow the
 * controller's PermissionArea like the rest of the CRM.
 */
@PermissionArea("customers")
@Controller("organizations/:organizationId/crm/custom-fields")
@UseGuards(TenantGuard, RolesGuard)
export class CustomFieldsController {
  constructor(private readonly fields: CustomFieldsService) {}

  @Get()
  list(@Param("organizationId") orgId: string, @Query("entity") entity?: string) {
    return this.fields.listDefs(orgId, entity);
  }

  @Post() @UseGuards(RolesGuard) @Roles("OWNER", "ADMIN")
  create(@CurrentUser() _user: AuthUser, @Param("organizationId") orgId: string, @Body() dto: CreateCustomFieldDto) {
    return this.fields.createDef(orgId, dto);
  }

  @Patch(":defId") @UseGuards(RolesGuard) @Roles("OWNER", "ADMIN")
  update(@Param("organizationId") orgId: string, @Param("defId") defId: string, @Body() dto: UpdateCustomFieldDto) {
    return this.fields.updateDef(orgId, defId, dto);
  }

  @Post(":defId/archive") @UseGuards(RolesGuard) @Roles("OWNER", "ADMIN")
  archive(@Param("organizationId") orgId: string, @Param("defId") defId: string) {
    return this.fields.archiveDef(orgId, defId);
  }
}
