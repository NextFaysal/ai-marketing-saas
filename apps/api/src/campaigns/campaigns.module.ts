import { Module } from "@nestjs/common";
import { CampaignsController } from "./campaigns.controller";
import { CampaignsService } from "./campaigns.service";
import { CampaignFrontierService } from "./frontier.service";
import { LlmFactory } from "../ai/llm/llm.factory";
import { PublishingModule } from "../publishing/publishing.module";
import { AudiencesModule } from "../audiences/audiences.module";
import { StorageModule } from "../storage/storage.module";

@Module({ imports: [PublishingModule, AudiencesModule, StorageModule], controllers: [CampaignsController], providers: [CampaignsService, CampaignFrontierService, LlmFactory], exports: [CampaignsService, CampaignFrontierService] })
export class CampaignsModule {}
