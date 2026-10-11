import { Module } from "@nestjs/common";
import { AutomationController } from "./automation.controller";
import { AutomationService } from "./automation.service";
import { InternalJobsController } from "./internal-jobs.controller";
import { IntegrationsModule } from "../integrations/integrations.module";
import { AdsModule } from "../ads/ads.module";
import { AiModule } from "../ai/ai.module";
import { CompetitorsModule } from "../competitors/competitors.module";
import { CampaignsModule } from "../campaigns/campaigns.module";
import { MessagingModule } from "../messaging/messaging.module";
import { AudiencesModule } from "../audiences/audiences.module";
import { InboxModule } from "../inbox/inbox.module";

@Module({
  imports: [IntegrationsModule, AdsModule, AiModule, CompetitorsModule, CampaignsModule, MessagingModule, AudiencesModule, InboxModule],
  controllers: [AutomationController, InternalJobsController],
  providers: [AutomationService],
  exports: [AutomationService],
})
export class AutomationModule {}
