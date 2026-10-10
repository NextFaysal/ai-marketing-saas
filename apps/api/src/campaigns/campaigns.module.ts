import { Module } from "@nestjs/common";
import { CampaignsController } from "./campaigns.controller";
import { CampaignsService } from "./campaigns.service";
import { LlmFactory } from "../ai/llm/llm.factory";

@Module({ controllers: [CampaignsController], providers: [CampaignsService, LlmFactory], exports: [CampaignsService] })
export class CampaignsModule {}
