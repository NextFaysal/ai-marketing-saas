import { Module } from "@nestjs/common";
import { AiController } from "./ai.controller";
import { ReportsService } from "./reports.service";
import { ChatService } from "./chat.service";
import { ToolsService } from "./tools.service";
import { LlmFactory } from "./llm/llm.factory";
import { AnalyticsModule } from "../analytics/analytics.module";
import { AttributionModule } from "../attribution/attribution.module";
import { CampaignsModule } from "../campaigns/campaigns.module";
import { MessagingModule } from "../messaging/messaging.module";
import { ProposalsService } from "./proposals.service";
import { ProactiveService } from "./proactive.service";
import { CreativeStudioService } from "./creative-studio.service";

import { CompetitorsModule } from "../competitors/competitors.module";

@Module({
  imports: [AnalyticsModule, AttributionModule, CampaignsModule, MessagingModule, CompetitorsModule],
  controllers: [AiController],
  providers: [ReportsService, ChatService, ToolsService, LlmFactory, ProposalsService, ProactiveService, CreativeStudioService],
  exports: [ReportsService, ProposalsService, ProactiveService],
})

export class AiModule {}
