import { Module } from "@nestjs/common";
import { AgencyController, AgencyCommissionsController } from "./agency.controller";
import { AgencyConsoleService } from "./agency.service";
import { OrganizationsModule } from "../organizations/organizations.module";
import { AnalyticsModule } from "../analytics/analytics.module";

/**
 * NF15 (FB5) — Agency / reseller console. Dependencies ride
 * EXISTING modules only: OrganizationsModule supplies
 * OrganizationsService (listMine = the membership basis, create
 * = client-org creation with TD1 slug governance + the ORG12
 * cap inside) and AnalyticsModule supplies AnalyticsService
 * (the dashboard home's own overview path). Neither module
 * imports this one, so the graph stays acyclic. PrismaService
 * and AuditService are global.
 */
@Module({
  imports: [OrganizationsModule, AnalyticsModule],
  controllers: [AgencyController, AgencyCommissionsController],
  providers: [AgencyConsoleService],
  exports: [AgencyConsoleService],
})
export class AgencyModule {}
