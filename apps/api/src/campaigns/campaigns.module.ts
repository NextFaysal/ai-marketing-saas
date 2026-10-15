import { Module } from "@nestjs/common";
import { CampaignsController } from "./campaigns.controller";
import { CampaignsService } from "./campaigns.service";
import { CampaignFrontierService } from "./frontier.service";
import { LlmFactory } from "../ai/llm/llm.factory";
import { PublishingModule } from "../publishing/publishing.module";
import { AudiencesModule } from "../audiences/audiences.module";

@Module({ imports: [PublishingModule, AudiencesModule], controllers: [CampaignsController], providers: [CampaignsService, CampaignFrontierService, LlmFactory], exports: [CampaignsService, CampaignFrontierService] })
export class CampaignsModule {}
