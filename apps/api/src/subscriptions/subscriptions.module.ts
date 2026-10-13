import { Module } from "@nestjs/common";
import { SubscriptionsController } from "./subscriptions.controller";
import { SubscriptionsService } from "./subscriptions.service";
import { AuditModule } from "../audit/audit.module";
import { IntegrationsModule } from "../integrations/integrations.module";

/**
 * EC24c — customer subscriptions. IntegrationsModule provides
 * the shared upsertOrder path for renewal orders; it does not
 * import this module, so the graph stays acyclic. AutomationModule
 * imports this module for the commerce_subscription_sweep job.
 */
@Module({
  imports: [AuditModule, IntegrationsModule],
  controllers: [SubscriptionsController],
  providers: [SubscriptionsService],
  exports: [SubscriptionsService],
})
export class SubscriptionsModule {}
