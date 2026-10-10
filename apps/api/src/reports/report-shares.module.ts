import { Module } from "@nestjs/common";
import { ReportSharesController, PublicReportsController } from "./report-shares.controller";
import { ReportSharesService } from "./report-shares.service";
import { AnalyticsModule } from "../analytics/analytics.module";

@Module({
  imports: [AnalyticsModule],
  controllers: [ReportSharesController, PublicReportsController],
  providers: [ReportSharesService],
  exports: [ReportSharesService],
})
export class ReportSharesModule {}
