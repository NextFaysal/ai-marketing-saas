
import { Module } from "@nestjs/common";
import { AdminController, PublicStatusController } from "./admin.controller";
import { AdminService } from "./admin.service";
import { AdminAiController } from "./admin-ai.controller";
import { AdminTranslationsController } from "./admin-translations.controller";
import { AdminTranslationsCoverageService } from "./admin-translations.service";
import { PlatformTeachingService } from "./platform-teaching.service";
import { LearningSourcesService } from "./learning-sources.service";
import { AdminBrainService } from "./admin-brain.service";
import { AdminBrainFixService } from "./admin-brain-fix.service";
import { AdminOversightService } from "./admin-oversight.service";
import { OrgBrainModule } from "../ai/org-brain.module";
import { SuperAdminGuard } from "../common/super-admin.guard";
import { AutomationModule } from "../automation/automation.module";
import { IntegrationsModule } from "../integrations/integrations.module";
import { PaymentsModule } from "../payments/payments.module";
import { AuthModule } from "../auth/auth.module";
import { ConnectionsModule } from "../connections/connections.module";
import { SocialModule } from "../social/social.module";
import { AdsModule } from "../ads/ads.module";

@Module({
  // SocialModule / AdsModule (AB3): AdminService's AN13 operator
  // retries delegate to SocialHealthService / SocialPublishService
  // / AdsService — the tenant side's own services.
  // OrgBrainModule (SA-B23): AdminBrainService reuses the
  // tenant Brain's own services (BrainAdminService overview,
  // AnswerStoreService, LearningService) so the admin view/fix
  // can never drift from — or bypass — the tenant paths.
  imports: [AutomationModule, IntegrationsModule, PaymentsModule, AuthModule, ConnectionsModule, SocialModule, AdsModule, OrgBrainModule],
  controllers: [AdminController, PublicStatusController, AdminAiController, AdminTranslationsController],
  providers: [AdminService, SuperAdminGuard, PlatformTeachingService, LearningSourcesService, AdminBrainService, AdminBrainFixService, AdminOversightService, AdminTranslationsCoverageService],
  exports: [AdminService],
})
export class AdminModule {}
