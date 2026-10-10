import { Body, Controller, Delete, Get, Param, Patch, Post, UseGuards } from "@nestjs/common";
import { WorkflowsService } from "./workflows.service";
import { CreateWorkflowDto, UpdateWorkflowDto } from "../messaging/messaging.dto";
import { CurrentUser, AuthUser, Roles } from "../common/decorators";
import { TenantGuard } from "../common/tenant.guard";
import { RolesGuard } from "../common/roles.guard";

const WRITE_ROLES = ["OWNER", "ADMIN", "MARKETING_MANAGER"];

@Controller("organizations/:organizationId/workflows")
@UseGuards(TenantGuard)
export class WorkflowsController {
  constructor(private readonly workflows: WorkflowsService) {}

  @Post() @UseGuards(RolesGuard) @Roles(...WRITE_ROLES)
  create(@CurrentUser() user: AuthUser, @Param("organizationId") orgId: string, @Body() dto: CreateWorkflowDto) {
    return this.workflows.create(orgId, user.userId, dto);
  }
  @Get()
  list(@Param("organizationId") orgId: string) { return this.workflows.list(orgId); }
  @Patch(":workflowId") @UseGuards(RolesGuard) @Roles(...WRITE_ROLES)
  update(@Param("organizationId") orgId: string, @Param("workflowId") id: string, @Body() dto: UpdateWorkflowDto) {
    return this.workflows.update(orgId, id, dto);
  }
  @Delete(":workflowId") @UseGuards(RolesGuard) @Roles("OWNER", "ADMIN")
  remove(@Param("organizationId") orgId: string, @Param("workflowId") id: string) {
    return this.workflows.delete(orgId, id);
  }
  @Get("runs")
  runs(@Param("organizationId") orgId: string) { return this.workflows.listRuns(orgId); }
}
