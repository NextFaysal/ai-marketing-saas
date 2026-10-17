import { Module } from "@nestjs/common";
import { CampaignsController } from "./campaigns.controller";
import { CampaignsService } from "./campaigns.service";
import { CampaignFrontierService } from "./frontier.service";
import { LlmFactory } from "../ai/llm/llm.factory";
import { VisionService } from "../ai/vision.service";
import { PublishingModule } from "../publishing/publishing.module";
import { AudiencesModule } from "../audiences/audiences.module";
import { StorageModule } from "../storage/storage.module";
import { CreativesModule } from "../creatives/creatives.module";
import { LandingsModule } from "../landings/landings.module";

// CA5: VisionService is provided HERE as well (the LlmFactory
// precedent — AiModule cannot be imported, it imports
// CampaignsModule) so creative-health can run vision
// estimates; the service is stateless.
// CA28: LandingsModule joins the imports so the builder
// can create EC13 landing pages through LandingsService.
// The landings import graph (Audit/Integrations/Commerce/
// Storefront/Inventory/Affiliates/Fraud/Connections) does
// not import CampaignsModule — the graph stays acyclic
// (proven by the batch boot smoke).
@Module({ imports: [PublishingModule, AudiencesModule, StorageModule, CreativesModule, LandingsModule], controllers: [CampaignsController], providers: [CampaignsService, CampaignFrontierService, LlmFactory, VisionService], exports: [CampaignsService, CampaignFrontierService] })
export class CampaignsModule {}
