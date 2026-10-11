import { Module } from "@nestjs/common";
import { AnalyticsController } from "./analytics.controller";
import { AnalyticsService } from "./analytics.service";
import { CohortService } from "./cohort.service";
@Module({ controllers: [AnalyticsController], providers: [AnalyticsService, CohortService], exports: [AnalyticsService] })
export class AnalyticsModule {}
