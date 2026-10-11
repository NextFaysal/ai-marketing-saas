import { Body, Controller, Delete, Get, Param, Patch, Post, Query, UseGuards } from "@nestjs/common";
import { WorkflowsService } from "./workflows.service";
import { CreateWorkflowDto, UpdateWorkflowDto } from "../messaging/messaging.dto";
import { CurrentUser, AuthUser, Roles, PermissionArea } from "../common/decorators";
import { TenantGuard } from "../common/tenant.guard";
import { RolesGuard } from "../common/roles.guard";

const WRITE_ROLES = ["OWNER", "ADMIN", "MARKETING_MANAGER"];

// Workflows W6: the controller joins the M72 custom-
// access map — a member denied the "automations" area
// now loses Workflows too, not just scheduled jobs.
@Controller("organizations/:organizationId/workflows")
@PermissionArea("automations")
@UseGuards(TenantGuard, RolesGuard)
export class WorkflowsController {
  constructor(private readonly workflows: WorkflowsService) {}

  @Post() @UseGuards(RolesGuard) @Roles(...WRITE_ROLES)
  create(@CurrentUser() user: AuthUser, @Param("organizationId") orgId: string, @Body() dto: CreateWorkflowDto) {
    return this.workflows.create(orgId, user.userId, dto);
  }
  @Get()
  list(@Param("organizationId") orgId: string) { return this.workflows.list(orgId); }
  @Patch(":workflowId") @UseGuards(RolesGuard) @Roles(...WRITE_ROLES)
  update(@CurrentUser() user: AuthUser, @Param("organizationId") orgId: string, @Param("workflowId") id: string, @Body() dto: UpdateWorkflowDto) {
    return this.workflows.update(orgId, id, dto, user.userId);
  }
  @Post(":workflowId/clone") @UseGuards(RolesGuard) @Roles(...WRITE_ROLES)
  clone(@CurrentUser() user: AuthUser, @Param("organizationId") orgId: string, @Param("workflowId") id: string, @Body() dto: { name?: string }) {
    return this.workflows.clone(orgId, id, user.userId, dto);
  }
  @Delete(":workflowId") @UseGuards(RolesGuard) @Roles("OWNER", "ADMIN")
  remove(@CurrentUser() user: AuthUser, @Param("organizationId") orgId: string, @Param("workflowId") id: string) {
    return this.workflows.delete(orgId, id, user.userId);
  }
  // Workflows W5: explorer + insights + testing.
  // Literal routes stay ABOVE the :workflowId params.
  @Get("runs")
  runs(@Param("organizationId") orgId: string, @Query("workflowId") workflowId?: string, @Query("status") status?: string, @Query("take") take?: string) {
    return this.workflows.listRuns(orgId, { workflowId, status, take: take ? Number(take) : undefined });
  }
  @Get("stats")
  stats(@Param("organizationId") orgId: string) { return this.workflows.stats(orgId); }
  // Workflows W6: preset gallery.
  @Get("presets")
  presets() { return this.workflows.listPresets(); }
  @Post("presets/:key/install") @UseGuards(RolesGuard) @Roles(...WRITE_ROLES)
  installPreset(@CurrentUser() user: AuthUser, @Param("organizationId") orgId: string, @Param("key") key: string, @Body() dto: { name?: string }) {
    return this.workflows.installPreset(orgId, user.userId, key, dto);
  }
  @Post("runs/:runId/retry") @UseGuards(RolesGuard) @Roles(...WRITE_ROLES)
  retry(@CurrentUser() user: AuthUser, @Param("organizationId") orgId: string, @Param("runId") runId: string) {
    return this.workflows.retryRun(orgId, runId, user.userId);
  }
  @Post(":workflowId/dry-run") @UseGuards(RolesGuard) @Roles(...WRITE_ROLES)
  dryRun(@Param("organizationId") orgId: string, @Param("workflowId") id: string, @Body() dto: { context?: Record<string, any> }) {
    return this.workflows.dryRun(orgId, id, dto?.context ?? {});
  }
  @Post(":workflowId/run") @UseGuards(RolesGuard) @Roles(...WRITE_ROLES)
  run(@CurrentUser() user: AuthUser, @Param("organizationId") orgId: string, @Param("workflowId") id: string, @Body() dto: { context?: Record<string, any> }) {
    return this.workflows.manualRun(orgId, id, user.userId, dto?.context ?? {});
  }
}
