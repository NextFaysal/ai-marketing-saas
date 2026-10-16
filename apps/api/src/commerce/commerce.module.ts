import { Module } from "@nestjs/common";
import { AbandonedSequenceController, CommerceController } from "./commerce.controller";
import { CommerceService } from "./commerce.service";
import { SyncOutboxService } from "./sync-outbox.service";
import { CatalogPushService } from "./catalog-push.service";
import { OrderPushService } from "./order-push.service";
import { CustomerPushService } from "./customer-push.service";
import { DiscountsService } from "./discounts.service";
import { PromotionsService } from "./promotions.service";
import { BundlesService } from "./bundles.service";
import { AbandonedCheckoutsService } from "./abandoned-checkouts.service";
import { CommerceAnalyticsService } from "./commerce-analytics.service";
import { LoyaltyService } from "./loyalty.service";
import { GiftCardsService } from "./gift-cards.service";
import { LicenseKeysService } from "./license-keys.service";
import { PriceListsService } from "./price-lists.service";
import { QuotesService } from "./quotes.service";
import { QuotesPublicController } from "./quotes-public.controller";
import { CommerceAdapterRegistry } from "../integrations/commerce/adapters";
import { AuditModule } from "../audit/audit.module";
import { MessagingModule } from "../messaging/messaging.module";
import { TrackingModule } from "../tracking/tracking.module";

@Module({
  imports: [AuditModule, MessagingModule, TrackingModule],
  // AX18: AbandonedSequenceController serves the canonical
  // organizations/:organizationId/abandoned-checkouts/:id/sequence
  // route (outside CommerceController's commerce prefix).
  controllers: [CommerceController, AbandonedSequenceController, QuotesPublicController],
  providers: [
    SyncOutboxService,
    CommerceService,
    CommerceAdapterRegistry,
    CatalogPushService,
    OrderPushService,
    CustomerPushService,
    DiscountsService,
    PromotionsService,
    BundlesService,
    AbandonedCheckoutsService,
    CommerceAnalyticsService,
    LoyaltyService,
    GiftCardsService,
    LicenseKeysService,
    PriceListsService,
    QuotesService,
  ],
  // AX18: AbandonedCheckoutsService is exported for the
  // workflow engine's issue_recovery_coupon action
  // (WorkflowsModule imports CommerceModule — commerce never
  // imports workflows, so there is no module cycle).
  exports: [SyncOutboxService, CommerceService, CatalogPushService, OrderPushService, CustomerPushService, DiscountsService, PromotionsService, BundlesService, AbandonedCheckoutsService, CommerceAnalyticsService, LoyaltyService, GiftCardsService, LicenseKeysService, PriceListsService, QuotesService],
})
export class CommerceModule {}
