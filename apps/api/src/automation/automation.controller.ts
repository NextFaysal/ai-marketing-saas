import { Body, Controller, Delete, Get, Param, Patch, Post, Query, UseGuards } from "@nestjs/common";
import { AutomationService } from "./automation.service";
import { CreateJobDto, UpdateJobDto, CreateRuleDto, UpdateRuleDto } from "./automation.dto";
import { CurrentUser, AuthUser, Roles, PermissionArea } from "../common/decorators";
import { TenantGuard } from "../common/tenant.guard";
import { RolesGuard } from "../common/roles.guard";

const WRITE_ROLES = ["OWNER", "ADMIN", "MARKETING_MANAGER"];

@PermissionArea("automations")
@Controller("organizations/:organizationId/automation")
@UseGuards(TenantGuard, RolesGuard)
export class AutomationController {
  constructor(private readonly automation: AutomationService) {}

  @Post("jobs") @UseGuards(RolesGuard) @Roles(...WRITE_ROLES)
  createJob(@CurrentUser() user: AuthUser, @Param("organizationId") orgId: string, @Body() dto: CreateJobDto) {
    return this.automation.createJob(orgId, user.userId, dto);
  }
  @Get("jobs")
  listJobs(@Param("organizationId") orgId: string) { return this.automation.listJobs(orgId); }
  @Patch("jobs/:jobId") @UseGuards(RolesGuard) @Roles(...WRITE_ROLES)
  updateJob(@Param("organizationId") orgId: string, @Param("jobId") jobId: string, @Body() dto: UpdateJobDto) {
    return this.automation.updateJob(orgId, jobId, dto);
  }
  @Delete("jobs/:jobId") @UseGuards(RolesGuard) @Roles("OWNER", "ADMIN")
  deleteJob(@Param("organizationId") orgId: string, @Param("jobId") jobId: string) {
    return this.automation.deleteJob(orgId, jobId);
  }
  @Post("jobs/:jobId/run") @UseGuards(RolesGuard) @Roles(...WRITE_ROLES)
  runJob(@CurrentUser() user: AuthUser, @Param("organizationId") orgId: string, @Param("jobId") jobId: string) {
    return this.automation.runJobNow(orgId, user.userId, jobId);
  }

  @Post("rules") @UseGuards(RolesGuard) @Roles(...WRITE_ROLES)
  createRule(@CurrentUser() user: AuthUser, @Param("organizationId") orgId: string, @Body() dto: CreateRuleDto) {
    return this.automation.createRule(orgId, user.userId, dto);
  }
  @Get("rules")
  listRules(@Param("organizationId") orgId: string) { return this.automation.listRules(orgId); }
  @Patch("rules/:ruleId") @UseGuards(RolesGuard) @Roles(...WRITE_ROLES)
  updateRule(@Param("organizationId") orgId: string, @Param("ruleId") ruleId: string, @Body() dto: UpdateRuleDto) {
    return this.automation.updateRule(orgId, ruleId, dto);
  }
  @Delete("rules/:ruleId") @UseGuards(RolesGuard) @Roles("OWNER", "ADMIN")
  deleteRule(@Param("organizationId") orgId: string, @Param("ruleId") ruleId: string) {
    return this.automation.deleteRule(orgId, ruleId);
  }
  @Post("rules/evaluate") @UseGuards(RolesGuard) @Roles(...WRITE_ROLES)
  evaluate(@CurrentUser() user: AuthUser, @Param("organizationId") orgId: string) {
    return this.automation.evaluateRules(orgId, user.userId);
  }
  @Get("runs")
  runs(@Param("organizationId") orgId: string) { return this.automation.listRuns(orgId); }

  // ----- Automations A3: tenant automation health -----
  @Get("health")
  health(@Param("organizationId") orgId: string) { return this.automation.getAutomationHealth(orgId); }
  @Get("dead-letters")
  deadLetters(@Param("organizationId") orgId: string, @Query() q: { take?: string; skip?: string; open?: string }) {
    return this.automation.listOrgDeadLetters(orgId, { take: q?.take, skip: q?.skip, openOnly: q?.open });
  }
  @Post("dead-letters/:dlqId/replay") @UseGuards(RolesGuard) @Roles(...WRITE_ROLES)
  replayDeadLetter(@CurrentUser() user: AuthUser, @Param("organizationId") orgId: string, @Param("dlqId") dlqId: string) {
    return this.automation.replayOrgDeadLetter(orgId, dlqId, user.userId);
  }

  // ----- Automations A4: job template gallery -----
  @Get("job-templates")
  jobTemplates() { return this.automation.listJobTemplates(); }
  @Post("job-templates/:key/install") @UseGuards(RolesGuard) @Roles(...WRITE_ROLES)
  installJobTemplate(@CurrentUser() user: AuthUser, @Param("organizationId") orgId: string, @Param("key") key: string, @Body() dto: { targetId?: string; name?: string }) {
    return this.automation.installJobTemplate(orgId, user.userId, key, dto);
  }
}
