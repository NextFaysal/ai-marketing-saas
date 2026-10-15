import { Module } from "@nestjs/common";
import { AutomationController } from "./automation.controller";
import { AutomationService } from "./automation.service";
import { InventoryAdGuardService } from "./inventory-ad-guard.service";
import { PredictiveReplenishmentService } from "./predictive-replenishment.service";
import { InternalJobsController } from "./internal-jobs.controller";
import { IntegrationsModule } from "../integrations/integrations.module";
import { AdsModule } from "../ads/ads.module";
import { AiModule } from "../ai/ai.module";
import { CompetitorsModule } from "../competitors/competitors.module";
import { CampaignsModule } from "../campaigns/campaigns.module";
import { MessagingModule } from "../messaging/messaging.module";
import { AudiencesModule } from "../audiences/audiences.module";
import { InboxModule } from "../inbox/inbox.module";
import { CrmModule } from "../crm/crm.module";
import { PaymentsModule } from "../payments/payments.module";
import { SocialModule } from "../social/social.module";
import { ReportSharesModule } from "../reports/report-shares.module";
import { CourierModule } from "../courier/courier.module";
import { OrdersModule } from "../orders/orders.module";
import { CommerceModule } from "../commerce/commerce.module";
import { SubscriptionsModule } from "../subscriptions/subscriptions.module";
import { StorefrontModule } from "../storefront/storefront.module";
import { InstallmentsModule } from "../installments/installments.module";
import { ConnectionsModule } from "../connections/connections.module";
import { FulfillmentModule } from "../fulfillment/fulfillment.module";
import { OrderAutomationModule } from "../order-automation/order-automation.module";
import { StorageModule } from "../storage/storage.module";
import { ProductsModule } from "../products/products.module";

@Module({
  imports: [IntegrationsModule, AdsModule, AiModule, CompetitorsModule, CampaignsModule, MessagingModule, AudiencesModule, InboxModule, CrmModule, PaymentsModule, SocialModule, ReportSharesModule, CourierModule, OrdersModule, CommerceModule, SubscriptionsModule, StorefrontModule, InstallmentsModule, ConnectionsModule, FulfillmentModule, OrderAutomationModule, StorageModule, ProductsModule],
  controllers: [AutomationController, InternalJobsController],
  providers: [AutomationService, InventoryAdGuardService, PredictiveReplenishmentService],
  exports: [AutomationService, InventoryAdGuardService, PredictiveReplenishmentService],
})
export class AutomationModule {}
