import { Module } from "@nestjs/common";
import { PublicMediaController, SocialController, SocialOAuthCallbackController } from "./social.controller";
import { SocialService } from "./social.service";
import { SocialAiService } from "./social-ai.service";
import { SocialImageService } from "./social-image.service";
import { SocialPublishService } from "./social-publish.service";
import { SocialInsightsService } from "./social-insights.service";
import { SocialOAuthService } from "./social-oauth.service";
import { SocialRasterService } from "./social-raster.service";
import { SocialImportService } from "./social-import.service";
import { AiModule } from "../ai/ai.module";

@Module({
  imports: [AiModule],
  controllers: [SocialController, PublicMediaController, SocialOAuthCallbackController],
  providers: [SocialService, SocialAiService, SocialImageService, SocialPublishService, SocialInsightsService, SocialOAuthService, SocialRasterService, SocialImportService],
  exports: [SocialService, SocialPublishService],
})
export class SocialModule {}
