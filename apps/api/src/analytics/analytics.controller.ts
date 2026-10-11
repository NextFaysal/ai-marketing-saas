import { Body, Controller, Get, Param, Post, Query, UseGuards } from "@nestjs/common";
import { AnalyticsService } from "./analytics.service";
import { CohortService } from "./cohort.service";
import { TenantGuard } from "../common/tenant.guard";
import { RolesGuard } from "../common/roles.guard";
import { Roles } from "../common/decorators";

@Controller("organizations/:organizationId/analytics")
@UseGuards(TenantGuard)
export class AnalyticsController {
  constructor(
    private readonly analytics: AnalyticsService,
    private readonly cohort: CohortService,
  ) {}

  @Get("cohorts")
  cohorts(@Param("organizationId") orgId: string) {
    return this.cohort.cohorts(orgId);
  }

  @Get("churn-risk")
  churnRisk(@Param("organizationId") orgId: string) {
    return this.cohort.churnRisk(orgId);
  }

  @Get("overview")
  overview(@Param("organizationId") orgId: string, @Query("from") from?: string, @Query("to") to?: string) {
    return this.analytics.overview(orgId, from, to);
  }

  @Post("recompute") @UseGuards(RolesGuard) @Roles("OWNER", "ADMIN", "MARKETING_MANAGER")
  recompute(@Param("organizationId") orgId: string, @Body() body: { from?: string; to?: string }) {
    return this.analytics.recomputeAggregates(orgId, body?.from, body?.to);
  }
}
