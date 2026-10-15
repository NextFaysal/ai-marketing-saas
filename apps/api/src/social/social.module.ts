import { Module } from "@nestjs/common";
import { PublicMediaController, PublicSocialLinkController, SocialController, SocialOAuthCallbackController } from "./social.controller";
import { SocialService } from "./social.service";
import { SocialAiService } from "./social-ai.service";
import { SocialImageService } from "./social-image.service";
import { SocialPublishService } from "./social-publish.service";
import { SocialInsightsService } from "./social-insights.service";
import { SocialOAuthService } from "./social-oauth.service";
import { SocialRasterService } from "./social-raster.service";
import { SocialImportService } from "./social-import.service";
import { SocialQueueService } from "./social-queue.service";
import { SocialMediaLibraryService } from "./social-media-library.service";
import { SocialCommerceDraftService } from "./social-commerce-draft.service";
import { SocialLinkService } from "./social-link.service";
import { SocialHealthService } from "./social-health.service";
import { SocialShareService } from "./social-share.service";
import { SocialStockService } from "./social-stock.service";
import { SocialCoachService } from "./social-coach.service";
import { TelegramClient } from "./telegram.client";
import { ThreadsClient } from "./threads.client";
import { AiModule } from "../ai/ai.module";

@Module({
  imports: [AiModule],
  controllers: [SocialController, PublicMediaController, SocialOAuthCallbackController, PublicSocialLinkController],
  providers: [SocialService, SocialAiService, SocialImageService, SocialPublishService, SocialInsightsService, SocialOAuthService, SocialRasterService, SocialImportService, SocialQueueService, SocialMediaLibraryService, SocialCommerceDraftService, SocialLinkService, SocialHealthService, SocialShareService, SocialStockService, SocialCoachService, TelegramClient, ThreadsClient],
  // SocialHealthService exported for AdminModule (AB3 / AN13
  // operator retry + account recheck delegate to it).
  exports: [SocialService, SocialPublishService, SocialQueueService, SocialCommerceDraftService, SocialLinkService, SocialInsightsService, SocialHealthService, SocialShareService, SocialCoachService],
})
export class SocialModule {}
