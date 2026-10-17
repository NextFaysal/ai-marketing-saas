import { Module } from "@nestjs/common";
import { OrdersController } from "./orders.controller";
import { OrdersService } from "./orders.service";
import { RiskService } from "./risk.service";
import { ReviewsService } from "./reviews.service";
import { ReviewsController, PublicReviewController } from "./reviews.controller";
import { OrderChaseService } from "./order-chase.service";
import { OrderChaseController } from "./order-chase.controller";
import { IntegrationsModule } from "../integrations/integrations.module";
import { InventoryModule } from "../inventory/inventory.module";
import { MessagingModule } from "../messaging/messaging.module";
import { CommerceModule } from "../commerce/commerce.module";

import { PackingScanController } from "./packing-scan.controller";
import { PackingScanService } from "./packing-scan.service";
import { ProductReviewsService } from "./product-reviews.service";
import { ProductReviewsController, PublicProductReviewsController } from "./product-reviews.controller";
import { ReviewInsightsService } from "./review-insights.service";
import { ReviewInsightsController, PublicReviewInsightController } from "./review-insights.controller";
import { LlmFactory } from "../ai/llm/llm.factory";
import { OrderInsightsService } from "./order-insights.service";
import { FraudModule } from "../fraud/fraud.module";
import { FraudNetworkModule } from "../fraud-network/fraud-network.module";
import { FraudShieldService } from "./fraud-shield.service";
import { OrderSurgeryService } from "./order-surgery.service";
import { OrderProfitService } from "./order-profit.service";
import { OrderProfitController } from "./order-profit.controller";
import { OrderAnalyticsService } from "./order-analytics.service";
import { OrderAnalyticsController } from "./order-analytics.controller";
import { PrintCenterService } from "./print-center.service";
import { PrintCenterController } from "./print-center.controller";
import { OrderTeamPerformanceService } from "./order-team-performance.service";
import { OrderTeamPerformanceController } from "./order-team-performance.controller";
import { StorefrontModule } from "../storefront/storefront.module";
import { ConnectionsModule } from "../connections/connections.module";
import { StorageModule } from "../storage/storage.module";
import { SocialModule } from "../social/social.module";
import { PaymentResendService } from "./payment-resend.service";

// Milestone 65: manual orders enter via the integrations upsert.
// Sales & Data S2: InventoryModule supplies the stock-restore
// calls for cancel/return status changes.
// CX12b: ReviewsService lives here (exported for the inbox
// capture hook + the automation sweep); MessagingModule supplies
// its SMS/email fallback providers and has no imports (no cycle).
// CX7: OrderChaseService lives here too (exported for the
// automation sweep; it sends only through the structural
// ChaseChatSender AutomationService passes in — no cycle).
// CX8 (owner series): PackingScanController/Service for parcel
// packing verification. EC5/EC9: CommerceModule supplies the
// fulfillment/RMA services OrdersService composes.
// ON3: StorefrontModule supplies StorefrontService for the
// surgery delivery recalc — cycle-free (the Storefront chain
// never reaches OrdersModule).
// ON9: OrderAnalyticsController is registered FIRST so its
// literal "analytics"/"digest" segments win over OrdersController's
// ":orderId" route. OrderAnalyticsService is exported for the
// AutomationModule owner_order_digest job (OrdersModule is
// already imported there — no cycle).
// ON10: PrintCenterController is registered ahead of both for
// the same reason (literal "print-jobs"/"print-template").
// PrintCenterService is exported for the FulfillmentModule ON1
// bulk reroute (FulfillmentModule already imports OrdersModule).
// ON12: OrderTeamPerformanceController likewise precedes
// OrdersController (literal "team-performance"); its service is
// read-only over existing rows (no schema change).
// GC12: ConnectionsModule joins for TenantPaymentsService (the
// payment-link resend's initiation + option validation). It
// imports nothing, so there is no cycle; ShopAccountService for
// the resend SMS already arrives via StorefrontModule.
// NF8: StorageModule supplies StorageService +
// StorageRegistryService for review-media uploads (ReviewsService)
// and signed media URLs (ProductReviewsService); SocialModule
// supplies SocialService for the share-as-draft action. Neither
// reaches OrdersModule (Social -> Ai/Storage only), so no cycle.
@Module({ imports: [IntegrationsModule, InventoryModule, MessagingModule, CommerceModule, FraudModule, FraudNetworkModule, StorefrontModule, ConnectionsModule, StorageModule, SocialModule], controllers: [PrintCenterController, OrderAnalyticsController, OrderTeamPerformanceController, OrdersController, OrderProfitController, ReviewsController, PublicReviewController, OrderChaseController, PackingScanController, ProductReviewsController, PublicProductReviewsController, ReviewInsightsController, PublicReviewInsightController], providers: [OrdersService, OrderInsightsService, RiskService, ReviewsService, OrderChaseService, PackingScanService, ProductReviewsService, ReviewInsightsService, LlmFactory, FraudShieldService, OrderSurgeryService, OrderProfitService, OrderAnalyticsService, PrintCenterService, OrderTeamPerformanceService, PaymentResendService], exports: [OrdersService, OrderInsightsService, RiskService, ReviewsService, OrderChaseService, PackingScanService, ProductReviewsService, ReviewInsightsService, FraudShieldService, OrderSurgeryService, OrderAnalyticsService, PrintCenterService, OrderProfitService] })
export class OrdersModule {}

