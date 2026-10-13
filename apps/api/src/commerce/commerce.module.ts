import { Module } from "@nestjs/common";
import { CommerceController } from "./commerce.controller";
import { CommerceService } from "./commerce.service";
import { SyncOutboxService } from "./sync-outbox.service";
import { CatalogPushService } from "./catalog-push.service";
import { OrderPushService } from "./order-push.service";
import { CustomerPushService } from "./customer-push.service";
import { DiscountsService } from "./discounts.service";
import { AbandonedCheckoutsService } from "./abandoned-checkouts.service";
import { CommerceAnalyticsService } from "./commerce-analytics.service";
import { CommerceAdapterRegistry } from "../integrations/commerce/adapters";
import { AuditModule } from "../audit/audit.module";
import { MessagingModule } from "../messaging/messaging.module";
import { TrackingModule } from "../tracking/tracking.module";

@Module({
  imports: [AuditModule, MessagingModule, TrackingModule],
  controllers: [CommerceController],
  providers: [
    SyncOutboxService,
    CommerceService,
    CommerceAdapterRegistry,
    CatalogPushService,
    OrderPushService,
    CustomerPushService,
    DiscountsService,
    AbandonedCheckoutsService,
    CommerceAnalyticsService,
  ],
  exports: [SyncOutboxService, CommerceService, CatalogPushService, OrderPushService, CustomerPushService, DiscountsService, CommerceAnalyticsService],
})
export class CommerceModule {}
