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
import { VisionService } from "./vision.service";
import { PromptsService } from "./prompts.service";
import { MentionsService } from "./mentions.service";
import { AssistantApiService } from "./assistant-api.service";
import { AssistantApiController } from "./assistant-api.controller";
import { AssistantApproveController } from "./assistant-approve.controller";
import { GrowthCopilotService } from "./growth-copilot.service";

import { CompetitorsModule } from "../competitors/competitors.module";
import { ProductsModule } from "../products/products.module";
import { InventoryModule } from "../inventory/inventory.module";
import { CommerceModule } from "../commerce/commerce.module";

@Module({
  imports: [AnalyticsModule, AttributionModule, CampaignsModule, MessagingModule, CompetitorsModule, ProductsModule, InventoryModule, CommerceModule],
  controllers: [AiController, AssistantApiController, AssistantApproveController],
  providers: [ReportsService, ChatService, ToolsService, LlmFactory, ProposalsService, ProactiveService, CreativeStudioService, VisionService, PromptsService, MentionsService, AssistantApiService, GrowthCopilotService],
  exports: [ReportsService, ProposalsService, ProactiveService, LlmFactory, VisionService, GrowthCopilotService],
})

export class AiModule {}
