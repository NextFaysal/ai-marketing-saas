import { Module } from "@nestjs/common";
import { ReportSharesController, PublicReportsController } from "./report-shares.controller";
import { ReportSharesService } from "./report-shares.service";
import { ReportsController } from "./reports.controller";
import { ReportCenterService } from "./report-center.service";
import { CustomReportsService } from "./custom-reports.service";
import { ReportExportService } from "./report-export.service";
import { ReportGoalsService } from "./report-goals.service";
import { ExecutiveService } from "./executive.service";
import { AnalyticsModule } from "../analytics/analytics.module";
import { CampaignsModule } from "../campaigns/campaigns.module";

@Module({
  imports: [AnalyticsModule, CampaignsModule],
  controllers: [ReportSharesController, PublicReportsController, ReportsController],
  providers: [ReportSharesService, ReportCenterService, CustomReportsService, ReportExportService, ReportGoalsService, ExecutiveService],
  exports: [ReportSharesService, ReportCenterService, CustomReportsService, ReportExportService, ReportGoalsService, ExecutiveService],
})
export class ReportSharesModule {}
