import { Module } from "@nestjs/common";
import { APP_GUARD } from "@nestjs/core";
import { PrismaModule } from "./prisma/prisma.module";
import { AuditModule } from "./audit/audit.module";
import { AuthModule } from "./auth/auth.module";
import { OrganizationsModule } from "./organizations/organizations.module";
import { HealthModule } from "./health/health.module";
import { ProductsModule } from "./products/products.module";
import { ImportsModule } from "./imports/imports.module";
import { KnowledgeModule } from "./knowledge/knowledge.module";
import { IntegrationsModule } from "./integrations/integrations.module";
import { OrdersModule } from "./orders/orders.module";
import { TrackingModule } from "./tracking/tracking.module";
import { AttributionModule } from "./attribution/attribution.module";
import { AdsModule } from "./ads/ads.module";
import { AnalyticsModule } from "./analytics/analytics.module";
import { AiModule } from "./ai/ai.module";
import { InboxModule } from "./inbox/inbox.module";
import { CrmModule } from "./crm/crm.module";
import { CompetitorsModule } from "./competitors/competitors.module";
import { CampaignsModule } from "./campaigns/campaigns.module";
import { AutomationModule } from "./automation/automation.module";
import { EventsModule } from "./common/events.service";
import { MessagingModule } from "./messaging/messaging.module";
import { WorkflowsModule } from "./workflows/workflows.module";
import { CourierModule } from "./courier/courier.module";
import { CustomersModule } from "./customers/customers.module";
import { ConversionsModule } from "./conversions/conversions.module";
import { OfflineConversionsModule } from "./offline-conversions/offline-conversions.module";
import { PortfolioModule } from "./portfolio/portfolio.module";
import { PaymentsModule } from "./payments/payments.module";
import { SupportModule } from "./support/support.module";
import { FeedbackModule } from "./feedback/feedback.module";
import { InventoryModule } from "./inventory/inventory.module";
import { AdminModule } from "./admin/admin.module";
import { CreativesModule } from "./creatives/creatives.module";
import { AudiencesModule } from "./audiences/audiences.module";
import { CatalogsModule } from "./catalogs/catalogs.module";
import { PublishingModule } from "./publishing/publishing.module";
import { ReportSharesModule } from "./reports/report-shares.module";
import { SocialModule } from "./social/social.module";
import { Cx8Module } from "./cx8/cx8.module";
import { CommerceModule } from "./commerce/commerce.module";
import { FulfillmentModule } from "./fulfillment/fulfillment.module";
import { StorefrontModule } from "./storefront/storefront.module";
import { LandingsModule } from "./landings/landings.module";
import { FeedsModule } from "./feeds/feeds.module";
import { PurchasingModule } from "./purchasing/purchasing.module";
import { WarehouseModule } from "./warehouse/warehouse.module";
import { DeliveryModule } from "./delivery/delivery.module";
import { TaxModule } from "./tax/tax.module";
import { ReconciliationModule } from "./reconciliation/reconciliation.module";
import { SubscriptionsModule } from "./subscriptions/subscriptions.module";
import { ConnectionsModule } from "./connections/connections.module";
import { InstallmentsModule } from "./installments/installments.module";
import { AffiliatesModule } from "./affiliates/affiliates.module";
import { PosModule } from "./pos/pos.module";
import { OrderNotificationsModule } from "./order-notifications/order-notifications.module";
import { OrderAutomationModule } from "./order-automation/order-automation.module";
import { JwtAuthGuard } from "./common/jwt-auth.guard";
import { ThrottlerGuard } from "./common/throttler.guard";

@Module({
  imports: [PrismaModule, AuditModule, AuthModule, OrganizationsModule, HealthModule, ProductsModule, ImportsModule, KnowledgeModule, IntegrationsModule, OrdersModule, TrackingModule, AttributionModule, AdsModule, AnalyticsModule, AiModule, InboxModule, CrmModule, CompetitorsModule, CampaignsModule, AutomationModule, EventsModule, MessagingModule, WorkflowsModule, CourierModule, CustomersModule, ConversionsModule, OfflineConversionsModule, PortfolioModule, AdminModule, CreativesModule, AudiencesModule, CatalogsModule, PublishingModule, ReportSharesModule, PaymentsModule, SupportModule, FeedbackModule, InventoryModule, SocialModule, Cx8Module, CommerceModule, FulfillmentModule, StorefrontModule, LandingsModule, FeedsModule, PurchasingModule, WarehouseModule, DeliveryModule, TaxModule, ReconciliationModule, SubscriptionsModule, ConnectionsModule, InstallmentsModule, AffiliatesModule, PosModule, OrderNotificationsModule, OrderAutomationModule],
  // Milestone 61: the throttler runs BEFORE the JWT guard so
  // brute force is rejected before any password verification.
  providers: [
    { provide: APP_GUARD, useClass: ThrottlerGuard },
    { provide: APP_GUARD, useClass: JwtAuthGuard },
  ],
})
export class AppModule {}
