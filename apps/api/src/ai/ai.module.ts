import { Module } from "@nestjs/common";
import { AiController } from "./ai.controller";
import { ReportsService } from "./reports.service";
import { ChatService } from "./chat.service";
import { ToolsService } from "./tools.service";
import { LlmFactory } from "./llm/llm.factory";
import { AnalyticsModule } from "../analytics/analytics.module";
import { AttributionModule } from "../attribution/attribution.module";

@Module({
  imports: [AnalyticsModule, AttributionModule],
  controllers: [AiController],
  providers: [ReportsService, ChatService, ToolsService, LlmFactory],
  exports: [ReportsService],
})
export class AiModule {}
