
import { Module } from "@nestjs/common";
import { AdminController, PublicStatusController } from "./admin.controller";
import { AdminService } from "./admin.service";
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
  imports: [AutomationModule, IntegrationsModule, PaymentsModule, AuthModule, ConnectionsModule, SocialModule, AdsModule],
  controllers: [AdminController, PublicStatusController],
  providers: [AdminService, SuperAdminGuard],
  exports: [AdminService],
})
export class AdminModule {}
