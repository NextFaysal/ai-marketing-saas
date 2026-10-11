import { Module } from "@nestjs/common";
import { CampaignsController } from "./campaigns.controller";
import { CampaignsService } from "./campaigns.service";
import { LlmFactory } from "../ai/llm/llm.factory";
import { PublishingModule } from "../publishing/publishing.module";

@Module({ imports: [PublishingModule], controllers: [CampaignsController], providers: [CampaignsService, LlmFactory], exports: [CampaignsService] })
export class CampaignsModule {}
