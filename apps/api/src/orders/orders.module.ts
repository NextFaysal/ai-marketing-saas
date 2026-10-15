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
@Module({ imports: [IntegrationsModule, InventoryModule, MessagingModule, CommerceModule], controllers: [OrdersController, ReviewsController, PublicReviewController, OrderChaseController, PackingScanController, ProductReviewsController, PublicProductReviewsController], providers: [OrdersService, RiskService, ReviewsService, OrderChaseService, PackingScanService, ProductReviewsService], exports: [OrdersService, RiskService, ReviewsService, OrderChaseService, PackingScanService, ProductReviewsService] })
export class OrdersModule {}

